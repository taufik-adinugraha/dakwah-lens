"""Add `verified` + `verified_at` to youtube_channels

The seed script resolves channel names via YT search.list (top-1 match),
which sometimes finds a wrong channel for ambiguous names (e.g. "dr
Sung" → "Justin Sung" the Western academic). To prevent these mis-
matches from polluting the ingest pipeline, channels now require an
explicit admin verification step before they're scraped.

`verified` is FALSE by default (incl. for seeded rows) — an admin must
hit the "Verify" button per channel or "Verify All" at /admin/system/
youtube-channels. Verification fetches `channels.list?id=X&part=snippet,
statistics,brandingSettings` (1 quota unit) and confirms:
  - channel exists and is public
  - reported title/handle is sensible vs the curated `name`
  - subscriber/video counts above sanity thresholds

The ingest dispatcher (workers/ingest.py::youtube_channels_ingest) is
updated to filter on `enabled=true AND verified=true` in the same
commit family.

Revision ID: m5q7s9u1w3y5
Revises: l3o5q7s9u1w3
Create Date: 2026-05-23 15:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op


revision: str = "m5q7s9u1w3y5"
down_revision: str | None = "l3o5q7s9u1w3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "youtube_channels",
        sa.Column(
            "verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "youtube_channels",
        sa.Column(
            "verified_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    # The ingest dispatcher's "pick least-recently-scraped enabled
    # channel" query becomes "...enabled AND verified" — add a partial
    # index on (verified, enabled) where both are true so that scan
    # stays O(verified count) instead of O(table).
    op.create_index(
        "ix_youtube_channels_active",
        "youtube_channels",
        ["verified", "enabled"],
        unique=False,
        postgresql_where=sa.text("verified = true AND enabled = true"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_youtube_channels_active", table_name="youtube_channels"
    )
    op.drop_column("youtube_channels", "verified_at")
    op.drop_column("youtube_channels", "verified")
