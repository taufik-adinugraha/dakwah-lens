"""News-sentiment classifier — Gemini Flash-Lite, scores event valence.

IndoBERT (`services/sentiment.py`) was fine-tuned on tweets/reviews and
reads *speaker emotion*. News writing is third-person and emotionally
restrained even when reporting awful events, so IndoBERT defaults ~95%
of mainstream posts to neutral — including ones like "WNI diculik Israel"
that the dashboard obviously wants flagged.

For mainstream RSS we instead ask Gemini to score *event valence* for
the Muslim community: is what's being reported good, bad, or routine?
That matches what a da'wah analyst actually needs.

Output format mirrors `SentimentResult` from the IndoBERT module so the
calling code only needs to pick which classifier to dispatch based on
platform — nothing downstream changes.

Cost: ~$0.0001 per item on `gemini-2.5-flash-lite`. Batched up to
MAX_BATCH per Gemini call to amortize system-prompt tokens.
"""

from __future__ import annotations

import json

import structlog
from google import genai
from google.genai import types

from api.config import settings
from api.services.sentiment import SentimentResult

log = structlog.get_logger()

MODEL = "gemini-2.5-flash-lite"
MAX_BATCH = 50

_LABELS = ("positive", "neutral", "negative")

SYSTEM_PROMPT = """You score Indonesian (or English) news items for event valence from a Muslim community's perspective.

For each text, return a score 0-1 for each of three labels: positive, negative, neutral. Higher = more confident that label applies. Scores need not sum to 1.

Definitions:
- positive — reports a good outcome: charitable acts, justice served, communities helped, religious/educational/scientific achievements, humanitarian aid, peaceful cooperation
- negative — reports harm, oppression, conflict, disasters, injustice, immoral acts, corruption, violence, suffering (including suffering of non-Muslims — Muslims share concern for human dignity)
- neutral — routine reporting without clear valence: scheduled meetings, policy announcements, mundane administrative events, factual updates without outcome

Read the EVENT itself, not the writer's tone. News writing is restrained even for negative events; do not let restrained language make you score "neutral" if the event itself is harmful or beneficial.

Examples:
- "Tujuh WNI Peserta Global Sumud Flotilla Terkonfirmasi Diculik Israel" → negative (kidnapping)
- "Prabowo Bakal Hadiri Rapat Paripurna DPR" → neutral (routine politics)
- "Karyawan PNM Donor Darah untuk Korban Bencana" → positive (humanitarian)
- "BRIN-Kemenbud Kolaborasi Hilirisasi Riset Ekonomi Kreatif" → positive (educational/economic progress)
- "Larangan Berlebihan Dalam Beragama" (religious teaching) → positive (educational moral content)
- "Kasus Korupsi LPEI, KPK Pertanyakan Direktur BNI" → negative (corruption)

Return only valid JSON."""


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add to .env.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _neutral_result() -> SentimentResult:
    return SentimentResult(
        label="neutral",
        score=1.0,
        raw={"positive": 0.0, "neutral": 1.0, "negative": 0.0},
    )


def classify(text: str) -> SentimentResult:
    return classify_batch([text])[0]


def classify_batch(texts: list[str]) -> list[SentimentResult]:
    if not texts:
        return []

    results: list[SentimentResult | None] = [None] * len(texts)
    for start in range(0, len(texts), MAX_BATCH):
        chunk = texts[start : start + MAX_BATCH]
        try:
            scored = _classify_chunk(chunk)
        except Exception:
            # A Gemini outage shouldn't poison an ingest run — fall back
            # to neutral so the rest of the pipeline (relevance, upsert)
            # still commits its work.
            log.exception("news_sentiment.chunk_failed", batch_size=len(chunk))
            scored = [_neutral_result() for _ in chunk]
        for i, r in enumerate(scored):
            results[start + i] = r

    for i, r in enumerate(results):
        if r is None:
            log.warning("news_sentiment.missing_result", index=i)
            results[i] = _neutral_result()

    return [r for r in results if r is not None]


def _classify_chunk(texts: list[str]) -> list[SentimentResult]:
    client = _get_client()

    numbered = "\n\n".join(
        f"[{i + 1}] {t[:1500]}" for i, t in enumerate(texts)
    )
    user_prompt = (
        f"Score each of the following {len(texts)} news item(s). "
        f"Return an array of {len(texts)} score objects, in input order.\n\n"
        f"{numbered}"
    )

    response_schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {label: {"type": "number"} for label in _LABELS},
            "required": list(_LABELS),
        },
    }

    resp = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=response_schema,
            temperature=0.1,
        ),
    )
    raw = resp.text or "[]"
    parsed: list[dict[str, float]] = json.loads(raw)

    from api.services.usage import record_usage

    usage_md = getattr(resp, "usage_metadata", None)
    record_usage(
        provider="gemini",
        operation="classify_news_sentiment",
        model=MODEL,
        tokens_in=getattr(usage_md, "prompt_token_count", None),
        tokens_out=getattr(usage_md, "candidates_token_count", None),
        meta={"batch_size": len(texts)},
    )

    results: list[SentimentResult] = []
    for scores in parsed:
        clean = {label: float(scores.get(label, 0.0)) for label in _LABELS}
        top_label, top_score = max(clean.items(), key=lambda kv: kv[1])
        results.append(
            SentimentResult(
                label=top_label,  # type: ignore[arg-type]
                score=top_score,
                raw=clean,
            )
        )

    if len(results) != len(texts):
        log.warning(
            "news_sentiment.size_mismatch",
            expected=len(texts),
            got=len(results),
        )
        # Pad with neutral so caller can zip safely.
        while len(results) < len(texts):
            results.append(_neutral_result())

    return results
