import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router as auth_router
from app.api.organizations import router as organization_router
from app.auth import storage
from app.auth.security import create_access_token, hash_password


class OrganizationManagementTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db_path = str(Path(directory.name) / "organizations.db")
        self.enterContext(patch.object(storage, "DB_PATH", self.db_path))
        self.owner = storage.create_user("owner", "", "test-hash")
        self.other = storage.create_user("other", "other@example.com", "test-hash")
        self.app = FastAPI()
        self.app.include_router(auth_router)
        self.app.include_router(organization_router)
        self.client = self.enterContext(TestClient(self.app))
        self.headers = self.headers_for(self.owner["id"])

    def headers_for(self, user_id):
        return {"Authorization": f"Bearer {create_access_token(user_id)}"}

    def create(self, name="Product Team"):
        response = self.client.post("/api/v1/organizations", headers=self.headers, json={"name": name})
        self.assertEqual(response.status_code, 200)
        return response.json()["data"]

    def test_new_default_name_and_active_preference(self):
        default = storage.get_default_organization(self.owner["id"])
        current = storage.get_current_organization(self.owner["id"])
        self.assertEqual(default["name"], "owner的组织")
        self.assertTrue(default["uses_default_name"])
        self.assertEqual(current["id"], default["id"])
        self.assertTrue(current["is_default"])

    def test_name_migration_is_one_time_and_preserves_custom_names(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE organizations SET name = '默认组织' WHERE default_for_user_id = ?", (self.owner["id"],))
            conn.execute(
                "UPDATE organizations SET name = 'Custom name', name_is_custom = 1 WHERE default_for_user_id = ?",
                (self.other["id"],),
            )
            conn.execute("DELETE FROM auth_schema_migrations WHERE name = 'default-organization-name-v2'")
            conn.execute("DELETE FROM auth_schema_migrations WHERE name = 'email-prefix-organization-name-v3'")
        storage.init_users_db()
        self.assertEqual(storage.get_default_organization(self.owner["id"])["name"], "owner的组织")
        self.assertEqual(storage.get_default_organization(self.other["id"])["name"], "Custom name")
        default_id = storage.get_default_organization(self.owner["id"])["id"]
        storage.rename_organization(self.owner["id"], default_id, "默认组织")
        storage.init_users_db()
        self.assertEqual(storage.get_default_organization(self.owner["id"])["name"], "默认组织")
        self.assertFalse(storage.get_default_organization(self.owner["id"])["uses_default_name"])

    def test_create_trims_name_and_assigns_owner_without_automatic_switch(self):
        before = storage.get_current_organization(self.owner["id"])["id"]
        organization = self.create("  Product Team  ")
        self.assertEqual(organization["name"], "Product Team")
        self.assertEqual(organization["role"], "owner")
        self.assertEqual(organization["member_count"], 1)
        self.assertFalse(organization["is_default"])
        self.assertEqual(storage.get_current_organization(self.owner["id"])["id"], before)

    def test_list_contains_only_memberships(self):
        own = self.create()
        response = self.client.get("/api/v1/organizations", headers=self.headers_for(self.other["id"]))
        ids = {item["id"] for item in response.json()["data"]}
        self.assertNotIn(own["id"], ids)
        self.assertEqual(len(ids), 1)

    def test_missing_authentication_is_rejected(self):
        organization = self.create()
        for method, path, body in (
            ("GET", "/api/v1/organizations", None),
            ("GET", f"/api/v1/organizations/{organization['id']}", None),
            ("POST", "/api/v1/organizations", {"name": "Test"}),
            ("PATCH", f"/api/v1/organizations/{organization['id']}", {"name": "Test"}),
            ("POST", f"/api/v1/organizations/{organization['id']}/members", {"email": "other@example.com", "role": "member"}),
            ("PATCH", f"/api/v1/organizations/{organization['id']}/members/{self.other['id']}", {"role": "admin"}),
            ("POST", f"/api/v1/organizations/{organization['id']}/switch", None),
        ):
            with self.subTest(method=method):
                self.assertEqual(self.client.request(method, path, json=body).status_code, 401)

    def test_switch_persists_across_initialization_profile_and_login(self):
        organization = self.create()
        result = self.client.post(f"/api/v1/organizations/{organization['id']}/switch", headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["data"]["id"], organization["id"])
        storage.init_users_db()
        self.assertEqual(storage.get_current_organization(self.owner["id"])["id"], organization["id"])
        with TestClient(self.app) as second_client:
            me = second_client.get("/api/v1/auth/me", headers=self.headers).json()["data"]
        self.assertEqual(me["current_organization"]["id"], organization["id"])
        self.assertNotEqual(me["default_organization"]["id"], organization["id"])
        storage.update_user(self.owner["id"], password_hash=hash_password("owner-password"))
        login = self.client.post("/api/v1/auth/login", json={"login": "owner", "password": "owner-password"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["data"]["user"]["current_organization"]["id"], organization["id"])

    def test_switch_to_nonmember_organization_is_rejected(self):
        other_default = storage.get_default_organization(self.other["id"])
        before = storage.get_current_organization(self.owner["id"])["id"]
        for organization_id in (other_default["id"], "unknown"):
            response = self.client.post(f"/api/v1/organizations/{organization_id}/switch", headers=self.headers)
            self.assertEqual(response.status_code, 404)
        self.assertEqual(storage.get_current_organization(self.owner["id"])["id"], before)

    def test_owner_can_rename_default_and_custom_organizations(self):
        custom = self.create()
        default = storage.get_default_organization(self.owner["id"])
        for organization_id in (custom["id"], default["id"]):
            response = self.client.patch(
                f"/api/v1/organizations/{organization_id}", headers=self.headers, json={"name": "  Renamed  "},
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["data"]["name"], "Renamed")
        storage.init_users_db()
        self.assertEqual(storage.get_default_organization(self.owner["id"])["name"], "Renamed")

    def test_member_can_switch_but_cannot_rename_even_if_global_admin(self):
        organization = self.create()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("INSERT INTO organization_memberships VALUES (?, ?, 'member', '2026-01-01')", (organization["id"], self.other["id"]))
        storage.set_user_role("other", "admin")
        headers = self.headers_for(self.other["id"])
        self.assertEqual(self.client.post(f"/api/v1/organizations/{organization['id']}/switch", headers=headers).status_code, 200)
        response = self.client.patch(f"/api/v1/organizations/{organization['id']}", headers=headers, json={"name": "Not allowed"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(storage.get_current_organization(self.other["id"])["name"], "Product Team")
        self.assertEqual(self.client.get("/api/v1/organizations", headers=self.headers).json()["data"][1]["member_count"], 2)

    def test_nonmember_cannot_rename(self):
        other_default = storage.get_default_organization(self.other["id"])
        response = self.client.patch(f"/api/v1/organizations/{other_default['id']}", headers=self.headers, json={"name": "Not allowed"})
        self.assertEqual(response.status_code, 404)

    def test_names_are_validated_for_creation_and_rename(self):
        organization = self.create()
        for name in ("", "   ", "a" * 81):
            with self.subTest(name_length=len(name)):
                self.assertEqual(self.client.post("/api/v1/organizations", headers=self.headers, json={"name": name}).status_code, 400)
                self.assertEqual(self.client.patch(f"/api/v1/organizations/{organization['id']}", headers=self.headers, json={"name": name}).status_code, 400)
        self.assertEqual(self.create("a" * 80)["name"], "a" * 80)

    def test_request_cannot_choose_owner_or_default_relationship(self):
        response = self.client.post("/api/v1/organizations", headers=self.headers, json={
            "name": "Own team", "owner_id": self.other["id"], "default_for_user_id": self.other["id"],
        })
        self.assertEqual(response.status_code, 200)
        organization = response.json()["data"]
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT owner_id, default_for_user_id FROM organizations WHERE id = ?", (organization["id"],)).fetchone()
        self.assertEqual(row, (self.owner["id"], None))

    def test_member_can_open_organization_detail(self):
        organization = self.create()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO organization_memberships VALUES (?, ?, 'member', '2026-01-01')",
                (organization["id"], self.other["id"]),
            )
        response = self.client.get(
            f"/api/v1/organizations/{organization['id']}",
            headers=self.headers_for(self.other["id"]),
        )
        self.assertEqual(response.status_code, 200)
        detail = response.json()["data"]
        self.assertEqual(detail["role"], "member")
        self.assertEqual(detail["member_count"], 2)
        self.assertEqual(
            [(member["username"], member["role"]) for member in detail["members"]],
            [("owner", "owner"), ("other", "member")],
        )

    def test_nonmember_cannot_open_organization_detail(self):
        other_default = storage.get_default_organization(self.other["id"])
        response = self.client.get(
            f"/api/v1/organizations/{other_default['id']}", headers=self.headers,
        )
        self.assertEqual(response.status_code, 404)

    def test_owner_can_invite_registered_users_by_email(self):
        organization = self.create()
        invited_by_email = storage.create_user(
            "email-user", "person@example.com", "test-hash", "Email User",
        )
        by_email = self.client.post(
            f"/api/v1/organizations/{organization['id']}/members",
            headers=self.headers,
            json={"email": "PERSON@EXAMPLE.COM", "role": "admin"},
        )
        self.assertEqual(by_email.status_code, 200)
        self.assertEqual(by_email.json()["data"]["user_id"], invited_by_email["id"])
        self.assertEqual(by_email.json()["data"]["role"], "admin")
        detail = self.client.get(
            f"/api/v1/organizations/{organization['id']}", headers=self.headers,
        ).json()["data"]
        self.assertEqual(detail["member_count"], 2)

    def test_invite_validates_user_duplicates_and_role(self):
        organization = self.create()
        path = f"/api/v1/organizations/{organization['id']}/members"
        self.assertEqual(
            self.client.post(path, headers=self.headers, json={"email": "missing@example.com", "role": "member"}).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(path, headers=self.headers, json={"email": "", "role": "member"}).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(path, headers=self.headers, json={"email": "other", "role": "member"}).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(path, headers=self.headers, json={"email": "other@example.com", "role": "owner"}).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(path, headers=self.headers, json={"email": "other@example.com", "role": "member"}).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(path, headers=self.headers, json={"email": "other@example.com", "role": "admin"}).status_code,
            409,
        )

    def test_only_owner_can_invite_and_change_member_permissions(self):
        organization = self.create()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO organization_memberships VALUES (?, ?, 'admin', '2026-01-01')",
                (organization["id"], self.other["id"]),
            )
        invited = storage.create_user("member-user", "member@example.com", "test-hash")
        invite_path = f"/api/v1/organizations/{organization['id']}/members"
        admin_headers = self.headers_for(self.other["id"])
        self.assertEqual(
            self.client.post(
                invite_path, headers=admin_headers, json={"email": "member@example.com", "role": "member"},
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                invite_path, headers=self.headers, json={"email": "member@example.com", "role": "member"},
            ).status_code,
            200,
        )
        role_path = f"{invite_path}/{invited['id']}"
        self.assertEqual(
            self.client.patch(role_path, headers=admin_headers, json={"role": "admin"}).status_code,
            403,
        )
        promoted = self.client.patch(
            role_path, headers=self.headers, json={"role": "admin"},
        )
        self.assertEqual(promoted.status_code, 200)
        self.assertEqual(promoted.json()["data"]["role"], "admin")
        owner_path = f"{invite_path}/{self.owner['id']}"
        self.assertEqual(
            self.client.patch(owner_path, headers=self.headers, json={"role": "member"}).status_code,
            403,
        )
        missing_path = f"{invite_path}/missing"
        self.assertEqual(
            self.client.patch(missing_path, headers=self.headers, json={"role": "member"}).status_code,
            404,
        )

    def test_membership_loss_restores_default_with_warning(self):
        organization = self.create()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("INSERT INTO organization_memberships VALUES (?, ?, 'member', '2026-01-01')", (organization["id"], self.other["id"]))
        storage.switch_organization(self.other["id"], organization["id"])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM organization_memberships WHERE user_id = ? AND organization_id = ?", (self.other["id"], organization["id"]))
        with self.assertLogs(storage.logger, level="WARNING"):
            current = storage.get_current_organization(self.other["id"])
        self.assertEqual(current["id"], storage.get_default_organization(self.other["id"])["id"])

    def test_failed_creation_is_rolled_back(self):
        before = len(storage.list_organizations(self.owner["id"]))
        with patch.object(storage, "_organization_details", return_value=None):
            with self.assertRaises(RuntimeError):
                storage.create_organization(self.owner["id"], "Will roll back")
        self.assertEqual(len(storage.list_organizations(self.owner["id"])), before)


if __name__ == "__main__":
    unittest.main()
