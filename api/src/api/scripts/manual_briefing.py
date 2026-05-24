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

Example flow (one Thursday morning):
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
    rerank_dua,
    retrieve_daleel,
    retrieve_dua,
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
) -> tuple[
    dict[str, Any],
    list[dict[str, Any]],
    list[dict[str, Any]],
    str,
    str,
]:
    """Run the data-prep half of the pipeline (everything BEFORE the LLM).

    Returns: (stats, daleel, adhkar, system_prompt, user_prompt).
    Indonesian-only because EN generation is paused; switch
    SYSTEM_PROMPT_EN/ "en" here if you ever need to dump an English
    prompt.
    """
    async with SessionLocal() as session:
        stats = await _compute_stats(session, segment)
        if stats["totals"]["posts_7d"] == 0:
            raise SystemExit(
                f"No posts in the 7-day window for segment '{_segment_key(segment)}'. "
                "Aborting — there's nothing to brief on."
            )

        retrieval_query = _build_retrieval_query(stats, segment)
        # Same widened-pool params as the auto pipeline
        # (generate_summary in insights_summary.py). limit=28
        # candidates + top_n=18 reranked gives the brief LLM a
        # genuinely thematic pool to pick from — 6 sub-sections + 6
        # Pesan Flyer slots = 12 needs, so a pool of 18 leaves real
        # choice without forcing weak fits.
        candidates = retrieve_daleel(retrieval_query, limit=28, per_corpus=6)
        daleel = rerank_daleel(retrieval_query, candidates, top_n=18)
        daleel = translate_daleel_to_id(daleel)

        # Du'a / dzikir retrieval — same theme, different query shape,
        # different pool. Feeds Pesan Flyer 5 (Sunnah call) + Flyer 6
        # (Du'a hero) so those flyers cite a recitable du'a sourced
        # from the existing kitab corpus instead of relying on the
        # LLM's parametric memory.
        dua_candidates = retrieve_dua(
            retrieval_query, limit=15, per_corpus=4
        )
        adhkar = rerank_dua(retrieval_query, dua_candidates, top_n=6)
        adhkar = translate_daleel_to_id(adhkar)

        log.info(
            "manual_briefing.context_ready",
            segment=segment,
            daleel_count=len(daleel),
            adhkar_count=len(adhkar),
            posts_7d=stats["totals"]["posts_7d"],
        )

    user_prompt = _build_user_prompt(
        stats, daleel, adhkar=adhkar, language="id"
    )
    return stats, daleel, adhkar, SYSTEM_PROMPT_ID, user_prompt


# ──────────────────────────────────────────────────────────────────
# Subcommand: dump
# ──────────────────────────────────────────────────────────────────


async def cmd_dump(segment: str, output_path: str | None) -> None:
    seg = _segment_arg(segment)
    seg_key = _segment_key(seg)
    stats, daleel, adhkar, system_prompt, user_prompt = await _prepare_context(
        seg
    )

    # Cache the (stats, daleel, adhkar) for the matching `save` step.
    # JSON keeps this tool inspectable + portable across script
    # invocations.
    cache_path = _cache_path(seg_key)
    cache_path.write_text(
        json.dumps(
            {
                "segment": seg,
                "segment_key": seg_key,
                "stats": stats,
                "daleel": daleel,
                "adhkar": adhkar,
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
        f"<!-- daleel pool: {len(daleel)} entries · adhkar pool: {len(adhkar)} entries -->\n"
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
    adhkar: list[dict[str, Any]] = cached.get("adhkar", [])

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

    # Lightweight validation only — regex/heuristic checks (forbidden
    # phrases). No API-LLM calls out: paragraph↔daleel fit + advice
    # sanity + replacement suggestion are content-judgment tasks the
    # operator's Claude session does in-chat, not via a Gemini call
    # from this script. Per the project rule "no API LLM for manual
    # content judgment".
    from api.services.validate_briefing import (
        format_warnings_for_stderr,
        validate_briefing,
    )

    final_md = summary_md
    heuristic_warnings: list[dict] = []
    try:
        heuristic_warnings = validate_briefing(
            summary_md,
            daleel_pool=daleel,
            adhkar_pool=adhkar,
            llm_judgments=False,
        )
    except Exception as exc:
        sys.stderr.write(f"⚠ Validation pass failed (non-fatal): {exc}\n")

    async with SessionLocal() as session:
        row = InsightsSummary(
            generated_at=datetime.now(UTC),
            period_start=datetime.fromisoformat(stats["period_start"]),
            period_end=datetime.fromisoformat(stats["period_end"]),
            summary_md=final_md,
            summary_md_en=None,
            headline_stats=stats,
            model=MODEL_TAG,
            tokens_in=0,
            tokens_out=0,
            cost_usd=0.0,
            segment=seg,
            daleel_refs=daleel,
            adhkar_refs=adhkar,
        )
        session.add(row)
        await session.commit()

        sys.stderr.write(
            f"✓ Briefing saved for segment '{seg_key}'.\n"
            f"  model={MODEL_TAG} (manual)\n"
            f"  daleel_refs={len(daleel)} · adhkar_refs={len(adhkar)}\n"
            f"  body={len(final_md):,} chars\n"
            f"  cost=$0.00\n",
        )

    # Report heuristic warnings. Paragraph↔daleel fit + advice sanity
    # are NOT checked here on purpose — the operator runs that
    # judgment in-chat via Claude.
    warning_report = format_warnings_for_stderr(heuristic_warnings)
    if warning_report:
        sys.stderr.write("\n" + warning_report + "\n")
    else:
        sys.stderr.write(
            "✓ Heuristic validation: no forbidden phrases.\n"
            "  (Paragraph↔daleel fit + advice sanity are reviewed "
            "in-chat by the operator, not by this script.)\n",
        )


# ──────────────────────────────────────────────────────────────────
# Subcommand: list
# ──────────────────────────────────────────────────────────────────


async def cmd_apply_swaps(segment: str, swaps_file: str | None) -> None:
    """Apply a list of daleel-citation swaps to the latest briefing.

    The swap list is operator-authored — typically copy-pasted from
    Claude-in-chat after the operator reviews the briefing's
    paragraph↔daleel fit. This command does the string substitution
    and DB UPDATE; it never calls an API LLM. Per the project rule
    "no API-LLM for manual content judgment", the suggester step is
    done in-chat, not from this script.

    Swap JSON shape (read from `swaps_file` or stdin):
      [
        {"flyer_index": 1, "from": "Riyad as-Salihin 951",
         "to": "QS. Al-Hajj: 30"},
        ...
      ]
    `flyer_index` is 0-based — Pesan Flyer N → index N-1.
    """
    from sqlalchemy import desc, select, update

    from api.services.validate_briefing import (
        BriefingWarning,
        apply_daleel_autofixes,
        format_autofixes_for_stderr,
    )

    # Read swaps JSON.
    if swaps_file and swaps_file != "-":
        raw = Path(swaps_file).read_text(encoding="utf-8")
    else:
        raw = sys.stdin.read()
    try:
        swaps = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid swap JSON: {exc}") from exc
    if not isinstance(swaps, list) or not swaps:
        raise SystemExit(
            "Swap JSON must be a non-empty array of "
            '{"flyer_index": N, "from": "<citation>", "to": "<citation>"}'
        )

    # Convert to the BriefingWarning shape `apply_daleel_autofixes`
    # consumes — same string-substitution code path the auto pipeline
    # uses. We tag each swap as a daleel_mismatch so the default
    # include_weak=False still applies them.
    synthetic_warnings: list[BriefingWarning] = []
    for s in swaps:
        if not isinstance(s, dict):
            raise SystemExit(f"Each swap must be an object, got: {s!r}")
        idx = s.get("flyer_index")
        current = s.get("from")
        replacement = s.get("to")
        if (
            not isinstance(idx, int)
            or not isinstance(current, str)
            or not isinstance(replacement, str)
        ):
            raise SystemExit(
                f"Each swap needs {{flyer_index: int, from: str, to: str}}: {s!r}"
            )
        synthetic_warnings.append(
            {
                "kind": "daleel_mismatch",
                "severity": "high",
                "where": f"Pesan Flyer {idx + 1}",
                "message": "operator-applied swap",
                "flyer_index": idx,
                "current_citation": current,
                "suggested_citation": replacement,
            }
        )

    seg = _segment_arg(segment)
    seg_key = _segment_key(seg)

    async with SessionLocal() as session:
        result = await session.execute(
            select(InsightsSummary)
            .where(
                InsightsSummary.segment.is_(None)
                if seg is None
                else InsightsSummary.segment == seg
            )
            .order_by(desc(InsightsSummary.generated_at))
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise SystemExit(f"No briefing found for segment '{seg_key}'.")

        original_md = row.summary_md
        sys.stderr.write(
            f"Loaded latest briefing for '{seg_key}'\n"
            f"  generated_at={row.generated_at.isoformat()}\n"
            f"  body={len(original_md):,} chars\n"
            f"  swaps requested: {len(swaps)}\n\n"
        )

        new_md, applied = apply_daleel_autofixes(
            original_md, synthetic_warnings, include_weak=False
        )
        skipped = [s for s in swaps if not any(
            a["from"] == s["from"] and a["to"] == s["to"] for a in applied
        )]

        if not applied:
            sys.stderr.write(
                "⚠ No swaps applied — none of the `from` citations "
                "matched the markdown. Possible drift: re-check the slug "
                "and flyer_index, or the briefing may have been edited.\n"
            )
            return

        await session.execute(
            update(InsightsSummary)
            .where(InsightsSummary.id == row.id)
            .values(summary_md=new_md)
        )
        await session.commit()

        sys.stderr.write(
            f"✓ Updated briefing for '{seg_key}' "
            f"({len(applied)} citation"
            f"{'s' if len(applied) != 1 else ''} rewritten)\n"
        )
        sys.stderr.write(format_autofixes_for_stderr(applied) + "\n")
        if skipped:
            sys.stderr.write(
                f"⚠ {len(skipped)} swap(s) skipped (citation drift — not "
                "found in markdown):\n",
            )
            for s in skipped:
                sys.stderr.write(
                    f"  · Flyer {s['flyer_index'] + 1}: "
                    f"'{s['from']}' → '{s['to']}'\n"
                )


async def cmd_list() -> None:
    """Show the most-recent briefing per segment so the operator knows
    which segments are stale heading into a fresh Thursday cycle."""
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

    p_apply = sub.add_parser(
        "apply-swaps",
        help=(
            "Apply operator-authored daleel-citation swaps to the latest "
            "briefing for SEGMENT. The swap list is JSON (file or stdin) of "
            "the form "
            "[{\"flyer_index\": N, \"from\": \"X\", \"to\": \"Y\"}, ...]. "
            "No API-LLM is called — the operator's Claude session does the "
            "paragraph↔daleel judgment in-chat, then pipes the swaps here."
        ),
    )
    p_apply.add_argument(
        "segment",
        help=f"Segment name. One of: {', '.join(sorted(VALID_SEGMENTS))}",
    )
    p_apply.add_argument(
        "--swaps-file",
        "-f",
        help="Path to JSON file with the swap list. Default: read stdin.",
        default=None,
    )

    args = parser.parse_args()

    if args.cmd == "dump":
        _validate_segment(args.segment)
        asyncio.run(cmd_dump(args.segment, args.output))
    elif args.cmd == "save":
        _validate_segment(args.segment)
        asyncio.run(cmd_save(args.segment, args.markdown_file))
    elif args.cmd == "list":
        asyncio.run(cmd_list())
    elif args.cmd == "apply-swaps":
        _validate_segment(args.segment)
        asyncio.run(cmd_apply_swaps(args.segment, args.swaps_file))


if __name__ == "__main__":
    main()
