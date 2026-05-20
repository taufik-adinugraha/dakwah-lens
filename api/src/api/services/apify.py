"""Thin wrapper around the Apify REST API.

Apify exposes hundreds of community-contributed scrapers ("actors"), each
with its own input shape and pricing. We wrap the common pattern:

    run = client.actor(actor_id).call(run_input=...)
    items = client.dataset(run.defaultDatasetId).iterate_items()

…into a single `scrape(...)` call that returns a `ScrapeResult` with the
items + the actual cost the run incurred.

Default actors are tuned for paid-plan Apify (we run on Starter $29/mo):
  - X: `apidojo/tweet-scraper` ($0.0004/item) — industry default,
    full thread context, reliable on weekend bursts
  - TikTok: `clockworks/free-tiktok-scraper` ($0.004/item) — name
    is misleading ("free" trial, not free-cost). TT ingest is
    currently disabled in beat pending product decision; this
    default stays here so manual `--platform tiktok` invocations
    still work for ad-hoc verification.
  - Instagram: `apify/instagram-hashtag-scraper` ($0.0023/item) —
    official Apify, sufficient for our hashtag-driven discovery
Override any of them via the `actor_id` parameter on `scrape(...)`.

Run cost is captured for budget tracking (PRD §13 caps spend at IDR 1M/mo).
The /admin/system/api-costs page reads the actual per-run USD reported by
Apify, so the figures above are planning estimates only — real cost
depends on the specific actor's pricing curve at the time of the run.
"""

from __future__ import annotations

import os as _os
from dataclasses import dataclass
from typing import Any

import structlog
from apify_client import ApifyClient

from api.config import settings

log = structlog.get_logger()

# ── Default actors per platform ─────────────────────────────────────
# These are marketplace actors. Swap in `.env` later if pricing or quality
# changes — every platform gets a single ENV-driven actor id.
# Per-platform default actor. Override at runtime via env, e.g.
#   APIFY_ACTOR_X=apify/twitter-scraper-lite
# to swap without code changes. Some actors are paid-plan-gated by their
# authors; pick a free-plan-compatible one for prototype use.

DEFAULT_ACTORS: dict[str, str] = {
    "x": _os.environ.get("APIFY_ACTOR_X", "apidojo/tweet-scraper"),
    "instagram": _os.environ.get(
        "APIFY_ACTOR_INSTAGRAM", "apify/instagram-hashtag-scraper"
    ),
    "tiktok": _os.environ.get("APIFY_ACTOR_TIKTOK", "clockworks/free-tiktok-scraper"),
    "facebook": _os.environ.get("APIFY_ACTOR_FACEBOOK", "apify/facebook-posts-scraper"),
}


@dataclass
class ScrapeResult:
    items: list[dict[str, Any]]
    actor_id: str
    run_id: str
    # USD cost of the run as reported by Apify. None if not available.
    cost_usd: float | None
    # Duration of the run in seconds.
    duration_s: float | None


_client: ApifyClient | None = None


def _get_client() -> ApifyClient:
    if not settings.apify_token:
        raise RuntimeError(
            "APIFY_TOKEN is not set. Add it to .env (sign up at https://console.apify.com)."
        )
    global _client
    if _client is None:
        _client = ApifyClient(token=settings.apify_token)
    return _client


def scrape(
    *,
    platform: str,
    run_input: dict[str, Any],
    actor_id: str | None = None,
    max_items: int | None = None,
) -> ScrapeResult:
    """Run an Apify actor synchronously and return its items.

    Args:
        platform: One of `x`, `instagram`, `tiktok`, `facebook` — used to
            pick the default actor if `actor_id` isn't given.
        run_input: Actor-specific input. See each actor's README on Apify
            for the schema.
        actor_id: Optional override of the default actor for that platform.
        max_items: Cap the number of items returned (the actor may produce
            more; we just stop iterating). Useful for dev / cost control.

    Raises:
        RuntimeError if `APIFY_TOKEN` is unset or the actor run fails.
    """
    client = _get_client()
    actor = actor_id or DEFAULT_ACTORS.get(platform)
    if not actor:
        raise ValueError(f"No default actor for platform `{platform}`")

    log.info("apify.run.start", actor=actor, platform=platform, input=run_input)
    run = client.actor(actor).call(run_input=run_input)
    if run is None:
        raise RuntimeError(f"Apify actor `{actor}` failed to start.")

    dataset_id = run.get("defaultDatasetId")
    if not dataset_id:
        raise RuntimeError(f"Actor run `{run['id']}` has no defaultDatasetId.")

    items: list[dict[str, Any]] = []
    for item in client.dataset(dataset_id).iterate_items():
        items.append(item)
        if max_items is not None and len(items) >= max_items:
            break

    # Apify exposes the run's actual usage cost on the run object.
    stats = run.get("stats") or {}
    cost_usd: float | None = run.get("usageTotalUsd")
    if cost_usd is None:
        usage = run.get("usage") or {}
        cost_usd = (
            usage.get("totalUsageUsd")
            or usage.get("computeUnits")  # last-resort approximation
        )
    duration_s = stats.get("runTimeSecs")

    log.info(
        "apify.run.done",
        actor=actor,
        run_id=run["id"],
        items=len(items),
        cost_usd=cost_usd,
        duration_s=duration_s,
    )

    # Persist for the admin cost dashboard. Apify already gives us the
    # exact USD figure, so no `estimate_cost` fallback needed.
    from api.services.usage import record_usage

    record_usage(
        provider="apify",
        operation="scrape",
        model=actor,
        units=len(items),
        cost_usd=float(cost_usd) if cost_usd is not None else 0.0,
        meta={"platform": platform, "run_id": run["id"]},
    )

    return ScrapeResult(
        items=items,
        actor_id=actor,
        run_id=run["id"],
        cost_usd=float(cost_usd) if cost_usd is not None else None,
        duration_s=float(duration_s) if duration_s is not None else None,
    )


# ── Per-platform convenience wrappers ───────────────────────────────


def scrape_x(query: str, *, max_items: int = 50) -> ScrapeResult:
    """Search X (Twitter) for tweets matching `query`.

    `query` accepts hashtags (`#islam`), keywords, or X's full search syntax
    (`from:@detikcom #pemilu`, etc).
    """
    return scrape(
        platform="x",
        run_input={
            "searchTerms": [query],
            "maxItems": max_items,
            "sort": "Latest",
            "tweetLanguage": "id",
            "onlyVerifiedUsers": False,
        },
        max_items=max_items,
    )


def scrape_tiktok(
    query: str, *, max_items: int = 50, actor_id: str | None = None
) -> ScrapeResult:
    """Scrape TikTok videos for a hashtag or search keyword.

    Strip the leading `#` from a hashtag (the actor adds it back). Pass a
    plain string for keyword search.

    `actor_id` overrides the default `clockworks/free-tiktok-scraper`.
    Kept available as a general escape hatch for swapping in a different
    TikTok actor without redeploying.
    """
    hashtag = query.lstrip("#")
    return scrape(
        platform="tiktok",
        actor_id=actor_id,
        run_input={
            "hashtags": [hashtag],
            "resultsPerPage": max_items,
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": False,
            "shouldDownloadSubtitles": False,
            "shouldDownloadSlideshowImages": False,
        },
        max_items=max_items,
    )


def scrape_instagram(query: str, *, max_items: int = 50) -> ScrapeResult:
    """Scrape Instagram posts under a hashtag.

    `query` is the hashtag with or without the leading `#`.
    """
    hashtag = query.lstrip("#")
    return scrape(
        platform="instagram",
        run_input={
            "hashtags": [hashtag],
            "resultsLimit": max_items,
        },
        max_items=max_items,
    )


def scrape_facebook(query: str, *, max_items: int = 50) -> ScrapeResult:
    """Scrape Facebook posts. Caveat: FB actors are flaky + expensive.

    `query` is typically a page URL or search term — varies by actor.
    """
    return scrape(
        platform="facebook",
        run_input={
            "searchQueries": [query],
            "maxPosts": max_items,
        },
        max_items=max_items,
    )
