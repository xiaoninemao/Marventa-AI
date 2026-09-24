import base64
import unittest
from unittest.mock import Mock, patch

from app.engines.market_insight import repo_parser


class RepoParserTests(unittest.TestCase):
    def test_parse_repo_preserves_readme_structure(self):
        readme = "# Product\n\nBuilt with Python.\n\n## Features\n\n- Fast reports\n"
        with patch.object(
            repo_parser, "_fetch_readme", return_value=(readme, "owner/repo README"),
        ) as fetch:
            document = repo_parser.parse_repo("https://github.com/owner/repo")

        fetch.assert_called_once_with("https://github.com/owner/repo")
        self.assertEqual(document.title, "Product")
        self.assertEqual(document.source_type, "repo")
        self.assertEqual(document.raw_text, readme)
        self.assertIn("python", document.tech_stack)
        self.assertEqual(document.sections[0].heading, "Product")
        self.assertEqual(document.sections[0].subsections[0].heading, "Features")

    def test_gitlab_readme_decodes_response_json(self):
        readme = "# Product\n\n说明"
        response = Mock()
        response.json.return_value = {
            "content": base64.b64encode(readme.encode("utf-8")).decode("ascii"),
        }
        with patch.object(repo_parser.httpx, "get", return_value=response) as fetch:
            content, title = repo_parser._fetch_gitlab("owner", "repo")

        self.assertEqual(content, readme)
        self.assertEqual(title, "owner/repo README")
        response.raise_for_status.assert_called_once_with()
        response.json.assert_called_once_with()
        fetch.assert_called_once_with(
            repo_parser.GITLAB_API.format(owner="owner", repo="repo"),
            follow_redirects=True,
            timeout=15.0,
        )
