"""brief_errors table

Captures failed brief-generation attempts so the admin dashboard can
compute an error rate over a sliding window. Successes are already
tracked by `briefs`; this is the failure-side ledger.

Revision ID: a3f8e1c4b920
Revises: 8c1a4f2e9b73
Create Date: 2026-05-19 14:00:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'a3f8e1c4b920'
down_revision: str | None = '8c1a4f2e9b73'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'brief_errors',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('topic_title', sa.Text(), nullable=True),
        sa.Column('segment', sa.String(length=32), nullable=True),
        sa.Column('tone', sa.String(length=32), nullable=True),
        sa.Column('locale', sa.String(length=8), nullable=True),
        sa.Column('error_code', sa.String(length=64), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_brief_errors_created_at', 'brief_errors', ['created_at'], unique=False)
    op.create_index('ix_brief_errors_error_code', 'brief_errors', ['error_code'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_brief_errors_error_code', table_name='brief_errors')
    op.drop_index('ix_brief_errors_created_at', table_name='brief_errors')
    op.drop_table('brief_errors')
