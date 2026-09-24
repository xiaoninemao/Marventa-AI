import re
from app.engines.market_insight.models import ParsedDocument, Section, CodeBlock


def parse_markdown(content: str, title: str = "") -> ParsedDocument:
    lines = content.split("\n")
    doc_title = title or _extract_title(lines)
    sections = _extract_sections(lines)
    code_blocks = _extract_code_blocks(content)
    tech_stack = _detect_tech_stack(content)
    features = _extract_features(sections)

    return ParsedDocument(
        title=doc_title,
        source_type="markdown",
        sections=sections,
        code_blocks=code_blocks,
        tech_stack=tech_stack,
        features=features,
        raw_text=content,
    )


def _extract_title(lines: list[str]) -> str:
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            return stripped[2:].strip()
    return "Untitled"


def _extract_sections(lines: list[str]) -> list[Section]:
    sections: list[Section] = []
    stack: list[Section] = []
    current_text: list[str] = []

    for line in lines:
        match = re.match(r"^(#{1,6})\s+(.+)$", line)
        if match:
            if current_text and stack:
                stack[-1].content = "\n".join(current_text).strip()
                current_text = []

            level = len(match.group(1))
            heading = match.group(2).strip()
            new_section = Section(heading=heading, level=level, content="")

            while stack and stack[-1].level >= level:
                closed = stack.pop()
                if stack:
                    stack[-1].subsections.append(closed)
                else:
                    sections.append(closed)

            stack.append(new_section)
        else:
            if stack:
                current_text.append(line)
            elif line.strip():
                if not sections:
                    sections.append(
                        Section(heading="Preamble", level=0, content="")
                    )
                    sections[0].content = line.strip()
                else:
                    sections[-1].content += "\n" + line

    if current_text and stack:
        stack[-1].content = "\n".join(current_text).strip()

    while stack:
        closed = stack.pop()
        if stack:
            stack[-1].subsections.append(closed)
        else:
            sections.append(closed)

    return [s for s in sections if s.content or s.subsections]


def _extract_code_blocks(content: str) -> list[CodeBlock]:
    pattern = re.compile(r"```(\w*)\n(.*?)```", re.DOTALL)
    return [
        CodeBlock(language=m.group(1) or "", code=m.group(2).strip())
        for m in pattern.finditer(content)
    ]


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


def _detect_tech_stack(content: str) -> list[str]:
    lower = content.lower()
    found = set()
    for kw in TECH_KEYWORDS:
        if kw in lower:
            found.add(kw)
    return sorted(found)


def _extract_features(sections: list[Section]) -> list[str]:
    feature_keywords = [
        "feature", "特性", "功能", "能力", "capability",
        "支持", "support", "集成", "integration",
    ]
    features: list[str] = []
    for sec in sections:
        combined = f"{sec.heading} {sec.content}".lower()
        if any(kw in combined for kw in feature_keywords):
            for line in sec.content.split("\n"):
                stripped = line.strip()
                if stripped.startswith("- ") or stripped.startswith("* "):
                    features.append(stripped[2:].strip())
                elif stripped and len(stripped) > 10 and len(stripped) < 200:
                    if not any(
                        f in combined
                        for f in ["```", "http", "www.", "copyright"]
                    ):
                        features.append(stripped)
    return features[:20]
