from __future__ import annotations

from app.engines.market_insight.models import ParsedDocument


def parse_document(
    source_type: str,
    content: str | None = None,
    file_path: str | None = None,
    with_ai: bool = True,
) -> ParsedDocument:
    doc = _parse_raw(source_type, content, file_path)

    if with_ai:
        try:
            from app.engines.market_insight.ai_analyzer import analyze_document
            doc = analyze_document(doc)
        except Exception as e:
            doc.ai_analysis = None
            doc.raw_text += f"\n\n[AI分析失败: {e}]"

    return doc


def _parse_raw(
    source_type: str,
    content: str | None,
    file_path: str | None,
) -> ParsedDocument:
    if source_type == "markdown":
        from app.engines.market_insight.markdown_parser import parse_markdown
        if content is None:
            raise ValueError("markdown parser requires content")
        return parse_markdown(content)

    if source_type == "pdf":
        from app.engines.market_insight.pdf_parser import parse_pdf
        if file_path is None:
            raise ValueError("pdf parser requires file_path")
        return parse_pdf(file_path)

    if source_type == "docx":
        from app.engines.market_insight.docx_parser import parse_docx
        if file_path is None:
            raise ValueError("docx parser requires file_path")
        return parse_docx(file_path)

    if source_type == "repo":
        from app.engines.market_insight.repo_parser import parse_repo
        if content is None:
            raise ValueError("repo parser requires repo_url as content")
        return parse_repo(content)

    raise ValueError(f"Unsupported source type: {source_type}")
