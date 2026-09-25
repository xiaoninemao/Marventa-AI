import os
import sqlite3
import unittest
import uuid


POSTGRES_URL = os.getenv("TEST_POSTGRES_URL", "")


@unittest.skipUnless(
    POSTGRES_URL.startswith(("postgresql://", "postgres://")),
    "TEST_POSTGRES_URL is not configured",
)
class PostgreSQLIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg

        from app import config

        cls.original_database_url = config.DATABASE_URL
        config.DATABASE_URL = POSTGRES_URL
        with psycopg.connect(POSTGRES_URL, autocommit=True) as conn:
            conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
            conn.execute("CREATE SCHEMA public")

        from app.auth.storage import init_users_db
        from app.engines.case_library.import_tasks import init_import_tasks_db
        from app.engines.case_library.storage import init_db as init_case_library_db
        from app.engines.content_generator.storage import init_db as init_content_generator_db
        from app.engines.market_insight.storage import init_db as init_market_insight_db
        from app.engines.portfolio.storage import init_db as init_portfolio_db
        from app.engines.publishing.storage import init_db as init_publishing_db
        from app.notifications.storage import init_notifications_db

        init_users_db()
        init_notifications_db()
        init_publishing_db()
        init_case_library_db()
        init_import_tasks_db()
        init_content_generator_db()
        init_portfolio_db()
        init_market_insight_db()

    @classmethod
    def tearDownClass(cls):
        import psycopg

        from app import config

        with psycopg.connect(POSTGRES_URL, autocommit=True) as conn:
            conn.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = current_database() AND pid != pg_backend_pid()",
            )
            conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
            conn.execute("CREATE SCHEMA public")
        config.DATABASE_URL = cls.original_database_url

    def test_core_organization_project_and_asset_flow(self):
        from app.auth import storage as auth_storage
        from app.engines.case_library.storage import create_case, get_case
        from app.engines.publishing.projects import (
            create_manual_project,
            get_project,
        )

        suffix = uuid.uuid4().hex[:8]
        user = auth_storage.create_user(
            f"pg-{suffix}",
            f"pg-{suffix}@example.com",
            "hash",
        )
        organization = auth_storage.get_current_organization(user["id"])
        self.assertIsNotNone(organization)
        project = create_manual_project(
            user["id"],
            title=f"PostgreSQL {suffix}",
        )
        loaded = get_project(project.id, user["id"])
        self.assertIsNotNone(loaded)
        case = create_case(
            title="PostgreSQL case",
            content_type="image_text",
            description="Database integration",
            tags=["postgresql"],
            video_url="",
            image_urls=[],
            owner_id=user["id"],
            project_id=project.id,
        )
        loaded_case = get_case(case.id, user["id"])
        self.assertIsNotNone(loaded_case)
        self.assertEqual(loaded_case.organization_id, organization["id"])
        self.assertEqual(loaded_case.project_id, project.id)

    def test_metadata_and_conflict_compatibility(self):
        from app.database import connect_database, is_postgresql

        conn = connect_database("")
        try:
            self.assertTrue(is_postgresql(conn))
            columns = {
                row[1]
                for row in conn.execute(
                    "PRAGMA table_info(project_memberships)",
                ).fetchall()
            }
            self.assertEqual(
                columns,
                {"project_id", "user_id", "role", "created_at"},
            )
            tables = {
                row["name"]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'",
                ).fetchall()
            }
            self.assertIn("content_projects", tables)
            self.assertIn("project_channel_accounts", tables)
        finally:
            conn.close()

    def test_postgres_scope_trigger_rejects_cross_project_rows(self):
        from app.auth import storage as auth_storage
        from app.database import connect_database
        from app.engines.publishing.projects import create_manual_project

        suffix = uuid.uuid4().hex[:8]
        first = auth_storage.create_user(
            f"first-{suffix}",
            f"first-{suffix}@example.com",
            "hash",
        )
        second = auth_storage.create_user(
            f"second-{suffix}",
            f"second-{suffix}@example.com",
            "hash",
        )
        project = create_manual_project(first["id"], title=f"Scope {suffix}")
        second_org = auth_storage.get_current_organization(second["id"])
        conn = connect_database("")
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    """
                    INSERT INTO cases (
                        id, title, content_type, owner_id,
                        organization_id, project_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"cross-{suffix}",
                        "Cross project",
                        "image_text",
                        second["id"],
                        second_org["id"],
                        project.id,
                        "2026-01-01",
                        "2026-01-01",
                    ),
                )
            conn.rollback()
        finally:
            conn.close()
