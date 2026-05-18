"""BERTopic clustering over `social_posts` — refreshes the `topics` table.

Why we do this client-side rather than free-text "AI summary":
- BERTopic's c-TF-IDF keyword extraction is deterministic and grounded in the
  actual posts, so we never hallucinate trends.
- Costs zero per run (no LLM call) — fits the IDR 1M/month budget.

Pipeline (per platform):
  1. Pull every post for the platform (text + id + posted_at).
  2. Embed with a small multilingual sentence-transformer (good for ID+EN mix).
  3. Fit BERTopic — UMAP → HDBSCAN → c-TF-IDF.
  4. Drop the -1 outlier cluster.
  5. Truncate `topics` for this platform, insert new rows, update each
     post's `topic_id`. The outlier posts get `topic_id = NULL`.

Usage:
    uv run python -m api.scripts.cluster_topics --platform x
    uv run python -m api.scripts.cluster_topics --platform x --min-cluster 5
    uv run python -m api.scripts.cluster_topics --all     # every platform with >= MIN_POSTS
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
from sklearn.feature_extraction.text import CountVectorizer
from sqlalchemy import delete, select, update

from api.db import SessionLocal
from api.models.social import SocialPost
from api.models.topics import Topic

log = structlog.get_logger()


# Multilingual MiniLM — 118MB, handles ID + EN well, fast enough to run on
# CPU. Heavier models (mpnet) are better quality but 5x slower; not worth the
# trade for a batch job run a few times a day.
EMBEDDING_MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"

# Common Indonesian stopwords. Standard NLP libraries don't ship an ID list;
# this short version covers the dominant noise tokens we see in scraped posts.
ID_STOPWORDS: list[str] = [
    "yang", "untuk", "dengan", "dari", "pada", "ini", "itu", "dan", "atau",
    "tidak", "tak", "akan", "agar", "saya", "kamu", "kita", "mereka", "dia",
    "ya", "iya", "deh", "sih", "kok", "aja", "saja", "biar", "kan", "lah",
    "telah", "udah", "sudah", "belum", "lagi", "juga", "punya", "bisa",
    "harus", "boleh", "kalau", "kalo", "jika", "tapi", "tetapi", "tetap",
    "karena", "sebab", "lalu", "kemudian", "supaya", "yaitu", "yakni",
    "antara", "tanpa", "tentang", "terhadap", "oleh", "seperti", "ketika",
    "saat", "waktu", "hari", "kali", "satu", "dua", "tiga", "buat", "sama",
    "dalam", "ke", "di", "se", "pun", "nya", "mu", "ku", "dong", "loh",
    "lho", "kah", "wah", "ah", "oh", "hmm", "the", "of", "to", "and", "a",
    "in", "is", "it", "you", "that", "he", "was", "for", "on", "are",
    "with", "as", "i", "his", "they", "be", "at", "one", "have", "this",
]
# Some PRD-mandated vocab to keep as features (don't filter even if common):
KEEP_TERMS = {"dakwah", "islam", "muslim", "khutbah", "ulama", "aqidah",
              "akhlaq", "muamalah", "syariah", "shalat", "puasa", "zakat"}

# BERTopic needs a minimum corpus size to be useful. Below this we skip the
# platform (it'll just produce a single noisy cluster).
MIN_POSTS_FOR_CLUSTERING = 20


async def _fetch_posts(platform: str) -> list[dict[str, Any]]:
    async with SessionLocal() as session:
        res = await session.execute(
            select(
                SocialPost.id,
                SocialPost.text,
                SocialPost.posted_at,
            ).where(SocialPost.platform == platform)
        )
        return [
            {"id": row.id, "text": row.text, "posted_at": row.posted_at}
            for row in res.all()
            if row.text
        ]


def _build_vectorizer() -> CountVectorizer:
    stopwords = [w for w in ID_STOPWORDS if w not in KEEP_TERMS]
    return CountVectorizer(
        stop_words=stopwords,
        ngram_range=(1, 2),
        min_df=2,
        max_df=0.95,
    )


def _cluster(texts: list[str], min_cluster: int) -> tuple[list[int], dict[int, list[str]]]:
    """Returns (assignments_per_doc, {cluster_id: keywords[]}).

    Imported here to keep the top-of-file lean — BERTopic + sentence-transformers
    pull ~500MB of model weights and ~2s of import time we don't want to pay on
    every CLI invocation (other scripts re-use this module).
    """
    from bertopic import BERTopic
    from hdbscan import HDBSCAN
    from sentence_transformers import SentenceTransformer
    from umap import UMAP

    log.info("cluster.embed.start", model=EMBEDDING_MODEL_NAME, n=len(texts))
    encoder = SentenceTransformer(EMBEDDING_MODEL_NAME)
    embeddings = encoder.encode(texts, show_progress_bar=False, normalize_embeddings=True)

    # Both UMAP and HDBSCAN have stochastic components — pin seeds so two
    # consecutive runs on the same corpus produce the same clusters.
    umap_model = UMAP(
        n_neighbors=min(15, max(2, len(texts) // 4)),
        n_components=min(5, max(2, len(texts) // 10)),
        min_dist=0.0,
        metric="cosine",
        random_state=42,
    )
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_cluster,
        metric="euclidean",
        cluster_selection_method="eom",
        prediction_data=True,
    )

    topic_model = BERTopic(
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        vectorizer_model=_build_vectorizer(),
        calculate_probabilities=False,
        verbose=False,
    )

    topics, _ = topic_model.fit_transform(texts, embeddings)

    # Pull the per-cluster keywords (c-TF-IDF top terms).
    keywords: dict[int, list[str]] = {}
    for cid in set(topics):
        if cid == -1:
            continue
        terms = topic_model.get_topic(cid)
        keywords[cid] = [t for t, _score in terms[:8] if t]

    return list(topics), keywords


async def _persist(
    platform: str,
    posts: list[dict[str, Any]],
    assignments: list[int],
    keywords: dict[int, list[str]],
) -> int:
    """Replace this platform's topics, then re-point each post to its new topic."""
    if not keywords:
        log.warning("cluster.no_real_clusters", platform=platform)
        return 0

    # Aggregate per-cluster stats from the assignment vector
    per_cluster: dict[int, dict[str, Any]] = {
        cid: {"count": 0, "first": None, "last": None} for cid in keywords
    }
    for post, cid in zip(posts, assignments, strict=True):
        if cid not in per_cluster:
            continue
        stats = per_cluster[cid]
        stats["count"] += 1
        posted = post["posted_at"]
        if posted is not None:
            if stats["first"] is None or posted < stats["first"]:
                stats["first"] = posted
            if stats["last"] is None or posted > stats["last"]:
                stats["last"] = posted

    async with SessionLocal() as session:
        # Clear the FK from posts first (FK is ON DELETE SET NULL so this is
        # technically unnecessary, but doing it explicitly keeps the data
        # state obvious for anyone reading the table mid-run).
        await session.execute(
            update(SocialPost)
            .where(SocialPost.platform == platform)
            .values(topic_id=None)
        )
        await session.execute(delete(Topic).where(Topic.platform == platform))

        # Insert the new topics and capture their generated UUIDs.
        cluster_to_uuid: dict[int, UUID] = {}
        for cid, kws in keywords.items():
            label = " · ".join(kws[:3]) if kws else f"cluster {cid}"
            stats = per_cluster[cid]
            topic = Topic(
                platform=platform,
                cluster_id=cid,
                label=label,
                keywords=kws,
                post_count=stats["count"],
                first_seen=stats["first"],
                last_seen=stats["last"],
            )
            session.add(topic)
            await session.flush()  # populate topic.id
            cluster_to_uuid[cid] = topic.id

        # Backfill topic_id on each post.
        for post, cid in zip(posts, assignments, strict=True):
            tid = cluster_to_uuid.get(cid)
            if tid is None:
                continue
            await session.execute(
                update(SocialPost)
                .where(SocialPost.id == post["id"])
                .values(topic_id=tid)
            )

        await session.commit()

    return len(keywords)


async def _run(platform: str, min_cluster: int) -> int:
    posts = await _fetch_posts(platform)
    if len(posts) < MIN_POSTS_FOR_CLUSTERING:
        print(
            f"⚠ Only {len(posts)} posts for `{platform}` — need >= "
            f"{MIN_POSTS_FOR_CLUSTERING} for meaningful clusters. Skipping."
        )
        return 0

    print(f"  Clustering {len(posts)} posts on `{platform}` (min cluster size {min_cluster}) …")
    texts = [p["text"] for p in posts]
    assignments, keywords = _cluster(texts, min_cluster)

    n_clusters = await _persist(platform, posts, assignments, keywords)
    n_outliers = sum(1 for a in assignments if a == -1)
    print(
        f"✓ Discovered {n_clusters} topics on `{platform}` "
        f"({len(posts) - n_outliers} clustered, {n_outliers} outliers)"
    )
    by_size = sorted(
        keywords.items(),
        key=lambda kv: -sum(1 for a in assignments if a == kv[0]),
    )
    for cid, kws in by_size:
        n = sum(1 for a in assignments if a == cid)
        print(f"    {n:3d} posts · {' · '.join(kws[:5])}")
    return n_clusters


async def _list_platforms_with_data() -> list[str]:
    async with SessionLocal() as session:
        res = await session.execute(
            select(SocialPost.platform).distinct()
        )
        return [row[0] for row in res.all()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Discover topics via BERTopic over social_posts.")
    parser.add_argument(
        "--platform",
        help="Single platform to cluster (e.g. x, tiktok, youtube, mainstream).",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Cluster every platform with enough posts.",
    )
    parser.add_argument(
        "--min-cluster",
        type=int,
        default=5,
        help="HDBSCAN min_cluster_size — smaller = more clusters, more noise (default 5).",
    )
    args = parser.parse_args()

    if not args.platform and not args.all:
        parser.error("Pass --platform <name> or --all.")

    started = datetime.now()

    async def _runner() -> None:
        platforms = (
            [args.platform] if args.platform else await _list_platforms_with_data()
        )
        for p in platforms:
            await _run(p, args.min_cluster)

    try:
        asyncio.run(_runner())
    except Exception as e:
        log.error("cluster.failed", error=str(e))
        sys.exit(1)

    print(f"\nDone in {(datetime.now() - started).total_seconds():.1f}s")


if __name__ == "__main__":
    main()
