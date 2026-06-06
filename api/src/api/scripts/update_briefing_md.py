"""Order-preserving briefing.summary_md updater for manual edits.

The 2026-06-06 incident: a manual psql `\\copy` + `string_agg(s, E'\\n')`
update reordered ~20 lines on prod (Q4/A4/Q5/A5 + a section heading
landed in the wrong positions) because `string_agg` makes no row-order
guarantee. The fix is trivial — `string_agg(... ORDER BY n)` against a
serial column — but easy to forget in ad-hoc psql sessions.

This script wraps the safe pattern and runs the post-write validator so
edits never silently land mis-shuffled OR with newly-introduced
anti-patterns (du'a-box trip wires, dangling citations, etc.).

Usage:
    uv run python -m api.scripts.update_briefing_md \\
        --briefing-id <uuid> \\
        --markdown /tmp/new_body.md

The Python ORM path (manual_briefing.cmd_save / cmd_apply_swaps)
already passes summary_md as a single TEXT value so they don't have
the shuffle risk this script protects against — use this script only
for one-off content patches outside the normal save/swap flows.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy import select, update

from api.db import SessionLocal
from api.models.admin import Briefing
from api.services.validate_briefing import (
    format_warnings_for_stderr,
    validate_briefing,
)


async def update_briefing_md(briefing_id: str, markdown_path: str, *, skip_validate: bool = False) -> None:
    md_path = Path(markdown_path)
    if not md_path.exists():
        raise SystemExit(f"markdown file not found: {markdown_path}")

    new_md = md_path.read_text(encoding="utf-8")
    if not new_md.strip():
        raise SystemExit("markdown is empty; aborting")

    async with SessionLocal() as session:
        row = (
            await session.execute(select(Briefing).where(Briefing.id == briefing_id))
        ).scalar_one_or_none()
        if row is None:
            raise SystemExit(f"no briefing with id={briefing_id}")

        # Run the structural validator BEFORE persisting. Heuristic
        # checks only — no API-LLM call out — so safe on any caller's
        # machine. Warnings are surfaced but don't block by default
        # (operator may be intentionally overriding a check).
        if not skip_validate:
            try:
                warnings = validate_briefing(
                    new_md,
                    daleel_pool=(row.daleel_refs or []),
                    adhkar_pool=(row.adhkar_refs or []),
                    llm_judgments=False,
                )
            except Exception as exc:
                sys.stderr.write(f"⚠ validator threw (non-fatal): {exc}\n")
                warnings = []
            sys.stderr.write(format_warnings_for_stderr(warnings) or "✓ validator clean\n")
            high_sev = [w for w in warnings if w.get("severity") == "high"]
            if high_sev:
                sys.stderr.write(
                    f"\n⚠ {len(high_sev)} HIGH-severity warning(s). Continue? [y/N] "
                )
                if input().strip().lower() != "y":
                    raise SystemExit("aborted")

        # ORM passes the full string as one TEXT value — no row-order
        # hazard here (unlike the `\\copy + string_agg` pattern that
        # bit us 2026-06-06). length asserted post-write so we catch
        # any truncation immediately.
        await session.execute(
            update(Briefing)
            .where(Briefing.id == briefing_id)
            .values(summary_md=new_md)
        )
        await session.commit()

        refreshed = (
            await session.execute(select(Briefing).where(Briefing.id == briefing_id))
        ).scalar_one()
        actual_len = len(refreshed.summary_md or "")
        expected_len = len(new_md)
        if actual_len != expected_len:
            raise SystemExit(
                f"length mismatch after write: wrote {expected_len}, "
                f"read back {actual_len} — investigate"
            )
        sys.stderr.write(
            f"✓ updated briefing {briefing_id} — {actual_len:,} chars persisted\n"
        )


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--briefing-id", required=True, help="UUID of the briefing to update")
    p.add_argument("--markdown", required=True, help="Path to the markdown file with the new body")
    p.add_argument("--skip-validate", action="store_true", help="Skip the pre-write structural validator (not recommended)")
    args = p.parse_args()
    asyncio.run(update_briefing_md(args.briefing_id, args.markdown, skip_validate=args.skip_validate))


if __name__ == "__main__":
    main()
