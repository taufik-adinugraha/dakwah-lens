"""One-shot backfill: fill empty `translation_id` on existing briefings.

Older briefings persisted `daleel_refs` / `adhkar_refs` JSONB with
empty `translation_id` on every hadith citation — the old batch
translator silently dropped them when its 2000-token output cap blew.
The Indonesian flyer renderer then fell back to English text below
Indonesian briefs.

This script walks every `insights_summaries` row, scans both JSONB
columns for hadith citations missing `translation_id`, uses the
cache-backed `translate_hadith_to_id` service to produce a faithful
Indonesian rendering, and UPDATEs the row in place.

Run:
    uv run python -m api.scripts.backfill_hadith_translations
    uv run python -m api.scripts.backfill_hadith_translations --dry-run
    uv run python -m api.scripts.backfill_hadith_translations --segment family

Idempotent — re-running only touches rows that still have missing
translations. Per-hadith cache means duplicate citations across rows
pay the LLM cost only once.
"""

from __future__ import annotations

import argparse
import asyncio

import structlog
from sqlalchemy import select, update

from api.db import SessionLocal
from api.models.admin import Briefing
from api.services.hadith_translation import translate_hadith_to_id

log = structlog.get_logger(__name__)


async def _backfill_refs(
    session,
    refs: list[dict] | None,
) -> tuple[list[dict] | None, int]:
    """Walk a `daleel_refs` / `adhkar_refs` list and translate any
    hadith entries with empty `translation_id`. Returns the updated
    list (a fresh copy) and the count of fills applied."""
    if not refs:
        return refs, 0
    out = [dict(r) for r in refs]
    filled = 0
    for r in out:
        if r.get("corpus") == "quran":
            continue
        if (r.get("translation_id") or "").strip():
            continue
        text_en = (r.get("translation_en") or "").strip()
        if not text_en:
            continue
        ref_id = r.get("ref_id", "")
        parts = ref_id.split("::", 1)
        if len(parts) != 2:
            continue
        corpus, hadithnumber = parts
        if not hadithnumber:
            continue
        translated = await translate_hadith_to_id(
            session, corpus, hadithnumber, text_en
        )
        if translated:
            r["translation_id"] = translated
            filled += 1
    return out, filled


async def backfill(
    segment_filter: str | None,
    dry_run: bool,
) -> None:
    async with SessionLocal() as session:
        stmt = select(Briefing).order_by(
            Briefing.generated_at.desc()
        )
        if segment_filter == "all":
            stmt = stmt.where(Briefing.theme_group.is_(None))
        elif segment_filter:
            stmt = stmt.where(Briefing.theme_group == segment_filter)

        result = await session.execute(stmt)
        rows = result.scalars().all()

        total_rows = 0
        total_daleel_fills = 0
        total_adhkar_fills = 0
        rows_modified = 0

        for row in rows:
            new_daleel, d_filled = await _backfill_refs(
                session, row.daleel_refs
            )
            new_adhkar, a_filled = await _backfill_refs(
                session, row.adhkar_refs
            )
            total_rows += 1
            total_daleel_fills += d_filled
            total_adhkar_fills += a_filled
            if d_filled == 0 and a_filled == 0:
                continue
            rows_modified += 1
            label = f"{row.segment or 'all'} @ {row.generated_at:%Y-%m-%d %H:%M}"
            print(
                f"  {label}: +{d_filled} daleel · +{a_filled} adhkar"
                f"{' [dry-run]' if dry_run else ''}"
            )
            if dry_run:
                continue
            await session.execute(
                update(Briefing)
                .where(Briefing.id == row.id)
                .values(daleel_refs=new_daleel, adhkar_refs=new_adhkar)
            )
            await session.commit()

        print()
        print(
            f"Scanned {total_rows} briefing(s) · {rows_modified} updated · "
            f"+{total_daleel_fills} daleel · +{total_adhkar_fills} adhkar"
            f"{' [dry-run]' if dry_run else ''}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="backfill_hadith_translations",
        description=(
            "Backfill missing translation_id on existing briefings "
            "by walking daleel_refs and adhkar_refs JSONB. Uses the "
            "hadith_translations_id cache."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change without writing.",
    )
    parser.add_argument(
        "--segment",
        choices=["all", "spiritual", "family", "youth", "justice"],
        help=(
            "Only backfill briefings matching this segment. 'all' means "
            "the cross-platform briefing (segment IS NULL)."
        ),
    )
    args = parser.parse_args()
    asyncio.run(backfill(args.segment, args.dry_run))


if __name__ == "__main__":
    main()
