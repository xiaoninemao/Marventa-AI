from __future__ import annotations

import os
import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile

from app.auth.dependencies import can_manage_organization_record, get_current_user
from app.engines.publishing.models import (
    CreateProjectRequest,
    CreateTaskRequest,
    CreateTaskFromProjectRequest,
    GenerateReviewRequest,
    InspectLoginRequest,
    ManualAccountImportRequest,
    ManualProjectRequest,
    PublishExecuteRequest,
    SaveLoginRequest,
    StartLoginRequest,
    UpdateSocialAccountRequest,
    UpdateTaskRequest,
    UpsertMetricRequest,
    UpsertAccountMemoryRequest,
)
from app.config import ALLOWED_IMAGE_EXTENSIONS, ALLOWED_VIDEO_EXTENSIONS, MEDIA_ROOT
from app.engines.publishing.account_import import (
    build_memory_seed,
    cookie_hint,
    encrypt_cookie_payload,
    parse_cookie_payload,
    validate_platform_cookie,
)
from app.engines.publishing.automation import (
    LoginSessionExpired,
    export_login_session_state,
    launch_login_window,
    publish_task_with_account,
)
from app.engines.publishing.storage import (
    add_project_media,
    create_manual_project,
    create_social_account,
    create_project_from_session,
    create_task_from_project,
    create_task_from_session,
    find_social_account,
    generate_review_for_task,
    get_project,
    get_publish_metric,
    get_publish_review,
    get_social_account,
    get_task,
    list_social_accounts,
    list_account_memories,
    list_projects,
    list_tasks,
    remove_project_media,
    update_social_account,
    update_task,
    upsert_publish_metric,
    upsert_account_memory,
)
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/publishing", tags=["publishing"])
logger = logging.getLogger(__name__)


@router.get("/health")
async def health_check():
    return success_response("Publishing service is running", {"status": "healthy"})


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
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")
    return success_response("Project saved", project.model_dump())


@router.post("/projects/manual")
async def create_manual_content_project(req: ManualProjectRequest, current_user=Depends(get_current_user)):
    project = create_manual_project(
        current_user["id"],
        title=req.title,
        xhs_account=req.xhs_account,
        content_type=req.content_type,
        platform_hint=req.platform_hint,
        final_snapshot=req.final_snapshot,
        notes=req.notes,
        media_assets=req.media_assets,
    )
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


@router.post("/projects/{project_id}/media")
async def upload_project_media(
    project_id: str,
    images: Annotated[list[UploadFile], File()] = [],
    video: UploadFile | None = File(default=None),
    current_user=Depends(get_current_user),
):
    project = get_project(project_id, current_user["id"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not can_manage_organization_record(current_user, project.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    if len(images) > 18:
        raise HTTPException(status_code=400, detail="Images cannot exceed 18")

    media_dir = os.path.join(
        MEDIA_ROOT, "publishing", current_user["organization_id"], project_id,
    )
    os.makedirs(media_dir, exist_ok=True)
    assets = []

    async def save_upload(file: UploadFile, kind: str):
        ext = os.path.splitext(file.filename or "")[1].lower()
        allowed = ALLOWED_IMAGE_EXTENSIONS if kind == "image" else ALLOWED_VIDEO_EXTENSIONS
        if ext not in allowed:
            raise HTTPException(status_code=400, detail=f"Unsupported {kind} extension: {ext}")
        filename = f"{uuid.uuid4().hex[:12]}{ext}"
        path = os.path.join(media_dir, filename)
        content = await file.read()
        with open(path, "wb") as fh:
            fh.write(content)
        url = (
            f"/media/publishing/{current_user['organization_id']}/"
            f"{project_id}/{filename}"
        )
        return {"id": uuid.uuid4().hex[:12], "kind": kind, "name": file.filename or filename, "path": path, "url": url}

    for image in images:
        assets.append(await save_upload(image, "image"))
    if video:
        assets.append(await save_upload(video, "video"))

    updated = add_project_media(project_id, assets)
    return success_response("Project media uploaded", updated.model_dump() if updated else None)


@router.delete("/projects/{project_id}/media/{media_id}")
async def delete_project_media(project_id: str, media_id: str, current_user=Depends(get_current_user)):
    project = get_project(project_id, current_user["id"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not can_manage_organization_record(current_user, project.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    updated = remove_project_media(project_id, media_id)
    return success_response("Project media removed", updated.model_dump() if updated else None)


@router.post("/tasks/from_session")
async def create_publish_task(req: CreateTaskRequest, current_user=Depends(get_current_user)):
    try:
        task = create_task_from_session(
            current_user["id"],
            req.source_session_id,
            project_id=req.project_id,
            platform=req.platform,
            account_name=req.account_name,
            source_card_id=req.source_card_id,
            content_type=req.content_type,
            selected_version_ids=req.selected_version_ids,
            final_snapshot=req.final_snapshot,
            planned_publish_at=req.planned_publish_at,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")
    return success_response("Publish task created", task.model_dump())


@router.post("/tasks/from_project")
async def create_publish_task_from_project(req: CreateTaskFromProjectRequest, current_user=Depends(get_current_user)):
    try:
        task = create_task_from_project(
            current_user["id"],
            req.project_id,
            platform=req.platform,
            account_name=req.account_name,
            content_type=req.content_type,
            selected_version_ids=req.selected_version_ids,
            planned_publish_at=req.planned_publish_at,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Project not found")
    return success_response("Publish task created", task.model_dump())


@router.get("/tasks")
async def get_tasks(status: str = Query(default=""), current_user=Depends(get_current_user)):
    tasks = list_tasks(current_user["id"], status=status)
    return success_response("Tasks retrieved", [item.model_dump() for item in tasks])


@router.get("/tasks/{task_id}")
async def get_task_detail(task_id: str, current_user=Depends(get_current_user)):
    task = get_task(task_id, current_user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return success_response("Task retrieved", task.model_dump())


@router.put("/tasks/{task_id}")
async def update_publish_task(task_id: str, req: UpdateTaskRequest, current_user=Depends(get_current_user)):
    task = get_task(task_id, current_user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not can_manage_organization_record(current_user, task.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    updated = update_task(task_id, **req.model_dump(exclude_unset=True))
    return success_response("Task updated", updated.model_dump() if updated else None)


@router.post("/tasks/{task_id}/review")
async def review_publish_task(task_id: str, req: GenerateReviewRequest, current_user=Depends(get_current_user)):
    task = get_task(task_id, current_user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not can_manage_organization_record(current_user, task.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    review = generate_review_for_task(task_id, write_to_memory=req.write_to_memory)
    return success_response("Review generated", review.model_dump())


@router.get("/tasks/{task_id}/metrics")
async def get_task_metrics(task_id: str, current_user=Depends(get_current_user)):
    task = get_task(task_id, current_user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    metric = get_publish_metric(task_id)
    return success_response("Metrics retrieved", metric.model_dump() if metric else None)


@router.put("/tasks/{task_id}/metrics")
async def save_task_metrics(task_id: str, req: UpsertMetricRequest, current_user=Depends(get_current_user)):
    task = get_task(task_id, current_user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not can_manage_organization_record(current_user, task.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    metric = upsert_publish_metric(task_id, current_user["id"], **req.model_dump())
    if task.status == "published_pending_data":
        update_task(task_id, status="published_pending_data")
    return success_response("Metrics saved", metric.model_dump())


@router.get("/tasks/{task_id}/review")
async def get_task_review(task_id: str, current_user=Depends(get_current_user)):
    task = get_task(task_id, current_user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    review = get_publish_review(task_id)
    return success_response("Review retrieved", review.model_dump() if review else None)


@router.post("/tasks/{task_id}/publish")
async def publish_task(
    task_id: str,
    req: PublishExecuteRequest,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    task = get_task(task_id, current_user["id"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not can_manage_organization_record(current_user, task.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    account = find_social_account(current_user["id"], task.platform, task.account_name)
    if not account:
        raise HTTPException(status_code=400, detail="Please login and save this platform account first")
    project = get_project(task.project_id, current_user["id"]) if task.project_id else None
    media_assets = project.media_assets if project else list(task.final_snapshot.get("media_assets") or [])
    update_task(task_id, status="publishing")

    def _run_publish():
        try:
            result = publish_task_with_account(task, account, media_assets, dry_run=req.dry_run)
            status = "published_pending_data" if result.get("status") in {"submitted", "needs_manual_confirm"} else "pending_publish"
            update_task(
                task_id,
                status=status,
                publish_link=str(result.get("url") or ""),
                platform_work_id=str(result.get("work_id") or ""),
                review={"publish_result": result},
            )
        except Exception as exc:
            update_task(task_id, status="pending_publish", review={"publish_error": str(exc)})

    background_tasks.add_task(_run_publish)
    return success_response("Publish started", {"status": "publishing"})


@router.get("/accounts")
async def get_social_accounts(platform: str = Query(default=""), current_user=Depends(get_current_user)):
    accounts = list_social_accounts(current_user["id"], platform=platform)
    return success_response("Accounts retrieved", [item.model_dump() for item in accounts])


@router.post("/accounts/login/start")
async def start_account_login(req: StartLoginRequest, current_user=Depends(get_current_user)):
    if req.platform not in {"douyin", "xiaohongshu"}:
        raise HTTPException(status_code=400, detail="Unsupported platform")
    account_name = req.account_name
    if req.account_id:
        account = get_social_account(req.account_id, current_user["id"])
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")
        if not can_manage_organization_record(current_user, account.user_id):
            raise HTTPException(status_code=403, detail="Access denied")
        account_name = account_name or account.account_name
    result = launch_login_window(
        current_user["id"],
        req.platform,
        account_name or _default_quick_account_name(req.platform),
        account_id=req.account_id,
        fresh=req.fresh,
    )
    return success_response("Login window opened", result)


@router.post("/accounts/login/inspect")
async def inspect_account_login(req: InspectLoginRequest, current_user=Depends(get_current_user)):
    if not req.login_session_id:
        raise HTTPException(status_code=400, detail="登录窗口会话已失效，请重新打开平台快速登录")
    try:
        login_state = export_login_session_state(req.login_session_id, close_after_export=False)
    except LoginSessionExpired:
        raise HTTPException(status_code=400, detail="登录窗口会话已失效，请重新打开平台快速登录")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"读取登录态失败：{exc}")
    return success_response("Login inspected", _login_preview(login_state))


@router.post("/accounts/login/save")
async def save_account_login(req: SaveLoginRequest, current_user=Depends(get_current_user)):
    if req.platform not in {"douyin", "xiaohongshu"}:
        raise HTTPException(status_code=400, detail="Unsupported platform")
    if req.account_id:
        existing_account = get_social_account(req.account_id, current_user["id"])
        if not existing_account:
            raise HTTPException(status_code=404, detail="Account not found")
        if not can_manage_organization_record(current_user, existing_account.user_id):
            raise HTTPException(status_code=403, detail="Access denied")
    account_name = (req.account_name or "").strip() or _default_quick_account_name(req.platform)
    if not req.login_session_id:
        raise HTTPException(status_code=400, detail="登录窗口会话已失效，请重新打开平台快速登录")
    try:
        login_state = export_login_session_state(req.login_session_id)
    except LoginSessionExpired:
        raise HTTPException(status_code=400, detail="登录窗口会话已失效，请重新打开平台快速登录")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"读取登录态失败：{exc}")

    cookies = login_state.get("cookies") or []
    local_storage = login_state.get("local_storage") or {}
    origins = login_state.get("origins") or []
    if not cookies and not local_storage and not origins:
        raise HTTPException(status_code=400, detail="未读取到登录态，请先在打开的窗口完成平台登录")

    nickname = str(req.nickname or login_state.get("nickname") or "").strip()
    if not nickname:
        logger.warning("nickname parse failed: platform=%s login_session_id=%s", req.platform, req.login_session_id)
    avatar_url = str(req.avatar_url or login_state.get("avatar_url") or "").strip()
    profile_url = str(req.profile_url or login_state.get("profile_url") or login_state.get("home_url") or "").strip()
    platform_user_id = str(req.platform_user_id or login_state.get("platform_user_id") or "").strip()
    followers = str(req.followers or login_state.get("followers") or "").strip()
    remark = str(req.remark or "").strip()
    authorized = bool(login_state.get("authorized"))
    display_name = nickname or _unrecognized_account_name(req.platform, account_name)
    session_dir = str(login_state.get("session_dir") or "")
    storage_state_file = str(login_state.get("storage_state_file") or "")
    profile = {
        "import_mode": "quick_login",
        "home_url": login_state.get("home_url") or "",
        "title": login_state.get("title") or "",
        "cookie_count": len(cookies),
        "cookie_names": login_state.get("cookie_names") or [],
        "origin_count": len(origins),
        "local_storage_origins": sorted(local_storage.keys()),
        "storage_state_file": storage_state_file,
        "login_session_id": req.login_session_id,
        "login_checked_at": login_state.get("login_checked_at") or "",
        "nickname_parse_status": "recognized" if nickname else "failed",
        "followers": followers,
    }
    credential_blob = encrypt_cookie_payload({
        "platform": req.platform,
        "mode": "quick_login",
        "cookies": cookies,
        "local_storage": local_storage,
        "storage_state_file": storage_state_file,
        "login_checked_at": login_state.get("login_checked_at") or "",
    })
    if req.account_id:
        try:
            account = update_social_account(
                current_user["id"],
                req.account_id,
                account_name=display_name,
                platform_user_id=platform_user_id,
                nickname=nickname,
                avatar_url=avatar_url,
                profile_url=profile_url,
                remark=remark,
                session_dir=session_dir,
                status="authorized" if nickname else "pending_identification",
                cookie_status="valid" if authorized else "pending",
                profile=profile,
                credential_blob=credential_blob,
                last_checked_at=login_state.get("login_checked_at") or "",
            )
        except ValueError:
            raise HTTPException(status_code=404, detail="Account not found")
    else:
        account = create_social_account(
            current_user["id"],
            platform=req.platform,
            account_name=display_name,
            session_dir=session_dir,
            status="authorized" if nickname else "pending_identification",
            cookie_status="valid" if authorized else "pending",
            platform_user_id=platform_user_id,
            nickname=nickname,
            avatar_url=avatar_url,
            profile_url=profile_url,
            remark=remark,
            profile=profile,
            credential_blob=credential_blob,
        )
    upsert_account_memory(
        current_user["id"],
        **build_memory_seed(req.platform, display_name, profile_url),
    )
    return {
        "success": True,
        "message": "Account login saved",
        "data": account.model_dump(),
        "account": {
            "id": account.id,
            "platform": "xhs" if account.platform == "xiaohongshu" else account.platform,
            "nickname": account.nickname or account.account_name,
            "status": account.status,
            "createdAt": account.created_at,
        },
    }


@router.put("/accounts/{account_id}")
async def update_account(account_id: str, req: UpdateSocialAccountRequest, current_user=Depends(get_current_user)):
    existing_account = get_social_account(account_id, current_user["id"])
    if not existing_account:
        raise HTTPException(status_code=404, detail="Account not found")
    if not can_manage_organization_record(current_user, existing_account.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    profile_updates = {}
    if req.followers is not None:
        profile_updates["followers"] = req.followers
    if req.industry is not None:
        profile_updates["industry"] = req.industry
    updates = req.model_dump(exclude_unset=True, exclude={"followers", "industry"})
    if profile_updates:
        updates["profile"] = profile_updates
    try:
        account = update_social_account(current_user["id"], account_id, **updates)
    except ValueError:
        raise HTTPException(status_code=404, detail="Account not found")
    return success_response("Account updated", account.model_dump())


@router.post("/accounts/manual_import")
async def manual_import_account(req: ManualAccountImportRequest, current_user=Depends(get_current_user)):
    try:
        account = _import_account_from_payload(current_user["id"], req.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return success_response("Account imported", account.model_dump())


def _import_account_from_payload(user_id: str, payload: dict):
    platform = str(payload.get("platform") or "").strip()
    if platform not in {"douyin", "xiaohongshu"}:
        raise ValueError("仅支持抖音或小红书")
    account_type = str(payload.get("account_type") or "ordinary").strip()
    cookie_content = str(payload.get("cookie_content") or payload.get("cookie") or "")
    cookies = parse_cookie_payload(str(payload.get("cookie_format") or "json"), cookie_content)
    cookie_status, warnings = validate_platform_cookie(platform, account_type, cookies)
    account_name = (
        str(payload.get("account_name") or "").strip()
        or str(payload.get("remark") or "").strip()
        or str(payload.get("nickname") or "").strip()
        or str(payload.get("platform_user_id") or "").strip()
        or f"{'抖音' if platform == 'douyin' else '小红书'}账号"
    )
    profile_url = str(payload.get("profile_url") or "").strip()
    platform_user_id = str(payload.get("platform_user_id") or "").strip()
    nickname = str(payload.get("nickname") or "").strip()
    encrypted = encrypt_cookie_payload({
        "platform": platform,
        "account_type": account_type,
        "cookies": cookies,
    })
    profile = {
        "import_mode": "manual_cookie",
        "cookie_names": sorted(cookies.keys()),
        "cookie_hint": cookie_hint(cookies),
        "warnings": warnings,
        "profile_url": profile_url,
    }
    account = create_social_account(
        user_id,
        platform=platform,
        account_name=account_name,
        platform_user_id=platform_user_id,
        nickname=nickname,
        profile_url=profile_url,
        account_type=account_type,
        remark=str(payload.get("remark") or "").strip(),
        session_dir="",
        status="authorized",
        cookie_status=cookie_status,
        profile=profile,
        credential_blob=encrypted,
    )
    upsert_account_memory(user_id, **build_memory_seed(platform, account_name, profile_url))
    return account


def _default_quick_account_name(platform: str) -> str:
    label = "小红书账号" if platform == "xiaohongshu" else "抖音账号"
    return f"{label}_{datetime.now().strftime('%Y%m%d%H%M%S')}"


def _unrecognized_account_name(platform: str, account_name: str = "") -> str:
    generic_names = {"小红书账号", "抖音账号", "xiaohongshu账号", "douyin账号"}
    if account_name and account_name not in generic_names:
        return account_name
    label = "小红书账号" if platform == "xiaohongshu" else "抖音账号"
    return f"{label}-未识别"


def _login_preview(login_state: dict) -> dict:
    return {
        "nickname": str(login_state.get("nickname") or ""),
        "avatar_url": str(login_state.get("avatar_url") or ""),
        "profile_url": str(login_state.get("profile_url") or login_state.get("home_url") or ""),
        "platform_user_id": str(login_state.get("platform_user_id") or ""),
        "followers": str(login_state.get("followers") or ""),
        "authorized": bool(login_state.get("authorized")),
        "cookie_count": int(login_state.get("cookie_count") or 0),
        "cookie_names": login_state.get("cookie_names") or [],
        "login_checked_at": str(login_state.get("login_checked_at") or ""),
    }


@router.get("/account_memories")
async def get_memories(platform: str = Query(default=""), current_user=Depends(get_current_user)):
    memories = list_account_memories(current_user["id"], platform=platform)
    return success_response("Account memories retrieved", [item.model_dump() for item in memories])


@router.post("/account_memories")
async def save_memory(req: UpsertAccountMemoryRequest, current_user=Depends(get_current_user)):
    if req.id:
        existing_memory = get_account_memory(req.id, current_user["id"])
        if not existing_memory:
            raise HTTPException(status_code=404, detail="Memory not found")
        if not can_manage_organization_record(current_user, existing_memory.user_id):
            raise HTTPException(status_code=403, detail="Access denied")
    try:
        memory = upsert_account_memory(
            current_user["id"],
            memory_id=req.id,
            **req.model_dump(exclude={"id"}),
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Memory not found")
    return success_response("Account memory saved", memory.model_dump())
