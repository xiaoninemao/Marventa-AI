import unittest
import sys
import types
from unittest.mock import patch

dotenv_stub = types.ModuleType("dotenv")
dotenv_stub.load_dotenv = lambda *args, **kwargs: None
sys.modules.setdefault("dotenv", dotenv_stub)

from app.engines.case_library.import_tasks import (
    _extract_douyin_aweme_id,
    _fetch_douyin_with_browser,
    _has_meaningful_import_content,
    _parse_douyin_aweme_payload,
    _parse_public_html,
    parse_shared_post_text,
)


class CaseImportTaskTests(unittest.TestCase):
    def test_douyin_browser_fallback_keeps_threaded_fetch_behavior(self):
        url = "https://www.douyin.com/video/example"
        with patch("playwright.sync_api.sync_playwright") as playwright:
            browser = playwright.return_value.__enter__.return_value.chromium.launch.return_value
            page = browser.new_page.return_value
            page.evaluate.return_value = {
                "url": url,
                "title": "Product launch - 抖音",
                "description": "Launch details",
                "cover": "https://example.com/cover.jpg",
                "text": "",
            }
            parsed, error = _fetch_douyin_with_browser(url)

        self.assertIsNone(error)
        self.assertEqual(parsed["title"], "Product launch")
        self.assertEqual(parsed["recognition_status"], "recognized")
        self.assertEqual(parsed["source_url"], url)
        page.goto.assert_called_once_with(url, wait_until="commit", timeout=45000)
        page.wait_for_timeout.assert_called_once_with(20000)
        browser.close.assert_called_once_with()

    def test_parse_shared_post_text_extracts_core_fields(self):
        raw = """Check this Xiaohongshu note https://www.xiaohongshu.com/explore/abc123
Weekend coffee shop launch
First 100 visitors get a tasting set.
#coffee #localLife
likes 1.2w favorites 340 comments 56
"""

        parsed = parse_shared_post_text(raw, platform="xiaohongshu")

        self.assertEqual(parsed["platform"], "xiaohongshu")
        self.assertEqual(parsed["source_url"], "https://www.xiaohongshu.com/explore/abc123")
        self.assertEqual(parsed["title"], "Weekend coffee shop launch")
        self.assertIn("First 100 visitors", parsed["body"])
        self.assertEqual(parsed["topics"], ["coffee", "localLife"])
        self.assertEqual(parsed["likes"], 12000)
        self.assertEqual(parsed["collects"], 340)
        self.assertEqual(parsed["comments"], 56)
        self.assertEqual(parsed["recognition_status"], "recognized")

    def test_parse_xiaohongshu_bracket_share_text_extracts_title(self):
        raw = (
            "37 【太湖大道学校保安 - 保安安置吴经理 | 小红书 - 你的生活兴趣社区】 "
            "😆 gDZQQcmVZC3iYJH 😆 "
            "https://www.xiaohongshu.com/discovery/item/6aafe1740000000026019f8e"
        )

        parsed = parse_shared_post_text(raw, platform="xiaohongshu")

        self.assertEqual(parsed["title"], "太湖大道学校保安 - 保安安置吴经理")
        self.assertEqual(parsed["body"], "")
        self.assertEqual(parsed["recognition_status"], "partial")

    def test_parse_public_html_extracts_cover_image(self):
        page_html = """
<html><head>
<meta property="og:title" content="Cover title" />
<meta property="og:description" content="Body #topic" />
<meta property="og:image" content="https://sns-img.example.com/cover.jpg" />
</head></html>
"""

        parsed = _parse_public_html(page_html, "https://www.xiaohongshu.com/explore/abc", "xiaohongshu")

        self.assertEqual(parsed["cover_url"], "https://sns-img.example.com/cover.jpg")
        self.assertEqual(parsed["image_urls"], ["https://sns-img.example.com/cover.jpg"])

    def test_parse_public_html_extracts_interaction_counts(self):
        page_html = """
<html><head>
<meta property="og:title" content="Cover title" />
<meta property="og:description" content="Body #topic" />
</head><body>
<script>window.__INITIAL_STATE__={"note":{"interactInfo":{"likedCount":"213","collectedCount":"97","commentCount":"9"}}}</script>
</body></html>
"""

        parsed = _parse_public_html(page_html, "https://www.xiaohongshu.com/explore/abc", "xiaohongshu")

        self.assertEqual(parsed["likes"], 213)
        self.assertEqual(parsed["collects"], 97)
        self.assertEqual(parsed["comments"], 9)

    def test_generic_xiaohongshu_login_page_is_not_meaningful_content(self):
        self.assertFalse(_has_meaningful_import_content({
            "title": "小红书 - 你的生活兴趣社区",
            "body": "",
            "topics": [],
            "image_urls": [
                "https://picasso-static.xiaohongshu.com/fe-platform/logo.png",
            ],
            "video_url": "",
        }))

    def test_shared_post_text_with_body_is_meaningful_content(self):
        self.assertTrue(_has_meaningful_import_content({
            "title": "Weekend coffee shop launch",
            "body": "First 100 visitors get a tasting set and can join the launch event this weekend.",
            "topics": ["coffee"],
            "image_urls": [],
            "video_url": "",
        }))

    def test_extract_douyin_aweme_id_from_modal_url(self):
        self.assertEqual(
            _extract_douyin_aweme_id("https://www.douyin.com/jingxuan?modal_id=7640032041598198757"),
            "7640032041598198757",
        )

    def test_parse_douyin_aweme_payload_extracts_video_case_fields(self):
        payload = {
            "aweme_detail": {
                "desc": "新品开箱体验 #科技好物",
                "text_extra": [{"hashtag_name": "科技好物"}],
                "statistics": {
                    "digg_count": 321,
                    "collect_count": 45,
                    "comment_count": 6,
                },
                "video": {
                    "cover": {"url_list": ["https://p3.douyinpic.com/cover.jpeg"]},
                    "play_addr": {"url_list": ["https://v.douyin.com/video.mp4"]},
                },
            }
        }

        parsed = _parse_douyin_aweme_payload(payload, "https://www.douyin.com/video/7640032041598198757")

        self.assertEqual(parsed["platform"], "douyin")
        self.assertEqual(parsed["content_type"], "video")
        self.assertEqual(parsed["likes"], 321)
        self.assertEqual(parsed["collects"], 45)
        self.assertEqual(parsed["comments"], 6)
        self.assertEqual(parsed["cover_url"], "https://p3.douyinpic.com/cover.jpeg")
        self.assertEqual(parsed["video_url"], "https://v.douyin.com/video.mp4")


if __name__ == "__main__":
    unittest.main()
