from __future__ import annotations

import os
import aiofiles
from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Depends, Request
from app.engines.market_insight.models import (
    ParseRequest, ParseResponse, HistoryUpdateRequest, HistoryRecord,
)
from app.engines.market_insight.parser_factory import parse_document
from app.engines.market_insight.ai_analyzer import analyze_async
from app.engines.market_insight.storage import (
    save_insight, list_history, get_insight, update_insight, delete_insight,
    save_manual_insight,
)
from app.shared.response import success_response
from app.config import ALLOWED_EXTENSIONS, ALLOWED_DOCUMENT_TYPES, MAX_UPLOAD_SIZE_BYTES, MEDIA_ROOT
from app.auth.dependencies import can_manage_organization_record, get_current_user

router = APIRouter(prefix="/api/v1/market_insight", tags=["market_insight"])


@router.get("/health")
async def health_check():
    return success_response("Service is running", {"status": "healthy"})


@router.get("/history")
async def get_history(
    limit: int = Query(default=50),
    offset: int = Query(default=0),
    search: str = Query(default=""),
    current_user=Depends(get_current_user),
):
    records = list_history(owner_id=current_user["id"], limit=limit, offset=offset, search=search)
    return success_response("History retrieved", [r.model_dump() for r in records])


@router.get("/history/{record_id}")
async def get_history_item(record_id: str, current_user=Depends(get_current_user)):
    record = get_insight(record_id, current_user["id"])
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return success_response("Record retrieved", record.model_dump())


@router.put("/history/{record_id}")
async def update_history_item(record_id: str, body: HistoryUpdateRequest, current_user=Depends(get_current_user)):
    existing = get_insight(record_id, current_user["id"])
    if existing is None:
        raise HTTPException(status_code=404, detail="Record not found")
    if not can_manage_organization_record(current_user, existing.owner_id):
        raise HTTPException(status_code=403, detail="Access denied")
    record = update_insight(record_id, body.ai_analysis)
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return success_response("Record updated", record.model_dump())


@router.delete("/history/{record_id}")
async def delete_history_item(record_id: str, current_user=Depends(get_current_user)):
    existing = get_insight(record_id, current_user["id"])
    if existing is None:
        raise HTTPException(status_code=404, detail="Record not found")
    if not can_manage_organization_record(current_user, existing.owner_id):
        raise HTTPException(status_code=403, detail="Access denied")
    deleted = delete_insight(record_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Record not found")

    # Clean up product images for this record
    import shutil
    img_dir = os.path.join(MEDIA_ROOT, "product_images", current_user["id"], record_id)
    if os.path.exists(img_dir):
        shutil.rmtree(img_dir)

    return success_response("Record deleted")


@router.post("/manual")
async def create_manual_insight(body: HistoryUpdateRequest, current_user=Depends(get_current_user)):
    record = save_manual_insight(body.ai_analysis, owner_id=current_user["id"])
    return success_response("Manual insight created", record.model_dump())


@router.post("/parse")
async def parse_file(
    file: UploadFile = File(...),
    with_ai: bool = Query(default=True),
    current_user=Depends(get_current_user),
    request: Request = None,
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")

    # Pre-check Content-Length before reading body into memory
    content_length = request.headers.get("content-length") if request else None
    if content_length and int(content_length) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max size: {MAX_UPLOAD_SIZE_BYTES // 1024 // 1024}MB",
        )

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    source_type = _resolve_source_type(file.content_type, ext)
    if source_type is None:
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {file.content_type}")

    file_path = f"/tmp/{file.filename}"
    try:
        content_bytes = await file.read()
        if len(content_bytes) > MAX_UPLOAD_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Max size: {MAX_UPLOAD_SIZE_BYTES // 1024 // 1024}MB",
            )

        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content_bytes)

        if source_type == "markdown":
            content = content_bytes.decode("utf-8")
            result = parse_document(source_type, content=content, with_ai=False)
        else:
            result = parse_document(source_type, file_path=file_path, with_ai=False)

        # Save with analyzing status, AI will update later
        status = "analyzing" if with_ai else "completed"
        record = save_insight(result, file.filename, len(content_bytes), owner_id=current_user["id"], status=status)
        response_data = result.model_dump()
        response_data["record_id"] = record.id
        response_data["status"] = status

        # Start async AI analysis in background
        if with_ai:
            analyze_async(result, record_id=record.id, owner_id=current_user["id"])

        return success_response("Document uploaded, AI analysis in progress", response_data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


@router.post("/parse_repo")
async def parse_repo(
    request: ParseRequest,
    with_ai: bool = Query(default=True),
    current_user=Depends(get_current_user),
):
    if not request.repo_url:
        raise HTTPException(status_code=400, detail="repo_url is required")

    try:
        result = parse_document("repo", content=request.repo_url, with_ai=False)
        status = "analyzing" if with_ai else "completed"
        record = save_insight(result, request.repo_url, 0, owner_id=current_user["id"], status=status)
        response_data = result.model_dump()
        response_data["record_id"] = record.id
        response_data["status"] = status

        if with_ai:
            analyze_async(result, record_id=record.id, owner_id=current_user["id"])

        return success_response("Repository uploaded, AI analysis in progress", response_data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _resolve_source_type(content_type: str | None, ext: str) -> str | None:
    if content_type and content_type in ALLOWED_DOCUMENT_TYPES:
        resolved = ALLOWED_DOCUMENT_TYPES[content_type]
        if resolved:
            return resolved

    ext_map = {
        ".md": "markdown",
        ".markdown": "markdown",
        ".pdf": "pdf",
        ".docx": "docx",
    }
    return ext_map.get(ext)
