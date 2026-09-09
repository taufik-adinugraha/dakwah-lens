"""Regression tests for the audit#150 GROUP_INTENT_HINTS additions.

audit#150 was a 4-day backfill of 7,081 posts left unclassified when the
theme classifier stopped on 2026-09-07. Because every post was null, it
could NOT tell us what the classifier gets wrong — that inference is the
trap behind 13 rejected rule candidates across 8 prior audits.

What it COULD tell us is where the *rulebook* is silent. Three news
clusters were split almost perfectly along batch boundaries, i.e. the
group depended on which reader drew the post rather than on the text:

    Islam-ala-Prabowo book   201 posts   80/1 in one batch, 2/37 in another
    BPJS / JKN               236 posts   66 Kesehatan vs 84 Lainnya
    harga emas Antam         268 posts   111 Ekonomi vs 155 Lainnya

That divergence is measured on identical texts, and `gen_rulebook.py`
derives the audit rulebook from `llm_group_options_prompt()` — the same
text the live classifier reads. So the ambiguity is in the prompt, and
these tests pin the clauses that resolve it.

Two of the three share one root cause: thin/routine/automated content
was inheriting its topic's group. The third is a genuine institutional
confusion (BPJS Ketenagakerjaan is not BPJS Kesehatan).
"""

from __future__ import annotations

import pytest

from api.services.theme_groups import (
    GROUP_INTENT_HINTS,
    llm_group_options_prompt,
)


def _hint(group: str) -> str:
    return GROUP_INTENT_HINTS[group]


# ── Gap 1: religiously-framed political polemic ───────────────────

def test_religious_framing_of_political_figures_routes_to_aqidah() -> None:
    """A book by state religious bodies venerating an official's piety
    satisfied BOTH "polemik aqidah" and "polemik pejabat" with nothing
    to adjudicate. The clause names the tie-breaker: religious
    authority is the substance."""
    h = _hint("Aqidah & Ibadah")
    assert "audit#150" in h
    assert "OTORITAS KEAGAMAAN" in h
    for token in ("MUI", "BAZNAS", "Kemenag"):
        assert token in h, f"{token} must be named as a state religious body"
    # It must say where NOT to send it, or the ambiguity survives.
    assert "BUKAN Pemerintahan & Kebijakan" in h


def test_aqidah_clause_keeps_the_official_statement_escape_hatch() -> None:
    """The rule must not swallow genuine palace/ministry statements."""
    h = _hint("Aqidah & Ibadah")
    assert "istana" in h and "kementerian" in h


def test_aqidah_clause_still_sends_banter_to_lainnya() -> None:
    """18 of the 201 cluster posts were bare links and one-line jokes."""
    assert "Lainnya" in _hint("Aqidah & Ibadah")


# ── Gap 2: thin/routine content must not inherit its topic ────────

def test_daily_price_bulletins_are_not_ekonomi() -> None:
    h = _hint("Ekonomi & Bisnis")
    assert "audit#150" in h
    assert "harga emas Antam" in h
    assert "buyback" in h
    assert "Lainnya" in h


def test_ekonomi_clause_still_admits_real_analysis() -> None:
    """The point is thinness, not the topic. Substantive gold coverage
    stays in Ekonomi & Bisnis."""
    h = _hint("Ekonomi & Bisnis")
    assert "SEBAB" in h  # analysis of why prices moved
    for token in ("inflasi", "investasi", "daya beli"):
        assert token in h


def test_health_service_tutorials_are_not_kesehatan() -> None:
    h = _hint("Kesehatan & Kehidupan")
    assert "audit#150" in h
    assert "Mobile JKN" in h
    assert "Lainnya" in h


def test_kesehatan_clause_still_admits_substantive_health_content() -> None:
    h = _hint("Kesehatan & Kehidupan")
    for token in ("pengalaman pasien", "mutu layanan", "Menkes"):
        assert token in h


# ── Gap 3: BPJS Ketenagakerjaan is a different institution ────────

def test_bpjs_ketenagakerjaan_disambiguated_from_the_HEALTH_side() -> None:
    """`Pekerja & Pertanian Rakyat` already claimed BPJS Ketenagakerjaan
    before audit#150 and readers still misfiled it — because a JMO/JHT
    post lands on Kesehatan & Kehidupan first and never reads the
    employment group's rules. A group-scoped BUKAN only fires if the
    reader already considers that group, so the pointer has to live on
    the group they actually reach. This is the load-bearing test: it
    fails if someone "tidies" the clause back to the employment side."""
    health = _hint("Kesehatan & Kehidupan")
    assert "KETENAGAKERJAAN" in health.upper()
    assert "Pekerja & Pertanian Rakyat" in health
    for token in ("JHT", "JMO"):
        assert token in health


def test_employment_group_still_claims_bpjs_ketenagakerjaan() -> None:
    """The pre-existing rule must stay — the fix is additive."""
    assert "BPJS Ketenagakerjaan" in _hint("Pekerja & Pertanian Rakyat")


# ── The prompt the classifier actually receives ───────────────────

@pytest.mark.parametrize(
    "needle",
    [
        "OTORITAS KEAGAMAAN",       # gap 1
        "harga emas Antam",         # gap 2a
        "Mobile JKN",               # gap 2b
        "KETENAGAKERJAAN",          # gap 3
    ],
)
def test_clauses_reach_the_rendered_prompt(needle: str) -> None:
    """A hint that never renders into `llm_group_options_prompt()` is
    dead text — and `gen_rulebook.py` reads exactly this function, so a
    clause missing here would also silently vanish from the next audit's
    rulebook, letting audit and pipeline drift apart."""
    assert needle in llm_group_options_prompt()


def test_every_hinted_group_renders_exactly_once() -> None:
    prompt = llm_group_options_prompt()
    for group in GROUP_INTENT_HINTS:
        assert prompt.count(f"- {group}:") == 1, group


def test_lainnya_has_no_hint_entry() -> None:
    """Documents why the thin-content rule is spread across the
    substantive groups instead of living in one place: Lainnya is the
    catch-all and is deliberately absent from the hint dict, so there is
    no single Lainnya clause to attach it to."""
    assert "Lainnya" not in GROUP_INTENT_HINTS
