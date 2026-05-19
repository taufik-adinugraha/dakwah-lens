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

Idempotent across re-runs:
  - Adding a new keyword to KEYWORDS → next run inserts the (platform,
    query) pairs that don't already exist.
  - Renaming an existing keyword → add a (old, new) tuple to RENAMES and
    the next run will UPDATE the rows in place (preserving `last_run_at`
    so the rotation doesn't get skewed by treating the rename as a
    brand-new entry).

    uv run python -m api.scripts.seed_ingest_queries
"""

from __future__ import annotations

import asyncio
from typing import TypedDict

from sqlalchemy import select, update

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
    {"query": "islam", "category": "religious"},
    {"query": "ulama", "category": "religious"},
    {"query": "fatwa", "category": "religious"},
    {"query": "mualaf", "category": "religious"},
    {"query": "hijrah", "category": "religious"},
    {"query": "pesantren", "category": "religious"},
    {"query": "ibadah", "category": "religious"},
    # ── Family / akhlaq ──
    {"query": "KDRT", "category": "family"},
    {"query": "cerai", "category": "family"},
    {"query": "parenting", "category": "family"},
    {"query": "broken home", "category": "family"},
    {"query": "childfree", "category": "family"},
    {"query": "nikah", "category": "family"},
    # ── Youth / mental health ──
    {"query": "mental", "category": "youth"},
    {"query": "burnout", "category": "youth"},
    {"query": "gen z", "category": "youth"},
    {"query": "bully", "category": "youth"},
    {"query": "tawuran", "category": "youth"},
    {"query": "bunuh diri", "category": "youth"},
    {"query": "game", "category": "youth"},
    {"query": "pacaran", "category": "youth"},
    {"query": "healing", "category": "youth"},
    # ── Muamalah / economic ethics ──
    {"query": "pinjol", "category": "muamalah"},
    {"query": "judi", "category": "muamalah"},
    {"query": "paylater", "category": "muamalah"},
    {"query": "riba", "category": "muamalah"},
    {"query": "hutang", "category": "muamalah"},
    {"query": "saham", "category": "muamalah"},
    {"query": "kripto", "category": "muamalah"},
    {"query": "investasi", "category": "muamalah"},
    {"query": "suap", "category": "muamalah"},
    {"query": "korupsi", "category": "muamalah"},
    # ── Social justice ──
    {"query": "kemiskinan", "category": "social_justice"},
    {"query": "ketimpangan", "category": "social_justice"},
    {"query": "ketidakadilan", "category": "social_justice"},
    {"query": "harga naik", "category": "social_justice"},
    {"query": "meresahkan", "category": "social_justice"},
    {"query": "kekerasan", "category": "social_justice"},
    {"query": "zina", "category": "social_justice"},
    {"query": "perkosa", "category": "social_justice"},
    {"query": "mesum", "category": "social_justice"},
    {"query": "porno", "category": "social_justice"},
    # ── Education ──
    {"query": "stres", "category": "education"},
    {"query": "guru", "category": "education"},
    # ── Health ──
    {"query": "narkoba", "category": "health"},
    {"query": "olahraga", "category": "health"},
    {"query": "rokok", "category": "health"},
    # ── Current events ──
    {"query": "bencana", "category": "current_events"},
    {"query": "perang", "category": "current_events"},
    {"query": "viral", "category": "current_events"},
    {"query": "demo", "category": "current_events"},
    {"query": "politik", "category": "current_events"},
    {"query": "pejabat", "category": "current_events"},
    {"query": "begal", "category": "current_events"},
    {"query": "kriminal", "category": "current_events"},
    # ── Cultural ──
    {"query": "film", "category": "cultural"},
    {"query": "k-pop", "category": "cultural"},
    {"query": "anime", "category": "cultural"},
]


# (old_query, new_query) — applied across all platforms before the add
# loop. Use this when a keyword's spelling changes (e.g. anglicism →
# Indonesian) so we update rows in place instead of leaving stale
# duplicates behind. Each rename is idempotent: the UPDATE is a no-op
# once it's been applied (no row matches `old_query` anymore).
RENAMES: list[tuple[str, str]] = [
    ("crypto", "kripto"),
]


PLATFORMS = ("x", "instagram", "tiktok", "youtube")


async def main() -> None:
    async with SessionLocal() as session:
        # 1) Apply renames first — UPDATE in place so we keep
        # `last_run_at` and don't briefly fall back into the "never
        # used, pick me first" rotation tier.
        renamed = 0
        for old, new in RENAMES:
            result = await session.execute(
                update(IngestQuery)
                .where(IngestQuery.query == old)
                .values(query=new)
            )
            renamed += result.rowcount or 0

        # 2) Add any (platform, query) pairs that don't yet exist.
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
        f"✓ Renamed {renamed} existing rows. "
        f"Added {added} new ingest queries "
        f"(out of {total_planned} candidate (platform, query) pairs). "
        f"Skipped {total_planned - added} that already existed."
    )


if __name__ == "__main__":
    asyncio.run(main())
