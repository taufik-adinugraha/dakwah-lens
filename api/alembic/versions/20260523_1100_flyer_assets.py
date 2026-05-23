"""Add `flyer_assets` — DB-backed registry for the modular flyer system

The flyer renderer (Puppeteer + Tailwind, /web/src/lib/flyer/) was
previously seeded by a hand-edited TS file. Moving to a DB-backed
registry so admins can upload new photos / SVGs via the web UI without
a code redeploy.

Schema mirrors `FlyerImageAsset` in TS:
    id (text PK)      — stable identifier; used as the compose() seed
    kind (text)       — "photo" | "ornament" | "pattern"
    src (text)        — path relative to web root, e.g.
                        "/flyer-assets/photos/mosque-night.jpg"
    aspect (text)     — "1:1" | "wide" | "tall"
    tags (text[])     — free-form mood tags for compose() filtering
    uploaded_by_id    — admin user id (null for seeded entries)
    created_at        — for audit / sort-by-newest

Initial seed populates the 13 assets currently in /web/public/flyer-
assets/* so the registry stays in sync with what's committed to the
repo. New uploads will land in /web/public/flyer-assets/uploads/* in
prod (volume-mounted for persistence).

Revision ID: j0l2n4p6q8s0
Revises: i9k1m3o5q7s9
Create Date: 2026-05-23 11:00:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "j0l2n4p6q8s0"
down_revision: str | None = "i9k1m3o5q7s9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Initial seed — mirrors web/src/lib/flyer/images/registry.ts as of
# 2026-05-23. If you add a new committed asset to the registry TS file,
# add a matching INSERT here (or via a follow-up migration) so a fresh
# DB picks it up. Uploaded-via-admin assets get inserted at runtime.
SEED_ASSETS = [
    # Ornaments
    ("star8", "ornament", "/flyer-assets/ornaments/star8.svg", "1:1",
     ["geometric", "compact", "decorative"]),
    ("arch", "ornament", "/flyer-assets/ornaments/arch.svg", "tall",
     ["architecture", "vertical", "mihrab"]),
    ("lantern", "ornament", "/flyer-assets/ornaments/lantern.svg", "tall",
     ["object", "decorative", "vertical"]),
    ("calligraphy-frame", "ornament",
     "/flyer-assets/ornaments/calligraphy-frame.svg", "wide",
     ["frame", "horizontal", "elegant"]),
    # Patterns
    ("arabesque", "pattern", "/flyer-assets/patterns/arabesque.svg", "1:1",
     ["geometric", "tileable", "calm"]),
    ("dots", "pattern", "/flyer-assets/patterns/dots.svg", "1:1",
     ["minimal", "tileable", "subtle"]),
    ("stars-row", "pattern", "/flyer-assets/patterns/stars-row.svg", "wide",
     ["border", "horizontal", "decorative"]),
    # Photos
    ("mosque-interior", "photo",
     "/flyer-assets/photos/mosque-interior.jpg", "1:1",
     ["mosque", "interior", "warm", "contemplative"]),
    ("mosque-night", "photo", "/flyer-assets/photos/mosque-night.jpg", "1:1",
     ["mosque", "night", "majestic", "dark"]),
    ("quran-open", "photo", "/flyer-assets/photos/quran-open.jpg", "1:1",
     ["quran", "study", "warm", "contemplative"]),
    ("minaret-sky", "photo", "/flyer-assets/photos/minaret-sky.jpg", "1:1",
     ["minaret", "outdoor", "aspirational"]),
    ("dome-interior", "photo", "/flyer-assets/photos/dome-interior.jpg", "1:1",
     ["mosque", "interior", "geometric", "majestic"]),
    ("open-book", "photo", "/flyer-assets/photos/open-book.jpg", "1:1",
     ["book", "study", "warm", "contemplative"]),
]


def upgrade() -> None:
    op.create_table(
        "flyer_assets",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("src", sa.Text(), nullable=False),
        sa.Column("aspect", sa.Text(), nullable=False),
        sa.Column(
            "tags",
            sa.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        # NULL for seeded entries (committed assets); set to the admin's
        # user id for runtime uploads so the audit log + delete-author
        # checks have a paper trail.
        sa.Column(
            "uploaded_by_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "kind IN ('photo', 'ornament', 'pattern')",
            name="flyer_assets_kind_check",
        ),
        sa.CheckConstraint(
            "aspect IN ('1:1', 'wide', 'tall')",
            name="flyer_assets_aspect_check",
        ),
    )
    op.create_index(
        "ix_flyer_assets_kind", "flyer_assets", ["kind"], unique=False,
    )

    # Seed the initial registry.
    bind = op.get_bind()
    for asset_id, kind, src, aspect, tags in SEED_ASSETS:
        bind.execute(
            sa.text(
                "INSERT INTO flyer_assets (id, kind, src, aspect, tags) "
                "VALUES (:id, :kind, :src, :aspect, :tags)"
            ),
            {
                "id": asset_id,
                "kind": kind,
                "src": src,
                "aspect": aspect,
                "tags": tags,
            },
        )


def downgrade() -> None:
    op.drop_index("ix_flyer_assets_kind", table_name="flyer_assets")
    op.drop_table("flyer_assets")
