"""Daily executive briefing for the public /insights page.

Computes headline numbers from the past 7 days vs the prior 7 days,
hands the structured data to Gemini 2.5 Pro, asks for a 3–5 sentence
narrative in Bahasa Indonesia citing those exact numbers. Persists one
`insights_summaries` row per generation.

Run cadence: daily 04:30 WIB via Celery beat — chosen to land just
after the 04:00 Gemini topic-discovery pass so the LLM sees fresh
theme labels.

Cost: ~$0.05–0.10 per generation on `gemini-2.5-pro`. The numeric
heavy lifting is done in SQL; the LLM is purely narration. Numbers
in the narrative are grounded in the corpus — Gemini is instructed
to use ONLY the supplied stats, never invent.
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

log = structlog.get_logger()

MODEL = "gemini-2.5-pro"


SYSTEM_PROMPT = """You write a daily executive briefing for Indonesian Muslim community leaders (da'i, ustadz, content creators) about what's happening in the public conversation.

Your tone: precise, observational, practical. NOT marketing-speak, NOT vague generalities. Every claim must be supported by the numbers I give you.

Output: 3–5 sentences in Bahasa Indonesia. Plain text — no headings, no bullets, no markdown formatting. About 60–100 words total.

Structure the briefing roughly as:
  1. ONE sentence on the dominant theme this week (which category leads, what % share, what's driving it if obvious from topic labels).
  2. ONE sentence on sentiment temperature (e.g., "Mood lebih gelap dari biasanya" with the specific numbers).
  3. ONE sentence on what's RISING vs LAST WEEK — name the specific topic or category, with the change.
  4. OPTIONAL: ONE sentence noting any platform-specific signal worth attention.
  5. Close with ONE practical takeaway for a da'i — what angle would resonate for a Friday khutbah, kajian, or social post this week. Concrete, not generic.

Rules:
  - Use the numbers I provide. Do not invent or round vaguely. "38%" not "sekitar sepertiga".
  - Topic + category names: use them verbatim as labels (don't translate them or paraphrase).
  - If a number is unavailable or zero, do not mention it. Don't fill with filler.
  - DO NOT use phrases like "the data shows", "according to our analysis", "this week's data". Just state the facts.
  - DO NOT make up topic labels or events. Only reference items that appear in the stats."""


async def _compute_stats(session) -> dict[str, Any]:
    """Pull headline numbers from social_posts + topics + categories.
    Returns the dict that becomes `headline_stats` in the DB row AND
    feeds the LLM prompt.

    All numbers are computed against the last 7 days vs the prior 7
    days (days 8-14 back) for the WoW comparison.
    """
    now = datetime.now(UTC)
    period_end = now
    period_start = now - timedelta(days=7)
    prev_period_start = now - timedelta(days=14)

    # 1. Totals
    total_row = (
        await session.execute(
            text(
                """
                SELECT
                  count(*) FILTER (WHERE posted_at >= :start) AS posts_7d,
                  count(*) FILTER (WHERE posted_at >= :prev AND posted_at < :start) AS posts_prev_7d
                FROM social_posts
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
                """
                SELECT
                  count(*) FILTER (WHERE sentiment_label = 'negative') AS neg,
                  count(*) FILTER (WHERE sentiment_label = 'neutral') AS neu,
                  count(*) FILTER (WHERE sentiment_label = 'positive') AS pos,
                  count(*) FILTER (WHERE sentiment_label IS NOT NULL) AS total
                FROM social_posts
                WHERE posted_at >= :start
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

    # Baseline = the prior 7 days, for delta computation
    baseline_row = (
        await session.execute(
            text(
                """
                SELECT
                  count(*) FILTER (WHERE sentiment_label = 'negative') AS neg,
                  count(*) FILTER (WHERE sentiment_label IS NOT NULL) AS total
                FROM social_posts
                WHERE posted_at >= :prev AND posted_at < :start
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

    # 3. Top categories — dominant category bucketing
    cat_rows = (
        await session.execute(
            text(
                """
                SELECT dominant AS category, count(*)::int AS posts
                FROM (
                  SELECT (
                    SELECT key FROM jsonb_each_text(categories)
                    WHERE key = ANY (ARRAY[
                      'aqidah','akhlaq','muamalah','social_justice','family',
                      'youth','education','economic_ethics','health'
                    ])
                    ORDER BY value::numeric DESC LIMIT 1
                  ) AS dominant
                  FROM social_posts
                  WHERE posted_at >= :start AND categories IS NOT NULL
                ) sub
                WHERE dominant IS NOT NULL
                GROUP BY dominant
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

    # Same for the prior week — so we can compute delta_pp on the
    # leader.
    prev_cat_rows = (
        await session.execute(
            text(
                """
                SELECT dominant AS category, count(*)::int AS posts
                FROM (
                  SELECT (
                    SELECT key FROM jsonb_each_text(categories)
                    WHERE key = ANY (ARRAY[
                      'aqidah','akhlaq','muamalah','social_justice','family',
                      'youth','education','economic_ethics','health'
                    ])
                    ORDER BY value::numeric DESC LIMIT 1
                  ) AS dominant
                  FROM social_posts
                  WHERE posted_at >= :prev AND posted_at < :start
                    AND categories IS NOT NULL
                ) sub
                WHERE dominant IS NOT NULL
                GROUP BY dominant
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

    # 4. Topics — latest from topic_discovery
    topic_rows = (
        await session.execute(
            text(
                """
                SELECT label, platform, keywords, post_count
                FROM topics
                ORDER BY post_count DESC
                LIMIT 8
                """
            )
        )
    ).all()
    top_topics = [
        {
            "label": r.label,
            "platform": r.platform,
            "keywords": list(r.keywords or [])[:5],
            "post_count": int(r.post_count or 0),
        }
        for r in topic_rows
    ]

    # 5. Per-platform breakdown
    plat_rows = (
        await session.execute(
            text(
                """
                SELECT platform, count(*)::int AS posts
                FROM social_posts
                WHERE posted_at >= :start
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
                "delta_pp": round(c["share_pct"] - prev_share.get(c["category"], 0), 1),
            }
            for c in top_categories_7d
        ],
        "top_topics": top_topics,
        "platforms": platform_breakdown,
    }


def _build_user_prompt(stats: dict[str, Any]) -> str:
    """Format the stats as a tight JSON-ish block for the LLM."""
    return f"""Here are the headline numbers from the past 7 days. Use these and ONLY these as the basis for the briefing.

{json.dumps(stats, indent=2, ensure_ascii=False)}

Write the briefing now (3–5 sentences, Bahasa Indonesia, plain text)."""


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


async def generate_summary() -> dict[str, Any] | None:
    """Compute stats, ask Gemini Pro to narrate, persist a row.

    Returns the inserted row's payload, or None on no-data conditions
    (e.g., empty social_posts).
    """
    async with SessionLocal() as session:
        stats = await _compute_stats(session)

        if stats["totals"]["posts_7d"] == 0:
            log.info("insights_summary.skip_empty_corpus")
            return None

        client = _get_client()
        user_prompt = _build_user_prompt(stats)

        resp = client.models.generate_content(
            model=MODEL,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.3,
                max_output_tokens=600,
            ),
        )
        summary_md = (resp.text or "").strip()
        if not summary_md:
            log.warning("insights_summary.empty_response")
            return None

        usage_md = getattr(resp, "usage_metadata", None)
        tokens_in = getattr(usage_md, "prompt_token_count", None)
        tokens_out = getattr(usage_md, "candidates_token_count", None)
        # Gemini 2.5 Pro pricing: $1.25/1M in, $10.00/1M out
        cost = (
            (tokens_in or 0) / 1_000_000 * 1.25
            + (tokens_out or 0) / 1_000_000 * 10.00
        )

        # Persist via the model.
        row = InsightsSummary(
            generated_at=datetime.now(UTC),
            period_start=datetime.fromisoformat(stats["period_start"]),
            period_end=datetime.fromisoformat(stats["period_end"]),
            summary_md=summary_md,
            headline_stats=stats,
            model=MODEL,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
        )
        session.add(row)
        await session.commit()

        # Mirror to usage_events for the cost dashboard.
        from api.services.usage import record_usage

        record_usage(
            provider="gemini",
            operation="insights_summary",
            model=MODEL,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
        )

        log.info(
            "insights_summary.generated",
            posts_7d=stats["totals"]["posts_7d"],
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=round(cost, 4),
        )

        return {
            "summary_md": summary_md,
            "stats": stats,
            "cost_usd": round(cost, 4),
        }
