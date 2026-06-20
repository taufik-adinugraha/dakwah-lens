"""Trending-headlines fetcher for the 15th-track Islamic-calendar
briefings.

Occasion briefings can attach a small pool of last-7d headlines as
``BERITA PENDUKUNG`` — supporting evidence the composer may weave into
Section 3 ("Konteks & Hikmah Acara"). The occasion is the lead; news
is ammunition, not the headline. Only occasions with
``include_trending_headlines: true`` in the catalog YAML request this
attachment.

This module is intentionally a single async helper rather than living
inside briefing.py — it's used by:

  - ``api.scripts.manual_briefing`` (operator ``dump <slug>`` command)
  - ``api.workers.occasion_cron`` (Sunday 05:00 WIB auto-generation)
  - ``api.services.briefing`` (assembly path when mode='occasion')

Keeping it isolated lets the cron import it without pulling the entire
weekly-briefing assembly graph.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger(__name__)


async def fetch_trending_headlines(
    session: AsyncSession,
    *,
    limit: int = 8,
    period_days: int = 7,
    exclude_lainnya: bool = True,
) -> list[dict[str, Any]]:
    """Fetch top-N trending posts from the last N days as supporting
    evidence for occasion briefings.

    Selection criteria — engagement-weighted, dawah-relevance-biased:
      - posted_at >= NOW() - period_days
      - text IS NOT NULL AND length(text) >= 30 (skip empty/very-short)
      - theme_group != 'Lainnya' (if exclude_lainnya=True) — keeps the
        supporting evidence on-mission for da'wah audiences
      - ORDER BY dawah_opportunity DESC NULLS LAST, engagement_score
        DESC NULLS LAST, posted_at DESC

    Returns list of dicts ready to drop into the prompt:
        {
          "title": str (first non-empty line, capped at 200 chars),
          "theme_group": str | None,
          "platform": str | None,
          "posted_at": str (ISO 8601, WIB),
          "author": str | None,
          "engagement_views": int | None,
          "dawah_opportunity": float | None,
        }

    Args:
      session: async DB session
      limit: max headlines to return (default 8 per spec)
      period_days: lookback window (default 7 — match weekly briefing
        recency)
      exclude_lainnya: drop posts tagged as Lainnya (default True;
        off-taxonomy posts rarely add value as supporting evidence)

    Returns empty list if no posts match. Logged at INFO level so
    the manual_briefing dump output shows what was attached.
    """
    cutoff = datetime.now(UTC) - timedelta(days=period_days)

    where_clauses = [
        "posted_at >= :cutoff",
        "text IS NOT NULL",
        "length(text) >= 30",
    ]
    if exclude_lainnya:
        where_clauses.append("(theme_group IS NULL OR theme_group != 'Lainnya')")
    where_sql = " AND ".join(where_clauses)

    rows = (
        await session.execute(
            text(
                f"""
                SELECT
                    text,
                    theme_group,
                    platform,
                    posted_at,
                    author,
                    engagement_views,
                    dawah_opportunity
                FROM social_posts
                WHERE {where_sql}
                ORDER BY dawah_opportunity DESC NULLS LAST,
                         engagement_score DESC NULLS LAST,
                         posted_at DESC
                LIMIT :limit
                """
            ),
            {"cutoff": cutoff, "limit": limit},
        )
    ).all()

    headlines: list[dict[str, Any]] = []
    for r in rows:
        # First non-empty line of text is almost always the headline
        # (mainstream RSS leads with the title; tweets are short).
        first_line = next(
            (line.strip() for line in (r.text or "").splitlines() if line.strip()),
            "",
        )
        if not first_line:
            continue
        headlines.append({
            "title": first_line[:200],
            "theme_group": r.theme_group,
            "platform": r.platform,
            "posted_at": r.posted_at.isoformat() if r.posted_at else None,
            "author": r.author,
            "engagement_views": (
                int(r.engagement_views) if r.engagement_views is not None else None
            ),
            "dawah_opportunity": (
                float(r.dawah_opportunity)
                if r.dawah_opportunity is not None else None
            ),
        })

    log.info(
        "trending_headlines.fetched",
        count=len(headlines),
        period_days=period_days,
        exclude_lainnya=exclude_lainnya,
    )
    return headlines
