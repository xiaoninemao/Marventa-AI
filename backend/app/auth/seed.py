from __future__ import annotations

from app.auth.security import hash_password
from app.auth.storage import create_user, get_user_by_login, init_users_db, update_user
from app.config import DEMO_EMAIL, DEMO_PASSWORD, DEMO_USERNAME

DEMO_NICKNAME = "demo"


def ensure_demo_user() -> None:
    if not DEMO_PASSWORD:
        raise RuntimeError("DEMO_PASSWORD is required when ENABLE_DEMO_USER=true")
    init_users_db()
    existing = get_user_by_login(DEMO_USERNAME)
    password_hash = hash_password(DEMO_PASSWORD)

    if existing:
        update_user(existing["id"], password_hash=password_hash, nickname=DEMO_NICKNAME)
        return

    create_user(DEMO_USERNAME, DEMO_EMAIL, password_hash, DEMO_NICKNAME)
