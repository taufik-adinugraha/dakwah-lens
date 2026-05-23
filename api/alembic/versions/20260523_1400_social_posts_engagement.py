"""Add engagement metrics columns to social_posts

Optimizing the YouTube pipeline (2026-05-23): the per-video stats
(views, likes, comments) become first-class on the row instead of being
stashed in raw_payload. Plus a precomputed `engagement_score` so we can
ORDER BY it in topic-discovery sampling + admin top-posts views.

Engagement score formula (computed at ingest time):
    log10(views+1) + 0.5*log10(comments+1) + 0.3*log10(likes+1)

Views dominate the order-of-magnitude; comments are a stronger signal
of audience reaction than likes so they get more weight per unit.
Comparable across YT, X, IG once those platforms wire up.

All columns nullable — historic rows + non-engagement platforms
(mainstream RSS has no per-article views from feedparser) keep NULL.

Revision ID: l3o5q7s9u1w3
Revises: k1m3o5q7s9u1
Create Date: 2026-05-23 14:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op


revision: str = "l3o5q7s9u1w3"
down_revision: str | None = "k1m3o5q7s9u1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "social_posts",
        sa.Column("engagement_views", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "social_posts",
        sa.Column("engagement_likes", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "social_posts",
        sa.Column("engagement_comments", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "social_posts",
        sa.Column("engagement_score", sa.Float(), nullable=True),
    )
    # Index for "top by engagement" queries used by topic discovery
    # weighting + admin top-posts pages. DESC because we always read
    # highest-first; NULLS LAST so unscored posts (mainstream) don't
    # pollute the top of the result.
    op.create_index(
        "ix_social_posts_engagement_score",
        "social_posts",
        [sa.text("engagement_score DESC NULLS LAST")],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_social_posts_engagement_score", table_name="social_posts"
    )
    op.drop_column("social_posts", "engagement_score")
    op.drop_column("social_posts", "engagement_comments")
    op.drop_column("social_posts", "engagement_likes")
    op.drop_column("social_posts", "engagement_views")
