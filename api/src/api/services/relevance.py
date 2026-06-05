"""Da'wah opportunity classifier — Gemini Flash-Lite, single 0-1 score.

Scopes down to ONE classifier as of 2026-06-05. The earlier 9-category
scoring (aqidah / akhlaq / muamalah / social_justice / family / youth /
education / economic_ethics / health) was dropped — those scores never
made it onto the user-facing UI, and the per-post `categories` JSONB
they fed has been retired. The theme_group emission they used to
piggyback on now lives in `services.sentiment` (folded into the same
call as sentiment classification, saving one Gemini round-trip per
post).

What remains here:
  - `_should_skip` heuristic (very short text / pure gossip) used by
    the opportunity scorer to protect the Gemini quota
  - `classify_opportunity_batch` — scores each text 0-1 on "would a
    da'i credibly use this in da'wah this week", calibrated against
    anchors at 0.2 / 0.4 / 0.6 / 0.8

Cost: ~$0.0001 per classification on `gemini-2.5-flash-lite`. Pre-
filter heuristic drops ~50% of calls (short/gossipy items get 0.0
without ever hitting Gemini).
"""

from __future__ import annotations

import json
import re
import time

import structlog
from google import genai
from google.genai import errors as genai_errors
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

# Retry config — Gemini Flash-Lite returns 503 "model overloaded" in
# bursts during Indonesia daytime peaks. Three attempts × exponential
# backoff (4s, 8s, 16s) absorbs typical 10-30s overload windows. After
# all retries fail, the chunk falls through to the existing zero-result
# fallback so the rest of the ingest still commits. Mirrors the same
# pattern in `sentiment._classify_chunk`.
MAX_RETRIES = 3
RETRY_BASE_SLEEP_S = 4.0
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



_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add to .env.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client



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




def _should_skip(text: str) -> bool:
    """Cheap heuristic that filters out items unlikely to ever score
    da'wah-relevant — protects the Gemini quota."""
    stripped = (text or "").strip()
    if len(stripped) < MIN_TEXT_CHARS:
        return True
    return bool(_GOSSIP_RE.search(stripped))


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

    # Same retry pattern as the categories classifier above.
    resp = None
    for attempt in range(MAX_RETRIES):
        try:
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
            break
        except genai_errors.ServerError as exc:
            if attempt == MAX_RETRIES - 1:
                log.warning(
                    "opportunity.gemini_5xx_giveup",
                    attempt=attempt + 1,
                    batch_size=len(texts),
                    error=str(exc)[:200],
                )
                raise
            wait_s = RETRY_BASE_SLEEP_S * (2**attempt)
            log.info(
                "opportunity.gemini_5xx_retry",
                attempt=attempt + 1,
                wait_s=wait_s,
                batch_size=len(texts),
            )
            time.sleep(wait_s)
    assert resp is not None  # noqa: S101 — loop above guarantees this or raises

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

    from api.services.usage import gemini_output_tokens, record_usage

    usage_md = getattr(resp, "usage_metadata", None)
    record_usage(
        provider="gemini",
        operation="classify_opportunity",
        model=MODEL,
        tokens_in=getattr(usage_md, "prompt_token_count", None),
        tokens_out=gemini_output_tokens(usage_md),
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
