from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from app.config import DB_PATH
from app.database import connect_database
from app.engines.market_insight.models import ParsedDocument, HistoryRecord, AIAnalysis
from app.storage_schema import ensure_json_columns, ensure_organization_scope, resolve_user_organization_id

os_imported = __import__("os")


def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def init_db() -> None:
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS insights (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            upload_time TEXT NOT NULL,
            source_type TEXT NOT NULL,
            title TEXT NOT NULL,
            raw_text TEXT NOT NULL,
            ai_model TEXT DEFAULT '',
            ai_analysis TEXT DEFAULT NULL,
            is_edited INTEGER DEFAULT 0,
            status TEXT DEFAULT 'completed'
        )
    """)
    # Migrations
    cols = [r[1] for r in conn.execute("PRAGMA table_info(insights)").fetchall()]
    if "status" not in cols:
        conn.execute("ALTER TABLE insights ADD COLUMN status TEXT DEFAULT 'completed'")
    if "owner_id" not in cols:
        conn.execute("ALTER TABLE insights ADD COLUMN owner_id TEXT DEFAULT ''")
    ensure_organization_scope(conn, "insights", "owner_id")
    ensure_json_columns(conn, "insights", ("ai_analysis",))
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_insights_org_owner_uploaded "
        "ON insights(organization_id, owner_id, upload_time DESC)"
    )
    conn.commit()
    conn.close()


def save_insight(doc: ParsedDocument, filename: str, file_size: int, owner_id: str = "", status: str = "completed") -> HistoryRecord:
    init_db()
    record_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    analysis_json = doc.ai_analysis.model_dump_json() if doc.ai_analysis else None

    conn = _get_conn()
    conn.execute(
        """INSERT INTO insights (id, filename, file_size, upload_time, source_type,
           title, raw_text, ai_model, ai_analysis, is_edited, status, owner_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)""",
        (record_id, filename, file_size, now, doc.source_type, doc.title,
         doc.raw_text, doc.ai_model, analysis_json, status, owner_id),
    )
    conn.commit()
    conn.close()

    return HistoryRecord(
        id=record_id,
        filename=filename,
        file_size=file_size,
        upload_time=now,
        source_type=doc.source_type,
        title=doc.title,
        ai_model=doc.ai_model,
        ai_analysis=doc.ai_analysis,
        is_edited=False,
        status=status,
        owner_id=owner_id,
    )


def list_history(owner_id: str, limit: int = 50, offset: int = 0, search: str = "") -> list[HistoryRecord]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, owner_id)
    params: list = []
    search_clause = ""
    if search:
        search_clause = " AND (title LIKE ? OR filename LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    params.extend([organization_id, limit, offset])
    rows = conn.execute(
        f"SELECT * FROM insights WHERE 1 = 1{search_clause} "
        "AND organization_id = ? ORDER BY upload_time DESC LIMIT ? OFFSET ?",
        params,
    ).fetchall()
    conn.close()

    return [_row_to_record(r) for r in rows]


def get_insight(record_id: str, owner_id: str | None = None) -> HistoryRecord | None:
    init_db()
    conn = _get_conn()
    if owner_id is None:
        row = conn.execute("SELECT * FROM insights WHERE id = ?", (record_id,)).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, owner_id)
        row = conn.execute(
            "SELECT * FROM insights WHERE id = ? AND organization_id = ?",
            (record_id, organization_id),
        ).fetchone()
    conn.close()
    if row is None:
        return None
    return _row_to_record(row)


def update_insight(record_id: str, analysis: AIAnalysis) -> HistoryRecord | None:
    init_db()
    analysis_json = analysis.model_dump_json()
    conn = _get_conn()
    conn.execute(
        "UPDATE insights SET ai_analysis = ?, is_edited = 1 WHERE id = ?",
        (analysis_json, record_id),
    )
    conn.commit()
    conn.close()
    return get_insight(record_id)


def update_insight_status(record_id: str, status: str, analysis: AIAnalysis | None = None) -> HistoryRecord | None:
    init_db()
    conn = _get_conn()
    if analysis is not None:
        analysis_json = analysis.model_dump_json()
        conn.execute(
            "UPDATE insights SET status = ?, ai_analysis = ? WHERE id = ?",
            (status, analysis_json, record_id),
        )
    else:
        conn.execute(
            "UPDATE insights SET status = ? WHERE id = ?",
            (status, record_id),
        )
    conn.commit()
    conn.close()
    return get_insight(record_id)


def save_manual_insight(analysis: AIAnalysis, owner_id: str = "") -> HistoryRecord:
    init_db()
    record_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    analysis_json = analysis.model_dump_json()
    product_name = analysis.product_name or "未命名"

    conn = _get_conn()
    conn.execute(
        """INSERT INTO insights (id, filename, file_size, upload_time, source_type,
           title, raw_text, ai_model, ai_analysis, is_edited, status, owner_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'completed', ?)""",
        (record_id, product_name, 0, now, "manual", product_name,
         "", "", analysis_json, owner_id),
    )
    conn.commit()
    conn.close()

    return HistoryRecord(
        id=record_id,
        filename=product_name,
        file_size=0,
        upload_time=now,
        source_type="manual",
        title=product_name,
        ai_model="",
        ai_analysis=analysis,
        is_edited=True,
        status="completed",
        owner_id=owner_id,
    )


def delete_insight(record_id: str) -> bool:
    init_db()
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM insights WHERE id = ?", (record_id,))
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def _row_to_record(row: sqlite3.Row) -> HistoryRecord:
    analysis = None
    if row["ai_analysis"]:
        try:
            analysis = AIAnalysis(**json.loads(row["ai_analysis"]))
        except (json.JSONDecodeError, TypeError):
            pass

    return HistoryRecord(
        id=row["id"],
        filename=row["filename"],
        file_size=row["file_size"],
        upload_time=row["upload_time"],
        source_type=row["source_type"],
        title=row["title"],
        ai_model=row["ai_model"] or "",
        ai_analysis=analysis,
        is_edited=bool(row["is_edited"]),
        status=row["status"] if "status" in row.keys() else "completed",
        owner_id=row["owner_id"] if "owner_id" in row.keys() else "",
    )
