"""Regression tests: a daleel candidate with a citation but no text.

A pool entry that carries an authoritative-looking citation and an empty
body is worse than no entry at all. The composer reads the citation,
finds nothing to quote, and may write prose attributed to a source it
never saw — which is the fabrication PRD §12 exists to prevent
("every Islamic reference must be RETRIEVED, never freely generated").

Two independent ways such an entry reached the pool, both observed in
live runs on 2026-09-10:

  1. `tafsir_ibn_kathir` / `tafsir_al_tabari` fell through to the hadith
     branch of `_normalize_hit`, which reads payload["ar"]/["id"]/["en"].
     Tafsir payloads have none of those keys, so every field normalized
     to "" while `citation_en` survived. Present in 3 of 3 themes
     sampled (44:14, 7:94, 5:33).

  2. `al_umm` / `fath_al_muin` / `fiqh_as_sunnah` are still Arabic-only —
     the 2026-06-13 bilingual re-embed covered 7 classics but not these.
     The Ekonomi & Bisnis run that day surfaced البيوع/الإحتكار,
     متى يحرم الاحتكار and التسعير — the three chapters most relevant to
     a week of mask price-gouging — every one with an empty body.

The bar is Indonesian specifically, not "any text": these pools feed
Indonesian briefings, and an entry the composer cannot render on an ID
surface is unusable even when its Arabic is present. That mirrors the
existing hadith rule, where EN-only corpora are skipped rather than
shown in English on an Indonesian card.
"""

from __future__ import annotations

from types import SimpleNamespace

from api.services.briefing import SYSTEM_PROMPT_EN, SYSTEM_PROMPT_ID
from api.services.kitab_retrieval import _has_usable_text, _normalize_hit


def _hit(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(payload=payload, score=0.9, id="x")


# ── the guard itself ──────────────────────────────────────────────


def test_empty_translation_id_is_not_usable():
    assert _has_usable_text({"translation_id": ""}) is False


def test_whitespace_only_translation_id_is_not_usable():
    assert _has_usable_text({"translation_id": "   \n\t "}) is False


def test_missing_translation_id_is_not_usable():
    assert _has_usable_text({"citation": "Sahih Muslim 1526a"}) is False


def test_none_translation_id_is_not_usable():
    assert _has_usable_text({"translation_id": None}) is False


def test_arabic_without_indonesian_is_still_not_usable():
    """Arabic alone does not make an entry renderable on an ID surface."""
    assert (
        _has_usable_text(
            {"arabic": "الحمد لله رب العالمين", "translation_id": ""}
        )
        is False
    )


def test_english_without_indonesian_is_still_not_usable():
    assert (
        _has_usable_text({"translation_en": "All praise is due to Allah", "translation_id": ""})
        is False
    )


def test_real_indonesian_text_is_usable():
    assert _has_usable_text({"translation_id": "Segala puji bagi Allah."}) is True


# ── the tafsir branch that manufactured the text-less entries ─────


def test_ibn_kathir_payload_maps_its_own_keys():
    """Before the dedicated branch, every one of these normalized to ""."""
    out = _normalize_hit(
        "tafsir_ibn_kathir",
        _hit(
            {
                "surah": 44,
                "ayah": 14,
                "chunk_index": 2,
                "chunk_text_en": "Then they turned away from him and said...",
                "ayah_text_ar": "ثُمَّ تَوَلَّوْا عَنْهُ",
                "citation_en": "Tafsir Ibn Kathir on 44:14",
            }
        ),
    )
    assert out["translation_en"] == "Then they turned away from him and said..."
    assert out["arabic"] == "ثُمَّ تَوَلَّوْا عَنْهُ"
    assert out["ref_id"] == "tafsir_ibn_kathir::44:14:2"


def test_al_tabari_payload_maps_arabic_chunk():
    out = _normalize_hit(
        "tafsir_al_tabari",
        _hit(
            {
                "surah": 5,
                "ayah": 33,
                "chunk_index": 0,
                "chunk_text_ar": "القول في تأويل قوله تعالى",
                "citation": "Tafsir al-Tabari on 5:33",
            }
        ),
    )
    assert out["arabic"] == "القول في تأويل قوله تعالى"
    assert out["citation"] == "Tafsir al-Tabari on 5:33"


def test_tafsir_carries_no_indonesian_so_the_guard_drops_it():
    """Neither tafsir corpus is translated, so both fail the ID bar.

    They stay reachable through `retrieve_tafsir_for_ayah`, the keyed
    path the Tafsir Pekan Ini track actually uses — this only keeps them
    out of the similarity-ranked daleel pool.
    """
    out = _normalize_hit(
        "tafsir_ibn_kathir",
        _hit(
            {
                "surah": 7,
                "ayah": 94,
                "chunk_index": 1,
                "chunk_text_en": "And We did not send a prophet...",
                "citation_en": "Tafsir Ibn Kathir on 7:94",
            }
        ),
    )
    assert out["citation"]  # a real citation survives …
    assert not _has_usable_text(out)  # … but it must not reach the pool


# ── the disclaimer the composer is told to emit ───────────────────


def test_disclaimer_template_uses_no_all_caps_emphasis():
    """`BUKAN` in the template put ALL-CAPS into every briefing shipped.

    The rule is markdown emphasis, never caps, in Indonesian Islamic
    prose. The template is what the composer copies, so the template is
    where it has to be right — `check_structure.py` treats the caps form
    as a blocking error and rejected four briefings on 2026-09-10.
    """
    assert "AI-assisted, bukan fatwa otoritatif" in SYSTEM_PROMPT_ID
    assert "BUKAN fatwa otoritatif" not in SYSTEM_PROMPT_ID
    assert "NOT an authoritative fatwa" not in SYSTEM_PROMPT_EN


def test_disclaimer_still_states_it_is_not_a_fatwa():
    """PRD §12 requires the label; the caps fix must not drop it."""
    assert "bukan fatwa otoritatif" in SYSTEM_PROMPT_ID
    assert "not an authoritative fatwa" in SYSTEM_PROMPT_EN
