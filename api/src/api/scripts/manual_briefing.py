"""Manual briefing generation — pipeline minus the Gemini Pro call.

Used while the Gemini Pro auto-schedule is paused (2026-05-23) to keep
LLM cost at zero during the development phase. The pipeline still runs
end-to-end (stats compute, daleel retrieval, prompt assembly) — you
just hand-roll the LLM step by pasting the prompt into Claude (chat
interface) and the response back into this script.

Subcommands:
  dump <segment> [--output FILE]
      Compute stats + retrieve daleel + assemble the prompt. Writes the
      system + user prompt to stdout or `FILE`. Paste into Claude.

  save <segment> <markdown-file>
      Read the LLM's response markdown from disk, persist to
      insights_summaries with cost=0 and model="claude-manual". Re-uses
      the stats + daleel from the most-recent matching `dump` so the
      bibliography stays anchored to the same retrieval.

  list
      Show all 5 segments + the date of the most-recent briefing for
      each. Sanity-check before running a fresh dump.

Segment values:
  all spiritual family youth justice
  ("all" → segment IS NULL, the cross-platform briefing)

Example flow (one Sunday morning):
  for seg in all spiritual family youth justice; do
    uv run python -m api.scripts.manual_briefing dump $seg \\
      --output /tmp/briefing-$seg-prompt.md
  done
  # → for each segment: paste the prompt into Claude → save reply as
  #   /tmp/briefing-<seg>-reply.md
  for seg in all spiritual family youth justice; do
    uv run python -m api.scripts.manual_briefing save $seg \\
      /tmp/briefing-$seg-reply.md
  done
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog

from api.db import SessionLocal
from api.models.admin import InsightsSummary
from api.services.insights_summary import (
    SYSTEM_PROMPT_ID,
    _build_retrieval_query,
    _build_user_prompt,
    _compute_stats,
)
from api.services.kitab_retrieval import (
    rerank_daleel,
    retrieve_daleel,
    translate_daleel_to_id,
)

log = structlog.get_logger(__name__)

VALID_SEGMENTS = {"all", "spiritual", "family", "youth", "justice"}
MODEL_TAG = "claude-manual"

# Where we stash the (stats, daleel) snapshot produced by `dump` so the
# matching `save` can persist with the SAME retrieval — otherwise the
# daleel_refs would drift between the prompt the LLM saw and the
# bibliography we store on the row.
_CACHE_DIR = Path("/tmp/dakwah-manual-briefing")


def _segment_arg(s: str | None) -> str | None:
    """Map CLI string to the DB segment column. 'all' → None."""
    if s is None:
        return None
    return None if s == "all" else s


def _segment_key(s: str | None) -> str:
    """Inverse of `_segment_arg` for cache filenames."""
    return s if s else "all"


def _validate_segment(s: str) -> str:
    if s not in VALID_SEGMENTS:
        raise SystemExit(
            f"Invalid segment: '{s}'. Use one of: {', '.join(sorted(VALID_SEGMENTS))}"
        )
    return s


def _cache_path(segment_key: str) -> Path:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _CACHE_DIR / f"{segment_key}.json"


async def _prepare_context(
    segment: str | None,
) -> tuple[dict[str, Any], list[dict[str, Any]], str, str]:
    """Run the data-prep half of the pipeline (everything BEFORE the LLM).

    Returns: (stats, daleel, system_prompt, user_prompt). Indonesian-only
    because EN generation is paused; switch SYSTEM_PROMPT_EN/ "en" here
    if you ever need to dump an English prompt.
    """
    async with SessionLocal() as session:
        stats = await _compute_stats(session, segment)
        if stats["totals"]["posts_7d"] == 0:
            raise SystemExit(
                f"No posts in the 7-day window for segment '{_segment_key(segment)}'. "
                "Aborting — there's nothing to brief on."
            )

        retrieval_query = _build_retrieval_query(stats, segment)
        candidates = retrieve_daleel(retrieval_query, limit=15, per_corpus=4)
        daleel = rerank_daleel(retrieval_query, candidates, top_n=10)
        daleel = translate_daleel_to_id(daleel)

        log.info(
            "manual_briefing.context_ready",
            segment=segment,
            daleel_count=len(daleel),
            posts_7d=stats["totals"]["posts_7d"],
        )

    user_prompt = _build_user_prompt(stats, daleel, language="id")
    return stats, daleel, SYSTEM_PROMPT_ID, user_prompt


# ──────────────────────────────────────────────────────────────────
# Subcommand: dump
# ──────────────────────────────────────────────────────────────────


async def cmd_dump(segment: str, output_path: str | None) -> None:
    seg = _segment_arg(segment)
    seg_key = _segment_key(seg)
    stats, daleel, system_prompt, user_prompt = await _prepare_context(seg)

    # Cache the (stats, daleel) for the matching `save` step. JSON keeps
    # this tool inspectable + portable across script invocations.
    cache_path = _cache_path(seg_key)
    cache_path.write_text(
        json.dumps(
            {
                "segment": seg,
                "segment_key": seg_key,
                "stats": stats,
                "daleel": daleel,
                "dumped_at_utc": datetime.now(UTC).isoformat(),
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # Assemble the full prompt as one human-readable document — system
    # instruction at the top, then the user-side context. Matches what
    # Gemini Pro receives, so Claude's output should structurally match
    # what the auto pipeline produces.
    composed = (
        f"<!-- DAKWAH-LENS MANUAL BRIEFING PROMPT -->\n"
        f"<!-- segment: {seg_key}  dumped: {datetime.now(UTC).isoformat()} -->\n"
        f"<!-- daleel pool: {len(daleel)} entries -->\n"
        f"<!-- After Claude responds, save the reply as a .md file and run: -->\n"
        f"<!--   uv run python -m api.scripts.manual_briefing save {seg_key} <reply.md> -->\n\n"
        "================================================================\n"
        "SYSTEM INSTRUCTION (this is the persona + format rules)\n"
        "================================================================\n\n"
        f"{system_prompt}\n\n"
        "================================================================\n"
        "USER PROMPT (data context — stats + daleel pool + sample headlines)\n"
        "================================================================\n\n"
        f"{user_prompt}\n"
    )

    if output_path:
        Path(output_path).write_text(composed, encoding="utf-8")
        sys.stderr.write(
            f"✓ Prompt written to {output_path} ({len(composed):,} chars).\n"
            f"  Cache: {cache_path}\n"
            f"  Next: paste {output_path} into Claude → save reply → run `save`.\n",
        )
    else:
        sys.stdout.write(composed)
        sys.stderr.write(
            f"\n[stderr] Cache: {cache_path}\n"
            f"[stderr] Next: pipe Claude's reply into `save {seg_key} <file.md>`\n",
        )


# ──────────────────────────────────────────────────────────────────
# Subcommand: save
# ──────────────────────────────────────────────────────────────────


def _basic_validate_briefing(md: str) -> None:
    """Cheap sanity check — bail before persisting an obviously-broken
    response. NOT a structural deep check; the UI tolerates malformed
    markdown but a missing Section 1 means the preview rolls up empty.
    """
    md = md.strip()
    if not md:
        raise SystemExit("Briefing markdown is empty. Aborting save.")
    if len(md) < 1500:
        raise SystemExit(
            f"Briefing is suspiciously short ({len(md):,} chars). "
            "Expected a 7,000-10,000 word content kit. Aborting save."
        )
    if md.count("\n## ") < 4:
        raise SystemExit(
            f"Only {md.count(chr(10) + '## ')} `## ` H2 sections found. "
            "Expected 5 (Ringkasan / Numerik / Tema / Strategi / Dalil). "
            "Did Claude truncate? Aborting save."
        )


async def cmd_save(segment: str, markdown_path: str) -> None:
    seg = _segment_arg(segment)
    seg_key = _segment_key(seg)

    cache_path = _cache_path(seg_key)
    if not cache_path.exists():
        raise SystemExit(
            f"No cached context for segment '{seg_key}'. "
            f"Run `dump {seg_key}` first so we know which stats/daleel pool to attach."
        )

    md_path = Path(markdown_path)
    if not md_path.exists():
        raise SystemExit(f"Markdown file not found: {markdown_path}")

    summary_md = md_path.read_text(encoding="utf-8").strip()
    _basic_validate_briefing(summary_md)

    cached = json.loads(cache_path.read_text(encoding="utf-8"))
    stats: dict[str, Any] = cached["stats"]
    daleel: list[dict[str, Any]] = cached["daleel"]

    # Belt-and-braces: don't let a stale cache get attached to a fresh
    # briefing the user dumped weeks ago.
    dumped_at = datetime.fromisoformat(cached["dumped_at_utc"])
    age_hours = (datetime.now(UTC) - dumped_at).total_seconds() / 3600.0
    if age_hours > 48:
        sys.stderr.write(
            f"⚠ Warning: cached context for '{seg_key}' is {age_hours:.1f}h old.\n"
            f"  Stats / daleel may be stale. Consider re-running `dump` first.\n"
            "  Continue anyway? [y/N] ",
        )
        if input().strip().lower() != "y":
            raise SystemExit("Aborted.")

    async with SessionLocal() as session:
        row = InsightsSummary(
            generated_at=datetime.now(UTC),
            period_start=datetime.fromisoformat(stats["period_start"]),
            period_end=datetime.fromisoformat(stats["period_end"]),
            summary_md=summary_md,
            summary_md_en=None,
            headline_stats=stats,
            model=MODEL_TAG,
            tokens_in=0,
            tokens_out=0,
            cost_usd=0.0,
            segment=seg,
            daleel_refs=daleel,
        )
        session.add(row)
        await session.commit()

        sys.stderr.write(
            f"✓ Briefing saved for segment '{seg_key}'.\n"
            f"  model={MODEL_TAG} (manual)\n"
            f"  daleel_refs={len(daleel)}\n"
            f"  body={len(summary_md):,} chars\n"
            f"  cost=$0.00\n",
        )


# ──────────────────────────────────────────────────────────────────
# Subcommand: list
# ──────────────────────────────────────────────────────────────────


async def cmd_list() -> None:
    """Show the most-recent briefing per segment so the operator knows
    which segments are stale heading into a fresh Sunday cycle."""
    from sqlalchemy import desc, select

    async with SessionLocal() as session:
        rows: list[tuple[str | None, datetime, str]] = []
        for seg_key in ["all", "spiritual", "family", "youth", "justice"]:
            seg = _segment_arg(seg_key)
            stmt = (
                select(
                    InsightsSummary.segment,
                    InsightsSummary.generated_at,
                    InsightsSummary.model,
                )
                .where(
                    InsightsSummary.segment.is_(None)
                    if seg is None
                    else InsightsSummary.segment == seg
                )
                .order_by(desc(InsightsSummary.generated_at))
                .limit(1)
            )
            result = await session.execute(stmt)
            row = result.first()
            if row:
                rows.append((row[0], row[1], row[2]))
            else:
                rows.append((seg, datetime.fromtimestamp(0, tz=UTC), "—"))

    sys.stdout.write(f"{'SEGMENT':<12} {'LAST GENERATED (UTC)':<26} {'MODEL':<24} {'AGE':>8}\n")
    sys.stdout.write("-" * 75 + "\n")
    now = datetime.now(UTC)
    for seg, ts, model in rows:
        seg_key = _segment_key(seg)
        if ts.timestamp() == 0:
            sys.stdout.write(f"{seg_key:<12} {'(never)':<26} {'—':<24} {'∞':>8}\n")
        else:
            age = now - ts
            age_str = (
                f"{int(age.total_seconds() / 86400)}d"
                if age.total_seconds() > 86400
                else f"{int(age.total_seconds() / 3600)}h"
            )
            sys.stdout.write(
                f"{seg_key:<12} {ts.strftime('%Y-%m-%d %H:%M'):<26} {model:<24} {age_str:>8}\n"
            )


# ──────────────────────────────────────────────────────────────────
# Argparse + entry
# ──────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="manual_briefing",
        description=(
            "Run the briefing pipeline with a manual Claude-in-the-loop "
            "LLM step. See the module docstring for the full flow."
        ),
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_dump = sub.add_parser(
        "dump", help="Compute stats + daleel, emit the prompt to feed Claude."
    )
    p_dump.add_argument(
        "segment",
        help=f"Segment name. One of: {', '.join(sorted(VALID_SEGMENTS))}",
    )
    p_dump.add_argument(
        "--output",
        "-o",
        help="Write prompt to this file. Default: stdout.",
        default=None,
    )

    p_save = sub.add_parser(
        "save", help="Persist Claude's reply markdown as an insights_summaries row."
    )
    p_save.add_argument(
        "segment",
        help=f"Segment name. One of: {', '.join(sorted(VALID_SEGMENTS))}",
    )
    p_save.add_argument("markdown_file", help="Path to Claude's reply (.md)")

    sub.add_parser("list", help="Show the most-recent briefing per segment.")

    args = parser.parse_args()

    if args.cmd == "dump":
        _validate_segment(args.segment)
        asyncio.run(cmd_dump(args.segment, args.output))
    elif args.cmd == "save":
        _validate_segment(args.segment)
        asyncio.run(cmd_save(args.segment, args.markdown_file))
    elif args.cmd == "list":
        asyncio.run(cmd_list())


if __name__ == "__main__":
    main()
