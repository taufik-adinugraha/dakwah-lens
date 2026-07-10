"""Cache table for Indonesian renderings of Ibn Kathir tafsir.

The seeded `tafsir_ibn_kathir` Qdrant corpus stores exegesis in ENGLISH
only (`chunk_text_en`; no Indonesian). The manual "Tafsir Pekan Ini"
track renders it to Bahasa at compose-time and persists the result,
keyed by (surah, ayah), so we never re-translate an unchanged ayah.

Direct analogue of `hadith_translations_id`. The calling service does
UPSERT-style "check, translate-if-missing, return"; the `text_en`
column lets us invalidate the cache if the upstream English changes.

Revision ID: d4e5f6g7h8i9
Revises: c3d4e5f6g7h8
Create Date: 2026-07-10 12:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "d4e5f6g7h8i9"
down_revision = "c3d4e5f6g7h8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tafsir_translations_id",
        sa.Column("surah", sa.Integer(), nullable=False),
        sa.Column("ayah", sa.Integer(), nullable=False),
        sa.Column(
            "text_en",
            sa.Text(),
            nullable=False,
            comment="English source text (concatenated Ibn Kathir chunks) — "
            "kept so we can invalidate the cached ID rendering if the "
            "upstream source changes.",
        ),
        sa.Column("text_id", sa.Text(), nullable=False),
        sa.Column(
            "model",
            sa.String(64),
            nullable=False,
            comment="Author of the ID rendering (e.g., 'claude-manual') — "
            "lets us audit / re-run if the translation policy changes.",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "surah", "ayah", name="pk_tafsir_translations_id"
        ),
    )


def downgrade() -> None:
    op.drop_table("tafsir_translations_id")
