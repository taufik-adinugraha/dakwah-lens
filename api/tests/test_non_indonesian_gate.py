"""Regression tests for the non-Indonesian pre-gate (audit#149).

The gate force-routes a post to `theme_group='Lainnya'` with a confident-
neutral sentiment WITHOUT calling the classifier. A false positive is
therefore destructive: it silently corrupts two columns for that row and the
post never reaches the model that would have labelled it correctly. A false
negative merely costs one classifier call.

Every INDONESIAN_* string below is a real post that audit#149 found wrongly
gated, or the register class it belongs to.
"""

from __future__ import annotations

import pytest

from api.services.sentiment import _is_predominantly_non_indonesian as gate


# Headline register: noun-heavy, zero function words. This is the class that
# broke — 16/16 sampled eruption reports were gated.
INDONESIAN_HEADLINES = [
    "Gunung Sinabung Erupsi, Muntahkan Kolom Abu Setinggi 3,5 KM | AKIS",
    "Gunung Anak Krakatau Erupsi, Semburan Abu Capai 15 Kilometer | OneNews Update",
    "Tiga Bandara InJourney Airports Terdampak Erupsi Gunung Anak Krakatau, 459 Penerbangan Dibatalkan",
    "Meluas hingga 290 Hektar Karhutla Semeru Hanguskan Vegetasi Jalur Pendakian",
    "Pascaerupsi Gunung Sinabung, PVMBG Imbau Masyarakat Jauhi Kawasan Rawan Bencana",
    "[HEADLINE NEWS, 02/09] Gunung Sinabung Masih Siaga Zona Bahaya Diperluas MetroTV",
    "Tingkat Kewaspadaan, Erupsi Gunung Merapi Berbarengan | Pagi-Pagi Seru",
]

# Colloquial / informal register: slang and abbreviations, also thin on
# formal function words. Morphology alone did not rescue these.
INDONESIAN_COLLOQUIAL = [
    "Gunung anak Krakatau erupsi lagi, semoga tdk terjadi tsunami",
    "ANAK KRAKATAU ERUPSI LAGI! Gunung Anak Krakatau kembali menunjukkan aktivitas erupsi.",
    "Info Gempa :: M3.4, 20-07-2026 09:25:29 WIB, Lokasi : 2.82 LU - 98.84 BT, Kedalaman 10 Km",
    "Update Tinggi Muka Air. Minggu, 06 September 2026 Pukul 11.00 WIB, siaga tiga",
    "Siapa sangka Roberto Carlos mualaf njir... Mashaallah brother, semoga hidupmu berkah",
]

# Genuinely foreign Latin-script posts — these SHOULD still be gated.
FOREIGN_LATIN = [
    "This is a completely English post about the weather and it has nothing "
    "to do with the region at all, just some words that go on for a while.",
    "I have been waiting for this movie to come out for such a long time and "
    "now that it is here I am not sure what I should be feeling about it.",
]


@pytest.mark.parametrize("text", INDONESIAN_HEADLINES)
def test_indonesian_headline_register_is_not_gated(text: str) -> None:
    """audit#149: headline register carries no function words but is Indonesian."""
    assert gate(text) is False, f"wrongly gated as foreign: {text!r}"


@pytest.mark.parametrize("text", INDONESIAN_COLLOQUIAL)
def test_indonesian_colloquial_register_is_not_gated(text: str) -> None:
    assert gate(text) is False, f"wrongly gated as foreign: {text!r}"


@pytest.mark.parametrize("text", FOREIGN_LATIN)
def test_english_is_still_gated(text: str) -> None:
    """The gate must keep doing its job — this is why it exists."""
    assert gate(text) is True, f"failed to gate obvious English: {text!r}"


def test_non_latin_script_still_gated() -> None:
    """Pathway 1 is unchanged by the audit#149 fix."""
    assert gate("यह पूरी तरह से हिंदी में लिखा गया एक पोस्ट है और इसमें कुछ और नहीं है") is True
    assert gate("这是一篇完全用中文写成的帖子，里面没有任何其他语言的内容存在") is True


def test_short_and_handle_only_posts_unchanged() -> None:
    assert gate("") is False
    assert gate("halo") is False  # <20 chars -> classifier decides
    assert gate("@aaa @bbb @ccc @ddd @eee @fff @ggg @hhh") is True  # handles only


def test_absence_of_indonesian_alone_does_not_gate() -> None:
    """The core regression: no Indonesian marker AND no English evidence
    must NOT gate. Pathway 2 previously returned True here."""
    # Proper nouns and numbers only — foreign-looking but no English evidence.
    assert gate("Sinabung Merapi Semeru Krakatau Rinjani Bromo Kerinci Agung") is False
