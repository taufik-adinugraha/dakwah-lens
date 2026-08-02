"""Embed Tafsir al-Tabari (Jāmiʿ al-Bayān) — ARABIC — into Qdrant.

Sibling of `embed_tafsir.py` (Ibn Kathir). Reads `api/data/tafsir-al-tabari.json`
(produced by `download_tafsir_tabari.py`), chunks each ayah's Arabic commentary,
embeds each chunk, and upserts into the `tafsir_al_tabari` Qdrant collection.

Why ARABIC (unlike the Ibn Kathir embedder, which embeds English)
-----------------------------------------------------------------
Tafsir al-Tabari has NO complete English translation (only Cooper's partial
vol.1, copyrighted). Arabic is the only complete source. `text-embedding-3`
handles classical Arabic worse than modern English for *semantic* search — but
the Tafsir track consumes this corpus via a KEYED lookup (`scroll` filtered on
(surah, ayah), see `retrieve_tafsir_for_ayah`), NOT vector similarity, so the
vector quality is irrelevant here; the vector just lets the point live in
Qdrant. The Arabic sits in the payload for the composer to read + render
AR→ID at compose time (per the Tafsir Pekan Ini spec's translate-at-compose
model). Do NOT surface this collection in the semantic `retrieve_daleel` path.

Idempotency / resume / cost preview: identical to embed_tafsir.py — point ids
are deterministic per (surah, ayah, chunk_index); a re-run skips ids already in
Qdrant; `--dry-run` prints chunk count + cost without calling OpenAI/Qdrant.

Run
---
    cd api && uv run python -m api.scripts.embed_tafsir_tabari --dry-run
    cd api && uv run python -m api.scripts.embed_tafsir_tabari
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
        f"Unknown embedding model `{EMBEDDING_MODEL}`. Supported: {', '.join(_MODEL_DIMS)}"
    )
PRICE_PER_1M = _MODEL_PRICES_PER_1M[EMBEDDING_MODEL]
COLLECTION = "tafsir_al_tabari"

# ~4000 chars/chunk. For Arabic this is ~1.5-2k tokens (< the 8191 embed
# limit); large enough to hold one of al-Tabari's views (isnad → riwayah →
# meaning) intact, with 400-char overlap for cross-chunk context.
CHUNK_TARGET_CHARS = 4000
CHUNK_OVERLAP_CHARS = 400
EMBED_BATCH = 100

TAFSIR_JSON = Path(__file__).resolve().parents[3] / "data" / "tafsir-al-tabari.json"


def _chunk_text(text: str) -> list[str]:
    """Split Arabic tafsir text into ~CHUNK_TARGET_CHARS windows on paragraph
    boundaries; hard-slice (with overlap) any paragraph over the target."""
    text = text.strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0
    for p in paragraphs:
        if len(p) > CHUNK_TARGET_CHARS:
            if buf:
                chunks.append("\n\n".join(buf))
                buf, buf_len = [], 0
            start = 0
            step = CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS
            while start < len(p):
                chunks.append(p[start : start + CHUNK_TARGET_CHARS])
                start += step
            continue
        if buf_len + len(p) + 2 > CHUNK_TARGET_CHARS and buf:
            chunks.append("\n\n".join(buf))
            buf, buf_len = [p], len(p)
        else:
            buf.append(p)
            buf_len += len(p) + 2
    if buf:
        chunks.append("\n\n".join(buf))
    return chunks


def _build_inputs(verses: list[dict[str, object]]) -> tuple[
    list[str], list[dict[str, object]], list[int]
]:
    texts: list[str] = []
    payloads: list[dict[str, object]] = []
    ids: list[int] = []
    for v in verses:
        surah = int(v["surah"])  # type: ignore[arg-type]
        ayah = int(v["ayah"])  # type: ignore[arg-type]
        ar_full = str(v.get("ar") or "")
        chunks = _chunk_text(ar_full)
        if not chunks:
            continue
        for idx, chunk in enumerate(chunks):
            embed_text = f"Tafsir al-Tabari on Qur'an {surah}:{ayah}\n\n{chunk}"
            texts.append(embed_text)
            payloads.append(
                {
                    "surah": surah,
                    "ayah": ayah,
                    "chunk_index": idx,
                    "total_chunks": len(chunks),
                    "chunk_text_ar": chunk,
                    "ayah_text_ar": ar_full,
                    "citation": f"Tafsir al-Tabari on {surah}:{ayah}",
                    "source": "al_tabari",
                }
            )
            ids.append(surah * 1_000_000 + ayah * 1000 + idx)
    return texts, payloads, ids


def _embed_with_retry(
    openai: OpenAI, batch_texts: list[str], max_retries: int = 6
) -> tuple[list[list[float]], int]:
    delay = 5.0
    for attempt in range(max_retries):
        try:
            resp = openai.embeddings.create(model=EMBEDDING_MODEL, input=batch_texts)
            return [d.embedding for d in resp.data], resp.usage.total_tokens
        except Exception as exc:
            is_rate = "429" in str(exc) or "rate_limit" in str(exc).lower()
            is_server = any(s in str(exc) for s in ("500", "502", "503", "504"))
            if not (is_rate or is_server) or attempt == max_retries - 1:
                raise
            wait_s = min(60.0, delay)
            log.warning("embed.retry", attempt=attempt + 1, wait_s=round(wait_s, 1))
            time.sleep(wait_s)
            delay *= 2
    raise RuntimeError("_embed_with_retry exhausted")


def _existing_point_ids(qdrant: QdrantClient, ids: list[int]) -> set[int]:
    if not qdrant.collection_exists(COLLECTION):
        return set()
    found: set[int] = set()
    for i in range(0, len(ids), 1000):
        try:
            hits = qdrant.retrieve(
                collection_name=COLLECTION,
                ids=ids[i : i + 1000],
                with_payload=False,
                with_vectors=False,
            )
            found.update(int(h.id) for h in hits if h.id is not None)
        except Exception as exc:
            log.warning("embed.probe_failed", error=str(exc))
            break
    return found


def _ensure_collection(qdrant: QdrantClient) -> None:
    if qdrant.collection_exists(COLLECTION):
        info = qdrant.get_collection(COLLECTION)
        vc = info.config.params.vectors
        existing_dim = vc.size if hasattr(vc, "size") else None
        if existing_dim != VECTOR_DIM:
            qdrant.delete_collection(COLLECTION)
            log.info("embed.collection.dropped", reason="dim_mismatch")
    if not qdrant.collection_exists(COLLECTION):
        qdrant.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE),
        )
        log.info("embed.collection.created", name=COLLECTION)


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed Tafsir al-Tabari (Arabic).")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--data",
        default=str(TAFSIR_JSON),
        help="Path to tafsir-al-tabari.json (override when the default "
        "api/data mount is read-only — e.g. a writable /tmp copy on prod).",
    )
    args = parser.parse_args()

    verses = json.loads(Path(args.data).read_text(encoding="utf-8"))
    texts, payloads, ids = _build_inputs(verses)
    total_chars = sum(len(t) for t in texts)
    # char/4 UNDER-estimates Arabic tokens; the real run records resp.usage.
    est_tokens = total_chars // 4
    est_cost = est_tokens / 1_000_000 * PRICE_PER_1M

    print()
    print(f"Model        : {EMBEDDING_MODEL}")
    print(f"Vector dim   : {VECTOR_DIM}")
    print(f"Collection   : {COLLECTION}")
    print(f"Ayat         : {len(verses):,}")
    print(f"Chunks       : {len(texts):,}")
    print(f"Total chars  : {total_chars:,}")
    print(f"Est. tokens  : ~{est_tokens:,} (Arabic → real count higher)")
    print(f"Est. cost    : ~${est_cost:.2f} USD (floor; real ~1.5-2x for Arabic)")
    print()

    if args.dry_run:
        print("--dry-run — no OpenAI/Qdrant calls.")
        return

    if not settings.openai_api_key:
        print("❌ OPENAI_API_KEY not set.", file=sys.stderr)
        raise SystemExit(1)

    openai = OpenAI(api_key=settings.openai_api_key)
    qdrant = QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key)
    _ensure_collection(qdrant)

    existing = _existing_point_ids(qdrant, ids)
    if existing:
        kept = [
            (t, p, i)
            for t, p, i in zip(texts, payloads, ids, strict=True)
            if i not in existing
        ]
        texts = [k[0] for k in kept]
        payloads = [k[1] for k in kept]
        ids = [k[2] for k in kept]
        log.info("embed.resume", already=len(existing), still=len(texts))

    if not texts:
        print(f"✓ All chunks already in `{COLLECTION}`. Nothing to do.")
        return

    total_tokens = 0
    upserted = 0
    start = time.time()
    for i in range(0, len(texts), EMBED_BATCH):
        bt = texts[i : i + EMBED_BATCH]
        bi = ids[i : i + EMBED_BATCH]
        bp = payloads[i : i + EMBED_BATCH]
        vectors, batch_tokens = _embed_with_retry(openai, bt)
        total_tokens += batch_tokens
        record_usage(
            provider="openai",
            operation="corpus_embed_tafsir_tabari",
            model=EMBEDDING_MODEL,
            tokens_in=batch_tokens,
            meta={"batch_size": len(bt)},
        )
        points = [
            PointStruct(id=pid, vector=vec, payload=pl)
            for pid, vec, pl in zip(bi, vectors, bp, strict=True)
        ]
        qdrant.upsert(collection_name=COLLECTION, points=points)
        upserted += len(points)
        log.info(
            "embed.batch",
            done=i + len(bt),
            total=len(texts),
            upserted=upserted,
            tokens=total_tokens,
            elapsed_s=round(time.time() - start, 1),
        )

    actual_cost = total_tokens / 1_000_000 * PRICE_PER_1M
    print()
    print(f"✓ Embedded {upserted:,} chunks across {len(verses):,} ayat")
    print(f"  tokens used : {total_tokens:>10,}")
    print(f"  elapsed     : {time.time() - start:>10.1f} s")
    print(f"  cost (USD)  : {actual_cost:>10.4f}")
    print(f"Qdrant collection `{COLLECTION}` is ready.")


if __name__ == "__main__":
    main()
