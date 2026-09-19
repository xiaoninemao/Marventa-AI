import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router
from app.auth import seed, storage
from app.auth.security import hash_password


class DefaultOrganizationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db_path = str(Path(directory.name) / "organizations.db")
        self.enterContext(patch.object(storage, "DB_PATH", self.db_path))
        self.enterContext(patch("app.api.auth.DEBUG", False))
        app = FastAPI()
        app.include_router(router)
        self.client = self.enterContext(TestClient(app))

    def legacy_users(self, with_role=True):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE users (
                    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
                    email TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL,
                    nickname TEXT DEFAULT '', avatar_url TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                )
            """)
            if with_role:
                conn.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
            conn.executemany(
                "INSERT INTO users (id, username, email, password_hash, nickname, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                [
                    ("old-a", "alice", "alice@example.com", "stored-hash-a", "Alice", "2026-01-01"),
                    ("old-b", "bob", "", "stored-hash-b", "Bob", "2026-02-01"),
                ],
            )
            if with_role:
                conn.execute("UPDATE users SET role = 'admin' WHERE id = 'old-a'")
            conn.execute("CREATE TABLE unrelated_content (id TEXT, body TEXT)")
            conn.execute("INSERT INTO unrelated_content VALUES ('content-1', 'Existing content')")

    def snapshot(self, table):
        with sqlite3.connect(self.db_path) as conn:
            # Table names are fixed test constants, not application inputs.
            return conn.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()

    def test_backfills_all_existing_users_without_changing_their_data(self):
        self.legacy_users()
        users_before = self.snapshot("users")
        content_before = self.snapshot("unrelated_content")
        storage.init_users_db()
        self.assertEqual(self.snapshot("users"), users_before)
        self.assertEqual(self.snapshot("unrelated_content"), content_before)
        self.assertEqual(len(self.snapshot("organizations")), 2)
        self.assertEqual(len(self.snapshot("organization_memberships")), 2)
        alice = storage.get_default_organization("old-a")
        bob = storage.get_default_organization("old-b")
        self.assertNotEqual(alice["id"], bob["id"])
        self.assertEqual(alice["name"], "alice的组织")
        self.assertEqual(bob["name"], "bob的组织")
        self.assertTrue(alice["uses_default_name"])
        self.assertEqual(alice["role"], "owner")
        self.assertEqual(bob["role"], "owner")
        with sqlite3.connect(self.db_path) as conn:
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_migrates_legacy_schema_without_role_column(self):
        self.legacy_users(with_role=False)
        storage.init_users_db()
        self.assertEqual(storage.get_user_by_id("old-a")["role"], "user")
        self.assertIsNotNone(storage.get_default_organization("old-a"))
        self.assertIsNotNone(storage.get_default_organization("old-b"))

    def test_repeated_initialization_preserves_organization_ids_and_names(self):
        self.legacy_users()
        storage.init_users_db()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE organizations SET name = 'Custom team' WHERE default_for_user_id = 'old-a'")
        before = self.snapshot("organizations")
        memberships = self.snapshot("organization_memberships")
        for _ in range(3):
            storage.init_users_db()
        self.assertEqual(self.snapshot("organizations"), before)
        self.assertEqual(self.snapshot("organization_memberships"), memberships)

    def test_missing_membership_is_repaired_without_creating_another_organization(self):
        user = storage.create_user("alice", "", "test-hash")
        organization = storage.get_default_organization(user["id"])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM organization_memberships WHERE user_id = ?", (user["id"],))
        storage.init_users_db()
        repaired = storage.get_default_organization(user["id"])
        self.assertEqual(repaired["id"], organization["id"])
        self.assertEqual(repaired["role"], "owner")
        self.assertEqual(len(self.snapshot("organizations")), 1)

    def test_concurrent_backfill_creates_exactly_one_default_per_user(self):
        self.legacy_users()
        with ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(lambda _: storage.init_users_db(), range(8)))
        self.assertEqual(len(self.snapshot("organizations")), 2)
        self.assertEqual(len(self.snapshot("organization_memberships")), 2)

    def test_user_and_organization_creation_are_atomic(self):
        with patch.object(storage, "_ensure_default_organization", side_effect=RuntimeError("Organization creation failed")):
            with self.assertRaisesRegex(RuntimeError, "Organization creation failed"):
                storage.create_user("failed-user", "", "test-hash")
        self.assertEqual(self.snapshot("users"), [])
        self.assertEqual(self.snapshot("organizations"), [])
        self.assertEqual(self.snapshot("organization_memberships"), [])

    def test_failed_backfill_rolls_back_schema_and_preserves_users(self):
        self.legacy_users(with_role=False)
        before = self.snapshot("users")
        with patch.object(storage, "_ensure_default_organization", side_effect=RuntimeError("Backfill failed")):
            with self.assertRaisesRegex(RuntimeError, "Backfill failed"):
                storage.init_users_db()
        self.assertEqual(self.snapshot("users"), before)
        with sqlite3.connect(self.db_path) as conn:
            self.assertIsNone(conn.execute("SELECT name FROM sqlite_master WHERE name = 'organizations'").fetchone())
        storage.init_users_db()
        self.assertEqual(len(self.snapshot("organizations")), 2)

    def test_registration_and_all_user_responses_include_the_same_default(self):
        response = self.client.post("/api/v1/auth/register", json={"email": "new-user@example.com", "password": "test-password"})
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        organization = data["user"]["default_organization"]
        self.assertEqual(organization["name"], "new-user的组织")
        self.assertTrue(organization["uses_default_name"])
        self.assertEqual(organization["role"], "owner")
        self.assertTrue(organization["is_default"])
        headers = {"Authorization": f"Bearer {data['access_token']}"}
        for method, path, payload in (
            ("GET", "/api/v1/auth/me", None),
            ("POST", "/api/v1/auth/verify", None),
            ("PUT", "/api/v1/auth/me", {"nickname": "Updated display name"}),
        ):
            with self.subTest(path=path, method=method):
                result = self.client.request(method, path, headers=headers, json=payload)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()["data"]["default_organization"], organization)
        login = self.client.post("/api/v1/auth/login", json={"email": "new-user@example.com", "password": "test-password"})
        self.assertEqual(login.json()["data"]["user"]["default_organization"], organization)

    def test_existing_user_can_sign_in_with_existing_password(self):
        self.legacy_users()
        password_hash = hash_password("old-password")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = 'old-a'", (password_hash,))
        response = self.client.post("/api/v1/auth/login", json={"login": "alice", "password": "old-password"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["user"]["role"], "admin")
        self.assertEqual(storage.get_user_by_id("old-a")["password_hash"], password_hash)
        self.assertEqual(len(self.snapshot("organizations")), 2)

    def test_users_cannot_choose_someone_elses_default_during_registration(self):
        alice = storage.create_user("alice", "", "test-hash")
        organization = storage.get_default_organization(alice["id"])
        response = self.client.post("/api/v1/auth/register", json={
            "email": "bob@example.com", "password": "test-password",
            "default_organization": {"id": organization["id"]},
        })
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.json()["data"]["user"]["default_organization"]["id"], organization["id"])
        self.assertIsNone(storage.get_default_organization("unknown-user"))

    def test_demo_user_also_gets_one_stable_default_organization(self):
        with patch.multiple(seed, DEMO_USERNAME="demo-test", DEMO_PASSWORD="demo-test-password", DEMO_EMAIL=""):
            seed.ensure_demo_user()
            user = storage.get_user_by_login("demo-test")
            before = storage.get_default_organization(user["id"])
            seed.ensure_demo_user()
            self.assertEqual(dict(storage.get_default_organization(user["id"])), dict(before))
        self.assertEqual(len(self.snapshot("organizations")), 1)


if __name__ == "__main__":
    unittest.main()
