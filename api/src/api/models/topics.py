"""Discovered-topic model.

A `Topic` is one theme cluster produced by `services.topic_discovery`
(Gemini Flash-Lite) over the latest batch of social posts for a given
platform. We persist the label, the keyword list, and the per-platform post
count so the `/insights/[platform]` page can render a "Discovered topics"
section without re-clustering on every request.

Topics are recomputed in batch (Celery beat at 04:00 WIB, or manual CLI) —
between runs they're effectively immutable. The `topic_id` FK on
`SocialPost` lets us join posts back to their topic for drilldowns.

The `cluster_id` column is a vestigial integer kept for back-compat with
old rows; new rows get a synthetic value.
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    ARRAY,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from api.models.base import Base, TimestampMixin


class Topic(Base, TimestampMixin):
    __tablename__ = "topics"

    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )

    platform: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    """The platform this topic was discovered on. Topics are scoped per-platform
    because clustering across platforms mixes vocabulary in unhelpful ways."""

    # Vestigial cluster id. New rows receive a synthetic integer to keep
    # the NOT NULL constraint; nothing in the read path uses it anymore.
    cluster_id: Mapped[int] = mapped_column(Integer, nullable=False)

    label: Mapped[str] = mapped_column(Text, nullable=False)
    """Human-readable Indonesian theme label authored by Gemini Flash-Lite
    during topic discovery (e.g. 'Korupsi Pejabat dan Keadilan Hukum')."""

    keywords: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    """Keyword list from the topic-discovery pass, ordered by relevance."""

    post_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    first_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_topics_platform_postcount", "platform", "post_count"),
    )
