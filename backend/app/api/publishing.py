from __future__ import annotations

import os
import shutil

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.dependencies import get_current_user
from app.engines.publishing.models import (
    CreateProjectRequest,
    ManualProjectRequest,
    ProjectMember,
    ProjectMemberInvite,
    ProjectMemberRole,
    UpdateProjectRequest,
)
from app.config import MEDIA_ROOT
from app.engines.publishing.projects import (
    ProjectNameExists,
    create_manual_project,
    create_project_from_session,
    delete_project,
    get_project,
    list_projects,
    update_project,
)
from app.engines.publishing.project_memberships import (
    ProjectMemberNotFound,
    ProjectMembershipExists,
    ProjectNotFound,
    ProjectOrganizationMembershipRequired,
    ProjectPermissionDenied,
    invite_project_member,
    list_project_members,
    remove_project_member,
    update_project_member_role,
)
from app.shared.response import success_response

# Keep the legacy namespace for project clients; publishing/account APIs are retired.
router = APIRouter(prefix="/api/v1/publishing", tags=["projects"])


@router.get("/health")
async def health_check():
    return success_response("Project service is running", {"status": "healthy"})


@router.post("/projects/from_session")
async def create_project(req: CreateProjectRequest, current_user=Depends(get_current_user)):
    try:
        project = create_project_from_session(
            current_user["id"],
            req.source_session_id,
            title=req.title,
            xhs_account=req.xhs_account,
            source_card_id=req.source_card_id,
            content_type=req.content_type,
            platform_hint=req.platform_hint,
            notes=req.notes,
        )
    except ProjectNameExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")
    return success_response("Project saved", project.model_dump())


@router.post("/projects/manual")
async def create_manual_content_project(req: ManualProjectRequest, current_user=Depends(get_current_user)):
    try:
        project = create_manual_project(
            current_user["id"],
            title=req.title,
            xhs_account=req.xhs_account,
            content_type=req.content_type,
            platform_hint=req.platform_hint,
            final_snapshot=req.final_snapshot,
            notes=req.notes,
        )
    except ProjectNameExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return success_response("Manual project saved", project.model_dump())


@router.get("/projects")
async def get_projects(
    xhs_account: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    projects = list_projects(current_user["id"], xhs_account=xhs_account)
    return success_response("Projects retrieved", [item.model_dump() for item in projects])


@router.get("/projects/{project_id}")
async def get_project_detail(project_id: str, current_user=Depends(get_current_user)):
    project = get_project(project_id, current_user["id"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return success_response("Project retrieved", project.model_dump())


@router.patch("/projects/{project_id}")
async def edit_project(
    project_id: str,
    body: UpdateProjectRequest,
    current_user=Depends(get_current_user),
):
    try:
        project = update_project(
            current_user["id"], project_id,
            title=body.title,
            notes=body.notes,
            avatar_color=body.avatar_color,
            avatar_icon=body.avatar_icon,
        )
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ProjectNameExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project updated", project.model_dump())


@router.delete("/projects/{project_id}")
async def remove_project(project_id: str, current_user=Depends(get_current_user)):
    try:
        case_media = delete_project(current_user["id"], project_id)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    media_dir = os.path.join(
        MEDIA_ROOT, "publishing", current_user["organization_id"], project_id,
    )
    if os.path.isdir(media_dir):
        shutil.rmtree(media_dir)
    media_root = os.path.realpath(MEDIA_ROOT)
    for relative_path in case_media:
        candidate = os.path.realpath(os.path.join(MEDIA_ROOT, relative_path.lstrip("/")))
        if os.path.commonpath([candidate, media_root]) == media_root and os.path.isfile(candidate):
            os.remove(candidate)
    return success_response("Project deleted")


@router.get("/projects/{project_id}/members")
async def get_project_members(project_id: str, current_user=Depends(get_current_user)):
    try:
        members = list_project_members(current_user["id"], project_id)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response(
        "Project members retrieved",
        [ProjectMember(**dict(member)).model_dump() for member in members],
    )


@router.post("/projects/{project_id}/members")
async def add_project_member(
    project_id: str,
    body: ProjectMemberInvite,
    current_user=Depends(get_current_user),
):
    try:
        member = invite_project_member(
            current_user["id"], project_id, body.email, body.role,
        )
    except (ProjectNotFound, ProjectMemberNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (ProjectMembershipExists, ProjectOrganizationMembershipRequired) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project member added", ProjectMember(**dict(member)).model_dump())


@router.patch("/projects/{project_id}/members/{member_user_id}")
async def change_project_member_role(
    project_id: str,
    member_user_id: str,
    body: ProjectMemberRole,
    current_user=Depends(get_current_user),
):
    try:
        member = update_project_member_role(
            current_user["id"], project_id, member_user_id, body.role,
        )
    except (ProjectNotFound, ProjectMemberNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Project member updated", ProjectMember(**dict(member)).model_dump())


@router.delete("/projects/{project_id}/members/{member_user_id}")
async def delete_project_member(
    project_id: str,
    member_user_id: str,
    current_user=Depends(get_current_user),
):
    try:
        remove_project_member(current_user["id"], project_id, member_user_id)
    except (ProjectNotFound, ProjectMemberNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return success_response("Project member removed")
