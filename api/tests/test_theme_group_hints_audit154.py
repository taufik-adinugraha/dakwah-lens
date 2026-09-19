"""Regression tests for the audit#154 GROUP_INTENT_HINTS addition.

Fiscal and tax news sat on a boundary neither hint claimed. `Ekonomi &
Bisnis` says "kebijakan ekonomi yang berdampak pada rakyat"; `Pemerintahan
& Kebijakan` says "kebijakan publik, program negara, polemik kebijakan/
pejabat". A tax-restitution story is honestly both, so readers split and
kept splitting.

Measured across SEVEN consecutive audit runs (2026-09-14 → 2026-09-20),
posts matching restitusi / DJP / Direktorat Jenderal Pajak:

    run 09-14   27   Pemerintahan 11 · Ekonomi  7 · Hukum 4
    run 09-15a   6   Hukum 5 · Pemerintahan 1
    run 09-15b   2   Pemerintahan 1 · Ekonomi 1
    run 09-17a   7   Pemerintahan 3 · Lainnya 2 · Ekonomi 2
    run 09-17b   5   Pemerintahan 4 · Ekonomi 1
    run 09-18    3   Ekonomi 2 · Pemerintahan 1
    run 09-20   42   Ekonomi 22 · Pemerintahan 19 · Hukum 1
                --
                92   Pemerintahan 40 · Ekonomi 35 · Hukum 10

Never converging, many independent agents — the audit#152/#153 signature
for "the rulebook is silent here" rather than "this is hard".

Reading both sides showed the line agents were already drawing, and it is
NOT a new axis: it is audit#98's existing corruption-story test (case
facts vs official-reaction polemic) applied to fiscal content.

    → Ekonomi & Bisnis     reported economic substance: "DJP Tegaskan Tak
                           Ada Kenaikan Tarif PPN", "Restitusi Pajak Turun
                           37% Jadi Rp191,7 T", business liquidity impact
    → Pemerintahan & Keb.  public polemic at the administration: replies to
                           officials' accounts, "duitnya gak ada, udah
                           kadung kepake buat embege dan kopdes", distrust
                           of the tax office

The rule is written into BOTH hints deliberately. Per
`project_audit_cumulative_ledger`, a group-scoped rule only fires if the
classifier is already considering that group — a one-sided rule would be
invisible to exactly the readers who need it.
"""

from __future__ import annotations

import pytest

from api.services.theme_groups import (
    GROUP_INTENT_HINTS,
    llm_group_options_prompt,
)

EKO = "Ekonomi & Bisnis"
PEM = "Pemerintahan & Kebijakan"


def test_rule_is_present_on_both_sides() -> None:
    """A one-sided rule is invisible to the reader who needs it."""
    assert "audit#154" in GROUP_INTENT_HINTS[EKO]
    assert "audit#154" in GROUP_INTENT_HINTS[PEM]


def test_fiscal_vocabulary_is_named() -> None:
    """The split was on restitusi/DJP; name it so it is findable."""
    for hint in (GROUP_INTENT_HINTS[EKO], GROUP_INTENT_HINTS[PEM]):
        assert "FISKAL" in hint or "fiskal" in hint
    assert "restitusi" in GROUP_INTENT_HINTS[EKO]
    assert "restitusi" in GROUP_INTENT_HINTS[PEM]


def test_each_side_points_at_the_other() -> None:
    """Each hint must say where the OTHER kind goes, or a reader who lands
    on one group never learns the boundary exists."""
    assert "Pemerintahan & Kebijakan" in GROUP_INTENT_HINTS[EKO]
    assert "Ekonomi & Bisnis" in GROUP_INTENT_HINTS[PEM]


def test_reuses_the_audit98_test_rather_than_inventing_one() -> None:
    """Consistency is the argument for this rule: it is audit#98's
    facts-vs-polemic test applied to fiscal news. If that anchor is
    dropped the rule looks arbitrary and gets deleted."""
    for hint in (GROUP_INTENT_HINTS[EKO], GROUP_INTENT_HINTS[PEM]):
        assert "audit#98" in hint


def test_evidence_is_recorded() -> None:
    """audit#150-#153 each carry their counts; keeping 40/35 on disk lets a
    later run tell 'rule works' from 'rule ignored'."""
    for hint in (GROUP_INTENT_HINTS[EKO], GROUP_INTENT_HINTS[PEM]):
        assert "40/35" in hint


@pytest.mark.parametrize("needle", ["audit#154", "restitusi", "likuiditas"])
def test_clause_reaches_the_rendered_prompt(needle: str) -> None:
    """`gen_rulebook.py` derives the audit rulebook from this function, so a
    clause that never renders would vanish from the next audit too."""
    assert needle in llm_group_options_prompt()
