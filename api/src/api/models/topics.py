"""Discovered-topic model.

A `Topic` is one cluster produced by BERTopic over the latest batch of social
posts for a given platform. We persist the cluster's auto-generated keyword
label and the per-platform post count so the `/insights/[platform]` page can
render a "Discovered topics" section without re-clustering on every request.

Topics are recomputed in batch (Celery beat or manual CLI) — between runs
they're effectively immutable. The `topic_id` FK on `SocialPost` lets us
join posts back to their topic for drilldowns.
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

    # BERTopic's integer cluster ID for the run that produced this row. -1 is
    # the "outlier" cluster which we drop before persisting, so all stored
    # topics have a real cluster_id >= 0. Useful for re-joining to the
    # in-memory model if we re-load it.
    cluster_id: Mapped[int] = mapped_column(Integer, nullable=False)

    label: Mapped[str] = mapped_column(Text, nullable=False)
    """Human-readable label — for now the top 3 keywords joined by ' · '."""

    keywords: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    """All top keywords from c-TF-IDF, ordered by relevance."""

    post_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    first_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_topics_platform_postcount", "platform", "post_count"),
    )
