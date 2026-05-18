"""Seed the `ingest_queries` table with a mixed religious + societal set.

The product insight driving this list: a da'i preparing a khutbah needs to
know what problems Indonesia is actually grappling with — not only what
people who already self-identify as religious are saying. So the query
mix deliberately spans both:

  - religious vocabulary (dakwah, khutbah, ulama, fatwa, …)
  - life-issue terms (pinjol, judi online, KDRT, mental health, …)

Downstream, Gemini relevance classifier scores each scraped post against
the 9 PRD da'wah categories — so even societal-vocabulary posts get
filtered into the right categories before they reach the dashboard.

Idempotent. Safe to re-run; existing (platform, query) rows are skipped.

    uv run python -m api.scripts.seed_ingest_queries
"""

from __future__ import annotations

import asyncio
from typing import TypedDict

from sqlalchemy import select

from api.db import SessionLocal
from api.models.admin import IngestQuery


class QuerySpec(TypedDict):
    query: str
    category: str


# Same keyword set applied to X, Instagram, TikTok, YouTube. The rotation
# task picks one per platform per beat tick (least-recently-used first),
# so over a week the corpus reflects the full keyword spread.
KEYWORDS: list[QuerySpec] = [
    # ── Core da'wah vocabulary ──
    {"query": "dakwah", "category": "religious"},
    {"query": "khutbah", "category": "religious"},
    {"query": "kajian", "category": "religious"},
    {"query": "ceramah", "category": "religious"},
    {"query": "tausiyah", "category": "religious"},
    {"query": "ulama", "category": "religious"},
    {"query": "fatwa", "category": "religious"},
    {"query": "mualaf", "category": "religious"},
    {"query": "hijrah", "category": "religious"},
    {"query": "pesantren", "category": "religious"},
    # ── Family / akhlaq ──
    {"query": "KDRT", "category": "family"},
    {"query": "perceraian", "category": "family"},
    {"query": "parenting", "category": "family"},
    {"query": "keluarga muslim", "category": "family"},
    # ── Youth / mental health ──
    {"query": "mental health", "category": "youth"},
    {"query": "burnout", "category": "youth"},
    {"query": "gen z", "category": "youth"},
    {"query": "quarter life crisis", "category": "youth"},
    {"query": "bullying", "category": "youth"},
    {"query": "tawuran", "category": "youth"},
    {"query": "bunuh diri", "category": "youth"},
    # ── Muamalah / economic ethics ──
    {"query": "pinjol", "category": "muamalah"},
    {"query": "judi online", "category": "muamalah"},
    {"query": "paylater", "category": "muamalah"},
    {"query": "riba", "category": "muamalah"},
    {"query": "gaji UMR", "category": "muamalah"},
    {"query": "harga naik", "category": "muamalah"},
    # ── Social justice ──
    {"query": "kemiskinan", "category": "social_justice"},
    {"query": "ketimpangan", "category": "social_justice"},
    {"query": "kekerasan seksual", "category": "social_justice"},
    # ── Education ──
    {"query": "biaya kuliah", "category": "education"},
    {"query": "mahasiswa stres", "category": "education"},
    # ── Health ──
    {"query": "narkoba", "category": "health"},
    {"query": "vape", "category": "health"},
]


PLATFORMS = ("x", "instagram", "tiktok", "youtube")


async def main() -> None:
    async with SessionLocal() as session:
        existing = {
            (row.platform, row.query)
            for row in (
                await session.execute(
                    select(IngestQuery.platform, IngestQuery.query)
                )
            ).all()
        }
        added = 0
        for platform in PLATFORMS:
            for spec in KEYWORDS:
                key = (platform, spec["query"])
                if key in existing:
                    continue
                session.add(
                    IngestQuery(
                        platform=platform,
                        query=spec["query"],
                        category=spec["category"],
                        enabled=True,
                    )
                )
                added += 1
        await session.commit()

    total_planned = len(KEYWORDS) * len(PLATFORMS)
    print(
        f"✓ Added {added} new ingest queries "
        f"(out of {total_planned} candidate (platform, query) pairs). "
        f"Skipped {total_planned - added} that already existed."
    )


if __name__ == "__main__":
    asyncio.run(main())
