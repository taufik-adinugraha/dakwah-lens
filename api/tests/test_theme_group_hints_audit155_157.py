"""Regression tests for the audit#155 / #156 / #157 GROUP_INTENT_HINTS additions.

Three rules surfaced as `_notes` from the 2026-09-21 and 2026-09-22 theme
audit runs — each recurring across batches, none covered by the rulebook.

audit#155 — REDAKSI DIGEST / BULLETIN
    Posts shaped `Judul | NamaProgram` followed by a numbered list of
    unrelated headlines (TV news round-ups, portal digests). Flagged
    independently by flags_08 (09-22) as recurring "heavily". They have no
    single substantive theme, so a reader who classifies from the FIRST
    headline files the whole digest under whatever that headline happened
    to be. Written into Hukum & Keadilan and Pemerintahan & Kebijakan —
    the two groups a multi-topic news digest most plausibly lands in.

audit#156 — MOCKERY OF POISONING VICTIMS
    audit#102 already routes mass food poisoning (MBG) WITHOUT a criminal
    element to Kesehatan & Kehidupan. But the 09-22 corpus carried a
    distinct follow-on story: a video of SPPG staff mocking victims, and a
    child victim ostracised by neighbours and school. The subject there is
    the TREATMENT OF THE VICTIM — child protection and bullying — not the
    poisoning event. flags_01 routed these to Sosial & Keluarga on its own
    judgment; the rulebook was silent.

audit#157 — SEIZED-ASSET GRANTS TO LOCAL GOVERNMENT
    Assets forfeited in a concluded corruption case, then granted to a
    pemkot/pemda for public use. flags_05 (09-21) reported this cluster
    "berulang salah null". It is administrative asset stewardship with no
    suspect and no live case, so it belongs with audit#101's existing
    principle (administrative acts without an active criminal case →
    Pemerintahan & Kebijakan) rather than with the prosecution.

Both boundary rules (#156, #157) are written into BOTH sides deliberately.
Per `project_audit_cumulative_ledger`, a group-scoped rule only fires if
the classifier is already considering that group — a one-sided rule is
invisible to exactly the readers who need it.

This module also guards a defect the audit#154 edit introduced: its text
was appended directly after `"(audit#96, diperluas audit#100)"` with no
separator, so the rendered hint read `...audit#100)BERITA FISKAL...`.
"""

from __future__ import annotations

import re

from api.services.theme_groups import (
    GROUP_INTENT_HINTS,
    llm_group_options_prompt,
)

HUK = "Hukum & Keadilan"
PEM = "Pemerintahan & Kebijakan"
KES = "Kesehatan & Kehidupan"
SOS = "Sosial & Keluarga"


# --------------------------------------------------------------- audit#155

def test_digest_rule_present_on_both_plausible_attractors() -> None:
    """A digest can be filed from any headline it contains; the rule has to
    sit in the groups that actually attract multi-topic news."""
    assert "audit#155" in GROUP_INTENT_HINTS[HUK]
    assert "audit#155" in GROUP_INTENT_HINTS[PEM]


def test_digest_rule_names_the_literal_shape() -> None:
    """The batch note identified the format, not the topic. Name the format
    or the rule is unfindable by a reader looking at one."""
    for hint in (GROUP_INTENT_HINTS[HUK], GROUP_INTENT_HINTS[PEM]):
        assert "NamaProgram" in hint
        assert "bernomor" in hint


def test_digest_rule_forbids_classifying_from_the_first_headline() -> None:
    """This is the actual failure mode, and it is what makes the rule more
    than a restatement of 'thin content is Lainnya'."""
    for hint in (GROUP_INTENT_HINTS[HUK], GROUP_INTENT_HINTS[PEM]):
        assert "judul pertama" in hint


# --------------------------------------------------------------- audit#156

def test_mockery_rule_present_on_both_sides() -> None:
    assert "audit#156" in GROUP_INTENT_HINTS[KES]
    assert "audit#156" in GROUP_INTENT_HINTS[SOS]


def test_mockery_rule_each_side_points_at_the_other() -> None:
    kes, sos = GROUP_INTENT_HINTS[KES], GROUP_INTENT_HINTS[SOS]
    assert "Sosial & Keluarga" in kes[kes.find("audit#156") - 400 :]
    assert "Kesehatan & Kehidupan" in sos[sos.find("audit#156") - 400 :]


def test_mockery_rule_turns_on_subject_not_topic() -> None:
    """MBG appears in BOTH audit#102 (poisoning → Kesehatan) and audit#156
    (mockery → Sosial). The discriminator is what the post is ABOUT, so the
    hint must say so rather than just naming MBG again."""
    kes = GROUP_INTENT_HINTS[KES]
    sos = GROUP_INTENT_HINTS[SOS]
    # The discriminator must be stated on BOTH sides. A reader who lands on
    # Sosial needs to know the poisoning event itself is NOT theirs, just as
    # a reader on Kesehatan needs to know the mockery is not.
    for hint in (kes, sos):
        tail = hint[hint.find("audit#156") - 400 :]
        assert "bukan peristiwa keracunannya" in tail
    assert "perlindungan anak/perundungan" in sos


def test_audit102_poisoning_rule_survives() -> None:
    """audit#156 narrows audit#102; it must not have replaced it."""
    kes = GROUP_INTENT_HINTS[KES]
    assert "audit#102" in kes
    assert "keracunan " in kes
    assert "BUKAN Hukum & Keadilan" in kes


# --------------------------------------------------------------- audit#157

def test_asset_grant_rule_present_on_both_sides() -> None:
    assert "audit#157" in GROUP_INTENT_HINTS[HUK]
    assert "audit#157" in GROUP_INTENT_HINTS[PEM]


def test_asset_grant_rule_states_the_no_active_case_test() -> None:
    """The reason this is not Hukum is the absence of a live case — the
    same test audit#101 already uses. Say it, don't imply it."""
    huk = GROUP_INTENT_HINTS[HUK]
    tail = huk[huk.find("audit#157") - 400 :]
    assert "perkara pidana" in tail
    pem = GROUP_INTENT_HINTS[PEM]
    ptail = pem[pem.find("audit#157") - 400 :]
    assert "tersangka" in ptail


def test_asset_grant_rule_is_anchored_to_audit101() -> None:
    """It extends an existing principle rather than opening a new axis."""
    huk = GROUP_INTENT_HINTS[HUK]
    tail = huk[huk.find("audit#157") - 400 :]
    assert "audit#101" in tail


def test_audit101_administrative_rule_survives() -> None:
    assert "audit#101" in GROUP_INTENT_HINTS[HUK]


# ------------------------------------------------- rendering / regressions

def test_no_string_concatenation_defects_in_any_hint() -> None:
    """A missing `. ` separator between two adjacent literals silently
    welds two sentences together. The audit#154 edit did exactly this,
    rendering `...audit#100)BERITA FISKAL...`."""
    for group, hint in GROUP_INTENT_HINTS.items():
        welded = re.findall(r"\)[A-Z]", hint)
        assert not welded, f"{group}: concatenation defect {welded}"


def test_audit154_separator_is_fixed() -> None:
    pem = GROUP_INTENT_HINTS[PEM]
    assert "audit#100)BERITA" not in pem
    assert "audit#100). BERITA" in pem


def test_all_new_rules_reach_the_rendered_prompt() -> None:
    """A hint that never reaches the prompt is a rule that does not exist."""
    prompt = llm_group_options_prompt()
    for tag in ("audit#155", "audit#156", "audit#157"):
        assert tag in prompt
