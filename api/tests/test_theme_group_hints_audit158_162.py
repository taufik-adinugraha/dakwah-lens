"""Regression tests for the audit#158-#162 GROUP_INTENT_HINTS additions.

Surfaced across the two 2026-09-23 theme audit runs (26 batches). Eight-plus
candidate `_notes` collapsed into five rules, because several were one
principle that agents kept re-deriving per domain.

audit#158 — 'SIDANG' IS NOT 'PIDANA'
    The Gibran ijazah saga looked like a contradiction: four agents, two
    answers. Measured in prod on 09-23 it was not one story but two legal
    tracks sharing a hashtag:

        ijazah/PHPU posts          Pemerintahan 156 · Hukum 72
        of the 72 in Hukum         62 say 'sidang' · 44 say 'MK'
                                   only 4 say 'pidana' · 0 mention police
        Roy Suryo / dr Tifa        Hukum 32 · Pemerintahan 1

    The criminal defamation track (Roy Suryo, dr Tifa: dakwaan, JPU,
    terdakwa) was filed correctly. The constitutional hearing was being
    filed to Hukum on the word 'sidang' alone — a hearing at the MK over
    candidacy eligibility is a legitimacy dispute, not a prosecution.
    The discriminator is the criminal charge, not the courtroom. This is
    audit#101's existing test (no active criminal case → Pemerintahan),
    which agents were re-deriving independently in MK litigation, karhutla
    arson prosecutions and KPK statements within the same run.

audit#159 — SINGLE-SUBJECT ROUND-UPS KEEP THEIR THEME
    Narrows audit#155. That rule keys on digest FORMAT (numbered list,
    `Judul | NamaProgram`), but its reason is that the items span unrelated
    topics. A KM Virgo "TERPOPULER" round-up whose every item was disaster
    coverage is not lintas-topik, and an agent rightly kept it in
    Lingkungan & Bencana against the literal format rule.

audit#160 — DISASTER / PROGRAMME HEALTH HARM: SUBJECT TEST
    Two agents independently reached for audit#102's MBG-poisoning carve-out
    to settle cases it does not cover — one sending haze-driven ISPA counts
    to Kesehatan, one sending a child choking during an MBG meal to
    Lingkungan. Both were right, by the same unstated principle: the post
    goes where its SUBJECT sits — the health condition, or the event.

audit#161 — TEMPLATED SERVICE CONTENT
    KUR/bank loan-simulation tables and ceremonial JKN/BPJS literacy
    contests, both recurring, both routed to Lainnya by agent judgment.

audit#162 — KAJIAN LOGISTICS, BEYOND MAULID
    audit#152 already says livestream promos and event announcements are
    logistics → Lainnya, but only for Maulid. One 09-23 batch had ~132 of
    169 posts that were mosque-channel kajian/ngaji schedule captions with
    no quoted teaching. This generalises the existing principle; it does
    not change what agents were already doing.

Boundary rules (#158, #160) are written into BOTH hints. Per
`project_audit_cumulative_ledger`, a group-scoped rule only fires if the
classifier is already considering that group. Every two-sided assertion
below is checked on BOTH sides: the audit#156 suite originally guarded its
subject-test on one side only, and mutation testing caught it passing with
the other side deleted.
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
LIN = "Lingkungan & Bencana"
EKO = "Ekonomi & Bisnis"
AQI = "Aqidah & Ibadah"


# A tag that CLOSES a rule is followed by ')': "(audit#157)". A tag that is
# merely CITED inside a rule is not: "perpanjangan audit#150 (", "audit#101;",
# "audit#96, diperluas". Treating every tag as a boundary cut audit#161's own
# wording off at its mid-sentence reference to audit#150.
_TAG = re.compile(r"audit#\d+\)")


def _near(group: str, tag: str, before: int | None = None) -> str:
    """Exactly ONE rule's own text: from the end of the previous audit tag up
    to and including this one.

    A fixed-width window is not safe here. It reaches back into the PRECEDING
    rule, so an assertion can pass on that rule's words: a 700-char window
    made 'PERISTIWA' match audit#151's "peristiwanya tidak terjadi" and made
    'Maulid' match audit#152, both with the audit#160/#162 wording deleted.
    Mutation testing caught it. `before` is accepted and ignored for call-site
    compatibility — the rule boundary is the scope, not a character count.
    """
    hint = GROUP_INTENT_HINTS[group]
    i = hint.find(tag)
    assert i != -1, f"{tag} missing from {group}"
    start = 0
    for m in _TAG.finditer(hint, 0, i):
        start = m.end()  # just past the previous rule's closing ")"
    return hint[start : i + len(tag)]


# --------------------------------------------------------------- audit#158

def test_sidang_rule_present_on_both_sides() -> None:
    assert "audit#158" in GROUP_INTENT_HINTS[HUK]
    assert "audit#158" in GROUP_INTENT_HINTS[PEM]


def test_sidang_rule_names_the_trap_word() -> None:
    """The measured failure is agents reading 'sidang' as criminal. The rule
    must say so explicitly — the bare word appears several times in the
    rule, so its presence alone proves nothing."""
    huk = _near(HUK, "audit#158")
    assert "'sidang'" in huk
    assert "BUKAN tanda perkara pidana" in huk
    assert "walau berbentuk 'sidang'" in _near(PEM, "audit#158")


def test_sidang_rule_names_the_constitutional_venues() -> None:
    for group in (HUK, PEM):
        near = _near(group, "audit#158")
        assert "PHPU" in near
        assert "MK" in near
        assert "PTUN" in near


def test_sidang_rule_states_the_criminal_markers_on_both_sides() -> None:
    """The discriminator is the charge. Both sides must name what a charge
    looks like, or a Pemerintahan reader cannot tell when to let go."""
    for group in (HUK, PEM):
        near = _near(group, "audit#158")
        assert "dakwaan" in near
        assert "JPU" in near
        assert "terdakwa" in near


def test_sidang_rule_describes_the_two_track_split() -> None:
    """One topic, two tracks. Without saying so, a reader who has already
    placed the MK hearing will drag the criminal trial after it."""
    for group in (HUK, PEM):
        near = _near(group, "audit#158")
        assert "pidana" in near
        assert "Pemerintahan & Kebijakan" in near or "Hukum & Keadilan" in near


def test_sidang_rule_carries_its_measurement() -> None:
    """Rules in this file cite the numbers that justified them."""
    near = _near(HUK, "audit#158")
    assert "72" in near and "62" in near and "44" in near


def test_audit98_and_audit101_survive() -> None:
    """audit#158 builds on these; it must not have displaced them."""
    assert "audit#98" in GROUP_INTENT_HINTS[HUK]
    assert "audit#101" in GROUP_INTENT_HINTS[HUK]


# --------------------------------------------------------------- audit#159

def test_roundup_exception_attached_to_audit155_on_both_sides() -> None:
    """The exception narrows audit#155, so it must sit next to it."""
    for group in (HUK, PEM):
        hint = GROUP_INTENT_HINTS[group]
        assert "audit#159" in hint
        assert hint.find("audit#155") < hint.find("audit#159")


def test_roundup_exception_turns_on_single_subject() -> None:
    for group in (HUK, PEM):
        near = _near(group, "audit#159", before=260)
        assert "SATU tema" in near
        assert "lintas-topik" in near


def test_audit155_digest_rule_survives() -> None:
    for group in (HUK, PEM):
        assert "judul pertama" in GROUP_INTENT_HINTS[group]


# --------------------------------------------------------------- audit#160

def test_health_harm_rule_present_on_both_sides() -> None:
    assert "audit#160" in GROUP_INTENT_HINTS[KES]
    assert "audit#160" in GROUP_INTENT_HINTS[LIN]


def test_health_harm_rule_each_side_points_at_the_other() -> None:
    assert "Lingkungan & Bencana" in _near(KES, "audit#160")
    assert "Kesehatan & Kehidupan" in _near(LIN, "audit#160")


def test_health_harm_rule_states_the_subject_test_on_both_sides() -> None:
    """The principle is subject, not topic: health condition vs event.
    Both sides must carry both halves."""
    # Case-sensitive on purpose. The rule marks its discriminator in capitals;
    # uppercasing the text first made 'KESEHATAN' match the ordinary phrase
    # "dampak kesehatan", so deleting "KONDISI KESEHATANNYA" still passed.
    kes = _near(KES, "audit#160")
    assert "KONDISI KESEHATANNYA" in kes
    assert "PERISTIWANYA" in kes
    lin = _near(LIN, "audit#160")
    assert "DAMPAK KESEHATAN" in lin
    assert "PERISTIWANYA" in lin


def test_health_harm_rule_names_the_haze_case() -> None:
    for group in (KES, LIN):
        assert "ISPA" in _near(group, "audit#160")


def test_audit102_mbg_rule_survives() -> None:
    kes = GROUP_INTENT_HINTS[KES]
    assert "audit#102" in kes
    assert "audit#156" in kes


# --------------------------------------------------------------- audit#161

def test_templated_content_rule_in_both_attracting_groups() -> None:
    assert "audit#161" in GROUP_INTENT_HINTS[EKO]
    assert "audit#161" in GROUP_INTENT_HINTS[KES]


def test_loan_table_rule_names_the_shape() -> None:
    near = _near(EKO, "audit#161", before=300)
    assert "KUR" in near
    assert "simulasi" in near


def test_bpjs_contest_rule_extends_audit150() -> None:
    near = _near(KES, "audit#161", before=300)
    assert "cerdas cermat" in near
    assert "audit#150" in near


# --------------------------------------------------------------- audit#162

def test_kajian_rule_present() -> None:
    assert "audit#162" in GROUP_INTENT_HINTS[AQI]


def test_kajian_rule_generalises_audit152_beyond_maulid() -> None:
    """It extends an existing principle. It must say so, and #152 must
    still be there to extend."""
    aqi = GROUP_INTENT_HINTS[AQI]
    assert "audit#152" in aqi
    assert aqi.find("audit#152") < aqi.find("audit#162")
    assert "DI LUAR Maulid" in _near(AQI, "audit#162")


def test_kajian_rule_keeps_the_door_open_for_substance() -> None:
    """Routing announcements away must not route teaching away. The rule
    has to say what still qualifies, or it thins the group further."""
    near = _near(AQI, "audit#162", before=400)
    assert "ayat" in near
    assert "hadits" in near


# ------------------------------------------------- rendering / regressions

def test_no_string_concatenation_defects_in_any_hint() -> None:
    for group, hint in GROUP_INTENT_HINTS.items():
        welded = re.findall(r"\)[A-Z]", hint)
        assert not welded, f"{group}: concatenation defect {welded}"


def test_all_new_rules_reach_the_rendered_prompt() -> None:
    prompt = llm_group_options_prompt()
    for tag in ("audit#158", "audit#159", "audit#160", "audit#161", "audit#162"):
        assert tag in prompt
