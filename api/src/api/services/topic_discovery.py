"""LLM-driven topic discovery via Gemini Flash-Lite.

Gemini handles this job well for our corpus:
  - Native Indonesian + English support
  - Short tweets/captions (<140 chars) are fine
  - Produces human-readable Bahasa Indonesia labels
  - Picks meaningful themes, not surface-form keyword noise

One Gemini call per platform per day → ~$0.36/mo total.

Writes to the `topics` table; `/insights/[platform]` reads from there.
"""

from __future__ import annotations

import json
import time
from typing import Any

import structlog
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from api.config import settings

log = structlog.get_logger()

MODEL = "gemini-2.5-flash-lite"

# Hard cap on how many posts we ever send to Gemini in one call.
# Sized to match the caller's stratified sample ceiling (PER_DAY_CAP ×
# TOPIC_DISCOVERY_WINDOW_DAYS = 800 × 7 = 5600 in
# cluster_topics.py). At ~200 chars each + system prompt this lands
# around 280K input tokens — well inside Flash-Lite's 1M context, ~$0.03
# per recluster call. Earlier values: 100 (truncated 80% of input,
# 2026-05-21) → 2000 (clipped to 1.6 days at busy news pace,
# 2026-05-22) → 5600 stratified (2026-05-23).
SAMPLE_SIZE = 5600

# Truncate each post's text to control input tokens. Tweets / captions
# usually fit in 200 chars; mainstream articles get cut to the lede
# which is the most theme-bearing part anyway.
MAX_TEXT_CHARS = 200


SYSTEM_PROMPT = """You analyze recent Indonesian news posts and group them into themes a DA'I would actually pick up for khutbah, kajian, or da'wah content this week.

The posts you receive have already been pre-filtered for da'wah relevance — they DO have a hook. Your job is to find what those hooks are, not to re-classify whether they're relevant.

Return 6-10 distinct themes (target: closer to 8-10 when the input pool is large, e.g. >200 posts; closer to 6-8 when it's smaller). For each theme:
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

PREFER SUBDIVIDE OVER GENERALIZE:
When you're tempted to widen a label (e.g. "Kekerasan dan Kriminalitas Jalanan") to fit posts that don't really belong (drug raids, industrial crime, traffic accidents, workplace violence), STOP and split into 2-3 specific themes instead. Examples of BAD generalization → BETTER split:
  ❌ "Kekerasan dan Kriminalitas Jalanan" (forces street-crime + drug raids + industrial fraud + traffic into one bucket)
  ✅ Split into: "Begal & Kejahatan Jalanan" + "Operasi Narkoba & Penyalahgunaan Obat" + "Kecelakaan & Pelanggaran Lalu Lintas"
  ❌ "Isu Sosial Pemuda" (mixes bullying + judi online + kecurangan ujian + gang violence)
  ✅ Split into: "Bullying & Kekerasan di Sekolah" + "Judi Online & Eksploitasi Digital Pemuda"
A da'i can build a specific khutbah from a tight theme; a generic bucket gives no angle.

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
    # Wrap the full generate+parse cycle in tenacity. Two failure modes
    # we want to retry on:
    #   1. ServerError (transient 503 "model overloaded") — 2026-05-22
    #      04:00 WIB hit this; recluster persisted 0 topics for the day.
    #   2. Truncated/malformed JSON — Gemini sometimes returns HTTP 200
    #      with the response body cut off mid-array (observed 2026-05-22
    #      08:54 WIB: 45s call returned just the first theme's opening
    #      brace before truncation). Treating this as transient gives us
    #      a clean second attempt instead of giving up on the day.
    # 3 attempts with exponential backoff (10s, 20s, 40s ... capped 120s).
    # Final fallback: empty themes → recluster returns 0 → existing topic
    # rows stay intact (defensive design preserved).
    resp = None
    parsed = None
    for attempt_idx in range(3):
        try:
            resp = client.models.generate_content(
                model=MODEL,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=response_schema,
                    temperature=0.2,
                    # Output budget bumped 16K → 32K on 2026-05-22 after
                    # observing a Flash-Lite call truncate mid-array
                    # despite the 16K cap. With 354 posts in 6-10 themes
                    # each carrying its full post_indices list, real
                    # output can hit 5-8K tokens; the bigger cap gives
                    # headroom against model-side overshoots.
                    max_output_tokens=32768,
                    # Thinking budget raised 0 → 4096. Setting it to 0
                    # was meant to disable thinking but Flash-Lite still
                    # spent ~45s deliberating internally and exhausted
                    # the implicit thinking allocation, leaving the
                    # output truncated. A modest explicit budget lets
                    # the model reason about cluster boundaries without
                    # racing past the output cap.
                    thinking_config=types.ThinkingConfig(thinking_budget=4096),
                ),
            )
            raw = resp.text or "{}"
            parsed = json.loads(raw)
            break  # success
        except genai_errors.ServerError as exc:
            log.warning(
                "topic_discovery.server_error_retry",
                platform=platform,
                attempt=attempt_idx + 1,
                error=str(exc)[:200],
            )
        except json.JSONDecodeError:
            # Log enough to diagnose: finish_reason tells us if it was
            # MAX_TOKENS / SAFETY / STOP; tokens_out tells us how much
            # the model actually emitted before truncating.
            finish_reason = None
            tokens_out = None
            try:
                if resp and resp.candidates:
                    finish_reason = getattr(resp.candidates[0], "finish_reason", None)
                usage_md = getattr(resp, "usage_metadata", None) if resp else None
                if usage_md:
                    tokens_out = getattr(usage_md, "candidates_token_count", None)
            except Exception:
                pass
            log.warning(
                "topic_discovery.bad_json_retry",
                platform=platform,
                attempt=attempt_idx + 1,
                finish_reason=str(finish_reason) if finish_reason else None,
                tokens_out=tokens_out,
                raw_len=len(resp.text or "") if resp else 0,
                raw_tail=(resp.text or "")[-200:] if resp else "",
            )
        # Exponential backoff before next attempt.
        if attempt_idx < 2:
            time.sleep(10 * (2 ** attempt_idx))

    if parsed is None:
        log.error("topic_discovery.gave_up", platform=platform)
        return []

    themes_raw = parsed.get("themes") or []

    # Record cost so the api-costs dashboard sees this spend.
    from api.services.usage import gemini_output_tokens, record_usage

    usage_md = getattr(resp, "usage_metadata", None) if resp else None
    record_usage(
        provider="gemini",
        operation="topic_discovery",
        model=MODEL,
        tokens_in=getattr(usage_md, "prompt_token_count", None),
        tokens_out=gemini_output_tokens(usage_md),
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
