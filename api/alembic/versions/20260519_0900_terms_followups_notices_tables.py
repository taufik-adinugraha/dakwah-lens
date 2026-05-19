"""terms_versions, admin_followups, app_notices tables

Backs the terms-update workflow: bumping `TERMS_VERSION` in web code
drifts from `terms_versions.version` here, which prompts the admin
dashboard to insert a new row + queue email-blast + banner-post
follow-ups for the superadmin to action from /admin/system/followups.

Revision ID: 8c1a4f2e9b73
Revises: 74bf46ffd953
Create Date: 2026-05-19 09:00:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = '8c1a4f2e9b73'
down_revision: str | None = '74bf46ffd953'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'terms_versions',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('version', sa.String(length=32), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('changelog', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('version', name='uq_terms_versions_version'),
    )
    op.create_index('ix_terms_versions_created_at', 'terms_versions', ['created_at'], unique=False)

    op.create_table(
        'admin_followups',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('kind', sa.String(length=48), nullable=False),
        sa.Column('status', sa.String(length=16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('related_id', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_by', sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_admin_followups_kind', 'admin_followups', ['kind'], unique=False)
    op.create_index('ix_admin_followups_status', 'admin_followups', ['status'], unique=False)

    op.create_table(
        'app_notices',
        sa.Column('id', sa.Uuid(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('message_en', sa.Text(), nullable=False),
        sa.Column('message_id', sa.Text(), nullable=False),
        sa.Column('severity', sa.String(length=16), server_default=sa.text("'info'"), nullable=False),
        sa.Column('starts_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_app_notices_window', 'app_notices', ['starts_at', 'ends_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_app_notices_window', table_name='app_notices')
    op.drop_table('app_notices')
    op.drop_index('ix_admin_followups_status', table_name='admin_followups')
    op.drop_index('ix_admin_followups_kind', table_name='admin_followups')
    op.drop_table('admin_followups')
    op.drop_index('ix_terms_versions_created_at', table_name='terms_versions')
    op.drop_table('terms_versions')
