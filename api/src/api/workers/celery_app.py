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
        # with a 7d window via `since_days` lands ~5–10× more unique
        # signal per dollar (cap is a ceiling).
        #
        # limit lowered 200 → 100 (2026-06-25). After the tweetLanguage
        # bug fix the full pool (~80 queries) returns near-max every run;
        # at limit=200 the 2026-06-25 manual re-ingest billed 14,978
        # items / $4.94 with ~36% being cross-query duplicate "Top"
        # tweets (apify charges per item RETURNED, dupes upsert onto
        # existing rows). limit=100 halves the per-run cost to ~$2.50
        # while still yielding ~8,000 fresh items — ample for the weekly
        # briefing's 7d window. Matches the daily trending X_LIMIT=100.
        "ingest-x-weekly": {
            "task": "api.workers.ingest.rotating_ingest",
            "schedule": crontab(minute=0, hour=22, day_of_week=3),
            "kwargs": {"platform": "x", "limit": 100, "n_keywords": 999},
        },
        # TikTok + Instagram — PAUSED 2026-06-08 to claw back budget for
        # higher-value LLM work (briefings, daleel pool widening). Three
        # weekly cycles (May 20, 27, Jun 3) showed:
        #   · TikTok: 3 runs × ~770 items ≈ $2.60/run → $10-11/mo billed
        #   · Instagram: 3 runs × ~1,000-2,100 items ≈ $1-3.70/run, very
        #     volatile (Jun 3 cycle alone burnt $3.68 — 2× expected — as
        #     hashtag yield doubled vs the limit=60 calibration).
        # Combined ~$23/month for two platforms whose signal overlaps
        # heavily with X (which we keep) on the same trending topics.
        #
        # Re-enable by uncommenting both blocks. No code changes needed —
        # the `ingest_queries` rows for tiktok/instagram remain in place
        # (admin-editable at /admin/system/queries), so the next cycle
        # picks up the existing keyword list immediately.
        # "ingest-tiktok-weekly": {
        #     "task": "api.workers.ingest.rotating_ingest",
        #     "schedule": crontab(minute=10, hour=22, day_of_week=3),
        #     "kwargs": {"platform": "tiktok", "limit": 20, "n_keywords": 999},
        # },
        # "ingest-instagram-weekly": {
        #     "task": "api.workers.ingest.rotating_ingest",
        #     "schedule": crontab(minute=20, hour=22, day_of_week=3),
        #     "kwargs": {"platform": "instagram", "limit": 60, "n_keywords": 999},
        # },
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
        # from each post's own platform.
        #
        # Cost split since 2026-06-14: Pro on Thursday (briefing day),
        # Flash other days — see topic_discovery.py::_model_for_today.
        # Thursday recluster: ~$0.30/run on Pro (better precision on
        # hard rules → cleaner briefing daleel pulls).
        # Other days:        ~$0.02/run on Flash (good enough for the
        # dashboard's daily freshness).
        # Monthly: ~$1.80/mo total (Flash×26 + Pro×4).
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
        # constants in services/briefing.py if changed.
        # "generate-briefings": {
        #     "task": "api.workers.ingest.generate_briefings",
        #     # day_of_week=4 = Thursday in Celery's crontab (Sun=0).
        #     "schedule": crontab(minute=0, hour=5, day_of_week=4),
        # },
        # 15th-track Islamic-calendar briefings — DISABLED by default,
        # same as the weekly briefings cron above. Re-enable when the
        # operator is ready to let the Sunday 05:00 WIB cron auto-fire
        # Gemini 2.5 Pro for the next 14-day occasion window.
        #
        # Catalog: api/src/api/catalogs/hijri_occasions.yaml (26 entries
        # across Hijri years 1448 + 1449). Cost: ~$0.50 per occasion ×
        # ~14-18 fires per year ≈ ~$10/year — well inside the IDR
        # 1.5-2M monthly cap.
        #
        # Manual pipeline (always available; no cron needed):
        #   uv run python -m api.scripts.manual_briefing list-occasions
        #   uv run python -m api.scripts.manual_briefing dump-occasion <slug>
        #   # paste into Claude → save reply as /tmp/r.md
        #   uv run python -m api.scripts.manual_briefing save-occasion <slug> /tmp/r.md
        #
        # Kill-switch (admin panel): `is_task_enabled
        # ('generate_occasion_briefings', 'all')` — flip OFF without
        # redeploying.
        #
        # "generate-occasion-briefings": {
        #     "task": "api.workers.ingest.generate_occasion_briefings",
        #     # day_of_week=0 = Sunday in Celery's crontab.
        #     "schedule": crontab(minute=0, hour=5, day_of_week=0),
        # },
        # Weekly email digest — DISABLED 2026-06-05 while the 9-PRD
        # categories retirement reshapes the digest body. Re-enable by
        # uncommenting once the new topic-driven pill rows have been
        # eyeballed on a live run. Resend API key also pending rotation,
        # so the schedule sitting idle is fine.
        #
        # Previous cadence: Thursday 08:00 WIB, same-day delivery after
        # the briefing publish, free up to 3K emails/month on Resend.
        #
        # "send-weekly-digest": {
        #     "task": "api.workers.ingest.send_weekly_digest",
        #     # day_of_week=4 = Thursday in Celery's crontab (Sun=0).
        #     "schedule": crontab(minute=0, hour=8, day_of_week=4),
        # },
        # Trending overlay — daily 12:00 WIB. Complements the weekly
        # curated X sweep (49 fixed keywords on Wed 22:00) by catching
        # news-cycle topics that emerge mid-week. Sources are free
        # (Google Trends ID + News RSS + YouTube Data API); Gemini
        # Flash-Lite filters for da'wah-relevance; surviving keywords
        # fan out to X + YouTube scrapes.
        #
        # Cost at current caps (PER_SOURCE_LIMIT=40, TOTAL_KEEP_LIMIT=10,
        # X_LIMIT=100, YT_LIMIT=200, dialed back 2026-06-15 from KEEP=20):
        #   X: 10 kw × ~82 items × 30d × $0.0004 ≈ $10/mo realistic
        #      ($12/mo ceiling at 100% utilization). Apify history shows
        #      82.5% per-call utilization at the 100-cap.
        #   YT: free within quota — 10 kw × 4 search.list calls × 100u
        #       + ~2 videos.list chunks × 1u ≈ 4100u/day (41% of 10K
        #       free tier; the weekly channel sweep uses ~150u/day so
        #       ~5750u/day headroom remains).
        #   Gemini filter: ~$0.0001/run × 30d ≈ $0.003/mo (trivial)
        # Original baseline (X=100, KEEP=8) averaged $1.28/mo actual spend.
        # The brief 2026-06-14 KEEP=20 setting showed ~$0.25/day on the
        # first full run; at 10 we project ~half that (~$3.50-5/mo).
        #
        # WARNING: at the new caps this single task can exceed the
        # ~$60/mo Apify budget. Monitor /admin/system/api-costs after
        # rollout and dial caps back if monthly run-rate breaches the
        # IDR 1.5–2M total cap.
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
