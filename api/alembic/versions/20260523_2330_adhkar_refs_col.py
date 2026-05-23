"""Add adhkar_refs JSONB column to insights_summaries.

Pesan Flyer 5 (Sunnah invitation) and Flyer 6 (Du'a hero) need to
cite a recitable du'a sourced from the existing kitab corpus (Quran +
hadith books — they already contain hundreds of du'a entries). The
briefing service retrieves a separate du'a pool via `retrieve_dua()`
and stores it here, alongside the existing thematic `daleel_refs`.

The web flyer renderer reads this pool and binds the Flyer 5+6
`**Daleel:**` markers to its citations. Older briefings (NULL value)
fall through to the inline-parse path the renderer already has.

Revision ID: q1u3w5y7a9c1
Revises: p9t0v2x4z6a8
Create Date: 2026-05-23 23:30:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "q1u3w5y7a9c1"
down_revision = "p9t0v2x4z6a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "insights_summaries",
        sa.Column("adhkar_refs", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("insights_summaries", "adhkar_refs")
