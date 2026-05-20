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
        # Mainstream RSS — free, every 2 hours.
        "ingest-mainstream": {
            "task": "api.workers.ingest.run_ingest",
            "schedule": crontab(minute=0, hour="*/2"),
            "kwargs": {"platform": "mainstream", "query": "", "limit": 40},
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
        # Starting at midnight gives a generous buffer before the 08:00
        # WIB BERTopic recluster picks up the fresh material.
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
        "ingest-youtube": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=0, hour=0),  # daily
            "kwargs": {"platform": "youtube", "limit": 20, "n_keywords": 999},
        },
        "ingest-x-mon": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=10, hour=0, day_of_week=1),
            "kwargs": {"platform": "x", "limit": 20, "n_keywords": 999},
        },
        "ingest-x-wed": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=10, hour=0, day_of_week=3),
            "kwargs": {"platform": "x", "limit": 20, "n_keywords": 999},
        },
        "ingest-x-fri": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=10, hour=0, day_of_week=5),
            "kwargs": {"platform": "x", "limit": 20, "n_keywords": 999},
        },
        # TikTok weekly (Tuesday 00:20 WIB). Free actor
        # (`clockworks/free-tiktok-scraper`) charges $0.004/item — the
        # name is misleading, "free" is the trial tier. At 49 keywords
        # × 20 items = 980 items/run × 4.33 wk/mo ≈ $17/mo. Tuesday
        # avoids Mon collision with X + IG.
        "ingest-tiktok": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=20, hour=0, day_of_week=2),
            "kwargs": {"platform": "tiktok", "limit": 20, "n_keywords": 999},
        },
        "ingest-instagram": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=30, hour=0, day_of_week=1),
            "kwargs": {"platform": "instagram", "limit": 20, "n_keywords": 999},
        },
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
        # Trending overlay: fetch Google Trends + YouTube popular + Google
        # News for Indonesia, filter via Gemini Flash-Lite, then dispatch
        # ad-hoc scrapes on the surviving keywords. Runs at 12:00 WIB so
        # the news cycle has settled in for the day. ~$15.8/mo extra
        # Apify (X $1.4 + TT $14.4 with the paid clockworks actor).
        "trending-ingest": {
            "task": "api.workers.ingest.trending_ingest",
            "schedule": crontab(minute=0, hour=12),
        },
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
