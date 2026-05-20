"""Add region column to page_views (IP-derived, no IP stored)

The `analytics.trackPageView` server action now resolves the client's
IP to an Indonesian region bucket (jabodetabek / jawa_barat / jawa_
tengah_diy / jawa_timur / sumatera / kalimantan / sulawesi /
indonesia_timur) via geoip-lite, then stores ONLY the region. The
IP itself is never written to the database — UU PDP §15 personal-data
minimisation.

Idempotent — re-running is fine because `ADD COLUMN IF NOT EXISTS`
and `CREATE INDEX IF NOT EXISTS` both no-op on second run.

Revision ID: a2c4e7d1b9f3
Revises: f0a3c5d7e2b1
Create Date: 2026-05-20 15:00:00.000000+00:00
"""
from collections.abc import Sequence

from alembic import op


revision: str = "a2c4e7d1b9f3"
down_revision: str | None = "f0a3c5d7e2b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE page_views "
        "ADD COLUMN IF NOT EXISTS region VARCHAR(32)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_page_views_region "
        "ON page_views(region)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_page_views_region")
    op.execute("ALTER TABLE page_views DROP COLUMN IF EXISTS region")
