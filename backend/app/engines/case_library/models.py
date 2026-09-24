from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    opening_hook: str = ""
    pacing_analysis: str = ""
    shot_structure: str = ""
    script_structure: str = ""


class GeneratedCaseAIAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    content_analysis: str = Field(min_length=80)
    marketing_angle: str = Field(min_length=40)
    target_audience: str = Field(min_length=40)
    experience_extraction: str = Field(min_length=60)
    key_highlights: list[str] = Field(min_length=3, max_length=5)
    improvement_suggestions: list[str] = Field(min_length=2, max_length=4)
    similar_approaches: list[str] = Field(min_length=3, max_length=5)
    hook_analysis: str = Field(min_length=40)
    title_suggestions: list[str] = Field(min_length=2, max_length=4)
    tag_suggestions: list[str] = Field(min_length=3, max_length=6)
    rewrite_examples: list[str] = Field(min_length=1, max_length=3)
    opening_hook: str
    pacing_analysis: str
    shot_structure: str
    script_structure: str

    @model_validator(mode="after")
    def validate_content_quality(self):
        arrays = (
            self.key_highlights,
            self.improvement_suggestions,
            self.similar_approaches,
            self.title_suggestions,
            self.tag_suggestions,
            self.rewrite_examples,
        )
        if any(not item.strip() for values in arrays for item in values):
            raise ValueError("Case analysis arrays cannot contain empty items")
        if any(len(item.strip()) < 6 for values in arrays[:-2] for item in values):
            raise ValueError("Case analysis recommendations must contain useful detail")
        if any(len(item.strip()) < 12 for item in self.rewrite_examples):
            raise ValueError("Case analysis rewrite examples must contain useful detail")
        return self


def validate_generated_case_analysis(
    payload: dict,
    content_type: str,
) -> CaseAIAnalysis:
    generated = GeneratedCaseAIAnalysis.model_validate(payload)
    video_fields = (
        generated.opening_hook,
        generated.pacing_analysis,
        generated.shot_structure,
        generated.script_structure,
    )
    if content_type == "video":
        if any(len(value.strip()) < 30 for value in video_fields):
            raise ValueError("Video analysis requires complete video-specific fields")
    elif any(value.strip() for value in video_fields):
        raise ValueError("Image-text analysis must leave video-specific fields empty")
    return CaseAIAnalysis(**generated.model_dump())


class CaseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    source: str | None = None


class CaseResponse(BaseModel):
    id: str
    title: str
    content_type: str
    description: str
    video_url: str
    image_urls: list[str]
    tags: list[str]
    owner_id: str
    creator_name: str = ""
    organization_id: str = ""
    project_id: str = ""
    project_title: str = ""
    project_role: str = "member"
    is_project_member: bool = False
    source: str = ""
    is_favorited: bool = False
    created_at: str
    updated_at: str
    ai_status: str = ""
    ai_analysis: CaseAIAnalysis | None = None
    ai_analyzed_at: str = ""
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
