from datetime import datetime, timezone
from app.engines.case_library.storage import _get_conn, init_db
from app.storage_schema import resolve_user_organization_id


def add_favorite(user_id: str, case_id: str) -> bool:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    try:
        conn.execute(
            "INSERT OR IGNORE INTO case_favorites "
            "(organization_id, user_id, case_id, created_at) VALUES (?, ?, ?, ?)",
            (organization_id, user_id, case_id, now),
        )
        conn.commit()
        conn.close()
        return True
    except Exception:
        conn.close()
        return False


def remove_favorite(user_id: str, case_id: str) -> bool:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    conn.execute(
        "DELETE FROM case_favorites WHERE user_id = ? AND case_id = ? AND organization_id = ?",
        (user_id, case_id, organization_id),
    )
    conn.commit()
    affected = conn.total_changes
    conn.close()
    return affected > 0


def is_favorited(user_id: str, case_id: str) -> bool:
    if not user_id:
        return False
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    row = conn.execute(
        "SELECT 1 FROM case_favorites WHERE user_id = ? AND case_id = ? AND organization_id = ?",
        (user_id, case_id, organization_id),
    ).fetchone()
    conn.close()
    return row is not None


def get_favorite_ids(user_id: str) -> set[str]:
    if not user_id:
        return set()
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    rows = conn.execute(
        "SELECT case_id FROM case_favorites WHERE user_id = ? AND organization_id = ?",
        (user_id, organization_id),
    ).fetchall()
    conn.close()
    return {r["case_id"] for r in rows}
