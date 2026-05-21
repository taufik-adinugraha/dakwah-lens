"""Ingest X (Twitter) posts → classify → store.

Phase-1 end-to-end ingestion CLI:
  1. Scrape `--limit` recent tweets matching `--query` via Apify
  2. Insert into `social_posts` (upserting on (platform, external_id))
  3. Run IndoBERT sentiment over the texts
  4. Run Gemini relevance classifier over the texts
  5. Update each row with sentiment + categories + relevance

The script is idempotent: re-running the same `--query --limit` upserts
the same rows by `(platform, external_id)` and re-classifies them.

Run:
    cd api && uv run python -m api.scripts.ingest_x --query "#dakwah" --limit 20
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from api.db import SessionLocal
from api.models.social import SocialPost
from api.services.apify import scrape_x
from api.services.relevance import (
    classify_batch as classify_relevance,
    classify_opportunity_batch as classify_opportunity,
)
from api.services.sentiment import classify_batch as classify_sentiment

log = structlog.get_logger()

PLATFORM = "x"


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _normalize(item: dict[str, Any]) -> dict[str, Any] | None:
    """Map an Apify tweet object into our `SocialPost` columns.

    The exact field names vary by actor; we look at the most common ones.
    """
    text = item.get("text") or item.get("full_text") or item.get("content")
    if not text:
        return None  # skip anything without text body

    external_id = (
        item.get("id_str")
        or item.get("id")
        or item.get("tweetId")
        or item.get("conversationId")
    )
    if not external_id:
        return None

    # Twitter actors disagree on the author shape:
    #   - Some put a plain string at `username` / `screen_name`
    #   - kaitoeasyapi puts a full USER object at `author`
    #   - Others nest it under `user`
    # Probe each, prefer the username/screen_name field if found.
    def _extract_author(it: dict[str, Any]) -> str | None:
        for key in ("author", "user"):
            value = it.get(key)
            if isinstance(value, dict):
                handle = (
                    value.get("userName")
                    or value.get("username")
                    or value.get("screen_name")
                    or value.get("name")
                )
                if handle:
                    return str(handle)[:255]
        for key in ("username", "screen_name", "userName"):
            v = it.get(key)
            if isinstance(v, str) and v:
                return v[:255]
        return None

    author = _extract_author(item)

    url = (
        item.get("url")
        or item.get("twitterUrl")
        or (
            f"https://x.com/{author}/status/{external_id}"
            if author
            else None
        )
    )

    posted_at = _coerce_datetime(
        item.get("created_at")
        or item.get("createdAt")
        or item.get("date")
    )

    return {
        "platform": PLATFORM,
        "external_id": str(external_id),
        "author": str(author) if author else None,
        "url": url,
        "text": str(text),
        "language": item.get("lang") or item.get("language"),
        "posted_at": posted_at,
        "raw_payload": item,
    }


async def _run(query: str, limit: int) -> int:
    # 1. Scrape via Apify
    result = scrape_x(query, max_items=limit)
    print(
        f"✓ Apify pulled {len(result.items)} tweets "
        f"(cost ${result.cost_usd or 0:.4f}, {result.duration_s or 0:.1f}s)"
    )
    if not result.items:
        return 0

    # 2. Normalize + dedup
    rows = [r for r in (_normalize(it) for it in result.items) if r]
    if not rows:
        print("⚠ no items had usable text")
        return 0
    print(f"  Normalized {len(rows)} usable rows")

    # 3. Classify (sentiment + relevance + opportunity)
    texts = [r["text"] for r in rows]
    print("  Running IndoBERT sentiment …")
    sentiments = classify_sentiment(texts)
    print("  Running Gemini relevance + opportunity …")
    relevances = classify_relevance(texts)
    opportunities = classify_opportunity(texts)

    for row, s, r, o in zip(
        rows, sentiments, relevances, opportunities, strict=False
    ):
        row["sentiment_label"] = s.label
        row["sentiment_score"] = s.score
        row["dawah_relevance"] = r.dawah_relevance
        row["dawah_opportunity"] = o
        row["categories"] = r.categories

    # 4. Upsert into Postgres
    async with SessionLocal() as session:
        stmt = (
            insert(SocialPost)
            .values(rows)
            .on_conflict_do_update(
                index_elements=["platform", "external_id"],
                set_={
                    "text": insert(SocialPost).excluded.text,
                    "sentiment_label": insert(SocialPost).excluded.sentiment_label,
                    "sentiment_score": insert(SocialPost).excluded.sentiment_score,
                    "dawah_relevance": insert(SocialPost).excluded.dawah_relevance,
                    "dawah_opportunity": insert(SocialPost).excluded.dawah_opportunity,
                    "categories": insert(SocialPost).excluded.categories,
                    "raw_payload": insert(SocialPost).excluded.raw_payload,
                },
            )
        )
        await session.execute(stmt)
        await session.commit()

    # 5. Quick post-run summary
    async with SessionLocal() as session:
        result = await session.execute(
            select(SocialPost)
            .where(SocialPost.platform == PLATFORM)
            .order_by(SocialPost.dawah_relevance.desc().nulls_last())
            .limit(5)
        )
        top = result.scalars().all()

    print(f"\n✓ Stored {len(rows)} posts. Top {len(top)} by da'wah relevance:")
    for p in top:
        cat = max(
            (p.categories or {}).items(), key=lambda kv: kv[1], default=("?", 0.0)
        )
        print(
            f"  {(p.dawah_relevance or 0):.2f}  "
            f"[{p.sentiment_label or '?':<8}]  "
            f"@{p.author or '?':<15}  "
            f"({cat[0]} {cat[1]:.2f})  "
            f"{(p.text or '')[:80]}"
        )

    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest X (Twitter) posts.")
    parser.add_argument(
        "--query", required=True, help="X search query (hashtag, keyword, etc.)"
    )
    parser.add_argument(
        "--limit", type=int, default=20, help="Max tweets to ingest (default 20)"
    )
    args = parser.parse_args()

    try:
        count = asyncio.run(_run(args.query, args.limit))
    except Exception as e:
        log.error("ingest.failed", error=str(e))
        sys.exit(1)
    if count == 0:
        sys.exit(2)


if __name__ == "__main__":
    main()
