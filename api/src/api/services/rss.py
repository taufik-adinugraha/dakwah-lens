"""RSS scraper for Indonesian mainstream media.

Indonesian news outlets all publish public RSS feeds — free, no key needed.
We fetch a configured set in parallel, parse with `feedparser`, and return
items in our `ScrapeResult` shape so the rest of the ingest pipeline doesn't
have to know the source was RSS rather than Apify.

`query` is interpreted as a substring filter applied to title + summary.
Pass empty string ("") to take the latest N items across all feeds.

Feed list is configurable via the `rss_feeds` table (managed by the
superadmin at `/admin/system/rss`). The table must be seeded before
the ingest pipeline runs — `scripts/seed_rss_feeds.py` populates
`DEFAULT_FEEDS` as a starting point, `seed_extended_feeds.py` adds the
regional + extended national outlets. If the table is empty at runtime
the loader raises rather than silently falling back to the constant —
silent fallback once hid a real bug for two days.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import feedparser
import httpx
import structlog
from sqlalchemy import select

from api.db import SessionLocal
from api.models.admin import RssFeed
from api.services.apify import ScrapeResult
from api.services.safe_fetch import UnsafeUrlError, safe_get

log = structlog.get_logger()

# Top Indonesian general-news outlets per PRD §05. Used as a fallback when
# `rss_feeds` is empty and as the seed list on first run.
DEFAULT_FEEDS: dict[str, str] = {
    "Kompas": "https://news.kompas.com/rss",
    "Detik": "https://news.detik.com/berita/rss",
    "CNN Indonesia": "https://www.cnnindonesia.com/nasional/rss",
    "Antara": "https://www.antaranews.com/rss/terkini.xml",
    "Republika": "https://www.republika.co.id/rss",
    "Tempo": "https://rss.tempo.co/nasional",
}


FeedMeta = tuple[str, str | None, bool]
"""(url, region, fetch_body) — region is NULL for national feeds; fetch_body
flips on per-outlet body extraction."""


async def _load_feeds_async() -> dict[str, FeedMeta]:
    async with SessionLocal() as session:
        res = await session.execute(
            select(
                RssFeed.name, RssFeed.url, RssFeed.region, RssFeed.fetch_body
            ).where(RssFeed.enabled.is_(True))
        )
        rows = res.all()
        if not rows:
            # No enabled rows is a configuration error — the admin must
            # seed the `rss_feeds` table (see scripts/seed_rss_feeds.py).
            # Fail loudly rather than silently scrape an unrelated set.
            raise RuntimeError(
                "rss_feeds table has no enabled rows — seed it via "
                "`uv run python -m api.scripts.seed_rss_feeds` "
                "(and the extended-feeds script for regional outlets) "
                "before running ingest."
            )
        return {
            row.name: (row.url, row.region, bool(row.fetch_body)) for row in rows
        }


def _load_feeds() -> dict[str, FeedMeta]:
    """Sync wrapper. RSS scraper runs in Celery sync tasks AND inside the
    ingest CLI's async `_run` — i.e. sometimes called from a sync context,
    sometimes from inside a running event loop.

    `asyncio.run()` raises `RuntimeError("asyncio.run() cannot be called from
    a running event loop")` when invoked from inside an active loop. We used
    to swallow that and silently fall back to a hardcoded default list,
    which masked real configuration bugs (the regional Tribun outlets
    never got scraped for days). The fallback is gone — we now detect the
    running-loop case and run the DB query in a separate thread with its
    own loop. Any failure of the DB query propagates.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        # No loop in this thread — direct asyncio.run is correct.
        return asyncio.run(_load_feeds_async())

    # We're inside a running event loop. Spawn a one-shot worker thread
    # that builds its own loop, runs the query, and returns the result.
    # ThreadPoolExecutor is the standard idiom for "I have an async call
    # but need it from sync code in an already-async context".
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(lambda: asyncio.run(_load_feeds_async())).result()


# CNN Indonesia (and a few others) reject bare requests as bots — send a
# regular-browser UA. We're publicly fetching their public RSS, so this is
# within ToS for everyone we hit.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; Dakwah-Lens/0.1; +https://dakwah-lens.id)"
    ),
    "Accept": "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
}


# ── Full-article extractor ──────────────────────────────────────────
# Politeness: one second minimum between requests to the same host.
# Hosts indexed by netloc (kompas.com, etc.). Module-level dict — only
# relevant within a single Celery worker process, which is exactly the
# right scope (per-process politeness, no cross-worker coordination).
_POLITENESS_S = 1.0
_FETCH_TIMEOUT_S = 5.0
_last_fetched_at: dict[str, float] = {}


def _polite_sleep(url: str) -> None:
    """Sleep enough to honour `_POLITENESS_S` between same-host requests."""
    from urllib.parse import urlparse

    host = urlparse(url).netloc
    if not host:
        return
    last = _last_fetched_at.get(host)
    now = time.time()
    if last is not None and (now - last) < _POLITENESS_S:
        time.sleep(_POLITENESS_S - (now - last))
    _last_fetched_at[host] = time.time()


def _extract_body(client: httpx.Client, url: str) -> str | None:
    """Fetch `url` and run trafilatura. Returns the extracted body text or
    None on any failure.

    Errors are swallowed and logged at debug — body extraction is a quality
    improvement, never a hard requirement. If extraction fails, the
    classifier falls back to title+summary like before.
    """
    try:
        import trafilatura

        _polite_sleep(url)
        resp = safe_get(
            client, url, timeout=_FETCH_TIMEOUT_S, headers=_HEADERS
        )
        resp.raise_for_status()
        body = trafilatura.extract(
            resp.text,
            include_comments=False,
            include_tables=False,
            favor_precision=True,
        )
        if not body or len(body) < 100:
            # Below ~100 chars usually means extraction missed the article and
            # picked up a navbar/footer instead. Treat as a miss.
            return None
        return body
    except UnsafeUrlError as e:
        log.warning("rss.body_extract.blocked", url=url, error=str(e))
        return None
    except Exception as e:  # noqa: BLE001
        log.debug("rss.body_extract_failed", url=url, error=str(e))
        return None


def _fetch_feed(
    client: httpx.Client,
    name: str,
    url: str,
    region: str | None,
) -> list[dict[str, Any]]:
    """Fetch one feed; return raw entry dicts with `_outlet` + `_region` tagged on.

    Errors are caught and logged — one outlet being down shouldn't stop the
    whole ingest.
    """
    try:
        resp = safe_get(client, url, timeout=15, headers=_HEADERS)
        resp.raise_for_status()
        feed = feedparser.parse(resp.content)
        items: list[dict[str, Any]] = []
        for entry in feed.entries:
            # feedparser entries are dict-like. Normalize to plain dict so the
            # downstream normalizer doesn't need to know about feedparser types.
            items.append(
                {
                    "_outlet": name,
                    "_region": region,
                    "title": entry.get("title"),
                    "summary": entry.get("summary") or entry.get("description"),
                    "link": entry.get("link"),
                    "id": entry.get("id") or entry.get("guid") or entry.get("link"),
                    "published": entry.get("published") or entry.get("updated"),
                    "published_parsed": entry.get("published_parsed")
                    or entry.get("updated_parsed"),
                    "author": entry.get("author"),
                    "tags": [t.get("term") for t in entry.get("tags", [])],
                }
            )
        return items
    except Exception as e:  # noqa: BLE001 — broad on purpose; we want resilience
        log.warning("rss.feed_failed", outlet=name, url=url, error=str(e))
        return []


def scrape_mainstream(query: str, *, max_items: int = 50) -> ScrapeResult:
    """Fetch latest articles across all configured Indonesian news outlets.

    Items are sorted newest-first by feed order (feedparser returns each
    feed's items in the order the outlet published them, which is already
    newest-first for every outlet we use). `query` if non-empty filters
    titles/summaries by substring match (case-insensitive).
    """
    feeds = _load_feeds()
    started = time.time()
    log.info(
        "rss.scrape.start", outlets=list(feeds), query=query or "(all)", max=max_items
    )

    all_items: list[dict[str, Any]] = []
    with httpx.Client(timeout=20) as client:
        for name, (url, region, fetch_body) in feeds.items():
            items = _fetch_feed(client, name, url, region)
            # Tag every item so the cap/interleave loop below can pass the
            # flag to the body fetcher without re-querying the DB.
            for it in items:
                it["_fetch_body"] = fetch_body
            all_items.extend(items)

    # Optional keyword filter
    if query:
        q = query.lower()
        all_items = [
            it
            for it in all_items
            if (it.get("title") and q in it["title"].lower())
            or (it.get("summary") and q in (it.get("summary") or "").lower())
        ]

    # Cap to `max_items`. We interleave by outlet (round-robin) so a single
    # noisy outlet doesn't dominate the cap — fairer cross-outlet coverage.
    by_outlet: dict[str, list[dict[str, Any]]] = {name: [] for name in feeds}
    for it in all_items:
        outlet = it.get("_outlet")
        if outlet in by_outlet:
            by_outlet[outlet].append(it)

    interleaved: list[dict[str, Any]] = []
    idx = 0
    while len(interleaved) < max_items:
        added = False
        for buckets in by_outlet.values():
            if idx < len(buckets):
                interleaved.append(buckets[idx])
                added = True
                if len(interleaved) >= max_items:
                    break
        if not added:
            break
        idx += 1

    # Body extraction — only for items whose feed had fetch_body=true.
    # Doing this AFTER the cap+interleave so we never spend network time
    # on items we're going to discard.
    body_targets = [
        it for it in interleaved if it.get("_fetch_body") and it.get("link")
    ]
    if body_targets:
        body_started = time.time()
        with httpx.Client(timeout=_FETCH_TIMEOUT_S + 1) as body_client:
            for it in body_targets:
                body = _extract_body(body_client, it["link"])
                if body:
                    it["_full_text"] = body
        log.info(
            "rss.body_extract.done",
            targets=len(body_targets),
            extracted=sum(1 for it in body_targets if it.get("_full_text")),
            duration_s=round(time.time() - body_started, 2),
        )

    duration_s = time.time() - started
    log.info(
        "rss.scrape.done",
        outlets=len(feeds),
        items=len(interleaved),
        duration_s=round(duration_s, 2),
    )

    # Cost log — RSS is $0 but volume matters for the dashboard.
    from api.services.usage import record_usage

    record_usage(
        provider="rss",
        operation="scrape",
        model="feedparser",
        units=len(interleaved),
        cost_usd=0.0,
        meta={"outlets": len(feeds), "query": query or ""},
    )

    return ScrapeResult(
        items=interleaved,
        actor_id="rss_aggregator",
        run_id=f"rss_{int(started)}",
        cost_usd=0.0,
        duration_s=duration_s,
    )
