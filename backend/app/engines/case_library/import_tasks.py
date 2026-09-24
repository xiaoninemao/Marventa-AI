from __future__ import annotations

import html
import json
import re
import sqlite3
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any

from app.config import DB_PATH
from app.database import connect_database
from app.engines.case_library.models import CaseResponse
from app.engines.case_library.storage import (
    create_case,
    get_case,
    update_case,
)
from app.storage_schema import ensure_json_columns, ensure_organization_scope

ALLOWED_HOSTS = (
    "xiaohongshu.com",
    "xhslink.com",
    "douyin.com",
    "iesdouyin.com",
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def init_import_tasks_db() -> None:
    conn = _get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS case_import_tasks (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL DEFAULT '',
            platform TEXT NOT NULL DEFAULT 'unknown',
            source_url TEXT NOT NULL DEFAULT '',
            raw_input TEXT NOT NULL DEFAULT '',
            manual_text TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            recognition_status TEXT NOT NULL DEFAULT 'pending',
            parsed_data TEXT DEFAULT '{}',
            ai_analysis TEXT DEFAULT '{}',
            case_id TEXT DEFAULT '',
            logs TEXT DEFAULT '[]',
            error TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    ensure_organization_scope(conn, "case_import_tasks", "owner_id")
    ensure_json_columns(
        conn, "case_import_tasks", ("parsed_data", "ai_analysis", "logs"),
    )
    conn.commit()
    conn.close()


def detect_platform(value: str) -> str:
    text = (value or "").lower()
    if "xiaohongshu" in text or "xhslink" in text or "小红书" in value:
        return "xiaohongshu"
    if "douyin" in text or "iesdouyin" in text or "抖音" in value:
        return "douyin"
    return "unknown"


def extract_first_url(value: str) -> str:
    match = re.search(r"https?://[^\s`\"'<>，。；、]+", value or "", re.I)
    return match.group(0) if match else ""


def _is_allowed_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    return parsed.scheme in ("http", "https") and any(
        host == item or host.endswith(f".{item}") for item in ALLOWED_HOSTS
    )


def _normalize_count(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).replace(",", "").replace("+", "").strip()
    match = re.search(r"(\d+(?:\.\d+)?)(\s*(?:w|W|万|k|K|千))?", text)
    if not match:
        return None
    base = float(match.group(1))
    unit = (match.group(2) or "").strip().lower()
    if unit in ("w", "万"):
        base *= 10000
    elif unit in ("k", "千"):
        base *= 1000
    return round(base)


def _normalize_compact_count(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).replace(",", "").replace("+", "").strip()
    match = re.search(r"(\d+(?:\.\d+)?)(\s*(?:w|W|万|萬|亿|億|k|K|千)?)", text)
    if not match:
        return None
    base = float(match.group(1))
    unit = (match.group(2) or "").strip().lower()
    if unit in ("w", "万", "萬"):
        base *= 10000
    elif unit in ("亿", "億"):
        base *= 100000000
    elif unit in ("k", "千"):
        base *= 1000
    return round(base)


def _extract_metric(text: str, keywords: tuple[str, ...]) -> int | None:
    for keyword in keywords:
        after = re.search(
            rf"{keyword}[^\d]{{0,10}}(\d+(?:\.\d+)?\s*(?:w|W|万|k|K|千)?\+?)",
            text,
            re.I,
        )
        if after:
            return _normalize_count(after.group(1))
        before = re.search(
            rf"(\d+(?:\.\d+)?\s*(?:w|W|万|k|K|千)?\+?)[^\d]{{0,10}}{keyword}",
            text,
            re.I,
        )
        if before:
            return _normalize_count(before.group(1))
    return None


def _extract_topics(*texts: str) -> list[str]:
    topics: list[str] = []
    for text in texts:
        for match in re.finditer(r"#([^#\s`，。；、]+)", text or ""):
            topic = match.group(1).strip()
            if topic and topic not in topics:
                topics.append(topic)
    return topics


def _repair_mojibake_text(value: str) -> str:
    if not value:
        return value
    # Some platform pages declare a wrong charset, producing strings such as
    # "ç­è½¦" instead of Chinese. This recovers the common UTF-8-as-Latin-1 case.
    suspicious_markers = ("Ã", "Â", "å", "ç", "è", "æ", "ä", "ï¼", "ã")
    if not any(marker in value for marker in suspicious_markers):
        return value
    try:
        repaired = value.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value
    return repaired if repaired else value


def _repair_mojibake(value: Any) -> Any:
    if isinstance(value, str):
        return _repair_mojibake_text(value)
    if isinstance(value, list):
        return [_repair_mojibake(item) for item in value]
    if isinstance(value, dict):
        return {key: _repair_mojibake(item) for key, item in value.items()}
    return value


def _clean_shared_line(line: str) -> str:
    return (
        re.sub(r"https?://[^\s`\"'<>，。；、]+", "", line)
        .strip(" \t\r\n-_:：")
    )


def parse_shared_post_text(raw_input: str, platform: str = "unknown") -> dict:
    raw = (raw_input or "").strip()
    detected_platform = platform if platform != "unknown" else detect_platform(raw)
    source_url = extract_first_url(raw)
    topics = _extract_topics(raw)
    shared_title_match = re.search(r"【([^】]+)】", raw)
    shared_title = ""
    if shared_title_match:
        shared_title = re.sub(
            r"\s*[|｜]\s*(?:小红书|抖音).*$", "",
            shared_title_match.group(1),
            flags=re.I,
        ).strip()

    metric_line_re = re.compile(
        r"(likes?|点赞|赞|收藏|favorites?|collects?|comments?|评论)",
        re.I,
    )
    platform_line_re = re.compile(r"(xiaohongshu|xhslink|douyin|iesdouyin|小红书|抖音)", re.I)

    lines = []
    for line in raw.splitlines():
        cleaned = _clean_shared_line(line)
        if not cleaned or cleaned.startswith("#"):
            continue
        if metric_line_re.search(cleaned) or platform_line_re.search(cleaned):
            continue
        lines.append(cleaned)

    title = (shared_title or (lines[0] if lines else "")).strip()[:100]
    body_lines = lines[1:] if len(lines) > 1 else []
    body = "\n".join(body_lines).strip()
    if not body:
        body = re.sub(r"https?://[^\s`\"'<>，。；、]+", "", raw)
        body = re.sub(r"\d*\s*【[^】]+】", "", body)
        body = re.sub(r"\b[A-Za-z0-9]{8,}\b", "", body)
        body = re.sub(r"#([^#\s`，。；、]+)", "", body).strip()
        if title:
            body = body.replace(title, "", 1).strip()
        if len(re.sub(r"[\W_]+", "", body, flags=re.UNICODE)) < 10:
            body = ""

    likes = _extract_metric(raw, ("likes?", "点赞", "赞", "喜欢"))
    collects = _extract_metric(raw, ("favorites?", "collects?", "收藏"))
    comments = _extract_metric(raw, ("comments?", "评论"))

    content_type = "video" if detected_platform == "douyin" else "image_text"
    has_core = bool(title and (body or topics))
    has_any = bool(title or body or topics or likes is not None or collects is not None or comments is not None)

    return {
        "platform": detected_platform,
        "source_url": source_url,
        "title": title,
        "body": body[:4000],
        "topics": topics,
        "likes": likes,
        "collects": collects,
        "comments": comments,
        "content_type": content_type if has_any else "pending",
        "recognition_status": "recognized" if has_core else "partial" if has_any else "pending",
    }


def _extract_meta(page_html: str, key: str) -> str:
    escaped = re.escape(key)
    patterns = [
        rf"<meta\b(?=[^>]*(?:name|property)=['\"]{escaped}['\"])(?=[^>]*content=['\"]([^'\"]*)['\"])[^>]*>",
        rf"<meta\b(?=[^>]*content=['\"]([^'\"]*)['\"])(?=[^>]*(?:name|property)=['\"]{escaped}['\"])[^>]*>",
    ]
    for pattern in patterns:
        match = re.search(pattern, page_html, re.I | re.S)
        if match:
            return html.unescape(match.group(1)).strip()
    return ""


def _normalize_image_url(url: str) -> str:
    value = html.unescape(url or "").strip()
    if value.startswith("//"):
        return f"https:{value}"
    return value


def _extract_public_interaction_counts(page_html: str) -> dict[str, int | None]:
    match = re.search(r'"interactInfo"\s*:\s*(\{[^{}]*\})', page_html or "", re.S)
    if not match:
        return {"likes": None, "collects": None, "comments": None}
    try:
        data = json.loads(html.unescape(match.group(1)))
    except (json.JSONDecodeError, TypeError):
        data = {}
    return {
        "likes": _normalize_count(data.get("likedCount")),
        "collects": _normalize_count(data.get("collectedCount")),
        "comments": _normalize_count(data.get("commentCount")),
    }


def _find_nested(obj: Any, keys: set[str]) -> Any:
    if isinstance(obj, dict):
        for key, value in obj.items():
            normalized = re.sub(r"[_\-\s]", "", str(key)).lower()
            if normalized in keys and value not in (None, "", []):
                return value
        for value in obj.values():
            found = _find_nested(value, keys)
            if found not in (None, "", []):
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _find_nested(item, keys)
            if found not in (None, "", []):
                return found
    return None


def _find_nested_count(obj: Any, keys: set[str]) -> int | None:
    return _normalize_compact_count(_find_nested(obj, keys))


def _first_url(value: Any) -> str:
    if isinstance(value, str):
        return _normalize_image_url(value)
    if isinstance(value, dict):
        found = _find_nested(value, {"url", "uri", "urllist"})
        return _first_url(found)
    if isinstance(value, list):
        for item in value:
            found = _first_url(item)
            if found:
                return found
    return ""


def _extract_douyin_aweme_id(url: str) -> str:
    parsed = urllib.parse.urlparse(url or "")
    query = urllib.parse.parse_qs(parsed.query)
    for key in ("modal_id", "aweme_id", "item_id", "video_id"):
        value = (query.get(key) or [""])[0]
        if re.fullmatch(r"\d{10,25}", value or ""):
            return value
    match = re.search(r"/(?:video|share/video)/(\d{10,25})", parsed.path)
    return match.group(1) if match else ""


def _parse_douyin_aweme_payload(payload: dict, source_url: str) -> dict | None:
    aweme = payload.get("aweme_detail") or payload.get("aweme") or {}
    if not aweme and isinstance(payload.get("item_list"), list) and payload["item_list"]:
        aweme = payload["item_list"][0]
    if not aweme:
        return None

    title = str(aweme.get("desc") or aweme.get("preview_title") or aweme.get("title") or "").strip()
    text_extra = aweme.get("text_extra") or aweme.get("textExtra") or []
    topics = []
    if isinstance(text_extra, list):
        for item in text_extra:
            if isinstance(item, dict):
                tag = str(item.get("hashtag_name") or item.get("hashtagName") or "").strip()
                if tag and tag not in topics:
                    topics.append(tag)
    topics = list(dict.fromkeys([*topics, *_extract_topics(title)]))

    statistics = aweme.get("statistics") or aweme.get("stats") or aweme
    video = aweme.get("video") or {}
    cover_url = _first_url(
        video.get("cover")
        or video.get("origin_cover")
        or video.get("dynamic_cover")
        or aweme.get("cover")
    )
    video_url = _first_url(video.get("play_addr") or video.get("playAddr") or video.get("download_addr"))

    return {
        "platform": "douyin",
        "source_url": source_url,
        "title": title,
        "body": title,
        "topics": topics,
        "likes": _find_nested_count(statistics, {"diggcount", "likecount", "likedcount"}),
        "collects": _find_nested_count(statistics, {"collectcount", "collectedcount", "favcount", "favoritecount"}),
        "comments": _find_nested_count(statistics, {"commentcount", "comments"}),
        "cover_url": cover_url,
        "image_urls": [cover_url] if cover_url else [],
        "video_url": video_url,
        "content_type": "video",
        "recognition_status": "recognized" if title and (cover_url or video_url) else "partial" if title else "pending",
    }


def _fetch_douyin_aweme_detail(url: str) -> tuple[dict | None, str | None]:
    aweme_id = _extract_douyin_aweme_id(url)
    if not aweme_id:
        return None, "missing_aweme_id"
    endpoints = [
        f"https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id={aweme_id}&aid=6383&device_platform=webapp",
        f"https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids={aweme_id}",
    ]
    for endpoint in endpoints:
        request = urllib.request.Request(
            endpoint,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
                "Referer": "https://www.douyin.com/",
                "Accept": "application/json,text/plain,*/*",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                raw = response.read(2 * 1024 * 1024)
            if not raw:
                continue
            payload = json.loads(raw.decode("utf-8", errors="replace"))
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
            continue
        parsed = _parse_douyin_aweme_payload(payload, url)
        if parsed and parsed.get("recognition_status") != "pending":
            return parsed, None
        if payload.get("status_msg"):
            return None, str(payload.get("status_msg"))
    return None, "douyin_public_detail_blocked"


def _extract_json_objects(page_html: str) -> list[dict]:
    objects = []
    for pattern in (
        r'<script[^>]*id=["\']RENDER_DATA["\'][^>]*>(.*?)</script>',
        r'<script[^>]*id=["\']__ROUTER_DATA__["\'][^>]*>(.*?)</script>',
    ):
        for match in re.finditer(pattern, page_html or "", re.I | re.S):
            text = html.unescape(match.group(1)).strip()
            try:
                text = urllib.parse.unquote(text)
                objects.append(json.loads(text))
            except (json.JSONDecodeError, ValueError):
                pass
    return objects


def _parse_douyin_rendered_text(text: str, title: str) -> dict[str, int | None]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    def strict_count(line: str) -> int | None:
        if not re.fullmatch(r"\d+(?:\.\d+)?\s*(?:w|W|万|萬|亿|億|k|K|千)?", line or ""):
            return None
        return _normalize_compact_count(line)

    counts: list[int] = []
    start_index = 0
    for marker in ("我知道了", "00:00 /"):
        for index, line in enumerate(lines):
            if marker in line:
                start_index = index
                break
        if start_index:
            break

    for index, line in enumerate(lines[start_index:], start=start_index):
        if line == "连播":
            window = lines[index + 1 : index + 12]
            for item in window:
                count = strict_count(item)
                if count is not None:
                    counts.append(count)
                if len(counts) >= 4:
                    break
            if len(counts) >= 3:
                break
    if len(counts) < 3:
        for index, line in enumerate(lines[start_index:], start=start_index):
            if re.search(r"\d{1,2}:\d{2}\s*/\s*\d{1,2}:\d{2}", line):
                window = lines[index + 1 : index + 15]
                for item in window:
                    count = strict_count(item)
                    if count is not None:
                        counts.append(count)
                    if len(counts) >= 4:
                        break
                if len(counts) >= 3:
                    break
    if len(counts) < 3 and title:
        title_head = title.split(" - ")[0][:24]
        for index, line in enumerate(lines):
            if title_head and title_head in line:
                if index > 0:
                    count = strict_count(lines[index - 1])
                    if count is not None:
                        counts.append(count)
                if counts:
                    break
    if not counts:
        for item in lines:
            count = strict_count(item)
            if count is not None and count not in counts:
                counts.append(count)
            if len(counts) >= 4:
                break
    return {
        "likes": counts[0] if len(counts) > 0 else None,
        "comments": counts[1] if len(counts) > 1 else None,
        "collects": counts[2] if len(counts) > 2 else None,
    }


def _fetch_douyin_with_browser(url: str) -> tuple[dict | None, str | None]:
    result: dict[str, Any] = {"parsed": None, "error": None}

    def run() -> None:
        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:
            result["error"] = f"playwright_unavailable: {exc}"
            return

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    )
                )
                page.goto(url, wait_until="commit", timeout=45000)
                page.wait_for_timeout(20000)
                data = page.evaluate(
                    """() => {
                        const meta = {};
                        for (const m of document.querySelectorAll('meta')) {
                            const key = m.getAttribute('name') || m.getAttribute('property');
                            if (key) meta[key] = m.getAttribute('content') || '';
                        }
                        return {
                            url: location.href,
                            title: document.title || '',
                            text: document.body?.innerText || '',
                            cover: meta['lark:url:video_cover_image_url'] || meta['og:image'] || '',
                            iframe: meta['lark:url:video_iframe_url'] || '',
                            description: meta['description'] || meta['og:description'] || ''
                        };
                    }"""
                )
                browser.close()
        except Exception as exc:
            result["error"] = f"playwright_failed: {exc}"
            return

        title = re.sub(r"\s*-\s*抖音\s*$", "", str(data.get("title") or "")).strip()
        description = str(data.get("description") or "").strip()
        if not title and description:
            title = re.sub(r"\s*-\s*.*$", "", description).strip()
        metrics = _parse_douyin_rendered_text(str(data.get("text") or ""), title)
        cover_url = _normalize_image_url(str(data.get("cover") or ""))
        topics = _extract_topics(title, description)
        has_any = bool(title or cover_url or any(value is not None for value in metrics.values()))
        if not has_any:
            result["error"] = "douyin_browser_no_public_fields"
            return
        result["parsed"] = {
            "platform": "douyin",
            "source_url": str(data.get("url") or url),
            "title": title,
            "body": description or title,
            "topics": topics,
            "likes": metrics["likes"],
            "collects": metrics["collects"],
            "comments": metrics["comments"],
            "cover_url": cover_url,
            "image_urls": [cover_url] if cover_url else [],
            "video_url": str(data.get("iframe") or ""),
            "content_type": "video",
            "recognition_status": "recognized" if title and (cover_url or metrics["likes"] is not None) else "partial",
        }

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(timeout=45)
    if thread.is_alive():
        return None, "playwright_timeout"
    if result["parsed"]:
        return result["parsed"], None
    return None, str(result["error"] or "playwright_failed")


def _fetch_public_html(url: str) -> tuple[str, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        final_url = response.geturl()
        content_type = response.headers.get("content-type", "")
        data = response.read(2 * 1024 * 1024)
    charset_match = re.search(r"charset=([\w-]+)", content_type, re.I)
    charset = charset_match.group(1) if charset_match else "utf-8"
    return data.decode(charset, errors="replace"), final_url


def _parse_public_html(page_html: str, final_url: str, platform: str) -> dict:
    if platform == "douyin":
        for obj in _extract_json_objects(page_html):
            parsed = _parse_douyin_aweme_payload(obj, final_url)
            if parsed:
                return parsed

    meta_title = _extract_meta(page_html, "og:title")
    if not meta_title:
        title_match = re.search(r"<title[^>]*>(.*?)</title>", page_html, re.I | re.S)
        meta_title = html.unescape(re.sub(r"\s+", " ", title_match.group(1))).strip() if title_match else ""
    description = _repair_mojibake_text(_extract_meta(page_html, "description") or _extract_meta(page_html, "og:description"))
    keywords = _repair_mojibake_text(_extract_meta(page_html, "keywords"))
    cover_url = _normalize_image_url(
        _extract_meta(page_html, "og:image")
        or _extract_meta(page_html, "twitter:image")
        or _extract_meta(page_html, "image")
    )
    meta_title = _repair_mojibake_text(meta_title)
    title = re.sub(r"\s*[-_]\s*(小红书|抖音).*$", "", meta_title).strip()
    topics = _extract_topics(title, description, keywords)
    metrics = _extract_public_interaction_counts(page_html)
    has_any = bool(title or description or topics)
    return {
        "platform": platform,
        "source_url": final_url,
        "title": title,
        "body": description,
        "topics": topics,
        "likes": metrics["likes"],
        "collects": metrics["collects"],
        "comments": metrics["comments"],
        "cover_url": cover_url,
        "image_urls": [cover_url] if cover_url else [],
        "content_type": "video" if platform == "douyin" else "image_text",
        "recognition_status": "recognized" if title and (description or topics) else "partial" if has_any else "pending",
    }


def parse_public_link(url: str, platform: str) -> tuple[dict | None, str | None]:
    if not url or not _is_allowed_url(url):
        return None, "unsupported_url"
    try:
        if platform == "douyin" or detect_platform(url) == "douyin":
            parsed, error = _fetch_douyin_aweme_detail(url)
            if parsed:
                return parsed, None
            detail_error = error
            browser_parsed, browser_error = _fetch_douyin_with_browser(url)
            if browser_parsed:
                return browser_parsed, None
            if browser_error:
                detail_error = f"{detail_error}; {browser_error}" if detail_error else browser_error
        else:
            detail_error = None
        page_html, final_url = _fetch_public_html(url)
        final_platform = detect_platform(final_url)
        parsed = _parse_public_html(page_html, final_url, final_platform if final_platform != "unknown" else platform)
        if (
            (final_platform == "douyin" or platform == "douyin")
            and parsed.get("recognition_status") == "pending"
            and "playwright_" not in (detail_error or "")
        ):
            browser_parsed, browser_error = _fetch_douyin_with_browser(url)
            if browser_parsed:
                return browser_parsed, None
            if browser_error:
                detail_error = f"{detail_error}; {browser_error}" if detail_error else browser_error
        if parsed.get("recognition_status") == "pending" and detail_error:
            return parsed, detail_error
        return parsed, None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        if platform == "douyin" or detect_platform(url) == "douyin":
            browser_parsed, browser_error = _fetch_douyin_with_browser(url)
            if browser_parsed:
                return browser_parsed, None
            return None, browser_error or str(exc)
        return None, str(exc)


def _has_meaningful_import_content(parsed: dict) -> bool:
    title = str(parsed.get("title") or "").strip()
    body = str(parsed.get("body") or "").strip()
    topics = parsed.get("topics") or []
    image_urls = [
        str(url) for url in (parsed.get("image_urls") or [])
        if "picasso-static.xiaohongshu.com/fe-platform/" not in str(url)
    ]
    video_url = str(parsed.get("video_url") or "").strip()
    generic_titles = {
        "小红书 - 你的生活兴趣社区",
        "小红书",
        "抖音",
    }
    meaningful_title = bool(title and title not in generic_titles)
    supporting_content = bool(len(body) >= 20 or topics or image_urls or video_url)
    return meaningful_title and supporting_content


def _to_import_task_data(parsed: dict) -> dict:
    return _repair_mojibake({
        **parsed,
        "sourceUrl": parsed.get("source_url", ""),
        "contentType": parsed.get("content_type", "pending"),
        "recognitionStatus": parsed.get("recognition_status", "pending"),
        "aiAnalysis": {},
    })


def _insert_task(owner_id: str, raw_input: str, manual_text: str, platform: str, source_url: str) -> str:
    init_import_tasks_db()
    task_id = uuid.uuid4().hex[:12]
    now = _now()
    conn = _get_conn()
    conn.execute(
        """
        INSERT INTO case_import_tasks (
            id, owner_id, platform, source_url, raw_input, manual_text,
            status, recognition_status, logs, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task_id,
            owner_id,
            platform,
            source_url,
            raw_input,
            manual_text,
            "pending",
            "pending",
            json.dumps(["Task created"]),
            now,
            now,
        ),
    )
    conn.commit()
    conn.close()
    return task_id


def _update_task(task_id: str, **updates: Any) -> None:
    if not updates:
        return
    updates["updated_at"] = _now()
    fields = []
    values = []
    for key, value in updates.items():
        fields.append(f"{key} = ?")
        if key in {"parsed_data", "ai_analysis", "logs"} and not isinstance(value, str):
            values.append(json.dumps(value, ensure_ascii=False))
        else:
            values.append(value)
    values.append(task_id)
    conn = _get_conn()
    conn.execute(f"UPDATE case_import_tasks SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()


def get_import_task(task_id: str) -> dict | None:
    init_import_tasks_db()
    conn = _get_conn()
    row = conn.execute("SELECT * FROM case_import_tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    if not row:
        return None
    data = dict(row)
    for key in ("parsed_data", "ai_analysis", "logs"):
        try:
            data[key] = json.loads(data.get(key) or ("[]" if key == "logs" else "{}"))
        except (json.JSONDecodeError, TypeError):
            data[key] = [] if key == "logs" else {}
    case_id = data.get("case_id") or ""
    data["case"] = get_case(case_id).model_dump() if case_id and get_case(case_id) else None
    return data


def _run_import_task(
    *,
    task_id: str,
    local_parsed: dict,
    source_url: str,
    platform: str,
    case_id: str,
) -> None:
    logs = ["Task created", "Case created immediately", "Parsing shared text"]
    try:
        parsed = local_parsed

        if source_url:
            logs.append("Trying public page metadata fetch")
            remote, error = parse_public_link(source_url, platform)
            if remote and remote.get("recognition_status") != "pending":
                parsed = _merge_parsed(local_parsed, remote)
                logs.append("Public metadata parsed")
            elif remote:
                parsed = _merge_parsed(local_parsed, remote)
                logs.append(f"Public metadata unavailable: {error or 'no public fields'}")
            else:
                logs.append(f"Public fetch skipped or failed: {error}")

        has_import_content = _has_meaningful_import_content(parsed)
        if has_import_content:
            logs.append("AI analysis deferred for manual start")
        else:
            logs.append("Public page did not expose enough post content")

        case: CaseResponse | None = get_case(case_id) if case_id else None
        if case is not None:
            title = parsed.get("title") or f"{parsed.get('platform', platform)} imported case"
            tags = list(dict.fromkeys(["link-import", parsed.get("platform", platform), *(parsed.get("topics") or [])]))
            update_case(
                case.id,
                title=title,
                content_type=parsed.get("content_type") if parsed.get("content_type") in ("video", "image_text") else "image_text",
                description=parsed.get("body") or "",
                tags=tags,
                video_url=parsed.get("video_url") or "",
                image_urls=parsed.get("image_urls") or ([parsed.get("cover_url")] if parsed.get("cover_url") else []),
                source=source_url or parsed.get("platform", platform),
                cover_url=parsed.get("cover_url") or "",
                likes=parsed.get("likes"),
                favorites_count=parsed.get("collects"),
                comments=parsed.get("comments"),
                recognition_status=parsed.get("recognition_status", "pending"),
            )
            case = get_case(case.id)
            logs.append(f"Case updated: {case.id if case else ''}")

        parsed_data = _to_import_task_data(parsed)
        _update_task(
            task_id,
            status="completed",
            recognition_status=parsed.get("recognition_status", "pending"),
            parsed_data=parsed_data,
            ai_analysis={},
            case_id=case.id if case else "",
            logs=logs,
        )
    except Exception as exc:
        logs.append(f"Import failed: {exc}")
        if case_id:
            update_case(case_id, recognition_status="partial")
        _update_task(task_id, status="failed", error=str(exc), logs=logs)


def create_and_run_import_task(
    *,
    owner_id: str,
    raw_input: str,
    manual_text: str = "",
    save_case: bool = True,
    project_id: str = "",
) -> dict:
    text_for_detection = "\n".join([raw_input or "", manual_text or ""])
    platform = detect_platform(text_for_detection)
    source_url = extract_first_url(text_for_detection)
    task_id = _insert_task(owner_id, raw_input, manual_text, platform, source_url)
    local_parsed = parse_shared_post_text(text_for_detection, platform=platform)
    case: CaseResponse | None = None
    try:
        if save_case:
            platform_label = "Douyin" if platform == "douyin" else "Xiaohongshu" if platform == "xiaohongshu" else "Link"
            title = local_parsed.get("title") or f"{platform_label} imported case"
            tags = list(dict.fromkeys([
                "link-import", platform, *(local_parsed.get("topics") or []),
            ]))
            case = create_case(
                title=title,
                content_type="video" if platform == "douyin" else "image_text",
                description=local_parsed.get("body") or "",
                tags=tags,
                video_url="",
                image_urls=[],
                owner_id=owner_id,
                source=source_url or platform,
                project_id=project_id,
            )
            update_case(case.id, recognition_status="pending")
        _update_task(
            task_id,
            status="pending",
            recognition_status=local_parsed.get("recognition_status", "pending"),
            parsed_data=local_parsed,
            case_id=case.id if case else "",
            logs=["Task created", *(["Case created immediately"] if case else [])],
        )
    except Exception as exc:
        _update_task(
            task_id, status="failed", error=str(exc),
            logs=["Task created", f"Case creation failed: {exc}"],
        )
        return get_import_task(task_id) or {}

    thread = threading.Thread(
        target=_run_import_task,
        kwargs={
            "task_id": task_id,
            "local_parsed": local_parsed,
            "source_url": source_url,
            "platform": platform,
            "case_id": case.id if case else "",
        },
        daemon=True,
    )
    thread.start()
    return get_import_task(task_id) or {}


def _merge_parsed(local: dict, remote: dict) -> dict:
    merged = dict(local)
    for key in ("platform", "source_url", "title", "body", "content_type", "cover_url", "video_url"):
        if remote.get(key) and (not merged.get(key) or merged.get(key) == "pending"):
            merged[key] = remote[key]
    if not merged.get("image_urls") and remote.get("image_urls"):
        merged["image_urls"] = remote["image_urls"]
    for key in ("likes", "collects", "comments"):
        if merged.get(key) is None and remote.get(key) is not None:
            merged[key] = remote[key]
    merged["topics"] = list(dict.fromkeys([*(local.get("topics") or []), *(remote.get("topics") or [])]))
    statuses = [local.get("recognition_status"), remote.get("recognition_status")]
    merged["recognition_status"] = "recognized" if "recognized" in statuses else "partial" if "partial" in statuses else "pending"
    return merged
