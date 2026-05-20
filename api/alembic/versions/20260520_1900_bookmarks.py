"""Bookmarks — saved kitab citations, briefs, posts

One table to rule a few save targets. Per the persona audit every
user type wanted "save this for later":

  - Ust. Hakim:    save daleel from /kitab to reuse for khutbah
  - Ibu Sarah:     save articles + ayat for her kajian
  - Mahasiswa:     personal stash of social-justice content
  - Ridwan:        save TT captions that gave him ideas

The `kind` discriminator + the JSONB `payload` keeps the table
flexible. Polymorphic alternatives (one row per target type) would
proliferate tables for marginal type safety.

Unique on (user_id, kind, ref_id) so re-saving the same item is a
no-op rather than a duplicate row. The optional `note` field lets
users annotate why they saved something.

Revision ID: d3f5b6c8a1e4
Revises: c5d7e9f1a3b2
Create Date: 2026-05-20 19:00:00.000000+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "d3f5b6c8a1e4"
down_revision: str | None = "c5d7e9f1a3b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bookmarks",
        sa.Column(
            "id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.String(length=32),
            nullable=False,
        ),
        # ref_id is a free-form opaque identifier per kind:
        #   kitab     → "{corpus}:{citation}" e.g. "quran:QS. Al-Baqarah: 195"
        #   brief     → briefs.id (UUID)
        #   post      → social_posts.id (UUID)
        # We don't FK to those tables because (a) kitab citations have
        # no DB row, (b) we want bookmarks to survive a post/brief
        # delete (they just point at nothing — UI handles gracefully).
        sa.Column("ref_id", sa.String(length=512), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "kind", "ref_id", name="uq_bookmark_user_kind_ref"
        ),
    )
    op.create_index(
        "ix_bookmarks_user_kind_time",
        "bookmarks",
        ["user_id", "kind", sa.text("created_at DESC")],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_bookmarks_user_kind_time", table_name="bookmarks")
    op.drop_table("bookmarks")
