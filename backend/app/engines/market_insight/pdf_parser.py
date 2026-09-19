from __future__ import annotations

import os
import re
import uuid
import fitz  # PyMuPDF
from app.config import MEDIA_ROOT
from app.engines.market_insight.models import ParsedDocument, Section, CodeBlock


def parse_pdf(file_path: str) -> ParsedDocument:
    doc = fitz.open(file_path)
    full_text: list[str] = []
    for page in doc:
        full_text.append(page.get_text())
    doc.close()

    content = "\n".join(full_text)
    title = _extract_pdf_title(content, file_path)
    sections = _extract_sections_from_text(content)
    code_blocks = _extract_code_blocks(content)
    tech_stack = _detect_tech_stack_from_text(content)
    features = _extract_features_from_sections(sections)
    extracted_images = _extract_pdf_images(file_path)

    return ParsedDocument(
        title=title,
        source_type="pdf",
        sections=sections,
        code_blocks=code_blocks,
        tech_stack=tech_stack,
        features=features,
        raw_text=content,
        extracted_images=extracted_images,
    )


def _extract_pdf_images(file_path: str) -> list[str]:
    """Extract embedded images from PDF, save locally, return file paths."""
    paths: list[str] = []
    try:
        doc = fitz.open(file_path)
        tmp_dir = os.path.join(MEDIA_ROOT, "extracted_images")
        os.makedirs(tmp_dir, exist_ok=True)

        for page_num in range(len(doc)):
            page = doc[page_num]
            for img in page.get_images(full=True):
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                ext = base_image["ext"]
                path = os.path.join(tmp_dir, f"{uuid.uuid4().hex}.{ext}")
                with open(path, "wb") as f:
                    f.write(image_bytes)
                paths.append(path)

        doc.close()
    except Exception:
        pass
    return paths


def _extract_pdf_title(content: str, file_path: str) -> str:
    import os
    first_line = content.strip().split("\n")[0] if content.strip() else ""
    # Reject lines that are obviously not titles: pure numbers, too short, or mostly digits
    if first_line and 5 <= len(first_line) < 120 and not re.match(r'^\d+[\.\s]*$', first_line.strip()):
        return first_line.strip()
    return os.path.splitext(os.path.basename(file_path))[0]


def _extract_sections_from_text(text: str) -> list[Section]:
    lines = text.split("\n")
    sections: list[Section] = []
    current_section: Section | None = None

    heading_pattern = re.compile(
        r"^(?:(\d+(?:\.\d+)*)\s+)?([A-Z][A-Za-z\s\-]{2,80})$"
    )

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        match = heading_pattern.match(stripped)
        if match and (len(stripped) < 100):
            if current_section:
                sections.append(current_section)
            heading = stripped
            level = stripped.count(".") + 1 if match.group(1) else 1
            current_section = Section(heading=heading, level=level, content="")
        elif current_section:
            current_section.content += stripped + "\n"
        elif stripped:
            current_section = Section(heading="Preamble", level=0, content=stripped)

    if current_section:
        sections.append(current_section)

    return sections


def _extract_code_blocks(content: str) -> list[CodeBlock]:
    pattern = re.compile(r"```(\w*)\n(.*?)```", re.DOTALL)
    blocks: list[CodeBlock] = []
    for m in pattern.finditer(content):
        blocks.append(CodeBlock(language=m.group(1) or "", code=m.group(2).strip()))

    inline_patterns = [
        r"(?:def|class|function|const|let|var|import|from|package)\s+\S+.*",
        r"^\s*(?:curl|wget|npm|pip|docker|git)\s+.*",
    ]
    for line in content.split("\n"):
        for pat in inline_patterns:
            if re.match(pat, line.strip()):
                blocks.append(CodeBlock(language="", code=line.strip()))
                break

    return blocks


TECH_KEYWORDS = {
    "python", "javascript", "typescript", "go", "golang", "rust", "java",
    "kotlin", "swift", "react", "vue", "angular", "next.js", "nextjs",
    "nuxt", "node.js", "nodejs", "django", "flask", "fastapi", "spring",
    "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
    "docker", "kubernetes", "k8s", "aws", "gcp", "azure", "terraform",
    "graphql", "rest", "grpc", "kafka", "rabbitmq", "nginx",
    "pytorch", "tensorflow", "langchain", "huggingface", "llm",
    "openai", "anthropic", "claude", "gpt", "embedding",
}


def _detect_tech_stack_from_text(content: str) -> list[str]:
    lower = content.lower()
    found = set()
    for kw in TECH_KEYWORDS:
        if kw in lower:
            found.add(kw)
    return sorted(found)


def _extract_features_from_sections(sections: list[Section]) -> list[str]:
    features: list[str] = []
    for sec in sections:
        for line in sec.content.split("\n"):
            stripped = line.strip()
            if stripped.startswith("- ") or stripped.startswith("* ") or stripped.startswith("• "):
                features.append(stripped.lstrip("- *•").strip())
            elif stripped and 10 < len(stripped) < 250 and not stripped.startswith("```"):
                features.append(stripped)
    return features[:20]
