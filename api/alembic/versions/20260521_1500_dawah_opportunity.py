"""Add `dawah_opportunity` — the 'would a da'i actually use this' score

The existing `dawah_relevance` is max(category_scores) — collapsed to
3 buckets (0.0, 0.5, 1.0) in practice because the model treats the
prompt's anchor values as a categorical choice. It also greedily
matches surface keywords (e.g. a stock-market story scores 1.0 on
muamalah just by mentioning banks).

`dawah_opportunity` is a SECOND classifier pass that asks the model a
focused question: "could a da'i credibly cite this in a khutbah,
kajian, or da'wah content piece this week?" Continuous score 0-1
with prompt-side calibration anchors at 0.2 / 0.4 / 0.6 / 0.8 to
break the bucketing pathology.

UI sorts "Top posts by da'wah relevance" by this column when present,
falling back to `dawah_relevance` for historic rows where it's NULL.

Revision ID: i9k1m3o5q7s9
Revises: h8j0l2n4p6q8
Create Date: 2026-05-21 15:00:00.000000+00:00
"""
from collections.abc import Sequence

from alembic import op


revision: str = "i9k1m3o5q7s9"
down_revision: str | None = "h8j0l2n4p6q8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE social_posts "
        "ADD COLUMN IF NOT EXISTS dawah_opportunity DOUBLE PRECISION"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_social_posts_opportunity "
        "ON social_posts(dawah_opportunity DESC NULLS LAST)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_social_posts_opportunity")
    op.execute(
        "ALTER TABLE social_posts DROP COLUMN IF EXISTS dawah_opportunity"
    )
