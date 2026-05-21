"""Daily executive briefing(s) for the public /insights page.

Five briefings per day after the 2026-05-20 expansion:
  - 1 all-platform (segment IS NULL)
  - 4 per-segment (spiritual / family / youth / justice)

Each briefing now contains three layers:
  1. Description — what trended this week, grounded in numeric stats
  2. Nasihah — a short Islamic admonition / practical takeaway
  3. Daleel — citations from the kitab corpus

PRD §12 — Sharia compliance. The LLM is RESTRICTED to citing only daleel
that we RETRIEVED from Qdrant for this briefing. Daleel that's not in
the retrieved list must not appear in the narrative. We pass the
retrieved daleel as context and a strict system instruction; failure
to comply would be a logged warning.

Cost per briefing: ~$0.02–0.05 (Gemini 2.5 Pro narrative + OpenAI
embedding for retrieval). Five briefings × 30 days ≈ $3-7.50/mo.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from google import genai
from google.genai import types
from sqlalchemy import text

from api.config import settings
from api.db import SessionLocal
from api.models.admin import InsightsSummary
from api.services.kitab_retrieval import rerank_daleel, retrieve_daleel

log = structlog.get_logger()

MODEL = "gemini-2.5-pro"

# Segment → category set mapping. MUST match the canonical mapping in
# web/src/app/[locale]/insights/segment/[focus]/page.tsx — if the web
# side moves, mirror here. `None` segment means "all categories".
SEGMENT_CATEGORIES: dict[str, list[str]] = {
    "spiritual": ["aqidah", "akhlaq"],
    "family": ["family", "health"],
    "youth": ["youth", "education"],
    "justice": ["social_justice", "economic_ethics", "muamalah"],
}

ALL_CATEGORIES = [
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


_PERSONA_ID = """Anda seorang analis dakwah Indonesia yang bekerja untuk Sukses & Berkah Group — yayasan nirlaba yang membantu ekosistem dakwah Indonesia (da'i, ustadzah, kreator konten, orang tua, pengurus komunitas). Tugas Anda menyusun briefing analisis MINGGUAN, bukan khutbah. Suara Anda observasional dan pragmatis: Anda memetakan pola percakapan publik dengan jernih, lalu memberikan handle praktis untuk berbagai surface dakwah. Anda berakar pada Qur'an + sunnah ahlu sunnah wal jama'ah, netral pada perbedaan mazhab, paham konteks sosial Indonesia kontemporer."""


_PERSONA_EN = """You are an Indonesian da'wah analyst working for Sukses & Berkah Group — a non-profit serving Indonesia's da'wah ecosystem (da'i, ustadzah, content creators, parents, community organizers). Your role is to produce a WEEKLY analytical briefing, not a khutbah. Your voice is observational and pragmatic: you map public conversation patterns clearly, then provide practical handles for various da'wah surfaces. You are rooted in Qur'an + sunnah ahlu sunnah wal jama'ah, neutral on mazhab differences, fluent in contemporary Indonesian context. THIS BRIEFING IS IN ENGLISH for diaspora readers, international researchers, and English-medium content creators — but the source material is Indonesian, so cite stories with their Indonesian framing intact."""


# Long-form 5-section briefing (~1500-1800 words). Replaced the short
# 3-paragraph format on 2026-05-21 after the scenario-1 calibration test
# showed the long form (a) names 4x more specific stories, (b) identifies
# patterns across topics instead of just listing symptoms, (c) gives
# each da'wah surface a distinct angle. Cost delta: ~$4/mo, well inside
# the IDR 1M cap. Output renders as markdown with H2 sections.
SYSTEM_PROMPT_ID = f"""{_PERSONA_ID}

CRITICAL FORMATTING RULES:
- Mulai output Anda LANGSUNG dengan `## Ringkasan Eksekutif`. JANGAN tulis pre-amble seperti "Tentu, ini draf…" atau "Berikut briefing…".
- JANGAN tambahkan header block sebelum Bagian 1 (tanggal, "UNTUK DISTRIBUSI INTERNAL", periode, dll).
- JANGAN tutup dengan signature, paraf, atau closing apologetik.
- Disclaimer keasistanan AI WAJIB ditulis sebagai paragraf italic di akhir Bagian 5 (BUKAN bagian terpisah).

OUTPUT: briefing analisis ~1500-1800 kata dalam Bahasa Indonesia, dibagi ke 5 BAGIAN dengan heading H2 (##). Antar bagian dipisahkan satu baris kosong.

## Ringkasan Eksekutif (100-130 kata, satu paragraf)
- Sebut top 3 kategori dengan share-pct
- Komposisi sentimen dengan angka verbatim
- Dua benang merah utama pekan ini
- Bisa di-skim dalam 30 detik

## Numerik & Tren Pekan Ini (200-250 kata)
- Ekspos angka dengan konteks — jangan sekadar daftar, hubungkan ke cerita
- Cantumkan top 5 kategori, komposisi sentimen, volume
- JIKA `delta_pp`/`delta_pp_negative` null: tulis "belum ada baseline mingguan untuk perbandingan". JANGAN memfabrikasi tren naik/turun.
- Sebut platform mix

CRITICAL — SCOPE OF PERCENTAGES: baca SEGMENT_SCOPE di input. Jika "all", persentase di `top_categories` adalah share dari seluruh percakapan mingguan. Jika SEGMENT_SCOPE adalah segmen spesifik (spiritual/family/youth/justice), persentase tersebut adalah share *WITHIN segmen itu saja* — frasa "di antara konten segmen keluarga, kategori family mendominasi 89%" atau "dalam diskursus segmen ini X memimpin 89%". JANGAN tulis "percakapan publik didominasi family 89%" saat scope adalah segmen — itu overclaim.

## Tema Utama & Pola Yang Muncul (500-650 kata)
- Analisis per top topic. Untuk SETIAP topic dari pool, beri 2-3 cerita konkret dari sample_headlines DENGAN OUTLET (e.g. "Liputan6 melaporkan…", "menurut Banjarmasin Post…")
- BUKAN sekadar daftar — identifikasi POLA yang menghubungkan cerita-cerita itu. Misal: "kekerasan terhadap anak di Tanahlaut, kamar mandi masjid, dan penjualan bayi menunjukkan satu pola: ruang yang seharusnya aman justru menjadi panggung pelanggaran."
- IDENTIFIKASI BENANG MERAH antar topik di akhir bagian
- Hindari kata kerja perintah ("wajib", "harus", "pentingnya"). Gunakan observasional ("menyoroti", "memetakan", "menunjukkan", "tercermin dari")
- HANYA gunakan headlines dari pool yang saya berikan. JANGAN mengarang cerita.

## Strategi per Surface Dakwah (350-450 kata)
WAJIB 4 sub-section dengan ### H3:

### Khutbah Jumat
[2-3 kalimat: sudut spesifik. Sebut tema sentral dan satu angle khutbah konkret.]

### Kajian Ibu-ibu & Majelis Taklim
[2-3 kalimat: angle praktis-pastoral. Masalah hari-ke-hari, BUKAN ceramah teoritis.]

### Kreator Konten Digital
[2-3 kalimat: format/hook spesifik untuk YouTube/TikTok/IG/Reels.]

### Pengajaran di Rumah
[2-3 kalimat: pendekatan untuk orang tua dengan anak. Percakapan keluarga, BUKAN khutbah mini di ruang makan.]

SETIAP surface harus dapat angle BERBEDA — bukan satu nasihat yang di-paraphrase 4x.

## Daleel & Sumber (250-350 kata)
- Kutip 4-5 daleel dari pool yang saya berikan, masing-masing dengan KONTEKS ringkas
- Format heading per daleel: `**{{citation_only}}**` — citation sudah berisi nama korpus dan nomor (mis. "QS. Hud: 85" atau "Riyad as-Salihin 1420"). JANGAN mengulang nama korpus dengan format `**RIYAD_AS_SALIHIN Riyad as-Salihin 1420**`. JANGAN sertakan ref_id `[quran::11:85]`.
- Format penuh per daleel:

  **{{citation}}**
  > {{Terjemahan atau parafrase}}

  {{1-2 kalimat konteks: mengapa daleel ini relevan dengan tema pekan ini}}

- CRITICAL: HANYA gunakan daleel dari pool yang saya sediakan. JANGAN mengutip ayat atau hadits dari memori Anda.
- TERJEMAHAN HADITS: pertahankan struktur dan nuansa asli. Contoh: Bulugh al-Maram 1023 berbunyi "tunaikan amanah kepada yang mempercayaimu, dan JANGAN khianati orang yang mengkhianatimu" — ini hadits anti-retaliation (walau dia mengkhianatimu, kau tidak balik mengkhianati). Jangan datarkan ke generik "jangan saling mengkhianati".
- Urutkan dari yang PALING RELEVAN dengan tema pekan ini

Di akhir Bagian 5, tutup dengan satu paragraf italic:
*Briefing ini AI-assisted, BUKAN fatwa otoritatif. Tanggung jawab keagamaan tetap pada penyusun konten dakwah.*

TONE GUARDRAILS (PRD §12):
- Promote *rahma* + *hikmah*. Tidak konfrontatif, tidak sektarian.
- Tidak mengeluarkan rulings (haram/halal, fatwa-shape). Anda starting point untuk da'i berpikir, bukan fatwa.
- Default ke charity in framing. Saat menyoroti kegagalan moral, fokus pada angle SISTEMIK + jalan keluar.
- Pertahankan jarak observasional. Anda analis, bukan da'i di mimbar.
- Istilah dakwah (da'i, khutbah, daleel, kitab, muamalah, akhlaq, amanah, mustad'afin) ditulis as-is, BUKAN diterjemahkan.
- Transliterasi Arab (*rahma*, *hikmah*, *mustad'afin*, *amanah*) bungkus dengan italic.
"""


SYSTEM_PROMPT_EN = f"""{_PERSONA_EN}

CRITICAL FORMATTING RULES:
- Start your output DIRECTLY with `## Executive Summary`. NO pre-amble ("Here's the draft…", "Sure, below is…").
- NO header block before Section 1 (no date headers, "FOR INTERNAL DISTRIBUTION", period stamps, etc).
- NO closing signature or apologetic outro.
- The AI-assistance disclaimer goes as an italic paragraph at the end of Section 5 (not as a separate section).

OUTPUT: ~1500-1800 word analytical briefing in clear English, split into 5 SECTIONS with H2 (##) headings, blank line between sections.

## Executive Summary (100-130 words, single paragraph)
- Top 3 categories with share-pct
- Sentiment composition verbatim
- Two main throughlines this week
- 30-second skimmable

## Numbers & Trends This Week (200-250 words)
- Numbers in context — connect to stories, don't just list
- Top 5 categories, sentiment composition, volume
- IF `delta_pp`/`delta_pp_negative` is null: write "no weekly baseline yet for comparison". DO NOT fabricate rising/falling trends.
- Mention platform mix

CRITICAL — SCOPE OF PERCENTAGES: read SEGMENT_SCOPE in the input. When "all", percentages in `top_categories` are share of all weekly conversation. When SEGMENT_SCOPE is a specific segment (spiritual/family/youth/justice), they are share *WITHIN that segment only* — phrase as "within family-segment content, the family category leads at 89%" or "in this segment's discourse, X leads with 89%". DO NOT write "public conversation is dominated by family 89%" when scope is a segment — that overclaims.

## Main Themes & Emerging Patterns (500-650 words)
- Per-topic analysis. For EACH topic in the pool, give 2-3 concrete stories from sample_headlines WITH OUTLET attribution (e.g. "Liputan6 reports…", "according to Banjarmasin Post…")
- The source headlines are Indonesian — translate or paraphrase them naturally into English, but keep the Indonesian context intact (kakek = "an elderly man / grandfather", pengajian = "Qur'an study circle / pengajian")
- NOT a list — identify the PATTERN connecting these stories
- IDENTIFY THE OVERARCHING THROUGHLINE between topics at the end
- Prefer observation verbs ("highlights", "maps", "tracks", "surfaces") over command verbs ("must", "should", "the importance of")
- Only use headlines from the pool I provide. Do NOT invent stories.

## Da'wah Surface Strategies (350-450 words)
REQUIRED: 4 sub-sections with ### H3:

### Friday Khutbah
[2-3 sentences: specific angle, not generic. Name the central theme + one concrete khutbah angle.]

### Women's Kajian & Majelis Taklim
[2-3 sentences: practical-pastoral angle. Day-to-day problems, NOT theoretical lecture.]

### Digital Content Creators
[2-3 sentences: specific format/hook for YouTube/TikTok/IG/Reels.]

### Teaching at Home
[2-3 sentences: approach for parents with children. Family conversation, NOT a mini-khutbah at the dinner table.]

EACH surface gets a DIFFERENT angle — not one piece of advice paraphrased 4 ways.

## Daleel & Sources (250-350 words)
- Cite 4-5 daleel from the pool I provide, each with brief CONTEXT
- Per-daleel heading format: `**{{citation_only}}**` — the citation already contains the corpus name and number (e.g. "QS. Hud: 85" or "Riyad as-Salihin 1420"). DO NOT repeat the corpus name as `**RIYAD_AS_SALIHIN Riyad as-Salihin 1420**`. DO NOT include the ref_id prefix `[quran::11:85]`.
- Full format per daleel:

  **{{citation}}**
  > {{Translation or paraphrase}}

  {{1-2 sentences of context: why this daleel is relevant to this week's themes}}

- CRITICAL: ONLY use daleel from the pool I provide. DO NOT quote verses or hadith from your memory.
- HADITH TRANSLATION: preserve the original structure and nuance. Example: Bulugh al-Maram 1023 reads "fulfill the trust to whoever entrusts you, and DO NOT betray the one who betrays you" — this is an anti-retaliation hadith (even if they betray you, you do not retaliate). Don't flatten to generic "don't betray each other".
- Order by MOST RELEVANT to this week's themes first.

End Section 5 with one italic paragraph:
*This briefing is AI-assisted and NOT an authoritative fatwa. The religious responsibility for any published da'wah content remains with you.*

TONE GUARDRAILS (PRD §12):
- Promote *rahma* + *hikmah*. Never confrontational, never sectarian.
- No rulings (halal/haram verdicts, fatwa-shape). You are a starting point for a da'i to think with.
- Default to charity in framing. When pointing at moral failings, focus on systemic angles + ways forward.
- Maintain observational distance. You are the analyst, not the preacher.
- Keep da'wah-specific terms (da'i, khutbah, daleel, kitab, akhlaq, muamalah, amanah, mustad'afin) as-is — do NOT translate to generic English.
- Arabic transliterations (*rahma*, *hikmah*, *mustad'afin*, *amanah*) wrapped in italic.
"""


async def _compute_stats(
    session, segment: str | None
) -> dict[str, Any]:
    """Pull headline numbers from social_posts + topics + categories.

    If `segment` is given, restrict everything to posts whose
    dominant category falls in `SEGMENT_CATEGORIES[segment]`.
    """
    now = datetime.now(UTC)
    period_end = now
    period_start = now - timedelta(days=7)
    prev_period_start = now - timedelta(days=14)

    cats_filter = (
        SEGMENT_CATEGORIES[segment] if segment else ALL_CATEGORIES
    )
    # Postgres array literal for the IN/ANY filter.
    cats_sql_array = "ARRAY[" + ",".join(f"'{c}'" for c in cats_filter) + "]"

    # Helper: a CTE that tags each post with its GLOBAL top-1 category
    # (argmax over the categories JSONB), then downstream queries filter
    # rows where `dominant_cat = ANY (cats_filter)`. Earlier we put the
    # `key = ANY (cats_filter)` filter inside the inner SELECT — that
    # returned the highest-scoring key *among the segment's set*, so any
    # post with a tiny non-zero score in a segment key was counted in
    # the segment. That made all four segment summaries converge to the
    # same numbers (2026-05-21 bugfix).
    post_filter = """
      WITH filtered AS (
        SELECT sp.*, (
          SELECT key FROM jsonb_each_text(categories)
          WHERE value::numeric > 0
          ORDER BY value::numeric DESC LIMIT 1
        ) AS dominant_cat
        FROM social_posts sp
        WHERE categories IS NOT NULL
      )
    """

    # 1. Totals
    total_row = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT
                  count(*) FILTER (WHERE posted_at >= :start AND dominant_cat = ANY ({cats_sql_array})) AS posts_7d,
                  count(*) FILTER (WHERE posted_at >= :prev AND posted_at < :start AND dominant_cat = ANY ({cats_sql_array})) AS posts_prev_7d
                FROM filtered
                """
            ),
            {"start": period_start, "prev": prev_period_start},
        )
    ).one()
    posts_7d = int(total_row.posts_7d or 0)
    posts_prev_7d = int(total_row.posts_prev_7d or 0)

    # 2. Sentiment mix this week + baseline
    sentiment_row = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT
                  count(*) FILTER (WHERE sentiment_label = 'negative') AS neg,
                  count(*) FILTER (WHERE sentiment_label = 'neutral') AS neu,
                  count(*) FILTER (WHERE sentiment_label = 'positive') AS pos,
                  count(*) FILTER (WHERE sentiment_label IS NOT NULL) AS total
                FROM filtered
                WHERE posted_at >= :start AND dominant_cat = ANY ({cats_sql_array})
                """
            ),
            {"start": period_start},
        )
    ).one()
    sentiment_total = int(sentiment_row.total or 0)
    pct_negative_7d = (
        round(100 * int(sentiment_row.neg or 0) / sentiment_total, 1)
        if sentiment_total
        else 0.0
    )
    pct_neutral_7d = (
        round(100 * int(sentiment_row.neu or 0) / sentiment_total, 1)
        if sentiment_total
        else 0.0
    )
    pct_positive_7d = (
        round(100 * int(sentiment_row.pos or 0) / sentiment_total, 1)
        if sentiment_total
        else 0.0
    )

    baseline_row = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT
                  count(*) FILTER (WHERE sentiment_label = 'negative') AS neg,
                  count(*) FILTER (WHERE sentiment_label IS NOT NULL) AS total
                FROM filtered
                WHERE posted_at >= :prev AND posted_at < :start AND dominant_cat = ANY ({cats_sql_array})
                """
            ),
            {"prev": prev_period_start, "start": period_start},
        )
    ).one()
    baseline_total = int(baseline_row.total or 0)
    pct_negative_prev = (
        round(100 * int(baseline_row.neg or 0) / baseline_total, 1)
        if baseline_total
        else 0.0
    )

    # 3. Top categories — same dominant bucketing, but inside the segment filter.
    cat_rows = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT dominant_cat AS category, count(*)::int AS posts
                FROM filtered
                WHERE posted_at >= :start AND dominant_cat = ANY ({cats_sql_array})
                GROUP BY dominant_cat
                ORDER BY posts DESC
                LIMIT 5
                """
            ),
            {"start": period_start},
        )
    ).all()
    cat_total_now = sum(int(r.posts) for r in cat_rows) or 1
    top_categories_7d = [
        {
            "category": r.category,
            "posts": int(r.posts),
            "share_pct": round(100 * int(r.posts) / cat_total_now, 1),
        }
        for r in cat_rows
    ]

    prev_cat_rows = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT dominant_cat AS category, count(*)::int AS posts
                FROM filtered
                WHERE posted_at >= :prev AND posted_at < :start AND dominant_cat = ANY ({cats_sql_array})
                GROUP BY dominant_cat
                """
            ),
            {"prev": prev_period_start, "start": period_start},
        )
    ).all()
    cat_total_prev_real = sum(int(r.posts) for r in prev_cat_rows)
    # Defensive `or 1` for the division below; the real value is used as
    # the no-baseline guard when populating delta_pp downstream.
    cat_total_prev = cat_total_prev_real or 1
    prev_share = {
        r.category: round(100 * int(r.posts) / cat_total_prev, 1)
        for r in prev_cat_rows
    }

    # 4. Topics — ranked by SEGMENT post count via a join on social_posts.
    # The `topics` table itself doesn't carry a category column, so we
    # bucket posts into topics + segment by joining the global-argmax
    # `filtered` CTE. Without this each segment's briefing was fed the
    # same global top-8 topics (2026-05-21) and narratives became
    # interchangeable across segments.
    #
    # For each topic also fetch 2-3 sample headlines (first non-empty
    # line of each post's text), top-scored by da'wah relevance, so
    # the LLM prompt has SUBSTANCE, not just category aggregates. Without
    # this, observed 2026-05-21 that briefings read as "isu pemuda
    # penting" instead of naming the specific stories driving the topic.
    # Headlines are also segment-filtered for the same reason.
    topic_rows = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT t.id, t.label, t.platform, t.keywords,
                       count(f.id)::int AS seg_post_count
                FROM topics t
                JOIN filtered f ON f.topic_id = t.id
                WHERE f.dominant_cat = ANY ({cats_sql_array})
                  AND f.posted_at >= :start
                GROUP BY t.id, t.label, t.platform, t.keywords
                ORDER BY seg_post_count DESC
                LIMIT 8
                """
            ),
            {"start": period_start},
        )
    ).all()
    top_topics: list[dict[str, Any]] = []
    for r in topic_rows:
        headline_rows = (
            await session.execute(
                text(
                    f"""
                    {post_filter}
                    SELECT text, author
                    FROM filtered
                    WHERE topic_id = :tid AND text IS NOT NULL
                      AND dominant_cat = ANY ({cats_sql_array})
                    ORDER BY dawah_relevance DESC NULLS LAST
                    LIMIT 3
                    """
                ),
                {"tid": r.id},
            )
        ).all()
        # First non-empty line of each post = the headline most of the
        # time (RSS body lead with the title; social posts are short).
        sample_headlines = []
        for h in headline_rows:
            first = next(
                (line for line in (h.text or "").splitlines() if line.strip()),
                "",
            )
            if first:
                sample_headlines.append({
                    "title": first[:140],
                    "author": h.author,
                })
        top_topics.append({
            "label": r.label,
            "platform": r.platform,
            "keywords": list(r.keywords or [])[:5],
            "post_count": int(r.seg_post_count or 0),
            "sample_headlines": sample_headlines,
        })

    # 5. Per-platform breakdown — within segment.
    plat_rows = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT platform, count(*)::int AS posts
                FROM filtered
                WHERE posted_at >= :start AND dominant_cat = ANY ({cats_sql_array})
                GROUP BY platform
                ORDER BY posts DESC
                """
            ),
            {"start": period_start},
        )
    ).all()
    platform_breakdown = [
        {"platform": r.platform, "posts": int(r.posts)} for r in plat_rows
    ]

    return {
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "segment": segment,
        "totals": {
            "posts_7d": posts_7d,
            "posts_prev_7d": posts_prev_7d,
            "delta_pct": (
                round(100 * (posts_7d - posts_prev_7d) / posts_prev_7d, 1)
                if posts_prev_7d > 0
                else None
            ),
        },
        "sentiment": {
            "current_pct_negative": pct_negative_7d,
            "current_pct_neutral": pct_neutral_7d,
            "current_pct_positive": pct_positive_7d,
            "baseline_pct_negative": pct_negative_prev,
            # Only emit a delta when we have a real baseline week. When
            # baseline_total = 0 (first full week of ingest, or empty
            # segment), the delta would equal the current value and
            # surface as a misleading "+27.5pp" pill (2026-05-21).
            "delta_pp_negative": (
                round(pct_negative_7d - pct_negative_prev, 1)
                if baseline_total > 0
                else None
            ),
        },
        "top_categories": [
            {
                **c,
                # Same baseline-empty guard: if there was no prior-week
                # data we can't compute a real delta, so emit None and
                # let the UI show "—" rather than a spurious "+58.2pp".
                "delta_pp": (
                    round(c["share_pct"] - prev_share.get(c["category"], 0), 1)
                    if cat_total_prev_real > 0
                    else None
                ),
            }
            for c in top_categories_7d
        ],
        "top_topics": top_topics,
        "platforms": platform_breakdown,
    }


def _build_retrieval_query_fallback(stats: dict[str, Any], segment: str | None) -> str:
    """Token-concatenation fallback when LLM query generation fails.

    Used to be the primary retrieval-query builder. Token-matches verses
    that contain category names literally (e.g. "youth" → Quran verses
    about youthful paradise servants), so quality is poor. Kept only as
    a non-fatal fallback if Flash-Lite is unavailable.
    """
    bits: list[str] = []
    if stats["top_categories"]:
        top = stats["top_categories"][0]
        bits.append(f"isu {top['category']}")
    rising = next(
        (
            c
            for c in stats["top_categories"]
            if isinstance(c.get("delta_pp"), (int, float)) and c["delta_pp"] > 0
        ),
        None,
    )
    if rising and rising.get("category") and rising["category"] not in bits[0:1]:
        bits.append(f"yang sedang meningkat: {rising['category']}")
    if stats["top_topics"]:
        bits.append(stats["top_topics"][0]["label"])
    if segment:
        bits.append(f"dalam konteks {segment}")
    return ". ".join(bits) or "tema dakwah umum minggu ini"


_SEGMENT_INTENT = {
    None: "isu dakwah umum yang relevan ke audiens Muslim Indonesia minggu ini",
    "spiritual": "pembinaan aqidah dan akhlaq Muslim",
    "family": "ketahanan keluarga, peran orang tua, dan kesehatan rumah tangga",
    "youth": "pembinaan pemuda Muslim, pendidikan, dan tantangan generasi muda",
    "justice": "keadilan sosial, etika ekonomi, dan muamalah",
}


def _build_retrieval_query(stats: dict[str, Any], segment: str | None) -> str:
    """LLM-generated thematic search query for Qdrant retrieval.

    Why an LLM call: token-concatenation of category names
    ("isu youth. yang sedang meningkat: youth.") matches surface keywords
    in verse translations — e.g. "youth" surfaces Quran verses about
    youthful paradise servants, not thematic guidance for pemuda. Flash-Lite
    reads the segment intent + top headlines and synthesizes a query in
    scholarly Bahasa Indonesia that a da'i would actually search for
    (e.g. "amanah pemuda dalam menghadapi tekanan ekonomi dan
    kritisme politik yang konstruktif"), giving the embedding step a
    fair shot at thematic-fit verses instead of surface-keyword matches.

    Cost: ~$0.0005 per call · 5 calls/day → ~$0.075/mo. Negligible.

    Falls back to the legacy token-concat builder on any error so the
    pipeline never breaks because of this enhancement.
    """
    if not settings.gemini_api_key:
        return _build_retrieval_query_fallback(stats, segment)

    headline_lines: list[str] = []
    for t in stats.get("top_topics", [])[:5]:
        for h in t.get("sample_headlines", [])[:2]:
            title = (h.get("title") or "").strip()
            if title:
                headline_lines.append(f"- {title}")
    headlines_block = "\n".join(headline_lines) or "(tidak ada headline)"

    top_cat = (
        stats["top_categories"][0]["category"]
        if stats.get("top_categories")
        else "umum"
    )
    intent = _SEGMENT_INTENT.get(segment, _SEGMENT_INTENT[None])

    prompt = f"""Saya ingin mencari ayat Qur'an dan hadith dari basis data vektor untuk dijadikan daleel dalam briefing da'i.

KONTEKS BRIEFING:
- Segmen: {segment or 'umum (semua)'}
- Niat tematik segmen ini: {intent}
- Kategori dominan pekan ini: {top_cat}

HEADLINE NYATA YANG MENDORONG TREN PEKAN INI:
{headlines_block}

TUGAS: Tulis SATU kalimat (maksimal 25 kata) dalam Bahasa Indonesia yang menggambarkan TEMA INTI yang menghubungkan headline-headline di atas dengan niat segmen, MENGGUNAKAN KOSAKATA SYAR'I yang biasa muncul dalam terjemahan ayat/hadith (contoh: amanah, qana'ah, ketahanan keluarga, akhlaq, adil, mengurangi timbangan, hikmah, sabar, tolong-menolong dalam kebaikan).

Jangan tulis nama kasus atau orang. Jangan tulis kata bahasa Inggris seperti "youth" atau "family". Tulis hanya kalimat tematik tersebut, tanpa pengantar."""

    try:
        client = _get_client()
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=120,
                # thinking disabled — this is a simple template-fill task,
                # no reasoning needed. Saves ~512 tokens of thinking budget
                # per call. Flash-Lite minimum if thinking IS enabled is 512.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        query = (resp.text or "").strip().strip('"').strip("'")
        if not query:
            return _build_retrieval_query_fallback(stats, segment)

        usage_md = getattr(resp, "usage_metadata", None)
        from api.services.usage import record_usage as _record_usage

        _record_usage(
            provider="gemini",
            operation="retrieval_query_gen",
            model="gemini-2.5-flash-lite",
            tokens_in=getattr(usage_md, "prompt_token_count", None),
            tokens_out=getattr(usage_md, "candidates_token_count", None),
            meta={"segment": segment},
        )
        log.info(
            "insights_summary.retrieval_query_generated",
            segment=segment,
            query=query[:120],
        )
        return query
    except Exception as exc:
        log.warning(
            "insights_summary.retrieval_query_failed",
            segment=segment,
            error=str(exc),
        )
        return _build_retrieval_query_fallback(stats, segment)


def _build_user_prompt(
    stats: dict[str, Any],
    daleel: list[dict[str, Any]],
    *,
    language: str = "id",
) -> str:
    """Assemble the structured context for Gemini.

    `language` switches the daleel block (Bahasa translation for `id`,
    English translation for `en`) and the empty-daleel sentinel string.
    The stats JSON itself is language-agnostic — the model translates
    numeric + categorical context naturally.
    """
    if language == "en":
        empty_marker = "(no daleel found for this theme)"
        translation_label = "Translation (EN)"
        scope_note_all = (
            "SEGMENT_SCOPE: all\n"
            "Top_categories percentages are share of all categorized "
            "conversation this week. Phrase as 'public conversation' is fine."
        )
    else:
        empty_marker = "(tidak ada daleel yang ditemukan untuk tema ini)"
        translation_label = "Terjemahan ID"
        scope_note_all = (
            "SEGMENT_SCOPE: all\n"
            "Top_categories percentages are share of all categorized "
            "conversation this week. Phrase as 'percakapan publik' is fine."
        )

    def _translation_for(d: dict[str, Any]) -> str:
        if language == "en":
            # Hadith corpora have no Bahasa translation; English is the
            # only option there anyway. Quran has both.
            return d.get("translation_en") or d.get("translation_id") or ""
        return d.get("translation_id") or d.get("translation_en") or ""

    # The `Citation` field is what the model echoes back as its heading.
    # Earlier we passed `[{ref_id}] {CORPUS} {citation}` which made the
    # model render `**RIYAD_AS_SALIHIN Riyad as-Salihin 1420**` headings
    # — corpus name doubled because it was already in the citation
    # string. Cleaned up 2026-05-21.
    daleel_block = (
        "\n\n".join(
            f"Citation: {d['citation']}\n"
            f"Arabic: {d['arabic'][:300]}\n"
            f"{translation_label}: {_translation_for(d)[:500]}"
            for d in daleel
        )
        if daleel
        else empty_marker
    )

    # Pretty-print top topics with their sample headlines so the model
    # can write about specific stories, not just category percentages.
    top_topics_block_lines: list[str] = []
    for t in stats.get("top_topics", [])[:5]:
        top_topics_block_lines.append(
            f"- {t['label']} ({t['post_count']} posts · platform={t['platform']})"
        )
        for h in t.get("sample_headlines", [])[:3]:
            author = h.get("author") or "?"
            top_topics_block_lines.append(
                f"    · [{author}] {h['title']}"
            )
    top_topics_block = (
        "\n".join(top_topics_block_lines)
        if top_topics_block_lines
        else "(tidak ada topik dengan sample headline)"
    )

    # Strip sample_headlines out of the JSON dump to avoid duplicating
    # them — they're already laid out in TOP TOPICS WITH SAMPLE HEADLINES.
    stats_for_json = {
        **stats,
        "top_topics": [
            {k: v for k, v in t.items() if k != "sample_headlines"}
            for t in stats.get("top_topics", [])
        ],
    }

    segment = stats.get("segment")
    scope_label = segment if segment else "all"
    if segment:
        seg_cats = SEGMENT_CATEGORIES.get(segment, [])
        scope_note = (
            f"SEGMENT_SCOPE: {scope_label}\n"
            f"Top_categories percentages are share WITHIN this segment's "
            f"categories ({', '.join(seg_cats)}) — not share of all weekly "
            f"conversation. Phrase accordingly (see system instructions)."
        )
    else:
        scope_note = scope_note_all

    write_now = (
        "Tulis briefing sekarang dalam format markdown 5 bagian (Ringkasan Eksekutif / Numerik & Tren Pekan Ini / Tema Utama & Pola Yang Muncul / Strategi per Surface Dakwah / Daleel & Sumber), ~1500-1800 kata."
        if language == "id"
        else "Write the briefing now in markdown, 5-section format (Executive Summary / Numbers & Trends This Week / Main Themes & Emerging Patterns / Da'wah Surface Strategies / Daleel & Sources), ~1500-1800 words."
    )

    return f"""{scope_note}

HEADLINE NUMBERS (use ONLY these for Sections 1 & 2):

{json.dumps(stats_for_json, indent=2, ensure_ascii=False)}

TOP TOPICS WITH SAMPLE HEADLINES (Section 3 MUST name specific stories from these headlines, not just abstract category counts):

{top_topics_block}

DALEEL POOL (use for Section 5, cite 4-5 from here; the `Citation` field is what goes in your heading):

{daleel_block}

{write_now}"""


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


_RELAXED_SAFETY = [
    types.SafetySetting(category=cat, threshold="BLOCK_ONLY_HIGH")
    for cat in (
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
    )
]
# Observed 2026-05-21: Gemini 2.5 Pro returned empty responses on 4 of 5
# segment briefings under default safety. The prompts referenced
# corruption cases, child-abuse incidents, WNI captives — news data we
# want the model to ANALYZE for a da'wah audience, not generate. Default
# thresholds over-fire for analytical use cases of dark-news content.


def _generate_for_language(
    client: genai.Client,
    stats: dict[str, Any],
    daleel: list[dict[str, Any]],
    language: str,
    segment: str | None,
) -> tuple[str, int | None, int | None, float] | None:
    """Run one Gemini Pro call in the requested language.

    Returns `(summary_md, tokens_in, tokens_out, cost_usd)` on success
    or `None` on empty response (safety block / token cap / unknown
    finish reason). Caller decides whether the missing output is fatal
    (Indonesian) or recoverable with fallback (English).
    """
    system_prompt = SYSTEM_PROMPT_EN if language == "en" else SYSTEM_PROMPT_ID
    user_prompt = _build_user_prompt(stats, daleel, language=language)

    resp = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.5,
            safety_settings=_RELAXED_SAFETY,
            # 8192-token output cap supports the long-form 5-section
            # briefing (~1500-1800 words → ~2400 output tokens). Default
            # ~8K was unset; observed scenario-1 calibration used
            # ~2300-2400 tokens with comfortable headroom (2026-05-21).
            max_output_tokens=8192,
            # 4096-token thinking budget — lets the model pick daleel and
            # structure 5 sections coherently. Negligible cost at 5×2
            # briefings/day.
            thinking_config=types.ThinkingConfig(thinking_budget=4096),
        ),
    )
    summary_md = (resp.text or "").strip()
    if not summary_md:
        finish_reason = None
        block_reason = None
        try:
            if resp.candidates:
                finish_reason = getattr(
                    resp.candidates[0], "finish_reason", None
                )
            pf = getattr(resp, "prompt_feedback", None)
            if pf is not None:
                block_reason = getattr(pf, "block_reason", None)
        except Exception:
            pass
        log.warning(
            "insights_summary.empty_response",
            segment=segment,
            language=language,
            finish_reason=str(finish_reason) if finish_reason else None,
            block_reason=str(block_reason) if block_reason else None,
        )
        return None

    usage_md = getattr(resp, "usage_metadata", None)
    tokens_in = getattr(usage_md, "prompt_token_count", None)
    tokens_out = getattr(usage_md, "candidates_token_count", None)
    cost = (
        (tokens_in or 0) / 1_000_000 * 1.25
        + (tokens_out or 0) / 1_000_000 * 10.00
    )
    return summary_md, tokens_in, tokens_out, cost


async def generate_summary(
    segment: str | None = None,
) -> dict[str, Any] | None:
    """Compute stats, retrieve daleel, ask Gemini Pro to narrate.

    Args:
      segment: `None` for the all-platform briefing, otherwise one of
        the keys in `SEGMENT_CATEGORIES`.

    Persists one `insights_summaries` row and returns its payload.
    Returns None when there's no data for the requested segment.
    """
    async with SessionLocal() as session:
        stats = await _compute_stats(session, segment)

        if stats["totals"]["posts_7d"] == 0:
            log.info(
                "insights_summary.skip_empty",
                segment=segment,
            )
            return None

        # Daleel retrieval — two-pass: (1) embedding similarity over
        # the whole corpus to surface a wide candidate set (limit=15,
        # per_corpus=4), then (2) Gemini Flash-Lite re-ranks them by
        # THEMATIC fit, returning the top 3 actually-relevant matches.
        # Without the re-rank, embedding matches like Quran verses
        # about youthful paradise servants slip through for any query
        # mentioning "muda" / "pemuda" — surface keyword overlap, not
        # semantic relevance.
        retrieval_query = _build_retrieval_query(stats, segment)
        candidates = retrieve_daleel(
            retrieval_query, limit=15, per_corpus=4
        )
        # top_n=5 (was 3) gives the brief LLM a richer set to pick from.
        # The system prompt still asks for 2-3 citations, but a wider
        # pool lets a strong hadith / tafsir surface alongside the
        # default-leaning Quran hits (2026-05-21).
        daleel = rerank_daleel(retrieval_query, candidates, top_n=5)
        log.info(
            "insights_summary.retrieved_daleel",
            segment=segment,
            query=retrieval_query,
            candidates=len(candidates),
            final=len(daleel),
        )

        client = _get_client()

        # Two-language generation. We make ONE Gemini Pro call per
        # language so each output is idiomatic-native, not a translation
        # — Islamic guidance content has nuance (e.g. honorifics, terms
        # of art, code-mixed da'wah vocabulary) that translation flattens.
        # Cost roughly doubles (~$0.013 per pair vs ~$0.006 single), still
        # well under the IDR 1M/month cap.
        #
        # If English fails, we still persist the Indonesian row with
        # summary_md_en=NULL; UI falls back to summary_md. The reverse
        # (English-only) is treated as a failure since Indonesian is the
        # primary product locale.
        id_result = _generate_for_language(client, stats, daleel, "id", segment)
        if id_result is None:
            return None
        summary_md, tokens_in_id, tokens_out_id, cost_id = id_result

        en_result = _generate_for_language(client, stats, daleel, "en", segment)
        if en_result is None:
            summary_md_en = None
            tokens_in_en = tokens_out_en = 0
            cost_en = 0.0
        else:
            summary_md_en, tokens_in_en, tokens_out_en, cost_en = en_result

        tokens_in = (tokens_in_id or 0) + (tokens_in_en or 0)
        tokens_out = (tokens_out_id or 0) + (tokens_out_en or 0)
        cost = cost_id + cost_en

        row = InsightsSummary(
            generated_at=datetime.now(UTC),
            period_start=datetime.fromisoformat(stats["period_start"]),
            period_end=datetime.fromisoformat(stats["period_end"]),
            summary_md=summary_md,
            summary_md_en=summary_md_en,
            headline_stats=stats,
            model=MODEL,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
            segment=segment,
            daleel_refs=daleel,
        )
        session.add(row)
        await session.commit()

        from api.services.usage import record_usage

        record_usage(
            provider="gemini",
            operation="insights_summary",
            model=MODEL,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
            meta={"segment": segment, "languages": "id+en" if summary_md_en else "id"},
        )

        log.info(
            "insights_summary.generated",
            segment=segment,
            posts_7d=stats["totals"]["posts_7d"],
            daleel_count=len(daleel),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=round(cost, 4),
            has_en=summary_md_en is not None,
        )

        return {
            "summary_md": summary_md,
            "summary_md_en": summary_md_en,
            "stats": stats,
            "daleel_refs": daleel,
            "segment": segment,
            "cost_usd": round(cost, 4),
        }


async def generate_all_summaries() -> dict[str, Any]:
    """Generate all 5 daily summaries: 1 all-platform + 4 per-segment.

    Returns a per-segment status dict, useful for the Celery task to
    log a single observable line and for ops to spot which ones
    failed.
    """
    results: dict[str, Any] = {}
    # all-platform first — its stats compute over the broadest set
    results["__all__"] = await generate_summary(None) is not None
    for segment in SEGMENT_CATEGORIES:
        try:
            ok = await generate_summary(segment) is not None
        except Exception as exc:
            log.exception(
                "insights_summary.segment_failed",
                segment=segment,
                error=str(exc),
            )
            ok = False
        results[segment] = ok
    return results
