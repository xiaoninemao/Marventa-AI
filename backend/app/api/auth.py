import logging

from fastapi import APIRouter, HTTPException, Depends, Request

from app.auth.models import UserRegister, UserLogin, UserResponse, UserUpdate, OrganizationResponse
from app.auth.security import hash_password, verify_password, create_access_token
from app.auth.storage import (
    create_email_user,
    get_current_organization,
    get_default_organization,
    get_user_by_email,
    get_user_by_login,
    normalize_email,
    update_user,
)
from app.auth.dependencies import get_current_user
from app.config import DEBUG
from app.media_storage import store_image_data_url
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
logger = logging.getLogger(__name__)


def _user_to_response(row) -> UserResponse:
    organization = get_default_organization(row["id"])
    current_organization = get_current_organization(row["id"])
    if organization is None or current_organization is None:
        logger.error("Default organization missing for user %s", row["id"])
        raise HTTPException(status_code=500, detail="Default organization is unavailable")
    return UserResponse(
        id=row["id"],
        username=row["username"],
        email=row["email"] or "",
        nickname=row["nickname"] or row["username"],
        avatar_url=row["avatar_url"] or "",
        default_organization=OrganizationResponse(
            id=organization["id"],
            name=organization["name"],
            role=organization["role"],
            uses_default_name=bool(organization["uses_default_name"]),
        ),
        current_organization=OrganizationResponse(**dict(current_organization)),
    )


@router.post("/register")
async def register(body: UserRegister):
    try:
        email = normalize_email(body.email)
    except ValueError as exc:
        detail = "邮箱不能为空" if str(exc) == "Email is required" else "邮箱格式不正确"
        raise HTTPException(status_code=400, detail=detail) from exc
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少需要6个字符")
    existing = get_user_by_email(email)
    if existing:
        if DEBUG:
            updated = update_user(
                existing["id"],
                password_hash=hash_password(body.password),
                nickname=body.nickname.strip() or existing["nickname"] or existing["username"],
            )
            token = create_access_token(updated["id"])
            return success_response("Existing local account recovered", {
                "access_token": token,
                "token_type": "bearer",
                "user": _user_to_response(updated).model_dump(),
            })
        raise HTTPException(status_code=400, detail="该邮箱已被注册")
    hashed = hash_password(body.password)
    try:
        user_row = create_email_user(email, hashed, body.nickname)
    except ValueError as exc:
        if str(exc) == "Email is already registered":
            raise HTTPException(status_code=400, detail="该邮箱已被注册") from exc
        raise
    token = create_access_token(user_row["id"])

    return success_response("Registration successful", {
        "access_token": token,
        "token_type": "bearer",
        "user": _user_to_response(user_row).model_dump(),
    })


@router.post("/login")
async def login(body: UserLogin):
    if not body.email.strip() or not body.password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    user_row = get_user_by_login(body.email.strip())
    if not user_row:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(body.password, user_row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user_row["id"])
    return success_response("Login successful", {
        "access_token": token,
        "token_type": "bearer",
        "user": _user_to_response(user_row).model_dump(),
    })


@router.get("/me")
async def get_me(user=Depends(get_current_user)):
    return success_response("User retrieved", _user_to_response(user).model_dump())


@router.put("/me")
async def update_me(body: UserUpdate, request: Request, user=Depends(get_current_user)):
    updates = {}
    if body.nickname is not None:
        updates["nickname"] = body.nickname.strip()
    if body.avatar_url is not None:
        updates["avatar_url"] = store_image_data_url(
            body.avatar_url.strip(), "avatars", user["id"], str(request.base_url),
            "Invalid profile image",
        )

    updated = update_user(user["id"], **updates)
    return success_response("Profile updated", _user_to_response(updated).model_dump())


@router.post("/verify")
async def verify_token(user=Depends(get_current_user)):
    return success_response("Token valid", _user_to_response(user).model_dump())
