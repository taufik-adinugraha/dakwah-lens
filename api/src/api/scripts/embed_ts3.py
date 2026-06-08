"""Embed Thalathat al-Usul (Muhammad ibn Abd al-Wahhab) into Qdrant.

Reads `api/data/thalathat-al-usul.json` (produced by `download_ts3.py`),
embeds each section's Arabic text with OpenAI's configured embedding
model, and upserts into the `thalathat_al_usul` Qdrant collection.

What we embed
-------------
Arabic only. The matn is very short — typically 1 or 2 sections after
TOC merging, each well under the 8k chunk cap.

Cost preview
------------
Negligible (~10k chars). Use `--dry-run` to confirm.

Run
---
    cd api && uv run python -m api.scripts.embed_ts3 --dry-run
    cd api && uv run python -m api.scripts.embed_ts3
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
JSON_PATH = DATA_DIR / "thalathat-al-usul.json"
COLLECTION = "thalathat_al_usul"
DISPLAY_NAME = "Thalathat al-Usul"

EMBED_BATCH = 30
UPSERT_BATCH = 200
MAX_CHARS_PER_VECTOR = 8_000


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


def _chunk_text(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    sentences = [s.strip() for s in text.split(". ") if s.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for s in sentences:
        if current_len + len(s) + 2 > max_chars and current:
            chunks.append(". ".join(current) + ".")
            current = []
            current_len = 0
        if len(s) > max_chars:
            for i in range(0, len(s), max_chars):
                chunks.append(s[i : i + max_chars])
            continue
        current.append(s)
        current_len += len(s) + 2
    if current:
        chunks.append(". ".join(current) + ".")
    return chunks


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
        qism = str(r.get("qism") or "")
        anchor = str(r.get("anchor") or "")

        header_parts = [part for part in (qism, title) if part]
        header = " / ".join(header_parts) if header_parts else ""

        if qism and title and qism != title:
            citation_en = f"Thalathat al-Usul — {qism} / {title}"
        elif title:
            citation_en = f"Thalathat al-Usul — {title}"
        else:
            citation_en = "Thalathat al-Usul"

        chunks = _chunk_text(ar, MAX_CHARS_PER_VECTOR)
        for idx, chunk in enumerate(chunks):
            embed_text = f"{header}\n\n{chunk}" if header else chunk
            payloads.append({
                "book": DISPLAY_NAME,
                "section_id": section_id,
                "anchor": anchor,
                "qism": qism,
                "title": title,
                "ar": chunk,
                "citation": citation_en,
                "chunk_idx": idx,
                "chunk_total": len(chunks),
            })
            texts.append(embed_text)
            ids.append(section_id * 100 + idx)
    return texts, payloads, ids


def _embed(
    openai: OpenAI, qdrant: QdrantClient
) -> tuple[int, int]:
    if not JSON_PATH.exists():
        raise SystemExit(
            f"Missing {JSON_PATH}. Run "
            "`uv run python -m api.scripts.download_ts3` first."
        )
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    texts, payloads, ids = _build_inputs(rows)
    if not texts:
        log.warning("embed_ts3.empty")
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
                    "embed_ts3.rate_limit",
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
            operation="corpus_embed_ts3",
            model=EMBEDDING_MODEL,
            tokens_in=batch_tokens,
            meta={"batch_size": len(batch)},
        )
        log.info(
            "embed_ts3.batch",
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
    log.info("embed_ts3.done", embedded=len(points), tokens=tokens_used)
    return len(points), tokens_used


def _dry_run() -> None:
    print(f"Model        : {EMBEDDING_MODEL}")
    print(f"Vector dim   : {VECTOR_DIM}")
    print()
    if not JSON_PATH.exists():
        print(f"(missing) {JSON_PATH}")
        print("Run download_ts3 first.")
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
    print("Section list (first 80 chars of each):")
    for i, t in enumerate(texts):
        print(f"  [{i+1}] {t[:80]!r}")


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
