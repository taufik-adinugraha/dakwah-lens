"""DB-level defaults on users.status + users.role

Without these defaults, NextAuth's DrizzleAdapter (which creates the
Google OAuth user row directly, bypassing our own signupAction) emits
an INSERT that omits both columns. Drizzle's schema has TS-level
defaults ('pending' and 'user'), but those only fire when our own code
does the insert. The adapter does not. Result: NOT NULL violation
(23502) on first Google sign-in.

Adding the defaults at the column level makes the schema correct
regardless of who inserts. Idempotent — re-running just resets to the
same value.

Revision ID: f0a3c5d7e2b1
Revises: e6f1a82c4d09
Create Date: 2026-05-19 21:00:00.000000+00:00
"""
from collections.abc import Sequence

from alembic import op

revision: str = 'f0a3c5d7e2b1'
down_revision: str | None = 'e6f1a82c4d09'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ALTER COLUMN status SET DEFAULT 'pending'")
    op.execute("ALTER TABLE users ALTER COLUMN role   SET DEFAULT 'user'")


def downgrade() -> None:
    op.execute("ALTER TABLE users ALTER COLUMN status DROP DEFAULT")
    op.execute("ALTER TABLE users ALTER COLUMN role   DROP DEFAULT")
