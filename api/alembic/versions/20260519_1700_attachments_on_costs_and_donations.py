"""attachment columns on manual_costs + donations

Lets the admin upload an invoice (manual costs) or transfer proof
(donations) alongside the row. Files live on disk under UPLOAD_DIR;
the DB only stores the metadata + the relative path.

Revision ID: c5e9a23b8147
Revises: a3f8e1c4b920
Create Date: 2026-05-19 17:00:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = 'c5e9a23b8147'
down_revision: str | None = 'a3f8e1c4b920'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("manual_costs", "donations"):
        op.add_column(table, sa.Column('attachment_path', sa.Text(), nullable=True))
        op.add_column(table, sa.Column('attachment_filename', sa.Text(), nullable=True))
        op.add_column(table, sa.Column('attachment_size_bytes', sa.Integer(), nullable=True))
        op.add_column(table, sa.Column('attachment_mime_type', sa.String(length=64), nullable=True))


def downgrade() -> None:
    for table in ("donations", "manual_costs"):
        op.drop_column(table, 'attachment_mime_type')
        op.drop_column(table, 'attachment_size_bytes')
        op.drop_column(table, 'attachment_filename')
        op.drop_column(table, 'attachment_path')
