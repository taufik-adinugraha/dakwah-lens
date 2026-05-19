"""Embed the four hadith books into Qdrant for daleel retrieval.

Reads `api/data/{bukhari,muslim,riyad-as-salihin,bulugh-al-maram}.json`
(produced by `download_hadith.py`), embeds each hadith's English text
with OpenAI's configured embedding model, and upserts into the matching
Qdrant collection.

Convention
----------
Each book gets its OWN Qdrant collection. This matches the per-corpus
model in `web/src/lib/kitab-retrieval.ts::COLLECTION_NAMES`. Adding a new
hadith book later means:
  1. Add a downloader entry in `download_hadith.py`
  2. Add a config entry in `BOOKS` below
  3. Add the corpus name + collection name on the TS side
The retrieval pipeline picks the new collection up automatically when
the next `corpus: "all"` query fires.

What we embed
-------------
English text only — the Arabic embedding is much weaker on classical
prose than modern English with `text-embedding-3-*`. Queries arrive in
ID or EN; either way the EN embedding works well as a retrieval target.
The Arabic stays in the Qdrant payload so the brief renderer can display
both sides at quote-time.

Each hadith is short (1-3 paragraphs), so we embed each as a single
vector — no chunking. To bias the embedding toward the right semantic
neighborhood, we prepend the citation as a header.

Idempotency
-----------
Point ids are the hadith's `hadithnumber` directly — collisions across
books are impossible because each book has its own collection. Re-running
overwrites existing vectors → no duplicates.

If a collection exists with a different vector dimension, the script
drops + recreates it; otherwise the existing collection is reused.

Cost preview
------------
~14,793 hadith × ~150 tokens avg ≈ 2.2M tokens (English-only).
  text-embedding-3-small ($0.020/1M)  → ~$0.04 one-time
  text-embedding-3-large ($0.130/1M)  → ~$0.29 one-time

Use `--dry-run` to see exact counts + cost preview WITHOUT calling
OpenAI or Qdrant, before committing to the real run.

Run
---
    cd api && uv run python -m api.scripts.embed_hadith --dry-run
    cd api && uv run python -m api.scripts.embed_hadith
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import structlog
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from api.config import settings

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

# Per-book config. Collection names must match COLLECTION_NAMES in
# web/src/lib/kitab-retrieval.ts so retrieval queries the right place.
EMBED_BATCH = 200
UPSERT_BATCH = 500


@dataclass(frozen=True)
class BookConfig:
    json_filename: str
    qdrant_collection: str
    display_name: str


BOOKS: list[BookConfig] = [
    BookConfig("bukhari.json", "bukhari", "Sahih al-Bukhari"),
    BookConfig("muslim.json", "muslim", "Sahih Muslim"),
    BookConfig("riyad-as-salihin.json", "riyad_as_salihin", "Riyad as-Salihin"),
    BookConfig("bulugh-al-maram.json", "bulugh_al_maram", "Bulugh al-Maram"),
]


def _ensure_collection(qdrant: QdrantClient, name: str) -> None:
    """Create or recreate the collection so its vector size matches the
    current embedding model. Avoids the silent-dim-mismatch failure mode."""
    if qdrant.collection_exists(name):
        info = qdrant.get_collection(name)
        vectors_config = info.config.params.vectors
        existing_dim = (
            vectors_config.size if hasattr(vectors_config, "size") else None
        )
        if existing_dim != VECTOR_DIM:
            qdrant.delete_collection(name)
            log.info("embed.collection.dropped", name=name, reason="dim_mismatch")
    if not qdrant.collection_exists(name):
        qdrant.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
        )
        log.info("embed.collection.created", name=name)


def _build_inputs(
    rows: list[dict[str, object]],
) -> tuple[list[str], list[dict[str, object]], list[int]]:
    """Build parallel (texts, payloads, ids) lists from a hadith JSON file.

    Skips rows with empty English text — those slip through the download
    when the source CDN didn't have a translation. Embedding an empty
    string would produce a vector that matches everything weakly.
    """
    texts: list[str] = []
    payloads: list[dict[str, object]] = []
    ids: list[int] = []
    for r in rows:
        en = str(r.get("en") or "").strip()
        if not en:
            continue
        num = r.get("hadithnumber")
        if num is None:
            continue
        # Prepend the citation as a header to bias the embedding toward
        # the right book/section. Helps when two hadith have similar
        # wording but different topical context.
        citation = str(r.get("citation_en") or "")
        embed_text = f"{citation}\n\n{en}" if citation else en
        texts.append(embed_text)
        payloads.append(
            {
                "collection": str(r.get("collection") or ""),
                "hadithnumber": int(num),
                "in_book_number": r.get("in_book_number"),
                "book": r.get("book"),
                "ar": str(r.get("ar") or ""),
                "en": en,
                "citation_en": citation,
                "grades": r.get("grades") or [],
            }
        )
        ids.append(int(num))
    return texts, payloads, ids


def _embed_book(
    book: BookConfig,
    openai: OpenAI,
    qdrant: QdrantClient,
) -> tuple[int, int]:
    """Embed one hadith book. Returns (chunks_embedded, tokens_used)."""
    path = DATA_DIR / book.json_filename
    if not path.exists():
        raise SystemExit(
            f"Missing {path}. Run `uv run python -m api.scripts.download_hadith` first."
        )
    rows = json.loads(path.read_text(encoding="utf-8"))
    texts, payloads, ids = _build_inputs(rows)
    if not texts:
        log.warning("embed.book.empty", book=book.display_name)
        return 0, 0

    _ensure_collection(qdrant, book.qdrant_collection)

    all_vectors: list[list[float]] = []
    tokens_used = 0
    started = time.time()
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i : i + EMBED_BATCH]
        resp = openai.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        all_vectors.extend(d.embedding for d in resp.data)
        tokens_used += resp.usage.total_tokens
        log.info(
            "embed.batch",
            book=book.qdrant_collection,
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
            collection_name=book.qdrant_collection,
            points=points[i : i + UPSERT_BATCH],
        )
    log.info(
        "embed.book.done",
        book=book.qdrant_collection,
        embedded=len(points),
        tokens=tokens_used,
    )
    return len(points), tokens_used


def _dry_run() -> None:
    """Print what would be embedded — chunk counts, token estimate, cost.
    No calls to OpenAI or Qdrant."""
    print(f"Model        : {EMBEDDING_MODEL}")
    print(f"Vector dim   : {VECTOR_DIM}")
    print()
    print(f"{'Book':<22} {'JSON file':<30} {'Embeddable':>10} {'~tokens':>10}")
    print("-" * 75)

    total_chunks = 0
    total_chars = 0
    for book in BOOKS:
        path = DATA_DIR / book.json_filename
        if not path.exists():
            print(f"{book.display_name:<22} {book.json_filename:<30}  (missing)")
            continue
        rows = json.loads(path.read_text(encoding="utf-8"))
        texts, _, _ = _build_inputs(rows)
        chars = sum(len(t) for t in texts)
        est_tok = chars // 4
        total_chunks += len(texts)
        total_chars += chars
        print(
            f"{book.display_name:<22} {book.json_filename:<30} {len(texts):>10,} {est_tok:>10,}"
        )

    total_tokens = total_chars // 4
    cost = total_tokens / 1_000_000 * PRICE_PER_1M
    print()
    print(f"Total embeddable hadith : {total_chunks:>10,}")
    print(f"Total chars             : {total_chars:>10,}")
    print(f"Est. tokens             : ~{total_tokens:,}")
    print(f"Est. cost (USD)         : ~${cost:.2f}")
    print()
    print("--dry-run — exiting without calling OpenAI or Qdrant.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed hadith books into Qdrant.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print chunk count + estimated cost without calling OpenAI / Qdrant.",
    )
    args = parser.parse_args()

    if args.dry_run:
        _dry_run()
        return

    if not settings.openai_api_key:
        print("❌ OPENAI_API_KEY is not set. Add it to .env first.", file=sys.stderr)
        raise SystemExit(1)

    openai = OpenAI(api_key=settings.openai_api_key)
    qdrant = QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
    )

    total_chunks = 0
    total_tokens = 0
    started = time.time()
    for book in BOOKS:
        print(f"\n→ {book.display_name} ({book.qdrant_collection})")
        n, tok = _embed_book(book, openai, qdrant)
        total_chunks += n
        total_tokens += tok
        print(f"  ✓ embedded {n:,} hadith ({tok:,} tokens)")

    elapsed = time.time() - started
    cost = total_tokens / 1_000_000 * PRICE_PER_1M
    print()
    print(f"✓ All {len(BOOKS)} books embedded")
    print(f"  hadith total : {total_chunks:>10,}")
    print(f"  tokens used  : {total_tokens:>10,}")
    print(f"  elapsed      : {elapsed:>10.1f} s")
    print(f"  cost (USD)   : {cost:>10.4f}")


if __name__ == "__main__":
    main()
