"""Insights summaries — daily AI-narrated executive briefing for /insights

One row per generation. The Celery `generate_insights_summary` task runs
daily at 04:30 WIB (right after topic-discovery at 04:00 — fresh data,
before the workday). Each row stores:

  - period_start / period_end: the 7-day window the briefing covered
  - summary_md: Gemini 2.5 Pro-generated narrative (Bahasa Indonesia,
    with key numbers cited)
  - headline_stats: pre-computed numbers for the pill-row UI so the
    front-end doesn't have to recompute on every page render
  - model + tokens + cost: usage telemetry, identical shape to
    usage_events

The /insights page reads the most recent row (by generated_at).

Revision ID: c5d7e9f1a3b2
Revises: a2c4e7d1b9f3
Create Date: 2026-05-20 17:00:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "c5d7e9f1a3b2"
down_revision: str | None = "a2c4e7d1b9f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "insights_summaries",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("summary_md", sa.Text(), nullable=False),
        sa.Column(
            "headline_stats",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("model", sa.String(length=64), nullable=False),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_insights_summaries_generated_at",
        "insights_summaries",
        [sa.text("generated_at DESC")],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_insights_summaries_generated_at", table_name="insights_summaries"
    )
    op.drop_table("insights_summaries")
