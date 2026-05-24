"""Add admin controls for /m/{slug} discussion rooms.

Two complementary additions:

  1. `mahasiswa_comments.pinned BOOLEAN NOT NULL DEFAULT FALSE`
      — admin can pin one (or a few) comments to the top of the public
        thread. The public listing orders by `pinned DESC, created_at
        DESC`. Index `(briefing_slug, pinned, created_at DESC)`
        backs that sort cheaply.

  2. New table `mahasiswa_room_settings`
      — one row per room (briefing_slug). For now it carries the
        mute flag (`muted_at`/`muted_by_user_id`). A muted room rejects
        new public submissions but stays readable to scanners; the
        admin can lift the mute anytime.

Why a side table instead of more columns on `insights_summaries`:
keeps room-moderation state isolated from the immutable briefing
content. The briefing row is read-once, render-only; mute state
churns and is mutable.

Revision ID: t5y7a9c1d3e5
Revises: s3w5y7a9c1d3
Create Date: 2026-05-24 02:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "t5y7a9c1d3e5"
down_revision = "s3w5y7a9c1d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- pinned column on comments ---
    op.add_column(
        "mahasiswa_comments",
        sa.Column(
            "pinned",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # Pinned reads are nearly always "give me the latest approved
    # rows, pinned ones first". Partial index keeps it small —
    # 99% of rows have pinned=false.
    op.create_index(
        "ix_mahasiswa_comments_pinned",
        "mahasiswa_comments",
        ["briefing_slug", "created_at"],
        postgresql_where=sa.text("pinned = true"),
    )

    # --- room settings table ---
    op.create_table(
        "mahasiswa_room_settings",
        sa.Column("briefing_slug", sa.String(64), primary_key=True),
        sa.Column(
            "muted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "muted_by_user_id",
            UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("mute_reason", sa.String(120), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("mahasiswa_room_settings")
    op.drop_index(
        "ix_mahasiswa_comments_pinned",
        table_name="mahasiswa_comments",
    )
    op.drop_column("mahasiswa_comments", "pinned")
