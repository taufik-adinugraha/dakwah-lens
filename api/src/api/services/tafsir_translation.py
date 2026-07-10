"""Ibn Kathir tafsir EN→ID translation cache (Tafsir Pekan Ini track).

The `tafsir_ibn_kathir` Qdrant corpus stores exegesis in ENGLISH only, so
the manual "Tafsir Pekan Ini" flow renders it to Bahasa at compose-time and
persists the result keyed by (surah, ayah). Direct analogue of
`hadith_translation.lookup_cached_translations` / `cache_translation`.

Zero Gemini, zero Claude-API — the ID rendering is produced by Claude in
chat during composition; these helpers only read/write the cache.
"""

from __future__ import annotations

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.admin import TafsirTranslationId


async def lookup_cached_tafsir(
    session: AsyncSession,
    hits: list[dict],
) -> tuple[list[dict], list[dict]]:
    """Read-only cache lookup for Ibn Kathir tafsir renderings.

    For each hit (shape from `retrieve_tafsir_for_ayah`: {surah, ayah,
    tafsir_en, ...}), fill `hit["tafsir_id"]` from the cache when a row
    exists AND its stored `text_en` matches the current `tafsir_en` (a
    staleness guard — if the upstream English changed, re-translate).

    Returns (hits-with-cache-hits-filled, misses). Each miss carries what
    Claude needs to render in chat: {"citation", "surah", "ayah", "text_en"}.
    After Claude supplies the ID text, persist via `cache_tafsir(...)`.
    """
    misses: list[dict] = []
    for hit in hits:
        if hit.get("tafsir_id"):
            continue
        text_en = (hit.get("tafsir_en") or "").strip()
        if not text_en:
            continue
        surah = hit.get("surah")
        ayah = hit.get("ayah")
        if surah is None or ayah is None:
            continue
        row = await session.get(TafsirTranslationId, (int(surah), int(ayah)))
        if row is not None and row.text_en == text_en:
            hit["tafsir_id"] = row.text_id
        else:
            misses.append(
                {
                    "citation": hit.get("citation"),
                    "surah": int(surah),
                    "ayah": int(ayah),
                    "text_en": text_en,
                }
            )
    return hits, misses


async def cache_tafsir(
    session: AsyncSession,
    surah: int,
    ayah: int,
    text_en: str,
    text_id: str,
    *,
    model: str = "claude-manual",
) -> None:
    """Write-through cache for a Claude-supplied tafsir ID rendering.

    Upsert on (surah, ayah) so re-saves update rather than duplicate.
    `text_en` is stored for the staleness guard in `lookup_cached_tafsir`.
    """
    stmt = (
        pg_insert(TafsirTranslationId)
        .values(
            surah=int(surah),
            ayah=int(ayah),
            text_en=text_en,
            text_id=text_id,
            model=model,
        )
        .on_conflict_do_update(
            index_elements=["surah", "ayah"],
            set_={"text_en": text_en, "text_id": text_id, "model": model},
        )
    )
    await session.execute(stmt)
    await session.commit()
