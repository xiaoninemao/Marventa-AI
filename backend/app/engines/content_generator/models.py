from __future__ import annotations

from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ContentCard(BaseModel):
    id: str
    card_type: str  # "script" | "title" | "copy" | "hashtags" | "visual"
    title: str
    preview: str
    content: str
    tips: list[str] = []


class SessionCreate(BaseModel):
    pass


class SessionUpdate(BaseModel):
    title: str | None = None
    messages: list[ChatMessage] | None = None
    cards: list[ContentCard] | None = None
    status: str | None = None


class SessionResponse(BaseModel):
    id: str
    user_id: str
    title: str
    messages: list[ChatMessage]
    cards: list[ContentCard]
    status: str
    insight_ids: list[str] = []
    case_ids: list[str] = []
    created_at: str
    updated_at: str


class ChatRequest(BaseModel):
    message: str
    insight_ids: list[str] = []
    case_ids: list[str] = []


class SetReferencesRequest(BaseModel):
    insight_ids: list[str] = []
    case_ids: list[str] = []


class ChatResponse(BaseModel):
    reply: ChatMessage
    session: SessionResponse


class ModifyCardRequest(BaseModel):
    instruction: str


class ModifyCardResponse(BaseModel):
    card: ContentCard


class ContentVersion(BaseModel):
    id: str
    session_id: str
    version_label: str
    major: int
    minor: int
    cards: list[ContentCard]
    created_at: str
