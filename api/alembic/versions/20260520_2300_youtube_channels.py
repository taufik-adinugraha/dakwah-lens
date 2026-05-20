"""YouTube whitelist channels — bucketed dakwah/lifestyle/news/etc.

Replaces the rotating-keyword strategy for YouTube. Instead of
`search.list` (100 quota units, returns spammy long tail), we hit
each channel's auto-generated uploads playlist via
`playlistItems.list` (1 quota unit, returns the channel's own recent
uploads). 100× cheaper on quota and trivially curated for quality.

The 8 buckets are content-archetypes the curator picks per channel:
religious, family, youth, muamalah, social_justice, health,
education, cultural. (We dropped `current_events` after seed
curation showed Najwa/Narasi/Watchdoc/Pinter Politik in
`social_justice` already cover that beat.)

Revision ID: f7i9k1m3n5p7
Revises: e5g7h9j1k3l5
Create Date: 2026-05-20 23:00:00.000000+00:00
"""
from collections.abc import Sequence

from alembic import op


revision: str = "f7i9k1m3n5p7"
down_revision: str | None = "e5g7h9j1k3l5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS youtube_channels (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            channel_id  VARCHAR(64)  NOT NULL UNIQUE,
            name        VARCHAR(255) NOT NULL,
            handle      VARCHAR(128),
            category    VARCHAR(32)  NOT NULL,
            enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
            last_run_at TIMESTAMPTZ,
            created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_youtube_channels_category_enabled "
        "ON youtube_channels(category, enabled)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_youtube_channels_enabled_last_run "
        "ON youtube_channels(enabled, last_run_at NULLS FIRST)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_youtube_channels_enabled_last_run")
    op.execute("DROP INDEX IF EXISTS ix_youtube_channels_category_enabled")
    op.execute("DROP TABLE IF EXISTS youtube_channels")
