"""Manual briefing generation — pipeline minus the Gemini Pro call.

Used while the Gemini Pro auto-schedule is paused (2026-05-23) to keep
LLM cost at zero during the development phase. The pipeline still runs
end-to-end (stats compute, daleel retrieval, prompt assembly) — you
just hand-roll the LLM step by pasting the prompt into Claude (chat
interface) and the response back into this script.

Group model since 2026-06-03: a briefing is keyed by ONE of the 14
THEME_GROUPS (e.g. "Hukum & Keadilan", "Aqidah & Ibadah") instead of
the prior 4 audience-segments. The CLI accepts EITHER the group's
slug (`hukum-keadilan`, `aqidah-ibadah`, ...) OR the literal label
("Hukum & Keadilan") — slugs are stable and shell-safe; pass labels
in quotes when convenient.

Subcommands:
  dump <group> [--output FILE]
      Compute stats + retrieve daleel + assemble the prompt. Writes the
      system + user prompt to stdout or `FILE`. Paste into Claude.

  save <group> <markdown-file>
      Read the LLM's response markdown from disk, persist to
      insights_summaries with cost=0 and model="claude-manual". Re-uses
      the stats + daleel from the most-recent matching `dump` so the
      bibliography stays anchored to the same retrieval.

  list
      Show all 14 groups + the date of the most-recent briefing for
      each. Sanity-check before running a fresh dump.

  apply-swaps <group> [--swaps-file FILE]
      Apply operator-authored daleel-citation swaps to the latest
      briefing for the group.

Group values (slug form):
  hukum-keadilan, sosial-keluarga, ekonomi-bisnis, aqidah-ibadah,
  kesehatan-kehidupan, pendidikan-sdm, lingkungan-bencana,
  pemerintahan-kebijakan, patologi-sosial-digital, teknologi-ai,
  pekerja-pertanian-rakyat, konflik-geopolitik,
  inspirasi-kisah-pribadi, toleransi-lintas-iman

Example flow (one Thursday morning):
  for g in hukum-keadilan aqidah-ibadah; do
    uv run python -m api.scripts.manual_briefing dump $g \\
      --output /tmp/briefing-$g-prompt.md
  done
  # → for each group: paste the prompt into Claude → save reply as
  #   /tmp/briefing-<g>-reply.md
  for g in hukum-keadilan aqidah-ibadah; do
    uv run python -m api.scripts.manual_briefing save $g \\
      /tmp/briefing-$g-reply.md
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
from api.models.admin import Briefing
from api.services.briefing import (
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
    retrieve_kisah_pendek,
)
from api.services.theme_groups import (
    GROUP_BY_SLUG,
    THEME_GROUPS,
    slugify_group,
)

log = structlog.get_logger(__name__)

MODEL_TAG = "claude-manual"

# Where we stash the (stats, daleel) snapshot produced by `dump` so the
# matching `save` can persist with the SAME retrieval — otherwise the
# daleel_refs would drift between the prompt the LLM saw and the
# bibliography we store on the row.
_CACHE_DIR = Path("/tmp/dakwah-manual-briefing")


# ──────────────────────────────────────────────────────────────────
# Group resolution
# ──────────────────────────────────────────────────────────────────


def _resolve_group(arg: str) -> str:
    """Accept either a slug ("hukum-keadilan") or a label
    ("Hukum & Keadilan"). Returns the canonical THEME_GROUPS label.
    SystemExit with the slug menu on miss."""
    if arg in GROUP_BY_SLUG:
        return GROUP_BY_SLUG[arg]
    # Literal label match
    for tg in THEME_GROUPS:
        if tg.group == arg:
            return tg.group
    # Be forgiving: slugify whatever was passed in and look that up.
    sl = slugify_group(arg)
    if sl in GROUP_BY_SLUG:
        return GROUP_BY_SLUG[sl]
    menu = ", ".join(sorted(GROUP_BY_SLUG.keys()))
    raise SystemExit(
        f"Unknown group: {arg!r}. Use one of (slug form): {menu}"
    )


def _group_slug(group: str) -> str:
    return slugify_group(group)


def _cache_path(group_slug: str) -> Path:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _CACHE_DIR / f"{group_slug}.json"


async def _prepare_context(
    group: str,
) -> tuple[
    dict[str, Any],
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any] | None,
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
        stats = await _compute_stats(session, group)
        if stats["totals"]["posts_7d"] == 0:
            raise SystemExit(
                f"No posts in the 7-day window for group '{group}'. "
                "Aborting — there's nothing to brief on."
            )

        retrieval_query = _build_retrieval_query(stats, group)
        # Same widened-pool params as the auto pipeline
        # (generate_summary in briefing.py). limit=28
        # candidates + top_n=18 reranked gives the brief LLM a
        # genuinely thematic pool to pick from — 6 sub-sections + 6
        # Pesan Flyer slots = 12 needs, so a pool of 18 leaves real
        # choice without forcing weak fits.
        candidates = retrieve_daleel(retrieval_query, limit=28, per_corpus=6)
        daleel = rerank_daleel(retrieval_query, candidates, top_n=18)
        # Cached per-hadith ID translation. Replaces the old
        # batch-of-many Gemini call (kept failing silently at
        # 2000-token output for full pools); this version asks one
        # hadith at a time and caches in `hadith_translations_id`,
        # so first run pays the LLM cost and re-runs are SELECTs.
        from api.services.hadith_translation import enrich_daleel_translations

        daleel = await enrich_daleel_translations(session, daleel)

        # Hijri-aware calendar context — same as production path so a
        # `manual_briefing dump` reflects what `generate_summary` will
        # actually send. See services/islamic_calendar.py.
        from datetime import date as _date

        from api.services.islamic_calendar import format_calendar_context

        calendar_block, hijri_short = format_calendar_context(
            _date.today(), lookahead_days=10
        )

        # Du'a / dzikir retrieval — same theme, different query shape,
        # different pool. Feeds Pesan Flyer 5 (Sunnah call) + Flyer 6
        # (Du'a hero) so those flyers cite a recitable du'a sourced
        # from the existing kitab corpus instead of relying on the
        # LLM's parametric memory.
        dua_candidates = retrieve_dua(
            retrieval_query,
            hijri_context=hijri_short,
            limit=15,
            per_corpus=4,
        )
        adhkar = rerank_dua(retrieval_query, dua_candidates, top_n=6)
        adhkar = await enrich_daleel_translations(session, adhkar)

        # Kisah Pendek source — contiguous Al-Bidayah wan-Nihayah excerpt.
        # Mirrors `generate_briefing` so manual + auto paths render the
        # same content kit shape. None when Al-Bidayah is empty or the
        # theme had no fit; the prompt handles that by skipping the slot.
        kisah = retrieve_kisah_pendek(retrieval_query)

        log.info(
            "manual_briefing.context_ready",
            group=group,
            daleel_count=len(daleel),
            adhkar_count=len(adhkar),
            kisah_fasal=len(kisah["fasal"]) if kisah else 0,
            posts_7d=stats["totals"]["posts_7d"],
            hijri_short=hijri_short,
        )

    user_prompt = _build_user_prompt(
        stats,
        daleel,
        adhkar=adhkar,
        kisah=kisah,
        language="id",
        calendar_context=calendar_block,
    )
    return stats, daleel, adhkar, kisah, SYSTEM_PROMPT_ID, user_prompt


# ──────────────────────────────────────────────────────────────────
# Subcommand: dump
# ──────────────────────────────────────────────────────────────────


async def cmd_dump(group_arg: str, output_path: str | None) -> None:
    group = _resolve_group(group_arg)
    slug = _group_slug(group)
    stats, daleel, adhkar, kisah, system_prompt, user_prompt = (
        await _prepare_context(group)
    )

    # Cache the (stats, daleel, adhkar, kisah) for the matching `save`
    # step. JSON keeps this tool inspectable + portable across script
    # invocations.
    cache_path = _cache_path(slug)
    cache_path.write_text(
        json.dumps(
            {
                "group": group,
                "slug": slug,
                "stats": stats,
                "daleel": daleel,
                "adhkar": adhkar,
                "kisah": kisah,
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
        f"<!-- group: {group} ({slug})  dumped: {datetime.now(UTC).isoformat()} -->\n"
        f"<!-- daleel pool: {len(daleel)} entries · adhkar pool: {len(adhkar)} entries · kisah pool: {len(kisah['fasal']) if kisah else 0} fasal -->\n"
        f"<!-- After Claude responds, save the reply as a .md file and run: -->\n"
        f"<!--   uv run python -m api.scripts.manual_briefing save {slug} <reply.md> -->\n\n"
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
            f"[stderr] Next: pipe Claude's reply into `save {slug} <file.md>`\n",
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
    if md.count("\n## ") < 5:
        raise SystemExit(
            f"Only {md.count(chr(10) + '## ')} `## ` H2 sections found. "
            "Expected 6 (Ringkasan / Numerik / Tema / Poin Kunci / "
            "Strategi / Dalil). Did Claude truncate? Aborting save."
        )


async def cmd_save(group_arg: str, markdown_path: str) -> None:
    group = _resolve_group(group_arg)
    slug = _group_slug(group)

    cache_path = _cache_path(slug)
    if not cache_path.exists():
        raise SystemExit(
            f"No cached context for group '{group}'. "
            f"Run `dump {slug}` first so we know which stats/daleel pool to attach."
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
            f"⚠ Warning: cached context for '{group}' is {age_hours:.1f}h old.\n"
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

    # HARD BLOCK: flyer Dalil markers that don't exist in the saved
    # pool render with the WRONG daleel — the flyer renderer silently
    # falls back to pickFlyerDaleel(rank) when the citation lookup
    # misses. That ships mis-attributed daleel to production.
    #
    # Real bug surfaced 2026-06-07: chained `dump → save` re-ran dump
    # between writing and saving, re-retrieving a different pool from
    # Qdrant. Operator's brief was tagged against pool A; save stored
    # pool B; renderer used pool B and rendered the wrong daleel for
    # ~55% of flyers across all briefings.
    #
    # Fail early here so the operator notices BEFORE the briefing
    # ships. Other warnings stay non-fatal (informational).
    pool_warnings = [
        w for w in heuristic_warnings
        if w.get("kind") == "flyer_dalil_not_in_pool"
    ]
    if pool_warnings:
        sys.stderr.write(
            "\n✗ SAVE BLOCKED — flyer Dalil markers reference citations "
            "NOT in the saved daleel/adhkar pool. The renderer would "
            "silently render the wrong daleel on those flyers.\n\n"
        )
        for w in pool_warnings:
            sys.stderr.write(f"  · {w['where']}: {w['message']}\n")
        sys.stderr.write(
            "\n  Fix options:\n"
            "    (a) Edit the brief's `**Dalil:**` markers to use "
            "citations from the actual stored pool (re-run "
            "`dump` to see the current pool), OR\n"
            "    (b) Replace the offending `**Dalil:**` line with "
            "'`**Dalil:** —`' to skip the daleel card.\n\n"
            "  Save aborted. No row written.\n"
        )
        raise SystemExit(1)

    async with SessionLocal() as session:
        row = Briefing(
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
            # `segment` column carries the canonical group label
            # since 2026-06-03 (was a 4-segment slug).
            theme_group=group,
            daleel_refs=daleel,
            adhkar_refs=adhkar,
        )
        session.add(row)
        await session.commit()

        sys.stderr.write(
            f"✓ Briefing saved for group '{group}'.\n"
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
# Subcommand: apply-swaps
# ──────────────────────────────────────────────────────────────────


async def cmd_apply_swaps(group_arg: str, swaps_file: str | None) -> None:
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

    group = _resolve_group(group_arg)

    async with SessionLocal() as session:
        result = await session.execute(
            select(Briefing)
            .where(Briefing.theme_group == group)
            .order_by(desc(Briefing.generated_at))
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise SystemExit(f"No briefing found for group '{group}'.")

        original_md = row.summary_md
        sys.stderr.write(
            f"Loaded latest briefing for '{group}'\n"
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
            update(Briefing)
            .where(Briefing.id == row.id)
            .values(summary_md=new_md)
        )
        await session.commit()

        sys.stderr.write(
            f"✓ Updated briefing for '{group}' "
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


# ──────────────────────────────────────────────────────────────────
# Subcommand: list
# ──────────────────────────────────────────────────────────────────


async def cmd_list() -> None:
    """Show the most-recent briefing per THEME_GROUP so the operator
    knows which groups are stale heading into a fresh Thursday cycle."""
    from sqlalchemy import desc, select

    async with SessionLocal() as session:
        rows: list[tuple[str, datetime, str]] = []
        for tg in THEME_GROUPS:
            stmt = (
                select(
                    Briefing.theme_group,
                    Briefing.generated_at,
                    Briefing.model,
                )
                .where(Briefing.theme_group == tg.group)
                .order_by(desc(Briefing.generated_at))
                .limit(1)
            )
            result = await session.execute(stmt)
            row = result.first()
            if row:
                rows.append((row[0], row[1], row[2]))
            else:
                rows.append((tg.group, datetime.fromtimestamp(0, tz=UTC), "—"))

    sys.stdout.write(
        f"{'GROUP':<32} {'LAST GENERATED (UTC)':<22} {'MODEL':<24} {'AGE':>8}\n"
    )
    sys.stdout.write("-" * 90 + "\n")
    now = datetime.now(UTC)
    for group, ts, model in rows:
        if ts.timestamp() == 0:
            sys.stdout.write(f"{group:<32} {'(never)':<22} {'—':<24} {'∞':>8}\n")
        else:
            age = now - ts
            age_str = (
                f"{int(age.total_seconds() / 86400)}d"
                if age.total_seconds() > 86400
                else f"{int(age.total_seconds() / 3600)}h"
            )
            sys.stdout.write(
                f"{group:<32} {ts.strftime('%Y-%m-%d %H:%M'):<22} {model:<24} {age_str:>8}\n"
            )


async def cmd_clear(assume_yes: bool) -> None:
    """Delete ALL briefings (insights_summaries).

    Destructive: the system flyers render live FROM these rows, so they
    disappear until you regenerate via `dump` → Claude → `save`. Scoped
    strictly to `insights_summaries` — `user_flyers` (users' own
    creations) and discussion comments (keyed by briefing_slug, a plain
    text column with no FK to this table) are NOT touched.

    Requires typing the exact confirmation phrase, or `--yes` for
    scripted use.
    """
    from sqlalchemy import delete, func, select

    async with SessionLocal() as session:
        total = (
            await session.execute(select(func.count()).select_from(Briefing))
        ).scalar() or 0
        if total == 0:
            sys.stderr.write("insights_summaries is already empty — nothing to delete.\n")
            return

        sys.stderr.write(
            f"About to DELETE ALL {total} briefing row(s) from insights_summaries.\n"
            "This removes every weekly briefing + its rendered flyers. user_flyers\n"
            "and discussion comments are NOT touched. This cannot be undone.\n"
        )
        if not assume_yes:
            sys.stderr.write('Type "DELETE ALL BRIEFINGS" to confirm: ')
            sys.stderr.flush()
            if input().strip() != "DELETE ALL BRIEFINGS":
                raise SystemExit("Aborted — confirmation phrase did not match.")

        await session.execute(delete(Briefing))
        await session.commit()
        remaining = (
            await session.execute(select(func.count()).select_from(Briefing))
        ).scalar() or 0
        sys.stderr.write(
            f"✓ Deleted {total} row(s). insights_summaries now has {remaining}.\n"
            "  Regenerate with: dump <group> → Claude → save <group> <reply.md>\n"
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

    group_help = (
        "Group slug (e.g. 'hukum-keadilan') or label "
        "('Hukum & Keadilan'). See module docstring for the full list."
    )

    p_dump = sub.add_parser(
        "dump", help="Compute stats + daleel, emit the prompt to feed Claude."
    )
    p_dump.add_argument("group", help=group_help)
    p_dump.add_argument(
        "--output",
        "-o",
        help="Write prompt to this file. Default: stdout.",
        default=None,
    )

    p_save = sub.add_parser(
        "save", help="Persist Claude's reply markdown as an insights_summaries row."
    )
    p_save.add_argument("group", help=group_help)
    p_save.add_argument("markdown_file", help="Path to Claude's reply (.md)")

    sub.add_parser("list", help="Show the most-recent briefing per group.")

    p_clear = sub.add_parser(
        "clear",
        help=(
            "Delete ALL briefings (insights_summaries). Destructive — system "
            "flyers regenerate from fresh briefings. user_flyers untouched."
        ),
    )
    p_clear.add_argument(
        "--yes",
        action="store_true",
        help="Skip the typed confirmation prompt (scripted use).",
    )

    p_apply = sub.add_parser(
        "apply-swaps",
        help=(
            "Apply operator-authored daleel-citation swaps to the latest "
            "briefing for GROUP. The swap list is JSON (file or stdin) of "
            "the form "
            "[{\"flyer_index\": N, \"from\": \"X\", \"to\": \"Y\"}, ...]. "
            "No API-LLM is called — the operator's Claude session does the "
            "paragraph↔daleel judgment in-chat, then pipes the swaps here."
        ),
    )
    p_apply.add_argument("group", help=group_help)
    p_apply.add_argument(
        "--swaps-file",
        "-f",
        help="Path to JSON file with the swap list. Default: read stdin.",
        default=None,
    )

    args = parser.parse_args()

    if args.cmd == "dump":
        asyncio.run(cmd_dump(args.group, args.output))
    elif args.cmd == "save":
        asyncio.run(cmd_save(args.group, args.markdown_file))
    elif args.cmd == "list":
        asyncio.run(cmd_list())
    elif args.cmd == "clear":
        asyncio.run(cmd_clear(args.yes))
    elif args.cmd == "apply-swaps":
        asyncio.run(cmd_apply_swaps(args.group, args.swaps_file))


if __name__ == "__main__":
    main()
