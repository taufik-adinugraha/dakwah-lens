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

THE SECOND FAILURE MODE: SEMANTIC POLLUTION
Substring inflation is morphological — it is visible by comparing a literal
match to a word-boundary match. There is a second failure this cannot see: a
token that is a perfectly clean WORD but is generic in context, so most of its
matches have nothing to do with the theme it was chosen for.

Measured on the 7,000-post corpus of 2026-09-17, against the themes authored
for 2026-09-14:

    wartawan   305 matches, 305 of them clean words -> only  11% on-story
    pewarta    138 matches, 138 of them clean words -> only  22% on-story

Both passed the inflation check with a perfect score. `wartawan` was polluted
by the commonest quotation formula in Indonesian news ("... kepada wartawan",
88 posts) and `pewarta` by ANTARA's byline footer. They shipped in the
"Pencarian Lima Jurnalis Hilang" theme, where they were the two highest-volume
keywords — so the largest theme of that run was built mostly on boilerplate.

COHESION measures this: for each keyword, the fraction of its matches that also
contain at least one OTHER keyword from the same theme. A keyword describing
the same story as its theme-mates co-occurs with them; a generic one does not.
Calibrated on both theme sets over the same corpus:

    09-14 themes   wartawan 11%, pewarta 22%, then a gap to houthi 39%
    09-17 themes   lowest keyword 51%

The two known-bad keywords sit far below every legitimate one in either set,
so COHESION_LIMIT is set at 0.30 — under the lowest good value (39%) with
margin, and well above both defects.

COHESION DOES NOT APPLY TO SYNONYM SETS EITHER
Cohesion assumes a theme's keywords are complementary FACETS of one story, so a
post about that story tends to contain more than one of them. A theme built from
SYNONYMS breaks that assumption: the keywords are alternatives, and a post uses
one or the other. Measured 2026-09-20 on "Kasus Kekerasan Seksual di Ruang
Publik" (kekerasan seksual · pelecehan seksual · tpks · pencabulan):

    kekerasan seksual  104 matches, 17% co-occur with a synonym
    pelecehan seksual   34 matches, 26%
    tpks                12 matches, 83%
    pencabulan           6 matches, 50%

Reading the matches showed all of them squarely on-theme — the phrase is
unambiguous and pulls nothing unrelated. The low number is the metric mis-fitting
the theme shape, not pollution. Mark such a theme `"synonyms": true` to skip
cohesion, exactly as magnets are skipped, and the skip prints so it cannot be
used quietly on a theme that really is polluted.

COHESION DOES NOT APPLY TO DOMAIN MAGNETS
`topic_discovery.py` (DOMAIN-MAGNET COVERAGE, 2026-07-06) requires 3-5 broad
"magnet" themes alongside the concrete event-themes, because the second-pass
rescues force every leftover orphan onto its nearest centroid: a domain with
low-signal chatter and no broad home dumps that chatter onto whatever concrete
theme is closest and tanks its purity. A magnet's keywords are deliberately
generic reservoirs, so they are EXPECTED to co-occur weakly with each other —
`sekolah` scored 12% against `kampus`/`dosen`, which is correct, not broken.
Cohesion is therefore skipped for any theme marked `"magnet": true`, and the
skip is printed so it cannot be used quietly to launder a bad concrete theme.
The inflation check still applies to magnets — breadth is never a licence to
ship a token that matches inside other words.

Exit 1 if any keyword is inflated or incoherent past its threshold, so it can
gate.
"""
import json
import os
import sys

# One copy of the gate, shared with the weekly automated recluster and with
# topic_discovery (project_manual_auto_parity): measurements, thresholds and
# the banned label words all live in api/src/api/services/keyword_gate.py.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "api", "src"))
from api.services.keyword_gate import (  # noqa: E402
    INFLATION_LIMIT,
    banned_label_words,
    check_themes,
)


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
    banned = banned_label_words(themes)
    for label, w in banned:
        print(f"  BANNED LABEL WORD {w!r} in {label!r}")
    if banned:
        print("FAIL: inject would silently drop these themes (their posts fall to Lainnya)")
        return 1

    rep = check_themes(themes, texts, inflation_limit=thresh)
    for r in rep.rows:
        flag = (
            f"  <-- INFLATED, {r.substring - r.word} of {r.substring} matches are inside other words"
            if r.inflated
            else ""
        )
        print(f"  {r.label[:28]:30s} {r.keyword:18s} substr={r.substring:5d} word={r.word:5d}{flag}")

    print()
    skipped = dict(rep.cohesion_skipped)
    incoherent_by_label: dict[str, list] = {}
    for item in rep.incoherent:
        incoherent_by_label.setdefault(item[0], []).append(item)
    for t in themes:
        if len([k for k in t.get("keywords", [])]) < 3:
            continue
        kind = skipped.get(t["label"])
        if kind == "magnet":
            print(f"  {t['label'][:28]:30s} (domain magnet — cohesion not applicable)")
            continue
        if kind == "synonyms":
            print(f"  {t['label'][:28]:30s} (synonym set — cohesion not applicable)")
            continue
        for _lab, k, n, frac in incoherent_by_label.get(t["label"], []):
            print(
                f"  {t['label'][:28]:30s} {k:18s} cohesion={frac:4.0%} "
                f"of {n:4d}  <-- INCOHERENT"
            )

    print()
    bad = rep.inflated
    incoherent = rep.incoherent
    if bad:
        print(f"FAIL: {len(bad)} keyword(s) match mostly inside other words:")
        for lab, kw, sub, wb in bad:
            print(f"  - {kw!r} in {lab!r}: {sub} substring vs {wb} as a word")
        print("Replace them with longer or more distinctive tokens.")
    if incoherent:
        print(f"FAIL: {len(incoherent)} keyword(s) rarely co-occur with their theme:")
        for lab, kw, n, frac in incoherent:
            print(
                f"  - {kw!r} in {lab!r}: {n} matches, only {frac:.0%} share any "
                f"other keyword of the theme"
            )
        print("These are clean words but generic in context (boilerplate, bylines,")
        print("stock phrases). Replace them with tokens specific to the story.")
    if bad or incoherent:
        return 1
    print(f"OK: all keywords across {len(themes)} themes are distinctive and coherent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
