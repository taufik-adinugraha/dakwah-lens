"""Daily trending-topic discovery for the ad-hoc ingest overlay.

Three free, official signals merged into one candidate pool, then filtered
by Gemini Flash-Lite for da'wah-relevance:

  1. **Google Trends Indonesia** — what people are searching for right now.
     Official Google RSS endpoint, no auth, decade-stable.
  2. **YouTube Data API mostPopular** — top trending videos in Indonesia.
     Uses the existing YOUTUBE_API_KEY; ~5 quota units per call, plenty of
     headroom against the 10K/day free quota.
  3. **Google News Indonesia RSS** — what editorial newsrooms are covering.
     Independent third signal — captures news-driven trends that may not
     have hit social yet.

Complements the curated rotation in `ingest_queries`. The curated list
guarantees structural coverage across the 9 PRD da'wah categories on a
~51-day cycle. This module fills the recency gap: a viral pinjol scam
breaking on Wednesday gets ingested Wednesday, not 38 days later.

Output: a deduplicated list of short keyword strings (e.g.
['halal oktober', 'gibran wisata', 'gizi anak']) ready to feed into
the existing scrape pipeline as ad-hoc Apify queries.

Cost: ~$0.009/mo for the Gemini filter call (~3K tokens/day).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

import feedparser
import httpx
import structlog
from google import genai
from google.genai import types

from api.config import settings

log = structlog.get_logger()

# Sources
GOOGLE_TRENDS_RSS_PRIMARY = "https://trends.google.com/trending/rss?geo=ID&hl=id"
GOOGLE_TRENDS_RSS_FALLBACK = (
    "https://trends.google.com/trends/trendingsearches/daily/rss?geo=ID"
)
GOOGLE_NEWS_RSS = "https://news.google.com/rss?gl=ID&hl=id&ceid=ID:id"
YOUTUBE_API = "https://www.googleapis.com/youtube/v3/videos"

# Gemini model — same as relevance classifier for consistency
FILTER_MODEL = "gemini-2.5-flash-lite"

# Per-source pull cap. Too many candidates wastes Gemini tokens; too few
# starves the merger. 20 each = ~60 candidates → ~3K-token prompt.
PER_SOURCE_LIMIT = 20

# Hard cap on how many surviving keywords we'll dispatch for scraping.
# At 20 items per keyword per platform, 8 keywords × 1 platform = 160
# items/day, well within the Apify budget headroom.
TOTAL_KEEP_LIMIT = 8


@dataclass(frozen=True)
class Candidate:
    text: str
    source: Literal["google_trends", "youtube", "google_news"]


# ── Fetchers ─────────────────────────────────────────────────────


def fetch_google_trends() -> list[Candidate]:
    """Pull today's Indonesia trending searches from Google Trends RSS.

    The endpoint moved in 2024 from /trends/trendingsearches/daily/rss
    to /trending/rss. We try the new one first; fall back if it 404s.
    On total failure we return [] so the rest of the pipeline still runs.
    """
    for url in (GOOGLE_TRENDS_RSS_PRIMARY, GOOGLE_TRENDS_RSS_FALLBACK):
        try:
            feed = feedparser.parse(url)
            if not feed.entries:
                continue
            return [
                Candidate(text=entry.title, source="google_trends")
                for entry in feed.entries[:PER_SOURCE_LIMIT]
                if entry.get("title")
            ]
        except Exception as e:  # noqa: BLE001 — resilience over precision
            log.warning("trending.google_trends.failed", url=url, error=str(e))
    return []


def fetch_youtube_popular() -> list[Candidate]:
    """Pull top-N most-popular videos in Indonesia via YouTube Data API."""
    if not settings.youtube_api_key:
        log.warning("trending.youtube.no_api_key")
        return []
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(
                YOUTUBE_API,
                params={
                    "part": "snippet",
                    "chart": "mostPopular",
                    "regionCode": "ID",
                    "maxResults": PER_SOURCE_LIMIT,
                    "key": settings.youtube_api_key,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return [
                Candidate(text=item["snippet"]["title"], source="youtube")
                for item in data.get("items", [])
                if item.get("snippet", {}).get("title")
            ]
    except Exception as e:  # noqa: BLE001
        log.warning("trending.youtube.failed", error=str(e))
        return []


def fetch_google_news() -> list[Candidate]:
    """Pull top news headlines for Indonesia via Google News RSS."""
    try:
        feed = feedparser.parse(GOOGLE_NEWS_RSS)
        return [
            Candidate(text=entry.title, source="google_news")
            for entry in feed.entries[:PER_SOURCE_LIMIT]
            if entry.get("title")
        ]
    except Exception as e:  # noqa: BLE001
        log.warning("trending.google_news.failed", error=str(e))
        return []


# ── Filter ───────────────────────────────────────────────────────


SYSTEM_PROMPT = """You filter trending topics for a da'wah media intelligence platform.

For each candidate text, do TWO things:

1. Extract a SHORT search keyword (1-4 words, lowercase) that captures the
   underlying topic. Strip emojis, fandom slogans, hashtag punctuation,
   media-outlet prefixes, and boilerplate. Examples:
     '#WajibHalalOktober2026 viral lagi'  →  'halal oktober'
     'Tim Cook ke Indonesia bertemu Jokowi'  →  'tim cook indonesia'
     '#TREASURE_NEW_WAV_D14 LET\\'S GO'  →  'treasure new wav'  (will be filtered out anyway)
     'Gibran Majukan Wisata Daerah'  →  'gibran wisata'

2. Judge whether the topic is DA'WAH-RELEVANT — i.e. would a da'i preparing
   a khutbah or social-media post find this useful?
     KEEP if it's about: society, news, family/parenting, muamalah/economic
       ethics, social justice, education, health, current events, religion,
       youth/mental-health concerns, parenting, policy debate.
     SKIP if it's pure entertainment: K-pop / BL / anime fandom, sports
       (football, badminton, e-sports), celebrity gossip, gaming product
       launches, tech-product hype, music charts, awards-show hashtags.

Return ONLY valid JSON: a list of {keyword, keep, reason} objects in input
order. `reason` should be 3-8 words explaining the judgment ("policy",
"K-pop fandom", "sports", "social-issue news", etc.).
"""


def filter_with_gemini(candidates: list[Candidate]) -> list[str]:
    """Send merged candidates to Gemini Flash-Lite for keyword extraction
    and da'wah-relevance filtering. Returns deduplicated keep-list."""
    if not candidates:
        return []
    if not settings.gemini_api_key:
        log.warning("trending.gemini.no_api_key")
        return []

    client = genai.Client(api_key=settings.gemini_api_key)
    numbered = "\n".join(
        f"[{i + 1}] ({c.source}) {c.text[:200]}"
        for i, c in enumerate(candidates)
    )
    user_prompt = f"Filter these {len(candidates)} candidate topics:\n\n{numbered}"

    response_schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "keyword": {"type": "string"},
                "keep": {"type": "boolean"},
                "reason": {"type": "string"},
            },
            "required": ["keyword", "keep", "reason"],
        },
    }

    try:
        resp = client.models.generate_content(
            model=FILTER_MODEL,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=response_schema,
                temperature=0.2,
            ),
        )
        parsed = json.loads(resp.text or "[]")

        # Log usage so the superadmin api-costs page sees this spend.
        from api.services.usage import record_usage

        usage_md = getattr(resp, "usage_metadata", None)
        record_usage(
            provider="gemini",
            operation="trending_filter",
            model=FILTER_MODEL,
            tokens_in=getattr(usage_md, "prompt_token_count", None),
            tokens_out=getattr(usage_md, "candidates_token_count", None),
            meta={"candidates": len(candidates)},
        )

        # Dedupe by lowercase keyword. Preserve first-seen order so the
        # top-scoring source-merge order roughly reflects priority.
        seen: set[str] = set()
        kept: list[str] = []
        skipped: list[dict[str, str]] = []
        for item in parsed:
            kw = (item.get("keyword") or "").strip()
            if not kw:
                continue
            if not item.get("keep"):
                skipped.append({"kw": kw, "reason": item.get("reason", "")})
                continue
            kw_lower = kw.lower()
            if kw_lower in seen:
                continue
            seen.add(kw_lower)
            kept.append(kw)
            if len(kept) >= TOTAL_KEEP_LIMIT:
                break

        log.info(
            "trending.filter.done",
            candidates=len(candidates),
            kept=len(kept),
            skipped=len(skipped),
            keep_keywords=kept,
        )
        return kept
    except Exception as e:  # noqa: BLE001
        log.error("trending.gemini.failed", error=str(e))
        return []


# ── High-level API ──────────────────────────────────────────────


def get_trending_keywords() -> list[str]:
    """End-to-end: fetch all three sources, merge, filter, return the
    surviving da'wah-relevant keyword list. Caller dispatches scrapes.

    Returns an empty list if all three sources fail OR if Gemini filtering
    fails — the caller treats this as "no trending today, skip".
    """
    candidates: list[Candidate] = []
    candidates.extend(fetch_google_trends())
    candidates.extend(fetch_youtube_popular())
    candidates.extend(fetch_google_news())

    by_source = {
        s: sum(1 for c in candidates if c.source == s)
        for s in ("google_trends", "youtube", "google_news")
    }
    log.info("trending.gather", **by_source, total=len(candidates))

    return filter_with_gemini(candidates)
