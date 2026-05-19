"""covers_provider on manual_costs

Lets a manual-cost row declare that it's a flat-rate subscription
covering a metered provider (e.g. Apify Starter $29/mo). The admin
cost totals then exclude that provider's usage_events for the
period, so the per-call usage stays visible (in /admin/system/api-costs)
without double-counting the subscription's cash outflow.

Revision ID: d4f7b29c1a85
Revises: c5e9a23b8147
Create Date: 2026-05-19 18:30:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'd4f7b29c1a85'
down_revision: str | None = 'c5e9a23b8147'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'manual_costs',
        sa.Column('covers_provider', sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('manual_costs', 'covers_provider')
