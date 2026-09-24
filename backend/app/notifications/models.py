from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: str
    organization_id: str
    kind: str
    data: dict[str, str]
    action_url: str
    is_read: bool
    created_at: str


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    unread_count: int
