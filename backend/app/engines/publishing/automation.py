from __future__ import annotations

import os
import queue
import logging
import hashlib
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.config import MEDIA_ROOT
from app.engines.publishing.account_import import read_encrypted_json, write_encrypted_json
from app.engines.publishing.models import PublishTask, SocialAccount

logger = logging.getLogger(__name__)
DATA_ROOT = os.path.abspath(os.path.join(MEDIA_ROOT, os.pardir))

_login_threads: dict[str, threading.Thread] = {}
_login_sessions: dict[str, "_LoginSession"] = {}
_login_sessions_lock = threading.Lock()

PLATFORM_URLS = {
    "douyin": {
        "login": "https://creator.douyin.com/",
        "publish": "https://creator.douyin.com/creator-micro/content/upload",
    },
    "xiaohongshu": {
        "login": "https://creator.xiaohongshu.com/",
        "publish": "https://creator.xiaohongshu.com/publish/publish?source=official",
    },
}


class LoginSessionExpired(RuntimeError):
    pass


@dataclass
class _LoginSession:
    login_session_id: str
    user_id: str
    platform: str
    account_name: str
    session_dir: str
    storage_state_file: str
    requests: "queue.Queue[dict[str, Any]]" = field(default_factory=queue.Queue)
    thread: threading.Thread | None = None
    last_error: str = ""


def session_dir_for(user_id: str, platform: str, account_name: str) -> str:
    safe_name = "".join(ch if ch.isalnum() else "_" for ch in account_name)[:40] or "default"
    path = os.path.join(MEDIA_ROOT, "platform_sessions", user_id, platform, safe_name)
    os.makedirs(path, exist_ok=True)
    return path


def login_session_paths_for(user_id: str, platform: str, login_session_id: str, account_name: str = "") -> dict[str, str]:
    safe_session_id = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in login_session_id)[:64] or "login"
    safe_platform = "".join(ch if ch.isalnum() else "_" for ch in platform)[:32] or "platform"
    safe_user = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in user_id)[:64] or "user"
    session_dir = os.path.join(MEDIA_ROOT, "platform_sessions", safe_user, safe_platform, safe_session_id)
    storage_state_dir = os.path.join(DATA_ROOT, "platform_storage_states", safe_user, safe_platform)
    os.makedirs(session_dir, exist_ok=True)
    os.makedirs(storage_state_dir, exist_ok=True)
    os.chmod(session_dir, 0o700)
    os.chmod(storage_state_dir, 0o700)
    return {
        "session_dir": session_dir,
        "storage_state_file": os.path.join(storage_state_dir, f"{safe_session_id}.json"),
    }


def stable_login_session_id_for(platform: str, account_name: str = "", account_id: str = "", fresh: bool = False) -> str:
    if fresh:
        return f"login_{uuid.uuid4().hex[:16]}"
    if account_id:
        safe_account_id = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in account_id)[:48]
        return f"account_{safe_account_id or uuid.uuid4().hex[:12]}"
    seed = f"{platform}:{account_name or 'default'}".encode("utf-8")
    return f"account_{hashlib.sha1(seed).hexdigest()[:16]}"


def launch_login_window(user_id: str, platform: str, account_name: str, account_id: str = "", fresh: bool = False) -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    login_session_id = stable_login_session_id_for(platform, account_name, account_id=account_id, fresh=fresh)
    paths = login_session_paths_for(user_id, platform, login_session_id, account_name)
    session_dir = paths["session_dir"]
    storage_state_file = paths["storage_state_file"]
    login_url = PLATFORM_URLS.get(platform, PLATFORM_URLS["douyin"])["login"]
    key = f"{user_id}:{platform}:{login_session_id}"

    with _login_sessions_lock:
        existing = _login_sessions.get(login_session_id)
    if existing:
        return {
            "login_session_id": existing.login_session_id,
            "session_dir": existing.session_dir,
            "storage_state_file": existing.storage_state_file,
            "login_url": login_url,
            "status": "opened",
        }

    login_session = _LoginSession(
        login_session_id=login_session_id,
        user_id=user_id,
        platform=platform,
        account_name=account_name,
        session_dir=session_dir,
        storage_state_file=storage_state_file,
    )

    def _runner() -> None:
        context = None
        with sync_playwright() as p:
            try:
                context = p.chromium.launch_persistent_context(
                    session_dir,
                    headless=False,
                    viewport={"width": 1440, "height": 960},
                    args=["--disable-blink-features=AutomationControlled"],
                )
                page = context.pages[0] if context.pages else context.new_page()
                page.goto(login_url, wait_until="domcontentloaded", timeout=60000)
                deadline = time.time() + 900
                should_close = False
                while time.time() < deadline and not should_close:
                    try:
                        request = login_session.requests.get(timeout=0.5)
                    except queue.Empty:
                        if len(context.pages) == 0:
                            break
                        continue
                    if request.get("type") == "export":
                        response_queue = request["response"]
                        try:
                            state = _export_context_login_state(
                                context,
                                page,
                                platform,
                                storage_state_file,
                                session_dir,
                            )
                            response_queue.put({"ok": True, "state": state})
                        except Exception as exc:
                            response_queue.put({"ok": False, "error": str(exc)})
                        should_close = bool(request.get("close", True))
            except Exception as exc:
                login_session.last_error = str(exc)
                _fail_pending_login_requests(login_session, exc)
                logger.warning("login window failed: platform=%s session=%s error=%s", platform, login_session_id, exc)
            finally:
                if context:
                    try:
                        context.close()
                    except Exception:
                        pass
                with _login_sessions_lock:
                    _login_sessions.pop(login_session_id, None)

    thread = threading.Thread(target=_runner, name=f"platform-login-{platform}", daemon=True)
    _login_threads[key] = thread
    login_session.thread = thread
    with _login_sessions_lock:
        _login_sessions[login_session_id] = login_session
    thread.start()
    return {
        "login_session_id": login_session_id,
        "session_dir": session_dir,
        "storage_state_file": storage_state_file,
        "login_url": login_url,
        "status": "opened",
    }


def export_login_session_state(login_session_id: str, timeout: float = 30, close_after_export: bool = True) -> dict[str, Any]:
    with _login_sessions_lock:
        login_session = _login_sessions.get(login_session_id)
    if not login_session:
        raise LoginSessionExpired("login_session_expired")
    response_queue: "queue.Queue[dict[str, Any]]" = queue.Queue(maxsize=1)
    login_session.requests.put({"type": "export", "response": response_queue, "close": close_after_export})
    try:
        response = response_queue.get(timeout=timeout)
    except queue.Empty:
        raise TimeoutError("导出登录态超时，请确认登录窗口仍然打开并已完成平台登录")
    if not response.get("ok"):
        raise RuntimeError(str(response.get("error") or "导出登录态失败"))
    return response["state"]


def _fail_pending_login_requests(login_session: _LoginSession, exc: Exception) -> None:
    while True:
        try:
            request = login_session.requests.get_nowait()
        except queue.Empty:
            return
        if request.get("type") == "export" and "response" in request:
            request["response"].put({"ok": False, "error": str(exc)})


def _export_context_login_state(context: Any, page: Any, platform: str, storage_state_file: str, session_dir: str) -> dict[str, Any]:
    os.makedirs(os.path.dirname(storage_state_file), exist_ok=True)
    storage_state = context.storage_state()
    write_encrypted_json(storage_state_file, storage_state)
    page_info = _page_info(page, platform)
    state = build_login_state_from_storage_state(storage_state, platform, page_info, storage_state_file)
    state["session_dir"] = session_dir
    logger.info(
        "login storage_state exported: session_dir=%s storage_state_file=%s cookies=%s origins=%s launch_persistent_context_on_save=false",
        session_dir,
        storage_state_file,
        state.get("cookie_count", 0),
        len(state.get("origins") or []),
    )
    return state


def _page_info(page: Any, platform: str) -> dict[str, str]:
    title = ""
    url = ""
    nickname = ""
    avatar_url = ""
    profile_url = ""
    platform_user_id = ""
    followers = ""
    try:
        title = page.title()
        url = page.url
    except Exception:
        pass
    try:
        nickname, avatar_url, profile_url, platform_user_id, followers = _parse_profile_hint_v2(page, platform)
    except Exception as exc:
        logger.warning("nickname parse failed: platform=%s error=%s", platform, exc)
    return {
        "title": title,
        "home_url": url,
        "nickname": nickname,
        "avatar_url": avatar_url,
        "profile_url": profile_url or url,
        "platform_user_id": platform_user_id,
        "followers": followers,
    }


def build_login_state_from_storage_state(
    storage_state: dict[str, Any],
    platform: str,
    page_info: dict[str, Any] | None = None,
    storage_state_file: str = "",
) -> dict[str, Any]:
    page_info = page_info or {}
    cookies = storage_state.get("cookies", [])
    origins = storage_state.get("origins", [])
    cookie_names = sorted({cookie.get("name", "") for cookie in cookies if cookie.get("name")})
    local_storage = {
        origin.get("origin", ""): origin.get("localStorage", [])
        for origin in origins
        if origin.get("localStorage")
    }
    return {
        "title": page_info.get("title") or "",
        "home_url": page_info.get("home_url") or "",
        "cookie_count": len(cookies),
        "cookie_names": cookie_names,
        "cookies": cookies,
        "origins": origins,
        "local_storage": local_storage,
        "nickname": page_info.get("nickname") or "",
        "avatar_url": page_info.get("avatar_url") or "",
        "profile_url": page_info.get("profile_url") or page_info.get("home_url") or "",
        "platform_user_id": page_info.get("platform_user_id") or "",
        "followers": page_info.get("followers") or "",
        "storage_state_file": storage_state_file,
        "login_checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "authorized": _has_authorized_cookie(platform, cookie_names),
    }


def inspect_login_session(session_dir: str, platform: str) -> dict[str, Any]:
    raise RuntimeError("legacy_profile_inspection_disabled")


def _has_authorized_cookie(platform: str, cookie_names: list[str]) -> bool:
    names = set(cookie_names)
    if platform == "douyin":
        return bool({
            "sessionid",
            "sid_guard",
            "uid_tt",
            "sid_tt",
            "passport_auth_status",
            "passport_csrf_token",
            "odin_tt",
            "ttwid",
        }.intersection(names))
    if platform == "xiaohongshu":
        return bool({
            "web_session",
            "a1",
            "xhsuid",
            "customer-sso-sid",
            "webId",
            "access-token-creator",
            "access-token-creator.xiaohongshu.com",
        }.intersection(names))
    return False


def _parse_profile_hint_v2(page: Any, platform: str) -> tuple[str, str, str, str, str]:
    nickname = ""
    for selector in [
        "[class*='user'] [class*='name']",
        "[class*='nickname']",
        "[class*='avatar']",
        "[data-e2e*='user']",
    ]:
        try:
            locator = page.locator(selector).first
            if locator.count() > 0:
                text = locator.inner_text(timeout=1500).strip()
                if text and len(text) <= 60:
                    nickname = text
                    break
        except Exception:
            continue

    avatar_url = ""
    try:
        avatar = page.locator("img[src*='avatar'], img[class*='avatar'], img[src*='douyinpic'], img[src*='xhscdn']").first
        if avatar.count() > 0:
            avatar_url = str(avatar.get_attribute("src", timeout=1500) or "")
    except Exception:
        avatar_url = ""

    body_text = ""
    page_html = ""
    try:
        body_text = str(page.locator("body").inner_text(timeout=2000) or "")
    except Exception:
        body_text = ""
    try:
        page_html = str(page.content() or "")
    except Exception:
        page_html = ""

    profile_url = _extract_profile_url(page.url, page_html, platform)
    platform_user_id = _extract_platform_user_id(body_text, page_html, profile_url, platform)
    followers = _extract_followers(body_text)
    if not avatar_url:
        avatar_url = _extract_avatar_url(page_html)
    return nickname, avatar_url, profile_url or page.url, platform_user_id, followers


def _extract_profile_url(current_url: str, html: str, platform: str) -> str:
    for pattern in [
        r"https?://(?:www\.)?douyin\.com/user/[A-Za-z0-9._-]+",
        r"https?://www\.xiaohongshu\.com/user/profile/[A-Za-z0-9._-]+",
    ]:
        match = re.search(pattern, html)
        if match:
            return match.group(0)
    if platform == "douyin" and "douyin.com/user/" in current_url:
        return current_url
    if platform == "xiaohongshu" and "/user/profile/" in current_url:
        return current_url
    return ""


def _extract_platform_user_id(text: str, html: str, profile_url: str, platform: str) -> str:
    source = "\n".join([text, html, profile_url])
    patterns = [
        r"小红书号[:：\s]*([A-Za-z0-9_-]{4,})",
        r"RED ID[:：\s]*([A-Za-z0-9_-]{4,})",
        r"user/profile/([A-Za-z0-9._-]+)",
    ] if platform == "xiaohongshu" else [
        r"抖音号[:：\s]*([A-Za-z0-9_-]{4,})",
        r"douyinId[\"'\s:]+([A-Za-z0-9_-]{4,})",
        r"user/([A-Za-z0-9._-]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, source, re.I)
        if match:
            return match.group(1)
    return ""


def _extract_followers(text: str) -> str:
    for pattern in [r"粉丝[:：\s]*([0-9.,]+[万wWkK]?)", r"([0-9.,]+[万wWkK]?)\s*粉丝"]:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return ""


def _extract_avatar_url(html: str) -> str:
    match = re.search(r"<img[^>]+src=[\"']([^\"']*(?:avatar|aweme|douyinpic|xhscdn)[^\"']*)[\"']", html, re.I)
    return match.group(1) if match else ""


def _parse_profile_hint(page: Any, platform: str) -> tuple[str, str, str]:
    candidates = [
        "[class*='user'] [class*='name']",
        "[class*='nickname']",
        "[class*='avatar']",
    ]
    if platform == "xiaohongshu":
        candidates.append("text=/小红书号|账号/")
    nickname = ""
    for selector in candidates:
        try:
            locator = page.locator(selector).first
            if locator.count() > 0:
                text = locator.inner_text(timeout=1500).strip()
                if text and len(text) <= 60:
                    nickname = text
                    break
        except Exception:
            continue
    avatar_url = ""
    try:
        avatar = page.locator("img[src*='avatar'], img[class*='avatar']").first
        if avatar.count() > 0:
            avatar_url = str(avatar.get_attribute("src", timeout=1500) or "")
    except Exception:
        avatar_url = ""
    return nickname, avatar_url, page.url


def publish_task_with_account(task: PublishTask, account: SocialAccount, media_assets: list[dict[str, Any]], dry_run: bool = False) -> dict[str, Any]:
    if task.platform == "douyin":
        return _publish_to_douyin_keepalive(task, account, media_assets, dry_run=dry_run)
    if task.platform == "xiaohongshu":
        return _publish_to_xiaohongshu_keepalive(task, account, media_assets, dry_run=dry_run)
    raise ValueError(f"Unsupported platform: {task.platform}")


def _media_paths(media_assets: list[dict[str, Any]], kind: str | None = None) -> list[str]:
    paths: list[str] = []
    for asset in media_assets:
        if kind and asset.get("kind") != kind:
            continue
        path = str(asset.get("path") or "")
        if path and os.path.exists(path):
            paths.append(path)
    return paths


def _fill_first(page: Any, selectors: list[str], value: str) -> bool:
    if not value:
        return False
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if locator.count() > 0:
                locator.fill(value, timeout=3000)
                return True
        except Exception:
            continue
    return False


def _click_first(page: Any, selectors: list[str]) -> bool:
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if locator.count() > 0:
                locator.click(timeout=5000)
                return True
        except Exception:
            continue
    return False


def _storage_state_file_from_account(account: SocialAccount) -> str:
    profile = getattr(account, "profile", {}) or {}
    storage_state_file = str(profile.get("storage_state_file") or "")
    return storage_state_file if storage_state_file and os.path.exists(storage_state_file) else ""


def _publish_result(status: str, page: Any, message: str = "") -> dict[str, Any]:
    result = {"status": status, "url": page.url}
    if message:
        result["message"] = message
    return result


def _new_publish_context(p: Any, account: SocialAccount) -> tuple[Any, Any | None]:
    if account.session_dir:
        context = p.chromium.launch_persistent_context(
            account.session_dir,
            headless=False,
            viewport={"width": 1440, "height": 960},
            args=["--disable-blink-features=AutomationControlled"],
        )
        return context, None
    storage_state_file = _storage_state_file_from_account(account)
    if storage_state_file:
        browser = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled"])
        context = browser.new_context(
            storage_state=read_encrypted_json(storage_state_file),
            viewport={"width": 1440, "height": 960},
        )
        return context, browser
    raise RuntimeError("account_has_no_login_state")


def _update_storage_state_file(context: Any, account: SocialAccount) -> None:
    storage_state_file = _storage_state_file_from_account(account)
    if not storage_state_file:
        return
    try:
        write_encrypted_json(storage_state_file, context.storage_state())
    except Exception as exc:
        logger.warning("storage_state update failed: account=%s error=%s", getattr(account, "id", ""), exc)


def _close_context(context: Any, browser: Any | None = None) -> None:
    try:
        context.close()
    finally:
        if browser:
            browser.close()


def should_keep_publish_window_open(dry_run: bool, clicked_publish: bool) -> bool:
    return dry_run or not clicked_publish


def _wait_for_manual_window_close(context: Any, max_seconds: int = 7200) -> None:
    deadline = time.time() + max_seconds
    while time.time() < deadline:
        try:
            if len(context.pages) == 0:
                return
        except Exception:
            return
        time.sleep(1)


def _publish_to_douyin(task: PublishTask, account: SocialAccount, media_assets: list[dict[str, Any]], dry_run: bool = False) -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    video_paths = _media_paths(media_assets, "video")
    image_paths = _media_paths(media_assets, "image")
    upload_paths = video_paths[:1] if task.content_type == "video" or video_paths else image_paths[:18]
    if not upload_paths:
        raise ValueError("请先上传视频或图片素材")

    title = str(task.final_snapshot.get("title") or "")
    body = str(task.final_snapshot.get("body") or "")
    tags = str(task.final_snapshot.get("tags") or "")
    mention = str(task.final_snapshot.get("mention") or "")
    description = "\n\n".join(part for part in [body, tags, mention] if part)

    with sync_playwright() as p:
        context, browser = _new_publish_context(p, account)
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(PLATFORM_URLS["douyin"]["publish"], wait_until="domcontentloaded", timeout=90000)
            page.wait_for_timeout(2500)

            file_inputs = page.locator("input[type=file]")
            if file_inputs.count() == 0:
                raise RuntimeError("未找到抖音上传控件，请确认账号已登录创作者中心")
            file_inputs.first.set_input_files(upload_paths)
            page.wait_for_timeout(5000)

            _fill_first(page, [
                "input[placeholder*='标题']",
                "textarea[placeholder*='标题']",
                "[contenteditable=true][data-placeholder*='标题']",
            ], title[:30])
            _fill_first(page, [
                "textarea[placeholder*='简介']",
                "textarea[placeholder*='描述']",
                "textarea[placeholder*='添加作品']",
                "[contenteditable=true][data-placeholder*='简介']",
                "[contenteditable=true][data-placeholder*='描述']",
            ], description)

            if dry_run:
                return {"status": "prepared", "url": page.url, "message": "已完成素材上传和字段填充，dry_run 未点击发布"}

            clicked = _click_first(page, [
                "button:has-text('发布')",
                "button:has-text('立即发布')",
                "text=发布",
                "text=立即发布",
            ])
            page.wait_for_timeout(3000)
            _update_storage_state_file(context, account)
            return {"status": "submitted" if clicked else "needs_manual_confirm", "url": page.url}
        finally:
            _close_context(context, browser)


def _publish_to_xiaohongshu(task: PublishTask, account: SocialAccount, media_assets: list[dict[str, Any]], dry_run: bool = False) -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    image_paths = _media_paths(media_assets, "image")[:18]
    video_paths = _media_paths(media_assets, "video")[:1]
    upload_paths = video_paths if task.content_type == "video" else image_paths
    if not upload_paths:
        raise ValueError("请先上传视频或图片素材")

    title = str(task.final_snapshot.get("title") or "")[:20]
    body = str(task.final_snapshot.get("body") or "")
    tags = str(task.final_snapshot.get("tags") or "")
    note = "\n\n".join(part for part in [body, tags] if part)

    with sync_playwright() as p:
        context, browser = _new_publish_context(p, account)
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(PLATFORM_URLS["xiaohongshu"]["publish"], wait_until="domcontentloaded", timeout=90000)
            page.wait_for_timeout(2500)
            inputs = page.locator("input[type=file]")
            if inputs.count() == 0:
                raise RuntimeError("未找到小红书上传控件，请确认账号已登录创作服务平台")
            inputs.first.set_input_files(upload_paths)
            page.wait_for_timeout(5000)
            _fill_first(page, ["input[placeholder*='标题']", "textarea[placeholder*='标题']"], title)
            _fill_first(page, ["textarea[placeholder*='正文']", "textarea[placeholder*='描述']", "[contenteditable=true]"], note)
            if dry_run:
                return {"status": "prepared", "url": page.url, "message": "已完成素材上传和字段填充，dry_run 未点击发布"}
            clicked = _click_first(page, ["button:has-text('发布')", "button:has-text('立即发布')", "text=发布"])
            page.wait_for_timeout(3000)
            _update_storage_state_file(context, account)
            return {"status": "submitted" if clicked else "needs_manual_confirm", "url": page.url}
        finally:
            _close_context(context, browser)


def _publish_to_douyin_keepalive(task: PublishTask, account: SocialAccount, media_assets: list[dict[str, Any]], dry_run: bool = False) -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    video_paths = _media_paths(media_assets, "video")
    image_paths = _media_paths(media_assets, "image")
    upload_paths = video_paths[:1] if task.content_type == "video" or video_paths else image_paths[:18]
    if not upload_paths:
        raise ValueError("Please upload video or image assets before publishing")

    title = str(task.final_snapshot.get("title") or "")
    body = str(task.final_snapshot.get("body") or "")
    tags = str(task.final_snapshot.get("tags") or "")
    mention = str(task.final_snapshot.get("mention") or "")
    description = "\n\n".join(part for part in [body, tags, mention] if part)

    with sync_playwright() as p:
        context, browser = _new_publish_context(p, account)
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(PLATFORM_URLS["douyin"]["publish"], wait_until="domcontentloaded", timeout=90000)
            page.wait_for_timeout(2500)

            file_inputs = page.locator("input[type=file]")
            if file_inputs.count() == 0:
                raise RuntimeError("Douyin upload control was not found; please confirm the account is logged in")
            file_inputs.first.set_input_files(upload_paths)
            page.wait_for_timeout(5000)

            _fill_first(page, [
                "input[placeholder*='标题']",
                "textarea[placeholder*='标题']",
                "[contenteditable=true][data-placeholder*='标题']",
            ], title[:30])
            _fill_first(page, [
                "textarea[placeholder*='简介']",
                "textarea[placeholder*='描述']",
                "textarea[placeholder*='添加作品']",
                "[contenteditable=true][data-placeholder*='简介']",
                "[contenteditable=true][data-placeholder*='描述']",
            ], description)

            if dry_run:
                _update_storage_state_file(context, account)
                _wait_for_manual_window_close(context)
                return _publish_result("prepared", page, "Publish package prepared; window was kept open for manual review.")

            clicked = _click_first(page, [
                "button:has-text('发布')",
                "button:has-text('立即发布')",
                "text=发布",
                "text=立即发布",
            ])
            page.wait_for_timeout(3000)
            _update_storage_state_file(context, account)
            if should_keep_publish_window_open(dry_run=dry_run, clicked_publish=clicked):
                _wait_for_manual_window_close(context)
            return _publish_result("submitted" if clicked else "needs_manual_confirm", page)
        finally:
            _close_context(context, browser)


def _publish_to_xiaohongshu_keepalive(task: PublishTask, account: SocialAccount, media_assets: list[dict[str, Any]], dry_run: bool = False) -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    image_paths = _media_paths(media_assets, "image")[:18]
    video_paths = _media_paths(media_assets, "video")[:1]
    upload_paths = video_paths if task.content_type == "video" else image_paths
    if not upload_paths:
        raise ValueError("Please upload video or image assets before publishing")

    title = str(task.final_snapshot.get("title") or "")[:20]
    body = str(task.final_snapshot.get("body") or "")
    tags = str(task.final_snapshot.get("tags") or "")
    note = "\n\n".join(part for part in [body, tags] if part)

    with sync_playwright() as p:
        context, browser = _new_publish_context(p, account)
        try:
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(PLATFORM_URLS["xiaohongshu"]["publish"], wait_until="domcontentloaded", timeout=90000)
            page.wait_for_timeout(2500)
            inputs = page.locator("input[type=file]")
            if inputs.count() == 0:
                raise RuntimeError("Xiaohongshu upload control was not found; please confirm the account is logged in")
            inputs.first.set_input_files(upload_paths)
            page.wait_for_timeout(5000)
            _fill_first(page, ["input[placeholder*='标题']", "textarea[placeholder*='标题']"], title)
            _fill_first(page, ["textarea[placeholder*='正文']", "textarea[placeholder*='描述']", "[contenteditable=true]"], note)

            if dry_run:
                _update_storage_state_file(context, account)
                _wait_for_manual_window_close(context)
                return _publish_result("prepared", page, "Publish package prepared; window was kept open for manual review.")

            clicked = _click_first(page, ["button:has-text('发布')", "button:has-text('立即发布')", "text=发布"])
            page.wait_for_timeout(3000)
            _update_storage_state_file(context, account)
            if should_keep_publish_window_open(dry_run=dry_run, clicked_publish=clicked):
                _wait_for_manual_window_close(context)
            return _publish_result("submitted" if clicked else "needs_manual_confirm", page)
        finally:
            _close_context(context, browser)
