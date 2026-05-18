"""Embed the Qur'an into Qdrant for da'wah brief generation.

Reads `api/data/quran.json` (produced by `download_quran.py`), embeds each
ayah's text using OpenAI's `text-embedding-3-small`, and upserts the vector +
full payload into the `quran` Qdrant collection.

What we embed
-------------
For each ayah we build a single text input that combines the Indonesian and
English translations + a small header line with surah name and verse number.
We do NOT embed the Arabic — `text-embedding-3-small` is much weaker on
classical Arabic and we only need to RETRIEVE on user queries (which arrive
in ID or EN). The Arabic stays in the Qdrant payload so the brief renderer
can display it alongside the citation.

Idempotency
-----------
Point ids are deterministic: `surah * 1000 + ayah`. Re-running the script
upserts the same ids, so vectors are overwritten — no duplicates.

If the collection already exists with a different vector dimension, the
script drops it and recreates. Otherwise the existing collection is reused.

Cost
----
~841K tokens at $0.020/1M = ~$0.017 USD one-time. See `download_quran.py`
for the precise breakdown.

Run
---
    cd api && uv run python -m api.scripts.embed_quran
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import structlog
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from api.config import settings

log = structlog.get_logger()

# Embedding model + dimensions are configured via `EMBEDDING_MODEL` in .env.
# Vector dimension is derived from the model name (must match the collection).
EMBEDDING_MODEL = settings.embedding_model

_MODEL_DIMS: dict[str, int] = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
}
_MODEL_PRICES_PER_1M: dict[str, float] = {
    "text-embedding-3-small": 0.020,
    "text-embedding-3-large": 0.130,
}

VECTOR_DIM = _MODEL_DIMS.get(EMBEDDING_MODEL)
if VECTOR_DIM is None:
    raise SystemExit(
        f"Unknown embedding model `{EMBEDDING_MODEL}`. "
        f"Supported: {', '.join(_MODEL_DIMS)}",
    )
PRICE_PER_1M = _MODEL_PRICES_PER_1M[EMBEDDING_MODEL]
COLLECTION = "quran"
EMBED_BATCH = 200  # OpenAI tolerates much larger but smaller batches give better progress
UPSERT_BATCH = 500

QURAN_JSON = Path(__file__).resolve().parents[3] / "data" / "quran.json"
TAGS_JSON = Path(__file__).resolve().parents[3] / "data" / "quran-tags.json"


def main() -> None:
    if not settings.openai_api_key:
        print("❌ OPENAI_API_KEY is not set. Add it to .env first.", file=sys.stderr)
        raise SystemExit(1)

    log.info("embed.start", file=str(QURAN_JSON))
    verses = json.loads(QURAN_JSON.read_text(encoding="utf-8"))
    log.info("embed.loaded", count=len(verses))

    # Topic tags from `tag_quran.py`, used as embedding context to bridge
    # modern queries to classical scripture. Optional — if the file is
    # missing we still embed cleanly without tags.
    tags_by_key: dict[str, list[str]] = {}
    if TAGS_JSON.exists():
        tags_data = json.loads(TAGS_JSON.read_text(encoding="utf-8"))
        for entry in tags_data:
            key = f"{entry['surah']}:{entry['ayah']}"
            tags_by_key[key] = entry["tags"]
        log.info("embed.tags_loaded", count=len(tags_by_key))
    else:
        log.warning("embed.no_tags", path=str(TAGS_JSON))

    openai = OpenAI(api_key=settings.openai_api_key)
    qdrant = QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
    )

    # Drop + recreate if existing collection has wrong vector dimension.
    if qdrant.collection_exists(COLLECTION):
        info = qdrant.get_collection(COLLECTION)
        vectors_config = info.config.params.vectors
        existing_dim = (
            vectors_config.size if hasattr(vectors_config, "size") else None
        )
        if existing_dim != VECTOR_DIM:
            qdrant.delete_collection(COLLECTION)
            log.info("embed.collection.dropped", reason="dim_mismatch")

    if not qdrant.collection_exists(COLLECTION):
        qdrant.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
        )
        log.info("embed.collection.created", name=COLLECTION)

    # Build inputs (text to embed) and payloads (data to store).
    texts: list[str] = []
    payloads: list[dict[str, object]] = []
    ids: list[int] = []

    for v in verses:
        surah = int(v["surah"])
        ayah = int(v["ayah"])
        translit = str(v["surah_name_translit"])

        # Compose the embedded text: optional topic-tag preamble, then both
        # translations. Tags act as a semantic bridge between modern queries
        # ("raising teenagers in the digital age") and classical wording —
        # they give the embedding model lexical hooks it would otherwise miss.
        tag_line = ""
        tags = tags_by_key.get(f"{surah}:{ayah}")
        if tags:
            tag_line = f"Topics: {', '.join(tags)}\n"
        text = f"{tag_line}{v['en']}\n{v['id']}"

        texts.append(text)
        ids.append(surah * 1000 + ayah)
        payloads.append(
            {
                "surah": surah,
                "ayah": ayah,
                "surah_name_ar": v["surah_name_ar"],
                "surah_name_translit": translit,
                "surah_name_en": v["surah_name_en"],
                "arabic": v["arabic"],
                "id": v["id"],
                "en": v["en"],
                "citation_id": f"QS. {translit}: {ayah}",
                "citation_en": f"Qur'an, {translit} {surah}:{ayah}",
            }
        )

    # Embed in batches.
    all_vectors: list[list[float]] = []
    total_tokens = 0
    start = time.time()

    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        resp = openai.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        all_vectors.extend(d.embedding for d in resp.data)
        total_tokens += resp.usage.total_tokens
        elapsed = time.time() - start
        log.info(
            "embed.batch",
            done=i + len(batch),
            total=len(texts),
            tokens=total_tokens,
            elapsed_s=round(elapsed, 1),
        )

    # Upsert vectors into Qdrant in chunks.
    points = [
        PointStruct(id=pid, vector=vec, payload=pl)
        for pid, vec, pl in zip(ids, all_vectors, payloads, strict=True)
    ]

    for i in range(0, len(points), UPSERT_BATCH):
        chunk = points[i : i + UPSERT_BATCH]
        qdrant.upsert(collection_name=COLLECTION, points=chunk)
        log.info("embed.upsert", done=i + len(chunk), total=len(points))

    elapsed = time.time() - start
    cost_usd = total_tokens / 1_000_000 * PRICE_PER_1M

    print()
    print(f"✓ Embedded {len(points):,} verses")
    print(f"  tokens used : {total_tokens:>10,}")
    print(f"  elapsed     : {elapsed:>10.1f} s")
    print(f"  cost (USD)  : {cost_usd:>10.4f}")
    print()
    print(f"Qdrant collection `{COLLECTION}` is ready.")
    print(f"  URL          : {settings.qdrant_url}")
    print(f"  Vector dim   : {VECTOR_DIM}")
    print(f"  Distance     : cosine")
    print(f"  Sample point : id={ids[0]}, surah={payloads[0]['surah']}, ayah={payloads[0]['ayah']}")


if __name__ == "__main__":
    main()
