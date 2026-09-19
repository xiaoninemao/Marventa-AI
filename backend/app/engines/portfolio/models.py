from __future__ import annotations

from pydantic import BaseModel


class ScriptDocument(BaseModel):
    id: str
    user_id: str
    title: str
    content: str
    source_session_id: str = ""
    created_at: str
    updated_at: str


class ScriptCreate(BaseModel):
    title: str
    content: str
    source_session_id: str = ""


class ScriptUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
