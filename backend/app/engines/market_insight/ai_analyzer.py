from __future__ import annotations

import base64
import json
import os
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from openai import OpenAI
from app.config import CASE_AI_API_KEY, CASE_AI_BASE_URL, CASE_AI_MODEL, MEDIA_ROOT
from app.engines.market_insight.models import ParsedDocument, AIAnalysis

SYSTEM_PROMPT = """你是一位资深的市场营销策略师和科技产品竞争分析专家。你的工作是对技术文档进行深度分析，提炼可操作的商业情报。

给定一份技术文档，请生成结构化分析，包含以下内容：

1. product_name: 文档中产品的准确名称。
2. product_category: 该产品所属的市场类别（例如："AI 营销平台"、"DevOps 工具"、"数据库"、"CRM"）。
3. product_description: 详细的产品介绍（2-4 段），以市场营销语言描述产品功能、核心特性和价值主张。
4. similar_products: 列出 3-6 个同品类的知名竞争或相似产品（例如："Notion"、"Jira"、"Salesforce"）。
5. strengths: 列出 3-5 个该产品相对于竞品的竞争优势或强项。
6. weaknesses: 列出 2-4 个你可以从文档中推断出的局限性、差距或改进空间。
7. product_summary: 用市场营销语言写一段简洁的 2-3 句电梯演讲。
8. target_audience: 主要用户画像——请明确说明角色、公司规模和行业。
9. use_cases: 3-5 个该产品解决实际问题的具体场景。
10. market_positioning: 一段关于如何针对现有竞品进行市场定位的描述。
11. tech_highlights: 3-5 个值得在营销中突出的技术创新点。
12. suggested_marketing_angles: 3-5 个适用于社交媒体或技术博客的营销切入点。
13. marketing_stage: 判断该产品当前所处的营销阶段（例如："早期市场教育"、"初期增长获客"、"规模化扩张"、"成熟期品牌维护"、"存量市场竞争"等），并简要说明判断依据。

输出不要使用 Markdown 格式（如 **、## 等标记符号）。请具体且富有洞察力。每一条结论都要有文档中的细节作为依据。始终使用中文输出。"""

ANALYSIS_PROMPT = """请分析以下技术文档，并返回结构化的 JSON 分析结果。

文档标题：{title}
文档类型：{source_type}

--- 文档内容 ---
{content}
--- 结束 ---

请以 JSON 对象的形式返回分析结果，严格按照以下结构：
{{
  "product_name": "...",
  "product_category": "...",
  "product_description": "...",
  "similar_products": ["...", "..."],
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "product_summary": "...",
  "target_audience": "...",
  "use_cases": ["...", "..."],
  "market_positioning": "...",
  "tech_highlights": ["...", "..."],
  "suggested_marketing_angles": ["...", "..."],
  "marketing_stage": "..."
}}

只输出 JSON 对象，不要有任何前言或解释。始终使用中文输出。"""

IMAGE_CLASSIFY_PROMPT = """你是一个产品图片筛选器。接下来你会看到 {num_images} 张图片，请逐一判断每张图片是否能够代表一个技术产品（如产品截图、架构图、UI 界面、产品演示图、产品照片等）。

判断标准：
- 1 = 是产品相关图片（产品截图、架构图、UI界面、产品演示、产品照片等）
- 0 = 不是产品相关图片（头像、徽章、图标、通用素材、装饰图、表情包等）

请严格按照顺序返回一个 JSON 数组，每个元素只能是 0 或 1，不要有任何其他内容。

示例返回格式：[1, 0, 1, 1, 0]

你现在有 {num_images} 张图片，请返回 {num_images} 个 0 或 1 的数组。"""

MIME_MAP = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml",
}


def _has_case_ai_provider() -> bool:
    return bool(CASE_AI_API_KEY)


def _get_case_ai_client() -> OpenAI:
    if not CASE_AI_API_KEY:
        raise ValueError("CASE_AI_API_KEY is not configured")
    return OpenAI(api_key=CASE_AI_API_KEY, base_url=CASE_AI_BASE_URL)


def _analyze_text(doc: ParsedDocument) -> AIAnalysis | None:
    if not _has_case_ai_provider():
        return None

    content = doc.raw_text[:60000]
    if len(doc.raw_text) > 60000:
        content += "\n\n[Content truncated due to length]"

    prompt = ANALYSIS_PROMPT.format(
        title=doc.title,
        source_type=doc.source_type,
        content=content,
    )

    prompt += (
        "\n\nKeep the JSON concise: each string must be under 120 Chinese characters; "
        "each list may contain at most 3 short items; keep the entire JSON under 2500 Chinese characters. "
        "Return every required key even when its value is empty."
    )

    client = _get_case_ai_client()
    response = client.chat.completions.create(
        model=CASE_AI_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=4096,
        temperature=0.3,
    )

    raw = response.choices[0].message.content or ""
    analysis_dict = _parse_json_response(raw)
    return AIAnalysis(**analysis_dict)


# ── Image extraction ──

def _parse_image_urls(text: str) -> list[str]:
    """Extract image URLs from document text (for markdown/repo sources)."""
    urls: list[str] = []

    # Markdown: ![alt](url)
    for match in re.finditer(r'!\[.*?\]\((https?://[^\s)]+)\)', text):
        urls.append(match.group(1))

    # HTML: <img src="url">
    for match in re.finditer(r'<img[^>]+src=["\']([^"\']+)["\']', text, re.IGNORECASE):
        urls.append(match.group(1))

    # Plain image URLs
    for match in re.finditer(r'https?://[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?', text, re.IGNORECASE):
        url = match.group(0)
        if url not in urls:
            urls.append(url)

    return urls


def _download_image(url: str, tmp_dir: str) -> str | None:
    """Download an image to a temp directory, return the local file path."""
    try:
        resp = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code == 200 and len(resp.content) > 512:
            ext = os.path.splitext(url.split("?")[0])[1].lower()
            if ext not in MIME_MAP:
                ext = ".png"
            name = f"{uuid.uuid4().hex}{ext}"
            path = os.path.join(tmp_dir, name)
            with open(path, "wb") as f:
                f.write(resp.content)
            return path
    except Exception:
        pass
    return None


def _image_to_data_url(path: str) -> str | None:
    """Read a local image file and return a base64 data URL."""
    try:
        ext = os.path.splitext(path)[1].lower()
        mime = MIME_MAP.get(ext, "image/jpeg")
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        return f"data:{mime};base64,{b64}"
    except Exception:
        return None


def _classify_batch(local_paths: list[str]) -> list[str]:
    """Send up to 5 images to the default AI for binary classification.
    Returns the local paths of images classified as 1 (product-related)."""
    if not local_paths:
        return []

    data_urls = []
    valid_indices = []
    for i, p in enumerate(local_paths):
        du = _image_to_data_url(p)
        if du:
            data_urls.append(du)
            valid_indices.append(i)

    if not data_urls:
        return []

    # Build multimodal message
    user_content: list[dict] = [
        {"type": "text", "text": IMAGE_CLASSIFY_PROMPT.format(num_images=len(data_urls))},
    ]
    for du in data_urls:
        user_content.append({"type": "image_url", "image_url": {"url": du}})

    try:
        client = _get_case_ai_client()
        response = client.chat.completions.create(
            model=CASE_AI_MODEL,
            messages=[{"role": "user", "content": user_content}],
            max_tokens=256,
            temperature=0,
        )

        raw = response.choices[0].message.content or ""
        classifications = _parse_classifications(raw, len(data_urls))
        print(f"[image_classify] batch of {len(data_urls)} → classifications: {classifications}")
    except Exception as e:
        print(f"[image_classify] AI image classification failed ({type(e).__name__}: {e}) — accepting all {len(valid_indices)} images")
        return [local_paths[i] for i in valid_indices]

    # Return paths classified as 1
    result: list[str] = []
    for j, cls in enumerate(classifications):
        if cls == 1 and j < len(valid_indices):
            result.append(local_paths[valid_indices[j]])

    return result


def _parse_classifications(raw: str, expected_len: int) -> list[int]:
    """Parse a JSON array of 0s and 1s from AI response."""
    raw = raw.strip()
    # Extract JSON array
    match = re.search(r"\[[0-1,\s]*\]", raw)
    if match:
        try:
            arr = json.loads(match.group(0))
            if isinstance(arr, list) and len(arr) == expected_len:
                return [int(x) for x in arr]
        except (json.JSONDecodeError, ValueError):
            pass

    # Fallback: if we can't parse, accept all
    return [1] * expected_len


def _extract_images(doc: ParsedDocument, record_id: str = "", owner_id: str = "") -> list[str]:
    """Extract and classify product images from document.

    For PDF/DOCX: uses images already extracted by the parser from the binary file.
    For markdown/repo: parses image URLs from text and downloads them.

    Then sends to the configured default AI in batches of 5 for vision classification (0 or 1),
    and returns only those classified as 1 (product-related).

    Images are stored under product_images/{owner_id}/{record_id}/ for isolation.
    """
    if not _has_case_ai_provider():
        print("[image_extract] default AI model not configured — skipping")
        return []

    local_paths: list[str] = []
    is_url_based = False

    if doc.extracted_images:
        # PDF/DOCX: images already extracted from the binary file
        print(f"[image_extract] using {len(doc.extracted_images)} parser-extracted images for {record_id}")
        local_paths = [p for p in doc.extracted_images if os.path.exists(p)]
        print(f"[image_extract] {len(local_paths)}/{len(doc.extracted_images)} exist on disk")
    else:
        # Markdown/repo: parse URLs from text and download
        all_urls = _parse_image_urls(doc.raw_text)
        if not all_urls:
            return []

        is_url_based = True
        tmp_dir = os.path.join(MEDIA_ROOT, "tmp_images")
        os.makedirs(tmp_dir, exist_ok=True)

        for url in all_urls:
            path = _download_image(url, tmp_dir)
            if path:
                local_paths.append(path)

    if not local_paths:
        return []

    # Classify in batches of 5, collect all 1s
    classified_paths: list[str] = []
    batch_size = 5

    for start in range(0, len(local_paths), batch_size):
        batch_paths = local_paths[start:start + batch_size]
        classified_paths.extend(_classify_batch(batch_paths))

    # Move classified images to per-user/per-record media location
    result: list[str] = []
    product_dir = os.path.join(MEDIA_ROOT, "product_images", owner_id, record_id)
    os.makedirs(product_dir, exist_ok=True)

    for p in classified_paths:
        name = os.path.basename(p)
        dest = os.path.join(product_dir, name)
        if os.path.abspath(p) != os.path.abspath(dest):
            import shutil
            shutil.copy2(p, dest)
        result.append(f"product_images/{owner_id}/{record_id}/{name}")

    # Clean up temp files
    if is_url_based:
        for p in local_paths:
            try:
                os.remove(p)
            except OSError:
                pass

    return result


def analyze_document(doc: ParsedDocument, record_id: str = "", owner_id: str = "") -> ParsedDocument:
    if not _has_case_ai_provider():
        return doc

    with ThreadPoolExecutor(max_workers=2) as executor:
        text_future = executor.submit(_analyze_text, doc)
        # Repository README files can reference hundreds of remote images.
        # Skip that optional work so repository insights finish from text promptly.
        image_future = (
            None
            if doc.source_type == "repo"
            else executor.submit(_extract_images, doc, record_id, owner_id)
        )

        analysis = text_future.result()
        images = image_future.result() if image_future else []

    if analysis:
        analysis.product_images = images
        doc.ai_analysis = analysis
        doc.ai_model = CASE_AI_MODEL
    return doc


def analyze_async(doc: ParsedDocument, record_id: str, owner_id: str = "") -> None:
    """Run AI analysis in a background thread and update the DB on completion."""

    def _run():
        try:
            result = analyze_document(doc, record_id, owner_id)
            from app.engines.market_insight.storage import update_insight_status
            if result.ai_analysis:
                update_insight_status(record_id, "completed", result.ai_analysis)
            else:
                update_insight_status(record_id, "failed")
        except Exception:
            from app.engines.market_insight.storage import update_insight_status
            update_insight_status(record_id, "failed")

    t = threading.Thread(target=_run, daemon=True)
    t.start()


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]

    text = text.strip()

    # Try multiple parse strategies
    result = None
    for attempt in range(3):
        try:
            result = json.loads(text)
            break
        except json.JSONDecodeError:
            if attempt == 0:
                # Remove trailing commas before ] or }
                text = re.sub(r",(\s*[}\]])", r"\1", text)
            elif attempt == 1:
                # Try extracting just the JSON object
                match = re.search(r"\{.*\}", text, re.DOTALL)
                if match:
                    text = re.sub(r",(\s*[}\]])", r"\1", match.group(0))
                else:
                    raise ValueError(f"Failed to parse AI response as JSON: {text[:200]}")

    if result is None:
        raise ValueError(f"Failed to parse AI response as JSON: {text[:200]}")

    # Normalize types and strip markdown
    string_fields = {"product_name", "product_category", "product_description", "product_summary",
                     "target_audience", "market_positioning", "marketing_stage"}
    array_fields = {"similar_products", "strengths", "weaknesses", "use_cases",
                    "tech_highlights", "suggested_marketing_angles", "product_images"}

    for key in list(result.keys()):
        if key in string_fields and isinstance(result[key], list):
            result[key] = "\n".join(str(v) for v in result[key])
        elif key in array_fields and isinstance(result[key], str):
            result[key] = [result[key]]

        if isinstance(result[key], str):
            result[key] = re.sub(r'\*\*(.+?)\*\*', r'\1', result[key])
            result[key] = re.sub(r'\*(.+?)\*', r'\1', result[key])
        elif isinstance(result[key], list):
            result[key] = [re.sub(r'\*\*(.+?)\*\*', r'\1', re.sub(r'\*(.+?)\*', r'\1', v)) if isinstance(v, str) else v for v in result[key]]
    return result
