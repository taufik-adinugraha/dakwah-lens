"""YouTube Data API v3 wrapper — channel uploads only.

One entry point: `scrape_youtube_uploads(channel_id)` pulls a single
channel's recent uploads via `playlistItems.list` (1 quota unit) and
batches their stats via `videos.list` (1 quota unit). 2 units per
channel total.

A keyword `search.list` path used to exist alongside this — deleted
2026-05-25. It was 100 units per call and pulled in cross-language
spam (Kerala matchmaking, Indian wedding shorts scoring 1.0 on words
like "nikah"). The whitelist + uploads path eliminates spam by
construction. See `api/src/api/scripts/seed_youtube_channels.py` for
the one-off resolution step that turns curated names into channel_id
values via `search.list` — that's the only place we still touch
search.list, amortized over ~80 names = ~8K units one-time.

We hit the YouTube Data API directly rather than going through Apify:
  - 10K free quota units/day; 75 verified channels × 2 = 150/day,
    well inside the free tier.
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
# `playlistItems.list` and `videos.list` are 1 quota unit regardless of
# maxResults (1-50), so always request the max we want — no benefit to
# paginating across more calls when one batch suffices.
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
    # `dropped_no_video_id` was previously also incremented for
    # langdetect non-ID drops; the language gate was removed
    # 2026-05-25 (see below), so this now exclusively counts the rare
    # case of a playlistItems row with a missing `resourceId.videoId`.
    # Should be ~0 in practice.
    dropped_no_video_id = 0
    dropped_stale = 0
    for it in raw_items:
        snippet = it.get("snippet") or {}
        resource = snippet.get("resourceId") or {}
        video_id = resource.get("videoId")
        if not video_id:
            dropped_no_video_id += 1
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

        # Language gate removed 2026-05-25. Rationale: the langdetect
        # filter was legacy from the keyword `search.list` path, where
        # we had zero trust in the result set and needed a defence
        # against cross-language pollution (Kerala matchmaking spam,
        # Indian wedding shorts, etc.). With the whitelist-only path
        # the channel itself is the trust boundary — an admin verified
        # it via the /admin/system/youtube-channels Verify button.
        # Channels with clickbait English titles on Indonesian-content
        # videos (Refly Harun, Bennix, parts of Deddy Corbuzier) lost
        # 30-60% of their uploads to this gate. The downstream Gemini
        # `dawah_relevance` classifier will still drop genuinely off-
        # topic English-content uploads, so we're not blind here.
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
        dropped_no_video_id=dropped_no_video_id,
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


# `search.list` is 100 quota units (vs 1 for the uploads path), so this
# is reserved for the daily trending pipeline — a handful of da'wah-
# relevant keywords/day — NOT the bulk corpus sweep, which stays on the
# cheap whitelist uploads path.
_SEARCH_COST_UNITS = 100


def search_youtube_videos(
    query: str,
    *,
    max_items: int = 25,
    region_code: str = "ID",
    relevance_language: str = "id",
) -> ScrapeResult:
    """Keyword search across ALL of YouTube (not channel-bounded), for the
    trending pipeline.

    This is the deliberately-UNBOUNDED counterpart to
    `scrape_youtube_uploads`. The whitelist uploads path is the trust
    boundary for the weekly corpus; this search path has none, so it
    re-applies the langdetect gate the channel path was allowed to drop.
    Without it, `search.list` pulls cross-language spam that scores high on
    shared Arabic-derived vocabulary (Kerala matchmaking / Indian wedding
    Shorts on "nikah") — the exact failure that got the old search path
    deleted 2026-05-25. `regionCode=ID` + `relevanceLanguage=id` bias the
    result set toward Indonesian *before* the gate; Gemini `dawah_relevance`
    is the final filter downstream.

    Cost: 100 quota units per `search.list` call (paginates in batches of
    50 via `pageToken` to reach `max_items`) + 1 unit per batched
    `videos.list` stats fetch (also chunked at 50). At 20 trending
    keywords/day × max_items=200 → up to 4 search calls/kw + 4 stats
    chunks/kw = ~8200 units/day, inside the 10K/day free tier with
    headroom for the channel-uploads sweep (~150 units/day).
    """
    if not settings.youtube_api_key:
        raise RuntimeError(
            "YOUTUBE_API_KEY is not set. Add it to .env (Google Cloud Console → "
            "APIs & Services → Credentials → Create API key)."
        )

    started = time.time()
    window_start = datetime.now(UTC) - timedelta(days=RECENT_WINDOW_DAYS)
    published_after = window_start.strftime("%Y-%m-%dT%H:%M:%SZ")
    log.info(
        "youtube.search.start",
        query=query,
        max=max_items,
        region=region_code,
    )

    # Paginate search.list in batches of _MAX_PER_CALL (50) until we have
    # max_items or YouTube stops returning a nextPageToken. Each call =
    # 100 quota units; we count them for accurate usage logging below.
    raw_items: list[dict[str, Any]] = []
    page_token: str | None = None
    search_calls = 0
    remaining = max_items
    last_payload: dict[str, Any] = {}
    with httpx.Client(timeout=30) as client:
        while remaining > 0:
            per_call = min(remaining, _MAX_PER_CALL)
            params: dict[str, Any] = {
                "part": "snippet",
                "q": query,
                "type": "video",
                "order": "relevance",
                "regionCode": region_code,
                "relevanceLanguage": relevance_language,
                "publishedAfter": published_after,
                "maxResults": per_call,
                "key": settings.youtube_api_key,
            }
            if page_token:
                params["pageToken"] = page_token
            resp = client.get(f"{_BASE}/search", params=params)
            resp.raise_for_status()
            last_payload = resp.json()
            search_calls += 1
            page_items = last_payload.get("items", []) or []
            raw_items.extend(page_items)
            page_token = last_payload.get("nextPageToken")
            remaining = max_items - len(raw_items)
            # YouTube may return < per_call rows on the last page even if
            # it gives a token. Stop when we either fill the request, run
            # out of pages, or get an empty page (defensive).
            if not page_token or not page_items:
                break

    reshaped: list[dict[str, Any]] = []
    dropped_no_video_id = 0
    dropped_non_id = 0
    for it in raw_items:
        id_obj = it.get("id") or {}
        snippet = it.get("snippet") or {}
        video_id = id_obj.get("videoId")
        if not video_id:
            dropped_no_video_id += 1
            continue

        # Language gate — RESTORED for this path (the channel path drops
        # it because the channel itself is the trust boundary). Detect on
        # title + description; drop anything not Indonesian. `detect_lang`
        # already folds Malay → id and defaults short/garbled text to id,
        # so this errs toward keeping borderline rows.
        title = snippet.get("title") or ""
        description = snippet.get("description") or ""
        if detect_lang(f"{title} {description}") != "id":
            dropped_non_id += 1
            continue

        reshaped.append(
            {
                "id": {"videoId": video_id},
                "snippet": {
                    "title": title,
                    "description": description,
                    "channelTitle": snippet.get("channelTitle"),
                    "publishedAt": snippet.get("publishedAt"),
                    "channelId": snippet.get("channelId"),
                },
            }
        )

    # Enrich with engagement stats — videos.list caps at 50 IDs per call,
    # so chunk if pagination produced more. Each chunk = 1 quota unit.
    stats_calls = 0
    stats_map: dict[str, dict[str, int]] = {}
    if reshaped:
        ids = [it["id"]["videoId"] for it in reshaped]
        with httpx.Client(timeout=20) as stats_client:
            for start in range(0, len(ids), 50):
                chunk = ids[start : start + 50]
                try:
                    stats_map.update(
                        _fetch_video_stats(
                            stats_client, chunk, settings.youtube_api_key
                        )
                    )
                    stats_calls += 1
                except httpx.HTTPError as exc:
                    log.warning(
                        "youtube.search.stats_fetch_failed",
                        error=str(exc),
                        chunk_start=start,
                    )

        for it in reshaped:
            stats = stats_map.get(it["id"]["videoId"])
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
    total_units = search_calls * _SEARCH_COST_UNITS + stats_calls
    log.info(
        "youtube.search.done",
        query=query,
        results=len(reshaped),
        search_calls=search_calls,
        stats_calls=stats_calls,
        units=total_units,
        dropped_no_video_id=dropped_no_video_id,
        dropped_non_id=dropped_non_id,
        duration_s=round(duration_s, 2),
    )

    from api.services.usage import record_usage

    record_usage(
        provider="youtube",
        operation="search",
        model="search.list+videos.list",
        units=total_units,
        cost_usd=0.0,
        meta={
            "query": query,
            "results": len(reshaped),
            "search_calls": search_calls,
            "stats_calls": stats_calls,
            "dropped_non_id": dropped_non_id,
        },
    )

    return ScrapeResult(
        items=reshaped,
        actor_id="youtube_data_api_v3_search",
        run_id=last_payload.get("nextPageToken", "no_token"),
        cost_usd=0.0,
        duration_s=duration_s,
    )
