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

import re
from typing import Any

import structlog
from openai import OpenAI
from qdrant_client import QdrantClient

from api.config import settings
from api.services.usage import gemini_output_tokens, record_usage

log = structlog.get_logger()

# Unicode ranges for Arabic harakat (tashkeel) — fathah, kasrah,
# dhammah, sukun, shadda, tanwin variants, plus the Quran-specific
# marks. A du'a is "recitable" if the density of harakat-to-letters
# is at least RECITABLE_HARAKAT_MIN — without these marks, non-Arab
# readers can't pronounce the text.
_HARAKAT_RE = re.compile(r"[ً-ٰٟۖ-ۭ]")
_ARABIC_LETTER_RE = re.compile(r"[ء-يٱ-ۓ]")
RECITABLE_HARAKAT_MIN = 0.30
"""Drop adhkar where harakat density falls below this threshold —
calibrated empirically: Quran / Bukhari / Muslim entries cluster
around 0.75-0.85, Riyad as-Salihin entries sit at 0.00. A 0.30 floor
keeps the well-marked corpora and rejects the unmarked ones with
generous headroom."""


def _is_recitable_du_a(arabic: str) -> bool:
    """Return True iff the Arabic text carries enough harakat marks
    for a non-Arab reader to actually recite it. Empty / non-Arabic
    text → False (caller will treat as ineligible for adhkar slot)."""
    if not arabic or not arabic.strip():
        return False
    letters = len(_ARABIC_LETTER_RE.findall(arabic))
    marks = len(_HARAKAT_RE.findall(arabic))
    if letters < 8:
        # Too short to evaluate meaningfully — accept by default so we
        # don't accidentally reject short Quran verses with low absolute
        # mark counts.
        return marks > 0
    return (marks / letters) >= RECITABLE_HARAKAT_MIN

# Collection names match the embed scripts in api/src/api/scripts/embed_*.py
COLLECTION_NAMES: dict[str, str] = {
    "quran": "quran",
    "bukhari": "bukhari",
    "muslim": "muslim",
    "riyad_as_salihin": "riyad_as_salihin",
    "bulugh_al_maram": "bulugh_al_maram",
    "tafsir_ibn_kathir": "tafsir_ibn_kathir",
    "bidayat_al_hidayah": "bidayat_al_hidayah",
    "al_umm": "al_umm",
    "al_bidayah_wan_nihayah": "al_bidayah_wan_nihayah",
    "nashaihul_ibad": "nashaihul_ibad",
    "fiqh_as_sunnah": "fiqh_as_sunnah",
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
    # AR-only kitabs (Bidayat, Al-Umm, Al-Bidayah, Nashaih, Fiqh as-Sunnah)
    # all sit at 0.28 — dropped from 0.30 on 2026-06-06 after a 10-theme
    # probe (see probe_kitab_scores.py) found AR-only kitabs averaging
    # ~0.38 top-1 vs Quran's ~0.55 even with trilingual ID+EN+AR query
    # enrichment. Bidayat short (~46k chars / 28 sections); Al-Umm large
    # (~5.7M / 1,332); Al-Bidayah historical narrative (~3.7M / 2,529);
    # Nashaih small akhlak corpus (~77k / 34); Fiqh as-Sunnah modern
    # topical fiqh (~900k / 866). 0.28 keeps comfortable margin above
    # the highest off-topic score observed (~0.27) while admitting more
    # of the 0.28-0.30 band of borderline-relevant content.
    "bidayat_al_hidayah": 0.28,
    "al_umm": 0.28,
    "al_bidayah_wan_nihayah": 0.28,
    "nashaihul_ibad": 0.28,
    "fiqh_as_sunnah": 0.28,
}

# AR-only kitabs get a +2 boost on the per-corpus quota — they score
# ~0.15 lower in absolute cosine than translation-bearing corpora (per
# the 2026-06-06 probe), so more candidates pre-threshold improves their
# chances of clearing MIN_SCORE and landing in the brief. Lifts
# proportionally with whatever `per_corpus` the caller passes (default
# 3 → 5, prod briefing's 6 → 8).
_AR_ONLY_CORPORA: frozenset[str] = frozenset({
    "bidayat_al_hidayah",
    "al_umm",
    "al_bidayah_wan_nihayah",
    "nashaihul_ibad",
    "fiqh_as_sunnah",
})


def _per_corpus_for(corpus: str, default: int) -> int:
    """Effective per-corpus topK after the AR-only boost."""
    return default + 2 if corpus in _AR_ONLY_CORPORA else default

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
    elif corpus in (
        "bidayat_al_hidayah",
        "al_umm",
        "al_bidayah_wan_nihayah",
        "nashaihul_ibad",
        "fiqh_as_sunnah",
    ):
        # AR-only kitab payload (2026-06-08). `translation_id` /
        # `translation_en` deliberately empty — re-embed pass will
        # backfill them when translations land.
        _default_citations = {
            "bidayat_al_hidayah": "Bidayatul Hidayah",
            "al_umm": "Al-Umm",
            "al_bidayah_wan_nihayah": "Al-Bidayah wan-Nihayah",
            "nashaihul_ibad": "Nashaihul Ibad",
            "fiqh_as_sunnah": "Fiqh as-Sunnah",
        }
        default_citation = _default_citations[corpus]
        citation = payload.get("citation") or default_citation
        arabic = payload.get("ar") or ""
        translation_id = ""
        translation_en = ""
        ref_id = f"{corpus}::{payload.get('section_id','')}"
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
                limit=_per_corpus_for(corpus, per_corpus),
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


def retrieve_kisah_pendek(
    theme: str,
    *,
    window_before: int = 2,
    window_after: int = 6,
    max_chars: int = 14000,
) -> dict[str, Any] | None:
    """Retrieve a CONTIGUOUS narrative passage from Al-Bidayah wan-Nihayah.

    Why contiguous, not top-K: Al-Bidayah is Ibn Kathir's universal
    history split into 2,529 sequential fasal (~1.5k chars each). A
    top-K cosine search lands scattered fasal from across the kitab —
    great for daleel retrieval, useless for retelling a single STORY.
    For the "Kisah Pendek" content kit slot we need a self-contained
    episode, which means: pick the best-matching seed fasal, then walk
    the surrounding fasal in their original kitab order so the LLM
    receives the scene → core event → denouement as a coherent block.

    Window: `window_before` fasal preceding the seed + `window_after`
    fasal following it. Defaults (2 + 6) give ~9 fasal ≈ 13k Arabic
    chars, roughly 2-3k Indonesian words to retell as a 10-min read.

    `max_chars` caps total Arabic chars so an over-long episode doesn't
    blow the prompt budget — when crossed, the window is truncated at
    the natural fasal boundary that fits.

    Returns None when:
      - Al-Bidayah collection is empty / unreachable
      - Top seed scored below MIN_SCORE (no thematic fit in the kitab)
      - Seed payload lacks `section_id` (shouldn't happen, defensive)

    Per the 2026-06-06 product decision: the Kisah Pendek slot uses
    Al-Bidayah EXCLUSIVELY. The caller's prompt is responsible for
    SKIPPING the section gracefully when this returns None — DO NOT
    fall back to hadith pool here.
    """
    if not theme.strip():
        return None
    openai = _get_openai()
    try:
        emb = openai.embeddings.create(
            model=settings.embedding_model, input=theme
        )
        vector = emb.data[0].embedding
        record_usage(
            provider="openai",
            operation="embedding",
            model=settings.embedding_model,
            tokens_in=getattr(emb.usage, "total_tokens", None),
            meta={"purpose": "kisah_retrieval"},
        )
    except Exception as exc:
        log.warning("kisah_retrieval.embed_failed", error=str(exc))
        return None

    qdrant = _get_qdrant()
    collection = COLLECTION_NAMES.get(
        "al_bidayah_wan_nihayah", "al_bidayah_wan_nihayah"
    )
    try:
        qr = qdrant.query_points(
            collection_name=collection,
            query=vector,
            limit=1,
            with_payload=True,
        )
        results = qr.points
    except Exception as exc:
        log.debug("kisah_retrieval.query_failed", error=str(exc))
        return None
    if not results:
        log.info("kisah_retrieval.no_results", theme=theme[:80])
        return None

    seed = results[0]
    threshold = MIN_SCORE.get("al_bidayah_wan_nihayah", 0.28)
    if seed.score is None or seed.score < threshold:
        log.info(
            "kisah_retrieval.below_threshold",
            score=seed.score,
            threshold=threshold,
            theme=theme[:80],
        )
        return None

    seed_payload = dict(seed.payload or {})
    seed_id = int(seed_payload.get("section_id", 0) or 0)
    if seed_id <= 0:
        return None

    # Point IDs in al_bidayah_wan_nihayah equal section_id (set by the
    # embed script), so a direct retrieve-by-id pulls the contiguous
    # window without another vector search.
    window_ids = list(
        range(
            max(1, seed_id - window_before),
            seed_id + window_after + 1,
        )
    )
    try:
        points = qdrant.retrieve(
            collection_name=collection,
            ids=window_ids,
            with_payload=True,
        )
    except Exception as exc:
        log.warning("kisah_retrieval.window_failed", error=str(exc))
        # Seed alone is degraded but better than dropping the whole slot.
        points = [seed]

    # Qdrant doesn't guarantee retrieve() order — sort by section_id so
    # the narrative reads forward.
    indexed: list[tuple[int, dict[str, Any]]] = []
    for pt in points:
        p = dict(pt.payload or {})
        sid = int(p.get("section_id", 0) or 0)
        if sid > 0:
            indexed.append((sid, p))
    indexed.sort(key=lambda kv: kv[0])
    if not indexed:
        return None

    fasal: list[dict[str, Any]] = []
    total_chars = 0
    for sid, p in indexed:
        ar = str(p.get("ar") or "")
        if not ar:
            continue
        if total_chars + len(ar) > max_chars and fasal:
            break
        fasal.append({
            "section_id": sid,
            "title": p.get("title") or "",
            "qism": p.get("qism") or "",
            "citation": p.get("citation") or "Al-Bidayah wan-Nihayah",
            "ar": ar,
        })
        total_chars += len(ar)

    if not fasal:
        return None

    log.info(
        "kisah_retrieval.assembled",
        seed_id=seed_id,
        seed_score=float(seed.score),
        fasal_count=len(fasal),
        total_chars=total_chars,
    )
    return {
        "fasal": fasal,
        "seed_section_id": seed_id,
        "seed_score": float(seed.score),
        "total_chars": total_chars,
    }


def retrieve_dua(
    theme: str,
    *,
    hijri_context: str | None = None,
    limit: int = 8,
    per_corpus: int = 4,
) -> list[dict[str, Any]]:
    """Retrieve DU'A / dzikir entries from the existing kitab corpus
    biased toward du'a content.

    Existing collections already cover this — Bukhari has Kitab
    ad-Da'awat (book 75, hadith 6304-6411); Muslim has Kitab adh-Dhikr
    wa ad-Du'a wa at-Tawbah wa al-Istighfar (book 48); Riyad as-Salihin
    has chapters 245-373 of dzikir + du'a; and Qur'an carries every
    prophetic du'a (Yunus, Ibrahim, Musa, Zakaria, Sulaiman, Ayyub…).
    We don't need a separate adhkar index — we need a separate QUERY
    shape so embedding similarity surfaces du'a passages instead of
    general thematic verses.

    The query is enriched with du'a-flavored Indonesian phrasing so
    the embedded vector lands near du'a content in vector space:
        "doa dan munajat tentang {theme}: memohon kepada Allah,
         dzikir pagi-petang, perlindungan, ketetapan hati"
    Hijri context (e.g., "menjelang Idul Adha", "bulan Sya'ban")
    biases retrieval toward seasonal du'a (Arafah, Asyura, Sha'ban).

    Returns the same DaleelRef shape as `retrieve_daleel`. The pool
    is meant to be passed to the LLM as an ADHKAR_POOL alongside the
    regular thematic DALEEL_POOL, and the Pesan Flyer 5 + 6 paragraphs
    are instructed to cite from this pool.
    """
    if not theme.strip():
        return []

    parts = [
        f"doa, dzikir, dan ibadah sunnah tentang {theme}",
        "memohon kepada Allah, dzikir pagi dan petang, perlindungan, hidayah, ampunan, tazkiyatun nafs",
        # Sunnah practice hadith — Flyer 5 (Ajakan Sunnah) needs the
        # hadith that ESTABLISHES the practice (Arafah / Tarwiyah /
        # Asyura / Senin-Kamis fasting, sedekah pagi, sholat Dhuha,
        # qiyamul lail, baca Surat Al-Kahfi Jumat, dll.) — not only
        # recitable du'a.
        "sunnah Nabi shallallahu alaihi wa sallam: puasa Arafah, puasa Tarwiyah, puasa Asyura, puasa Senin Kamis, puasa Ayyamul Bidh, sholat Dhuha, sholat Tahajjud, qiyamul lail, sedekah Subuh, dzikir setelah sholat, membaca Al-Kahfi Jumat, takbir Idul Adha",
    ]
    if hijri_context and hijri_context.strip():
        parts.insert(1, f"konteks Hijriyah: {hijri_context.strip()}")
    enriched = " — ".join(parts)

    # Pull from each corpus, then merge. Bukhari + Muslim + Riyad
    # naturally hold most of the du'a content; Quran lands the
    # prophetic du'a. Skip tafsir_ibn_kathir — it's exegesis, not
    # du'a text per se, and using it as a "du'a source" would surface
    # commentary rather than a recitable du'a.
    openai = _get_openai()
    try:
        emb = openai.embeddings.create(
            model=settings.embedding_model, input=enriched
        )
        vector = emb.data[0].embedding
        record_usage(
            provider="openai",
            operation="embedding",
            model=settings.embedding_model,
            tokens_in=getattr(emb.usage, "total_tokens", None),
            meta={"purpose": "adhkar_retrieval"},
        )
    except Exception as exc:
        log.warning("adhkar_retrieval.embed_failed", error=str(exc))
        return []

    DUA_CORPORA = {
        "quran": "quran",
        "bukhari": "bukhari",
        "muslim": "muslim",
        "riyad_as_salihin": "riyad_as_salihin",
        # Bulugh al-Maram is fiqh-focused; less rich in standalone du'a.
        # Skip to keep the pool tight.
    }

    qdrant = _get_qdrant()
    all_hits: list[dict[str, Any]] = []
    for corpus, collection in DUA_CORPORA.items():
        try:
            qr = qdrant.query_points(
                collection_name=collection,
                query=vector,
                limit=per_corpus,
                with_payload=True,
            )
            results = qr.points
        except Exception as exc:
            log.debug(
                "adhkar_retrieval.corpus_failed",
                corpus=corpus,
                error=str(exc),
            )
            continue
        # Use the same MIN_SCORE bar — embedded queries match du'a
        # content reasonably well, so the existing thresholds work.
        threshold = MIN_SCORE.get(corpus, 0.30)
        for hit in results:
            if hit.score is None or hit.score < threshold:
                continue
            normalized = _normalize_hit(corpus, hit)
            if normalized["ref_id"] in DALEEL_DENYLIST:
                continue
            # Harakat gate — du'a in Pesan Flyer 5 + 6 is meant to be
            # READ ALOUD by the audience. Without harakat the text
            # can't be pronounced by non-Arabs, defeating the purpose
            # of the flyer. Riyad as-Salihin entries are seeded
            # without harakat and would otherwise dominate the pool
            # for many themes. The kitab page still surfaces them
            # via the thematic retrieval path; this filter only
            # applies to the recitable-du'a pool.
            if not _is_recitable_du_a(normalized.get("arabic", "")):
                log.debug(
                    "adhkar_retrieval.unrecitable_dropped",
                    ref_id=normalized["ref_id"],
                    citation=normalized.get("citation"),
                )
                continue
            all_hits.append(normalized)

    all_hits.sort(key=lambda h: h["score"] or -1e9, reverse=True)
    log.info(
        "adhkar_retrieval.scored",
        theme=theme[:80],
        kept=len(all_hits),
        top_score=all_hits[0]["score"] if all_hits else None,
    )
    return all_hits[:limit]


def rerank_dua(
    theme: str,
    candidates: list[dict[str, Any]],
    *,
    top_n: int = 5,
) -> list[dict[str, Any]]:
    """Re-rank du'a candidates by whether they ARE a recitable du'a
    (vs. a verse / hadith ABOUT du'a), and by thematic fit.

    Mirrors `rerank_daleel` but with a du'a-shaped rubric — embedding
    similarity sometimes surfaces verses commenting on du'a (e.g.
    "Allah is near, He answers du'a") instead of an actual recitable
    du'a passage. The re-rank asks Gemini Flash-Lite to score each
    candidate against two criteria:
      (a) Is it a recitable du'a / dzikir (i.e. an Arabic supplication
          the reader can say verbatim)?
      (b) Does it thematically connect to the briefing's theme?
    """
    if not candidates or len(candidates) <= top_n:
        return candidates[:top_n]

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
    prompt = f"""Tema dakwah pekan ini:
{theme}

Berikut adalah {len(candidates)} kandidat dari Qur'an / hadith yang ditemukan untuk slot DOA + DZIKIR (bukan slot daleel argumentatif). Tugas Anda: pilih {top_n} kandidat terbaik berdasarkan DUA KRITERIA:

1. RECITABLE — apakah ini doa atau dzikir yang BISA langsung dibaca / diwirid oleh pembaca? (mis. "Allāhumma innī as'aluka al-hudā..." YES; "Allah akan menjawab doa hamba-Nya..." NO — itu komentar tentang doa, bukan doa itu sendiri)
2. THEMATIC — apakah maknanya nyambung dengan tema pekan ini?

Yang harus dihindari:
- Ayat / hadith yang sekadar BICARA TENTANG doa (bukan doa itu sendiri)
- Doa yang sangat panjang (>2 kalimat Arab) — sulit dipakai untuk flyer
- Doa yang konteksnya sangat spesifik tidak match dengan tema (mis. doa naik kendaraan untuk tema "amanah pejabat")

Kandidat:
{numbered}

Kembalikan JSON: {{"indices": [i1, i2, ...]}} dengan {top_n} index terbaik, diurutkan dari yang paling cocok untuk slot doa + tema."""

    try:
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
                max_output_tokens=200,
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
            if (
                isinstance(idx, int)
                and 0 <= idx < len(candidates)
                and idx not in seen
            ):
                picked.append(candidates[idx])
                seen.add(idx)
                if len(picked) >= top_n:
                    break

        usage_md = getattr(resp, "usage_metadata", None)
        record_usage(
            provider="gemini",
            operation="adhkar_rerank",
            model="gemini-2.5-flash-lite",
            tokens_in=getattr(usage_md, "prompt_token_count", None),
            tokens_out=gemini_output_tokens(usage_md),
        )
        log.info(
            "adhkar_retrieval.reranked",
            theme=theme[:80],
            candidates_in=len(candidates),
            picked=len(picked),
        )
        if len(picked) < top_n:
            for c in candidates:
                if c not in picked:
                    picked.append(c)
                    if len(picked) >= top_n:
                        break
        return picked
    except Exception as exc:
        log.warning("adhkar_retrieval.rerank_failed", error=str(exc))
        return candidates[:top_n]


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

TUGAS: Pilih INDEX daleel yang BENAR-BENAR relevan secara TEMATIK untuk tema di atas.

ATURAN PENILAIAN — wajib ketat:
- Daleel TIDAK COCOK jika hanya berbagi kata permukaan tapi konteks asli berbeda. Contoh kesalahan yang HARUS Anda tolak:
  * tema "pinjol/riba" + daleel tentang "pemuda yang taat di Gua Kahfi" → TIDAK COCOK (sama-sama "muda", tapi tema-nya kepatuhan vs muamalah)
  * tema "judol/maysir" + daleel tentang "permainan anak-anak" → TIDAK COCOK (kata "lahw" tidak otomatis = perjudian)
  * tema "kekerasan terhadap anak" + daleel tentang "perlindungan harta yatim" → LEMAH (terkait, tapi tema sebenarnya kekerasan fisik, bukan harta)
  * tema "depresi/mental health" + daleel tentang "kesabaran nabi atas kafir Quraysy" → LEMAH (sabar tapi konteks dakwah-ke-luar, bukan ketenangan jiwa)
- Daleel COCOK kalau ayat/hadith-nya BENAR-BENAR berbicara tentang inti tema-nya, bukan hanya berbagi satu kata. Contoh yang BENAR:
  * tema "pinjol/riba" + daleel QS Al-Baqarah:275-281 (larangan riba) → COCOK
  * tema "judol/maysir" + daleel QS Al-Maidah:90-91 (khamr & maysir) → COCOK
  * tema "bullying/ghibah" + hadith tentang lisan yang menjaga saudara → COCOK
  * tema "korupsi/amanah" + ayat tentang menunaikan amanah → COCOK

PRINSIP TERAKHIR: lebih baik mengembalikan SEDIKIT daleel yang benar-benar tematik daripada memaksa {top_n} entri ketika hanya sebagian yang benar-benar relevan. Da'i akan mengutip ulang daleel ini di mimbar — daleel yang dipaksakan akan terasa janggal dan merusak kredibilitas pesan.

Kandidat:
{numbered}

Kembalikan JSON: {{"indices": [i1, i2, ...]}} dengan SEMUA index daleel yang BENAR-BENAR cocok (jumlah bisa antara 0 hingga {top_n}, urutan dari paling relevan). Kalau tidak ada satu pun yang cocok secara tematik, kembalikan {{"indices": []}}."""

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
        # IMPORTANT: do NOT top up the picked list with weak candidates.
        # The previous behavior backfilled with the original similarity-
        # sorted list to always return top_n, which re-introduced the
        # surface-keyword matches the rerank was specifically asked to
        # reject. Trust the rerank's verdict — the brief LLM can handle
        # a pool of < top_n daleel; it CANNOT recover from forced
        # mis-citations.
        #
        # If the rerank returned literally zero candidates (and at least
        # one input was given) we DO take the single top-similarity hit
        # as a last-resort fallback so the brief still has something to
        # cite for Section 5. Anything more aggressive would mask bugs.
        if not picked and candidates:
            picked = [candidates[0]]
            log.warning(
                "kitab_retrieval.rerank_returned_empty_fallback_to_top1",
                theme=theme[:80],
            )
        return picked
    except Exception as exc:
        log.warning("kitab_retrieval.rerank_failed", error=str(exc))
        return candidates[:top_n]


# `translate_daleel_to_id` lived here until 2026-05-24 — the old
# batch-of-many Flash-Lite call kept hitting the 2000-token output
# cap on full daleel pools and falling back silently to English. It's
# now replaced by `api.services.hadith_translation.enrich_daleel_translations`,
# which translates one hadith per call and caches results in the
# `hadith_translations_id` table.


# ─────────────────────────────────────────────────────────────────────
# Per-flyer daleel pick (sketched 2026-06-08, not yet wired)
#
# Replaces the current "retrieve one big pool per briefing → weave into
# 6 flyers and hope" approach. Each flyer body gets its OWN Qdrant
# query + LLM judge, so daleel relevance is per-message rather than
# per-briefing-theme.
#
# Failure mode this fixes (2026-06-08 audit):
#   - Toleransi briefing pool had ~12 daleel; after the 240ch cap
#     filter only 4-5 short options remained for 6 flyers. Auto-picker
#     reused the same short citation across multiple unrelated flyers
#     ("QS. An-Nahl: 90" appeared 4× across F1/F5/F6 with weak fit).
#   - Pool was retrieved against one big briefing summary, so flyers
#     about disparate sub-themes (Pancasila + LGBT + zuhud + muhasabah)
#     all drew from the same generic-justice candidate set.
#
# Pipeline:
#   1. Embed (headline + first paragraph of body) as a single query.
#      Body alone misses the headline's punch words; headline alone is
#      too short for stable embedding (~4-6 words).
#   2. Qdrant top-candidate_pool across all kitab collections. Reuses
#      _per_corpus_for + MIN_SCORE + DALEEL_DENYLIST gates already in
#      retrieve_daleel.
#   3. Optional adhkar filter (for flyer slots 5+6 — Ajakan Sunnah /
#      Doa Pekan Ini): drop entries without harakat density above
#      RECITABLE_HARAKAT_MIN. Same gate retrieve_dua already uses.
#   4. Gemini Flash-Lite judge: picks the SINGLE best citation given
#      relevance + length constraints. Explicit instruction: prefer
#      ≤240ch translation; accept up to 350ch if best-fit is longer;
#      return None (em-dash) if nothing genuinely relevant exists.
#
# Cost: ~$0.001 embedding + ~$0.0002 judge × 6 flyers = $0.007 per
# briefing. Negligible vs current $0.20 OpenAI line item.
#
# Caller flow (briefing.py, after LLM has drafted bodies, BEFORE
# final markdown assembly):
#
#   for slot in range(1, 7):
#       headline = flyer_drafts[slot]["headline"]
#       body_first_para = flyer_drafts[slot]["body"].split("\n\n")[0]
#       pick = pick_flyer_daleel(
#           flyer_body=body_first_para,
#           flyer_headline=headline,
#           is_adhkar_slot=(slot >= 5),
#       )
#       flyer_drafts[slot]["dalil_cit"] = pick["citation"] if pick else "—"
#
# Validators stay correct: scan_flyer_dalil_in_pool will accept the
# per-flyer citation because we add the pick to daleel_refs before
# save. If pick is None, em-dash already bypasses the pool check.
# ─────────────────────────────────────────────────────────────────────


_FLYER_PICK_RELEVANCE_FLOOR_CHARS = 240
"""Soft cap on translation length the LLM judge prefers. The judge is
told to accept up to ~350ch if the best-fit candidate is longer, since
relevance always beats brevity. Strict-cap mode would force bad picks
from a small pool (the 2026-06-08 failure mode)."""

_FLYER_PICK_HARD_CAP_CHARS = 350
"""Hard cap. Above this, the judge is told to return None — renderer
will show em-dash + skip the side-card. Body still carries the daleel
content inline for slots 5+6 (du'a) so user-visible content survives."""


def pick_flyer_daleel(
    flyer_body: str,
    flyer_headline: str | None = None,
    *,
    is_adhkar_slot: bool = False,
    candidate_pool_size: int = 10,
) -> dict[str, Any] | None:
    """Pick the single best-fitting daleel for ONE flyer's message.

    Args:
        flyer_body: The 70-90 word prose body of the flyer (first
            paragraph is enough — that's what the renderer surfaces).
        flyer_headline: The 4-6 word punch headline. Optional but
            improves embedding query (headlines carry the active-voice
            verb that often anchors the thematic intent).
        is_adhkar_slot: True for slots 5+6 (Ajakan Sunnah, Doa Pekan
            Ini). Filters candidates to harakat-marked recitable entries
            only — slots 1-4 accept any kitab.
        candidate_pool_size: How many embedding-retrieved candidates
            to feed the judge. Default 10 balances cost ($0.0002 judge)
            vs catching the right entry when it sits at rank 7-10.

    Returns:
        A single normalised hit dict (same shape as `retrieve_daleel`
        entries) ready to be added to `daleel_refs` and tagged in the
        flyer's `**Dalil:**` marker.

        Returns None when:
            - flyer_body is empty / too short to embed
            - Qdrant returns zero candidates above MIN_SCORE
            - Judge concludes no candidate is genuinely on-topic
            - All candidates exceed the hard char cap and the judge
              determines none of them can serve this flyer well
            - Any error (defense-in-depth — never break briefing flow
              on a per-flyer pick failure; caller defaults to em-dash).
    """
    if not flyer_body or not flyer_body.strip():
        return None

    # ── Stage 1: build the query embedding ────────────────────────
    # Concatenate headline (if any) + first paragraph of body. The
    # OpenAI embedding model handles up to 8K tokens, so we don't need
    # to truncate aggressively — but body sentences past the first
    # paragraph dilute the embedding (downstream paragraphs often pivot
    # to community/individual aksi which is the same across flyers).
    query_parts = []
    if flyer_headline and flyer_headline.strip():
        query_parts.append(flyer_headline.strip())
    query_parts.append(flyer_body.strip()[:600])
    query = "\n\n".join(query_parts)

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
            meta={"context": "flyer_pick", "is_adhkar": is_adhkar_slot},
        )
    except Exception as exc:
        log.warning("flyer_pick.embed_failed", error=str(exc))
        return None

    # ── Stage 2: gather candidates from every kitab collection ────
    qdrant = _get_qdrant()
    candidates: list[dict[str, Any]] = []
    # Per-corpus quota: ~3 from each, with the AR-only boost in
    # _per_corpus_for. With ~11 corpora, this gives 30-40 candidates
    # pre-filter — we'll trim to candidate_pool_size after merge.
    for corpus, collection in COLLECTION_NAMES.items():
        try:
            qr = qdrant.query_points(
                collection_name=collection,
                query=vector,
                limit=_per_corpus_for(corpus, 3),
                with_payload=True,
            )
            results = qr.points
        except Exception as exc:
            log.debug(
                "flyer_pick.corpus_failed", corpus=corpus, error=str(exc)
            )
            continue

        threshold = MIN_SCORE.get(corpus, 0.30)
        for hit in results:
            if hit.score is None or hit.score < threshold:
                continue
            normalized = _normalize_hit(corpus, hit)
            if normalized["ref_id"] in DALEEL_DENYLIST:
                continue
            # Adhkar filter for slots 5+6: only entries with enough
            # harakat density to be recitable as a du'a.
            if is_adhkar_slot and not _is_recitable_du_a(
                normalized.get("arabic", "")
            ):
                continue
            candidates.append(normalized)

    if not candidates:
        log.info(
            "flyer_pick.no_candidates",
            headline=(flyer_headline or "")[:60],
            is_adhkar=is_adhkar_slot,
        )
        return None

    # Sort by score desc, trim to pool size before LLM judge
    candidates.sort(key=lambda h: h["score"] or -1e9, reverse=True)
    candidates = candidates[:candidate_pool_size]

    # ── Stage 3: LLM judge picks the single best fit ──────────────
    # Lazy import — keeps module light when this path isn't hit.
    from google import genai
    from google.genai import types as genai_types

    if not settings.gemini_api_key:
        # No judge available — fall back to top-1 by cosine. Logged so
        # we can audit when this fires in prod.
        log.warning("flyer_pick.no_gemini_key_using_cosine_top1")
        return candidates[0]

    client = genai.Client(api_key=settings.gemini_api_key)

    numbered = "\n".join(
        f"[{i}] {c['corpus'].upper()} {c['citation']} ({len(c.get('translation_id') or c.get('translation_en') or '')} ch)\n"
        f"    Arab: {c['arabic'][:160]}\n"
        f"    ID:   {(c.get('translation_id') or c.get('translation_en') or '')[:280]}"
        for i, c in enumerate(candidates)
    )
    adhkar_clause = (
        "\n\nSLOT INI = Ajakan Sunnah / Doa Pekan Ini. Daleel HARUS sebuah du'a / dzikir / ayat yang bisa direcite jamaah — bukan hadits historis panjang dengan rantai perawi."
        if is_adhkar_slot
        else ""
    )
    headline_clause = (
        f"\n\nHEADLINE flyer: \"{flyer_headline}\""
        if flyer_headline and flyer_headline.strip()
        else ""
    )
    prompt = f"""BODY flyer dakwah pekan ini:
{flyer_body[:600]}{headline_clause}{adhkar_clause}

Berikut {len(candidates)} kandidat daleel dari Qur'an dan kitab hadits yang ditemukan oleh pencarian embedding. PILIH SATU yang PALING TEPAT secara TEMATIK untuk flyer di atas — bukan yang skor kosinusnya tertinggi, tetapi yang BENAR-BENAR berbicara tentang inti pesan flyer.

ATURAN PEMILIHAN (wajib ketat):

1. RELEVANSI > BREVITY. Pilih daleel yang BENAR-BENAR cocok dengan pesan, walaupun terjemahannya agak panjang ({_FLYER_PICK_RELEVANCE_FLOOR_CHARS}ch ideal, sampai {_FLYER_PICK_HARD_CAP_CHARS}ch masih bisa). Daleel yang dipaksakan tematik (kata permukaan sama, konteks berbeda) lebih buruk daripada daleel agak panjang yang persis cocok.

2. TOLAK daleel yang hanya BERBAGI KATA tapi konteksnya berbeda:
   ❌ flyer tentang "pulang haji jadi tersangka korupsi" + daleel tentang "tawaran harga muslim" → KATA "muslim" sama, KONTEKS beda
   ❌ flyer tentang "dakwah dengan hikmah ke saudara LGBT" + daleel tentang "timbangan adil" → KATA "adil" sama, KONTEKS beda
   ❌ flyer tentang "shalat tepi siang muhasabah" + daleel tentang "adil + ihsan" → tema beda
   ❌ flyer tentang "iklan paylater 0%" + daleel tentang "harta yatim" → keduanya tentang harta tapi tema spesifik beda

3. TERIMA daleel yang ISINYA langsung membahas tema flyer:
   ✓ flyer tentang "integritas pejabat" + Sahih Muslim 4721 (mimbar cahaya untuk orang adil) → KONTEKS langsung
   ✓ flyer tentang "dakwah nasihat" + Bulugh al-Maram 1730 ("Agama adalah nasihat") → KONTEKS langsung
   ✓ flyer tentang "shalat tepi siang" + QS. Hud: 114 (dirikan shalat di kedua tepi siang) → KONTEKS langsung
   ✓ flyer tentang "kezaliman" + hadits qudsi tentang larangan zhulm → KONTEKS langsung

4. BATAS PANJANG: kalau dua daleel sama-sama tematik, pilih yang TERJEMAHANNYA LEBIH PENDEK. Tapi JANGAN tolak yang relevan hanya karena panjang.

5. KALAU TIDAK ADA satu pun kandidat yang benar-benar cocok, kembalikan {{"picked": null, "reason": "..."}} — em-dash di renderer lebih jujur daripada daleel mismatch.

Kandidat:
{numbered}

Kembalikan JSON SAJA, salah satu format:
  {{"picked": <index 0-{len(candidates)-1}>, "reason": "1 kalimat penjelasan kenapa daleel ini paling cocok"}}
  ATAU
  {{"picked": null, "reason": "1 kalimat penjelasan kenapa tidak ada yang cocok"}}"""

    try:
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
                max_output_tokens=200,
                # Pick + 1-sentence reason = small structured output;
                # no deliberation needed (same as rerank_daleel).
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
        raw = resp.text or "{}"
        import json as _json

        data = _json.loads(raw)
        picked_idx = data.get("picked")
        reason = data.get("reason", "")

        usage_md = getattr(resp, "usage_metadata", None)
        record_usage(
            provider="gemini",
            operation="flyer_dalil_pick",
            model="gemini-2.5-flash-lite",
            tokens_in=getattr(usage_md, "prompt_token_count", None),
            tokens_out=gemini_output_tokens(usage_md),
            meta={"is_adhkar": is_adhkar_slot},
        )

        if picked_idx is None:
            log.info(
                "flyer_pick.judge_returned_none",
                reason=reason[:120],
                headline=(flyer_headline or "")[:60],
            )
            return None

        if (
            not isinstance(picked_idx, int)
            or picked_idx < 0
            or picked_idx >= len(candidates)
        ):
            log.warning(
                "flyer_pick.judge_bad_index",
                picked=picked_idx,
                n_candidates=len(candidates),
            )
            return candidates[0]

        chosen = candidates[picked_idx]
        log.info(
            "flyer_pick.judged",
            headline=(flyer_headline or "")[:60],
            picked_cit=chosen["citation"],
            picked_trans_len=len(
                chosen.get("translation_id")
                or chosen.get("translation_en")
                or ""
            ),
            reason=reason[:120],
            is_adhkar=is_adhkar_slot,
        )
        return chosen

    except Exception as exc:
        log.warning("flyer_pick.judge_failed", error=str(exc))
        # Defense in depth: rather than breaking the briefing, fall
        # back to top-1 by cosine. Logged so anomalies are auditable.
        return candidates[0]
