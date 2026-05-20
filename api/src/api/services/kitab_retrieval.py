"""Python-side kitab retrieval for the insights-summary briefings.

Mirror of `web/src/lib/kitab-retrieval.ts` — embeds a query via OpenAI,
searches each Qdrant corpus, merges, returns top-K hits across all
corpora. We need this on the Python side because the Celery
`generate_insights_summary` task runs there and must hand retrieved
daleel to the Gemini narrator (PRD §12: every Islamic reference in a
briefing must be RETRIEVED, never freely generated).

Kept narrow on purpose — only what the summary service needs. If a
future Python flow needs the full feature set (per-corpus topK, locale
filtering, etc.), promote and extend.
"""

from __future__ import annotations

from typing import Any

import structlog
from openai import OpenAI
from qdrant_client import QdrantClient

from api.config import settings
from api.services.usage import record_usage

log = structlog.get_logger()

# Collection names match the embed scripts in api/src/api/scripts/embed_*.py
COLLECTION_NAMES: dict[str, str] = {
    "quran": "quran",
    "bukhari": "bukhari",
    "muslim": "muslim",
    "riyad_as_salihin": "riyad_as_salihin",
    "bulugh_al_maram": "bulugh_al_maram",
    "tafsir_ibn_kathir": "tafsir_ibn_kathir",
}


_openai_client: OpenAI | None = None
_qdrant_client: QdrantClient | None = None


def _get_openai() -> OpenAI:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _get_qdrant() -> QdrantClient:
    global _qdrant_client
    if _qdrant_client is None:
        _qdrant_client = QdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            check_compatibility=False,
        )
    return _qdrant_client


def _build_ref_id(corpus: str, payload: dict[str, Any]) -> str:
    """Stable identifier the UI can use to link back to a kitab passage."""
    citation = (
        payload.get("citation")
        or payload.get("ref")
        or f"{payload.get('surah', '?')}:{payload.get('ayah', '?')}"
    )
    return f"{corpus}::{citation}"


def _normalize_hit(corpus: str, hit: Any) -> dict[str, Any]:
    """Reshape a Qdrant hit into the schema we persist in
    `insights_summaries.daleel_refs` (and feed to the LLM).

    Different corpora use slightly different payload keys — Quran has
    surah + ayah + translation_id / translation_en; hadith has citation
    + matn_translation_id / matn_translation_en. Normalize here so the
    LLM and UI see one shape.
    """
    payload = dict(hit.payload or {})
    citation = (
        payload.get("citation")
        or payload.get("ref")
        or f"QS {payload.get('surah_name', payload.get('surah'))} {payload.get('ayah','')}"
    )
    arabic = payload.get("arabic") or payload.get("matn_arabic") or ""
    translation_id = (
        payload.get("translation_id")
        or payload.get("matn_translation_id")
        or payload.get("text_id")
        or ""
    )
    translation_en = (
        payload.get("translation_en")
        or payload.get("matn_translation_en")
        or payload.get("text_en")
        or ""
    )
    return {
        "corpus": corpus,
        "citation": str(citation),
        "score": float(hit.score) if hit.score is not None else None,
        "arabic": arabic,
        "translation_id": translation_id,
        "translation_en": translation_en,
        "ref_id": _build_ref_id(corpus, payload),
    }


def retrieve_daleel(
    query: str, *, limit: int = 5, per_corpus: int = 3
) -> list[dict[str, Any]]:
    """Embed `query`, search every kitab collection, merge top hits.

    Args:
      query: Indonesian or English natural-language theme description.
        e.g. "rising concern about pinjol and economic injustice".
      limit: max hits returned across all corpora after merge.
      per_corpus: how many hits to fetch from each corpus before merging.
        Used to give non-Quran corpora a fair shot even when Quran
        consistently scores higher on average.

    Returns at most `limit` hits sorted by similarity score. Each hit
    is a dict suitable for both LLM context and DB persistence — see
    `_normalize_hit` for shape.
    """
    if not query.strip():
        return []

    openai = _get_openai()
    try:
        emb = openai.embeddings.create(
            model=settings.embedding_model, input=query
        )
        vector = emb.data[0].embedding
        record_usage(
            provider="openai",
            operation="embedding",
            model=settings.embedding_model,
            tokens_in=getattr(emb.usage, "total_tokens", None),
        )
    except Exception as exc:
        log.warning("kitab_retrieval.embed_failed", error=str(exc))
        return []

    qdrant = _get_qdrant()
    all_hits: list[dict[str, Any]] = []
    for corpus, collection in COLLECTION_NAMES.items():
        try:
            results = qdrant.search(
                collection_name=collection,
                query_vector=vector,
                limit=per_corpus,
                with_payload=True,
            )
        except Exception as exc:
            # Empty / missing collections are normal during rollout.
            log.debug(
                "kitab_retrieval.corpus_failed",
                corpus=corpus,
                error=str(exc),
            )
            continue
        for hit in results:
            all_hits.append(_normalize_hit(corpus, hit))

    all_hits.sort(key=lambda h: h["score"] or -1e9, reverse=True)
    return all_hits[:limit]
