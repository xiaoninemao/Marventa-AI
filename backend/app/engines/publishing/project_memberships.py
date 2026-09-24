from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from typing import Callable

from app.config import DB_PATH
from app.database import connect_database
from app.engines.publishing.models import ContentProject, ProjectMember
from app.storage_schema import resolve_user_organization_id


class ProjectNotFound(LookupError):
    pass


class ProjectPermissionDenied(PermissionError):
    pass


class ProjectMemberNotFound(LookupError):
    pass


class ProjectMembershipExists(ValueError):
    pass


class ProjectOrganizationMembershipRequired(ValueError):
    pass


_connection_factory: Callable[[], sqlite3.Connection] = lambda: connect_database(DB_PATH)
_schema_initializer: Callable[[], None] = lambda: None
_clock: Callable[[], str] = lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def configure(
    connection_factory: Callable[[], sqlite3.Connection],
    schema_initializer: Callable[[], None],
    clock: Callable[[], str],
) -> None:
    global _connection_factory, _schema_initializer, _clock
    _connection_factory = connection_factory
    _schema_initializer = schema_initializer
    _clock = clock


def attach_project_members(
    conn: sqlite3.Connection,
    projects: list[ContentProject],
) -> None:
    if not projects or not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'",
    ).fetchone():
        return
    project_ids = [project.id for project in projects]
    placeholders = ",".join("?" for _ in project_ids)
    rows = conn.execute(f"""
        SELECT pm.project_id, u.id AS user_id, u.username, u.email, u.nickname,
               u.avatar_url, pm.role, pm.created_at AS joined_at
        FROM project_memberships pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id IN ({placeholders})
        ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                 pm.created_at, u.id
    """, project_ids).fetchall()
    members_by_project: dict[str, list[dict]] = {
        project_id: [] for project_id in project_ids
    }
    for row in rows:
        members_by_project[row["project_id"]].append(dict(row))
    for project in projects:
        project.members = [
            ProjectMember(**member) for member in members_by_project[project.id]
        ]
        project.member_count = len(project.members)


def project_manager_access(
    conn: sqlite3.Connection, user_id: str, project_id: str,
) -> sqlite3.Row:
    organization_id = resolve_user_organization_id(conn, user_id)
    access = conn.execute("""
        SELECT p.id, p.organization_id, p.user_id, p.title, pm.role
        FROM content_projects p
        JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
        WHERE p.id = ? AND p.organization_id = ?
    """, (user_id, project_id, organization_id)).fetchone()
    if access is None:
        raise ProjectNotFound("Project not found")
    if access["role"] not in {"owner", "admin"}:
        raise ProjectPermissionDenied("Only project owners and administrators can manage members")
    return access


def list_project_members(user_id: str, project_id: str) -> list[sqlite3.Row]:
    _schema_initializer()
    with closing(_connection_factory()) as conn:
        organization_id = resolve_user_organization_id(conn, user_id)
        access = conn.execute("""
            SELECT 1 FROM content_projects p
            JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
            WHERE p.id = ? AND p.organization_id = ?
        """, (user_id, project_id, organization_id)).fetchone()
        if access is None:
            raise ProjectNotFound("Project not found")
        return conn.execute("""
            SELECT u.id AS user_id, u.username, u.email, u.nickname, u.avatar_url,
                   pm.role, pm.created_at AS joined_at
            FROM project_memberships pm
            JOIN users u ON u.id = pm.user_id
            WHERE pm.project_id = ?
            ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                     lower(u.nickname), lower(u.username), u.id
        """, (project_id,)).fetchall()


def invite_project_member(
    user_id: str, project_id: str, email: str, role: str,
) -> sqlite3.Row:
    email = email.strip().lower()
    if not email:
        raise ValueError("Email is required")
    if role not in {"admin", "member"}:
        raise ValueError("Member role must be admin or member")
    _schema_initializer()
    now = _clock()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        project = project_manager_access(conn, user_id, project_id)
        invited_user = conn.execute(
            "SELECT id FROM users WHERE lower(email) = ?", (email,),
        ).fetchone()
        if invited_user is None:
            raise ProjectMemberNotFound("User not found")
        organization_member = conn.execute(
            "SELECT 1 FROM organization_memberships WHERE organization_id = ? AND user_id = ?",
            (project["organization_id"], invited_user["id"]),
        ).fetchone()
        if organization_member is None:
            raise ProjectOrganizationMembershipRequired("Member is not in the organization")
        existing = conn.execute(
            "SELECT 1 FROM project_memberships WHERE project_id = ? AND user_id = ?",
            (project_id, invited_user["id"]),
        ).fetchone()
        if existing:
            raise ProjectMembershipExists("User is already a project member")
        conn.execute(
            "INSERT INTO project_memberships VALUES (?, ?, ?, ?)",
            (project_id, invited_user["id"], role, now),
        )
        return conn.execute("""
            SELECT u.id AS user_id, u.username, u.email, u.nickname, u.avatar_url,
                   pm.role, pm.created_at AS joined_at
            FROM project_memberships pm
            JOIN users u ON u.id = pm.user_id
            WHERE pm.project_id = ? AND pm.user_id = ?
        """, (project_id, invited_user["id"])).fetchone()


def update_project_member_role(
    user_id: str, project_id: str, member_user_id: str, role: str,
) -> sqlite3.Row:
    if role not in {"admin", "member"}:
        raise ValueError("Member role must be admin or member")
    _schema_initializer()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        project = project_manager_access(conn, user_id, project_id)
        member = conn.execute(
            "SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?",
            (project_id, member_user_id),
        ).fetchone()
        if member is None:
            raise ProjectMemberNotFound("Project member not found")
        if member_user_id == user_id:
            raise ProjectPermissionDenied("You cannot change your own project role")
        if member["role"] == "owner":
            raise ProjectPermissionDenied("The project owner's role cannot be changed")
        if project["role"] != "owner" and member["role"] == "admin":
            raise ProjectPermissionDenied("Only the project owner can manage project administrators")
        conn.execute(
            "UPDATE project_memberships SET role = ? WHERE project_id = ? AND user_id = ?",
            (role, project_id, member_user_id),
        )
        return conn.execute("""
            SELECT u.id AS user_id, u.username, u.email, u.nickname, u.avatar_url,
                   pm.role, pm.created_at AS joined_at
            FROM project_memberships pm
            JOIN users u ON u.id = pm.user_id
            WHERE pm.project_id = ? AND pm.user_id = ?
        """, (project_id, member_user_id)).fetchone()


def remove_project_member(
    user_id: str, project_id: str, member_user_id: str,
) -> None:
    _schema_initializer()
    with closing(_connection_factory()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        project = project_manager_access(conn, user_id, project_id)
        member = conn.execute(
            "SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?",
            (project_id, member_user_id),
        ).fetchone()
        if member is None:
            raise ProjectMemberNotFound("Project member not found")
        if member_user_id == user_id:
            raise ProjectPermissionDenied("You cannot remove yourself from the project")
        if member["role"] == "owner":
            raise ProjectPermissionDenied("The project owner cannot be removed")
        if member["role"] == "admin" and project["role"] != "owner":
            raise ProjectPermissionDenied("Only the project owner can manage project administrators")
        conn.execute(
            "DELETE FROM project_memberships WHERE project_id = ? AND user_id = ?",
            (project_id, member_user_id),
        )
