from __future__ import annotations

import json

from cryptography.fernet import Fernet, InvalidToken

from app.config import CHANNEL_CREDENTIAL_ENCRYPTION_KEY


class ChannelCredentialEncryptionUnavailable(RuntimeError):
    pass


class InvalidChannelCredential(RuntimeError):
    pass


def _cipher() -> Fernet:
    if not CHANNEL_CREDENTIAL_ENCRYPTION_KEY:
        raise ChannelCredentialEncryptionUnavailable(
            "Channel credential encryption is not configured",
        )
    try:
        return Fernet(CHANNEL_CREDENTIAL_ENCRYPTION_KEY.encode("ascii"))
    except (TypeError, ValueError) as exc:
        raise ChannelCredentialEncryptionUnavailable(
            "Channel credential encryption key is invalid",
        ) from exc


def ensure_channel_credential_encryption() -> None:
    _cipher()


def encrypt_channel_credentials(credentials: dict[str, object]) -> str:
    payload = json.dumps(
        credentials,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return _cipher().encrypt(payload).decode("ascii")


def decrypt_channel_credentials(credential_blob: str) -> dict[str, object]:
    try:
        payload = _cipher().decrypt(credential_blob.encode("ascii"))
        parsed = json.loads(payload)
    except (InvalidToken, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InvalidChannelCredential("Stored channel credential is invalid") from exc
    if not isinstance(parsed, dict):
        raise InvalidChannelCredential("Stored channel credential is invalid")
    return parsed
