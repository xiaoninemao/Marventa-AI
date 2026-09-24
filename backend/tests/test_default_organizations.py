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
        with sqlite3.connect(self.db_path) as conn:
            users_before = conn.execute("""
                SELECT id, username, email, password_hash, nickname, avatar_url, created_at
                FROM users ORDER BY id
            """).fetchall()
        content_before = self.snapshot("unrelated_content")
        storage.init_users_db()
        with sqlite3.connect(self.db_path) as conn:
            columns = [row[1] for row in conn.execute("PRAGMA table_info(users)")]
            users_after = conn.execute("""
                SELECT id, username, email, password_hash, nickname, avatar_url, created_at
                FROM users ORDER BY id
            """).fetchall()
        self.assertNotIn("role", columns)
        self.assertEqual(users_after, users_before)
        self.assertEqual(self.snapshot("unrelated_content"), content_before)
        self.assertEqual(len(self.snapshot("organizations")), 2)
        self.assertEqual(len(self.snapshot("organization_memberships")), 2)
        alice = storage.get_default_organization("old-a")
        bob = storage.get_default_organization("old-b")
        self.assertNotEqual(alice["id"], bob["id"])
        self.assertEqual(alice["name"], "alice's organization")
        self.assertEqual(bob["name"], "bob's organization")
        self.assertTrue(alice["uses_default_name"])
        self.assertEqual(alice["role"], "owner")
        self.assertEqual(bob["role"], "owner")
        with sqlite3.connect(self.db_path) as conn:
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_initializes_existing_schema_without_adding_role_column(self):
        self.legacy_users(with_role=False)
        storage.init_users_db()
        self.assertNotIn("role", storage.get_user_by_id("old-a").keys())
        self.assertIsNotNone(storage.get_default_organization("old-a"))
        self.assertIsNotNone(storage.get_default_organization("old-b"))

    def test_fresh_schema_and_repeated_startup_never_create_role_column(self):
        user = storage.create_user("fresh", "fresh@example.com", "stored-hash")
        for _ in range(3):
            storage.init_users_db()
        with sqlite3.connect(self.db_path) as conn:
            columns = [row[1] for row in conn.execute("PRAGMA table_info(users)")]
            stored = conn.execute(
                "SELECT username, email, password_hash, nickname, avatar_url "
                "FROM users WHERE id = ?",
                (user["id"],),
            ).fetchone()
        self.assertNotIn("role", columns)
        self.assertEqual(
            stored,
            ("fresh", "fresh@example.com", "stored-hash", "fresh", ""),
        )

    def test_role_removal_preserves_extended_fields_indexes_and_foreign_keys(self):
        self.legacy_users()
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript("""
                ALTER TABLE users ADD COLUMN profile_note TEXT NOT NULL DEFAULT '';
                UPDATE users SET avatar_url = '/avatars/alice.png', profile_note = 'keep me'
                WHERE id = 'old-a';
                CREATE INDEX idx_users_email_legacy ON users(email);
                CREATE INDEX idx_users_role_legacy ON users(role);
                CREATE TABLE user_notes (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    body TEXT NOT NULL
                );
                INSERT INTO user_notes VALUES ('note-a', 'old-a', 'existing note');
            """)

        storage.init_users_db()
        storage.init_users_db()

        with sqlite3.connect(self.db_path) as conn:
            columns = [row[1] for row in conn.execute("PRAGMA table_info(users)")]
            indexes = {row[1] for row in conn.execute("PRAGMA index_list(users)")}
            alice = conn.execute(
                "SELECT email, nickname, avatar_url, profile_note FROM users WHERE id = 'old-a'"
            ).fetchone()
            note = conn.execute("SELECT user_id, body FROM user_notes").fetchone()
            note_foreign_key = conn.execute(
                "PRAGMA foreign_key_list(user_notes)"
            ).fetchone()
            migrations = conn.execute(
                "SELECT COUNT(*) FROM auth_schema_migrations "
                "WHERE name = 'remove-user-role-v4'"
            ).fetchone()[0]
            foreign_key_errors = conn.execute("PRAGMA foreign_key_check").fetchall()
        self.assertNotIn("role", columns)
        self.assertIn("profile_note", columns)
        self.assertIn("idx_users_email_legacy", indexes)
        self.assertNotIn("idx_users_role_legacy", indexes)
        self.assertEqual(
            alice,
            ("alice@example.com", "Alice", "/avatars/alice.png", "keep me"),
        )
        self.assertEqual(note, ("old-a", "existing note"))
        self.assertEqual(note_foreign_key[2], "users")
        self.assertEqual(note_foreign_key[6], "CASCADE")
        self.assertEqual(migrations, 1)
        self.assertEqual(foreign_key_errors, [])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO user_notes VALUES ('invalid', 'missing-user', 'invalid')"
                )

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

    def test_english_default_does_not_rename_existing_chinese_organizations(self):
        user = storage.create_user("alice", "alice@example.com", "test-hash")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE organizations SET name = 'alice的组织' WHERE default_for_user_id = ?",
                (user["id"],),
            )
        before = self.snapshot("organizations")
        storage.init_users_db()
        self.assertEqual(self.snapshot("organizations"), before)
        organization_id = storage.get_default_organization(user["id"])["id"]
        storage.rename_organization(user["id"], organization_id, "我的品牌团队")
        storage.init_users_db()
        saved = storage.get_default_organization(user["id"])
        self.assertEqual(saved["name"], "我的品牌团队")
        self.assertFalse(saved["uses_default_name"])

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
        self.assertNotIn("role", data["user"])
        organization = data["user"]["default_organization"]
        self.assertEqual(organization["name"], "new-user's organization")
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
                self.assertNotIn("role", result.json()["data"])
                self.assertEqual(result.json()["data"]["default_organization"], organization)
        login = self.client.post("/api/v1/auth/login", json={"email": "new-user@example.com", "password": "test-password"})
        self.assertNotIn("role", login.json()["data"]["user"])
        self.assertEqual(login.json()["data"]["user"]["default_organization"], organization)

    def test_existing_user_can_sign_in_with_existing_password(self):
        self.legacy_users()
        password_hash = hash_password("old-password")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = 'old-a'", (password_hash,))
        response = self.client.post("/api/v1/auth/login", json={"login": "alice", "password": "old-password"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("role", response.json()["data"]["user"])
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
