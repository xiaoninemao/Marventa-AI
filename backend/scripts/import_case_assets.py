from __future__ import annotations

import hashlib
import json
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from docx import Document

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import DB_PATH, MEDIA_ROOT
from app.engines.case_library.models import CaseAIAnalysis
from app.engines.case_library.storage import init_db


SOURCE_ROOT = Path(r"D:\1项目\0科技营销方案\案例库")
OWNER_ID = "seed_importer"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
VIDEO_EXTENSIONS = {".mp4"}


def sanitize_filename(name: str) -> str:
    return re.sub(r"[^\w.\-]", "_", name)


def stable_id(path: Path) -> str:
    return hashlib.md5(str(path).encode("utf-8")).hexdigest()[:12]


def parse_count(value: str) -> int | None:
    text = value.strip().lower().replace("+", "")
    match = re.search(r"([\d.]+)\s*(w|万|k|千)?", text)
    if not match:
        return None
    number = float(match.group(1))
    if match.group(2) in {"w", "万"}:
        number *= 10000
    elif match.group(2) in {"k", "千"}:
        number *= 1000
    return int(number)


def extract_metric(text: str, labels: tuple[str, ...]) -> int | None:
    label_pattern = "|".join(re.escape(label) for label in labels)
    number_pattern = r"[\d.]+\s*(?:w|万|k|千)?\+?"
    patterns = (
        rf"(?:{label_pattern})\s*[:：]?\s*({number_pattern})",
        rf"({number_pattern})\s*(?:次|条)?\s*(?:{label_pattern})",
    )
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return parse_count(match.group(1))
    return None


def read_docx(path: Path) -> str:
    doc = Document(str(path))
    return "\n".join(p.text.strip() for p in doc.paragraphs if p.text.strip())


def field_after(text: str, label: str) -> str:
    pattern = rf"{label}\s*[：:]\s*(.*?)(?=\n\s*(?:\d+\.)?(?:来源|热门程度|正版视频链接|标题|文案|视频逻辑|反馈)\s*[：:]|$)"
    match = re.search(pattern, text, re.S)
    return match.group(1).strip() if match else ""


def parse_text(text: str, folder_name: str) -> dict:
    title = field_after(text, "标题")
    body = field_after(text, "文案") or field_after(text, "视频逻辑")
    source = field_after(text, "来源")
    original_url_match = re.search(r"https?://\S+", text)
    original_url = original_url_match.group(0).rstrip("。,.，") if original_url_match else ""

    if not title:
        title = re.sub(r"^(图文|视频|短视频)[-—_\s]*", "", folder_name).strip()
    if not body:
        body = text

    hashtags = [tag.strip("#") for tag in re.findall(r"#[\w\u4e00-\u9fff]+", text)]
    stats_text = field_after(text, "热门程度") or field_after(text, "反馈")
    metric_text = stats_text or text
    likes = extract_metric(metric_text, ("点赞", "赞", "likes", "like"))
    collects = extract_metric(metric_text, ("收藏", "favorites", "favorite", "collects", "collect"))
    comments = extract_metric(metric_text, ("评论", "comments", "comment"))

    return {
        "title": title.replace("\n", " ").strip("：: "),
        "body": body.strip(),
        "source": source.strip(),
        "original_url": original_url,
        "tags": list(dict.fromkeys(hashtags)),
        "likes": likes,
        "favorites_count": collects,
        "comments": comments,
    }


def detect_platform(folder: Path, parsed_source: str) -> str:
    text = f"{folder} {parsed_source}".lower()
    if "小红书" in text or "xiaohongshu" in text or "xhslink" in text:
        return "小红书"
    if "抖音" in text or "douyin" in text:
        return "抖音"
    if "b站" in text or "bilibili" in text:
        return "B站"
    if "ins" in text or "instagram" in text:
        return "Instagram"
    if "youtube" in text:
        return "YouTube"
    return parsed_source or "素材导入"


def infer_industry(name: str) -> str:
    if any(word in name for word in ("智己", "小米su7", "问界", "车", "SUV")):
        return "汽车"
    if any(word in name for word in ("无人车", "运输车", "草莓", "农业", "采摘")):
        return "农业科技"
    if any(word in name for word in ("户外电源", "充电宝", "耳机", "打印机", "相机", "NAS", "录音笔", "雕刻机", "风扇", "鱼尾灯", "Insta", "Plaud", "xTool", "Phomemo", "倍思", "漫步者", "绿联", "飞利浦")):
        return "数码"
    return "数码"


def copy_media(case_dir: Path, case_id: str) -> tuple[list[str], str]:
    image_urls: list[str] = []
    video_url = ""
    image_dir = Path(MEDIA_ROOT) / "shared" / "images"
    video_dir = Path(MEDIA_ROOT) / "shared" / "videos"
    image_dir.mkdir(parents=True, exist_ok=True)
    video_dir.mkdir(parents=True, exist_ok=True)

    for source in sorted(case_dir.iterdir(), key=lambda p: p.name):
        ext = source.suffix.lower()
        if ext in IMAGE_EXTENSIONS:
            target = image_dir / f"{case_id}_{sanitize_filename(source.name)}"
            shutil.copy2(source, target)
            image_urls.append(f"shared/images/{target.name}")
        elif ext in VIDEO_EXTENSIONS and not video_url:
            target = video_dir / f"{case_id}_{sanitize_filename(source.name)}"
            shutil.copy2(source, target)
            video_url = f"shared/videos/{target.name}"
    return image_urls, video_url


def iter_case_dirs() -> list[tuple[Path, str]]:
    result: list[tuple[Path, str]] = []
    main_root = SOURCE_ROOT / "案例库"
    for category_dir, category in ((main_root / "企业定制", "agency"), (main_root / "行业精选", "curated")):
        if category_dir.exists():
            for child in sorted(p for p in category_dir.iterdir() if p.is_dir()):
                result.append((child, category))
    case2 = SOURCE_ROOT / "案例库2"
    if case2.exists():
        for child in sorted(p for p in case2.iterdir() if p.is_dir()):
            result.append((child, "curated"))
    return result


def build_analysis(title: str, body: str, tags: list[str], content_type: str) -> CaseAIAnalysis:
    topic = tags[0] if tags else title[:20]
    return CaseAIAnalysis(
        content_analysis=(body[:260] + "..." if len(body) > 260 else body),
        marketing_angle=f"围绕「{topic}」提炼产品卖点、使用场景和第一眼吸引点，适合作为同类内容参考。",
        target_audience="关注科技产品、智能硬件、出行工具或效率设备的潜在消费者。",
        experience_extraction="保留原始素材的标题钩子、场景表达、产品卖点和互动反馈，用于后续复刻选题与文案结构。",
        key_highlights=tags[:6] or [topic],
        improvement_suggestions=[
            "补充更明确的开头钩子，强化用户为什么要继续看。",
            "把核心卖点前置，并用真实使用场景承接。",
            "结尾增加评论、收藏或私信引导，方便转化承接。",
        ],
        similar_approaches=[
            "痛点/场景开头 + 产品卖点证明 + 使用体验 + 行动引导",
            "视觉封面/视频首帧突出核心产品和结果",
            "话题标签承接产品品类、平台热词和使用场景",
        ],
        title_suggestions=[title],
        tag_suggestions=tags[:10],
        hook_analysis="当前标题已经具备素材识别度，后续可继续强化目标人群、结果收益或冲突感。",
        rewrite_examples=[body[:180] if body else title],
    )


def main() -> None:
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    conn.execute("DELETE FROM case_favorites WHERE case_id IN (SELECT id FROM cases WHERE is_public = 1 AND category IN ('agency', 'curated'))")
    conn.execute("DELETE FROM cases WHERE is_public = 1 AND category IN ('agency', 'curated')")

    imported = 0
    for case_dir, category in iter_case_dirs():
        docs = sorted(case_dir.glob("*.docx"))
        if not docs:
            continue
        case_id = stable_id(case_dir)
        text = read_docx(docs[0])
        parsed = parse_text(text, case_dir.name)
        image_urls, video_url = copy_media(case_dir, case_id)
        content_type = "video" if video_url else "image_text"
        platform = detect_platform(case_dir, parsed["source"])
        folder_label = re.sub(r"^\d+\s*", "", case_dir.name)
        scene = "短视频种草" if content_type == "video" else "图文种草"
        industry = infer_industry(case_dir.name)
        tags = parsed["tags"] or [industry, platform, scene]
        likes = parsed["likes"]
        favorites_count = parsed["favorites_count"]
        comments = parsed["comments"]
        popularity = min(100, int(((likes or 0) + (favorites_count or 0) + (comments or 0)) / 1000)) if any([likes, favorites_count, comments]) else 60
        analysis = build_analysis(parsed["title"], parsed["body"], tags, content_type)

        conn.execute(
            """
            INSERT INTO cases (
                id, title, content_type, description, video_url, image_urls, tags,
                created_at, updated_at, owner_id, is_public, category, source,
                ai_status, ai_analysis, platform, industry, scene, original_url,
                cover_url, published_at, popularity, likes, favorites_count,
                comments, body, recognition_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                case_id,
                parsed["title"],
                content_type,
                parsed["body"],
                video_url,
                json.dumps(image_urls, ensure_ascii=False),
                json.dumps(tags, ensure_ascii=False),
                now,
                now,
                OWNER_ID,
                1,
                category,
                platform,
                "ready",
                analysis.model_dump_json(),
                platform,
                industry,
                scene,
                parsed["original_url"],
                image_urls[0] if image_urls else "",
                now[:10],
                popularity,
                likes,
                favorites_count,
                comments,
                parsed["body"],
                "recognized",
            ),
        )
        imported += 1
        print(f"imported {category} {content_type}: {folder_label} -> {parsed['title']}")

    conn.commit()
    conn.close()
    print(f"Imported {imported} cases from {SOURCE_ROOT}")


if __name__ == "__main__":
    main()
