"""Celery app + beat schedule.

Two roles:
- **Worker** — runs the `api.workers.ingest` tasks (one per platform + topic
  clustering) when triggered by beat or by manual `delay()` calls.
- **Beat** — fires the schedule below: ingest every 6 hours, recluster topics
  every 24 hours, so the `/insights/[platform]` pages stay fresh without any
  manual CLI runs.

Run locally with:
    uv run celery -A api.workers.celery_app worker --loglevel=info
    uv run celery -A api.workers.celery_app beat   --loglevel=info

Schedule is intentionally light — at prototype scale we're well under the
IDR 1M/month cap. Tighten when traffic + Apify cost actually warrants it.
"""

from celery import Celery
from celery.schedules import crontab

from api.config import settings

celery_app = Celery(
    "dakwah_lens",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["api.workers.ingest"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Jakarta",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=600,
    # Crash-safe task delivery. With `acks_late=True` Redis only removes
    # the message from the queue once the task SUCCEEDS — so a worker
    # crash mid-task returns the message for retry instead of dropping
    # it. Combined with `prefetch=1` (workers hold ONE task at a time
    # instead of the default 4 in-memory buffer), a SIGKILL during a
    # deploy loses at most one in-flight task per worker process. We
    # learned this the hard way on 2026-05-20: a mid-deploy worker
    # restart dropped 8 trending-overlay X scrapes because Celery had
    # already pulled them out of Redis into worker memory.
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    # Beat schedule. Keep query strings broad enough to surface a meaningful
    # cross-section of da'wah-relevant content. Mainstream/YouTube have no
    # Apify cost, so they run more often.
    beat_schedule={
        # Mainstream RSS — free, every 2 hours (00:00, 02:00, … WIB).
        "ingest-mainstream": {
            "task": "api.workers.ingest.run_ingest",
            "schedule": crontab(minute=0, hour="*/2"),
            # limit=100 (was 40) — 27 enabled feeds × ~3-4 items per
            # outlet per run via the round-robin interleave in
            # services/rss.py::scrape_mainstream. Older 40-cap had every
            # run hitting the ceiling with no spare headroom (items
            # scraped == items stored == 40 verbatim), capping real
            # daily volume around 480 even on busy news days. New cap
            # lifts the ceiling to ~1,200/day while staying well inside
            # the Flash-Lite classification budget.
            "kwargs": {"platform": "mainstream", "query": "", "limit": 100},
        },
        # Retry mainstream rows whose sentiment label is NULL (Gemini 5xx
        # exhausted the in-line retry budget). Runs at 01:00, 03:00, … —
        # one hour OFFSET from the RSS ingest so a Gemini overload that
        # took down the previous tick has time to recover. Almost always
        # a no-op (0-25 rows); cost is < $0.003 per run when it does work.
        "retry-failed-sentiment": {
            "task": "api.workers.ingest.retry_failed_sentiment",
            "schedule": crontab(minute=0, hour="1-23/2"),
        },
        # Social-media platforms scrape the FULL `ingest_queries` pool
        # (admin-editable at /admin/system/queries). Cadence varies by
        # platform, balancing freshness against Apify cost / free-actor
        # rate limits:
        #   YT (every day)             — free (YouTube Data API)
        #   TT (Tue only)              — clockworks/free-tiktok-scraper
        #                                $0.004/item; weekly keeps it
        #                                cheaper than the $45/mo paid sub
        #   X  (Mon, Wed, Fri)         — apidojo $0.0004/item
        #   IG (Mon only)              — apify hashtag $0.0023/item
        #
        # n_keywords=999 is intentionally larger than the realistic pool
        # size — the rotating_ingest task picks "up to N" enabled
        # queries, so any N >> pool means "all enabled".
        #
        # All runs land at 00:xx WIB (Indonesian sleep window) on a
        # 10-min stagger to avoid Apify per-actor concurrency bursts.
        # Starting at midnight gives a generous buffer before the 04:00
        # WIB topic-discovery recluster picks up the fresh material.
        #
        # Cost at the current ~49-keyword pool × ~20 posts/keyword =
        # ~980 results per run:
        #   YT 7×/wk × 980 → free
        #   TT 1×/wk × 980 → ~$17/mo @ $0.004/item
        #   X  3×/wk × 980 → ~$5/mo  @ $0.0004/item
        #   IG 1×/wk × 980 → ~$10/mo @ $0.0023/item
        # Subtotal sweep: ~$32/mo. Add trending overlay (X only, ~$0.1)
        # → ~$32/mo total Apify usage. Inside the IDR 1M ($60) cap.
        # Track real costs at /admin/system/api-costs.
        # ── PAUSED 2026-05-20 ───────────────────────────────────────
        # Only `mainstream` RSS is verified end-to-end against the new
        # dedup-before-classify + lang-filter + Top-sort + relevance
        # JSON-fix code path. X / TT / IG / YT remain unvalidated and
        # we don't want to leave them firing unattended while the user
        # is off-server. Re-enable one at a time after running a single
        # manual trigger and confirming items_stored + distribution +
        # `ingest.lang_filter` log entries look sane.
        #
        # YT specifically also needs a one-time
        # `uv run python -m api.scripts.seed_youtube_channels`
        # before the daily ingest will find any channels to scrape.
        # "ingest-youtube-channels": {
        #     "task": "api.workers.ingest.youtube_channels_ingest",
        #     "schedule": crontab(minute=0, hour=0),
        #     "kwargs": {"limit": 50},
        # },
        # "ingest-x-mon": {
        #     "task": "api.workers.ingest.rotating_ingest",
        #     "schedule": crontab(minute=10, hour=0, day_of_week=1),
        #     "kwargs": {"platform": "x", "limit": 20, "n_keywords": 999},
        # },
        # "ingest-x-wed": {
        #     "task": "api.workers.ingest.rotating_ingest",
        #     "schedule": crontab(minute=10, hour=0, day_of_week=3),
        #     "kwargs": {"platform": "x", "limit": 20, "n_keywords": 999},
        # },
        # "ingest-x-fri": {
        #     "task": "api.workers.ingest.rotating_ingest",
        #     "schedule": crontab(minute=10, hour=0, day_of_week=5),
        #     "kwargs": {"platform": "x", "limit": 20, "n_keywords": 999},
        # },
        # "ingest-tiktok": {
        #     "task": "api.workers.ingest.rotating_ingest",
        #     "schedule": crontab(minute=20, hour=0, day_of_week=2),
        #     "kwargs": {"platform": "tiktok", "limit": 20, "n_keywords": 999},
        # },
        # "ingest-instagram": {
        #     "task": "api.workers.ingest.rotating_ingest",
        #     "schedule": crontab(minute=30, hour=0, day_of_week=1),
        #     "kwargs": {"platform": "instagram", "limit": 20, "n_keywords": 999},
        # },
        # Re-cluster topics nightly. 04:00 WIB — 1–2h after the daily
        # X/YT/TT/IG fanouts finish (~02:00) so we have fresh data, but
        # well before the workday so the public /insights page shows
        # current themes. Was 08:00 WIB but that wasted 4 fresh-data
        # hours of public visibility. The task handles "not enough
        # posts" gracefully, so safe to fire even on quiet platforms.
        "recluster-topics": {
            "task": "api.workers.ingest.recluster_all",
            "schedule": crontab(minute=0, hour=4),
        },
        # Insights briefing generation — PAUSED 2026-05-23 for cost.
        #
        # Gemini 2.5 Pro at the current 7300-9800-word target costs
        # ~$0.30-0.50 per briefing × 5 segments × 4 Sundays/month ≈
        # $6-10/mo. Modest in absolute terms but the user is tightening
        # the budget during the development phase, so we disabled the
        # auto schedule and switched to manual generation via Claude.
        #
        # The pipeline still works end-to-end (stats compute, daleel
        # retrieval, prompt assembly) — only the LLM step is now manual.
        # Trigger from a host shell:
        #
        #   uv run python -m api.scripts.manual_briefing dump all > /tmp/p.md
        #   # paste /tmp/p.md into Claude → save reply as /tmp/r.md
        #   uv run python -m api.scripts.manual_briefing save all /tmp/r.md
        #
        # Re-enable by uncommenting this block + restoring the schedule
        # constants in services/insights_summary.py if changed.
        # "generate-insights-summary": {
        #     "task": "api.workers.ingest.generate_insights_summary",
        #     "schedule": crontab(minute=0, hour=5, day_of_week=0),
        # },
        # Weekly email digest — Sunday 18:00 WIB. Late-evening before
        # Monday morning so Indonesian audiences see it in their
        # Sunday-evening inbox routine. Free up to 3K emails/month on
        # Resend's free tier.
        "send-weekly-digest": {
            "task": "api.workers.ingest.send_weekly_digest",
            "schedule": crontab(minute=0, hour=18, day_of_week=0),
        },
        # Trending overlay paused 2026-05-20 — fans out X scrapes
        # which are themselves paused pending verification.
        # "trending-ingest": {
        #     "task": "api.workers.ingest.trending_ingest",
        #     "schedule": crontab(minute=0, hour=12),
        # },
        # Daily 06:00 WIB reconcile of Apify's authoritative monthly
        # spend against our per-run usage_events. Closes the gap between
        # `run.usageTotalUsd` (best-effort, lags) and Apify's billing
        # dashboard (truth). After the morning ingests have settled but
        # before the workday so the cost dashboard reads correctly.
        "reconcile-apify-costs": {
            "task": "api.workers.ingest.reconcile_apify_costs",
            "schedule": crontab(minute=0, hour=6),
        },
        # Host metrics every minute → drives the superadmin infra chart.
        "snapshot-system": {
            "task": "api.workers.ingest.snapshot_system",
            "schedule": 60.0,
        },
    },
)
