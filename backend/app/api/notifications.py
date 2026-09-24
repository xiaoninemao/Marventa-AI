import json

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.dependencies import get_current_user
from app.notifications.models import NotificationListResponse, NotificationResponse
from app.notifications.storage import (
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    unread_notification_count,
)
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


def _notification_response(row) -> NotificationResponse:
    return NotificationResponse(
        id=row["id"],
        organization_id=row["organization_id"],
        kind=row["kind"],
        data=json.loads(row["data_json"]),
        action_url=row["action_url"],
        is_read=bool(row["is_read"]),
        created_at=row["created_at"],
    )


@router.get("")
async def get_notifications(
    limit: int = Query(default=30, ge=1, le=100),
    user=Depends(get_current_user),
):
    items = [_notification_response(row) for row in list_notifications(user["id"], limit)]
    data = NotificationListResponse(
        items=items,
        unread_count=unread_notification_count(user["id"]),
    )
    return success_response("Notifications retrieved", data.model_dump())


@router.patch("/{notification_id}/read")
async def read_notification(notification_id: str, user=Depends(get_current_user)):
    if not mark_notification_read(user["id"], notification_id):
        raise HTTPException(status_code=404, detail="Notification not found")
    return success_response("Notification marked as read")


@router.post("/read-all")
async def read_all_notifications(user=Depends(get_current_user)):
    count = mark_all_notifications_read(user["id"])
    return success_response("Notifications marked as read", {"updated_count": count})
