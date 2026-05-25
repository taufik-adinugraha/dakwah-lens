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
  - Gemini sentiment prompt was retuned 2026-05-21 with arrest-verb /
    political-courtesy / personal-achievement / death rules; ~16% of
    existing mainstream labels disagree with the new prompt (97% bench).

This script re-runs THREE classifiers over every already-classified post:
  1. relevance (9-category, mean-of-top-2 aggregate) — all platforms
  2. dawah_opportunity (focused "would a da'i use this") — all platforms
  3. sentiment — MAINSTREAM ONLY. We could re-sentiment X / YT / IG too
     now that Gemini is the universal classifier (2026-05-25 IndoBERT
     retirement), but that would re-bill on every historical social
     row. Run a separate one-off if you want that.

Usage:
    uv run python -m api.scripts.backfill_relevance               # all
    uv run python -m api.scripts.backfill_relevance --limit 50    # smoke
    uv run python -m api.scripts.backfill_relevance --days 30     # 30d
    uv run python -m api.scripts.backfill_relevance --skip-sentiment
    uv run python -m api.scripts.backfill_relevance --dry-run     # count

Cost: ~$0.0003 per post (relevance + opportunity + sentiment). At ~500
mainstream posts that's ~$0.15. Idempotent — safe to re-run.
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
from api.services.sentiment import classify_batch as classify_sentiment

CHUNK = 50  # posts per loop iteration; classifiers batch to 10/Gemini call


async def run(
    *,
    days: int | None,
    limit: int | None,
    dry_run: bool,
    skip_sentiment: bool,
    redo_done: bool,
) -> None:
    async with SessionLocal() as session:
        stmt = select(
            SocialPost.id,
            SocialPost.platform,
            SocialPost.external_id,
            SocialPost.text,
        ).where(SocialPost.categories.is_not(None))
        if not redo_done:
            # Resume mode: skip rows that already have the new opportunity
            # score (i.e. previous backfill run got to them). Lets us
            # re-run after a transient Gemini 502 without redoing work.
            stmt = stmt.where(SocialPost.dawah_opportunity.is_(None))
        if days is not None:
            cutoff = datetime.now(UTC) - timedelta(days=days)
            stmt = stmt.where(SocialPost.posted_at >= cutoff)
        stmt = stmt.order_by(SocialPost.posted_at.desc())
        if limit:
            stmt = stmt.limit(limit)
        rows = (await session.execute(stmt)).all()

    sentiment_eligible = sum(1 for r in rows if r.platform == "mainstream")
    print(
        f"Backfilling {len(rows)} posts "
        f"(sentiment on {sentiment_eligible} mainstream rows, "
        f"skip_sentiment={skip_sentiment}, redo_done={redo_done}, "
        f"dry_run={dry_run}) …"
    )
    if dry_run:
        return

    done = 0
    failed_chunks = 0
    for start in range(0, len(rows), CHUNK):
        chunk = rows[start : start + CHUNK]
        texts = [r.text or "" for r in chunk]

        # Re-classify relevance + opportunity for every row in the chunk.
        # Wrap in try/except so a transient Gemini outage on one chunk
        # (we hit a 502 mid-run on 2026-05-21) doesn't kill the whole
        # backfill. The skip-resume logic above lets a re-run pick up
        # exactly the chunks that failed.
        try:
            relevances = classify_relevance(texts)
            opportunities = classify_opportunity(texts)
        except Exception as exc:
            failed_chunks += 1
            print(
                f"  ⚠ chunk {start}-{start + len(chunk)} failed: "
                f"{type(exc).__name__}: {exc}"
            )
            continue

        # Sentiment scoped to mainstream to avoid re-billing on every
        # historical social row. Build a parallel-aligned list with
        # None gaps for non-mainstream rows.
        # Same defensive try/except as relevance — sentiment outage shouldn't
        # block relevance/opportunity from landing.
        sentiments: list[object | None] = [None] * len(chunk)
        if not skip_sentiment:
            mainstream_idx = [i for i, r in enumerate(chunk) if r.platform == "mainstream"]
            mainstream_texts = [texts[i] for i in mainstream_idx]
            if mainstream_texts:
                try:
                    scored = classify_sentiment(mainstream_texts)
                    for li, s in zip(mainstream_idx, scored, strict=False):
                        sentiments[li] = s
                except Exception as exc:
                    print(
                        f"  ⚠ sentiment chunk {start}-{start + len(chunk)} failed: "
                        f"{type(exc).__name__}: {exc} — preserving existing labels"
                    )

        async with SessionLocal() as session:
            for i, row in enumerate(chunk):
                values = {
                    "dawah_relevance": relevances[i].dawah_relevance,
                    "dawah_opportunity": opportunities[i],
                    "categories": relevances[i].categories,
                }
                s = sentiments[i]
                if s is not None:
                    values["sentiment_label"] = getattr(s, "label", None)
                    values["sentiment_score"] = getattr(s, "score", None)
                await session.execute(
                    update(SocialPost)
                    .where(SocialPost.id == row.id)
                    .values(**values)
                )
            await session.commit()

        done += len(chunk)
        print(f"  {done}/{len(rows)} done")

    if failed_chunks > 0:
        print(
            f"⚠ {failed_chunks} chunk(s) failed (transient Gemini errors). "
            f"Re-run to pick up where it stopped — already-done rows are skipped."
        )
    print("✓ backfill complete")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=None, help="restrict to last N days")
    parser.add_argument("--limit", type=int, default=None, help="cap total rows")
    parser.add_argument(
        "--skip-sentiment",
        action="store_true",
        help="re-classify relevance + opportunity only; leave sentiment_label intact",
    )
    parser.add_argument(
        "--redo-done",
        action="store_true",
        help="also re-process rows that already have dawah_opportunity set (default: skip them)",
    )
    parser.add_argument("--dry-run", action="store_true", help="count rows only")
    args = parser.parse_args()
    asyncio.run(
        run(
            days=args.days,
            limit=args.limit,
            dry_run=args.dry_run,
            skip_sentiment=args.skip_sentiment,
            redo_done=args.redo_done,
        )
    )


if __name__ == "__main__":
    main()
