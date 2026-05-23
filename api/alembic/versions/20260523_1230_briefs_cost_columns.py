"""Add cost/token columns to briefs

Brief generation has always logged token usage to `usage_events` (via
`recordUsage` in web/src/lib/llm.ts), but the per-brief cost wasn't
visible alongside the brief itself. Adding the columns directly to the
`briefs` row so:

  * The brief detail page can show "this brief cost $0.04" without
    cross-joining usage_events.
  * The pre-generation cost-preview UI can compare its estimate against
    the actual cost once generation finishes.
  * Per-user spend analytics is a simple SUM over briefs instead of a
    join over usage_events filtered by operation.

All four columns are nullable — historic rows (~2026-05-23 cutover)
keep NULL and the UI shows "n/a" for them.

Revision ID: k1m3o5q7s9u1
Revises: j0l2n4p6q8s0
Create Date: 2026-05-23 12:30:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "k1m3o5q7s9u1"
down_revision: str | None = "j0l2n4p6q8s0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "briefs", sa.Column("tokens_in", sa.Integer(), nullable=True)
    )
    op.add_column(
        "briefs", sa.Column("tokens_out", sa.Integer(), nullable=True)
    )
    # NUMERIC(10,6) holds costs up to ~$9,999 with 6-decimal precision —
    # well past any single brief's cost. Matches the precision we use on
    # `insights_summaries.cost_usd`.
    op.add_column(
        "briefs", sa.Column("cost_usd", sa.Numeric(10, 6), nullable=True)
    )
    op.add_column(
        "briefs", sa.Column("provider", sa.Text(), nullable=True)
    )
    op.add_column(
        "briefs", sa.Column("model", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("briefs", "model")
    op.drop_column("briefs", "provider")
    op.drop_column("briefs", "cost_usd")
    op.drop_column("briefs", "tokens_out")
    op.drop_column("briefs", "tokens_in")
