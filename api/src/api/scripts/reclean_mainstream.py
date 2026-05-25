"""One-off backfill: clean mainstream-RSS posts + relabel sentiment with Gemini.

This script does two things on every `platform='mainstream'` row:

    1. Re-runs the normalizer (`normalize_mainstream`) so the stored
       `text` is HTML-stripped + entity-decoded. Idempotent — already-
       clean rows aren't touched.

    2. Re-runs sentiment via the unified Gemini Flash-Lite classifier
       (`services/sentiment`). The previous IndoBERT-based labels were
       ~95% neutral on news (wrong tool: IndoBERT was trained on
       tweets/reviews) and need a full rollback, not just on rows
       whose text changed. Cost is negligible (~$0.0001/item).

Relevance + categories are left as-is — Gemini already handled those,
and HTML noise doesn't materially affect category scoring.

    uv run python -m api.scripts.reclean_mainstream [--dry-run]

Idempotent: re-running picks up the same Gemini scores (modulo temperature
0.1 jitter) and writes the same rows. Safe to run after deploys.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

import structlog
from sqlalchemy import select, update

from api.db import SessionLocal
from api.models.social import SocialPost
from api.services.normalizers import normalize_mainstream
from api.services.sentiment import classify_batch as classify_sentiment

log = structlog.get_logger()


async def _run(dry_run: bool) -> int:
    async with SessionLocal() as session:
        res = await session.execute(
            select(SocialPost).where(SocialPost.platform == "mainstream")
        )
        posts = res.scalars().all()

    print(f"Loaded {len(posts)} mainstream posts.")
    if not posts:
        return 0

    # Step 1: figure out the right text for each row (HTML-stripped).
    text_by_id: dict[str, str] = {}
    n_text_changed = 0
    for p in posts:
        if not isinstance(p.raw_payload, dict):
            text_by_id[str(p.id)] = p.text or ""
            continue
        rebuilt = normalize_mainstream(p.raw_payload)
        new_text = rebuilt["text"] if rebuilt else (p.text or "")
        text_by_id[str(p.id)] = new_text
        if new_text != (p.text or ""):
            n_text_changed += 1

    print(f"  {n_text_changed} rows need HTML-stripped text.")

    if dry_run:
        print("\n[dry-run] sentiment label distribution will be relabeled "
              "by Gemini for ALL rows; printing 3 text diffs and exiting.\n")
        shown = 0
        for p in posts:
            new = text_by_id[str(p.id)]
            if new != (p.text or "") and shown < 3:
                print("─" * 60)
                print(f"id={p.id}  outlet={p.author}  current_label={p.sentiment_label}")
                print(f"  BEFORE: {(p.text or '')[:200]!r}")
                print(f"  AFTER : {new[:200]!r}")
                shown += 1
        print(f"\n[dry-run] would re-classify {len(posts)} rows + "
              f"update text on {n_text_changed}; no DB write.")
        return n_text_changed

    # Step 2: call Gemini once for every row's (cleaned) text.
    print(f"  Running Gemini sentiment on {len(posts)} posts …")
    texts = [text_by_id[str(p.id)] for p in posts]
    new_sentiments = classify_sentiment(texts)

    # Step 3: write everything back. We always update text (idempotent
    # if unchanged) + sentiment fields. Relevance is left alone.
    # A `None` element in new_sentiments means the chunk hit a sustained
    # Gemini 5xx and retries were exhausted — we write NULL labels so
    # `retry_failed_sentiment` can pick them up on its 2-hourly cron.
    n_written = 0
    n_label_changed = 0
    n_null = 0
    async with SessionLocal() as session:
        for p, s in zip(posts, new_sentiments, strict=False):
            new_text = text_by_id[str(p.id)]
            values: dict[str, object | None] = {
                "text": new_text,
                "sentiment_label": s.label if s is not None else None,
                "sentiment_score": s.score if s is not None else None,
            }
            if s is None:
                n_null += 1
            elif s.label != p.sentiment_label:
                n_label_changed += 1
            await session.execute(
                update(SocialPost).where(SocialPost.id == p.id).values(**values)
            )
            n_written += 1
        await session.commit()

    print(
        f"\n✓ Updated {n_written} rows  "
        f"({n_text_changed} text changes, {n_label_changed} sentiment flips, "
        f"{n_null} unclassified — retry cron will reprocess)."
    )
    return n_written


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill mainstream posts: HTML-strip text + relabel sentiment "
            "via Gemini Flash-Lite."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without writing or calling Gemini.",
    )
    args = parser.parse_args()

    try:
        asyncio.run(_run(args.dry_run))
    except Exception as exc:
        log.error("reclean.failed", error=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
