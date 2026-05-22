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
from datetime import UTC, datetime, timedelta

import structlog

from api.scripts import cluster_topics
from api.scripts import ingest as ingest_script
from api.services import (
    billing,
    email_digest,
    ingest_queries,
    ingest_runs,
    insights_summary,
    metrics,
    trending_topics,
)
from api.workers.celery_app import celery_app

log = structlog.get_logger()


@celery_app.task(name="api.workers.ingest.run_ingest", bind=True, max_retries=2)
def run_ingest(
    self,
    platform: str,
    query: str,
    limit: int = 20,
    actor_id: str | None = None,
    channel_id: str | None = None,
) -> int:
    """Scrape + classify + upsert one platform. Returns post count.

    `actor_id` overrides the Apify default for the given platform — used
    by the weekly TT paid task to scrape with the richer-metadata actor
    on Mondays while daily runs use the free actor.

    `channel_id` (YouTube only) routes this task through the curated
    playlistItems.list path instead of keyword search.list — 100×
    cheaper on YT quota. `query` becomes a display name in that path.

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
            n = await ingest_script._run(
                platform,
                query,
                limit,
                actor_id=actor_id,
                channel_id=channel_id,
            )
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
        log.exception(
            "ingest.task_failed",
            platform=platform,
            query=query,
            channel_id=channel_id,
        )
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


@celery_app.task(
    name="api.workers.ingest.youtube_channels_ingest",
    bind=True,
    max_retries=2,
)
def youtube_channels_ingest(self, limit: int = 50) -> dict[str, object]:
    """Iterate enabled `youtube_channels` and fan out one `run_ingest`
    child per channel via the playlistItems.list (uploads) path.

    At 1 quota unit per channel and ~80 channels, the whole sweep costs
    ~80 units/day — under 1% of the YT API free tier. We mark
    `last_run_at` after dispatch (parent), not after each child finishes
    — same rationale as the keyword rotator: a failing child shouldn't
    starve the rest of the curated whitelist.
    """
    from sqlalchemy import select, update

    from api.db import SessionLocal
    from api.models.admin import YoutubeChannel

    async def _pick_and_mark() -> list[tuple[str, str]]:
        async with SessionLocal() as session:
            res = await session.execute(
                select(
                    YoutubeChannel.id,
                    YoutubeChannel.channel_id,
                    YoutubeChannel.name,
                ).where(YoutubeChannel.enabled.is_(True))
            )
            rows = list(res.all())
            if not rows:
                return []
            await session.execute(
                update(YoutubeChannel)
                .where(YoutubeChannel.id.in_([r[0] for r in rows]))
                .values(last_run_at=datetime.now(UTC))
            )
            await session.commit()
            return [(r[1], r[2]) for r in rows]

    try:
        picked = asyncio.run(_pick_and_mark())
    except Exception as exc:
        log.exception("youtube_channels_ingest.pick_failed")
        raise self.retry(exc=exc, countdown=300 * (2**self.request.retries)) from exc

    if not picked:
        log.warning("youtube_channels_ingest.no_channels")
        return {"dispatched": 0, "channels": []}

    for channel_id, channel_name in picked:
        run_ingest.delay(
            platform="youtube",
            query=channel_name,
            limit=limit,
            channel_id=channel_id,
        )

    log.info(
        "youtube_channels_ingest.dispatched",
        n=len(picked),
        channels=[c[1] for c in picked],
    )
    return {
        "dispatched": len(picked),
        "channels": [c[1] for c in picked],
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

    Platforms scraped: X (apidojo at $0.0004/item). Skipping IG (most
    expensive + 30-day lookback duplicates the weekly curated sweep
    anyway) and YouTube (its own popular-chart fetch is already one of
    the trending signal sources). TikTok was here too but dropped
    2026-05-20 — TT is fully disabled until we make a product decision,
    and the "free" actor isn't free ($0.004/item). Budget impact:
    ~$0.1/mo Apify, ~3-5 trending keywords/day × $0.0004 × 20 items.
    """
    PLATFORMS = ("x",)
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
def recluster_all() -> dict[str, int]:
    """Re-run Gemini topic discovery on every platform that has enough posts.

    Idempotent — each run truncates the platform's topics and writes
    fresh ones from the most recent corpus.
    """

    async def _runner() -> dict[str, int]:
        out: dict[str, int] = {}
        for platform in await cluster_topics._list_platforms_with_data():
            run_id = await ingest_runs.start_run(
                task_name="recluster_all", platform=platform
            )
            try:
                n = await cluster_topics._run(platform)
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


@celery_app.task(name="api.workers.ingest.send_weekly_digest")
def send_weekly_digest() -> dict[str, object]:
    """Send the weekly insights digest to every opted-in user.

    Runs Sunday 18:00 WIB via Celery beat. Uses the most-recent row
    of `insights_summaries` as the body. Free up to 3K emails/month
    via Resend.
    """
    try:
        result = asyncio.run(email_digest.send_weekly_digests())
        return result or {"skipped": True}
    except Exception:
        log.exception("email_digest.failed")
        return {"error": "send_failed"}


@celery_app.task(name="api.workers.ingest.generate_insights_summary")
def generate_insights_summary() -> dict[str, object]:
    """Generate all 5 daily executive briefings for /insights.

    1 all-platform briefing + 4 per-segment (spiritual / family /
    youth / justice). Each briefing now grounds its `daleel` paragraph
    in passages retrieved from Qdrant — the LLM is constrained to cite
    only those (PRD §12).

    Runs at 04:30 WIB — right after the 04:00 Gemini topic-discovery
    pass so the LLM sees the freshest theme labels. Five Gemini 2.5
    Pro calls + five OpenAI embedding calls, ~$0.10-0.30 per run total.
    """
    try:
        result = asyncio.run(insights_summary.generate_all_summaries())
        return result
    except Exception:
        log.exception("insights_summary.failed")
        return {"error": "generate_failed"}


@celery_app.task(name="api.workers.ingest.retry_failed_sentiment")
def retry_failed_sentiment() -> dict[str, int]:
    """Re-classify mainstream posts whose sentiment label is NULL.

    These rows result from sustained Gemini 5xx outages that exhausted
    the in-line retry budget inside `news_sentiment._classify_chunk`.
    Rather than burning $0.09 on a full reclean we just pick up the
    stragglers — usually 0-25 rows after each ingest tick.

    Scoped to the last 14 days so a backlog from an old outage doesn't
    grow unbounded. Caps at 200 rows per run so a worst-case batch
    can't blow our Gemini-per-minute quota.

    Schedule: every 2h offset 1h from the RSS ingest (so 01:00, 03:00
    … WIB). The offset means an RSS-induced 503 has a full hour to
    recover before we try the failed rows again.
    """
    from sqlalchemy import and_, select, update

    from api.db import SessionLocal
    from api.models.social import SocialPost
    from api.services.news_sentiment import (
        classify_batch as classify_news_sentiment,
    )

    cutoff = datetime.now(UTC) - timedelta(days=14)

    async def _runner() -> dict[str, int]:
        async with SessionLocal() as session:
            rows = (
                await session.execute(
                    select(SocialPost.id, SocialPost.text)
                    .where(
                        and_(
                            SocialPost.platform == "mainstream",
                            SocialPost.sentiment_label.is_(None),
                            SocialPost.text.is_not(None),
                            SocialPost.posted_at >= cutoff,
                        )
                    )
                    .order_by(SocialPost.posted_at.desc().nulls_last())
                    .limit(200)
                )
            ).all()

            if not rows:
                log.info("retry_failed_sentiment.nothing_to_do")
                return {"checked": 0, "relabeled": 0, "still_failed": 0}

            ids = [r.id for r in rows]
            texts = [r.text or "" for r in rows]
            scored = classify_news_sentiment(texts)

            relabeled = 0
            still_failed = 0
            for post_id, s in zip(ids, scored, strict=False):
                if s is None:
                    still_failed += 1
                    # Leave label NULL — next cron tick retries.
                    continue
                await session.execute(
                    update(SocialPost)
                    .where(SocialPost.id == post_id)
                    .values(
                        sentiment_label=s.label,
                        sentiment_score=s.score,
                    )
                )
                relabeled += 1
            await session.commit()

            log.info(
                "retry_failed_sentiment.done",
                checked=len(rows),
                relabeled=relabeled,
                still_failed=still_failed,
            )
            return {
                "checked": len(rows),
                "relabeled": relabeled,
                "still_failed": still_failed,
            }

    try:
        return asyncio.run(_runner())
    except Exception:
        log.exception("retry_failed_sentiment.failed")
        return {"checked": 0, "relabeled": 0, "still_failed": 0}


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
