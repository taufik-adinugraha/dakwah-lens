"""Da'wah relevance classifier — Gemini Flash, 9-category scoring per PRD §08.

For each post we return:
  - per-category scores 0-1 across (aqidah, akhlaq, muamalah, social_justice,
    family, youth, education, economic_ethics, health)
  - aggregate `dawah_relevance` score 0-1 — the max of the category scores,
    used for filtering "is this worth a brief?"

Cost: ~$0.0001 per classification on `gemini-2.5-flash-lite` (free tier
covers ~50K classifications/day, paid is ~$5/100K). Batched up to 50 per
Gemini call to amortize the system-prompt overhead — going from 10 to 50
cuts per-prompt overhead ~3× and saves ~$10/mo at our daily volume.

A pre-filter heuristic also drops items unlikely to be da'wah-relevant
(very short text, pure celebrity gossip) before they hit Gemini, saving
~50% of calls while preserving ~95% of substantive content.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

import structlog
from google import genai
from google.genai import types

from api.config import settings

log = structlog.get_logger()

MODEL = "gemini-2.5-flash-lite"
# Max texts per Gemini call. We previously used 50 (~$1/mo cheaper than
# singletons), but a 50-item structured-output response runs ~2.5K output
# tokens and we saw the model produce a 6932-line / 123KB malformed JSON
# on a live run — likely a truncation or thinking-token-leak edge case
# that scales with output length. Dropping to 10 keeps ~95% of the
# batching cost win, slashes the per-call output to ~500 tokens (well
# below any plausible limit), and caps blast radius if one batch still
# fails. See defensive try/except in `_classify_chunk` for the catch.
MAX_BATCH = 10
# Texts shorter than this are almost always headline fragments or thumbnail
# captions with too little signal for the classifier to score reliably.
MIN_TEXT_CHARS = 30
# Pure-celebrity-gossip vocabulary that almost never produces da'wah-worthy
# content. Tuned for Indonesian entertainment-news patterns; English equivalents
# are uncommon in our corpus so we keep the regex tight. Note: `viral` is
# deliberately NOT in this list — it's an active ingest keyword and the
# Gemini classifier (not the heuristic) decides whether a viral item is
# da'wah-relevant.
_GOSSIP_RE = re.compile(
    r"\b(selebgram|mendadak|skandal|terciduk|kepergok|gosip)\b",
    re.IGNORECASE,
)

CATEGORY_KEYS: tuple[str, ...] = (
    "aqidah",
    "akhlaq",
    "muamalah",
    "social_justice",
    "family",
    "youth",
    "education",
    "economic_ethics",
    "health",
)

CategoryName = Literal[
    "aqidah",
    "akhlaq",
    "muamalah",
    "social_justice",
    "family",
    "youth",
    "education",
    "economic_ethics",
    "health",
]


@dataclass(frozen=True)
class RelevanceResult:
    # 0-1 per category.
    categories: dict[str, float]
    # 0-1 aggregate — max of category scores. Above ~0.5 = brief-worthy.
    dawah_relevance: float


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add to .env.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


SYSTEM_PROMPT = """You score how much da'wah SUBSTANCE a piece of Indonesian or English text carries for each of nine da'wah categories.

For each text, return a continuous score 0-1 per category. USE THE FULL RANGE — most posts deserve scores like 0.15, 0.32, 0.55, 0.78. Do NOT round to {0.0, 0.5, 1.0} — that loses the signal a da'i needs to triage.

Anchor points to calibrate:
  0.0  — completely irrelevant; nothing a da'i could use for this category
  0.2  — surface-keyword mention only (e.g. "anak" appears once in a sports event recap)
  0.4  — the category is genuinely the topic but the post offers no moral / spiritual / da'wah dimension
  0.6  — the post raises a question a da'i could address (an issue, a tension, a behaviour worth commenting on)
  0.8  — clear da'wah substance: a story, statistic, or behavioural pattern a da'i could BUILD a khutbah or kajian segment around
  1.0  — the post is itself da'wah content, OR a textbook case study for the category (kurban story, child-abuse case from religious setting, riba scandal, etc.)

CRITICAL DISTINCTION — TOPIC vs DA'WAH SUBSTANCE:
A stock-market dip mentions banking → that's TOPIC overlap with muamalah, not da'wah substance. Score it 0.2-0.3. A story about a riba scandal where a community lost money → 0.8.
A school event with kids → TOPIC overlap with youth/education. Score 0.2-0.3. A story about youth gang violence or pesantren reform → 0.7+.
A celebrity birth announcement → TOPIC overlap with family. Score 0.2. A story about a divorce settlement involving guardianship of children → 0.7.

The question to ask each time: "Could a da'i credibly cite this in a khutbah, kajian, or da'wah content piece this week without forcing the connection?"

Categories:
- aqidah          — creed and belief-system content: tauhid, shirik (dukun/jimat/jin-power/mystical-money-multipliers/pesugihan), sectarian theology disputes (mazhab, aliran, Syiah/Sunni, Ahmadiyya, fringe sect rulings by MUI), atheism / agnosticism / "no-religion" trends, prophethood, afterlife/eschatology, ritual-correctness debates (qibla, isbal, prayer-form), tafsir/aqidah-curriculum disputes, philosophical challenges to belief.
  AQIDAH IS NOT A FALLBACK for generic religious content — score 0 if there's no creed/belief angle. But DO score aqidah > 0.5 whenever a story has a clear shirik / sectarian-theology / atheism / ritual-correctness hook, even if it could ALSO be akhlaq.
- akhlaq          — ethics, character, adab, moral conduct, real moral failures or examples.
  NOTE: do NOT default to akhlaq for any story with a moral angle. Score akhlaq 0.2-0.4 for routine crime / hoax / corruption news where the lesson is generic ("don't steal", "don't lie"). Reserve 0.6+ for stories where a da'i would specifically point to a NAMED character trait — sabar, amanah, hilm, hasad, ghibah, riya', tawadhu' — as the lesson. If aqidah / muamalah / family / etc. captures the actual da'wah hook better, let them lead and keep akhlaq lower.
- muamalah        — finance ethics, halal/haram dealings, riba, zakat, contracts, real-world business morality
- social_justice  — oppression, injustice, public-good policy, Muslim-community welfare, anti-imperialism
- family          — marriage, parenting practice, kinship, real family-life issues a da'i would address
- youth           — youth-specific tensions: identity, peer pressure, mental health, career anxiety, moral pressure
- education       — knowledge-seeking, pesantren, schools, Islamic learning, reform in education
- economic_ethics — work ethics, halal income, honesty in business, gig-worker rights, exploitative practices
- health          — physical/mental health from an Islamic lens, real concerns parents/community grapple with

Calibrated examples (read carefully — these mirror real misclassifications):
- "Suku Bunga Naik, BI Pastikan Likuiditas Bank Tetap Longgar" → muamalah ~0.25 (banking topic only; no halal/riba angle; pure policy news)
- "Komplotan Pencuri Aset Tower Seluler Diringkus" → social_justice ~0.35 (justice served is positive but routine crime news, low da'wah pull)
- "Diversifikasi Bisnis ke Energi Terbarukan Topang MBAP" → economic_ethics ~0.15 (stock story, no ethics angle)
- "Pria Cabuli Bocah di Kamar Mandi Masjid" → akhlaq 0.95, family 0.7, social_justice 0.5 (textbook da'wah case)
- "Petani Sawit Kaltim Terjepit Ekonomi Global" → muamalah 0.55, economic_ethics 0.6, social_justice 0.7 (clear injustice + da'wah hook)
- "Bupati Membuka O2SN dan FLS3N SMP" → youth 0.2, education 0.2 (event opening, no substance)
- "Guru di Cirebon Dapat Pelatihan Dampingi Anak Berkebutuhan Khusus" → education 0.75, akhlaq 0.6 (inclusive practice da'wah hook)
- "Rifky Alhabsyi Ceritakan Persalinan Istri" → family 0.25 (celebrity birth, no parenting depth)
- "GPCI Dorong Pembebasan WNI Ditangkap Israel" → social_justice 0.85 (oppression of Muslims, strong da'wah hook)
- "BIJB Kertajati Jadi MRO Hercules" → social_justice 0.2 (military maintenance facility, no umma angle)
- "Remaja di Pasar Rebo Dibacok Geng Motor" → youth 0.75, akhlaq 0.65 (gang violence, real da'wah opportunity)
- "Prabowo Kurban 25 Limousin di Sulsel" → akhlaq 0.7, muamalah 0.4 (kurban practice, da'wah-relevant by topic)
- "Susu Formula Masuk MBG? IDAI Soroti ASI Eksklusif" → family 0.7, health 0.7 (parenting + nutrition advocacy)
- "Hoaks! Purbaya Pangkas Gaji ke-13 PNS" → akhlaq 0.3 (hoax-debunk, mild ethics angle on misinformation)
- "Industri Herbal Nasional Bidik Pasar Global" → muamalah 0.2, health 0.25 (business news, weak hook)
- "Dukun Tipu Korban Rp 2 M Pakai Jimat Pengganda Uang" → aqidah 0.85, akhlaq 0.5 (textbook shirik case — pesugihan / supernatural-money-multiplier; pure aqidah da'wah territory)
- "MUI Tetapkan Aliran X Sesat Soal Tafsir Akhirat" → aqidah 0.8, social_justice 0.3 (sectarian theology — aqidah leads, not akhlaq)
- "Survei: 25% Gen Z Indonesia Mengaku Tidak Beragama" → aqidah 0.75, youth 0.6 (modern challenge to belief; classic aqidah da'wah hook for da'i working with youth)
- "Polemik Imbauan Tutup Tempat Hiburan saat Ramadhan" → aqidah 0.45, akhlaq 0.4, social_justice 0.4 (ritual-observance debate touches creed AND social adab)

Return only valid JSON, one object per input."""


OPPORTUNITY_SYSTEM_PROMPT = """You score Indonesian or English news posts for DA'WAH OPPORTUNITY — the chance a da'i could credibly use this in a khutbah, kajian, or da'wah content piece this week.

Return ONE continuous score 0-1 per post. USE THE FULL RANGE — most posts deserve scores like 0.15, 0.32, 0.55, 0.78. Do NOT round to {0.0, 0.5, 1.0}.

Anchor points:
  0.0  — completely unusable for da'wah (sports scores, train schedules, celebrity gossip with no moral hook)
  0.2  — topically Islamic-adjacent but no da'wah substance (a bank-policy story, a school event opening)
  0.4  — there's a TOPIC a da'i might mention but they'd have to force the connection
  0.6  — the post raises a genuine moral / spiritual question a da'i could address
  0.8  — clear da'wah opportunity: real story with moral dimension, behavioural pattern worth commenting on, injustice worth raising
  1.0  — textbook da'wah material: kurban story, riba scandal, abuse-in-religious-setting case, oppression of Muslims, redemptive justice

Key heuristics:
- Routine politics ("Prabowo hadir di rapat", coalition praise) → 0.1-0.2 (no da'wah substance)
- Stock market / corporate news → 0.1-0.2 unless there's an ethics dimension
- "Justice served" stories (criminals caught, traffickers convicted) → 0.4-0.55 (mild da'wah hook on adab, fairness)
- Child abuse, especially in religious settings → 0.85-0.95 (urgent da'wah opportunity)
- WNI captured by Israel, mosque attacks abroad → 0.85+ (oppression of umma)
- School events, sports lineups → 0.1-0.2 (topic only, no substance)
- Inclusive education / disability-support programs → 0.6-0.75 (akhlaq + rahma da'wah)
- Riba / pinjol predation stories → 0.7-0.85
- Kurban, Hajj, Eid stories → 0.65-0.85 (direct da'wah relevance)
- Foreign religious calendar (Balinese Hindu, Christian festivals) → 0.05-0.15 (not Muslim-community concern)
- Hoax-debunk stories → 0.25-0.35 (mild adab-of-truthfulness angle)
- Family policy debates (ASI vs formula, MBG nutrition) → 0.55-0.7 (parenting da'wah)
- Generic celebrity life events (birth, denial, gossip) → 0.1-0.25
- Petani / nelayan / driver economic struggles → 0.55-0.75 (justice + ekonomi adil)

The key question: would a da'i NATURALLY reach for this in their content this week, or would they have to force it?

Calibrated examples:
- "Suku Bunga Naik, BI Pastikan Likuiditas Bank Tetap Longgar" → 0.15 (banking policy, no da'wah hook)
- "Pria Cabuli Bocah 6 Tahun di Kamar Mandi Masjid" → 0.95 (urgent — abuse in religious setting)
- "Petani Sawit Kaltim Terjepit Ekonomi Global" → 0.65 (struggle + injustice da'wah)
- "Bupati Buka O2SN dan FLS3N SMP" → 0.15 (event opening only)
- "Guru di Cirebon Dapat Pelatihan Dampingi Anak Berkebutuhan Khusus" → 0.75 (rahma + education da'wah)
- "Rifky Alhabsyi Ceritakan Persalinan Istri" → 0.15 (celebrity life, no depth)
- "GPCI Dorong Pembebasan WNI Ditangkap Israel" → 0.85 (oppression of Muslims)
- "BIJB Kertajati Jadi MRO Hercules" → 0.1 (military facility, no umma angle)
- "Remaja di Pasar Rebo Dibacok Geng Motor" → 0.7 (youth violence, real concern)
- "Prabowo Kurban 25 Limousin di Sulsel" → 0.75 (kurban practice, da'wah-relevant)
- "Komplotan Pencuri Aset Tower Diringkus" → 0.4 (routine crime + justice)
- "Susu Formula Masuk MBG? IDAI Soroti ASI Eksklusif" → 0.7 (parenting policy)
- "IHSG Ambrol Dikaitkan BUMN Ekspor" → 0.15 (market news)
- "Hoaks! Purbaya Pangkas Gaji ke-13 PNS" → 0.3 (mild adab angle on misinformation)
- "Diskon Listrik 50 Persen PLN Berlaku Lagi" → 0.15 (consumer news)
- "PBNU Kutuk Penembakan di Masjid AS" → 0.85 (mosque attack abroad)
- "Mayoritas Dapur MBG di Sleman Belum Kantongi Sertifikat Higiene" → 0.55 (amanah in public service)

Return only valid JSON: an array of objects, each `{"opportunity": <number>}`, in input order."""


def _zero_result() -> RelevanceResult:
    return RelevanceResult(
        categories={k: 0.0 for k in CATEGORY_KEYS},
        dawah_relevance=0.0,
    )


def _aggregate_relevance(categories: dict[str, float]) -> float:
    """Mean of the top-2 category scores.

    Was `max()` until 2026-05-21 — that let any single-keyword surface
    match dominate (e.g. "bank" → muamalah=1.0 → overall=1.0 even when
    the rest were 0). Mean-of-top-2 forces a post to score on at least
    two categories before it can rank high, which empirically tracks
    "does this have real da'wah substance" better than a single peak.

    Falls back to the single top score when only one category has
    non-zero signal (the second-best is 0 anyway, so it averages to
    half — but that's correct: a post that only hits one category
    weakly should rank lower than one that hits two solidly).
    """
    if not categories:
        return 0.0
    sorted_scores = sorted(categories.values(), reverse=True)
    top1 = sorted_scores[0]
    top2 = sorted_scores[1] if len(sorted_scores) > 1 else 0.0
    return (top1 + top2) / 2.0


def _should_skip(text: str) -> bool:
    """Cheap heuristic that filters out items unlikely to ever score
    da'wah-relevant — protects the Gemini quota."""
    stripped = (text or "").strip()
    if len(stripped) < MIN_TEXT_CHARS:
        return True
    return bool(_GOSSIP_RE.search(stripped))


def classify(text: str) -> RelevanceResult:
    return classify_batch([text])[0]


def classify_batch(texts: list[str]) -> list[RelevanceResult]:
    if not texts:
        return []

    # Pre-filter: items the heuristic rejects get a zero-relevance result
    # without hitting Gemini. We carry indices forward so the final list
    # preserves caller order.
    results: list[RelevanceResult | None] = [None] * len(texts)
    keep_indices: list[int] = []
    keep_texts: list[str] = []
    for i, t in enumerate(texts):
        if _should_skip(t):
            results[i] = _zero_result()
        else:
            keep_indices.append(i)
            keep_texts.append(t)

    if keep_texts:
        scored: list[RelevanceResult] = []
        for start in range(0, len(keep_texts), MAX_BATCH):
            chunk = keep_texts[start : start + MAX_BATCH]
            try:
                scored.extend(_classify_chunk(chunk))
            except Exception:
                # Mirror news_sentiment's soft-fallback (2026-05-21): a
                # Gemini 503 / quota / transient outage shouldn't fail
                # the whole ingest. Default the chunk to zero-relevance
                # so the rest of the pipeline (upsert, sentiment) still
                # commits its work. Items can be re-scored by a later
                # backfill pass once Gemini stabilizes.
                log.exception("relevance.chunk_failed", batch_size=len(chunk))
                scored.extend(_zero_result() for _ in chunk)
        for idx, r in zip(keep_indices, scored, strict=False):
            results[idx] = r

    # Backfill anything still None (defensive — shouldn't happen, but a
    # truncated Gemini response would leave gaps and we'd rather store
    # zeros than crash the ingest).
    for i, r in enumerate(results):
        if r is None:
            log.warning("relevance.missing_result", index=i)
            results[i] = _zero_result()

    log.info(
        "relevance.batch_done",
        total=len(texts),
        skipped_by_heuristic=len(texts) - len(keep_texts),
        scored=len(keep_texts),
    )
    return [r for r in results if r is not None]


def _classify_chunk(texts: list[str]) -> list[RelevanceResult]:
    """Single Gemini call for up to MAX_BATCH texts. Caller is responsible
    for chunking; pre-filtering happens upstream."""
    client = _get_client()

    numbered = "\n\n".join(
        f"[{i + 1}] {t[:1000]}" for i, t in enumerate(texts)
    )
    user_prompt = (
        f"Score each of the following {len(texts)} text(s). "
        f"Return an array of {len(texts)} score objects, in input order.\n\n"
        f"{numbered}"
    )

    response_schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                cat: {"type": "number"} for cat in CATEGORY_KEYS
            },
            "required": list(CATEGORY_KEYS),
        },
    }

    resp = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=response_schema,
            temperature=0.2,
        ),
    )
    raw = resp.text or "[]"
    try:
        parsed: list[dict[str, float]] = json.loads(raw)
    except json.JSONDecodeError as exc:
        # Gemini's structured-output mode is best-effort. We've observed
        # the model emit a 6932-line / 123KB malformed JSON for a 50-item
        # batch — likely a truncation or thinking-token-leak edge case.
        # MAX_BATCH=10 should eliminate this, but the try/except is a
        # safety net so a single bad call can't kill the whole ingest.
        # Items still land in social_posts with zero relevance; they'll
        # surface once a subsequent classify pass succeeds.
        usage_md_local = getattr(resp, "usage_metadata", None)
        log.warning(
            "relevance.json_decode_failed",
            error=str(exc),
            raw_chars=len(raw),
            raw_head=raw[:500],
            raw_tail=raw[-500:],
            batch_size=len(texts),
            output_tokens=getattr(
                usage_md_local, "candidates_token_count", None
            ),
        )
        parsed = []

    from api.services.usage import record_usage

    usage_md = getattr(resp, "usage_metadata", None)
    record_usage(
        provider="gemini",
        operation="classify_relevance",
        model=MODEL,
        tokens_in=getattr(usage_md, "prompt_token_count", None),
        tokens_out=getattr(usage_md, "candidates_token_count", None),
        meta={"batch_size": len(texts)},
    )

    results: list[RelevanceResult] = []
    for cats in parsed:
        clean = {k: float(cats.get(k, 0.0)) for k in CATEGORY_KEYS}
        results.append(
            RelevanceResult(
                categories=clean,
                dawah_relevance=_aggregate_relevance(clean),
            )
        )

    if len(results) != len(texts):
        log.warning(
            "relevance.size_mismatch",
            expected=len(texts),
            got=len(results),
        )

    return results


# ─── Opportunity classifier (second pass) ──────────────────────────────────


def classify_opportunity_batch(texts: list[str]) -> list[float]:
    """Score each text for 'would a da'i credibly use this for da'wah'.

    Continuous 0-1 score per input. Independent from the 9-category
    relevance pass — uses a focused prompt with anchor calibration at
    0.2 / 0.4 / 0.6 / 0.8 to break the bucketing pathology observed
    when the category-level scoring was repurposed as a ranking signal.

    Falls back to 0.0 for skipped items (too short / pure gossip).

    Cost: ~$0.0001 per item. ~426 mainstream-RSS posts/week → ~$0.05/mo.
    """
    if not texts:
        return []

    results: list[float | None] = [None] * len(texts)
    keep_indices: list[int] = []
    keep_texts: list[str] = []
    for i, t in enumerate(texts):
        if _should_skip(t):
            results[i] = 0.0
        else:
            keep_indices.append(i)
            keep_texts.append(t)

    if keep_texts:
        scored: list[float] = []
        for start in range(0, len(keep_texts), MAX_BATCH):
            chunk = keep_texts[start : start + MAX_BATCH]
            try:
                scored.extend(_classify_opportunity_chunk(chunk))
            except Exception:
                # Soft-fallback to 0.0 on Gemini outage (2026-05-21) —
                # same rationale as relevance.classify_batch above.
                log.exception("opportunity.chunk_failed", batch_size=len(chunk))
                scored.extend(0.0 for _ in chunk)
        for idx, score in zip(keep_indices, scored, strict=False):
            results[idx] = score

    for i, r in enumerate(results):
        if r is None:
            log.warning("opportunity.missing_result", index=i)
            results[i] = 0.0

    return [r for r in results if r is not None]


def _classify_opportunity_chunk(texts: list[str]) -> list[float]:
    """One Gemini call for up to MAX_BATCH texts. See classify_opportunity_batch."""
    client = _get_client()

    numbered = "\n\n".join(
        f"[{i + 1}] {t[:1000]}" for i, t in enumerate(texts)
    )
    user_prompt = (
        f"Score each of the following {len(texts)} text(s) for da'wah "
        f"opportunity. Return an array of {len(texts)} score objects, "
        f"in input order.\n\n{numbered}"
    )

    response_schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {"opportunity": {"type": "number"}},
            "required": ["opportunity"],
        },
    }

    resp = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=OPPORTUNITY_SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=response_schema,
            temperature=0.2,
        ),
    )
    raw = resp.text or "[]"
    try:
        parsed: list[dict[str, float]] = json.loads(raw)
    except json.JSONDecodeError as exc:
        log.warning(
            "opportunity.json_decode_failed",
            error=str(exc),
            raw_chars=len(raw),
            raw_head=raw[:500],
            batch_size=len(texts),
        )
        parsed = []

    from api.services.usage import record_usage

    usage_md = getattr(resp, "usage_metadata", None)
    record_usage(
        provider="gemini",
        operation="classify_opportunity",
        model=MODEL,
        tokens_in=getattr(usage_md, "prompt_token_count", None),
        tokens_out=getattr(usage_md, "candidates_token_count", None),
        meta={"batch_size": len(texts)},
    )

    scores = [
        max(0.0, min(1.0, float(item.get("opportunity", 0.0))))
        for item in parsed
    ]

    if len(scores) != len(texts):
        log.warning(
            "opportunity.size_mismatch",
            expected=len(texts),
            got=len(scores),
        )
        # Pad with zeros so caller can zip safely.
        while len(scores) < len(texts):
            scores.append(0.0)

    return scores
