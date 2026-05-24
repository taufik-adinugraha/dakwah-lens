"""Cache table for Indonesian translations of hadith corpora.

The seeded kitab corpus has Indonesian translations ONLY for the Qur'an
(Kemenag). Hadith corpora (Bukhari, Muslim, Riyad as-Salihin) carry
only Arabic + English. That made every hadith-cited flyer render in
English on the Bahasa-default UI.

This table caches one-shot Gemini Flash-Lite translations of the
English hadith text into Indonesian, keyed by (corpus, hadithnumber).
Re-translation is idempotent — the calling service does UPSERT-style
"check, translate-if-missing, return".

Revision ID: w1a3c5e7g9j1
Revises: v9z1b3d5f7h9
Create Date: 2026-05-24 06:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "w1a3c5e7g9j1"
down_revision = "v9z1b3d5f7h9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hadith_translations_id",
        sa.Column("corpus", sa.String(64), nullable=False),
        sa.Column("hadithnumber", sa.String(32), nullable=False),
        sa.Column(
            "text_en",
            sa.Text(),
            nullable=False,
            comment="English source text — kept so we can invalidate the "
            "cached ID translation if the upstream source changes.",
        ),
        sa.Column("text_id", sa.Text(), nullable=False),
        sa.Column(
            "model",
            sa.String(64),
            nullable=False,
            comment="LLM model id (e.g., 'gemini-flash-lite-2.5') used "
            "to produce the translation — lets us audit / re-run if the "
            "translation policy changes.",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "corpus", "hadithnumber", name="pk_hadith_translations_id"
        ),
    )


def downgrade() -> None:
    op.drop_table("hadith_translations_id")
