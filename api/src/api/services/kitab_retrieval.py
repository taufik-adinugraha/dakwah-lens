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
from api.services.usage import gemini_output_tokens, record_usage

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

# Per-corpus minimum cosine similarity for a hit to count as a usable
# daleel. Calibrated against a 11-query test set on 2026-05-21
# (strong / medium / weak / noise tiers). Scores observed:
#   - Quran tops STRONG queries: 0.36-0.60; NOISE never above 0.27.
#   - Hadith tops STRONG queries: 0.27-0.46; NOISE never above 0.19.
# Quran embeds higher than hadith for the same query because the
# translations are cleaner Bahasa text. Setting separate thresholds
# rather than a single global one — a global cut high enough to
# block Quran noise would block most legitimate hadith hits.
MIN_SCORE: dict[str, float] = {
    "quran": 0.35,
    "bukhari": 0.28,
    "muslim": 0.28,
    "riyad_as_salihin": 0.28,
    "bulugh_al_maram": 0.28,
    "tafsir_ibn_kathir": 0.28,
}

# Verse / hadith IDs that we never want to surface UNGROUNDED in a
# briefing. These passages have legitimate scholarly readings but are
# easy to misframe in a 280-character chip — and the briefing UI shows
# them stripped of tafsir context (PRD §12: promote rahma + hikmah).
# When a brief explicitly needs to address a controversial verse in
# context, that's a dedicated UX surface, not the daily auto-briefing.
#
# Observed 2026-05-21: family-segment retrieval pulled QS. An-Nisaa 4:34
# (waḍribūhunna) against a "family resilience" query — semantic match
# without tafsir framing.
DALEEL_DENYLIST: frozenset[str] = frozenset({
    "quran::4:34",
})


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


def _normalize_hit(corpus: str, hit: Any) -> dict[str, Any]:
    """Reshape a Qdrant hit into the schema we persist in
    `insights_summaries.daleel_refs` and feed to the LLM.

    Payload schema differs by corpus (inspected directly in Qdrant on
    2026-05-21 — see `embed_quran.py` / `embed_hadith.py`):

      Quran:  {surah, ayah, surah_name_translit, surah_name_en, arabic,
               id, en, citation_id, citation_en}
      Hadith: {collection, hadithnumber, book, ar, en, citation_en,
               grades}      # hadith corpora have NO Bahasa translation

    `citation` uses the human-readable Indonesian form when available
    ("QS. Al-Baqarah: 286"), falling back to English. `ref_id` is the
    stable identifier the UI uses to deep-link back into /kitab.
    """
    payload = dict(hit.payload or {})

    if corpus == "quran":
        citation = payload.get("citation_id") or payload.get("citation_en") or ""
        arabic = payload.get("arabic") or ""
        translation_id = payload.get("id") or ""
        translation_en = payload.get("en") or ""
        ref_id = (
            f"quran::{payload.get('surah','')}:{payload.get('ayah','')}"
        )
    else:
        # All four hadith corpora share the same payload shape.
        citation = payload.get("citation_en") or ""
        arabic = payload.get("ar") or ""
        # Hadith corpora aren't translated to Bahasa yet — leave id
        # blank so the UI knows to render the English text instead.
        translation_id = ""
        translation_en = payload.get("en") or ""
        ref_id = f"{corpus}::{payload.get('hadithnumber','')}"

    return {
        "corpus": corpus,
        "citation": str(citation),
        "score": float(hit.score) if hit.score is not None else None,
        "arabic": arabic,
        "translation_id": translation_id,
        "translation_en": translation_en,
        "ref_id": ref_id,
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
    below_threshold = 0
    for corpus, collection in COLLECTION_NAMES.items():
        try:
            # qdrant-client 1.18 removed `.search()` — the new API is
            # `query_points()` which returns a QueryResponse with `.points`.
            # Works against both legacy (1.12) and newer Qdrant servers.
            qr = qdrant.query_points(
                collection_name=collection,
                query=vector,
                limit=per_corpus,
                with_payload=True,
            )
            results = qr.points
        except Exception as exc:
            # Empty / missing collections are normal during rollout.
            log.debug(
                "kitab_retrieval.corpus_failed",
                corpus=corpus,
                error=str(exc),
            )
            continue
        threshold = MIN_SCORE.get(corpus, 0.30)
        for hit in results:
            if hit.score is None or hit.score < threshold:
                below_threshold += 1
                continue
            normalized = _normalize_hit(corpus, hit)
            if normalized["ref_id"] in DALEEL_DENYLIST:
                log.info(
                    "kitab_retrieval.denylisted",
                    ref_id=normalized["ref_id"],
                    score=normalized["score"],
                )
                continue
            all_hits.append(normalized)

    all_hits.sort(key=lambda h: h["score"] or -1e9, reverse=True)
    log.info(
        "kitab_retrieval.scored",
        query=query[:80],
        kept=len(all_hits),
        below_threshold=below_threshold,
        top_score=all_hits[0]["score"] if all_hits else None,
    )
    return all_hits[:limit]


def rerank_daleel(
    theme: str,
    candidates: list[dict[str, Any]],
    *,
    top_n: int = 3,
) -> list[dict[str, Any]]:
    """Re-rank embedding-retrieved daleel candidates by THEMATIC fit
    using Gemini Flash-Lite.

    Cosine similarity matches passages whose embedding tokens overlap
    the query — for "isu youth" it surfaces verses that contain `muda`
    or `pemuda` regardless of context (e.g. Quran verses about
    youthful paradise servants instead of real-world youth issues).
    This re-rank asks a cheap LLM to score the *thematic relevance*
    of each candidate to the theme described in the briefing.

    Cost: ~$0.0001 per re-rank call on `gemini-2.5-flash-lite`. Big
    quality lift on daleel selection for a tiny cost.

    Returns the top `top_n` candidates by re-rank score, preserving
    the original schema. Falls back to the input order on any error
    (defense in depth — never break the pipeline on a re-rank failure).
    """
    if not candidates or len(candidates) <= top_n:
        return candidates[:top_n]

    # Lazy import to keep this module light when re-rank isn't called.
    from google import genai
    from google.genai import types as genai_types

    if not settings.gemini_api_key:
        return candidates[:top_n]

    client = genai.Client(api_key=settings.gemini_api_key)

    numbered = "\n".join(
        f"[{i}] {c['corpus'].upper()} {c['citation']}\n"
        f"    Arab: {c['arabic'][:200]}\n"
        f"    ID:   {c['translation_id'][:300] or c['translation_en'][:300]}"
        for i, c in enumerate(candidates)
    )
    prompt = f"""Theme da'i akan diangkat pekan ini:
{theme}

Berikut adalah {len(candidates)} kandidat daleel dari Qur'an dan hadith yang ditemukan oleh pencarian embedding. Beberapa cocok dengan tema, beberapa hanya cocok pada kata kunci permukaan saja (tidak relevan secara tematik).

Pilih INDEX dari {top_n} daleel yang PALING relevan secara TEMATIK untuk tema di atas. Pertimbangkan:
- Apakah ayat/hadith ini benar-benar BERBICARA tentang tema, atau hanya berbagi kata kunci?
- Apakah seorang da'i akan mengutipnya untuk topik ini, atau itu akan terasa dipaksakan?

Kandidat:
{numbered}

Kembalikan JSON: {{"indices": [i1, i2, i3]}} dengan {top_n} index daleel terbaik, diurutkan dari yang paling relevan."""

    try:
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
                max_output_tokens=200,
                # thinking_budget=0 disables deliberation — this is a
                # "pick 3 indices from a small list" task, not a reasoning
                # problem, so deliberation adds latency + cost with no
                # quality gain. Was 256 but Gemini API now rejects values
                # in 1-511 with 400 INVALID_ARGUMENT, which silently broke
                # the rerank step on every briefing run (2026-05-21):
                # we fell back to raw cosine-sorted candidates which
                # always rank Quran higher than hadith, so every
                # briefing's daleel was Quran-only.
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
        raw = resp.text or "{}"
        import json as _json

        data = _json.loads(raw)
        indices = data.get("indices", [])
        if not isinstance(indices, list):
            raise ValueError("indices not a list")
        picked: list[dict[str, Any]] = []
        seen: set[int] = set()
        for idx in indices:
            if isinstance(idx, int) and 0 <= idx < len(candidates) and idx not in seen:
                picked.append(candidates[idx])
                seen.add(idx)
                if len(picked) >= top_n:
                    break

        usage_md = getattr(resp, "usage_metadata", None)
        record_usage(
            provider="gemini",
            operation="daleel_rerank",
            model="gemini-2.5-flash-lite",
            tokens_in=getattr(usage_md, "prompt_token_count", None),
            tokens_out=gemini_output_tokens(usage_md),
        )
        log.info(
            "kitab_retrieval.reranked",
            theme=theme[:80],
            candidates_in=len(candidates),
            picked=len(picked),
        )
        # If the LLM picked fewer than top_n (or returned garbage), fall back
        # to topping up from the original (similarity-sorted) list.
        if len(picked) < top_n:
            for c in candidates:
                if c not in picked:
                    picked.append(c)
                    if len(picked) >= top_n:
                        break
        return picked
    except Exception as exc:
        log.warning("kitab_retrieval.rerank_failed", error=str(exc))
        return candidates[:top_n]


def translate_daleel_to_id(
    daleel: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fill `translation_id` for any daleel where it's empty.

    Hadith corpora (Bukhari, Muslim, Riyad as-Salihin) arrive from
    Qdrant with only `translation_en` populated — see `_normalize_hit`
    above. The frontend `DaleelChips` component falls back to English
    when `translation_id` is empty, so on the Indonesian locale users
    were seeing English hadith translations below an Indonesian brief.

    Fix: just-in-time translation via Gemini Flash-Lite during brief
    generation. One batched call (5 daleel max) → ~$0.0001 per brief.
    Idempotent (skips entries where `translation_id` is already filled),
    so this is safe to run on Quran-only daleel lists too.

    Falls back silently to the input on any error — translation is a
    nice-to-have, not a blocker.

    Note: a fuller fix would be to re-embed the hadith corpora with
    Indonesian translations baked into the payload. That's a one-time
    backfill (translate ~30K hadith once) but cheaper at read time.
    Tracked as a follow-up; this just-in-time path covers the current
    UX gap.
    """
    needs_id = [
        (i, d.get("translation_en", ""))
        for i, d in enumerate(daleel)
        if not d.get("translation_id") and d.get("translation_en")
    ]
    if not needs_id:
        return daleel

    from google import genai
    from google.genai import types as genai_types

    if not settings.gemini_api_key:
        return daleel

    client = genai.Client(api_key=settings.gemini_api_key)

    numbered = "\n\n".join(
        f"[{idx}] {text}" for idx, text in needs_id
    )
    prompt = (
        "Terjemahkan teks hadith berikut ke Bahasa Indonesia formal "
        "yang mudah dipahami jamaah umum (BUKAN terjemahan literal "
        "kaku). Pertahankan istilah-istilah Islami baku (Rasulullah, "
        "shallallahu 'alaihi wa sallam → SAW, sahabat, dll). Jika "
        "teks berisi tanda kurung kuratorial seperti '(noun)' atau "
        "'[explanatory]', boleh diringkas atau diabaikan jika "
        "mengganggu alur Bahasa Indonesia. JANGAN tambah penjelasan "
        "atau parafrase di luar terjemahan.\n\n"
        f"{numbered}\n\n"
        "Kembalikan JSON: {\"translations\": [{\"i\": <index>, \"id\": "
        "\"<terjemahan>\"}, ...]} — tiap entri harus punya field i "
        "(integer, matching index input) dan id (string terjemahan)."
    )

    try:
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,
                max_output_tokens=2000,
                thinking_config=genai_types.ThinkingConfig(
                    thinking_budget=0,
                ),
            ),
        )
        import json as _json

        raw = resp.text or "{}"
        data = _json.loads(raw)
        entries = data.get("translations", [])
        if not isinstance(entries, list):
            raise ValueError("translations not a list")

        # Build out a copy with the new translations filled in.
        out = [dict(d) for d in daleel]
        filled = 0
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            idx = entry.get("i")
            tr = entry.get("id", "")
            if (
                isinstance(idx, int)
                and 0 <= idx < len(out)
                and isinstance(tr, str)
                and tr.strip()
            ):
                out[idx]["translation_id"] = tr.strip()
                filled += 1

        usage_md = getattr(resp, "usage_metadata", None)
        record_usage(
            provider="gemini",
            operation="daleel_translate_id",
            model="gemini-2.5-flash-lite",
            tokens_in=getattr(usage_md, "prompt_token_count", None),
            tokens_out=gemini_output_tokens(usage_md),
        )
        log.info(
            "kitab_retrieval.translated_to_id",
            needed=len(needs_id),
            filled=filled,
        )
        return out
    except Exception as exc:
        log.warning("kitab_retrieval.translate_id_failed", error=str(exc))
        return daleel
