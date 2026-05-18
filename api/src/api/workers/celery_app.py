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
        # Social-media platforms rotate through the `ingest_queries` table
        # (admin-editable at /admin/system/queries) — one query per tick,
        # least-recently-used. Hardcoded keywords are gone; the team edits
        # the mix to balance religious + societal coverage.
        # 2×/day cadence (morning + evening) with limit=50 per run lands at
        # ~$8/mo Apify spend on the Starter plan — under the $10 budget.
        "ingest-youtube": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=10, hour="6,18"),
            "kwargs": {"platform": "youtube", "limit": 50},
        },
        "ingest-x": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=20, hour="7,19"),
            "kwargs": {"platform": "x", "limit": 50},
        },
        "ingest-tiktok": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=30, hour="7,19"),
            "kwargs": {"platform": "tiktok", "limit": 50},
        },
        "ingest-instagram": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=40, hour="7,19"),
            "kwargs": {"platform": "instagram", "limit": 50},
        },
        # Re-cluster topics every night after the daily ingest finishes. The
        # task itself handles the "not enough posts" case gracefully so it's
        # safe to fire even when scrapers returned nothing.
        "recluster-topics": {
            "task": "api.workers.ingest.recluster_all",
            "schedule": crontab(minute=0, hour=8),
        },
        # Host metrics every minute → drives the superadmin infra chart.
        "snapshot-system": {
            "task": "api.workers.ingest.snapshot_system",
            "schedule": 60.0,
        },
    },
)
