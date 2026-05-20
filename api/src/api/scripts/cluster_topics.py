"""Topic discovery over `social_posts` — refreshes the `topics` table.

Previously this ran BERTopic locally. We replaced it on 2026-05-20 with a
Gemini Flash-Lite call (see `services/topic_discovery`) after BERTopic
underperformed on short Indonesian social text — stopword leakage,
URL/outlet artifacts in keywords, and uninterpretable auto-labels like
"barat · nasional · masih".

Pipeline (per platform):
  1. Pull recent posts for the platform (text + id + posted_at).
  2. Hand them to `services.topic_discovery.discover_topics`, which
     samples ~100, asks Gemini for 5-8 themes with Indonesian labels,
     and returns `[{label, keywords, post_ids}]`.
  3. Truncate `topics` for this platform, insert new rows, update each
     post's `topic_id`. Posts not assigned to any theme get `topic_id = NULL`.

Usage:
    uv run python -m api.scripts.cluster_topics --platform x
    uv run python -m api.scripts.cluster_topics --all
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import delete, select, update

from api.db import SessionLocal
from api.models.social import SocialPost
from api.models.topics import Topic
from api.services.topic_discovery import discover_topics

log = structlog.get_logger()


# Minimum corpus size to bother running topic discovery. Below this the
# themes wouldn't be statistically meaningful — we'd just be naming a
# handful of unrelated posts.
MIN_POSTS_FOR_DISCOVERY = 20

# How many of the most-recent posts to feed the discovery service. Wider
# windows blur day-over-day theme shifts; narrower windows miss long-tail
# topics that span a few days. 500 = ~3 days of mainstream RSS or ~half
# a week of X scrapes at current cadence.
RECENT_POST_LIMIT = 500


async def _fetch_recent_posts(platform: str) -> list[dict[str, Any]]:
    async with SessionLocal() as session:
        res = await session.execute(
            select(SocialPost.id, SocialPost.text, SocialPost.posted_at)
            .where(SocialPost.platform == platform)
            .order_by(SocialPost.posted_at.desc().nulls_last())
            .limit(RECENT_POST_LIMIT)
        )
        return [
            {"id": row.id, "text": row.text, "posted_at": row.posted_at}
            for row in res.all()
            if row.text
        ]


async def _persist(
    platform: str,
    posts: list[dict[str, Any]],
    themes: list[dict[str, Any]],
) -> int:
    """Replace this platform's topics, then re-point each post to its theme."""
    if not themes:
        log.warning("topics.no_themes", platform=platform)
        return 0

    # Aggregate per-theme posted_at range. We don't have it inside the
    # theme dict — look it up from the fetched posts.
    post_by_id: dict[UUID, dict[str, Any]] = {p["id"]: p for p in posts}

    async with SessionLocal() as session:
        # Clear FKs from posts (FK is ON DELETE SET NULL so technically
        # unnecessary, but doing it explicitly keeps DB state legible).
        await session.execute(
            update(SocialPost)
            .where(SocialPost.platform == platform)
            .values(topic_id=None)
        )
        await session.execute(delete(Topic).where(Topic.platform == platform))

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
                platform=platform,
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


async def _run(platform: str) -> int:
    posts = await _fetch_recent_posts(platform)
    if len(posts) < MIN_POSTS_FOR_DISCOVERY:
        print(
            f"⚠ Only {len(posts)} posts for `{platform}` — need >= "
            f"{MIN_POSTS_FOR_DISCOVERY} for meaningful themes. Skipping."
        )
        return 0

    print(f"  Discovering themes on {len(posts)} `{platform}` posts via Gemini …")
    themes = discover_topics(posts, platform=platform)

    n_themes = await _persist(platform, posts, themes)
    n_assigned = sum(len(t["post_ids"]) for t in themes)
    n_orphan = len(posts) - n_assigned
    print(
        f"✓ Discovered {n_themes} themes on `{platform}` "
        f"({n_assigned} assigned, {n_orphan} orphan)"
    )
    for t in themes:
        print(f"    {len(t['post_ids']):3d} posts · {t['label']}")
        print(f"        keywords: {', '.join(t['keywords'])}")
    return n_themes


async def _list_platforms_with_data() -> list[str]:
    async with SessionLocal() as session:
        res = await session.execute(select(SocialPost.platform).distinct())
        return [row[0] for row in res.all()]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Discover topics over social_posts using Gemini Flash-Lite."
    )
    parser.add_argument(
        "--platform",
        help="Single platform to cluster (e.g. x, tiktok, youtube, mainstream).",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Cluster every platform with enough posts.",
    )
    args = parser.parse_args()

    if not args.platform and not args.all:
        parser.error("Pass --platform <name> or --all")

    async def runner() -> None:
        platforms = (
            [args.platform] if args.platform else await _list_platforms_with_data()
        )
        for p in platforms:
            try:
                await _run(p)
            except Exception as exc:
                log.error("cluster.failed", platform=p, error=str(exc))

    try:
        asyncio.run(runner())
    except Exception as e:
        log.error("cluster.failed", error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
