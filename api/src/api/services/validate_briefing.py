"""Post-generation sanity checks for an LLM-written briefing.

Two passes:

  1. Forbidden-phrase scan — fast regex over the markdown body. Catches
     translator / publisher mentions ("Kemenag", "Sahih International",
     etc.) and other "metadata leaked into prose" tells. No LLM cost.

  2. Per-flyer paragraph ↔ daleel alignment — Flash-Lite scores whether
     the daleel tagged on each Pesan Flyer paragraph actually addresses
     the paragraph's theme. ~$0.0001 per call × 6 flyers = negligible.

Returns a list of structured warnings the caller can log or print.
Never raises into the caller's flow — generation must not break when
this module errors out.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal, TypedDict

import structlog

from api.config import settings
from api.services.usage import gemini_output_tokens, record_usage

log = structlog.get_logger(__name__)


class BriefingWarning(TypedDict, total=False):
    """One issue surfaced by `validate_briefing`.

    Structured fields (`flyer_index` / `current_citation` /
    `suggested_citation`) are populated for daleel-fit warnings so
    callers can autofix without re-parsing the message string.
    """

    kind: Literal[
        "forbidden_phrase",
        "daleel_mismatch",
        "daleel_weak",
        "missing_daleel",
        "absurd_advice",
    ]
    severity: Literal["low", "medium", "high"]
    where: str  # human-readable locator, e.g. "Pesan Flyer 2"
    message: str

    # ── Optional structured payload ──────────────────────────────
    # Present on daleel_mismatch / daleel_weak only.
    flyer_index: int  # 0-based — Pesan Flyer N → idx N-1
    current_citation: str
    # Present when the re-retrieval suggester returned a better pool
    # entry. Absent if no pool entry fits — operator should leave the
    # marker empty.
    suggested_citation: str


# ──────────────────────────────────────────────────────────────────
# Pass 1 — forbidden-phrase scan
# ──────────────────────────────────────────────────────────────────

# Phrases that should NEVER appear in a briefing's user-facing prose.
# Translator / publisher mentions are source-data metadata, not content.
_FORBIDDEN_PATTERNS: list[tuple[str, str]] = [
    (r"\bKemenag\b\s+style\b", "translator-style mention"),
    (r"\bgaya\s+Kemenag\b", "translator-style mention"),
    (r"\bSahih\s+International\b", "translator-name mention"),
    (r"\bSaheeh\s+International\b", "translator-name mention"),
    (r"\bHilali-?Khan\b", "translator-name mention"),
    (r"\bPickthall\b", "translator-name mention"),
    (r"\bYusuf\s+Ali\b", "translator-name mention"),
    (r"\bIbn\s+Kathir\s+style\b", "tafsir-style mention"),
    (r"\bmenurut\s+terjemahan\s+Kemenag\b", "translator attribution"),
    (r"\bversi\s+Kemenag\b", "translator-version mention"),
    (r"\btafsir\s+gaya\b", "tafsir-style mention"),
]


def scan_forbidden_phrases(markdown: str) -> list[BriefingWarning]:
    """Find any forbidden phrases in the briefing body."""
    warnings: list[BriefingWarning] = []
    for pattern, label in _FORBIDDEN_PATTERNS:
        for m in re.finditer(pattern, markdown, flags=re.IGNORECASE):
            # Render a short snippet of surrounding context for the log.
            start = max(0, m.start() - 30)
            end = min(len(markdown), m.end() + 30)
            snippet = markdown[start:end].replace("\n", " ")
            warnings.append(
                {
                    "kind": "forbidden_phrase",
                    "severity": "high",
                    "where": f"char {m.start()}",
                    "message": f"{label}: '{m.group(0)}' — context: …{snippet}…",
                }
            )
    return warnings


# ──────────────────────────────────────────────────────────────────
# Pass 2 — per-flyer daleel alignment
# ──────────────────────────────────────────────────────────────────


def _parse_flyer_blocks(
    markdown: str,
) -> list[dict[str, str]]:
    """Pull every `### Pesan Flyer N` block out of the briefing.

    Returns a list of `{title, body, citation}` dicts. `citation` is
    the value of the `**Daleel:**` marker (may be empty for Flyer 5/6
    that didn't find a matching adhkar entry).
    """
    # Locate the `## Pesan Flyer` H2 section.
    h2_match = re.search(r"^##\s+Pesan\s+Flyer\b", markdown, flags=re.MULTILINE)
    if not h2_match:
        return []
    section_start = h2_match.end()
    # Section ends at the next H2 or EOF.
    next_h2 = re.search(r"^##\s+", markdown[section_start:], flags=re.MULTILINE)
    section_end = (
        section_start + next_h2.start() if next_h2 else len(markdown)
    )
    section = markdown[section_start:section_end]

    blocks: list[dict[str, str]] = []
    # Capture each `### Pesan Flyer N — …` block + its body up to the
    # next H3 (or section end).
    h3_iter = list(re.finditer(r"^###\s+(.+)$", section, flags=re.MULTILINE))
    for i, h3 in enumerate(h3_iter):
        body_start = h3.end()
        body_end = h3_iter[i + 1].start() if i + 1 < len(h3_iter) else len(section)
        body = section[body_start:body_end].strip()
        title = h3.group(1).strip()
        # Pull the `**Daleel:**` marker. Empty / missing → empty string.
        daleel_match = re.search(
            r"\*\*Daleel:\*\*\s*([^\n]+)", body, flags=re.IGNORECASE
        )
        citation = ""
        if daleel_match:
            citation = daleel_match.group(1).strip().strip("\"'")
        blocks.append({"title": title, "body": body, "citation": citation})
    return blocks


def _find_daleel_by_citation(
    pool: list[dict[str, Any]], citation: str
) -> dict[str, Any] | None:
    """Find a pool entry whose citation matches (case + punctuation
    insensitive). Mirrors web/src/lib/flyer/content.ts findDaleelByCitation."""
    if not citation or not pool:
        return None

    def _norm(s: str) -> str:
        return re.sub(r"[.,;:]+", "", re.sub(r"\s+", " ", s)).lower().strip()

    wanted = _norm(citation)
    for entry in pool:
        if _norm(entry.get("citation", "")) == wanted:
            return entry
    # Prefix match for "QS. Al-Ma'aarij 32" vs "QS. Al-Ma'aarij: 32"
    for entry in pool:
        en = _norm(entry.get("citation", ""))
        if en.startswith(wanted) or wanted.startswith(en):
            return entry
    return None


def _score_paragraph_daleel_fit(
    paragraph: str, daleel: dict[str, Any]
) -> Literal["fit", "weak", "mismatch", "unknown"]:
    """Flash-Lite one-shot classification of how well a daleel
    supports a flyer paragraph."""
    if not settings.gemini_api_key:
        return "unknown"

    from google import genai
    from google.genai import types as genai_types

    translation = (
        daleel.get("translation_id")
        or daleel.get("translation_en")
        or ""
    )[:400]
    citation = daleel.get("citation", "")
    # Truncate the paragraph for cost — first ~600 chars is plenty.
    para = paragraph.strip()[:600]

    prompt = f"""Saya menilai apakah daleel cocok untuk satu paragraf flyer dakwah.

PARAGRAF:
{para}

DALEEL ({citation}):
{translation}

Jawab dengan SATU kata saja:
- FIT — daleel-nya benar-benar berbicara tentang inti paragraf
- WEAK — terkait jauh, tapi terasa dipaksakan / hanya berbagi satu kata kunci
- MISMATCH — daleel-nya tidak relevan dengan inti paragraf

Jawaban (satu kata):"""

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                temperature=0.0,
                max_output_tokens=8,
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
        usage_md = getattr(resp, "usage_metadata", None)
        record_usage(
            provider="gemini",
            operation="daleel_validate",
            model="gemini-2.5-flash-lite",
            tokens_in=getattr(usage_md, "prompt_token_count", None),
            tokens_out=gemini_output_tokens(usage_md),
        )
        raw = (resp.text or "").strip().upper()
        if "FIT" in raw and "MISMATCH" not in raw and "WEAK" not in raw:
            return "fit"
        if "MISMATCH" in raw:
            return "mismatch"
        if "WEAK" in raw:
            return "weak"
        return "unknown"
    except Exception as exc:
        log.warning("validate_briefing.score_failed", error=str(exc))
        return "unknown"


def _score_advice_sanity(paragraph: str) -> tuple[Literal["ok", "absurd", "unknown"], str]:
    """Flash-Lite sanity check: does this flyer paragraph contain
    absurd / ambiguous / nonsensical advice that would embarrass the
    da'i if read at a mimbar?

    Returns ("absurd", explanation) for issues, ("ok", "") otherwise.
    Catches the kind of mistake the user flagged ("adopsi tetangga
    yang sedang hamil" — bizarre as general advice).
    """
    if not settings.gemini_api_key:
        return "unknown", ""

    from google import genai
    from google.genai import types as genai_types

    para = paragraph.strip()[:800]
    prompt = f"""Saya menilai apakah saran/tindakan dalam paragraf flyer dakwah ini PRAKTIS dan MASUK AKAL untuk jamaah Muslim Indonesia.

PARAGRAF:
{para}

CONTOH SARAN ABSURD YANG HARUS DIBLOKIR:
- "Adopsi tetangga yang sedang hamil" — tidak masuk akal sebagai saran umum, ambigu, terdengar aneh. (Yang dimaksud kemungkinan: kunjungi/bantu tetangga.)
- "Bergabung dengan korban kekerasan" — ambigu, seolah ikut jadi korban.
- "Hapus media sosial demi anak" — terlalu ekstrim sebagai saran umum.

Tugas Anda: jawab dalam format JSON SINGKAT.

Apakah paragraf mengandung saran/tindakan yang ABSURD/AMBIGU/TIDAK MASUK AKAL?

- Kalau TIDAK ada masalah, jawab: {{"verdict": "ok"}}
- Kalau ADA, jawab: {{"verdict": "absurd", "phrase": "<kutipan singkat 5-12 kata>", "why": "<1 kalimat alasan kenapa janggal>"}}

JSON only, no preamble:"""

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
                max_output_tokens=200,
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
        usage_md = getattr(resp, "usage_metadata", None)
        record_usage(
            provider="gemini",
            operation="advice_sanity",
            model="gemini-2.5-flash-lite",
            tokens_in=getattr(usage_md, "prompt_token_count", None),
            tokens_out=gemini_output_tokens(usage_md),
        )
        data = json.loads(resp.text or "{}")
        if data.get("verdict") == "absurd":
            phrase = str(data.get("phrase", "")).strip()
            why = str(data.get("why", "")).strip()
            details = (
                f"'{phrase}' — {why}" if phrase and why else why or phrase
            )
            return "absurd", details[:240]
        return "ok", ""
    except Exception as exc:
        log.warning("validate_briefing.sanity_failed", error=str(exc))
        return "unknown", ""


def _suggest_replacement_daleel(
    paragraph: str,
    pool: list[dict[str, Any]],
) -> str | None:
    """When a flyer's tagged daleel mismatches the paragraph, do a
    focused re-retrieval against THIS PARAGRAPH'S theme + pick the
    best pool entry. Returns the suggested citation (string) or None.

    Re-retrieval = a Flash-Lite call that picks the best-fitting
    pool entry for the paragraph's specific theme. We don't hit
    Qdrant a second time — the existing pool of N daleel is wide
    enough; we're just asking the LLM to pick a DIFFERENT entry
    that fits better than the one the brief LLM originally chose.
    """
    if not pool or not settings.gemini_api_key:
        return None

    from google import genai
    from google.genai import types as genai_types

    para = paragraph.strip()[:600]
    candidates_text = "\n".join(
        f"[{i}] {c.get('citation', '')}\n"
        f"    {((c.get('translation_id') or c.get('translation_en') or '')[:240])}"
        for i, c in enumerate(pool)
    )
    prompt = f"""Saya mencari daleel paling cocok dari pool berikut untuk paragraf flyer dakwah ini.

PARAGRAF:
{para}

POOL DALEEL (urut tidak relevan):
{candidates_text}

Pilih SATU index daleel yang PALING tematik & cocok untuk paragraf di atas. Tolak daleel yang hanya berbagi 1-2 kata kunci permukaan.

Kalau tidak ada satu pun yang BENAR-BENAR cocok, jawab dengan index -1.

Format jawaban (JSON only): {{"best_index": <int>}}"""

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,
                max_output_tokens=40,
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
        usage_md = getattr(resp, "usage_metadata", None)
        record_usage(
            provider="gemini",
            operation="daleel_resuggest",
            model="gemini-2.5-flash-lite",
            tokens_in=getattr(usage_md, "prompt_token_count", None),
            tokens_out=gemini_output_tokens(usage_md),
        )
        data = json.loads(resp.text or "{}")
        idx = data.get("best_index")
        if isinstance(idx, int) and 0 <= idx < len(pool):
            return pool[idx].get("citation") or None
        return None
    except Exception as exc:
        log.warning("validate_briefing.resuggest_failed", error=str(exc))
        return None


def check_flyer_daleel_alignment(
    markdown: str,
    daleel_pool: list[dict[str, Any]],
    adhkar_pool: list[dict[str, Any]] | None = None,
) -> list[BriefingWarning]:
    """For each Pesan Flyer paragraph, score how well its tagged
    daleel supports the paragraph. Returns warnings for WEAK /
    MISMATCH cases and for blocks where the citation doesn't resolve
    to any pool entry.

    Flyer 5 + 6 search the adhkar pool; Flyer 1-4 search the daleel
    pool. Empty citations are reported separately as "missing_daleel"
    with low severity (Flyer 5/6 are allowed to skip when no adhkar
    fits).
    """
    warnings: list[BriefingWarning] = []
    blocks = _parse_flyer_blocks(markdown)
    if not blocks:
        return warnings

    for idx, b in enumerate(blocks):
        flyer_label = f"Pesan Flyer {idx + 1}"
        # Flyer 5 + 6 pin to adhkar pool, the rest to daleel pool.
        pool = adhkar_pool if idx >= 4 and adhkar_pool else daleel_pool
        citation = b["citation"]

        if not citation:
            warnings.append(
                {
                    "kind": "missing_daleel",
                    "severity": "low",
                    "where": flyer_label,
                    "message": "no **Daleel:** marker — fine if intentional, but worth confirming",
                }
            )
            continue

        entry = _find_daleel_by_citation(pool, citation)
        if not entry:
            warnings.append(
                {
                    "kind": "daleel_mismatch",
                    "severity": "high",
                    "where": flyer_label,
                    "message": (
                        f"citation '{citation}' not found in pool "
                        "— fabricated or pool drift"
                    ),
                }
            )
            continue

        # Trim paragraph: drop the **Headline:**, **Daleel:** markers.
        para_body = re.sub(
            r"\*\*(Headline|Daleel)\:\*\*[^\n]*\n?",
            "",
            b["body"],
            flags=re.IGNORECASE,
        ).strip()

        # Sanity check the advice in the paragraph BEFORE checking
        # daleel-fit. An absurd-advice paragraph is the more urgent
        # issue (operator needs to rewrite the copy, not just swap
        # citations).
        sanity, sanity_detail = _score_advice_sanity(para_body)
        if sanity == "absurd":
            warnings.append(
                {
                    "kind": "absurd_advice",
                    "severity": "high",
                    "where": flyer_label,
                    "message": (
                        "advice may sound absurd / ambiguous — "
                        f"{sanity_detail or 'rewrite for clarity'}"
                    ),
                }
            )

        verdict = _score_paragraph_daleel_fit(para_body, entry)
        if verdict in ("weak", "mismatch"):
            # Focused re-retrieval — ask Flash-Lite to pick the best
            # pool entry for THIS paragraph specifically. Surfaced
            # to the operator as a concrete replacement suggestion
            # AND as structured fields (current_citation /
            # suggested_citation / flyer_index) so apply_daleel_autofixes()
            # can rewrite the markdown without re-parsing the message.
            replacement = _suggest_replacement_daleel(para_body, pool)
            has_real_replacement = bool(replacement) and replacement != citation
            suggestion = (
                f" Suggested replacement from pool: '{replacement}'."
                if has_real_replacement
                else " Leave the **Daleel:** marker empty if no pool entry fits."
            )
            warning: BriefingWarning = {
                "kind": "daleel_weak" if verdict == "weak" else "daleel_mismatch",
                "severity": "medium" if verdict == "weak" else "high",
                "where": flyer_label,
                "message": (
                    f"daleel '{citation}' weakly fits."
                    if verdict == "weak"
                    else (
                        f"daleel '{citation}' does NOT match "
                        "paragraph theme."
                    )
                )
                + suggestion,
                "flyer_index": idx,
                "current_citation": citation,
            }
            if has_real_replacement and replacement:
                warning["suggested_citation"] = replacement
            warnings.append(warning)
    return warnings


# ──────────────────────────────────────────────────────────────────
# Aggregator — single entry point
# ──────────────────────────────────────────────────────────────────


# ──────────────────────────────────────────────────────────────────
# Autofix — apply structured warnings back to the markdown
# ──────────────────────────────────────────────────────────────────


def apply_daleel_autofixes(
    markdown: str,
    warnings: list[BriefingWarning],
    *,
    include_weak: bool = False,
) -> tuple[str, list[dict[str, str]]]:
    """Rewrite `**Daleel:**` markers on flyer paragraphs whose
    validator warning carries a `suggested_citation`.

    Mode:
      - default (`include_weak=False`): only autofixes
        `daleel_mismatch` (high severity). The mismatch verdict from
        Flash-Lite is a confident "this doesn't address the topic";
        swapping in the pool's best alternative is almost always
        net-positive.
      - `include_weak=True`: also rewrites `daleel_weak` cases. Weak
        verdicts are subjective ("terkait jauh tapi terasa
        dipaksakan"), so this is off by default — callers can opt
        in for aggressive cleanup.

    Returns the rewritten markdown + a list of applied swaps
    (`[{"where": "Pesan Flyer 2", "from": "X", "to": "Y"}]`) for
    audit logging. Empty list means nothing changed.

    Defensive: only rewrites a marker line that contains the exact
    `current_citation` string. If the markdown drifted (operator
    hand-edited between validate and autofix), the swap is skipped
    and absent from the returned list.
    """
    target_kinds: set[str] = (
        {"daleel_mismatch", "daleel_weak"} if include_weak else {"daleel_mismatch"}
    )

    # Group warnings by flyer_index so we only re-parse blocks once.
    by_idx: dict[int, BriefingWarning] = {}
    for w in warnings:
        if w.get("kind") not in target_kinds:
            continue
        if "suggested_citation" not in w or "current_citation" not in w:
            continue
        if "flyer_index" not in w:
            continue
        # If multiple warnings target the same flyer (shouldn't happen,
        # but be defensive), prefer mismatch over weak.
        existing = by_idx.get(w["flyer_index"])
        if existing and existing.get("kind") == "daleel_mismatch":
            continue
        by_idx[w["flyer_index"]] = w

    if not by_idx:
        return markdown, []

    # Locate flyer blocks via the same parser the alignment check uses.
    blocks = _parse_flyer_blocks(markdown)
    if not blocks:
        return markdown, []

    md = markdown
    applied: list[dict[str, str]] = []
    for idx, w in by_idx.items():
        if idx < 0 or idx >= len(blocks):
            continue
        current = w["current_citation"]
        replacement = w["suggested_citation"]

        # Find the **Daleel:** line that appears INSIDE this specific
        # flyer's body. We do this by anchoring to the flyer's H3
        # heading line + searching only within the block range.
        block_body = blocks[idx]["body"]
        # The current_citation may have been normalized — try a few
        # exact-shape variants. Most permissive: case-insensitive,
        # whitespace-collapsed.
        daleel_re = re.compile(
            r"(\*\*Daleel:\*\*\s*)" + re.escape(current),
            flags=re.IGNORECASE,
        )
        new_block_body, n = daleel_re.subn(
            # Default-arg binding so this lambda captures the current
            # loop value rather than late-binding by name (B023).
            lambda m, _r=replacement: m.group(1) + _r,
            block_body,
            count=1,
        )
        if n == 0:
            # Citation drift since validate ran — skip.
            continue

        # Splice the new block body back into the full markdown. We
        # locate by the block's `### Pesan Flyer N — ...` heading
        # + the original body string (unambiguous within the doc).
        if block_body not in md:
            continue  # paranoid guard against unicode-normalize drift
        md = md.replace(block_body, new_block_body, 1)
        applied.append(
            {
                "where": w.get("where", f"Pesan Flyer {idx + 1}"),
                "from": current,
                "to": replacement,
            }
        )

    return md, applied


def format_autofixes_for_stderr(applied: list[dict[str, str]]) -> str:
    """Pretty-print applied autofixes for the manual_briefing.py save
    flow. Returns "" when nothing was applied."""
    if not applied:
        return ""
    lines = [
        f"\n✎ {len(applied)} daleel autofix(es) applied — citations rewritten:\n",
    ]
    for a in applied:
        lines.append(f"  · [{a['where']}] '{a['from']}' → '{a['to']}'")
    lines.append("")
    return "\n".join(lines)


def validate_briefing(
    markdown: str,
    *,
    daleel_pool: list[dict[str, Any]],
    adhkar_pool: list[dict[str, Any]] | None = None,
) -> list[BriefingWarning]:
    """Run all validators. Never raises — failures inside individual
    passes are logged and the pass returns no warnings for that
    branch."""
    warnings: list[BriefingWarning] = []
    try:
        warnings.extend(scan_forbidden_phrases(markdown))
    except Exception as exc:
        log.warning("validate_briefing.forbidden_scan_failed", error=str(exc))
    try:
        warnings.extend(
            check_flyer_daleel_alignment(
                markdown, daleel_pool, adhkar_pool=adhkar_pool
            )
        )
    except Exception as exc:
        log.warning("validate_briefing.alignment_check_failed", error=str(exc))
    return warnings


def format_warnings_for_stderr(warnings: list[BriefingWarning]) -> str:
    """Pretty-print warnings for the manual_briefing.py operator
    flow. Returns "" when there are no warnings."""
    if not warnings:
        return ""
    lines = [
        f"⚠ {len(warnings)} validation warning(s) — review before publish:\n",
    ]
    for w in warnings:
        sev = {"low": "·", "medium": "!", "high": "✗"}.get(w["severity"], "?")
        lines.append(f"  {sev} [{w['where']}] {w['message']}")
    lines.append("")
    return "\n".join(lines)


# Convenience for callers that just want the JSON dump.
def warnings_to_json(warnings: list[BriefingWarning]) -> str:
    return json.dumps(warnings, ensure_ascii=False, indent=2)
