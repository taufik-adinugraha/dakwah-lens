"""YouTube Data API v3 — search wrapper that returns items in our `ScrapeResult` shape.

We hit the YouTube Data API directly rather than going through Apify because:
  - It's free up to 10K quota units/day (a `search.list` call = 100 units → 100
    searches/day; a single `videos.list` = 1 unit → comfortable headroom).
  - Apify YouTube actors are 100x more expensive per result.

Each search returns video metadata (title, description, channel, publishedAt).
We deliberately skip per-video statistics (views/comments) on the search path
to keep latency low; those can be fetched on-demand for individual videos.

Auth: requires `YOUTUBE_API_KEY` in env. The key only needs the *YouTube Data
API v3* enabled in the Cloud project — no OAuth, no scopes.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import structlog

from api.config import settings
from api.services.apify import ScrapeResult

log = structlog.get_logger()

_BASE = "https://www.googleapis.com/youtube/v3"
# Search.list costs 100 quota units regardless of maxResults (1-50), so we
# always ask for the max we want — no benefit to batching.
_MAX_PER_CALL = 50


def scrape_youtube(query: str, *, max_items: int = 20) -> ScrapeResult:
    """Search YouTube for videos matching `query` (Indonesian preferred).

    `max_items` caps at 50 per single call. Paginate with `pageToken` if you
    need more, but for da'wah intelligence the most recent 30-50 is plenty.
    """
    if not settings.youtube_api_key:
        raise RuntimeError(
            "YOUTUBE_API_KEY is not set. Add it to .env (Google Cloud Console → "
            "APIs & Services → Credentials → Create API key)."
        )

    started = time.time()
    capped = min(max_items, _MAX_PER_CALL)
    log.info("youtube.search.start", query=query, max=capped)

    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{_BASE}/search",
            params={
                "part": "snippet",
                "q": query,
                "type": "video",
                "maxResults": capped,
                "order": "date",  # newest first
                "relevanceLanguage": "id",
                "regionCode": "ID",
                "key": settings.youtube_api_key,
            },
        )
        resp.raise_for_status()
        payload = resp.json()

    items: list[dict[str, Any]] = payload.get("items", [])
    duration_s = time.time() - started
    log.info(
        "youtube.search.done",
        query=query,
        results=len(items),
        duration_s=round(duration_s, 2),
    )

    # Log against the YouTube provider so the admin dashboard can show
    # quota burn even though there's no USD cost. search.list = 100 units.
    from api.services.usage import record_usage

    record_usage(
        provider="youtube",
        operation="search",
        model="search.list",
        units=100,
        cost_usd=0.0,
        meta={"query": query, "results": len(items)},
    )

    return ScrapeResult(
        items=items,
        actor_id="youtube_data_api_v3",
        run_id=payload.get("nextPageToken", "no_token"),
        # YouTube Data API is free up to 10K units/day; per-call cost is
        # accounted in *quota units*, not USD. Reporting 0 here so the
        # ingest CLI's cost printout reflects "no marginal $".
        cost_usd=0.0,
        duration_s=duration_s,
    )
