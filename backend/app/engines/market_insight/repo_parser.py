from __future__ import annotations

import re
import httpx
from app.engines.market_insight.models import ParsedDocument, Section, CodeBlock


GITHUB_API = "https://api.github.com/repos/{owner}/{repo}/readme"
GITLAB_API = "https://gitlab.com/api/v4/projects/{owner}%2F{repo}/repository/files/README.md?ref=main"


def parse_repo(repo_url: str) -> ParsedDocument:
    content, title = _fetch_readme(repo_url)
    return _parse_readme_content(content, title)


def _fetch_readme(repo_url: str) -> tuple[str, str]:
    owner, repo = _parse_repo_url(repo_url)

    for fetcher in [_fetch_github, _fetch_gitlab]:
        try:
            content, title = fetcher(owner, repo)
            if content:
                return content, title
        except Exception:
            continue

    raise ValueError(f"Unable to fetch README from: {repo_url}")


def _parse_repo_url(url: str) -> tuple[str, str]:
    url = url.rstrip("/")
    url = re.sub(r"https?://(www\.)?", "", url)
    parts = url.split("/")
    if len(parts) >= 3:
        return parts[1], parts[2].removesuffix(".git")
    raise ValueError(f"Invalid repository URL: {url}")


def _fetch_github(owner: str, repo: str) -> tuple[str | None, str]:
    headers = {"Accept": "application/vnd.github.v3.raw"}
    try:
        resp = httpx.get(
            GITHUB_API.format(owner=owner, repo=repo),
            headers=headers,
            follow_redirects=True,
            timeout=15.0,
        )
        resp.raise_for_status()
        return resp.text, f"{owner}/{repo} README"
    except Exception:
        return None, ""


def _fetch_gitlab(owner: str, repo: str) -> tuple[str | None, str]:
    try:
        resp = httpx.get(
            GITLAB_API.format(owner=owner, repo=repo),
            follow_redirects=True,
            timeout=15.0,
        )
        resp.raise_for_status()
        import base64
        data = resp.json()
        content = base64.b64decode(data["content"]).decode("utf-8")
        return content, f"{owner}/{repo} README"
    except Exception:
        return None, ""


def _parse_readme_content(content: str, title: str) -> ParsedDocument:
    lines = content.split("\n")

    doc_title = title
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            doc_title = stripped[2:].strip()
            break

    sections = _extract_sections(lines)
    code_blocks = _extract_code_blocks(content)
    tech_stack = _detect_tech_stack(content)
    features = _extract_features(sections)

    return ParsedDocument(
        title=doc_title,
        source_type="repo",
        sections=sections,
        code_blocks=code_blocks,
        tech_stack=tech_stack,
        features=features,
        raw_text=content,
    )


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
    features: list[str] = []
    for sec in sections:
        combined = f"{sec.heading} {sec.content}".lower()
        if any(
            kw in combined
            for kw in ["feature", "特性", "功能", "能力", "support", "支持"]
        ):
            for line in sec.content.split("\n"):
                stripped = line.strip()
                if stripped.startswith(("- ", "* ")):
                    features.append(stripped[2:].strip())
                elif stripped and 10 < len(stripped) < 200:
                    features.append(stripped)
    return features[:20]
