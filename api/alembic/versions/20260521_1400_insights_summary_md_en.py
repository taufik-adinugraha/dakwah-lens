"""Add `summary_md_en` so briefings ship in both Bahasa Indonesia + English

The existing `summary_md` stays as the Indonesian copy (the primary
locale of this product). `summary_md_en` is the parallel English copy,
generated alongside in the same `generate_summary` run. UI picks the
column matching the user's locale; falls back to `summary_md` when the
English column is NULL (rows generated before this migration).

Nullable on purpose so historic rows survive without a backfill — the
service will populate both going forward.

Revision ID: h8j0l2n4p6q8
Revises: g7i9k1m3n5p7
Create Date: 2026-05-21 14:00:00.000000+00:00
"""
from collections.abc import Sequence

from alembic import op


revision: str = "h8j0l2n4p6q8"
down_revision: str | None = "g7i9k1m3n5p7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE insights_summaries "
        "ADD COLUMN IF NOT EXISTS summary_md_en TEXT"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE insights_summaries DROP COLUMN IF EXISTS summary_md_en"
    )
