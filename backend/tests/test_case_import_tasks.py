import unittest
import sys
import types

dotenv_stub = types.ModuleType("dotenv")
dotenv_stub.load_dotenv = lambda *args, **kwargs: None
sys.modules.setdefault("dotenv", dotenv_stub)

from app.engines.case_library.import_tasks import (
    _extract_douyin_aweme_id,
    _parse_douyin_aweme_payload,
    generate_fallback_analysis,
    _parse_public_html,
    parse_shared_post_text,
)


class CaseImportTaskTests(unittest.TestCase):
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

    def test_generate_fallback_analysis_produces_copywriting_fields(self):
        analysis = generate_fallback_analysis(
            title="Weekend coffee shop launch",
            body="First 100 visitors get a tasting set. The post uses a time-limited launch hook.",
            topics=["coffee", "localLife"],
            platform="xiaohongshu",
        )

        self.assertTrue(analysis.title_suggestions)
        self.assertIn("coffee", analysis.tag_suggestions)
        self.assertTrue(analysis.hook_analysis)
        self.assertTrue(analysis.rewrite_examples)

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
