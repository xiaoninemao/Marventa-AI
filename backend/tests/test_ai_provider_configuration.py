import json
import os
import runpy
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.engines.case_library import ai_analyzer


def valid_case_analysis_payload(video: bool = False) -> dict:
    return {
        "content_analysis": "该案例通过清晰的内容结构、视觉表达和叙事推进建立用户认知，并在关键信息节点持续强化产品价值与互动理由。内容从真实问题切入，再通过场景演示、细节证明和结果呈现完成完整说服链路。",
        "marketing_angle": "以真实使用场景和情绪价值作为核心切入点，降低用户理解门槛并增强内容记忆，同时通过可信体验细节承接转化。",
        "target_audience": "目标受众为关注生活品质、愿意主动搜索解决方案并重视真实体验反馈的年轻消费人群，他们通常会比较细节并参考他人评价。",
        "experience_extraction": "可复用经验包括前置信息钩子、场景化卖点表达、可信细节证明以及低门槛互动引导，适合迁移到同类内容。执行时应保持单一信息重点，并在结尾设置明确的互动或行动路径。",
        "key_highlights": ["开场信息明确有吸引力", "卖点与使用场景结合紧密", "互动问题降低参与门槛"],
        "improvement_suggestions": ["增加结果对比强化说服力", "补充更明确的行动引导"],
        "similar_approaches": ["用户体验型内容结构", "场景问题解决型表达", "情绪价值驱动型叙事"],
        "hook_analysis": "开头通过明确问题和结果预期快速建立观看理由，使用户愿意继续了解后续内容，同时用具体场景和视觉反差强化首屏注意力。",
        "title_suggestions": ["真实体验后的三个发现", "这个场景下它真的很好用"],
        "tag_suggestions": ["真实体验", "场景种草", "实用建议"],
        "rewrite_examples": ["从具体使用场景切入，并用真实细节说明产品如何解决用户问题。"],
        "opening_hook": "前三秒直接展示核心冲突和最终效果，配合简短口播建立继续观看的理由。" if video else "",
        "pacing_analysis": "前段快速建立问题，中段用连续画面解释卖点，结尾放慢节奏完成互动引导。" if video else "",
        "shot_structure": "镜头依次覆盖问题场景、产品特写、使用过程、效果对比和结尾行动提示。" if video else "",
        "script_structure": "口播采用问题提出、方案解释、体验证明和行动号召的递进结构完成表达。" if video else "",
    }


class AIProviderConfigurationTests(unittest.TestCase):
    def load_config(self, environment):
        with patch.dict(os.environ, environment, clear=True), patch("dotenv.load_dotenv"):
            return runpy.run_path(str(Path(__file__).resolve().parents[1] / "app" / "config.py"))

    def test_new_case_analysis_names_are_read(self):
        config = self.load_config({
            "CASE_ANALYSIS_AI_API_KEY": " analysis-key ",
            "CASE_ANALYSIS_AI_BASE_URL": " https://analysis.example/v1 ",
            "CASE_ANALYSIS_AI_MODEL": " vision-model ",
        })
        self.assertEqual(config["CASE_ANALYSIS_AI_API_KEY"], "analysis-key")
        self.assertEqual(config["CASE_ANALYSIS_AI_BASE_URL"], "https://analysis.example/v1")
        self.assertEqual(config["CASE_ANALYSIS_AI_MODEL"], "vision-model")

    def test_old_provider_names_are_not_read_or_exported(self):
        config = self.load_config({
            "DEEPSEEK_API_KEY": "old-key",
            "DEEPSEEK_BASE_URL": "https://old.example/v1",
            "DEEPSEEK_MODEL": "old-model",
            "QWEN_API_KEY": "old-analysis-key",
            "QWEN_BASE_URL": "https://old-analysis.example/v1",
            "QWEN_MODEL": "old-analysis-model",
        })
        self.assertEqual(config["CASE_AI_API_KEY"], "")
        self.assertEqual(config["CASE_AI_BASE_URL"], "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(config["CASE_AI_MODEL"], "qwen3.8-flash")
        self.assertEqual(config["CASE_ANALYSIS_AI_API_KEY"], "")
        self.assertEqual(config["CASE_ANALYSIS_AI_BASE_URL"], "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(config["CASE_ANALYSIS_AI_MODEL"], "qwen3.8-flash")
        self.assertFalse(any(key.startswith(("QWEN_", "DEEPSEEK_")) for key in config))

    def test_primary_configuration_is_inherited_by_card_modification(self):
        config = self.load_config({
            "CASE_AI_API_KEY": "primary-key",
            "CASE_AI_BASE_URL": "https://primary.example/v1",
            "CASE_AI_MODEL": "primary-model",
        })
        self.assertEqual(config["CASE_AI_API_KEY"], "primary-key")
        self.assertEqual(config["MODIFY_CARD_AI_API_KEY"], "primary-key")
        self.assertEqual(config["MODIFY_CARD_AI_BASE_URL"], "https://primary.example/v1")
        self.assertEqual(config["MODIFY_CARD_AI_MODEL"], "primary-model")

    def test_removed_legacy_key_cannot_enable_ai(self):
        config = self.load_config({"LWAN_API_KEY_3RD": "legacy-key"})
        self.assertNotIn("LWAN_API_KEY_3RD", config)
        self.assertEqual(config["CASE_AI_API_KEY"], "")
        self.assertEqual(config["MODIFY_CARD_AI_API_KEY"], "")
        self.assertEqual(config["CASE_AI_BASE_URL"], "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(config["CASE_AI_MODEL"], "qwen3.8-flash")
        self.assertEqual(config["CASE_ANALYSIS_AI_API_KEY"], "")


class CaseAnalysisProviderTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.multiple(
            ai_analyzer,
            CASE_ANALYSIS_AI_API_KEY="analysis-key",
            CASE_ANALYSIS_AI_BASE_URL="https://analysis.example/v1",
            CASE_ANALYSIS_AI_MODEL="analysis-model",
        ))

    def test_case_analyzer_uses_new_provider_configuration(self):
        with patch.object(ai_analyzer, "OpenAI") as provider:
            provider.return_value.chat.completions.create.return_value.choices[0].message.content = (
                json.dumps(valid_case_analysis_payload(), ensure_ascii=False)
            )
            result = ai_analyzer.analyze_case("Title", "image_text", "Body", [])
            provider.assert_called_once_with(api_key="analysis-key", base_url="https://analysis.example/v1")
            call = provider.return_value.chat.completions.create.call_args
            self.assertEqual(call.kwargs["model"], "analysis-model")
            self.assertEqual(call.kwargs["response_format"], {"type": "json_object"})
            self.assertIn("内容结构", result.content_analysis)

    def test_case_analyzer_retries_invalid_structured_output_once(self):
        invalid = MagicMock()
        invalid.choices[0].message.content = "{}"
        valid = MagicMock()
        valid.choices[0].message.content = json.dumps(
            valid_case_analysis_payload(), ensure_ascii=False,
        )
        with patch.object(ai_analyzer, "OpenAI") as provider:
            provider.return_value.chat.completions.create.side_effect = [invalid, valid]
            result = ai_analyzer.analyze_case("Title", "image_text", "Body", [])

        self.assertIn("内容结构", result.content_analysis)
        self.assertEqual(provider.return_value.chat.completions.create.call_count, 2)

    def test_video_analysis_requires_video_specific_fields(self):
        payload = valid_case_analysis_payload()
        with self.assertRaisesRegex(ValueError, "video-specific"):
            ai_analyzer.validate_generated_case_analysis(payload, "video")



if __name__ == "__main__":
    unittest.main()
