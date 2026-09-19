from __future__ import annotations

import os
import re
import uuid
import aiofiles
from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Depends, Form, Request
from pydantic import BaseModel
from app.engines.case_library.models import CaseCreate, CaseUpdate, CaseResponse
from app.engines.case_library.storage import (
    create_case, list_public_cases, list_user_cases, list_favorited_cases, list_all_cases,
    get_case, update_case, delete_case, init_db,
)
from app.engines.case_library.favorites import add_favorite, remove_favorite, is_favorited, get_favorite_ids
from app.shared.response import success_response
from app.auth.dependencies import (
    can_manage_organization_record,
    get_admin_user,
    get_current_user,
    get_optional_user,
)
from app.auth.storage import is_admin
from app.config import (
    MEDIA_ROOT, ALLOWED_VIDEO_EXTENSIONS, ALLOWED_IMAGE_EXTENSIONS,
    MAX_VIDEO_SIZE_BYTES, MAX_IMAGE_SIZE_BYTES,
)

router = APIRouter(prefix="/api/v1/case_library", tags=["case_library"])

class CaseImportTaskRequest(BaseModel):
    input: str
    manual_text: str = ""
    save_case: bool = True


def _sanitize_filename(name: str) -> str:
    return re.sub(r"[^\w.\-]", "_", name)


def _media_dirs(is_public: bool, owner_id: str, media_type: str) -> tuple[str, str]:
    """Return (filesystem_dir, url_prefix) for a given visibility and media type."""
    if is_public:
        sub = "shared"
    else:
        sub = f"users/{owner_id}"
    dir_path = os.path.join(MEDIA_ROOT, sub, media_type)
    os.makedirs(dir_path, exist_ok=True)
    return dir_path, f"{sub}/{media_type}"


@router.get("/health")
async def health_check():
    return success_response("Case library service is running", {"status": "healthy"})


@router.post("/import_tasks")
async def create_case_import_task(
    body: CaseImportTaskRequest,
    current_user=Depends(get_optional_user),
):
    if not body.input.strip() and not body.manual_text.strip():
        raise HTTPException(status_code=400, detail="Input or manual_text is required")

    from app.engines.case_library.import_tasks import create_and_run_import_task

    owner_id = current_user.get("id", "") if current_user else ""
    task = create_and_run_import_task(
        owner_id=owner_id,
        raw_input=body.input.strip(),
        manual_text=body.manual_text.strip(),
        save_case=body.save_case,
    )
    if task.get("status") == "failed":
        raise HTTPException(status_code=422, detail=task.get("error") or "Import failed")
    return success_response("Import task completed", task)


@router.get("/import_tasks/{task_id}")
async def get_case_import_task(
    task_id: str,
    current_user=Depends(get_optional_user),
):
    from app.engines.case_library.import_tasks import get_import_task

    task = get_import_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Import task not found")
    owner_id = task.get("owner_id") or ""
    if owner_id and current_user and owner_id != current_user.get("id", ""):
        raise HTTPException(status_code=403, detail="You can only view your own import tasks")
    return success_response("Import task retrieved", task)

@router.get("/cases")
async def get_public_cases(
    limit: int = Query(default=50),
    offset: int = Query(default=0),
    content_type: str = Query(default=""),
    category: str = Query(default=""),
    search: str = Query(default=""),
    current_user=Depends(get_optional_user),
):
    cases = list_public_cases(limit=limit, offset=offset, content_type=content_type, category=category, search=search)
    user_id = current_user.get("id", "")
    fav_ids = get_favorite_ids(user_id) if user_id else set()
    return success_response("Cases retrieved", {
        "cases": [c.model_dump() for c in cases],
        "favorite_ids": list(fav_ids),
    })


@router.get("/cases/{case_id}")
async def get_case_item(case_id: str, current_user=Depends(get_optional_user)):
    user_id = current_user.get("id", "")
    case = get_case(case_id, user_id) if user_id else get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    if not case.is_public and not user_id:
        raise HTTPException(status_code=404, detail="Case not found")
    data = case.model_dump()
    data["is_favorited"] = is_favorited(user_id, case_id) if user_id else False
    return success_response("Case retrieved", data)


# ── User endpoints (auth required) ──

@router.get("/my/cases")
async def get_my_cases(
    limit: int = Query(default=100),
    offset: int = Query(default=0),
    search: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    cases = list_user_cases(current_user["id"], limit=limit, offset=offset, search=search)
    fav_ids = get_favorite_ids(current_user["id"])
    return success_response("My cases retrieved", {
        "cases": [c.model_dump() for c in cases],
        "favorite_ids": list(fav_ids),
    })


@router.get("/my/favorites")
async def get_my_favorites(
    limit: int = Query(default=100),
    offset: int = Query(default=0),
    search: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    cases = list_favorited_cases(current_user["id"], limit=limit, offset=offset, search=search)
    return success_response("My favorites retrieved", {
        "cases": [c.model_dump() for c in cases],
        "favorite_ids": [c.id for c in cases],
    })


@router.post("/cases")
async def create_case_item(
    title: str = Form(...),
    content_type: str = Form(...),
    category: str = Form("agency"),
    description: str = Form(""),
    tags: str = Form("[]"),
    is_public: str = Form("false"),
    source: str = Form(""),
    video: UploadFile | None = File(None),
    images: list[UploadFile] | None = File(None),
    current_user=Depends(get_current_user),
    request: Request = None,
):
    # Pre-check Content-Length before reading files into memory
    content_length = request.headers.get("content-length") if request else None
    if content_length and content_type == "video" and int(content_length) > MAX_VIDEO_SIZE_BYTES + 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Video too large. Max: {MAX_VIDEO_SIZE_BYTES // 1024 // 1024}MB")
    if content_length and content_type == "image_text" and int(content_length) > MAX_IMAGE_SIZE_BYTES * 10 + 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Images too large. Max: {MAX_IMAGE_SIZE_BYTES // 1024 // 1024}MB per image")

    if content_type not in ("video", "image_text"):
        raise HTTPException(status_code=400, detail="content_type must be 'video' or 'image_text'")
    if category not in ("agency", "curated"):
        raise HTTPException(status_code=400, detail="category must be 'agency' or 'curated'")

    import json
    try:
        tags_list = json.loads(tags) if isinstance(tags, str) else tags
    except json.JSONDecodeError:
        tags_list = []

    owner_id = current_user["id"]
    # Only admins can set is_public
    public = is_public.lower() == "true" and is_admin(owner_id)

    os_imported = __import__("os")
    video_url = ""
    image_urls: list[str] = []

    if content_type == "video":
        if video is None or not video.filename:
            raise HTTPException(status_code=400, detail="Video file is required for video cases")
        ext = os.path.splitext(video.filename)[1].lower()
        if ext not in ALLOWED_VIDEO_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported video format: {ext}")
        content_bytes = await video.read()
        if len(content_bytes) > MAX_VIDEO_SIZE_BYTES:
            raise HTTPException(status_code=413, detail=f"Video too large. Max: {MAX_VIDEO_SIZE_BYTES // 1024 // 1024}MB")
        videos_dir, url_prefix = _media_dirs(public, owner_id, "videos")
        safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(video.filename)}"
        file_path = os_imported.path.join(videos_dir, safe_name)
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content_bytes)
        video_url = f"{url_prefix}/{safe_name}"

    elif content_type == "image_text":
        if images is None or len(images) == 0:
            raise HTTPException(status_code=400, detail="At least one image is required for image_text cases")
        images_dir, url_prefix = _media_dirs(public, owner_id, "images")
        for img in images:
            if not img.filename:
                continue
            ext = os.path.splitext(img.filename)[1].lower()
            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                raise HTTPException(status_code=400, detail=f"Unsupported image format: {ext}")
            content_bytes = await img.read()
            if len(content_bytes) > MAX_IMAGE_SIZE_BYTES:
                raise HTTPException(status_code=413, detail=f"Image too large. Max: {MAX_IMAGE_SIZE_BYTES // 1024 // 1024}MB")
            safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(img.filename)}"
            file_path = os_imported.path.join(images_dir, safe_name)
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(content_bytes)
            image_urls.append(f"{url_prefix}/{safe_name}")

    case = create_case(
        title=title,
        content_type=content_type,
        category=category,
        description=description,
        tags=tags_list,
        video_url=video_url,
        image_urls=image_urls,
        owner_id=owner_id,
        is_public=public,
        source=source,
    )
    return success_response("Case created", case.model_dump())


# ── Admin endpoints ──

@router.get("/admin/cases")
async def get_admin_cases(
    limit: int = Query(default=100),
    offset: int = Query(default=0),
    _admin=Depends(get_admin_user),
):
    cases = list_all_cases(limit=limit, offset=offset)
    return success_response("All cases retrieved", [c.model_dump() for c in cases])


# ── Update / Delete (ownership or admin check) ──

def _check_ownership(case_id: str, current_user):
    case = (
        get_case(case_id)
        if is_admin(current_user["id"])
        else get_case(case_id, current_user["id"])
    )
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    if (
        not is_admin(current_user["id"])
        and not can_manage_organization_record(current_user, case.owner_id)
    ):
        raise HTTPException(status_code=403, detail="You can only modify your own cases")
    return case


@router.put("/cases/{case_id}")
async def update_case_item(
    case_id: str,
    body: CaseUpdate,
    current_user=Depends(get_current_user),
):
    _check_ownership(case_id, current_user)
    updates = body.model_dump(exclude_none=True)
    # Non-admins cannot set is_public
    if "is_public" in updates and not is_admin(current_user["id"]):
        del updates["is_public"]
    updated = update_case(case_id, **updates)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update case")
    return success_response("Case updated", updated.model_dump())


@router.post("/cases/{case_id}/media")
async def replace_case_media(
    case_id: str,
    video: UploadFile | None = File(None),
    images: list[UploadFile] | None = File(None),
    current_user=Depends(get_current_user),
):
    case = _check_ownership(case_id, current_user)
    os_imported = __import__("os")

    # Delete old media files
    if case.video_url:
        old = os_imported.path.join(MEDIA_ROOT, case.video_url)
        try:
            if os_imported.path.exists(old):
                os_imported.remove(old)
        except OSError:
            pass
    for img_url in case.image_urls:
        old = os_imported.path.join(MEDIA_ROOT, img_url)
        try:
            if os_imported.path.exists(old):
                os_imported.remove(old)
        except OSError:
            pass

    video_url = ""
    image_urls: list[str] = []

    if video is not None and video.filename:
        ext = os.path.splitext(video.filename)[1].lower()
        if ext not in ALLOWED_VIDEO_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported video format: {ext}")
        content_bytes = await video.read()
        if len(content_bytes) > MAX_VIDEO_SIZE_BYTES:
            raise HTTPException(status_code=413, detail=f"Video too large")
        videos_dir, url_prefix = _media_dirs(case.is_public, case.owner_id, "videos")
        safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(video.filename)}"
        file_path = os_imported.path.join(videos_dir, safe_name)
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content_bytes)
        video_url = f"{url_prefix}/{safe_name}"

    if images is not None and len(images) > 0:
        images_dir, url_prefix = _media_dirs(case.is_public, case.owner_id, "images")
        for img in images:
            if not img.filename:
                continue
            ext = os.path.splitext(img.filename)[1].lower()
            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                raise HTTPException(status_code=400, detail=f"Unsupported image format: {ext}")
            content_bytes = await img.read()
            if len(content_bytes) > MAX_IMAGE_SIZE_BYTES:
                raise HTTPException(status_code=413, detail=f"Image too large")
            safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(img.filename)}"
            file_path = os_imported.path.join(images_dir, safe_name)
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(content_bytes)
            image_urls.append(f"{url_prefix}/{safe_name}")

    updates = {}
    if video_url:
        updates["video_url"] = video_url
    if image_urls:
        updates["image_urls"] = image_urls

    updated = update_case(case_id, **updates)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update case media")
    return success_response("Media updated", updated.model_dump())


@router.delete("/cases/{case_id}")
async def delete_case_item(
    case_id: str,
    current_user=Depends(get_current_user),
):
    case = _check_ownership(case_id, current_user)

    deleted = delete_case(case_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Case not found")

    os_imported = __import__("os")
    if case.video_url:
        file_path = os_imported.path.join(MEDIA_ROOT, case.video_url)
        try:
            if os_imported.path.exists(file_path):
                os_imported.remove(file_path)
        except OSError:
            pass
    for img_url in case.image_urls:
        file_path = os_imported.path.join(MEDIA_ROOT, img_url)
        try:
            if os_imported.path.exists(file_path):
                os_imported.remove(file_path)
        except OSError:
            pass

    return success_response("Case deleted")


@router.post("/cases/{case_id}/analyze")
async def analyze_case_item(
    case_id: str,
    current_user=Depends(get_current_user),
    images: list[UploadFile] | None = File(None),
):
    case = _check_ownership(case_id, current_user)

    if case.ai_status == "analyzing":
        raise HTTPException(status_code=409, detail="AI analysis is already in progress")

    from app.engines.case_library.storage import update_case_ai
    from app.engines.case_library.ai_analyzer import analyze_async

    # Build image paths from existing case media
    image_paths: list[str] = []
    for img_url in case.image_urls:
        full = os.path.join(MEDIA_ROOT, img_url)
        if os.path.exists(full):
            image_paths.append(full)

    # If new images were uploaded for analysis, save them temporarily and add to paths
    if images:
        tmp_dir = os.path.join(MEDIA_ROOT, "analysis_tmp")
        os.makedirs(tmp_dir, exist_ok=True)
        for img in images:
            if not img.filename:
                continue
            ext = os.path.splitext(img.filename)[1].lower()
            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                continue
            content_bytes = await img.read()
            if len(content_bytes) > MAX_IMAGE_SIZE_BYTES:
                continue
            safe_name = f"{uuid.uuid4().hex[:12]}_{_sanitize_filename(img.filename)}"
            file_path = os.path.join(tmp_dir, safe_name)
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(content_bytes)
            image_paths.append(file_path)

    video_path = ""
    if case.video_url:
        full_video = os.path.join(MEDIA_ROOT, case.video_url)
        if os.path.exists(full_video):
            video_path = case.video_url

    update_case_ai(case_id, "analyzing")
    analyze_async(
        case_id=case.id,
        title=case.title,
        content_type=case.content_type,
        category=case.category,
        description=case.description,
        tags=case.tags,
        image_paths=image_paths if image_paths else None,
        video_url=video_path,
    )
    return success_response("AI analysis started", {"status": "analyzing"})


# ── Favorites ──

@router.post("/cases/{case_id}/favorite")
async def favorite_case(case_id: str, current_user=Depends(get_current_user)):
    case = get_case(case_id, current_user["id"])
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    if case.category != "curated":
        raise HTTPException(status_code=400, detail="Only curated cases can be favorited")
    add_favorite(current_user["id"], case_id)
    return success_response("Favorited")


@router.delete("/cases/{case_id}/favorite")
async def unfavorite_case(case_id: str, current_user=Depends(get_current_user)):
    remove_favorite(current_user["id"], case_id)
    return success_response("Unfavorited")
