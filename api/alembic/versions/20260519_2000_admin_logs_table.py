"""admin_logs table

Audit trail for every admin server action. Append-only — written by
`logAdminAction()` in web/src/lib/admin-log.ts. The audit page at
/admin/system/audit reads from this table.

Revision ID: e6f1a82c4d09
Revises: d4f7b29c1a85
Create Date: 2026-05-19 20:00:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = 'e6f1a82c4d09'
down_revision: str | None = 'd4f7b29c1a85'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'admin_logs',
        sa.Column(
            'id',
            sa.Uuid(),
            server_default=sa.text('gen_random_uuid()'),
            nullable=False,
        ),
        sa.Column('actor_user_id', sa.Uuid(), nullable=True),
        sa.Column('action', sa.String(length=64), nullable=False),
        sa.Column('target_type', sa.String(length=32), nullable=True),
        sa.Column('target_id', sa.Text(), nullable=True),
        sa.Column(
            'payload',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_admin_logs_action_time',
        'admin_logs',
        ['action', 'created_at'],
        unique=False,
    )
    op.create_index(
        'ix_admin_logs_actor_time',
        'admin_logs',
        ['actor_user_id', 'created_at'],
        unique=False,
    )
    op.create_index(
        'ix_admin_logs_created_at',
        'admin_logs',
        ['created_at'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_admin_logs_created_at', table_name='admin_logs')
    op.drop_index('ix_admin_logs_actor_time', table_name='admin_logs')
    op.drop_index('ix_admin_logs_action_time', table_name='admin_logs')
    op.drop_table('admin_logs')
