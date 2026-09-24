from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from app.config import DB_PATH
from app.database import connect_database
from app.engines.case_library.models import CaseResponse, CaseAIAnalysis
from app.storage_schema import (
    ensure_json_columns,
    ensure_organization_scope,
    ensure_project_scope,
    resolve_user_organization_id,
)

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
    if "ai_status" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN ai_status TEXT DEFAULT ''")
    if "ai_analysis" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN ai_analysis TEXT DEFAULT NULL")
    if "ai_analyzed_at" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN ai_analyzed_at TEXT DEFAULT ''")
    if "source" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN source TEXT DEFAULT ''")
    if "project_id" not in cols:
        conn.execute("ALTER TABLE cases ADD COLUMN project_id TEXT NOT NULL DEFAULT ''")
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
    if all(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,),
    ).fetchone() for table in ("content_projects", "project_memberships")):
        conn.execute("""
            UPDATE cases
            SET project_id = COALESCE((
                SELECT pm.project_id
                FROM project_memberships pm
                JOIN content_projects p ON p.id = pm.project_id
                WHERE pm.user_id = cases.owner_id
                  AND p.organization_id = cases.organization_id
                ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                         pm.created_at, pm.project_id
                LIMIT 1
            ), '')
            WHERE project_id = '' AND EXISTS (
                SELECT 1 FROM project_memberships pm
                JOIN content_projects p ON p.id = pm.project_id
                WHERE pm.user_id = cases.owner_id
                  AND p.organization_id = cases.organization_id
            )
        """)
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
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cases_project_created "
        "ON cases(project_id, created_at DESC)"
    )
    ensure_project_scope(conn, "cases")
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
    source: str = "",
    project_id: str = "",
) -> CaseResponse:
    init_db()
    case_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    conn = _get_conn()
    project_title = ""
    project_role = "member"
    organization_id = resolve_user_organization_id(conn, owner_id) if owner_id else ""
    if project_id:
        access = conn.execute("""
            SELECT p.title, pm.role
            FROM content_projects p
            JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
            WHERE p.id = ? AND p.organization_id = ?
        """, (owner_id, project_id, organization_id)).fetchone()
        if access is None:
            conn.close()
            raise ValueError("Project not found or access denied")
        project_title = access["title"]
        project_role = access["role"]
    elif conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'content_projects'",
    ).fetchone():
        conn.close()
        raise ValueError("Project is required")
    conn.execute(
        """INSERT INTO cases (id, title, content_type, description, video_url,
           image_urls, tags, created_at, updated_at, owner_id, source,
           project_id, organization_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (case_id, title, content_type, description, video_url,
         json.dumps(image_urls), json.dumps(tags), now, now, owner_id,
         source, project_id, organization_id),
    )
    conn.commit()
    conn.close()

    return CaseResponse(
        id=case_id, title=title, content_type=content_type,
        description=description,
        video_url=video_url, image_urls=image_urls,
        tags=tags, owner_id=owner_id,
        organization_id=organization_id,
        source=source, project_id=project_id, project_title=project_title,
        project_role=project_role, created_at=now, updated_at=now,
    )


def list_user_cases(
    owner_id: str, limit: int = 100, offset: int = 0,
    search: str = "", project_id: str = "", content_type: str = "",
) -> list[CaseResponse]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, owner_id)
    if not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_memberships'",
    ).fetchone():
        params: list = []
        search_clause = ""
        if search:
            search_clause = " AND (title LIKE ? OR description LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])
        if content_type:
            search_clause += " AND content_type = ?"
            params.append(content_type)
        if project_id:
            search_clause += " AND project_id = ?"
            params.append(project_id)
        params.extend([organization_id, limit, offset])
        rows = conn.execute(
            f"SELECT * FROM cases WHERE 1 = 1{search_clause} "
            "AND organization_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params,
        ).fetchall()
        conn.close()
        return [_row_to_case(row) for row in rows]
    params: list = [owner_id]
    search_clause = ""
    if search:
        search_clause = " AND (title LIKE ? OR description LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    if content_type:
        search_clause += " AND c.content_type = ?"
        params.append(content_type)
    project_clause = " AND c.project_id = ?" if project_id else ""
    if project_id:
        params.append(project_id)
    params.extend([organization_id, limit, offset])
    rows = conn.execute(
        "SELECT c.*, p.title AS project_title, pm.role AS project_role, 1 AS is_project_member, "
        "COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name "
        "FROM cases c "
        "JOIN content_projects p ON p.id = c.project_id "
        "JOIN project_memberships pm ON pm.project_id = c.project_id AND pm.user_id = ? "
        "LEFT JOIN users creator ON creator.id = c.owner_id "
        f"WHERE 1 = 1{search_clause}{project_clause} "
        "AND c.organization_id = ? ORDER BY c.created_at DESC LIMIT ? OFFSET ?",
        params,
    ).fetchall()
    conn.close()
    return [_row_to_case(r) for r in rows]


def list_favorited_cases(user_id: str, limit: int = 100, offset: int = 0, search: str = "") -> list[CaseResponse]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    params: list = [organization_id, user_id, organization_id]
    search_clause = ""
    if search:
        search_clause = " AND (c.title LIKE ? OR c.description LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    params.extend([organization_id, limit, offset])
    rows = conn.execute(
        f"""SELECT c.*, p.title AS project_title, pm.role AS project_role,
                   COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name,
                   (c.organization_id = ? AND pm.user_id IS NOT NULL) AS is_project_member
           FROM case_favorites f
           INNER JOIN cases c ON c.id = f.case_id
           LEFT JOIN users creator ON creator.id = c.owner_id
           LEFT JOIN content_projects p ON p.id = c.project_id
           LEFT JOIN project_memberships pm
             ON pm.project_id = c.project_id AND pm.user_id = f.user_id
             AND c.organization_id = f.organization_id
           WHERE f.user_id = ? AND f.organization_id = ?
             {search_clause}
             AND c.organization_id = ? AND pm.user_id IS NOT NULL
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
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_memberships'",
        ).fetchone():
            row = conn.execute("""
                SELECT c.*, p.title AS project_title, pm.role AS project_role,
                       COALESCE(NULLIF(creator.nickname, ''), creator.username, '') AS creator_name,
                       (c.organization_id = ? AND pm.user_id IS NOT NULL) AS is_project_member
                FROM cases c
                LEFT JOIN users creator ON creator.id = c.owner_id
                LEFT JOIN content_projects p ON p.id = c.project_id
                LEFT JOIN project_memberships pm
                  ON pm.project_id = c.project_id AND pm.user_id = ?
                  AND c.organization_id = ?
                WHERE c.id = ? AND c.organization_id = ? AND pm.user_id IS NOT NULL
            """, (organization_id, user_id, organization_id, case_id, organization_id)).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM cases WHERE id = ? AND "
                "organization_id = ?",
                (case_id, organization_id),
            ).fetchone()
    conn.close()
    if row is None:
        return None
    return _row_to_case(row)


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
        analyzed_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "UPDATE cases SET ai_status = ?, ai_analysis = ?, ai_analyzed_at = ? WHERE id = ?",
            (status, analysis_json, analyzed_at, case_id),
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

    owner_id = row["owner_id"] if "owner_id" in row.keys() else ""
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
        description=row["description"] or "",
        video_url=row["video_url"] or "",
        image_urls=image_urls,
        tags=tags,
        owner_id=owner_id,
        creator_name=row["creator_name"] if "creator_name" in row.keys() else "",
        organization_id=row["organization_id"] if "organization_id" in row.keys() else "",
        project_id=row["project_id"] if "project_id" in row.keys() else "",
        project_title=row["project_title"] if "project_title" in row.keys() else "",
        project_role=row["project_role"] if "project_role" in row.keys() and row["project_role"] else "member",
        is_project_member=bool(row["is_project_member"]) if "is_project_member" in row.keys() else False,
        source=source,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        ai_status=ai_status,
        ai_analysis=ai_analysis,
        ai_analyzed_at=row["ai_analyzed_at"] if "ai_analyzed_at" in row.keys() else "",
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
