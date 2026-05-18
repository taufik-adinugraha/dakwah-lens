"""Bulk-insert a verified set of Indonesian RSS feeds — 8 additional
national outlets + 10 regional outlets — on top of the 6 already seeded
by `seed_rss_feeds.py`.

Each feed below was probed before commit (HTTP 200 + valid RSS XML +
non-empty <item> set). The probe command is documented in commit history
for repeatability:

    UA="Mozilla/5.0 (compatible; Dakwah-Lens/0.1; +https://dakwah-lens.id)"
    curl -sL -A "$UA" <url> | head

Idempotent — skips entries that already exist by `name`.

Run:
    uv run python -m api.scripts.seed_extended_feeds
"""

from __future__ import annotations

import asyncio
from typing import TypedDict

from sqlalchemy import select

from api.db import SessionLocal
from api.models.admin import RssFeed


class FeedSpec(TypedDict):
    name: str
    url: str
    scope: str  # "national" | "regional"
    region: str | None
    fetch_body: bool


EXTRA_NATIONAL: list[FeedSpec] = [
    {
        "name": "Tribunnews",
        "url": "https://www.tribunnews.com/rss",
        "scope": "national",
        "region": None,
        "fetch_body": True,
    },
    {
        "name": "Liputan6",
        "url": "https://feed.liputan6.com/rss/berita",
        "scope": "national",
        "region": None,
        "fetch_body": True,
    },
    {
        "name": "Okezone",
        "url": "https://sindikasi.okezone.com/index.php/rss/0/RSS2.0",
        "scope": "national",
        "region": None,
        "fetch_body": True,
    },
    {
        "name": "Sindonews",
        "url": "https://nasional.sindonews.com/rss",
        "scope": "national",
        "region": None,
        "fetch_body": True,
    },
    {
        "name": "RRI",
        "url": "https://www.rri.co.id/rss",
        "scope": "national",
        "region": None,
        "fetch_body": True,
    },
    {
        "name": "CNBC Indonesia",
        "url": "https://www.cnbcindonesia.com/news/rss",
        "scope": "national",
        "region": None,
        "fetch_body": True,
    },
    {
        # Substitutes for Jakarta Post (no public RSS as of 2026) — serves
        # the same English-language Indonesia readership.
        "name": "Antara English",
        "url": "https://en.antaranews.com/rss/news.xml",
        "scope": "national",
        "region": None,
        "fetch_body": True,
    },
    {
        "name": "Detik Hot",
        "url": "https://hot.detik.com/rss",
        "scope": "national",
        "region": None,
        "fetch_body": True,
    },
]


# Tribun Network covers nearly every Indonesian province with the same
# `<subdomain>.tribunnews.com/rss` pattern. Verified all 10 endpoints
# return ~20 items each.
EXTRA_REGIONAL: list[FeedSpec] = [
    {
        "name": "Wartakota",
        "url": "https://wartakota.tribunnews.com/rss",
        "scope": "regional",
        "region": "jabodetabek",
        "fetch_body": True,
    },
    {
        "name": "Tribun Jabar",
        "url": "https://jabar.tribunnews.com/rss",
        "scope": "regional",
        "region": "jawa_barat",
        "fetch_body": True,
    },
    {
        "name": "Tribun Jogja",
        "url": "https://jogja.tribunnews.com/rss",
        "scope": "regional",
        "region": "jawa_tengah_diy",
        "fetch_body": True,
    },
    {
        "name": "Tribun Surabaya",
        "url": "https://surabaya.tribunnews.com/rss",
        "scope": "regional",
        "region": "jawa_timur",
        "fetch_body": True,
    },
    {
        "name": "Tribun Sumut",
        "url": "https://medan.tribunnews.com/rss",
        "scope": "regional",
        "region": "sumatera",
        "fetch_body": True,
    },
    {
        "name": "Tribun Sumbar",
        "url": "https://padang.tribunnews.com/rss",
        "scope": "regional",
        "region": "sumatera",
        "fetch_body": True,
    },
    {
        "name": "Tribun Kaltim",
        "url": "https://kaltim.tribunnews.com/rss",
        "scope": "regional",
        "region": "kalimantan",
        "fetch_body": True,
    },
    {
        "name": "Banjarmasin Post",
        "url": "https://banjarmasin.tribunnews.com/rss",
        "scope": "regional",
        "region": "kalimantan",
        "fetch_body": True,
    },
    {
        "name": "Tribun Timur",
        "url": "https://makassar.tribunnews.com/rss",
        "scope": "regional",
        "region": "sulawesi",
        "fetch_body": True,
    },
    {
        "name": "Tribun Bali",
        "url": "https://bali.tribunnews.com/rss",
        "scope": "regional",
        "region": "indonesia_timur",
        "fetch_body": True,
    },
    # ── Round 2: under-covered regions ──
    {
        # Semarang — second outlet for the most populous corridor.
        "name": "Tribun Jateng",
        "url": "https://jateng.tribunnews.com/rss",
        "scope": "regional",
        "region": "jawa_tengah_diy",
        "fetch_body": True,
    },
    {
        # Sulawesi Utara — paired with Tribun Timur (Makassar) for broader
        # Sulawesi coverage.
        "name": "Tribun Manado",
        "url": "https://manado.tribunnews.com/rss",
        "scope": "regional",
        "region": "sulawesi",
        "fetch_body": True,
    },
    {
        # NTT (Kupang) — second outlet for Indonesia Timur alongside Bali.
        "name": "Pos Kupang",
        "url": "https://kupang.tribunnews.com/rss",
        "scope": "regional",
        "region": "indonesia_timur",
        "fetch_body": True,
    },
    {
        # Aceh — religiously rich territory, valuable for da'wah relevance.
        "name": "Tribun Aceh",
        "url": "https://aceh.tribunnews.com/rss",
        "scope": "regional",
        "region": "sumatera",
        "fetch_body": True,
    },
    {
        # Papua — previously zero-covered; widens the corpus diversity.
        "name": "Tribun Papua",
        "url": "https://papua.tribunnews.com/rss",
        "scope": "regional",
        "region": "indonesia_timur",
        "fetch_body": True,
    },
]


async def main() -> None:
    async with SessionLocal() as session:
        existing_names = {
            row[0]
            for row in (await session.execute(select(RssFeed.name))).all()
        }
        added_national = 0
        added_regional = 0
        for spec in EXTRA_NATIONAL + EXTRA_REGIONAL:
            if spec["name"] in existing_names:
                continue
            session.add(
                RssFeed(
                    name=spec["name"],
                    url=spec["url"],
                    scope=spec["scope"],
                    region=spec["region"],
                    fetch_body=spec["fetch_body"],
                    enabled=True,
                )
            )
            if spec["scope"] == "national":
                added_national += 1
            else:
                added_regional += 1
        await session.commit()

    print(
        f"✓ Seeded {added_national} new national + {added_regional} new regional "
        f"RSS feed(s). Skipped {len(EXTRA_NATIONAL) + len(EXTRA_REGIONAL) - added_national - added_regional} "
        f"that already existed."
    )


if __name__ == "__main__":
    asyncio.run(main())
