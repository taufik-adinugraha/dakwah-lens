"""Add `segment` discriminator + `daleel_refs` to insights_summaries

The hero now ships in 5 variants: 1 all-platform + 4 per-segment
(spiritual, family, youth, justice). `segment` is NULL for the
all-platform row, otherwise one of the segment keys.

`daleel_refs` is a JSONB array of kitab citations that the Gemini
narrative is allowed to reference. Shape:

    [
      {
        "corpus": "quran" | "bukhari" | "muslim" | …,
        "citation": "Q 2:286",
        "score": 0.78,
        "arabic": "…",
        "translation": "…",
        "ref_id": "quran::2:286"
      },
      …
    ]

The LLM is constrained at prompt-time to ONLY cite from this list (PRD
§12 — hallucinated daleel is the single biggest credibility risk).
The UI renders each cited ref_id as a chip that links back to the
kitab passage on `/kitab/c/{ref_id}`.

Both columns are nullable for backward-compat with rows generated
before this migration; the service writes both going forward.

Revision ID: g7i9k1m3n5p7
Revises: f7i9k1m3n5p7
Create Date: 2026-05-20 23:30:00.000000+00:00
"""
from collections.abc import Sequence

from alembic import op


revision: str = "g7i9k1m3n5p7"
down_revision: str | None = "f7i9k1m3n5p7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE insights_summaries "
        "ADD COLUMN IF NOT EXISTS segment VARCHAR(32)"
    )
    op.execute(
        "ALTER TABLE insights_summaries "
        "ADD COLUMN IF NOT EXISTS daleel_refs JSONB"
    )
    # One summary per (segment, generated_at date) — dedups same-day
    # re-runs without losing the historical timeline.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_insights_summaries_segment "
        "ON insights_summaries(segment, generated_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_insights_summaries_segment")
    op.execute(
        "ALTER TABLE insights_summaries DROP COLUMN IF EXISTS daleel_refs"
    )
    op.execute(
        "ALTER TABLE insights_summaries DROP COLUMN IF EXISTS segment"
    )
