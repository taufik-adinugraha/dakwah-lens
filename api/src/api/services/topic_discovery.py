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
import re
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


# Beats we ALWAYS want Gemini to look for, but never as rigid pre-set
# labels. The 2026-06-04 audit found that injecting these as static
# themes produced generic, editorially flat buckets ("Korupsi" with 94
# posts) that competed with the concrete dynamic theme Gemini already
# discovered ("Korupsi Program MBG & BGN" with 455 posts) — splitting
# attention and burying the actual headline.
#
# Replaced 2026-06-04: these are now PROMPT HINTS only. We list each
# beat + its intent + an example of GOOD week-specific naming, then
# trust Gemini to:
#   - Surface the beat ONLY IF it's actually present this week
#   - Name it CONCRETELY based on the specific story driving it,
#     not the generic category
#
# Old behavior: "Palestina" guaranteed every run, generic label.
# New behavior: this week Gemini might call it "Bantuan WNI ke Gaza"
# (concrete + this-week-specific); next week if nothing's happening
# in Palestina, no Palestina topic at all and the slot goes to
# whatever's actually driving the conversation.
THEMES_TO_WATCH: tuple[tuple[str, str, str], ...] = (
    # (beat, intent hint, example of a concrete week-specific label)
    (
        "Korupsi & penyalahgunaan amanah pejabat",
        "Pejabat publik / institusi pemerintah; suap, gratifikasi, KPK, ghulul",
        "Korupsi Dana Bansos di Kementerian X / Suap Hakim Y",
    ),
    (
        "Kekerasan seksual & perlindungan anak",
        "Pelecehan, KDRT, kekerasan terhadap anak — termasuk di pesantren, sekolah, rumah tangga",
        "Pelecehan oleh Tokoh Agama di Pesantren / KS Anak di Sekolah",
    ),
    (
        "Judi online & jeratan utang konsumtif",
        "Judol, slot online, pinjol, paylater, hutang konsumtif rumah tangga",
        "Operasi Judol Skala Besar / Pinjol Mencekik Buruh",
    ),
    (
        "Narkoba & penyalahgunaan obat",
        "Sabu, pil koplo, BNN, rehabilitasi, kecanduan obat",
        "Tangkapan Sabu di Pelabuhan / Rehabilitasi Pesantren",
    ),
    (
        "Konflik Palestina & solidaritas umat",
        "Palestina, Gaza, mustadh'afin, hubungan Indonesia-Palestina",
        "Bantuan WNI ke Gaza / Demo Palestina di Kota X",
    ),
    (
        "Hijrah, mualaf & cerita iman personal",
        "Cerita hijrah, mualaf, dakwah personal, perjalanan iman",
        "Hijrah Selebritas X / Mualaf di Komunitas Y",
    ),
    (
        "Fatwa & polemik hukum Islam kontemporer",
        "Fatwa MUI / ulama, kontroversi keagamaan, ijtihad isu modern",
        "Fatwa MUI soal Crypto / Polemik Vaksin Dosis Berikut",
    ),
    (
        "Kekerasan dalam rumah tangga (KDRT)",
        "KDRT, kekerasan domestik, kasus perceraian dengan kekerasan",
        "Kasus KDRT Selebritas X / Sweeping KDRT di Kelurahan Y",
    ),
    (
        "Polemik aqidah & sektarian",
        "Aliran sesat, sektarian, polemik Syiah/Ahmadiyah, pelurusan aqidah",
        "Polemik Aliran X / MUI Sesatkan Kelompok Y",
    ),
    (
        "Toleransi & lintas-iman",
        "Moderasi beragama, pluralisme, kerukunan umat",
        "Konflik Rumah Ibadah di Kota X / Dialog Lintas Iman",
    ),
)

# Render THEMES_TO_WATCH as a senior-editor-style hint block. Each
# beat shows up as "Beat name → intent (e.g. concrete label)". Gemini
# uses this to know what to LOOK FOR, but is explicitly told to name
# the theme based on this week's actual story, NOT to reuse the
# generic beat name.
_THEMES_TO_WATCH_BLOCK = "\n".join(
    f'  - {beat}\n      intent: {intent}\n      example concrete label: "{example}"'
    for beat, intent, example in THEMES_TO_WATCH
)


SYSTEM_PROMPT = f"""You analyze recent Indonesian posts and group them into themes that describe what the conversation is actually about this week. Output is consumed by da'wah analysts, but YOUR job is to map the conversation faithfully — not to force every theme through a da'wah lens. Some themes will have an obvious da'wah angle (haji, korupsi, palestina); others (health, education, sport, lifestyle, finance) won't, and that's fine — surface them anyway so the analyst can decide which to act on.

The posts you receive have already been pre-filtered for da'wah relevance — they DO have a hook. Your job is to find what the week's conversation is, not to re-classify whether each post is relevant.

THEMES TO WATCH (chronic da'wah-concern beats — surface them ONLY IF a real story is happening, and NAME THEM CONCRETELY based on this week's news):
{_THEMES_TO_WATCH_BLOCK}

How to use the THEMES TO WATCH block:
- These are BEATS we always care about, not rigid labels to reuse verbatim. Think like a senior editor: you watch for these patterns, but you write the HEADLINE based on what's actually happening.
- If a beat IS present this week, propose a theme with a CONCRETE label naming the specific story, not the generic beat name. Example: a corruption case at BGN → label "Korupsi MBG & BGN", NOT "Korupsi". A pilgrim transport accident → label "Kecelakaan Jamaah Haji di Mekkah", NOT "Ibadah Haji & Umrah".
- If a beat is NOT present this week (or only marginally, < ~10 posts), DO NOT force a generic theme just to cover the beat. Let those posts land in Lainnya or in adjacent themes.
- Never use the generic beat name as your label — that produces editorially flat clusters that compete with the real-story clusters for the same posts.

Your job: propose 22-28 themes for what's distinctive about THIS WEEK's conversation — concrete week-specific stories (from the THEMES TO WATCH list when present + anything else emerging), plus broad-domain themes (politics, education, health, lifestyle, sport) to cover the breadth of the pool. The downstream UI groups themes into 14 coarse THEME_GROUPS (Hukum & Keadilan, Sosial & Keluarga, Ekonomi & Bisnis, Aqidah & Ibadah, Kesehatan & Kehidupan, Pendidikan & SDM, Lingkungan & Bencana, Pemerintahan & Kebijakan, Patologi Sosial Digital, Teknologi & AI, Pekerja & Pertanian Rakyat, Konflik & Geopolitik, Inspirasi & Kisah Pribadi, Toleransi & Lintas-Iman) so a higher theme count won't clutter the dashboard — readers see the groups first and can drill into fine themes when needed.

ERR ON THE SIDE OF MORE THEMES (audit failure 2026-06-06): a 17-theme run had ~38% within-topic noise because broad absorbent themes swallowed semantically-adjacent but story-distinct posts. Concrete contamination from that run, sorted by impact:
  · "Korupsi MBG & Pejabat BGN" (67% noise) absorbed Bandara IKN corruption, BBM Jepara smuggling, Roy Suryo ijazah-palsu case, even general anti-fraud posts. CURE: split each corruption case into its own theme. This week alone deserves SEPARATE themes for: "Korupsi MBG & BGN", "Korupsi Imigrasi WNA Silmy Karim", "Korupsi Chromebook Nadiem", "Korupsi BBM/Solar Subsidi Jepara", plus a generic "Korupsi Pejabat Lainnya" catch-all.
  · "Kekerasan dalam Rumah Tangga (KDRT)" (83% noise) absorbed broader gender discourse — feminist commentary, cerai-debates, "perempuan menyusahkan" posts. CURE: keep KDRT TIGHTLY scoped to physical-violence-in-household cases; create a separate "Diskursus Gender & Feminisme" theme for the discourse.
  · "Pelemahan Rupiah & Dampak Ekonomi" (83% noise) absorbed generic macro (FDI claims, food rankings, Mazhab Austria economic theory, bantuan pangan). CURE: separate "Pelemahan Rupiah" (currency-specific) from "Kebijakan Ekonomi Makro" (broader policy) from "Bantuan Sosial & Pangan".
  · "Ibadah Haji & Umrah" (50% noise) absorbed qurban posts (different ibadah), sinetron "Tukang Bubur Naik Haji" reviews, NU Mubes organizational news. CURE: split "Ibadah Haji & Umrah" from "Qurban & Idul Adha" — they're separate ibadah events even though they peak the same week.
  · "Kekerasan Seksual & Perlindungan Anak" (50% noise) absorbed happy wedding announcements, film-documentary disputes. CURE: tight exclude_keywords ["nikah", "pernikahan", "menikah", "menikahkan", "film dokumenter"] OR split into "Pelecehan oleh Tokoh Agama/Ponpes" + "Kekerasan Seksual & Penegakan Hukum".
  · "Narkoba & Penyalahgunaan Obat" (50% noise) absorbed rokok posts + kosmetik fraud. CURE: tight exclude_keywords ["rokok", "tembakau", "kosmetik", "BPOM kosmetik"].
  · "Bencana Alam & Lingkungan" (33% noise) absorbed "burnout" slang posts. CURE: tight exclude_keywords ["burnout", "burnout syndrome"].
The pattern: ANY theme whose label starts with a broad category noun ("Korupsi", "Kekerasan", "Ekonomi") will absorb adjacent stories unless either (a) split into specific stories or (b) given a tight exclude_keywords list. Default to (a) — splitting is cheaper than maintaining excludes.

For each theme:
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

ELASTIC-WORD GUARD (HARD RULE):
Some words in Indonesian are emotionally elastic — they appear in MANY unrelated headlines because journalists overuse them. These words include: "misterius", "horor", "aneh", "tragis", "viral", "polemik", "kontroversi", "heboh", "geger". If you put any of these in a theme label, the embedding centroid pulls in everything with that word — accidents framed as "tewas misterius", deaths framed as "tragis", scandals framed as "polemik". REAL 2026-06-02 audit failure: a theme labeled "Peristiwa Misterius & Horor" sucked in 70% accident/death-news ("tewas misterius di kamping Temanggung", "pria hanyut", "keracunan gas") because every accident headline uses "misterius".

If you propose a theme whose label contains any elastic word above, you MUST EITHER:
  (a) rename it to a NON-elastic concrete label (e.g. "Peristiwa Misterius & Horor" → "Cerita Pocong & Fenomena Paranormal"), OR
  (b) set a tight `exclude_keywords` list that filters out the bleed-in. For "misterius/horor": exclude_keywords MUST include at minimum: ["keracunan", "kebakaran", "kecelakaan", "tenggelam", "hanyut", "tewas", "banjir", "korban"]. The exclude list is the ONLY way the bleed-in stops.

If you can't do either confidently, drop the theme entirely and let the static "Lainnya — Tidak Terklasifikasi" bucket catch those posts.

CATCH-ALL THEMES ARE FORBIDDEN (HARD RULE — added 2026-06-07):
You MUST NOT mint a theme whose purpose is to be a leftover/uncategorized bucket. The downstream system ALREADY appends a single canonical static bucket called "Lainnya — Tidak Terklasifikasi" (with em-dash) AFTER your themes are processed — it is your safety net, not your responsibility. Concretely, DO NOT return any theme whose label is or normalises to:
  · "Lainnya" / "Lainnya - Tidak Terklasifikasi" (hyphen) / "Lainnya Tidak Terklasifikasi" (no dash) — these are duplicates of the canonical em-dash bucket and the system will reject them
  · "Misc" / "Miscellaneous" / "Other" / "Others" / "Uncategorized" / "Unclassified" — English variants are equally forbidden
  · "Umum Lainnya" / "Catch-all" / "Lain-lain"
  · ANY label whose intent is "stuff I couldn't classify"
A 2026-06-07 audit found Gemini minting "Lainnya - Tidak Terklasifikasi" (hyphen variant) alongside the canonical em-dash bucket, creating duplicate rows. Even if you think the variant is "more accurate" or "covers different posts," it's wrong — the system has exactly ONE leftover bucket and you do not own it. If a post does not fit any of your concrete themes, leave it unassigned and the static bucket will pick it up.

ASSIGNMENT CONTROLS — each theme MAY include two extra optional fields that protect it from false-positive assignment:

- `exclude_keywords`: 0-6 short Indonesian terms that DISQUALIFY a post from this theme even when the vector is similar. Use this for themes whose semantic space bleeds into adjacent concepts. Examples that came from a real audit:
  * "Judi Online & Pinjol" was grabbing romance scams, WO catering scams, saham investment talk, and game-developer complaints — all "scam"-shaped but not judol/pinjol. Set `exclude_keywords: ["WO", "wedding organizer", "saham", "investasi", "game developer", "TNI gadungan"]`.
  * "Konflik Palestina" was grabbing Afghanistan history, skin-whitening rants, and unrelated humanitarian crises. Set `exclude_keywords: ["skin care", "skincare", "putih instan", "Afghanistan"]`.
  * "Korupsi Pejabat" was grabbing education policy and labor lawsuits. Set `exclude_keywords: ["UU Ciptaker", "kecelakaan tol", "sekolah swasta"]`.
  Tight themes ("Kriminalitas Jalanan", "Ibadah Haji & Kurban") rarely need this — leave empty.

- `min_similarity`: float in [0.28, 0.55]. Override the default 0.28 cosine floor for this theme. Raise it (e.g. 0.40-0.45) for themes whose centroid is broad and likely to attract weak matches: "Lainnya"-flavored buckets, "Kesehatan Mental" (the word "mental" is used in unrelated snark), "Krisis Kemanusiaan" (broad), AND any theme whose label is a broad category noun ("Korupsi …", "Kekerasan …", "Ekonomi …", "Bencana …"). The 2026-06-06 audit found these category-noun themes absorbed 50-83% noise at the default floor; raising to 0.40 cuts the bleed dramatically without losing the on-theme posts (their centroid match is usually 0.45+). Leave at default for tight, well-bounded themes ("Konflik Palestina & Lebanon" — 0% noise at default — needs no override).

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

    # Static-theme merge removed 2026-06-04. Every theme is now
    # dynamic — Gemini decides what's present this week using the
    # THEMES TO WATCH hint block in the system prompt for editorial
    # guidance. No post-emit injection.

    # Catch-all collision filter (added 2026-06-07). The prompt instructs
    # Gemini at line 287 to NOT mint themes for unclassified content —
    # "let the static 'Lainnya — Tidak Terklasifikasi' bucket catch
    # those posts." Despite this, the 2026-06-07 audit found Gemini
    # occasionally minted near-duplicates of the static fallback
    # ("Lainnya - Tidak Terklasifikasi" with a hyphen instead of em-
    # dash, "Lainnya Tidak Terklasifikasi" without dash, "Misc", "Other
    # — Uncategorized"). The pre-existing cosine-merge step at 0.78
    # didn't catch these because the static fallback isn't part of the
    # LLM-discovered theme set at that point — it's appended later.
    # Filter them here BEFORE the cosine pass so the posts that would
    # have landed in the duplicate funnel through to the canonical
    # static bucket instead.
    def _is_catchall_label(label: str) -> bool:
        norm = re.sub(r"[^a-z0-9]+", " ", label.lower()).strip()
        # Match canonical (lainnya tidak terklasifikasi), shorter
        # variants (just "lainnya", just "tidak terklasifikasi"),
        # English borrowings (misc, other, uncategorized,
        # unclassified), and explicit "catch-all" phrasings.
        catchall_tokens = {
            "lainnya tidak terklasifikasi",
            "tidak terklasifikasi",
            "lainnya",
            "lain lain",
            "lain-lain",
            "miscellaneous",
            "misc",
            "other",
            "others",
            "uncategorized",
            "unclassified",
            "catch all",
            "umum lainnya",
        }
        return norm in catchall_tokens

    rejected_catchall: list[str] = []
    kept_themes: list[dict[str, Any]] = []
    for t in themes:
        if _is_catchall_label(t["label"]):
            rejected_catchall.append(t["label"])
        else:
            kept_themes.append(t)
    themes = kept_themes
    if rejected_catchall:
        log.info(
            "topic_discovery.catchall_themes_filtered",
            count=len(rejected_catchall),
            labels=rejected_catchall,
            reason="LLM minted a Lainnya/Misc-flavored theme; posts will route to the canonical static fallback bucket instead",
        )

    if not themes:
        log.warning("topic_discovery.no_themes_named", platform=platform)
        return []
    log.info(
        "topic_discovery.themes_assembled",
        dynamic_count=len(themes),
        total=len(themes),
    )

    # Mystery/horror auto-inject. Targets THE specific failure mode we
    # observed: themes labeled "misterius / horor / aneh" empirically
    # vacuum in unrelated fire & accident news because Indonesian
    # journalists frame ANY death/fire/disaster with those words
    # ("api misterius", "tewas misterius", "kejadian aneh"). The
    # auto-inject below ONLY trips on these three labels — other
    # elastic words (polemik, tragis, kontroversi, viral, heboh, geger)
    # are still gated by the prompt-side rule but NOT auto-augmented
    # here because their excludes would actually break legitimate
    # clusters:
    #   - "Tragedi Glamping Temanggung" needs `tewas/korban/keracunan`
    #     in scope (they're the topic, not the bleed-in)
    #   - "Polemik Sapi Kurban Presiden" needs `korban` (sapi korban =
    #     sapi kurban offering — narrowing it would drop legitimate
    #     kurban-discussion posts)
    #   - "Kontroversi Pemilu" / "Heboh PDI-P" have no canonical
    #     bleed-pattern to exclude
    # If a new bleed-in pattern emerges for those elastic words,
    # extend ELASTIC_WORDS + add a separate excludes list per pattern.
    ELASTIC_WORDS = {"misterius", "horor", "aneh"}
    # Indonesian morphology: a single verb root sprouts many surface
    # forms (bakar / terbakar / dibakar / membakar / kobaran / hangus).
    # The exclude check is literal substring on post text, so each
    # form needs to be listed. Catches the 2026-06-03 04:00 WIB
    # auto-recluster failure where "Fenomena Api Misterius di Sleman"
    # vacuumed posts like "Motornya Hangus Dibakar Massa" and "Tembus
    # Kobaran Api Ruko" because the post text matched the cluster's
    # embedding centroid AND didn't contain the literal token
    # "kebakaran".
    ELASTIC_MIN_EXCLUDES = [
        # Fire / burning — all morphological variants
        "kebakaran",
        "terbakar",
        "dibakar",
        "membakar",
        "hangus",
        "kobaran",
        # Other accident / disaster framings
        "keracunan",
        "kecelakaan",
        "tenggelam",
        "hanyut",
        "tewas",
        "banjir",
        "korban",
    ]
    elastic_augmented: list[str] = []
    for theme in themes:
        label_lower = theme["label"].lower()
        if not any(word in label_lower for word in ELASTIC_WORDS):
            continue
        existing = {ex.lower() for ex in (theme.get("exclude_keywords") or [])}
        added: list[str] = []
        for ex in ELASTIC_MIN_EXCLUDES:
            if ex not in existing:
                theme.setdefault("exclude_keywords", []).append(ex)
                existing.add(ex)
                added.append(ex)
        if added:
            elastic_augmented.append(theme["label"])
    if elastic_augmented:
        log.info(
            "topic_discovery.elastic_excludes_injected",
            count=len(elastic_augmented),
            themes=elastic_augmented,
        )

    # String-overlap dedup pass removed 2026-06-04 along with the
    # static themes — it was specifically a dynamic-vs-static safety
    # net (catching e.g. dynamic "Pelecehan & Kekerasan Seksual" that
    # cosine-merge missed against static "Kekerasan Seksual &
    # Perlindungan Anak"). Now every theme is dynamic, so the post-
    # emit cosine merge at 0.78 below handles all near-duplicate
    # collapsing on its own.

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
    # DISTINCT themes, but the model occasionally outputs near-duplicates
    # that differ only in framing or setting (e.g. a 2026-05-31 audit
    # found three rows for sexual-violence variants: by victim class,
    # by setting, by act-vs-protection angle). We fold them here using
    # pairwise cosine on theme vectors — same embedding space used
    # downstream for post-assignment, so the threshold is interpretable.
    #
    # Threshold 0.78: lowered from 0.85 on 2026-06-02. With all-
    # dynamic themes (post 2026-06-04 STATIC_THEMES removal) we keep
    # the SHORTER label (proxy for "more canonical") and union the
    # keyword + exclude lists into it.
    merge_threshold = 0.78
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
            # Keep the shorter label (more canonical proxy); union the
            # other's keywords + excludes into it.
            if len(themes[i]["label"]) > len(themes[j]["label"]):
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

    # Purity audit — for each assigned theme, fraction of posts whose
    # text contains at least one of the theme's keywords (literal
    # substring, case-insensitive). Low purity = the embedding centroid
    # is attracting posts that don't share surface vocabulary with the
    # theme — usually a bleed-in pattern worth investigating. Logged
    # alongside `topic_discovery.done` so it's grep-able from worker
    # logs. Doesn't change behaviour — purely observational.
    #
    # Skip the fallback bucket (its keyword "lainnya" never matches
    # any real post). Threshold 0.40 flags clusters where >60% of
    # assigned posts don't even mention a single keyword — strong
    # signal of bleed-in or over-broad label.
    id_to_text = {p["id"]: p.get("text", "") for p in sample}
    purity_per_theme: list[dict[str, Any]] = []
    low_purity: list[str] = []
    for t_idx, theme in enumerate(themes):
        # theme_post_ids is a list[list], not a dict — index by t_idx
        # directly. Was .get(t_idx, []) prior to 2026-06-04 which
        # crashed every recluster after the purity-audit code landed
        # (commit 8910a28); recluster 2026-06-04 04:00 WIB failed
        # this way, leaving topics stale at 06-03 04:00 WIB.
        post_ids = theme_post_ids[t_idx]
        if not post_ids:
            continue
        keywords_lower = [kw.lower() for kw in theme.get("keywords", []) if kw]
        if not keywords_lower:
            continue
        matched = 0
        for pid in post_ids:
            text_lower = id_to_text.get(pid, "").lower()
            if any(kw in text_lower for kw in keywords_lower):
                matched += 1
        purity = matched / len(post_ids)
        purity_per_theme.append(
            {
                "label": theme["label"],
                "n": len(post_ids),
                "purity": round(purity, 2),
            }
        )
        if purity < 0.40:
            low_purity.append(theme["label"])

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
    log.info(
        "topic_discovery.purity_audit",
        platform=platform,
        themes=purity_per_theme,
        low_purity_count=len(low_purity),
        low_purity_labels=low_purity,
    )

    return results
