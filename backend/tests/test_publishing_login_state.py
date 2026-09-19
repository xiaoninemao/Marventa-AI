import os
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

dotenv_stub = types.ModuleType("dotenv")
dotenv_stub.load_dotenv = lambda *args, **kwargs: None
sys.modules.setdefault("dotenv", dotenv_stub)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

models_stub = types.ModuleType("app.engines.publishing.models")
models_stub.PublishTask = object
models_stub.SocialAccount = object
sys.modules.setdefault("app.engines.publishing.models", models_stub)

tmp_dir = tempfile.TemporaryDirectory()
os.environ["DB_PATH"] = os.path.join(tmp_dir.name, "publishing_login_state.db")

from app.engines.publishing.automation import (
    build_login_state_from_storage_state,
    should_keep_publish_window_open,
    stable_login_session_id_for,
    login_session_paths_for,
)
from app.engines.publishing import account_import

if sys.modules.get("app.engines.publishing.models") is models_stub:
    del sys.modules["app.engines.publishing.models"]


class PublishingLoginStateTests(unittest.TestCase):
    def tearDown(self):
        tmp_dir.cleanup()

    def test_xiaohongshu_storage_state_can_be_saved_without_nickname(self):
        storage_state = {
            "cookies": [
                {"name": "a1", "value": "token", "domain": ".xiaohongshu.com"},
                {"name": "webId", "value": "web-id", "domain": ".xiaohongshu.com"},
            ],
            "origins": [
                {
                    "origin": "https://creator.xiaohongshu.com",
                    "localStorage": [{"name": "xsecappid", "value": "creator"}],
                }
            ],
        }

        state = build_login_state_from_storage_state(
            storage_state,
            platform="xiaohongshu",
            page_info={
                "title": "Xiaohongshu Creator",
                "home_url": "https://creator.xiaohongshu.com/",
                "nickname": "",
            },
            storage_state_file="D:/sessions/login-123/storage_state.json",
        )

        self.assertTrue(state["authorized"])
        self.assertEqual(state["nickname"], "")
        self.assertEqual(state["storage_state_file"], "D:/sessions/login-123/storage_state.json")
        self.assertIn("a1", state["cookie_names"])
        self.assertIn("https://creator.xiaohongshu.com", state["local_storage"])

    def test_browser_storage_state_is_encrypted_and_permission_restricted(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = str(Path(directory.name) / "state.json")
        payload = {"cookies": [{"name": "session", "value": "secret"}], "origins": []}
        with patch.object(account_import, "DATA_ENCRYPTION_KEY", "data-secret"):
            account_import.write_encrypted_json(path, payload)
            raw = Path(path).read_text()
            self.assertTrue(raw.startswith("v2:"))
            self.assertNotIn("secret", raw)
            self.assertEqual(account_import.read_encrypted_json(path), payload)
        self.assertEqual(Path(path).stat().st_mode & 0o777, 0o600)

    def test_legacy_cookie_ciphertext_remains_readable(self):
        payload = {"cookies": {"session": "legacy"}}
        legacy = account_import._fernet("legacy-jwt").encrypt(
            json.dumps(payload).encode("utf-8")
        ).decode("utf-8")
        with (
            patch.object(account_import, "JWT_SECRET", "legacy-jwt"),
            patch.object(account_import, "DATA_ENCRYPTION_KEY", "new-data-key"),
        ):
            self.assertEqual(account_import.decrypt_cookie_payload(legacy), payload)

    def test_login_session_paths_use_ascii_session_id_not_account_name(self):
        paths = login_session_paths_for(
            user_id="user-1",
            platform="xiaohongshu",
            login_session_id="login_abc123",
            account_name="小红书账号",
        )

        self.assertIn("login_abc123", paths["session_dir"])
        self.assertNotIn("小红书账号", paths["session_dir"])
        self.assertIn("platform_storage_states", paths["storage_state_file"])
        self.assertTrue(paths["storage_state_file"].endswith("login_abc123.json"))

    def test_existing_account_login_uses_stable_session_id(self):
        first = stable_login_session_id_for("douyin", account_name="品牌抖音号", account_id="acct-123")
        second = stable_login_session_id_for("douyin", account_name="换个备注", account_id="acct-123")
        fresh = stable_login_session_id_for("douyin", account_name="品牌抖音号", account_id="acct-123", fresh=True)

        self.assertEqual(first, "account_acct-123")
        self.assertEqual(second, first)
        self.assertTrue(fresh.startswith("login_"))
        self.assertNotEqual(fresh, first)

    def test_new_account_login_uses_stable_hash_when_not_fresh(self):
        first = stable_login_session_id_for("douyin", account_name="品牌抖音号")
        second = stable_login_session_id_for("douyin", account_name="品牌抖音号")

        self.assertEqual(first, second)
        self.assertTrue(first.startswith("account_"))

    def test_login_state_keeps_profile_identifiers_and_followers(self):
        state = build_login_state_from_storage_state(
            {"cookies": [{"name": "sessionid", "value": "token"}], "origins": []},
            platform="douyin",
            page_info={
                "nickname": "品牌号",
                "avatar_url": "https://example.com/avatar.jpg",
                "profile_url": "https://www.douyin.com/user/MS4wLjABAAAA",
                "platform_user_id": "1234567890",
                "followers": "1.2万",
            },
            storage_state_file="D:/sessions/douyin.json",
        )

        self.assertEqual(state["platform_user_id"], "1234567890")
        self.assertEqual(state["followers"], "1.2万")
        self.assertEqual(state["avatar_url"], "https://example.com/avatar.jpg")

    def test_publish_window_stays_open_for_package_or_manual_confirmation(self):
        self.assertTrue(should_keep_publish_window_open(dry_run=True, clicked_publish=False))
        self.assertTrue(should_keep_publish_window_open(dry_run=False, clicked_publish=False))
        self.assertFalse(should_keep_publish_window_open(dry_run=False, clicked_publish=True))


if __name__ == "__main__":
    unittest.main()
