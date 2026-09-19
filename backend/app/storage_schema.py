from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone


_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _identifier(value: str) -> str:
    if not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"Invalid SQLite identifier: {value}")
    return value


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone() is not None


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    table = _identifier(table)
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _record_migration(conn: sqlite3.Connection, name: str) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS storage_schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
    """)
    conn.execute(
        "INSERT OR IGNORE INTO storage_schema_migrations (name, applied_at) VALUES (?, ?)",
        (name, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")),
    )


def ensure_json_columns(
    conn: sqlite3.Connection,
    table: str,
    columns: tuple[str, ...],
) -> None:
    table = _identifier(table)
    available = _columns(conn, table)
    for column in columns:
        column = _identifier(column)
        if column not in available:
            raise RuntimeError(f"{table}.{column} does not exist")
        conn.execute(f"""
            CREATE TRIGGER IF NOT EXISTS trg_{table}_{column}_json_insert
            BEFORE INSERT ON {table}
            WHEN NEW.{column} IS NOT NULL AND json_valid(NEW.{column}) = 0
            BEGIN
                SELECT RAISE(ABORT, '{table}.{column} must contain valid JSON');
            END
        """)
        conn.execute(f"""
            CREATE TRIGGER IF NOT EXISTS trg_{table}_{column}_json_update
            BEFORE UPDATE OF {column} ON {table}
            WHEN NEW.{column} IS NOT NULL AND json_valid(NEW.{column}) = 0
            BEGIN
                SELECT RAISE(ABORT, '{table}.{column} must contain valid JSON');
            END
        """)
    _record_migration(conn, f"json-validation-v1:{table}")


def resolve_user_organization_id(conn: sqlite3.Connection, user_id: str) -> str:
    if not user_id or not all(_table_exists(conn, name) for name in (
        "organizations", "organization_memberships", "user_organization_preferences",
    )):
        return ""
    row = conn.execute("""
        SELECT p.organization_id
        FROM user_organization_preferences p
        JOIN organization_memberships m
          ON m.organization_id = p.organization_id
         AND m.user_id = p.user_id
        WHERE p.user_id = ?
        UNION ALL
        SELECT o.id
        FROM organizations o
        WHERE o.default_for_user_id = ?
        LIMIT 1
    """, (user_id, user_id)).fetchone()
    return row[0] if row else ""


def ensure_organization_scope(
    conn: sqlite3.Connection,
    table: str,
    user_column: str,
) -> None:
    table = _identifier(table)
    user_column = _identifier(user_column)
    if not _table_exists(conn, table):
        return
    if user_column not in _columns(conn, table):
        raise RuntimeError(f"{table}.{user_column} does not exist")
    if "organization_id" not in _columns(conn, table):
        conn.execute(
            f"ALTER TABLE {table} ADD COLUMN organization_id TEXT NOT NULL DEFAULT ''"
        )

    if all(_table_exists(conn, name) for name in (
        "organizations", "organization_memberships", "user_organization_preferences",
    )):
        conn.execute(f"""
            UPDATE {table}
            SET organization_id = COALESCE(
                (
                    SELECT p.organization_id
                    FROM user_organization_preferences p
                    JOIN organization_memberships m
                      ON m.organization_id = p.organization_id
                     AND m.user_id = {table}.{user_column}
                    WHERE p.user_id = {table}.{user_column}
                    LIMIT 1
                ),
                (
                    SELECT o.id
                    FROM organizations o
                    WHERE o.default_for_user_id = {table}.{user_column}
                    LIMIT 1
                ),
                ''
            )
            WHERE organization_id = ''
        """)

    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{table}_organization "
        f"ON {table}(organization_id)"
    )
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{table}_organization_user "
        f"ON {table}(organization_id, {user_column})"
    )
    if all(_table_exists(conn, name) for name in (
        "organizations", "organization_memberships", "user_organization_preferences",
    )):
        organization_expression = f"""
            COALESCE(
                (
                    SELECT p.organization_id
                    FROM user_organization_preferences p
                    JOIN organization_memberships m
                      ON m.organization_id = p.organization_id
                     AND m.user_id = NEW.{user_column}
                    WHERE p.user_id = NEW.{user_column}
                    LIMIT 1
                ),
                (
                    SELECT o.id
                    FROM organizations o
                    WHERE o.default_for_user_id = NEW.{user_column}
                    LIMIT 1
                ),
                ''
            )
        """
        conn.execute(f"""
            CREATE TRIGGER IF NOT EXISTS trg_{table}_organization_insert
            AFTER INSERT ON {table}
            WHEN NEW.organization_id = ''
            BEGIN
                UPDATE {table}
                SET organization_id = {organization_expression}
                WHERE rowid = NEW.rowid;
            END
        """)
        conn.execute(f"""
            CREATE TRIGGER IF NOT EXISTS trg_{table}_organization_user_update
            AFTER UPDATE OF {user_column} ON {table}
            WHEN NEW.{user_column} != OLD.{user_column}
            BEGIN
                UPDATE {table}
                SET organization_id = {organization_expression}
                WHERE rowid = NEW.rowid;
            END
        """)
        conn.execute(f"""
            CREATE TRIGGER IF NOT EXISTS trg_{table}_organization_validate_insert
            BEFORE INSERT ON {table}
            WHEN NEW.organization_id != ''
             AND NOT EXISTS (
                SELECT 1 FROM organizations WHERE id = NEW.organization_id
             )
            BEGIN
                SELECT RAISE(ABORT, '{table}.organization_id does not exist');
            END
        """)
        conn.execute(f"""
            CREATE TRIGGER IF NOT EXISTS trg_{table}_organization_validate_update
            BEFORE UPDATE OF organization_id ON {table}
            WHEN NEW.organization_id != ''
             AND NOT EXISTS (
                SELECT 1 FROM organizations WHERE id = NEW.organization_id
             )
            BEGIN
                SELECT RAISE(ABORT, '{table}.organization_id does not exist');
            END
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS data_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id TEXT NOT NULL DEFAULT '',
                table_name TEXT NOT NULL,
                record_id TEXT NOT NULL,
                record_owner_id TEXT NOT NULL DEFAULT '',
                action TEXT NOT NULL CHECK (action IN ('delete')),
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_data_audit_org_created
            ON data_audit_log(organization_id, created_at DESC)
        """)
        conn.execute(f"""
            CREATE TRIGGER IF NOT EXISTS trg_{table}_audit_delete
            AFTER DELETE ON {table}
            BEGIN
                INSERT INTO data_audit_log (
                    organization_id, table_name, record_id,
                    record_owner_id, action, created_at
                ) VALUES (
                    OLD.organization_id, '{table}', CAST(OLD.rowid AS TEXT),
                    CAST(OLD.{user_column} AS TEXT), 'delete',
                    strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                );
            END
        """)
    _record_migration(conn, f"organization-scope-v1:{table}")


def ensure_parent_organization_scope(
    conn: sqlite3.Connection,
    table: str,
    parent_table: str,
    parent_key: str,
    parent_id_column: str = "id",
) -> None:
    table = _identifier(table)
    parent_table = _identifier(parent_table)
    parent_key = _identifier(parent_key)
    parent_id_column = _identifier(parent_id_column)
    if not _table_exists(conn, table) or not _table_exists(conn, parent_table):
        return
    if parent_key not in _columns(conn, table):
        raise RuntimeError(f"{table}.{parent_key} does not exist")
    parent_columns = _columns(conn, parent_table)
    if parent_id_column not in parent_columns or "organization_id" not in parent_columns:
        raise RuntimeError(f"{parent_table} is not organization-scoped")
    if "organization_id" not in _columns(conn, table):
        conn.execute(
            f"ALTER TABLE {table} ADD COLUMN organization_id TEXT NOT NULL DEFAULT ''"
        )

    conn.execute(f"""
        UPDATE {table}
        SET organization_id = COALESCE(
            (
                SELECT parent.organization_id
                FROM {parent_table} parent
                WHERE parent.{parent_id_column} = {table}.{parent_key}
                LIMIT 1
            ),
            ''
        )
        WHERE organization_id = ''
    """)
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{table}_organization "
        f"ON {table}(organization_id)"
    )
    conn.execute(f"""
        CREATE TRIGGER IF NOT EXISTS trg_{table}_organization_insert
        AFTER INSERT ON {table}
        WHEN NEW.organization_id = ''
        BEGIN
            UPDATE {table}
            SET organization_id = COALESCE(
                (
                    SELECT parent.organization_id
                    FROM {parent_table} parent
                    WHERE parent.{parent_id_column} = NEW.{parent_key}
                    LIMIT 1
                ),
                ''
            )
            WHERE rowid = NEW.rowid;
        END
    """)
    _record_migration(conn, f"organization-scope-v1:{table}")
