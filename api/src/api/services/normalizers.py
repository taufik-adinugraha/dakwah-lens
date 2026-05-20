"""Per-platform mappers: raw Apify item → `social_posts` row dict.

Each scraper actor returns a different shape, so we keep one small pure
function per platform. They all return `None` for items that lack a usable
text body, which the ingestion CLI then skips.

When adding a new platform or swapping its actor:
  1. Add a `normalize_<platform>` function below
  2. Add it to `NORMALIZERS`
  3. Add a `scrape_<platform>` helper in `services/apify.py`

Field shapes documented in each function come from real actor output, not
guesses. If an actor changes its schema, those functions are the only thing
that needs touching.
"""

from __future__ import annotations

import html
import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from bs4 import BeautifulSoup

NormalizerFn = Callable[[dict[str, Any]], dict[str, Any] | None]

_WHITESPACE_RE = re.compile(r"[ \t ]+")
_NEWLINES_RE = re.compile(r"\n{3,}")


# Outlet-specific CTA boilerplate that gets appended to RSS bodies and
# pollutes the text we feed downstream classifiers + the public UI.
_CTA_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"Berikan apresiasi[^.]*?https?://\S+", re.IGNORECASE),
    re.compile(r"apresiasi kamu di sini[^.]*?https?://\S+", re.IGNORECASE),
    re.compile(
        r"\b(BACA(?: JUGA)?|ARTIKEL TERKAIT|TONTON JUGA|SIMAK JUGA|LIHAT JUGA)\s*:[^\n]{0,200}",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:Original Video|Originl Video|Source|Sumber)\s*:\s*https?://\S+",
        re.IGNORECASE,
    ),
)


def _clean_text(text: str, *, strip_outlet_cta: bool = False) -> str:
    """Decode HTML entities, strip HTML tags, normalize whitespace.

    Called by every per-platform normalizer so the rules are consistent:
    `&quot;` → `"`, `&#39;` → `'`, `&amp;` → `&`, etc. Outlet CTA
    boilerplate (`apresiasi kamu di sini: …`, `BACA JUGA: …`) is stripped
    only for RSS bodies — irrelevant on X/TT/IG which are user posts.

    `html.unescape()` runs BEFORE BeautifulSoup because BS4's get_text()
    is unreliable on entities outside HTML structure; running unescape
    first guarantees the decode happens regardless.
    """
    if not text:
        return ""
    text = html.unescape(text)
    if "<" in text:
        text = BeautifulSoup(text, "html.parser").get_text(separator=" ")
        # Tags may have hidden more entities (e.g. attribute values).
        text = html.unescape(text)
    if strip_outlet_cta:
        for pat in _CTA_PATTERNS:
            text = pat.sub("", text)
    text = _WHITESPACE_RE.sub(" ", text)
    text = _NEWLINES_RE.sub("\n\n", text)
    return text.strip()


# Backwards-compat alias — old code (reclean script) calls _strip_html.
def _strip_html(text: str) -> str:
    return _clean_text(text, strip_outlet_cta=True)


def _to_datetime(value: Any) -> datetime | None:
    """Best-effort parse of various date shapes Apify actors return."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, int | float):
        # Unix epoch seconds.
        try:
            return datetime.fromtimestamp(value, tz=UTC)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _str_or_none(value: Any, max_len: int = 255) -> str | None:
    if isinstance(value, str) and value:
        return value[:max_len]
    return None


# ── X (Twitter) ────────────────────────────────────────────────────


def normalize_x(item: dict[str, Any]) -> dict[str, Any] | None:
    """Map an Apify tweet object → SocialPost row dict.

    Field-by-field tolerant — works across `apidojo/tweet-scraper`
    (current default), `kaitoeasyapi/twitter-x-data-tweet-scraper-...`
    (previous default), and most other community X actors. Author may
    live under `author` (dict) or `user` (dict), id under `id` / `id_str` /
    `tweetId`. Each fallback chain matches the union of actor schemas
    we've seen.
    """
    text = item.get("text") or item.get("full_text") or item.get("content")
    if not isinstance(text, str) or not text.strip():
        return None
    text = _clean_text(text)

    external_id = (
        item.get("id_str") or item.get("id") or item.get("tweetId")
        or item.get("conversationId")
    )
    if not external_id:
        return None

    # Author can be at `author` (dict) or `user` (dict) or `username` (str).
    author: str | None = None
    for key in ("author", "user"):
        val = item.get(key)
        if isinstance(val, dict):
            handle = (
                val.get("userName")
                or val.get("username")
                or val.get("screen_name")
                or val.get("name")
            )
            if handle:
                author = _str_or_none(handle)
                break
    if not author:
        author = _str_or_none(item.get("username") or item.get("screen_name"))

    url = (
        item.get("url")
        or item.get("twitterUrl")
        or (f"https://x.com/{author}/status/{external_id}" if author else None)
    )

    return {
        "platform": "x",
        "external_id": str(external_id),
        "author": author,
        "url": _str_or_none(url, max_len=1000),
        "text": text,
        "language": _str_or_none(item.get("lang") or item.get("language"), max_len=8),
        "posted_at": _to_datetime(
            item.get("created_at") or item.get("createdAt") or item.get("date")
        ),
        "raw_payload": item,
    }


# ── TikTok ────────────────────────────────────────────────────────


def normalize_tiktok(item: dict[str, Any]) -> dict[str, Any] | None:
    """Map an Apify TikTok video object → SocialPost row dict.

    Tested against `clockworks/free-tiktok-scraper`. Output shape is
    stable across clockworks's TikTok actor family — caption in `text`,
    author info nested under `authorMeta`, video id in `id`.
    """
    text = item.get("text") or item.get("description") or item.get("caption")
    if not isinstance(text, str) or not text.strip():
        # Some TikTok posts have empty captions but still useful titles; skip.
        return None
    text = _clean_text(text)

    external_id = item.get("id") or item.get("videoId") or item.get("aweme_id")
    if not external_id:
        return None

    author: str | None = None
    meta = item.get("authorMeta") or item.get("author")
    if isinstance(meta, dict):
        author = _str_or_none(meta.get("name") or meta.get("nickname") or meta.get("uniqueId"))

    url = item.get("webVideoUrl") or item.get("url") or item.get("videoUrl")

    return {
        "platform": "tiktok",
        "external_id": str(external_id),
        "author": author,
        "url": _str_or_none(url, max_len=1000),
        "text": text,
        "language": _str_or_none(
            (item.get("textLanguage") or item.get("language")), max_len=8
        ),
        "posted_at": _to_datetime(
            item.get("createTimeISO")
            or item.get("createTime")
            or item.get("createdAt")
        ),
        "raw_payload": item,
    }


# ── Instagram ─────────────────────────────────────────────────────


def normalize_instagram(item: dict[str, Any]) -> dict[str, Any] | None:
    """Map an Apify Instagram post → SocialPost row dict.

    Tested against `apify/instagram-hashtag-scraper`. Caption is at
    `caption`, owner at `ownerUsername`, post id at `id` or `shortCode`.
    """
    text = item.get("caption") or item.get("text")
    if not isinstance(text, str) or not text.strip():
        return None
    text = _clean_text(text)

    external_id = (
        item.get("id") or item.get("shortCode") or item.get("shortcode")
    )
    if not external_id:
        return None

    author = _str_or_none(
        item.get("ownerUsername")
        or item.get("owner_username")
        or item.get("username")
    )
    if not author:
        owner = item.get("owner")
        if isinstance(owner, dict):
            author = _str_or_none(owner.get("username") or owner.get("full_name"))

    url = item.get("url") or item.get("postUrl") or (
        f"https://www.instagram.com/p/{external_id}/" if external_id else None
    )

    return {
        "platform": "instagram",
        "external_id": str(external_id),
        "author": author,
        "url": _str_or_none(url, max_len=1000),
        "text": text,
        "language": None,  # IG actor doesn't reliably report
        "posted_at": _to_datetime(
            item.get("timestamp") or item.get("taken_at") or item.get("createdAt")
        ),
        "raw_payload": item,
    }


# ── Facebook ──────────────────────────────────────────────────────


def normalize_facebook(item: dict[str, Any]) -> dict[str, Any] | None:
    """Map an Apify Facebook post → SocialPost row dict.

    Caveat: FB actors are notoriously fragile and expensive. We keep this
    function for completeness; in Phase 1 we don't actually run it.
    """
    text = item.get("text") or item.get("postText") or item.get("message")
    if not isinstance(text, str) or not text.strip():
        return None
    text = _clean_text(text)

    external_id = (
        item.get("postId") or item.get("id") or item.get("topLevelUrl")
    )
    if not external_id:
        return None

    author: str | None = None
    user = item.get("user") or item.get("author") or item.get("pageName")
    if isinstance(user, dict):
        author = _str_or_none(user.get("name") or user.get("username"))
    elif isinstance(user, str):
        author = _str_or_none(user)

    url = item.get("url") or item.get("postUrl") or item.get("topLevelUrl")

    return {
        "platform": "facebook",
        "external_id": str(external_id),
        "author": author,
        "url": _str_or_none(url, max_len=1000),
        "text": text,
        "language": None,
        "posted_at": _to_datetime(
            item.get("time") or item.get("date") or item.get("createdAt")
        ),
        "raw_payload": item,
    }


# ── YouTube ───────────────────────────────────────────────────────


def normalize_youtube(item: dict[str, Any]) -> dict[str, Any] | None:
    """Map a YouTube Data API v3 search result → SocialPost row dict.

    The API returns `{id: {videoId}, snippet: {title, description, …}}`. We
    use title + description as the searchable text and combine them so the
    sentiment/relevance classifiers have more to work with than just a title.
    """
    snippet = item.get("snippet")
    id_obj = item.get("id")
    if not isinstance(snippet, dict) or not isinstance(id_obj, dict):
        return None

    video_id = id_obj.get("videoId") or id_obj.get("id")
    if not video_id:
        return None

    title = _clean_text(snippet.get("title") or "")
    description = _clean_text(snippet.get("description") or "")
    if not title and not description:
        return None
    text = f"{title}\n\n{description}".strip()

    return {
        "platform": "youtube",
        "external_id": str(video_id),
        "author": _str_or_none(snippet.get("channelTitle")),
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "text": text,
        "language": _str_or_none(snippet.get("defaultAudioLanguage"), max_len=8),
        "posted_at": _to_datetime(snippet.get("publishedAt")),
        "raw_payload": item,
    }


# ── Mainstream news (RSS) ─────────────────────────────────────────


def normalize_mainstream(item: dict[str, Any]) -> dict[str, Any] | None:
    """Map a feedparser entry → SocialPost row dict.

    Builds text from title + (full body OR summary). `_outlet` is set by
    the RSS scraper and becomes the `author` field (e.g. "Kompas", "Detik").
    When the feed has `fetch_body=true`, the scraper populates
    `_full_text` via trafilatura and we use that in place of the RSS lede.
    """
    title = item.get("title")
    full_text = item.get("_full_text")
    summary = item.get("summary")
    if not (isinstance(title, str) and title.strip()):
        return None

    # Strip any HTML tags + decode entities. Republika and a few others
    # inject `<img>` and `&nbsp;` into the summary, which biases IndoBERT
    # toward neutral. Trafilatura output (`_full_text`) is already plain
    # text — `_strip_html` is a cheap no-op on those.
    title_clean = _strip_html(title)
    if not title_clean:
        return None

    text = title_clean
    body_source = (
        full_text if isinstance(full_text, str) and full_text.strip() else summary
    )
    if isinstance(body_source, str) and body_source.strip():
        body_clean = _strip_html(body_source)
        if body_clean:
            text = f"{title_clean}\n\n{body_clean}"

    external_id = item.get("id") or item.get("link")
    if not external_id:
        return None

    # `published_parsed` is a struct_time; convert if present.
    posted_at = None
    parsed = item.get("published_parsed")
    if parsed is not None:
        try:
            import calendar
            from datetime import datetime

            posted_at = datetime.fromtimestamp(
                calendar.timegm(parsed), tz=UTC
            )
        except (TypeError, ValueError, OverflowError):
            posted_at = None
    if posted_at is None:
        posted_at = _to_datetime(item.get("published"))

    return {
        "platform": "mainstream",
        "external_id": str(external_id)[:255],
        "author": _str_or_none(item.get("_outlet")),
        "url": _str_or_none(item.get("link"), max_len=1000),
        "text": text,
        # `language` is set by the ingest script via `detect_lang()` — most
        # mainstream feeds are Indonesian but we now also pull Antara
        # English, so leaving detection authoritative.
        "language": None,
        "posted_at": posted_at,
        # Region tag from the originating feed (NULL for national outlets).
        # Denormalized onto the post for fast filtering on the insights page.
        "region": _str_or_none(item.get("_region"), max_len=32),
        "raw_payload": item,
    }


NORMALIZERS: dict[str, NormalizerFn] = {
    "x": normalize_x,
    "tiktok": normalize_tiktok,
    "instagram": normalize_instagram,
    "facebook": normalize_facebook,
    "youtube": normalize_youtube,
    "mainstream": normalize_mainstream,
}
