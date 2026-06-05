"""Hotfix: replace whole-word `kau` / `Kau` with `kamu` / `Kamu` inside
the Mahasiswa article section of recent insights_summaries rows.

Scope:
  - Last 7 days of `insights_summaries` (this week's batch).
  - Only the substring under `### Mahasiswa: Poster, Artikel & Diskusi`
    (Indonesian) — stops at the NEXT `### ` heading or end of doc.
  - Whole-word match (`\\bkau\\b` / `\\bKau\\b`) so `kaum`, `engkau`,
    `lakukan`, `kaul` etc. are untouched.
  - Touches `summary_md` (ID). `summary_md_en` is currently NULL on all
    rows generated since 2026-05-23 (English locale disabled); the
    English Mahasiswa heading is `### Mahasiswa: Poster, Article & Discussion`
    so EN is handled if/when it returns.

Run:
    uv run python -m api.scripts.hotfix_kau_kamu             # dry-run, prints diff
    uv run python -m api.scripts.hotfix_kau_kamu --apply     # writes back

The dry-run prints the affected rows + a unified-ish diff of changed
lines so you can eyeball before committing.
"""

from __future__ import annotations

import argparse
import asyncio
import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from api.db import SessionLocal
from api.models.admin import Briefing

_MAHASISWA_HEADINGS = (
    "### Mahasiswa: Poster, Artikel & Diskusi",
    "### Mahasiswa: Poster, Article & Discussion",
)

_KAU_RE = re.compile(r"\bkau\b")
_KAU_CAP_RE = re.compile(r"\bKau\b")


def _rewrite_mahasiswa(md: str) -> tuple[str, int]:
    """Return (new_md, replacements_count). Replacements happen ONLY
    inside the Mahasiswa H3 block; everything else is untouched.
    """
    if not md:
        return md, 0

    start = -1
    for h in _MAHASISWA_HEADINGS:
        idx = md.find(h)
        if idx != -1:
            start = idx
            break
    if start == -1:
        return md, 0

    # Find next `### ` heading after this one — that's our section end.
    # `re.search` from `start + len(heading)` to skip the current heading.
    rest = md[start + 4:]
    next_h3 = re.search(r"\n### ", rest)
    end = start + 4 + next_h3.start() if next_h3 else len(md)

    before = md[:start]
    section = md[start:end]
    after = md[end:]

    new_section, n_lower = _KAU_RE.subn("kamu", section)
    new_section, n_cap = _KAU_CAP_RE.subn("Kamu", new_section)
    return before + new_section + after, n_lower + n_cap


def _changed_lines(old: str, new: str) -> list[str]:
    """Return the line-pairs that actually differ, formatted for stdout."""
    out: list[str] = []
    for o, n in zip(old.splitlines(), new.splitlines(), strict=False):
        if o != n:
            out.append(f"  - {o}")
            out.append(f"  + {n}")
    return out


async def main(apply: bool, days: int) -> None:
    cutoff = datetime.now(UTC) - timedelta(days=days)

    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(Briefing)
                .where(Briefing.generated_at >= cutoff)
                .order_by(Briefing.generated_at.desc())
            )
        ).scalars().all()

        if not rows:
            print(f"no insights_summaries rows in the last {days} days.")
            return

        total_changes = 0
        rows_changed = 0
        for r in rows:
            new_md, n = _rewrite_mahasiswa(r.summary_md or "")
            if n == 0:
                continue

            total_changes += n
            rows_changed += 1
            seg = r.segment or "all"
            print(
                f"\n[{seg}] {r.generated_at.isoformat()} — {n} replacement(s)"
            )
            for line in _changed_lines(r.summary_md, new_md):
                print(line)

            if apply:
                await session.execute(
                    update(Briefing)
                    .where(Briefing.id == r.id)
                    .values(summary_md=new_md)
                )

        if apply:
            await session.commit()
            print(
                f"\nAPPLIED. {rows_changed} row(s), {total_changes} replacement(s)."
            )
        else:
            print(
                f"\nDRY-RUN. {rows_changed} row(s) would change, "
                f"{total_changes} replacement(s) total. "
                "Re-run with --apply to write."
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes. Without this flag, runs as dry-run.",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=7,
        help="How far back to look. Default 7 (this week's batch).",
    )
    args = parser.parse_args()
    asyncio.run(main(apply=args.apply, days=args.days))
