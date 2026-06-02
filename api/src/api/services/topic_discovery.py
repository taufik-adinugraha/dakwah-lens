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

# GLOBAL similarity floor — a post is assigned to its nearest theme only
# if cosine similarity clears this floor; otherwise it's left orphan
# (collected into the "Lainnya — Tidak Terklasifikasi" bucket so it stays
# visible rather than disappearing). Tuned for text-embedding-3-small,
# where related short Indonesian texts sit around 0.3-0.5 and unrelated
# ones around 0.1-0.2.
#
# History:
#   · 2026-05-29: raised 0.28 → 0.32 after Judol grabbed all "scam"
#     content and Palestina grabbed all "humanitarian".
#   · 2026-05-30: lowered 0.32 → 0.28 after an audit of 443 unclassified
#     posts showed ~50% were floor-casualties with clear matching
#     themes that fell just under 0.32 (Polemik Aqidah & Sektarian got
#     0 posts despite ~2 obvious matches in a 25-post sample). The
#     earlier spillover risk is now mitigated because every broad
#     theme carries strict `exclude_keywords` (Judol excludes WO/
#     wedding-organizer/saham, Palestina excludes skin-care/Afghanistan)
#     and the theme set is finer-grained (31 → 33 themes), so
#     borderline posts land on narrower fits.
# The floor is the DEFAULT — each theme may override with its own
# `min_similarity` (see prompt).
MIN_SIMILARITY = 0.28

# A theme needs at least this many assigned posts to survive. Mirrors the
# old prompt rule ("a theme needs at least 2 posts"); a 1-post theme is
# usually an embedding fluke, not a trend.
MIN_POSTS_PER_THEME = 2

# Label for the synthetic catch-all topic that holds posts which fail
# every theme's similarity floor or hit a negative pivot. Persisting these
# under a real topic_id (instead of leaving them as NULL) gives the UI a
# visible home for unclassified content and stops them from looking like
# "missing data" in audit queries.
FALLBACK_LABEL = "Lainnya — Tidak Terklasifikasi"
# Only emit the fallback bucket when it has at least this many posts —
# below this it's just noise.
MIN_POSTS_FOR_FALLBACK = 10

# OpenAI caps inputs per embeddings request; chunk well under it.
EMBED_BATCH = 1000


# Static themes: ALWAYS present in the final theme set, regardless of what
# Gemini proposes this run. These are chronic da'wah-relevant concerns the
# project has decided should never disappear between reclusters even when
# the week's content drifts away from them.
#
# Each row has the same shape as the dynamic themes Gemini returns:
# `label`, `keywords`, `exclude_keywords`, `min_similarity`. The
# embedding + cosine-floor assignment treats them identically — what
# makes them "static" is just that they're guaranteed to be in the theme
# set every run.
#
# Rationale for each (chosen 2026-05-30):
#   · Korupsi & Pengkhianatan Amanah — chronic Indonesia issue, high da'wah hook
#   · Kekerasan Seksual & Perlindungan Anak — recurring + critical
#   · Judi Online & Pinjaman Online — Indonesia-specific scourge (Gemini
#     dropped this in 2026-05-30 recluster; that's the kind of volatility
#     this static set fixes)
#   · Narkoba & Penyalahgunaan Obat — chronic public-health crisis
#   · Konflik Palestina & Solidaritas Umat — ongoing global concern for ummah
#   · Hijrah, Mualaf & Inspirasi Spiritual — captures personal-devotion +
#     mualaf-story content that historically lands in unclassified
#   · Fatwa & Hukum Islam Kontemporer — captures ulama/fatwa news that
#     also historically lands in unclassified
#
# To add/remove: edit this list. The prompt explicitly tells Gemini the
# static labels so it won't propose duplicates.
STATIC_THEMES: list[dict[str, Any]] = [
    {
        "label": "Korupsi & Pengkhianatan Amanah",
        "keywords": ["korupsi", "suap", "gratifikasi", "kpk", "ghulul", "amanah pejabat"],
        "exclude_keywords": [],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Kekerasan Seksual & Perlindungan Anak",
        "keywords": [
            "pelecehan seksual",
            "kekerasan anak",
            "pesantren cabul",
            "perlindungan anak",
            "kdrt",
        ],
        "exclude_keywords": [],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Judi Online & Pinjaman Online",
        "keywords": ["judol", "judi online", "pinjol", "slot online", "paylater"],
        "exclude_keywords": [
            "wedding organizer",
            "WO",
            "saham",
            "investasi",
            "game developer",
        ],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Narkoba & Penyalahgunaan Obat",
        "keywords": ["narkoba", "sabu", "pil koplo", "bnn", "kecanduan obat"],
        "exclude_keywords": [],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Konflik Palestina & Solidaritas Umat",
        "keywords": [
            "palestina",
            "gaza",
            "mustadh'afin",
            "solidaritas",
            "israel",
            "al-quds",
        ],
        "exclude_keywords": ["skin care", "skincare", "putih instan", "Afghanistan"],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Hijrah, Mualaf & Inspirasi Spiritual",
        "keywords": [
            "hijrah",
            "mualaf",
            "taubat",
            "kisah inspirasi",
            "dakwah personal",
            "perjalanan iman",
        ],
        "exclude_keywords": [],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Fatwa & Hukum Islam Kontemporer",
        "keywords": [
            "fatwa",
            "hukum islam",
            "ulama",
            "mui",
            "kontroversi keagamaan",
            "ijtihad",
        ],
        "exclude_keywords": [],
        "min_similarity": MIN_SIMILARITY,
    },
    # ── Added 2026-05-30 after audit of the 838 unclassified posts
    #    showed ~40% had no matching theme. These 4 cover the most
    #    common "missing theme" patterns from that audit.
    {
        "label": "Bisnis & Wirausaha",
        "keywords": [
            "wirausaha",
            "umkm",
            "entrepreneur",
            "bisnis",
            "modal usaha",
            "kewirausahaan",
        ],
        "exclude_keywords": ["judol", "judi online", "pinjol"],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Pemerintahan & Otonomi Daerah",
        "keywords": [
            "pemerintahan",
            "otonomi daerah",
            "kebijakan publik",
            "birokrasi",
            "pelayanan publik",
            "kepala daerah",
        ],
        "exclude_keywords": ["korupsi"],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Kesehatan Mental & Kesejahteraan Jiwa",
        "keywords": [
            "kesehatan mental",
            "depresi",
            "stres",
            "burnout",
            "kecemasan",
            "bunuh diri",
        ],
        "exclude_keywords": [],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Polemik Aqidah & Sektarian",
        "keywords": [
            "aqidah",
            "syiah",
            "ahmadiyah",
            "aliran sesat",
            "sektarian",
            "polemik teologi",
        ],
        "exclude_keywords": ["mualaf", "hijrah"],
        "min_similarity": MIN_SIMILARITY,
    },
    # ── Added 2026-05-30 (round 2) after grouping infrastructure made
    #    a wider static set safe to dashboard. These are the most-
    #    frequent missing-theme patterns from the 20-post audit that
    #    weren't covered by the round-1 additions.
    {
        "label": "Inspirasi & Kisah Hidup Pribadi",
        "keywords": [
            "kisah inspirasi",
            "perjalanan hidup",
            "pengalaman pribadi",
            "renungan",
            "motivasi",
            "pelajaran hidup",
        ],
        "exclude_keywords": ["hijrah", "mualaf"],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Toleransi & Lintas-Iman",
        "keywords": [
            "toleransi",
            "keberagaman",
            "lintas iman",
            "kerukunan umat",
            "pluralisme",
            "moderasi beragama",
        ],
        "exclude_keywords": [],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Crypto, Trading & Investasi Spekulatif",
        "keywords": [
            "crypto",
            "kripto",
            "trading saham",
            "investasi saham",
            "fintech",
            "spekulasi finansial",
        ],
        "exclude_keywords": ["judol", "judi online", "pinjol"],
        "min_similarity": MIN_SIMILARITY,
    },
    # ── Added 2026-05-30 (round 3) after a second audit of 443 posts
    #    revealed two more missing-theme clusters (~12% each):
    #    labor-rights content (Demo Indomaret, ART abuse, BPJS
    #    Ketenagakerjaan) and food-security / agriculture content
    #    (Bulog beras, pupuk sawit, DPRD pertanian).
    {
        "label": "Buruh, Pekerja & Hak Tenaga Kerja",
        "keywords": [
            "buruh",
            "tenaga kerja",
            "demo pegawai",
            "pekerja rumah tangga",
            "bpjs ketenagakerjaan",
            "upah minimum",
        ],
        "exclude_keywords": [],
        "min_similarity": MIN_SIMILARITY,
    },
    {
        "label": "Ketahanan Pangan & Pertanian",
        "keywords": [
            "ketahanan pangan",
            "pertanian",
            "petani",
            "stok beras",
            "pupuk",
            "produktivitas sawah",
            "bulog",
            "nelayan",
        ],
        "exclude_keywords": [],
        "min_similarity": MIN_SIMILARITY,
    },
]

# Render the static labels into the prompt so Gemini knows not to propose
# duplicates. Kept in sync with STATIC_THEMES automatically.
_STATIC_LABEL_LIST = "\n".join(f"  - {t['label']}" for t in STATIC_THEMES)


SYSTEM_PROMPT = f"""You analyze recent Indonesian posts and group them into themes that describe what the conversation is actually about this week. Output is consumed by da'wah analysts, but YOUR job is to map the conversation faithfully — not to force every theme through a da'wah lens. Some themes will have an obvious da'wah angle (haji, korupsi, palestina); others (health, education, sport, lifestyle, finance) won't, and that's fine — surface them anyway so the analyst can decide which to act on.

The posts you receive have already been pre-filtered for da'wah relevance — they DO have a hook. Your job is to find what the week's conversation is, not to re-classify whether each post is relevant.

IMPORTANT — STATIC THEMES ARE ALREADY GUARANTEED, DO NOT DUPLICATE THEM:
The downstream system automatically appends the following CHRONIC da'wah-concern themes to every run, even if you don't propose them. DO NOT include any of these in your output (they'd be duplicates and waste a slot):
{_STATIC_LABEL_LIST}

Your job: propose 12-16 DYNAMIC themes for what's distinctive about THIS WEEK's conversation — emerging stories, new patterns, week-specific events, broad domains (politics, education, health, lifestyle, sport) — that the static themes above don't already capture. The static themes are narrow chronic-concern slots; you should still cover the BREADTH of this week's pool with your dynamic themes. The downstream UI groups themes into ~10 thematic clusters (Hukum & Keadilan, Sosial & Keluarga, Ekonomi & Bisnis, Aqidah & Spiritualitas, Kesehatan & Kehidupan, Pendidikan, Lingkungan & Bencana, Pemerintahan, Patologi Sosial Digital, Konflik Global) so a higher theme count won't clutter the dashboard — readers see the groups first and can drill into fine themes when needed. Lean toward MORE themes when the pool spans many domains: undersizing pushes 20-30% of posts into an "uncategorized" bucket that's then useless for analysis. For each theme:
- label: short human-readable name in Bahasa Indonesia (3-6 words). Be CONCRETE about what the theme is — name the actual subject matter, not a generic newsroom department.

  GOOD labels — concrete, name what the cluster is actually about:
    "Pelecehan oleh Tokoh Agama"           (NOT "Hukum & Kriminalitas")
    "WNI Tertahan di Israel"               (NOT "Diplomasi Internasional")
    "Persiapan Haji & Idul Adha"           (specific religious event)
    "Tekanan Ekonomi Petani & Nelayan"     (NOT "Kebijakan Ekonomi")
    "Judi Online & Pinjol bagi Pemuda"     (specific phenomenon)
    "Solidaritas untuk Palestina & Gaza"   (NOT "Konflik Internasional")
    "Korupsi Pejabat & Keadilan Hukum"     (specific pattern)
    "Kekerasan terhadap Anak & Remaja"     (specific victim class)
    "Kanker & Penyakit Kronis"             (concrete health cluster — OK even without obvious da'wah angle)
    "Kajian & Hadits Akhlaq"               (concrete content type — kajian videos, akhlaq lessons)
    "Pendidikan & Sekolah Inklusif"        (concrete education cluster)
    "Pasar Saham & Investasi Pribadi"      (concrete finance cluster)
    "Bencana Alam & Tanggap Darurat"       (concrete event class)

  BAD labels — generic buckets that mix unrelated stories:
    "Berita Politik"                       (too broad)
    "Pemerintahan & Birokrasi"             (department-level, not a theme)
    "Hukum & Kriminalitas"                 (mixes 5 unrelated stories — split into specifics)
    "Isu Sosial"                           (mixes everything)
    "barat · nasional · masih"             (stopwords joined by dots)

  Rule of thumb: a good label names a SPECIFIC subject the analyst can scan and decide on. A bad label is a section-header so broad the analyst still has to read every post to know what's in it.

- keywords: 3-5 distinctive keywords (Bahasa Indonesia preferred). These keywords are ALSO used to match posts to this theme by meaning, so pick words that are specific and central to the theme. Avoid stopwords (yang, dan, atau, dengan, untuk, akan, masih, sebelum, terkait, dari, ke) and URL artifacts (republikacoid, kompascom).

Rules:
- Themes must be DISTINCT — don't split one theme into two near-duplicates. Two themes are near-duplicates if a da'i preparing a kajian would use the SAME daleel and the SAME framing for both. Setting / context variation (school vs. domestic vs. workplace, urban vs. rural, online vs. offline) is NOT enough to justify a separate theme — fold it into ONE theme. The downstream system has a post-emit cosine-merge step at 0.85 that will collapse near-duplicates automatically, but it's a safety net, not a substitute for clean labeling.

  ❌ BAD — three rows on one theme (real audit, 2026-05-31):
      "Kekerasan Seksual & Perlindungan Anak"
      "Pelecehan & Kekerasan terhadap Perempuan dan Anak"
      "Kekerasan Seksual di Lingkungan Pendidikan"
    The da'i quotes the same Qur'anic verses (An-Nisa, An-Nahl on mustadh'afin) for all three; the setting differences belong INSIDE one cluster, not as separate clusters.
  ✅ GOOD — one canonical row covering the scope:
      "Pelecehan & Kekerasan terhadap Perempuan dan Anak"

  ❌ BAD — two rows differing only in framing angle:
      "Kriminalitas & Kejahatan Jalanan"
      "Kriminalitas & Penegakan Hukum"
  ✅ GOOD:
      "Kriminalitas & Penegakan Hukum"

- Aim for BREADTH: the themes you return should jointly cover the great majority (≥80%) of the posts in the pool. If you notice a sizable slice you haven't covered (health stories, education stories, finance/investasi posts, kajian/akhlaq content, sport, lifestyle), add a theme for it rather than letting it drop to "uncategorized". The downstream system has its own cosine-similarity floor that filters borderline matches — you don't need to be conservative here. Undersizing themes is more costly than oversizing.
- If multiple stories share a clear pattern (e.g. 3 separate child-abuse cases involving religious figures), group them under ONE specific theme ("Pelecehan oleh Tokoh Agama"), not three "miscellaneous crime" entries.

PREFER SUBDIVIDE OVER GENERALIZE:
When you're tempted to widen a label (e.g. "Kekerasan dan Kriminalitas Jalanan") to fit posts that don't really belong (drug raids, industrial crime, traffic accidents, workplace violence), STOP and split into 2-3 specific themes instead. Examples of BAD generalization → BETTER split:
  ❌ "Kekerasan dan Kriminalitas Jalanan" (forces street-crime + drug raids + industrial fraud + traffic into one bucket)
  ✅ Split into: "Begal & Kejahatan Jalanan" + "Operasi Narkoba & Penyalahgunaan Obat" + "Kecelakaan & Pelanggaran Lalu Lintas"
  ❌ "Isu Sosial Pemuda" (mixes bullying + judi online + kecurangan ujian + gang violence)
  ✅ Split into: "Bullying & Kekerasan di Sekolah" + "Judi Online & Eksploitasi Digital Pemuda"
A reader can scan a tight, specific theme and decide what to do with it; a generic bucket forces them to read every post to know what's inside.

ASSIGNMENT CONTROLS — each theme MAY include two extra optional fields that protect it from false-positive assignment:

- `exclude_keywords`: 0-6 short Indonesian terms that DISQUALIFY a post from this theme even when the vector is similar. Use this for themes whose semantic space bleeds into adjacent concepts. Examples that came from a real audit:
  * "Judi Online & Pinjol" was grabbing romance scams, WO catering scams, saham investment talk, and game-developer complaints — all "scam"-shaped but not judol/pinjol. Set `exclude_keywords: ["WO", "wedding organizer", "saham", "investasi", "game developer", "TNI gadungan"]`.
  * "Konflik Palestina" was grabbing Afghanistan history, skin-whitening rants, and unrelated humanitarian crises. Set `exclude_keywords: ["skin care", "skincare", "putih instan", "Afghanistan"]`.
  * "Korupsi Pejabat" was grabbing education policy and labor lawsuits. Set `exclude_keywords: ["UU Ciptaker", "kecelakaan tol", "sekolah swasta"]`.
  Tight themes ("Kriminalitas Jalanan", "Ibadah Haji & Kurban") rarely need this — leave empty.

- `min_similarity`: float in [0.28, 0.55]. Override the default 0.28 cosine floor for this theme. Raise it (e.g. 0.40-0.45) for themes whose centroid is broad and likely to attract weak matches: "Lainnya"-flavored buckets, "Kesehatan Mental" (the word "mental" is used in unrelated snark), "Krisis Kemanusiaan" (broad). Leave at default for tight, well-bounded themes.

Return ONLY valid JSON:
{{"themes": [{{"label": "...", "keywords": ["...", ...], "exclude_keywords": ["...", ...], "min_similarity": 0.40}}, ...]}}
The two extra fields are OPTIONAL — omit them when not needed.
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
                        "exclude_keywords": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "min_similarity": {"type": "number"},
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
    themes: list[dict[str, Any]] = []
    for t in themes_raw:
        label = str(t.get("label", "")).strip()
        if not label:
            continue
        # Per-theme similarity override clamps to [global_floor, 0.55] —
        # the LLM can ask for stricter assignment but can't loosen below
        # the global noise floor.
        per_theme_floor = t.get("min_similarity")
        try:
            per_theme_floor = (
                float(per_theme_floor) if per_theme_floor is not None else None
            )
        except (TypeError, ValueError):
            per_theme_floor = None
        if per_theme_floor is None or per_theme_floor < MIN_SIMILARITY:
            per_theme_floor = MIN_SIMILARITY
        per_theme_floor = min(per_theme_floor, 0.55)
        themes.append(
            {
                "label": label,
                "keywords": [
                    str(k).strip()
                    for k in (t.get("keywords") or [])
                    if str(k).strip()
                ],
                "exclude_keywords": [
                    str(k).strip().lower()
                    for k in (t.get("exclude_keywords") or [])
                    if str(k).strip()
                ],
                "min_similarity": per_theme_floor,
            }
        )

    # Merge static themes. Drop any dynamic theme whose label collides
    # with a static theme (Gemini occasionally proposes one despite the
    # prompt directive — static wins because its keywords are curated
    # and stable across runs). Static themes are deep-copied so the
    # downstream embedding+assignment doesn't mutate the global constant.
    static_labels_lower = {t["label"].strip().lower() for t in STATIC_THEMES}
    themes = [t for t in themes if t["label"].strip().lower() not in static_labels_lower]
    themes.extend(
        {
            "label": t["label"],
            "keywords": list(t["keywords"]),
            "exclude_keywords": list(t.get("exclude_keywords") or []),
            "min_similarity": float(t.get("min_similarity") or MIN_SIMILARITY),
        }
        for t in STATIC_THEMES
    )

    if not themes:
        log.warning("topic_discovery.no_themes_named", platform=platform)
        return []
    log.info(
        "topic_discovery.themes_assembled",
        dynamic_count=len(themes) - len(STATIC_THEMES),
        static_count=len(STATIC_THEMES),
        total=len(themes),
    )

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

    # Post-emit near-duplicate merge. The system prompt asks Gemini for
    # DISTINCT themes (line ~392), but the model occasionally outputs
    # near-duplicates that differ only in framing or setting (e.g. a
    # 2026-05-31 audit found three rows for sexual-violence variants:
    # by victim class, by setting, by act-vs-protection angle). We fold
    # them here using pairwise cosine on theme vectors — same embedding
    # space used downstream for post-assignment, so the threshold is
    # interpretable.
    #
    # Threshold 0.85: empirically catches the audit's three-way split
    # while leaving genuinely-distinct adjacent themes alone (e.g.
    # "Krisis Ekonomi & Daya Beli" vs. "Ketahanan Pangan & Pertanian"
    # share economic vocab but score < 0.80 in practice).
    #
    # Static themes are NEVER merged away — they're the curated stable
    # set. Dynamic-vs-static near-duplicate: drop the dynamic, keep
    # the static. Dynamic-vs-dynamic: keep the shorter label (proxy
    # for "more canonical"), union the keyword lists.
    n_static = len(STATIC_THEMES)
    static_offset = len(themes) - n_static  # static themes are at the tail
    merge_threshold = 0.85
    # Pairwise similarity matrix (n_themes, n_themes).
    theme_sims = theme_vecs @ theme_vecs.T
    drop_idx: set[int] = set()
    merge_log: list[tuple[str, str, float]] = []
    n_themes = len(themes)
    for i in range(n_themes):
        if i in drop_idx:
            continue
        for j in range(i + 1, n_themes):
            if j in drop_idx:
                continue
            sim = float(theme_sims[i, j])
            if sim < merge_threshold:
                continue
            i_is_static = i >= static_offset
            j_is_static = j >= static_offset
            if i_is_static and j_is_static:
                # Two static themes near-dup — curated set, log only.
                log.warning(
                    "topic_discovery.static_static_collision",
                    a=themes[i]["label"],
                    b=themes[j]["label"],
                    similarity=round(sim, 3),
                )
                continue
            # Pick keep + drop. Static always wins. Otherwise keep the
            # shorter label (proxy for "more canonical").
            if j_is_static or (
                not i_is_static
                and len(themes[i]["label"]) > len(themes[j]["label"])
            ):
                keep, drop = j, i
            else:
                keep, drop = i, j
            # Union the dropped theme's keywords into the kept one.
            kept_kw = set(k.lower() for k in themes[keep]["keywords"])
            for kw in themes[drop]["keywords"]:
                if kw.lower() not in kept_kw:
                    themes[keep]["keywords"].append(kw)
                    kept_kw.add(kw.lower())
            # Union exclude_keywords too — the dropped theme's excludes
            # are still relevant guardrails on the merged centroid.
            kept_ex = set(themes[keep].get("exclude_keywords") or [])
            for ex in themes[drop].get("exclude_keywords") or []:
                if ex not in kept_ex:
                    themes[keep].setdefault("exclude_keywords", []).append(ex)
                    kept_ex.add(ex)
            drop_idx.add(drop)
            merge_log.append(
                (themes[keep]["label"], themes[drop]["label"], sim)
            )
            if drop == i:
                # Just dropped i; stop scanning j's for this i.
                break
    if drop_idx:
        log.info(
            "topic_discovery.merged_near_duplicates",
            merged_count=len(drop_idx),
            pairs=[
                {"kept": k, "dropped": d, "sim": round(s, 3)}
                for k, d, s in merge_log
            ],
        )
        # Compact themes + theme_vecs (and theme_texts though unused below).
        keep_mask = [i not in drop_idx for i in range(n_themes)]
        themes = [t for t, m in zip(themes, keep_mask, strict=True) if m]
        theme_vecs = theme_vecs[keep_mask]

    # Cosine similarity (vectors are L2-normalized) → (n_posts, n_themes).
    sims = post_vecs @ theme_vecs.T
    # Iterate themes in decreasing similarity per post — when a post's
    # top-1 theme excludes it (via exclude_keywords or per-theme floor),
    # fall through to the next-best theme rather than dropping the post.
    order = np.argsort(-sims, axis=1)

    theme_post_ids: list[list[Any]] = [[] for _ in themes]
    orphan_ids: list[Any] = []
    assigned = 0
    excluded_by_keyword = 0
    excluded_by_floor = 0

    for row, (sample_i, post_text) in enumerate(indexed_texts):
        post_lower = post_text.lower()
        placed = False
        for theme_idx in order[row]:
            theme = themes[theme_idx]
            sim = sims[row, theme_idx]
            if sim < theme["min_similarity"]:
                # All remaining themes have even lower similarity → bail.
                excluded_by_floor += 1
                break
            # Negative-pivot check: any exclude_keyword present as a
            # case-insensitive substring disqualifies this assignment;
            # try the next theme. Word-boundary match would be cleaner
            # but Indonesian inflection + multi-word keywords make
            # substring the pragmatic choice.
            if any(kw in post_lower for kw in theme["exclude_keywords"]):
                excluded_by_keyword += 1
                continue
            theme_post_ids[theme_idx].append(sample[sample_i]["id"])
            assigned += 1
            placed = True
            break
        if not placed:
            orphan_ids.append(sample[sample_i]["id"])

    results: list[dict[str, Any]] = []
    for theme, post_ids in zip(themes, theme_post_ids, strict=True):
        if len(post_ids) < MIN_POSTS_PER_THEME:
            # Posts that landed on a too-small theme become orphans
            # rather than disappearing.
            orphan_ids.extend(post_ids)
            continue
        results.append(
            {
                "label": theme["label"],
                "keywords": theme["keywords"],
                "post_ids": post_ids,
            }
        )

    if len(orphan_ids) >= MIN_POSTS_FOR_FALLBACK:
        results.append(
            {
                "label": FALLBACK_LABEL,
                "keywords": ["lainnya"],
                "post_ids": orphan_ids,
            }
        )

    log.info(
        "topic_discovery.done",
        platform=platform,
        themes_named=len(themes),
        themes_kept=len(results),
        sampled=len(sample),
        assigned=assigned,
        orphan=len(orphan_ids),
        excluded_by_keyword=excluded_by_keyword,
        excluded_by_floor=excluded_by_floor,
        fallback_bucket=len(orphan_ids) >= MIN_POSTS_FOR_FALLBACK,
    )

    return results
