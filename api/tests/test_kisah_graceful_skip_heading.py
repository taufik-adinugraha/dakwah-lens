"""The Kisah Pendek graceful skip must keep its H3 heading.

When no narrative-kitab section matches a theme, the Kisah Pendek slot is
skipped rather than filled from memory — writing a story that was not
retrieved is the worst failure this pipeline has. But HOW the skip is
written matters, and the prompt used to specify the form that breaks.

`check_structure.py` locates every deliverable sub-section by its
`### <Name>` heading and only then looks inside for skip language to waive
the length check:

    ks = re.search(r"### Kisah Pendek(.*?)(?=^### |\\Z)", md, re.S | re.M)
    skipped = re.search(r"(tidak tersedia|belum bisa|belum tersedia)", seg)

A bare italic line with no heading therefore reads as the section being
MISSING, and the gate fails closed. The web renderer likewise keys the
page off the H3, so a headingless skip would render untitled.

Both prompt sites nonetheless instructed exactly that bare form —
"tulis hanya satu baris" — and two composers followed it and hard-failed
on 2026-09-03. `COMPOSE_INSTRUCTION.md` documents the correct shape; the
generated prompt contradicted it, so a composer obeying its own source
prompt was guaranteed to fail. Found again on 2026-09-17 while composing
Lingkungan & Bencana, whose kisah pool was empty (kisah_fasal=0).

These tests pin the instruction to the form the gate accepts.
"""

from __future__ import annotations

import pytest

from api.services.briefing import SYSTEM_PROMPT_ID


def _skip_instruction() -> str:
    """The skip instruction only, not the whole prompt.

    Scoping matters: `### Kisah Pendek` also appears in the prompt's
    section template, so a global membership test passes on the broken
    text too — it did when this file was first written. Assert inside the
    instruction that actually governs the skip.
    """
    i = SYSTEM_PROMPT_ID.find("sumber kisah belum tersedia")
    assert i != -1, "skip instruction not found — did the marker text change?"
    return SYSTEM_PROMPT_ID[i : i + 1200]


def test_skip_instruction_requires_the_h3_heading() -> None:
    """The instruction must name the heading, not just the italic line."""
    assert "### Kisah Pendek" in _skip_instruction()


def test_skip_instruction_does_not_say_write_only_one_line() -> None:
    """The exact phrasing that produced the 2026-09-03 failures."""
    assert "tulis hanya satu baris" not in SYSTEM_PROMPT_ID


def test_skip_instruction_explains_why_the_heading_matters() -> None:
    """A rule without its reason gets 'tidied' away by the next editor —
    this one already was. Keep the mechanism in the text."""
    seg = _skip_instruction()
    assert "heading" in seg.lower()
    assert "HILANG" in seg or "hilang" in seg


def test_skip_still_forbids_writing_a_story_from_memory() -> None:
    """The fix must not weaken the retrieval rule it sits next to."""
    seg = _skip_instruction()
    assert "memori" in seg.lower()


@pytest.mark.parametrize("marker", ["Tidak Tersedia Pekan Ini", "tidak tersedia"])
def test_skip_language_is_what_the_gate_greps_for(marker: str) -> None:
    """check_structure waives the length check on (tidak tersedia|belum
    bisa|belum tersedia). The instructed wording must contain one."""
    assert marker in SYSTEM_PROMPT_ID
