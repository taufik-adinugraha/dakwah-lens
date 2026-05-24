"""Discussion continuity: visitor token + email opt-in subscribers.

Two complementary additions for /m/{slug} room continuity:

  1. `mahasiswa_comments.visitor_token_hash`
     — SHA-256 of an opaque anonymous UUID stored in an httpOnly
       cookie. Lets us count "unique visitors" across IP / UA changes
       without persisting any PII. The cookie is set on first comment
       and lives ~1 year; cleared by clearing cookies (the user is in
       control).

  2. New table `mahasiswa_subscribers`
     — One row per (room, opted-in email). Powers admin-action
       notifications: when an admin posts a reply or "let's meet
       offline" pin, the platform emails every opted-in participant
       (throttled to 1 email per 24h per recipient per room).
       UNIQUE (briefing_slug, email_normalized) lets us
       ON CONFLICT DO UPDATE to gracefully handle re-subscribes.

Privacy stance: emails are stored plain so we can send to them.
Each subscriber row gets a single-use-style `unsubscribe_token`
(base64url, 32 bytes of entropy). Every notification email includes
the unsubscribe URL.

Revision ID: u7y9a1c3e5g7
Revises: t5y7a9c1d3e5
Create Date: 2026-05-24 03:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "u7y9a1c3e5g7"
down_revision = "t5y7a9c1d3e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- 1) visitor_token_hash on comments ---
    op.add_column(
        "mahasiswa_comments",
        sa.Column("visitor_token_hash", sa.String(64), nullable=True),
    )
    op.create_index(
        "ix_mahasiswa_comments_visitor_time",
        "mahasiswa_comments",
        ["visitor_token_hash", "created_at"],
    )

    # --- 2) mahasiswa_subscribers ---
    op.create_table(
        "mahasiswa_subscribers",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("briefing_slug", sa.String(64), nullable=False),
        sa.Column(
            "comment_id",
            UUID(as_uuid=True),
            nullable=True,
            comment="The comment row this opt-in came in with. Nullable in "
            "case we ever offer subscribe-without-comment.",
        ),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column(
            "email_normalized",
            sa.String(255),
            nullable=False,
            comment="Lowercased + trimmed form used for uniqueness checks.",
        ),
        sa.Column("unsubscribe_token", sa.String(64), nullable=False),
        sa.Column(
            "subscribed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "unsubscribed_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Set when the user clicks the unsubscribe link. "
            "Notification senders treat non-null as 'do not email'.",
        ),
        sa.Column(
            "last_notified_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="Used by the per-recipient throttle (1 email / 24h "
            "/ (slug, email)).",
        ),
        sa.UniqueConstraint(
            "briefing_slug",
            "email_normalized",
            name="uq_mahasiswa_subscribers_slug_email",
        ),
        sa.UniqueConstraint(
            "unsubscribe_token",
            name="uq_mahasiswa_subscribers_unsub_token",
        ),
    )
    op.create_index(
        "ix_mahasiswa_subscribers_slug_active",
        "mahasiswa_subscribers",
        ["briefing_slug"],
        postgresql_where=sa.text("unsubscribed_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_mahasiswa_subscribers_slug_active",
        table_name="mahasiswa_subscribers",
    )
    op.drop_table("mahasiswa_subscribers")
    op.drop_index(
        "ix_mahasiswa_comments_visitor_time",
        table_name="mahasiswa_comments",
    )
    op.drop_column("mahasiswa_comments", "visitor_token_hash")
