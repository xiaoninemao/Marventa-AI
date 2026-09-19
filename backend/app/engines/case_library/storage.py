from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from app.config import DB_PATH
from app.database import connect_database
from app.engines.case_library.models import CaseResponse, CaseAIAnalysis
from app.storage_schema import ensure_json_columns, ensure_organization_scope, resolve_user_organization_id

os_imported = __import__("os")


def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def init_db() -> None:
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content_type TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            video_url TEXT DEFAULT '',
            image_urls TEXT DEFAULT '[]',
            tags TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        )
    """)
    # Migrations
    cols = [r[1] for r in conn.execute("PRAGMA table_info(cases)").fetchall()]
    if "owner_id" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''")
    if "is_public" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN is_public INTEGER DEFAULT 0")
    if "category" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN category TEXT DEFAULT 'agency'")
    if "ai_status" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN ai_status TEXT DEFAULT ''")
    if "ai_analysis" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN ai_analysis TEXT DEFAULT NULL")
    if "source" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN source TEXT DEFAULT ''")
    metadata_columns = {
        "platform": "TEXT DEFAULT ''",
        "industry": "TEXT DEFAULT ''",
        "scene": "TEXT DEFAULT ''",
        "original_url": "TEXT DEFAULT ''",
        "cover_url": "TEXT DEFAULT ''",
        "published_at": "TEXT DEFAULT ''",
        "popularity": "INTEGER DEFAULT 0",
        "likes": "INTEGER DEFAULT NULL",
        "favorites_count": "INTEGER DEFAULT NULL",
        "comments": "INTEGER DEFAULT NULL",
        "body": "TEXT DEFAULT ''",
        "recognition_status": "TEXT DEFAULT 'recognized'",
    }
    for name, definition in metadata_columns.items():
        if name not in cols:
            conn.execute(f"ALTER TABLE cases ADD COLUMN {name} {definition}")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS case_favorites (
            user_id TEXT NOT NULL,
            case_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, case_id)
        )
    """)
    ensure_organization_scope(conn, "cases", "owner_id")
    ensure_organization_scope(conn, "case_favorites", "user_id")
    favorite_pk = [
        row[1]
        for row in sorted(
            conn.execute("PRAGMA table_info(case_favorites)").fetchall(),
            key=lambda row: row[5],
        )
        if row[5]
    ]
    if favorite_pk != ["organization_id", "user_id", "case_id"]:
        conn.execute("ALTER TABLE case_favorites RENAME TO case_favorites_legacy")
        conn.execute("""
            CREATE TABLE case_favorites (
                organization_id TEXT NOT NULL DEFAULT '',
                user_id TEXT NOT NULL,
                case_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (organization_id, user_id, case_id)
            )
        """)
        conn.execute("""
            INSERT OR IGNORE INTO case_favorites (
                organization_id, user_id, case_id, created_at
            )
            SELECT organization_id, user_id, case_id, created_at
            FROM case_favorites_legacy
        """)
        conn.execute("DROP TABLE case_favorites_legacy")
        ensure_organization_scope(conn, "case_favorites", "user_id")
    ensure_json_columns(conn, "cases", ("image_urls", "tags", "ai_analysis"))
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cases_org_owner_created "
        "ON cases(organization_id, owner_id, created_at DESC)"
    )
    conn.commit()
    conn.close()


def create_case(
    title: str,
    content_type: str,
    description: str,
    tags: list[str],
    video_url: str,
    image_urls: list[str],
    owner_id: str = "",
    is_public: bool = False,
    category: str = "agency",
    source: str = "",
) -> CaseResponse:
    init_db()
    case_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    conn = _get_conn()
    conn.execute(
        """INSERT INTO cases (id, title, content_type, description, video_url,
           image_urls, tags, created_at, updated_at, owner_id, is_public, category, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (case_id, title, content_type, description, video_url,
         json.dumps(image_urls), json.dumps(tags), now, now, owner_id,
         1 if is_public else 0, category, source),
    )
    conn.commit()
    conn.close()

    return CaseResponse(
        id=case_id, title=title, content_type=content_type,
        category=category, description=description,
        video_url=video_url, image_urls=image_urls,
        tags=tags, owner_id=owner_id, is_public=is_public,
        source=source, created_at=now, updated_at=now,
    )


def list_public_cases(limit: int = 50, offset: int = 0, content_type: str = "", category: str = "", search: str = "") -> list[CaseResponse]:
    init_db()
    conn = _get_conn()
    conditions = ["is_public = 1"]
    params: list = []
    if content_type:
        conditions.append("content_type = ?")
        params.append(content_type)
    if category:
        conditions.append("category = ?")
        params.append(category)
    if search:
        conditions.append("(title LIKE ? OR description LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    where = " AND ".join(conditions)
    params.extend([limit, offset])
    rows = conn.execute(
        f"SELECT * FROM cases WHERE {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params,
    ).fetchall()
    conn.close()
    return [_row_to_case(r) for r in rows]


def list_user_cases(owner_id: str, limit: int = 100, offset: int = 0, search: str = "") -> list[CaseResponse]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, owner_id)
    params: list = []
    search_clause = ""
    if search:
        search_clause = " AND (title LIKE ? OR description LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    params.extend([organization_id, limit, offset])
    rows = conn.execute(
        f"SELECT * FROM cases WHERE 1 = 1{search_clause} "
        "AND organization_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params,
    ).fetchall()
    conn.close()
    return [_row_to_case(r) for r in rows]


def list_favorited_cases(user_id: str, limit: int = 100, offset: int = 0, search: str = "") -> list[CaseResponse]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    params: list = [user_id, organization_id]
    search_clause = ""
    if search:
        search_clause = " AND (c.title LIKE ? OR c.description LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    params.extend([limit, offset])
    rows = conn.execute(
        f"""SELECT c.* FROM cases c
           INNER JOIN case_favorites f ON f.case_id = c.id
           WHERE f.user_id = ? AND f.organization_id = ?
             AND c.category = 'curated'{search_clause}
           ORDER BY f.created_at DESC LIMIT ? OFFSET ?""",
        params,
    ).fetchall()
    conn.close()
    results = []
    for r in rows:
        case = _row_to_case(r)
        case.is_favorited = True
        results.append(case)
    return results


def get_case(case_id: str, user_id: str | None = None) -> CaseResponse | None:
    init_db()
    conn = _get_conn()
    if user_id is None:
        row = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, user_id)
        row = conn.execute(
            "SELECT * FROM cases WHERE id = ? AND "
            "(is_public = 1 OR organization_id = ?)",
            (case_id, organization_id),
        ).fetchone()
    conn.close()
    if row is None:
        return None
    return _row_to_case(row)


def list_all_cases(limit: int = 100, offset: int = 0) -> list[CaseResponse]:
    """List all cases for admin."""
    init_db()
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM cases ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    conn.close()
    return [_row_to_case(r) for r in rows]


def update_case(case_id: str, **kwargs) -> CaseResponse | None:
    init_db()
    existing = get_case(case_id)
    if existing is None:
        return None

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    fields = []
    values = []

    for key, val in kwargs.items():
        if val is not None and hasattr(existing, key):
            if key in ("tags", "image_urls") and isinstance(val, list):
                fields.append(f"{key} = ?")
                values.append(json.dumps(val))
            elif key == "is_public":
                fields.append("is_public = ?")
                values.append(1 if val else 0)
            else:
                fields.append(f"{key} = ?")
                values.append(val)

    if not fields:
        return existing

    fields.append("updated_at = ?")
    values.append(now)
    values.append(case_id)

    conn = _get_conn()
    conn.execute(
        f"UPDATE cases SET {', '.join(fields)} WHERE id = ?",
        values,
    )
    conn.commit()
    conn.close()
    return get_case(case_id)


def delete_case(case_id: str) -> bool:
    init_db()
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM cases WHERE id = ?", (case_id,))
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def update_case_ai(case_id: str, status: str, analysis: CaseAIAnalysis | None = None) -> CaseResponse | None:
    init_db()
    conn = _get_conn()
    if analysis:
        analysis_json = analysis.model_dump_json()
        conn.execute(
            "UPDATE cases SET ai_status = ?, ai_analysis = ? WHERE id = ?",
            (status, analysis_json, case_id),
        )
    else:
        conn.execute(
            "UPDATE cases SET ai_status = ? WHERE id = ?",
            (status, case_id),
        )
    conn.commit()
    conn.close()
    return get_case(case_id)


def _row_to_case(row: sqlite3.Row) -> CaseResponse:
    try:
        image_urls = json.loads(row["image_urls"])
    except (json.JSONDecodeError, TypeError):
        image_urls = []

    try:
        tags = json.loads(row["tags"])
    except (json.JSONDecodeError, TypeError):
        tags = []

    is_public = bool(row["is_public"]) if "is_public" in row.keys() else False
    owner_id = row["owner_id"] if "owner_id" in row.keys() else ""
    category = row["category"] if "category" in row.keys() else "agency"
    source = row["source"] if "source" in row.keys() else ""
    ai_status = row["ai_status"] if "ai_status" in row.keys() else ""

    ai_analysis = None
    if "ai_analysis" in row.keys() and row["ai_analysis"]:
        try:
            ai_analysis = CaseAIAnalysis(**json.loads(row["ai_analysis"]))
        except (json.JSONDecodeError, TypeError):
            pass

    return CaseResponse(
        id=row["id"],
        title=row["title"],
        content_type=row["content_type"],
        category=category,
        description=row["description"] or "",
        video_url=row["video_url"] or "",
        image_urls=image_urls,
        tags=tags,
        owner_id=owner_id,
        is_public=is_public,
        source=source,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        ai_status=ai_status,
        ai_analysis=ai_analysis,
        platform=row["platform"] if "platform" in row.keys() else "",
        industry=row["industry"] if "industry" in row.keys() else "",
        scene=row["scene"] if "scene" in row.keys() else "",
        original_url=row["original_url"] if "original_url" in row.keys() else "",
        cover_url=row["cover_url"] if "cover_url" in row.keys() else "",
        published_at=row["published_at"] if "published_at" in row.keys() else "",
        popularity=int(row["popularity"] or 0) if "popularity" in row.keys() else 0,
        likes=row["likes"] if "likes" in row.keys() else None,
        favorites_count=row["favorites_count"] if "favorites_count" in row.keys() else None,
        comments=row["comments"] if "comments" in row.keys() else None,
        body=row["body"] if "body" in row.keys() else row["description"] or "",
        recognition_status=row["recognition_status"] if "recognition_status" in row.keys() else "recognized",
    )
