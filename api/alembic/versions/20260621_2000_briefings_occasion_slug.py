"""briefings: add occasion_slug for 15th-track Islamic calendar briefings.

Enables a new briefing track that fires for upcoming Islamic occasions
(1 Muharram, Tasu'a+Asyura, Maulid, Isra' Mi'raj, Nisfu Sya'ban, Ramadan
weekly sub-themes, Idul Fitri+6 Syawwal, 10 Dzulhijjah+Idul Adha+Tasyriq)
in parallel with the existing 14 weekly theme briefings. The 15th track
uses `theme_group = 'Acara Kalender Islam'` and adds an `occasion_slug`
identifier so the Sunday 05:00 WIB cron can idempotently check whether a
given iteration has already been generated.

Slug shape: `<occasion>-<hijri_year>` for single-iteration occasions
(e.g. `asyura-1448`, `maulid-1448`), or `<occasion>-<hijri_year>-<sub>`
for weekly-refresh occasions (e.g. `ramadan-1448-w2`,
`dzulhijjah-1448-arafah`). The cron's idempotency check is
`SELECT 1 FROM briefings WHERE occasion_slug = ?` — partial index on
non-null occasion_slug keeps the index small.

Nullable — historical and 14-theme briefings stay NULL. URL slug format
`/d/YYYY-MM-DD-<occasion-slug>/<deliverable>` mirrors the existing theme
briefings.

Revision ID: c3d4e5f6g7h8
Revises: b1d2e3f4a5b6
Create Date: 2026-06-21 20:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op


revision: str = "c3d4e5f6g7h8"
down_revision: str | None = "b1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "briefings",
        sa.Column("occasion_slug", sa.String(length=64), nullable=True),
    )
    # Partial index on non-null only — most rows are 14-theme briefings
    # with NULL occasion_slug. The cron's idempotency query targets
    # specific slugs (asyura-1448, ramadan-1448-w2, etc.), so a small
    # index on the non-null subset is what we want.
    op.create_index(
        "ix_briefings_occasion_slug",
        "briefings",
        ["occasion_slug"],
        unique=False,
        postgresql_where=sa.text("occasion_slug IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_briefings_occasion_slug", table_name="briefings")
    op.drop_column("briefings", "occasion_slug")
