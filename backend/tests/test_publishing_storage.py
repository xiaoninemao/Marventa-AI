import sys
import tempfile
import types
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

dotenv_stub = types.ModuleType("dotenv")
dotenv_stub.load_dotenv = lambda *args, **kwargs: None
sys.modules.setdefault("dotenv", dotenv_stub)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engines.content_generator.models import ContentCard
from app.engines.content_generator import storage as content_storage
from app.engines.content_generator.storage import create_session, update_session
from app.engines.publishing import storage as publishing_storage
from app.engines.publishing.storage import (
    add_project_media,
    create_social_account,
    create_account_memory,
    create_manual_project,
    create_project_from_session,
    create_task_from_project,
    create_task_from_session,
    generate_review_for_task,
    get_account_memory,
    get_social_account,
    get_task,
    list_projects,
    list_social_accounts,
    update_social_account,
    update_task,
)


class PublishingStorageTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        db_path = str(Path(directory.name) / "publishing_test.db")
        self.enterContext(patch.object(content_storage, "DB_PATH", db_path))
        self.enterContext(patch.object(publishing_storage, "DB_PATH", db_path))
        self.user_id = f"user-{uuid.uuid4().hex[:8]}"
        self.session = create_session(self.user_id)
        self.cards = [
            ContentCard(
                id="title-card",
                card_type="title",
                title="标题版本",
                preview="标题 A / 标题 B",
                content="1. 三分钟看懂新品卖点\n2. 这款新品解决了什么痛点",
                tips=["保留痛点钩子"],
            ),
            ContentCard(
                id="copy-card",
                card_type="copy",
                title="正文版本",
                preview="正文 A",
                content="痛点开场，场景展开，最后引导评论。",
                tips=["评论区引导"],
            ),
        ]
        update_session(
            self.session.id,
            title="新品上市内容方案",
            cards=self.cards,
            status="completed",
        )

    def test_project_and_publish_task_keep_creation_snapshot(self):
        project = create_project_from_session(
            self.user_id,
            self.session.id,
            title="新品上市 Q2",
            xhs_account="品牌小红书号",
        )
        task = create_task_from_session(
            self.user_id,
            self.session.id,
            project_id=project.id,
            platform="xiaohongshu",
            account_name="品牌小红书号",
            selected_version_ids={"title": "title-card", "body": "copy-card"},
        )

        saved = get_task(task.id)
        self.assertEqual(saved.project_id, project.id)
        self.assertEqual(saved.status, "pending_publish")
        self.assertEqual(saved.original_cards[0].id, "title-card")
        self.assertEqual(saved.final_snapshot["title"], "标题版本")

        projects = list_projects(self.user_id, xhs_account="品牌小红书号")
        self.assertEqual([item.id for item in projects], [project.id])

    def test_review_can_write_effective_lesson_to_account_memory(self):
        memory = create_account_memory(
            self.user_id,
            platform="xiaohongshu",
            account_name="品牌小红书号",
            brand_positioning="科技新品种草账号",
        )
        task = create_task_from_session(
            self.user_id,
            self.session.id,
            platform="xiaohongshu",
            account_name="品牌小红书号",
            selected_version_ids={"title": "title-card", "body": "copy-card"},
        )
        update_task(task.id, metrics={"views": 2000, "likes": 180, "collects": 90, "comments": 22})

        review = generate_review_for_task(task.id, write_to_memory=True)

        self.assertIn("表现原因", review.summary)
        updated_memory = get_account_memory(memory.id)
        self.assertTrue(updated_memory.ai_operation_lessons)
        self.assertIn("新品上市内容方案", updated_memory.ai_operation_lessons[-1])

    def test_social_account_and_project_media_are_persisted(self):
        account = create_social_account(
            self.user_id,
            platform="douyin",
            account_name="抖音品牌号",
            session_dir="D:/sessions/douyin-brand",
            profile={"nickname": "抖音品牌号", "home_url": "https://creator.douyin.com/"},
        )
        self.assertEqual(get_social_account(account.id).platform, "douyin")
        self.assertEqual(list_social_accounts(self.user_id, "douyin")[0].account_name, "抖音品牌号")

        project = create_project_from_session(self.user_id, self.session.id, title="素材归档")
        updated = add_project_media(
            project.id,
            [
                {"id": "img1", "kind": "image", "url": "/media/publishing/img1.jpg", "name": "img1.jpg"},
                {"id": "vid1", "kind": "video", "url": "/media/publishing/vid1.mp4", "name": "vid1.mp4"},
            ],
        )

        self.assertEqual(updated.media_assets[0]["kind"], "image")
        self.assertEqual(updated.media_assets[1]["kind"], "video")

    def test_quick_login_account_can_be_saved_without_nickname(self):
        account = create_social_account(
            self.user_id,
            platform="xiaohongshu",
            account_name="小红书账号_未命名",
            session_dir="D:/sessions/xhs-unnamed",
            status="pending_identification",
            cookie_status="valid",
            profile={
                "import_mode": "quick_login",
                "cookie_names": ["a1", "web_session"],
                "nickname_parse_status": "failed",
            },
            credential_blob="encrypted-login-state",
        )

        saved = get_social_account(account.id)
        self.assertEqual(saved.nickname, "")
        self.assertEqual(saved.account_name, "小红书账号_未命名")
        self.assertEqual(saved.status, "pending_identification")
        self.assertEqual(list_social_accounts(self.user_id, "xiaohongshu")[0].id, account.id)

    def test_social_account_editable_fields_can_be_updated(self):
        account = create_social_account(
            self.user_id,
            platform="douyin",
            account_name="品牌号",
            session_dir="D:/sessions/douyin-brand",
            nickname="平台昵称",
            profile={"followers": ""},
        )

        updated = update_social_account(
            self.user_id,
            account.id,
            remark="运营备注",
            platform_user_id="1234567890",
            profile={"followers": "1.2万", "industry": "美妆"},
        )

        self.assertEqual(updated.nickname, "平台昵称")
        self.assertEqual(updated.remark, "运营备注")
        self.assertEqual(updated.platform_user_id, "1234567890")
        self.assertEqual(updated.profile["followers"], "1.2万")
        self.assertEqual(updated.profile["industry"], "美妆")

    def test_publish_task_can_be_created_from_content_project(self):
        project = create_project_from_session(self.user_id, self.session.id, title="项目库内容", platform_hint="douyin")
        updated_project = add_project_media(
            project.id,
            [{"id": "vid1", "kind": "video", "url": "/media/publishing/vid1.mp4", "name": "vid1.mp4"}],
        )

        task = create_task_from_project(
            self.user_id,
            updated_project.id,
            platform="douyin",
            account_name="品牌号",
            content_type="video",
        )

        self.assertEqual(task.project_id, project.id)
        self.assertEqual(task.source_session_id, self.session.id)
        self.assertEqual(task.final_snapshot["title"], updated_project.final_snapshot["title"])
        self.assertEqual(task.final_snapshot["media_assets"][0]["id"], "vid1")

    def test_manual_content_creates_project_then_draft_task(self):
        project = create_manual_project(
            self.user_id,
            title="手写草稿",
            platform_hint="xiaohongshu",
            content_type="image_text",
            final_snapshot={"title": "手写标题", "body": "手写正文", "tags": "#新品"},
            notes="发布管理手动创建",
        )
        task = create_task_from_project(
            self.user_id,
            project.id,
            platform="xiaohongshu",
            account_name="",
            content_type="image_text",
        )

        self.assertEqual(project.source_session_id, "")
        self.assertEqual(task.status, "pending_publish")
        self.assertEqual(task.final_snapshot["title"], "手写标题")
        self.assertEqual(task.project_id, project.id)


if __name__ == "__main__":
    unittest.main()
