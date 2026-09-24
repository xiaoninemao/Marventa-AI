import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.notifications import router as notification_router
from app.api.organizations import router as organization_router
from app.auth import storage as auth_storage
from app.auth.security import create_access_token
from app.notifications import storage as notification_storage


class NotificationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db_path = str(Path(directory.name) / "notifications.db")
        self.enterContext(patch.object(auth_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(notification_storage, "DB_PATH", self.db_path))
        self.owner = auth_storage.create_user("owner", "owner@example.com", "test-hash", "Owner")
        self.member = auth_storage.create_user("member", "member@example.com", "test-hash", "Member")
        self.app = FastAPI()
        self.app.include_router(organization_router)
        self.app.include_router(notification_router)
        self.client = self.enterContext(TestClient(self.app))
        self.owner_headers = self.headers_for(self.owner["id"])
        self.member_headers = self.headers_for(self.member["id"])

    @staticmethod
    def headers_for(user_id):
        token = create_access_token(user_id)
        return {"Authorization": "Bearer " + token}

    def create_organization(self):
        response = self.client.post(
            "/api/v1/organizations",
            headers=self.owner_headers,
            json={"name": "Growth Team"},
        )
        self.assertEqual(response.status_code, 200)
        return response.json()["data"]

    def invite_member(self, organization_id):
        response = self.client.post(
            f"/api/v1/organizations/{organization_id}/members",
            headers=self.owner_headers,
            json={"email": "member@example.com", "role": "member"},
        )
        self.assertEqual(response.status_code, 200)

    def test_invitation_creates_private_unread_notification(self):
        organization = self.create_organization()
        self.invite_member(organization["id"])

        owner = self.client.get("/api/v1/notifications", headers=self.owner_headers).json()["data"]
        self.assertEqual(owner, {"items": [], "unread_count": 0})

        response = self.client.get("/api/v1/notifications", headers=self.member_headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["unread_count"], 1)
        self.assertEqual(len(data["items"]), 1)
        item = data["items"][0]
        self.assertEqual(item["kind"], "organization_invitation")
        self.assertEqual(item["organization_id"], organization["id"])
        self.assertEqual(item["data"], {
            "actor_name": "Owner",
            "organization_name": "Growth Team",
            "role": "member",
        })
        self.assertEqual(item["action_url"], f"/organizations/{organization['id']}")
        self.assertFalse(item["is_read"])

    def test_read_operations_are_scoped_to_recipient(self):
        organization = self.create_organization()
        self.invite_member(organization["id"])
        item = self.client.get(
            "/api/v1/notifications", headers=self.member_headers,
        ).json()["data"]["items"][0]

        self.assertEqual(
            self.client.patch(
                f"/api/v1/notifications/{item['id']}/read",
                headers=self.owner_headers,
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.patch(
                f"/api/v1/notifications/{item['id']}/read",
                headers=self.member_headers,
            ).status_code,
            200,
        )
        data = self.client.get(
            "/api/v1/notifications", headers=self.member_headers,
        ).json()["data"]
        self.assertEqual(data["unread_count"], 0)
        self.assertTrue(data["items"][0]["is_read"])

    def test_role_changes_notify_only_when_role_changes(self):
        organization = self.create_organization()
        self.invite_member(organization["id"])
        path = f"/api/v1/organizations/{organization['id']}/members/{self.member['id']}"
        self.assertEqual(
            self.client.patch(path, headers=self.owner_headers, json={"role": "admin"}).status_code,
            200,
        )
        self.assertEqual(
            self.client.patch(path, headers=self.owner_headers, json={"role": "admin"}).status_code,
            200,
        )

        data = self.client.get(
            "/api/v1/notifications", headers=self.member_headers,
        ).json()["data"]
        self.assertEqual(data["unread_count"], 2)
        self.assertEqual(
            [item["kind"] for item in data["items"]],
            ["organization_role_changed", "organization_invitation"],
        )
        self.assertEqual(data["items"][0]["data"]["role"], "admin")

        response = self.client.post("/api/v1/notifications/read-all", headers=self.member_headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["updated_count"], 2)
        self.assertEqual(
            self.client.get(
                "/api/v1/notifications", headers=self.member_headers,
            ).json()["data"]["unread_count"],
            0,
        )

    def test_notification_routes_require_authentication(self):
        self.assertEqual(self.client.get("/api/v1/notifications").status_code, 401)
        self.assertEqual(self.client.patch("/api/v1/notifications/missing/read").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/notifications/read-all").status_code, 401)
