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
    llm_judgments: bool = False,
) -> list[BriefingWarning]:
    """Run all validators. Never raises — failures inside individual
    passes are logged and the pass returns no warnings for that
    branch.

    `llm_judgments` gates the API-LLM-based passes:
      - False (default, manual flow): only regex/heuristic checks
        (forbidden phrases). Paragraph↔daleel fit and absurd-advice
        detection get done by the operator's Claude session out of
        band — no API-LLM call out from this script.
      - True (auto pipeline): also runs the Gemini Flash-Lite passes
        for daleel alignment + advice sanity. Fine in the auto path
        since it's already an API-LLM context.
    """
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
    ):
        try:
            warnings.extend(fn(markdown))
        except Exception as exc:
            log.warning(f"validate_briefing.{key}", error=str(exc))
    if llm_judgments:
        # Paragraph↔daleel fit + absurd-advice scoring + replacement
        # suggester all call Gemini Flash-Lite. Skipped on the manual
        # path so the script doesn't make API-LLM calls out — the
        # operator's Claude session does that judgment in-chat.
        try:
            warnings.extend(
                check_flyer_daleel_alignment(
                    markdown, daleel_pool, adhkar_pool=adhkar_pool
                )
            )
        except Exception as exc:
            log.warning(
                "validate_briefing.alignment_check_failed", error=str(exc)
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
