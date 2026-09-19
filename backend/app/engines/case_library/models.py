from __future__ import annotations

from pydantic import BaseModel


class CaseAIAnalysis(BaseModel):
    content_analysis: str = ""
    marketing_angle: str = ""
    target_audience: str = ""
    experience_extraction: str = ""
    key_highlights: list[str] = []
    improvement_suggestions: list[str] = []
    similar_approaches: list[str] = []
    title_suggestions: list[str] = []
    tag_suggestions: list[str] = []
    hook_analysis: str = ""
    rewrite_examples: list[str] = []


class CaseCreate(BaseModel):
    title: str
    content_type: str  # "video" or "image_text"
    category: str = "agency"  # "agency" or "curated"
    description: str = ""
    tags: list[str] = []
    source: str = ""


class CaseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    is_public: bool | None = None
    category: str | None = None
    source: str | None = None


class CaseResponse(BaseModel):
    id: str
    title: str
    content_type: str
    category: str
    description: str
    video_url: str
    image_urls: list[str]
    tags: list[str]
    owner_id: str
    is_public: bool
    source: str = ""
    is_favorited: bool = False
    created_at: str
    updated_at: str
    ai_status: str = ""
    ai_analysis: CaseAIAnalysis | None = None
    platform: str = ""
    industry: str = ""
    scene: str = ""
    original_url: str = ""
    cover_url: str = ""
    published_at: str = ""
    popularity: int = 0
    likes: int | None = None
    favorites_count: int | None = None
    comments: int | None = None
    body: str = ""
    recognition_status: str = "recognized"
