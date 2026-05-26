"""User-generated flyers + per-user uploaded images.

Adds two tables:

* `user_flyers` — one row per flyer a logged-in user generated via
  the /flyers/new wizard. Stores the user-authored prompt, the
  Flash-Lite-generated headline/body, the daleel retrieved from the
  kitab corpus (so we never re-fetch and never re-invent), and a
  visibility flag for the public gallery. PNGs are NOT stored — the
  /api/user-flyers/[id].png endpoint re-renders on demand from this
  row's config + the same `composeFlyer()` pipeline the briefing
  flyers use.

* `user_flyer_uploads` — registry of user-uploaded images that back
  user flyers. Separate from `flyer_assets` (admin-curated) so a user
  upload doesn't leak into the briefing-flyer asset pool. Files land
  in /public/flyer-assets/user-uploads/<uuid>.<ext> on the host disk
  (IDCloudHost VPS — UU PDP §17 residency commitment).

Quota (5 flyers/user/week, Sunday WIB-reset) is enforced at write
time via a COUNT(*) on `user_flyers` — no separate counter table.

Revision ID: a8b0c2d4e6f8
Revises: y4c6d8f0h2j4
Create Date: 2026-05-26 12:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision = "a8b0c2d4e6f8"
down_revision = "y4c6d8f0h2j4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_flyer_uploads",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Path relative to web root, e.g. "/flyer-assets/user-uploads/<uuid>.jpg".
        sa.Column("src", sa.Text(), nullable=False),
        sa.Column("mime", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_user_flyer_uploads_user_time",
        "user_flyer_uploads",
        ["user_id", "created_at"],
    )

    op.create_table(
        "user_flyers",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Layout slug — one of the user-exposed values:
        # hero-ayat | hero-headline | split-image | quote-card | dua-hero.
        sa.Column("layout", sa.Text(), nullable=False),
        # Asset reference — either `flyer_assets.id` (admin pool) or
        # `user_flyer_uploads.id` prefixed with "upload:".
        sa.Column("image_ref", sa.Text(), nullable=False),
        sa.Column("headline", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        # Daleel snapshot from kitab corpus. NULL when the layout doesn't
        # carry a daleel card OR retrieval found no fitting entry.
        sa.Column("daleel_citation", sa.Text(), nullable=True),
        sa.Column("daleel_arabic", sa.Text(), nullable=True),
        sa.Column("daleel_translation", sa.Text(), nullable=True),
        sa.Column("daleel_corpus", sa.Text(), nullable=True),
        # User's free-text input — kept for audit + so we could regenerate.
        sa.Column("user_prompt", sa.Text(), nullable=False),
        sa.Column(
            "include_news_context",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # 'private' (default) or 'public'.
        sa.Column(
            "visibility",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'private'"),
        ),
        # Free-form metadata (cost, token counts, model version). Not
        # surfaced in UI; kept for cost-audit + future analytics.
        sa.Column(
            "meta",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "visibility IN ('private', 'public')",
            name="user_flyers_visibility_check",
        ),
        sa.CheckConstraint(
            "layout IN ('hero-ayat', 'hero-headline', 'split-image', "
            "'quote-card', 'dua-hero')",
            name="user_flyers_layout_check",
        ),
    )
    op.create_index(
        "ix_user_flyers_user_time",
        "user_flyers",
        ["user_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_user_flyers_public_time",
        "user_flyers",
        ["created_at"],
        postgresql_where=sa.text("visibility = 'public'"),
    )
    # Quota-window scan: counts rows for one user in the current
    # Sunday-anchored week.
    op.create_index(
        "ix_user_flyers_quota",
        "user_flyers",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_flyers_quota", table_name="user_flyers")
    op.drop_index("ix_user_flyers_public_time", table_name="user_flyers")
    op.drop_index("ix_user_flyers_user_time", table_name="user_flyers")
    op.drop_table("user_flyers")
    op.drop_index(
        "ix_user_flyer_uploads_user_time", table_name="user_flyer_uploads"
    )
    op.drop_table("user_flyer_uploads")
