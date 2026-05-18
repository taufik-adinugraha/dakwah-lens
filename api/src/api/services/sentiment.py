"""Indonesian sentiment classification via a pre-trained IndoBERT model.

Loads `mdhugol/indonesia-bert-sentiment-classification` once at module level
(~500MB, lazy on first call). Subsequent calls reuse the loaded weights.

We use the pre-trained model as-is for Phase 1 — it's already fine-tuned on
Indonesian sentiment (positive/negative/neutral). Fine-tuning further only
makes sense once we have labeled da'wah-specific posts and measure that the
baseline is materially worse on our domain. See PRD §08 Stage 2.

Latency: ~50-200ms per inference on CPU. Memory: ~600MB peak. Fine to keep
hot-loaded in the same FastAPI process for prototype scale (~50K posts/mo).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import structlog

log = structlog.get_logger()

# `mdhugol/...` outputs: 0=positive, 1=neutral, 2=negative.
_MODEL_NAME = "mdhugol/indonesia-bert-sentiment-classification"
_LABEL_MAP: dict[int, Literal["positive", "neutral", "negative"]] = {
    0: "positive",
    1: "neutral",
    2: "negative",
}


@dataclass(frozen=True)
class SentimentResult:
    label: Literal["positive", "neutral", "negative"]
    score: float  # confidence of the predicted label, 0-1
    raw: dict[str, float]  # per-class probabilities for the curious


# Lazy module-level singleton. Loaded on first call rather than on import so
# CLI scripts that don't touch sentiment (e.g. `download_quran`) don't pay
# the ~10-15s startup cost.
_pipeline = None


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        from transformers import pipeline

        log.info("sentiment.loading_model", model=_MODEL_NAME)
        _pipeline = pipeline(
            "text-classification",
            model=_MODEL_NAME,
            top_k=None,  # return all class scores, not just the argmax
        )
        log.info("sentiment.loaded")
    return _pipeline


def classify(text: str) -> SentimentResult:
    """Run a single piece of text through IndoBERT and return the result."""
    pipe = _get_pipeline()
    # `pipeline(text)` returns `[[{label, score}, …]]` when top_k=None.
    output: list[list[dict[str, float | str]]] = pipe(text, truncation=True, max_length=512)
    scores = output[0]

    # The model emits labels `LABEL_0` / `LABEL_1` / `LABEL_2`. Map to ours.
    by_label: dict[str, float] = {}
    for entry in scores:
        idx = int(str(entry["label"]).split("_")[-1])
        by_label[_LABEL_MAP[idx]] = float(entry["score"])

    top = max(by_label.items(), key=lambda kv: kv[1])
    return SentimentResult(
        label=top[0],  # type: ignore[arg-type]
        score=top[1],
        raw=by_label,
    )


def classify_batch(texts: list[str]) -> list[SentimentResult]:
    """Batched inference. Faster than calling `classify()` in a loop."""
    if not texts:
        return []
    pipe = _get_pipeline()
    outputs: list[list[dict[str, float | str]]] = pipe(
        texts, truncation=True, max_length=512, batch_size=8
    )
    results: list[SentimentResult] = []
    for scores in outputs:
        by_label: dict[str, float] = {}
        for entry in scores:
            idx = int(str(entry["label"]).split("_")[-1])
            by_label[_LABEL_MAP[idx]] = float(entry["score"])
        top = max(by_label.items(), key=lambda kv: kv[1])
        results.append(
            SentimentResult(label=top[0], score=top[1], raw=by_label)  # type: ignore[arg-type]
        )
    return results
