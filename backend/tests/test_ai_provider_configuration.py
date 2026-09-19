import json
import os
import runpy
import unittest
from pathlib import Path
from unittest.mock import patch

from app.engines.case_library import ai_analyzer, import_tasks


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
        self.assertEqual(config["CASE_AI_BASE_URL"], "https://api.deepseek.com")
        self.assertEqual(config["CASE_AI_MODEL"], "deepseek-v4-flash")
        self.assertEqual(config["CASE_ANALYSIS_AI_API_KEY"], "")
        self.assertEqual(config["CASE_ANALYSIS_AI_BASE_URL"], "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.assertEqual(config["CASE_ANALYSIS_AI_MODEL"], "qwen3.6-flash")
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
        self.assertEqual(config["CASE_AI_BASE_URL"], "https://api.deepseek.com")
        self.assertEqual(config["CASE_AI_MODEL"], "deepseek-v4-flash")
        self.assertEqual(config["CASE_ANALYSIS_AI_API_KEY"], "")


class CaseAnalysisProviderTests(unittest.TestCase):
    def setUp(self):
        for module in (ai_analyzer, import_tasks):
            self.enterContext(patch.multiple(
                module,
                CASE_ANALYSIS_AI_API_KEY="analysis-key",
                CASE_ANALYSIS_AI_BASE_URL="https://analysis.example/v1",
                CASE_ANALYSIS_AI_MODEL="analysis-model",
            ))

    def test_case_analyzer_uses_new_provider_configuration(self):
        with patch.object(ai_analyzer, "OpenAI") as provider:
            provider.return_value.chat.completions.create.return_value.choices[0].message.content = (
                '{"content_analysis": "Provider result"}'
            )
            result = ai_analyzer.analyze_case("Title", "image_text", "agency", "Body", [])
            provider.assert_called_once_with(api_key="analysis-key", base_url="https://analysis.example/v1")
            call = provider.return_value.chat.completions.create.call_args
            self.assertEqual(call.kwargs["model"], "analysis-model")
            self.assertEqual(result.content_analysis, "Provider result")

    def test_case_import_uses_new_provider_configuration(self):
        with patch.object(import_tasks.urllib.request, "urlopen") as request:
            request.return_value.__enter__.return_value.read.return_value = json.dumps({
                "choices": [{"message": {"content": '{"content_analysis": "Imported result"}'}}],
            }).encode()
            result, message = import_tasks.generate_case_ai_analysis("Title", "Body", [], "xiaohongshu")
            sent = request.call_args.args[0]
            self.assertEqual(sent.full_url, "https://analysis.example/v1/chat/completions")
            self.assertEqual(sent.get_header("Authorization"), "Bearer analysis-key")
            self.assertEqual(json.loads(sent.data)["model"], "analysis-model")
            self.assertEqual(result.content_analysis, "Imported result")
            self.assertEqual(message, "AI analysis generated by analysis-model")

    def test_missing_key_diagnostic_uses_new_name(self):
        with patch.object(import_tasks, "CASE_ANALYSIS_AI_API_KEY", ""), \
                patch.object(import_tasks.urllib.request, "urlopen") as request:
            _, message = import_tasks.generate_case_ai_analysis("Title", "Body", [], "xiaohongshu")
            self.assertIn("CASE_ANALYSIS_AI_API_KEY missing", message)
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
