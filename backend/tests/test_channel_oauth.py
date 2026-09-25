import json
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import httpx

from app.engines.publishing import channel_oauth


class ChannelOAuthTests(unittest.IsolatedAsyncioTestCase):
    async def test_douyin_uses_official_web_oauth_contract(self):
        with (
            patch.multiple(
                channel_oauth,
                DOUYIN_CHANNEL_CLIENT_KEY="douyin-key",
                DOUYIN_CHANNEL_CLIENT_SECRET="douyin-secret",
                DOUYIN_CHANNEL_REDIRECT_URI="https://app.example/oauth/douyin",
            ),
            patch.object(
                channel_oauth,
                "ensure_channel_credential_encryption",
            ),
            patch.object(channel_oauth, "ensure_project_channel_access"),
            patch.object(
                channel_oauth,
                "create_channel_authorization_state",
                return_value="signed-state",
            ),
        ):
            started = await channel_oauth.start_channel_authorization(
                "user-1", "project-1", "douyin",
            )
        query = parse_qs(urlparse(started.authorization_url).query)
        self.assertEqual(started.mode, "redirect")
        self.assertEqual(query["client_key"], ["douyin-key"])
        self.assertEqual(query["scope"], ["user_info"])
        self.assertEqual(
            query["redirect_uri"],
            ["https://app.example/oauth/douyin"],
        )
        self.assertEqual(query["state"], ["signed-state"])

        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path == "/oauth/access_token/":
                form = parse_qs(request.content.decode())
                self.assertEqual(form["grant_type"], ["authorization_code"])
                self.assertEqual(form["client_secret"], ["douyin-secret"])
                return httpx.Response(200, json={
                    "data": {
                        "access_token": "douyin-access",
                        "refresh_token": "douyin-refresh",
                        "open_id": "douyin-open-id",
                        "scope": "user_info",
                        "expires_in": 1296000,
                        "refresh_expires_in": 2592000,
                        "error_code": 0,
                    },
                    "message": "success",
                })
            self.assertEqual(
                json.loads(request.content),
                {
                    "access_token": "douyin-access",
                    "open_id": "douyin-open-id",
                },
            )
            return httpx.Response(200, json={
                "err_no": 0,
                "data": {
                    "error_code": 0,
                    "open_id": "douyin-open-id",
                    "union_id": "douyin-union-id",
                    "nickname": "Douyin creator",
                    "avatar": "https://example.com/douyin-avatar.jpg",
                },
            })

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
        ) as client:
            with (
                patch.multiple(
                    channel_oauth,
                    DOUYIN_CHANNEL_CLIENT_KEY="douyin-key",
                    DOUYIN_CHANNEL_CLIENT_SECRET="douyin-secret",
                    DOUYIN_CHANNEL_REDIRECT_URI="https://app.example/oauth/douyin",
                ),
                patch.object(
                    channel_oauth,
                    "ensure_channel_credential_encryption",
                ),
                patch.object(channel_oauth, "ensure_project_channel_access"),
            ):
                grant = await channel_oauth.exchange_douyin_code(
                    "authorization-code",
                    client=client,
                )
        self.assertEqual(len(requests), 2)
        self.assertEqual(grant.platform_user_id, "douyin-open-id")
        self.assertEqual(grant.account_name, "Douyin creator")
        self.assertEqual(grant.scopes, ["user_info"])
        self.assertEqual(grant.credentials["refresh_token"], "douyin-refresh")

    async def test_xiaohongshu_uses_device_authorization_contract(self):
        requests: list[httpx.Request] = []

        def start_handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            payload = json.loads(request.content)
            self.assertEqual(payload["scopes"], ["basic_info"])
            self.assertEqual(payload["scene"], "web")
            return httpx.Response(200, json={
                "code": 0,
                "success": True,
                "data": {
                    "device_code": "xhs-device-code",
                    "user_code": "ABCD-EFGH",
                    "verification_uri_complete": (
                        "https://openaccount.xiaohongshu.com/device"
                        "?user_code=ABCD-EFGH"
                    ),
                    "expires_in": 600,
                    "interval": 2,
                },
            })

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(start_handler),
        ) as client:
            with (
                patch.multiple(
                    channel_oauth,
                    XIAOHONGSHU_CHANNEL_APP_ID="xhs-app",
                    XIAOHONGSHU_CHANNEL_APP_SECRET="xhs-secret",
                ),
                patch.object(
                    channel_oauth,
                    "ensure_channel_credential_encryption",
                ),
                patch.object(channel_oauth, "ensure_project_channel_access"),
                patch.object(
                    channel_oauth,
                    "create_channel_authorization_state",
                    return_value="xhs-signed-state",
                ),
                patch.object(channel_oauth, "attach_device_authorization") as attach,
            ):
                started = await channel_oauth.start_channel_authorization(
                    "user-1",
                    "project-1",
                    "xiaohongshu",
                    client=client,
                )
        self.assertEqual(started.mode, "device")
        self.assertEqual(started.interval, 2)
        self.assertEqual(started.user_code, "ABCD-EFGH")
        attach.assert_called_once_with(
            "xhs-signed-state",
            "xiaohongshu",
            provider_code="xhs-device-code",
            poll_interval_seconds=2,
        )

        def poll_handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/device/token"):
                return httpx.Response(200, json={
                    "code": 0,
                    "success": True,
                    "data": {
                        "access_token": "xhs-access",
                        "refresh_token": "xhs-refresh",
                        "open_id": "xhs-open-id",
                        "scope": ["basic_info"],
                        "expire_time": 1790000000,
                        "refresh_expire_time": 1800000000,
                    },
                })
            self.assertEqual(request.headers["Authorization"], "xhs-access")
            self.assertEqual(request.content, b"")
            return httpx.Response(200, json={
                "code": 0,
                "success": True,
                "data": {
                    "open_id": "xhs-open-id",
                    "nickname": "Xiaohongshu creator",
                    "avatar": "https://example.com/xhs-avatar.jpg",
                },
            })

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(poll_handler),
        ) as client:
            with (
                patch.multiple(
                    channel_oauth,
                    XIAOHONGSHU_CHANNEL_APP_ID="xhs-app",
                    XIAOHONGSHU_CHANNEL_APP_SECRET="xhs-secret",
                ),
                patch.object(
                    channel_oauth,
                    "ensure_channel_credential_encryption",
                ),
            ):
                polled = await channel_oauth.poll_xiaohongshu_authorization(
                    "xhs-device-code",
                    2,
                    client=client,
                )
        self.assertEqual(polled.status, "authorized")
        self.assertIsNotNone(polled.grant)
        assert polled.grant is not None
        self.assertEqual(polled.grant.platform_user_id, "xhs-open-id")
        self.assertEqual(polled.grant.account_name, "Xiaohongshu creator")
        self.assertEqual(polled.grant.scopes, ["basic_info"])

    async def test_xiaohongshu_pending_and_slow_down_statuses(self):
        responses = iter([
            {"code": 37002, "success": False, "msg": "authorization_pending"},
            {"code": 37009, "success": False, "msg": "scanned"},
            {"code": 37003, "success": False, "msg": "slow_down"},
        ])

        def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=next(responses))

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
        ) as client:
            with (
                patch.multiple(
                    channel_oauth,
                    XIAOHONGSHU_CHANNEL_APP_ID="xhs-app",
                    XIAOHONGSHU_CHANNEL_APP_SECRET="xhs-secret",
                ),
                patch.object(
                    channel_oauth,
                    "ensure_channel_credential_encryption",
                ),
            ):
                pending = await channel_oauth.poll_xiaohongshu_authorization(
                    "device", 2, client=client,
                )
                scanned = await channel_oauth.poll_xiaohongshu_authorization(
                    "device", 2, client=client,
                )
                slowed = await channel_oauth.poll_xiaohongshu_authorization(
                    "device", 2, client=client,
                )
        self.assertEqual((pending.status, pending.interval), ("pending", 2))
        self.assertEqual((scanned.status, scanned.interval), ("scanned", 2))
        self.assertEqual((slowed.status, slowed.interval), ("pending", 7))
