"""Unified social-media ingestion CLI.

Single entry point for all platforms. Pick `--platform x|tiktok|instagram|facebook`,
a `--query` (hashtag or keyword), and `--limit`. The pipeline:

    1. scrape via Apify (`services/apify.scrape_<platform>`)
    2. normalize per platform (`services/normalizers.NORMALIZERS[platform]`)
    3. classify sentiment (IndoBERT, batched)
    4. classify relevance (Gemini Flash-Lite, 9 da'wah categories, batched)
    5. upsert into `social_posts` on `(platform, external_id)`
    6. print top-5 by relevance for a quick sanity check

Examples:
    uv run python -m api.scripts.ingest --platform x         --query "#dakwah" --limit 20
    uv run python -m api.scripts.ingest --platform tiktok    --query "dakwah"  --limit 20
    uv run python -m api.scripts.ingest --platform instagram --query "dakwah"  --limit 20
"""

from __future__ import annotations

import argparse
import asyncio
import sys

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from api.db import SessionLocal
from api.models.social import SocialPost
from api.services.apify import (
    ScrapeResult,
    scrape_facebook,
    scrape_instagram,
    scrape_tiktok,
    scrape_x,
)
from api.services.language import detect_lang
from api.services.news_sentiment import classify_batch as classify_news_sentiment
from api.services.normalizers import NORMALIZERS
from api.services.relevance import classify_batch as classify_relevance
from api.services.rss import scrape_mainstream
from api.services.sentiment import classify_batch as classify_sentiment
from api.services.youtube import scrape_youtube

log = structlog.get_logger()


SCRAPERS = {
    "x": scrape_x,
    "tiktok": scrape_tiktok,
    "instagram": scrape_instagram,
    "facebook": scrape_facebook,
    "youtube": scrape_youtube,
    "mainstream": scrape_mainstream,
}


def _scrape(
    platform: str, query: str, limit: int, *, actor_id: str | None = None
) -> ScrapeResult:
    fn = SCRAPERS.get(platform)
    if fn is None:
        raise ValueError(f"Unsupported platform: {platform}")
    # Only a subset of scrapers accept an actor_id override (the Apify
    # ones — RSS / YT use no Apify actor). Pass through where supported,
    # silently ignore where not.
    if actor_id is not None and platform == "tiktok":
        return fn(query, max_items=limit, actor_id=actor_id)
    return fn(query, max_items=limit)


async def _run(
    platform: str, query: str, limit: int, *, actor_id: str | None = None
) -> int:
    # 1. Scrape
    result = _scrape(platform, query, limit, actor_id=actor_id)
    cost = result.cost_usd or 0
    dur = result.duration_s or 0
    print(f"✓ Apify pulled {len(result.items)} items (cost ${cost:.4f}, {dur:.1f}s)")
    if not result.items:
        return 0

    # 2. Normalize per platform
    normalize = NORMALIZERS[platform]
    rows = [r for r in (normalize(it) for it in result.items) if r]
    if not rows:
        print(f"⚠ {len(result.items)} items returned, but none had usable text — skipping")
        return 0
    print(f"  Normalized {len(rows)}/{len(result.items)} usable rows")

    # 3. Detect language per row, then dispatch classifiers accordingly.
    texts = [r["text"] for r in rows]
    languages = [detect_lang(t) for t in texts]
    for row, lang in zip(rows, languages, strict=False):
        # Detection result wins over whatever the per-platform normalizer
        # might have set (e.g. mainstream RSS hardcoded "id" before this
        # change). Stored so the analytics surface can filter by language.
        row["language"] = lang

    # Dispatch sentiment by platform:
    #   - mainstream  → Gemini news-valence (IndoBERT was trained on
    #                   tweets/reviews and reads speaker-emotion, not
    #                   event-valence — produces ~95% neutral on news).
    #   - else        → IndoBERT, ID-only (for EN/other the model
    #                   produces confident noise, so we leave sentiment
    #                   NULL on non-ID posts).
    sentiment_by_index: dict[int, object] = {}
    if platform == "mainstream":
        print(f"  Running Gemini news-sentiment on {len(texts)} posts …")
        news_sentiments = classify_news_sentiment(texts)
        sentiment_by_index = dict(enumerate(news_sentiments))
    else:
        id_indices = [i for i, lang in enumerate(languages) if lang == "id"]
        id_texts = [texts[i] for i in id_indices]
        n_id, n_other = len(id_texts), len(texts) - len(id_texts)
        print(
            f"  Running IndoBERT sentiment on {n_id}/{len(texts)} ID posts "
            f"({n_other} non-ID skipped) …"
        )
        id_sentiments = classify_sentiment(id_texts) if id_texts else []
        sentiment_by_index = dict(
            zip(id_indices, id_sentiments, strict=False)
        )

    # Gemini relevance handles ID + EN natively, so it runs on everything.
    print("  Running Gemini relevance …")
    relevances = classify_relevance(texts)

    for i, (row, r) in enumerate(zip(rows, relevances, strict=False)):
        s = sentiment_by_index.get(i)
        row["sentiment_label"] = getattr(s, "label", None)
        row["sentiment_score"] = getattr(s, "score", None)
        row["dawah_relevance"] = r.dawah_relevance
        row["categories"] = r.categories

    # 4. Upsert
    async with SessionLocal() as session:
        stmt = (
            insert(SocialPost)
            .values(rows)
            .on_conflict_do_update(
                index_elements=["platform", "external_id"],
                set_={
                    "text": insert(SocialPost).excluded.text,
                    "language": insert(SocialPost).excluded.language,
                    "sentiment_label": insert(SocialPost).excluded.sentiment_label,
                    "sentiment_score": insert(SocialPost).excluded.sentiment_score,
                    "dawah_relevance": insert(SocialPost).excluded.dawah_relevance,
                    "categories": insert(SocialPost).excluded.categories,
                    "region": insert(SocialPost).excluded.region,
                    "raw_payload": insert(SocialPost).excluded.raw_payload,
                },
            )
        )
        await session.execute(stmt)
        await session.commit()

    # 5. Summary — top 5 of this platform by relevance
    async with SessionLocal() as session:
        res = await session.execute(
            select(SocialPost)
            .where(SocialPost.platform == platform)
            .order_by(SocialPost.dawah_relevance.desc().nulls_last())
            .limit(5)
        )
        top = res.scalars().all()

    print(f"\n✓ Stored {len(rows)} posts. Top {len(top)} on `{platform}` by relevance:")
    for p in top:
        cats = p.categories or {}
        cat = max(cats.items(), key=lambda kv: kv[1], default=("?", 0.0))
        author = (p.author or "?")[:15]
        snippet = (p.text or "").replace("\n", " ")[:75]
        print(
            f"  {(p.dawah_relevance or 0):.2f}  "
            f"[{(p.sentiment_label or '?'):<8}]  "
            f"@{author:<15}  "
            f"({cat[0]} {cat[1]:.2f})  "
            f"{snippet}"
        )

    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest social posts from any platform.")
    parser.add_argument(
        "--platform",
        required=True,
        choices=sorted(SCRAPERS.keys()),
        help="Which platform to ingest from.",
    )
    parser.add_argument(
        "--query",
        required=True,
        help="Hashtag, keyword, or platform-specific search expression.",
    )
    parser.add_argument(
        "--limit", type=int, default=20, help="Max items to ingest (default 20)."
    )
    args = parser.parse_args()

    try:
        count = asyncio.run(_run(args.platform, args.query, args.limit))
    except Exception as e:
        log.error("ingest.failed", error=str(e))
        sys.exit(1)
    if count == 0:
        sys.exit(2)


if __name__ == "__main__":
    main()
