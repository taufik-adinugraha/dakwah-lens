"""Manual briefing generation — pure-Claude two-stage flow.

Replaces the old single-pass `dump` (which called Gemini Flash-Lite for
rerank + kisah picker + hadith translation) with a two-stage flow that
keeps every LLM judgment with Claude in chat. The retrieval-side
embedding similarity (OpenAI) still runs in-script; everything that
USED to call Gemini Flash-Lite is now either:
  (a) skipped — the full unranked pool is dumped for Claude to filter
  (b) deferred to Claude in chat (kisah source pick, hadith translation)

Refactor 2026-06-24, per operator rule: "manual workflow must be done
by YOU (Claude), no Gemini, no Claude API calls from the script."

Group model since 2026-06-03: a briefing is keyed by ONE of the 14
THEME_GROUPS (e.g. "Hukum & Keadilan", "Aqidah & Ibadah") instead of
the prior 4 audience-segments. The CLI accepts EITHER the group's
slug (`hukum-keadilan`, `aqidah-ibadah`, ...) OR the literal label
("Hukum & Keadilan") — slugs are stable and shell-safe; pass labels
in quotes when convenient.

Subcommands:
  dump-candidates <group> [--output FILE]
      STAGE 1: compute stats + retrieve full unranked pools (28 daleel,
      15 du'a, 4 kisah seeds). Emits a markdown summary for Claude to
      read in chat. Cache-misses for hadith ID translations surface as
      a separate section so Claude can translate them in chat too.

  dump-prompt <group> --picks <picks.json> [--output FILE]
      STAGE 2: apply Claude's picks (18 daleel citations + 6 du'a
      citations + 1 kisah kitab slug + optional translation overrides)
      to the cached candidate pools and emit the final prompt for the
      composition step.

  save <group> <markdown-file>
      Read Claude's response markdown from disk, run the 17 scan_*
      validators (with `llm_judgments=False` — no API LLM judgment),
      and persist to insights_summaries with cost=0 model="claude-manual".

  cache-translation <citation> <text_en> <text_id>
      Persist a Claude-supplied hadith ID translation to the
      `hadith_translations_id` cache so future runs are free SELECTs.

  list / clear / apply-swaps / dump-occasion / save-occasion /
  list-occasions — unchanged from prior flows.

Picks JSON schema (the operator hands Claude the candidates dump and
gets back something like this):
  {
    "daleel_picks": ["Sahih Muslim 1135", ...],          # exactly 18
    "dua_picks":    ["QS. Adh-Dhaariyat: 18", ...],      # exactly 6
    "kisah_kitab":  "al_bidayah_wan_nihayah",            # one of 4 (or null)
    "hadith_translations": {                              # optional, for cache misses
      "Sahih al-Bukhari 4737": "<Indonesian translation>"
    }
  }

Group values (slug form):
  hukum-keadilan, sosial-keluarga, ekonomi-bisnis, aqidah-ibadah,
  kesehatan-kehidupan, pendidikan-sdm, lingkungan-bencana,
  pemerintahan-kebijakan, patologi-sosial-digital, teknologi-ai,
  pekerja-pertanian-rakyat, konflik-geopolitik,
  inspirasi-kisah-pribadi, toleransi-lintas-iman

Example flow (one Thursday morning):
  uv run python -m api.scripts.manual_briefing dump-candidates hukum-keadilan \\
    --output /tmp/cand-hukum-keadilan.md
  # → paste into Claude → Claude returns picks JSON → save to /tmp/picks-h-k.json

  uv run python -m api.scripts.manual_briefing dump-prompt hukum-keadilan \\
    --picks /tmp/picks-h-k.json \\
    --output /tmp/prompt-hukum-keadilan.md
  # → paste into Claude → Claude composes briefing → save reply to /tmp/reply-h-k.md

  uv run python -m api.scripts.manual_briefing save hukum-keadilan /tmp/reply-h-k.md
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime, timedelta
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
    build_kisah_for_corpus,
    retrieve_daleel,
    retrieve_dua,
    retrieve_kisah_pendek_unranked,
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
#
# Path priority (resolved at import time):
#   1. /data/attachments/manual-briefing-cache — PERSISTENT bind-mount in
#      prod (host /srv/dakwah-lens/data/attachments survives container
#      restarts). Required because every deploy restarts dakwah-lens-api-1
#      and wipes /tmp, breaking the dump→edit-in-Claude→save flow whenever
#      a deploy lands between the two steps. Resolved 2026-06-18 after
#      every save in a 14-theme batch needed a manual re-dump before save.
#   2. /tmp/dakwah-manual-briefing — local dev fallback (no /data mount).
def _resolve_cache_dir() -> Path:
    persistent = Path("/data/attachments/manual-briefing-cache")
    try:
        persistent.mkdir(parents=True, exist_ok=True)
        # Test write — catches permission errors that mkdir didn't see
        probe = persistent / ".write_probe"
        probe.touch()
        probe.unlink()
        return persistent
    except (OSError, PermissionError):
        return Path("/tmp/dakwah-manual-briefing")


_CACHE_DIR = _resolve_cache_dir()


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


async def _prepare_unranked_candidates(
    group: str,
) -> dict[str, Any]:
    """Two-stage flow STEP 1: run retrieval, skip every Gemini call.

    Replaces the old `_prepare_context` (removed 2026-06-24 to pull
    Gemini Flash-Lite out of the manual loop). The auto pipeline still
    uses the Flash-Lite reranks — see `briefing.generate_briefing`.

    Pipeline shape:
      - Embedding retrieval over kitab corpus (OpenAI — kept, not Gemini)
      - Per-corpus top-1 kisah seeds (4 candidates, NO Flash-Lite picker)
      - Cache lookup for hadith ID translations (NO Gemini fallback)

    Returns a dict with everything Claude needs to make picks in chat:
      stats, retrieval_query, daleel_candidates (28), dua_candidates (15),
      kisah_seeds (≤4), translation_misses (citations needing chat
      translation), calendar_block, hijri_short.
    """
    async with SessionLocal() as session:
        stats = await _compute_stats(session, group)
        if stats["totals"]["posts_7d"] == 0:
            raise SystemExit(
                f"No posts in the 7-day window for group '{group}'. "
                "Aborting — there's nothing to brief on."
            )

        retrieval_query = _build_retrieval_query(stats, group)

        # 28 candidates — no rerank. Auto pipeline reranks to 18 with
        # Flash-Lite; here Claude picks 18 in chat from the full pool.
        daleel_candidates = retrieve_daleel(
            retrieval_query, limit=28, per_corpus=6
        )

        # Calendar context — local engine, no LLM.
        from datetime import date as _date

        from api.services.islamic_calendar import format_calendar_context

        calendar_block, hijri_short = format_calendar_context(
            _date.today(), lookahead_days=10
        )

        # 15 du'a candidates — no rerank. Same logic as daleel: Claude
        # picks 6 in chat.
        dua_candidates = retrieve_dua(
            retrieval_query,
            hijri_context=hijri_short,
            limit=15,
            per_corpus=4,
        )

        # Kisah seeds — 4 candidates (per-corpus top-1, no Flash-Lite
        # source picker). Claude picks one in chat, `dump-prompt` then
        # materializes the contiguous window via `build_kisah_for_corpus`.
        kisah_seeds = retrieve_kisah_pendek_unranked(retrieval_query)

        # Translation cache — read-only lookup. Cache hits fill
        # translation_id in-place; misses surface in `translation_misses`
        # for Claude to translate in chat (then persist via
        # `cache-translation` subcommand).
        from api.services.hadith_translation import lookup_cached_translations

        daleel_candidates, daleel_misses = await lookup_cached_translations(
            session, daleel_candidates
        )
        dua_candidates, dua_misses = await lookup_cached_translations(
            session, dua_candidates
        )

        translation_misses = daleel_misses + dua_misses

        log.info(
            "manual_briefing.candidates_ready",
            group=group,
            daleel_candidates=len(daleel_candidates),
            dua_candidates=len(dua_candidates),
            kisah_seeds=len(kisah_seeds),
            translation_misses=len(translation_misses),
            posts_7d=stats["totals"]["posts_7d"],
            hijri_short=hijri_short,
        )

    return {
        "stats": stats,
        "retrieval_query": retrieval_query,
        "daleel_candidates": daleel_candidates,
        "dua_candidates": dua_candidates,
        "kisah_seeds": kisah_seeds,
        "translation_misses": translation_misses,
        "calendar_block": calendar_block,
        "hijri_short": hijri_short,
    }


def _build_picks_context(
    group: str,
    candidates: dict[str, Any],
    picks: dict[str, Any],
) -> tuple[
    dict[str, Any],
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any] | None,
    str,
    str,
]:
    """Two-stage flow STEP 2: apply Claude's picks to the unranked pools.

    `picks` schema (operator-supplied via `dump-prompt --picks`):
        {
          "daleel_picks": ["Sahih Muslim 1135", ...],   # 18 citations
          "dua_picks":    ["QS. Adh-Dhaariyat: 18", ...], # 6 citations
          "kisah_kitab":  "al_bidayah_wan_nihayah",     # one of 4 slugs
          "hadith_translations": {                       # for cache misses
              "Sahih al-Bukhari 4737": "...ID translation text..."
          }
        }

    Returns the same shape `_prepare_context` used to return so the
    downstream `_build_user_prompt` call is unchanged.
    """
    stats = candidates["stats"]
    daleel_candidates = candidates["daleel_candidates"]
    dua_candidates = candidates["dua_candidates"]
    kisah_seeds = candidates["kisah_seeds"]
    calendar_block = candidates["calendar_block"]

    # Index by citation for O(1) lookup.
    daleel_by_citation = {d["citation"]: d for d in daleel_candidates}
    dua_by_citation = {d["citation"]: d for d in dua_candidates}

    # Filter daleel + dua to picks, in picks-supplied order.
    daleel_picks = picks.get("daleel_picks") or []
    dua_picks = picks.get("dua_picks") or []
    daleel = [daleel_by_citation[c] for c in daleel_picks if c in daleel_by_citation]
    adhkar = [dua_by_citation[c] for c in dua_picks if c in dua_by_citation]

    missing_daleel = [c for c in daleel_picks if c not in daleel_by_citation]
    missing_dua = [c for c in dua_picks if c not in dua_by_citation]
    if missing_daleel or missing_dua:
        raise SystemExit(
            f"Picks reference citations not in the candidate pool — "
            f"likely a stale candidates cache.\n"
            f"  Missing daleel: {missing_daleel}\n"
            f"  Missing dua:    {missing_dua}\n"
            f"  Re-run `dump-candidates` to refresh the pool."
        )

    # Inject Claude-supplied translations for cache misses.
    overrides = picks.get("hadith_translations") or {}
    for hit in daleel + adhkar:
        translation = overrides.get(hit.get("citation"))
        if translation:
            hit["translation_id"] = translation

    # Materialize the kisah window for the chosen source.
    kisah = None
    kisah_kitab = picks.get("kisah_kitab")
    if kisah_kitab:
        seed = next((s for s in kisah_seeds if s["corpus"] == kisah_kitab), None)
        if seed is None:
            raise SystemExit(
                f"Picks reference kisah_kitab={kisah_kitab!r} which is not "
                f"in the candidate seeds. Available: "
                f"{[s['corpus'] for s in kisah_seeds]}"
            )
        kisah = build_kisah_for_corpus(
            seed["corpus"], seed["payload"], seed["score"]
        )

    # Flyer pools — restricted to 11-kitab whitelist (FLYER_ALLOWED_CORPORA).
    # Auto pipeline applies this same filter; without it the prompt's
    # `if flyer_daleel_pool:` falls through to the empty-pool branch.
    from api.services.kitab_retrieval import FLYER_ALLOWED_CORPORA

    flyer_allowed = set(FLYER_ALLOWED_CORPORA)
    flyer_daleel_pool = [
        d for d in daleel if d.get("corpus") in flyer_allowed
    ]
    flyer_adhkar_pool = [
        a for a in adhkar if a.get("corpus") in flyer_allowed
    ]

    log.info(
        "manual_briefing.picks_applied",
        group=group,
        daleel=len(daleel),
        adhkar=len(adhkar),
        kisah_fasal=len(kisah["fasal"]) if kisah else 0,
        flyer_daleel=len(flyer_daleel_pool),
        flyer_adhkar=len(flyer_adhkar_pool),
        translation_overrides=len(overrides),
    )

    user_prompt = _build_user_prompt(
        stats,
        daleel,
        adhkar=adhkar,
        kisah=kisah,
        language="id",
        calendar_context=calendar_block,
        flyer_daleel_pool=flyer_daleel_pool,
        flyer_adhkar_pool=flyer_adhkar_pool,
    )
    return stats, daleel, adhkar, kisah, SYSTEM_PROMPT_ID, user_prompt


# ──────────────────────────────────────────────────────────────────
# Subcommand: dump-candidates  (STAGE 1 of the two-stage flow)
# ──────────────────────────────────────────────────────────────────


def _candidates_cache_path(group_slug: str) -> Path:
    """Companion to `_cache_path` — stores the unranked candidate pools
    so `dump-prompt` can read them after Claude picks in chat."""
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _CACHE_DIR / f"{group_slug}_candidates.json"


def _format_candidates_markdown(
    group: str, slug: str, candidates: dict[str, Any]
) -> str:
    """Human-readable summary of the candidate pools for Claude in chat.

    Lists every daleel (28) + du'a (15) + kisah (4) candidate with its
    citation, corpus, score, and Arabic preview so Claude can choose
    18 daleel + 6 du'a + 1 kisah from the full pool — replacing what
    Gemini Flash-Lite did in the old pipeline.
    """
    stats = candidates["stats"]
    daleel = candidates["daleel_candidates"]
    dua = candidates["dua_candidates"]
    kisah = candidates["kisah_seeds"]
    misses = candidates["translation_misses"]

    lines = [
        "<!-- DAKWAH-LENS MANUAL BRIEFING — STAGE 1: candidates -->",
        f"<!-- group: {group} ({slug})  dumped: {datetime.now(UTC).isoformat()} -->",
        f"<!-- posts_7d: {stats['totals']['posts_7d']}  hijri: {candidates['hijri_short']} -->",
        "<!-- After picking, save picks JSON and run: -->",
        f"<!--   manual_briefing dump-prompt {slug} --picks <picks.json> -->",
        "",
        f"# Daleel candidates ({len(daleel)} — pick 18)",
        "",
    ]
    for i, d in enumerate(daleel, 1):
        cit = d.get("citation", "?")
        corpus = d.get("corpus", "?")
        score = d.get("score") or d.get("similarity", 0)
        score_s = f"{score:.3f}" if isinstance(score, (int, float)) else "?"
        ar = (d.get("arabic") or "")[:200].replace("\n", " ")
        trn = (d.get("translation_id") or d.get("translation_en") or "")[:200].replace("\n", " ")
        lines.append(f"## {i}. {cit}  [{corpus} · sim={score_s}]")
        lines.append(f"AR: {ar}")
        lines.append(f"ID/EN: {trn}")
        lines.append("")

    lines.append(f"# Du'a candidates ({len(dua)} — pick 6)")
    lines.append("")
    for i, d in enumerate(dua, 1):
        cit = d.get("citation", "?")
        corpus = d.get("corpus", "?")
        score = d.get("score") or d.get("similarity", 0)
        score_s = f"{score:.3f}" if isinstance(score, (int, float)) else "?"
        ar = (d.get("arabic") or "")[:200].replace("\n", " ")
        trn = (d.get("translation_id") or d.get("translation_en") or "")[:200].replace("\n", " ")
        lines.append(f"## {i}. {cit}  [{corpus} · sim={score_s}]")
        lines.append(f"AR: {ar}")
        lines.append(f"ID/EN: {trn}")
        lines.append("")

    lines.append(f"# Kisah Pendek seeds ({len(kisah)} — pick 1 kitab)")
    lines.append("")
    if not kisah:
        lines.append("(no above-threshold seed — picks.kisah_kitab can be null)")
        lines.append("")
    for i, k in enumerate(kisah, 1):
        lines.append(
            f"## {i}. corpus = `{k['corpus']}`  "
            f"[{k['source_label_id']} · score={k['score']:.3f}]"
        )
        lines.append(f"Title: {k.get('title','(untitled)')}")
        lines.append(f"AR preview: {k['preview']}")
        lines.append("")

    if misses:
        lines.append(f"# Translation cache misses ({len(misses)})")
        lines.append("")
        lines.append(
            "Cache lookup found no Indonesian translation for these hadith. "
            "Translate each in chat and include them in `picks.hadith_translations`. "
            "After save, run `cache-translation` to persist for next time."
        )
        lines.append("")
        for m in misses:
            lines.append(f"## {m['citation']}  [{m['corpus']} · #{m['hadithnumber']}]")
            lines.append(f"EN: {m['text_en'][:500]}")
            lines.append("")

    return "\n".join(lines)


async def cmd_dump_candidates(group_arg: str, output_path: str | None) -> None:
    group = _resolve_group(group_arg)
    slug = _group_slug(group)

    candidates = await _prepare_unranked_candidates(group)

    # Cache the unranked candidates so `dump-prompt` can apply Claude's
    # picks without re-running retrieval.
    cand_path = _candidates_cache_path(slug)
    cand_path.write_text(
        json.dumps(
            {
                "group": group,
                "slug": slug,
                **candidates,
                "dumped_at_utc": datetime.now(UTC).isoformat(),
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    md = _format_candidates_markdown(group, slug, candidates)

    if output_path:
        Path(output_path).write_text(md, encoding="utf-8")
        sys.stderr.write(
            f"✓ Candidates written to {output_path} ({len(md):,} chars).\n"
            f"  Cache: {cand_path}\n"
            f"  Misses: {len(candidates['translation_misses'])} hadith need Claude translation\n"
            f"  Next: paste {output_path} into Claude → get picks.json →\n"
            f"        manual_briefing dump-prompt {slug} --picks <picks.json>\n",
        )
    else:
        sys.stdout.write(md)
        sys.stderr.write(
            f"\n[stderr] Cache: {cand_path}\n"
            f"[stderr] Misses: {len(candidates['translation_misses'])}\n",
        )


# ──────────────────────────────────────────────────────────────────
# Subcommand: dump-prompt  (STAGE 2 of the two-stage flow)
# ──────────────────────────────────────────────────────────────────


async def cmd_dump_prompt(
    group_arg: str, picks_path: str, output_path: str | None
) -> None:
    group = _resolve_group(group_arg)
    slug = _group_slug(group)

    cand_path = _candidates_cache_path(slug)
    if not cand_path.exists():
        raise SystemExit(
            f"Candidates cache missing for {slug}: {cand_path}\n"
            f"Run `dump-candidates {slug}` first."
        )
    candidates = json.loads(cand_path.read_text(encoding="utf-8"))

    picks = json.loads(Path(picks_path).read_text(encoding="utf-8"))
    stats, daleel, adhkar, kisah, system_prompt, user_prompt = (
        _build_picks_context(group, candidates, picks)
    )

    # Write the legacy cache (`<slug>.json`) so `cmd_save` can find the
    # picks-applied pools — same shape as the old `cmd_dump` wrote.
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
                "picks_source": picks_path,
                "dumped_at_utc": datetime.now(UTC).isoformat(),
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    composed = (
        f"<!-- DAKWAH-LENS MANUAL BRIEFING — STAGE 2: prompt -->\n"
        f"<!-- group: {group} ({slug})  dumped: {datetime.now(UTC).isoformat()} -->\n"
        f"<!-- daleel: {len(daleel)} · adhkar: {len(adhkar)} · kisah: {len(kisah['fasal']) if kisah else 0} fasal -->\n"
        f"<!-- After Claude responds, save the reply as a .md file and run: -->\n"
        f"<!--   manual_briefing save {slug} <reply.md> -->\n\n"
        "================================================================\n"
        "SYSTEM INSTRUCTION (persona + format rules)\n"
        "================================================================\n\n"
        f"{system_prompt}\n\n"
        "================================================================\n"
        "USER PROMPT (stats + Claude-picked daleel pool + headlines)\n"
        "================================================================\n\n"
        f"{user_prompt}\n"
    )

    if output_path:
        Path(output_path).write_text(composed, encoding="utf-8")
        sys.stderr.write(
            f"✓ Prompt written to {output_path} ({len(composed):,} chars).\n"
            f"  Cache: {cache_path}\n"
            f"  Next: paste {output_path} into Claude → save reply →\n"
            f"        manual_briefing save {slug} <reply.md>\n",
        )
    else:
        sys.stdout.write(composed)


# ──────────────────────────────────────────────────────────────────
# Subcommand: cache-translation  (persist Claude-supplied translations)
# ──────────────────────────────────────────────────────────────────


async def cmd_cache_translation(
    citation: str, text_en: str, text_id: str
) -> None:
    """Persist a Claude-supplied hadith translation to the cache.

    Lookup keys: `citation` is parsed into corpus + hadithnumber via the
    same convention used by `lookup_cached_translations`. For citations
    that don't follow the "<Collection> <number>" shape (e.g.,
    section-titled classical kitabs), this fails loudly — those have no
    cache entry to fill.
    """
    from api.services.hadith_translation import cache_translation as _cache

    # Citation forms we expect: "Sahih Muslim 1135", "Sahih al-Bukhari 4737",
    # "Riyad as-Salihin 1251", "Bulugh al-Maram 788". The corpus_id slug
    # in our DB is lower-cased + hyphenated.
    citation = citation.strip()
    corpus_map = {
        "Sahih Muslim": "muslim",
        "Sahih al-Bukhari": "bukhari",
        "Riyad as-Salihin": "riyad_as_salihin",
        "Bulugh al-Maram": "bulugh_al_maram",
    }
    corpus_slug = None
    hadithnumber = None
    for prefix, slug in corpus_map.items():
        if citation.startswith(prefix + " "):
            corpus_slug = slug
            hadithnumber = citation[len(prefix) + 1 :].strip()
            break
    if corpus_slug is None or not hadithnumber:
        raise SystemExit(
            f"Citation {citation!r} doesn't look like a hadith number citation. "
            f"Supported prefixes: {sorted(corpus_map.keys())}"
        )

    async with SessionLocal() as session:
        await _cache(
            session, corpus_slug, hadithnumber, text_en, text_id
        )
    sys.stderr.write(
        f"✓ Cached translation for {citation} ({corpus_slug}:{hadithnumber})\n"
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
        # No auto-redump in the two-stage flow: a fresh `dump-candidates`
        # would lose Claude's picks (different pool order, possibly
        # different candidates). Force the operator to re-run the
        # two-stage dance with the same picks instead. The persistent
        # cache dir (/data/attachments/manual-briefing-cache) survives
        # container restarts so this should rarely trigger.
        raise SystemExit(
            f"Cache missing for '{group}' at {cache_path}.\n"
            f"  → Two-stage flow has no idempotent auto-redump (would\n"
            f"    drop Claude's picks). Re-run:\n"
            f"      manual_briefing dump-candidates {slug}\n"
            f"      # Claude picks in chat → save picks.json\n"
            f"      manual_briefing dump-prompt {slug} --picks <picks.json>\n"
            f"    then `save` again."
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

    # POOL TOP-UP via refetch-by-citation. When a flyer Dalil marker
    # points to a citation NOT in the saved pool, the renderer silently
    # falls back to `pickFlyerDaleel(rank)` and ships the WRONG daleel.
    # Until 2026-06-19 the workaround was either em-dashing the marker
    # (still triggers the silent fallback — just via a different code
    # path) or asking the operator to rewrite the Dalil line manually.
    # Both paths lose the daleel-first methodology.
    #
    # The structural fix: when a citation doesn't resolve, refetch the
    # exact chunk from Qdrant via `retrieve_by_citation` and append to
    # the saved pool. The composer's choice survives end-to-end; the
    # renderer finds the citation; no fallback; no em-dash. Real bug
    # 2026-06-18 batch: 75% of saved Dalil markers were em-dashed by
    # the band-aid path because compose-time + save-time semantic
    # searches returned different top-K. Refetch closes the gap.
    #
    # If refetch fails (unparseable citation OR no matching chunk in
    # Qdrant), THEN hard-fail — that's a real composer error, not a
    # pool-drift artifact. See AGENTS.md
    # [FLYER DALEEL-FIRST — INVIOLABLE] + 2026-06-19 incident note.
    pool_warnings = [
        w for w in heuristic_warnings
        if w.get("kind") == "flyer_dalil_not_in_pool"
    ]
    if pool_warnings:
        from api.services.kitab_retrieval import retrieve_by_citation

        unresolved: list[dict] = []
        refetched_daleel: list[dict] = []
        refetched_adhkar: list[dict] = []
        for w in pool_warnings:
            citation = (w.get("current_citation") or "").strip()
            flyer_idx = w.get("flyer_index")
            if not citation:
                unresolved.append(w)
                continue
            hit = retrieve_by_citation(citation)
            if hit is None:
                unresolved.append(w)
                continue
            # Pesan Flyer 5+6 (idx 4, 5 — 0-based) pin to the adhkar pool;
            # 1-4 pin to the daleel pool.
            if isinstance(flyer_idx, int) and flyer_idx in (4, 5):
                refetched_adhkar.append(hit)
            else:
                refetched_daleel.append(hit)

        if refetched_daleel or refetched_adhkar:
            # Dedup against the existing pool by citation string so a
            # second save doesn't double-insert.
            existing_d = {d.get("citation", "") for d in daleel}
            existing_a = {d.get("citation", "") for d in adhkar}
            added_d = [h for h in refetched_daleel if h["citation"] not in existing_d]
            added_a = [h for h in refetched_adhkar if h["citation"] not in existing_a]
            daleel = daleel + added_d
            adhkar = adhkar + added_a
            sys.stderr.write(
                f"\n↻ Refetched {len(added_d)} daleel + {len(added_a)} adhkar "
                f"by exact citation from Qdrant (top-up). "
                f"Composer-picked daleel survives end-to-end; renderer "
                f"will find every Dalil marker. Re-running pool "
                f"validation.\n"
            )
            for h in added_d + added_a:
                sys.stderr.write(f"    + {h['citation']}\n")
            # Re-validate with the topped-up pool. The pool_warnings list
            # should now be empty for any citation that refetched.
            heuristic_warnings = validate_briefing(
                summary_md,
                daleel_pool=daleel,
                adhkar_pool=adhkar,
                llm_judgments=False,
            )
            pool_warnings = [
                w for w in heuristic_warnings
                if w.get("kind") == "flyer_dalil_not_in_pool"
            ]
            unresolved = pool_warnings  # whatever's left after refetch

        if unresolved:
            sys.stderr.write(
                "\n✗ SAVE BLOCKED — flyer Dalil markers reference "
                "citations that don't resolve in the saved pool AND "
                "couldn't be refetched from Qdrant (citation unparseable "
                "or no matching chunk). Refetch closes the gap when the "
                "composer picks a real-but-out-of-pool daleel; it can't "
                "rescue a fabricated citation.\n\n"
            )
            for w in unresolved:
                sys.stderr.write(f"  · {w['where']}: {w['message']}\n")
            sys.stderr.write(
                "\n  Fix: verify each unresolved `**Dalil:**` marker "
                "points to a real chunk in Qdrant (correct kitab name, "
                "exact verse/hadith number, exact section descriptor "
                "for AR-only kitabs). Copy the citation verbatim from "
                "the FLYER POOL block in the original prompt. NEVER use "
                "`**Dalil:** —` to bypass — that triggers the silent "
                "fallback we're trying to eliminate.\n\n"
                "  Save aborted. No row written.\n"
            )
            raise SystemExit(1)

    # Same hard-fail discipline for structural flyer-section problems —
    # added 2026-06-08 after Inspirasi & Toleransi briefings shipped
    # with `### Pesan Flyer N` blocks nested under `## Dalil & Sumber`
    # (no top-level `## Pesan Flyer` H2). The web flyer extractor needs
    # the H2 wrapper; without it 4 of 6 flyers rendered unrelated
    # content from a legacy fallback. Catch this BEFORE save so the
    # operator can re-structure the markdown.
    structure_warnings = [
        w for w in heuristic_warnings
        if w.get("kind") == "flyer_section_malformed"
    ]
    if structure_warnings:
        sys.stderr.write(
            "\n✗ SAVE BLOCKED — flyer section is structurally malformed. "
            "The web renderer needs a top-level `## Pesan Flyer` H2 "
            "containing exactly 6 `### Pesan Flyer N` H3 blocks. "
            "Without it, the renderer silently falls back to legacy "
            "extraction and ships unrelated content as the flyer body.\n\n"
        )
        for w in structure_warnings:
            sys.stderr.write(f"  · {w['where']}: {w['message']}\n")
        sys.stderr.write(
            "\n  Fix: add `## Pesan Flyer` as its own H2 line "
            "(separate from `## Dalil & Sumber`) directly above the "
            "first `### Pesan Flyer 1` block, and ensure all 6 blocks "
            "live under it.\n\n"
            "  Save aborted. No row written.\n"
        )
        raise SystemExit(1)

    # Same hard-fail discipline for headline-quality problems — added
    # 2026-06-08 after Inspirasi & Toleransi briefings shipped with 12
    # flyers MISSING `**Headline:**` markers (renderer fell back to
    # extracting body's first words → all rendered as title "Pekan
    # ini"). Generic template headlines like "Pesan Pekan Ini" / "Doa
    # Pekan Ini" / "Renungan Mingguan" are equally forbidden because
    # they look identical across all 14 briefings in the IG gallery.
    headline_warnings = [
        w for w in heuristic_warnings
        if w.get("kind") == "flyer_headline_missing_or_generic"
    ]
    if headline_warnings:
        sys.stderr.write(
            "\n✗ SAVE BLOCKED — flyer headline(s) are MISSING or GENERIC. "
            "Each Pesan Flyer 1-6 needs a `**Headline:** \"...\"` line "
            "right under its H3 heading with a punchy 4-6 word title. "
            "Without a marker the renderer falls back to extracting the "
            "first words of the body (real bug: 12 flyers rendered with "
            "title 'Pekan ini'). Generic template phrases defeat the "
            "eye-catching purpose — every flyer looks identical in the "
            "IG gallery.\n\n"
        )
        for w in headline_warnings:
            sys.stderr.write(f"  · {w['where']}: {w['message']}\n")
        sys.stderr.write(
            "\n  Fix: add or rewrite each flyer's `**Headline:** \"...\"` "
            "with a punchy 4-6 word title specific to that flyer's "
            "message (e.g. 'Mulai Adil dari Meja Sendiri', 'Cukupkan "
            "Takaran di Setiap Transaksi', 'Allah Haramkan Kezaliman "
            "atas Diri-Nya'). Avoid 'Pekan ini', 'Pesan Pekan Ini', "
            "'Renungan Mingguan', 'Doa Pekan Ini', 'Suara Khutbah'.\n\n"
            "  Save aborted. No row written.\n"
        )
        raise SystemExit(1)

    # Flyer-independence hard-fail. Added 2026-06-19 after a batch
    # shipped with 80+ of 84 flyers carrying staged-narrator framings
    # ("Jamaah Jumat pekan ini...", "Mimbar pekan ini...", "Takmir dan
    # pengurus RT pekan ini...", "Kreator dakwah pekan ini...",
    # "Mahasiswa pekan ini...") + cross-deliverable references ("Bawa
    # ini ke khutbah", "Khateeb membingkai..."). The flyer is a
    # standalone IG/WA share-card — the reader has no briefing context,
    # so audience-staged framing leaks scaffolding that doesn't belong.
    # See AGENTS.md [FLYER INDEPENDENCE — INVIOLABLE].
    independence_warnings = [
        w for w in heuristic_warnings
        if w.get("kind") == "flyer_independence_violation"
    ]
    if independence_warnings:
        sys.stderr.write(
            "\n✗ SAVE BLOCKED — Pesan Flyer body references another "
            "deliverable in the same briefing, or uses staged-narrator "
            "framing. Flyers are STANDALONE IG/WA share-cards — the "
            "reader has NO briefing context. References to "
            "khutbah/kultum/kajian/kreator/aksi-sosial/mahasiswa "
            "leak briefing scaffolding into the share-card. Staged "
            "narrators (jamaah Jumat / mimbar / takmir / pengurus RT / "
            "kreator pekan ini / mahasiswa pekan ini) make the flyer "
            "read like an internal memo, not a public message.\n\n"
        )
        for w in independence_warnings:
            sys.stderr.write(f"  · {w['where']}: {w['message']}\n")
        sys.stderr.write(
            "\n  Fix: rewrite the body addressed universally to the "
            "reader. Open from the daleel's principle directly "
            "('Hadits ini menamai pelakunya dengan tegas: ...', "
            "'Ketika fitnah meluas dan banyak orang justru "
            "bingung...') or from the contemporary pattern without "
            "a narrator ('Sebagian dari kita tanpa sadar duduk di "
            "kursi itu...'). The action handle at the end addresses "
            "the reader ('Audit satu aplikasi malam ini...'), NOT a "
            "sub-section operator ('Khatib menutup...', 'Takmir "
            "agendakan...'). See AGENTS.md "
            "[FLYER INDEPENDENCE — INVIOLABLE].\n\n"
            "  Save aborted. No row written.\n"
        )
        raise SystemExit(1)

    # ── LAYER-3 FACT-CHECK GATE (added 2026-06-18 after audit caught 12
    # critical fabrications in v3 batch) ──────────────────────────────
    # Calls Claude Sonnet 4.6 to scan the briefing body for name-role
    # paraphrase fabrications against the cached sample_headlines (this
    # week's mainstream ID news as ground truth). Returns warnings; ANY
    # 'high' severity warning is a defamation-risk fabrication and the
    # save is hard-failed.
    #
    # This is the load-bearing safety net — Layer 1 (composer self-
    # check) and Layer 2 (workflow Verify phase) are advisory / operator-
    # initiated; this layer fires automatically every save.
    #
    # Cost: ~$0.01-0.03 per save on Sonnet. ~$0.50/week for 14 briefings.
    # Skipped (returns []) if ANTHROPIC_API_KEY is unset or sample_headlines
    # is empty — i.e. local dev / pre-prod paths can run without it.
    from api.services.validate_briefing import scan_news_paraphrase_facts

    fact_warnings: list[dict] = []
    try:
        sample_h = stats.get("sample_headlines") or []
        fact_warnings = scan_news_paraphrase_facts(summary_md, sample_h)
    except Exception as exc:
        log.warning("manual_briefing.fact_check_failed", error=str(exc))

    critical_facts = [w for w in fact_warnings if w.get("severity") == "high"]
    if critical_facts:
        sys.stderr.write(
            "\n✗ SAVE BLOCKED — briefing contains factual fabrications. "
            "The Claude judge cross-referenced the briefing body against "
            "this week's mainstream Indonesian news headlines and found "
            "named-entity claims that have NO supporting headline. These "
            "are defamation-risk and must be hedged or removed before "
            "save.\n\n"
        )
        for w in critical_facts:
            sys.stderr.write(f"  · [{w['where']}] {w['message']}\n\n")
        sys.stderr.write(
            "\n  Fix options:\n"
            "    (a) Replace the named-entity claim with hedged language "
            "('diskursus yang ramai dibicarakan' / 'kembali muncul' "
            "instead of asserting as fact), OR\n"
            "    (b) Remove the specific claim and replace with a general "
            "pattern that doesn't name a specific person/institution, OR\n"
            "    (c) If the claim IS verified by a headline not in the "
            "sample_headlines pool, edit the briefing to reference the "
            "actual headline more closely so the judge can match.\n\n"
            "  This gate fires automatically on every save — it cannot be "
            "bypassed without an ANTHROPIC_API_KEY=unset. Save aborted.\n"
        )
        raise SystemExit(1)

    # Non-critical (medium/low) fact warnings go to the operator-review
    # block alongside the existing heuristic warnings — they don't block
    # save but are surfaced so the operator can eyeball before publish.
    medium_low_facts = [w for w in fact_warnings if w.get("severity") != "high"]
    if medium_low_facts:
        heuristic_warnings.extend(medium_low_facts)

    async with SessionLocal() as session:
        from sqlalchemy import delete, select

        now = datetime.now(UTC)
        # One briefing row per (theme_group, calendar day). The web layer
        # derives each briefing's slug as `YYYY-MM-DD-<group>` (Asia/
        # Jakarta date), so a same-day re-save must REPLACE the existing
        # row, not accumulate. A plain INSERT used to leave a duplicate
        # behind on every re-save — the /m "other rooms" rail then showed
        # the same theme twice and 81 rows piled up for the 2026-06-18
        # batch (cleaned 2026-06-26). Drop same-theme rows whose
        # generated_at lands on today's Jakarta date, then insert.
        # (Jakarta = UTC+7, no DST, so the +7h shift is exact.)
        jakarta_today = (now + timedelta(hours=7)).date()
        existing = (
            await session.execute(
                select(Briefing.id, Briefing.generated_at).where(
                    Briefing.theme_group == group
                )
            )
        ).all()
        stale = [
            bid
            for bid, gen in existing
            if (gen + timedelta(hours=7)).date() == jakarta_today
        ]
        if stale:
            await session.execute(delete(Briefing).where(Briefing.id.in_(stale)))
            sys.stderr.write(
                f"  ↻ replaced {len(stale)} same-day row(s) for "
                f"'{group}' ({jakarta_today}) — re-save, not duplicate.\n"
            )

        row = Briefing(
            generated_at=now,
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
# Subcommands: dump-occasion / save-occasion / list-occasions
# (15th-track Islamic-calendar briefings — sibling to dump/save above)
# ──────────────────────────────────────────────────────────────────


async def _prepare_occasion_context(
    slug: str,
) -> tuple[
    Any,  # OccasionEntry
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    str,
    str,
]:
    """Data-prep half of the occasion-mode pipeline (everything BEFORE
    Claude composes). Pure-Claude (no Gemini) since 2026-06-24.

    Returns: (entry, daleel, adhkar, flyer_daleel_pool,
              flyer_adhkar_pool, trending_headlines, translation_misses,
              system_prompt, user_prompt). All Indonesian.

    `translation_misses` lists hadith citations needing Claude
    translation in chat — write them back later via `cache-translation`.
    Cache hits are filled in-place on `daleel` / `adhkar`.
    """
    from datetime import date as _date

    from api.services.briefing import (
        OCCASION_SYSTEM_PROMPT_ID,
        _build_occasion_user_prompt,
    )
    from api.services.kitab_retrieval import (
        FLYER_ALLOWED_CORPORA,
        retrieve_dua,
        retrieve_occasion_daleel,
    )
    from api.services.occasion_catalog import get_by_slug
    from api.services.trending_headlines import fetch_trending_headlines

    entry = get_by_slug(slug)
    if entry is None:
        raise SystemExit(
            f"Unknown occasion slug '{slug}'. "
            "Run `list-occasions` to see upcoming entries from "
            "api/src/api/catalogs/hijri_occasions.yaml."
        )

    # Thematic daleel pool — semantic search on YAML query_template.
    # NO rerank (occasion path uses the full embedding-ranked pool — same
    # as the auto path; composer picks via citation, not via Gemini).
    candidates = retrieve_occasion_daleel(slug, limit=24, per_corpus=4)
    async with SessionLocal() as session:
        # Read-only cache lookup, no Gemini fallback. Cache misses
        # surface for Claude to translate in chat; persist later via
        # `manual_briefing cache-translation`.
        from api.services.hadith_translation import lookup_cached_translations

        daleel, daleel_misses = await lookup_cached_translations(
            session, candidates
        )

        # Adhkar pool — du'a/dzikir biased query for Flyer 5+6 slots.
        # Reuse retrieve_dua with the occasion's query_template + name
        # as the Hijri context so the embedding lands near seasonal du'a.
        dua_candidates = retrieve_dua(
            entry.query_template,
            hijri_context=entry.hijri_date,
            limit=15,
            per_corpus=4,
        )
        adhkar, dua_misses = await lookup_cached_translations(
            session, dua_candidates
        )
        translation_misses = daleel_misses + dua_misses

        # Trending headlines as supporting evidence, only when the
        # catalog opted in.
        if entry.include_trending_headlines:
            trending = await fetch_trending_headlines(
                session, limit=8, period_days=7
            )
        else:
            trending = []

    # Flyer-pool filter: 11-kitab whitelist subset of daleel + adhkar.
    flyer_allowed = set(FLYER_ALLOWED_CORPORA)
    flyer_daleel_pool = [d for d in (daleel or []) if d.get("corpus") in flyer_allowed]
    flyer_adhkar_pool = [a for a in (adhkar or []) if a.get("corpus") in flyer_allowed]

    log.info(
        "manual_briefing.occasion_context_ready",
        slug=slug,
        daleel_count=len(daleel),
        adhkar_count=len(adhkar),
        flyer_daleel=len(flyer_daleel_pool),
        flyer_adhkar=len(flyer_adhkar_pool),
        trending=len(trending),
        translation_misses=len(translation_misses),
        gregorian=entry.gregorian_date.isoformat(),
    )

    user_prompt = _build_occasion_user_prompt(
        entry,
        today_gregorian=_date.today(),
        daleel=daleel,
        adhkar=adhkar,
        flyer_daleel_pool=flyer_daleel_pool,
        flyer_adhkar_pool=flyer_adhkar_pool,
        trending_headlines=trending,
        language="id",
    )
    return (
        entry,
        daleel,
        adhkar,
        flyer_daleel_pool,
        flyer_adhkar_pool,
        trending,
        translation_misses,
        OCCASION_SYSTEM_PROMPT_ID,
        user_prompt,
    )


async def cmd_dump_occasion(slug: str, output_path: str | None) -> None:
    """Compute occasion-mode pool + prompt, write cache, emit prompt.

    Pure-Claude since 2026-06-24: no Gemini calls in this path. Cache
    misses for hadith ID translations are appended to the dumped prompt
    as an explicit "TRANSLATION MISSES" block so Claude can translate
    them inline during composition. Persist translations later via
    `manual_briefing cache-translation`.
    """
    (
        entry,
        daleel,
        adhkar,
        flyer_daleel_pool,
        flyer_adhkar_pool,
        trending,
        translation_misses,
        system_prompt,
        user_prompt,
    ) = await _prepare_occasion_context(slug)

    cache_path = _cache_path(slug)
    cache_path.write_text(
        json.dumps(
            {
                "mode": "occasion",
                "occasion_slug": slug,
                "entry": {
                    "slug": entry.slug,
                    "name": entry.name,
                    "hijri_year": entry.hijri_year,
                    "hijri_date": entry.hijri_date,
                    "gregorian_date": entry.gregorian_date.isoformat(),
                    "query_template": entry.query_template,
                    "include_trending_headlines": entry.include_trending_headlines,
                    "confirmed": entry.confirmed,
                    "notes": entry.notes,
                },
                "daleel": daleel,
                "adhkar": adhkar,
                "flyer_daleel_pool": flyer_daleel_pool,
                "flyer_adhkar_pool": flyer_adhkar_pool,
                "trending_headlines": trending,
                "translation_misses": translation_misses,
                "dumped_at_utc": datetime.now(UTC).isoformat(),
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # Translation-miss block — surface cache misses for Claude.
    if translation_misses:
        miss_block_lines = [
            "================================================================",
            "TRANSLATION CACHE MISSES (translate these in chat)",
            "================================================================",
            "",
            f"The hadith_translations_id cache has no Indonesian translation for "
            f"the {len(translation_misses)} hadith below. Provide ID translations "
            f"inline in your briefing where you cite them, then persist them after "
            f"save with:",
            "  manual_briefing cache-translation \"<citation>\" \"<text_en>\" \"<text_id>\"",
            "",
        ]
        for m in translation_misses:
            miss_block_lines.append(f"## {m['citation']}  [{m['corpus']} #{m['hadithnumber']}]")
            miss_block_lines.append(f"EN: {m['text_en']}")
            miss_block_lines.append("")
        miss_block = "\n".join(miss_block_lines) + "\n"
    else:
        miss_block = ""

    composed = (
        f"<!-- DAKWAH-LENS MANUAL OCCASION BRIEFING PROMPT (pure-Claude) -->\n"
        f"<!-- occasion: {entry.name} ({entry.slug})  "
        f"gregorian: {entry.gregorian_date}  "
        f"dumped: {datetime.now(UTC).isoformat()} -->\n"
        f"<!-- daleel pool: {len(daleel)} entries · adhkar pool: "
        f"{len(adhkar)} entries · trending headlines: {len(trending)} · "
        f"translation misses: {len(translation_misses)} -->\n"
        f"<!-- After Claude responds, save the reply as a .md file and run: -->\n"
        f"<!--   uv run python -m api.scripts.manual_briefing save-occasion "
        f"{slug} <reply.md> -->\n\n"
        "================================================================\n"
        "SYSTEM INSTRUCTION (occasion-mode persona + 7-section structure)\n"
        "================================================================\n\n"
        f"{system_prompt}\n\n"
        "================================================================\n"
        "USER PROMPT (occasion context + daleel pool + supporting headlines)\n"
        "================================================================\n\n"
        f"{user_prompt}\n\n"
        f"{miss_block}"
    )

    if output_path:
        Path(output_path).write_text(composed, encoding="utf-8")
        sys.stderr.write(
            f"✓ Occasion prompt written to {output_path} "
            f"({len(composed):,} chars).\n"
            f"  Cache: {cache_path}\n"
            f"  Translation misses: {len(translation_misses)} "
            f"(surfaced in prompt for Claude to translate)\n"
            f"  Next: paste {output_path} into Claude → save reply → "
            f"`save-occasion {slug} <reply.md>`.\n",
        )
    else:
        sys.stdout.write(composed)
        sys.stderr.write(
            f"\n[stderr] Occasion cache: {cache_path}\n"
            f"[stderr] Translation misses: {len(translation_misses)}\n"
            f"[stderr] Next: pipe Claude's reply into "
            f"`save-occasion {slug} <file.md>`\n",
        )


async def cmd_save_occasion(slug: str, markdown_path: str) -> None:
    """Persist Claude's reply for an occasion briefing.

    Same validator chain as the weekly save path — the new
    `scan_occasion_section_structure` validator fires automatically
    via `validate_briefing()`. Hard-fails on any `high` severity
    `occasion_section_malformed` warning (composer drifted to weekly
    template). Flyer pool refetch + independence + headline checks
    apply unchanged.
    """
    from api.models.admin import Briefing
    from api.services.occasion_catalog import get_by_slug
    from api.services.validate_briefing import (
        format_warnings_for_stderr,
        validate_briefing,
    )

    entry = get_by_slug(slug)
    if entry is None:
        raise SystemExit(
            f"Unknown occasion slug '{slug}'. "
            "Add it to api/src/api/catalogs/hijri_occasions.yaml first."
        )

    cache_path = _cache_path(slug)
    if not cache_path.exists():
        # Occasion path's auto-redump is safe: no Claude-judgment step
        # in dump-occasion (the YAML query + embeddings + cache lookup
        # are all deterministic). Daleel pool may drift slightly if the
        # corpus was re-embedded between dump and save, but refetch +
        # save-time pool top-up handles citation mismatches.
        sys.stderr.write(
            f"⚠ Occasion cache for '{slug}' missing at {cache_path}\n"
            f"  → Auto-redumping (likely a container restart wiped the cache).\n"
        )
        await cmd_dump_occasion(slug, None)
        if not cache_path.exists():
            raise SystemExit(
                f"Auto-redump failed to create cache at {cache_path}. "
                f"Run `dump-occasion {slug}` manually and check logs."
            )

    md_path = Path(markdown_path)
    if not md_path.exists():
        raise SystemExit(f"Markdown file not found: {markdown_path}")
    summary_md = md_path.read_text(encoding="utf-8").strip()
    if not summary_md or len(summary_md) < 1500:
        raise SystemExit(
            f"Occasion briefing markdown looks empty or truncated "
            f"({len(summary_md):,} chars). Aborting save."
        )

    cached = json.loads(cache_path.read_text(encoding="utf-8"))
    daleel: list[dict[str, Any]] = cached["daleel"]
    adhkar: list[dict[str, Any]] = cached.get("adhkar", [])
    flyer_daleel = cached.get("flyer_daleel_pool") or []
    flyer_adhkar = cached.get("flyer_adhkar_pool") or []

    # Run the standard validator chain. Occasion-mode validator fires
    # via auto-detection on '## Kalender Hijriah' / '## Konteks & Hikmah'
    # H2s. Flyer pool checks use the FLYER-restricted pools.
    try:
        heuristic_warnings = validate_briefing(
            summary_md,
            daleel_pool=daleel,
            adhkar_pool=adhkar,
            flyer_daleel_pool=flyer_daleel,
            flyer_adhkar_pool=flyer_adhkar,
            llm_judgments=False,
        )
    except Exception as exc:
        sys.stderr.write(f"⚠ Validation pass failed (non-fatal): {exc}\n")
        heuristic_warnings = []

    # HARD-FAIL on occasion structural drift (composer reverted to
    # weekly template midway, partial drift, etc.).
    occ_struct_high = [
        w
        for w in heuristic_warnings
        if w.get("kind") == "occasion_section_malformed"
        and w.get("severity") == "high"
    ]
    if occ_struct_high:
        sys.stderr.write(
            "\n✗ SAVE BLOCKED — occasion briefing has structural drift "
            "between weekly + occasion templates:\n\n"
        )
        for w in occ_struct_high:
            sys.stderr.write(f"  · {w['where']}: {w['message']}\n")
        sys.stderr.write(
            "\n  Fix the markdown (rename H2s to occasion-mode names + "
            "remove any '## Numerik & Tren' / '## Tema Utama' sections "
            "the composer left behind), then re-run save-occasion.\n"
            "  Save aborted. No row written.\n"
        )
        raise SystemExit(1)

    # Reuse the same flyer pool + headline + structure hard-fails the
    # weekly save path enforces.
    pool_warnings = [
        w
        for w in heuristic_warnings
        if w.get("kind") == "flyer_dalil_not_in_pool"
    ]
    if pool_warnings:
        # Try refetch-by-citation top-up before failing.
        from api.services.kitab_retrieval import retrieve_by_citation

        refetched_d: list[dict[str, Any]] = []
        refetched_a: list[dict[str, Any]] = []
        unresolved: list[dict[str, Any]] = []
        for w in pool_warnings:
            citation = (w.get("current_citation") or "").strip()
            flyer_idx = w.get("flyer_index")
            if not citation:
                unresolved.append(w)
                continue
            hit = retrieve_by_citation(citation)
            if hit is None:
                unresolved.append(w)
                continue
            if isinstance(flyer_idx, int) and flyer_idx in (4, 5):
                refetched_a.append(hit)
            else:
                refetched_d.append(hit)
        if refetched_d or refetched_a:
            existing_d = {d.get("citation", "") for d in daleel}
            existing_a = {d.get("citation", "") for d in adhkar}
            added_d = [h for h in refetched_d if h["citation"] not in existing_d]
            added_a = [h for h in refetched_a if h["citation"] not in existing_a]
            daleel = daleel + added_d
            adhkar = adhkar + added_a
            sys.stderr.write(
                f"\n↻ Refetched {len(added_d)} daleel + {len(added_a)} "
                f"adhkar by exact citation. Re-running pool validation.\n"
            )
            heuristic_warnings = validate_briefing(
                summary_md,
                daleel_pool=daleel,
                adhkar_pool=adhkar,
                flyer_daleel_pool=flyer_daleel,
                flyer_adhkar_pool=flyer_adhkar,
                llm_judgments=False,
            )
            pool_warnings = [
                w
                for w in heuristic_warnings
                if w.get("kind") == "flyer_dalil_not_in_pool"
            ]
            unresolved = pool_warnings
        if unresolved:
            sys.stderr.write(
                "\n✗ SAVE BLOCKED — flyer Dalil markers don't resolve in "
                "pool AND couldn't be refetched.\n\n"
            )
            for w in unresolved:
                sys.stderr.write(f"  · {w['where']}: {w['message']}\n")
            raise SystemExit(1)

    # Flyer independence hard-fail (same rule as weekly).
    independence_warnings = [
        w
        for w in heuristic_warnings
        if w.get("kind") == "flyer_independence_violation"
    ]
    if independence_warnings:
        sys.stderr.write(
            "\n✗ SAVE BLOCKED — Pesan Flyer body references another "
            "deliverable / uses staged-narrator framing:\n\n"
        )
        for w in independence_warnings:
            sys.stderr.write(f"  · {w['where']}: {w['message']}\n")
        raise SystemExit(1)

    # Persist. theme_group = 'Acara Kalender Islam' (15th track).
    # period_start / period_end frame the 14-day window around the
    # occasion's gregorian date (matches the cron's lookahead).
    period_start = datetime.combine(
        entry.gregorian_date - timedelta(days=14),
        datetime.min.time(),
    ).replace(tzinfo=UTC)
    period_end = datetime.combine(
        entry.gregorian_date + timedelta(days=7),
        datetime.min.time(),
    ).replace(tzinfo=UTC)

    async with SessionLocal() as session:
        from sqlalchemy import delete, select

        # One row per occasion (keyed by occasion_slug). A re-save of the
        # same occasion REPLACES the prior row instead of accumulating —
        # same insert-not-upsert bug the weekly cmd_save had (the plain
        # INSERT left a duplicate on every re-save). Drop prior rows for
        # this occasion, then insert.
        existing = (
            await session.execute(
                select(Briefing.id).where(Briefing.occasion_slug == slug)
            )
        ).scalars().all()
        if existing:
            await session.execute(delete(Briefing).where(Briefing.id.in_(existing)))
            sys.stderr.write(
                f"  ↻ replaced {len(existing)} prior row(s) for occasion "
                f"'{slug}' — re-save, not duplicate.\n"
            )

        row = Briefing(
            generated_at=datetime.now(UTC),
            period_start=period_start,
            period_end=period_end,
            summary_md=summary_md,
            summary_md_en=None,
            headline_stats={
                "mode": "occasion",
                "occasion_slug": slug,
                "occasion_name": entry.name,
                "hijri_year": entry.hijri_year,
                "hijri_date": entry.hijri_date,
                "gregorian_date": entry.gregorian_date.isoformat(),
                "trending_headlines_used": len(cached.get("trending_headlines", [])),
            },
            model=MODEL_TAG,
            tokens_in=0,
            tokens_out=0,
            cost_usd=0.0,
            theme_group="Acara Kalender Islam",
            occasion_slug=slug,
            daleel_refs=daleel,
            adhkar_refs=adhkar,
        )
        session.add(row)
        await session.commit()

    sys.stderr.write(
        f"✓ Occasion briefing saved: {entry.name} ({slug}).\n"
        f"  model={MODEL_TAG} (manual)\n"
        f"  daleel_refs={len(daleel)} · adhkar_refs={len(adhkar)}\n"
        f"  body={len(summary_md):,} chars\n"
        f"  period={period_start.date()} → {period_end.date()}\n"
    )

    warning_report = format_warnings_for_stderr(heuristic_warnings)
    if warning_report:
        sys.stderr.write("\n" + warning_report + "\n")


async def cmd_list_occasions(lookahead_days: int = 14) -> None:
    """Print the occasion catalog entries whose Gregorian date falls
    within the next `lookahead_days`. Operator uses this to decide
    which occasion to dump next."""
    from datetime import date as _date

    from api.services.occasion_catalog import upcoming

    upcoming_entries = upcoming(now=_date.today(), lookahead_days=lookahead_days)
    if not upcoming_entries:
        sys.stdout.write(
            f"No occasions in the next {lookahead_days} days. "
            "Catalog: api/src/api/catalogs/hijri_occasions.yaml\n"
        )
        return
    sys.stdout.write(
        f"Upcoming occasions in the next {lookahead_days} days:\n\n"
    )
    for o in upcoming_entries:
        days = (o.gregorian_date - _date.today()).days
        confirmed = "✓" if o.confirmed else "⚠ approx"
        sys.stdout.write(
            f"  {o.slug:<30} {o.hijri_date:<32} "
            f"{o.gregorian_date.isoformat()} (in {days}d) [{confirmed}]\n"
            f"  {'':<30} {o.name}\n\n"
        )
    sys.stdout.write(
        "Run: uv run python -m api.scripts.manual_briefing "
        "dump-occasion <slug>\n"
    )


# ──────────────────────────────────────────────────────────────────
# Argparse + entry
# ──────────────────────────────────────────────────────────────────



# ──────────────────────────────────────────────────────────────────
# Fiqh Pekan Ini (16th track): dump-fiqh / save-fiqh
#
# Weekly fiqh briefing = top-4 fiqh issues of the last 7d, each as a
# news-anchored article (~900-1,300 words) that REPORTS the ruling
# landscape (positions attributed to retrieved kitab dalil or to
# authorities as reported in the news) and NEVER issues its own tarjih.
# Replaces "Strategi & Aksi Dakwah"; NO Pesan Flyer, NO poster.
#
# Flow (pure-Claude, zero Gemini — same discipline as the weekly +
# occasion paths):
#   1. Operator's Claude session picks 4 issues from the 7d corpus and
#      writes issues.json: {"issues": [{"title", "query", "context"}x4]}
#   2. dump-fiqh issues.json → per-issue Qdrant retrieval builds the
#      daleel pool, caches it, emits the composition prompt.
#   3. Claude composes in chat → save-fiqh reply.md validates
#      (fiqh-specific structural hard-fails + generic heuristics) and
#      upserts the Briefing row (theme_group='Fiqh Pekan Ini').
# ──────────────────────────────────────────────────────────────────

FIQH_GROUP = "Fiqh Pekan Ini"
FIQH_CACHE_SLUG = "fiqh-pekan-ini"

FIQH_SYSTEM_PROMPT = """Kamu menyusun BRIEFING FIQH PEKAN INI untuk platform Dakwah-Lens: 4 isu fiqh terhangat dari percakapan publik Indonesia 7 hari terakhir, masing-masing dibahas dalam satu artikel yang berpijak pada berita nyata.

STRUKTUR WAJIB (H2 persis seperti ini, berurutan):
## Ringkasan Eksekutif
## Poin Kunci
## Artikel Fiqh Pekan Ini
## Dalil & Sumber

Di bawah "## Artikel Fiqh Pekan Ini" tulis paragraf pengantar singkat, lalu TEPAT 4 sub-bagian H3 dengan pola persis:
### Artikel 1 — "<judul punchy 4-7 kata>"
### Artikel 2 — "<judul punchy 4-7 kata>"
### Artikel 3 — "<judul punchy 4-7 kata>"
### Artikel 4 — "<judul punchy 4-7 kata>"

SETIAP ARTIKEL (900-1.300 kata prosa + blok Tanya-Jawab; total per artikel maks ±1.700 kata) mengikuti alur:
1. Peristiwa — apa yang terjadi pekan ini dan apa yang sedang ditanyakan umat (anchor ke berita di prompt; JANGAN mengarang detail; ikuti disiplin parafrase-berita: setiap atribusi nama/peran harus bisa ditelusuri ke headline).
2. Pertanyaan fiqh — rumuskan pertanyaannya secara presisi.
3. Peta pandangan — LAPORKAN posisi-posisi yang ada, JANGAN memutuskan tarjih sendiri. Setiap dalil WAJIB diambil verbatim dari DALEEL POOL di prompt (kutip teks Arab pada barisnya sendiri + terjemahan + sitasi persis seperti di pool). Posisi lembaga (MUI/NU/Muhammadiyah dll.) hanya boleh dikutip bila termuat di berita pada prompt — kutip sebagai BERITA, bukan sebagai dalil.
4. Panduan praktis — langkah bijak yang bisa diambil pembaca hari ini, nada rahmah dan hikmah.
5. Tanya-Jawab — sub-bagian dengan heading persis `#### Tanya-Jawab` berisi 3-4 pasang pertanyaan-jawaban. Pertanyaan = suara akar rumput yang NYATA (gaya bertanya jamaah/warganet, first-person, diambil dari pola keresahan di konteks berita — mis. "Saya sudah terlanjur…", "Kalau cuma ikut-ikutan…", "Bagaimana dengan…"). Format tiap pasang: baris `**T:** <pertanyaan>` lalu `**J:** <jawaban 2-4 kalimat>`. Jawaban mengikuti aturan yang sama: atribusi posisi, dalil hanya dari pool (boleh merujuk dalil yang sudah dikutip artikel), akhiri dengan arahan ke ulama bila menyangkut keputusan pribadi.
6. Penutup wajib — ajakan eksplisit merujuk ke ulama/ustadz setempat untuk keputusan pribadi (frasa mengandung kata "ulama").

ATURAN KERAS:
- Setiap referensi Islam HARUS berasal dari DALEEL POOL (retrieved, bukan digenerate). Jangan sekali-kali menulis dalil dari ingatan.
- Jangan menghukumi tanpa atribusi: kalimat seperti "hukumnya haram" hanya boleh muncul sebagai laporan posisi yang di-atribusi ("Dalam Fathul Qarib disebutkan…", "MUI dalam pemberitaan pekan ini menyatakan…").
- Bagian "## Ringkasan Eksekutif" dan "## Poin Kunci": naratif; angka statistik internal (jumlah posting dll.) TIDAK boleh masuk ke badan artikel.
- Tanpa emphasis ALL-CAPS; gunakan **bold**/*italic*.
- Fokus pada pola/praktik, bukan menyerang individu; tanpa framing sektarian atau merendahkan madzhab mana pun.
- "## Dalil & Sumber": daftar SEMUA dalil yang dikutip artikel, satu baris per dalil dengan pola persis: `- **<sitasi persis dari pool>** — <catatan 1 kalimat>`.
- Tutup dokumen dengan satu baris disclaimer yang memuat frasa "bukan fatwa" (konten berbantuan AI, bukan fatwa; keputusan akhir kembali kepada ulama).
- JANGAN menulis bagian "Pesan Flyer", "Strategi & Aksi Dakwah", khutbah, kultum, atau deliverable mingguan lain."""


def _fiqh_stats(issues: list[dict[str, Any]]) -> dict[str, Any]:
    """headline_stats payload for the fiqh row. period = trailing 7d
    (the corpus window the issues were picked from)."""
    now = datetime.now(UTC)
    return {
        "mode": "fiqh",
        "fiqh_issues": [i["title"] for i in issues],
        "issues_meta": [
            {"title": i["title"], "query": i["query"]} for i in issues
        ],
        "period_start": (now - timedelta(days=7)).isoformat(),
        "period_end": now.isoformat(),
    }


def _load_fiqh_issues(issues_path: str) -> list[dict[str, Any]]:
    p = Path(issues_path)
    if not p.exists():
        raise SystemExit(f"Issues file not found: {issues_path}")
    raw = json.loads(p.read_text(encoding="utf-8"))
    issues = raw.get("issues") if isinstance(raw, dict) else raw
    if not isinstance(issues, list) or len(issues) != 4:
        raise SystemExit(
            "Expected exactly 4 issues: "
            '{"issues": [{"title", "query", "context"} x4]}.'
        )
    for i, it in enumerate(issues, 1):
        for key in ("title", "query", "context"):
            if not str(it.get(key, "")).strip():
                raise SystemExit(f"Issue {i} missing '{key}'.")
    return issues


async def cmd_dump_fiqh(issues_path: str, output_path: str | None) -> None:
    """STAGE 1 (fiqh): per-issue Qdrant retrieval → daleel pool + prompt.

    Deterministic re-dump is NOT safe once composition started (a fresh
    retrieval can shift the pool and orphan citations) — same discipline
    as the weekly two-stage flow.
    """
    issues = _load_fiqh_issues(issues_path)

    # Per-issue retrieval, tagged so the composer knows which hits
    # anchor which article. Dedupe by citation across issues (first
    # issue wins the tag; the composer may cite any pool entry in any
    # article — the tag is a hint, not a fence).
    pool: list[dict[str, Any]] = []
    seen: set[str] = set()
    for idx, issue in enumerate(issues, 1):
        hits = retrieve_daleel(
            f"{issue['title']}. {issue['query']}", limit=8, per_corpus=2
        )
        for h in hits:
            cit = (h.get("citation") or "").strip()
            if not cit or cit in seen:
                continue
            seen.add(cit)
            entry = dict(h)
            entry["fiqh_issue"] = idx
            pool.append(entry)

    if len(pool) < 8:
        raise SystemExit(
            f"Only {len(pool)} pool entries retrieved across 4 issues — "
            "too thin to compose 4 dalil-grounded articles. Refine the "
            "issue queries."
        )

    from api.services.hadith_translation import lookup_cached_translations
    from api.services.trending_headlines import fetch_trending_headlines

    async with SessionLocal() as session:
        pool, misses = await lookup_cached_translations(session, pool)
        headlines = await fetch_trending_headlines(
            session, limit=12, period_days=7
        )

    stats = _fiqh_stats(issues)
    cache = {
        "mode": "fiqh",
        "dumped_at_utc": datetime.now(UTC).isoformat(),
        "issues": issues,
        "stats": stats,
        "daleel": pool,
        "adhkar": [],
    }
    cache_file = _cache_path(FIQH_CACHE_SLUG)
    cache_file.write_text(
        json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    lines = [
        "<!-- DAKWAH-LENS MANUAL BRIEFING — FIQH PEKAN INI -->",
        f"<!-- dumped: {datetime.now(UTC).isoformat()} -->",
        "<!-- After composing, save with: -->",
        "<!--   uv run python -m api.scripts.manual_briefing save-fiqh <reply.md> -->",
        "",
        "SYSTEM INSTRUCTION (fiqh-mode persona + structure)",
        "─" * 60,
        FIQH_SYSTEM_PROMPT,
        "─" * 60,
        "",
        "# ISU FIQH PEKAN INI (4)",
        "",
    ]
    for i, issue in enumerate(issues, 1):
        lines.append(f"## Isu {i}: {issue['title']}")
        lines.append(f"Konteks berita: {issue['context']}")
        lines.append("")

    lines.append("# BERITA PENDUKUNG (7 hari terakhir — anchor faktual)")
    lines.append("")
    for h in headlines:
        text = (h.get("text") or "").replace(chr(10), " ")[:220]
        lines.append(f"- [{h.get('theme_group') or '?'}] {text}")
    lines.append("")

    lines.append(f"# DALEEL POOL ({len(pool)} — kutip HANYA dari sini)")
    lines.append("")
    for i, d in enumerate(pool, 1):
        cit = d.get("citation", "?")
        corpus = d.get("corpus", "?")
        ar = (d.get("arabic") or "").replace(chr(10), " ")
        trn = (
            d.get("translation_id") or d.get("translation_en") or ""
        ).replace(chr(10), " ")
        lines.append(f"## {i}. {cit}  [{corpus} · isu {d.get('fiqh_issue')}]")
        lines.append(f"AR: {ar}")
        lines.append(f"ID/EN: {trn}")
        lines.append("")

    if misses:
        lines.append(
            f"# TRANSLATION MISSES ({len(misses)}) — terjemahkan di chat "
            "lalu cache-translation bila dipakai"
        )
        for m in misses:
            lines.append(f"- {m.get('citation')}")
        lines.append("")

    out = chr(10).join(lines)
    if output_path:
        Path(output_path).write_text(out, encoding="utf-8")
        sys.stderr.write(
            f"✓ Fiqh prompt written to {output_path} "
            f"({len(out):,} chars, pool={len(pool)}, "
            f"headlines={len(headlines)}, misses={len(misses)})" + chr(10)
        )
    else:
        print(out)


_FIQH_REQUIRED_H2S = [
    "## Ringkasan Eksekutif",
    "## Poin Kunci",
    "## Artikel Fiqh Pekan Ini",
    "## Dalil & Sumber",
]

_FIQH_FORBIDDEN_H2S = ["## Pesan Flyer", "## Strategi & Aksi Dakwah"]


def _validate_fiqh_briefing(md: str, daleel_pool: list[dict[str, Any]]) -> None:
    """Fiqh-specific structural hard-fails. Raises SystemExit on any
    violation — nothing is persisted."""
    import re as _re

    problems: list[str] = []
    md_stripped = md.strip()
    if len(md_stripped) < 8000:
        problems.append(
            f"Body suspiciously short ({len(md_stripped):,} chars) — "
            "expected 4 articles x 900-1,300 words."
        )

    # Required H2s, in order; forbidden weekly/flyer H2s absent.
    pos = -1
    for h2 in _FIQH_REQUIRED_H2S:
        p = md.find(chr(10) + h2)
        if p == -1 and not md.startswith(h2):
            problems.append(f"Missing required H2 '{h2}'.")
        elif p != -1:
            if p < pos:
                problems.append(f"H2 '{h2}' out of order.")
            pos = p
    for h2 in _FIQH_FORBIDDEN_H2S:
        if h2 in md:
            problems.append(
                f"Forbidden section '{h2}' present — fiqh briefing must "
                "not carry weekly deliverables/flyers (composer drift)."
            )

    # Exactly 4 article H3s with quote-titles: ### Artikel N — "…"
    h3s = _re.findall(
        r'^###\s+Artikel\s+([1-4])\s+—\s+"([^"]{8,90})"\s*$',
        md,
        _re.MULTILINE,
    )
    nums = [int(n) for n, _t in h3s]
    if nums != [1, 2, 3, 4]:
        problems.append(
            f"Expected exactly H3s 'Artikel 1..4 — \"judul\"' in order; "
            f"found {nums or 'none'}."
        )

    # Per-article: consult-ulama close present.
    if len(nums) == 4:
        bodies = _re.split(r'^###\s+Artikel\s+[1-4][^\n]*$', md, flags=_re.MULTILINE)
        # bodies[1..4] are the article bodies (tail of 4 includes next H2 —
        # trim at the next H2 boundary).
        for i, body in enumerate(bodies[1:5], 1):
            body = body.split(chr(10) + "## ")[0]
            if "ulama" not in body.lower():
                problems.append(
                    f"Artikel {i} missing the consult-ulama close "
                    "(no 'ulama' mention)."
                )
            # Grassroots Q&A block: `#### Tanya-Jawab` with >=3 T/J pairs.
            if "#### Tanya-Jawab" not in body:
                problems.append(
                    f"Artikel {i} missing the `#### Tanya-Jawab` block."
                )
            else:
                qa = body.split("#### Tanya-Jawab", 1)[1]
                n_q = len(_re.findall(r"\*\*T:\*\*", qa))
                if n_q < 3:
                    problems.append(
                        f"Artikel {i} Tanya-Jawab has only {n_q} questions "
                        "(expect >=3 `**T:**` pairs)."
                    )

    # Disclaimer with the exact anchor phrase.
    if "bukan fatwa" not in md.lower():
        problems.append("Missing 'bukan fatwa' AI-disclaimer line.")

    # Dalil & Sumber entries must cite the pool verbatim.
    dalil_section = md.split("## Dalil & Sumber", 1)
    cited: list[str] = []
    if len(dalil_section) == 2:
        cited = _re.findall(
            r"^-\s+\*\*(.+?)\*\*", dalil_section[1], _re.MULTILINE
        )
    if len(cited) < 4:
        problems.append(
            f"Dalil & Sumber lists only {len(cited)} entries (expect >=4, "
            "one line per cited dalil: `- **<sitasi>** — catatan`)."
        )
    def _norm(s: str) -> str:
        return _re.sub(r"\s+", " ", s).strip().casefold()
    pool_cits = {_norm(d.get("citation") or "") for d in daleel_pool}
    out_of_pool = [c for c in cited if _norm(c) not in pool_cits]
    if out_of_pool:
        problems.append(
            "Dalil & Sumber citations NOT in the retrieved pool: "
            + "; ".join(out_of_pool[:6])
        )

    if problems:
        sys.stderr.write("✗ Fiqh validation failed:" + chr(10))
        for p in problems:
            sys.stderr.write(f"  - {p}" + chr(10))
        raise SystemExit(1)


async def cmd_save_fiqh(markdown_path: str) -> None:
    """STAGE 2 (fiqh): validate Claude's reply + upsert the Briefing row."""
    cache_file = _cache_path(FIQH_CACHE_SLUG)
    if not cache_file.exists():
        raise SystemExit(
            f"Fiqh cache missing at {cache_file}." + chr(10) +
            "  → Re-run: manual_briefing dump-fiqh <issues.json> "
            "(NO auto-redump: it would shift the pool and orphan "
            "citations)."
        )
    md_path = Path(markdown_path)
    if not md_path.exists():
        raise SystemExit(f"Markdown file not found: {markdown_path}")
    summary_md = md_path.read_text(encoding="utf-8").strip()

    cached = json.loads(cache_file.read_text(encoding="utf-8"))
    if cached.get("mode") != "fiqh":
        raise SystemExit("Cache at fiqh slot is not a fiqh dump. Re-dump.")
    daleel: list[dict[str, Any]] = cached["daleel"]
    issues: list[dict[str, Any]] = cached["issues"]
    stats: dict[str, Any] = cached["stats"]

    dumped_at = datetime.fromisoformat(cached["dumped_at_utc"])
    age_hours = (datetime.now(UTC) - dumped_at).total_seconds() / 3600.0
    if age_hours > 48:
        sys.stderr.write(
            f"⚠ Fiqh cache is {age_hours:.1f}h old — pool may be stale."
            + chr(10)
        )

    # Fiqh structural hard-fails first (cheap, most specific).
    _validate_fiqh_briefing(summary_md, daleel)

    # Generic heuristic pass — surfaced for operator review. Flyer /
    # occasion structure kinds hard-fail (they can only fire if the
    # composer drifted into another template).
    from api.services.validate_briefing import (
        format_warnings_for_stderr,
        validate_briefing,
    )

    warnings: list[dict] = []
    try:
        warnings = validate_briefing(
            summary_md,
            daleel_pool=daleel,
            adhkar_pool=[],
            llm_judgments=False,
        )
    except Exception as exc:  # pragma: no cover — never block on scanner bug
        sys.stderr.write(f"⚠ Validation pass failed (non-fatal): {exc}" + chr(10))

    drift = [
        w
        for w in warnings
        if str(w.get("kind", "")).startswith("flyer_")
        or w.get("kind") == "occasion_section_malformed"
    ]
    if drift:
        sys.stderr.write(
            "✗ Template-drift warnings (flyer/occasion structures in a "
            "fiqh briefing):" + chr(10)
        )
        sys.stderr.write(format_warnings_for_stderr(drift) + chr(10))
        raise SystemExit(1)
    if warnings:
        sys.stderr.write(
            f"⚠ {len(warnings)} heuristic warning(s) — review:" + chr(10)
        )
        sys.stderr.write(format_warnings_for_stderr(warnings) + chr(10))

    from sqlalchemy import delete, select

    async with SessionLocal() as session:
        now = datetime.now(UTC)
        # Same-day upsert, mirroring cmd_save: one row per (FIQH_GROUP,
        # Jakarta calendar day) so the slug stays stable across re-saves.
        jakarta_today = (now + timedelta(hours=7)).date()
        existing = (
            await session.execute(
                select(Briefing.id, Briefing.generated_at).where(
                    Briefing.theme_group == FIQH_GROUP
                )
            )
        ).all()
        stale = [
            bid
            for bid, gen in existing
            if (gen + timedelta(hours=7)).date() == jakarta_today
        ]
        if stale:
            await session.execute(
                delete(Briefing).where(Briefing.id.in_(stale))
            )
            sys.stderr.write(
                f"  ↻ replaced {len(stale)} same-day fiqh row(s) "
                f"({jakarta_today})." + chr(10)
            )

        row = Briefing(
            generated_at=now,
            period_start=datetime.fromisoformat(stats["period_start"]),
            period_end=datetime.fromisoformat(stats["period_end"]),
            summary_md=summary_md,
            summary_md_en=None,
            headline_stats=stats,
            model=MODEL_TAG,
            tokens_in=0,
            tokens_out=0,
            cost_usd=0.0,
            theme_group=FIQH_GROUP,
            daleel_refs=daleel,
            adhkar_refs=[],
        )
        session.add(row)
        await session.commit()

    sys.stderr.write(
        "✓ Fiqh briefing saved." + chr(10) +
        f"  theme_group={FIQH_GROUP}" + chr(10) +
        f"  issues={[i['title'] for i in issues]}" + chr(10) +
        f"  daleel_refs={len(daleel)} · body={len(summary_md):,} chars" + chr(10)
    )


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

    # Two-stage flow (replaces old single `dump` since 2026-06-24).
    # Stage 1: dump-candidates — emit full unranked pools for Claude.
    # Stage 2: dump-prompt --picks — apply Claude's picks, build prompt.
    # See module docstring for full operational flow.
    p_dump_c = sub.add_parser(
        "dump-candidates",
        help=(
            "STAGE 1: retrieve full unranked pools (28 daleel, 15 du'a, "
            "4 kisah seeds) and emit them for Claude to pick from in chat. "
            "No Gemini calls — replaces the old single-pass `dump`."
        ),
    )
    p_dump_c.add_argument("group", help=group_help)
    p_dump_c.add_argument(
        "--output",
        "-o",
        help="Write candidates markdown to this file. Default: stdout.",
        default=None,
    )

    p_dump_p = sub.add_parser(
        "dump-prompt",
        help=(
            "STAGE 2: apply Claude's picks (18 daleel + 6 du'a + 1 kisah "
            "source) to the cached candidate pools, emit the final prompt."
        ),
    )
    p_dump_p.add_argument("group", help=group_help)
    p_dump_p.add_argument(
        "--picks",
        required=True,
        help="Path to picks JSON (see module docstring for schema).",
    )
    p_dump_p.add_argument(
        "--output",
        "-o",
        help="Write prompt to this file. Default: stdout.",
        default=None,
    )

    p_cache_t = sub.add_parser(
        "cache-translation",
        help=(
            "Persist a Claude-supplied hadith ID translation to the "
            "hadith_translations_id cache so future runs are free SELECTs."
        ),
    )
    p_cache_t.add_argument(
        "citation",
        help='Hadith citation, e.g. "Sahih Muslim 1135"',
    )
    p_cache_t.add_argument(
        "text_en",
        help="The English source text (from the candidates dump)",
    )
    p_cache_t.add_argument(
        "text_id",
        help="The Claude-supplied Indonesian translation",
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

    # ── Occasion (15th-track Islamic-calendar briefings) ───────────
    occasion_help = (
        "Occasion slug from api/src/api/catalogs/hijri_occasions.yaml "
        "(e.g. 'asyura-1448', 'ramadan-1448-w2', 'maulid-1448'). Run "
        "`list-occasions` to see upcoming entries."
    )

    p_dump_occ = sub.add_parser(
        "dump-occasion",
        help=(
            "Compute occasion daleel + supporting headlines, emit "
            "occasion-mode prompt to feed Claude. 7-section format "
            "(Sections 2+3 are Kalender Hijriah + Konteks & Hikmah)."
        ),
    )
    p_dump_occ.add_argument("slug", help=occasion_help)
    p_dump_occ.add_argument(
        "--output",
        "-o",
        help="Write prompt to this file. Default: stdout.",
        default=None,
    )

    p_save_occ = sub.add_parser(
        "save-occasion",
        help=(
            "Persist Claude's reply as an occasion briefing (15th-track). "
            "Hard-fails on structural drift (Sections 2+3 must be "
            "occasion-mode H2s, no '## Numerik & Tren' / '## Tema Utama')."
        ),
    )
    p_save_occ.add_argument("slug", help=occasion_help)
    p_save_occ.add_argument("markdown_file", help="Path to Claude's reply (.md)")

    p_dump_fiqh = sub.add_parser(
        "dump-fiqh",
        help=(
            "Fiqh mode STAGE 1: per-issue retrieval for the 4 picked fiqh "
            "issues → daleel pool + composition prompt."
        ),
    )
    p_dump_fiqh.add_argument(
        "issues_file",
        help='JSON: {"issues": [{"title","query","context"} x4]}',
    )
    p_dump_fiqh.add_argument(
        "--output", "-o", default=None, help="Write prompt to file."
    )

    p_save_fiqh = sub.add_parser(
        "save-fiqh",
        help="Fiqh mode STAGE 2: validate Claude's reply + upsert the row.",
    )
    p_save_fiqh.add_argument("markdown_file", help="Path to Claude's reply (.md)")

    p_list_occ = sub.add_parser(
        "list-occasions",
        help=(
            "Show occasion catalog entries within the next 14 days "
            "(default). Operator uses this to decide which occasion "
            "to dump next."
        ),
    )
    p_list_occ.add_argument(
        "--days",
        type=int,
        default=14,
        help="Lookahead window in days (default 14).",
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

    if args.cmd == "dump-candidates":
        asyncio.run(cmd_dump_candidates(args.group, args.output))
    elif args.cmd == "dump-prompt":
        asyncio.run(cmd_dump_prompt(args.group, args.picks, args.output))
    elif args.cmd == "cache-translation":
        asyncio.run(
            cmd_cache_translation(args.citation, args.text_en, args.text_id)
        )
    elif args.cmd == "save":
        asyncio.run(cmd_save(args.group, args.markdown_file))
    elif args.cmd == "list":
        asyncio.run(cmd_list())
    elif args.cmd == "clear":
        asyncio.run(cmd_clear(args.yes))
    elif args.cmd == "apply-swaps":
        asyncio.run(cmd_apply_swaps(args.group, args.swaps_file))
    elif args.cmd == "dump-occasion":
        asyncio.run(cmd_dump_occasion(args.slug, args.output))
    elif args.cmd == "save-occasion":
        asyncio.run(cmd_save_occasion(args.slug, args.markdown_file))
    elif args.cmd == "dump-fiqh":
        asyncio.run(cmd_dump_fiqh(args.issues_file, args.output))
    elif args.cmd == "save-fiqh":
        asyncio.run(cmd_save_fiqh(args.markdown_file))
    elif args.cmd == "list-occasions":
        asyncio.run(cmd_list_occasions(args.days))


if __name__ == "__main__":
    main()
