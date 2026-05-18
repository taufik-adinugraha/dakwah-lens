"""Celery tasks: scheduled ingest + topic re-clustering + host metrics.

These wrappers re-use the same logic as the `api.scripts.ingest` and
`api.scripts.cluster_topics` CLIs — we just expose them as Celery tasks so
beat can fire them on a schedule. Keep them thin; if you find yourself
adding non-trivial logic here, prefer extending the script module instead.

Each ingest run brackets itself with `ingest_runs.start_run` / `finish_run`
so the superadmin Pipeline-health tab has a per-run timeline (success/fail,
items scraped, duration, error).
"""

from __future__ import annotations

import asyncio

import structlog

from api.scripts import cluster_topics
from api.scripts import ingest as ingest_script
from api.services import ingest_queries, ingest_runs, metrics
from api.workers.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(name="api.workers.ingest.run_ingest", bind=True, max_retries=2)
def run_ingest(self, platform: str, query: str, limit: int = 20) -> int:
    """Scrape + classify + upsert one platform. Returns post count.

    Errors auto-retry with exponential backoff. Most failures we've seen are
    transient (Apify rate-limit, RSS outlet 5xx, Gemini quota) and resolve
    on the next attempt; permanent ones (missing API key, bad query) will
    just retry twice and then give up — beat will fire again on the next
    schedule tick anyway.
    """

    async def _runner() -> int:
        run_id = await ingest_runs.start_run(
            task_name="run_ingest", platform=platform
        )
        try:
            n = await ingest_script._run(platform, query, limit)
            await ingest_runs.finish_run(
                run_id, status="success", items_stored=n, items_scraped=n
            )
            return n
        except Exception as exc:
            await ingest_runs.finish_run(
                run_id, status="failed", error=str(exc)
            )
            raise

    try:
        return asyncio.run(_runner())
    except Exception as exc:
        log.exception("ingest.task_failed", platform=platform, query=query)
        raise self.retry(exc=exc, countdown=300 * (2**self.request.retries)) from exc


@celery_app.task(
    name="api.workers.ingest.rotating_ingest", bind=True, max_retries=2
)
def rotating_ingest(self, platform: str, limit: int = 20) -> int:
    """Pick the least-recently-used enabled query for `platform` and run it.

    This is what the social-media beat schedule fires — instead of pinning
    a single hardcoded keyword (`#dakwah` etc.) per platform, we rotate
    through the `ingest_queries` table so the corpus reflects the team's
    actual editorial choices and broadens past the religious bubble.

    The original `run_ingest(platform, query, limit)` task is still around
    for manual / CLI use.
    """

    async def _runner() -> int:
        picked = await ingest_queries.pick_next_query(platform)
        if picked is None:
            log.warning("rotating_ingest.no_queries", platform=platform)
            return 0
        query_id, query = picked
        run_id = await ingest_runs.start_run(
            task_name="rotating_ingest", platform=platform
        )
        try:
            n = await ingest_script._run(platform, query, limit)
            await ingest_runs.finish_run(
                run_id, status="success", items_stored=n, items_scraped=n
            )
            await ingest_queries.mark_used(query_id)
            return n
        except Exception as exc:
            await ingest_runs.finish_run(
                run_id, status="failed", error=str(exc)
            )
            # Still mark used — a failed query shouldn't block the rotation
            # forever. If it's structurally broken, admin can disable it.
            await ingest_queries.mark_used(query_id)
            raise

    try:
        return asyncio.run(_runner())
    except Exception as exc:
        log.exception("rotating_ingest.task_failed", platform=platform)
        raise self.retry(exc=exc, countdown=300 * (2**self.request.retries)) from exc


@celery_app.task(name="api.workers.ingest.recluster_all")
def recluster_all(min_cluster: int = 5) -> dict[str, int]:
    """Re-fit BERTopic on every platform that has enough posts. Idempotent."""

    async def _runner() -> dict[str, int]:
        out: dict[str, int] = {}
        for platform in await cluster_topics._list_platforms_with_data():
            run_id = await ingest_runs.start_run(
                task_name="recluster_all", platform=platform
            )
            try:
                n = await cluster_topics._run(platform, min_cluster)
                out[platform] = n
                await ingest_runs.finish_run(
                    run_id, status="success", items_stored=n
                )
            except Exception as exc:
                await ingest_runs.finish_run(
                    run_id, status="failed", error=str(exc)
                )
                log.exception("recluster.failed", platform=platform)
        return out

    return asyncio.run(_runner())


@celery_app.task(name="api.workers.ingest.snapshot_system")
def snapshot_system() -> None:
    """Capture one psutil snapshot. Fired by beat every minute.

    Quiet by design — no logs when it succeeds. Failures (rare; this is
    100% local syscalls) get logged but don't retry: we'd rather miss one
    sample than queue up failures.
    """
    try:
        asyncio.run(metrics.persist_snapshot())
    except Exception:
        log.exception("metrics.snapshot_failed")
