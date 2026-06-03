"""social_posts: add theme_group column for Gemini-judged 14-group classification.

Replaces the read-time chain `post.topic_id → topic.label →
classify_theme_group(label) [regex]` with a column populated at INGEST
time by the same Gemini Flash-Lite call that already tags sentiment +
the 9 PRD da'wah categories (`services.relevance.classify_batch`).
Piggybacking on the existing call means the marginal cost is just ~10
output tokens per post (a single extra field in the response schema) —
no new call, no new round-trip.

Why this replaces the regex: the regex matched surface keywords
(e.g. `kurban` caught "Polemik Sapi Kurban Presiden" → Aqidah &
Ibadah even though it's a political-accountability story) and missed
labels with no matching tokens ("Peringatan Hari Lahir Pancasila",
"Fenomena Api Misterius di Sleman"). Gemini reads the post text
semantically and routes correctly.

Nullable (no default) so old rows surface as NULL until the backfill
runs. Read paths fall back to the old regex when this column is NULL,
so the migration is non-breaking.

Indexed because the briefing pipeline + dashboard chart bucket posts
by theme_group + posted_at, and an index lookup beats a sequential
scan over 28k+ rows.

Revision ID: f1a3c5e7g9j1
Revises: e3f5g7h9i1k3
Create Date: 2026-06-03 21:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op


revision = "f1a3c5e7g9j1"
down_revision = "e3f5g7h9i1k3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "social_posts",
        sa.Column("theme_group", sa.Text(), nullable=True),
    )
    # Composite index on (theme_group, posted_at DESC) — matches the
    # exact predicate the briefing pipeline + dashboard chart use:
    # "posts in this group from the last 7d, newest first". Partial
    # WHERE clause keeps the index small (NULL rows are excluded
    # since they're not bucketed yet).
    op.create_index(
        "ix_social_posts_theme_group_posted_at",
        "social_posts",
        ["theme_group", sa.text("posted_at DESC")],
        unique=False,
        postgresql_where=sa.text("theme_group IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_social_posts_theme_group_posted_at", table_name="social_posts"
    )
    op.drop_column("social_posts", "theme_group")
