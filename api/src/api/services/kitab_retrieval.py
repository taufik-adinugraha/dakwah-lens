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


# Markers of an actual SUPPLICATION (du'a) — as opposed to a command /
# statement verse that merely has harakat (e.g. "وَزِنُوا۟ بِٱلْقِسْطَاسِ",
# "لَا تَأْكُلُوا۟ ٱلرِّبَوٰا"). `_is_recitable_du_a` only gates on harakat
# density (pronounceability), so command ayat slip into the du'a pool and
# end up cited under "Doa Pekan Ini" (slot 6). This catches the real
# thing: Qur'anic "Rabbana…" or prophetic "Allahumma…/a'ūdhu/as'aluka".
_DUA_SUPPLICATION_MARKERS = (
    "اللهم",
    "اللَّهُمَّ",
    "اللّٰهُمَّ",
    "اللّهمّ",
    "ربنا",
    "رَبَّنَا",
    "رَبَّنَآ",
    "ربّنا",
    "رب اغفر",
    "رَبِّ اغْفِرْ",
    "رب إني",
    "رَبِّ إِنِّي",
    "رب اجعلني",
    "أعوذ",
    "أَعُوذُ",
    "اعوذ",
    "نعوذ",
    "نَعُوذُ",
    "أسألك",
    "أَسْأَلُكَ",
    "اللهم إني",
)


_TASHKIL_RE = re.compile("[\u0640\u064b-\u0655\u0670]")


def _strip_tashkil(s: str) -> str:
    """Drop harakat / tanwin / sukun / maddah / superscript-alef / tatweel
    and fold the alif-hamza variants, so supplication-marker matching is
    immune to vocalization differences between corpora."""
    s = _TASHKIL_RE.sub("", s or "")
    for a in ("أ", "إ", "آ", "ٱ", "ٲ", "ٳ"):
        s = s.replace(a, "ا")
    return s


def _looks_like_supplication(arabic: str) -> bool:
    """True iff the Arabic reads as a recitable du'a (supplication),
    not merely a harakat'd command/statement verse. Matching is done on
    tashkil-stripped text so vocalization variants don't cause misses."""
    norm = _strip_tashkil(arabic)
    return any(_strip_tashkil(m) in norm for m in _DUA_SUPPLICATION_MARKERS)


# Universal, recitable, flyer-eligible du'a used as a FLOOR for the du'a
# pool: theme-biased embedding frequently returns only command/principle
# ayat for a theme (justice, riba, leadership…), leaving slot 5/6
# ("Doa Pekan Ini") with no actual supplication to cite. We top the pool
# up from this set so a recitable du'a is ALWAYS available. (Root fix
# 2026-06-25 after the operator caught 6 "Doa" flyers citing command ayat.)
_CANONICAL_DUA_CITATIONS = (
    "Sahih al-Bukhari 6389",  # allāhumma rabbanā ātinā fid-dunyā ḥasanah (most frequent du'a)
    "Sahih al-Bukhari 6368",  # a'ūdhu min al-ma'tham wal-maghram (sin + debt)
    "Sahih al-Bukhari 6377",  # a'ūdhu min sharri fitnatil-faqr (poverty)
    "Sahih al-Bukhari 6323",  # sayyid al-istighfār
    "Sahih Muslim 2722",  # allāhumma āti nafsī taqwāhā wa zakkihā
    "Sahih Muslim 2721a",  # as'aluka al-hudā wat-tuqā wal-'afāf wal-ghinā
    "QS. Al-Baqara: 201",  # rabbanā ātinā fid-dunyā ḥasanah…
    "QS. Al-Baqara: 286",  # rabbanā lā tu'ākhidhnā…
)
_MIN_DUA_SUPPLICATIONS = 4


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
    "fath_al_muin": "fath_al_muin",
    "fath_al_qarib": "fath_al_qarib",
    "adab_alim_mutaallim": "adab_alim_mutaallim",
    "aqidah_awam": "aqidah_awam",
    "thalathat_al_usul": "thalathat_al_usul",
    "syamail_muhammadiyyah": "syamail_muhammadiyyah",
    "sirah_ibn_hisham": "sirah_ibn_hisham",
    "hayat_as_sahabah": "hayat_as_sahabah",
}

# Per-corpus minimum cosine similarity for a hit to count as a usable
# daleel. Recalibrated 2026-06-09 against 27 real recent topic labels
# pulled from `topics.label` (the actual queries the briefing pipeline
# runs) + 17 deliberately-off-topic "noise" queries (K-pop, gadget,
# sport, drakor). For each corpus we measured the top-1 cosine for
# both buckets and set MIN_SCORE just above each corpus's noise ceiling.
#
# Why the original 2026-05 calibration drifted: it assumed noise capped
# at 0.27 universally. That only held for Quran's Bahasa-anchored
# payload. Once we added 13 AR-only kitabs (Fath al-Mu'in, 'Aqidat
# al-'Awam, Sirah, Hayat as-Sahabah, etc.), the absolute score scale
# collapsed because the embedder maps Bahasa queries → Arabic payloads
# at consistently lower cosine. A 0.28 floor was rejecting 90%+ of real
# matches for these corpora — they were effectively absent from the
# briefing pool.
#
# Headline shifts:
#   - quran (0.35) + muslim (0.28) KEPT — first verification pass showed
#     raising them to noise_max dropped recall from 24/27 → 19/27 (quran)
#     and 24/27 → 12/27 (muslim) for no real quality gain, because the
#     reranker already catches the noise that slips through. Those two
#     corpora have meaningful real-vs-noise distribution overlap, so the
#     original empirical thresholds remain the right tradeoff.
#   - The other 17 corpora dropped to noise_max + ~0.01 buffer — recall
#     went 0-3/27 → 6-17/27 across the board.
#
# Rationale for setting MIN_SCORE = noise_max + small buffer (not p90):
# the Flash-Lite reranker is the actual quality gate and only costs
# ~$0.0004 per call. Cost of too-LOW threshold = wasted reranker tokens
# on a few junk candidates. Cost of too-HIGH threshold = silent recall
# loss across the whole corpus. The asymmetry favours erring low.
MIN_SCORE: dict[str, float] = {
    # Translation-bearing corpora — Bahasa or English in payload.
    "quran": 0.35,
    "muslim": 0.28,
    "bukhari": 0.26,
    "bulugh_al_maram": 0.23,
    "riyad_as_salihin": 0.19,
    "tafsir_ibn_kathir": 0.18,
    # AR-only corpora — embedder maps ID query → AR payload at lower
    # absolute cosine, so thresholds sit much lower.
    "fiqh_as_sunnah": 0.22,
    "hayat_as_sahabah": 0.21,
    "al_bidayah_wan_nihayah": 0.19,
    "al_umm": 0.17,
    "aqidah_awam": 0.16,
    "sirah_ibn_hisham": 0.16,
    "fath_al_qarib": 0.15,
    "nashaihul_ibad": 0.15,
    "fath_al_muin": 0.14,
    "adab_alim_mutaallim": 0.14,
    "syamail_muhammadiyyah": 0.13,
    "bidayat_al_hidayah": 0.12,
    "thalathat_al_usul": 0.10,
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
    "fath_al_muin",
    "fath_al_qarib",
    "adab_alim_mutaallim",
    "aqidah_awam",
    "thalathat_al_usul",
    "syamail_muhammadiyyah",
    "sirah_ibn_hisham",
    "hayat_as_sahabah",
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


# Whitelist of corpora the flyer picker is allowed to draw from. The
# rationale lives inline in pick_flyer_daleel where this is iterated;
# the short version: flyers are 1080x1080 graphics with ~3-4 lines of
# daleel text, so we want short, well-known hadith + pesantren matns
# and exclude tafsir / sirah / fiqh-heavy kitabs whose entries are
# multi-paragraph and don't render in the format.
#
# Widened 2026-06-18 from 7 → 11 corpora after audit found the kesehatan
# theme's FLYER POOL collapsed to 1 entry (a financial-debt hadith
# stretched across all 4 flyer slots because no thematic alternatives
# survived the 7-kitab filter). Added: quran (verses are typically
# short — average <3 lines for non-narrative ayat), adab_alim_mutaallim
# (Imam Nawawi's adab matns), thalathat_al_usul (Wahab pamphlet),
# syamail_muhammadiyyah (short hadith descriptions of the Prophet).
# All four pass the "short pull-quote that fits 1080×1080" test. Length
# is still enforced at composition time (≤240 char ID, ≤200 char Arabic)
# via the prompt rules — overly-long Qur'an verses (long Yusuf/Shu'ara
# narrative sequences) get rejected at headline-write time.
FLYER_ALLOWED_CORPORA: tuple[str, ...] = (
    "bukhari",
    "muslim",
    "riyad_as_salihin",
    "bulugh_al_maram",
    "bidayat_al_hidayah",
    "nashaihul_ibad",
    "aqidah_awam",
    "quran",
    "adab_alim_mutaallim",
    "thalathat_al_usul",
    "syamail_muhammadiyyah",
)


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
        "fath_al_muin",
        "fath_al_qarib",
        "adab_alim_mutaallim",
        "aqidah_awam",
        "thalathat_al_usul",
        "syamail_muhammadiyyah",
        "sirah_ibn_hisham",
        "hayat_as_sahabah",
    ):
        # Classic-kitab payload. The 7 classics re-embedded bilingually
        # on 2026-06-13 carry the Indonesian translation under `id` (and
        # English under `en` when present); still-AR-only corpora in this
        # branch simply lack those keys, so `.get(...) or ""` leaves them
        # blank. (Before this, the branch hardcoded both to "" — a stale
        # 2026-06-08 assumption that silently dropped classic-kitab
        # translations from the daleel pool, blanking the daleel card on
        # any flyer citing a classic kitab even though Qdrant had them.)
        _default_citations = {
            "bidayat_al_hidayah": "Bidayatul Hidayah",
            "al_umm": "Al-Umm",
            "al_bidayah_wan_nihayah": "Al-Bidayah wan-Nihayah",
            "nashaihul_ibad": "Nashaihul Ibad",
            "fiqh_as_sunnah": "Fiqh as-Sunnah",
            "fath_al_muin": "Fath al-Mu'in",
            "fath_al_qarib": "Fath al-Qarib",
            "adab_alim_mutaallim": "Adab al-'Alim wa al-Muta'allim",
            "aqidah_awam": "'Aqidat al-'Awam",
            "thalathat_al_usul": "Thalathat al-Usul",
            "syamail_muhammadiyyah": "Ash-Shama'il al-Muhammadiyyah",
            "sirah_ibn_hisham": "Sirah Ibn Hisham",
            "hayat_as_sahabah": "Hayat as-Sahabah",
        }
        default_citation = _default_citations[corpus]
        citation = payload.get("citation") or default_citation
        arabic = payload.get("ar") or ""
        translation_id = payload.get("id") or ""
        translation_en = payload.get("en") or ""
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
    # Per-corpus contribution tally — added 2026-06-09 so future
    # MIN_SCORE drift can be detected from production logs without
    # running an ad-hoc probe. `kept` is how many candidates from that
    # corpus cleared MIN_SCORE; `top` is the highest score we saw from
    # that corpus before threshold filtering.
    per_corpus_stats: dict[str, dict[str, Any]] = {}
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
        corpus_kept = 0
        corpus_top = None
        for hit in results:
            if corpus_top is None or (hit.score or 0) > corpus_top:
                corpus_top = hit.score
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
            corpus_kept += 1
        per_corpus_stats[corpus] = {
            "kept": corpus_kept,
            "top": round(corpus_top, 3) if corpus_top is not None else None,
            "thr": threshold,
        }

    all_hits.sort(key=lambda h: h["score"] or -1e9, reverse=True)
    # Corpora that returned zero candidates — early signal of MIN_SCORE
    # drift or a broken collection. Tracked separately so the dashboard
    # can chart "which kitabs are silent this week" without parsing the
    # per_corpus_stats blob.
    silent_corpora = sorted(c for c, s in per_corpus_stats.items() if s["kept"] == 0)

    # Per-corpus slot reservation — added 2026-06-09. Without this, a
    # naive global cosine sort lets high-absolute-score corpora (Quran
    # ~0.40, Muslim ~0.33) crowd out low-absolute-score AR-only corpora
    # (Sirah ~0.20, Shama'il ~0.20) from the top-`limit` pool — even
    # when those AR-only candidates are on-topic. The Gemini Flash-Lite
    # reranker that runs downstream can decide quality on merit, but
    # only sees what we hand it; if Sirah never makes top-28, it never
    # enters consideration. The MIN_SCORE recalibration earlier the
    # same day got AR-only corpora to clear their own thresholds, but
    # that's only step one — they also need a guaranteed seat at the
    # merge table.
    #
    # Algorithm: walk all_hits in score order, claim each corpus's
    # best (first-seen) candidate as a reserved slot, then fill the
    # remaining slots with the next-best cosine-sorted candidates from
    # any corpus. Backward-compatible: if every corpus's top-1 was
    # naturally in the global top-`limit` already, the output is
    # bit-identical to the pre-reservation sort.
    reserved: list[dict[str, Any]] = []
    seen_corpora: set[str] = set()
    for hit in all_hits:
        if hit["corpus"] not in seen_corpora:
            reserved.append(hit)
            seen_corpora.add(hit["corpus"])
    reserved_keys = {(h["corpus"], h["ref_id"]) for h in reserved}
    remaining = [
        h for h in all_hits if (h["corpus"], h["ref_id"]) not in reserved_keys
    ]
    if len(reserved) >= limit:
        final_hits = reserved[:limit]
    else:
        final_hits = reserved + remaining[: limit - len(reserved)]

    log.info(
        "kitab_retrieval.scored",
        query=query[:80],
        kept=len(all_hits),
        below_threshold=below_threshold,
        top_score=all_hits[0]["score"] if all_hits else None,
        per_corpus=per_corpus_stats,
        silent_corpora=silent_corpora,
        reserved_corpora=len(reserved),
    )
    return final_hits


# ── Exact-citation refetch ────────────────────────────────────────────
#
# When the brief composer picks a daleel by citation (e.g.
# "QS. Al-Baqara: 280", "Sahih Muslim 4734") that ISN'T in the pre-fetched
# pool, `retrieve_by_citation` lets us scroll Qdrant for the exact chunk
# and top up the pool — instead of em-dashing the marker (silent fallback)
# or swapping to the nearest pool entry (drifts the message).
#
# Why this exists (2026-06-19): the 2026-06-18 batch save path em-dashed
# 75% of saved flyer Dalil markers because the post-deploy re-dumped pool
# (semantic search at save time) differed from the compose-time pool, and
# there was no exact-citation lookup to top up. Renderer fell back to
# `pickFlyerDaleel(rank)` which returned random pool entries — readers
# saw correct headlines under wildly off-topic daleels. This function is
# the structural fix: any composer-picked citation that names a real
# kitab + identifier can be refetched on demand.

_QURAN_CITATION_RE = re.compile(
    r"""
    ^\s*QS\.?\s+               # "QS. " or "QS "
    (?P<surah>[^:]+?)           # surah translit (Al-Baqara / Al-Baqarah / Aal-i-Imraan / An-Nisaa / etc.)
    \s*[:.]?\s*                 # ": " or " . " or " "
    (?P<ayah>\d+)\b             # ayah number
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Hadith corpora citations carry the kitab name + a hadith number. The
# number is keyed on `payload.hadithnumber` (int). Different sources use
# different numbering systems (USC / Abdul Baqi / Bukhari's own), but
# the embedder writes whatever `citation_en` carries, so payload.citation_en
# is the authoritative match field.
_HADITH_CITATION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # corpus key, regex that captures hadith number in group 1
    ("bukhari", re.compile(r"^Sah[ie]h\s+(?:al-)?Bukhari\s+(\d+)", re.IGNORECASE)),
    ("muslim", re.compile(r"^Sah[ie]h\s+Muslim\s+(\d+)", re.IGNORECASE)),
    ("riyad_as_salihin", re.compile(r"^Riyad\s+as-Salihin\s+(\d+)", re.IGNORECASE)),
    ("bulugh_al_maram", re.compile(r"^Bulugh\s+al-Maram\s+(\d+)", re.IGNORECASE)),
]

# AR-only corpora citations carry the kitab name + a section descriptor
# (often Arabic text). The full citation string is the authoritative
# match field — we don't try to parse the section descriptor.
_AR_ONLY_CITATION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("bidayat_al_hidayah", re.compile(r"^Bidayat(?:ul)?\s+Hidayah\b", re.IGNORECASE)),
    ("nashaihul_ibad", re.compile(r"^Nashaihul\s+Ibad\b", re.IGNORECASE)),
    ("aqidah_awam", re.compile(r"^'?Aqidat?\s+al-'?Awam", re.IGNORECASE)),
    ("adab_alim_mutaallim", re.compile(r"^Adab\s+al-'Alim", re.IGNORECASE)),
    ("thalathat_al_usul", re.compile(r"^Thalathat\s+al-Usul", re.IGNORECASE)),
    ("syamail_muhammadiyyah", re.compile(r"^Ash-Shama'il\s+(?:al-)?Muhammadiyyah", re.IGNORECASE)),
    ("sirah_ibn_hisham", re.compile(r"^Sirah\s+Ibn\s+Hisham", re.IGNORECASE)),
    ("hayat_as_sahabah", re.compile(r"^Hayat\s+as-Sahabah", re.IGNORECASE)),
    ("fath_al_qarib", re.compile(r"^Fath\s+al-Qarib", re.IGNORECASE)),
    ("fath_al_muin", re.compile(r"^Fath\s+al-Mu'in", re.IGNORECASE)),
    ("fiqh_as_sunnah", re.compile(r"^Fiqh\s+as-Sunnah", re.IGNORECASE)),
    ("al_umm", re.compile(r"^Al-Umm\b", re.IGNORECASE)),
    ("al_bidayah_wan_nihayah", re.compile(r"^Al-Bidayah\s+wan-Nihayah", re.IGNORECASE)),
    # Tafsir Ibn Kathir uses a Quran-style citation, special-cased below
]


class _FakeHit:
    """Adapter so a `scroll`-fetched point can flow through `_normalize_hit`,
    which expects an object with `.payload` + `.score` attributes."""

    __slots__ = ("payload", "score")

    def __init__(self, payload: dict[str, Any] | None) -> None:
        self.payload = payload or {}
        self.score = None


def _normalize_surah_name(name: str) -> str:
    """Normalize Quran surah translit for tolerant matching. Operators
    write 'Al-Baqara' or 'Al-Baqarah'; the payload uses one canonical
    form. Compare lowercased + dash-stripped to survive both.
    """
    return re.sub(r"[\s'\-]+", "", name).lower()


def retrieve_occasion_daleel(
    occasion_slug: str,
    *,
    limit: int = 12,
    per_corpus: int = 4,
) -> list[dict[str, Any]]:
    """Retrieve daleel for an Islamic-calendar occasion (15th briefing
    track). Wraps the standard ``retrieve_daleel`` with the occasion's
    ``query_template`` from ``api/catalogs/hijri_occasions.yaml``.

    Returns the same hit shape as ``retrieve_daleel`` so the rest of
    the briefing pipeline (briefing.py prompt assembly,
    validate_briefing.scan_flyer_dalil_in_pool, manual_briefing save
    path) consume it without changes.

    Defaults are slightly more generous than ``retrieve_daleel`` (12
    vs 5) because occasion briefings need more breadth: the composer
    has to anchor sirah background + fiqh significance + supporting
    headlines, often across multiple kitab. Caller can still pass
    ``limit`` to override.

    Args:
      occasion_slug: stable slug from the catalog YAML
        (e.g. ``"asyura-1448"``, ``"ramadan-1448-w2"``).
      limit: max hits returned across all corpora after merge.
      per_corpus: how many hits to fetch from each corpus before merging.

    Returns: list of normalized hit dicts. Empty list if the slug is
    unknown, the query template is empty, or no candidate clears
    MIN_SCORE in any corpus.
    """
    from api.services.occasion_catalog import get_by_slug

    entry = get_by_slug(occasion_slug)
    if entry is None:
        log.warning(
            "kitab_retrieval.occasion_unknown_slug",
            slug=occasion_slug,
        )
        return []
    query = (entry.query_template or "").strip()
    if not query:
        log.warning(
            "kitab_retrieval.occasion_empty_query",
            slug=occasion_slug,
        )
        return []
    return retrieve_daleel(query, limit=limit, per_corpus=per_corpus)


def retrieve_by_citation(citation: str) -> dict[str, Any] | None:
    """Fetch a specific Qdrant chunk by its human-readable citation.

    Returns the same shape as `retrieve_daleel` hits (via `_normalize_hit`)
    so callers can append the result directly into `daleel_refs` without
    re-normalizing. Returns None if the citation can't be parsed, no
    matching chunk exists in Qdrant, or the qdrant call fails.

    Supported citation forms:
      - Quran:  "QS. Al-Baqara: 280", "QS. Al-Baqarah: 280",
                "QS. Aal-i-Imraan: 130", "QS. An-Nisaa: 161"
      - Hadith: "Sahih al-Bukhari 6377", "Sahih Muslim 1325",
                "Riyad as-Salihin 1701", "Bulugh al-Maram 951"
      - AR-only: "Bidayatul Hidayah — القول في معاصى القلب",
                 "Nashaihul Ibad — باب الثنائي (2/8)",
                 (matches on the FULL citation string verbatim)

    Notes:
      - For AR-only kitabs the section descriptor must match exactly;
        operators should copy the citation from the saved pool verbatim.
      - Tafsir Ibn Kathir entries use a 'Tafsir Ibn Kathir on <surah>:<ayah>'
        form — those parse via the Quran patterns.
    """
    from qdrant_client import models

    c = citation.strip()
    if not c:
        return None

    qdrant = _get_qdrant()

    # ── Quran path ────────────────────────────────────────────────────
    m = _QURAN_CITATION_RE.match(c)
    if m:
        surah_norm = _normalize_surah_name(m.group("surah"))
        ayah = int(m.group("ayah"))
        # surah is matched by ayah-number filter + post-filter on
        # normalized translit (payload's `surah_name_translit` may
        # be 'Al-Baqarah' while operator wrote 'Al-Baqara'). Scroll
        # all candidates for that ayah and pick the surah-name match.
        try:
            points, _ = qdrant.scroll(
                collection_name=COLLECTION_NAMES["quran"],
                scroll_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="ayah",
                            match=models.MatchValue(value=ayah),
                        )
                    ]
                ),
                limit=200,  # 114 surahs max for any given ayah number
                with_payload=True,
                with_vectors=False,
            )
        except Exception as exc:
            log.warning(
                "kitab_retrieval.refetch_quran_failed",
                citation=c,
                error=str(exc),
            )
            return None
        for p in points:
            payload = p.payload or {}
            translit_norm = _normalize_surah_name(
                str(payload.get("surah_name_translit") or "")
            )
            if translit_norm == surah_norm:
                return _normalize_hit("quran", _FakeHit(payload))
        log.info(
            "kitab_retrieval.refetch_quran_not_found",
            citation=c,
            surah_normalized=surah_norm,
            ayah=ayah,
        )
        return None

    # ── Hadith path ───────────────────────────────────────────────────
    # Match on the canonical citation STRING (citation_en / citation_id),
    # NOT the legacy integer `hadithnumber`. The 2026-06-23 sunnah.com
    # renumbering migration rewrote citation_en/citation_id to canonical
    # numbers but left `hadithnumber` on the OLD sequential numbering — so
    # filtering by hadithnumber resolves a migrated citation to the WRONG
    # chunk (e.g. "Sahih Muslim 2721a" → hadithnumber 2721 → the hadith now
    # labelled "Sahih Muslim 1156e") and silently drops sub-letters
    # ("2721a" → 2721). The regex still identifies the corpus; we match the
    # full citation string, keeping hadithnumber only as a legacy fallback.
    for corpus, pattern in _HADITH_CITATION_PATTERNS:
        m = pattern.match(c)
        if not m:
            continue
        for field in ("citation_en", "citation_id"):
            try:
                points, _ = qdrant.scroll(
                    collection_name=COLLECTION_NAMES[corpus],
                    scroll_filter=models.Filter(
                        must=[
                            models.FieldCondition(
                                key=field,
                                match=models.MatchValue(value=c),
                            )
                        ]
                    ),
                    limit=2,
                    with_payload=True,
                    with_vectors=False,
                )
            except Exception as exc:
                log.warning(
                    "kitab_retrieval.refetch_hadith_failed",
                    citation=c,
                    corpus=corpus,
                    field=field,
                    error=str(exc),
                )
                points = []
            if points:
                return _normalize_hit(corpus, _FakeHit(points[0].payload))
        # Legacy fallback: pre-migration citation whose citation_en/_id
        # isn't populated — match the parsed integer hadithnumber.
        try:
            hadithnumber = int(m.group(1))
            points, _ = qdrant.scroll(
                collection_name=COLLECTION_NAMES[corpus],
                scroll_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="hadithnumber",
                            match=models.MatchValue(value=hadithnumber),
                        )
                    ]
                ),
                limit=2,
                with_payload=True,
                with_vectors=False,
            )
        except Exception as exc:
            log.warning(
                "kitab_retrieval.refetch_hadith_failed",
                citation=c,
                corpus=corpus,
                error=str(exc),
            )
            return None
        if points:
            return _normalize_hit(corpus, _FakeHit(points[0].payload))
        log.info(
            "kitab_retrieval.refetch_hadith_not_found",
            citation=c,
            corpus=corpus,
        )
        return None

    # ── AR-only path (exact citation string match) ───────────────────
    for corpus, pattern in _AR_ONLY_CITATION_PATTERNS:
        if not pattern.match(c):
            continue
        try:
            points, _ = qdrant.scroll(
                collection_name=COLLECTION_NAMES[corpus],
                scroll_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="citation",
                            match=models.MatchValue(value=c),
                        )
                    ]
                ),
                limit=2,
                with_payload=True,
                with_vectors=False,
            )
        except Exception as exc:
            log.warning(
                "kitab_retrieval.refetch_ar_only_failed",
                citation=c,
                corpus=corpus,
                error=str(exc),
            )
            return None
        if points:
            return _normalize_hit(corpus, _FakeHit(points[0].payload))
        log.info(
            "kitab_retrieval.refetch_ar_only_not_found",
            citation=c,
            corpus=corpus,
        )
        return None

    log.info("kitab_retrieval.refetch_unparsed_citation", citation=c)
    return None


# ── Kisah Pendek (10-min storytelling slot) ───────────────────────────
#
# Source: one of FOUR narrative kitabs. Each has different content shape
# and section size, so the window strategy is per-corpus:
#
#   - al_bidayah_wan_nihayah: Ibn Kathir's universal history split into
#     ~1.5k-char fasal. A single fasal is too short for a 10-min retell,
#     so we pull window_before=2 + window_after=6 to assemble ~13k chars
#     of contiguous narrative (the original 2026-06-06 design).
#   - sirah_ibn_hisham: 192 sections of ~7k chars each (~3-page windows
#     of the 2-volume sirah). Each section is already substantial — no
#     window needed.
#   - hayat_as_sahabah: 687 thematic Sahabah anecdotes ~3k chars each.
#     Adjacent sections cover RELATED-but-distinct anecdotes within the
#     same theme; pulling neighbors would mix unrelated stories. Seed
#     alone, even at ~3k chars, gives the LLM enough scaffolding for a
#     1500-2000 word retelling.
#   - syamail_muhammadiyyah: 74 chapters on specific Prophetic traits
#     (~6k chars each). Each chapter is a tight self-contained set of
#     hadiths on ONE trait. Neighbors are different traits — window of
#     0.
#
# Two-step retrieval: cosine top-1 per corpus → Gemini Flash-Lite picks
# the single most thematically-coherent candidate.
_KisahCorpusConfig = dict[str, Any]
KISAH_SOURCE_CONFIG: dict[str, _KisahCorpusConfig] = {
    "al_bidayah_wan_nihayah": {
        "label_id": "Al-Bidayah wan-Nihayah",
        "label_en": "Al-Bidayah wan-Nihayah",
        "author_id": "Ibn Katsir",
        "author_en": "Ibn Kathir",
        "window_before": 2,
        "window_after": 6,
        # Point IDs in al_bidayah == section_id, so we can fetch the
        # window via direct ID arithmetic (cheap, no scroll).
        "id_scheme": "bare_section_id",
    },
    "sirah_ibn_hisham": {
        "label_id": "Sirah Ibnu Hisyam",
        "label_en": "Sirah Ibn Hisham",
        "author_id": "Ibnu Hisyam",
        "author_en": "Ibn Hisham",
        "window_before": 0,
        "window_after": 0,
        "id_scheme": "section_chunk",  # section_id * 100 + chunk_idx
    },
    "hayat_as_sahabah": {
        "label_id": "Hayatus Shahabah",
        "label_en": "Hayat as-Sahabah",
        "author_id": "Syaikh Yusuf al-Kandahlawi",
        "author_en": "Shaykh Yusuf al-Kandahlawi",
        "window_before": 0,
        "window_after": 0,
        "id_scheme": "section_chunk",
    },
    "syamail_muhammadiyyah": {
        "label_id": "Asy-Syama'il al-Muhammadiyyah",
        "label_en": "Ash-Shama'il al-Muhammadiyyah",
        "author_id": "Imam at-Tirmidzi",
        "author_en": "Imam al-Tirmidhi",
        "window_before": 0,
        "window_after": 0,
        "id_scheme": "section_chunk",
    },
}


def _embed_kisah_query(theme: str) -> list[float] | None:
    """Embed a kisah query once and record usage. Returns None on
    failure — the caller logs and skips the slot."""
    openai = _get_openai()
    try:
        emb = openai.embeddings.create(
            model=settings.embedding_model, input=theme
        )
        record_usage(
            provider="openai",
            operation="embedding",
            model=settings.embedding_model,
            tokens_in=getattr(emb.usage, "total_tokens", None),
            meta={"purpose": "kisah_retrieval"},
        )
        return emb.data[0].embedding
    except Exception as exc:
        log.warning("kisah_retrieval.embed_failed", error=str(exc))
        return None


def _pick_kisah_with_llm(
    theme: str, candidates: list[dict[str, Any]]
) -> int:
    """Gemini Flash-Lite picks the single most narrative-suitable
    candidate for the 10-min Kisah Pendek slot. Returns the index in
    `candidates`. Falls back to 0 (highest cosine) on any error so the
    pipeline never breaks on the picker.

    Picker uses the candidate's structural metadata (corpus, title) and
    a short preview of the body — enough to judge thematic fit and
    story-shape without sending the whole window to Gemini."""
    if len(candidates) <= 1:
        return 0

    from google import genai
    from google.genai import types as genai_types

    if not settings.gemini_api_key:
        return 0

    client = genai.Client(api_key=settings.gemini_api_key)

    numbered = "\n\n".join(
        f"[{i}] {c['source_label_id']} — {c['title'] or '(tanpa judul)'}\n"
        f"    Skor cosine: {c['score']:.3f}\n"
        f"    Pratinjau Arab (220 huruf pertama): {c['preview']}"
        for i, c in enumerate(candidates)
    )
    prompt = f"""Tema briefing pekan ini:
{theme}

Berikut {len(candidates)} kandidat kisah dari beberapa kitab naratif.
Tugas Anda: pilih SATU yang paling cocok untuk dijadikan KISAH PENDEK
10 menit (target retelling ~1800-2200 kata Bahasa Indonesia).

KARAKTER SUMBER (penting — pilih sesuai bentuk tema):
- Al-Bidayah wan-Nihayah (Ibn Katsir): sejarah dunia + sirah lengkap.
  Cocok untuk tema dengan bentuk: peristiwa sejarah besar, kisah
  khilafah / sahabat era kerajaan, peristiwa lintas-zaman, kisah para
  nabi terdahulu. Bentang waktu luas.
- Sirah Ibnu Hisyam: biografi inti Nabi ﷺ. PILIH ini kalau tema soal:
  hijrah, dakwah Mekkah, ghazwah (Badar/Uhud/Khandaq), perjanjian
  Madinah, fathu Makkah, haji wada'. Inilah sumber utama untuk SIRAH
  NABI klasik.
- Hayatus Shahabah (al-Kandahlawi): anekdot sahabat per tema (dakwah,
  iman, jihad, ibadah, akhlak). PILIH ini kalau tema soal: kiprah
  sahabat tertentu, pengorbanan sahabat dalam dakwah, semangat iman
  sahabat, akhlak para sahabat.
- Asy-Syama'il al-Muhammadiyyah (at-Tirmidzi): himpunan hadis SIFAT
  & KESEHARIAN Nabi ﷺ (penampilan, makan, tidur, ibadah, akhlak
  Rasulullah). PILIH ini kalau tema soal: akhlak / kebiasaan / sifat
  fisik / adab keseharian Nabi.

KRITERIA PILIHAN (urut prioritas):
1. KECOCOKAN BENTUK TEMA dengan SPESIALISASI SUMBER (lihat di atas).
   Kalau tema secara natural adalah biografi inti Nabi → Sirah Ibn
   Hisham mengalahkan Al-Bidayah meski Al-Bidayah juga punya
   sirah-content. Kalau tema soal sahabat → Hayatus Shahabah lebih
   tepat dari Al-Bidayah meski sama-sama menyebut sahabat.
2. KECOCOKAN TEMATIK isi kandidat: kisah harus benar-benar menyentuh
   tema, bukan hanya berbagi kata kunci. Mis. tema "korupsi pejabat"
   cocok dengan kisah ketegasan khalifah terhadap amil zakat, BUKAN
   dengan kisah pernikahan sahabat hanya karena ada kata "amanah".
3. BENTUK NARATIF: lebih disukai kisah yang punya struktur cerita
   (latar → ketegangan/peristiwa → resolusi/pelajaran).
4. JANGAN DEFAULT KE COSINE TERTINGGI. Skor cosine hanya ditunjukkan
   sebagai sinyal tambahan, bukan keputusan utama. Sumber dengan
   cosine lebih rendah bisa lebih tepat kalau spesialisasinya pas.

Kandidat:
{numbered}

Kembalikan JSON: {{"index": N}} dengan N adalah indeks (0..{len(candidates)-1})
dari kandidat pilihan."""

    try:
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1,
                max_output_tokens=80,
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
        import json as _json

        parsed = _json.loads(resp.text or "{}")
        idx = int(parsed.get("index", 0))
        if 0 <= idx < len(candidates):
            return idx
        return 0
    except Exception as exc:
        log.warning(
            "kisah_retrieval.picker_failed",
            error=str(exc),
            fallback_index=0,
        )
        return 0


def _build_kisah_window(
    qdrant: QdrantClient,
    corpus: str,
    config: _KisahCorpusConfig,
    seed_payload: dict[str, Any],
    seed_score: float,
    max_chars: int,
) -> list[dict[str, Any]] | None:
    """Build the contiguous narrative window around `seed_payload` per
    the corpus's configured strategy. Returns the ordered list of
    fasal/section dicts that the briefing prompt will render, or None
    when neither a window nor the seed alone is usable."""
    seed_id = int(seed_payload.get("section_id", 0) or 0)
    if seed_id <= 0:
        return None

    window_before = int(config["window_before"])
    window_after = int(config["window_after"])

    if window_before == 0 and window_after == 0:
        # No window — just the seed. Each section in sirah / hayat /
        # syamail is substantial enough on its own.
        ar = str(seed_payload.get("ar") or "")
        if not ar:
            return None
        return [{
            "section_id": seed_id,
            "title": seed_payload.get("title") or "",
            "qism": seed_payload.get("qism") or "",
            "citation": seed_payload.get("citation") or config["label_en"],
            "ar": ar,
        }]

    # Windowed retrieval — currently only al_bidayah_wan_nihayah uses
    # this branch (`id_scheme=bare_section_id`). The other 3 narrative
    # corpora use `section_id * 100 + chunk_idx` for point IDs, so
    # direct ID arithmetic doesn't yield neighbors — but they also set
    # window_before = window_after = 0 above, so we never reach here.
    collection = COLLECTION_NAMES.get(corpus, corpus)
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
        points = []
    if not points:
        # Window fetch failed — fall back to seed alone rather than
        # dropping the slot entirely.
        ar = str(seed_payload.get("ar") or "")
        if not ar:
            return None
        return [{
            "section_id": seed_id,
            "title": seed_payload.get("title") or "",
            "qism": seed_payload.get("qism") or "",
            "citation": seed_payload.get("citation") or config["label_en"],
            "ar": ar,
        }]

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
            "citation": p.get("citation") or config["label_en"],
            "ar": ar,
        })
        total_chars += len(ar)
    return fasal or None


def retrieve_kisah_pendek(
    theme: str,
    *,
    max_chars: int = 14000,
) -> dict[str, Any] | None:
    """Pick ONE 10-min storytelling source from four narrative kitabs.

    Sources (per 2026-06-09 expansion):
      - Al-Bidayah wan-Nihayah (Ibn Kathir) — universal history
      - Sirah Ibn Hisham — Prophetic biography
      - Hayat as-Sahabah (al-Kandahlawi) — Sahabah anecdotes
      - Ash-Shama'il al-Muhammadiyyah (al-Tirmidhi) — Prophetic conduct

    Why multi-source: the original 2026-06-06 design hardcoded
    Al-Bidayah only. As the corpus grew, themes like "akhlak
    Rasulullah" or "kisah para sahabat dalam dakwah" had stronger
    matches in Syamail / Hayat than in Al-Bidayah, but were forced to
    fall back to Al-Bidayah anyway. Multi-source widens the eligible
    pool so each theme gets the most narratively fitting kisah.

    Algorithm:
      1. Embed the theme once.
      2. Cosine top-1 against each of the 4 source collections.
      3. Filter by per-corpus MIN_SCORE.
      4. Gemini Flash-Lite picks the SINGLE most narrative-suitable
         candidate from what survived (thematic fit + story shape).
      5. Build the contiguous window per the chosen corpus's strategy
         (window of 2+6 for Al-Bidayah's small fasal; seed-only for
         the other 3 whose sections are already substantial).

    `max_chars` caps total Arabic chars so an over-long episode doesn't
    blow the prompt budget — only matters for Al-Bidayah where the
    window can balloon; the other 3 corpora's seeds are well within.

    Returns None when no source produced an above-threshold seed.
    Caller's prompt must skip the section gracefully — DO NOT fall
    back to the daleel pool.

    The returned dict carries `source_corpus` / `source_label_id` /
    `source_label_en` / `source_author_id` / `source_author_en` so the
    briefing prompt can phrase the attribution correctly per kitab.
    """
    if not theme.strip():
        return None
    vector = _embed_kisah_query(theme)
    if vector is None:
        return None

    qdrant = _get_qdrant()

    # Step 1+2: cosine top-1 per source corpus.
    candidates: list[dict[str, Any]] = []
    for corpus, config in KISAH_SOURCE_CONFIG.items():
        collection = COLLECTION_NAMES.get(corpus, corpus)
        try:
            qr = qdrant.query_points(
                collection_name=collection,
                query=vector,
                limit=1,
                with_payload=True,
            )
            results = qr.points
        except Exception as exc:
            log.debug(
                "kisah_retrieval.corpus_query_failed",
                corpus=corpus,
                error=str(exc),
            )
            continue
        if not results:
            continue
        seed = results[0]
        if seed.score is None:
            continue
        threshold = MIN_SCORE.get(corpus, 0.28)
        if seed.score < threshold:
            log.debug(
                "kisah_retrieval.below_threshold",
                corpus=corpus,
                score=seed.score,
                threshold=threshold,
            )
            continue
        payload = dict(seed.payload or {})
        ar_preview = str(payload.get("ar") or "")[:220]
        candidates.append({
            "corpus": corpus,
            "config": config,
            "payload": payload,
            "score": float(seed.score),
            "title": payload.get("title") or "",
            "preview": ar_preview,
            "source_label_id": config["label_id"],
            "source_label_en": config["label_en"],
        })

    if not candidates:
        log.info("kisah_retrieval.no_candidates", theme=theme[:80])
        return None

    # Highest cosine first — fallback order when the LLM picker errors.
    candidates.sort(key=lambda c: c["score"], reverse=True)

    # Step 3: LLM picks the single best.
    chosen_idx = _pick_kisah_with_llm(theme, candidates)
    chosen = candidates[chosen_idx]

    # Step 4: build window for chosen corpus.
    fasal = _build_kisah_window(
        qdrant,
        chosen["corpus"],
        chosen["config"],
        chosen["payload"],
        chosen["score"],
        max_chars,
    )
    if not fasal:
        return None

    total_chars = sum(len(f["ar"]) for f in fasal)
    log.info(
        "kisah_retrieval.assembled",
        chosen_corpus=chosen["corpus"],
        seed_score=chosen["score"],
        candidate_corpora=[c["corpus"] for c in candidates],
        candidate_scores=[round(c["score"], 3) for c in candidates],
        picker_idx=chosen_idx,
        fasal_count=len(fasal),
        total_chars=total_chars,
    )
    config = chosen["config"]
    return {
        "fasal": fasal,
        "seed_section_id": fasal[0]["section_id"] if fasal else 0,
        "seed_score": chosen["score"],
        "total_chars": total_chars,
        "source_corpus": chosen["corpus"],
        "source_label_id": config["label_id"],
        "source_label_en": config["label_en"],
        "source_author_id": config["author_id"],
        "source_author_en": config["author_en"],
    }


def retrieve_kisah_pendek_unranked(
    theme: str,
) -> list[dict[str, Any]]:
    """Per-corpus top-1 candidates WITHOUT the Gemini Flash-Lite picker.

    Same retrieval as `retrieve_kisah_pendek` up to step 3 (cosine top-1
    per corpus, filter by MIN_SCORE). Skips the LLM picker AND the
    window build. Returns ALL surviving candidates sorted by score so a
    human (Claude in the manual-briefing two-stage flow) can pick the
    source kitab themselves and then call `build_kisah_for_corpus` to
    materialize the contiguous window for the chosen one.

    Empty list when no source has an above-threshold seed.
    """
    if not theme.strip():
        return []
    vector = _embed_kisah_query(theme)
    if vector is None:
        return []

    qdrant = _get_qdrant()
    candidates: list[dict[str, Any]] = []
    for corpus, config in KISAH_SOURCE_CONFIG.items():
        collection = COLLECTION_NAMES.get(corpus, corpus)
        try:
            qr = qdrant.query_points(
                collection_name=collection,
                query=vector,
                limit=1,
                with_payload=True,
            )
            results = qr.points
        except Exception as exc:
            log.debug(
                "kisah_unranked.corpus_query_failed",
                corpus=corpus,
                error=str(exc),
            )
            continue
        if not results:
            continue
        seed = results[0]
        if seed.score is None:
            continue
        threshold = MIN_SCORE.get(corpus, 0.28)
        if seed.score < threshold:
            continue
        payload = dict(seed.payload or {})
        candidates.append(
            {
                "corpus": corpus,
                "payload": payload,
                "score": float(seed.score),
                "title": payload.get("title") or "",
                "preview": str(payload.get("ar") or "")[:300],
                "source_label_id": config["label_id"],
                "source_label_en": config["label_en"],
                "source_author_id": config["author_id"],
                "source_author_en": config["author_en"],
            }
        )

    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates


def build_kisah_for_corpus(
    corpus: str,
    payload: dict[str, Any],
    score: float,
    *,
    max_chars: int = 14000,
) -> dict[str, Any] | None:
    """Materialize the contiguous fasal window for a chosen kisah source.

    Pair with `retrieve_kisah_pendek_unranked`: caller picks ONE
    candidate, then calls this to build the full window for prompting.

    Returns the same shape as `retrieve_kisah_pendek` so downstream
    `_build_user_prompt` consumers are unchanged.
    """
    config = KISAH_SOURCE_CONFIG.get(corpus)
    if config is None:
        return None
    qdrant = _get_qdrant()
    fasal = _build_kisah_window(
        qdrant, corpus, config, payload, score, max_chars
    )
    if not fasal:
        return None
    total_chars = sum(len(f["ar"]) for f in fasal)
    return {
        "fasal": fasal,
        "seed_section_id": fasal[0]["section_id"] if fasal else 0,
        "seed_score": score,
        "total_chars": total_chars,
        "source_corpus": corpus,
        "source_label_id": config["label_id"],
        "source_label_en": config["label_en"],
        "source_author_id": config["author_id"],
        "source_author_en": config["author_en"],
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
    result = all_hits[:limit]

    # Du'a FLOOR: guarantee the pool carries actual recitable supplications
    # for slot 5/6, not just harakat'd command verses. Top up from the
    # canonical set (exact-citation refetch) until we have at least
    # _MIN_DUA_SUPPLICATIONS — but only when the theme-biased retrieval
    # came up short, so on-theme du'a still win when they exist.
    n_supp = sum(1 for h in result if _looks_like_supplication(h.get("arabic", "")))
    if n_supp < _MIN_DUA_SUPPLICATIONS:
        present = {h.get("citation", "") for h in result}
        added: list[str] = []
        for cit in _CANONICAL_DUA_CITATIONS:
            if n_supp >= _MIN_DUA_SUPPLICATIONS:
                break
            if cit in present:
                continue
            hit = retrieve_by_citation(cit)
            if hit and _looks_like_supplication(hit.get("arabic", "")):
                result.append(hit)
                added.append(cit)
                n_supp += 1
        if added:
            log.info(
                "adhkar_retrieval.dua_floor_topup",
                theme=theme[:60],
                added=added,
            )

    log.info(
        "adhkar_retrieval.scored",
        theme=theme[:80],
        kept=len(all_hits),
        top_score=all_hits[0]["score"] if all_hits else None,
        dua_supplications=n_supp,
    )
    return result


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

    # ── Stage 2: gather candidates from the flyer-source whitelist ──
    # The flyer surface is a 1080x1080 image with ~3-4 lines of daleel
    # text — it has different curation needs than the briefing daleel
    # pool. By 2026-06-09 product call, flyer daleel comes from a
    # tight 7-kitab whitelist:
    #   - Hadith canon: Bukhari + Muslim + Riyad as-Salihin + Bulugh
    #     al-Maram. These have clean citations, manageable hadith
    #     lengths, and well-known weight in Indonesian audiences.
    #   - Pesantren staples: Bidayatul Hidayah (Al-Ghazali — adab/
    #     spiritual matn) + Nashaihul Ibad (Nawawi al-Bantani — akhlak)
    #     + 'Aqidat al-'Awam (al-Marzuqi — Ash'ari creed nadham).
    # Explicit exclusions worth calling out:
    #   - Qur'an — the curator's product decision (verses can carry
    #     more weight than a 1080x1080 graphic deserves; verses also
    #     tend toward longer translations that overflow the card).
    #   - Sirah/biographical kitabs (Sirah Ibn Hisham, Hayat as-Sahabah,
    #     Al-Bidayah wan-Nihayah, Shama'il) — those are narrative
    #     sources for the Kisah Pendek slot, not pull-quote material.
    #   - Fiqh-heavy kitabs (Al-Umm, Fath al-Mu'in, Fath al-Qarib,
    #     Fiqh as-Sunnah, Adab al-'Alim) — ruling-style passages are
    #     hard to translate to a 240-char punchy flyer line.
    #   - Tafsir Ibn Kathir — same overflow problem as Qur'an.
    #   - Thalathat al-Usul — Salafi creed matn; left out to avoid
    #     mixing manhaj voices on creed flyers (creed slot defers to
    #     'Aqidat al-'Awam instead).
    qdrant = _get_qdrant()
    candidates: list[dict[str, Any]] = []
    flyer_corpora = [c for c in FLYER_ALLOWED_CORPORA if c in COLLECTION_NAMES]
    for corpus in flyer_corpora:
        collection = COLLECTION_NAMES[corpus]
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

    # Sort by cosine score desc, trim to pool size for the LLM judge.
    # We do NOT pre-filter EN-only entries — that would drop relevant
    # hadith candidates (the kitab corpus is mostly EN-translated at
    # embed time). Instead the post-pick stage lazy-translates the
    # chosen entry to ID if needed. Picks relevance over translation
    # availability.
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

        # ── Stage 4: lazy ID translation if needed ────────────────
        # Kitab corpora (hadith especially) are mostly EN-only at embed
        # time. If the judge picked an EN-only entry, translate it to
        # Indonesian before returning so the flyer renderer can use
        # `translation_id` without falling back to English. Uses the
        # sync `_call_gemini` from hadith_translation (skipping the
        # async DB cache — cost is ~$0.0001 per pick which is fine for
        # the once-per-flyer call frequency). Added 2026-06-08 after
        # audit found 42% of flyer cards rendering in English.
        trans_id = (chosen.get("translation_id") or "").strip()
        trans_en = (chosen.get("translation_en") or "").strip()
        if not trans_id and trans_en:
            try:
                from api.services.hadith_translation import _call_gemini as _translate_hadith_sync
                id_text = _translate_hadith_sync(trans_en)
                if id_text:
                    chosen = dict(chosen)
                    chosen["translation_id"] = id_text
                    log.info(
                        "flyer_pick.lazy_translated",
                        citation=chosen["citation"],
                        chars=len(id_text),
                    )
            except Exception as exc:
                # Translation is best-effort; if it fails the renderer
                # still has translation_en as fallback.
                log.warning(
                    "flyer_pick.lazy_translate_failed",
                    citation=chosen.get("citation"),
                    error=str(exc)[:200],
                )

        log.info(
            "flyer_pick.judged",
            headline=(flyer_headline or "")[:60],
            picked_cit=chosen["citation"],
            picked_trans_len=len(
                chosen.get("translation_id")
                or chosen.get("translation_en")
                or ""
            ),
            had_lazy_translate=bool(not trans_id and trans_en),
            reason=reason[:120],
            is_adhkar=is_adhkar_slot,
        )
        return chosen

    except Exception as exc:
        log.warning("flyer_pick.judge_failed", error=str(exc))
        # Defense in depth: rather than breaking the briefing, fall
        # back to top-1 by cosine. Logged so anomalies are auditable.
        return candidates[0]
