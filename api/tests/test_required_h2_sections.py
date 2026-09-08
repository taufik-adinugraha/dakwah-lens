"""Regression tests for the required-H2 web contract (2026-09-03 incident).

The dashboard resolves each segment tab by exact H2 heading text
(`SEGMENT_HEADINGS` in web/src/lib/dashboard-metrics.ts). When an H2 is
missing, `pickSection` returns "" and the whole segment renders EMPTY —
while the content sits in the markdown, orphaned under the previous H2.

Nothing else catches it: the H3 deliverables are all present and titled,
so every per-deliverable validator passes. That is exactly how the
`Pendidikan & SDM` 2026-09-03 briefing shipped without
`## Strategi & Aksi Dakwah` and lost its entire deliverable segment on
the live page.
"""

from __future__ import annotations

import pytest

from api.services.validate_briefing import scan_required_h2_sections

# Minimal weekly briefing skeleton. The deliverable H3s are what mark it
# as weekly; the H2s are what the web looks up.
_H2S = [
    "## Ringkasan Eksekutif",
    "## Numerik & Tren Pekan Ini",
    "## Tema Utama & Pola Yang Muncul",
    "## Poin Kunci",
    "## Strategi & Aksi Dakwah",
    "## Dalil & Sumber",
]

_DELIVERABLES = "\n".join(
    [
        '### Khutbah Jumat — "Judul"',
        "isi khutbah",
        '### Kultum — "Judul"',
        "isi kultum",
        '### Kajian Ibu-ibu & Majelis Taklim — "Judul"',
        "isi kajian",
    ]
)


def _brief(h2s: list[str]) -> str:
    """Assemble a briefing with `h2s`, deliverables under the last one."""
    parts = []
    for h in h2s:
        parts.append(h)
        parts.append("isi bagian")
        if "Strategi" in h or "Strategies" in h:
            parts.append(_DELIVERABLES)
    return "\n\n".join(parts)


def test_complete_briefing_passes() -> None:
    assert scan_required_h2_sections(_brief(_H2S)) == []


def test_missing_strategi_is_flagged() -> None:
    """The exact 2026-09-03 shape: deliverables present, parent H2 gone."""
    md = _brief([h for h in _H2S if "Strategi" not in h]) + "\n\n" + _DELIVERABLES
    warns = scan_required_h2_sections(md)
    assert len(warns) == 1
    w = warns[0]
    assert w["kind"] == "missing_web_h2_section"
    assert w["severity"] == "high"
    assert w["where"] == "Strategi & Aksi Dakwah"
    assert "renders EMPTY" in w["message"]


@pytest.mark.parametrize("drop", [h for h in _H2S])
def test_each_required_h2_is_checked(drop: str) -> None:
    """Not just Strategi — losing ANY of them empties its tab."""
    md = _brief([h for h in _H2S if h != drop]) + "\n\n" + _DELIVERABLES
    assert len(scan_required_h2_sections(md)) == 1


def test_english_headings_accepted() -> None:
    en = [
        "## Executive Summary",
        "## Numbers & Trends This Week",
        "## Main Themes & Emerging Patterns",
        "## Key Points for Senior Da'i",
        "## Da'wah Strategies & Actions",
        "## Daleel & Sources",
    ]
    assert scan_required_h2_sections(_brief(en)) == []


def test_short_form_headings_accepted() -> None:
    """`Poin Kunci` / `Tema Utama` / `Numerik & Tren` are live variants."""
    short = [
        "## Ringkasan Eksekutif",
        "## Numerik & Tren",
        "## Tema Utama",
        "## Poin Kunci",
        "## Strategi & Aksi Dakwah",
        "## Daleel & Sumber",
    ]
    assert scan_required_h2_sections(_brief(short)) == []


def test_fiqh_briefing_is_not_weekly_and_is_skipped() -> None:
    """Fiqh has its own structure (### Artikel N) and its own checks."""
    fiqh = "\n\n".join(
        [
            "## Ringkasan Eksekutif",
            "isi",
            "## Poin Kunci",
            "isi",
            "## Artikel Fiqh Pekan Ini",
            '### Artikel 1 — "Judul"',
            "isi artikel",
            "## Dalil & Sumber",
            "isi",
        ]
    )
    assert scan_required_h2_sections(fiqh) == []


def test_tafsir_briefing_is_skipped() -> None:
    tafsir = "\n\n".join(
        [
            "## Ringkasan Eksekutif",
            "isi",
            "## Artikel Tafsir Pekan Ini",
            '### Tafsir 1 — "Judul"',
            "isi",
            "## Dalil & Sumber",
            "isi",
        ]
    )
    assert scan_required_h2_sections(tafsir) == []


def test_empty_and_garbage_do_not_raise() -> None:
    assert scan_required_h2_sections("") == []
    assert scan_required_h2_sections("no headings here at all") == []


def test_heading_match_is_case_insensitive() -> None:
    md = _brief([h.upper() for h in _H2S])
    assert scan_required_h2_sections(md) == []


def test_h3_lookalike_does_not_satisfy_the_h2() -> None:
    """An H3 named the same must NOT count — the web looks up H2s only."""
    md = _brief([h for h in _H2S if "Strategi" not in h])
    md += "\n\n### Strategi & Aksi Dakwah\n\n" + _DELIVERABLES
    warns = scan_required_h2_sections(md)
    assert len(warns) == 1
    assert warns[0]["where"] == "Strategi & Aksi Dakwah"


# ── Occasion / national tracks (15th + 18th) ──────────────────────
# They carry the same deliverable H3s but deliberately swap Numerik +
# Tema for their own mode H2s. Requiring the weekly pair there would
# contradict scan_occasion_section_structure, which treats those exact
# headings as DRIFT.

_OCCASION = "\n\n".join(
    [
        "## Ringkasan Eksekutif",
        "isi",
        "## Kalender Hijriah Pekan Ini",
        "isi",
        "## Konteks & Hikmah Acara",
        "isi",
        "## Poin Kunci",
        "isi",
        "## Strategi & Aksi Dakwah",
        _DELIVERABLES,
        "## Dalil & Sumber",
        "isi",
    ]
)

_NATIONAL = _OCCASION.replace("Kalender Hijriah Pekan Ini", "Kalender Nasional Pekan Ini").replace(
    "Konteks & Hikmah Acara", "Konteks & Hikmah Bangsa"
)


def test_occasion_briefing_exempt_from_numerik_and_tema() -> None:
    assert scan_required_h2_sections(_OCCASION) == []


def test_national_briefing_exempt_from_numerik_and_tema() -> None:
    assert scan_required_h2_sections(_NATIONAL) == []


def test_occasion_still_requires_strategi() -> None:
    """The exemption is narrow — losing Strategi still empties the tab."""
    md = _OCCASION.replace("## Strategi & Aksi Dakwah\n\n", "")
    warns = scan_required_h2_sections(md)
    assert [w["where"] for w in warns] == ["Strategi & Aksi Dakwah"]


def test_occasion_still_requires_poin_kunci() -> None:
    md = _OCCASION.replace("## Poin Kunci\n\nisi\n\n", "")
    warns = scan_required_h2_sections(md)
    assert [w["where"] for w in warns] == ["Poin Kunci"]


def test_weekly_briefing_still_requires_numerik_and_tema() -> None:
    """No occasion anchors -> the exemption must not apply."""
    md = _brief([h for h in _H2S if "Numerik" not in h]) + "\n\n" + _DELIVERABLES
    assert [w["where"] for w in scan_required_h2_sections(md)] == [
        "Numerik & Tren Pekan Ini"
    ]
