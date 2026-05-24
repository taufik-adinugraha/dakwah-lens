"""Comment edit support: edited_at + edit_count on mahasiswa_comments.

Lets a poster edit their own comment within a short window after
submission. Ownership is verified server-side via the existing
`visitor_token_hash` cookie; this migration only adds the bookkeeping
fields the API needs to expose "edited" state and cap retries.

Revision ID: v9z1b3d5f7h9
Revises: u7y9a1c3e5g7
Create Date: 2026-05-24 05:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "v9z1b3d5f7h9"
down_revision = "u7y9a1c3e5g7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mahasiswa_comments",
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "mahasiswa_comments",
        sa.Column(
            "edit_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("mahasiswa_comments", "edit_count")
    op.drop_column("mahasiswa_comments", "edited_at")
