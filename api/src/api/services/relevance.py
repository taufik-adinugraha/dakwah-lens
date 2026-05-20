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


SYSTEM_PROMPT = """You score how relevant a piece of Indonesian or English text is to each of nine da'wah categories.

For each text, return a score 0-1 per category. 0 = not relevant at all; 0.5 = somewhat relevant; 1 = highly relevant (the post is directly about that category).

Categories:
- aqidah        — Islamic creed, tauhid, beliefs about Allah/prophets/afterlife
- akhlaq        — Islamic ethics, character, adab, moral conduct
- muamalah      — finance, business, halal/haram, riba, zakat, contracts
- social_justice— justice, inequality, oppression, public ethics
- family        — marriage, parenting, kinship, husband/wife/children
- youth         — issues facing young people: identity, education, career, mental health
- education     — knowledge-seeking, schools, pesantren, learning
- economic_ethics — work ethics, employment, halal income, business honesty
- health        — physical/mental health from an Islamic lens

Return only valid JSON, one object per input."""


def _zero_result() -> RelevanceResult:
    return RelevanceResult(
        categories={k: 0.0 for k in CATEGORY_KEYS},
        dawah_relevance=0.0,
    )


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
            scored.extend(
                _classify_chunk(keep_texts[start : start + MAX_BATCH])
            )
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
        rel = max(clean.values()) if clean else 0.0
        results.append(RelevanceResult(categories=clean, dawah_relevance=rel))

    if len(results) != len(texts):
        log.warning(
            "relevance.size_mismatch",
            expected=len(texts),
            got=len(results),
        )

    return results
