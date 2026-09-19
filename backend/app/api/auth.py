import base64
import binascii
import hashlib
import logging
import os
import re
import tempfile

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
from app.config import DEBUG, MEDIA_ROOT
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
logger = logging.getLogger(__name__)
_AVATAR_DATA_URL = re.compile(
    r"^data:(image/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\\s]+)$"
)
_AVATAR_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}


def _valid_image_signature(mime_type: str, data: bytes) -> bool:
    if mime_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if mime_type == "image/gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    return len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP"


def _store_avatar(value: str, user_id: str, base_url: str) -> str:
    match = _AVATAR_DATA_URL.fullmatch(value)
    if not match:
        return value
    mime_type, encoded = match.groups()
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid profile image") from exc
    if not data or len(data) > 2 * 1024 * 1024 or not _valid_image_signature(mime_type, data):
        raise HTTPException(status_code=400, detail="Invalid profile image")
    directory = os.path.join(MEDIA_ROOT, "avatars", user_id)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    filename = f"{hashlib.sha256(data).hexdigest()[:24]}.{_AVATAR_EXTENSIONS[mime_type]}"
    destination = os.path.join(directory, filename)
    if not os.path.exists(destination):
        fd, temp_path = tempfile.mkstemp(prefix=".avatar-", dir=directory)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temp_path, 0o600)
            os.replace(temp_path, destination)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
    return f"{base_url.rstrip('/')}/media/avatars/{user_id}/{filename}"


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
        role=row["role"] if "role" in row.keys() else "user",
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
        updates["avatar_url"] = _store_avatar(
            body.avatar_url.strip(), user["id"], str(request.base_url),
        )

    updated = update_user(user["id"], **updates)
    return success_response("Profile updated", _user_to_response(updated).model_dump())


@router.post("/verify")
async def verify_token(user=Depends(get_current_user)):
    return success_response("Token valid", _user_to_response(user).model_dump())
