import os
from dotenv import load_dotenv

load_dotenv(override=True)


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()

APP_NAME = os.getenv("APP_NAME", "ai_marketing_platform")
DEBUG = os.getenv("DEBUG", "true").lower() == "true"
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50"))
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

# ---- LLM Providers ----
# Global AI configuration used by market insight and content generation.
# Change only these CASE_AI_* values when switching providers.
CASE_AI_API_KEY = _env("CASE_AI_API_KEY")
CASE_AI_BASE_URL = _env("CASE_AI_BASE_URL", "https://api.deepseek.com")
CASE_AI_MODEL = _env("CASE_AI_MODEL", "deepseek-v4-flash")

# Provider-independent configuration for case library analysis.
CASE_ANALYSIS_AI_API_KEY = _env("CASE_ANALYSIS_AI_API_KEY")
CASE_ANALYSIS_AI_BASE_URL = _env("CASE_ANALYSIS_AI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
CASE_ANALYSIS_AI_MODEL = _env("CASE_ANALYSIS_AI_MODEL", "qwen3.6-flash")

# Card Modification AI inherits the same provider unless explicitly overridden.
MODIFY_CARD_AI_API_KEY = _env("MODIFY_CARD_AI_API_KEY", CASE_AI_API_KEY) or CASE_AI_API_KEY
MODIFY_CARD_AI_BASE_URL = _env("MODIFY_CARD_AI_BASE_URL", CASE_AI_BASE_URL) or CASE_AI_BASE_URL
MODIFY_CARD_AI_MODEL = _env("MODIFY_CARD_AI_MODEL", CASE_AI_MODEL) or CASE_AI_MODEL

# ---- Database ----
DB_PATH = os.getenv("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "data", "market_insight.db"))

# ---- Auth ----
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production-use-a-random-string")
DATA_ENCRYPTION_KEY = _env("DATA_ENCRYPTION_KEY")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))
ENABLE_DEMO_USER = os.getenv("ENABLE_DEMO_USER", "false").lower() == "true"
DEMO_USERNAME = _env("DEMO_USERNAME", "demo")
DEMO_PASSWORD = _env("DEMO_PASSWORD")
DEMO_EMAIL = _env("DEMO_EMAIL", "demo@local.dev")

# ---- File Handling ----
ALLOWED_DOCUMENT_TYPES = {
    "text/markdown": "markdown",
    "text/x-markdown": "markdown",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/octet-stream": None,
}

ALLOWED_EXTENSIONS = {".md", ".markdown", ".pdf", ".docx"}

# ---- Media Storage ----
MEDIA_ROOT = os.path.join(os.path.dirname(__file__), "..", "data", "media")
ALLOWED_VIDEO_EXTENSIONS = {".mp4"}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_VIDEO_SIZE_MB = int(os.getenv("MAX_VIDEO_SIZE_MB", "100"))
MAX_IMAGE_SIZE_MB = int(os.getenv("MAX_IMAGE_SIZE_MB", "10"))
MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024
MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024
