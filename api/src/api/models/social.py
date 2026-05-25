"""Social-post ingestion model.

A `SocialPost` is one item pulled from any source — mainstream RSS, X tweet,
TikTok video, IG post, Facebook post, YouTube video. The shape is intentionally
generic so a single table can hold them all. Per-platform specifics live in
`raw_payload` (JSONB), which carries the original Apify (or RSS) response for
later debugging / re-classification without re-scraping.

Per PRD §05 / §08 the post flows through this lifecycle:
  raw_payload      → just-scraped, no classification yet
  + sentiment_*    → after sentiment pass: Gemini Flash-Lite (unified
                     classifier across mainstream + social platforms
                     since 2026-05-25)
  + categories     → after Gemini Flash-Lite da'wah classifier
  + topic_id       → after Gemini Flash-Lite topic discovery clusters posts
                     into themes; runs nightly at 04:00 WIB.
"""

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
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

    # ── sentiment (Stage 2) ─────────────────────────────────────────
    # Single classifier across all platforms: Gemini Flash-Lite reading
    # event valence (`services/sentiment.py`). Was a hybrid Gemini-for-
    # news / IndoBERT-for-social setup until 2026-05-25 — IndoBERT was
    # ~14% accurate on X positives (sarcasm + supportive opinion both
    # mislabelled).
    sentiment_label: Mapped[str | None] = mapped_column(String(20))
    sentiment_score: Mapped[float | None] = mapped_column(Float)
    """Confidence of the predicted label, 0-1."""

    # ── relevance (Gemini Flash-Lite, Stage 4) ─────────────────────
    dawah_relevance: Mapped[float | None] = mapped_column(Float)
    """Topical relevance, 0-1. Aggregated as mean-of-top-2 category
    scores so single-keyword matches don't dominate (was max() until
    2026-05-21). Used by segment filtering + topic discovery."""

    dawah_opportunity: Mapped[float | None] = mapped_column(Float)
    """'Would a da'i credibly use this?' score, 0-1 continuous.
    Independent second-pass classifier with prompt-side calibration
    anchors at 0.2/0.4/0.6/0.8 — addresses the bucketing pathology
    where the topical relevance score collapsed to {0.0, 0.5, 1.0}.
    UI sorts 'Top posts' by this; falls back to dawah_relevance when
    NULL (rows from before the 2026-05-21 migration)."""

    categories: Mapped[dict[str, float] | None] = mapped_column(JSONB)
    """Per-category scores: `{ "akhlaq": 0.78, "muamalah": 0.12, … }`."""

    # ── engagement (YouTube videos.list stats — 2026-05-23) ─────────
    # Per-video interaction counts. Populated for platforms with public
    # engagement metrics (YT today, X / IG / TikTok when those scrapers
    # come back online). NULL for mainstream RSS where no per-article
    # counts exist.
    engagement_views: Mapped[int | None] = mapped_column(BigInteger)
    engagement_likes: Mapped[int | None] = mapped_column(BigInteger)
    engagement_comments: Mapped[int | None] = mapped_column(BigInteger)
    engagement_score: Mapped[float | None] = mapped_column(Float)
    """Composite score: log10(views+1) + 0.5*log10(comments+1) +
    0.3*log10(likes+1). Views dominate the magnitude; comments weight
    higher than likes because they signal stronger audience reaction.
    Used by top-posts sorting + topic-discovery weighting."""

    # ── topic cluster (Gemini Flash-Lite topic discovery, Stage 5) ──
    topic_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("topics.id", ondelete="SET NULL"), index=True
    )
    """FK to the discovered-topic cluster this post was assigned to in the
    latest run. Nullable: a post not picked up by any theme, or one scraped
    after the last topic-discovery run, has no topic yet."""

    __table_args__ = (
        # Dedup key — re-scraping the same post upserts rather than duplicates.
        UniqueConstraint(
            "platform", "external_id", name="uq_social_post_platform_external"
        ),
        Index("ix_social_posts_relevance", "dawah_relevance"),
        Index("ix_social_posts_opportunity", "dawah_opportunity"),
        Index("ix_social_posts_platform_posted", "platform", "posted_at"),
        Index("ix_social_posts_platform_region", "platform", "region"),
    )


class SocialPostMetric(Base):
    """Time-series snapshot of one post's engagement at one scrape.

    Append-only. The current `social_posts.engagement_*` columns hold the
    LATEST snapshot (for cheap top-N reads); this table holds the full
    history (for "viral growth" / velocity detection). One row per
    (social_post_id, captured_at) — typically one per daily YT scrape.

    Currently populated only for `platform='youtube'` since other
    platforms don't have engagement signal yet.
    """

    __tablename__ = "social_post_metrics"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    social_post_id: Mapped[UUID] = mapped_column(
        ForeignKey("social_posts.id", ondelete="CASCADE"),
        nullable=False,
    )
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    engagement_views: Mapped[int | None] = mapped_column(BigInteger)
    engagement_likes: Mapped[int | None] = mapped_column(BigInteger)
    engagement_comments: Mapped[int | None] = mapped_column(BigInteger)
    engagement_score: Mapped[float | None] = mapped_column(Float)

    __table_args__ = (
        Index(
            "ix_social_post_metrics_post_time",
            "social_post_id",
            "captured_at",
        ),
        Index("ix_social_post_metrics_captured_at", "captured_at"),
    )
