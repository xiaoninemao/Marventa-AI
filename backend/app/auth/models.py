from __future__ import annotations

from typing import Literal
from pydantic import AliasChoices, BaseModel, Field


class UserRegister(BaseModel):
    email: str
    password: str
    nickname: str = ""


class UserLogin(BaseModel):
    email: str = Field(validation_alias=AliasChoices("email", "login"))
    password: str


class OrganizationResponse(BaseModel):
    id: str
    name: str
    avatar_url: str = ""
    role: Literal["owner", "admin", "member"]
    is_default: bool = True
    uses_default_name: bool = False


class OrganizationDetails(OrganizationResponse):
    created_at: str
    member_count: int


class OrganizationName(BaseModel):
    name: str


class OrganizationUpdate(BaseModel):
    name: str | None = None
    avatar_url: str | None = None


class OrganizationMember(BaseModel):
    user_id: str
    username: str
    email: str = ""
    nickname: str
    avatar_url: str = ""
    role: Literal["owner", "admin", "member"]
    joined_at: str


class OrganizationDetail(OrganizationDetails):
    members: list[OrganizationMember]


class OrganizationMemberInvite(BaseModel):
    email: str
    role: Literal["admin", "member"] = "member"


class OrganizationMemberRole(BaseModel):
    role: Literal["admin", "member"]


class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    nickname: str
    avatar_url: str
    default_organization: OrganizationResponse
    current_organization: OrganizationResponse


class UserUpdate(BaseModel):
    nickname: str | None = None
    avatar_url: str | None = None
