"""youtube_channels: persist subscriber_count from verify calls.

The verify path already fetches `channel.statistics.subscriberCount`
from the YouTube Data API (one round-trip per channel) but threw it
away after the response. Persisting it lets the admin UI sort channels
by audience size and surfaces a useful signal for prioritising verify-
all sweeps (large channels first).

`subscriber_count` is BIGINT because MrBeast et al. exceed INT range
(~2.1B); Indonesia's largest channels are nowhere near that, but it's
a one-time choice and BIGINT costs the same row width via TOAST.

`subscribers_updated_at` records the wall clock at which the count
landed, so the operator can spot stale figures (channel grew since
last verify) without re-running the whole verify-all.

Revision ID: b1c3d5e7f9a1
Revises: a8b0c2d4e6f8
Create Date: 2026-05-29 11:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op


revision = "b1c3d5e7f9a1"
down_revision = "a8b0c2d4e6f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "youtube_channels",
        sa.Column("subscriber_count", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "youtube_channels",
        sa.Column(
            "subscribers_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    # Partial index: only verified channels with a known count get an
    # index entry. Unverified rows have NULL counts and the admin UI's
    # "sort by followers" puts them at the bottom anyway — no need to
    # bloat the index with NULLs.
    op.create_index(
        "ix_youtube_channels_subscriber_count",
        "youtube_channels",
        ["subscriber_count"],
        unique=False,
        postgresql_where=sa.text("subscriber_count IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_youtube_channels_subscriber_count", table_name="youtube_channels")
    op.drop_column("youtube_channels", "subscribers_updated_at")
    op.drop_column("youtube_channels", "subscriber_count")
