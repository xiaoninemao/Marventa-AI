from __future__ import annotations

import base64
import json
import os
import threading
from openai import OpenAI
from app.config import CASE_ANALYSIS_AI_API_KEY, CASE_ANALYSIS_AI_BASE_URL, CASE_ANALYSIS_AI_MODEL
from app.engines.case_library.models import CaseAIAnalysis

SYSTEM_PROMPT = """你是一位资深营销策略师和内容分析师。请分析给定的营销案例（短视频或图文内容），提取可落地的洞察。

根据案例的标题、描述、标签、内容类型、分类以及提供的图片/视频截图，产出结构化的中文分析：

1. **content_analysis**: 对该案例内容的全面解析，包括内容结构、核心信息、视觉风格、叙事手法等方面的分析。
2. **marketing_angle**: 该案例采用的核心营销策略或切入角度。
3. **target_audience**: 该内容吸引的具体目标受众画像。
4. **experience_extraction**: 从该案例中可以借鉴的可复用经验和关键 takeaways。
5. **key_highlights**: 3-5 个使该案例出彩的亮点元素。
6. **improvement_suggestions**: 2-4 条可操作的改进建议。
7. **similar_approaches**: 3-5 种可借鉴的类似营销方式或风格。

请用中文输出，分析要具体、有洞察力，每个结论都要有依据。输出不要使用 Markdown 格式标记（如 **、## 等）。"""

ANALYSIS_PROMPT = """请分析以下营销案例，返回结构化的 JSON 分析结果。

案例标题: {title}
内容类型: {content_type}
分类: {category}
描述: {description}
标签: {tags}
{video_hint}

返回格式（仅输出 JSON，不要前言或解释）:
{{
  "content_analysis": "...",
  "marketing_angle": "...",
  "target_audience": "...",
  "experience_extraction": "...",
  "key_highlights": ["...", "..."],
  "improvement_suggestions": ["...", "..."],
  "similar_approaches": ["...", "..."]
}}"""

MIME_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def _get_client() -> OpenAI:
    return OpenAI(api_key=CASE_ANALYSIS_AI_API_KEY, base_url=CASE_ANALYSIS_AI_BASE_URL)


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


def analyze_case(
    title: str,
    content_type: str,
    category: str,
    description: str,
    tags: list[str],
    image_paths: list[str] | None = None,
    video_url: str = "",
) -> CaseAIAnalysis:
    video_hint = ""
    if content_type == "video" and video_url:
        video_hint = f"视频文件: {video_url}\n（注意：以上为视频文件路径，请基于案例文本信息进行分析）"

    prompt = ANALYSIS_PROMPT.format(
        title=title,
        content_type=content_type,
        category=category,
        description=description or "(无描述)",
        tags=", ".join(tags) if tags else "(无标签)",
        video_hint=video_hint,
    )

    # Build multimodal message content
    user_content: list[dict] = []

    # Add images (limit to 5)
    image_paths = (image_paths or [])[:5]
    for path in image_paths:
        data_url = _image_to_data_url(path)
        if data_url:
            user_content.append({
                "type": "image_url",
                "image_url": {"url": data_url},
            })

    user_content.append({"type": "text", "text": prompt})

    client = _get_client()
    response = client.chat.completions.create(
        model=CASE_ANALYSIS_AI_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        max_tokens=8192,
        temperature=0.3,
    )

    raw = response.choices[0].message.content or ""
    analysis_dict = _parse_json_response(raw)
    return CaseAIAnalysis(**analysis_dict)


def analyze_async(
    case_id: str,
    title: str,
    content_type: str,
    category: str,
    description: str,
    tags: list[str],
    image_paths: list[str] | None = None,
    video_url: str = "",
) -> None:
    """Run AI analysis in a background thread and update the DB on completion."""

    def _run():
        from app.engines.case_library.storage import update_case_ai
        try:
            analysis = analyze_case(
                title, content_type, category, description, tags,
                image_paths=image_paths, video_url=video_url,
            )
            update_case_ai(case_id, "completed", analysis)
        except Exception:
            update_case_ai(case_id, "failed")

    t = threading.Thread(target=_run, daemon=True)
    t.start()


def _strip_markdown(text: str) -> str:
    """Remove markdown bold/italic markers from text."""
    import re
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    return text


def _parse_json_response(text: str) -> dict:
    import re
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]

    text = text.strip()

    # Fix truncated JSON: close open strings and braces
    if not text.endswith("}"):
        brace_count = text.count("{") - text.count("}")
        quote_count = text.count('"') % 2
        if quote_count:  # Unterminated string
            text += '"'
        text += "}" * max(brace_count, 0)
        # Close any open arrays
        bracket_count = text.count("[") - text.count("]")
        text += "]" * max(bracket_count, 0)
        # Close any open braces again after arrays
        text += "}" * max(text.count("{") - text.count("}"), 0)

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
    string_fields = {"content_analysis", "marketing_angle", "target_audience", "experience_extraction"}
    array_fields = {"key_highlights", "improvement_suggestions", "similar_approaches"}

    for key in list(result.keys()):
        if key in string_fields and isinstance(result[key], list):
            result[key] = "\n".join(str(v) for v in result[key])
        elif key in array_fields and isinstance(result[key], str):
            result[key] = [result[key]]

        if isinstance(result[key], str):
            result[key] = _strip_markdown(result[key])
        elif isinstance(result[key], list):
            result[key] = [_strip_markdown(v) if isinstance(v, str) else v for v in result[key]]
    return result
