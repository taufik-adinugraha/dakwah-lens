"""Topic discovery over `social_posts` — refreshes the `topics` table.

Driven by a Gemini Flash call (see `services/topic_discovery`).

UNIFIED across platforms (2026-05-27): topic discovery runs ONCE over the
whole recent corpus (mainstream + X + YouTube + …), producing a single
set of cross-platform themes stored with `platform = "all"`. Previously
each platform was clustered independently, which produced near-duplicate
themes (e.g. mainstream "Ibadah Haji & Idul Adha" + YouTube "Persiapan
Haji & Idul Adha"). One pooled pass dedupes by construction; per-platform
breakdowns are derived downstream from each post's own `platform`.

Pipeline:
  1. Pull recent posts across ALL platforms (text + id + posted_at),
     stratified per WIB day, above the da'wah-opportunity floor.
  2. Hand them to `services.topic_discovery.discover_topics`, which asks
     Gemini for 6-10 themes with Indonesian labels and returns
     `[{label, keywords, post_ids}]`.
  3. Truncate `topics`, insert the new unified rows, re-point each post's
     `topic_id`. Posts not assigned to any theme get `topic_id = NULL`.

Usage:
    uv run python -m api.scripts.cluster_topics --all
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import delete, func, select, update
from sqlalchemy import or_ as sql_or

from api.db import SessionLocal
from api.models.social import SocialPost
from api.models.topics import Topic
from api.services.topic_discovery import discover_topics

log = structlog.get_logger()


# Minimum corpus size to bother running topic discovery. Below this the
# themes wouldn't be statistically meaningful — we'd just be naming a
# handful of unrelated posts.
MIN_POSTS_FOR_DISCOVERY = 20

# Topic discovery is a STRATIFIED sample: up to PER_DAY_CAP posts from
# each of the last TOPIC_DISCOVERY_WINDOW_DAYS days. Total upper bound is
# PER_DAY_CAP × DAYS, but most days will yield fewer.
#
# Why stratified instead of "newest N":
#   The old "newest 2000" cut clipped to ~1.6 days at busy-news pace
#   (1200 mainstream posts/day with the new RSS cap=100). Themes that
#   emerged Sunday/Monday would be invisible by Friday's recluster.
#   Per-day buckets guarantee every day contributes some signal —
#   the LLM sees a representative cross-section of the week.
#
# Within each day we still take the newest, so partial days at the
# window edges naturally yield fewer rows. Days with no posts at all
# (or only sub-floor `dawah_opportunity`) contribute zero — no
# bookkeeping for empty days.
TOPIC_DISCOVERY_WINDOW_DAYS = 7
PER_DAY_CAP = 1000
SAMPLE_HARD_CEILING = PER_DAY_CAP * TOPIC_DISCOVERY_WINDOW_DAYS  # 7000

# Day buckets are computed in Asia/Jakarta so a post at 23:00 WIB lands
# in the same day as one at 06:00 WIB — what readers would call "the
# same day's news". Otherwise UTC-midnight would split Indonesian days.
DAY_TZ = "Asia/Jakarta"

# Floor for `dawah_opportunity` when deciding which posts feed topic
# discovery. Without this filter the sample is dominated by routine
# politics, stock market, sports, BPJS, weather — none of which produces
# da'wah-relevant themes. 0.4 keeps anything a da'i could plausibly use
# (per the calibration anchors in relevance.py) while dropping the noise
# floor. Posts missing the column (pre-migration) are included so we
# don't accidentally exclude content that just hasn't been re-classified.
MIN_OPPORTUNITY_FOR_DISCOVERY = 0.4

# Sentinel platform for the unified topic set. All discovered topics are
# stored under this value; the per-platform breakdown is derived from
# each post's own `social_posts.platform` downstream.
UNIFIED_PLATFORM = "all"


async def _fetch_recent_posts() -> list[dict[str, Any]]:
    """Pull stratified recent posts across ALL platforms, above the
    da'wah-opportunity floor.

    Mainstream RSS publishes ~50% routine news the model can't form a
    da'wah theme out of (stock prices, sports scores, traffic alerts).
    The opportunity floor filter at the SQL level keeps the discovery
    sample focused.

    Stratification: PER_DAY_CAP posts per WIB day, newest-first within
    each day. Returns up to SAMPLE_HARD_CEILING rows ordered overall
    newest-first. Pooling every platform means the whole week's corpus
    (mainstream + X + YouTube + …) feeds one discovery pass.
    """
    async with SessionLocal() as session:
        window_start = datetime.now(UTC) - timedelta(
            days=TOPIC_DISCOVERY_WINDOW_DAYS
        )
        # Window function ranks each post within its WIB-calendar day.
        # We then keep only ranks <= PER_DAY_CAP. Doing the partition +
        # rank in one CTE keeps Postgres planner happy on the
        # (platform, posted_at) composite index.
        day_bucket = func.date_trunc(
            "day", func.timezone(DAY_TZ, SocialPost.posted_at)
        )
        # Composite ranking: dawah_opportunity × engagement_score.
        # For mainstream RSS rows (no engagement metrics), engagement_score
        # is NULL → fallback to 1.0 so opportunity alone drives the sort.
        # For YouTube rows, both factors multiply: high-relevance content
        # that's actually being watched floats to the top. The score is
        # used ONLY for sample selection inside the day partition; the
        # 0.4 opportunity floor still gates entry into the pool.
        composite_score = (
            func.coalesce(SocialPost.dawah_opportunity, 0.0)
            * func.coalesce(SocialPost.engagement_score, 1.0)
        )
        ranked = (
            select(
                SocialPost.id,
                SocialPost.text,
                SocialPost.posted_at,
                func.row_number()
                .over(
                    partition_by=day_bucket,
                    order_by=(composite_score.desc(), SocialPost.posted_at.desc()),
                )
                .label("rn"),
            )
            .where(SocialPost.posted_at >= window_start)
            .where(
                sql_or(
                    SocialPost.dawah_opportunity.is_(None),
                    SocialPost.dawah_opportunity >= MIN_OPPORTUNITY_FOR_DISCOVERY,
                )
            )
            .subquery()
        )

        res = await session.execute(
            select(ranked.c.id, ranked.c.text, ranked.c.posted_at)
            .where(ranked.c.rn <= PER_DAY_CAP)
            .order_by(ranked.c.posted_at.desc())
        )
        rows = [
            {"id": row.id, "text": row.text, "posted_at": row.posted_at}
            for row in res.all()
            if row.text
        ]

        # Belt-and-suspenders against a runaway scrape: enforce the
        # absolute ceiling even though the partition cap should already
        # bound it. Cheap O(n) slice.
        if len(rows) > SAMPLE_HARD_CEILING:
            rows = rows[:SAMPLE_HARD_CEILING]

        return rows


async def _persist(
    posts: list[dict[str, Any]],
    themes: list[dict[str, Any]],
) -> int:
    """Replace ALL topics with the unified set, then re-point each post."""
    if not themes:
        log.warning("topics.no_themes")
        return 0

    # Aggregate per-theme posted_at range. We don't have it inside the
    # theme dict — look it up from the fetched posts.
    post_by_id: dict[UUID, dict[str, Any]] = {p["id"]: p for p in posts}

    async with SessionLocal() as session:
        # Full rebuild: drop every topic. The FK `social_posts.topic_id`
        # is ON DELETE SET NULL, so this auto-clears every post's
        # topic_id — no separate UPDATE needed.
        await session.execute(delete(Topic))

        n_persisted = 0
        for cluster_id, theme in enumerate(themes):
            post_ids = theme["post_ids"]
            stats_first: Any = None
            stats_last: Any = None
            for pid in post_ids:
                p = post_by_id.get(pid)
                if p is None:
                    continue
                posted = p.get("posted_at")
                if posted is None:
                    continue
                if stats_first is None or posted < stats_first:
                    stats_first = posted
                if stats_last is None or posted > stats_last:
                    stats_last = posted

            topic_row = Topic(
                platform=UNIFIED_PLATFORM,
                cluster_id=cluster_id,
                label=theme["label"],
                keywords=theme["keywords"],
                post_count=len(post_ids),
                first_seen=stats_first,
                last_seen=stats_last,
            )
            session.add(topic_row)
            await session.flush()  # populate topic_row.id

            for pid in post_ids:
                await session.execute(
                    update(SocialPost)
                    .where(SocialPost.id == pid)
                    .values(topic_id=topic_row.id)
                )

            n_persisted += 1

        await session.commit()

    return n_persisted


async def _run() -> int:
    """Run one unified discovery pass over the whole recent corpus."""
    posts = await _fetch_recent_posts()
    if len(posts) < MIN_POSTS_FOR_DISCOVERY:
        print(
            f"⚠ Only {len(posts)} posts in the corpus — need >= "
            f"{MIN_POSTS_FOR_DISCOVERY} for meaningful themes. Skipping."
        )
        return 0

    print(f"  Discovering themes on {len(posts)} posts (all platforms) via Gemini …")
    themes = discover_topics(posts, platform=UNIFIED_PLATFORM)

    n_themes = await _persist(posts, themes)
    n_assigned = sum(len(t["post_ids"]) for t in themes)
    n_orphan = len(posts) - n_assigned
    print(
        f"✓ Discovered {n_themes} unified themes "
        f"({n_assigned} assigned, {n_orphan} orphan)"
    )
    for t in themes:
        print(f"    {len(t['post_ids']):3d} posts · {t['label']}")
        print(f"        keywords: {', '.join(t['keywords'])}")
    return n_themes


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Discover topics over social_posts using Gemini Flash. Runs one "
            "UNIFIED pass over all platforms (no per-platform split)."
        )
    )
    # `--all` / `--platform` retained as no-ops for backward compat with
    # existing cron + muscle memory; clustering is always unified now.
    parser.add_argument("--all", action="store_true", help="(default; no-op)")
    parser.add_argument("--platform", help="(deprecated; ignored — clustering is unified)")
    parser.parse_args()

    try:
        asyncio.run(_run())
    except Exception as e:
        log.error("cluster.failed", error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
