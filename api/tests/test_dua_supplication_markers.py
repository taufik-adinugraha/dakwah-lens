"""The du'a-supplication marker list: single source, and the imperative shape.

Two defects, found together on 2026-09-17 while reviewing the Lingkungan &
Bencana briefing.

1. FALSE POSITIVE. `scan_flyer_doa_not_dua` warned that Pesan Flyer 6 cited
   `Sahih Muslim 2191a` but its Arabic was "bukan du'a recitable … tampak ayat
   perintah/pernyataan". That entry is the well-known prophetic healing du'a:

       أَذْهِبِ الْبَاسَ رَبَّ النَّاسِ وَاشْفِ أَنْتَ الشَّافِي …

   It is unmistakably a supplication — but it opens with an IMPERATIVE
   addressed to Allah plus a vocative, not with "Allahumma…"/"Rabbana…", so
   no marker matched. Measured against the whole FLYER ADHKAR POOL that week,
   5 of 6 entries passed (all opening "Allahumma…"/"Bismillah…") and only this
   one was flagged — a narrow, well-characterised gap, not a content defect.
   The briefing's inline du'a matched the cited entry exactly (`check_flyer_dua`
   reported 0 mismatches), so acting on the warning would have replaced a
   correct, famous du'a on the operator's say-so of a heuristic.

2. DUPLICATED CONSTANT, ALREADY DRIFTED. The tuple lived in BOTH
   `kitab_retrieval` and `validate_briefing` with no import between them, and
   the copies had already diverged — 30 markers against 29, with "اللهم إني"
   present in one and missing from the other. The drift was harmless only by
   luck (that marker is redundant with "اللهم"). Adding the fix to one copy
   would silently not have reached the other. Same failure class as the
   flyer-pool kwarg (2026-06-18) and the 30-post volume floor (2026-08-27):
   import the constant, never re-type it.

The markers added are deliberately unambiguous: any text carrying "rabb
an-nas" or "adhhibi l-ba's" is a supplication (Surat an-Nas contains the
former, and it is itself a du'a).
"""

from __future__ import annotations

import pytest

from api.services import kitab_retrieval, validate_briefing
from api.services.validate_briefing import _DUA_SUPPLICATION_MARKERS, _strip_tashkil


def _is_supplication(arabic: str) -> bool:
    norm = _strip_tashkil(arabic)
    return any(_strip_tashkil(m) in norm for m in _DUA_SUPPLICATION_MARKERS)


def test_marker_list_is_a_single_shared_object() -> None:
    """Not merely equal — the SAME object. Equality would pass again the
    moment someone re-typed the tuple, which is exactly what happened."""
    assert (
        validate_briefing._DUA_SUPPLICATION_MARKERS
        is kitab_retrieval._DUA_SUPPLICATION_MARKERS
    )


def test_imperative_vocative_dua_is_recognised() -> None:
    """Sahih Muslim 2191 — the healing du'a that triggered the false warning."""
    assert _is_supplication(
        "أَذْهِبِ الْبَاسَ رَبَّ النَّاسِ وَاشْفِ أَنْتَ الشَّافِي "
        "لاَ شِفَاءَ إِلاَّ شِفَاؤُكَ شِفَاءً لاَ يُغَادِرُ سَقَمًا"
    )


@pytest.mark.parametrize(
    "arabic",
    [
        "اللَّهُمَّ بِاسْمِكَ أَحْيَا وَبِاسْمِكَ أَمُوتُ",
        "اللَّهُمَّ اغْفِرْ لَهُ، اللَّهُمَّ ارْحَمْهُ",
        "بِسْمِ اللَّهِ، تَوَكَّلْتُ عَلَى اللَّهِ، اللَّهُمَّ إِنِّي أَعُوذُ بِكَ",
    ],
)
def test_classic_allahumma_dua_still_recognised(arabic: str) -> None:
    """The additions must not be the only thing holding the list up."""
    assert _is_supplication(arabic)


@pytest.mark.parametrize(
    "arabic,why",
    [
        ("وَزِنُوا۟ بِٱلْقِسْطَاسِ ٱلْمُسْتَقِيمِ", "command verse, not a request"),
        ("لَا تَأْكُلُوا۟ ٱلرِّبَوٰٓا۟", "prohibition, not a request"),
        ("ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ", "statement using rabb"),
        ("ذَٰلِكُمُ ٱللَّهُ رَبُّكُمْ", "statement using rabbukum"),
    ],
)
def test_command_and_statement_verses_still_rejected(arabic: str, why: str) -> None:
    """The whole point of the marker list is that harakat density alone lets
    command ayat into the du'a pool. Widening it must not undo that."""
    assert not _is_supplication(arabic), why
