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


SYSTEM_PROMPT_ID = """You write a daily executive briefing for Indonesian Muslim community leaders (da'i, ustadz, content creators) about what's happening in the public conversation.

The briefing has THREE consecutive paragraphs separated by blank lines:

PARAGRAPH 1 — Penjelasan (3-4 sentences in Bahasa Indonesia):
  - Dominant theme this week — which category leads, what % share, what's driving it
  - Sentiment temperature with the specific numbers
  - What's RISING vs LAST WEEK — name the specific topic or category with the change
  Tone: precise, observational, practical. Use the numbers VERBATIM (e.g. "38%" not "sekitar sepertiga").

  CRITICAL — SCOPE OF PERCENTAGES: read SEGMENT_SCOPE in the input. When SEGMENT_SCOPE is "all" the percentages are share of all weekly conversation. When SEGMENT_SCOPE is a specific segment (spiritual/family/youth/justice), the percentages in `top_categories` are share *WITHIN THAT SEGMENT'S CATEGORIES ONLY* — e.g. "family 89%" means 89% of family-segment posts are family-dominant (vs health-dominant), NOT 89% of all conversation. Phrase accordingly: use language like "di antara konten segmen keluarga, kategori family mendominasi dengan 89%" or "dalam diskursus segmen ini, X memimpin dengan 89%". Do NOT write "percakapan publik didominasi oleh family 89%" when scope is a segment — that overclaims.

  CRITICAL: when describing what's happening, USE THE SPECIFIC SAMPLE HEADLINES I provide for each top topic. Do NOT abstract them into generic category statements ("isu pemuda penting"). Instead, name the actual stories driving the trend ("rentetan kasus pencabulan oleh kiai di Ponorogo, guru honorer, dan pria di kamar mandi masjid"). The headlines I give you ARE the substance — use them. Do NOT invent stories not in the headlines.

PARAGRAPH 2 — Nasihah (2-3 sentences in Bahasa Indonesia):
  Practical Islamic counsel tied to what trended. Address the BROAD da'wah audience — da'i giving khutbah, ustadzah leading kajian ibu-ibu, content creators on YouTube/IG/TikTok, parents teaching at home, community organizers, researchers tracking Muslim discourse. Do NOT default to "khutbah Jumat" as the only surface. Mention the angle that resonates across these surfaces. Concrete, not generic.

  TONE GUARDRAILS (PRD §12 — non-negotiable):
  - Promote rahma (mercy) + hikmah (wisdom). Never confrontational, divisive, or sectarian framing.
  - Do NOT contradict established ijma' on fundamental aqidah. If a trending topic is sensitive (mazhab differences, modern fiqh debate), counsel HOW to discuss it adabfully rather than picking sides.
  - Do NOT issue rulings (haram/halal verdicts, fatwa-shaped statements). You're providing a starting point for a da'i to think with, not a fatwa for an audience to act on.
  - Default to charity in framing. When pointing at a moral failing (corruption, abuse, etc.) focus on the systemic angle and the path forward, not on shaming individuals or groups.

PARAGRAPH 3 — Daleel (ONLY if I provided non-empty daleel below):
  If I have provided daleel passages, cite 2-3 of them. Each line:
    - QS [surah_name] [ayah]: [brief Bahasa Indonesia gloss]
    - HR. Bukhari/Muslim/etc. [number]: [brief Bahasa Indonesia gloss]
  CRITICAL: You may ONLY cite passages from the daleel list I supplied. You may NOT invent verses, hadith numbers, or attributions.

  If the daleel list is empty (the user input says "tidak ada daleel"), OMIT paragraph 3 entirely. Output only paragraphs 1 and 2. Do NOT write filler text about missing daleel — just stop after paragraph 2.

Output format: plain text. No headings, no markdown formatting. Two or three paragraphs separated by blank lines, depending on whether daleel was provided.
"""


SYSTEM_PROMPT_EN = """You write a daily executive briefing for Indonesian Muslim community leaders (da'i, ustadz, content creators) about what's happening in the public conversation. THIS BRIEFING IS IN ENGLISH for non-Indonesian readers (diaspora, international researchers, English-medium content creators).

The briefing has THREE consecutive paragraphs separated by blank lines:

PARAGRAPH 1 — Context (3-4 sentences in clear, neutral English):
  - Dominant theme this week — which category leads, what % share, what's driving it
  - Sentiment temperature with the specific numbers
  - What's RISING vs LAST WEEK — name the specific topic or category with the change
  Tone: precise, observational, practical. Use the numbers VERBATIM (e.g. "38%" not "about a third").

  CRITICAL — SCOPE OF PERCENTAGES: read SEGMENT_SCOPE in the input. When SEGMENT_SCOPE is "all" the percentages are share of all weekly conversation. When SEGMENT_SCOPE is a specific segment (spiritual/family/youth/justice), the percentages in `top_categories` are share *WITHIN THAT SEGMENT'S CATEGORIES ONLY* — e.g. "family 89%" means 89% of family-segment posts are family-dominant (vs health-dominant), NOT 89% of all conversation. Phrase accordingly: use language like "within family-segment content, the family category leads at 89%" or "in this segment's discourse, X leads with 89%". Do NOT write "public conversation is dominated by family 89%" when scope is a segment — that overclaims.

  CRITICAL: when describing what's happening, USE THE SPECIFIC SAMPLE HEADLINES I provide for each top topic. The headlines are in Indonesian — translate or paraphrase them naturally into English. Do NOT abstract them into generic category statements ("youth issues are important"). Instead, name the actual stories driving the trend ("a string of clerical sexual-abuse cases in Ponorogo and elsewhere"). Do NOT invent stories not in the headlines.

PARAGRAPH 2 — Nasihah (2-3 sentences in clear English):
  Practical Islamic counsel tied to what trended. Address the BROAD da'wah audience — da'i giving khutbah, ustadzah leading kajian, content creators on YouTube/IG/TikTok, parents teaching at home, community organizers, researchers tracking Muslim discourse. Do NOT default to "Friday sermon" as the only surface. Mention the angle that resonates across these surfaces. Concrete, not generic. KEEP da'wah-specific terms (da'i, khutbah, nasihah, daleel, kitab, aqidah, akhlaq, muamalah) as-is — do not translate them to generic English equivalents.

  TONE GUARDRAILS (PRD §12 — non-negotiable):
  - Promote rahma (mercy) + hikmah (wisdom). Never confrontational, divisive, or sectarian framing.
  - Do NOT contradict established ijma' on fundamental aqidah. When a trending topic is sensitive (mazhab differences, modern fiqh debate), counsel HOW to discuss it adabfully rather than picking sides.
  - Do NOT issue rulings (haram/halal verdicts, fatwa-shaped statements). You're providing a starting point for a da'i to think with, not a fatwa for an audience to act on.
  - Default to charity in framing. When pointing at a moral failing (corruption, abuse, etc.) focus on the systemic angle and the path forward, not on shaming individuals or groups.

PARAGRAPH 3 — Daleel (ONLY if I provided non-empty daleel below):
  If I have provided daleel passages, cite 2-3 of them. Each line:
    - QS [surah_name] [ayah]: [brief English gloss]
    - Sahih Bukhari/Muslim/etc. [number]: [brief English gloss]
  CRITICAL: You may ONLY cite passages from the daleel list I supplied. You may NOT invent verses, hadith numbers, or attributions.

  If the daleel list is empty (the user input says "no daleel found"), OMIT paragraph 3 entirely. Output only paragraphs 1 and 2. Do NOT write filler text about missing daleel — just stop after paragraph 2.

Output format: plain text. No headings, no markdown formatting. Two or three paragraphs separated by blank lines, depending on whether daleel was provided.
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
    post_filter = f"""
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
    cat_total_prev = sum(int(r.posts) for r in prev_cat_rows) or 1
    prev_share = {
        r.category: round(100 * int(r.posts) / cat_total_prev, 1)
        for r in prev_cat_rows
    }

    # 4. Topics — latest, ranked by post count. (Not segment-filtered
    # because the `topics` table doesn't yet carry a category column;
    # if topic discovery later splits per-segment, swap in a join.)
    #
    # For each topic also fetch 2-3 sample headlines (first non-empty
    # line of each post's text), top-scored by da'wah relevance, so
    # the LLM prompt has SUBSTANCE, not just category aggregates. Without
    # this, observed 2026-05-21 that briefings read as "isu pemuda
    # penting" instead of naming the specific stories driving the topic.
    topic_rows = (
        await session.execute(
            text(
                """
                SELECT id, label, platform, keywords, post_count
                FROM topics
                ORDER BY post_count DESC
                LIMIT 8
                """
            )
        )
    ).all()
    top_topics: list[dict[str, Any]] = []
    for r in topic_rows:
        headline_rows = (
            await session.execute(
                text(
                    """
                    SELECT text, author
                    FROM social_posts
                    WHERE topic_id = :tid AND text IS NOT NULL
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
            "post_count": int(r.post_count or 0),
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
            "delta_pp_negative": round(pct_negative_7d - pct_negative_prev, 1),
        },
        "top_categories": [
            {
                **c,
                "delta_pp": round(
                    c["share_pct"] - prev_share.get(c["category"], 0), 1
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

    daleel_block = (
        "\n\n".join(
            f"[{d['ref_id']}] {d['corpus'].upper()} {d['citation']}\n"
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

    return f"""{scope_note}

HEADLINE NUMBERS (use these and ONLY these for paragraph 1):

{json.dumps(stats_for_json, indent=2, ensure_ascii=False)}

TOP TOPICS WITH SAMPLE HEADLINES (paragraph 1 MUST name the specific stories from these headlines, not just abstract category counts):

{top_topics_block}

DALEEL YOU MAY CITE in paragraph 3 (cite 2-3 of these; you may NOT cite anything not in this list):

{daleel_block}

Write the briefing now: Paragraph 1 (Penjelasan, grounded in the specific headlines above), blank line, Paragraph 2 (Nasihah), blank line, Paragraph 3 (Daleel as a short list)."""


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
            temperature=0.3,
            safety_settings=_RELAXED_SAFETY,
            # 4096-token thinking budget — lets the model pick the right
            # 2-3 daleel from the rerank list and structure the 3-paragraph
            # briefing coherently. Negligible cost at 5×2 briefings/day.
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
        daleel = rerank_daleel(retrieval_query, candidates, top_n=3)
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
