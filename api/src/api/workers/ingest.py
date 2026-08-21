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
    briefing,
    email_digest,
    ingest_queries,
    ingest_runs,
    metrics,
    trending_topics,
)
from api.services.pipeline_flags import is_task_enabled
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
    youtube_search: bool = False,
) -> int:
    """Scrape + classify + upsert one platform. Returns post count.

    `actor_id` overrides the Apify default for the given platform — used
    by the weekly TT paid task to scrape with the richer-metadata actor
    on Mondays while daily runs use the free actor.

    `channel_id` (YouTube only) routes this task through the curated
    playlistItems.list path instead of keyword search.list — 100×
    cheaper on YT quota. `query` becomes a display name in that path.

    `youtube_search=True` (YouTube only) routes through the unbounded
    keyword `search.list` path used by the trending pipeline — NOT
    channel-bounded, with a langdetect gate restored in the scraper.

    Errors auto-retry with exponential backoff. Most failures we've seen are
    transient (Apify rate-limit, RSS outlet 5xx, Gemini quota) and resolve
    on the next attempt; permanent ones (missing API key, bad query) will
    just retry twice and then give up — beat will fire again on the next
    schedule tick anyway.
    """
    # Kill-switch ONLY for the direct-from-beat mainstream invocation
    # (no channel_id, no youtube_search, no actor override → this isn't
    # a fan-out child from rotating_ingest / youtube_channels_ingest /
    # trending_ingest, all of which have their own kill switch upstream
    # and pass these args). Disabling the mainstream toggle in the admin
    # UI must NOT silently block fan-out children.
    is_direct_mainstream_beat = (
        platform == "mainstream"
        and channel_id is None
        and not youtube_search
        and actor_id is None
    )
    if is_direct_mainstream_beat and not is_task_enabled("run_ingest", "mainstream"):
        log.info("pipeline.disabled", task="run_ingest", platform="mainstream")
        return 0

    async def _runner() -> int:
        # Record the query text on the run row so per-query yield is
        # traceable from history (added 2026-06-11). Mainstream RSS
        # doesn't use a query — pass None there. Empty/whitespace
        # query → also None so SQL filters don't see empty strings.
        run_query = (
            (query or "").strip() if platform != "mainstream" else None
        ) or None
        run_id = await ingest_runs.start_run(
            task_name="run_ingest", platform=platform, query=run_query
        )
        try:
            n = await ingest_script._run(
                platform,
                query,
                limit,
                actor_id=actor_id,
                channel_id=channel_id,
                youtube_search=youtube_search,
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
    if not is_task_enabled("rotating_ingest", platform):
        log.info("pipeline.disabled", task="rotating_ingest", platform=platform)
        return {"disabled": True, "dispatched": 0, "platform": platform}

    # Parent-level ingest_runs row so the /admin/system/pipeline UI can
    # distinguish "this weekly schedule fired" from "trending_ingest's
    # daily fan-out for the same platform fired". The fan-out children
    # below ALSO log their own per-keyword ingest_runs row (task_name
    # = "run_ingest") — both layers are useful: parent for schedule
    # health, children for per-keyword scrape outcome.
    async def _runner() -> dict[str, object]:
        run_id = await ingest_runs.start_run(
            task_name="rotating_ingest", platform=platform
        )
        try:
            picked = await ingest_queries.pick_next_queries(platform, n=n_keywords)
            if picked:
                await ingest_queries.mark_used_many([qid for qid, _ in picked])
            await ingest_runs.finish_run(
                run_id, status="success", items_stored=len(picked)
            )
            return {"picked": picked, "run_id": str(run_id)}
        except Exception as exc:
            await ingest_runs.finish_run(
                run_id, status="failed", error=str(exc)
            )
            raise

    try:
        result = asyncio.run(_runner())
    except Exception as exc:
        log.exception("rotating_ingest.pick_failed", platform=platform)
        raise self.retry(exc=exc, countdown=300 * (2**self.request.retries)) from exc

    picked = result["picked"]
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
    """Iterate enabled + VERIFIED `youtube_channels` and fan out one
    `run_ingest` child per channel via the playlistItems.list (uploads)
    path.

    Verified filter (2026-05-23): channels enter the pipeline only after
    an admin confirms the channel via the /admin/system/youtube-channels
    "Verify" button (which round-trips through channels.list). The seed
    script's top-1 search.list match was wrong for ambiguous names —
    e.g. "dr Sung" → "Justin Sung" instead of an Indonesian Dr Sung.
    Without the verify gate, those wrong channels would have polluted
    the ingest.

    At 1 quota unit per channel and ~80 channels, the whole sweep costs
    ~80 units/day — under 1% of the YT API free tier. We mark
    `last_run_at` after dispatch (parent), not after each child finishes
    — same rationale as the keyword rotator: a failing child shouldn't
    starve the rest of the curated whitelist.
    """
    if not is_task_enabled("youtube_channels_ingest", "all"):
        log.info("pipeline.disabled", task="youtube_channels_ingest")
        return {"disabled": True, "dispatched": 0, "channels": []}

    from sqlalchemy import select, update

    from api.db import SessionLocal
    from api.models.admin import YoutubeChannel

    # Parent-level ingest_runs row — see the rotating_ingest comment.
    # platform="all" mirrors the schedule's beatPlatform in the admin
    # BEAT_SCHEDULE (and the kill-switch key) so the pipeline UI can
    # match (youtube_channels_ingest, all) cleanly.
    async def _runner() -> list[tuple[str, str]]:
        run_id = await ingest_runs.start_run(
            task_name="youtube_channels_ingest", platform="all"
        )
        try:
            async with SessionLocal() as session:
                res = await session.execute(
                    select(
                        YoutubeChannel.id,
                        YoutubeChannel.channel_id,
                        YoutubeChannel.name,
                    )
                    .where(YoutubeChannel.enabled.is_(True))
                    .where(YoutubeChannel.verified.is_(True))
                )
                rows = list(res.all())
                if not rows:
                    await ingest_runs.finish_run(
                        run_id, status="success", items_stored=0
                    )
                    return []
                await session.execute(
                    update(YoutubeChannel)
                    .where(YoutubeChannel.id.in_([r[0] for r in rows]))
                    .values(last_run_at=datetime.now(UTC))
                )
                await session.commit()
            await ingest_runs.finish_run(
                run_id, status="success", items_stored=len(rows)
            )
            return [(r[1], r[2]) for r in rows]
        except Exception as exc:
            await ingest_runs.finish_run(
                run_id, status="failed", error=str(exc)
            )
            raise

    try:
        picked = asyncio.run(_runner())
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

    Platforms scraped per keyword:
      • X — apidojo at $0.0004/item, 100 items/keyword. Budget at ~8
        keywords/day: ~$0.32/day ≈ $9.6/mo.
      • YouTube — unbounded `search.list` keyword search (free YouTube
        Data API, 100 quota units/call), 25 items/keyword. This is the
        UNBOUNDED-by-channel counterpart to the weekly whitelist uploads
        sweep: weekly = trusted da'i voices, trending = whatever da'wah-
        relevant content is spiking. The mostPopular-ID chart is still
        only a keyword *signal* source (above); here we actually ingest
        the matching videos. ~8 keywords/day × ~101 units ≈ 800 units/day,
        well inside the 10K/day free tier.

    Skipping IG (most expensive + 30-day lookback duplicates the weekly
    curated sweep) and TikTok (disabled pending a product decision; the
    "free" actor isn't free at $0.004/item). The relevance filter upstream
    keeps keyword count to the dakwah-signal subset (~8/day observed).
    """
    if not is_task_enabled("trending_ingest", "all"):
        log.info("pipeline.disabled", task="trending_ingest")
        return {"disabled": True, "keywords": [], "dispatched": 0}

    # Per-keyword caps. X stays at 100 (held steady 2026-06-14 alongside
    # the kw count bump 8 → 20) — at 2.5× the keyword count, monthly
    # Apify spend ~triples without re-bumping per-keyword depth.
    # YouTube: `search_youtube_videos` now paginates (added 2026-06-14)
    # in 50-result chunks. Bumped 25 → 200 (2026-06-14): 20 kw × 4 calls
    # × 100 units = 8000 units/day, ~80% of the 10K free-tier quota,
    # leaves ~2K headroom for the weekly channel-uploads sweep.
    X_LIMIT = 100
    YT_LIMIT = 200

    # Parent-level ingest_runs row — see the rotating_ingest comment.
    # platform="all" mirrors the schedule's beatPlatform in the admin
    # BEAT_SCHEDULE so the pipeline UI matches (trending_ingest, all)
    # against this parent row rather than the run_ingest fan-out
    # children (which would also match for platform = x or youtube
    # alone — exactly the conflation we're fixing).
    async def _runner() -> tuple[list[str], int]:
        run_id = await ingest_runs.start_run(
            task_name="trending_ingest", platform="all"
        )
        try:
            kw = trending_topics.get_trending_keywords()
            await ingest_runs.finish_run(
                run_id,
                status="success",
                items_stored=len(kw) * 2 if kw else 0,
            )
            return kw, len(kw) * 2 if kw else 0
        except Exception as exc:
            await ingest_runs.finish_run(
                run_id, status="failed", error=str(exc)
            )
            raise

    try:
        keywords, _ = asyncio.run(_runner())
    except Exception:
        log.exception("trending_ingest.keyword_fetch_failed")
        return {"keywords": [], "dispatched": 0}

    if not keywords:
        log.info("trending_ingest.no_keywords")
        return {"keywords": [], "dispatched": 0}

    dispatched = 0
    for keyword in keywords:
        run_ingest.delay(platform="x", query=keyword, limit=X_LIMIT)
        run_ingest.delay(
            platform="youtube",
            query=keyword,
            limit=YT_LIMIT,
            youtube_search=True,
        )
        dispatched += 2

    platforms = ["x", "youtube"]
    log.info(
        "trending_ingest.dispatched",
        keywords=keywords,
        platforms=platforms,
        dispatched=dispatched,
    )
    return {
        "keywords": keywords,
        "platforms": platforms,
        "dispatched": dispatched,
    }


@celery_app.task(name="api.workers.ingest.recluster_all")
def recluster_all(platforms: list[str] | None = None) -> dict[str, int]:
    """Re-run UNIFIED Gemini topic discovery over the whole corpus.

    Since 2026-05-27 clustering is unified across all platforms into a
    single topic set (`platform="all"`) — pooling one pass dedupes the
    near-identical themes the old per-platform split produced. The
    `platforms` arg is accepted for backward-compat with existing beat
    kwargs but IGNORED.

    Idempotent — each run truncates `topics` and writes fresh unified
    rows from the most recent corpus.
    """
    if not is_task_enabled("recluster_all", "all"):
        log.info("pipeline.disabled", task="recluster_all")
        return {"all": 0, "disabled": True}

    async def _runner() -> dict[str, int]:
        run_id = await ingest_runs.start_run(
            task_name="recluster_all", platform="all"
        )
        try:
            n = await cluster_topics._run()
            await ingest_runs.finish_run(
                run_id, status="success", items_stored=n
            )
            return {"all": n}
        except Exception as exc:
            await ingest_runs.finish_run(run_id, status="failed", error=str(exc))
            log.exception("recluster.failed")
            return {"all": 0}

    return asyncio.run(_runner())


@celery_app.task(name="api.workers.ingest.send_weekly_digest")
def send_weekly_digest() -> dict[str, object]:
    """Send the weekly insights digest to every opted-in user.

    Runs Thursday 18:00 WIB via Celery beat — same day as the briefing
    publish (Thursday 05:00). Uses the most-recent row of
    `insights_summaries` as the body. Free up to 3K emails/month via
    Resend.
    """
    if not is_task_enabled("send_weekly_digest", "all"):
        log.info("pipeline.disabled", task="send_weekly_digest")
        return {"disabled": True}

    try:
        result = asyncio.run(email_digest.send_weekly_digests())
        return result or {"skipped": True}
    except Exception:
        log.exception("email_digest.failed")
        return {"error": "send_failed"}


@celery_app.task(name="api.workers.ingest.generate_briefings")
def generate_briefings() -> dict[str, object]:
    """Generate weekly briefings — one per THEME_GROUP that crossed the
    `MIN_POSTS_PER_GROUP_FOR_BRIEFING` volume floor in the last 7 days.

    Each briefing grounds its `daleel` paragraph in passages retrieved
    from Qdrant — the LLM is constrained to cite only those (PRD §12).

    Runs Thursday 05:00 WIB (one hour after the 04:00 Gemini topic-
    discovery pass so the LLM sees the freshest theme labels). Up to
    14 Gemini 2.5 Pro calls + 14 OpenAI embedding calls per run; cost
    scales to ~$0.30-0.85 per cycle (~$3.40/month at ~$0.06 per
    briefing × 14 × 4 weeks).

    Renamed from `generate_insights_summary` 2026-06-05 (Scope C).
    Widened from top-5 to all-above-floor 2026-06-05.
    """
    if not is_task_enabled("generate_briefings", "all"):
        log.info("pipeline.disabled", task="generate_briefings")
        return {"disabled": True}

    try:
        result = asyncio.run(briefing.generate_all_briefings())
        return result
    except Exception:
        log.exception("briefing.failed")
        return {"error": "generate_failed"}


@celery_app.task(name="api.workers.ingest.generate_occasion_briefings")
def generate_occasion_briefings() -> dict[str, object]:
    """Generate 15th-track Islamic-calendar briefings — one per
    upcoming occasion (next 14 days) that hasn't been generated yet.

    Catalog source: api/src/api/catalogs/hijri_occasions.yaml.
    Idempotent: each generate_occasion_briefing() does a per-slug
    DB existence check before composing.

    Runs Sunday 05:00 WIB (aligned with the existing weekly briefings
    schedule). Cost: ~$0.50 per occasion × ~1-2 fires per week ≈
    ~$10/year, well within the IDR 1.5-2M monthly cap.

    Kill-switch: this task respects `is_task_enabled
    ('generate_occasion_briefings', 'all')` so the operator can stop
    auto-spend without redeploying.

    Returns a dict shaped like:
        {"scanned": N, "fired": M, "skipped_existing": K,
         "results": {slug: True/False/None}}
    """
    if not is_task_enabled("generate_occasion_briefings", "all"):
        log.info("pipeline.disabled", task="generate_occasion_briefings")
        return {"disabled": True}

    try:
        result = asyncio.run(briefing.generate_all_occasion_briefings())
        return result
    except Exception:
        log.exception("briefing.occasion_cron_top_level_failed")
        return {"error": "generate_failed"}


# Rows repaired per run. Was 200, which at the 2h schedule (12 runs/day)
# drains 2,400/day — at or BELOW the 2,000-3,500/day ingest rate, so a
# backlog inside the 14-day window could never actually drain: rows aged
# out of the window faster than the task reached them. 600 gives ~7,200/day,
# comfortably above inflow, so a backlog shrinks instead of rotting.
# This does NOT raise the monthly LLM bill: these are classifications the
# ingest path already owed (one Gemini call per post, deferred by an
# outage), so total spend is bounded by post volume, not by this cap.
RETRY_SENTIMENT_ROW_CAP = 600

# How far back to repair. Rows older than this are never revisited, so
# anything still NULL past the cutoff is permanently unclassified.
RETRY_SENTIMENT_WINDOW_DAYS = 14


# The predicate and the write are extracted as pure functions (no DB, no
# IO) so the two properties that actually caused the 2026-08-20 stranding
# bug are unit-testable — see tests/test_retry_repair_semantics.py:
#   1. the filter must reach rows whose theme_group alone is NULL, and
#   2. the write must COALESCE, never blind-set, or it would silently undo
#      hand-verified manual theme audits.
# Imports stay function-local to match this module's existing lazy-import
# style (keeps worker import time down / avoids model-import cycles).
def retry_repair_filter(cutoff: datetime):
    """Rows inside `cutoff` that are missing sentiment OR theme_group."""
    from sqlalchemy import and_, or_

    from api.models.social import SocialPost

    return and_(
        SocialPost.text.is_not(None),
        SocialPost.posted_at >= cutoff,
        or_(
            SocialPost.sentiment_label.is_(None),
            SocialPost.theme_group.is_(None),
        ),
    )


def retry_repair_values(label: str, score: float, theme_group: str | None) -> dict:
    """Fill-in write: `coalesce(existing, new)` for every column.

    Never overwrites a value that is already present — see the task
    docstring for why that is load-bearing for `theme_group`.
    """
    from sqlalchemy import func

    from api.models.social import SocialPost

    return {
        "sentiment_label": func.coalesce(SocialPost.sentiment_label, label),
        "sentiment_score": func.coalesce(SocialPost.sentiment_score, score),
        "theme_group": func.coalesce(SocialPost.theme_group, theme_group),
    }


@celery_app.task(name="api.workers.ingest.retry_failed_sentiment")
def retry_failed_sentiment() -> dict[str, int]:
    """Repair posts missing `sentiment_label` OR `theme_group`.

    These rows result from sustained Gemini outages that exhausted the
    in-line retry budget inside `sentiment._classify_chunk` (5xx) or that
    never got a response at all (429 RESOURCE_EXHAUSTED when the prepay
    balance is depleted — the 4/8/16s backoff only covers ServerError, so
    quota failures land straight here). Covers every platform (mainstream
    + X + YT + IG + TT) since the 2026-05-25 single-classifier cutover.

    FILL-IN SEMANTICS — this task repairs missing fields and NEVER
    overwrites data that is already present. Every write goes through
    `coalesce(existing, new)`. That matters for two reasons:
      * `theme_group` is also written directly by the manual theme audits
        (232k+ rows as of 2026-08-20). A blind write here would silently
        undo that hand-verified work.
      * Re-running the classifier over a row whose sentiment was already
        good shouldn't churn its label.

    WHY IT ALSO REPAIRS theme_group (fix 2026-08-20): `classify_batch`
    returns sentiment AND theme_group from a single Gemini call, and the
    normal ingest path persists both (`scripts/ingest.py`). This task used
    to write only the two sentiment columns and DISCARD `s.theme_group`.
    Because its own predicate was `sentiment_label IS NULL`, every row it
    repaired became permanently unreachable with `theme_group` still NULL
    — silently stranding it. That produced 848 orphans, with a further
    9,327 rows queued to be stranded the moment credits were topped up.
    Selecting on `sentiment_label IS NULL OR theme_group IS NULL` and
    coalescing the theme in closes both halves of that hole.

    Scoped to the last `RETRY_SENTIMENT_WINDOW_DAYS` so an old backlog
    doesn't grow unbounded, and capped at `RETRY_SENTIMENT_ROW_CAP` rows
    per run so a worst-case batch can't blow the Gemini per-minute quota.

    Schedule: every 2h offset 1h from the RSS ingest (so 01:00, 03:00
    … WIB). The offset means an RSS-induced 503 has a full hour to
    recover before we try the failed rows again.
    """
    if not is_task_enabled("retry_failed_sentiment", "all"):
        log.info("pipeline.disabled", task="retry_failed_sentiment")
        return {
            "checked": 0,
            "relabeled": 0,
            "themed": 0,
            "still_failed": 0,
            "disabled": True,
        }

    from sqlalchemy import select, update

    from api.db import SessionLocal
    from api.models.social import SocialPost
    from api.services.sentiment import classify_batch as classify_sentiment

    cutoff = datetime.now(UTC) - timedelta(days=RETRY_SENTIMENT_WINDOW_DAYS)

    async def _runner() -> dict[str, int]:
        async with SessionLocal() as session:
            rows = (
                await session.execute(
                    select(
                        SocialPost.id,
                        SocialPost.text,
                        SocialPost.sentiment_label,
                        SocialPost.theme_group,
                    )
                    .where(retry_repair_filter(cutoff))
                    .order_by(SocialPost.posted_at.desc().nulls_last())
                    .limit(RETRY_SENTIMENT_ROW_CAP)
                )
            ).all()

            if not rows:
                log.info("retry_failed_sentiment.nothing_to_do")
                return {
                    "checked": 0,
                    "relabeled": 0,
                    "themed": 0,
                    "still_failed": 0,
                }

            ids = [r.id for r in rows]
            texts = [r.text or "" for r in rows]
            needed_label = {r.id for r in rows if r.sentiment_label is None}
            needed_theme = {r.id for r in rows if r.theme_group is None}
            scored = classify_sentiment(texts)

            relabeled = 0
            themed = 0
            still_failed = 0
            for post_id, s in zip(ids, scored, strict=False):
                if s is None:
                    still_failed += 1
                    # Leave the NULLs — next cron tick retries.
                    continue
                await session.execute(
                    update(SocialPost)
                    .where(SocialPost.id == post_id)
                    .values(**retry_repair_values(s.label, s.score, s.theme_group))
                )
                if post_id in needed_label:
                    relabeled += 1
                # s.theme_group is None when the model omitted it or emitted
                # an invalid name — that row stays NULL and is retried.
                if post_id in needed_theme and s.theme_group is not None:
                    themed += 1
            await session.commit()

            log.info(
                "retry_failed_sentiment.done",
                checked=len(rows),
                relabeled=relabeled,
                themed=themed,
                still_failed=still_failed,
            )
            return {
                "checked": len(rows),
                "relabeled": relabeled,
                "themed": themed,
                "still_failed": still_failed,
            }

    try:
        return asyncio.run(_runner())
    except Exception as exc:
        # Surface a depleted prepay balance as its own high-signal event.
        # It is NOT a transient error: no amount of retrying fixes it, only
        # an operator top-up does, and until then EVERY post ingested lands
        # unclassified. It arrives as a google.genai ClientError (429), which
        # the in-line ServerError backoff does not catch, so this is where it
        # surfaces. Matched on message text to avoid importing genai types.
        msg = str(exc)
        if "RESOURCE_EXHAUSTED" in msg or "prepayment credits" in msg:
            log.error(
                "retry_failed_sentiment.quota_exhausted",
                hint=(
                    "Gemini prepay balance depleted — classification is DOWN "
                    "pipeline-wide (sentiment + theme_group + topic + rerank). "
                    "Top up at https://ai.studio/projects; retrying cannot fix it."
                ),
                error=msg[:300],
            )
        else:
            log.exception("retry_failed_sentiment.failed")
        return {"checked": 0, "relabeled": 0, "themed": 0, "still_failed": 0}


@celery_app.task(name="api.workers.ingest.reconcile_apify_costs")
def reconcile_apify_costs() -> dict[str, object]:
    """Pull Apify's authoritative monthly bill and write a delta row.

    Closes the gap between per-run `usageTotalUsd` (which lags + skips
    failed runs + rounds small runs to $0) and the real dashboard total.
    Idempotent — re-runs the same day are no-ops.
    """
    if not is_task_enabled("reconcile_apify_costs", "all"):
        log.info("pipeline.disabled", task="reconcile_apify_costs")
        return {"disabled": True}

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
    if not is_task_enabled("snapshot_system", "host"):
        return None

    try:
        asyncio.run(metrics.persist_snapshot())
    except Exception:
        log.exception("metrics.snapshot_failed")
