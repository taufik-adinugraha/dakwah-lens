"""Arabic search helpers for the Ilmu Waris dalil extraction (build_dalil.py, build_waris.py).

Moved from the DALIL researcher's session scratchpad (2026-10-09) with the corpus path made
repo-relative; the patterns are the same strings, written with escapes instead of invisible
literal characters. Searching uses a normalised key only. Every excerpt is cut from the original,
vocalised string by the offsets a match returns, so nothing is retyped.

The key differs from common.normalise() (the Qur'an track's Tanzil search key): it also folds
alif maqsurah to ya' and ta' marbutah to ha', and strips the bidi marks and BOM that the
api/data hadith and kitab files carry.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
D = REPO / "api" / "data"  # the platform corpus (git-ignored; see README "Ilmu Waris")

# Stripped for the search key: Qur'anic/honorific marks U+0610-U+061A, harakat and tanwin
# U+064B-U+065F, superscript alif U+0670, Qur'anic annotation marks U+06D6-U+06ED, tatweel
# U+0640, RLM U+200F, LRM U+200E, BOM U+FEFF.
HARAKAT = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ‏‎﻿]")
# The same marks (without the BOM) may sit between any two letters of a match in the original.
_MARKS = "[ؐ-ًؚ-ٰٟۖ-ۭـ‏‎]*"


def norm(s: str | None) -> str:
    s = HARAKAT.sub("", s or "")
    s = (s.replace("ٱ", "ا").replace("أ", "ا").replace("إ", "ا")
         .replace("آ", "ا").replace("ى", "ي").replace("ة", "ه"))
    return re.sub(r"\s+", " ", s)


def load(f: str):
    """Load one api/data corpus file (a JSON array of records)."""
    with open(D / f, encoding="utf-8") as fh:
        return json.load(fh)


VAR = {"ا": "[اٱأإآ]", "ي": "[يى]", "ه": "[هة]"}


def rx(phrase: str) -> re.Pattern:
    """A regex that finds `phrase` in vocalised text: letters in order, any marks between them,
    alif/ya'/ha' variants, whitespace or tatweel runs for a space."""
    p = norm(phrase)
    parts = []
    for ch in p:
        if ch == " ":
            parts.append(r"[\sـ]+")
            continue
        parts.append(VAR.get(ch, re.escape(ch)) + _MARKS)
    return re.compile("".join(parts))


def find_orig(text: str, phrase: str) -> list[tuple[int, int]]:
    """[start, end) offsets of every match of `phrase` in the original `text`."""
    return [(m.start(), m.end()) for m in rx(phrase).finditer(text)]


# ---------------------------------------------------------------- running heads (review 2026-10-09)
# The printed editions behind two corpus files put the book's title line at every page break, and
# the corpus text carries it mid-sentence (Fath al-Qarib 329 times, Fath al-Mu'in 673 times, the
# latter sometimes followed by a run of 28-38 zero digits). It is never part of the kitab's text,
# so an excerpt that crosses one is cut around it: `omit` lists the [x, y) source offsets cut out,
# and the shown `ar` marks each cut with ELISION. Short digit runs after a head ("2- ...") are the
# kitab's own list numbers and are kept. validate_waris.py re-derives all of this independently.
RUNNING_HEADS = (
    "فتح القريب المجيب في شرح ألفاظ التقريب = القول المختار في شرح غاية الاختصار",
    "فتح المعين بشرح قرة العين بمهمات الدين",
)
ELISION = "…"
_HEAD_RX = re.compile("(?:" + "|".join(re.escape(h) for h in RUNNING_HEADS) + r")(?:\s+[0-9]{6,})?")


def running_head_spans(text: str, a: int, b: int) -> list[list[int]]:
    """[x, y) spans of `text` inside the excerpt [a, b) that hold a running head (with the junk
    digit run that may follow it). A head that straddles an excerpt edge is a build error."""
    out = []
    for m in _HEAD_RX.finditer(text):
        if m.end() <= a or m.start() >= b:
            continue
        if m.start() <= a or m.end() >= b:
            raise SystemExit(f"a running head straddles the excerpt edge [{a}, {b}) at [{m.start()}, {m.end()})")
        out.append([m.start(), m.end()])
    return out


def elide(text: str, a: int, b: int, omit: list, truncated: bool = False) -> str:
    """The shown excerpt: text[a:b] with each omitted span replaced by ELISION, plus ' …' when the
    source record itself ends mid-sentence at b (`source_truncated`)."""
    parts, pos = [], a
    for x, y in omit:
        parts.append(text[pos:x])
        pos = y
    parts.append(text[pos:b])
    return ELISION.join(parts) + (" " + ELISION if truncated else "")
