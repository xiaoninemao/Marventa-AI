from fastapi import APIRouter, HTTPException, Depends

from app.auth.dependencies import can_manage_organization_record, get_current_user
from app.engines.portfolio.models import ScriptCreate, ScriptUpdate
from app.engines.portfolio.storage import (
    create_script, get_script, list_scripts, update_script, delete_script,
)
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/portfolio", tags=["portfolio"])


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/scripts")
async def list_my_scripts(current_user=Depends(get_current_user)):
    scripts = list_scripts(current_user["id"])
    return success_response("ok", [s.model_dump() for s in scripts])


@router.get("/scripts/{script_id}")
async def get_my_script(script_id: str, current_user=Depends(get_current_user)):
    s = get_script(script_id, current_user["id"])
    if not s:
        raise HTTPException(status_code=404, detail="Script not found")
    return success_response("ok", s.model_dump())


@router.post("/scripts")
async def create_my_script(req: ScriptCreate, current_user=Depends(get_current_user)):
    s = create_script(current_user["id"], req.title, req.content, req.source_session_id)
    return success_response("created", s.model_dump())


@router.put("/scripts/{script_id}")
async def update_my_script(script_id: str, req: ScriptUpdate, current_user=Depends(get_current_user)):
    s = get_script(script_id, current_user["id"])
    if not s:
        raise HTTPException(status_code=404, detail="Script not found")
    if not can_manage_organization_record(current_user, s.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    updated = update_script(script_id, title=req.title, content=req.content)
    return success_response("updated", updated.model_dump())


@router.delete("/scripts/{script_id}")
async def delete_my_script(script_id: str, current_user=Depends(get_current_user)):
    s = get_script(script_id, current_user["id"])
    if not s:
        raise HTTPException(status_code=404, detail="Script not found")
    if not can_manage_organization_record(current_user, s.user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    delete_script(script_id)
    return success_response("deleted")
