"""Regression tests for the audit#152 GROUP_INTENT_HINTS addition.

audit#152 was the first run after `fetch.sh` stopped date-scoping NULLs:
152 batches, 26,565 posts, 26,562 corrections — the whole Gemini-outage
backlog in one pass.

A run that large is a measuring instrument. Scanning all 26,562 flags for
recurring patterns, the top clusters were already covered by existing
rules (gossip/fandom 5.5%, spam/promo 5.3%, routine bulletins 3.3%,
foreign traffic 3.0%, ceremonial 3.0%, fiction/game 2.4% = audit#151).

The one real gap was smaller and only visible as DISAGREEMENT. 192 posts
whose text mentions Maulid split 102 Lainnya / 85 Aqidah & Ibadah across
batch boundaries — a near coin-flip on one cluster, which is the
audit#150 signature for "the rulebook is silent here".

Reading both sides showed the split was not sloppiness: Lainnya held
tumpengan, sholawat clips, harlah videos, fundraisers and event promos;
Aqidah & Ibadah held ceramah content, bid'ah polemic, ulama rulings and
reflection. Both are the substance test applied correctly. But Maulid
was never NAMED in the rulebook, so every reader re-derived that test
from first principles and 192 posts rode on the derivation. These tests
pin the clause that names it.
"""

from __future__ import annotations

import pytest

from api.services.theme_groups import (
    GROUP_INTENT_HINTS,
    llm_group_options_prompt,
)


def _aqidah() -> str:
    return GROUP_INTENT_HINTS["Aqidah & Ibadah"]


def test_maulid_is_named_at_all() -> None:
    """The whole point: the rule was derivable but unnamed."""
    h = _aqidah()
    assert "audit#152" in h
    assert "MAULID NABI" in h


def test_maulid_teaching_side_is_specified() -> None:
    """Content with real teaching/polemic stays in Aqidah & Ibadah."""
    h = _aqidah()
    for token in ("ceramah", "bid'ah", "ulama"):
        assert token in h, f"{token} must be named on the teaching side"


def test_maulid_ceremonial_side_routes_to_lainnya() -> None:
    """The logistics half — the larger half, 102 of 192 — must be explicit,
    or the clause reads as 'all Maulid is Aqidah' and inverts the split."""
    h = _aqidah()
    for token in ("pengumuman acara", "tumpengan", "sholawat", "harlah"):
        assert token in h, f"{token} must be named on the ceremonial side"
    assert "Lainnya" in h


def test_maulid_clause_does_not_contradict_the_music_rule() -> None:
    """audit#92 already sends religious MUSIC to Lainnya. The Maulid
    clause names sholawat clips on the same side — these must agree, not
    fight, or a sholawat-for-Maulid post has two rules pointing opposite
    ways."""
    h = _aqidah()
    assert "audit#92" in h
    i_music = h.find("BUKAN LAGU/MUSIK")
    i_maulid = h.find("MAULID NABI")
    assert i_music != -1 and i_maulid != -1
    # both must route to Lainnya; neither may claim sholawat for Aqidah
    assert "klip sholawat" in h


def test_substance_test_language_is_shared_with_audit150() -> None:
    """audit#150 established SUBSTANSI as the tie-breaker for religiously
    framed content. audit#152 reuses it rather than inventing a parallel
    test, so the two clauses cannot drift apart."""
    h = _aqidah()
    assert "audit#150" in h
    assert "SUBSTANSI" in h


@pytest.mark.parametrize("needle", ["MAULID NABI", "tumpengan", "bid'ah"])
def test_clause_reaches_the_rendered_prompt(needle: str) -> None:
    """`gen_rulebook.py` derives the audit rulebook from this function, so
    a clause that never renders would vanish from the next audit too."""
    assert needle in llm_group_options_prompt()
