from __future__ import annotations

from pydantic import BaseModel, Field
from datetime import datetime


class CodeBlock(BaseModel):
    language: str = ""
    code: str


class Section(BaseModel):
    heading: str
    level: int
    content: str
    subsections: list["Section"] = []


class AIAnalysis(BaseModel):
    product_name: str = ""
    product_category: str = ""
    product_description: str = ""
    product_images: list[str] = []
    similar_products: list[str] = []
    strengths: list[str] = []
    weaknesses: list[str] = []
    product_summary: str = ""
    target_audience: str = ""
    use_cases: list[str] = []
    market_positioning: str = ""
    tech_highlights: list[str] = []
    suggested_marketing_angles: list[str] = []
    marketing_stage: str = ""


class ParsedDocument(BaseModel):
    title: str
    source_type: str
    sections: list[Section] = []
    code_blocks: list[CodeBlock] = []
    tech_stack: list[str] = []
    features: list[str] = []
    raw_text: str = ""
    extracted_images: list[str] = []
    ai_analysis: AIAnalysis | None = None
    ai_model: str = ""


class HistoryRecord(BaseModel):
    id: str
    filename: str
    file_size: int
    upload_time: str
    source_type: str
    title: str
    ai_model: str = ""
    ai_analysis: AIAnalysis | None = None
    is_edited: bool = False
    status: str = "completed"
    owner_id: str = ""


class HistoryUpdateRequest(BaseModel):
    ai_analysis: AIAnalysis


class ParseRequest(BaseModel):
    repo_url: str = Field(..., description="GitHub or GitLab repository URL")


class ParseResponse(BaseModel):
    success: bool
    message: str
    data: ParsedDocument | None = None
