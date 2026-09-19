from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

from app.config import DB_PATH
from app.database import connect_database
from app.engines.portfolio.models import ScriptDocument
from app.storage_schema import ensure_organization_scope, resolve_user_organization_id

DOCUMENT_WATERMARK = "由 Marventa AI 生成 · 未付费版本保留水印"


def ensure_watermark(content: str) -> str:
    text = content or ""
    if DOCUMENT_WATERMARK in text:
        return text
    return text.rstrip() + ("\n\n" if text.strip() else "") + DOCUMENT_WATERMARK


def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def init_db():
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS portfolio (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            source_session_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
    """)
    ensure_organization_scope(conn, "portfolio", "user_id")
    conn.commit()
    conn.close()


def create_script(user_id: str, title: str, content: str, source_session_id: str = "") -> ScriptDocument:
    init_db()
    conn = _get_conn()
    sid = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    content = ensure_watermark(content)
    conn.execute(
        "INSERT INTO portfolio (id, user_id, title, content, source_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (sid, user_id, title, content, source_session_id, now, now),
    )
    conn.commit()
    conn.close()
    return ScriptDocument(
        id=sid, user_id=user_id, title=title, content=content,
        source_session_id=source_session_id, created_at=now, updated_at=now,
    )


def get_script(script_id: str, user_id: str | None = None) -> ScriptDocument | None:
    init_db()
    conn = _get_conn()
    if user_id is None:
        row = conn.execute("SELECT * FROM portfolio WHERE id = ?", (script_id,)).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, user_id)
        row = conn.execute(
            "SELECT * FROM portfolio WHERE id = ? AND organization_id = ?",
            (script_id, organization_id),
        ).fetchone()
    conn.close()
    if not row:
        return None
    return ScriptDocument(**dict(row))


def list_scripts(user_id: str) -> list[ScriptDocument]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    rows = conn.execute(
        "SELECT * FROM portfolio WHERE organization_id = ? "
        "ORDER BY updated_at DESC, id DESC LIMIT 200",
        (organization_id,),
    ).fetchall()
    conn.close()
    return [ScriptDocument(**dict(r)) for r in rows]


def update_script(script_id: str, title: str | None = None, content: str | None = None) -> ScriptDocument | None:
    init_db()
    conn = _get_conn()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    if title is not None:
        conn.execute("UPDATE portfolio SET title = ?, updated_at = ? WHERE id = ?", (title, now, script_id))
    if content is not None:
        content = ensure_watermark(content)
        conn.execute("UPDATE portfolio SET content = ?, updated_at = ? WHERE id = ?", (content, now, script_id))
    conn.commit()
    row = conn.execute("SELECT * FROM portfolio WHERE id = ?", (script_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return ScriptDocument(**dict(row))


def delete_script(script_id: str) -> bool:
    init_db()
    conn = _get_conn()
    conn.execute("DELETE FROM portfolio WHERE id = ?", (script_id,))
    conn.commit()
    conn.close()
    return True
