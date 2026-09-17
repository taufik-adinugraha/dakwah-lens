"""Regression tests for the audit#153 GROUP_INTENT_HINTS addition.

audit#153 came out of the 2026-09-17 run (37 batches, 6,439 posts, 6,345
corrections). Most of the subagent `_notes` that run produced were
agreements, not gaps: karhutla bulletins, kapal-search clusters, reshuffle
duplicates and fandom banter were all already routed correctly by existing
rules, and reading a 20-post sample of serious-keyword-to-Lainnya
corrections confirmed it — jokes, flirty banter, thin fragments and
routine police PR, every one correctly Lainnya. Vocabulary overlap is not
reader disagreement.

The one real gap showed up as two agents writing OPPOSITE rules for the
same content. flags_09 proposed gestun/paylater cash-out ads to Patologi
Sosial Digital; flags_25 proposed the same content to Lainnya "kecuali
eksplisit menyebut penipuan/pinjol ilegal".

Measured, that split is persistent and does not converge:

    run 2026-09-14   43 gestun corrections   27 Patologi / 16 Lainnya
    run 2026-09-17   35 gestun corrections   18 Patologi / 17 Lainnya
                     --                      --
                     78                      45 / 33

Two independent cohorts, two days apart, landing on a coin-flip. The cause
is the same as audit#152's Maulid clause: the hint closes with "Patologi
butuh unsur judi/pinjol/narkoba/KBGO/hoax eksplisit", and gestun is none of
those by name. A literal reader answers "no" and writes Lainnya; a reader
reasoning by analogy from pinjol writes Patologi. Both are defensible
against the text, which is the signature of silence rather than difficulty.

One caution is baked into the clause. The first measurement here swept the
`#zonauang` hashtag and found a 74/21 "split" that was not one — the 74
were arisan, joki tugas, jasa edit video and freelance posts that merely
share the tag. The rule therefore names gestun as the ACT and explicitly
leaves the rest of the hashtag in Lainnya, so it cannot re-inflate into a
tag-wide sweep.
"""

from __future__ import annotations

import pytest

from api.services.theme_groups import (
    GROUP_INTENT_HINTS,
    llm_group_options_prompt,
)


def _patologi() -> str:
    return GROUP_INTENT_HINTS["Patologi Sosial Digital"]


def test_gestun_is_named_at_all() -> None:
    """The whole point: the rule was derivable but unnamed."""
    h = _patologi()
    assert "audit#153" in h
    assert "GESTUN" in h


def test_both_sides_of_the_transaction_are_covered() -> None:
    """The 09-17 sample had `kak bisa gestun paylater tiktok gaa` land in
    Patologi while `rekomendasiin gestun tiktok paylater yang trusted` land
    in Lainnya. Seeking the service is the same act as offering it; if the
    clause named only the ads, that asymmetry would survive the fix."""
    h = _patologi()
    assert "MENAWARKAN" in h
    assert "MENCARI" in h


def test_the_named_platforms_are_present() -> None:
    """Readers matched on brand names, not on the word gestun alone."""
    h = _patologi()
    for token in ("Spaylater", "Kredivo", "GoPayLater"):
        assert token in h, f"{token} must be named"


def test_clause_does_not_sweep_the_whole_hashtag() -> None:
    """The guard against the false 74/21 reading. Without these exclusions
    the clause reads as '#zonauang is Patologi' and mislabels arisan, joki
    and jasa-edit posts that merely share the tag."""
    h = _patologi()
    assert "#zonauang" in h
    for token in ("arisan online", "joki tugas", "jasa edit video"):
        assert token in h, f"{token} must stay excluded"
    assert "Lainnya" in h


def test_rationale_ties_gestun_to_the_pinjol_ecosystem() -> None:
    """The group requires an explicit online element and an explicit
    judi/pinjol/narkoba/KBGO/hoax element (audit#102). Gestun qualifies on
    both counts only because it is informal high-cost consumer credit run
    digitally — if that reasoning is dropped the clause looks arbitrary and
    the next editor deletes it."""
    h = _patologi()
    assert "audit#102" in h
    assert "pinjol" in h
    assert "digital" in h


def test_evidence_is_recorded_in_the_clause() -> None:
    """audit#150/#151/#152 each carry their own counts. Keeping the 45/33
    on disk is what lets a later run tell 'rule works' from 'rule ignored'."""
    assert "45/33" in _patologi()


@pytest.mark.parametrize("needle", ["GESTUN", "Kredivo", "#zonauang", "MENCARI"])
def test_clause_reaches_the_rendered_prompt(needle: str) -> None:
    """`gen_rulebook.py` derives the audit rulebook from this function, so
    a clause that never renders would vanish from the next audit too."""
    assert needle in llm_group_options_prompt()
