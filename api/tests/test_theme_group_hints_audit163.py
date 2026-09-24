"""Regression tests for audit#163 — decide by COURT, not by vocabulary.

audit#158 fixed one misreading and caused another. It told agents that a
'sidang' or 'gugatan' is not a criminal case by itself, and that Hukum &
Keadilan applies "HANYA bila ada unsur pidana aktif: dakwaan, JPU, terdakwa...".
Agents read the list as a literal-word gate.

Measured over the 2026-09-24 run (33 batches, 5,661 posts), posts naming the
defendants in the ijazah criminal DEFAMATION trial:

    before audit#158 (09-23 corpus)   Hukum 32 · Pemerintahan 1
    after  audit#158 (09-24 run)      Hukum  5 · Pemerintahan 16 · Lainnya 1

The misfiled posts were clickbait YouTube titles — "SIDANG POKOK PERKARA DR TIFA
VS JOKOWI", "PN JAKTIM HARI INI! ROY-TIFA DATANG", "ROY SURYO TOLAK ... TAWARAN
RJ DARI HAKIM", press conferences "USAI SIDANG POKOK PERKARA". They name the
defendant and the trial, but never use 'dakwaan', 'JPU' or 'terdakwa'. One
agent's own note gave the confusion away: it treated "MK-PN" as one venue.

The discriminator is the court. A hearing at the PN (Pengadilan Negeri) with a
named defendant is the criminal case; a hearing at the MK, PTUN or KIP is the
constitutional or administrative dispute. Venue is concrete, rarely omitted from
a trial headline, and cannot be defeated by clickbait phrasing the way a
required-vocabulary list can. The marker words are demoted from requirement to
evidence.

11 of the 16 were corrected by hand before that run was applied; the other 6
genuinely concerned the MK/PTUN candidacy dispute (a defendant appearing as a
participant there) and stayed in Pemerintahan.

Written into BOTH hints, and every two-sided assertion is checked on both
sides — the audit#156 suite once guarded a rule on one side only, and a
mutation deleting the other side passed.
"""

from __future__ import annotations

import re

from api.services.theme_groups import (
    GROUP_INTENT_HINTS,
    llm_group_options_prompt,
)

HUK = "Hukum & Keadilan"
PEM = "Pemerintahan & Kebijakan"

# A tag that CLOSES a rule is followed by ')'. A tag cited mid-sentence is not.
_TAG = re.compile(r"audit#\d+\)")


def _rule(group: str, tag: str) -> str:
    """Exactly one rule's own text: from the previous rule's closing tag up to
    and including this one. A fixed-width window bleeds into the neighbouring
    rule and lets assertions pass on its words."""
    hint = GROUP_INTENT_HINTS[group]
    i = hint.find(tag)
    assert i != -1, f"{tag} missing from {group}"
    start = 0
    for m in _TAG.finditer(hint, 0, i):
        start = m.end()
    return hint[start : i + len(tag)]


# --------------------------------------------------------------- audit#163

def test_venue_rule_present_on_both_sides() -> None:
    assert "audit#163" in GROUP_INTENT_HINTS[HUK]
    assert "audit#163" in GROUP_INTENT_HINTS[PEM]


def test_venue_rule_names_the_court_as_the_test_on_both_sides() -> None:
    """The principle itself. Without it the rule is a list of cases, and the
    next clickbait format falls through the gaps between them."""
    for group in (HUK, PEM):
        assert "pengadilannya" in _rule(group, "audit#163").lower()


def test_venue_rule_names_PN_as_the_criminal_court_on_both_sides() -> None:
    for group in (HUK, PEM):
        rule = _rule(group, "audit#163")
        assert "PN" in rule
        assert "Pengadilan Negeri" in rule


def test_venue_rule_names_the_constitutional_courts_on_both_sides() -> None:
    """Each side must name the OTHER venue, or a reader on one side never
    learns where the boundary is."""
    for group in (HUK, PEM):
        rule = _rule(group, "audit#163")
        assert "MK" in rule
        assert "PTUN" in rule
        assert "KIP" in rule


def test_venue_rule_names_the_trial_tells_on_both_sides() -> None:
    """The misfiled titles were identifiable by these, not by 'dakwaan'.

    Asserted in QUOTED form on purpose. The Hukum side's measurement sentence
    repeats the phrase unquoted ("sidang pokok perkara di PN Jaktim"), so an
    unquoted check still passed with the rule's own list entry deleted.
    """
    for group in (HUK, PEM):
        rule = _rule(group, "audit#163")
        assert "'sidang pokok perkara'" in rule, group
        assert "RJ" in rule


def test_venue_rule_says_the_marker_word_is_not_required_on_both_sides() -> None:
    """This is the actual fix: a trial headline that never says 'dakwaan'
    is still the trial."""
    # Quoted 'dakwaan' marks the normative clause. The measurement sentence says
    # "tak memuat kata dakwaan" unquoted; matching it let a mutation deleting the
    # actual rule pass.
    for group in (HUK, PEM):
        rule = _rule(group, "audit#163")
        assert re.search(r"memuat kata\s+'dakwaan'", rule), group


def test_venue_rule_carries_its_measurement() -> None:
    assert "16 dari 22" in _rule(HUK, "audit#163")


def test_venue_rule_each_side_points_at_the_other() -> None:
    assert "Pemerintahan & Kebijakan" in _rule(HUK, "audit#163")
    assert "Hukum & Keadilan" in _rule(PEM, "audit#163")


# ------------------------------------------- audit#158, as amended by #163

def test_audit158_no_longer_gates_on_literal_words() -> None:
    """The phrasing that caused the regression must be gone."""
    assert "Masuk sini HANYA bila ada unsur pidana" not in GROUP_INTENT_HINTS[HUK]


def test_audit158_demotes_marker_words_to_evidence() -> None:
    rule = _rule(HUK, "audit#158")
    assert "BUKTI, bukan syarat" in rule
    assert "pengadilannya" in rule


def test_audit158_still_names_what_a_charge_looks_like() -> None:
    """Demoted, not deleted: the words are still the best evidence when
    present, and the audit#158 suite relies on them."""
    for group in (HUK, PEM):
        rule = _rule(group, "audit#158")
        for word in ("dakwaan", "JPU", "terdakwa"):
            assert word in rule, (group, word)


def test_audit158_mk_rule_survives() -> None:
    """#163 narrows the criminal side; the MK-candidacy rule must stand —
    it routed 45 of 45 such posts correctly on 09-24."""
    rule = _rule(PEM, "audit#158")
    assert "PHPU" in rule
    assert "walau berbentuk 'sidang'" in rule


# ------------------------------------------------- rendering / regressions

def test_no_string_concatenation_defects_in_any_hint() -> None:
    for group, hint in GROUP_INTENT_HINTS.items():
        welded = re.findall(r"\)[A-Z]", hint)
        assert not welded, f"{group}: concatenation defect {welded}"


def test_no_cross_reference_masquerades_as_a_rule_boundary() -> None:
    """A '(lihat audit#NNN)' inside another rule's text looks exactly like
    that rule's closing tag. It broke the scoping helper once."""
    for group in (HUK, PEM):
        assert "lihat audit#" not in GROUP_INTENT_HINTS[group]


def test_audit163_reaches_the_rendered_prompt() -> None:
    assert "audit#163" in llm_group_options_prompt()
