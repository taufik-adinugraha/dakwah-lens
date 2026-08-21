"""Pool/candidate text must never be clipped SILENTLY.

Why this file exists — a measured, not hypothetical, failure:

On the 2026-08-20 weekly batch, 427 of 645 pool Arabic fields (66%) were
clipped mid-sentence by a bare `[:300]` with no marker. A composer that
sees a hadith stop mid-word cannot tell the text was cut, so it completes
the well-known ending from training memory. That produced the batch's
dominant defect class — scripture presented as retrieved but in fact
generated:

  * Hukum        — Sahih Muslim 1827: Arabic stopped inside the isnad, so
                   the matn was never supplied at all; the composer wrote
                   the whole matn from memory.
  * Patologi     — Sahih Muslim 2121c: cut after item 1 of a 5-item list;
                   items 2-5 came from memory.
  * Inspirasi    — three separate entries completed from memory.
  * Kesehatan    — one.

Six of the seven briefings verified carried at least one instance. That
violates the AGENTS.md hard rule that every Islamic reference must be
RETRIEVED, never freely generated.

The same silent-clip bug in the *candidate dump* had a second cost: it
clipped at 200 chars with no length shown, so `Riyad as-Salihin 1587` —
whose first 200 chars are pure isnad — looked like a stub with no matn.
Two pick agents were told to skip it as unusable. It is in fact the
hadits qudsi on withholding a worker's wage, the best anchor the labour
theme had.

So both renderers must make a cut unmissable.
"""

from api.scripts.manual_briefing import CAND_FIELD_CHARS, _cand_field
from api.services.briefing import (
    POOL_ARABIC_CHARS,
    POOL_TRANSLATION_CHARS,
    _clip_pool_text,
)


class TestPoolClip:
    def test_text_within_limit_is_returned_verbatim(self):
        s = "بسم الله الرحمن الرحيم"
        assert _clip_pool_text(s, POOL_ARABIC_CHARS) == s

    def test_clipped_text_carries_a_visible_marker(self):
        """The whole point: a cut must be visible to the composer."""
        out = _clip_pool_text("ا" * (POOL_ARABIC_CHARS + 200), POOL_ARABIC_CHARS)
        assert "TERPOTONG" in out, "a silent clip invites completion from memory"

    def test_marker_tells_the_composer_what_not_to_do(self):
        out = _clip_pool_text("x" * 2000, POOL_ARABIC_CHARS)
        assert "hafalan" in out, "marker must forbid completing from memory"

    def test_uncut_text_is_not_marked(self):
        """A false 'truncated' marker would make good daleel look unusable."""
        assert "TERPOTONG" not in _clip_pool_text("short", POOL_ARABIC_CHARS)

    def test_none_and_empty_are_safe(self):
        assert _clip_pool_text(None, 100) == ""
        assert _clip_pool_text("", 100) == ""

    def test_limits_are_wide_enough_for_a_hadith_with_isnad(self):
        """Muslim 1827's Arabic never reached its matn under the old 300."""
        assert POOL_ARABIC_CHARS >= 600
        assert POOL_TRANSLATION_CHARS >= 900


class TestCandidateField:
    def test_true_length_is_always_shown(self):
        """The Riyad as-Salihin 1587 regression.

        The isnad alone fills the visible window, so the only signal that
        a matn exists past the cut is the character count.
        """
        isnad = "Abu Hurairah (May Allah be pleased with him) reported: " + "x" * 400
        matn = " Allah says: Three are those whose adversary I shall be..."
        out = _cand_field("ID/EN", isnad + matn)
        assert f"({len(isnad + matn)} ch)" in out

    def test_clip_is_marked(self):
        out = _cand_field("AR", "y" * (CAND_FIELD_CHARS + 50))
        assert "[CLIPPED]" in out

    def test_short_field_is_not_marked(self):
        out = _cand_field("AR", "brief")
        assert "[CLIPPED]" not in out
        assert "(5 ch)" in out

    def test_empty_field_is_labelled_empty_not_shown_as_text(self):
        """Blank pool entries are widespread; they must be obvious, since
        citing one produces a citation with nothing behind it."""
        assert "empty" in _cand_field("AR", None)
        assert "empty" in _cand_field("AR", "   ")

    def test_newlines_are_flattened_so_one_entry_stays_one_line(self):
        out = _cand_field("ID/EN", "line one\nline two")
        assert "\n" not in out
