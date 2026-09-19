from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone

from app.config import DB_PATH
from app.database import connect_database


def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def ensure_notifications_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            organization_id TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL,
            data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
            action_url TEXT NOT NULL DEFAULT '',
            is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_notifications_user_created
        ON notifications(user_id, created_at DESC, id DESC)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
        ON notifications(user_id, is_read, created_at DESC)
    """)


def init_notifications_db() -> None:
    with closing(_get_conn()) as conn, conn:
        ensure_notifications_schema(conn)


def create_notification(
    user_id: str,
    kind: str,
    data: dict[str, str],
    action_url: str = "",
    organization_id: str = "",
    conn: sqlite3.Connection | None = None,
) -> str:
    notification_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")

    def insert(target: sqlite3.Connection) -> None:
        ensure_notifications_schema(target)
        target.execute(
            "INSERT INTO notifications "
            "(id, user_id, organization_id, kind, data_json, action_url, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                notification_id,
                user_id,
                organization_id,
                kind,
                json.dumps(data, ensure_ascii=False, sort_keys=True),
                action_url,
                created_at,
            ),
        )

    if conn is not None:
        insert(conn)
    else:
        with closing(_get_conn()) as own_conn, own_conn:
            insert(own_conn)
    return notification_id


def list_notifications(user_id: str, limit: int = 30) -> list[sqlite3.Row]:
    init_notifications_db()
    with closing(_get_conn()) as conn:
        return conn.execute("""
            SELECT id, organization_id, kind, data_json, action_url, is_read, created_at
            FROM notifications
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        """, (user_id, limit)).fetchall()


def unread_notification_count(user_id: str) -> int:
    init_notifications_db()
    with closing(_get_conn()) as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0",
            (user_id,),
        ).fetchone()
        return int(row["count"])


def mark_notification_read(user_id: str, notification_id: str) -> bool:
    init_notifications_db()
    with closing(_get_conn()) as conn, conn:
        cursor = conn.execute(
            "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
            (notification_id, user_id),
        )
        return cursor.rowcount > 0


def mark_all_notifications_read(user_id: str) -> int:
    init_notifications_db()
    with closing(_get_conn()) as conn, conn:
        cursor = conn.execute(
            "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
            (user_id,),
        )
        return cursor.rowcount
