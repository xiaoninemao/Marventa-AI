import base64
import binascii
import hashlib
import os
import re
import tempfile

from fastapi import HTTPException

from app.config import MEDIA_ROOT


_IMAGE_DATA_URL = re.compile(
    r"^data:(image/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\\s]+)$"
)
_IMAGE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}


def _valid_image_signature(mime_type: str, data: bytes) -> bool:
    if mime_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if mime_type == "image/gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    return len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP"


def store_image_data_url(
    value: str,
    category: str,
    owner_id: str,
    base_url: str,
    invalid_detail: str,
) -> str:
    match = _IMAGE_DATA_URL.fullmatch(value)
    if not match:
        return value
    mime_type, encoded = match.groups()
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail=invalid_detail) from exc
    if not data or len(data) > 2 * 1024 * 1024 or not _valid_image_signature(mime_type, data):
        raise HTTPException(status_code=400, detail=invalid_detail)

    directory = os.path.join(MEDIA_ROOT, category, owner_id)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    filename = f"{hashlib.sha256(data).hexdigest()[:24]}.{_IMAGE_EXTENSIONS[mime_type]}"
    destination = os.path.join(directory, filename)
    if not os.path.exists(destination):
        fd, temp_path = tempfile.mkstemp(prefix=".image-", dir=directory)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temp_path, 0o600)
            os.replace(temp_path, destination)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
    return f"{base_url.rstrip('/')}/media/{category}/{owner_id}/{filename}"
