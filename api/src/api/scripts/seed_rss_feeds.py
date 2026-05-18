"""One-off seed for the `rss_feeds` table.

Idempotent: skips entries that already exist by `name`. Safe to re-run after
adding entries to `DEFAULT_FEEDS` to top-up without clobbering admin edits.

    uv run python -m api.scripts.seed_rss_feeds
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select

from api.db import SessionLocal
from api.models.admin import RssFeed
from api.services.rss import DEFAULT_FEEDS


async def main() -> None:
    async with SessionLocal() as session:
        existing = {
            row[0]
            for row in (await session.execute(select(RssFeed.name))).all()
        }
        added = 0
        for name, url in DEFAULT_FEEDS.items():
            if name in existing:
                continue
            session.add(RssFeed(name=name, url=url, enabled=True))
            added += 1
        await session.commit()
        print(f"✓ Seeded {added} new RSS feed(s). Total now: {len(existing) + added}.")


if __name__ == "__main__":
    asyncio.run(main())
