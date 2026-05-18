"""uuid server defaults

Adds `DEFAULT gen_random_uuid()` to UUID primary-key columns so that
non-SQLAlchemy clients (Drizzle, raw SQL) can insert rows without
providing an explicit `id`. Postgres 13+ has `gen_random_uuid()` built-in.

Revision ID: 870d08fc74cb
Revises: 26582f0b8f5b
Create Date: 2026-05-17 10:01:48.641515+00:00
"""
from collections.abc import Sequence

from alembic import op

revision: str = "870d08fc74cb"
down_revision: str | None = "26582f0b8f5b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("users", "accounts", "organizations", "org_members")


def upgrade() -> None:
    for table in TABLES:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN id SET DEFAULT gen_random_uuid()"
        )


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN id DROP DEFAULT")
