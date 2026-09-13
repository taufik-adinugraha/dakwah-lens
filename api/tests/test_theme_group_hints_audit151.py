"""Regression tests for the audit#151 GROUP_INTENT_HINTS additions.

audit#151 was the 4-day sweep of 2026-09-13: 5,152 unaudited posts, 5,145
of them null because the classifier had been down since the Gemini prepay
ran out on 09-04. Like audit#150, a run where everything is null cannot
tell us what the classifier gets *wrong* — only where the rulebook is
*silent*.

241 of 4,637 flags (5.2%) turned on one silence: content that uses event
vocabulary for events that never happened. 143 of the clear cases went to
`Lainnya`, with reasons that name the trap directly — "Fiksi serial
pendek, bukan kisah nyata", "Konten roleplay game anak", "game simulator
(bussid/Roblox/Sakura/BeamNG)".

Two groups were absorbing them, for two different reasons:
  * Lingkungan & Bencana scopes `kecelakaan`, so a BeamNG crash clip or a
    sinetron accident scene matches on the noun alone.
  * Inspirasi & Kisah Pribadi scopes personal experience, so a first-person
    fanfic or AU thread reads as a lived story.

The fix is symmetrical: both groups now require the REAL-event / REAL-story
predicate that was previously implicit.
"""

from __future__ import annotations

import pytest

from api.services.theme_groups import (
    GROUP_INTENT_HINTS,
    llm_group_options_prompt,
)


def _hint(group: str) -> str:
    return GROUP_INTENT_HINTS[group]


# ── Simulated events are not disasters ────────────────────────────

def test_simulated_disasters_are_not_lingkungan() -> None:
    h = _hint("Lingkungan & Bencana")
    assert "audit#151" in h
    assert "SIMULASI/FIKSI" in h
    assert "Lainnya" in h


def test_named_game_simulators_are_spelled_out() -> None:
    """The clip titles are the actual signal a reader sees. Naming the
    engines is what makes the rule fire without a judgment call."""
    h = _hint("Lingkungan & Bencana")
    for token in ("BUSSID", "BeamNG", "Roblox"):
        assert token in h, f"{token} must be named as a simulator"


def test_lingkungan_requires_evidence_of_a_real_event() -> None:
    """Without a positive predicate the rule is only a blocklist, and the
    next simulator that isn't on it slips through."""
    h = _hint("Lingkungan & Bencana")
    assert "NYATA" in h
    for token in ("lokasi", "korban"):
        assert token in h


def test_lingkungan_still_admits_routine_bmkg_bulletins() -> None:
    """audit#100's rule must survive audit#151 — a template bulletin is a
    real event reported dully, which is exactly what the new clause must
    not sweep out."""
    h = _hint("Lingkungan & Bencana")
    assert "audit#100" in h
    assert "BMKG" in h


# ── Fiction is not personal experience ────────────────────────────

def test_fiction_is_not_a_personal_story() -> None:
    h = _hint("Inspirasi & Kisah Pribadi")
    assert "audit#151" in h
    assert "NYATA" in h
    assert "Lainnya" in h


def test_the_fiction_forms_that_actually_appear_are_named() -> None:
    h = _hint("Inspirasi & Kisah Pribadi")
    for token in ("fiksi", "fanfiksi", "cerbung", "roleplay"):
        assert token in h, f"{token} must be named as a fiction form"


def test_inspirasi_keeps_its_pre_existing_exclusions() -> None:
    """The fix is additive: the K-pop / celebrity / hadith / non-Islam
    carve-outs predate audit#151 and must not be lost to a rewrite."""
    h = _hint("Inspirasi & Kisah Pribadi")
    for token in ("K-pop", "Aqidah & Ibadah", "Toleransi & Lintas-Iman"):
        assert token in h


# ── The prompt the classifier actually receives ───────────────────

@pytest.mark.parametrize("needle", ["SIMULASI/FIKSI", "BeamNG", "fanfiksi"])
def test_clauses_reach_the_rendered_prompt(needle: str) -> None:
    """`gen_rulebook.py` derives the audit rulebook from this same
    function, so a clause that never renders would silently vanish from
    the next audit too — audit and pipeline would drift apart on exactly
    the rule that was just added to stop them drifting."""
    assert needle in llm_group_options_prompt()
