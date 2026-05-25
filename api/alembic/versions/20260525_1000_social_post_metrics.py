"""Add social_post_metrics time-series table

The existing `social_posts.engagement_*` columns hold the LATEST stats
per video — yesterday's snapshot gets overwritten by today's. That
loses the time-series signal we need for "viral right now" detection
("this video had 5K views Monday and 200K views Tuesday").

This migration adds a thin append-only `social_post_metrics` table.
One row per (social_post_id, captured_at). The YT scraper writes a
snapshot row on every fetch. The latest row stays mirrored to
`social_posts.engagement_*` for cheap top-N queries; this table backs
the trending / rising-velocity queries that need history.

Index: (social_post_id, captured_at DESC) covers the "what was this
video's view count N hours ago?" query pattern. Partial index on
(captured_at) gates the "what's rising in the last 24h?" sweep cheaply.

All columns nullable except FK + captured_at — mirrors social_posts
which lets likes/comments be NULL when the channel hides them.

Revision ID: y4c6d8f0h2j4
Revises: x3b5d7f9h1k3
Create Date: 2026-05-25 10:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "y4c6d8f0h2j4"
down_revision: str | None = "x3b5d7f9h1k3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "social_post_metrics",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "social_post_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("social_posts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "captured_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("engagement_views", sa.BigInteger(), nullable=True),
        sa.Column("engagement_likes", sa.BigInteger(), nullable=True),
        sa.Column("engagement_comments", sa.BigInteger(), nullable=True),
        sa.Column("engagement_score", sa.Float(), nullable=True),
    )
    # The "give me yesterday's snapshot for this video" lookup:
    # WHERE social_post_id = X AND captured_at < now()-24h ORDER BY captured_at DESC LIMIT 1.
    op.create_index(
        "ix_social_post_metrics_post_time",
        "social_post_metrics",
        ["social_post_id", sa.text("captured_at DESC")],
        unique=False,
    )
    # The "find rising videos in the last 24-48h" sweep: WHERE captured_at >= now() - X.
    op.create_index(
        "ix_social_post_metrics_captured_at",
        "social_post_metrics",
        [sa.text("captured_at DESC")],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_social_post_metrics_captured_at", table_name="social_post_metrics"
    )
    op.drop_index(
        "ix_social_post_metrics_post_time", table_name="social_post_metrics"
    )
    op.drop_table("social_post_metrics")
