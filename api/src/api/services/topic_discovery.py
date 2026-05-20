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
from google.genai import types

from api.config import settings

log = structlog.get_logger()

MODEL = "gemini-2.5-flash-lite"

# How many recent posts to sample per platform. Smaller = cheaper but
# misses long-tail themes; larger = costs more tokens. 100 balances
# theme coverage (~5-8 surfaces well) and token budget (~$0.003/run).
SAMPLE_SIZE = 100

# Truncate each post's text to control input tokens. Tweets / captions
# usually fit in 200 chars; mainstream articles get cut to the lede
# which is the most theme-bearing part anyway.
MAX_TEXT_CHARS = 200


SYSTEM_PROMPT = """You analyze a sample of recent Indonesian social-media or news posts about da'wah, society, and Muslim community life. Your job is to identify the major themes being discussed.

Return 5-8 distinct themes. For each theme:
- label: short human-readable name in Bahasa Indonesia (2-5 words). Examples of GOOD labels:
    "Akhlak Sehari-hari"
    "Konflik Israel-Palestina"
    "Hukum Halal-Haram"
    "Pendidikan Anak Muslim"
    "Kondisi Ekonomi Umat"
    "Hijrah & Pertaubatan"
  BAD labels (do NOT produce these):
    "barat · nasional · masih"           ← stopwords joined by dots
    "berita"                              ← too generic
    "indonesia"                           ← too broad
    "kemanusiaan"                         ← single word, no specificity
- keywords: 3-5 distinctive keywords characterizing this theme (Indonesian preferred). Avoid Indonesian stopwords (yang, dan, atau, dengan, untuk, akan, masih, sebelum, terkait, dari, ke). Avoid URL artifacts (republikacoid, kompascom).
- post_indices: list of input post indices (0-based) that fit this theme

Rules:
- Each post belongs to AT MOST ONE theme. If a post fits multiple, pick the strongest.
- Posts that don't fit any clear theme can be omitted (will be marked as orphan downstream).
- Themes should be DISTINCT — don't split one theme into two near-duplicates.
- Cover the bulk of the corpus — your themes together should account for >60% of posts.

Return ONLY valid JSON with this shape:
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
    try:
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
