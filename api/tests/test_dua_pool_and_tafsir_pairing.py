"""Flyer du'a pool widening + tafsir AR/EN pairing (2026-10-01).

1. Every theme received the SAME eight weekly library du'a, and a pick of six
   came from them, so the 14 themes' flyer du'a pools converged: Sahih
   al-Bukhari 6389, Riyad as-Salihin 1406 and Sahih Muslim 2721a each sat on
   flyers in three themes, and one theme was left choosing between a reused
   du'a and a death-wish du'a (Riyad as-Salihin 585).
2. Tafsir Ibn Kathir hits paired one chunk of the ENGLISH abridgement with the
   opening of the whole ARABIC tafsir of the ayah — never parallel text.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace

import api.scripts.manual_briefing as mb
from api.services import briefing
from api.services import kitab_retrieval as kr

GROUPS = list(kr._THEME_DUA_TAGS)


def test_every_weekly_theme_has_dua_tags() -> None:
    assert len(GROUPS) == 14


def test_themes_in_the_same_week_draw_different_dua() -> None:
    pools = {
        g: [d["citation"] for d in kr.weekly_dua_pool(12, theme_group=g)] for g in GROUPS
    }
    assert all(len(p) == 12 for p in pools.values())
    union = set().union(*pools.values())
    # 14 themes x 12 = 168 slots; a shared slice would give 12.
    assert len(union) >= 100, len(union)


def test_theme_slice_is_card_safe() -> None:
    for g in GROUPS:
        for d in kr.weekly_dua_pool(12, theme_group=g):
            assert 0 < len(d["arabic"]) <= kr._CARD_MAX_ARABIC
            lo, hi = kr._CARD_TRANSLATION_RANGE
            assert lo <= len(d["translation_id"]) <= hi


def test_theme_slice_is_led_by_theme_tags() -> None:
    lib = {d["citation"]: d for d in kr._load_dua_library()}
    pool = kr.weekly_dua_pool(12, theme_group="Kesehatan & Kehidupan")
    tags = set(kr._THEME_DUA_TAGS["Kesehatan & Kehidupan"])
    lead = pool[:4]
    assert all(tags & set(lib[d["citation"]].get("tags") or []) for d in lead)


def test_shared_weekly_slice_is_unchanged_without_a_group() -> None:
    assert len(kr.weekly_dua_pool()) == kr._WEEKLY_DUA_LEAD


def test_death_wish_dua_is_unsafe_even_with_harakat() -> None:
    riyad_585 = (
        "اللَّهُمَّ أَحْيِنِي مَا كَانَتِ الحَيَاةُ خَيْرًا لِي، "
        "وَتَوَفَّنِي إِذَا كَانَتِ الوَفَاةُ خَيْرًا لِي"
    )
    assert kr._is_unsafe_dua(riyad_585)
    assert kr._is_unsafe_dua("اللَّهُمَّ عَلَيْكَ بِقُرَيْشٍ")


def test_ordinary_dua_is_safe() -> None:
    dua = "رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ"
    assert not kr._is_unsafe_dua(dua)


def test_both_weekly_paths_pass_the_group_to_retrieve_dua() -> None:
    assert "group" in inspect.signature(kr.retrieve_dua).parameters
    manual = inspect.getsource(mb._prepare_unranked_candidates)
    auto = inspect.getsource(briefing.generate_briefing)
    call = "dua_candidates = retrieve_dua("
    assert "group=group" in manual[manual.index(call):][:400]
    assert "group=group" in auto[auto.index(call):][:400]


def _tafsir_hit(chunk_en: str) -> SimpleNamespace:
    return SimpleNamespace(
        score=0.5,
        payload={
            "surah": "2", "ayah": "188", "chunk_index": "3",
            "chunk_text_en": chunk_en,
            "ayah_text_ar": "قال علي بن أبي طلحة وعن ابن عباس هذا في الرجل يكون عليه مال",
            "citation_en": "Tafsir Ibn Kathir on 2:188",
        },
    )


def test_tafsir_chunk_without_quoted_arabic_carries_no_arabic() -> None:
    text = "Bribery is prohibited and is a Sin. Ibn Abbas said this is about the debtor."
    h = kr._normalize_hit("tafsir_ibn_kathir", _tafsir_hit(text))
    assert h["arabic"] == ""
    assert "Bribery" in h["translation_en"]


def test_tafsir_chunk_keeps_only_the_arabic_it_quotes() -> None:
    quote = "أَعْظَمُ الْغُلُولِ عِنْدَ اللهِ ذِرَاعٌ مِنَ الْأَرْضِ"
    text = f"The Prophet said, «{quote}» (The worst Ghulul is a yard of land)"
    h = kr._normalize_hit("tafsir_ibn_kathir", _tafsir_hit(text))
    assert quote in h["arabic"]
    assert "ابن أبي طلحة" not in h["arabic"]
