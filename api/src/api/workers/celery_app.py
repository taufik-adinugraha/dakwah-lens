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
            # limit=200 (was 100 was 40) — measured 2026-05-25 the
            # 100-cap was hitting the ceiling every run with 31% of
            # picks deduping. Raw available items per run is ~995
            # across 27 feeds, but the long tail of *fresh* items
            # (post-dedup) plateaus around 100-150. 200 leaves
            # headroom on busy news days without bloating Gemini
            # Flash-Lite classification cost (each new row costs
            # ~Rp 0.5-1; +100 picks/run × 13 runs/day ≈ Rp 20k/mo
            # extra, well inside the 1.5-2M IDR LLM budget).
            "kwargs": {"platform": "mainstream", "query": "", "limit": 200},
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
        # YouTube — WEEKLY channel scan, Wed 21:00 WIB (1h before the X
        # social burst). This is the trusted-voices half of the YT split:
        # the verified-channel whitelist via the cheap uploads path (2
        # quota units/channel). The UNBOUNDED half lives in the daily
        # `trending-ingest` task, which keyword-searches all of YouTube.
        #
        # Weekly (not daily) because curated da'i channels publish a
        # handful of videos/week — a daily sweep would mostly re-see the
        # same uploads. The 7-day publishedAt window in
        # `scrape_youtube_uploads` matches this cadence.
        #
        # Needs a one-time `uv run python -m api.scripts.seed_youtube_channels`
        # + admin Verify before it finds any channels; until then the task
        # is a harmless no-op (logs `youtube_channels_ingest.no_channels`).
        "ingest-youtube-channels": {
            "task": "api.workers.ingest.youtube_channels_ingest",
            "schedule": crontab(minute=0, hour=21, day_of_week=3),
            "kwargs": {"limit": 50},
        },
        # X — weekly Wed 22:00 WIB. Since briefings became weekly
        # (Sun 05:00 WIB), 3× daily X fanouts were paying for the same
        # engagement-sticky "Top" tweets multiple times. One weekly run
        # with a 500-item cap and a 7d window via `since_days` lands
        # ~5–10× more unique signal per dollar (cap is a ceiling — the
        # actor returned 205 items for `korupsi` in smoke).
        "ingest-x-weekly": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=0, hour=22, day_of_week=3),
            "kwargs": {"platform": "x", "limit": 500, "n_keywords": 999},
        },
        # TikTok + Instagram — weekly Wed evening, staggered after X so the
        # paid-Apify burst lands together and a single Thu 04:00 recluster
        # covers all three. Enabled 2026-05-25 for one-week evaluation.
        # Cost @ limit=20 × 49 keywords:
        #   · TikTok ($0.004/item)    ≈ $3.92/run → $16/mo
        #   · Instagram ($0.0023/item) ≈ $2.25/run → $9/mo
        # Keep limit at 20 — bumping higher pushes TT past budget cap.
        # ingest-tiktok-weekly RE-ENABLED 2026-05-28 with a pruned seed
        # list (36 Indonesian-distinctive seeds, down from 49) — 13
        # collision-prone English/multilingual hashtags (#anime, #crypto,
        # #film, #game, #guru, #healing, #kpop, #mental, #parenting,
        # #viral, #zina, #burnout, #childfree) were marked enabled=false
        # in ingest_queries because TT's $0.056/item rate makes each
        # foreign-language pull expensive (was 30.1% foreign noise before
        # the audit). Watch the next Wed 22:10 WIB run's foreign-rate via
        # the language-cleanup script; if still >15%, prune further from:
        # genz / stres / bully (Indonesian-used but English-loanword).
        "ingest-tiktok-weekly": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=10, hour=22, day_of_week=3),
            "kwargs": {"platform": "tiktok", "limit": 20, "n_keywords": 999},
        },
        "ingest-instagram-weekly": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=20, hour=22, day_of_week=3),
            "kwargs": {"platform": "instagram", "limit": 20, "n_keywords": 999},
        },
        # Re-cluster topics. Split across two beat entries to match the
        # ingest cadence of each platform — re-running Gemini topic
        # discovery on the same corpus does no work but still costs
        # ~$0.05/platform/run, so we only re-cluster when there's fresh
        # data to find themes in.
        #
        # Daily 04:00 WIB → ONE unified topic-discovery pass over the
        # whole corpus (mainstream + X + TikTok + IG + YouTube). 1–2h
        # after RSS's 02:00 WIB tick gives fresh material; well before
        # the workday so /insights shows current themes.
        #
        # Unified since 2026-05-27 (was split daily mainstream+YT /
        # weekly social): per-platform clustering produced near-duplicate
        # themes across platforms. One pooled pass dedupes by
        # construction; per-platform breakdowns are derived downstream
        # from each post's own platform. Re-clustering the whole corpus
        # daily costs ~$0.05/run on Gemini Flash — negligible.
        "recluster-daily": {
            "task": "api.workers.ingest.recluster_all",
            "schedule": crontab(minute=0, hour=4),
        },
        # Insights briefing generation — PAUSED 2026-05-23 for cost.
        #
        # Scheduled day moved Sunday → Thursday 2026-05-24 so the
        # weekly content kit lands a day before Friday khutbah prep
        # (giving the da'i 24h to adapt the khutbah deliverable).
        #
        # Gemini 2.5 Pro at the current 7300-9800-word target costs
        # ~$0.30-0.50 per briefing × 5 segments × 4 Thursdays/month ≈
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
        #     # day_of_week=4 = Thursday in Celery's crontab (Sun=0).
        #     "schedule": crontab(minute=0, hour=5, day_of_week=4),
        # },
        # Weekly email digest — Thursday 08:00 WIB. Same day as the
        # briefing publish (Thursday 05:00); the 3-hour gap gives the
        # generation pipeline a window even when retries fire, and lands
        # in the inbox first thing Thursday morning — well ahead of
        # Friday khutbah preparation. Free up to 3K emails/month on
        # Resend's free tier.
        #
        # Moved Sunday 18:00 → Thursday 18:00 (2026-05-24, tracking the
        # briefing day) → Thursday 08:00 (2026-05-27, morning delivery).
        "send-weekly-digest": {
            "task": "api.workers.ingest.send_weekly_digest",
            # day_of_week=4 = Thursday in Celery's crontab (Sun=0).
            "schedule": crontab(minute=0, hour=8, day_of_week=4),
        },
        # Trending overlay — daily 12:00 WIB. Complements the weekly
        # curated X sweep (49 fixed keywords on Wed 22:00) by catching
        # news-cycle topics that emerge mid-week. Sources are free
        # (Google Trends ID + News RSS + YouTube Data API); Gemini
        # Flash-Lite filters for da'wah-relevance; surviving keywords
        # fan out to X scrapes (apidojo $0.0004/item × 20 items ×
        # ~3-5 keywords/day ≈ $1/mo).
        #
        # Re-enabled 2026-05-25 after the weekly X schedule landed —
        # was paused 2026-05-20 because it depended on X scrapes which
        # were themselves paused.
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
