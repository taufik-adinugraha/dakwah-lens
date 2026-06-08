"""Embed 'Aqidat al-'Awam (Ahmad al-Marzuqi) into Qdrant.

Reads `api/data/aqidah-awam.json` (produced by `download_aqidah_awam.py`),
embeds each 5-verse section with OpenAI's configured embedding model,
and upserts into the `aqidah_awam` Qdrant collection.

What we embed
-------------
Arabic only — the matn is verse-only, no translation. Each section
holds 5 consecutive verses (~250-400 chars), well below the 8k chunk
cap so no further chunking is needed.

Cost preview
------------
TBD by --dry-run. Expected ~15 sections × ~300 chars ≈ 5k tokens =
~$0.0006. Cheapest kitab in the corpus.

Run
---
    cd api && uv run python -m api.scripts.embed_aqidah_awam --dry-run
    cd api && uv run python -m api.scripts.embed_aqidah_awam
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import structlog
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from api.config import settings
from api.services.usage import record_usage

log = structlog.get_logger()

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

DATA_DIR = Path(__file__).resolve().parents[3] / "data"
JSON_PATH = DATA_DIR / "aqidah-awam.json"
COLLECTION = "aqidah_awam"
DISPLAY_NAME = "'Aqidat al-'Awam"

EMBED_BATCH = 30
UPSERT_BATCH = 200


def _ensure_collection(qdrant: QdrantClient) -> None:
    if qdrant.collection_exists(COLLECTION):
        info = qdrant.get_collection(COLLECTION)
        vectors_config = info.config.params.vectors
        existing_dim = (
            vectors_config.size if hasattr(vectors_config, "size") else None
        )
        if existing_dim != VECTOR_DIM:
            qdrant.delete_collection(COLLECTION)
            log.info("embed.collection.dropped", name=COLLECTION, reason="dim_mismatch")
    if not qdrant.collection_exists(COLLECTION):
        qdrant.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
        )
        log.info("embed.collection.created", name=COLLECTION)


def _build_inputs(
    rows: list[dict[str, object]],
) -> tuple[list[str], list[dict[str, object]], list[int]]:
    texts: list[str] = []
    payloads: list[dict[str, object]] = []
    ids: list[int] = []
    for r in rows:
        section_id = int(r["section_id"])  # type: ignore[arg-type]
        ar = str(r.get("ar") or "").strip()
        if not ar:
            continue
        title = str(r.get("title") or "")
        anchor = str(r.get("anchor") or "")

        citation_en = (
            f"'Aqidat al-'Awam — {title}" if title else "'Aqidat al-'Awam"
        )
        # Verses are short enough that the title alone makes a useful
        # retrieval header without forcing the embedder to over-weight it.
        embed_text = f"{title}\n\n{ar}" if title else ar
        payloads.append({
            "book": DISPLAY_NAME,
            "section_id": section_id,
            "anchor": anchor,
            "qism": "",
            "title": title,
            "ar": ar,
            "citation": citation_en,
            "chunk_idx": 0,
            "chunk_total": 1,
        })
        texts.append(embed_text)
        ids.append(section_id)
    return texts, payloads, ids


def _embed(
    openai: OpenAI, qdrant: QdrantClient
) -> tuple[int, int]:
    if not JSON_PATH.exists():
        raise SystemExit(
            f"Missing {JSON_PATH}. Run "
            "`uv run python -m api.scripts.download_aqidah_awam` first."
        )
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    texts, payloads, ids = _build_inputs(rows)
    if not texts:
        log.warning("embed_aqidah_awam.empty")
        return 0, 0

    _ensure_collection(qdrant)

    all_vectors: list[list[float]] = []
    tokens_used = 0
    started = time.time()
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        attempt = 0
        while True:
            try:
                resp = openai.embeddings.create(
                    model=EMBEDDING_MODEL, input=batch
                )
                break
            except Exception as exc:
                cls = type(exc).__name__
                if "RateLimit" not in cls or attempt >= 5:
                    raise
                attempt += 1
                wait = min(30, 5 * 2 ** (attempt - 1))
                log.warning(
                    "embed_aqidah_awam.rate_limit",
                    attempt=attempt,
                    wait_s=wait,
                    batch_idx=i,
                )
                time.sleep(wait)
        all_vectors.extend(d.embedding for d in resp.data)
        batch_tokens = resp.usage.total_tokens
        tokens_used += batch_tokens
        record_usage(
            provider="openai",
            operation="corpus_embed_aqidah_awam",
            model=EMBEDDING_MODEL,
            tokens_in=batch_tokens,
            meta={"batch_size": len(batch)},
        )
        log.info(
            "embed_aqidah_awam.batch",
            done=i + len(batch),
            total=len(texts),
            elapsed_s=round(time.time() - started, 1),
        )
        if i + EMBED_BATCH < len(texts):
            time.sleep(5)

    points = [
        PointStruct(id=pid, vector=vec, payload=pl)
        for pid, vec, pl in zip(ids, all_vectors, payloads, strict=True)
    ]
    for i in range(0, len(points), UPSERT_BATCH):
        qdrant.upsert(
            collection_name=COLLECTION,
            points=points[i : i + UPSERT_BATCH],
        )
    log.info("embed_aqidah_awam.done", embedded=len(points), tokens=tokens_used)
    return len(points), tokens_used


def _dry_run() -> None:
    print(f"Model        : {EMBEDDING_MODEL}")
    print(f"Vector dim   : {VECTOR_DIM}")
    print()
    if not JSON_PATH.exists():
        print(f"(missing) {JSON_PATH}")
        print("Run download_aqidah_awam first.")
        return
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    texts, _, _ = _build_inputs(rows)
    total_chars = sum(len(t) for t in texts)
    est_tokens = total_chars // 3
    est_usd = est_tokens * PRICE_PER_1M / 1_000_000
    print(f"Sections     : {len(rows)}")
    print(f"Vectors      : {len(texts)}")
    print(f"Total chars  : {total_chars:,}")
    print(f"Est. tokens  : ~{est_tokens:,}")
    print(f"Est. cost    : ~${est_usd:.4f}")
    print()
    print("First 3 sample headers (first 200 chars of each embed input):")
    for t in texts[:3]:
        print(f"  · {t[:200]!r}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print counts + cost preview; no OpenAI / Qdrant calls.",
    )
    args = parser.parse_args()

    if args.dry_run:
        _dry_run()
        return

    if not settings.openai_api_key:
        raise SystemExit("OPENAI_API_KEY not set.")
    openai = OpenAI(api_key=settings.openai_api_key)
    qdrant = QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        check_compatibility=False,
    )

    embedded, tokens = _embed(openai, qdrant)
    actual_usd = tokens * PRICE_PER_1M / 1_000_000
    print(
        f"Embedded {embedded} vectors of {DISPLAY_NAME} "
        f"({tokens:,} tokens, ${actual_usd:.4f})."
    )


if __name__ == "__main__":
    sys.exit(main())
