"""Threaded replies on mahasiswa_comments.

Adds `parent_id` so a comment can be a reply to another top-level
comment in the same room. Single-level threading by design — replies
to replies aren't allowed (the API enforces parent.parent_id IS NULL).

ON DELETE SET NULL so admin deletion of a parent doesn't cascade-wipe
the replies that hung off it; orphaned replies surface back at the
top level.

Revision ID: x3b5d7f9h1k3
Revises: w1a3c5e7g9j1
Create Date: 2026-05-24 07:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "x3b5d7f9h1k3"
down_revision = "w1a3c5e7g9j1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mahasiswa_comments",
        sa.Column("parent_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_mahasiswa_comments_parent",
        "mahasiswa_comments",
        "mahasiswa_comments",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_mahasiswa_comments_parent_status_time",
        "mahasiswa_comments",
        ["parent_id", "status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_mahasiswa_comments_parent_status_time",
        table_name="mahasiswa_comments",
    )
    op.drop_constraint(
        "fk_mahasiswa_comments_parent",
        "mahasiswa_comments",
        type_="foreignkey",
    )
    op.drop_column("mahasiswa_comments", "parent_id")
