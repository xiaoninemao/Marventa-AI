from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import DB_PATH, MEDIA_ROOT
from app.database import connect_database


USER_SCOPED_TABLES = {
    "insights": "owner_id",
    "cases": "owner_id",
    "case_favorites": "user_id",
    "case_import_tasks": "owner_id",
    "creation_sessions": "user_id",
    "portfolio": "user_id",
    "content_projects": "user_id",
    "publish_tasks": "user_id",
    "publish_metrics": "user_id",
    "publish_reviews": "user_id",
    "account_memories": "user_id",
    "social_accounts": "user_id",
}


def check_storage() -> int:
    conn = connect_database(DB_PATH)
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = conn.execute("PRAGMA foreign_key_check").fetchall()
        orphan_counts: dict[str, int] = {}
        for table, user_column in USER_SCOPED_TABLES.items():
            exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()
            if not exists:
                continue
            orphan_counts[table] = conn.execute(
                f"SELECT COUNT(*) FROM {table} row "
                f"WHERE row.{user_column} != '' "
                f"AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = row.{user_column})"
            ).fetchone()[0]
        print(f"integrity={integrity}")
        print(f"foreign_key_errors={len(foreign_keys)}")
        print(f"orphan_records={sum(orphan_counts.values())}")
        for table, count in orphan_counts.items():
            if count:
                print(f"orphan:{table}={count}")
        return 0 if integrity == "ok" and not foreign_keys and not any(orphan_counts.values()) else 1
    finally:
        conn.close()


def backup_storage(output: str) -> None:
    output_path = Path(output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp_dir:
        snapshot = Path(temp_dir) / "database.sqlite"
        source = connect_database(DB_PATH)
        target = sqlite3.connect(snapshot)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        with tarfile.open(output_path, "w:gz") as archive:
            archive.add(snapshot, arcname="database.sqlite")
            media = Path(MEDIA_ROOT)
            if media.exists():
                archive.add(media, arcname="media")
            states = Path(DB_PATH).resolve().parent / "platform_storage_states"
            if states.exists():
                archive.add(states, arcname="platform_storage_states")
    os.chmod(output_path, 0o600)
    print(output_path)


def prune_audit(days: int) -> None:
    if days < 1:
        raise ValueError("days must be at least 1")
    conn = connect_database(DB_PATH)
    try:
        cursor = conn.execute(
            "DELETE FROM data_audit_log "
            "WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)",
            (f"-{days} days",),
        )
        conn.commit()
        print(f"deleted={cursor.rowcount}")
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Marventa storage administration")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("check", help="Check integrity, foreign keys, and orphan records")
    backup = subparsers.add_parser("backup", help="Create a database and media backup bundle")
    backup.add_argument(
        "--output",
        default=str(
            Path(DB_PATH).resolve().parent
            / "backups"
            / f"marventa-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.tar.gz"
        ),
    )
    prune = subparsers.add_parser("prune-audit", help="Delete expired audit records")
    prune.add_argument("--days", type=int, default=90)
    args = parser.parse_args()
    if args.command == "check":
        return check_storage()
    if args.command == "backup":
        backup_storage(args.output)
        return 0
    prune_audit(args.days)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
