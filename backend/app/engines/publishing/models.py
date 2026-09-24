"""Project schemas and legacy publishing records retained for stored-data compatibility."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.engines.content_generator.models import ContentCard


class ProjectMember(BaseModel):
    user_id: str
    username: str
    email: str = ""
    nickname: str
    avatar_url: str = ""
    role: str
    joined_at: str


class ContentProject(BaseModel):
    id: str
    user_id: str
    title: str
    xhs_account: str = ""
    source_session_id: str
    source_card_id: str = ""
    content_type: str = "mixed"
    platform_hint: str = ""
    cards_snapshot: list[ContentCard] = []
    final_snapshot: dict[str, Any] = {}
    notes: str = ""
    status: str = "active"
    role: str = "owner"
    avatar_color: str = "#bfdbfe"
    avatar_icon: str = "💡"
    members: list[ProjectMember] = []
    member_count: int = 0
    created_at: str
    updated_at: str


class ProjectMemberInvite(BaseModel):
    email: str
    role: str = "member"


class ProjectMemberRole(BaseModel):
    role: str


class PublishTask(BaseModel):
    id: str
    user_id: str
    project_id: str = ""
    source_session_id: str
    source_card_id: str = ""
    platform: str = "xiaohongshu"
    account_name: str = ""
    content_type: str = "mixed"
    status: str = "pending_publish"
    selected_version_ids: dict[str, str] = {}
    original_cards: list[ContentCard] = []
    final_snapshot: dict[str, Any] = {}
    planned_publish_at: str = ""
    published_at: str = ""
    publish_link: str = ""
    platform_work_id: str = ""
    metrics: dict[str, Any] = {}
    review: dict[str, Any] = {}
    created_at: str
    updated_at: str


class PublishMetric(BaseModel):
    id: str
    task_id: str
    user_id: str
    views: int = 0
    likes: int = 0
    collects: int = 0
    comments: int = 0
    shares: int = 0
    followers: int = 0
    leads: int = 0
    completion_rate: float = 0
    interaction_rate: float = 0
    collect_rate: float = 0
    raw_data: dict[str, Any] = {}
    created_at: str
    updated_at: str


class PublishReview(BaseModel):
    id: str
    task_id: str
    user_id: str
    summary: str = ""
    success_reasons: list[str] = []
    problem_reasons: list[str] = []
    reusable_structures: list[str] = []
    next_directions: list[str] = []
    series_potential: str = ""
    memory_update_suggestion: str = ""
    created_at: str
    updated_at: str


class SocialAccount(BaseModel):
    id: str
    user_id: str
    platform: str
    account_name: str
    platform_user_id: str = ""
    nickname: str = ""
    avatar_url: str = ""
    profile_url: str = ""
    account_type: str = "ordinary"
    remark: str = ""
    session_dir: str
    status: str = "authorized"
    cookie_status: str = "unknown"
    profile: dict[str, Any] = {}
    last_checked_at: str = ""
    created_at: str
    updated_at: str


class AccountMemory(BaseModel):
    id: str
    user_id: str
    platform: str = "xiaohongshu"
    account_name: str
    brand_positioning: str = ""
    target_users: str = ""
    product_selling_points: str = ""
    content_style: str = ""
    banned_expressions: list[str] = []
    common_tags: list[str] = []
    high_performing_content: list[str] = []
    low_performing_directions: list[str] = []
    ai_operation_lessons: list[str] = []
    created_at: str
    updated_at: str


class ReviewConclusion(BaseModel):
    summary: str
    performance_reasons: list[str] = Field(default_factory=list)
    reusable_structures: list[str] = Field(default_factory=list)
    problems: list[str] = Field(default_factory=list)
    next_adjustments: list[str] = Field(default_factory=list)
    series_potential: str = ""
    memory_lesson: str = ""


class CreateProjectRequest(BaseModel):
    source_session_id: str
    source_card_id: str = ""
    title: str = ""
    xhs_account: str = ""
    content_type: str = "mixed"
    platform_hint: str = ""
    notes: str = ""


class ManualProjectRequest(BaseModel):
    title: str = ""
    platform_hint: str = ""
    content_type: str = "mixed"
    xhs_account: str = ""
    final_snapshot: dict[str, Any] = {}
    notes: str = ""


class UpdateProjectRequest(BaseModel):
    title: str | None = None
    notes: str | None = None
    avatar_color: str | None = None
    avatar_icon: str | None = None
