"""One-off backfill: re-clean HTML from mainstream-RSS posts + re-classify.

Existing mainstream rows were normalized before `_strip_html` landed, so a
chunk of them have HTML tags + entities (e.g. Republika's `<img>` lede,
`&nbsp;`, `&ndash;`) embedded in `posts.text`. That noise biased IndoBERT
toward neutral. This script:

    1. Pulls every `platform='mainstream'` row.
    2. Rebuilds `text` from `raw_payload` via the updated normalizer
       (which now strips HTML).
    3. UPDATEs `text` for any row that changed.
    4. Re-runs IndoBERT on the cleaned text for `language='id'` rows
       whose text changed, and UPDATEs sentiment fields too.
    5. Leaves relevance/categories alone — Gemini cost money, and HTML
       noise affects relevance much less than sentiment (Gemini handles
       light markup gracefully).

Idempotent — running it twice is a no-op since the second pass's
`_strip_html` output equals the stored text.

    uv run python -m api.scripts.reclean_mainstream [--dry-run]
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

    changed: list[tuple[SocialPost, str]] = []
    for p in posts:
        if not isinstance(p.raw_payload, dict):
            continue
        rebuilt = normalize_mainstream(p.raw_payload)
        if rebuilt is None:
            continue
        new_text = rebuilt["text"]
        if new_text != p.text:
            changed.append((p, new_text))

    print(f"  {len(changed)} rows have HTML noise to strip.")

    if dry_run:
        for p, new_text in changed[:5]:
            print("─" * 60)
            print(f"id={p.id}  outlet={p.author}")
            print(f"  BEFORE: {(p.text or '')[:200]!r}")
            print(f"  AFTER : {new_text[:200]!r}")
        print(f"\n[dry-run] would update {len(changed)} rows; no DB write.")
        return len(changed)

    if not changed:
        print("Nothing to do.")
        return 0

    # Re-classify ID posts whose text changed. Non-ID rows still get their
    # text updated below but skip the model — sentiment for non-ID is NULL.
    id_changed_idx = [
        i for i, (p, _) in enumerate(changed) if (p.language or "").startswith("id")
    ]
    id_texts = [changed[i][1] for i in id_changed_idx]
    print(f"  Running IndoBERT on {len(id_texts)} ID posts …")
    new_sentiments = classify_sentiment(id_texts) if id_texts else []
    sentiment_by_changed_idx: dict[int, object] = dict(
        zip(id_changed_idx, new_sentiments, strict=False)
    )

    n_written = 0
    async with SessionLocal() as session:
        for idx, (post, new_text) in enumerate(changed):
            values: dict[str, object] = {"text": new_text}
            s = sentiment_by_changed_idx.get(idx)
            if s is not None:
                values["sentiment_label"] = s.label  # type: ignore[attr-defined]
                values["sentiment_score"] = s.score  # type: ignore[attr-defined]
            await session.execute(
                update(SocialPost).where(SocialPost.id == post.id).values(**values)
            )
            n_written += 1
        await session.commit()

    print(f"\n✓ Updated {n_written} rows ({len(id_texts)} re-classified).")
    return n_written


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Strip HTML from existing mainstream posts + re-run IndoBERT."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without writing anything.",
    )
    args = parser.parse_args()

    try:
        asyncio.run(_run(args.dry_run))
    except Exception as exc:
        log.error("reclean.failed", error=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
