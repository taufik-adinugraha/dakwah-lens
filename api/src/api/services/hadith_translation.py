"""Indonesian translations for hadith corpora.

The seeded kitab corpus has Indonesian text only for the Qur'an
(Kemenag). Hadith corpora (Bukhari, Muslim, Riyad as-Salihin) carry
Arabic + English only — which meant every hadith-cited flyer rendered
in English on the Bahasa-default UI.

This service translates English hadith text into Indonesian via
Gemini Flash-Lite, caching per `(corpus, hadithnumber)` in
`hadith_translations_id`. First call for a given hadith pays the
LLM cost; subsequent calls are free SELECT.

Sharia-aware prompt: faithful translation, no interpretation,
preserves the speaker, the chain ("Rasulullah bersabda…"), and the
specific words. Renders English idioms into natural Indonesian without
adding commentary.

Cost: ~Rp 5–10 per hadith on Flash-Lite. With ~50–100 distinct hadith
cited across briefings over a quarter, lifetime cost is trivial.
"""

from __future__ import annotations

import asyncio
import time

import structlog
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.config import settings
from api.models.admin import HadithTranslationId

log = structlog.get_logger(__name__)

MODEL = "gemini-2.5-flash-lite"
MAX_RETRIES = 3
RETRY_BASE_SLEEP_S = 4.0

SYSTEM_PROMPT = """Anda penerjemah teks hadits dari Bahasa Inggris ke \
Bahasa Indonesia.

Aturan:
- Terjemahkan dengan setia. Jangan tambah tafsir, jangan kurangi makna, \
jangan ringkas.
- Pertahankan nama-nama (Nabi, sahabat, perawi) seperti aslinya.
- Sebutan untuk Rasulullah ﷺ tetap "Rasulullah" atau "Nabi" sesuai \
teks sumber. Jangan ditambah salawat sendiri.
- Frasa yang lazim dalam tradisi hadits ID gunakan bentuk standar: \
"bersabda" (said), "diriwayatkan oleh" (narrated by), \
"radhiyallahu 'anhu" (may Allah be pleased with him), dst.
- Output: hanya hasil terjemahan dalam Bahasa Indonesia. \
Tanpa preamble, tanpa label, tanpa kutip pembuka/penutup.
- Jaga gaya Bahasa Indonesia yang natural dan mudah dibaca oleh \
audiens umum (santri, mahasiswa, pengurus pengajian)."""

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add to .env.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _call_gemini(text_en: str) -> str:
    """Synchronous Gemini call wrapped for the asyncio thread offload."""
    client = _get_client()
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.models.generate_content(
                model=MODEL,
                contents=text_en,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.2,
                ),
            )
            break
        except genai_errors.ServerError as exc:
            last_exc = exc
            if attempt == MAX_RETRIES - 1:
                raise
            time.sleep(RETRY_BASE_SLEEP_S * (2**attempt))
    else:
        raise RuntimeError("translate_hadith: retry loop exited") from last_exc

    out = (resp.text or "").strip()
    if not out:
        raise RuntimeError("translate_hadith: empty model response")

    from api.services.usage import gemini_output_tokens, record_usage

    usage_md = getattr(resp, "usage_metadata", None)
    record_usage(
        provider="gemini",
        operation="translate_hadith_to_id",
        model=MODEL,
        tokens_in=getattr(usage_md, "prompt_token_count", None),
        tokens_out=gemini_output_tokens(usage_md),
        meta={"chars_in": len(text_en), "chars_out": len(out)},
    )
    return out


async def translate_hadith_to_id(
    session: AsyncSession,
    corpus: str,
    hadithnumber: str,
    text_en: str,
) -> str:
    """Return the Indonesian translation of `text_en`, using the
    `hadith_translations_id` cache. On a cache miss, calls Gemini
    Flash-Lite and persists the result. Empty `text_en` short-circuits
    to "" so callers don't need to pre-check."""
    if not text_en.strip():
        return ""

    # Cache hit — most calls. Re-check the English source so a corpus
    # refresh that altered the upstream text re-triggers translation.
    row = await session.get(HadithTranslationId, (corpus, hadithnumber))
    if row is not None and row.text_en == text_en:
        return row.text_id

    # Cache miss / source-changed. Translate, then upsert.
    try:
        text_id = await asyncio.to_thread(_call_gemini, text_en)
    except Exception as exc:
        log.warning(
            "hadith_translation.translate_failed",
            corpus=corpus,
            hadithnumber=hadithnumber,
            error=str(exc)[:200],
        )
        # Don't poison the cache with a bad translation — return ""
        # so the flyer renderer falls back to English for this cycle.
        return ""

    stmt = (
        pg_insert(HadithTranslationId)
        .values(
            corpus=corpus,
            hadithnumber=hadithnumber,
            text_en=text_en,
            text_id=text_id,
            model=MODEL,
        )
        .on_conflict_do_update(
            index_elements=["corpus", "hadithnumber"],
            set_={
                "text_en": text_en,
                "text_id": text_id,
                "model": MODEL,
            },
        )
    )
    await session.execute(stmt)
    await session.commit()
    return text_id


async def enrich_daleel_translations(
    session: AsyncSession,
    hits: list[dict],
) -> list[dict]:
    """Fill `translation_id` for hadith hits whose `translation_id` is
    blank. Mutates and returns the list. Qur'an hits are untouched —
    they already carry Kemenag ID text from the corpus."""
    for hit in hits:
        if hit.get("corpus") == "quran":
            continue
        if hit.get("translation_id"):
            continue
        text_en = (hit.get("translation_en") or "").strip()
        if not text_en:
            continue
        ref_id = hit.get("ref_id", "")
        # ref_id is `{corpus}::{hadithnumber}` — split back out so the
        # cache key matches what's stored in the table.
        parts = ref_id.split("::", 1)
        if len(parts) != 2:
            continue
        corpus, hadithnumber = parts
        if not hadithnumber:
            continue
        translated = await translate_hadith_to_id(
            session, corpus, hadithnumber, text_en
        )
        if translated:
            hit["translation_id"] = translated
    return hits
