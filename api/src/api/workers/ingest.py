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
from api.services import billing, ingest_queries, ingest_runs, metrics, trending_topics
from api.workers.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(name="api.workers.ingest.run_ingest", bind=True, max_retries=2)
def run_ingest(
    self,
    platform: str,
    query: str,
    limit: int = 20,
    actor_id: str | None = None,
) -> int:
    """Scrape + classify + upsert one platform. Returns post count.

    `actor_id` overrides the Apify default for the given platform — used
    by the weekly TT paid task to scrape with the richer-metadata actor
    on Mondays while daily runs use the free actor.

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
            n = await ingest_script._run(platform, query, limit, actor_id=actor_id)
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
def rotating_ingest(
    self,
    platform: str,
    limit: int = 20,
    n_keywords: int = 1,
    actor_id: str | None = None,
) -> dict[str, object]:
    """Pick N least-recently-used enabled queries for `platform` and
    dispatch each as a separate `run_ingest` child task.

    Each beat tick picks `n_keywords` from the rotation pool (LRU,
    NULLS FIRST), marks them used immediately so the cursor advances,
    then fans out one `run_ingest.delay(...)` per picked keyword. The
    parent finishes in <1 sec; each child scrape gets its own time
    budget and ingest_runs tracking row.

    Cadence formula (with 49-keyword pool):
      - daily, n=7  → 7-day cycle per keyword (weekly)
      - daily, n=4  → 12-day cycle (≈ biweekly)
      - daily, n=2  → 25-day cycle (≈ monthly)
      - daily, n=1  → 49-day cycle (original behavior)

    Why mark used BEFORE the scrapes run: if a child fails, the failure
    is logged in its own ingest_runs row. We don't want the parent to
    re-pick the same keyword on the next tick just because one child
    failed — that would starve the rest of the rotation. Admin can
    disable a structurally-broken keyword via /admin/system/queries.
    """

    async def _pick_and_mark() -> list[tuple]:
        picked = await ingest_queries.pick_next_queries(platform, n=n_keywords)
        if picked:
            await ingest_queries.mark_used_many([qid for qid, _ in picked])
        return picked

    try:
        picked = asyncio.run(_pick_and_mark())
    except Exception as exc:
        log.exception("rotating_ingest.pick_failed", platform=platform)
        raise self.retry(exc=exc, countdown=300 * (2**self.request.retries)) from exc

    if not picked:
        log.warning("rotating_ingest.no_queries", platform=platform)
        return {"platform": platform, "dispatched": 0, "keywords": []}

    for _, query in picked:
        run_ingest.delay(
            platform=platform, query=query, limit=limit, actor_id=actor_id
        )

    log.info(
        "rotating_ingest.dispatched",
        platform=platform,
        actor_id=actor_id,
        n=len(picked),
        keywords=[q for _, q in picked],
    )
    return {
        "platform": platform,
        "actor_id": actor_id,
        "dispatched": len(picked),
        "keywords": [q for _, q in picked],
    }


@celery_app.task(name="api.workers.ingest.trending_ingest")
def trending_ingest() -> dict[str, object]:
    """Fetch today's trending topics, filter for da'wah-relevance, and
    dispatch ad-hoc scrapes on the surviving keywords.

    Sources:
      - Google Trends Indonesia (search trends)
      - YouTube Data API mostPopular regionCode=ID (video trends)
      - Google News Indonesia RSS (editorial trends)

    Merged + filtered by Gemini Flash-Lite. Each surviving keyword is
    dispatched as a separate `run_ingest.delay(...)` so each scrape gets
    its own time budget (the parent finishes in <1 min regardless of how
    many scrapes fan out).

    Platforms scraped: X (apidojo at ~$0.40/1K) and TikTok
    (clockworks/free-tiktok-scraper at $0). Skipping IG (most expensive
    + 30-day lookback duplicates the weekly curated sweep anyway) and
    YouTube (its own popular-chart fetch is already one of the trending
    signal sources). Budget impact at current limits: ~$1.4/mo extra
    Apify (X only — TT is free).
    """
    PLATFORMS = ("x", "tiktok")
    LIMIT = 20

    keywords = trending_topics.get_trending_keywords()
    if not keywords:
        log.info("trending_ingest.no_keywords")
        return {"keywords": [], "dispatched": 0}

    dispatched = 0
    for platform in PLATFORMS:
        for keyword in keywords:
            run_ingest.delay(platform=platform, query=keyword, limit=LIMIT)
            dispatched += 1

    log.info(
        "trending_ingest.dispatched",
        keywords=keywords,
        platforms=list(PLATFORMS),
        dispatched=dispatched,
    )
    return {
        "keywords": keywords,
        "platforms": list(PLATFORMS),
        "dispatched": dispatched,
    }


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


@celery_app.task(name="api.workers.ingest.reconcile_apify_costs")
def reconcile_apify_costs() -> dict[str, object]:
    """Pull Apify's authoritative monthly bill and write a delta row.

    Closes the gap between per-run `usageTotalUsd` (which lags + skips
    failed runs + rounds small runs to $0) and the real dashboard total.
    Idempotent — re-runs the same day are no-ops.
    """
    try:
        return asyncio.run(billing.reconcile_apify_monthly())
    except Exception:
        log.exception("billing.reconcile_failed")
        return {"error": "reconcile_failed"}


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
