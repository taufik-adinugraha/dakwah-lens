"""Post-generation sanity checks for an LLM-written briefing.

Two passes — context-aware:

  1. Forbidden-phrase scan — fast regex over the markdown body. Catches
     translator / publisher mentions ("Kemenag", "Sahih International",
     etc.) and other "metadata leaked into prose" tells. No LLM cost.
     Runs in BOTH manual + auto paths.

  2. Per-flyer paragraph ↔ daleel alignment — Gemini Flash-Lite scores
     whether the daleel tagged on each Pesan Flyer paragraph actually
     addresses the paragraph's theme + suggests a replacement from
     the pool when it doesn't. ~$0.0001 per call × 6 flyers = negligible.
     ONLY runs in the AUTO pipeline. The manual path (which uses
     Claude-in-chat as the writer) does the same judgment in chat —
     no API-LLM call out from the script — per the project rule
     "no API LLM for manual content judgment".

Caller selects the depth via `validate_briefing(..., llm_judgments=True/False)`.
Manual flow passes False; auto pipeline passes True.

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
        "poin_kunci_missing_dalil",
        "flyer_inline_arabic",
        "mixed_script_paragraph",
        "dangling_citation",
        "arabic_block_inline",
        "deliverable_too_short",
        "kisah_preacher_voice",
        "mahasiswa_personal_voice",
        "pengajaran_preacher_voice",
        "preacher_anda_voice",
        "firman_hadith_mismatch",
        "flyer_dalil_not_in_pool",
        "flyer_section_malformed",
        "flyer_outlet_or_handle",
        "flyer_headline_missing_or_generic",
        "flyer_independence_violation",
        "news_paraphrase_fabrication",
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
# Pass 1b — structural anti-patterns (added 2026-06-06 after a series
# of manual-briefing regressions where the renderer fired du'a-box on
# mixed-script paragraphs, the flyer truncated on inline citations,
# and Poin Kunci bullets dropped Dalil. Catches them at save time so
# the broken markdown never reaches the DB.)
# ──────────────────────────────────────────────────────────────────

# Unicode ranges covering Arabic script (Arabic + Supplement + Extended-A
# + presentation forms). Compiled once.
_ARABIC_CHAR_RE = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
_LATIN_CHAR_RE = re.compile(r"[A-Za-z]")

# Sentence fragments that read as the wind-up to an inline citation —
# mirrors the renderer's CITATION_LEADIN_RE in
# web/src/lib/flyer/content.ts. Kept in sync by hand; both layers stop
# the same anti-pattern at the same shape so a regression here is
# caught either at save (this) or at render (that).
_DANGLING_CITATION_RE = re.compile(
    r"(?:dalam\s+(?:QS|HR|Hadits)\.?\s*$|berfirman\s*[:：]?\s*$|bersabda\s*[:：]?\s*$|"
    r"berkata\s*[:：]?\s*$|menyebutkan\s*[:：]?\s*$|mengatakan\s*[:：]?\s*$|"
    r"firman\s+Allah\s*[:：]?\s*$|sabda\s+(?:Nabi|Rasulullah)[^.]{0,40}[:：]?\s*$|"
    r"Allah\s+(?:Ta'ala|SWT|swt)\s+(?:dalam|berfirman)[^.]{0,30}\s*$)",
    re.IGNORECASE | re.MULTILINE,
)


def _section_slice(markdown: str, h2_pattern: str) -> tuple[int, int] | None:
    """Return (start, end) char offsets of the H2 section whose heading
    matches `h2_pattern`. End is the start of the next H2 (or EOF)."""
    m = re.search(rf"^##\s+{h2_pattern}\b", markdown, flags=re.MULTILINE)
    if not m:
        return None
    start = m.end()
    nxt = re.search(r"^##\s+", markdown[start:], flags=re.MULTILINE)
    end = start + nxt.start() if nxt else len(markdown)
    return (start, end)


def scan_poin_kunci_missing_dalil(markdown: str) -> list[BriefingWarning]:
    """Every Poin Kunci bullet must carry **Masalah** + **Aksi** +
    **Dalil** (3 indented fields). Pre-2026-06-06 prompts allowed Dalil
    to be optional, which led to inconsistent rendering."""
    warnings: list[BriefingWarning] = []
    slc = _section_slice(markdown, r"Poin\s+Kunci(?:\s+\([^)]*\))?")
    if not slc:
        return warnings
    section = markdown[slc[0] : slc[1]]
    # Split bullets on top-level `- ` at line start.
    bullets = re.split(r"^- ", section, flags=re.MULTILINE)[1:]
    for i, bullet in enumerate(bullets, 1):
        # Each well-formed bullet contains "**Masalah:**", "**Aksi:**",
        # and "**Dalil:**" markers. Surface any that are missing.
        missing = [
            field
            for field in ("Masalah", "Aksi", "Dalil")
            if not re.search(rf"\*\*\s*{field}\s*:\*\*", bullet, flags=re.IGNORECASE)
        ]
        if missing:
            warnings.append(
                {
                    "kind": "poin_kunci_missing_dalil",
                    "severity": "high",
                    "where": f"Poin Kunci bullet #{i}",
                    "message": (
                        f"bullet missing {', '.join(missing)} field(s) — "
                        f"format must be 3 indented lines: **Masalah:** / "
                        f"**Aksi:** / **Dalil:**"
                    ),
                }
            )
    return warnings


def scan_pesan_flyer_inline_arabic(markdown: str) -> list[BriefingWarning]:
    """Pesan Flyer 1-4 paragraphs must be 100% Indonesian prose. Inline
    Arabic in the body breaks `trimToSentences` (citation lead-in
    truncates the prose) and clutters the 1080×1080 layout."""
    warnings: list[BriefingWarning] = []
    slc = _section_slice(markdown, r"Pesan\s+Flyer")
    if not slc:
        return warnings
    section = markdown[slc[0] : slc[1]]
    h3_iter = list(
        re.finditer(
            r"^###\s+Pesan\s+Flyer\s+(\d)[^\n]*$",
            section,
            flags=re.MULTILINE | re.IGNORECASE,
        )
    )
    for i, h3 in enumerate(h3_iter):
        slot = int(h3.group(1))
        if slot >= 5:
            continue  # Flyers 5 + 6 explicitly allow Arabic du'a inline.
        body_start = h3.end()
        body_end = h3_iter[i + 1].start() if i + 1 < len(h3_iter) else len(section)
        body = section[body_start:body_end]
        # Strip the **Headline:** + **Dalil:** marker lines before
        # counting — the citation marker is allowed to contain Arabic
        # in surah names (won't happen with current pool, but defensive).
        body_prose = re.sub(
            r"^\s*\*\*\s*(?:Headline|Judul|Tema|Dalil|Daleel)\s*:\*\*[^\n]*$",
            "",
            body,
            flags=re.MULTILINE | re.IGNORECASE,
        )
        arabic_chars = _ARABIC_CHAR_RE.findall(body_prose)
        # ≥15 Arabic chars roughly = 3-4 Arabic words. Below that is a
        # single token like "Allah Ta'ala" or honorific ﷺ — allowed.
        if len(arabic_chars) >= 15:
            warnings.append(
                {
                    "kind": "flyer_inline_arabic",
                    "severity": "high",
                    "where": f"Pesan Flyer {slot}",
                    "message": (
                        f"body contains {len(arabic_chars)} Arabic chars inline "
                        f"— flyer 1-4 bodies must be 100% Indonesian prose. "
                        f"Daleel goes in the **Dalil:** marker only; renderer "
                        f"surfaces it visually below the message."
                    ),
                }
            )
    return warnings


def scan_mixed_script_paragraphs(markdown: str) -> list[BriefingWarning]:
    """Paragraphs with substantial Arabic AND substantial Latin trigger
    the du'a-box renderer's plain-prose fallback (correct behavior) but
    are usually a sign the writer forgot to split the Arabic into its
    own paragraph. Flag at save time so the writer can split before the
    reader sees a dense mixed-script wall."""
    warnings: list[BriefingWarning] = []
    # Skip Section 5 (Dalil & Sumber) — its entries are by design
    # `**citation**` + Arabic + translation on adjacent lines and may
    # collapse into one paragraph after stripping. Also skip the
    # YAML/frontmatter region (none here, defensive).
    cutoff = markdown.find("\n## Dalil & Sumber")
    body = markdown[:cutoff] if cutoff >= 0 else markdown
    paragraphs = re.split(r"\n{2,}", body)
    for idx, para in enumerate(paragraphs):
        line = para.strip()
        if len(line) < 120:
            continue
        if line.startswith("#") or line.startswith("-") or line.startswith("|"):
            continue
        if line.startswith(">"):
            continue
        nonws = sum(1 for c in line if not c.isspace()) or 1
        ar = len(_ARABIC_CHAR_RE.findall(line))
        lat = len(_LATIN_CHAR_RE.findall(line))
        if ar < 20:
            continue
        ar_ratio = ar / nonws
        lat_ratio = lat / nonws
        # Mirror the renderer's rule: box fires when Arabic ≥40% AND
        # Latin <15%. The hazard zone is Arabic ≥40% AND Latin ≥15% —
        # the renderer falls back to plain prose (correct) but the
        # writer almost certainly intended a standalone Arabic block.
        if ar_ratio >= 0.4 and lat_ratio >= 0.15:
            preview = line[:80].replace("\n", " ")
            warnings.append(
                {
                    "kind": "mixed_script_paragraph",
                    "severity": "medium",
                    "where": f"paragraph #{idx + 1}",
                    "message": (
                        f"paragraph mixes {ar_ratio:.0%} Arabic + {lat_ratio:.0%} "
                        f"Latin in one block — split the Arabic into its own "
                        f"paragraph (blank line before + after) so the "
                        f"renderer can present it cleanly. Preview: '{preview}…'"
                    ),
                }
            )
    return warnings


# A citation lead-in ("…Allah berfirman:") is orphaned ONLY when the
# next paragraph doesn't carry the actual citation/quote. Allowed next-
# paragraph shapes: a citation marker like `**QS. X: Y**` or `**Sahih
# Muslim N**`, or a paragraph that begins with Arabic script. Either
# means the bridge is complete across the paragraph break — the
# standalone-Arabic convention introduced 2026-06-06.
_NEXT_PARA_CITATION_RE = re.compile(
    # `\b` after `QS.` doesn't fire (both sides non-word). Use a lookahead
    # for whitespace or alpha to anchor the prefix without false matches.
    r"^\s*\*\*\s*(?:QS|HR|Hadits|Sahih|Riyad|Bulugh|Hisnul|Surat|Surah)(?:\.|\s|\b)",
    re.IGNORECASE,
)


def _starts_with_arabic(para: str) -> bool:
    stripped = para.lstrip()
    # Skip any leading markdown decoration (**, *, _, quotes) before
    # checking the first script-carrying char.
    stripped = re.sub(r"^[\*_>\"'\s]+", "", stripped)
    if not stripped:
        return False
    return bool(_ARABIC_CHAR_RE.match(stripped))


# Word-count targets per Section-4 deliverable, mirrors the ranges in
# briefing.py's `## Strategi & Aksi Dakwah` prompt. Each entry: a regex
# matching the H3 heading (case-insensitive, language-tolerant) plus
# `(min, max)` words. We only flag at 70% of `min` so authors with a
# tight-but-on-target draft don't get nagged — the real failure mode
# we're guarding against is the v5 Kultum that landed at 400 words on
# a 1650-word target (24% of min, clearly under-delivered).
_DELIVERABLE_WORD_TARGETS: list[tuple[str, tuple[int, int]]] = [
    (r"^###\s+Khutbah(?:\s+Jumat)?(?:\s+/\s+Friday\s+Khutbah)?\b", (3450, 4800)),
    (r"^###\s+Kultum(?:\s+/\s+Short\s+Talk)?\b", (1650, 2250)),
    (r"^###\s+Kajian(?:\s+Ibu-ibu)?(?:\s+(?:&|and)\s+Majelis\s+Taklim)?\b", (1400, 1800)),
    (r"^###\s+Kisah(?:\s+Pendek)?(?:\s+(?:—|-)\s+Short\s+Story)?\b", (1800, 2200)),
    (r"^###\s+Pengajaran(?:\s+di\s+Rumah)?(?:\s+/\s+Home\s+Teaching)?\b", (500, 700)),
    (r"^###\s+Kreator\s+Konten(?:\s+Digital)?(?:\s+/\s+Content\s+Creator)?\b", (100, 130)),
    (r"^###\s+Mahasiswa\b", (900, 1200)),
    (r"^###\s+Aksi\s+Sosial(?:\s+(?:&|dan)\s+Khidmah(?:\s+Umat)?)?\b", (600, 900)),
]
# Pesan Flyer 1-6 each target ~75 words. We use a 50-word floor to
# avoid flagging the legitimate Flyer 6 du'a-only slot (short prose +
# Arabic du'a that gets stripped by the word-count regex).
_FLYER_SLOT_TARGETS: tuple[int, int] = (50, 100)


def _count_words(text: str) -> int:
    """Count Latin + accented word tokens. Skips Arabic glyphs so an
    Arabic-heavy block doesn't get counted as 'long' on Arabic chars
    alone — the threshold is meant to measure Indonesian/English prose
    delivery time, not aksara Arab volume."""
    return len(re.findall(r"\b[\wÀ-ʯ]+\b", text))


def scan_deliverable_word_counts(markdown: str) -> list[BriefingWarning]:
    """Flag any Section-4 deliverable or Pesan Flyer slot whose word
    count falls below 70% of its prompt-specified minimum. Catches
    under-delivered sub-sections at save time so they don't reach
    readers — the v5 Kultum (400 words on a 1650-word target) was the
    motivating regression."""
    warnings: list[BriefingWarning] = []

    # Section 4 deliverables. Slice from `## Strategi & Aksi Dakwah`
    # (or `## Da'wah Strategies & Actions`) to the next H2.
    sec4 = _section_slice(markdown, r"(?:Strategi(?:\s+(?:&|dan)\s+Aksi\s+Dakwah)?|Da['’]?wah\s+Strategies(?:\s+(?:&|and)\s+Actions)?)")
    if sec4:
        body = markdown[sec4[0] : sec4[1]]
        # Capture each `### …` heading + its slice up to the next ###
        # (or section end).
        h3s = list(re.finditer(r"^###\s+.+$", body, flags=re.MULTILINE))
        for i, h3 in enumerate(h3s):
            heading = h3.group(0)
            start = h3.end()
            end = h3s[i + 1].start() if i + 1 < len(h3s) else len(body)
            block = body[start:end]
            for pattern, (lo, hi) in _DELIVERABLE_WORD_TARGETS:
                if re.match(pattern, heading, flags=re.IGNORECASE):
                    # Kisah Pendek prompt explicitly allows a placeholder
                    # line when KISAH POOL is empty (no Al-Bidayah fasal
                    # available for the theme). Detect that case and
                    # skip word-count flagging — the placeholder is the
                    # legitimate output, not under-delivery.
                    if re.match(r"^###\s+Kisah", heading, flags=re.IGNORECASE):
                        if re.search(
                            r"tidak\s+tersedia\s+untuk\s+tema\s+ini",
                            block,
                            flags=re.IGNORECASE,
                        ):
                            break
                    words = _count_words(block)
                    floor = int(lo * 0.7)
                    if words < floor:
                        warnings.append(
                            {
                                "kind": "deliverable_too_short",
                                "severity": "high",
                                "where": heading.lstrip("# ").strip(),
                                "message": (
                                    f"section is {words} words but prompt "
                                    f"targets {lo}-{hi}. Below 70% of min "
                                    f"({floor}) — under-delivered. Expand "
                                    f"with more concrete examples, dalil "
                                    f"cycles, or aplikasi praktis."
                                ),
                            }
                        )
                    break

    # Pesan Flyer slots. Same structure but a single floor for all 6.
    pf = _section_slice(markdown, r"Pesan\s+Flyer")
    if pf:
        body = markdown[pf[0] : pf[1]]
        h3_iter = list(
            re.finditer(
                r"^###\s+Pesan\s+Flyer\s+(\d)[^\n]*$",
                body,
                flags=re.MULTILINE | re.IGNORECASE,
            )
        )
        for i, h3 in enumerate(h3_iter):
            slot = int(h3.group(1))
            start = h3.end()
            end = h3_iter[i + 1].start() if i + 1 < len(h3_iter) else len(body)
            # Strip the marker lines (Headline / Dalil) before counting
            # so the count reflects the prose paragraph only.
            block = body[start:end]
            prose = re.sub(
                r"^\s*\*\*\s*(?:Headline|Judul|Tema|Dalil|Daleel)\s*:\*\*[^\n]*$",
                "",
                block,
                flags=re.MULTILINE | re.IGNORECASE,
            )
            words = _count_words(prose)
            lo, _hi = _FLYER_SLOT_TARGETS
            floor = int(lo * 0.7)
            if words < floor:
                warnings.append(
                    {
                        "kind": "deliverable_too_short",
                        "severity": "medium",
                        "where": f"Pesan Flyer {slot}",
                        "message": (
                            f"flyer body is {words} words; target is "
                            f"~75. Below {floor} reads as too short on a "
                            f"1080×1080 share tile — expand the "
                            f"Fakta→Masalah→Solusi paragraph."
                        ),
                    }
                )
    return warnings


# Preacher-voice phrases that break the cerpen-sejarah immersion of
# Kisah Pendek. The Pelajaran sub-section is excluded — voice there
# is allowed to shift gently toward essayist-with-reader ("kita").
# Matched as whole phrases (case-insensitive) so a substring like
# "hadirin" inside a quoted dialog won't trip the check.
_KISAH_PREACHER_PATTERNS: list[tuple[str, str]] = [
    (r"\bhadirin\s+yang\s+(?:dimuliakan|dirahmati|saya\s+hormati)\b", "preacher salutation"),
    (r"\bjamaah\s+yang\s+(?:dimuliakan|dirahmati|saya\s+hormati)\b", "preacher salutation"),
    (r"\bpara\s+jamaah\b", "preacher salutation"),
    (r"\bsaudara-?saudara(?:\s+sekalian)?\b", "preacher 2nd-person address"),
    (r"\bwahai\s+sekalian\s+(?:manusia|muslim|hadirin)\b", "preacher 2nd-person address"),
    (r"\bizinkan\s+saya\s+(?:menceritakan|berbagi|mengisahkan|menyampaikan)\b", "preacher framing"),
    (r"\bsaya\s+akan\s+(?:bercerita|menceritakan|mengisahkan)\b", "1st-person narrator"),
    (r"\bmari\s+kita\s+(?:simak|dengarkan|renungkan|mulai)\b", "preacher invitation"),
    (r"\bcoba\s+bayangkan,\s+hadirin\b", "direct address"),
    (r"\bperhatikan\s+(?:bahwa\s+)?(?:Rasulullah|Nabi)\b.*ﷺ", "preacher commentary inside narrative"),
]


def scan_kisah_voice(markdown: str) -> list[BriefingWarning]:
    """Flag preacher-voice phrases inside the Kisah Pendek narrative
    sub-section. The cerpen-sejarah format breaks when the narrator
    suddenly addresses the reader as a jamaah — pulls the reader out
    of the historical scene. Carves out `#### Pelajaran` (mild "kita"
    is allowed there to land the moral) and `#### Sumber Asli` (just
    raw Arabic). Only checks the Pembuka / Latar / Inti / Klimaks
    body."""
    warnings: list[BriefingWarning] = []
    # Locate the `### Kisah Pendek` block within Section 4. Section 4
    # heading match is loose to allow both `Strategi & Aksi Dakwah`
    # and the English variant.
    sec4 = _section_slice(
        markdown,
        r"(?:Strategi(?:\s+(?:&|dan)\s+Aksi\s+Dakwah)?|Da['’]?wah\s+Strategies(?:\s+(?:&|and)\s+Actions)?)",
    )
    if not sec4:
        return warnings
    body = markdown[sec4[0] : sec4[1]]
    h3s = list(re.finditer(r"^###\s+(.+)$", body, flags=re.MULTILINE))
    kisah_block: str | None = None
    for i, h3 in enumerate(h3s):
        if re.match(r"Kisah(?:\s+Pendek)?\b", h3.group(1).strip(), flags=re.IGNORECASE):
            start = h3.end()
            end = h3s[i + 1].start() if i + 1 < len(h3s) else len(body)
            kisah_block = body[start:end]
            break
    if not kisah_block:
        return warnings
    # Strip the Pelajaran + Sumber Asli sub-sections — voice there is
    # allowed to shift toward essayist tone (mild "kita") and the
    # source dump is just raw Arabic.
    narrative_only = re.split(
        r"^####\s+(?:Pelajaran|Sumber\s+Asli)\b",
        kisah_block,
        maxsplit=1,
        flags=re.MULTILINE | re.IGNORECASE,
    )[0]
    for pattern, label in _KISAH_PREACHER_PATTERNS:
        for m in re.finditer(pattern, narrative_only, flags=re.IGNORECASE):
            start = max(0, m.start() - 30)
            end = min(len(narrative_only), m.end() + 30)
            snippet = narrative_only[start:end].replace("\n", " ")
            warnings.append(
                {
                    "kind": "kisah_preacher_voice",
                    "severity": "high",
                    "where": "Kisah Pendek (narrative)",
                    "message": (
                        f"{label}: '{m.group(0)}' — Kisah Pendek must read "
                        f"as third-person cerpen sejarah; preacher voice "
                        f"belongs in Khutbah/Kultum/Kajian. Context: …{snippet}…"
                    ),
                }
            )
    return warnings


# Voice violations specific to Mahasiswa #### Artikel — 1st/2nd person
# and directive sentences (telling the reader to do something). The
# article must read as impersonal analytical essay; pembaca diam
# membaca, artikel menggerakkan ide.
_MAHASISWA_PERSONAL_PATTERNS: list[tuple[str, str]] = [
    # 1st-person narrator
    (r"\bsaya\s+(?:akan|sengaja|ingin|paparkan|lempar|tutup)\b", "1st-person narrator"),
    (r"\baku\s+(?:akan|sengaja|ingin)\b", "1st-person narrator"),
    (r"\btulisan\s+(?:saya|ini)\s+(?:sengaja|tidak)\b", "1st-person framing"),
    # 2nd-person direct address (kalian / kamu / Anda used to direct
    # the reader). Q&A questions get exempted later — students quoting
    # themselves naturally say "kita".
    (r"\bkalian\b", "2nd-person address (kalian)"),
    (r"(?:di\s+kampus\s+)?kamu(?:\s+sendiri)?\b", "2nd-person address (kamu)"),
    # Directive verbs aimed at the reader
    (r"\b(?:coba|silakan|mari)\s+(?:debat|diskusi|tulis\s+ulang|bawa)\b", "directive to reader"),
    (r"\bambil\s+(?:satu\s+)?(?:kasus|sikap|kerangka)\b", "directive to reader"),
    (r"\btantang\s+diri\s+sendiri\b", "directive to reader"),
    (r"\bdiskusikan\s+(?:di|tanpa)\b", "directive to reader"),
    (r"\bkomen\s+di\s+postingan\b", "directive to reader"),
    (r"\bbawa\s+ke\s+ruang\s+diskusi\b", "directive to reader"),
]


def scan_mahasiswa_voice(markdown: str) -> list[BriefingWarning]:
    """Flag 1st/2nd-person voice and directive sentences inside the
    Mahasiswa `#### Artikel` body. Q&A is exempted — the **Q:** lines
    are mahasiswa pushback questions and naturally carry "kita"; the
    **A:** lines should still be impersonal-analytical but the
    quote-shape there is harder to lint cleanly, so this pass focuses
    on the Artikel where the rule is strictest."""
    warnings: list[BriefingWarning] = []
    sec4 = _section_slice(
        markdown,
        r"(?:Strategi(?:\s+(?:&|dan)\s+Aksi\s+Dakwah)?|Da['’]?wah\s+Strategies(?:\s+(?:&|and)\s+Actions)?)",
    )
    if not sec4:
        return warnings
    body = markdown[sec4[0] : sec4[1]]
    # Find `### Mahasiswa` block.
    h3s = list(re.finditer(r"^###\s+(.+)$", body, flags=re.MULTILINE))
    mahasiswa_block: str | None = None
    for i, h3 in enumerate(h3s):
        if re.match(r"Mahasiswa\b", h3.group(1).strip(), flags=re.IGNORECASE):
            start = h3.end()
            end = h3s[i + 1].start() if i + 1 < len(h3s) else len(body)
            mahasiswa_block = body[start:end]
            break
    if not mahasiswa_block:
        return warnings
    # Within Mahasiswa, isolate the Artikel sub-section (between
    # `#### Artikel` and `#### Q&A` — voice rule applies here strictly).
    h4_artikel = re.search(r"^####\s+Artikel\b", mahasiswa_block, flags=re.MULTILINE)
    if not h4_artikel:
        return warnings
    start = h4_artikel.end()
    h4_next = re.search(r"^####\s+", mahasiswa_block[start:], flags=re.MULTILINE)
    end = start + h4_next.start() if h4_next else len(mahasiswa_block)
    artikel = mahasiswa_block[start:end]
    for pattern, label in _MAHASISWA_PERSONAL_PATTERNS:
        for m in re.finditer(pattern, artikel, flags=re.IGNORECASE):
            ctx_start = max(0, m.start() - 30)
            ctx_end = min(len(artikel), m.end() + 30)
            snippet = artikel[ctx_start:ctx_end].replace("\n", " ")
            warnings.append(
                {
                    "kind": "mahasiswa_personal_voice",
                    "severity": "high",
                    "where": "Mahasiswa Artikel",
                    "message": (
                        f"{label}: '{m.group(0)}' — Mahasiswa Artikel must be "
                        f"impersonal analytical essay (no saya/aku/kalian/kamu, "
                        f"no directives to reader). Context: …{snippet}…"
                    ),
                }
            )
    return warnings


# Voice violations specific to Pengajaran di Rumah — narrator
# voice must be impersonal-instructional ("Tunggu jawaban", "JANGAN
# marah"), NOT addressing orang tua as audience ("ayah, bunda, ingin
# saya ajak..."). The QUOTED dialog inside the script legitimately
# uses "Bunda" / "kamu" / "Nak" — that's the script parent reads to
# child — so the validator strips quoted strings before scanning.
_PENGAJARAN_PREACHER_PATTERNS: list[tuple[str, str]] = [
    (r"\bsaya\s+(?:akan|ingin|ajak|ajak\s+kita)\b", "1st-person narrator"),
    (r"\bkita\s+(?:akan|sebagai\s+orang\s+tua|para\s+ayah|para\s+bunda)\b", "1st-person plural addressing parents"),
    (r"\b(?:ayah|bunda)\s*,\s*(?:pengajaran|sesi|mari)\b", "direct address to ayah/bunda"),
    # Common opener pattern: "Ayah, bunda —" / "Ayah, bunda, " starting a paragraph
    (r"(?:^|\n)\s*Ayah\s*,?\s*bunda\s*[—,\-]\s*\S", "direct address to ayah, bunda (opener)"),
    (r"(?:^|\n)\s*Para\s+(?:ayah|orang\s+tua)\b", "direct address to ayah/orang tua (opener)"),
    (r"\bayah\s+dan\s+bunda\s+(?:perlu|wajib|harus)\b", "direct address to ayah dan bunda"),
    (r"\banda\s+(?:perlu|harus|wajib)\b", "2nd-person address to orang tua"),
    (r"\bwahai\s+(?:para\s+)?(?:ayah|bunda|ibu|orang\s+tua)\b", "preacher salutation"),
    (r"\bkalian\s+sebagai\s+orang\s+tua\b", "2nd-person address"),
    (r"\bmarilah\s+kita\b", "preacher invitation"),
]


def scan_pengajaran_voice(markdown: str) -> list[BriefingWarning]:
    """Flag preacher / 1st-2nd-person voice in Pengajaran di Rumah
    narrator body. Quoted dialog (the parent-to-child script) is
    stripped before scanning — inside quotes, "Bunda" / "kamu" / "Nak"
    are part of the recipe, not narrator voice."""
    warnings: list[BriefingWarning] = []
    sec4 = _section_slice(
        markdown,
        r"(?:Strategi(?:\s+(?:&|dan)\s+Aksi\s+Dakwah)?|Da['’]?wah\s+Strategies(?:\s+(?:&|and)\s+Actions)?)",
    )
    if not sec4:
        return warnings
    body = markdown[sec4[0] : sec4[1]]
    h3s = list(re.finditer(r"^###\s+(.+)$", body, flags=re.MULTILINE))
    pengajaran_block: str | None = None
    for i, h3 in enumerate(h3s):
        if re.match(
            r"Pengajaran(?:\s+di\s+Rumah)?\b",
            h3.group(1).strip(),
            flags=re.IGNORECASE,
        ):
            start = h3.end()
            end = h3s[i + 1].start() if i + 1 < len(h3s) else len(body)
            pengajaran_block = body[start:end]
            break
    if not pengajaran_block:
        return warnings
    # Strip quoted dialog (any "..." or "…" run) — voice rules apply
    # only to narrator prose, not to the script parent reads to child.
    narrator_only = re.sub(r"[\"“][^\"”]*[\"”]", "", pengajaran_block)
    for pattern, label in _PENGAJARAN_PREACHER_PATTERNS:
        for m in re.finditer(pattern, narrator_only, flags=re.IGNORECASE):
            ctx_start = max(0, m.start() - 30)
            ctx_end = min(len(narrator_only), m.end() + 30)
            snippet = narrator_only[ctx_start:ctx_end].replace("\n", " ")
            warnings.append(
                {
                    "kind": "pengajaran_preacher_voice",
                    "severity": "high",
                    "where": "Pengajaran di Rumah",
                    "message": (
                        f"{label}: '{m.group(0)}' — narrator must be "
                        f"impersonal-instructional. Voice goes inside the "
                        f"quoted parent-to-child script, not in the "
                        f"recipe prose. Context: …{snippet}…"
                    ),
                }
            )
    return warnings


# Section heading patterns for the 3 deliverables where "Anda" is
# wrong voice (mimbar / ba'da-sholat / majelis taklim — speaker is
# part of the audience, not separate from it). Other deliverables
# (Mahasiswa is impersonal, Pengajaran has its own rule, Kreator
# uses "kamu"/"kalian", Pesan Flyer addresses individual reader) are
# untouched by this scan.
_ANDA_TARGET_HEADINGS = [
    (r"Khutbah(?:\s+Jumat)?", "Khutbah Jumat"),
    (r"Kultum(?:\s+/\s+Short\s+Talk)?", "Kultum"),
    (
        r"Kajian(?:\s+Ibu-ibu)?(?:\s+(?:&|dan)\s+Majelis\s+Taklim)?",
        "Kajian Ibu-ibu",
    ),
]


def scan_preacher_anda(markdown: str) -> list[BriefingWarning]:
    """Flag any use of 'Anda' in Khutbah / Kultum / Kajian sections —
    the speaker (khateeb, ustadz, ustadzah) must position themselves
    as part of the audience using 'kita', not separate from it using
    'Anda'. The latter creates a dosen-to-murid distance that breaks
    the mimbar / ba'da-sholat / majelis taklim voice.

    Quoted dialog inside scripts (e.g., Q&A questions naturally
    carrying 'Anda' as the asker's voice) is preserved by checking
    paragraph-level positioning — Q: lines inside Q&A are kept."""
    warnings: list[BriefingWarning] = []
    sec4 = _section_slice(
        markdown,
        r"(?:Strategi(?:\s+(?:&|dan)\s+Aksi\s+Dakwah)?|Da['’]?wah\s+Strategies(?:\s+(?:&|and)\s+Actions)?)",
    )
    if not sec4:
        return warnings
    body = markdown[sec4[0] : sec4[1]]
    h3s = list(re.finditer(r"^###\s+(.+)$", body, flags=re.MULTILINE))
    for heading_pattern, label in _ANDA_TARGET_HEADINGS:
        rx = re.compile(rf"^{heading_pattern}\b", re.IGNORECASE)
        for i, h3 in enumerate(h3s):
            heading_text = h3.group(1).strip()
            if not rx.match(heading_text):
                continue
            start = h3.end()
            end = h3s[i + 1].start() if i + 1 < len(h3s) else len(body)
            section = body[start:end]
            # Strip Q&A questions — the **Q:** lines naturally quote
            # jamaah questions that may use Anda. Keep the rest of the
            # body (including A: answers, which should NOT use Anda).
            section_no_q = re.sub(
                r"^\s*\*\*Q:\*\*[^\n]*$",
                "",
                section,
                flags=re.MULTILINE,
            )
            for m in re.finditer(r"\bAnda\b", section_no_q):
                ctx_start = max(0, m.start() - 30)
                ctx_end = min(len(section_no_q), m.end() + 30)
                snippet = section_no_q[ctx_start:ctx_end].replace("\n", " ")
                warnings.append(
                    {
                        "kind": "preacher_anda_voice",
                        "severity": "high",
                        "where": label,
                        "message": (
                            f"'Anda' in {label} — voice creates dosen-to-murid "
                            f"distance. Replace with 'kita' (speaker as part of "
                            f"audience). Context: …{snippet}…"
                        ),
                    }
                )
            break
    return warnings


# Patterns for "Allah berfirman"-style framing (case-insensitive). These
# phrases are reserved for Qur'an citations only — using them before a
# hadith is an aqidah-level mis-attribution. The trigger windows up to
# 600 chars ahead (covers one short paragraph) for a citation marker.
_FIRMAN_TRIGGER_RE = re.compile(
    r"(?i)\b("
    r"Allah\s+(?:Ta'?ala\s+)?berfirman"
    r"|Allah\s+(?:Ta'?ala\s+)?berkata"
    r"|firman\s+Allah(?:\s+Ta'?ala)?"
    r"|Allah\s+(?:Ta'?ala\s+)?mengingatkan\s+dalam\s+(?:ayat|Kitab)"
    r"|Allah\s+menyebutkan\s+dalam\s+(?:ayat|Kitab)"
    r"|Allah\s+says"
    r"|Allah's\s+word"
    r"|Allah\s+declares"
    r")\b"
)

# Citations that unambiguously point to a hadith collection (i.e. the
# Prophet ﷺ's sayings, not Allah's direct word). If a "Allah berfirman"
# trigger fires shortly before one of these, that's the mis-attribution.
_HADITH_CITATION_RE = re.compile(
    r"(?i)\b("
    r"Sahih\s+al[- ]?Bukhari"
    r"|Sahih\s+Muslim"
    r"|Bulugh\s+al[- ]?Maram"
    r"|Riyad\s+as[- ]?Salihin"
    r"|Sunan\s+(?:Ibn\s+Majah|Abu\s+Dawud|an[- ]?Nasa'?i|Tirmidzi|Tirmidhi)"
    r"|Musnad\s+Ahmad"
    r"|Muwatta(?:\s+Malik)?"
    r"|HR\.?\s+(?:Bukhari|Muslim|Tirmidzi|Tirmidhi|Abu\s+Dawud|Nasa'?i|Ibn\s+Majah|Ahmad)"
    r"|(?:Bukhari|Muslim)\s+\d+"
    r")\b"
)

# Allow "hadits qudsi" exception — if the prose explicitly tags the
# upcoming citation as hadits qudsi, "Allah berfirman" is acceptable
# because the Prophet ﷺ is relaying Allah's word that is NOT in the
# Qur'an. Window the qudsi marker check to the same 600-char span.
_HADITH_QUDSI_RE = re.compile(r"(?i)\bhadi(?:t|th)s?\s+qudsi\b")

# Qur'an citation pattern — if the trigger is followed by `QS.` /
# `Quran` instead of a hadith citation, the framing is correct and we
# don't fire.
_QURAN_CITATION_RE = re.compile(r"(?i)\b(?:QS\.|Qur'?an|Quran|Q\d+:)")


def scan_firman_hadith_mismatch(markdown: str) -> list[BriefingWarning]:
    """Flag "Allah berfirman" / "Allah Ta'ala berfirman" / "firman Allah"
    framing that precedes a HADITH citation — these phrases are
    reserved for Qur'an verses only.

    Real bug surfaced in Kultum Aqidah & Ibadah 2026-06-06:
        > Allah berfirman tentang ini.
        > **Bulugh al-Maram 890** — "Pekerjaan tangan ..."
    Bulugh al-Maram is a hadith collection; the Prophet ﷺ said it, not
    Allah. Mis-attribution at this level is an aqidah error, not a
    cosmetic typo.

    Strategy: for each "Allah berfirman" trigger, look at the next 600
    characters. If they contain a hadith citation BEFORE any Qur'an
    citation AND there's no "hadits qudsi" disclaimer, warn.
    """
    warnings: list[BriefingWarning] = []
    for match in _FIRMAN_TRIGGER_RE.finditer(markdown):
        trigger_end = match.end()
        window = markdown[trigger_end : trigger_end + 600]
        hadith_match = _HADITH_CITATION_RE.search(window)
        if not hadith_match:
            continue
        # The hadith citation has to appear BEFORE any Qur'an citation
        # — otherwise the prose is referring to a Qur'anic verse and
        # the hadith mention is a separate aside.
        quran_match = _QURAN_CITATION_RE.search(window)
        if quran_match and quran_match.start() < hadith_match.start():
            continue
        # Hadits qudsi exception — the qualifier must appear in the same
        # window (either before or alongside the citation).
        if _HADITH_QUDSI_RE.search(window):
            continue
        trigger_text = match.group(0)
        citation_text = hadith_match.group(0)
        # Locate the trigger in the markdown for a more useful "where"
        # locator (paragraph index).
        prefix = markdown[: match.start()]
        paragraph_idx = prefix.count("\n\n") + 1
        warnings.append(
            {
                "kind": "firman_hadith_mismatch",
                "severity": "high",
                "where": f"paragraph #{paragraph_idx}",
                "message": (
                    f"'{trigger_text}' framing is reserved for Qur'an "
                    f"verses, but it's followed by a HADITH citation "
                    f"({citation_text}). The Prophet ﷺ said it, not "
                    f"Allah directly. Replace with 'Rasulullah ﷺ "
                    f"bersabda' / 'Nabi ﷺ mengajarkan' / 'diriwayatkan "
                    f"bahwa ...'. If this is intentionally a hadits "
                    f"qudsi, add 'dalam hadits qudsi' to the prose so "
                    f"the reader knows the source genre."
                ),
            }
        )
    return warnings


def _norm_citation(s: str) -> str:
    """Same normalization as web's findDaleelByCitation — lowercase,
    strip punctuation, collapse whitespace. Two citations match iff
    their normalized forms are equal OR one is a prefix of the other."""
    return re.sub(r"\s+", " ", re.sub(r"[.,;:]+", "", s.lower())).strip()


# Pull every "### Pesan Flyer N — …" header + its `**Dalil:** X` line.
# The header has to come AFTER the `## Pesan Flyer` H2 section start —
# inline citations elsewhere in the briefing (Khutbah/Kultum/Kajian)
# are NOT looked up by the flyer renderer and don't need to match the
# pool. Only the 6 Pesan Flyer Dalil markers do.
_FLYER_SECTION_RE = re.compile(r"##\s+Pesan\s+Flyer\b", re.IGNORECASE)
_FLYER_HEADER_RE = re.compile(
    r"###\s+Pesan\s+Flyer\s+(\d+)\b", re.IGNORECASE
)
_FLYER_DALIL_RE = re.compile(
    r"\*\*Dalil:\*\*\s*([^\n]+?)\s*$", re.MULTILINE
)


_FLYER_H2_LINE_RE = re.compile(
    r"^##\s+(?:Pesan\s+Flyer|Flyer\s+Messages)\b", re.IGNORECASE | re.MULTILINE
)


# Outlet / handle patterns the flyer body must NOT contain. Statistics
# (numbers, views, post counts) ARE allowed — the rule only forbids
# named attribution to media outlets or social accounts.
#
# 2026-06-08 v2 tightening: removed standalone single-word outlets that
# overlap with common Indonesian words ("Detik" = "second", "Radar" =
# RADAR detection, "Antara" = "between", "Tempo" = "tempo/pace", "Inilah"
# = "this is"). Only match outlet names that are unambiguous in
# Indonesian-language text — either compound brand strings or
# domain-style identifiers.
_FLYER_OUTLET_NAMES = (
    "Republika", "Kompas", "Liputan6", "Okezone",
    "Detik.com", "Detiknews", "DetikNews",
    "Antara News", "Antaranews", "Kantor Berita Antara",
    "Radar Tegal", "Radar Jogja", "Radar Bandung", "Radar Surabaya",
    "Radar Jakarta", "Radar Bogor", "Radar Semarang",
    "Tribunnews", "Tribun News", "Tribun Jakarta", "Tribun Aceh",
    "CNN Indonesia", "CNBC Indonesia",
    "Tempo.co", "Majalah Tempo",
    "Sindonews", "Sindo News", "iNews.id",
    "Suara.com", "Merdeka.com", "Pikiran Rakyat",
    "Berita Satu", "BeritaSatu",
    "Bisnis Indonesia", "JPNN.com", "Metro TV", "TVOne", "TV One",
    "Republika Online", "Kompas TV", "Kompas.com",
)
_FLYER_OUTLET_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(n) for n in _FLYER_OUTLET_NAMES) + r")\b",
    re.IGNORECASE,
)
# @handle (X / Instagram / TikTok) and [bracket_handle] (mainstream
# author tag from the dump). Allow trailing _ and digits; min 3 chars
# after sigil to avoid false positives on emails / "@" used as "at".
_FLYER_HANDLE_AT_RE = re.compile(r"(?:^|[^\w@])@([A-Za-z][\w]{2,})")
_FLYER_HANDLE_BRACKET_RE = re.compile(r"\[([A-Za-z][\w.\-]{2,})\]")
# Direct attribution patterns: "menurut <Name>", "dilaporkan <Name>",
# "<Name> melaporkan/menulis/menyebut/menyatakan/mengatakan". Only
# trigger when the attributed party is a Capitalized proper-noun-like
# token sequence (≥1 capital word, not generic prose like "menurut
# saya" / "menurut Islam").
_FLYER_ATTRIB_RE = re.compile(
    r"\b(?:[Mm]enurut|[Dd]ilaporkan(?:\s+oleh)?)\s+"
    r"([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z.]+){0,3})\b"
    r"|"
    r"\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z.]+){0,3})\s+"
    r"(?:melaporkan|menulis|menerbitkan|menyebut(?:kan)?|menyatakan)\b"
)
# Words the attribution regex must NOT match — these are generic
# concepts, not outlets/accounts (e.g. "menurut Islam", "menurut
# Al-Qur'an", "Nabi menyebutkan", "Rasulullah menyatakan").
_FLYER_ATTRIB_ALLOWLIST = {
    "islam", "muslim", "muslimah", "al-qur'an", "alquran", "al-quran",
    "qur'an", "quran", "kitab", "sunnah", "hadits", "hadith", "nabi",
    "rasulullah", "rasul", "allah", "syariat", "ulama", "para", "imam",
    "khalifah", "sahabat", "khabbab", "suhaib", "ibn", "bin", "anas",
    "umar", "abu", "abdullah", "abdurrahman", "uthman", "ali", "fatimah",
    "aisyah", "khadijah", "syu'aib", "musa", "isa", "ibrahim", "yusuf",
    "ahmad", "syafi'i", "malik", "bukhari", "tirmidzi", "dawud", "nasai",
    "ghazali", "nawawi", "katsir", "kementerian", "menteri",
    "pemerintah", "presiden", "kemenkes", "kemenag", "kemendikbud",
}


def scan_flyer_outlet_handle(markdown: str) -> list[BriefingWarning]:
    """Pesan Flyer bodies must not name media outlets, social handles,
    or attribute statements to specific accounts. Statistics (post
    counts, views) ARE allowed; only the attribution is forbidden.

    Real bug surfaced 2026-06-08 in Toleransi & Lintas-Iman briefing:
    flyer body mentioned 'Republika menerbitkan artikel…', '[_BangFu]',
    '[vita_AVP]' — all leaked from the headlines pool into the flyer
    text. The flyer is a self-contained message shared on IG/WA,
    so editorial attribution is noise + accidental endorsement.
    """
    warnings: list[BriefingWarning] = []
    slc = _section_slice(markdown, r"Pesan\s+Flyer")
    if not slc:
        return warnings
    section = markdown[slc[0] : slc[1]]

    h3_iter = list(
        re.finditer(
            r"^###\s+Pesan\s+Flyer\s+(\d)[^\n]*$",
            section,
            flags=re.MULTILINE | re.IGNORECASE,
        )
    )
    for i, h3 in enumerate(h3_iter):
        slot = int(h3.group(1))
        body_start = h3.end()
        body_end = (
            h3_iter[i + 1].start() if i + 1 < len(h3_iter) else len(section)
        )
        body = section[body_start:body_end]

        # Strip marker lines (**Headline:**, **Dalil:**) before scanning
        # — citation strings can legitimately contain "Bukhari" etc.
        body_prose = re.sub(
            r"^\s*\*\*\s*(?:Headline|Judul|Tema|Dalil|Daleel)\s*:\*\*[^\n]*$",
            "",
            body,
            flags=re.MULTILINE | re.IGNORECASE,
        )

        hits: list[str] = []

        for m in _FLYER_OUTLET_RE.finditer(body_prose):
            hits.append(f"outlet name '{m.group(0)}'")

        for m in _FLYER_HANDLE_AT_RE.finditer(body_prose):
            hits.append(f"social handle '@{m.group(1)}'")

        for m in _FLYER_HANDLE_BRACKET_RE.finditer(body_prose):
            # Skip purely-numeric or single-char bracket content
            # (footnote-style refs like [1], [42] are not handles).
            handle = m.group(1)
            if handle.lower() in {"sic", "ed", "redaksi"}:
                continue
            hits.append(f"bracket handle '[{handle}]'")

        for m in _FLYER_ATTRIB_RE.finditer(body_prose):
            attr_subj = (m.group(1) or m.group(2) or "").strip()
            first_word = attr_subj.split()[0].lower() if attr_subj else ""
            if first_word in _FLYER_ATTRIB_ALLOWLIST:
                continue
            hits.append(f"attribution to '{attr_subj}'")

        if hits:
            # Dedup while preserving order
            seen: set[str] = set()
            uniq = [h for h in hits if not (h in seen or seen.add(h))]
            warnings.append(
                {
                    "kind": "flyer_outlet_or_handle",
                    "severity": "high",
                    "where": f"Pesan Flyer {slot}",
                    "message": (
                        f"body names outlet/account/attribution: "
                        f"{', '.join(uniq)}. Flyer is a self-contained "
                        f"IG/WA share — strip the name(s) and rewrite "
                        f"using generic framing ('pekan ini ramai...', "
                        f"'kabar yang sampai ke kita...'). Statistics "
                        f"(views, post counts) are still allowed."
                    ),
                }
            )
    return warnings


# Flyer-independence patterns. Pesan Flyer bodies must be self-contained
# (no references to other deliverables in the SAME briefing, no
# staged-narrator framing that implies a specific pulpit/audience).
# Added 2026-06-19 after batch shipped with 80+ flyers opening
# "Jamaah Jumat pekan ini...", "Mimbar pekan ini...", "Takmir dan
# pengurus RT pekan ini...", "Kreator dakwah pekan ini...", "Mahasiswa
# pekan ini..." — leaking briefing scaffolding into IG/WA share-cards
# that the reader has no briefing context for. See AGENTS.md
# [FLYER INDEPENDENCE — INVIOLABLE].
_FLYER_INDEPENDENCE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Cross-deliverable references — naming other sub-sections of the
    # same briefing.
    (re.compile(r"\bkhutbah\s+jum.?at\b", re.IGNORECASE), "khutbah jum'at"),
    (re.compile(r"\bkhutbah\s+pekan\s+ini\b", re.IGNORECASE), "khutbah pekan ini"),
    (re.compile(r"\bkhutbah(?:nya)?\s+(?:ini|hari\s+ini)\b", re.IGNORECASE), "khutbah ini/hari ini"),
    (re.compile(r"\bkultum\s+pekan\s+ini\b", re.IGNORECASE), "kultum pekan ini"),
    (re.compile(r"\bkajian\s+pekan\s+ini\b", re.IGNORECASE), "kajian pekan ini"),
    (re.compile(r"\bkajian\s+ibu[-\s]?ibu\b", re.IGNORECASE), "kajian ibu-ibu"),
    (re.compile(r"\bmajelis\s+taklim\b", re.IGNORECASE), "majelis taklim"),
    (re.compile(r"\bpengajaran\s+di\s+rumah\b", re.IGNORECASE), "pengajaran di rumah"),
    (re.compile(r"\bkisah\s+pendek\s+pekan\s+ini\b", re.IGNORECASE), "kisah pendek pekan ini"),
    (re.compile(r"\bkreator\s+pekan\s+ini\b", re.IGNORECASE), "kreator pekan ini"),
    (re.compile(r"\bkreator\s+dakwah\s+pekan\s+ini\b", re.IGNORECASE), "kreator dakwah pekan ini"),
    (re.compile(r"\bkreator\s+konten\s+pekan\s+ini\b", re.IGNORECASE), "kreator konten pekan ini"),
    (re.compile(r"\baksi\s+sosial\s+pekan\s+ini\b", re.IGNORECASE), "aksi sosial pekan ini"),
    (re.compile(r"\bartikel\s+mahasiswa\b", re.IGNORECASE), "artikel mahasiswa"),
    (re.compile(r"\bmahasiswa\s+pekan\s+ini\b", re.IGNORECASE), "mahasiswa pekan ini"),

    # Staged-narrator audience framings. The "X pekan ini ..." opener is
    # the canonical violation — implies a memo to a specific operator.
    (re.compile(r"\bjamaah\s+jum.?at\b", re.IGNORECASE), "jamaah jum'at"),
    (re.compile(r"\bjamaah\s+pekan\s+ini\b", re.IGNORECASE), "jamaah pekan ini"),
    (re.compile(r"\bmimbar\s+(?:jum.?at|pekan\s+ini|ini)\b", re.IGNORECASE), "mimbar jum'at/pekan-ini/ini"),
    (re.compile(r"\bdi\s+mimbar\b", re.IGNORECASE), "di mimbar"),
    (re.compile(r"\bkhateeb\b", re.IGNORECASE), "khateeb"),
    (re.compile(r"\bkhatib\s+(?:menutup|membingkai|mengajak|memandu|berdiri|menyampaikan)", re.IGNORECASE), "khatib + verb"),
    (re.compile(r"\bimam\s+masjid\s+pekan\s+ini\b", re.IGNORECASE), "imam masjid pekan ini"),
    (re.compile(r"\btakmir\b", re.IGNORECASE), "takmir"),
    (re.compile(r"\bpengurus\s+rt\b", re.IGNORECASE), "pengurus RT"),
    (re.compile(r"\bsantri\s+pekan\s+ini\b", re.IGNORECASE), "santri pekan ini"),

    # Instructions framed AT another sub-section operator.
    (re.compile(r"\bbawa\s+(?:ini\s+)?ke\s+khutbah\b", re.IGNORECASE), "bawa ke khutbah"),
    (re.compile(r"\bjadikan\s+sumbu\s+khutbah\b", re.IGNORECASE), "jadikan sumbu khutbah"),
    (re.compile(r"\bbuka\s+khutbah\s+dengan\b", re.IGNORECASE), "buka khutbah dengan"),
    (re.compile(r"\bkhatib\s+menutup\s+dengan\b", re.IGNORECASE), "khatib menutup dengan"),
    (re.compile(r"\bkhateeb\s+(?:menutup|membingkai|memandu|dapat\s+memandu)\b", re.IGNORECASE), "khateeb + verb"),
]


def scan_flyer_independence(markdown: str) -> list[BriefingWarning]:
    """Pesan Flyer bodies must be self-contained — no references to
    other deliverables in the same briefing, no staged-narrator framings
    (jamaah Jumat / mimbar / takmir / pengurus RT / kreator pekan ini /
    mahasiswa pekan ini). The flyer is a standalone IG/WA share-card —
    the reader has no briefing context.

    Live in prod since 2026-06-19 after 80+ of 84 flyers shipped with
    audience-staged framing. See AGENTS.md
    [FLYER INDEPENDENCE — INVIOLABLE] for the full rule.
    """
    warnings: list[BriefingWarning] = []
    slc = _section_slice(markdown, r"Pesan\s+Flyer")
    if not slc:
        return warnings
    section = markdown[slc[0] : slc[1]]

    h3_iter = list(
        re.finditer(
            r"^###\s+Pesan\s+Flyer\s+(\d)[^\n]*$",
            section,
            flags=re.MULTILINE | re.IGNORECASE,
        )
    )
    for i, h3 in enumerate(h3_iter):
        slot = int(h3.group(1))
        body_start = h3.end()
        body_end = (
            h3_iter[i + 1].start() if i + 1 < len(h3_iter) else len(section)
        )
        body = section[body_start:body_end]

        # Strip marker lines + Arabic blocks before scanning — citation
        # strings may legitimately contain words that overlap with
        # cross-deliverable tokens.
        body_prose = re.sub(
            r"^\s*\*\*\s*(?:Headline|Judul|Tema|Dalil|Daleel)\s*:\*\*[^\n]*$",
            "",
            body,
            flags=re.MULTILINE | re.IGNORECASE,
        )

        hits: list[str] = []
        for pat, label in _FLYER_INDEPENDENCE_PATTERNS:
            if pat.search(body_prose):
                hits.append(label)

        if hits:
            seen: set[str] = set()
            uniq = [h for h in hits if not (h in seen or seen.add(h))]
            warnings.append(
                {
                    "kind": "flyer_independence_violation",
                    "severity": "high",
                    "where": f"Pesan Flyer {slot}",
                    "message": (
                        f"body references other deliverable / uses "
                        f"staged-narrator framing: {', '.join(uniq)}. "
                        f"Flyer is a standalone IG/WA share-card — "
                        f"reader has NO briefing context. Rewrite the "
                        f"body universally addressed to the reader, "
                        f"starting from the daleel's principle or the "
                        f"contemporary pattern directly. NO 'jamaah "
                        f"pekan ini ...' / 'takmir pekan ini ...' / "
                        f"'kreator pekan ini ...' / 'mahasiswa pekan "
                        f"ini ...' / 'khateeb membingkai ...' / 'bawa "
                        f"ke khutbah ...' openers. See AGENTS.md "
                        f"[FLYER INDEPENDENCE — INVIOLABLE]."
                    ),
                }
            )
    return warnings


# Generic template phrases forbidden in `**Headline:**` markers.
# The headline must be punchy + flyer-specific; generic phrases like
# "Pekan ini" or "Renungan Mingguan" defeat the purpose (every flyer
# would look identical in the IG gallery and the renderer falls back
# to the body's first words when the marker is missing, producing the
# same generic result).
_FLYER_HEADLINE_RE_M = re.compile(
    r"^\s*\*\*\s*(?:Headline|Judul|Tema)\s*:\s*\*\*\s*[\"“”']?\s*(.+?)\s*[\"“”']?\s*$",
    re.MULTILINE | re.IGNORECASE,
)
_GENERIC_HEADLINE_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"^pekan ini\b",
        r"^pesan pekan ini$",
        r"^pesan mingguan$",
        r"^renungan( pekan ini| mingguan)?$",
        r"^refleksi( pekan ini| mingguan)?$",
        r"^doa pekan ini$",
        r"^du'?a pekan ini$",
        r"^ajakan sunnah( pekan ini)?$",
        r"^tema kit$",
        r"^kit konten\b",
        r"^konten pekan ini$",
        r"^khutbah (pertama|jumat|kedua)$",
        r"^kultum( pekan ini)?$",
        r"^suara (khutbah|aksi sosial|kreator|kreator konten|gen z|refleksi gen z)$",
        r"^apa yang terjadi pekan ini\??$",
    )
]


def scan_flyer_headline_quality(markdown: str) -> list[BriefingWarning]:
    """Each Pesan Flyer block must carry a `**Headline:**` marker with a
    punchy, flyer-specific title. Two failure modes:

      (a) MISSING marker — the web flyer renderer falls back to
          extracting the first words of the body, producing weak titles
          like "Pekan ini" (real 2026-06-08 bug in Inspirasi & Toleransi
          briefings).
      (b) GENERIC marker — title matches a template phrase like
          "Pesan Pekan Ini" / "Renungan Mingguan" / "Doa Pekan Ini".
          These look identical across all 14 briefings in the IG
          gallery and defeat the eye-catching purpose of the title.
    """
    warnings: list[BriefingWarning] = []
    slc = _section_slice(markdown, r"Pesan\s+Flyer")
    if not slc:
        return warnings
    section = markdown[slc[0] : slc[1]]
    h3s = list(
        re.finditer(
            r"^###\s+Pesan\s+Flyer\s+(\d)[^\n]*$",
            section,
            flags=re.MULTILINE | re.IGNORECASE,
        )
    )
    for i, h3 in enumerate(h3s):
        slot = int(h3.group(1))
        start = h3.end()
        end = h3s[i + 1].start() if i + 1 < len(h3s) else len(section)
        block = section[start:end]
        hl_match = _FLYER_HEADLINE_RE_M.search(block)
        if not hl_match:
            warnings.append(
                {
                    "kind": "flyer_headline_missing_or_generic",
                    "severity": "high",
                    "where": f"Pesan Flyer {slot}",
                    "message": (
                        "MISSING `**Headline:**` marker. Web renderer "
                        "will fall back to extracting the first words "
                        "of the body and produce a weak title (real "
                        "2026-06-08 bug: 12 flyers rendered with title "
                        "\"Pekan ini\"). Add a `**Headline:** \"...\"` "
                        "line right under the `### Pesan Flyer "
                        f"{slot}` heading — 4-6 punch words, active "
                        "voice, flyer-specific."
                    ),
                }
            )
            continue
        title = hl_match.group(1).strip().strip("\"“”'")
        for pat in _GENERIC_HEADLINE_PATTERNS:
            if pat.match(title):
                warnings.append(
                    {
                        "kind": "flyer_headline_missing_or_generic",
                        "severity": "high",
                        "where": f"Pesan Flyer {slot}",
                        "message": (
                            f"GENERIC headline '{title}'. This phrase "
                            f"looks identical across all 14 weekly "
                            f"briefings in the IG gallery and gives "
                            f"the reader no reason to stop scrolling. "
                            f"Replace with a punchy 4-6 word headline "
                            f"specific to this flyer's message (e.g. "
                            f"'Mulai Adil dari Meja Sendiri', "
                            f"'Cukupkan Takaran di Setiap Transaksi')."
                        ),
                    }
                )
                break
    return warnings


def scan_flyer_section_structure(markdown: str) -> list[BriefingWarning]:
    """The web flyer renderer (web/src/lib/flyer/content.ts
    ::extractDedicatedFlyerBlock) requires a top-level `## Pesan Flyer`
    (or `## Flyer Messages`) H2 section as the anchor — it scans only
    inside that section for `### Pesan Flyer N` H3 blocks.

    Real bug surfaced 2026-06-08: two briefings (Inspirasi & Kisah
    Pribadi + Toleransi & Lintas-Iman) nested the H3 blocks under
    `## Dalil & Sumber` H2 instead of giving them their own H2. The
    extractor returned null, a legacy fallback fired, and 4 of 6
    rendered flyers showed unrelated content (one was completely
    empty).

    This validator catches that shape before save. Two failure modes:
      (a) No `## Pesan Flyer` H2 line exists at all but H3 blocks do —
          renderer will silently fall back.
      (b) Wrong number of `### Pesan Flyer N` H3 blocks — should be
          exactly 6 (slots 1-6).
    """
    warnings: list[BriefingWarning] = []
    h2_match = _FLYER_H2_LINE_RE.search(markdown)
    h3_headers = list(_FLYER_HEADER_RE.finditer(markdown))

    if not h2_match and h3_headers:
        warnings.append(
            {
                "kind": "flyer_section_malformed",
                "severity": "high",
                "where": "## Pesan Flyer",
                "message": (
                    f"Found {len(h3_headers)} `### Pesan Flyer N` H3 "
                    f"blocks but NO top-level `## Pesan Flyer` H2 "
                    f"section heading. The web flyer extractor requires "
                    f"the H2 wrapper — without it, "
                    f"extractDedicatedFlyerBlock() returns null and a "
                    f"legacy fallback ships unrelated content as the "
                    f"flyer body. Fix: add a `## Pesan Flyer` line as "
                    f"its own H2 (separate from `## Dalil & Sumber`) "
                    f"above the first `### Pesan Flyer 1` block."
                ),
            }
        )
        return warnings  # downstream count check is misleading without H2

    # Allow the documented empty-pool skip path (added 2026-06-18): when
    # FLYER DALEEL POOL is empty for the week, the prompt instructs the
    # composer to emit the `## Pesan Flyer` H2 header alone with a single
    # `_Pool flyer kosong pekan ini, slot dilewati._` note — no H3 blocks
    # at all. This is a legitimate state (no whitelist-eligible daleel
    # for the theme this week → no flyers ship; renderer just falls back
    # to the dashboard's "no flyer this week" empty state). So treat 0
    # H3 blocks as valid; reject only partial 1-5 (incomplete set risks
    # blank-card renders).
    if h2_match and h3_headers and len(h3_headers) != 6:
        warnings.append(
            {
                "kind": "flyer_section_malformed",
                "severity": "high",
                "where": "## Pesan Flyer",
                "message": (
                    f"`## Pesan Flyer` section contains "
                    f"{len(h3_headers)} `### Pesan Flyer N` H3 blocks "
                    f"— expected either exactly 6 (one per slot 1-6) or "
                    f"0 + the documented skip note (when FLYER POOL is "
                    f"empty for the week). The flyer renderer iterates "
                    f"slots 0-5 and will render blank cards for missing "
                    f"slots or ignore extras."
                ),
            }
        )

    return warnings


def scan_flyer_dalil_in_pool(
    markdown: str,
    daleel_pool: list[dict[str, Any]] | None = None,
    adhkar_pool: list[dict[str, Any]] | None = None,
) -> list[BriefingWarning]:
    """Each `### Pesan Flyer N` block carries a `**Dalil:**` line that
    pins which pool entry the flyer renderer uses for the daleel card.
    If the cited string doesn't match any pool entry (normalized,
    prefix-tolerant), the renderer silently falls back to
    `pickFlyerDaleel(rank)` — picking a daleel by position that has
    NOTHING to do with the flyer's message. That mis-rendered daleel
    ships to production unnoticed.

    Real bug surfaced in the 2026-06-07 audit: 50/90 flyer markers
    across all briefings cited daleel NOT in the stored pool, because
    the chained `dump → save` command re-ran dump between writing and
    saving, re-retrieving a different pool from Qdrant.

    Strategy:
      - Locate the `## Pesan Flyer` section header. Below it, find every
        `### Pesan Flyer N` block.
      - For each block, extract the `**Dalil:** X` line.
      - Flyers 1-4 cite from `daleel_pool`. Flyers 5-6 cite from
        `adhkar_pool`. If a flyer cites a citation that isn't in its
        designated pool (case-insensitive, prefix-tolerant), flag it
        at severity=high.

    Returns empty list if no pools provided or no Pesan Flyer section.
    """
    if not daleel_pool and not adhkar_pool:
        return []
    sec_m = _FLYER_SECTION_RE.search(markdown)
    if not sec_m:
        return []
    flyer_section = markdown[sec_m.start():]
    daleel_norms = {_norm_citation(d.get("citation", "")) for d in (daleel_pool or [])}
    adhkar_norms = {_norm_citation(d.get("citation", "")) for d in (adhkar_pool or [])}
    # Combined pool — accept either daleel or adhkar match. Slot
    # discipline (flyer 5/6 must be adhkar) is enforced separately by
    # the renderer; for the "citation exists at all" check, either
    # pool is fine.
    all_norms = daleel_norms | adhkar_norms

    def _in_pool(nc: str) -> bool:
        if nc in all_norms:
            return True
        # Prefix-tolerant — matches "QS. Al-Ma'aarij" vs "QS. Al-Ma'aarij: 32"
        return any(p.startswith(nc) or nc.startswith(p) for p in all_norms if p)

    warnings: list[BriefingWarning] = []
    headers = list(_FLYER_HEADER_RE.finditer(flyer_section))
    for idx, h in enumerate(headers):
        flyer_n = h.group(1)
        block_start = h.start()
        block_end = (
            headers[idx + 1].start() if idx + 1 < len(headers) else len(flyer_section)
        )
        block = flyer_section[block_start:block_end]
        dalil_m = _FLYER_DALIL_RE.search(block)
        if not dalil_m:
            continue
        cited = dalil_m.group(1).strip()
        # Allow explicit "no daleel" markers — `—`, `-`, `–`, empty.
        if cited in ("—", "-", "–", ""):
            continue
        if _in_pool(_norm_citation(cited)):
            continue
        warnings.append(
            {
                "kind": "flyer_dalil_not_in_pool",
                "severity": "high",
                "where": f"Pesan Flyer {flyer_n}",
                "message": (
                    f"Dalil marker '{cited}' is NOT in the saved daleel/"
                    f"adhkar pool. Renderer will silently fall back to "
                    f"pickFlyerDaleel(rank) and display a mismatched "
                    f"daleel. Fix: save-time refetch will attempt to "
                    f"pull this citation from Qdrant + top up the pool. "
                    f"If refetch fails (citation unparseable or no "
                    f"matching chunk), the save will hard-fail."
                ),
                "flyer_index": flyer_n - 1,
                "current_citation": cited,
            }
        )
    return warnings


def scan_dangling_citations(markdown: str) -> list[BriefingWarning]:
    """A sentence ending '...Allah Ta'ala dalam QS.' or '...berfirman:'
    is a wind-up that only makes sense if the citation actually
    follows. The "standalone Arabic paragraph" rule (added 2026-06-06)
    allows the citation to sit in the NEXT paragraph as a `**…**`
    marker or as an Arabic block — so this check only fires when
    NEITHER the same paragraph nor the next one carries the bridge."""
    warnings: list[BriefingWarning] = []
    paragraphs = re.split(r"\n{2,}", markdown)
    for idx, para in enumerate(paragraphs):
        text = para.strip()
        if not text or text.startswith("#") or text.startswith(">"):
            continue
        # Check the trailing sentence — split on `.!?` and look at the
        # last non-empty fragment.
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
        if not sentences:
            continue
        last = sentences[-1].rstrip(".!?").strip()
        if not _DANGLING_CITATION_RE.search(last):
            continue
        # Look ahead: does this paragraph itself contain Arabic (bridge
        # completed inline), or does the next paragraph carry a
        # citation marker / Arabic block (bridge across paragraphs —
        # the new convention)?
        bridge_inline = bool(_ARABIC_CHAR_RE.search(text))
        next_para = paragraphs[idx + 1].strip() if idx + 1 < len(paragraphs) else ""
        bridge_next = bool(
            _NEXT_PARA_CITATION_RE.match(next_para) or _starts_with_arabic(next_para)
        )
        if bridge_inline or bridge_next:
            continue
        preview = last[-60:]
        warnings.append(
            {
                "kind": "dangling_citation",
                "severity": "high",
                "where": f"paragraph #{idx + 1}",
                "message": (
                    f"paragraph ends with citation lead-in '…{preview}' "
                    f"but neither this nor the next paragraph carries the "
                    f"actual citation marker (e.g. **QS. X: Y**) or an "
                    f"Arabic quote. Renderer drops the orphan stub."
                ),
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
        # Pull the `**Dalil:**` (current) or `**Daleel:**` (legacy)
        # marker. Empty / missing → empty string. Both forms coexist
        # while the 2026-05-24 ID-prompt change rolls out and the
        # backfill rewrites old rows.
        daleel_match = re.search(
            r"\*\*(?:Dalil|Daleel):\*\*\s*([^\n]+)",
            body,
            flags=re.IGNORECASE,
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

        # Trim paragraph: drop the **Headline:**, **Dalil:** /
        # **Daleel:** markers (both forms accepted during the rollout).
        para_body = re.sub(
            r"\*\*(Headline|Dalil|Daleel)\:\*\*[^\n]*\n?",
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

        # Find the **Dalil:** / **Daleel:** line that appears INSIDE
        # this specific flyer's body. Both forms accepted during the
        # 2026-05-24 rollout. The capturing group preserves the actual
        # marker style in the rewrite (so the rewrite keeps the
        # original "Dalil" or "Daleel" wording).
        block_body = blocks[idx]["body"]
        daleel_re = re.compile(
            r"(\*\*(?:Dalil|Daleel):\*\*\s*)" + re.escape(current),
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
    flyer_daleel_pool: list[dict[str, Any]] | None = None,
    flyer_adhkar_pool: list[dict[str, Any]] | None = None,
    llm_judgments: bool = False,
) -> list[BriefingWarning]:
    """Run all validators. Never raises — failures inside individual
    passes are logged and the pass returns no warnings for that
    branch.

    `flyer_daleel_pool` / `flyer_adhkar_pool` (added 2026-06-09) are
    the corpus-restricted pools the LLM was instructed to draw flyer
    citations from. When supplied, the flyer-specific checks
    (scan_flyer_dalil_in_pool + check_flyer_daleel_alignment) use
    THESE pools instead of the broader daleel/adhkar pools — so a
    flyer citing a non-whitelist corpus fails the in-pool check.
    Backwards-compatible: when omitted, those checks fall back to
    the broader pools (the pre-2026-06-09 behaviour).

    `llm_judgments` gates the API-LLM-based passes:
      - False (default, manual flow): only regex/heuristic checks
        (forbidden phrases). Paragraph↔daleel fit and absurd-advice
        detection get done by the operator's Claude session out of
        band — no API-LLM call out from this script.
      - True (auto pipeline): also runs the Gemini Flash-Lite passes
        for daleel alignment + advice sanity. Fine in the auto path
        since it's already an API-LLM context.
    """
    flyer_dpool = (
        flyer_daleel_pool if flyer_daleel_pool is not None else daleel_pool
    )
    flyer_apool = (
        flyer_adhkar_pool if flyer_adhkar_pool is not None else adhkar_pool
    )
    warnings: list[BriefingWarning] = []
    try:
        warnings.extend(scan_forbidden_phrases(markdown))
    except Exception as exc:
        log.warning("validate_briefing.forbidden_scan_failed", error=str(exc))
    # Structural anti-patterns (added 2026-06-06). Each pass is
    # independent — one regex throwing doesn't block the others. None
    # of these call out to an API LLM; safe on the manual save path.
    for fn, key in (
        (scan_poin_kunci_missing_dalil, "poin_kunci_check_failed"),
        (scan_pesan_flyer_inline_arabic, "flyer_arabic_check_failed"),
        (scan_mixed_script_paragraphs, "mixed_script_check_failed"),
        (scan_dangling_citations, "dangling_citation_check_failed"),
        (scan_deliverable_word_counts, "word_count_check_failed"),
        (scan_kisah_voice, "kisah_voice_check_failed"),
        (scan_mahasiswa_voice, "mahasiswa_voice_check_failed"),
        (scan_pengajaran_voice, "pengajaran_voice_check_failed"),
        (scan_preacher_anda, "preacher_anda_check_failed"),
        (scan_firman_hadith_mismatch, "firman_hadith_check_failed"),
        (scan_flyer_section_structure, "flyer_section_structure_check_failed"),
        (scan_flyer_outlet_handle, "flyer_outlet_handle_check_failed"),
        (scan_flyer_headline_quality, "flyer_headline_quality_check_failed"),
        (scan_flyer_independence, "flyer_independence_check_failed"),
    ):
        try:
            warnings.extend(fn(markdown))
        except Exception as exc:
            log.warning(f"validate_briefing.{key}", error=str(exc))
    # Pool-aware flyer checks use the FLYER-restricted pools (7-kitab
    # whitelist) when supplied — so any flyer citing a non-whitelist
    # corpus fails the in-pool check and gets caught at save time.
    try:
        warnings.extend(
            scan_flyer_dalil_in_pool(markdown, flyer_dpool, flyer_apool)
        )
    except Exception as exc:
        log.warning(
            "validate_briefing.flyer_dalil_in_pool_check_failed", error=str(exc)
        )
    if llm_judgments:
        # Paragraph↔daleel fit + absurd-advice scoring + replacement
        # suggester all call Gemini Flash-Lite. Skipped on the manual
        # path so the script doesn't make API-LLM calls out — the
        # operator's Claude session does that judgment in-chat.
        try:
            warnings.extend(
                check_flyer_daleel_alignment(
                    markdown, flyer_dpool, adhkar_pool=flyer_apool
                )
            )
        except Exception as exc:
            log.warning(
                "validate_briefing.alignment_check_failed", error=str(exc)
            )
    return warnings


def scan_news_paraphrase_facts(
    markdown: str,
    sample_headlines: list[dict[str, Any]] | None,
) -> list[BriefingWarning]:
    """LLM-judge fact-check against ground-truth news headlines.

    Spawns a Claude API call (Sonnet 4.6) to scan the briefing body for
    name-role paraphrase fabrications — the failure mode that the
    2026-06-18 audit found 12 instances of (pelatih bola Senegal shahada
    at konferensi pers, pesantren cabul this week, aktivis berinisial X
    teror dari kementerian, Wakil Ketua KPK menyebut seluruh anggota
    Komisi XI, buron sejak 1994, dosen senior dipecat jurnal predator,
    Iran-AS perang aktif post-MoU, etc.).

    These are defamation-risk fabrications that structural validators
    (forbidden phrases, flyer headlines, dalil-in-pool) cannot catch
    because they are SEMANTIC mismatches between claimed news event and
    actual headlines.

    Returns BriefingWarning with severity 'high' for fabrications that
    would defame a named person/institution; 'medium' for unverified
    current-week claims; 'low' for tangential issues. Hard-fail callers
    (manual_briefing.cmd_save) should reject save on any 'high' result.

    Costs ~$0.01-0.03 per call on Sonnet 4.6 (~10-20K input tokens,
    1-2K output). Skipped (returns []) when anthropic_api_key is unset
    or sample_headlines is empty.

    Added 2026-06-18 as Layer 3 of the briefing pipeline fact-check
    architecture. Layer 1 = composer SELF-FACT-CHECK in SYSTEM_PROMPT.
    Layer 2 = workflow Verify phase (operator-initiated). Layer 3 (this
    function) = code-side hard gate that fires automatically on save
    regardless of operator's workflow choice — the missing piece that
    made the difference between "probably fine" and "structurally safe".
    """
    from api.config import settings

    if not settings.anthropic_api_key:
        log.info("validate_briefing.fact_check_skipped", reason="no_api_key")
        return []

    headlines = sample_headlines or []
    if not headlines:
        log.info("validate_briefing.fact_check_skipped", reason="no_headlines")
        return []

    # Render headlines as ground truth corpus for the judge
    headline_lines: list[str] = []
    for h in headlines[:120]:  # cap to keep prompt budget bounded
        when = h.get("posted_at_wib") or h.get("posted_at") or ""
        source = h.get("author") or h.get("platform") or "?"
        text = (h.get("text") or "").replace("\n", " ").replace("\r", " ").strip()
        if text:
            headline_lines.append(f"- [{when}] {source}: {text[:240]}")
    if not headline_lines:
        return []
    headlines_block = "\n".join(headline_lines)

    judge_prompt = f"""You are auditing an Indonesian weekly dakwah briefing for fact-check violations against this week's news ground truth.

GROUND TRUTH — mainstream Indonesian news headlines from this week ({len(headline_lines)} entries):

{headlines_block}

BRIEFING BODY TO AUDIT (Indonesian; ~80-100KB):

{markdown[:90000]}

YOUR TASK:
Scan the briefing body for paragraphs that pair a NAMED ENTITY (proper noun — person, agency, company, university, ormas, named viral post) with a ROLE VERB (bebas, dicopot, dilantik, ditahan, tersangka, tertangkap, vonis, dibebaskan, dipenjara, dipulihkan, menggantikan, pelaku cabul, korban penculikan, dijatuhi, mengaku menerima teror, buron sejak X, dipecat after melapor, etc.).

For EACH such pair: cross-reference against the ground-truth headlines block above. If the briefing claims a role/event that is NOT in the headlines, flag it.

KNOWN HALLUCINATION PATTERNS (these recurred in the 2026-06-18 audit — flag aggressively if they appear without explicit headline support):
- "pelatih sepak bola Senegal/Afrika shahada di konferensi pers internasional"
- "pesantren cabul / kiai pemerkosa pekan ini"
- "aktivis berinisial X mengaku teror dari kementerian"
- "Wakil Ketua KPK menyebut seluruh anggota Komisi XI" (or similar collective-defamation claims)
- "buron sejak 1994 / aset miliaran ditarik pekan ini"
- "dosen senior dipecat setelah melaporkan jurnal predator"
- "Iran-AS perang aktif" (this week is POST-MoU damai)
- Sindiran/satire "pulang haji jadi tersangka korupsi" treated as a real current case

SEVERITY:
- 'high' = defamation risk: specific person/institution + criminal/negative role NOT in headlines. Save MUST be blocked.
- 'medium' = current-week event claim not verifiable (viral satire as fact, social-media virality, unverified pattern)
- 'low' = tangential / unverified detail; no defamation risk

Return STRICT JSON with this exact shape — no preamble, no markdown, just JSON:
{{
  "findings": [
    {{
      "severity": "high" | "medium" | "low",
      "where": "section name (e.g. Khutbah Jumat, Kultum, Mahasiswa Artikel)",
      "quote": "verbatim phrase from briefing (≤200 chars)",
      "named_entity": "the proper noun in question",
      "claimed_role": "role the briefing attributes",
      "actual_situation": "what headlines actually show, or 'no supporting headline found'",
      "fix_suggestion": "concrete one-sentence fix"
    }}
  ]
}}

If briefing is clean, return {{"findings": []}}.
"""

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=settings.anthropic_api_key)
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=[{"role": "user", "content": judge_prompt}],
        )
        from api.services.usage import record_usage
        record_usage(
            provider="anthropic",
            operation="briefing_fact_check",
            model="claude-sonnet-4-6",
            tokens_in=resp.usage.input_tokens,
            tokens_out=resp.usage.output_tokens,
            cost_usd=(
                resp.usage.input_tokens * 3.0 / 1_000_000
                + resp.usage.output_tokens * 15.0 / 1_000_000
            ),
            meta={"briefing_chars": len(markdown), "headlines_count": len(headline_lines)},
        )
        raw = "".join(
            block.text for block in resp.content if block.type == "text"
        ).strip()
    except Exception as exc:
        log.warning("validate_briefing.fact_check_api_failed", error=str(exc))
        return []

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.strip("`").lstrip("json").strip()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        log.warning(
            "validate_briefing.fact_check_unparseable_response",
            error=str(exc),
            raw_head=raw[:300],
        )
        return []

    findings = parsed.get("findings", [])
    if not isinstance(findings, list):
        return []

    warnings: list[BriefingWarning] = []
    for f in findings:
        if not isinstance(f, dict):
            continue
        sev_in = f.get("severity", "medium")
        sev: Literal["low", "medium", "high"] = (
            "high" if sev_in == "high"
            else "medium" if sev_in == "medium"
            else "low"
        )
        where = f.get("where", "(unknown section)")
        quote = (f.get("quote") or "")[:200]
        entity = f.get("named_entity", "?")
        claimed = f.get("claimed_role", "?")
        actual = f.get("actual_situation", "no supporting headline found")
        fix = f.get("fix_suggestion", "")
        msg = (
            f"'{entity}' attributed role '{claimed}'. "
            f"Ground truth: {actual}. "
            f"Fix: {fix}. "
            f"Quote: …{quote}…"
        )
        warnings.append(
            {
                "kind": "news_paraphrase_fabrication",
                "severity": sev,
                "where": where,
                "message": msg,
            }
        )
    log.info(
        "validate_briefing.fact_check_done",
        findings=len(findings),
        high=sum(1 for w in warnings if w["severity"] == "high"),
        medium=sum(1 for w in warnings if w["severity"] == "medium"),
        low=sum(1 for w in warnings if w["severity"] == "low"),
    )
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
