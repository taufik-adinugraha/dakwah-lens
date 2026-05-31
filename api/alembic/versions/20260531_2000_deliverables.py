"""Add deliverables table for publish-ready kajian artifacts

A "deliverable" / "kajian" is the publish-grade output derived from a
draft brief. The brief is research scaffolding (daleel pool + analysis
the da'i reviews); the deliverable is the format-specific artifact the
da'i actually delivers — Khutbah Jumat (2-part with dua AR), Kultum
(~7 min single thread), or Kajian Umum (3 talking points + Q&A).

One draft can produce many deliverables (same topic in three formats),
so we link by brief_id rather than collapsing into briefs. Publishing
is opt-in: status defaults to "draft" — only published rows are listed
in /pustaka-kajian.

Revision ID: d2e4f6g8h0i2
Revises: b1c3d5e7f9a1
Create Date: 2026-05-31 20:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d2e4f6g8h0i2"
down_revision: str | None = "b1c3d5e7f9a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deliverables",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "brief_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("briefs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("format", sa.Text(), nullable=False),
        # Audience config chosen at deliverable-generation time (not on
        # the draft brief). Same draft can spawn multiple deliverables
        # for different audiences/tones.
        sa.Column("segment", sa.Text(), nullable=False),
        sa.Column("tone", sa.Text(), nullable=False),
        sa.Column(
            "locale", sa.Text(), nullable=False, server_default="id"
        ),
        sa.Column(
            "pages", sa.Integer(), nullable=False, server_default="2"
        ),
        sa.Column(
            "include_profile",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "status", sa.Text(), nullable=False, server_default="draft"
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column(
            "content",
            sa.dialects.postgresql.JSONB(),
            nullable=False,
        ),
        sa.Column(
            "published_at", sa.TIMESTAMP(timezone=True), nullable=True
        ),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(10, 6), nullable=True),
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_deliverables_user_id", "deliverables", ["user_id"]
    )
    op.create_index(
        "ix_deliverables_brief_id", "deliverables", ["brief_id"]
    )
    # Composite index for the /pustaka-kajian list query
    # (WHERE status='published' ORDER BY published_at DESC).
    op.create_index(
        "ix_deliverables_status_published_at",
        "deliverables",
        ["status", "published_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_deliverables_status_published_at", "deliverables")
    op.drop_index("ix_deliverables_brief_id", "deliverables")
    op.drop_index("ix_deliverables_user_id", "deliverables")
    op.drop_table("deliverables")
