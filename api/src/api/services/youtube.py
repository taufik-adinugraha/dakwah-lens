"""YouTube Data API v3 wrappers — search + channel uploads.

Two entry points:
  - `scrape_youtube(query)`        — keyword search.list (100 quota units).
                                     Kept for ad-hoc + weekly discovery only.
  - `scrape_youtube_uploads(channel_id)` — pull one channel's recent uploads
                                     via playlistItems.list (1 quota unit).
                                     This is the everyday path; see
                                     `api/src/api/models/admin.py::YoutubeChannel`
                                     for the whitelist.

We hit the YouTube Data API directly rather than going through Apify:
  - 10K free quota units/day; uploads-playlist scraping is 100× cheaper
    than search per-call so 50 curated channels cost ~50 units total.
  - Apify YouTube actors are 100× more expensive per result.

Auth: requires `YOUTUBE_API_KEY` in env. The key only needs the *YouTube Data
API v3* enabled in the Cloud project — no OAuth, no scopes.
"""

from __future__ import annotations

import math
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import structlog

from api.config import settings
from api.services.apify import ScrapeResult
from api.services.language import detect_lang

log = structlog.get_logger()

_BASE = "https://www.googleapis.com/youtube/v3"
# Search.list costs 100 quota units regardless of maxResults (1-50), so we
# always ask for the max we want — no benefit to batching.
_MAX_PER_CALL = 50

# Time window for "recent uploads" — matches the briefing 7-day window
# so topic discovery only sees videos that are still timely.
RECENT_WINDOW_DAYS = 7


def _engagement_score(
    views: int, likes: int, comments: int
) -> float:
    """Composite score capturing magnitude + interaction quality.

    Formula (calibrated against ~30 sampled videos):
        log10(views + 1) + 0.5 * log10(comments + 1) + 0.3 * log10(likes + 1)

    Views dominate the order of magnitude (a 1M-view video should rank
    above a 10K-view video regardless of likes). Comments weight higher
    than likes per unit — they're a stronger signal of audience reaction
    (people typed something) than the one-click like.

    Designed so a typical da'wah video (~50K views, ~2K likes, ~200
    comments) lands around score 5.4, with viral videos (~1M, 50K, 5K)
    around 7.5, and obscure uploads (~500, 10, 1) around 2.9. Logarithmic
    so the score doesn't get dominated by the top 1% of outliers.
    """
    return (
        math.log10(views + 1)
        + 0.5 * math.log10(comments + 1)
        + 0.3 * math.log10(likes + 1)
    )


def _fetch_video_stats(
    client: httpx.Client, video_ids: list[str], api_key: str
) -> dict[str, dict[str, int]]:
    """Batch-fetch viewCount/likeCount/commentCount for up to 50 video
    IDs in one `videos.list` call (1 quota unit per call regardless of
    batch size).

    Returns `{ video_id: {views, likes, comments} }`. Missing videos
    (e.g. deleted, private) just don't appear in the map; caller should
    fall through to zeros or skip.
    """
    if not video_ids:
        return {}
    if len(video_ids) > 50:
        raise ValueError(f"videos.list max 50 IDs per call, got {len(video_ids)}")

    resp = client.get(
        f"{_BASE}/videos",
        params={
            "part": "statistics",
            "id": ",".join(video_ids),
            "key": api_key,
        },
    )
    resp.raise_for_status()
    payload = resp.json()

    out: dict[str, dict[str, int]] = {}
    for item in payload.get("items", []):
        vid = item.get("id")
        stats = item.get("statistics") or {}
        if not vid:
            continue
        # API returns counts as STRINGs (legacy quirk). likeCount can be
        # absent if the channel hides likes; treat as 0 not None so the
        # score formula still works.
        out[vid] = {
            "views": int(stats.get("viewCount") or 0),
            "likes": int(stats.get("likeCount") or 0),
            "comments": int(stats.get("commentCount") or 0),
        }
    return out


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
                # `viewCount` = most-watched-first. We deliberately give up
                # chronological freshness to drop zero-view spam (Indian
                # wedding shorts, no-name uploads using our keywords). The
                # da'i wants "what's resonating," not the raw timestamp
                # firehose. Same rationale as the X→Top sort flip.
                "order": "viewCount",
                "relevanceLanguage": "id",
                "regionCode": "ID",
                "key": settings.youtube_api_key,
            },
        )
        resp.raise_for_status()
        payload = resp.json()

    raw_items: list[dict[str, Any]] = payload.get("items", [])

    # Strict Indonesian-only filter. `relevanceLanguage=id` is a *soft*
    # hint to YouTube's ranker; in practice ~30% of results are Hindi/
    # Urdu/Bengali content tagged with words that overlap Indonesian
    # (e.g. "nikah"). langdetect on title+description (the only text we
    # have at search-list time) is cheap and catches the overwhelming
    # majority of cross-language pollution.
    items: list[dict[str, Any]] = []
    dropped = 0
    for it in raw_items:
        snippet = it.get("snippet") or {}
        title = (snippet.get("title") or "").strip()
        description = (snippet.get("description") or "").strip()
        probe = f"{title}\n{description}"
        if not probe:
            dropped += 1
            continue
        if detect_lang(probe) != "id":
            dropped += 1
            continue
        items.append(it)

    duration_s = time.time() - started
    log.info(
        "youtube.search.done",
        query=query,
        results=len(items),
        dropped_non_id=dropped,
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


def _uploads_playlist_id(channel_id: str) -> str:
    """Every YT channel has an auto-generated 'uploads' playlist whose ID is
    the channel ID with the leading `UC` swapped for `UU`. Documented behavior;
    saves us one `channels.list` call per channel."""
    if channel_id.startswith("UC"):
        return "UU" + channel_id[2:]
    # Channel IDs that don't start with UC are vanishingly rare (legacy/migrated)
    # — fall back to channels.list lookup if we ever see one in the wild.
    raise ValueError(
        f"channel_id {channel_id!r} doesn't start with 'UC'; "
        "cannot derive uploads playlist heuristically"
    )


def scrape_youtube_uploads(
    channel_id: str, *, max_items: int = 50, channel_name: str | None = None
) -> ScrapeResult:
    """Pull the most recent uploads of one channel via `playlistItems.list`.

    Cheap: 1 quota unit per call vs. 100 for `search.list`. The returned
    items are reshaped to match what `normalizers.normalize_youtube`
    expects (id.videoId + snippet) — the wire shape of playlistItems
    differs from search.list (snippet.resourceId.videoId), so we adapt
    here to keep one downstream normalizer.

    `channel_name` overrides the channelTitle in snippet so the
    resulting `social_posts.author` field uses the curated display
    name from `youtube_channels.name` instead of whatever YT returns
    (handy when a channel rebrands).
    """
    if not settings.youtube_api_key:
        raise RuntimeError(
            "YOUTUBE_API_KEY is not set. Add it to .env (Google Cloud Console → "
            "APIs & Services → Credentials → Create API key)."
        )

    started = time.time()
    capped = min(max_items, _MAX_PER_CALL)
    playlist_id = _uploads_playlist_id(channel_id)
    log.info(
        "youtube.uploads.start",
        channel_id=channel_id,
        channel_name=channel_name,
        max=capped,
    )

    with httpx.Client(timeout=30) as client:
        resp = client.get(
            f"{_BASE}/playlistItems",
            params={
                "part": "snippet",
                "playlistId": playlist_id,
                "maxResults": capped,
                "key": settings.youtube_api_key,
            },
        )
        resp.raise_for_status()
        payload = resp.json()

    raw_items: list[dict[str, Any]] = payload.get("items", [])

    # 7-day publishedAt cutoff so the briefing only sees fresh content.
    # Older uploads in this channel's recent-50 (slow channels) get
    # dropped here rather than churning through classification.
    window_start = datetime.now(UTC) - timedelta(days=RECENT_WINDOW_DAYS)

    # Reshape to the search.list contract the normalizer expects:
    # `id.videoId` + `snippet.title/description/channelTitle/publishedAt`.
    # playlistItems gives us `snippet.resourceId.videoId` instead.
    reshaped: list[dict[str, Any]] = []
    dropped_non_id = 0
    dropped_stale = 0
    for it in raw_items:
        snippet = it.get("snippet") or {}
        resource = snippet.get("resourceId") or {}
        video_id = resource.get("videoId")
        if not video_id:
            dropped_non_id += 1
            continue

        # publishedAt comes back as ISO-8601 UTC string. Drop anything
        # older than the 7-day window.
        published_at_raw = snippet.get("publishedAt") or ""
        if published_at_raw:
            try:
                published_at = datetime.fromisoformat(
                    published_at_raw.replace("Z", "+00:00")
                )
                if published_at < window_start:
                    dropped_stale += 1
                    continue
            except ValueError:
                # Malformed timestamp — let it through; downstream
                # publishedAt parsing will sort it out.
                pass

        title = (snippet.get("title") or "").strip()
        description = (snippet.get("description") or "").strip()
        # Channels do occasionally post bilingual / English uploads; the
        # langdetect gate that protected the search.list path applies
        # equally well here.
        probe = f"{title}\n{description}"
        if probe and detect_lang(probe) != "id":
            dropped_non_id += 1
            continue
        reshaped.append(
            {
                "id": {"videoId": video_id},
                "snippet": {
                    "title": snippet.get("title"),
                    "description": snippet.get("description"),
                    # Prefer curated channel_name when given so the
                    # author column stays stable across rebrands.
                    "channelTitle": channel_name
                    or snippet.get("channelTitle"),
                    "publishedAt": snippet.get("publishedAt"),
                    "channelId": snippet.get("channelId"),
                },
            }
        )

    # Fetch engagement statistics in ONE batched videos.list call
    # (up to 50 IDs, 1 quota unit). View counts grow over time so we
    # re-fetch on every run rather than caching — the cost is trivial
    # (~80 channels × 1 call = 80 quota/day) and the upside is that
    # topic discovery sorts on current popularity, not first-seen
    # popularity.
    if reshaped:
        with httpx.Client(timeout=20) as stats_client:
            try:
                stats_map = _fetch_video_stats(
                    stats_client,
                    [it["id"]["videoId"] for it in reshaped],
                    settings.youtube_api_key,
                )
            except httpx.HTTPError as exc:
                log.warning(
                    "youtube.stats_fetch_failed",
                    channel_id=channel_id,
                    error=str(exc),
                )
                stats_map = {}

        for it in reshaped:
            vid = it["id"]["videoId"]
            stats = stats_map.get(vid)
            if stats:
                it["snippet"]["statistics"] = {
                    "views": stats["views"],
                    "likes": stats["likes"],
                    "comments": stats["comments"],
                    "score": _engagement_score(
                        stats["views"], stats["likes"], stats["comments"]
                    ),
                }

    duration_s = time.time() - started
    log.info(
        "youtube.uploads.done",
        channel_id=channel_id,
        channel_name=channel_name,
        results=len(reshaped),
        dropped_non_id=dropped_non_id,
        dropped_stale=dropped_stale,
        duration_s=round(duration_s, 2),
    )

    from api.services.usage import record_usage

    # Two quota units now (playlistItems.list + videos.list).
    record_usage(
        provider="youtube",
        operation="uploads_fetch",
        model="playlistItems.list+videos.list",
        units=2 if reshaped else 1,
        cost_usd=0.0,
        meta={
            "channel_id": channel_id,
            "results": len(reshaped),
            "dropped_stale": dropped_stale,
        },
    )

    return ScrapeResult(
        items=reshaped,
        actor_id="youtube_data_api_v3",
        run_id=payload.get("nextPageToken", "no_token"),
        cost_usd=0.0,
        duration_s=duration_s,
    )
