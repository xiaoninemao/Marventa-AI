from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.engines.content_generator.models import ContentCard


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
    media_assets: list[dict[str, Any]] = []
    notes: str = ""
    status: str = "active"
    created_at: str
    updated_at: str


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
    media_assets: list[dict[str, Any]] = []


class CreateTaskRequest(BaseModel):
    source_session_id: str
    source_card_id: str = ""
    project_id: str = ""
    platform: str = "xiaohongshu"
    account_name: str = ""
    content_type: str = "mixed"
    selected_version_ids: dict[str, str] = {}
    final_snapshot: dict[str, Any] = {}
    planned_publish_at: str = ""


class CreateTaskFromProjectRequest(BaseModel):
    project_id: str
    platform: str = "xiaohongshu"
    account_name: str = ""
    content_type: str = "mixed"
    selected_version_ids: dict[str, str] = {}
    planned_publish_at: str = ""


class UpdateTaskRequest(BaseModel):
    project_id: str | None = None
    platform: str | None = None
    account_name: str | None = None
    content_type: str | None = None
    status: str | None = None
    selected_version_ids: dict[str, str] | None = None
    final_snapshot: dict[str, Any] | None = None
    planned_publish_at: str | None = None
    published_at: str | None = None
    publish_link: str | None = None
    platform_work_id: str | None = None


class UpsertMetricRequest(BaseModel):
    views: int = 0
    likes: int = 0
    collects: int = 0
    comments: int = 0
    shares: int = 0
    followers: int = 0
    leads: int = 0
    completion_rate: float = 0


class GenerateReviewRequest(BaseModel):
    write_to_memory: bool = False


class UpsertAccountMemoryRequest(BaseModel):
    id: str | None = None
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


class StartLoginRequest(BaseModel):
    platform: str
    account_name: str
    account_id: str = ""
    fresh: bool = False


class InspectLoginRequest(BaseModel):
    login_session_id: str


class SaveLoginRequest(BaseModel):
    platform: str
    account_name: str
    login_session_id: str = ""
    account_id: str = ""
    platform_user_id: str = ""
    nickname: str = ""
    avatar_url: str = ""
    profile_url: str = ""
    followers: str = ""
    remark: str = ""


class UpdateSocialAccountRequest(BaseModel):
    account_name: str | None = None
    platform_user_id: str | None = None
    avatar_url: str | None = None
    profile_url: str | None = None
    remark: str | None = None
    followers: str | None = None
    industry: str | None = None
    status: str | None = None
    cookie_status: str | None = None


class ManualAccountImportRequest(BaseModel):
    platform: str
    account_type: str = "ordinary"
    cookie_format: str = "json"
    cookie_content: str
    account_name: str = ""
    remark: str = ""
    profile_url: str = ""
    platform_user_id: str = ""
    nickname: str = ""


class PublishExecuteRequest(BaseModel):
    mode: str = "real"
    dry_run: bool = False
