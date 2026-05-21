"""One-off backfill: re-score classified posts with the 2026-05-21 prompts.

Why this exists:
  - `dawah_relevance` was computed with `max(categories.values())`, which
    collapsed to 3 buckets {0.0, 0.5, 1.0} in production and produced 100+
    posts tied at the top with no within-tier ordering.
  - The new pipeline (1) rewrites the system prompt to ask for da'wah
    substance not topical overlap, (2) aggregates as mean-of-top-2, and
    (3) adds a focused `dawah_opportunity` second-pass score.
  - The migration left `dawah_opportunity = NULL` on existing rows. The UI
    falls back to the old `dawah_relevance` for them, which is broken.

This script re-runs BOTH classifiers (relevance + opportunity) over every
already-classified post and overwrites both columns.

Usage:
    uv run python -m api.scripts.backfill_relevance              # all rows
    uv run python -m api.scripts.backfill_relevance --limit 50   # smoke
    uv run python -m api.scripts.backfill_relevance --days 30    # last 30d
    uv run python -m api.scripts.backfill_relevance --dry-run    # preview

Cost: ~$0.0002 per post (relevance + opportunity together). At 500 posts
that's ~$0.10. Idempotent — safe to re-run.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from api.db import SessionLocal
from api.models.social import SocialPost
from api.services.relevance import (
    classify_batch as classify_relevance,
)
from api.services.relevance import (
    classify_opportunity_batch as classify_opportunity,
)

CHUNK = 50  # posts per loop iteration; relevance.py internally re-batches to 10/Gemini call


async def run(*, days: int | None, limit: int | None, dry_run: bool) -> None:
    async with SessionLocal() as session:
        stmt = select(
            SocialPost.id, SocialPost.external_id, SocialPost.text
        ).where(SocialPost.categories.is_not(None))
        if days is not None:
            cutoff = datetime.now(UTC) - timedelta(days=days)
            stmt = stmt.where(SocialPost.posted_at >= cutoff)
        stmt = stmt.order_by(SocialPost.posted_at.desc())
        if limit:
            stmt = stmt.limit(limit)
        rows = (await session.execute(stmt)).all()

    print(f"Backfilling {len(rows)} posts (dry_run={dry_run}) …")
    if dry_run:
        return

    done = 0
    for start in range(0, len(rows), CHUNK):
        chunk = rows[start : start + CHUNK]
        texts = [r.text or "" for r in chunk]

        # Re-classify both signals. Each helper batches internally
        # (MAX_BATCH=10 per Gemini call) and pre-filters short / gossip
        # rows to zero, so this stays within the Flash-Lite per-minute
        # rate limit.
        relevances = classify_relevance(texts)
        opportunities = classify_opportunity(texts)

        async with SessionLocal() as session:
            for row, rel, opp in zip(chunk, relevances, opportunities, strict=False):
                await session.execute(
                    update(SocialPost)
                    .where(SocialPost.id == row.id)
                    .values(
                        dawah_relevance=rel.dawah_relevance,
                        dawah_opportunity=opp,
                        categories=rel.categories,
                    )
                )
            await session.commit()

        done += len(chunk)
        print(f"  {done}/{len(rows)} done")

    print("✓ backfill complete")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=None, help="restrict to last N days")
    parser.add_argument("--limit", type=int, default=None, help="cap total rows")
    parser.add_argument("--dry-run", action="store_true", help="count rows only")
    args = parser.parse_args()
    asyncio.run(run(days=args.days, limit=args.limit, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
