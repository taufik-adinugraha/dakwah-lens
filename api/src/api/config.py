from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ─── App ─────────────────────────────────────────────
    app_name: str = "DakwahLens API"
    environment: str = Field(default="development")
    api_base_url: str = "http://localhost:8000"
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default=["http://localhost:3000"],
        description="Allowed CORS origins for the web frontend. Comma-separated in .env.",
    )

    # ─── Database ────────────────────────────────────────
    database_url: str = Field(
        default="postgresql+asyncpg://dakwah:dakwah_dev@localhost:5433/dakwah_lens"
    )

    # ─── Qdrant ──────────────────────────────────────────
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None

    # ─── Redis (Celery broker) ───────────────────────────
    redis_url: str = "redis://localhost:6380/0"

    # ─── LLM / Embeddings ────────────────────────────────
    openai_api_key: str | None = None
    gemini_api_key: str | None = None
    anthropic_api_key: str | None = None

    embedding_model: str = "text-embedding-3-small"
    classifier_model: str = "gemini-2.0-flash"
    # Brief synthesis: Gemini 2.5 Pro primary (cheaper than Claude
    # Sonnet at $1.25/$10.00 vs $3/$15 per 1M tokens), Claude Sonnet
    # 4.6 as fallback when Gemini errors or returns malformed output.
    brief_model: str = "gemini-2.5-pro"
    brief_fallback_model: str = "claude-sonnet-4-6"

    # ─── Scrapers ────────────────────────────────────────
    apify_token: str | None = None
    youtube_api_key: str | None = None

    # ─── i18n ────────────────────────────────────────────
    default_locale: str = "en"
    supported_locales: Annotated[list[str], NoDecode] = Field(default=["en", "id"])

    # ─── Auth ────────────────────────────────────────────
    # Shared secret with Next.js Auth.js. JWTs signed by Auth.js with this
    # secret are verified here. MUST be set in .env for production.
    nextauth_secret: str | None = Field(default=None, alias="NEXTAUTH_SECRET")
    admin_email: str | None = Field(
        default=None,
        description=(
            "Bootstrap admin email. Whoever first signs up with this address "
            "gets approved + admin role automatically."
        ),
    )

    # ─── Feature flags ───────────────────────────────────
    # When True, briefing.py post-processes the `## Pesan Flyer` section
    # (slots 1-4) using the daleel-first content pipeline in
    # services/flyer_content.py — picker chooses the daleel + LLM-driven
    # truncation, then writes message+title FROM the chosen daleel. Off
    # by default to make the rollout reversible; flip in .env once the
    # A/B comparison confirms the new flow is at least parity with the
    # in-prompt flyer generation. Slots 5-6 (inline du'a) are untouched.
    flyer_daleel_first_enabled: bool = Field(
        default=False, alias="DALEEL_FIRST_FLYERS"
    )

    @field_validator("cors_origins", "supported_locales", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
