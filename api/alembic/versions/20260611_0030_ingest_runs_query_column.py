"""Add `query` column to ingest_runs for per-query yield attribution.

After the 2026-06-08 weekly X scrape showed 64% zero-yield queries (51 of
79), we couldn't identify WHICH queries returned 0 because the run rows
only stored task_name + platform, not the source query. Adding a
nullable text column + index so future runs are traceable per-query.

Pre-existing rows stay NULL (we can't reconstruct historical attribution).

Revision ID: b1d2e3f4a5b6
Revises: a7c9d0e1f2g3
Create Date: 2026-06-11 00:30:00.000000
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b1d2e3f4a5b6"
down_revision: str | None = "a7c9d0e1f2g3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable — existing rows stay NULL; new rows fill it. String(160)
    # matches ingest_queries.query column so we don't truncate.
    op.add_column(
        "ingest_runs",
        sa.Column("query", sa.String(length=160), nullable=True),
    )
    # Index for the admin panel "dead queries" query: filter by
    # (task_name, platform, query) over a date window. Partial index on
    # non-null only — most rows are parent/mainstream with NULL query.
    op.create_index(
        "ix_ingest_runs_query",
        "ingest_runs",
        ["query"],
        postgresql_where=sa.text("query IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_ingest_runs_query", table_name="ingest_runs")
    op.drop_column("ingest_runs", "query")
