from __future__ import annotations

from pydantic import BaseModel


class ApiResponse(BaseModel):
    success: bool
    message: str
    data: object | None = None


def success_response(message: str, data: object = None) -> ApiResponse:
    return ApiResponse(success=True, message=message, data=data)
