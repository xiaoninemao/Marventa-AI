import json
import unittest
from unittest.mock import MagicMock, patch

from app.engines.content_generator.ai_analyzer import (
    generate_document,
    _validate_content_format,
    _resolve_content_format,
    _validate_generated_cards,
)
from app.engines.content_generator.models import ContentCard


class ContentCardFormatTests(unittest.TestCase):
    def _valid_work_report(self):
        section_titles = {
            "project_background_and_goals": "项目背景与目标",
            "target_audience": "目标受众洞察",
            "core_communication_strategy": "核心传播策略",
            "content_ideas": "内容创意方案",
            "publishing_schedule": "平台发布节奏",
            "risks_and_optimization": "风险与优化建议",
            "next_steps": "下一步行动",
        }
        return json.dumps({
            "schema_version": 1,
            "title_zh": "小金猫小红书营销策划报告",
            "title_en": "Xiao Jin Mao Xiaohongshu Marketing Strategy Report",
            "summary_zh": "本报告围绕小金猫的品牌传播目标展开，形成从用户洞察到内容执行与后续复盘的完整营销方案。",
            "summary_en": "This report develops a complete marketing strategy for Xiao Jin Mao, connecting audience insight, content execution, publishing, and performance review.",
            "sections": [{
                "section_type": section_type,
                "title_zh": title,
                "title_en": section_type.replace("_", " ").title(),
                "paragraphs_zh": [
                    "第一段详细说明本章节的策略依据、业务背景与需要解决的核心问题，确保团队理解执行原因。",
                    "第二段详细说明具体执行方法、协作步骤与预期效果，为后续落地和复盘提供清晰依据。",
                ],
                "paragraphs_en": [
                    "The first paragraph explains the strategic rationale, business context, and core problem in sufficient detail for the delivery team.",
                    "The second paragraph defines the execution method, collaboration steps, and expected outcome so implementation can be measured.",
                ],
            } for section_type, title in section_titles.items()],
        }, ensure_ascii=False)

    def _cards(self, script_content: str):
        return [
            {"card_type": "script", "title": "脚本方案", "content": script_content},
            {"card_type": "title", "title": "标题文案", "content": "标题内容"},
            {"card_type": "copy", "title": "发布文案", "content": "发布内容"},
            {"card_type": "hashtags", "title": "话题标签", "content": "话题内容"},
            {"card_type": "visual", "title": "视觉方案", "content": "视觉内容"},
        ]

    def test_explicit_content_format_preference_wins(self):
        cards = [{"title": "图文发布计划", "content": "小红书图文正文与图片顺序"}]

        self.assertEqual(
            _resolve_content_format(["short_video"], [], cards),
            "short_video",
        )

    def test_generated_image_text_content_is_detected(self):
        cards = [{
            "title": "图文发布计划",
            "preview": "小红书图文种草",
            "content": "包含图片顺序、封面图、正文排版和互动引导",
        }]

        self.assertEqual(_resolve_content_format([], [], cards), "image_text")

    def test_generated_video_content_is_detected(self):
        cards = [{
            "title": "视频分镜脚本",
            "preview": "15秒短视频",
            "content": "包含镜头、口播、时长和前3秒钩子",
        }]

        self.assertEqual(_resolve_content_format([], [], cards), "short_video")

    def test_image_text_generation_rejects_video_terms(self):
        with self.assertRaisesRegex(ValueError, "mix content formats"):
            _validate_generated_cards(
                self._cards("图文正文中又包含分镜和口播"),
                "image_text",
            )

    def test_video_generation_rejects_image_text_terms(self):
        with self.assertRaisesRegex(ValueError, "mix content formats"):
            _validate_generated_cards(
                self._cards("短视频脚本中又包含图片顺序和图文正文"),
                "short_video",
            )

    def test_generation_requires_one_card_of_each_type(self):
        with self.assertRaisesRegex(ValueError, "exactly one card"):
            _validate_generated_cards(self._cards("图文正文")[:-1], "image_text")

    def test_single_format_card_set_is_accepted(self):
        _validate_generated_cards(
            self._cards("图文正文包含图片顺序、配图和正文排版"),
            "image_text",
        )

    def test_single_card_edit_cannot_switch_content_format(self):
        with self.assertRaisesRegex(ValueError, "mix content formats"):
            _validate_content_format(
                [{"title": "图文发布计划", "content": "改成分镜和口播脚本"}],
                "image_text",
            )

    def test_document_generation_uses_only_cards_and_a_larger_token_budget(self):
        client = MagicMock()
        client.chat.completions.create.return_value.choices = [
            MagicMock(message=MagicMock(content=self._valid_work_report())),
        ]
        cards = [ContentCard(
            id="card-1",
            card_type="copy",
            title="发布文案",
            preview="摘要",
            content="卡片正文",
            tips=[],
        )]

        with patch(
            "app.engines.content_generator.ai_analyzer._get_client",
            return_value=client,
        ):
            result = generate_document(cards)

        generated = json.loads(result)
        self.assertEqual(generated["schema_version"], 1)
        self.assertEqual(generated["title_zh"], "小金猫小红书营销策划报告")
        self.assertEqual(
            generated["title_en"],
            "Xiao Jin Mao Xiaohongshu Marketing Strategy Report",
        )
        request = client.chat.completions.create.call_args.kwargs
        self.assertEqual(request["max_tokens"], 8192)
        self.assertEqual(request["response_format"], {"type": "json_object"})
        user_prompt = request["messages"][1]["content"]
        self.assertIn("Content cards:", user_prompt)
        self.assertIn("卡片正文", user_prompt)
        self.assertNotIn("Conversation context:", user_prompt)

    def test_document_generation_retries_invalid_json_once(self):
        client = MagicMock()
        client.chat.completions.create.side_effect = [
            MagicMock(choices=[MagicMock(message=MagicMock(content='{"title":"不完整"}'))]),
            MagicMock(choices=[MagicMock(message=MagicMock(content=self._valid_work_report()))]),
        ]
        cards = [ContentCard(
            id="card-1", card_type="copy", title="发布文案",
            preview="摘要", content="卡片正文", tips=[],
        )]

        with patch(
            "app.engines.content_generator.ai_analyzer._get_client",
            return_value=client,
        ):
            result = generate_document(cards)

        self.assertEqual(json.loads(result)["sections"][0]["title_zh"], "项目背景与目标")
        self.assertEqual(client.chat.completions.create.call_count, 2)

    def test_document_generation_rejects_invalid_json_after_retry(self):
        client = MagicMock()
        client.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content="{}"))],
        )
        cards = [ContentCard(
            id="card-1", card_type="copy", title="发布文案",
            preview="摘要", content="卡片正文", tips=[],
        )]

        with patch(
            "app.engines.content_generator.ai_analyzer._get_client",
            return_value=client,
        ):
            with self.assertRaisesRegex(ValueError, "invalid work report"):
                generate_document(cards)

        self.assertEqual(client.chat.completions.create.call_count, 2)


if __name__ == "__main__":
    unittest.main()
