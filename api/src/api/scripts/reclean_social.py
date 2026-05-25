"""One-off: re-label sentiment for an existing social platform via Gemini.

After the 2026-05-25 IndoBERT retirement, social-platform rows in the DB
still carry the OLD IndoBERT labels. A manual eval on `korupsi` X tweets
showed those labels were ~14% accurate on the positive class (sarcasm
and supportive opinion both mislabelled). This script re-runs sentiment
for every row of a given platform through the unified Gemini classifier
in `services/sentiment` and updates `sentiment_label` + `sentiment_score`.

Usage:
    uv run python -m api.scripts.reclean_social --platform x [--dry-run]

Cost: ~$0.0001 per item. Idempotent — safe to re-run.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

import structlog
from sqlalchemy import select, update

from api.db import SessionLocal
from api.models.social import SocialPost
from api.services.sentiment import classify_batch as classify_sentiment

log = structlog.get_logger()


async def _run(platform: str, dry_run: bool) -> int:
    async with SessionLocal() as session:
        res = await session.execute(
            select(SocialPost).where(SocialPost.platform == platform)
        )
        posts = res.scalars().all()

    print(f"Loaded {len(posts)} `{platform}` posts.")
    if not posts:
        return 0

    # Before-distribution snapshot for the print-out.
    before: dict[str | None, int] = {}
    for p in posts:
        before[p.sentiment_label] = before.get(p.sentiment_label, 0) + 1
    print(f"  Before: {dict(sorted(before.items(), key=lambda kv: -kv[1]))}")

    if dry_run:
        print(
            f"\n[dry-run] would re-label {len(posts)} rows via Gemini "
            f"(~${len(posts) * 0.0001:.2f}); no DB write."
        )
        return 0

    print(f"  Running Gemini sentiment on {len(posts)} posts …")
    texts = [(p.text or "") for p in posts]
    new_sentiments = classify_sentiment(texts)

    n_written = 0
    n_label_changed = 0
    n_null = 0
    after: dict[str | None, int] = {}
    async with SessionLocal() as session:
        for p, s in zip(posts, new_sentiments, strict=False):
            new_label = s.label if s is not None else None
            new_score = s.score if s is not None else None
            after[new_label] = after.get(new_label, 0) + 1
            if s is None:
                n_null += 1
            elif s.label != p.sentiment_label:
                n_label_changed += 1
            await session.execute(
                update(SocialPost)
                .where(SocialPost.id == p.id)
                .values(sentiment_label=new_label, sentiment_score=new_score)
            )
            n_written += 1
        await session.commit()

    print(
        f"\n✓ Updated {n_written} rows "
        f"({n_label_changed} sentiment flips, "
        f"{n_null} unclassified — retry cron will reprocess)."
    )
    print(f"  After: {dict(sorted(after.items(), key=lambda kv: -kv[1] if kv[1] else 0))}")
    return n_written


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Re-label sentiment for an existing social platform via Gemini. "
            "One-off cleanup after IndoBERT retirement (2026-05-25)."
        )
    )
    parser.add_argument(
        "--platform",
        required=True,
        choices=["x", "youtube", "tiktok", "instagram", "facebook"],
        help="Which platform's existing labels to overwrite.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show counts and exit without calling Gemini or writing.",
    )
    args = parser.parse_args()

    try:
        asyncio.run(_run(args.platform, args.dry_run))
    except Exception as exc:
        log.error("reclean_social.failed", error=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
