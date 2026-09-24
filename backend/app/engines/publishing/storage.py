from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from app.config import DB_PATH
from app.database import connect_database
from app.engines.content_generator.models import ContentCard
from app.engines.content_generator.storage import get_session
from app.engines.publishing.models import (
    AccountMemory,
    ContentProject as ContentProject,
    PublishMetric,
    PublishReview,
    PublishTask,
    ReviewConclusion,
    SocialAccount,
)
from app.engines.publishing import project_memberships, projects
# Keep the original storage-module imports available to existing project clients.
from app.engines.publishing.project_memberships import (
    ProjectNotFound as ProjectNotFound,
    ProjectPermissionDenied as ProjectPermissionDenied,
)
from app.engines.publishing.projects import (
    PROJECT_AVATAR_COLORS as PROJECT_AVATAR_COLORS,
    PROJECT_AVATAR_ICONS,
    ProjectNameExists as ProjectNameExists,
    create_manual_project as create_manual_project,
    create_project_from_session as create_project_from_session,
    delete_project as delete_project,
    get_project,
    list_projects as list_projects,
    update_project as update_project,
)
from app.storage_schema import ensure_json_columns, ensure_organization_scope, resolve_user_organization_id


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _load_json(value: str | None, default: Any) -> Any:
    try:
        return json.loads(value or "")
    except (TypeError, json.JSONDecodeError):
        return default


def _cards_json(cards: list[ContentCard]) -> str:
    return _json([card.model_dump() for card in cards])


def _get_conn() -> sqlite3.Connection:
    return connect_database(DB_PATH)


def init_db() -> None:
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS content_projects (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            xhs_account TEXT DEFAULT '',
            source_session_id TEXT NOT NULL,
            source_card_id TEXT DEFAULT '',
            content_type TEXT DEFAULT 'mixed',
            platform_hint TEXT DEFAULT '',
            cards_snapshot TEXT DEFAULT '[]',
            final_snapshot TEXT DEFAULT '{}',
            notes TEXT DEFAULT '',
            status TEXT DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(content_projects)").fetchall()]
    if "avatar_color" not in cols:
        conn.execute(
            "ALTER TABLE content_projects ADD COLUMN avatar_color TEXT NOT NULL DEFAULT '#bfdbfe'"
        )
    if "avatar_icon" not in cols:
        conn.execute(
            "ALTER TABLE content_projects ADD COLUMN avatar_icon TEXT NOT NULL DEFAULT '💡'"
        )
    allowed_avatar_icons = ",".join("?" for _ in PROJECT_AVATAR_ICONS)
    conn.execute(
        f"UPDATE content_projects SET avatar_icon = '💡' "
        f"WHERE avatar_icon NOT IN ({allowed_avatar_icons})",
        tuple(PROJECT_AVATAR_ICONS),
    )
    conn.execute("""
        CREATE TABLE IF NOT EXISTS project_memberships (
            project_id TEXT NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
            created_at TEXT NOT NULL,
            PRIMARY KEY (project_id, user_id)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_memberships_user "
        "ON project_memberships(user_id, project_id)"
    )
    conn.execute("""
        INSERT OR IGNORE INTO project_memberships (project_id, user_id, role, created_at)
        SELECT id, user_id, 'owner', created_at
        FROM content_projects
    """)
    conn.execute("""
        UPDATE project_memberships
        SET role = 'owner'
        WHERE rowid IN (
            SELECT (
                SELECT candidate.rowid
                FROM project_memberships candidate
                WHERE candidate.project_id = project.id
                ORDER BY candidate.created_at, candidate.user_id
                LIMIT 1
            )
            FROM content_projects project
            WHERE NOT EXISTS (
                SELECT 1
                FROM project_memberships owner
                WHERE owner.project_id = project.id AND owner.role = 'owner'
            )
        )
    """)
    conn.execute("""
        WITH ranked_owners AS (
            SELECT rowid,
                   ROW_NUMBER() OVER (
                       PARTITION BY project_id
                       ORDER BY created_at, user_id
                   ) AS owner_number
            FROM project_memberships
            WHERE role = 'owner'
        )
        UPDATE project_memberships
        SET role = 'admin'
        WHERE rowid IN (
            SELECT rowid FROM ranked_owners WHERE owner_number > 1
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_memberships_single_owner
        ON project_memberships(project_id)
        WHERE role = 'owner'
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS publish_tasks (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            project_id TEXT DEFAULT '',
            source_session_id TEXT NOT NULL,
            source_card_id TEXT DEFAULT '',
            platform TEXT DEFAULT 'xiaohongshu',
            account_name TEXT DEFAULT '',
            content_type TEXT DEFAULT 'mixed',
            status TEXT DEFAULT 'pending_publish',
            selected_version_ids TEXT DEFAULT '{}',
            original_cards TEXT DEFAULT '[]',
            final_snapshot TEXT DEFAULT '{}',
            planned_publish_at TEXT DEFAULT '',
            published_at TEXT DEFAULT '',
            publish_link TEXT DEFAULT '',
            platform_work_id TEXT DEFAULT '',
            metrics TEXT DEFAULT '{}',
            review TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS publish_metrics (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            views INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0,
            collects INTEGER DEFAULT 0,
            comments INTEGER DEFAULT 0,
            shares INTEGER DEFAULT 0,
            followers INTEGER DEFAULT 0,
            leads INTEGER DEFAULT 0,
            completion_rate REAL DEFAULT 0,
            interaction_rate REAL DEFAULT 0,
            collect_rate REAL DEFAULT 0,
            raw_data TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS publish_reviews (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            summary TEXT DEFAULT '',
            success_reasons TEXT DEFAULT '[]',
            problem_reasons TEXT DEFAULT '[]',
            reusable_structures TEXT DEFAULT '[]',
            next_directions TEXT DEFAULT '[]',
            series_potential TEXT DEFAULT '',
            memory_update_suggestion TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS account_memories (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            platform TEXT DEFAULT 'xiaohongshu',
            account_name TEXT NOT NULL,
            brand_positioning TEXT DEFAULT '',
            target_users TEXT DEFAULT '',
            product_selling_points TEXT DEFAULT '',
            content_style TEXT DEFAULT '',
            banned_expressions TEXT DEFAULT '[]',
            common_tags TEXT DEFAULT '[]',
            high_performing_content TEXT DEFAULT '[]',
            low_performing_directions TEXT DEFAULT '[]',
            ai_operation_lessons TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS social_accounts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            account_name TEXT NOT NULL,
            platform_user_id TEXT DEFAULT '',
            nickname TEXT DEFAULT '',
            avatar_url TEXT DEFAULT '',
            profile_url TEXT DEFAULT '',
            account_type TEXT DEFAULT 'ordinary',
            remark TEXT DEFAULT '',
            session_dir TEXT NOT NULL,
            status TEXT DEFAULT 'authorized',
            cookie_status TEXT DEFAULT 'unknown',
            profile TEXT DEFAULT '{}',
            credential_blob TEXT DEFAULT '',
            last_checked_at TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    social_cols = [r[1] for r in conn.execute("PRAGMA table_info(social_accounts)").fetchall()]
    for col, ddl in {
        "platform_user_id": "TEXT DEFAULT ''",
        "nickname": "TEXT DEFAULT ''",
        "avatar_url": "TEXT DEFAULT ''",
        "profile_url": "TEXT DEFAULT ''",
        "account_type": "TEXT DEFAULT 'ordinary'",
        "remark": "TEXT DEFAULT ''",
        "cookie_status": "TEXT DEFAULT 'unknown'",
        "credential_blob": "TEXT DEFAULT ''",
    }.items():
        if col not in social_cols:
            conn.execute(f"ALTER TABLE social_accounts ADD COLUMN {col} {ddl}")
    for table in (
        "content_projects",
        "publish_tasks",
        "publish_metrics",
        "publish_reviews",
        "account_memories",
        "social_accounts",
    ):
        ensure_organization_scope(conn, table, "user_id")
    ensure_json_columns(
        conn, "content_projects",
        ("cards_snapshot", "final_snapshot"),
    )
    ensure_json_columns(
        conn, "publish_tasks",
        ("selected_version_ids", "original_cards", "final_snapshot", "metrics", "review"),
    )
    ensure_json_columns(conn, "publish_metrics", ("raw_data",))
    ensure_json_columns(
        conn, "publish_reviews",
        ("success_reasons", "problem_reasons", "reusable_structures", "next_directions"),
    )
    ensure_json_columns(
        conn, "account_memories",
        (
            "banned_expressions", "common_tags", "high_performing_content",
            "low_performing_directions", "ai_operation_lessons",
        ),
    )
    ensure_json_columns(conn, "social_accounts", ("profile",))
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_projects_org_user_updated "
        "ON content_projects(organization_id, user_id, updated_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_org_user_status_updated "
        "ON publish_tasks(organization_id, user_id, status, updated_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_accounts_org_platform_name "
        "ON social_accounts(organization_id, platform, account_name)"
    )
    conn.commit()
    conn.close()


def _snapshot_from_cards(cards: list[ContentCard], selected: dict[str, str] | None = None, source_title: str = "") -> dict[str, Any]:
    selected = selected or {}
    by_id = {card.id: card for card in cards}

    def pick(slot: str, card_type: str) -> ContentCard | None:
        selected_id = selected.get(slot) or selected.get(card_type)
        if selected_id and selected_id in by_id:
            return by_id[selected_id]
        return next((card for card in cards if card.card_type == card_type), None)

    title = pick("title", "title")
    body = pick("body", "copy")
    cover = pick("cover", "visual")
    tags = pick("tags", "hashtags")
    script = pick("script", "script")
    return {
        "source_title": source_title,
        "title": title.title if title else (cards[0].title if cards else ""),
        "body": body.content if body else "",
        "cover_text": cover.preview if cover else "",
        "tags": tags.content if tags else "",
        "layout": cover.content if cover else "",
        "script": script.content if script else "",
        "selected_card_ids": selected,
    }


def create_task_from_session(
    user_id: str,
    source_session_id: str,
    project_id: str = "",
    platform: str = "xiaohongshu",
    account_name: str = "",
    source_card_id: str = "",
    content_type: str = "mixed",
    selected_version_ids: dict[str, str] | None = None,
    final_snapshot: dict[str, Any] | None = None,
    planned_publish_at: str = "",
) -> PublishTask:
    init_db()
    session = get_session(source_session_id, user_id)
    if not session:
        raise ValueError("Session not found")
    if session.user_id != user_id and session.project_role not in {"owner", "admin"}:
        raise ValueError("You can only create tasks from your own sessions")
    if project_id and project_id != session.project_id:
        raise ValueError("Session does not belong to the selected project")
    project_id = project_id or session.project_id
    selected = selected_version_ids or {}
    snapshot = final_snapshot or _snapshot_from_cards(session.cards, selected, source_title=session.title)
    now = _now()
    task_id = uuid.uuid4().hex[:12]
    status = "pending_publish"
    conn = _get_conn()
    conn.execute(
        """
        INSERT INTO publish_tasks (
            id, user_id, project_id, source_session_id, source_card_id, platform,
            account_name, content_type, status, selected_version_ids, original_cards,
            final_snapshot, planned_publish_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task_id, user_id, project_id, source_session_id, source_card_id, platform,
            account_name, content_type, status, _json(selected), _cards_json(session.cards),
            _json(snapshot), planned_publish_at, now, now,
        ),
    )
    conn.commit()
    conn.close()
    return get_task(task_id)  # type: ignore[return-value]


def create_task_from_project(
    user_id: str,
    project_id: str,
    platform: str = "xiaohongshu",
    account_name: str = "",
    content_type: str = "mixed",
    selected_version_ids: dict[str, str] | None = None,
    planned_publish_at: str = "",
) -> PublishTask:
    init_db()
    project = get_project(project_id, user_id)
    if not project:
        raise ValueError("Project not found")
    now = _now()
    task_id = uuid.uuid4().hex[:12]
    selected = selected_version_ids or {}
    snapshot = dict(project.final_snapshot or {})
    conn = _get_conn()
    conn.execute(
        """
        INSERT INTO publish_tasks (
            id, user_id, project_id, source_session_id, source_card_id, platform,
            account_name, content_type, status, selected_version_ids, original_cards,
            final_snapshot, planned_publish_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task_id, user_id, project.id, project.source_session_id, project.source_card_id,
            platform or project.platform_hint or "xiaohongshu", account_name,
            content_type or project.content_type or "mixed", "pending_publish",
            _json(selected), _cards_json(project.cards_snapshot), _json(snapshot),
            planned_publish_at, now, now,
        ),
    )
    conn.commit()
    conn.close()
    return get_task(task_id)  # type: ignore[return-value]


def get_task(task_id: str, user_id: str | None = None) -> PublishTask | None:
    init_db()
    conn = _get_conn()
    if user_id is None:
        row = conn.execute("SELECT * FROM publish_tasks WHERE id = ?", (task_id,)).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, user_id)
        row = conn.execute(
            "SELECT * FROM publish_tasks WHERE id = ? AND organization_id = ?",
            (task_id, organization_id),
        ).fetchone()
    conn.close()
    return _row_to_task(row) if row else None


def update_task(task_id: str, **updates: Any) -> PublishTask | None:
    init_db()
    current = get_task(task_id)
    if not current:
        return None
    json_fields = {"selected_version_ids", "original_cards", "final_snapshot", "metrics", "review"}
    fields: list[str] = []
    values: list[Any] = []
    for key, value in updates.items():
        if value is None or not hasattr(current, key):
            continue
        fields.append(f"{key} = ?")
        values.append(_json(value) if key in json_fields else value)
    if not fields:
        return current
    fields.append("updated_at = ?")
    values.append(_now())
    values.append(task_id)
    conn = _get_conn()
    conn.execute(f"UPDATE publish_tasks SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return get_task(task_id)


def upsert_publish_metric(task_id: str, user_id: str, **fields: Any) -> PublishMetric:
    init_db()
    existing = get_publish_metric(task_id)
    views = int(fields.get("views") or 0)
    likes = int(fields.get("likes") or 0)
    collects = int(fields.get("collects") or 0)
    comments = int(fields.get("comments") or 0)
    shares = int(fields.get("shares") or 0)
    interaction_rate = (likes + collects + comments + shares) / views if views else 0
    collect_rate = collects / views if views else 0
    payload = {
        "views": views,
        "likes": likes,
        "collects": collects,
        "comments": comments,
        "shares": shares,
        "followers": int(fields.get("followers") or 0),
        "leads": int(fields.get("leads") or 0),
        "completion_rate": float(fields.get("completion_rate") or 0),
        "interaction_rate": interaction_rate,
        "collect_rate": collect_rate,
        "raw_data": fields.get("raw_data") or fields,
    }
    now = _now()
    conn = _get_conn()
    if existing:
        conn.execute(
            """
            UPDATE publish_metrics
            SET views = ?, likes = ?, collects = ?, comments = ?, shares = ?,
                followers = ?, leads = ?, completion_rate = ?, interaction_rate = ?,
                collect_rate = ?, raw_data = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                payload["views"], payload["likes"], payload["collects"], payload["comments"], payload["shares"],
                payload["followers"], payload["leads"], payload["completion_rate"], payload["interaction_rate"],
                payload["collect_rate"], _json(payload["raw_data"]), now, existing.id,
            ),
        )
    else:
        metric_id = uuid.uuid4().hex[:12]
        conn.execute(
            """
            INSERT INTO publish_metrics (
                id, task_id, user_id, views, likes, collects, comments, shares,
                followers, leads, completion_rate, interaction_rate, collect_rate,
                raw_data, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                metric_id, task_id, user_id, payload["views"], payload["likes"], payload["collects"],
                payload["comments"], payload["shares"], payload["followers"], payload["leads"],
                payload["completion_rate"], payload["interaction_rate"], payload["collect_rate"],
                _json(payload["raw_data"]), now, now,
            ),
        )
    conn.commit()
    conn.close()
    metric = get_publish_metric(task_id)
    if not metric:
        raise RuntimeError("Failed to save metric")
    return metric


def get_publish_metric(task_id: str) -> PublishMetric | None:
    init_db()
    conn = _get_conn()
    row = conn.execute("SELECT * FROM publish_metrics WHERE task_id = ? ORDER BY updated_at DESC LIMIT 1", (task_id,)).fetchone()
    conn.close()
    return _row_to_metric(row) if row else None


def save_publish_review(task_id: str, user_id: str, review: ReviewConclusion) -> PublishReview:
    init_db()
    existing = get_publish_review(task_id)
    now = _now()
    success_reasons = review.performance_reasons
    problem_reasons = review.problems
    conn = _get_conn()
    if existing:
        conn.execute(
            """
            UPDATE publish_reviews
            SET summary = ?, success_reasons = ?, problem_reasons = ?, reusable_structures = ?,
                next_directions = ?, series_potential = ?, memory_update_suggestion = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                review.summary, _json(success_reasons), _json(problem_reasons),
                _json(review.reusable_structures), _json(review.next_adjustments),
                review.series_potential, review.memory_lesson, now, existing.id,
            ),
        )
    else:
        review_id = uuid.uuid4().hex[:12]
        conn.execute(
            """
            INSERT INTO publish_reviews (
                id, task_id, user_id, summary, success_reasons, problem_reasons,
                reusable_structures, next_directions, series_potential,
                memory_update_suggestion, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                review_id, task_id, user_id, review.summary, _json(success_reasons),
                _json(problem_reasons), _json(review.reusable_structures),
                _json(review.next_adjustments), review.series_potential,
                review.memory_lesson, now, now,
            ),
        )
    conn.commit()
    conn.close()
    saved = get_publish_review(task_id)
    if not saved:
        raise RuntimeError("Failed to save review")
    return saved


def get_publish_review(task_id: str) -> PublishReview | None:
    init_db()
    conn = _get_conn()
    row = conn.execute("SELECT * FROM publish_reviews WHERE task_id = ? ORDER BY updated_at DESC LIMIT 1", (task_id,)).fetchone()
    conn.close()
    return _row_to_review(row) if row else None


def create_account_memory(
    user_id: str,
    account_name: str,
    platform: str = "xiaohongshu",
    **fields: Any,
) -> AccountMemory:
    init_db()
    memory_id = uuid.uuid4().hex[:12]
    now = _now()
    payload = {
        "brand_positioning": fields.get("brand_positioning", ""),
        "target_users": fields.get("target_users", ""),
        "product_selling_points": fields.get("product_selling_points", ""),
        "content_style": fields.get("content_style", ""),
        "banned_expressions": fields.get("banned_expressions", []),
        "common_tags": fields.get("common_tags", []),
        "high_performing_content": fields.get("high_performing_content", []),
        "low_performing_directions": fields.get("low_performing_directions", []),
        "ai_operation_lessons": fields.get("ai_operation_lessons", []),
    }
    conn = _get_conn()
    conn.execute(
        """
        INSERT INTO account_memories (
            id, user_id, platform, account_name, brand_positioning, target_users,
            product_selling_points, content_style, banned_expressions, common_tags,
            high_performing_content, low_performing_directions, ai_operation_lessons,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            memory_id, user_id, platform, account_name, payload["brand_positioning"],
            payload["target_users"], payload["product_selling_points"], payload["content_style"],
            _json(payload["banned_expressions"]), _json(payload["common_tags"]),
            _json(payload["high_performing_content"]), _json(payload["low_performing_directions"]),
            _json(payload["ai_operation_lessons"]), now, now,
        ),
    )
    conn.commit()
    conn.close()
    return get_account_memory(memory_id)  # type: ignore[return-value]


def create_social_account(
    user_id: str,
    platform: str,
    account_name: str,
    session_dir: str,
    status: str = "authorized",
    profile: dict[str, Any] | None = None,
    platform_user_id: str = "",
    nickname: str = "",
    avatar_url: str = "",
    profile_url: str = "",
    account_type: str = "ordinary",
    remark: str = "",
    cookie_status: str = "unknown",
    credential_blob: str = "",
) -> SocialAccount:
    init_db()
    now = _now()
    existing = _find_social_account_by_identity(user_id, platform, account_name, platform_user_id, profile_url)
    if existing:
        conn = _get_conn()
        conn.execute(
            """
            UPDATE social_accounts
            SET account_name = ?, platform_user_id = ?, nickname = ?, avatar_url = ?, profile_url = ?,
                account_type = ?, remark = ?, session_dir = ?, status = ?, cookie_status = ?,
                profile = ?, credential_blob = CASE WHEN ? != '' THEN ? ELSE credential_blob END,
                last_checked_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                account_name, platform_user_id, nickname, avatar_url, profile_url,
                account_type or "ordinary", remark, session_dir, status, cookie_status,
                _json(profile or {}), credential_blob, credential_blob, now, now, existing.id,
            ),
        )
        conn.commit()
        conn.close()
        return get_social_account(existing.id)  # type: ignore[return-value]

    account_id = uuid.uuid4().hex[:12]
    conn = _get_conn()
    conn.execute(
        """
        INSERT INTO social_accounts (
            id, user_id, platform, account_name, platform_user_id, nickname, avatar_url,
            profile_url, account_type, remark, session_dir, status, cookie_status, profile,
            credential_blob,
            last_checked_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            account_id, user_id, platform, account_name, platform_user_id, nickname, avatar_url,
            profile_url, account_type or "ordinary", remark, session_dir, status, cookie_status,
            _json(profile or {}), credential_blob, now, now, now,
        ),
    )
    conn.commit()
    conn.close()
    return get_social_account(account_id)  # type: ignore[return-value]


def list_social_accounts(user_id: str, platform: str = "") -> list[SocialAccount]:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    if platform:
        rows = conn.execute(
            "SELECT * FROM social_accounts WHERE organization_id = ? "
            "AND platform = ? ORDER BY updated_at DESC, id DESC LIMIT 200",
            (organization_id, platform),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM social_accounts WHERE organization_id = ? "
            "ORDER BY updated_at DESC, id DESC LIMIT 200",
            (organization_id,),
        ).fetchall()
    conn.close()
    return [_row_to_social_account(row) for row in rows]


def get_social_account(account_id: str, user_id: str | None = None) -> SocialAccount | None:
    init_db()
    conn = _get_conn()
    if user_id is None:
        row = conn.execute("SELECT * FROM social_accounts WHERE id = ?", (account_id,)).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, user_id)
        row = conn.execute(
            "SELECT * FROM social_accounts WHERE id = ? AND organization_id = ?",
            (account_id, organization_id),
        ).fetchone()
    conn.close()
    return _row_to_social_account(row) if row else None


def update_social_account(user_id: str, account_id: str, **updates: Any) -> SocialAccount:
    init_db()
    current = get_social_account(account_id, user_id)
    if not current:
        raise ValueError("Account not found")
    allowed = {
        "account_name",
        "platform_user_id",
        "nickname",
        "avatar_url",
        "profile_url",
        "account_type",
        "remark",
        "session_dir",
        "status",
        "cookie_status",
        "credential_blob",
        "last_checked_at",
    }
    fields: list[str] = []
    values: list[Any] = []
    for key, value in updates.items():
        if key == "profile" and isinstance(value, dict):
            merged = {**(current.profile or {}), **value}
            fields.append("profile = ?")
            values.append(_json(merged))
        elif key in allowed and value is not None:
            fields.append(f"{key} = ?")
            values.append(value)
    if not fields:
        return current
    fields.append("updated_at = ?")
    values.append(_now())
    values.append(account_id)
    conn = _get_conn()
    conn.execute(f"UPDATE social_accounts SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    conn.close()
    updated = get_social_account(account_id, user_id)
    if not updated:
        raise RuntimeError("Failed to update account")
    return updated


def _find_social_account_by_identity(
    user_id: str,
    platform: str,
    account_name: str,
    platform_user_id: str = "",
    profile_url: str = "",
) -> SocialAccount | None:
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    row = None
    if platform_user_id:
        row = conn.execute(
            "SELECT * FROM social_accounts WHERE organization_id = ? "
            "AND platform = ? AND platform_user_id = ? ORDER BY updated_at DESC LIMIT 1",
            (organization_id, platform, platform_user_id),
        ).fetchone()
    if not row and profile_url:
        row = conn.execute(
            "SELECT * FROM social_accounts WHERE organization_id = ? "
            "AND platform = ? AND profile_url = ? ORDER BY updated_at DESC LIMIT 1",
            (organization_id, platform, profile_url),
        ).fetchone()
    if not row:
        row = conn.execute(
            "SELECT * FROM social_accounts WHERE organization_id = ? "
            "AND platform = ? AND account_name = ? ORDER BY updated_at DESC LIMIT 1",
            (organization_id, platform, account_name),
        ).fetchone()
    conn.close()
    return _row_to_social_account(row) if row else None


def get_account_memory(memory_id: str, user_id: str | None = None) -> AccountMemory | None:
    init_db()
    conn = _get_conn()
    if user_id is None:
        row = conn.execute("SELECT * FROM account_memories WHERE id = ?", (memory_id,)).fetchone()
    else:
        organization_id = resolve_user_organization_id(conn, user_id)
        row = conn.execute(
            "SELECT * FROM account_memories WHERE id = ? AND organization_id = ?",
            (memory_id, organization_id),
        ).fetchone()
    conn.close()
    return _row_to_memory(row) if row else None


def upsert_account_memory(user_id: str, memory_id: str | None = None, **fields: Any) -> AccountMemory:
    if not memory_id:
        existing = _find_memory(user_id, fields.get("platform", "xiaohongshu"), fields.get("account_name", ""))
        if existing:
            memory_id = existing.id
    if memory_id:
        current = get_account_memory(memory_id, user_id)
        if not current:
            raise ValueError("Memory not found")
        json_fields = {"banned_expressions", "common_tags", "high_performing_content", "low_performing_directions", "ai_operation_lessons"}
        updates = []
        values = []
        for key, value in fields.items():
            if value is None or not hasattr(current, key):
                continue
            updates.append(f"{key} = ?")
            values.append(_json(value) if key in json_fields else value)
        updates.append("updated_at = ?")
        values.append(_now())
        values.append(memory_id)
        conn = _get_conn()
        conn.execute(f"UPDATE account_memories SET {', '.join(updates)} WHERE id = ?", values)
        conn.commit()
        conn.close()
        return get_account_memory(memory_id, user_id)  # type: ignore[return-value]
    return create_account_memory(user_id, **fields)


def _find_memory(user_id: str, platform: str, account_name: str) -> AccountMemory | None:
    init_db()
    conn = _get_conn()
    organization_id = resolve_user_organization_id(conn, user_id)
    row = conn.execute(
        "SELECT * FROM account_memories WHERE organization_id = ? "
        "AND platform = ? AND account_name = ? ORDER BY updated_at DESC LIMIT 1",
        (organization_id, platform, account_name),
    ).fetchone()
    conn.close()
    return _row_to_memory(row) if row else None


def generate_review_for_task(task_id: str, write_to_memory: bool = False) -> ReviewConclusion:
    task = get_task(task_id)
    if not task:
        raise ValueError("Task not found")
    metric = get_publish_metric(task_id)
    metrics = metric.model_dump() if metric else (task.metrics or {})
    views = int(metrics.get("views") or metrics.get("plays") or 0)
    likes = int(metrics.get("likes") or 0)
    collects = int(metrics.get("collects") or metrics.get("favorites") or 0)
    comments = int(metrics.get("comments") or 0)
    engagement = likes + collects + comments
    rate = engagement / views if views else 0
    title = str(task.final_snapshot.get("source_title") or task.final_snapshot.get("title") or "未命名内容")

    if rate >= 0.08:
        reason = "钩子与目标用户痛点匹配，收藏/评论说明内容具有复查和讨论价值。"
        next_step = "延续当前选题结构，扩展为同场景系列内容。"
        series = "适合扩展为系列内容"
    elif views:
        reason = "内容有基础曝光，但互动转化偏弱，需要强化首屏利益点和评论引导。"
        next_step = "下一轮优先测试更直接的标题利益点、封面文案和结尾提问。"
        series = "可小规模二次测试"
    else:
        reason = "尚未录入有效曝光数据，复盘结论以结构检查为主。"
        next_step = "发布后补充浏览、互动、涨粉和线索数据再做正式复盘。"
        series = "暂不判断"

    lesson = f"{title}: {reason} 下一轮方向：{next_step}"
    review = ReviewConclusion(
        summary=f"表现原因：{reason}",
        performance_reasons=[reason],
        reusable_structures=["痛点开场", "场景化展开", "明确互动引导"],
        problems=["需持续对比标题、正文、封面和标签版本的真实表现"],
        next_adjustments=[next_step],
        series_potential=series,
        memory_lesson=lesson,
    )
    update_task(task_id, review=review.model_dump(), status="reviewed")
    save_publish_review(task_id, task.user_id, review)

    if write_to_memory and task.account_name:
        memory = _find_memory(task.user_id, task.platform, task.account_name)
        if memory:
            lessons = [*memory.ai_operation_lessons, lesson]
            upsert_account_memory(task.user_id, memory.id, ai_operation_lessons=lessons[-30:])
        else:
            create_account_memory(
                task.user_id,
                platform=task.platform,
                account_name=task.account_name,
                ai_operation_lessons=[lesson],
            )
    return review


def _row_to_task(row: sqlite3.Row) -> PublishTask:
    cards = [ContentCard(**card) for card in _load_json(row["original_cards"], [])]
    status = row["status"] or "pending_publish"
    if status == "pending_version_selection":
        status = "pending_publish"
    elif status == "reusable":
        status = "archived"
    return PublishTask(
        id=row["id"], user_id=row["user_id"], project_id=row["project_id"] or "",
        source_session_id=row["source_session_id"], source_card_id=row["source_card_id"] or "",
        platform=row["platform"] or "xiaohongshu", account_name=row["account_name"] or "",
        content_type=row["content_type"] or "mixed", status=status,
        selected_version_ids=_load_json(row["selected_version_ids"], {}), original_cards=cards,
        final_snapshot=_load_json(row["final_snapshot"], {}), planned_publish_at=row["planned_publish_at"] or "",
        published_at=row["published_at"] or "", publish_link=row["publish_link"] or "",
        platform_work_id=row["platform_work_id"] or "", metrics=_load_json(row["metrics"], {}),
        review=_load_json(row["review"], {}), created_at=row["created_at"], updated_at=row["updated_at"],
    )


def _row_to_memory(row: sqlite3.Row) -> AccountMemory:
    return AccountMemory(
        id=row["id"], user_id=row["user_id"], platform=row["platform"] or "xiaohongshu",
        account_name=row["account_name"], brand_positioning=row["brand_positioning"] or "",
        target_users=row["target_users"] or "", product_selling_points=row["product_selling_points"] or "",
        content_style=row["content_style"] or "", banned_expressions=_load_json(row["banned_expressions"], []),
        common_tags=_load_json(row["common_tags"], []), high_performing_content=_load_json(row["high_performing_content"], []),
        low_performing_directions=_load_json(row["low_performing_directions"], []),
        ai_operation_lessons=_load_json(row["ai_operation_lessons"], []),
        created_at=row["created_at"], updated_at=row["updated_at"],
    )


def _row_to_social_account(row: sqlite3.Row) -> SocialAccount:
    return SocialAccount(
        id=row["id"], user_id=row["user_id"], platform=row["platform"],
        account_name=row["account_name"], platform_user_id=row["platform_user_id"] or "",
        nickname=row["nickname"] or "", avatar_url=row["avatar_url"] or "",
        profile_url=row["profile_url"] or "", account_type=row["account_type"] or "ordinary",
        remark=row["remark"] or "", session_dir=row["session_dir"],
        status=row["status"] or "authorized", cookie_status=row["cookie_status"] or "unknown",
        profile=_load_json(row["profile"], {}),
        last_checked_at=row["last_checked_at"] or "",
        created_at=row["created_at"], updated_at=row["updated_at"],
    )


def _row_to_metric(row: sqlite3.Row) -> PublishMetric:
    return PublishMetric(
        id=row["id"], task_id=row["task_id"], user_id=row["user_id"],
        views=row["views"] or 0, likes=row["likes"] or 0, collects=row["collects"] or 0,
        comments=row["comments"] or 0, shares=row["shares"] or 0,
        followers=row["followers"] or 0, leads=row["leads"] or 0,
        completion_rate=row["completion_rate"] or 0,
        interaction_rate=row["interaction_rate"] or 0,
        collect_rate=row["collect_rate"] or 0,
        raw_data=_load_json(row["raw_data"], {}),
        created_at=row["created_at"], updated_at=row["updated_at"],
    )


def _row_to_review(row: sqlite3.Row) -> PublishReview:
    return PublishReview(
        id=row["id"], task_id=row["task_id"], user_id=row["user_id"],
        summary=row["summary"] or "",
        success_reasons=_load_json(row["success_reasons"], []),
        problem_reasons=_load_json(row["problem_reasons"], []),
        reusable_structures=_load_json(row["reusable_structures"], []),
        next_directions=_load_json(row["next_directions"], []),
        series_potential=row["series_potential"] or "",
        memory_update_suggestion=row["memory_update_suggestion"] or "",
        created_at=row["created_at"], updated_at=row["updated_at"],
    )


project_memberships.configure(_get_conn, init_db, _now)
projects.configure(_get_conn, init_db, _now)
