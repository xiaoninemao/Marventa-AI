from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from app.config import DB_PATH
from app.database import connect_database
from app.engines.content_generator.models import (
    ChatMessage, ContentCard, SessionResponse, ContentVersion,
)
from app.storage_schema import (
    ensure_organization_scope,
    ensure_parent_organization_scope,
    ensure_json_columns,
    resolve_user_organization_id,
)

_os = __import__("os")


def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def init_db() -> None:
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS creation_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT DEFAULT '',
            messages TEXT DEFAULT '[]',
            cards TEXT DEFAULT '[]',
            status TEXT DEFAULT 'drafting',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    # Migrations
    cols = [r[1] for r in conn.execute("PRAGMA table_info(creation_sessions)").fetchall()]
    if "insight_ids" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN insight_ids TEXT DEFAULT '[]'")
    if "case_ids" not in cols:
        conn.execute("ALTER TABLE creation_sessions ADD COLUMN case_ids TEXT DEFAULT '[]'")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS content_versions (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            version_label TEXT NOT NULL,
            major INTEGER NOT NULL,
            minor INTEGER NOT NULL,
            cards TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_content_versions_session
        ON content_versions(session_id, major, minor)
    """)
    ensure_organization_scope(conn, "creation_sessions", "user_id")
    ensure_parent_organization_scope(
        conn, "content_versions", "creation_sessions", "session_id",
    )
    ensure_json_columns(
        conn, "creation_sessions", ("messages", "cards", "insight_ids", "case_ids"),
    )
    ensure_json_columns(conn, "content_versions", ("cards",))
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_org_user_updated "
        "ON creation_sessions(organization_id, user_id, updated_at DESC)"
    )
    conn.commit()
    conn.close()


def create_session(user_id: str) -> SessionResponse:
    init_db()
    sid = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    conn = _get_conn()
    conn.execute(
        "INSERT INTO creation_sessions (id, user_id, title, messages, cards, status, insight_ids, case_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (sid, user_id, "", "[]", "[]", "drafting", "[]", "[]", now, now),
    )
    conn.commit()
    conn.close()
    return SessionResponse(
        id=sid, user_id=user_id, title="", messages=[], cards=[],
        status="drafting", insight_ids=[], case_ids=[],
        created_at=now, updated_at=now,
    )


def get_session(session_id: str, user_id: str | None = None) -> SessionResponse | None:
    init_db()
    conn = _get_conn()
    if user_id is None:
        row = conn.execute(
            "SELECT * FROM creation_sessions WHERE id = ?", (session_id,),
        ).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, user_id)
        row = conn.execute(
            "SELECT * FROM creation_sessions "
            "WHERE id = ? AND user_id = ? AND organization_id = ?",
            (session_id, user_id, organization_id),
        ).fetchone()
    conn.close()
    if row is None:
        return None
    return _row_to_session(row)


def list_sessions(user_id: str) -> list[SessionResponse]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    rows = conn.execute(
        "SELECT * FROM creation_sessions WHERE user_id = ? AND organization_id = ? "
        "AND (cards != '[]' OR messages != '[]') "
        "ORDER BY updated_at DESC, id DESC LIMIT 200",
        (user_id, organization_id),
    ).fetchall()
    conn.close()
    return [_row_to_session(r) for r in rows]


def update_session(session_id: str, **kwargs) -> SessionResponse | None:
    init_db()
    existing = get_session(session_id)
    if existing is None:
        return None

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    fields = []
    values = []

    for key, val in kwargs.items():
        if val is not None and hasattr(existing, key):
            if key in ("messages", "cards") and isinstance(val, list):
                fields.append(f"{key} = ?")
                values.append(json.dumps(
                    [v.model_dump() if hasattr(v, "model_dump") else v for v in val],
                    ensure_ascii=False,
                ))
            elif key in ("insight_ids", "case_ids") and isinstance(val, list):
                fields.append(f"{key} = ?")
                values.append(json.dumps(val, ensure_ascii=False))
            else:
                fields.append(f"{key} = ?")
                values.append(val)

    if not fields:
        return existing

    fields.append("updated_at = ?")
    values.append(now)
    values.append(session_id)

    conn = _get_conn()
    conn.execute(f"UPDATE creation_sessions SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return get_session(session_id)


def delete_session(session_id: str) -> bool:
    init_db()
    conn = _get_conn()
    conn.execute("DELETE FROM content_versions WHERE session_id = ?", (session_id,))
    cursor = conn.execute("DELETE FROM creation_sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def _row_to_session(row: sqlite3.Row) -> SessionResponse:
    messages = []
    try:
        raw = json.loads(row["messages"] or "[]")
        messages = [ChatMessage(**m) for m in raw]
    except (json.JSONDecodeError, TypeError):
        pass

    cards = []
    try:
        raw = json.loads(row["cards"] or "[]")
        cards = [ContentCard(**c) for c in raw]
    except (json.JSONDecodeError, TypeError):
        pass

    insight_ids = []
    try:
        insight_ids = json.loads(row["insight_ids"] or "[]")
    except (json.JSONDecodeError, TypeError):
        pass

    case_ids = []
    try:
        case_ids = json.loads(row["case_ids"] or "[]")
    except (json.JSONDecodeError, TypeError):
        pass

    return SessionResponse(
        id=row["id"],
        user_id=row["user_id"],
        title=row["title"] or "",
        messages=messages,
        cards=cards,
        status=row["status"] or "drafting",
        insight_ids=insight_ids,
        case_ids=case_ids,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── Version History ──


def _row_to_version(row: sqlite3.Row) -> ContentVersion:
    cards = []
    try:
        raw = json.loads(row["cards"] or "[]")
        cards = [ContentCard(**c) for c in raw]
    except (json.JSONDecodeError, TypeError):
        pass
    return ContentVersion(
        id=row["id"],
        session_id=row["session_id"],
        version_label=row["version_label"],
        major=row["major"],
        minor=row["minor"],
        cards=cards,
        created_at=row["created_at"],
    )


def save_version(session_id: str, cards: list[ContentCard], major: int, minor: int) -> ContentVersion:
    init_db()
    vid = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    label = f"v{major}.{minor}"
    cards_json = json.dumps(
        [v.model_dump() if hasattr(v, "model_dump") else v for v in cards],
        ensure_ascii=False,
    )
    conn = _get_conn()
    conn.execute(
        "INSERT INTO content_versions (id, session_id, version_label, major, minor, cards, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (vid, session_id, label, major, minor, cards_json, now),
    )
    conn.commit()
    conn.close()
    return ContentVersion(
        id=vid, session_id=session_id, version_label=label,
        major=major, minor=minor, cards=cards, created_at=now,
    )


def save_next_version(session_id: str, cards: list[ContentCard], is_major_bump: bool) -> ContentVersion:
    """Atomically compute next version number and save the version record."""
    init_db()
    conn = _get_conn()
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute(
        "SELECT major, minor FROM content_versions WHERE session_id = ? ORDER BY major DESC, minor DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    if row is None:
        major, minor = 1, 0
    else:
        major, minor = row["major"], row["minor"]
        if is_major_bump:
            major, minor = major + 1, 0
        else:
            minor = minor + 1

    vid = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    label = f"v{major}.{minor}"
    cards_json = json.dumps(
        [v.model_dump() if hasattr(v, "model_dump") else v for v in cards],
        ensure_ascii=False,
    )
    conn.execute(
        "INSERT INTO content_versions (id, session_id, version_label, major, minor, cards, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (vid, session_id, label, major, minor, cards_json, now),
    )
    conn.commit()
    conn.close()
    return ContentVersion(
        id=vid, session_id=session_id, version_label=label,
        major=major, minor=minor, cards=cards, created_at=now,
    )


def get_versions(session_id: str) -> list[ContentVersion]:
    init_db()
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM content_versions WHERE session_id = ? ORDER BY major ASC, minor ASC",
        (session_id,),
    ).fetchall()
    conn.close()
    return [_row_to_version(r) for r in rows]


def get_version(version_id: str) -> ContentVersion | None:
    init_db()
    conn = _get_conn()
    row = conn.execute("SELECT * FROM content_versions WHERE id = ?", (version_id,)).fetchone()
    conn.close()
    if row is None:
        return None
    return _row_to_version(row)


def get_current_version_number(session_id: str) -> tuple[int, int] | None:
    init_db()
    conn = _get_conn()
    row = conn.execute(
        "SELECT major, minor FROM content_versions WHERE session_id = ? ORDER BY major DESC, minor DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return (row["major"], row["minor"])


def _compute_next_version(session_id: str, is_major_bump: bool) -> tuple[int, int]:
    current = get_current_version_number(session_id)
    if current is None:
        return (1, 0)
    major, minor = current
    if is_major_bump:
        return (major + 1, 0)
    else:
        return (major, minor + 1)


def delete_versions_for_session(session_id: str) -> None:
    init_db()
    conn = _get_conn()
    conn.execute("DELETE FROM content_versions WHERE session_id = ?", (session_id,))
    conn.commit()
    conn.close()
