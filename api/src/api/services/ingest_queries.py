"""Keyword rotation for the social-media scrapers.

The Celery rotating-ingest task calls `pick_next_query(platform)` on every
beat tick. We return the **least-recently-used enabled query** for that
platform — ensuring every keyword in the table gets a turn over the week
rather than always hitting the same one.

`mark_used` is called after the scrape completes so the rotation pointer
advances. Rotation is in-database (last_run_at column), not in-memory,
so a worker restart doesn't reset the cursor.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import structlog
from sqlalchemy import asc, select, update

from api.db import SessionLocal
from api.models.admin import IngestQuery

log = structlog.get_logger()


async def pick_next_query(platform: str) -> tuple[UUID, str] | None:
    """Return (id, query) for the least-recently-used enabled query on this
    platform, or None if no enabled queries exist.

    NULL `last_run_at` sorts first (NULLS FIRST) so freshly-added queries
    get an immediate first run before falling into the rotation.
    """
    async with SessionLocal() as session:
        res = await session.execute(
            select(IngestQuery.id, IngestQuery.query)
            .where(IngestQuery.platform == platform)
            .where(IngestQuery.enabled.is_(True))
            .order_by(asc(IngestQuery.last_run_at).nulls_first())
            .limit(1)
        )
        row = res.first()
        if row is None:
            return None
        return row[0], row[1]


async def mark_used(query_id: UUID) -> None:
    """Stamp `last_run_at = now()` so this query falls to the back of the
    rotation queue. Called after a scrape completes regardless of result
    count — failed/empty runs still consume their turn."""
    async with SessionLocal() as session:
        await session.execute(
            update(IngestQuery)
            .where(IngestQuery.id == query_id)
            .values(last_run_at=datetime.utcnow())
        )
        await session.commit()
