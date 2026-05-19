"""Social-post ingestion model.

A `SocialPost` is one item pulled from any source — mainstream RSS, X tweet,
TikTok video, IG post, Facebook post, YouTube video. The shape is intentionally
generic so a single table can hold them all. Per-platform specifics live in
`raw_payload` (JSONB), which carries the original Apify (or RSS) response for
later debugging / re-classification without re-scraping.

Per PRD §05 / §08 the post flows through this lifecycle:
  raw_payload      → just-scraped, no classification yet
  + sentiment_*    → after IndoBERT pass (Stage 2)
  + categories     → after Gemini Flash relevance classifier (Stage 4)
"""

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base, TimestampMixin


class Platform(StrEnum):
    """Recognised content sources. Stored as plain text; this enum is for code."""

    x = "x"
    instagram = "instagram"
    tiktok = "tiktok"
    facebook = "facebook"
    youtube = "youtube"
    mainstream = "mainstream"


class SentimentLabel(StrEnum):
    positive = "positive"
    neutral = "neutral"
    negative = "negative"


class SocialPost(Base, TimestampMixin):
    __tablename__ = "social_posts"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )

    # ── identity ───────────────────────────────────────────────────
    platform: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    """One of `Platform`. Stored as string so adding a new platform doesn't
    require a DB migration."""

    external_id: Mapped[str] = mapped_column(String(255), nullable=False)
    """The platform's own ID (tweet ID, IG post shortcode, etc). Used for dedup."""

    # ── content ────────────────────────────────────────────────────
    author: Mapped[str | None] = mapped_column(String(255))
    url: Mapped[str | None] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str | None] = mapped_column(String(8))
    """ISO 639-1 (`id`, `en`, …) — set by language detection. NULL until classified."""

    posted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )

    region: Mapped[str | None] = mapped_column(String(32))
    """Region code for posts from regional outlets (matches `UserProfile.location`).
    NULL for national / non-mainstream platforms. Denormalized from the
    `rss_feeds.region` of the originating outlet so insights queries stay
    fast — outlives feed deletion."""

    raw_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    """Original API/scraper response. Useful for re-classification later."""

    # ── sentiment (IndoBERT, Stage 2) ──────────────────────────────
    sentiment_label: Mapped[str | None] = mapped_column(String(20))
    sentiment_score: Mapped[float | None] = mapped_column(Float)
    """Confidence of the predicted label, 0-1."""

    # ── relevance (Gemini Flash, Stage 4) ──────────────────────────
    dawah_relevance: Mapped[float | None] = mapped_column(Float)
    """Aggregate da'wah-worthiness, 0-1. Indexed for `WHERE relevance >= …` queries."""

    categories: Mapped[dict[str, float] | None] = mapped_column(JSONB)
    """Per-category scores: `{ "akhlaq": 0.78, "muamalah": 0.12, … }`."""

    # ── topic cluster (BERTopic, Stage 5) ──────────────────────────
    topic_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("topics.id", ondelete="SET NULL"), index=True
    )
    """FK to the BERTopic cluster this post was assigned to in the latest run.
    Nullable: an outlier post (BERTopic cluster -1) or a post scraped after the
    last clustering run has no topic yet."""

    __table_args__ = (
        # Dedup key — re-scraping the same post upserts rather than duplicates.
        UniqueConstraint(
            "platform", "external_id", name="uq_social_post_platform_external"
        ),
        Index("ix_social_posts_relevance", "dawah_relevance"),
        Index("ix_social_posts_platform_posted", "platform", "posted_at"),
        Index("ix_social_posts_platform_region", "platform", "region"),
    )
