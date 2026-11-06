"""Picks map back to the candidate the picker chose (2026-11-06).

This holds even when two candidates share a citation.

Riyad as-Salihin 1032 is one hadith carrying two supplications — the shahada and
«اللهم اجعلني من التوابين واجعلني من المتطهرين» — and the du'a pool lists both
as "Riyad as-Salihin 1032". `_build_picks_context` indexed the pool with a dict
keyed by citation, which kept only the LAST entry, so a pick of the tawwabin du'a
staged the shahada. Picks now carry the candidate numbers, and a citation-only
pick that two candidates share is refused instead of guessed.
"""

from __future__ import annotations

import pytest

import api.scripts.manual_briefing as mb

POOL = [
    {"citation": "QS. Al-Baqarah: 201", "arabic": "رَبَّنَا آتِنَا"},
    {"citation": "Riyad as-Salihin 1032", "arabic": "اللَّهُمَّ اجْعَلْنِي مِنَ التَّوَّابِينَ"},
    {"citation": "Riyad as-Salihin 1032", "arabic": "أَشْهَدُ أَنْ لَا إِلَهَ إِلَّا اللَّهُ"},
    {"citation": "Riyad as-Salihin 1872", "arabic": "رَبِّ اغْفِرْ لِي"},
]


def test_index_picks_stage_the_entry_that_was_picked() -> None:
    out, missing = mb._resolve_picks(POOL, ["Riyad as-Salihin 1032"], [2], "dua")
    assert missing == []
    assert out == [POOL[1]]                       # the tawwabin du'a, not the shahada


def test_index_picks_without_citations_work() -> None:
    out, _ = mb._resolve_picks(POOL, [], [3, 1], "dua")
    assert out == [POOL[2], POOL[0]]              # picks-supplied order


def test_citation_only_pick_shared_by_two_candidates_is_refused() -> None:
    with pytest.raises(SystemExit, match=r"#2, #3"):
        mb._resolve_picks(POOL, ["Riyad as-Salihin 1032"], None, "dua")


def test_index_that_names_another_citation_is_a_stale_cache() -> None:
    with pytest.raises(SystemExit, match="stale candidates cache"):
        mb._resolve_picks(POOL, ["Riyad as-Salihin 1872"], [2], "dua")


def test_index_outside_the_pool_is_refused() -> None:
    with pytest.raises(SystemExit, match="outside the candidate pool"):
        mb._resolve_picks(POOL, [], [9], "dua")


def test_unique_citation_picks_still_work_and_report_missing() -> None:
    picks = ["Riyad as-Salihin 1872", "Sahih Muslim 1"]
    out, missing = mb._resolve_picks(POOL, picks, None, "daleel")
    assert out == [POOL[3]]
    assert missing == ["Sahih Muslim 1"]
