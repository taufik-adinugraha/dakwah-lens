"""Lifecycle tracking for ingest tasks.

The Celery `run_ingest` and `recluster_all` tasks bracket their work with:

    run_id = await start_run(task_name, platform=...)
    try:
        ...
        await finish_run(run_id, status="success", items_scraped=N, ...)
    except Exception as e:
        await finish_run(run_id, status="failed", error=str(e))
        raise

The result is one `ingest_runs` row per task invocation. The admin
'Pipeline health' tab tails these — most recent N, plus aggregate
success-rate per platform over the last 7 days.

Both functions are async — call from async code or wrap with `asyncio.run`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import structlog

from api.db import SessionLocal
from api.models.admin import IngestRun

log = structlog.get_logger()


async def start_run(
    task_name: str,
    *,
    platform: str | None = None,
    query: str | None = None,
) -> UUID:
    """Open an `ingest_runs` row in `status=running`. Returns the new row's
    UUID — caller passes it to `finish_run()` to close the lifecycle.

    `query` records the search keyword for `run_ingest` rows so dead /
    zero-yield queries are traceable from the run history. Pass None
    for parent-level rows (rotating_ingest, trending_ingest,
    youtube_channels_ingest) and for `run_ingest mainstream` (fixed RSS
    list, no query).
    """
    async with SessionLocal() as session:
        # `datetime.now(UTC)` not `utcnow()` — utcnow returns a naive
        # datetime that PG (with session TZ=Asia/Jakarta) re-interprets
        # as local time, double-converting and storing the value 7
        # hours off. Pass a tz-aware datetime instead.
        run = IngestRun(
            task_name=task_name,
            platform=platform,
            query=(query[:160] if query else None),  # match column length
            status="running",
            started_at=datetime.now(UTC),
        )
        session.add(run)
        await session.commit()
        return run.id


async def finish_run(
    run_id: UUID,
    *,
    status: str,
    items_scraped: int | None = None,
    items_stored: int | None = None,
    cost_usd: float | None = None,
    error: str | None = None,
) -> None:
    from sqlalchemy import update

    async with SessionLocal() as session:
        await session.execute(
            update(IngestRun)
            .where(IngestRun.id == run_id)
            .values(
                status=status,
                finished_at=datetime.now(UTC),
                items_scraped=items_scraped,
                items_stored=items_stored,
                cost_usd=cost_usd,
                error=(error[:1000] if error else None),
            )
        )
        await session.commit()
