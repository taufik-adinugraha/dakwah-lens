"""rss_feeds.fetch_body default true + backfill

Revision ID: 859ced351031
Revises: 4b087cde930d
Create Date: 2026-05-18 02:39:50.527832+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '859ced351031'
down_revision: str | None = '4b087cde930d'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Flip the column-level default for new inserts.
    op.alter_column(
        "rss_feeds",
        "fetch_body",
        server_default=sa.text("true"),
        existing_type=sa.Boolean(),
        existing_nullable=False,
    )
    # Backfill existing rows so the default actually applies to current
    # outlets (only ~6 at time of writing, all still on the old default).
    op.execute("UPDATE rss_feeds SET fetch_body = true WHERE fetch_body = false")


def downgrade() -> None:
    op.alter_column(
        "rss_feeds",
        "fetch_body",
        server_default=sa.text("false"),
        existing_type=sa.Boolean(),
        existing_nullable=False,
    )
