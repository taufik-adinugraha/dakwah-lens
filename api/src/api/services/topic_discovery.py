"""LLM-driven topic discovery via Gemini Flash-Lite.

Replaces the previous BERTopic implementation. BERTopic underperformed on
short Indonesian social text — stopword leakage (`masih`, `sebelum`),
URL/outlet artifacts in keywords (`republikacoid`), and auto-labels like
"barat · nasional · masih" that nobody can interpret.

Gemini fits this job better:
  - Native handling of Indonesian + English
  - Handles short tweets/captions (BERTopic's sentence-transformer
    embeddings collapse on <140 chars)
  - Produces human-readable labels in Bahasa Indonesia
  - Picks meaningful themes, not c-TF-IDF noise

One Gemini call per platform per day → ~$0.36/mo total.

Output preserves the existing `Topic` table schema (label / keywords /
post_count), so the `/insights/[platform]` page reads from the same
table — drop-in replacement.
"""

from __future__ import annotations

import json
from typing import Any

import structlog
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from tenacity import (
    Retrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from api.config import settings

log = structlog.get_logger()

MODEL = "gemini-2.5-flash-lite"

# Hard cap on how many posts we ever send to Gemini in one call.
# Was 100 — silently truncated the 500 posts the caller pre-fetched and
# left ~80% of the corpus without a topic_id (2026-05-21). Raised to
# 2000 to match the caller's 7-day window cap. At ~200 chars each + a
# tight system prompt this fits in Flash-Lite's input window with
# headroom; cost stays ~$0.02/run.
SAMPLE_SIZE = 2000

# Truncate each post's text to control input tokens. Tweets / captions
# usually fit in 200 chars; mainstream articles get cut to the lede
# which is the most theme-bearing part anyway.
MAX_TEXT_CHARS = 200


SYSTEM_PROMPT = """You analyze recent Indonesian news posts and group them into themes a DA'I would actually pick up for khutbah, kajian, or da'wah content this week.

The posts you receive have already been pre-filtered for da'wah relevance — they DO have a hook. Your job is to find what those hooks are, not to re-classify whether they're relevant.

Return 5-8 distinct themes. For each theme:
- label: short human-readable name in Bahasa Indonesia (3-6 words). Frame by DA'WAH ANGLE, not by newsroom department.

  GOOD labels — these read as themes a da'i would actually preach about:
    "Pelecehan oleh Tokoh Agama"           (NOT "Hukum & Kriminalitas")
    "WNI Tertahan di Israel"               (NOT "Diplomasi Internasional")
    "Persiapan Haji & Idul Adha"           (NOT "Keagamaan & Spiritualitas")
    "Tekanan Ekonomi Petani & Nelayan"     (NOT "Kebijakan Ekonomi")
    "Ancaman Judi Online & AI bagi Pemuda" (NOT "Pendidikan")
    "Solidaritas untuk Palestina & Gaza"   (NOT "Konflik Internasional")
    "Korupsi Pejabat & Keadilan Hukum"     (NOT "Pemerintahan")
    "Kekerasan terhadap Anak & Remaja"     (NOT "Hukum & Kriminalitas")
    "Inspirasi Penghafal Qur'an"           (NOT "Pendidikan & Sekolah")
    "Bencana Alam & Ketabahan Umat"        (NOT "Bencana & Lingkungan")
    "Ujian Iman di Masa Pailit"            (NOT "Krisis Ekonomi")

  BAD labels — generic newsroom buckets that a da'i can't directly preach from:
    "Berita Politik"                       (too broad)
    "Pemerintahan & Birokrasi"             (newsroom department, not da'wah theme)
    "Hukum & Kriminalitas"                 (mixes 5 unrelated stories)
    "Olahraga & Prestasi"                  (no da'wah hook)
    "barat · nasional · masih"             (stopwords joined by dots)

  Rule of thumb: if the label sounds like a Kompas/Detik section header, REPHRASE it from a da'wah angle. The label should make a da'i say "yes, I can build a khutbah from that this week."

- keywords: 3-5 distinctive keywords (Bahasa Indonesia preferred). Avoid stopwords (yang, dan, atau, dengan, untuk, akan, masih, sebelum, terkait, dari, ke) and URL artifacts (republikacoid, kompascom).

- post_indices: 0-based input indices that fit this theme.

Rules:
- Each post belongs to AT MOST ONE theme. If it fits multiple, pick the strongest da'wah angle.
- A theme needs at least 2 posts. Don't create a theme for a single story unless it's an unmistakable event (e.g. one major political assassination would deserve its own theme).
- Themes must be DISTINCT — don't split one theme into two near-duplicates.
- Cover the bulk of the input. Posts that genuinely don't cluster can be omitted.
- If multiple stories share a clear pattern (e.g. 3 separate child-abuse cases involving religious figures), group them under ONE specific theme ("Pelecehan oleh Tokoh Agama"), not three "miscellaneous crime" entries.

Return ONLY valid JSON:
{"themes": [{"label": "...", "keywords": ["...", ...], "post_indices": [0, 5, ...]}, ...]}
"""


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add to .env.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def discover_topics(
    posts: list[dict[str, Any]],
    *,
    platform: str,
    sample_size: int = SAMPLE_SIZE,
) -> list[dict[str, Any]]:
    """Identify themes in a corpus via Gemini Flash-Lite.

    `posts` is a list of dicts with at least {id, text}. We sample the
    most recent `sample_size` posts (assumed already sorted recent-first
    by the caller) and ask Gemini to cluster them by theme.

    Returns a list of theme dicts:
        [{"label": str, "keywords": list[str], "post_ids": list[UUID]}]

    Empty list on failure — the caller decides whether to keep the old
    topics or persist nothing.
    """
    if not posts:
        return []

    sample = posts[:sample_size]
    numbered_texts = []
    for i, p in enumerate(sample):
        text = (p.get("text") or "")[:MAX_TEXT_CHARS].replace("\n", " ").strip()
        if text:
            numbered_texts.append(f"[{i}] {text}")

    if not numbered_texts:
        return []

    user_prompt = (
        f"Platform: {platform}\n"
        f"Posts ({len(numbered_texts)} of {len(posts)} sampled):\n\n"
        + "\n".join(numbered_texts)
    )

    response_schema = {
        "type": "object",
        "properties": {
            "themes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "keywords": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "post_indices": {
                            "type": "array",
                            "items": {"type": "integer"},
                        },
                    },
                    "required": ["label", "keywords", "post_indices"],
                },
            },
        },
        "required": ["themes"],
    }

    client = _get_client()
    # Tenacity wrapper around generate_content. The genai client has its
    # own short-window retry but it gives up too fast on intermittent 503s
    # ("This model is currently experiencing high demand"). Observed on
    # 2026-05-22 04:00 WIB: a single 503 → recluster_all returned with
    # `{'mainstream': 0}`, no topics created for the day, briefings at
    # 04:30 used stale yesterday-topic data. Adding our own backoff
    # gives the model 3 chances over ~2.5 min before we give up; if all
    # fail we still fall through to the soft-empty return so the task
    # doesn't crash and the existing topics rows stay intact.
    try:
        for attempt in Retrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=10, min=10, max=120),
            retry=retry_if_exception_type(genai_errors.ServerError),
            reraise=True,
        ):
            with attempt:
                resp = client.models.generate_content(
                    model=MODEL,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        response_mime_type="application/json",
                        response_schema=response_schema,
                        temperature=0.2,
                        # 16K output budget so the model can emit full
                        # post_indices arrays for 5-8 themes over the full
                        # 7-day pool. The default ~8K was being silently
                        # exhausted on a 274-post input, producing a
                        # truncated JSON that failed to parse and persisted
                        # ZERO topics (2026-05-21).
                        max_output_tokens=16384,
                        # Disable thinking — this is a "bucket inputs into
                        # named groups" task with hard rules in the system
                        # prompt, not a reasoning problem. Thinking tokens
                        # were eating into the output budget AND adding
                        # ~200s of latency per call.
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                    ),
                )
    except Exception:
        log.exception("topic_discovery.gemini_failed", platform=platform)
        return []

    raw = resp.text or "{}"
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        log.warning(
            "topic_discovery.bad_json", platform=platform, raw=raw[:200]
        )
        return []

    themes_raw = parsed.get("themes") or []

    # Record cost so the api-costs dashboard sees this spend.
    from api.services.usage import record_usage

    usage_md = getattr(resp, "usage_metadata", None)
    record_usage(
        provider="gemini",
        operation="topic_discovery",
        model=MODEL,
        tokens_in=getattr(usage_md, "prompt_token_count", None),
        tokens_out=getattr(usage_md, "candidates_token_count", None),
        meta={"platform": platform, "sample_size": len(sample)},
    )

    # Map indices → post UUIDs. Gemini may hallucinate indices outside
    # the sample range; drop those defensively.
    results: list[dict[str, Any]] = []
    for theme in themes_raw:
        indices = theme.get("post_indices") or []
        post_ids = [sample[i]["id"] for i in indices if 0 <= i < len(sample)]
        if not post_ids:
            continue
        results.append({
            "label": str(theme.get("label", "")).strip()
            or f"theme {len(results) + 1}",
            "keywords": [str(k).strip() for k in (theme.get("keywords") or [])],
            "post_ids": post_ids,
        })

    log.info(
        "topic_discovery.done",
        platform=platform,
        themes=len(results),
        sampled=len(sample),
    )

    return results
