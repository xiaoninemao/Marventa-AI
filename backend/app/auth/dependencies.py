from fastapi import Request, HTTPException

from app.auth.security import decode_access_token
from app.auth.storage import get_current_organization, get_user_by_id


def _with_organization(user) -> dict:
    result = dict(user)
    organization = get_current_organization(user["id"])
    if organization is None:
        raise HTTPException(status_code=403, detail="Current organization is unavailable")
    result["organization_id"] = organization["id"]
    result["organization_role"] = organization["role"]
    return result


def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return _with_organization(user)


def get_optional_user(request: Request):
    """Try to authenticate, but return a guest user if no valid token is present."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return {"id": ""}

    token = auth_header[7:]
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if user_id:
            user = get_user_by_id(user_id)
            if user:
                return _with_organization(user)
    except Exception:
        pass

    return {"id": ""}


def can_manage_organization_record(user, creator_id: str) -> bool:
    return user["id"] == creator_id or user.get("organization_role") in {"owner", "admin"}
