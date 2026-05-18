"""Language detection for ingest-time routing.

We use `langdetect` (pure-Python port of Google's language-detection library)
because the only thing we need is a coarse "is this Indonesian or English?"
signal — not full multilingual NLP. It's tiny and has no network calls.

The output is consumed by `scripts/ingest.py` to gate IndoBERT: that model
is fine-tuned on Indonesian only, so feeding it English text produces a
confident-looking but meaningless label. We'd rather store NULL.
"""

from __future__ import annotations

import structlog
from langdetect import DetectorFactory, LangDetectException, detect

log = structlog.get_logger()

# Make detection deterministic — without this seed, langdetect's
# probabilistic sampling can return different codes for the same input
# across runs. We seed once at import time.
DetectorFactory.seed = 42

# Codes we actually support in the rest of the pipeline. Anything else
# falls back below.
SUPPORTED: frozenset[str] = frozenset({"id", "en"})

# Below this character count detection becomes unreliable — e.g. a one-line
# tweet "Mantap!" can come back as `tl` (Tagalog) or `ms` (Malay). We bail
# out to the fallback for short text.
MIN_CONFIDENCE_CHARS = 15


def detect_lang(text: str, *, fallback: str = "id") -> str:
    """Return an ISO 639-1 code from `SUPPORTED`, or `fallback`.

    Why the Indonesian default: the corpus is overwhelmingly Indonesian, and
    langdetect's mis-classifications on short text often land on `ms`
    (Malay — linguistically related, IndoBERT handles it acceptably) or
    `tl` (Tagalog — wrong but rare). Defaulting to ID preserves more
    sentiment signal than dropping it.
    """
    if not text or len(text.strip()) < MIN_CONFIDENCE_CHARS:
        return fallback
    try:
        code = detect(text)
    except LangDetectException:
        # Empty / garbled input. Don't log — happens enough on noisy
        # social posts that it'd spam the worker output.
        return fallback

    # Treat Malay as Indonesian for downstream purposes — close enough
    # linguistically that IndoBERT sentiment classification still applies.
    if code == "ms":
        return "id"

    return code if code in SUPPORTED else fallback
