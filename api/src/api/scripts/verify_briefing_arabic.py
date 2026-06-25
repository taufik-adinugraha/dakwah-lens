"""Daleel-hallucination guard for a composed briefing (PRD §12 — hallucinated
daleel is the single biggest credibility risk).

Extracts EVERY substantial Arabic run from a briefing markdown — NOT just
`> ` blockquotes, but plain-line Arabic too (khutbah/kajian frequently print a
daleel's Arabic on a plain line). Each run is orthography-normalized to a
consonant skeleton and checked for verbatim presence in that group's Qdrant
pool (the cached daleel + adhkar `arabic` fields + the kisah pool). Standard
khutbah liturgy (hamdalah, shahadah, salawat, the du'a / `اللهم …` family,
ta'awwudz, istighfar, salam, etc.) is allow-listed — it legitimately is NOT in
the kitab pool. Whatever non-liturgy run does NOT match the pool is surfaced
for human review: a genuinely-different/from-memory ayat or hadith wording, or
a quote completed beyond what the pool stores.

This is advisory tooling (exit 0 always). It complements the structural
save-gate validators in `validate_briefing.py`, which do NOT check Arabic
verbatim-ness.

Usage (in the API container / uv env):
    python -m api.scripts.verify_briefing_arabic <group-slug> <reply.md>
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

from api.scripts.manual_briefing import _cache_path

# Combining marks (harakat), tatweel, Quranic annotation signs — stripped.
_HARAKAT = re.compile("[ً-ْٰـۖ-ۭࣣ-ࣿ]")
# Run extraction: maximal spans of Arabic-block chars + whitespace.
_ARABIC_RUN = re.compile("[؀-ۿﭐ-﷿ﹰ-﻿\\s]{20,}")


def skeletonize(s: str) -> str:
    """Reduce Arabic text to a comparable consonant skeleton: strip harakat /
    tatweel / Arabic-Indic digits / punctuation, fold alef + ya + ta-marbuta
    variants, keep only letters U+0621–U+064A."""
    s = unicodedata.normalize("NFC", s)
    s = _HARAKAT.sub("", s)
    s = (
        s.replace("ٱ", "ا")  # alef wasla → alef
        .replace("أ", "ا")  # alef hamza above → alef
        .replace("إ", "ا")  # alef hamza below → alef
        .replace("آ", "ا")  # alef madda → alef
        .replace("ى", "ي")  # alef maqsura → ya
        .replace("ة", "ه")  # ta marbuta → ha
    )
    return "".join(ch for ch in s if "ء" <= ch <= "ي")


# Standard khutbah/du'a liturgy that is NOT kitab daleel. Skeleton substrings;
# a run is treated as liturgy if it contains any of these OR begins with the
# `اللهم …` (allahumma) du'a opener.
_LITURGY = [
    skeletonize(x)
    for x in [
        "بسم الله الرحمن الرحيم",
        "أعوذ بالله من الشيطان الرجيم",
        "الحمد لله رب العالمين",
        "الحمد لله",
        "أشهد أن لا إله إلا الله",
        "وأشهد أن محمدا عبده ورسوله",
        "اللهم صل وسلم على",
        "اللهم صل على",
        "صلى الله عليه وسلم",
        "أما بعد",
        "فيا عباد الله",
        "عباد الله",
        "اتقوا الله",
        "أوصيكم ونفسي بتقوى الله",
        "أقول قولي هذا وأستغفر الله",
        "بارك الله لي ولكم",
        "ونفعني وإياكم",
        "فاستغفروه إنه هو الغفور الرحيم",
        "ربنا آتنا في الدنيا حسنة",
        "إن الله يأمر بالعدل والإحسان",
        "فاذكروا الله العظيم يذكركم",
        "واذكروا الله العظيم يذكركم",
        "ولذكر الله أكبر",
        "والسلام عليكم ورحمة الله وبركاته",
        "إن الله وملائكته يصلون على النبي",
        "رضي الله عنه",
        "رضي الله عنها",
        "رحمه الله",
        "سبحانه وتعالى",
    ]
]
_ALLAHUMMA = skeletonize("اللهم")


def _is_liturgy(sk: str) -> bool:
    if sk.startswith(_ALLAHUMMA):
        return True
    return any(b and (b in sk or sk in b) for b in _LITURGY)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Verify briefing Arabic is verbatim from the Qdrant pool."
    )
    ap.add_argument("group_slug", help="theme-group slug, e.g. hukum-keadilan")
    ap.add_argument("markdown", help="path to the composed briefing .md")
    args = ap.parse_args()

    cache_path = _cache_path(args.group_slug)
    if not cache_path.exists():
        print(f"✗ No candidate/picks cache for '{args.group_slug}' at {cache_path}.")
        return 0
    cached = json.loads(cache_path.read_text(encoding="utf-8"))
    pool_entries = (cached.get("daleel") or []) + (cached.get("adhkar") or [])
    blob = skeletonize(
        " ".join(str(e.get("arabic") or "") for e in pool_entries)
        + " "
        + json.dumps(cached.get("kisah") or {}, ensure_ascii=False)
    )

    md = Path(args.markdown).read_text(encoding="utf-8")
    flags: list[str] = []
    checked = 0
    seen: set[str] = set()
    for run in _ARABIC_RUN.findall(md):
        sk = skeletonize(run)
        if len(sk) < 20 or sk in seen:
            continue
        seen.add(sk)
        checked += 1
        # Contiguous match, or a long-enough leading window (tolerates a quote
        # that runs slightly past a pool chunk boundary).
        if sk in blob or (len(sk) >= 30 and sk[:30] in blob):
            continue
        if _is_liturgy(sk):
            continue
        flags.append(re.sub(r"\s+", " ", run).strip()[:100])

    print(
        f"== ARABIC VERIFY: {args.group_slug}  pool_entries={len(pool_entries)}  checked={checked} runs"
    )
    if flags:
        print(
            f"\n⚠ {len(flags)} Arabic run(s) NOT verbatim in pool and NOT recognized "
            f"liturgy — REVIEW (from-memory daleel? quote completed past the pool? "
            f"wrong narration's wording?):"
        )
        for f in flags:
            print(f"   ✗ {f}")
    else:
        print("\n✓ Every non-liturgy Arabic run is verbatim from the Qdrant pool.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
