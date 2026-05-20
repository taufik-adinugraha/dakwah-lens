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
        #   TT (Tue only)              — clockworks/free-tiktok-scraper.
        #                                "Free" is the product NAME, not the
        #                                cost: Apify still charges compute
        #                                (~$0.08/run × 49 keys = ~$3.92/run).
        #                                Cut from daily to weekly to keep
        #                                inside the IDR 1M ($60/mo) cap.
        #   TT (every 2 weeks, paid)   — clockworks/tiktok-scraper $4/1K,
        #                                richer metadata, 1st + 3rd Mon
        #   X  (Mon, Wed, Fri)         — apidojo $0.40/1K
        #   IG (Mon only)              — apify hashtag $2.30/1K, priciest
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
        # The TT-paid biweekly run lands on Monday — separate from the
        # weekly free run on Tuesday — so the two never collide on the
        # same day. DB upserts on (platform, external_id) anyway, so a
        # collision would be safe (richer payload wins).
        #
        # Cost at the current ~49-keyword pool × ~20 posts/keyword =
        # ~980 results per run:
        #   YT 7×/wk × 980 → free
        #   TT 1×/wk (free actor) → ~$17/mo  (49 × $0.08 × ~4.3 wk/mo)
        #   TT 2×/mo (paid actor) → ~$8/mo @ $4/1K
        #   X  3×/wk × 980 → ~$5/mo @ $0.40/1K
        #   IG 1×/wk × 980 → ~$10/mo @ $2.30/1K
        # Subtotal sweep: ~$40/mo. Add daily trending overlay (~$1.4/mo)
        # → ~$41/mo total Apify usage. Inside the IDR 1M ($60) cap.
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
        "ingest-tiktok": {
            "task": "api.workers.ingest.rotating_ingest",
            # Tuesday only — was daily, but the "free" actor isn't free
            # (~$3.92/run × 7 days = ~$118/mo, blowing the IDR 1M cap).
            # Tue picked to avoid colliding with Mon (X + IG + TT-paid).
            "schedule": crontab(minute=20, hour=0, day_of_week=2),
            "kwargs": {"platform": "tiktok", "limit": 20, "n_keywords": 999},
        },
        "ingest-tiktok-paid": {
            "task": "api.workers.ingest.rotating_ingest",
            # Biweekly: 1st + 3rd Mondays of the month. Celery crontab
            # `day_of_month="1-7,15-21"` constrains the date range, then
            # `day_of_week=1` picks the Monday inside each range — that's
            # exactly two Mondays per month, 14 days apart in-month
            # (cross-month gap can be 14-21 days depending on weekday
            # alignment).
            "schedule": crontab(
                minute=25,
                hour=0,
                day_of_week=1,
                day_of_month="1-7,15-21",
            ),
            "kwargs": {
                "platform": "tiktok",
                "limit": 20,
                "n_keywords": 999,
                "actor_id": "clockworks/tiktok-scraper",
            },
        },
        "ingest-instagram": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=30, hour=0, day_of_week=1),
            "kwargs": {"platform": "instagram", "limit": 20, "n_keywords": 999},
        },
        # Re-cluster topics every night after the daily ingest finishes. The
        # task itself handles the "not enough posts" case gracefully so it's
        # safe to fire even when scrapers returned nothing.
        "recluster-topics": {
            "task": "api.workers.ingest.recluster_all",
            "schedule": crontab(minute=0, hour=8),
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
