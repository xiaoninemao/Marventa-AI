from __future__ import annotations

import sqlite3
import uuid
import logging
import re
from contextlib import closing
from datetime import datetime, timezone
from app.config import DB_PATH
from app.database import connect_database

os_imported = __import__("os")
logger = logging.getLogger(__name__)


class OrganizationNotFound(LookupError):
    pass


class OrganizationPermissionDenied(PermissionError):
    pass


class OrganizationMemberNotFound(LookupError):
    pass


class OrganizationMembershipExists(ValueError):
    pass


def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def init_users_db() -> None:
    with closing(_get_conn()) as conn, conn:
        # Serialize schema changes and backfills across concurrent sign-ins.
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL,
                nickname TEXT DEFAULT '',
                avatar_url TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "role" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS organizations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                owner_id TEXT NOT NULL REFERENCES users(id),
                default_for_user_id TEXT UNIQUE REFERENCES users(id),
                name_is_custom INTEGER NOT NULL DEFAULT 0 CHECK (name_is_custom IN (0, 1)),
                created_at TEXT NOT NULL,
                CHECK (default_for_user_id IS NULL OR default_for_user_id = owner_id)
            )
        """)
        organization_cols = [r[1] for r in conn.execute("PRAGMA table_info(organizations)").fetchall()]
        if "name_is_custom" not in organization_cols:
            conn.execute("ALTER TABLE organizations ADD COLUMN name_is_custom INTEGER NOT NULL DEFAULT 0")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS organization_memberships (
                organization_id TEXT NOT NULL REFERENCES organizations(id),
                user_id TEXT NOT NULL REFERENCES users(id),
                role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
                created_at TEXT NOT NULL,
                PRIMARY KEY (organization_id, user_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON organization_memberships(user_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_organization_preferences (
                user_id TEXT PRIMARY KEY REFERENCES users(id),
                organization_id TEXT NOT NULL REFERENCES organizations(id),
                updated_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS auth_schema_migrations (
                name TEXT PRIMARY KEY, applied_at TEXT NOT NULL
            )
        """)
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        migration = "default-organization-name-v2"
        if not conn.execute("SELECT 1 FROM auth_schema_migrations WHERE name = ?", (migration,)).fetchone():
            conn.execute(
                "UPDATE organizations SET name = '我的组织' "
                "WHERE default_for_user_id IS NOT NULL AND name = '默认组织'",
            )
            conn.execute("INSERT INTO auth_schema_migrations VALUES (?, ?)", (migration, now))
        migration = "email-prefix-organization-name-v3"
        if not conn.execute("SELECT 1 FROM auth_schema_migrations WHERE name = ?", (migration,)).fetchone():
            conn.execute("""
                UPDATE organizations
                SET name = (
                    SELECT
                        CASE
                            WHEN instr(trim(u.email), '@') > 1
                            THEN substr(lower(trim(u.email)), 1, instr(trim(u.email), '@') - 1)
                            ELSE u.username
                        END || '的组织'
                    FROM users u
                    WHERE u.id = organizations.default_for_user_id
                )
                WHERE default_for_user_id IS NOT NULL
                  AND name_is_custom = 0
                  AND name IN ('我的组织', '默认组织')
            """)
            conn.execute("INSERT INTO auth_schema_migrations VALUES (?, ?)", (migration, now))
        missing = conn.execute("""
            SELECT u.id FROM users u
            LEFT JOIN organizations o ON o.default_for_user_id = u.id
            LEFT JOIN organization_memberships m ON m.organization_id = o.id AND m.user_id = u.id
            LEFT JOIN user_organization_preferences p ON p.user_id = u.id
            LEFT JOIN organization_memberships active ON active.organization_id = p.organization_id AND active.user_id = u.id
            WHERE o.id IS NULL OR m.user_id IS NULL OR p.user_id IS NULL OR active.user_id IS NULL
        """).fetchall()
        for user in missing:
            _ensure_default_organization(conn, user["id"], now)


def _ensure_default_organization(conn: sqlite3.Connection, user_id: str, now: str) -> str:
    existing = conn.execute(
        "SELECT id FROM organizations WHERE default_for_user_id = ?", (user_id,),
    ).fetchone()
    if existing:
        organization_id = existing["id"]
    else:
        organization_id = uuid.uuid4().hex[:16]
        user = conn.execute(
            "SELECT username, email FROM users WHERE id = ?", (user_id,),
        ).fetchone()
        if user is None:
            raise RuntimeError("Default organization user could not be retrieved")
        identity = user["email"].strip().lower().split("@", 1)[0] if "@" in user["email"] else user["username"]
        conn.execute(
            "INSERT INTO organizations (id, name, owner_id, default_for_user_id, name_is_custom, created_at) "
            "VALUES (?, ?, ?, ?, 0, ?)",
            (organization_id, f"{identity}的组织", user_id, user_id, now),
        )
    conn.execute(
        "INSERT INTO organization_memberships (organization_id, user_id, role, created_at) "
        "VALUES (?, ?, 'owner', ?) ON CONFLICT(organization_id, user_id) DO NOTHING",
        (organization_id, user_id, now),
    )
    preference = conn.execute("""
        SELECT p.organization_id, m.user_id AS member_id
        FROM user_organization_preferences p
        LEFT JOIN organization_memberships m ON m.organization_id = p.organization_id AND m.user_id = p.user_id
        WHERE p.user_id = ?
    """, (user_id,)).fetchone()
    if preference is None:
        conn.execute("INSERT INTO user_organization_preferences VALUES (?, ?, ?)", (user_id, organization_id, now))
    elif preference["member_id"] is None:
        logger.warning("Restoring default organization after membership loss for user %s", user_id)
        conn.execute(
            "UPDATE user_organization_preferences SET organization_id = ?, updated_at = ? WHERE user_id = ?",
            (organization_id, now, user_id),
        )
    return organization_id


def get_default_organization(user_id: str) -> sqlite3.Row | None:
    init_users_db()
    with closing(_get_conn()) as conn:
        return conn.execute("""
            SELECT o.id, o.name, m.role,
                   COALESCE(o.default_for_user_id IS NOT NULL AND o.name_is_custom = 0, 0) AS uses_default_name
            FROM organizations o
            JOIN organization_memberships m ON m.organization_id = o.id AND m.user_id = ?
            WHERE o.default_for_user_id = ?
        """, (user_id, user_id)).fetchone()


def _organization_details(conn: sqlite3.Connection, user_id: str, organization_id: str) -> sqlite3.Row | None:
    return conn.execute("""
        SELECT o.id, o.name, o.created_at, m.role,
               COALESCE(o.default_for_user_id = ?, 0) AS is_default,
               COALESCE(o.default_for_user_id IS NOT NULL AND o.name_is_custom = 0, 0) AS uses_default_name,
               (SELECT COUNT(*) FROM organization_memberships members WHERE members.organization_id = o.id) AS member_count
        FROM organizations o
        JOIN organization_memberships m ON m.organization_id = o.id AND m.user_id = ?
        WHERE o.id = ?
    """, (user_id, user_id, organization_id)).fetchone()


def get_current_organization(user_id: str) -> sqlite3.Row | None:
    init_users_db()
    with closing(_get_conn()) as conn:
        preference = conn.execute(
            "SELECT organization_id FROM user_organization_preferences WHERE user_id = ?", (user_id,),
        ).fetchone()
        return _organization_details(conn, user_id, preference["organization_id"]) if preference else None


def list_organizations(user_id: str) -> list[sqlite3.Row]:
    init_users_db()
    with closing(_get_conn()) as conn:
        return conn.execute("""
            SELECT o.id, o.name, o.created_at, m.role,
                   COALESCE(o.default_for_user_id = ?, 0) AS is_default,
                   COALESCE(o.default_for_user_id IS NOT NULL AND o.name_is_custom = 0, 0) AS uses_default_name,
                   (SELECT COUNT(*) FROM organization_memberships members WHERE members.organization_id = o.id) AS member_count
            FROM organizations o
            JOIN organization_memberships m ON m.organization_id = o.id AND m.user_id = ?
            ORDER BY is_default DESC, o.created_at ASC, o.id ASC
        """, (user_id, user_id)).fetchall()


def get_organization(user_id: str, organization_id: str) -> sqlite3.Row:
    init_users_db()
    with closing(_get_conn()) as conn:
        organization = _organization_details(conn, user_id, organization_id)
        if organization is None:
            raise OrganizationNotFound("Organization not found")
        return organization


def list_organization_members(user_id: str, organization_id: str) -> list[sqlite3.Row]:
    init_users_db()
    with closing(_get_conn()) as conn:
        if _organization_details(conn, user_id, organization_id) is None:
            raise OrganizationNotFound("Organization not found")
        return conn.execute("""
            SELECT u.id AS user_id, u.username, u.nickname, m.role, m.created_at AS joined_at
            FROM organization_memberships m
            JOIN users u ON u.id = m.user_id
            WHERE m.organization_id = ?
            ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                     lower(u.nickname), lower(u.username), u.id
        """, (organization_id,)).fetchall()


def _organization_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise ValueError("Organization name is required")
    if len(name) > 80:
        raise ValueError("Organization name must be at most 80 characters")
    return name


def normalize_email(email: str) -> str:
    email = email.strip().lower()
    if not email:
        raise ValueError("Email is required")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise ValueError("A valid email is required")
    return email


def create_organization(user_id: str, name: str) -> sqlite3.Row:
    name = _organization_name(name)
    init_users_db()
    organization_id = uuid.uuid4().hex[:16]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with closing(_get_conn()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "INSERT INTO organizations (id, name, owner_id, name_is_custom, created_at) VALUES (?, ?, ?, 1, ?)",
            (organization_id, name, user_id, now),
        )
        conn.execute("INSERT INTO organization_memberships VALUES (?, ?, 'owner', ?)", (organization_id, user_id, now))
        result = _organization_details(conn, user_id, organization_id)
        if result is None:
            raise RuntimeError("Created organization could not be retrieved")
        return result


def rename_organization(user_id: str, organization_id: str, name: str) -> sqlite3.Row:
    name = _organization_name(name)
    init_users_db()
    with closing(_get_conn()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        organization = _organization_details(conn, user_id, organization_id)
        if organization is None:
            raise OrganizationNotFound("Organization not found")
        if organization["role"] != "owner":
            raise OrganizationPermissionDenied("Only organization owners can rename organizations")
        conn.execute(
            "UPDATE organizations SET name = ?, name_is_custom = 1 WHERE id = ?",
            (name, organization_id),
        )
        result = _organization_details(conn, user_id, organization_id)
        if result is None:
            raise RuntimeError("Updated organization could not be retrieved")
        return result


def _organization_owner_access(
    conn: sqlite3.Connection, user_id: str, organization_id: str,
) -> sqlite3.Row:
    organization = _organization_details(conn, user_id, organization_id)
    if organization is None:
        raise OrganizationNotFound("Organization not found")
    if organization["role"] != "owner":
        raise OrganizationPermissionDenied("Only organization owners can manage members")
    return organization


def invite_organization_member(
    user_id: str, organization_id: str, email: str, role: str,
) -> sqlite3.Row:
    email = normalize_email(email)
    if role not in {"admin", "member"}:
        raise ValueError("Member role must be admin or member")
    init_users_db()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with closing(_get_conn()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        _organization_owner_access(conn, user_id, organization_id)
        invited_user = conn.execute(
            "SELECT id FROM users WHERE lower(email) = ?",
            (email,),
        ).fetchone()
        if invited_user is None:
            raise OrganizationMemberNotFound("User not found")
        existing = conn.execute(
            "SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ?",
            (organization_id, invited_user["id"]),
        ).fetchone()
        if existing:
            raise OrganizationMembershipExists("User is already an organization member")
        conn.execute(
            "INSERT INTO organization_memberships VALUES (?, ?, ?, ?)",
            (organization_id, invited_user["id"], role, now),
        )
        return conn.execute("""
            SELECT u.id AS user_id, u.username, u.nickname, m.role, m.created_at AS joined_at
            FROM organization_memberships m
            JOIN users u ON u.id = m.user_id
            WHERE m.organization_id = ? AND m.user_id = ?
        """, (organization_id, invited_user["id"])).fetchone()


def update_organization_member_role(
    user_id: str, organization_id: str, member_user_id: str, role: str,
) -> sqlite3.Row:
    if role not in {"admin", "member"}:
        raise ValueError("Member role must be admin or member")
    init_users_db()
    with closing(_get_conn()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        _organization_owner_access(conn, user_id, organization_id)
        member = conn.execute("""
            SELECT m.role, o.owner_id
            FROM organization_memberships m
            JOIN organizations o ON o.id = m.organization_id
            WHERE m.organization_id = ? AND m.user_id = ?
        """, (organization_id, member_user_id)).fetchone()
        if member is None:
            raise OrganizationMemberNotFound("Organization member not found")
        if member["owner_id"] == member_user_id or member["role"] == "owner":
            raise OrganizationPermissionDenied("The organization owner's role cannot be changed")
        conn.execute(
            "UPDATE organization_memberships SET role = ? WHERE organization_id = ? AND user_id = ?",
            (role, organization_id, member_user_id),
        )
        return conn.execute("""
            SELECT u.id AS user_id, u.username, u.nickname, m.role, m.created_at AS joined_at
            FROM organization_memberships m
            JOIN users u ON u.id = m.user_id
            WHERE m.organization_id = ? AND m.user_id = ?
        """, (organization_id, member_user_id)).fetchone()


def switch_organization(user_id: str, organization_id: str) -> sqlite3.Row:
    init_users_db()
    with closing(_get_conn()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        organization = _organization_details(conn, user_id, organization_id)
        if organization is None:
            raise OrganizationNotFound("Organization not found")
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("""
            INSERT INTO user_organization_preferences VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET organization_id = excluded.organization_id, updated_at = excluded.updated_at
        """, (user_id, organization_id, now))
        return organization


def create_user(username: str, email: str, password_hash: str, nickname: str = "") -> sqlite3.Row:
    init_users_db()
    user_id = uuid.uuid4().hex[:16]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    username = username.strip()
    email = email.strip().lower()
    nickname = nickname.strip() or username

    with closing(_get_conn()) as conn, conn:
        conn.execute(
            "INSERT INTO users (id, username, email, password_hash, nickname, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, username, email, password_hash, nickname, now),
        )
        _ensure_default_organization(conn, user_id, now)
    return get_user_by_id(user_id)


def create_email_user(email: str, password_hash: str, nickname: str = "") -> sqlite3.Row:
    email = normalize_email(email)
    init_users_db()
    user_id = uuid.uuid4().hex[:16]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    local_part = email.split("@", 1)[0]
    username_base = re.sub(r"[^a-z0-9._-]+", "-", local_part).strip("._-")[:40] or "user"

    with closing(_get_conn()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM users WHERE lower(email) = ?", (email,)).fetchone():
            raise ValueError("Email is already registered")
        username = username_base
        suffix = 2
        while conn.execute("SELECT 1 FROM users WHERE lower(username) = ?", (username,)).fetchone():
            username = f"{username_base[:35]}-{suffix}"
            suffix += 1
        conn.execute(
            "INSERT INTO users (id, username, email, password_hash, nickname, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, username, email, password_hash, nickname.strip() or local_part, now),
        )
        _ensure_default_organization(conn, user_id, now)
    return get_user_by_id(user_id)


def get_user_by_login(login: str) -> sqlite3.Row | None:
    init_users_db()
    login = login.strip().lower()
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ?",
        (login, login),
    ).fetchone()
    conn.close()
    return row


def get_user_by_email(email: str) -> sqlite3.Row | None:
    init_users_db()
    email = email.strip().lower()
    conn = _get_conn()
    row = conn.execute("SELECT * FROM users WHERE lower(email) = ?", (email,)).fetchone()
    conn.close()
    return row


def get_user_by_id(user_id: str) -> sqlite3.Row | None:
    init_users_db()
    conn = _get_conn()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return row


def update_user(user_id: str, **kwargs) -> sqlite3.Row | None:
    init_users_db()
    allowed = {"nickname", "avatar_url", "password_hash"}
    updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if not updates:
        return get_user_by_id(user_id)

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [user_id]

    conn = _get_conn()
    conn.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return get_user_by_id(user_id)


def is_admin(user_id: str) -> bool:
    init_users_db()
    conn = _get_conn()
    row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return row is not None and row["role"] == "admin"


def set_user_role(username: str, role: str) -> bool:
    init_users_db()
    conn = _get_conn()
    conn.execute("UPDATE users SET role = ? WHERE username = ?", (role, username))
    conn.commit()
    affected = conn.total_changes > 0
    conn.close()
    return affected
