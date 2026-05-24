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


class BriefingWarning(TypedDict):
    """One issue surfaced by `validate_briefing`."""

    kind: Literal["forbidden_phrase", "daleel_mismatch", "daleel_weak", "missing_daleel"]
    severity: Literal["low", "medium", "high"]
    where: str  # human-readable locator, e.g. "Pesan Flyer 2"
    message: str


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
        verdict = _score_paragraph_daleel_fit(para_body, entry)
        if verdict == "weak":
            warnings.append(
                {
                    "kind": "daleel_weak",
                    "severity": "medium",
                    "where": flyer_label,
                    "message": (
                        f"daleel '{citation}' weakly fits "
                        "— consider another pool entry or leave empty"
                    ),
                }
            )
        elif verdict == "mismatch":
            warnings.append(
                {
                    "kind": "daleel_mismatch",
                    "severity": "high",
                    "where": flyer_label,
                    "message": (
                        f"daleel '{citation}' does NOT match "
                        "paragraph theme — pick a better one or leave empty"
                    ),
                }
            )
    return warnings


# ──────────────────────────────────────────────────────────────────
# Aggregator — single entry point
# ──────────────────────────────────────────────────────────────────


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
