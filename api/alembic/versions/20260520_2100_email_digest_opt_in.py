"""Email digest opt-in on users + unsubscribe token

Two columns on `users`:
  - `email_digest_opt_in` (bool, default false): user has agreed to
    receive the weekly digest. False by default — PDP §22 requires
    explicit consent.
  - `digest_unsubscribe_token` (varchar): random per-user opaque
    token. The unsubscribe link in each email points at
    /api/digest/unsubscribe?token=… so users can opt out in one
    click without needing to log in. Issued on first opt-in.

Idempotent — both ADD COLUMN IF NOT EXISTS.

Revision ID: e5g7h9j1k3l5
Revises: d3f5b6c8a1e4
Create Date: 2026-05-20 21:00:00.000000+00:00
"""
from collections.abc import Sequence

from alembic import op


revision: str = "e5g7h9j1k3l5"
down_revision: str | None = "d3f5b6c8a1e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS email_digest_opt_in BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN IF NOT EXISTS digest_unsubscribe_token VARCHAR(64)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_digest_opt_in "
        "ON users(email_digest_opt_in) WHERE email_digest_opt_in = true"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_digest_unsub_token "
        "ON users(digest_unsubscribe_token) "
        "WHERE digest_unsubscribe_token IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_digest_unsub_token")
    op.execute("DROP INDEX IF EXISTS ix_users_digest_opt_in")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS digest_unsubscribe_token")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_digest_opt_in")
