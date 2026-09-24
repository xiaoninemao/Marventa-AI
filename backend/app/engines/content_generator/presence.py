"""Short-lived, per-browser-visit creation presence; never edits creation content."""

from __future__ import annotations

import sqlite3
import time
from contextlib import closing

from app.engines.content_generator import storage


LEASE_TTL_SECONDS = 30


def ensure_presence_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS creation_presence_leases (
            session_id TEXT NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            client_id TEXT NOT NULL,
            expires_at REAL NOT NULL,
            PRIMARY KEY (session_id, user_id, client_id)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_creation_presence_expiry
        ON creation_presence_leases(expires_at)
    """)
    # Older deletion paths may use connections without foreign-key enforcement.
    for table, column in (
        ("creation_sessions", "session_id"),
        ("users", "user_id"),
        ("organizations", "organization_id"),
    ):
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,),
        ).fetchone():
            conn.execute(f"""
                CREATE TRIGGER IF NOT EXISTS trg_{table}_presence_delete
                AFTER DELETE ON {table}
                BEGIN
                    DELETE FROM creation_presence_leases WHERE {column} = OLD.id;
                END
            """)


_ELIGIBLE_MEMBERS = """
    SELECT u.id, u.username, COALESCE(u.nickname, '') AS nickname,
           COALESCE(u.avatar_url, '') AS avatar_url, s.organization_id
    FROM creation_sessions s
    JOIN organizations o ON o.id = s.organization_id
    JOIN organization_memberships om ON om.organization_id = s.organization_id
    JOIN users u ON u.id = om.user_id
    WHERE s.id = ?
      AND s.organization_id = COALESCE(
          (SELECT pref.organization_id FROM user_organization_preferences pref
           JOIN organization_memberships active
             ON active.user_id = pref.user_id
            AND active.organization_id = pref.organization_id
           WHERE pref.user_id = u.id),
          (SELECT fallback.id FROM organizations fallback
           WHERE fallback.default_for_user_id = u.id), ''
      )
      AND (
          EXISTS (
              SELECT 1 FROM project_memberships pm
              JOIN content_projects p ON p.id = pm.project_id
              WHERE pm.project_id = s.project_id AND pm.user_id = u.id
                AND p.organization_id = s.organization_id
          )
          OR (s.project_id = '' AND s.user_id = u.id)
      )
"""


def get_presence(
    session_id: str, user_id: str, client_id: str | None = None,
) -> dict:
    """Read members, optionally renewing this actor's lease, in one transaction.

    Callers must first apply get_session(session_id, user_id). Eligibility is
    rechecked here under the write lock to prevent a membership-revocation race.
    """
    with closing(storage._get_conn()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        ensure_presence_schema(conn)
        now = time.time()
        eligible = conn.execute(_ELIGIBLE_MEMBERS, (session_id,)).fetchall()
        actor = next((row for row in eligible if row["id"] == user_id), None)
        if actor is None:
            raise PermissionError("Session not found")
        conn.execute("DELETE FROM creation_presence_leases WHERE expires_at <= ?", (now,))
        conn.execute(f"""
            DELETE FROM creation_presence_leases
            WHERE session_id = ? AND user_id NOT IN (
                SELECT id FROM ({_ELIGIBLE_MEMBERS})
            )
        """, (session_id, session_id))
        if client_id is not None:
            conn.execute("""
                INSERT INTO creation_presence_leases
                    (session_id, user_id, organization_id, client_id, expires_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(session_id, user_id, client_id)
                DO UPDATE SET expires_at = excluded.expires_at,
                              organization_id = excluded.organization_id
            """, (session_id, user_id, actor["organization_id"], client_id,
                  now + LEASE_TTL_SECONDS))
        rows = conn.execute(f"""
            SELECT DISTINCT member.id, member.username, member.nickname, member.avatar_url
            FROM ({_ELIGIBLE_MEMBERS}) member
            JOIN creation_presence_leases lease
              ON lease.user_id = member.id AND lease.organization_id = member.organization_id
            WHERE lease.session_id = ? AND lease.expires_at > ?
            ORDER BY member.id
        """, (session_id, session_id, now)).fetchall()
        return {"members": [dict(row) for row in rows]}


def release_presence(session_id: str, user_id: str, client_id: str) -> None:
    """Release only the actor's lease, without requiring or disclosing access."""
    with closing(storage._get_conn()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        ensure_presence_schema(conn)
        conn.execute("""
            DELETE FROM creation_presence_leases
            WHERE session_id = ? AND user_id = ? AND client_id = ?
        """, (session_id, user_id, client_id))
        conn.execute(
            "DELETE FROM creation_presence_leases WHERE expires_at <= ?", (time.time(),),
        )
