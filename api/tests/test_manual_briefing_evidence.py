"""Two defects in what the manual briefing path feeds its composer (2026-09-24).

1. The manual path called Gemini. `dump-candidates` built its Qdrant query with
   `briefing._build_retrieval_query`, which calls Gemini Flash-Lite — the one
   call the 2026-06-24 pure-Claude refactor missed. The operator rule is zero
   Gemini in the manual path. With the prepay depleted, every batch had also been
   silently retrieving with the weak token-concat fallback (Pemerintahan: Qur'an 0
   kept against 6 per corpus with a Claude-authored query).

2. Sample headlines were not filtered by theme_group. `_compute_stats` ranked
   topics by the group's own post count but fetched each topic's three headlines
   with `WHERE topic_id = :tid` alone. Topics span groups, so every group's prompt
   carried the same headlines per topic — Aqidah & Ibadah's evidence was
   political posts about an MK case. Those headlines are the composer's ground
   truth; the SELF-FACT-CHECK GATE forbids anything not in them.
"""

from __future__ import annotations

import inspect
import re

import pytest

import api.scripts.manual_briefing as mb
from api.services import briefing


def test_manual_path_does_not_import_the_gemini_query_builder() -> None:
    assert not hasattr(mb, "_build_retrieval_query"), (
        "manual_briefing must not reach briefing._build_retrieval_query (Gemini)"
    )


def test_manual_path_never_calls_the_gemini_query_builder() -> None:
    src = inspect.getsource(mb)
    assert not re.search(r"\b_build_retrieval_query\(", src)


def test_query_file_is_parsed_into_three_joined_lines(tmp_path) -> None:
    q = tmp_path / "q.txt"
    q.write_text("ID: amanah jabatan\nEN: amanah of office\nAR: الأمانة في الولاية\n",
                 encoding="utf-8")
    assert mb._read_query_file(str(q)) == "amanah jabatan\namanah of office\nالأمانة في الولاية"


def test_query_file_missing_a_language_is_refused(tmp_path) -> None:
    q = tmp_path / "q.txt"
    q.write_text("ID: amanah jabatan\nEN: amanah of office\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        mb._read_query_file(str(q))


def _headline_query() -> str:
    src = inspect.getsource(briefing._compute_stats)
    start = src.index("SELECT text, author, engagement_views")
    return src[start : src.index("LIMIT 3", start)]


def test_sample_headlines_are_filtered_to_the_group() -> None:
    q = _headline_query()
    assert "WHERE topic_id = :tid" in q
    assert "{group_filter_clause}" in q


def test_sample_headlines_are_filtered_to_the_week() -> None:
    assert "posted_at >= :start" in _headline_query()


def test_headline_query_binds_the_group_and_window_params() -> None:
    src = inspect.getsource(briefing._compute_stats)
    call = src[src.index("SELECT text, author, engagement_views"):][:1500]
    assert '"group_name": group' in call
    assert '"start": period_start' in call


# ── khutbah du'a template (2026-09-24) ────────────────────────────────────
# The system prompt's khutbah-kedua list is copied by composers nearly verbatim.
# It carried a du'a for victory over "Your enemy, our enemy and the enemy of
# Islam" and a parents' du'a with broken grammar, and it REQUIRED every thematic
# addition to be in Arabic — i.e. Arabic composed from memory.

_PROMPTS = {"id": briefing.SYSTEM_PROMPT_ID, "en": briefing.SYSTEM_PROMPT_EN}


@pytest.mark.parametrize("lang", ["id", "en"])
def test_khutbah_template_has_no_victory_over_enemies_dua(lang) -> None:
    p = _PROMPTS[lang]
    assert "انْصُرْنَا عَلٰى عَدُوِّكَ" not in p
    assert "عَدُوِّ الْإِسْلَامِ" not in p


@pytest.mark.parametrize("lang", ["id", "en"])
def test_khutbah_template_parents_dua_is_grammatical(lang) -> None:
    p = _PROMPTS[lang]
    assert "وَرَبِّهِمْ كَمَا رَبَّيَانَا" not in p
    assert "وَارْحَمْهُمَا كَمَا رَبَّيَانَا صِغَارًا" in p


def test_khutbah_template_forbids_composed_arabic_dua() -> None:
    assert "SETIAP TAMBAHAN HARUS DALAM AKSARA ARAB" not in _PROMPTS["id"]
    assert "EVERY ADDITION MUST BE IN ARABIC SCRIPT" not in _PROMPTS["en"]
    assert "JANGAN menyusun kalimat doa Arab sendiri" in _PROMPTS["id"]
    assert "NEVER compose Arabic du'a sentences yourself" in _PROMPTS["en"]


# ── scan_firman_hadith_mismatch: qudsi marker placed BEFORE the trigger ────
from api.services.validate_briefing import scan_firman_hadith_mismatch  # noqa: E402


def test_qudsi_marker_before_firman_is_not_flagged() -> None:
    md = ("Dalam hadits qudsi yang diriwayatkan Abu Dzar dari Nabi ﷺ, dari Rabb-nya, "
          "firman Allah Ta'ala tercatat dalam **Bulugh al-Maram 1692**:\n\n"
          "\"Wahai hamba-hamba-Ku, sesungguhnya Aku telah mengharamkan kezaliman...\"")
    assert scan_firman_hadith_mismatch(md) == []


def test_firman_on_a_hadith_without_qudsi_marker_is_still_flagged() -> None:
    md = ("Sebagaimana firman Allah Ta'ala dalam **Bulugh al-Maram 1692**:\n\n"
          "\"Wahai hamba-hamba-Ku...\"")
    assert scan_firman_hadith_mismatch(md)


# ── maqashid framing: no unsourced ruling (2026-09-25) ──────────────────────
# The template declared guarding all six maqashid axes "fardh kifayah" with a
# "dosa bersama" clause, and its pinjol example called educating neighbours
# fardh kifayah — a ruling with no retrieved daleel, flagged by verify every week.


def test_maqashid_template_issues_no_fardh_kifayah_ruling() -> None:
    p = briefing.SYSTEM_PROMPT_ID
    assert "adalah **fardh kifayah** atas umat" not in p
    assert "ini fardh kifayah komunitas Muslim" not in p
    assert "dosa bersama bila terbengkalai" not in p
    assert "JANGAN menetapkan status hukum" in p
