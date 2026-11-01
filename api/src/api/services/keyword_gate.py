"""Keyword gate for topic themes — ONE copy, shared by every clustering path.

Used by:
  * `topic_discovery` (the banned label words it silently drops),
  * `claude_recluster` (the weekly automated run gates its themes with it),
  * `scripts/cluster_topics/check_keywords.py` (the manual run's CLI).

Keep this module free of heavy imports: the manual script imports it from a
plain `python3` that has no numpy/genai/openai installed.

Why each check exists is documented at length in
`scripts/cluster_topics/check_keywords.py`; the short version:

  * INFLATION — assignment matches keywords as literal substrings, so a short
    token swallows unrelated posts through Indonesian morphology
    (`iran` 1374 substring vs 85 as a word: perairan, kehadiran, aliran).
  * COHESION — a clean word can still be generic in context (`wartawan` was
    305/305 clean words yet 11% on-story: "… kepada wartawan"). Measured as
    the share of a keyword's matches that contain another keyword of the
    same theme. Skipped for domain magnets and synonym sets, whose keywords
    are alternatives by design.
  * BANNED LABEL WORDS — `topic_discovery` drops a theme whose label contains
    one of these and only logs a warning; its posts fall to Lainnya.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

INFLATION_LIMIT = 0.15  # >15% of matches coming from inside other words
COHESION_LIMIT = 0.30   # <30% of matches sharing ANY other keyword of its theme
COHESION_MIN_N = 40     # below this the fraction is too noisy to judge

# Label words that never produced a clean cluster. `topic_discovery` rejects
# any theme whose label contains one (substring match, lowercased).
ELASTIC_HARD_BAN = {
    "misterius",
    "horor",
    "aneh",
    "tragis",
    "viral",
    "polemik",
    "kontroversi",
    "heboh",
    "geger",
    "gempar",
    "fenomena",
}


def word_re(keyword: str) -> re.Pattern[str]:
    """Word-boundary pattern: the keyword not glued to other letters."""
    return re.compile(rf"(?<![a-z]){re.escape(keyword.lower())}(?![a-z])")


@dataclass
class KeywordRow:
    label: str
    keyword: str
    substring: int
    word: int
    inflated: bool


@dataclass
class GateReport:
    rows: list[KeywordRow] = field(default_factory=list)
    banned: list[tuple[str, str]] = field(default_factory=list)
    """(label, banned word)"""
    inflated: list[tuple[str, str, int, int]] = field(default_factory=list)
    """(label, keyword, substring count, word count)"""
    incoherent: list[tuple[str, str, int, float]] = field(default_factory=list)
    """(label, keyword, word-match count, co-occurrence fraction)"""
    cohesion_skipped: list[tuple[str, str]] = field(default_factory=list)
    """(label, "magnet" | "synonyms")"""

    @property
    def ok(self) -> bool:
        return not (self.banned or self.inflated or self.incoherent)


def banned_label_words(themes: list[dict[str, Any]]) -> list[tuple[str, str]]:
    return [
        (t["label"], w)
        for t in themes
        for w in sorted(ELASTIC_HARD_BAN)
        if w in t["label"].lower()
    ]


def check_themes(
    themes: list[dict[str, Any]],
    texts: list[str],
    *,
    inflation_limit: float = INFLATION_LIMIT,
) -> GateReport:
    """Measure every keyword of every theme against the corpus `texts`.

    `texts` are matched lowercased; pass the same corpus `inject` assigns
    over (the posts cache), never a sample of it."""
    texts = [(x or "").lower() for x in texts]
    report = GateReport(banned=banned_label_words(themes))

    for t in themes:
        for kw in t.get("keywords", []):
            k = kw.lower()
            pat = word_re(k)
            sub = sum(1 for x in texts if k in x)
            wb = sum(1 for x in texts if pat.search(x))
            inflated = bool(sub) and (sub - wb) / sub > inflation_limit
            report.rows.append(KeywordRow(t["label"], kw, sub, wb, inflated))
            if inflated:
                report.inflated.append((t["label"], kw, sub, wb))

    for t in themes:
        kws = [k.lower() for k in t.get("keywords", [])]
        if len(kws) < 3:
            continue
        if t.get("magnet"):
            report.cohesion_skipped.append((t["label"], "magnet"))
            continue
        if t.get("synonyms"):
            report.cohesion_skipped.append((t["label"], "synonyms"))
            continue
        pats = {k: word_re(k) for k in kws}
        for k in kws:
            hits = [x for x in texts if pats[k].search(x)]
            if len(hits) < COHESION_MIN_N:
                continue
            others = [pats[o] for o in kws if o != k]
            co = sum(1 for x in hits if any(p.search(x) for p in others))
            frac = co / len(hits)
            if frac < COHESION_LIMIT:
                report.incoherent.append((t["label"], k, len(hits), frac))
    return report


def describe_failures(report: GateReport) -> str:
    """Plain-text list of what failed — fed back to the theme author."""
    out: list[str] = []
    for label, w in report.banned:
        out.append(
            f"- Label {label!r} contains the banned word {w!r}: the pipeline "
            f"silently drops this theme. Rename it (e.g. 'Sengketa', "
            f"'Perdebatan', or the event itself)."
        )
    for label, kw, sub, wb in report.inflated:
        out.append(
            f"- Keyword {kw!r} in {label!r} matches {sub} posts as a substring "
            f"but only {wb} as a word: it is matching inside other words. "
            f"Replace it with a longer or more distinctive token."
        )
    for label, kw, n, frac in report.incoherent:
        out.append(
            f"- Keyword {kw!r} in {label!r}: {n} matches, only {frac:.0%} share "
            f"another keyword of the theme — generic in context (boilerplate, "
            f"bylines, stock phrases). Replace it with a story-specific token."
        )
    return "\n".join(out)
