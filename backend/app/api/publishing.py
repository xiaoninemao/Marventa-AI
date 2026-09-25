from __future__ import annotations

import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse

from app.auth.dependencies import get_current_user
from app.engines.publishing.models import (
    CreateProjectRequest,
    ManualProjectRequest,
    ProjectMember,
    ProjectChannelAuthorizationPollRequest,
    ProjectChannelAuthorizationRequest,
    ProjectMemberInvite,
    ProjectMemberRole,
    UpdateProjectRequest,
)
from app.engines.publishing.channel_credentials import (
    ChannelCredentialEncryptionUnavailable,
)
from app.engines.publishing.channel_oauth import (
    ChannelOAuthConfigurationError,
    ChannelOAuthProviderError,
    exchange_douyin_code,
    poll_xiaohongshu_authorization,
    start_channel_authorization,
)
from app.engines.publishing.project_channel_accounts import (
    InvalidChannelAuthorizationState,
    consume_channel_authorization_state,
    delete_project_channel_account,
    get_channel_authorization_state,
    list_project_channel_accounts,
    save_authorized_channel_account,
)
from app.config import FRONTEND_BASE_URL
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
from app.media_storage import delete_media, delete_media_prefix, media_key_from_url

# Keep the legacy namespace for project clients; publishing/account APIs are retired.
router = APIRouter(prefix="/api/v1/publishing", tags=["projects"])
logger = logging.getLogger(__name__)


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


@router.get("/projects/{project_id}/channel-accounts")
async def get_project_channel_accounts(
    project_id: str, current_user=Depends(get_current_user),
):
    try:
        accounts = list_project_channel_accounts(current_user["id"], project_id)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response("Channel accounts retrieved", [account.model_dump() for account in accounts])


@router.post("/projects/{project_id}/channel-accounts/authorization")
async def authorize_project_channel_account(
    project_id: str,
    body: ProjectChannelAuthorizationRequest,
    current_user=Depends(get_current_user),
):
    try:
        authorization = await start_channel_authorization(
            current_user["id"], project_id, body.platform,
        )
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (
        ChannelOAuthConfigurationError,
        ChannelCredentialEncryptionUnavailable,
    ) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ChannelOAuthProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return success_response(
        "Channel authorization started",
        {
            "platform": authorization.platform,
            "mode": authorization.mode,
            "state": authorization.state,
            "authorization_url": authorization.authorization_url,
            "expires_in": authorization.expires_in,
            "interval": authorization.interval,
            "user_code": authorization.user_code,
        },
    )


def _channel_authorization_redirect(
    project_id: str,
    *,
    status: str,
) -> RedirectResponse:
    query = urlencode({
        "tab": "channels",
        "channel_authorization": status,
    })
    return RedirectResponse(
        f"{FRONTEND_BASE_URL.rstrip('/')}/projects/{project_id}?{query}",
        status_code=303,
    )


@router.get("/channel-accounts/oauth/douyin/callback")
async def complete_douyin_channel_authorization(
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
):
    try:
        authorization = get_channel_authorization_state(state, "douyin")
    except InvalidChannelAuthorizationState:
        raise HTTPException(
            status_code=400,
            detail="Channel authorization state is invalid or expired",
        ) from None
    project_id = str(authorization["project_id"])
    if error or not code:
        consume_channel_authorization_state(state, "douyin")
        return _channel_authorization_redirect(project_id, status="cancelled")
    try:
        grant = await exchange_douyin_code(code)
        user_id, consumed_project_id = consume_channel_authorization_state(
            state, "douyin",
        )
        save_authorized_channel_account(
            user_id,
            consumed_project_id,
            platform="douyin",
            platform_user_id=grant.platform_user_id,
            account_name=grant.account_name,
            profile_url=grant.profile_url,
            scopes=grant.scopes,
            credentials=grant.credentials,
            token_expires_at=grant.token_expires_at,
            refresh_token_expires_at=grant.refresh_token_expires_at,
        )
    except (
        ChannelOAuthConfigurationError,
        ChannelOAuthProviderError,
        ChannelCredentialEncryptionUnavailable,
        InvalidChannelAuthorizationState,
        ValueError,
    ) as exc:
        logger.warning(
            "Douyin channel authorization callback failed for project %s: %s",
            project_id,
            type(exc).__name__,
        )
        return _channel_authorization_redirect(project_id, status="failed")
    return _channel_authorization_redirect(project_id, status="success")


@router.post(
    "/projects/{project_id}/channel-accounts/authorization/xiaohongshu/poll",
)
async def poll_xiaohongshu_channel_authorization(
    project_id: str,
    body: ProjectChannelAuthorizationPollRequest,
    current_user=Depends(get_current_user),
):
    try:
        authorization = get_channel_authorization_state(
            body.state, "xiaohongshu",
        )
        if (
            authorization["user_id"] != current_user["id"]
            or authorization["project_id"] != project_id
        ):
            raise InvalidChannelAuthorizationState(
                "Channel authorization state is invalid or expired",
            )
        poll = await poll_xiaohongshu_authorization(
            str(authorization["provider_code"]),
            int(authorization["poll_interval_seconds"]),
        )
        if poll.status != "authorized" or poll.grant is None:
            return success_response(
                "Channel authorization pending",
                {"status": poll.status, "interval": poll.interval},
            )
        user_id, consumed_project_id = consume_channel_authorization_state(
            body.state, "xiaohongshu",
        )
        account = save_authorized_channel_account(
            user_id,
            consumed_project_id,
            platform="xiaohongshu",
            platform_user_id=poll.grant.platform_user_id,
            account_name=poll.grant.account_name,
            profile_url=poll.grant.profile_url,
            scopes=poll.grant.scopes,
            credentials=poll.grant.credentials,
            token_expires_at=poll.grant.token_expires_at,
            refresh_token_expires_at=poll.grant.refresh_token_expires_at,
        )
    except (ProjectNotFound, InvalidChannelAuthorizationState) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (
        ChannelOAuthConfigurationError,
        ChannelCredentialEncryptionUnavailable,
    ) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ChannelOAuthProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return success_response(
        "Channel account authorized",
        {"status": "authorized", "account": account.model_dump()},
    )


@router.delete("/projects/{project_id}/channel-accounts/{account_id}")
async def unbind_project_channel_account(
    project_id: str,
    account_id: str,
    current_user=Depends(get_current_user),
):
    try:
        delete_project_channel_account(current_user["id"], project_id, account_id)
    except (ProjectNotFound, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return success_response("Channel account authorization removed")


@router.delete("/projects/{project_id}")
async def remove_project(project_id: str, current_user=Depends(get_current_user)):
    try:
        case_media = delete_project(current_user["id"], project_id)
    except ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProjectPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    delete_media_prefix(
        f"publishing/{current_user['organization_id']}/{project_id}",
    )
    for relative_path in case_media:
        if key := media_key_from_url(relative_path):
            delete_media(key)
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
