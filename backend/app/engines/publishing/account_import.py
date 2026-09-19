from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import os
import re
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from typing import Any

from cryptography.fernet import Fernet

from app.config import DATA_ENCRYPTION_KEY, JWT_SECRET


def _fernet(secret: str) -> Fernet:
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_cookie_payload(payload: dict[str, Any]) -> str:
    secret = DATA_ENCRYPTION_KEY or JWT_SECRET
    encrypted = _fernet(secret).encrypt(
        json.dumps(payload, ensure_ascii=False).encode("utf-8")
    ).decode("utf-8")
    return f"v2:{encrypted}"


def decrypt_cookie_payload(value: str) -> dict[str, Any]:
    version, separator, encrypted = value.partition(":")
    if separator and version == "v2":
        secrets = [DATA_ENCRYPTION_KEY or JWT_SECRET]
    else:
        encrypted = value
        secrets = [JWT_SECRET]
        if DATA_ENCRYPTION_KEY:
            secrets.insert(0, DATA_ENCRYPTION_KEY)
    for secret in dict.fromkeys(secrets):
        try:
            raw = _fernet(secret).decrypt(encrypted.encode("utf-8"))
            result = json.loads(raw.decode("utf-8"))
            if isinstance(result, dict):
                return result
        except Exception:
            continue
    raise ValueError("Encrypted credential could not be decrypted")


def write_encrypted_json(path: str, payload: dict[str, Any]) -> None:
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    encrypted = encrypt_cookie_payload(payload).encode("utf-8")
    fd, temp_path = tempfile.mkstemp(prefix=".state-", dir=directory)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(encrypted)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_path, 0o600)
        os.replace(temp_path, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def read_encrypted_json(path: str) -> dict[str, Any]:
    with open(path, "rb") as handle:
        raw = handle.read()
    text = raw.decode("utf-8")
    if text.startswith("v2:"):
        return decrypt_cookie_payload(text)
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("Browser storage state must be a JSON object")
    return parsed


def parse_cookie_payload(cookie_format: str, content: str) -> dict[str, str]:
    content = (content or "").strip()
    if not content:
        raise ValueError("Cookie 内容不能为空")
    fmt = (cookie_format or "json").lower()
    if fmt == "raw":
        return _parse_raw_cookie(content)
    if fmt == "json":
        return _parse_json_cookie(content)
    raise ValueError("仅支持 JSON Cookie 或浏览器原始 Cookie 字符串")


def validate_platform_cookie(platform: str, account_type: str, cookies: dict[str, str]) -> tuple[str, list[str]]:
    names = set(cookies)
    warnings: list[str] = []
    platform = platform.lower()
    account_type = (account_type or "ordinary").lower()

    if platform == "xiaohongshu":
        required = {"web_session", "a1"} if account_type == "ordinary" else {"access-token-creator"}
        if not required.intersection(names):
            raise ValueError("小红书 Cookie 未识别到 web_session/a1 或创作者 token")
        if "web_session" not in names:
            warnings.append("未检测到 web_session，后续自动读取可能受限")
        return "valid", warnings

    if platform == "douyin":
        preferred = {"sessionid", "passport_csrf_token", "sid_guard", "odin_tt", "ttwid"}
        if not preferred.intersection(names):
            raise ValueError("抖音 Cookie 未识别到 sessionid、passport_csrf_token、sid_guard、odin_tt 或 ttwid")
        if "sessionid" not in names:
            warnings.append("未检测到 sessionid，发布接口/RPA 可能需要重新校验")
        return "valid", warnings

    raise ValueError("暂不支持该平台")


def cookie_hint(cookies: dict[str, str]) -> str:
    parts = []
    for name in sorted(cookies)[:8]:
        value = cookies[name]
        if len(value) <= 8:
            masked = "***"
        else:
            masked = f"{value[:4]}***{value[-4:]}"
        parts.append(f"{name}={masked}")
    return "; ".join(parts)


def build_memory_seed(platform: str, account_name: str, profile_url: str = "") -> dict[str, Any]:
    label = "抖音" if platform == "douyin" else "小红书"
    return {
        "platform": platform,
        "account_name": account_name,
        "brand_positioning": f"{account_name} 的{label}内容账号，已完成登录态绑定。",
        "target_users": "已绑定账号，可结合账号主页、历史内容和后续发布数据继续自动补全。",
        "product_selling_points": "",
        "content_style": f"系统已保存账号登录态{f'，主页：{profile_url}' if profile_url else ''}。后续会按发布表现沉淀稳定风格。",
        "banned_expressions": [],
        "common_tags": [],
        "high_performing_content": [],
        "low_performing_directions": [],
        "ai_operation_lessons": [f"{label}账号已绑定，发布管理可选择该账号执行发布和数据回收。"],
    }


def rows_from_cookie_file(filename: str, data: bytes) -> list[dict[str, str]]:
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if suffix == "csv":
        return _rows_from_csv(data)
    if suffix == "xlsx":
        return _rows_from_xlsx(data)
    raise ValueError("批量导入仅支持 CSV 或 XLSX")


def _parse_json_cookie(content: str) -> dict[str, str]:
    parsed = json.loads(content)
    if isinstance(parsed, dict):
        if "cookies" in parsed:
            parsed = parsed["cookies"]
        else:
            return {str(k): str(v) for k, v in parsed.items() if v is not None}
    if isinstance(parsed, list):
        result = {}
        for item in parsed:
            if isinstance(item, dict) and item.get("name"):
                result[str(item["name"])] = str(item.get("value", ""))
        if result:
            return result
    raise ValueError("JSON Cookie 格式应为浏览器导出的数组或键值对象")


def _parse_raw_cookie(content: str) -> dict[str, str]:
    result = {}
    for part in content.split(";"):
        if "=" not in part:
            continue
        name, value = part.split("=", 1)
        name = name.strip()
        if name:
            result[name] = value.strip()
    if not result:
        raise ValueError("原始 Cookie 字符串未解析到有效键值")
    return result


def _rows_from_csv(data: bytes) -> list[dict[str, str]]:
    text = data.decode("utf-8-sig")
    return [dict(row) for row in csv.DictReader(io.StringIO(text))]


def _rows_from_xlsx(data: bytes) -> list[dict[str, str]]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        shared = _xlsx_shared_strings(zf)
        sheet_name = next((name for name in zf.namelist() if name.startswith("xl/worksheets/sheet")), "")
        if not sheet_name:
            return []
        root = ET.fromstring(zf.read(sheet_name))
    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows: list[list[str]] = []
    for row in root.findall(".//x:sheetData/x:row", ns):
        values: list[str] = []
        for cell in row.findall("x:c", ns):
            raw = cell.findtext("x:v", default="", namespaces=ns)
            if cell.attrib.get("t") == "s" and raw:
                raw = shared[int(raw)]
            values.append(raw)
        rows.append(values)
    if not rows:
        return []
    headers = [_normalize_header(value) for value in rows[0]]
    return [{headers[i]: value for i, value in enumerate(row) if i < len(headers)} for row in rows[1:]]


def _xlsx_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    values = []
    for item in root.findall("x:si", ns):
        values.append("".join(node.text or "" for node in item.findall(".//x:t", ns)))
    return values


def _normalize_header(value: str) -> str:
    value = re.sub(r"\s+", "_", (value or "").strip().lower())
    aliases = {
        "平台": "platform",
        "账号类型": "account_type",
        "cookie": "cookie_content",
        "备注": "remark",
        "账号名称": "account_name",
        "主页": "profile_url",
        "平台用户id": "platform_user_id",
        "昵称": "nickname",
    }
    return aliases.get(value, value)
