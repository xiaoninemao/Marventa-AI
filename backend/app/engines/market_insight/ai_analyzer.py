from __future__ import annotations

import json
import re
import threading
from openai import OpenAI
from app.config import CASE_AI_API_KEY, CASE_AI_BASE_URL, CASE_AI_MODEL
from app.engines.market_insight.models import ParsedDocument, AIAnalysis
from app.shared.prompts import build_system_prompt

SYSTEM_PROMPT = build_system_prompt("""Analyze technical documentation as a marketing strategist and technology-product competitive analyst, extracting actionable business intelligence.

Return a structured analysis with these fields:
1. product_name: the product's accurate name from the document.
2. product_category: its market category, such as AI marketing platform, DevOps tool, database, or CRM.
3. product_description: a detailed description in 2-4 paragraphs covering functionality, key features, and value proposition in marketing language.
4. similar_products: 3-6 known competitors or comparable products in the category, such as Notion, Jira, or Salesforce.
5. strengths: 3-5 competitive advantages.
6. weaknesses: 2-4 limitations, gaps, or improvement opportunities supported by the documentation.
7. product_summary: a concise 2-3 sentence elevator pitch.
8. target_audience: a specific user profile including role, company size, and industry.
9. use_cases: 3-5 concrete real-world problems the product solves.
10. market_positioning: how to position the product against existing competitors.
11. tech_highlights: 3-5 technical innovations worth emphasizing in marketing.
12. suggested_marketing_angles: 3-5 angles for social media or technical blogs.
13. marketing_stage: the current stage, such as early market education, initial customer acquisition, scaling, mature brand maintenance, or competition in an established market, with a brief rationale.

If the request specifies a compact output budget, prioritize those length and list limits while retaining all fields and their intended meaning.
Be specific and insightful, ground every conclusion in details from the document, and do not use Markdown formatting in the output.""")

ANALYSIS_PROMPT = """Analyze this technical document and return a structured JSON analysis.

Document title: {title}
Document type: {source_type}

--- Document content ---
{content}
--- End of document ---

Return a JSON object with exactly this structure:
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

Return only the JSON object, with no preamble or explanation."""

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
        "\n\nKeep the JSON concise: each string must be under 120 characters; "
        "each list may contain at most 3 short items; keep the entire JSON under 2500 characters. "
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


def analyze_document(doc: ParsedDocument, record_id: str = "", owner_id: str = "") -> ParsedDocument:
    if not _has_case_ai_provider():
        return doc

    analysis = _analyze_text(doc)
    if analysis:
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
