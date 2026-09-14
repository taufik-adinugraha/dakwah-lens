#!/usr/bin/env python3
"""Measure a themes.json's keywords against substring inflation.

Usage: check_keywords.py <run_dir>

WHY THIS EXISTS
Assignment matches keywords as LITERAL SUBSTRINGS, so a short token can
silently swallow unrelated posts through common Indonesian morphology.
Measured on the 7,000-post corpus of 2026-09-14:

    iran      1374 substring ->   85 as a word   (perairan, kehadiran,
                                                  aliran, kekhawatiran)
    sar       3423 substring ->  287 as a word   (besar, pasar, dasar)
    onsu       408 substring ->   63 as a word   (konsumsi, konsultasi)
    menteri    832 substring ->  508 as a word   (kementerian)
    demo       212 substring ->   38 as a word   (demokrasi, demografi)

A survey agent proposed `iran` for the Middle-East cluster. Unchecked, it
would have matched ~20% of the corpus — mostly maritime and attendance
copy — and the resulting "geopolitics" topic would have been noise.

The standing guidance "tune with short single tokens, not phrases" is
right about phrases and incomplete about tokens: short is necessary, and
DISTINCTIVE is the other half. This script supplies the second half by
measuring rather than guessing.

Exit 1 if any keyword is inflated past the threshold, so it can gate.
"""
import json
import re
import sys

INFLATION_LIMIT = 0.15  # >15% of matches coming from inside other words


def main() -> int:
    run = sys.argv[1]
    thresh = float(sys.argv[2]) if len(sys.argv) > 2 else INFLATION_LIMIT
    texts = [
        (json.loads(ln).get("text") or "").lower()
        for ln in open(f"{run}/posts.jsonl", encoding="utf-8")
        if ln.strip()
    ]
    raw = json.load(open(f"{run}/themes.json", encoding="utf-8"))
    themes = raw.get("themes") if isinstance(raw, dict) else raw

    bad = []
    for t in themes:
        for kw in t.get("keywords", []):
            k = kw.lower()
            sub = sum(1 for x in texts if k in x)
            wb = sum(
                1 for x in texts
                if re.search(rf"(?<![a-z]){re.escape(k)}(?![a-z])", x)
            )
            infl = sub - wb
            flag = ""
            if sub and infl / sub > thresh:
                flag = f"  <-- INFLATED, {infl} of {sub} matches are inside other words"
                bad.append((t["label"], kw, sub, wb))
            print(f"  {t['label'][:28]:30s} {kw:18s} substr={sub:5d} word={wb:5d}{flag}")

    print()
    if bad:
        print(f"FAIL: {len(bad)} keyword(s) match mostly inside other words:")
        for lab, kw, sub, wb in bad:
            print(f"  - {kw!r} in {lab!r}: {sub} substring vs {wb} as a word")
        print("Replace them with longer or more distinctive tokens.")
        return 1
    print(f"OK: all keywords across {len(themes)} themes are distinctive")
    return 0


if __name__ == "__main__":
    sys.exit(main())
