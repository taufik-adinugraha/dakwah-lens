"""Regression tests for the two flyer-render rules added 2026-09-10.

Both defects share a shape: the markdown looks correct, the save
validators pass, and the 1080x1080 card still renders something other
than what the author intended — with no error anywhere. Neither is
catchable by a Python validator, because the rendering lives in
TypeScript (`web/src/lib/flyer/content.ts`). So the fix is upstream, in
the prompt the composer reads, and these tests pin that it stays there.

1. The card window. `pickDaleelTranslation` accumulates from the START of
   the translation and stops near 560 chars. Classic-kitab entries run
   1,000-1,300 chars, so more than half never appears. A headline lifting
   an idea from deep in the entry renders beside an unrelated quote.
   Pendidikan & SDM shipped "Semut pun Mendoakan Pengajar Kebaikan" whose
   ant image sat at offset 956 of 1,271 — real, correctly used in the
   body, invisible on the card.

2. Mid-chunk entries. Many classic-kitab chunks begin "Lanjutan ..." or
   with an ellipsis because the passage starts in the previous chunk.
   Three of six Pendidikan flyers rendered cards opening mid-sentence.

The companion fix for the inline-du'a parse is in the renderer itself
(`parseInlineDua` now accepts an unquoted Indonesian line inside the
Arabic -> Indonesian -> citation sandwich); its tests live in
`web/src/lib/flyer/content.test.ts`. The prompt rule below still states
the quoted convention, because the parse is only the safety net.
"""

from __future__ import annotations

from api.services.briefing import SYSTEM_PROMPT_ID


def test_prompt_states_the_card_only_renders_the_opening():
    assert "ATURAN JENDELA KARTU" in SYSTEM_PROMPT_ID
    assert "560 karakter" in SYSTEM_PROMPT_ID


def test_prompt_tells_the_composer_to_read_the_opening_before_writing_a_headline():
    """The actionable half — without it the rule is just trivia."""
    assert "550 karakter" in SYSTEM_PROMPT_ID
    assert "PERTAMA" in SYSTEM_PROMPT_ID


def test_prompt_warns_against_mid_chunk_daleel():
    assert "MULAI DI TENGAH KALIMAT" in SYSTEM_PROMPT_ID
    # The two literal markers a composer can actually scan for.
    assert "Lanjutan" in SYSTEM_PROMPT_ID


def test_prompt_specifies_the_inline_dua_layout():
    """Arabic, quoted Indonesian, citation — each on its own line.

    A miss here is silent: composeFlyer falls back to the pool entry and
    the card shows the full isnad-bearing hadith instead of the du'a.
    """
    assert "BENTUK PENULISAN DU'A INLINE" in SYSTEM_PROMPT_ID
    assert "TANDA KUTIP" in SYSTEM_PROMPT_ID


def test_prompt_explains_the_silent_fallback_not_just_the_rule():
    """Every hard rule in this template says WHY, because a rule whose
    cost is invisible gets optimised away by the next composer."""
    assert "diam-diam jatuh ke entri pool" in SYSTEM_PROMPT_ID


def test_slot6_recitability_rule_survives():
    """Pre-existing rule these edits sit next to — guard against a
    careless overwrite of the surrounding block."""
    assert "Doa Pekan Ini" in SYSTEM_PROMPT_ID
    assert "as'aluka" in SYSTEM_PROMPT_ID
