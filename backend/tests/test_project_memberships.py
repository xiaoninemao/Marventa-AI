import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.organizations import router as organization_router
from app.api.market_insight import router as market_insight_router
from app.api.case_library import router as case_library_router
from app.api.content_generator import router as content_generator_router
from app.api.publishing import router as publishing_router
from app.api import publishing as publishing_api
from app.api import market_insight as market_insight_api
from app.api import case_library as case_library_api
from app.auth import storage as auth_storage
from app.auth.security import create_access_token
from app.engines.publishing import storage as publishing_storage
from app.engines.market_insight import storage as market_insight_storage
from app.engines.market_insight.models import AIAnalysis, ParsedDocument
from app.engines.case_library import storage as case_storage
from app.engines.case_library import favorites as case_favorites
from app.engines.case_library import import_tasks as case_import_tasks
from app.engines.case_library.models import CaseAIAnalysis
from app.engines.content_generator import storage as content_storage
from app.engines.content_generator.models import ChatMessage
from app.engines.portfolio import storage as portfolio_storage


class ProjectMembershipTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db_path = str(Path(directory.name) / "project-memberships.db")
        self.media_root = Path(directory.name) / "media"
        self.media_root.mkdir()
        self.enterContext(patch.object(auth_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(publishing_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(market_insight_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(case_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(case_import_tasks, "DB_PATH", self.db_path))
        self.enterContext(patch.object(content_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(portfolio_storage, "DB_PATH", self.db_path))
        self.enterContext(patch.object(publishing_api, "MEDIA_ROOT", str(self.media_root)))
        self.enterContext(patch.object(market_insight_api, "MEDIA_ROOT", str(self.media_root)))
        self.enterContext(patch.object(case_library_api, "MEDIA_ROOT", str(self.media_root)))
        self.enterContext(patch.object(market_insight_storage, "MEDIA_ROOT", str(self.media_root)))
        self.owner = auth_storage.create_user("owner", "owner@example.com", "test-hash")
        self.admin = auth_storage.create_user("admin", "admin@example.com", "test-hash")
        self.member = auth_storage.create_user("member", "member@example.com", "test-hash")
        self.outsider = auth_storage.create_user("outsider", "outsider@example.com", "test-hash")
        self.organization = auth_storage.get_current_organization(self.owner["id"])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO organization_memberships VALUES (?, ?, 'admin', '2026-01-01')",
                (self.organization["id"], self.admin["id"]),
            )
            conn.execute(
                "INSERT INTO organization_memberships VALUES (?, ?, 'member', '2026-01-01')",
                (self.organization["id"], self.member["id"]),
            )
            conn.execute(
                "UPDATE user_organization_preferences SET organization_id = ? WHERE user_id IN (?, ?)",
                (self.organization["id"], self.admin["id"], self.member["id"]),
            )
        self.project = publishing_storage.create_manual_project(
            self.owner["id"], title="Private Project",
        )
        app = FastAPI()
        app.include_router(organization_router)
        app.include_router(publishing_router)
        app.include_router(market_insight_router)
        app.include_router(case_library_router)
        app.include_router(content_generator_router)
        self.client = self.enterContext(TestClient(app))

    @staticmethod
    def headers(user_id):
        token = create_access_token(user_id)
        return {"Authorization": "Bearer " + token}

    def test_organization_members_do_not_automatically_access_project(self):
        owner_projects = self.client.get(
            "/api/v1/publishing/projects", headers=self.headers(self.owner["id"]),
        ).json()["data"]
        self.assertEqual(len(owner_projects), 1)
        self.assertEqual(owner_projects[0]["role"], "owner")
        self.assertEqual(owner_projects[0]["member_count"], 1)
        self.assertEqual(owner_projects[0]["members"][0]["email"], "owner@example.com")

        member_projects = self.client.get(
            "/api/v1/publishing/projects", headers=self.headers(self.member["id"]),
        ).json()["data"]
        self.assertEqual(member_projects, [])
        self.assertEqual(
            self.client.get(
                f"/api/v1/publishing/projects/{self.project.id}",
                headers=self.headers(self.member["id"]),
            ).status_code,
            404,
        )

    def test_project_names_can_repeat_across_organizations(self):
        first = publishing_storage.create_manual_project(
            self.owner["id"], title="Shared Launch Plan",
        )
        second_organization = auth_storage.create_organization(
            self.owner["id"], "Second Organization",
        )
        auth_storage.switch_organization(self.owner["id"], second_organization["id"])
        second = publishing_storage.create_manual_project(
            self.owner["id"], title="Shared Launch Plan",
        )

        second_projects = publishing_storage.list_projects(self.owner["id"])
        self.assertEqual([project.id for project in second_projects], [second.id])

        auth_storage.switch_organization(self.owner["id"], self.organization["id"])
        first_projects = publishing_storage.list_projects(self.owner["id"])
        first_project_ids = {project.id for project in first_projects}
        self.assertIn(first.id, first_project_ids)
        self.assertNotIn(second.id, first_project_ids)

    def test_project_names_can_repeat_between_creators_in_one_organization(self):
        member_project = publishing_storage.create_manual_project(
            self.member["id"], title=self.project.title,
        )
        self.assertEqual(member_project.title, self.project.title)

        with self.assertRaises(publishing_storage.ProjectNameExists):
            publishing_storage.create_manual_project(
                self.owner["id"], title=self.project.title,
            )

    def test_insight_requires_project_and_inherits_project_access(self):
        manual_path = "/api/v1/market_insight/manual"
        missing_project = self.client.post(
            manual_path,
            headers=self.headers(self.owner["id"]),
            json={"ai_analysis": {"product_name": "Missing project"}},
        )
        self.assertEqual(missing_project.status_code, 422)

        created = self.client.post(
            manual_path,
            headers=self.headers(self.owner["id"]),
            json={
                "project_id": self.project.id,
                "ai_analysis": {
                    "product_name": "Project insight",
                    "product_summary": "Bound to a project",
                },
            },
        )
        self.assertEqual(created.status_code, 200)
        insight = created.json()["data"]
        self.assertEqual(insight["project_id"], self.project.id)
        self.assertEqual(insight["project_title"], self.project.title)

        failed_document = market_insight_storage.save_insight(
            market_insight_storage.ParsedDocument(
                title="Failed repository",
                source_type="repo",
                raw_text="https://github.com/example/repository\n" + ("x" * 50_001),
                ai_analysis=market_insight_storage.AIAnalysis(
                    product_name="Failed repository",
                ),
            ),
            filename="https://github.com/example/repository",
            file_size=0,
            owner_id=self.owner["id"],
            project_id=self.project.id,
            status="failed",
        )
        failed_source = market_insight_storage.add_insight_source(
            failed_document.id,
            "https://github.com/example/repository",
            0,
            "repo",
            "https://github.com/example/repository\n" + ("x" * 50_001),
        )
        failed_update = self.client.put(
            f"/api/v1/market_insight/history/{failed_document.id}",
            headers=self.headers(self.owner["id"]),
            json={"ai_analysis": {"product_name": "Forbidden edit"}},
        )
        self.assertEqual(failed_update.status_code, 409)
        self.assertEqual(
            failed_update.json()["detail"],
            "Document insights cannot be edited while analyzing or failed",
        )
        renamed_failed = self.client.patch(
            f"/api/v1/market_insight/history/{failed_document.id}/name",
            headers=self.headers(self.owner["id"]),
            json={"name": "Renamed failed insight"},
        )
        self.assertEqual(renamed_failed.status_code, 200)
        self.assertEqual(renamed_failed.json()["data"]["title"], "Renamed failed insight")
        self.assertEqual(
            renamed_failed.json()["data"]["ai_analysis"]["product_name"],
            "Failed repository",
        )
        preview = self.client.get(
            f"/api/v1/market_insight/history/{failed_document.id}/sources/{failed_source.id}/preview",
            headers=self.headers(self.owner["id"]),
        )
        self.assertEqual(preview.status_code, 200)
        first_page = preview.json()["data"]
        self.assertEqual(len(first_page["content"]), 20_000)
        self.assertTrue(first_page["has_more"])
        second_page = self.client.get(
            f"/api/v1/market_insight/history/{failed_document.id}/sources/{failed_source.id}/preview",
            headers=self.headers(self.owner["id"]),
            params={"offset": first_page["next_offset"], "limit": 50_000},
        ).json()["data"]
        self.assertFalse(second_page["has_more"])
        self.assertEqual(
            len(first_page["content"] + second_page["content"]),
            len("https://github.com/example/repository\n") + 50_001,
        )
        self.assertEqual(
            self.client.get(
                f"/api/v1/market_insight/history/{failed_document.id}/sources/{failed_source.id}/preview",
                headers=self.headers(self.member["id"]),
            ).status_code,
            404,
        )
        with patch.object(market_insight_api, "analyze_async") as analyze_async:
            retried = self.client.post(
                f"/api/v1/market_insight/history/{failed_document.id}/retry",
                headers=self.headers(self.owner["id"]),
            )
        self.assertEqual(retried.status_code, 200)
        self.assertEqual(retried.json()["data"]["status"], "analyzing")
        analyze_async.assert_called_once()
        self.assertEqual(
            self.client.patch(
                f"/api/v1/market_insight/history/{failed_document.id}/name",
                headers=self.headers(self.owner["id"]),
                json={"name": "Blocked while analyzing"},
            ).status_code,
            409,
        )
        self.assertEqual(
            self.client.post(
                f"/api/v1/market_insight/history/{failed_document.id}/retry",
                headers=self.headers(self.owner["id"]),
            ).status_code,
            409,
        )

        owner_history = self.client.get(
            "/api/v1/market_insight/history",
            headers=self.headers(self.owner["id"]),
        ).json()["data"]
        self.assertCountEqual(
            [item["id"] for item in owner_history],
            [failed_document.id, insight["id"]],
        )

        member_history = self.client.get(
            "/api/v1/market_insight/history",
            headers=self.headers(self.member["id"]),
        ).json()["data"]
        self.assertEqual(member_history, [])
        self.assertEqual(
            self.client.get(
                f"/api/v1/market_insight/history/{insight['id']}",
                headers=self.headers(self.member["id"]),
            ).status_code,
            404,
        )

        project_members = f"/api/v1/publishing/projects/{self.project.id}/members"
        self.assertEqual(
            self.client.post(
                project_members,
                headers=self.headers(self.owner["id"]),
                json={"email": "member@example.com", "role": "member"},
            ).status_code,
            200,
        )
        insight_path = f"/api/v1/market_insight/history/{insight['id']}"
        self.assertEqual(
            self.client.get(
                insight_path, headers=self.headers(self.member["id"]),
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.put(
                insight_path,
                headers=self.headers(self.member["id"]),
                json={"ai_analysis": {"product_name": "Project insight", "product_summary": "Member edit"}},
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.delete(
                insight_path, headers=self.headers(self.member["id"]),
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                project_members,
                headers=self.headers(self.owner["id"]),
                json={"email": "admin@example.com", "role": "admin"},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.put(
                insight_path,
                headers=self.headers(self.admin["id"]),
                json={"ai_analysis": {"product_name": "Administrator edit"}},
            ).status_code,
            200,
        )

        member_created = self.client.post(
            manual_path,
            headers=self.headers(self.member["id"]),
            json={
                "project_id": self.project.id,
                "ai_analysis": {"product_name": "Member-created insight"},
            },
        )
        self.assertEqual(member_created.status_code, 200)
        member_insight_path = (
            f"/api/v1/market_insight/history/{member_created.json()['data']['id']}"
        )
        self.assertEqual(
            self.client.put(
                member_insight_path,
                headers=self.headers(self.member["id"]),
                json={"ai_analysis": {"product_name": "Creator edit"}},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.delete(
                member_insight_path, headers=self.headers(self.member["id"]),
            ).status_code,
            200,
        )

    def test_project_members_cannot_access_other_members_insights(self):
        with sqlite3.connect(self.db_path) as conn:
            for user, role in ((self.member, "member"), (self.admin, "admin")):
                conn.execute(
                    "INSERT INTO project_memberships VALUES (?, ?, ?, '2026-01-01')",
                    (self.project.id, user["id"], role),
                )
        insight = market_insight_storage.save_insight(
            market_insight_storage.ParsedDocument(
                title="Shared insight", source_type="repo", raw_text="Source material",
                ai_analysis=market_insight_storage.AIAnalysis(product_name="Shared insight"),
            ),
            filename="source", file_size=0, owner_id=self.owner["id"],
            project_id=self.project.id, status="completed",
        )
        market_insight_storage.add_insight_source(
            insight.id, "source", 0, "repo", "Source material",
        )
        path = f"/api/v1/market_insight/history/{insight.id}"
        member_headers = self.headers(self.member["id"])
        with patch.object(market_insight_api, "analyze_async") as analyze:
            self.assertEqual(self.client.patch(
                path + "/name", headers=member_headers, json={"name": "Member renamed"},
            ).status_code, 403)
            renamed_analysis = self.client.put(
                path, headers=member_headers,
                json={"ai_analysis": {"product_name": "Indirect rename"}},
            )
            self.assertEqual(renamed_analysis.status_code, 403)
            edited = self.client.put(
                path, headers=member_headers,
                json={"ai_analysis": {"product_name": "Shared insight", "product_summary": "Member content"}},
            )
            self.assertEqual(edited.status_code, 403)
            self.assertEqual(self.client.delete(path, headers=member_headers).status_code, 403)
            self.assertEqual(self.client.post(path + "/retry", headers=member_headers).status_code, 403)
            self.assertEqual(self.client.post(path + "/retry", headers=member_headers).status_code, 403)
            self.assertEqual(self.client.patch(
                path + "/name", headers=member_headers, json={"name": "In progress"},
            ).status_code, 403)
            market_insight_storage.update_insight_status(insight.id, "failed")
            self.assertEqual(self.client.post(path + "/retry", headers=member_headers).status_code, 403)
            analyze.assert_not_called()
            market_insight_storage.update_insight_status(insight.id, "completed")
            for actor in (self.owner, self.admin):
                self.assertEqual(self.client.patch(
                    path + "/name", headers=self.headers(actor["id"]),
                    json={"name": "Authorized rename"},
                ).status_code, 200)
            self.assertEqual(self.client.post(path + "/retry", headers=member_headers).status_code, 403)
            completed = market_insight_storage.update_insight_status(
                insight.id, "completed",
                market_insight_storage.AIAnalysis(product_name="New AI product name"),
            )
            self.assertEqual(completed.title, "Authorized rename")
            self.assertEqual(completed.ai_analysis.product_name, "New AI product name")
            market_insight_storage.init_db()
            self.assertEqual(market_insight_storage.get_insight(insight.id).title, "Authorized rename")
            outsider = self.headers(self.outsider["id"])
            self.assertEqual(self.client.patch(
                path + "/name", headers=outsider, json={"name": "Denied"},
            ).status_code, 404)
            self.assertEqual(self.client.put(
                path, headers=outsider, json={"ai_analysis": {"product_name": "Denied"}},
            ).status_code, 404)
            self.assertEqual(self.client.post(path + "/retry", headers=outsider).status_code, 404)
            other_org = auth_storage.create_organization(self.member["id"], "Other organization")
            auth_storage.switch_organization(self.member["id"], other_org["id"])
            self.assertEqual(self.client.post(path + "/retry", headers=member_headers).status_code, 404)
            self.assertEqual(self.client.put(
                path, headers=member_headers, json={"ai_analysis": {"product_name": "Denied"}},
            ).status_code, 404)
            self.assertEqual(self.client.delete(
                path, headers=self.headers(self.admin["id"]),
            ).status_code, 200)

    def test_insight_name_migration_preserves_existing_display_names_once(self):
        insight = market_insight_storage.save_manual_insight(
            market_insight_storage.AIAnalysis(product_name="Existing displayed name"),
            owner_id=self.owner["id"], project_id=self.project.id,
        )
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE insights SET title='Original filename' WHERE id=?", (insight.id,))
            conn.execute("DELETE FROM market_insight_migrations WHERE key='stable-insight-title-v3'")
        market_insight_storage.init_db()
        self.assertEqual(market_insight_storage.get_insight(insight.id).title, "Existing displayed name")
        market_insight_storage.rename_insight(insight.id, "Custom name", self.owner["id"])
        market_insight_storage.update_insight_status(
            insight.id, "completed", market_insight_storage.AIAnalysis(product_name="AI name"),
        )
        market_insight_storage.init_db()
        self.assertEqual(market_insight_storage.get_insight(insight.id).title, "Custom name")

    def test_project_member_cannot_manage_insights(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO project_memberships VALUES (?, ?, 'member', '2026-01-01')",
                (self.project.id, self.member["id"]),
            )
        insight = market_insight_storage.save_manual_insight(
            market_insight_storage.AIAnalysis(product_name="Protected"),
            owner_id=self.owner["id"], project_id=self.project.id,
        )
        path = f"/api/v1/market_insight/history/{insight.id}"
        headers = self.headers(self.member["id"])
        self.assertEqual(self.client.patch(path + "/name", headers=headers, json={"name": "Denied"}).status_code, 403)
        self.assertEqual(self.client.delete(path, headers=headers).status_code, 403)
        self.assertEqual(self.client.put(
            path, headers=headers, json={"ai_analysis": {"product_name": "Product", "product_summary": "Allowed"}},
        ).status_code, 403)
        self.assertEqual(market_insight_storage.get_insight(insight.id).title, "Protected")

    def test_uploaded_insight_source_file_is_persisted_and_deleted(self):
        uploaded = self.client.post(
            "/api/v1/market_insight/parse?with_ai=false",
            headers=self.headers(self.owner["id"]),
            data={"project_id": self.project.id},
            files=[
                ("files", ("first.md", b"# First source\n\nBody one", "text/markdown")),
                ("files", ("second.md", b"# Second source\n\nBody two", "text/markdown")),
            ],
        )
        self.assertEqual(uploaded.status_code, 200)
        record_id = uploaded.json()["data"]["record_id"]
        record = market_insight_storage.get_insight(record_id)
        self.assertEqual(record.title, "First source (2 sources)")
        self.assertEqual(record.filename, "2 sources")
        with sqlite3.connect(self.db_path) as conn:
            insight_count = conn.execute(
                "SELECT COUNT(*) FROM insights",
            ).fetchone()[0]
            aggregate_raw_text = conn.execute(
                "SELECT raw_text FROM insights WHERE id = ?",
                (record_id,),
            ).fetchone()[0]
            source_rows = conn.execute(
                "SELECT id, filename, source_file_path FROM insight_sources "
                "WHERE insight_id = ? ORDER BY position",
                (record_id,),
            ).fetchall()
        self.assertEqual(insight_count, 1)
        self.assertEqual(aggregate_raw_text, "")
        self.assertEqual([row[1] for row in source_rows], ["first.md", "second.md"])
        source_paths = [self.media_root / row[2] for row in source_rows]
        self.assertEqual(
            [path.read_bytes() for path in source_paths],
            [b"# First source\n\nBody one", b"# Second source\n\nBody two"],
        )

        sources_response = self.client.get(
            f"/api/v1/market_insight/history/{record_id}/sources",
            headers=self.headers(self.owner["id"]),
        )
        self.assertEqual(sources_response.status_code, 200)
        self.assertEqual(len(sources_response.json()["data"]), 2)
        searched = self.client.get(
            "/api/v1/market_insight/history",
            headers=self.headers(self.owner["id"]),
            params={"search": "second.md"},
        )
        self.assertEqual(
            [item["id"] for item in searched.json()["data"]],
            [record_id],
        )

        for row, expected in zip(
            source_rows,
            (b"# First source\n\nBody one", b"# Second source\n\nBody two"),
        ):
            downloaded = self.client.get(
                f"/api/v1/market_insight/history/{record_id}/sources/{row[0]}/file",
                headers=self.headers(self.owner["id"]),
            )
            self.assertEqual(downloaded.status_code, 200)
            self.assertEqual(downloaded.content, expected)
        self.assertEqual(
            self.client.get(
                f"/api/v1/market_insight/history/{record_id}/sources/{source_rows[0][0]}/file",
                headers=self.headers(self.member["id"]),
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.delete(
                f"/api/v1/market_insight/history/{record_id}",
                headers=self.headers(self.owner["id"]),
            ).status_code,
            200,
        )
        self.assertTrue(all(not path.exists() for path in source_paths))

    def test_insight_source_reconciliation_repairs_file_drift(self):
        insight = market_insight_storage.save_manual_insight(
            market_insight_storage.AIAnalysis(product_name="Reconcile"),
            owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        source = market_insight_storage.add_insight_source(
            insight.id,
            "missing.md",
            7,
            "markdown",
            "missing",
            f"market_insight_sources/{insight.id}/missing.md",
        )
        orphan = self.media_root / "market_insight_sources" / "orphan" / "unused.md"
        orphan.parent.mkdir(parents=True)
        orphan.write_text("orphan")
        conn = market_insight_storage._get_conn()
        market_insight_storage._reconcile_source_files(conn)
        conn.commit()
        conn.close()
        with sqlite3.connect(self.db_path) as conn:
            source_path = conn.execute(
                "SELECT source_file_path FROM insight_sources WHERE id = ?",
                (source.id,),
            ).fetchone()[0]
        self.assertEqual(source_path, "")
        self.assertFalse(orphan.exists())

    def test_project_invitee_must_belong_to_organization(self):
        response = self.client.post(
            f"/api/v1/publishing/projects/{self.project.id}/members",
            headers=self.headers(self.owner["id"]),
            json={"email": "outsider@example.com", "role": "member"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "Member is not in the organization")

    def test_case_content_and_portfolio_assets_inherit_project_access(self):
        case = case_storage.create_case(
            title="Project case",
            content_type="image_text",
            description="Case content",
            tags=[],
            video_url="",
            image_urls=[],
            owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        favorite_path = f"/api/v1/case_library/cases/{case.id}/favorite"
        self.assertEqual(
            self.client.post(
                favorite_path, headers=self.headers(self.member["id"]),
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                favorite_path, headers=self.headers(self.owner["id"]),
            ).status_code,
            200,
        )
        favorites = self.client.get(
            "/api/v1/case_library/my/favorites",
            headers=self.headers(self.owner["id"]),
        )
        self.assertEqual(favorites.status_code, 200)
        self.assertEqual(
            [item["id"] for item in favorites.json()["data"]["cases"]],
            [case.id],
        )
        self.assertEqual(
            self.client.delete(
                favorite_path, headers=self.headers(self.owner["id"]),
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(
                "/api/v1/case_library/my/favorites",
                headers=self.headers(self.owner["id"]),
            ).json()["data"]["cases"],
            [],
        )
        session = content_storage.create_session(self.owner["id"], self.project.id)
        content_storage.update_session(
            session.id,
            messages=[ChatMessage(role="user", content="Project content")],
        )
        script = portfolio_storage.create_script(
            self.owner["id"],
            "Project work",
            "Portfolio content",
            source_session_id=session.id,
            project_id=self.project.id,
        )
        for table, record_id in (
            ("cases", case.id),
            ("creation_sessions", session.id),
            ("portfolio", script.id),
        ):
            with sqlite3.connect(self.db_path) as conn:
                with self.assertRaises(sqlite3.IntegrityError):
                    conn.execute(
                        f"UPDATE {table} SET project_id = '' WHERE id = ?",
                        (record_id,),
                    )

        self.assertEqual(
            [item.id for item in case_storage.list_user_cases(self.owner["id"], project_id=self.project.id)],
            [case.id],
        )
        case_response = self.client.get(
            f"/api/v1/case_library/my/cases?project_id={self.project.id}",
            headers=self.headers(self.owner["id"]),
        )
        self.assertEqual(case_response.status_code, 200)
        self.assertEqual(
            [item["id"] for item in case_response.json()["data"]["cases"]],
            [case.id],
        )

        self.assertEqual(
            [item.id for item in content_storage.list_sessions(self.owner["id"], self.project.id)],
            [session.id],
        )
        self.assertEqual(
            [item.id for item in portfolio_storage.list_scripts(self.owner["id"], self.project.id)],
            [script.id],
        )
        self.assertEqual(case_storage.list_user_cases(self.member["id"]), [])
        self.assertEqual(content_storage.list_sessions(self.member["id"]), [])
        self.assertEqual(portfolio_storage.list_scripts(self.member["id"]), [])

        members_path = f"/api/v1/publishing/projects/{self.project.id}/members"
        self.assertEqual(
            self.client.post(
                members_path,
                headers=self.headers(self.owner["id"]),
                json={"email": "member@example.com", "role": "member"},
            ).status_code,
            200,
        )
        self.assertEqual(
            [item.id for item in case_storage.list_user_cases(self.member["id"], project_id=self.project.id)],
            [case.id],
        )
        self.assertEqual(
            [item.id for item in content_storage.list_sessions(self.member["id"], self.project.id)],
            [session.id],
        )
        self.assertEqual(
            [item.id for item in portfolio_storage.list_scripts(self.member["id"], self.project.id)],
            [script.id],
        )
        with self.assertRaises(ValueError):
            publishing_storage.create_task_from_session(
                self.member["id"], session.id, project_id=self.project.id,
            )

    def test_empty_content_canvas_is_persisted_and_listed(self):
        create_response = self.client.post(
            "/api/v1/content_generator/sessions",
            headers=self.headers(self.owner["id"]),
            json={"project_id": self.project.id, "title": "Launch campaign"},
        )
        self.assertEqual(create_response.status_code, 200)
        self.assertEqual(create_response.json()["data"]["title"], "Launch campaign")
        self.assertEqual(create_response.json()["data"]["project_role"], "owner")
        self.assertEqual(create_response.json()["data"]["organization_id"], self.organization["id"])
        canvas = content_storage.get_session(
            create_response.json()["data"]["id"], self.owner["id"],
        )

        self.assertEqual(canvas.title, "Launch campaign")
        self.assertEqual(canvas.messages, [])
        self.assertEqual(canvas.cards, [])
        self.assertIn(
            canvas.id,
            [item.id for item in content_storage.list_sessions(self.owner["id"], self.project.id)],
        )
        response = self.client.get(
            f"/api/v1/content_generator/sessions?project_id={self.project.id}",
            headers=self.headers(self.owner["id"]),
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(canvas.id, [item["id"] for item in response.json()["data"]])

    def test_members_see_all_project_assets_but_admins_manage_all(self):
        with sqlite3.connect(self.db_path) as conn:
            for user, role in ((self.member, "member"), (self.admin, "admin")):
                conn.execute(
                    "INSERT INTO project_memberships VALUES (?, ?, ?, '2026-01-01')",
                    (self.project.id, user["id"], role),
                )

        owner_insight = market_insight_storage.save_manual_insight(
            market_insight_storage.AIAnalysis(product_name="Owner insight"),
            self.owner["id"], self.project.id,
        )
        member_insight = market_insight_storage.save_manual_insight(
            market_insight_storage.AIAnalysis(product_name="Member insight"),
            self.member["id"], self.project.id,
        )
        owner_case = case_storage.create_case(
            title="Owner case", content_type="image_text", description="",
            tags=[], video_url="", image_urls=[], owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        member_case = case_storage.create_case(
            title="Member case", content_type="image_text", description="",
            tags=[], video_url="", image_urls=[], owner_id=self.member["id"],
            project_id=self.project.id,
        )
        owner_creation = content_storage.create_session(
            self.owner["id"], self.project.id, "Owner creation",
        )
        member_creation = content_storage.create_session(
            self.member["id"], self.project.id, "Member creation",
        )
        owner_work = portfolio_storage.create_script(
            self.owner["id"], "Owner work", "Owner content",
            project_id=self.project.id,
        )
        member_work = portfolio_storage.create_script(
            self.member["id"], "Member work", "Member content",
            project_id=self.project.id,
        )

        member_insights = market_insight_storage.list_history(
            self.member["id"], project_id=self.project.id,
        )
        self.assertEqual(
            {item.id for item in member_insights},
            {owner_insight.id, member_insight.id},
        )
        member_cases = case_storage.list_user_cases(
            self.member["id"], project_id=self.project.id,
        )
        self.assertEqual(
            {item.id for item in member_cases},
            {owner_case.id, member_case.id},
        )
        member_creations = content_storage.list_sessions(
            self.member["id"], self.project.id,
        )
        self.assertEqual(
            {item.id for item in member_creations},
            {owner_creation.id, member_creation.id},
        )
        member_works = portfolio_storage.list_scripts(
            self.member["id"], self.project.id,
        )
        self.assertEqual(
            {item.id for item in member_works},
            {owner_work.id, member_work.id},
        )
        expected_creators = {self.owner["nickname"], self.member["nickname"]}
        self.assertEqual({item.creator_name for item in member_insights}, expected_creators)
        self.assertEqual({item.creator_name for item in member_cases}, expected_creators)
        self.assertEqual({item.creator_name for item in member_creations}, expected_creators)
        self.assertEqual({item.creator_name for item in member_works}, expected_creators)
        self.assertIsNotNone(market_insight_storage.get_insight(owner_insight.id, self.member["id"]))
        self.assertIsNotNone(case_storage.get_case(owner_case.id, self.member["id"]))
        self.assertIsNotNone(content_storage.get_session(owner_creation.id, self.member["id"]))

        self.assertEqual(
            {item.id for item in market_insight_storage.list_history(
                self.admin["id"], project_id=self.project.id,
            )},
            {owner_insight.id, member_insight.id},
        )
        self.assertEqual(
            {item.id for item in case_storage.list_user_cases(
                self.admin["id"], project_id=self.project.id,
            )},
            {owner_case.id, member_case.id},
        )
        self.assertEqual(
            {item.id for item in content_storage.list_sessions(
                self.admin["id"], self.project.id,
            )},
            {owner_creation.id, member_creation.id},
        )

    def test_creation_rename_and_delete_require_creator_or_project_manager(self):
        with sqlite3.connect(self.db_path) as conn:
            for user in (self.admin, self.member):
                conn.execute(
                    "INSERT INTO project_memberships VALUES (?, ?, 'member', '2026-01-01')",
                    (self.project.id, user["id"]),
                )
        creation = content_storage.create_session(self.member["id"], self.project.id, "Original")
        content_storage.update_session(
            creation.id, messages=[ChatMessage(role="user", content="Keep this content")],
        )
        content_storage.save_next_version(creation.id, [], is_major_bump=True)
        path = f"/api/v1/content_generator/sessions/{creation.id}"
        admin_headers = self.headers(self.admin["id"])
        self.assertEqual(self.client.get(path, headers=admin_headers).status_code, 200)
        self.assertEqual(self.client.patch(
            path + "/name", headers=admin_headers, json={"title": "Denied"},
        ).status_code, 403)
        self.assertEqual(self.client.delete(path, headers=admin_headers).status_code, 403)
        self.assertEqual(content_storage.get_session(creation.id).title, "Original")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE project_memberships SET role = 'admin' WHERE project_id = ? AND user_id = ?",
                (self.project.id, self.admin["id"]),
            )
        for actor, role in ((self.member, "member"), (self.admin, "admin"), (self.owner, "owner")):
            headers = self.headers(actor["id"])
            renamed = self.client.patch(path + "/name", headers=headers, json={"title": f"  Renamed {role}  "})
            self.assertEqual(renamed.status_code, 200, renamed.text)
            self.assertEqual(renamed.json()["data"]["title"], f"Renamed {role}")
            self.assertEqual(renamed.json()["data"]["project_role"], role)
            self.assertEqual(renamed.json()["data"]["organization_id"], self.organization["id"])
            self.assertEqual(renamed.json()["data"]["messages"], [{
                "role": "user", "content": "Keep this content",
                "client_message_id": None, "references": [],
            }])
            retrieved = self.client.get(path, headers=headers).json()["data"]
            listed = self.client.get("/api/v1/content_generator/sessions", headers=headers).json()["data"]
            self.assertEqual(retrieved["title"], f"Renamed {role}")
            self.assertEqual(next(item for item in listed if item["id"] == creation.id)["project_role"], role)
            removable = content_storage.create_session(self.member["id"], self.project.id, "Delete")
            content_storage.save_next_version(removable.id, [], is_major_bump=True)
            self.assertEqual(self.client.delete(
                f"/api/v1/content_generator/sessions/{removable.id}", headers=headers,
            ).status_code, 200)
            self.assertIsNone(content_storage.get_session(removable.id))
            self.assertEqual(content_storage.get_versions(removable.id), [])
        self.assertEqual(len(content_storage.get_versions(creation.id)), 1)

    def test_creation_management_requires_current_project_access(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO project_memberships VALUES (?, ?, 'member', '2026-01-01')",
                (self.project.id, self.member["id"]),
            )
        creation = content_storage.create_session(self.member["id"], self.project.id, "Scoped")
        path = f"/api/v1/content_generator/sessions/{creation.id}"
        for actor in (self.admin, self.outsider):
            headers = self.headers(actor["id"])
            self.assertEqual(self.client.patch(path + "/name", headers=headers, json={"title": "Denied"}).status_code, 404)
            self.assertEqual(self.client.delete(path, headers=headers).status_code, 404)
        other_org = auth_storage.create_organization(self.member["id"], "Other organization")
        auth_storage.switch_organization(self.member["id"], other_org["id"])
        headers = self.headers(self.member["id"])
        self.assertEqual(self.client.patch(path + "/name", headers=headers, json={"title": "Denied"}).status_code, 404)
        self.assertEqual(self.client.delete(path, headers=headers).status_code, 404)
        auth_storage.switch_organization(self.member["id"], self.organization["id"])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "DELETE FROM project_memberships WHERE project_id = ? AND user_id = ?",
                (self.project.id, self.member["id"]),
            )
        self.assertEqual(self.client.patch(path + "/name", headers=headers, json={"title": "Denied"}).status_code, 404)
        self.assertEqual(self.client.delete(path, headers=headers).status_code, 404)
        private_project = publishing_storage.create_manual_project(self.member["id"], title="Member project")
        private_creation = content_storage.create_session(self.member["id"], private_project.id, "Private")
        private_path = f"/api/v1/content_generator/sessions/{private_creation.id}"
        owner_headers = self.headers(self.owner["id"])
        self.assertEqual(self.client.patch(private_path + "/name", headers=owner_headers, json={"title": "Denied"}).status_code, 404)
        self.assertEqual(self.client.delete(private_path, headers=owner_headers).status_code, 404)
        self.assertEqual(content_storage.get_session(creation.id).title, "Scoped")

    def test_creation_names_validate_length_and_chat_preserves_concurrent_rename(self):
        creation = content_storage.create_session(self.owner["id"], self.project.id, "Original")
        path = f"/api/v1/content_generator/sessions/{creation.id}"
        headers = self.headers(self.owner["id"])
        for title, status in (("", 422), ("   ", 400), ("x" * 81, 422)):
            self.assertEqual(self.client.patch(path + "/name", headers=headers, json={"title": title}).status_code, status)
            self.assertEqual(content_storage.get_session(creation.id).title, "Original")
        self.assertEqual(self.client.patch(path + "/name", headers=headers, json={}).status_code, 422)
        self.assertEqual(self.client.patch(path + "/name", json={"title": "Denied"}).status_code, 401)
        self.assertEqual(self.client.delete(path).status_code, 401)
        self.assertEqual(self.client.patch(path + "/name", headers=headers, json={"title": "x" * 80}).status_code, 200)

        def reply_after_rename(*args, **kwargs):
            content_storage.update_session(creation.id, title="Renamed during chat")
            return "AI reply"

        with patch("app.api.content_generator.chat", side_effect=reply_after_rename):
            response = self.client.post(path + "/chat", headers=headers, json={"message": "A new brief"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"]["session"]["title"], "Renamed during chat")
        self.assertEqual(content_storage.get_session(creation.id).title, "Renamed during chat")
        self.assertEqual(len(content_storage.get_session(creation.id).messages), 2)

    def test_creation_context_is_committed_only_with_an_accepted_message(self):
        creation = content_storage.create_session(self.owner["id"], self.project.id, "Context")
        insight = market_insight_storage.save_insight(
            ParsedDocument(
                title="Launch insight", source_type="manual",
                ai_analysis=AIAnalysis(product_name="Launch insight", product_summary="Insight summary"),
            ),
            "manual", 0, self.owner["id"], self.project.id,
        )
        case = case_storage.create_case(
            title="Launch case", content_type="image_text", description="Case summary",
            tags=[], video_url="", image_urls=[], owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        path = f"/api/v1/content_generator/sessions/{creation.id}"
        headers = self.headers(self.owner["id"])
        self.assertEqual(self.client.put(
            path + "/references", headers=headers,
            json={"insight_ids": [insight.id], "case_ids": [case.id]},
        ).status_code, 404)
        untouched = content_storage.get_session(creation.id)
        self.assertEqual(untouched.insight_ids, [])
        self.assertEqual(untouched.case_ids, [])
        self.assertEqual(untouched.preference_keys, [])
        self.assertEqual(self.client.post(path + "/chat", headers=headers, json={
            "message": "Reject unanalyzed case",
            "case_ids": [case.id],
        }).status_code, 422)
        self.assertEqual(content_storage.get_session(creation.id).messages, [])
        case_storage.update_case_ai(
            case.id,
            "completed",
            CaseAIAnalysis(content_analysis="Analyzed case"),
        )
        pending_insight = market_insight_storage.save_insight(
            ParsedDocument(title="Pending insight", source_type="manual"),
            "manual", 0, self.owner["id"], self.project.id,
            status="analyzing",
        )
        self.assertEqual(self.client.post(path + "/chat", headers=headers, json={
            "message": "Reject pending insight",
            "insight_ids": [pending_insight.id],
        }).status_code, 422)
        self.assertEqual(content_storage.get_session(creation.id).messages, [])

        first_id = "11111111-1111-4111-8111-111111111111"
        observed: dict = {}

        def reply(messages, reference_context=""):
            observed["messages"] = messages
            observed["context"] = reference_context
            return "Accepted"

        with patch("app.api.content_generator.chat", side_effect=reply):
            response = self.client.post(path + "/chat", headers=headers, json={
                "message": "Create launch content",
                "insight_ids": [insight.id, insight.id],
                "case_ids": [case.id, case.id],
                "preference_keys": ["short_video", "douyin"],
                "client_message_id": first_id,
            })
        self.assertEqual(response.status_code, 200, response.text)
        committed = response.json()["data"]["session"]
        self.assertEqual(committed["insight_ids"], [insight.id])
        self.assertEqual(committed["case_ids"], [case.id])
        self.assertEqual(
            committed["preference_keys"], ["short_video", "douyin"],
        )
        self.assertEqual(committed["messages"][0]["client_message_id"], first_id)
        self.assertEqual(committed["messages"][0]["references"], [
            {"id": insight.id, "kind": "insight", "title": "Launch insight"},
            {"id": case.id, "kind": "case", "title": "Launch case"},
        ])
        self.assertTrue(committed["messages"][0]["content"].startswith(
            "Selected preferences: Short video, Douyin\n\n"
        ))
        self.assertEqual(set(observed["messages"][0]), {"role", "content"})
        self.assertIn("Launch insight", observed["context"])
        self.assertIn("Launch case", observed["context"])

        with patch("app.api.content_generator.chat", return_value="Duplicate retry") as duplicate_chat:
            duplicate = self.client.post(path + "/chat", headers=headers, json={
                "message": "Changed retry payload",
                "preference_keys": ["xiaohongshu"],
                "client_message_id": first_id,
            })
        self.assertEqual(duplicate.status_code, 200, duplicate.text)
        duplicate_chat.assert_not_called()
        duplicate_session = duplicate.json()["data"]["session"]
        self.assertEqual(
            len([message for message in duplicate_session["messages"]
                 if message["client_message_id"] == first_id]),
            1,
        )
        self.assertNotIn("xiaohongshu", duplicate_session["preference_keys"])

        second_id = "22222222-2222-4222-8222-222222222222"
        with patch("app.api.content_generator.chat", return_value="Updated"):
            response = self.client.post(path + "/chat", headers=headers, json={
                "message": "Refine it",
                "preference_keys": ["image_text", "xiaohongshu"],
                "client_message_id": second_id,
            })
        self.assertEqual(response.status_code, 200, response.text)
        committed = response.json()["data"]["session"]
        self.assertEqual(committed["insight_ids"], [insight.id])
        self.assertEqual(committed["case_ids"], [case.id])
        self.assertEqual(
            committed["preference_keys"],
            ["image_text", "xiaohongshu"],
        )
        self.assertEqual(committed["title"], "Context")

        failed_id = "33333333-3333-4333-8333-333333333333"
        with patch("app.api.content_generator.chat", side_effect=RuntimeError("AI down")):
            failed = self.client.post(path + "/chat", headers=headers, json={
                "message": "Accepted before AI failure",
                "preference_keys": ["short_video"],
                "client_message_id": failed_id,
            })
        self.assertEqual(failed.status_code, 500)
        after_failure = content_storage.get_session(creation.id)
        self.assertEqual(str(after_failure.messages[-1].client_message_id), failed_id)
        self.assertIn("short_video", after_failure.preference_keys)
        self.assertNotIn("image_text", after_failure.preference_keys)
        self.assertEqual(after_failure.title, "Context")

    def test_invalid_creation_context_never_mutates_the_session(self):
        creation = content_storage.create_session(self.owner["id"], self.project.id, "Protected")
        path = f"/api/v1/content_generator/sessions/{creation.id}/chat"
        headers = self.headers(self.owner["id"])
        for payload, status in (
            ({"message": "Invalid preference", "preference_keys": ["unknown"]}, 422),
            ({"message": "Removed preference", "preference_keys": ["marketing_copy"]}, 422),
            ({"message": "Conflicting format", "preference_keys": ["short_video", "image_text"]}, 422),
            ({"message": "Conflicting channel", "preference_keys": ["douyin", "xiaohongshu"]}, 422),
            ({"message": "Missing insight", "insight_ids": ["missing"]}, 404),
            ({"message": "Missing case", "case_ids": ["missing"]}, 404),
        ):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post(path, headers=headers, json=payload).status_code, status)
                unchanged = content_storage.get_session(creation.id)
                self.assertEqual(unchanged.messages, [])
                self.assertEqual(unchanged.insight_ids, [])
                self.assertEqual(unchanged.case_ids, [])
                self.assertEqual(unchanged.preference_keys, [])

    def test_case_analysis_records_timestamp_and_video_fields(self):
        case = case_storage.create_case(
            title="Video case",
            content_type="video",
            description="Video content",
            tags=[],
            video_url="videos/demo.mp4",
            image_urls=[],
            owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        updated = case_storage.update_case_ai(
            case.id,
            "completed",
            CaseAIAnalysis(
                content_analysis="Content",
                opening_hook="Opening",
                pacing_analysis="Pacing",
                shot_structure="Shots",
                script_structure="Script",
            ),
        )
        self.assertIsNotNone(updated)
        self.assertEqual(updated.ai_status, "completed")
        self.assertTrue(updated.ai_analyzed_at)
        self.assertEqual(updated.ai_analysis.opening_hook, "Opening")
        self.assertEqual(updated.ai_analysis.pacing_analysis, "Pacing")
        self.assertEqual(updated.ai_analysis.shot_structure, "Shots")
        self.assertEqual(updated.ai_analysis.script_structure, "Script")

    def test_case_edit_and_analysis_permissions_preserve_project_context(self):
        with sqlite3.connect(self.db_path) as conn:
            for user, role in ((self.admin, "admin"), (self.member, "member")):
                conn.execute(
                    "INSERT INTO project_memberships VALUES (?, ?, ?, '2026-01-01')",
                    (self.project.id, user["id"], role),
                )
        case = case_storage.create_case(
            title="Permission case", content_type="image_text", description="Original",
            tags=[], video_url="", image_urls=[], owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        path = f"/api/v1/case_library/cases/{case.id}"
        with patch("app.engines.case_library.ai_analyzer.analyze_async") as analyze:
            for user, status in ((self.member, 403), (self.outsider, 404)):
                with self.subTest(user=user["username"]):
                    self.assertEqual(self.client.put(
                        path, headers=self.headers(user["id"]), json={"title": "Denied"},
                    ).status_code, status)
                    self.assertEqual(self.client.post(
                        path + "/analyze", headers=self.headers(user["id"]),
                    ).status_code, status)
                    self.assertEqual(self.client.post(
                        path + "/media", headers=self.headers(user["id"]),
                    ).status_code, status)
            analyze.assert_not_called()
            for user, role in ((self.owner, "owner"), (self.admin, "admin")):
                with self.subTest(role=role):
                    response = self.client.put(
                        path, headers=self.headers(user["id"]), json={"title": "Edited"},
                    )
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()["data"]["project_role"], role)
                    self.assertEqual(response.json()["data"]["project_title"], self.project.title)
                    self.assertTrue(response.json()["data"]["is_project_member"])
                    case_storage.update_case_ai(case.id, "pending")
                    self.assertEqual(self.client.post(
                        path + "/analyze", headers=self.headers(user["id"]),
                    ).status_code, 200)
            self.assertEqual(analyze.call_count, 2)
            self.assertEqual(self.client.delete(
                path, headers=self.headers(self.member["id"]),
            ).status_code, 403)

            self.assertEqual(self.client.get(
                path, headers=self.headers(self.outsider["id"]),
            ).status_code, 404)
            for action in ("edit", "analyze"):
                response = self.client.put(
                    path, headers=self.headers(self.outsider["id"]), json={"title": "Denied"},
                ) if action == "edit" else self.client.post(
                    path + "/analyze", headers=self.headers(self.outsider["id"]),
                )
                self.assertEqual(response.status_code, 404)
            self.assertTrue(case_storage.get_case(case.id, self.member["id"]).is_project_member)
            case_favorites.add_favorite(self.member["id"], case.id)
            self.assertTrue(case_storage.list_favorited_cases(self.member["id"])[0].is_project_member)
            other_org = auth_storage.create_organization(self.member["id"], "Other context")
            auth_storage.switch_organization(self.member["id"], other_org["id"])
            self.assertIsNone(case_storage.get_case(case.id, self.member["id"]))
            self.assertEqual(self.client.post(
                path + "/analyze", headers=self.headers(self.member["id"]),
            ).status_code, 404)

    def test_case_creator_member_can_edit_analyze_and_delete_own_case(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO project_memberships VALUES (?, ?, 'member', '2026-01-01')",
                (self.project.id, self.member["id"]),
            )
        case = case_storage.create_case(
            title="Member-owned case", content_type="image_text", description="Original",
            tags=[], video_url="", image_urls=[], owner_id=self.member["id"],
            project_id=self.project.id,
        )
        path = f"/api/v1/case_library/cases/{case.id}"
        headers = self.headers(self.member["id"])
        self.assertEqual(self.client.put(
            path, headers=headers, json={"description": "Creator edited"},
        ).status_code, 200)
        with patch("app.engines.case_library.ai_analyzer.analyze_async") as analyze:
            self.assertEqual(self.client.post(path + "/analyze", headers=headers).status_code, 200)
            analyze.assert_called_once()
        self.assertEqual(self.client.delete(path, headers=headers).status_code, 200)
        self.assertIsNone(case_storage.get_case(case.id))

    def test_case_import_saves_project_case_without_public_catalog_fields(self):
        class InlineThread:
            def __init__(self, target, kwargs=None, **_):
                self.target = target
                self.kwargs = kwargs or {}

            def start(self):
                self.target(**self.kwargs)

        with patch.object(case_import_tasks, "parse_public_link") as fetch_public_page, \
                patch.object(case_import_tasks.threading, "Thread", InlineThread):
            response = self.client.post(
                "/api/v1/case_library/import_tasks",
                headers=self.headers(self.owner["id"]),
                json={
                    "input": "Launch announcement\nTry our product today #launch",
                    "project_id": self.project.id,
                },
            )
            fetch_public_page.assert_not_called()
        self.assertEqual(response.status_code, 200, response.text)
        task = response.json()["data"]
        self.assertEqual(task["status"], "completed")
        self.assertTrue(task["case_id"])
        case = task["case"]
        self.assertEqual(case["project_id"], self.project.id)
        self.assertEqual(case["ai_status"], "")
        self.assertNotIn("is_public", case)
        self.assertNotIn("category", case)
        self.assertEqual(case_storage.get_case(case["id"], self.owner["id"]).id, task["case_id"])

    def test_link_import_creates_unanalyzed_case_before_background_processing(self):
        class CapturingThread:
            latest = None

            def __init__(self, target, kwargs=None, **_):
                self.target = target
                self.kwargs = kwargs or {}
                CapturingThread.latest = self

            def start(self):
                return None

        remote = {
            "platform": "xiaohongshu",
            "source_url": "https://www.xiaohongshu.com/explore/example",
            "title": "Remote title",
            "body": "Remote body with enough visible post content for a meaningful structured analysis.",
            "topics": ["launch"],
            "image_urls": ["https://example.com/image.jpg"],
            "content_type": "image_text",
            "recognition_status": "recognized",
        }
        with patch.object(case_import_tasks.threading, "Thread", CapturingThread), \
                patch.object(case_import_tasks, "parse_public_link", return_value=(remote, None)) as fetch:
            response = self.client.post(
                "/api/v1/case_library/import_tasks",
                headers=self.headers(self.owner["id"]),
                json={
                    "input": "https://www.xiaohongshu.com/explore/example",
                    "project_id": self.project.id,
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            task = response.json()["data"]
            self.assertEqual(task["status"], "pending")
            self.assertTrue(task["case_id"])
            self.assertEqual(task["case"]["ai_status"], "")
            self.assertEqual(task["case"]["recognition_status"], "pending")
            self.assertEqual(task["case"]["project_id"], self.project.id)
            fetch.assert_not_called()

            CapturingThread.latest.target(**CapturingThread.latest.kwargs)

        fetch.assert_called_once()
        completed = case_storage.get_case(task["case_id"], self.owner["id"])
        self.assertEqual(completed.ai_status, "")
        self.assertEqual(completed.title, "Remote title")
        self.assertEqual(completed.image_urls, ["https://example.com/image.jpg"])

    def test_case_uploads_and_replacements_use_creator_media_without_visibility_fields(self):
        headers = self.headers(self.owner["id"])
        for content_type, field, filename, mime in (
            ("video", "video", "clip.mp4", "video/mp4"),
            ("image_text", "images", "image.png", "image/png"),
        ):
            with self.subTest(content_type=content_type):
                response = self.client.post(
                    "/api/v1/case_library/cases", headers=headers,
                    data={
                        "title": "Project case", "content_type": content_type,
                        "project_id": self.project.id, "source": "Upload test",
                    },
                    files={field: (filename, b"original media", mime)},
                )
                self.assertEqual(response.status_code, 200, response.text)
                case = response.json()["data"]
                self.assertEqual(case["source"], "Upload test")
                self.assertEqual(case["project_id"], self.project.id)
                self.assertNotIn("is_public", case)
                self.assertNotIn("category", case)
                media_url = case["video_url"] if field == "video" else case["image_urls"][0]
                self.assertTrue(media_url.startswith(f"users/{self.owner['id']}/"))
                self.assertEqual((self.media_root / media_url).read_bytes(), b"original media")
                replaced = self.client.post(
                    f"/api/v1/case_library/cases/{case['id']}/media", headers=headers,
                    files={field: (filename, b"replacement media", mime)},
                )
                self.assertEqual(replaced.status_code, 200, replaced.text)
                updated = replaced.json()["data"]
                replacement_url = updated["video_url"] if field == "video" else updated["image_urls"][0]
                self.assertTrue(replacement_url.startswith(f"users/{self.owner['id']}/"))
                self.assertEqual((self.media_root / replacement_url).read_bytes(), b"replacement media")
                self.assertEqual(updated["project_role"], "owner")
                self.assertFalse((self.media_root / media_url).exists())
        schemas = self.client.get("/openapi.json").json()["components"]["schemas"]
        for name, schema in schemas.items():
            if "Case" in name or "create_case_item" in name:
                self.assertNotIn("is_public", schema.get("properties", {}))
                self.assertNotIn("category", schema.get("properties", {}))

    def test_legacy_case_migration_preserves_data_and_requires_projects(self):
        case_storage.init_db()
        with sqlite3.connect(self.db_path) as conn:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(cases)")}
            self.assertNotIn("is_public", columns)
            self.assertNotIn("category", columns)
            conn.executescript("""
                ALTER TABLE cases ADD COLUMN is_public INTEGER DEFAULT 0;
                ALTER TABLE cases ADD COLUMN category TEXT DEFAULT 'agency';
                DROP TRIGGER trg_cases_project_insert;
                DROP TRIGGER trg_cases_project_update;
                CREATE TRIGGER trg_cases_project_insert BEFORE INSERT ON cases
                WHEN NEW.project_id = '' AND NEW.is_public = 0
                BEGIN SELECT RAISE(ABORT, 'project required'); END;
                CREATE TRIGGER trg_cases_project_update
                BEFORE UPDATE OF project_id, organization_id ON cases
                WHEN NEW.project_id = '' AND NEW.is_public = 0
                BEGIN SELECT RAISE(ABORT, 'project required'); END;
            """)
            for case_id, owner_id in (
                ("legacy-owned", self.owner["id"]),
                ("legacy-orphan", self.member["id"]),
            ):
                conn.execute("""
                    INSERT INTO cases (
                        id, title, content_type, created_at, updated_at,
                        owner_id, organization_id, is_public, category, video_url
                    ) VALUES (?, 'Legacy', 'video', '2026-01-01', '2026-01-01',
                              ?, ?, 1, 'curated', 'shared/videos/legacy.mp4')
                """, (case_id, owner_id, self.organization["id"]))
        case_storage.init_db()
        case_storage.init_db()
        with sqlite3.connect(self.db_path) as conn:
            rows = dict(conn.execute("SELECT id, project_id FROM cases"))
            self.assertEqual(rows, {"legacy-owned": self.project.id, "legacy-orphan": ""})
            self.assertEqual(conn.execute(
                "SELECT video_url FROM cases WHERE id = 'legacy-owned'"
            ).fetchone()[0], "shared/videos/legacy.mp4")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "project_id is required"):
                conn.execute("""
                    INSERT INTO cases (id, title, content_type, created_at, updated_at, is_public)
                    VALUES ('invalid', 'No project', 'video', '', '', 1)
                """)
            with self.assertRaisesRegex(sqlite3.IntegrityError, "project_id is required"):
                conn.execute("UPDATE cases SET project_id = '' WHERE id = 'legacy-owned'")
        self.assertEqual(
            [item.id for item in case_storage.list_user_cases(self.owner["id"])],
            ["legacy-owned"],
        )
        self.assertEqual(case_storage.list_user_cases(self.member["id"]), [])
        with self.assertRaisesRegex(ValueError, "Project is required"):
            case_storage.create_case(
                title="Missing project", content_type="image_text", description="",
                tags=[], video_url="", image_urls=[], owner_id=self.owner["id"],
            )
        self.assertEqual(self.client.get(
            "/api/v1/case_library/admin/cases", headers=self.headers(self.owner["id"]),
        ).status_code, 404)

    def test_legacy_public_case_is_scoped_to_current_organization(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO project_memberships VALUES (?, ?, 'admin', '2026-01-01')",
                (self.project.id, self.admin["id"]),
            )
        case = case_storage.create_case(
            title="Public case", content_type="image_text", description="Original",
            tags=[], video_url="", image_urls=[], owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("ALTER TABLE cases ADD COLUMN is_public INTEGER DEFAULT 0")
            conn.execute("ALTER TABLE cases ADD COLUMN category TEXT DEFAULT 'agency'")
            conn.execute("UPDATE cases SET is_public = 1, category = 'curated' WHERE id = ?", (case.id,))
        path = f"/api/v1/case_library/cases/{case.id}"
        with patch("app.engines.case_library.ai_analyzer.analyze_async") as analyze:
            for actor in (self.owner, self.admin):
                other = auth_storage.create_organization(actor["id"], "Different organization")
                auth_storage.switch_organization(actor["id"], other["id"])
                headers = self.headers(actor["id"])
                retrieved = self.client.get(path, headers=headers)
                self.assertEqual(retrieved.status_code, 404)
                self.assertEqual(self.client.put(path, headers=headers, json={"title": "Denied"}).status_code, 404)
                self.assertEqual(self.client.post(path + "/analyze", headers=headers).status_code, 404)
                self.assertEqual(self.client.post(path + "/media", headers=headers).status_code, 404)
                self.assertEqual(self.client.delete(path, headers=headers).status_code, 404)
                self.assertEqual(self.client.post(path + "/favorite", headers=headers).status_code, 404)
                for listing in ("/cases", "/my/cases"):
                    self.assertEqual(self.client.get(
                        "/api/v1/case_library" + listing, headers=headers,
                    ).json()["data"]["cases"], [])
                # A legacy favorite must not make an inaccessible case visible.
                case_favorites.add_favorite(actor["id"], case.id)
                self.assertEqual(case_storage.list_favorited_cases(actor["id"]), [])
                self.assertEqual(self.client.delete(path + "/favorite", headers=headers).status_code, 200)
                auth_storage.switch_organization(actor["id"], self.organization["id"])
                self.assertEqual(self.client.put(path, headers=headers, json={"title": "Allowed"}).status_code, 200)
                visible = self.client.get("/api/v1/case_library/cases", headers=headers).json()["data"]["cases"]
                self.assertIn(case.id, [item["id"] for item in visible])
                self.assertNotIn("is_public", visible[0])
                self.assertNotIn("category", visible[0])
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get("/api/v1/case_library/cases").status_code, 401)
            analyze.assert_not_called()
            self.assertEqual(self.client.put(
                path, headers=self.headers(self.outsider["id"]), json={"title": "Outsider"},
            ).status_code, 404)

    def test_project_owner_can_delete_case(self):
        case = case_storage.create_case(
            title="Disposable case",
            content_type="image_text",
            description="Delete me",
            tags=[],
            video_url="",
            image_urls=[],
            owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        response = self.client.delete(
            f"/api/v1/case_library/cases/{case.id}",
            headers=self.headers(self.owner["id"]),
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(case_storage.get_case(case.id))

    def test_case_favorites_room_is_scoped_to_account_and_organization(self):
        case = case_storage.create_case(
            title="Favorite room case",
            content_type="image_text",
            description="Saved independently from project filters",
            tags=[],
            video_url="",
            image_urls=[],
            owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        self.assertTrue(case_favorites.add_favorite(self.owner["id"], case.id))
        self.assertEqual(
            [item.id for item in case_storage.list_favorited_cases(self.owner["id"])],
            [case.id],
        )

        second_organization = auth_storage.create_organization(
            self.owner["id"], "Favorites Room Organization",
        )
        auth_storage.switch_organization(self.owner["id"], second_organization["id"])
        self.assertEqual(case_favorites.get_favorite_ids(self.owner["id"]), set())
        self.assertEqual(case_storage.list_favorited_cases(self.owner["id"]), [])

        auth_storage.switch_organization(self.owner["id"], self.organization["id"])
        self.assertEqual(case_favorites.get_favorite_ids(self.owner["id"]), {case.id})
        self.assertEqual(
            [item.id for item in case_storage.list_favorited_cases(self.owner["id"])],
            [case.id],
        )

    def test_project_admin_can_manage_others_but_not_self_or_owner(self):
        base = f"/api/v1/publishing/projects/{self.project.id}/members"
        invited_admin = self.client.post(
            base,
            headers=self.headers(self.owner["id"]),
            json={"email": "admin@example.com", "role": "admin"},
        )
        self.assertEqual(invited_admin.status_code, 200)
        invited_member = self.client.post(
            base, headers=self.headers(self.admin["id"]),
            json={"email": "member@example.com", "role": "admin"},
        )
        self.assertEqual(invited_member.status_code, 200)

        member_path = f"{base}/{self.member['id']}"
        self.assertEqual(self.client.patch(
            member_path, headers=self.headers(self.admin["id"]), json={"role": "member"},
        ).status_code, 403)
        self.assertEqual(
            self.client.delete(member_path, headers=self.headers(self.admin["id"])).status_code,
            403,
        )
        self.assertEqual(self.client.patch(
            member_path, headers=self.headers(self.owner["id"]), json={"role": "member"},
        ).status_code, 200)
        promoted = self.client.patch(
            member_path,
            headers=self.headers(self.admin["id"]),
            json={"role": "admin"},
        )
        self.assertEqual(promoted.status_code, 200)
        self.assertEqual(promoted.json()["data"]["role"], "admin")
        self.assertEqual(self.client.patch(
            member_path, headers=self.headers(self.admin["id"]), json={"role": "member"},
        ).status_code, 403)
        self.assertEqual(self.client.delete(member_path, headers=self.headers(self.admin["id"])).status_code, 403)
        self.assertEqual(self.client.patch(
            member_path, headers=self.headers(self.owner["id"]), json={"role": "member"},
        ).status_code, 200)
        self.assertEqual(
            self.client.delete(member_path, headers=self.headers(self.admin["id"])).status_code,
            200,
        )

        owner_path = f"{base}/{self.owner['id']}"
        admin_path = f"{base}/{self.admin['id']}"
        for method, path in (
            ("patch", owner_path),
            ("delete", owner_path),
            ("patch", admin_path),
            ("delete", admin_path),
        ):
            response = (
                self.client.patch(path, headers=self.headers(self.admin["id"]), json={"role": "member"})
                if method == "patch"
                else self.client.delete(path, headers=self.headers(self.admin["id"]))
            )
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.delete(admin_path, headers=self.headers(self.owner["id"])).status_code, 200)

    def test_project_owner_role_cannot_be_assigned_to_another_member(self):
        base = f"/api/v1/publishing/projects/{self.project.id}/members"
        self.assertEqual(
            self.client.post(
                base,
                headers=self.headers(self.owner["id"]),
                json={"email": "member@example.com", "role": "member"},
            ).status_code,
            200,
        )
        rejected = self.client.patch(
            f"{base}/{self.member['id']}",
            headers=self.headers(self.owner["id"]),
            json={"role": "owner"},
        )
        self.assertEqual(rejected.status_code, 400)

        members = self.client.get(
            base, headers=self.headers(self.owner["id"]),
        ).json()["data"]
        roles = {member["user_id"]: member["role"] for member in members}
        self.assertEqual(roles[self.member["id"]], "member")
        self.assertEqual(roles[self.owner["id"]], "owner")
        self.assertEqual(sum(role == "owner" for role in roles.values()), 1)

    def test_removing_organization_member_revokes_project_membership(self):
        project_members = f"/api/v1/publishing/projects/{self.project.id}/members"
        self.assertEqual(
            self.client.post(
                project_members,
                headers=self.headers(self.owner["id"]),
                json={"email": "member@example.com", "role": "member"},
            ).status_code,
            200,
        )
        organization_member = (
            f"/api/v1/organizations/{self.organization['id']}/members/{self.member['id']}"
        )
        self.assertEqual(
            self.client.delete(
                organization_member, headers=self.headers(self.admin["id"]),
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(
                f"/api/v1/publishing/projects/{self.project.id}",
                headers=self.headers(self.member["id"]),
            ).status_code,
            404,
        )

    def test_removing_project_owner_transfers_project_to_organization_owner(self):
        member_project = publishing_storage.create_manual_project(
            self.member["id"], title="Member Owned Project",
        )
        project_members = f"/api/v1/publishing/projects/{member_project.id}/members"
        self.assertEqual(
            self.client.post(
                project_members,
                headers=self.headers(self.member["id"]),
                json={"email": "owner@example.com", "role": "admin"},
            ).status_code,
            200,
        )
        organization_member = (
            f"/api/v1/organizations/{self.organization['id']}/members/{self.member['id']}"
        )
        self.assertEqual(
            self.client.delete(
                organization_member, headers=self.headers(self.admin["id"]),
            ).status_code,
            200,
        )

        transferred = self.client.get(
            f"/api/v1/publishing/projects/{member_project.id}",
            headers=self.headers(self.owner["id"]),
        )
        self.assertEqual(transferred.status_code, 200)
        self.assertEqual(transferred.json()["data"]["role"], "owner")
        transferred_members = self.client.get(
            project_members, headers=self.headers(self.owner["id"]),
        ).json()["data"]
        self.assertEqual(
            [member["user_id"] for member in transferred_members if member["role"] == "owner"],
            [self.owner["id"]],
        )

    def test_project_database_rejects_a_second_owner(self):
        with sqlite3.connect(self.db_path) as conn:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO project_memberships VALUES (?, ?, 'owner', '2026-01-02')",
                    (self.project.id, self.admin["id"]),
                )

    def test_project_admin_can_customize_and_delete(self):
        members = f"/api/v1/publishing/projects/{self.project.id}/members"
        self.assertEqual(
            self.client.post(
                members,
                headers=self.headers(self.owner["id"]),
                json={"email": "admin@example.com", "role": "admin"},
            ).status_code,
            200,
        )
        project_path = f"/api/v1/publishing/projects/{self.project.id}"
        updated = self.client.patch(
            project_path,
            headers=self.headers(self.admin["id"]),
            json={
                "title": "Updated Project",
                "notes": "Updated description",
                "avatar_color": "#e9d5ff",
                "avatar_icon": "🚀",
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["data"]["title"], "Updated Project")
        self.assertEqual(updated.json()["data"]["notes"], "Updated description")
        self.assertEqual(updated.json()["data"]["avatar_color"], "#e9d5ff")
        self.assertEqual(updated.json()["data"]["avatar_icon"], "🚀")
        publishing_storage.create_manual_project(
            self.owner["id"], title="Existing Project",
        )
        duplicate = self.client.patch(
            project_path,
            headers=self.headers(self.owner["id"]),
            json={"title": " existing project "},
        )
        self.assertEqual(duplicate.status_code, 409)
        invalid_avatar = self.client.patch(
            project_path,
            headers=self.headers(self.owner["id"]),
            json={"avatar_color": "#000000", "avatar_icon": "unknown"},
        )
        self.assertEqual(invalid_avatar.status_code, 400)
        self.assertEqual(
            self.client.delete(project_path, headers=self.headers(self.admin["id"])).status_code,
            200,
        )
        self.assertIsNone(publishing_storage.get_project(self.project.id, self.owner["id"]))

    def test_project_member_cannot_customize_delete_or_invite(self):
        project_path = f"/api/v1/publishing/projects/{self.project.id}"
        self.assertEqual(self.client.post(
            project_path + "/members",
            headers=self.headers(self.owner["id"]),
            json={"email": "member@example.com", "role": "member"},
        ).status_code, 200)
        headers = self.headers(self.member["id"])
        for changes in (
            {"title": "Denied rename"}, {"notes": "Denied description"},
            {"avatar_color": "#e9d5ff", "avatar_icon": "🚀"},
        ):
            with self.subTest(changes=changes):
                self.assertEqual(self.client.patch(
                    project_path, headers=headers, json=changes,
                ).status_code, 403)
        self.assertEqual(self.client.delete(project_path, headers=headers).status_code, 403)
        self.assertEqual(self.client.post(
            project_path + "/members", headers=headers,
            json={"email": "admin@example.com", "role": "member"},
        ).status_code, 403)
        project = publishing_storage.get_project(self.project.id, self.owner["id"])
        self.assertEqual(project.title, self.project.title)
        self.assertNotIn(
            self.admin["id"], [member.user_id for member in project.members],
        )

    def test_project_owner_can_delete_and_publish_tasks_are_unlinked(self):
        task = publishing_storage.create_task_from_project(
            self.owner["id"], self.project.id,
        )
        insight = market_insight_storage.save_manual_insight(
            market_insight_storage.AIAnalysis(product_name="Deleted with project"),
            owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        insight_source = (
            self.media_root / "market_insight_sources" / self.organization["id"]
            / self.project.id / insight.id / "source.md"
        )
        insight_source.parent.mkdir(parents=True)
        insight_source.write_bytes(b"source")
        market_insight_storage.add_insight_source(
            insight.id,
            "source.md",
            len(b"source"),
            "markdown",
            "source",
            str(insight_source.relative_to(self.media_root)),
        )
        case = case_storage.create_case(
            title="Deleted case",
            content_type="image_text",
            description="",
            tags=[],
            video_url="",
            image_urls=[],
            owner_id=self.owner["id"],
            project_id=self.project.id,
        )
        session = content_storage.create_session(self.owner["id"], self.project.id)
        script = portfolio_storage.create_script(
            self.owner["id"], "Deleted work", "Content",
            source_session_id=session.id, project_id=self.project.id,
        )
        case_media = self.media_root / "users" / self.owner["id"] / "images" / "case.png"
        case_media.parent.mkdir(parents=True)
        case_media.write_bytes(b"case")
        case_storage.update_case(case.id, image_urls=[
            f"users/{self.owner['id']}/images/case.png",
        ])
        project_path = f"/api/v1/publishing/projects/{self.project.id}"
        self.assertEqual(
            self.client.delete(project_path, headers=self.headers(self.owner["id"])).status_code,
            200,
        )
        self.assertIsNone(publishing_storage.get_project(self.project.id))
        self.assertEqual(publishing_storage.get_task(task.id).project_id, "")
        self.assertIsNone(market_insight_storage.get_insight(insight.id))
        self.assertIsNone(case_storage.get_case(case.id))
        self.assertIsNone(content_storage.get_session(session.id))
        self.assertIsNone(portfolio_storage.get_script(script.id))
        self.assertFalse(case_media.exists())
        self.assertFalse(insight_source.exists())


if __name__ == "__main__":
    unittest.main()
