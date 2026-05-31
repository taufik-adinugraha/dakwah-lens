"""Add weekly_quota_usage table — immutable per-user generation counter

User-side quota enforcement (5 drafts + 5 kajian per week) previously
counted rows in `briefs` and `deliverables`. Deleting a row decremented
the count, so users could game the cap by deleting old generations.

This table holds an immutable, monotonically-increasing counter per
(user_id, week_start) pair. Generate actions UPSERT-increment on
success; delete actions leave it untouched. Cap checks read from here
instead of counting source rows.

Window key is the Sunday-00:00 WIB boundary (matching
`currentWeekStartUtc()` in lib/user-flyer/quota.ts). Rows older than
a few weeks are safe to GC, but no urgent need since each user has
at most one row per week.

Revision ID: e3f5g7h9i1k3
Revises: d2e4f6g8h0i2
Create Date: 2026-05-31 22:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e3f5g7h9i1k3"
down_revision: str | None = "d2e4f6g8h0i2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "weekly_quota_usage",
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "week_start_utc",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "briefs_used",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "kajian_used",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("user_id", "week_start_utc"),
    )


def downgrade() -> None:
    op.drop_table("weekly_quota_usage")
