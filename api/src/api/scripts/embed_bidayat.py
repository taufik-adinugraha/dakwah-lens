"""Embed Bidayatul Hidayah (Imam al-Ghazali) into Qdrant.

Reads `api/data/bidayat-al-hidayah.json` (produced by `download_bidayat.py`),
embeds each section's Arabic text with OpenAI's configured embedding model,
and upserts into the `bidayat_al_hidayah` Qdrant collection.

Convention
----------
Matches the existing per-corpus model in `kitab_retrieval.py::COLLECTION_NAMES`
and `web/src/lib/kitab-retrieval.ts`. A new collection per kitab.

What we embed
-------------
Arabic only for now (decision 2026-06-08). Translation (ID/EN) will be
added in a later pass — when that lands we re-embed with `AR\\nEN\\nID`
concatenated, same approach Quran/Sahih Muslim use. `text-embedding-3-large`
is multilingual so cross-lingual retrieval from ID/EN queries still works
in the meantime.

To bias the embedding toward the right semantic neighborhood we prepend
the qism (top-level part) + chapter title as a header. Same trick
`embed_hadith.py` uses with the citation header.

Chunking
--------
Bidayat sections average ~1.6k chars and max ~2.2k — all comfortably
under the 4000-char chunk threshold the tafsir embedder uses, so each
section becomes ONE vector. No chunking. If later kitabs need it we'll
copy the embed_tafsir.py windowing logic.

Idempotency
-----------
Point ids are deterministic from `section_id`. Re-running overwrites
existing vectors → no duplicates. If the collection exists with a
different vector dimension (e.g. switching embedding model) the script
drops + recreates it.

Cost preview
------------
~46k Arabic chars ≈ 15k tokens × $0.130/1M = ~$0.002 one-time at
text-embedding-3-large. Use `--dry-run` to confirm the count before
calling the API.

Run
---
    cd api && uv run python -m api.scripts.embed_bidayat --dry-run
    cd api && uv run python -m api.scripts.embed_bidayat
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
JSON_PATH = DATA_DIR / "bidayat-al-hidayah.json"
COLLECTION = "bidayat_al_hidayah"
DISPLAY_NAME = "Bidayatul Hidayah"

EMBED_BATCH = 50  # 28 sections fit in one batch — generous headroom.
UPSERT_BATCH = 200


def _ensure_collection(qdrant: QdrantClient) -> None:
    """Create or recreate `COLLECTION` so its vector size matches the
    current embedding model. Avoids silent dim-mismatch failures."""
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
    """Build parallel (texts, payloads, ids) lists from the JSON.

    Embed text = "<qism>\\n<title>\\n\\n<ar body>" — the header lifts
    retrieval for queries that name the broad topic (qism) or the
    specific chapter (title), in addition to the body content.
    """
    texts: list[str] = []
    payloads: list[dict[str, object]] = []
    ids: list[int] = []
    for r in rows:
        section_id = int(r["section_id"])  # type: ignore[arg-type]
        ar = str(r.get("ar") or "").strip()
        if not ar:
            continue
        title = str(r.get("title") or "")
        qism = str(r.get("qism") or "")
        anchor = str(r.get("anchor") or "")

        header_parts = [part for part in (qism, title) if part]
        embed_text = (
            f"{' / '.join(header_parts)}\n\n{ar}" if header_parts else ar
        )

        # Citation rendered in the chip: prefer a clean book + chapter
        # title; qism gives sub-section context if reader wants more.
        citation_en = (
            f"Bidayatul Hidayah — {title}" if title else "Bidayatul Hidayah"
        )

        payloads.append({
            "book": DISPLAY_NAME,
            "section_id": section_id,
            "anchor": anchor,
            "qism": qism,
            "title": title,
            "ar": ar,
            "citation": citation_en,
            # `translation_id` / `translation_en` deliberately omitted —
            # this corpus is AR-only until a translation pass lands.
            # The TS-side `normalizeHit()` falls back to "" for missing
            # translation fields, same as Bukhari/Riyad pre-translation.
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
            "`uv run python -m api.scripts.download_bidayat` first."
        )
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    texts, payloads, ids = _build_inputs(rows)
    if not texts:
        log.warning("embed_bidayat.empty")
        return 0, 0

    _ensure_collection(qdrant)

    all_vectors: list[list[float]] = []
    tokens_used = 0
    started = time.time()
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        resp = openai.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        all_vectors.extend(d.embedding for d in resp.data)
        batch_tokens = resp.usage.total_tokens
        tokens_used += batch_tokens
        record_usage(
            provider="openai",
            operation="corpus_embed_bidayat",
            model=EMBEDDING_MODEL,
            tokens_in=batch_tokens,
            meta={"batch_size": len(batch)},
        )
        log.info(
            "embed_bidayat.batch",
            done=i + len(batch),
            total=len(texts),
            elapsed_s=round(time.time() - started, 1),
        )

    points = [
        PointStruct(id=pid, vector=vec, payload=pl)
        for pid, vec, pl in zip(ids, all_vectors, payloads, strict=True)
    ]
    for i in range(0, len(points), UPSERT_BATCH):
        qdrant.upsert(
            collection_name=COLLECTION,
            points=points[i : i + UPSERT_BATCH],
        )
    log.info("embed_bidayat.done", embedded=len(points), tokens=tokens_used)
    return len(points), tokens_used


def _dry_run() -> None:
    print(f"Model        : {EMBEDDING_MODEL}")
    print(f"Vector dim   : {VECTOR_DIM}")
    print()
    if not JSON_PATH.exists():
        print(f"(missing) {JSON_PATH}")
        print("Run download_bidayat first.")
        return
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    texts, _, _ = _build_inputs(rows)
    total_chars = sum(len(t) for t in texts)
    # Arabic with harakat tokenizes denser than English. ~3 chars/token
    # is a conservative estimate for vocalized Arabic.
    est_tokens = total_chars // 3
    est_usd = est_tokens * PRICE_PER_1M / 1_000_000
    print(f"Sections     : {len(texts)}")
    print(f"Total chars  : {total_chars:,}")
    print(f"Est. tokens  : ~{est_tokens:,}")
    print(f"Est. cost    : ~${est_usd:.4f}")
    print()
    print("First 3 sample headers (first 100 chars of each embed input):")
    for t in texts[:3]:
        print(f"  · {t[:100]!r}")


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
        f"Embedded {embedded} sections of {DISPLAY_NAME} "
        f"({tokens:,} tokens, ${actual_usd:.4f})."
    )


if __name__ == "__main__":
    sys.exit(main())
