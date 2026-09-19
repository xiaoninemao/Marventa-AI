import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router
from app.auth import storage


class AccountRegistrationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(patch.object(storage, "DB_PATH", str(Path(directory.name) / "auth.db")))
        self.enterContext(patch("app.api.auth.DEBUG", False))
        app = FastAPI()
        app.include_router(router)
        self.client = self.enterContext(TestClient(app))

    def register(self, **overrides):
        payload = {"email": "example@example.com", "password": "example-password"}
        payload.update(overrides)
        return self.client.post("/api/v1/auth/register", json=payload)

    def test_register_with_email_and_password_then_login(self):
        response = self.register(email="  Example@Example.com  ")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["user"]["username"], "example")
        self.assertEqual(data["user"]["nickname"], "example")
        self.assertEqual(data["user"]["email"], "example@example.com")
        self.assertEqual(storage.get_user_by_id(data["user"]["id"])["nickname"], "example")
        me = self.client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {data['access_token']}"},
        )
        self.assertEqual(me.status_code, 200)
        login = self.client.post(
            "/api/v1/auth/login",
            json={"email": "example@example.com", "password": "example-password"},
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["data"]["user"]["id"], data["user"]["id"])

    def test_empty_optional_nickname_uses_email_prefix(self):
        response = self.register(nickname=" ")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["user"]["nickname"], "example")

    def test_optional_display_name_is_supported(self):
        response = self.register(nickname="Display name")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["user"]["nickname"], "Display name")

    def test_missing_empty_and_invalid_email_are_rejected(self):
        self.assertEqual(
            self.client.post("/api/v1/auth/register", json={"password": "example-password"}).status_code,
            422,
        )
        for email, detail in (
            ("", "邮箱不能为空"),
            ("plain-address", "邮箱格式不正确"),
            ("missing-domain@", "邮箱格式不正确"),
            ("missing-tld@example", "邮箱格式不正确"),
        ):
            with self.subTest(email=email):
                response = self.register(email=email)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"], detail)

    def test_short_password_is_rejected(self):
        response = self.register(password="12345")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "密码至少需要6个字符")

    def test_duplicate_email_is_rejected_in_production(self):
        self.assertEqual(self.register().status_code, 200)
        response = self.register(email="EXAMPLE@EXAMPLE.COM")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "该邮箱已被注册")

    def test_incorrect_password_is_rejected(self):
        self.assertEqual(self.register().status_code, 200)
        response = self.client.post(
            "/api/v1/auth/login", json={"email": "example@example.com", "password": "incorrect"},
        )
        self.assertEqual(response.status_code, 401)

    def test_legacy_username_login_remains_supported(self):
        data = self.register().json()["data"]
        response = self.client.post(
            "/api/v1/auth/login", json={"login": data["user"]["username"], "password": "example-password"},
        )
        self.assertEqual(response.status_code, 200)

    def test_removed_github_oauth_routes_return_not_found(self):
        for path in (
            "/api/v1/auth/oauth/github/start",
            "/api/v1/auth/oauth/github/callback?code=unused&state=unused",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_auth_schema_exposes_only_supported_routes(self):
        schema = self.client.get("/openapi.json").json()
        paths = schema["paths"]
        self.assertEqual(set(paths), {
            "/api/v1/auth/register",
            "/api/v1/auth/login",
            "/api/v1/auth/me",
            "/api/v1/auth/verify",
        })
        self.assertEqual(
            set(schema["components"]["schemas"]["UserLogin"]["properties"]),
            {"email", "password"},
        )

    def test_token_verification_and_profile_updates_are_preserved(self):
        data = self.register().json()["data"]
        headers = dict(Authorization="Bearer " + data["access_token"])
        verified = self.client.post("/api/v1/auth/verify", headers=headers)
        self.assertEqual(verified.status_code, 200)
        self.assertEqual(verified.json()["data"]["id"], data["user"]["id"])
        updated = self.client.put(
            "/api/v1/auth/me", headers=headers, json={"nickname": "Updated name"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["data"]["nickname"], "Updated name")


if __name__ == "__main__":
    unittest.main()
