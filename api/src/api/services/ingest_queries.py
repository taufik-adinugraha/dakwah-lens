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
    res = await pick_next_queries(platform, n=1)
    return res[0] if res else None


async def pick_next_queries(platform: str, n: int = 1) -> list[tuple[UUID, str]]:
    """Return up to N least-recently-used enabled queries for `platform`.

    Used by the cadence-tuned beat schedule: e.g. YT/X daily with n=7
    gives a 7-day rotation cycle across the ~49-keyword pool, TT daily
    with n=4 gives ~12-day, IG daily with n=2 gives ~25-day. n=1 keeps
    the original single-keyword-per-tick behavior.
    """
    if n <= 0:
        return []
    async with SessionLocal() as session:
        res = await session.execute(
            select(IngestQuery.id, IngestQuery.query)
            .where(IngestQuery.platform == platform)
            .where(IngestQuery.enabled.is_(True))
            .order_by(asc(IngestQuery.last_run_at).nulls_first())
            .limit(n)
        )
        return [(row[0], row[1]) for row in res.all()]


async def mark_used(query_id: UUID) -> None:
    """Stamp `last_run_at = now()` so this query falls to the back of the
    rotation queue. Called after a scrape completes regardless of result
    count — failed/empty runs still consume their turn."""
    await mark_used_many([query_id])


async def mark_used_many(query_ids: list[UUID]) -> None:
    """Batch variant of `mark_used` — single UPDATE for N ids. Used when
    the beat task picks multiple keywords per tick so we don't issue N
    separate UPDATEs."""
    if not query_ids:
        return
    async with SessionLocal() as session:
        await session.execute(
            update(IngestQuery)
            .where(IngestQuery.id.in_(query_ids))
            .values(last_run_at=datetime.utcnow())
        )
        await session.commit()
