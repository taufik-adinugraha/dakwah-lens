"""Mahasiswa pack public discussion table.

Backs the discussion section on /m/{slug} (the Mahasiswa article page
behind the campus-poster QR). Public, no-auth — anyone can post a
display name + a short body. Auto-moderation runs server-side before
insert; only `approved` rows are listed back, but everything is
persisted (including blocks) so we can audit false positives.

Identity model:
  - `display_name` is the only visible field the writer controls.
  - `ip_hash` + `ua_hash` are SHA-256 of (IP|UA, secret) and are used
    purely for rate-limiting / spam scoring. We never store raw IPs
    (per the public privacy stance) and we never expose these hashes.

Pagination strategy: simple `created_at DESC` with a 10-per-page
slice on the read side; a composite (briefing_slug, status,
created_at DESC) index serves it without sequential scans.

Revision ID: s3w5y7a9c1d3
Revises: r2v4x6z8b0d2
Create Date: 2026-05-24 01:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "s3w5y7a9c1d3"
down_revision = "r2v4x6z8b0d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mahasiswa_comments",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("briefing_slug", sa.String(64), nullable=False),
        sa.Column("display_name", sa.String(40), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("ip_hash", sa.String(64), nullable=True),
        sa.Column("ua_hash", sa.String(64), nullable=True),
        sa.Column(
            "status",
            sa.String(16),
            nullable=False,
            server_default=sa.text("'approved'"),
        ),
        sa.Column("block_reason", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('approved', 'blocked', 'pending')",
            name="ck_mahasiswa_comments_status",
        ),
    )
    op.create_index(
        "ix_mahasiswa_comments_slug_status_time",
        "mahasiswa_comments",
        ["briefing_slug", "status", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_mahasiswa_comments_ip_time",
        "mahasiswa_comments",
        ["ip_hash", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_mahasiswa_comments_ip_time", table_name="mahasiswa_comments")
    op.drop_index(
        "ix_mahasiswa_comments_slug_status_time",
        table_name="mahasiswa_comments",
    )
    op.drop_table("mahasiswa_comments")
