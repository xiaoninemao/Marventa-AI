import asyncio
import logging
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from openai import APIConnectionError, APIStatusError, AuthenticationError
from app.engines.content_generator.models import (
    SessionResponse, ChatRequest, ChatMessage, SetReferencesRequest,
    ModifyCardRequest, ModifyCardResponse,
)
from app.engines.content_generator.storage import (
    create_session, get_session, list_sessions, update_session, delete_session,
    save_next_version, get_versions, get_version,
)
from app.engines.content_generator.ai_analyzer import chat, generate_async, build_reference_context, modify_card, generate_document
from app.engines.portfolio.storage import create_script
from app.shared.response import success_response
from app.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/v1/content_generator", tags=["content_generator"])
logger = logging.getLogger(__name__)
_document_jobs: set[tuple[str, str]] = set()


def _ai_http_exception(exc: Exception) -> HTTPException:
    if isinstance(exc, AuthenticationError):
        return HTTPException(status_code=502, detail="AI 鉴权失败，请检查 backend/.env 里的 CASE_AI_API_KEY 是否有效。")
    if isinstance(exc, APIConnectionError):
        return HTTPException(status_code=502, detail="无法连接 AI 服务，请检查 CASE_AI_BASE_URL 和网络。")
    if isinstance(exc, APIStatusError):
        return HTTPException(status_code=502, detail=f"AI 服务返回错误 {exc.status_code}，请检查模型名、额度或服务状态。")
    return HTTPException(status_code=500, detail="AI 生成失败，请检查后端日志。")


def _generate_document_job(session_id: str, user_id: str) -> None:
    job_key = (user_id, session_id)
    try:
        session = get_session(session_id)
        if not session or session.user_id != user_id or not session.cards:
            return
        msg_dicts = [m.model_dump() for m in session.messages]
        content = generate_document(session.cards, msg_dicts)
        create_script(
            user_id,
            title=session.title or "综合营销策划文档",
            content=content,
            source_session_id=session_id,
        )
    except Exception:
        logger.exception("Failed to generate portfolio document for session %s", session_id)
    finally:
        _document_jobs.discard(job_key)


@router.get("/health")
async def health_check():
    return success_response("Content generator service is running", {"status": "healthy"})


@router.post("/sessions")
async def create_new_session(current_user=Depends(get_current_user)):
    session = create_session(current_user["id"])
    return success_response("Session created", session.model_dump())


@router.get("/sessions")
async def list_my_sessions(current_user=Depends(get_current_user)):
    sessions = list_sessions(current_user["id"])
    return success_response("Sessions retrieved", [s.model_dump() for s in sessions])


@router.get("/sessions/{session_id}")
async def get_session_detail(session_id: str, current_user=Depends(get_current_user)):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
    return success_response("Session retrieved", session.model_dump())


@router.post("/sessions/{session_id}/chat")
async def send_chat_message(
    session_id: str,
    req: ChatRequest,
    current_user=Depends(get_current_user),
):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")

    # Persist reference IDs if any are provided
    if req.insight_ids or req.case_ids:
        update_session(session_id, insight_ids=req.insight_ids, case_ids=req.case_ids)

    # Build reference context from the request (fresh, not from DB)
    ref_ctx = build_reference_context(
        req.insight_ids, req.case_ids, current_user["id"],
    )

    # Build message history + new user message
    msg_dicts = [m.model_dump() for m in session.messages]
    msg_dicts.append({"role": "user", "content": req.message})

    # Auto-generate title from first user message if not set
    title = session.title
    if not title:
        title = req.message[:40] + ("..." if len(req.message) > 40 else "")

    # Persist user message immediately so session appears in history right away
    user_messages = [ChatMessage(**m) for m in msg_dicts]
    update_session(session_id, messages=user_messages, title=title)

    # Get AI reply
    try:
        reply_content = await asyncio.to_thread(chat, msg_dicts, reference_context=ref_ctx)
    except Exception as exc:
        raise _ai_http_exception(exc) from exc
    assistant_msg = ChatMessage(role="assistant", content=reply_content)
    msg_dicts.append(assistant_msg.model_dump())

    # Update session with AI reply
    all_messages = [ChatMessage(**m) for m in msg_dicts]
    updated = update_session(session_id, messages=all_messages, title=title)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update session")

    return success_response("Message sent", {
        "reply": assistant_msg.model_dump(),
        "session": updated.model_dump(),
    })


@router.post("/sessions/{session_id}/generate")
async def trigger_generation(session_id: str, current_user=Depends(get_current_user)):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.messages:
        raise HTTPException(status_code=400, detail="No messages in session")

    update_session(session_id, status="generating")
    generate_async(session_id)
    return success_response("Generation started", {"status": "generating"})


@router.put("/sessions/{session_id}/references")
async def set_session_references(
    session_id: str,
    req: SetReferencesRequest,
    current_user=Depends(get_current_user),
):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")

    updated = update_session(session_id, insight_ids=req.insight_ids, case_ids=req.case_ids)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update session")
    return success_response("References updated", updated.model_dump())


@router.post("/sessions/{session_id}/cards/{card_id}/modify")
async def modify_session_card(
    session_id: str,
    card_id: str,
    req: ModifyCardRequest,
    current_user=Depends(get_current_user),
):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")

    card = next((c for c in session.cards if c.id == card_id), None)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    msg_dicts = [m.model_dump() for m in session.messages]
    try:
        modified = await asyncio.to_thread(modify_card, card, req.instruction, msg_dicts)
    except Exception as exc:
        raise _ai_http_exception(exc) from exc

    new_cards = [modified if c.id == card_id else c for c in session.cards]
    updated = update_session(session_id, cards=new_cards)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update session")

    saved_version = save_next_version(session_id, new_cards, is_major_bump=False)

    return success_response("Card modified", {"card": modified.model_dump(), "version": saved_version.model_dump()})


@router.get("/sessions/{session_id}/versions")
async def list_session_versions(session_id: str, current_user=Depends(get_current_user)):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
    versions = get_versions(session_id)
    return success_response("Versions retrieved", [v.model_dump() for v in versions])


@router.post("/sessions/{session_id}/versions/{version_id}/restore")
async def restore_session_version(session_id: str, version_id: str, current_user=Depends(get_current_user)):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
    version = get_version(version_id)
    if not version or version.session_id != session_id:
        raise HTTPException(status_code=404, detail="Version not found")
    updated = update_session(session_id, cards=version.cards)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to restore version")
    saved_version = save_next_version(session_id, version.cards, is_major_bump=False)
    return success_response("Version restored", {
        "version": saved_version.model_dump(),
        "session": updated.model_dump(),
    })


@router.post("/sessions/{session_id}/generate_document")
async def generate_session_document(
    session_id: str,
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.cards:
        raise HTTPException(status_code=400, detail="No cards to generate document from")

    job_key = (current_user["id"], session_id)
    if job_key not in _document_jobs:
        _document_jobs.add(job_key)
        background_tasks.add_task(_generate_document_job, session_id, current_user["id"])

    return success_response("Document generation queued", {
        "status": "queued",
        "source_session_id": session_id,
    })


@router.delete("/sessions/{session_id}")
async def delete_my_session(session_id: str, current_user=Depends(get_current_user)):
    session = get_session(session_id, current_user["id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
    delete_session(session_id)
    return success_response("Session deleted")
