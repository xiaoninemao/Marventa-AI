from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.market_insight import router as market_insight_router
from app.api.auth import router as auth_router
from app.api.case_library import router as case_library_router
from app.api.content_generator import router as content_generator_router
from app.api.portfolio import router as portfolio_router
from app.api.publishing import router as publishing_router
from app.api.organizations import router as organizations_router
from app.api.notifications import router as notifications_router
from app.auth.seed import ensure_demo_user
from app.auth.storage import init_users_db
from app.config import APP_NAME, DEBUG, ENABLE_DEMO_USER, FRONTEND_ORIGINS
from app.engines.case_library.import_tasks import init_import_tasks_db
from app.engines.case_library.storage import init_db as init_case_library_db
from app.engines.content_generator.storage import init_db as init_content_generator_db
from app.engines.market_insight.storage import init_db as init_market_insight_db
from app.engines.portfolio.storage import init_db as init_portfolio_db
from app.engines.publishing.storage import init_db as init_publishing_db
from app.notifications.storage import init_notifications_db
from app.media_storage import media_response, validate_media_storage

app = FastAPI(
    title=APP_NAME,
    docs_url="/docs" if DEBUG else None,
    redoc_url="/redoc" if DEBUG else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_origin_regex=r"^(chrome-extension|moz-extension)://.*$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

validate_media_storage()
init_users_db()
init_notifications_db()
init_publishing_db()
init_case_library_db()
init_import_tasks_db()
init_content_generator_db()
init_portfolio_db()
init_market_insight_db()
if ENABLE_DEMO_USER:
    ensure_demo_user()

@app.get("/media/{key:path}", include_in_schema=False)
async def serve_media(key: str):
    return media_response(key, public=True)

app.include_router(market_insight_router)
app.include_router(auth_router)
app.include_router(case_library_router)
app.include_router(content_generator_router)
app.include_router(portfolio_router)
app.include_router(publishing_router)
app.include_router(organizations_router)
app.include_router(notifications_router)


@app.get("/")
async def root():
    return {"app": APP_NAME, "status": "running"}
