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
from api.services.youtube import scrape_youtube, scrape_youtube_uploads

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
    platform: str,
    query: str,
    limit: int,
    *,
    actor_id: str | None = None,
    channel_id: str | None = None,
) -> int:
    # 1. Scrape — two YouTube paths: channel-based (whitelisted uploads
    # via playlistItems.list, 1 quota unit) and keyword search.list
    # (100 units). `channel_id` opts into the cheap, curated path; when
    # NULL we fall back to the legacy `_scrape()` dispatcher which
    # routes by `platform`.
    if channel_id and platform == "youtube":
        result = scrape_youtube_uploads(
            channel_id, max_items=limit, channel_name=query or None
        )
    else:
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

    # 3. Detect language per row (cheap, no API call — always re-run).
    texts = [r["text"] for r in rows]
    languages = [detect_lang(t) for t in texts]
    for row, lang in zip(rows, languages, strict=False):
        row["language"] = lang

    # 3a. Look up rows we've already classified — RSS feeds carry items
    # for ~24h and beat fires every 2h, so a naive re-classify burns
    # ~80% of Gemini calls on items already in the DB. Skip the LLM for
    # any row whose `categories` is already populated; we'll still upsert
    # so text/body improvements land, but with the cached scores intact.
    external_ids = [r["external_id"] for r in rows]
    async with SessionLocal() as session:
        existing_res = await session.execute(
            select(
                SocialPost.external_id,
                SocialPost.sentiment_label,
                SocialPost.sentiment_score,
                SocialPost.dawah_relevance,
                SocialPost.categories,
            ).where(
                SocialPost.platform == platform,
                SocialPost.external_id.in_(external_ids),
                SocialPost.categories.is_not(None),
            )
        )
        cached: dict[str, tuple[str | None, float | None, float | None, dict]] = {
            eid: (label, score, rel, cats)
            for (eid, label, score, rel, cats) in existing_res.all()
        }
    fresh_indices = [
        i for i, r in enumerate(rows) if r["external_id"] not in cached
    ]
    fresh_texts = [texts[i] for i in fresh_indices]
    fresh_languages = [languages[i] for i in fresh_indices]
    overlap_pct = (
        round(100.0 * len(cached) / len(rows), 1) if rows else 0.0
    )
    # Structured log for offline analysis: if overlap_pct stays high
    # (>50%) on a given (platform, query) we're either burning Apify
    # spend on dupes or our max_items cap is too conservative. Aggregate
    # via `grep ingest.dedup_stats` on worker logs.
    log.info(
        "ingest.dedup_stats",
        platform=platform,
        query=query,
        scraped=len(rows),
        cached=len(cached),
        new=len(fresh_indices),
        overlap_pct=overlap_pct,
    )
    print(
        f"  Classifier skip: {len(cached)}/{len(rows)} already classified "
        f"({overlap_pct}% overlap), running on {len(fresh_indices)} new items …"
    )

    # Dispatch sentiment by platform AND language, on FRESH items only:
    #   - mainstream            → Gemini news-valence (event-valence
    #                             prompt, IndoBERT misfires on news).
    #   - else, ID language     → IndoBERT (free, on-device, well-tuned
    #                             for Indonesian tweets/captions).
    #   - else, non-ID language → Gemini Flash-Lite fallback.
    sentiment_by_index: dict[int, object] = {}
    if fresh_texts:
        if platform == "mainstream":
            print(f"  Running Gemini news-sentiment on {len(fresh_texts)} posts …")
            fresh_sentiments = classify_news_sentiment(fresh_texts)
            for idx, s in zip(fresh_indices, fresh_sentiments, strict=False):
                sentiment_by_index[idx] = s
        else:
            id_local = [
                i for i, lang in enumerate(fresh_languages) if lang == "id"
            ]
            non_id_local = [
                i for i, lang in enumerate(fresh_languages) if lang != "id"
            ]
            id_texts = [fresh_texts[i] for i in id_local]
            non_id_texts = [fresh_texts[i] for i in non_id_local]
            print(
                f"  IndoBERT on {len(id_texts)} ID posts, "
                f"Gemini fallback on {len(non_id_texts)} non-ID posts …"
            )
            id_sentiments = classify_sentiment(id_texts) if id_texts else []
            non_id_sentiments = (
                classify_news_sentiment(non_id_texts) if non_id_texts else []
            )
            for li, s in zip(id_local, id_sentiments, strict=False):
                sentiment_by_index[fresh_indices[li]] = s
            for li, s in zip(non_id_local, non_id_sentiments, strict=False):
                sentiment_by_index[fresh_indices[li]] = s

        # Gemini relevance handles ID + EN natively.
        print("  Running Gemini relevance …")
        fresh_relevances = classify_relevance(fresh_texts)
    else:
        fresh_relevances = []

    relevance_by_index = {
        idx: r for idx, r in zip(fresh_indices, fresh_relevances, strict=False)
    }

    for i, row in enumerate(rows):
        if row["external_id"] in cached:
            label, score, rel, cats = cached[row["external_id"]]
            row["sentiment_label"] = label
            row["sentiment_score"] = score
            row["dawah_relevance"] = rel
            row["categories"] = cats
        else:
            s = sentiment_by_index.get(i)
            r = relevance_by_index.get(i)
            row["sentiment_label"] = getattr(s, "label", None)
            row["sentiment_score"] = getattr(s, "score", None)
            row["dawah_relevance"] = getattr(r, "dawah_relevance", None)
            row["categories"] = getattr(r, "categories", None)

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
