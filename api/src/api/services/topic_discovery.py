"""LLM-driven topic discovery via Gemini Flash — index-free design.

Gemini handles theme NAMING well for our corpus:
  - Native Indonesian + English support
  - Short tweets/captions (<140 chars) are fine
  - Produces human-readable Bahasa Indonesia labels
  - Picks meaningful themes, not surface-form keyword noise

POST→THEME ASSIGNMENT is done OURSELVES via embedding similarity, NOT by
the LLM (2026-05-27 rewrite). History: the model used to echo back a
`post_indices` array for every theme, so output size scaled linearly
with corpus size. At the unified ~3K-post pool that output ran away —
the model emitted near-contiguous integer runs (… 1532, 1533, 1534 …)
and truncated against the output-token cap on every retry (16K AND 32K
both failed), persisting zero themes. Decoupling assignment from the LLM
makes Gemini output tiny and CONSTANT (just 6-10 labels + keywords)
regardless of how big the pipeline grows, and kills the hallucinated /
runaway-index failure mode for good.

Pipeline:
  1. Gemini reads the sampled corpus → returns 6-10 themes, each just
     {label, keywords}. Bounded output (~hundreds of tokens).
  2. Embed each theme (label + keywords) and each post via OpenAI.
  3. Assign every post to its nearest theme by cosine similarity, above
     a floor; posts below the floor stay orphan (topic_id NULL).

Writes to the `topics` table; `/insights/[platform]` reads from there.
"""

from __future__ import annotations

import json
import time
from typing import Any

import numpy as np
import structlog
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from openai import OpenAI

from api.config import settings

log = structlog.get_logger()

MODEL = "gemini-2.5-flash"
# Flash (not Flash-Lite) + thinking_budget=0. Flash-Lite had a
# thinking-spiral failure mode (thoughts_token_count ate the whole
# budget, candidates_token_count=0 → empty response). Flash with
# thinking disabled produces clean structured JSON. With assignment now
# off-loaded to embeddings the output is tiny either way, but Flash's
# labels are noticeably better than Lite's, and the cost delta on a
# labels-only response is negligible.

# Hard cap on how many posts we send to Gemini in one call (for naming)
# and embed for assignment. Input-only now that the model no longer
# echoes indices, so this bounds input tokens + embedding spend, not
# output. At ~200 chars each this lands ~280K input tokens for Gemini
# (well inside Flash's 1M context) and ~180K embedding tokens (~$0.004
# at text-embedding-3-small). Caller's stratified pool tops out lower
# (PER_DAY_CAP × WINDOW = 7000) so this is rarely the binding limit.
SAMPLE_SIZE = 5600

# Truncate each post's text to control input + embedding tokens. Tweets
# / captions usually fit in 200 chars; mainstream articles get cut to
# the lede which is the most theme-bearing part anyway. The SAME
# truncation feeds both Gemini (naming) and the embedder (assignment) so
# the model and the vectors see identical text.
MAX_TEXT_CHARS = 200

# A post is assigned to its nearest theme only if cosine similarity
# clears this floor; otherwise it's left orphan (topic_id NULL — same
# outcome as the old design omitting an unclustered post). Tuned for
# text-embedding-3-small, where related short Indonesian texts sit around
# 0.3-0.5 and unrelated ones around 0.1-0.2. 0.28 keeps plausible matches
# while dropping noise. OBSERVE the orphan rate after deploy: too many
# orphans → lower this; themes polluted by weak matches → raise it.
MIN_SIMILARITY = 0.28

# A theme needs at least this many assigned posts to survive. Mirrors the
# old prompt rule ("a theme needs at least 2 posts"); a 1-post theme is
# usually an embedding fluke, not a trend.
MIN_POSTS_PER_THEME = 2

# OpenAI caps inputs per embeddings request; chunk well under it.
EMBED_BATCH = 1000


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

- keywords: 3-5 distinctive keywords (Bahasa Indonesia preferred). These keywords are ALSO used to match posts to this theme by meaning, so pick words that are specific and central to the theme. Avoid stopwords (yang, dan, atau, dengan, untuk, akan, masih, sebelum, terkait, dari, ke) and URL artifacts (republikacoid, kompascom).

Rules:
- Themes must be DISTINCT — don't split one theme into two near-duplicates.
- Cover the main currents in the input. You don't need to account for every post; posts that don't fit any theme are fine to leave out (they will simply not be assigned).
- If multiple stories share a clear pattern (e.g. 3 separate child-abuse cases involving religious figures), group them under ONE specific theme ("Pelecehan oleh Tokoh Agama"), not three "miscellaneous crime" entries.

PREFER SUBDIVIDE OVER GENERALIZE:
When you're tempted to widen a label (e.g. "Kekerasan dan Kriminalitas Jalanan") to fit posts that don't really belong (drug raids, industrial crime, traffic accidents, workplace violence), STOP and split into 2-3 specific themes instead. Examples of BAD generalization → BETTER split:
  ❌ "Kekerasan dan Kriminalitas Jalanan" (forces street-crime + drug raids + industrial fraud + traffic into one bucket)
  ✅ Split into: "Begal & Kejahatan Jalanan" + "Operasi Narkoba & Penyalahgunaan Obat" + "Kecelakaan & Pelanggaran Lalu Lintas"
  ❌ "Isu Sosial Pemuda" (mixes bullying + judi online + kecurangan ujian + gang violence)
  ✅ Split into: "Bullying & Kekerasan di Sekolah" + "Judi Online & Eksploitasi Digital Pemuda"
A da'i can build a specific khutbah from a tight theme; a generic bucket gives no angle.

Return ONLY valid JSON:
{"themes": [{"label": "...", "keywords": ["...", ...]}, ...]}
"""


_client: genai.Client | None = None
_openai_client: OpenAI | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add to .env.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _get_openai() -> OpenAI:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not set. Add to .env.")
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _embed_texts(texts: list[str]) -> np.ndarray:
    """Embed `texts` via OpenAI, returning an L2-normalized (N, D) matrix.

    Batches to stay under the per-request input cap and records spend on
    the api-costs dashboard. Normalizing here lets the caller compute
    cosine similarity as a plain dot product.
    """
    from api.services.usage import record_usage

    openai = _get_openai()
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH):
        batch = texts[start : start + EMBED_BATCH]
        emb = openai.embeddings.create(model=settings.embedding_model, input=batch)
        vectors.extend(d.embedding for d in emb.data)
        record_usage(
            provider="openai",
            operation="embedding",
            model=settings.embedding_model,
            tokens_in=getattr(emb.usage, "total_tokens", None),
            meta={"context": "topic_discovery", "n": len(batch)},
        )

    mat = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms[norms == 0] = 1.0  # guard against a zero vector
    return mat / norms


def discover_topics(
    posts: list[dict[str, Any]],
    *,
    platform: str,
    sample_size: int = SAMPLE_SIZE,
) -> list[dict[str, Any]]:
    """Identify themes in a corpus and assign posts to them.

    `posts` is a list of dicts with at least {id, text}. We sample the
    most recent `sample_size` posts (assumed already sorted recent-first
    by the caller), ask Gemini to NAME 6-10 themes, then assign each post
    to its nearest theme by embedding cosine similarity.

    Returns a list of theme dicts:
        [{"label": str, "keywords": list[str], "post_ids": list[UUID]}]

    Empty list on failure — the caller decides whether to keep the old
    topics or persist nothing.
    """
    if not posts:
        return []

    sample = posts[:sample_size]
    indexed_texts: list[tuple[int, str]] = []
    for i, p in enumerate(sample):
        text = (p.get("text") or "")[:MAX_TEXT_CHARS].replace("\n", " ").strip()
        if text:
            indexed_texts.append((i, text))

    if not indexed_texts:
        return []

    user_prompt = (
        f"Platform: {platform}\n"
        f"Posts ({len(indexed_texts)} of {len(posts)} sampled):\n\n"
        + "\n".join(f"- {t}" for _, t in indexed_texts)
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
                    },
                    "required": ["label", "keywords"],
                },
            },
        },
        "required": ["themes"],
    }

    client = _get_client()
    # Retry the generate+parse cycle on transient ServerError (503 "model
    # overloaded") or malformed JSON. Output is tiny now (labels only), so
    # MAX_TOKENS truncation should never recur — but the retry keeps us
    # robust against transient 503s. 3 attempts, exponential backoff.
    # Final fallback: empty themes → recluster persists nothing → existing
    # topic rows stay intact.
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
                    # Labels-only output: 6-10 themes × (label + 5 short
                    # keywords) is a few hundred tokens. 4K is generous
                    # headroom and can't run away — assignment no longer
                    # lives in this response.
                    max_output_tokens=4096,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
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
        if attempt_idx < 2:
            time.sleep(10 * (2 ** attempt_idx))

    if parsed is None:
        log.error("topic_discovery.gave_up", platform=platform)
        return []

    # Record Gemini naming cost.
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

    themes_raw = parsed.get("themes") or []
    themes = [
        {
            "label": str(t.get("label", "")).strip(),
            "keywords": [str(k).strip() for k in (t.get("keywords") or []) if str(k).strip()],
        }
        for t in themes_raw
        if str(t.get("label", "")).strip()
    ]
    if not themes:
        log.warning("topic_discovery.no_themes_named", platform=platform)
        return []

    # Embed themes + posts, then assign each post to its nearest theme.
    # Theme text = label + keywords so both the human-facing name and the
    # distinctive terms steer the vector.
    theme_texts = [
        f"{t['label']}. {', '.join(t['keywords'])}".strip(". ") for t in themes
    ]
    post_texts = [t for _, t in indexed_texts]

    try:
        theme_vecs = _embed_texts(theme_texts)
        post_vecs = _embed_texts(post_texts)
    except Exception as exc:
        log.error("topic_discovery.embed_failed", platform=platform, error=str(exc)[:200])
        return []

    # Cosine similarity (vectors are L2-normalized) → (n_posts, n_themes).
    sims = post_vecs @ theme_vecs.T
    best_theme = sims.argmax(axis=1)
    best_score = sims.max(axis=1)

    theme_post_ids: list[list[Any]] = [[] for _ in themes]
    assigned = 0
    for row, (sample_i, _) in enumerate(indexed_texts):
        if best_score[row] < MIN_SIMILARITY:
            continue  # orphan — no theme fits well enough
        theme_post_ids[best_theme[row]].append(sample[sample_i]["id"])
        assigned += 1

    results: list[dict[str, Any]] = []
    for theme, post_ids in zip(themes, theme_post_ids, strict=True):
        if len(post_ids) < MIN_POSTS_PER_THEME:
            continue
        results.append(
            {
                "label": theme["label"],
                "keywords": theme["keywords"],
                "post_ids": post_ids,
            }
        )

    log.info(
        "topic_discovery.done",
        platform=platform,
        themes_named=len(themes),
        themes_kept=len(results),
        sampled=len(sample),
        assigned=assigned,
        orphan=len(indexed_texts) - assigned,
    )

    return results
