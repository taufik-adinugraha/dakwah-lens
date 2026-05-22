"""Embed Tafsir Ibn Kathir into Qdrant for daleel-supporting commentary.

Reads `api/data/tafsir-ibn-kathir.json` (produced by `download_tafsir.py`),
chunks each ayah's English commentary into retrieval-friendly windows,
embeds each chunk with OpenAI's configured embedding model, and upserts
into the `tafsir_ibn_kathir` Qdrant collection.

Why chunking
------------
Unlike a Qur'an ayah (1-3 sentences) or a hadith (1-2 paragraphs), Ibn
Kathir's commentary per ayah averages ~5,000 chars in English and tops
out around 50,000 chars (e.g. surah 1:1). Embedding a whole entry as one
vector blurs the retrieval signal — a query about a specific point in
the commentary would get matched to the entry as a whole, not the
relevant paragraph. We chunk into ~1000-token windows (4000 chars) with
paragraph boundaries preserved where possible — large enough to hold
one complete argument (narrator chain → ayah → meaning), small enough
that the embedding still localises to a coherent point.

What we embed
-------------
English text only — the Arabic commentary uses classical vocabulary that
`text-embedding-3-small`/`-large` handles much worse than its modern
English. The Arabic stays in the payload so the brief renderer can show
both sides at display time. Queries arrive in ID or EN; either way the
EN embedding works well as a retrieval target.

Idempotency
-----------
Point ids are deterministic per (surah, ayah, chunk_index). Re-running
upserts the same ids → existing vectors overwritten. If the collection
exists with a different vector dimension the script drops + recreates.

Cost preview
------------
At ~1000-token chunks, total embedded tokens equals the total tafsir
text size (~7.5M tokens for AR+EN, but we embed EN only ≈ 5.5M tokens).
  text-embedding-3-small ($0.020/1M)  → ~$0.11 one-time
  text-embedding-3-large ($0.130/1M)  → ~$0.72 one-time

Use `--dry-run` to see the actual chunk count + cost preview WITHOUT
calling the OpenAI API, before committing to the real run.

Run
---
    cd api && uv run python -m api.scripts.embed_tafsir --dry-run
    cd api && uv run python -m api.scripts.embed_tafsir
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
COLLECTION = "tafsir_ibn_kathir"

# Chunk targets in *characters* (not tokens — chars are stable, tokens
# depend on the tokenizer). ~4 chars per English token, so 4000 chars
# ≈ 1000 tokens. Chosen large enough to keep one of Ibn Kathir's
# multi-paragraph arguments intact (narrator chain → ayah → meaning →
# corollary) instead of chopping mid-argument. 400-char overlap (~100
# tokens, ~10% of chunk) preserves cross-chunk context bridges.
CHUNK_TARGET_CHARS = 4000
CHUNK_OVERLAP_CHARS = 400
# Embed in moderate batches — OpenAI tolerates much larger but smaller
# batches give better progress signal + recovery on transient failures.
EMBED_BATCH = 100
UPSERT_BATCH = 500

TAFSIR_JSON = Path(__file__).resolve().parents[3] / "data" / "tafsir-ibn-kathir.json"


def _chunk_text(text: str) -> list[str]:
    """Split English tafsir text into ~CHUNK_TARGET_CHARS windows.

    Strategy:
      1. Split on double-newline (paragraph boundary) — Ibn Kathir's EN
         text uses these between sub-sections.
      2. Greedily accumulate paragraphs until adding another would exceed
         CHUNK_TARGET_CHARS.
      3. If a single paragraph already exceeds CHUNK_TARGET_CHARS (rare,
         happens with the very long isnad chains), hard-slice it into
         windows of CHUNK_TARGET_CHARS with CHUNK_OVERLAP_CHARS overlap.
    """
    text = text.strip()
    if not text:
        return []

    # Paragraph split first; \n\n is the natural Ibn Kathir section break.
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0
    for p in paragraphs:
        if len(p) > CHUNK_TARGET_CHARS:
            # Flush whatever's in the buffer.
            if buf:
                chunks.append("\n\n".join(buf))
                buf = []
                buf_len = 0
            # Hard-slice the over-long paragraph with overlap.
            start = 0
            step = CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS
            while start < len(p):
                chunks.append(p[start : start + CHUNK_TARGET_CHARS])
                start += step
            continue
        if buf_len + len(p) + 2 > CHUNK_TARGET_CHARS and buf:
            chunks.append("\n\n".join(buf))
            buf = [p]
            buf_len = len(p)
        else:
            buf.append(p)
            buf_len += len(p) + 2
    if buf:
        chunks.append("\n\n".join(buf))

    return chunks


def _build_inputs(verses: list[dict[str, object]]) -> tuple[
    list[str], list[dict[str, object]], list[int]
]:
    """Walk every ayah, chunk its EN commentary, and emit parallel
    (texts, payloads, ids) for the embedding + upsert loop."""
    texts: list[str] = []
    payloads: list[dict[str, object]] = []
    ids: list[int] = []
    for v in verses:
        surah = int(v["surah"])  # type: ignore[arg-type]
        ayah = int(v["ayah"])  # type: ignore[arg-type]
        en_full = str(v.get("en") or "")
        ar_full = str(v.get("ar") or "")
        chunks = _chunk_text(en_full)
        if not chunks:
            continue
        for idx, chunk in enumerate(chunks):
            # Lead each embedded input with a header so the model has
            # surah/ayah context — helps with topic-bridging queries
            # ('what does Ibn Kathir say about Al-Baqarah 195?').
            embed_text = f"Tafsir Ibn Kathir on Qur'an {surah}:{ayah}\n\n{chunk}"
            texts.append(embed_text)
            payloads.append(
                {
                    "surah": surah,
                    "ayah": ayah,
                    "chunk_index": idx,
                    "total_chunks": len(chunks),
                    "chunk_text_en": chunk,
                    # Full per-ayah commentary stays in payload so a hit on
                    # one chunk can render the surrounding paragraphs and
                    # the matching AR commentary alongside.
                    "ayah_text_en": en_full,
                    "ayah_text_ar": ar_full,
                    "citation_en": f"Tafsir Ibn Kathir on {surah}:{ayah}",
                    "source": "ibn_kathir",
                }
            )
            ids.append(surah * 1_000_000 + ayah * 1000 + idx)
    return texts, payloads, ids


def _embed_with_retry(
    openai: OpenAI, batch_texts: list[str], max_retries: int = 6
) -> tuple[list[list[float]], int]:
    """Call OpenAI embeddings with explicit backoff on 429s.

    Returns `(vectors, total_tokens)` so the caller can record honest
    usage instead of the char/4 estimate.

    Why we need this beyond the SDK's built-in retry: a 1M-token-per-minute
    TPM ceiling means a 100-chunk batch at ~1000 tokens each consumes a
    tenth of the bucket per call. Six calls/minute fills it. The SDK
    catches 429 once and retries on the same second; we need to sleep
    long enough that the TPM window resets. Use the `Retry-After` hint
    when present, otherwise exponential backoff capped at 60s.
    """
    delay = 5.0
    for attempt in range(max_retries):
        try:
            resp = openai.embeddings.create(
                model=EMBEDDING_MODEL, input=batch_texts
            )
            return [d.embedding for d in resp.data], resp.usage.total_tokens
        except Exception as exc:
            is_rate_limit = "429" in str(exc) or "rate_limit" in str(exc).lower()
            is_server_error = any(
                s in str(exc) for s in ("500", "502", "503", "504")
            )
            if not (is_rate_limit or is_server_error):
                raise
            if attempt == max_retries - 1:
                raise
            wait_s = min(60.0, delay)
            log.warning(
                "embed.retry",
                attempt=attempt + 1,
                max_retries=max_retries,
                wait_s=round(wait_s, 1),
                reason="rate_limit" if is_rate_limit else "server_error",
            )
            time.sleep(wait_s)
            delay *= 2
    # Should be unreachable — raise above on last attempt.
    raise RuntimeError("_embed_with_retry exhausted without returning")


def _existing_point_ids(qdrant: QdrantClient, ids: list[int]) -> set[int]:
    """Probe Qdrant for ids already in the collection so a re-run can
    skip them. Uses retrieve() with `with_payload=False, with_vectors=False`
    — cheap metadata-only lookup. Returns the subset of `ids` already
    present (or an empty set if the collection doesn't exist yet)."""
    if not qdrant.collection_exists(COLLECTION):
        return set()
    found: set[int] = set()
    PROBE_BATCH = 1000
    for i in range(0, len(ids), PROBE_BATCH):
        chunk = ids[i : i + PROBE_BATCH]
        try:
            hits = qdrant.retrieve(
                collection_name=COLLECTION,
                ids=chunk,
                with_payload=False,
                with_vectors=False,
            )
            found.update(int(h.id) for h in hits if h.id is not None)
        except Exception as exc:
            log.warning("embed.probe_failed", error=str(exc))
            break
    return found


def _ensure_collection(qdrant: QdrantClient) -> None:
    """Create or recreate the collection so its vector size matches the
    current embedding model. Avoids the silent-dim-mismatch failure mode."""
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed Tafsir Ibn Kathir.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print chunk count + estimated cost without calling OpenAI.",
    )
    args = parser.parse_args()

    log.info("embed.start", file=str(TAFSIR_JSON), model=EMBEDDING_MODEL)
    verses = json.loads(TAFSIR_JSON.read_text(encoding="utf-8"))
    log.info("embed.loaded", ayat=len(verses))

    texts, payloads, ids = _build_inputs(verses)
    log.info(
        "embed.chunks_built",
        ayat=len(verses),
        chunks=len(texts),
        avg_chars=int(sum(len(t) for t in texts) / max(1, len(texts))),
    )

    # Estimate token volume + cost. Rough rule for English: 1 token ≈ 4
    # chars. Will be slightly off for prefixes / mixed AR script but in
    # the right order of magnitude for budget planning.
    total_chars = sum(len(t) for t in texts)
    est_tokens = total_chars // 4
    est_cost = est_tokens / 1_000_000 * PRICE_PER_1M

    print()
    print(f"Model        : {EMBEDDING_MODEL}")
    print(f"Vector dim   : {VECTOR_DIM}")
    print(f"Ayat         : {len(verses):,}")
    print(f"Chunks       : {len(texts):,}")
    print(f"Total chars  : {total_chars:,}")
    print(f"Est. tokens  : ~{est_tokens:,}")
    print(f"Est. cost    : ~${est_cost:.2f} USD")
    print()

    if args.dry_run:
        print("--dry-run — exiting without calling OpenAI or Qdrant.")
        return

    if not settings.openai_api_key:
        print("❌ OPENAI_API_KEY is not set. Add it to .env first.", file=sys.stderr)
        raise SystemExit(1)

    openai = OpenAI(api_key=settings.openai_api_key)
    qdrant = QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
    )
    _ensure_collection(qdrant)

    # Skip-already-embedded resume: if Qdrant already has a point for a
    # given (surah, ayah, chunk_index) id, drop it from this run. Saves
    # rework when picking up after a rate-limit / connection failure.
    # Idempotent re-runs cost nothing extra.
    existing_ids = _existing_point_ids(qdrant, ids)
    if existing_ids:
        before = len(texts)
        kept = [
            (t, p, i)
            for t, p, i in zip(texts, payloads, ids, strict=True)
            if i not in existing_ids
        ]
        texts = [k[0] for k in kept]
        payloads = [k[1] for k in kept]
        ids = [k[2] for k in kept]
        log.info(
            "embed.resume",
            already_in_qdrant=len(existing_ids),
            still_to_embed=len(texts),
            dropped_from_run=before - len(texts),
        )

    if not texts:
        print()
        print(f"✓ Nothing to do — all {len(existing_ids):,} chunks already in Qdrant.")
        print(f"Qdrant collection `{COLLECTION}` is ready.")
        return

    # Embed AND upsert per batch so a mid-run crash (rate-limit, network
    # blip, OOM) doesn't lose hours of work. Was previously two-phase
    # (embed-all → upsert-all); a 429 at chunk 2300/12000 left zero points
    # in Qdrant despite ~$0.25 already spent.
    total_tokens = 0
    upserted = 0
    start = time.time()
    for i in range(0, len(texts), EMBED_BATCH):
        batch_texts = texts[i : i + EMBED_BATCH]
        batch_ids = ids[i : i + EMBED_BATCH]
        batch_payloads = payloads[i : i + EMBED_BATCH]

        vectors, batch_tokens = _embed_with_retry(openai, batch_texts)
        total_tokens += batch_tokens
        # Log per batch so a mid-run crash still leaves an audit row.
        record_usage(
            provider="openai",
            operation="corpus_embed_tafsir",
            model=EMBEDDING_MODEL,
            tokens_in=batch_tokens,
            meta={"batch_size": len(batch_texts)},
        )

        points = [
            PointStruct(id=pid, vector=vec, payload=pl)
            for pid, vec, pl in zip(batch_ids, vectors, batch_payloads, strict=True)
        ]
        qdrant.upsert(collection_name=COLLECTION, points=points)
        upserted += len(points)

        elapsed = time.time() - start
        log.info(
            "embed.batch",
            done=i + len(batch_texts),
            total=len(texts),
            upserted=upserted,
            tokens=total_tokens,
            elapsed_s=round(elapsed, 1),
        )

    elapsed = time.time() - start
    actual_cost = total_tokens / 1_000_000 * PRICE_PER_1M
    print()
    print(f"✓ Embedded {upserted:,} chunks across {len(verses):,} ayat")
    print(f"  tokens used : {total_tokens:>10,}")
    print(f"  elapsed     : {elapsed:>10.1f} s")
    print(f"  cost (USD)  : {actual_cost:>10.4f}")
    print()
    print(f"Qdrant collection `{COLLECTION}` is ready.")


if __name__ == "__main__":
    main()
