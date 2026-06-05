"""Rename insights_summaries → briefings, segment → theme_group, drop retired columns.

Part of the "Scope C" terminology cleanup (2026-06-05). The product's
weekly long-form AI output is called a BRIEFING; "insights" was a
muddy umbrella that read ambiguously next to the data dashboard. This
migration aligns the DB to the canonical vocabulary:

  - Table: `insights_summaries` → `briefings`
  - Column: `briefings.segment` → `briefings.theme_group`
      (the column has carried THEME_GROUPS labels since 2026-06-03,
       the legacy `segment` name was a holdover from the prior 4-
       audience-segment model)
  - Drops: `social_posts.categories` + `social_posts.dawah_relevance`
      (the 9 PRD da'wah scoring was retired 2026-06-05; columns are
       no longer written or read, and historical values aren't useful
       enough to justify the schema weight)

Backwards-compat: there are no external consumers of these names —
the only callers are this codebase + our own UI. So we can rename
in-place. Down-migration restores the old names + recreates the
dropped columns (NULL — historical data isn't recoverable).

Revision ID: a7c9d0e1f2g3
Revises: f1a3c5e7g9j1
Create Date: 2026-06-05 15:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op


revision = "a7c9d0e1f2g3"
down_revision = "f1a3c5e7g9j1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Table rename.
    op.rename_table("insights_summaries", "briefings")
    # 2. Column rename.
    op.alter_column(
        "briefings",
        "segment",
        new_column_name="theme_group",
    )
    # 3. Drop the 9-PRD retirement columns.
    op.drop_index(
        "ix_social_posts_relevance", table_name="social_posts", if_exists=True
    )
    op.drop_column("social_posts", "dawah_relevance")
    op.drop_column("social_posts", "categories")


def downgrade() -> None:
    # Restore columns (data isn't restorable).
    op.add_column(
        "social_posts",
        sa.Column(
            "categories",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.add_column(
        "social_posts",
        sa.Column("dawah_relevance", sa.Float(), nullable=True),
    )
    op.create_index(
        "ix_social_posts_relevance",
        "social_posts",
        ["dawah_relevance"],
        unique=False,
    )
    op.alter_column(
        "briefings",
        "theme_group",
        new_column_name="segment",
    )
    op.rename_table("briefings", "insights_summaries")
