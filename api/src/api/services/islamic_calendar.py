"""Hijri-calendar awareness for the briefing synthesis pipeline.

Pesan Flyer 5 (Ajakan Sunnah) and Flyer 6 (Du'a Pekan Ini) are
supposed to surface ibadah sunnah and du'a that are TIMELY for the
week the briefing publishes. Without injecting a real Hijri-date
anchor into the synthesis prompt, the LLM falls back on its
parametric memory of "what month it might be" — which drifts because
Gemini doesn't know today's date and has no Umm al-Qura table.

This module computes:
  * today's Hijri date (Umm al-Qura via `hijridate`),
  * any high-impact events landing in the next N days,
  * a short context string (for biasing adhkar retrieval), and
  * a formatted prompt block (for the Pro synthesis call).

Only universally-agreed sunnah events are listed. Manhaj-contested
events (Mawlid, Isra Mi'raj, Nisfu Sya'ban) are intentionally
omitted — per AGENTS.md sharia-compliance rule "no divisive /
sectarian messaging". When no curated event lands inside the
window, we still surface today's Hijri month + the always-on weekly
sunnah hints (Senin/Kamis, Ayyamul Bidh).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from hijridate import Gregorian

# Hijri month names in Bahasa Indonesia (1-indexed). Kept here rather
# than relying on `hijridate.month_name()` so the LLM sees the spelling
# Indonesian readers expect ("Dzulhijjah" vs "Dhu al-Hijjah").
HIJRI_MONTH_NAMES_ID: dict[int, str] = {
    1: "Muharram",
    2: "Safar",
    3: "Rabi'ul Awwal",
    4: "Rabi'ul Akhir",
    5: "Jumadil Awwal",
    6: "Jumadil Akhir",
    7: "Rajab",
    8: "Sya'ban",
    9: "Ramadhan",
    10: "Syawal",
    11: "Dzulqa'dah",
    12: "Dzulhijjah",
}


@dataclass(frozen=True)
class HijriEvent:
    """A curated Islamic event the briefing should consider.

    `match` returns True when `(h_month, h_day)` is inside the event
    window. Events with `day_end` cover a range (e.g. Tasyriq 11-13);
    single-day events leave `day_end=None`.
    """

    month: int
    day_start: int
    day_end: int | None
    name_id: str
    sunnah_hint: str
    dua_hint: str

    def match(self, h_month: int, h_day: int) -> bool:
        if h_month != self.month:
            return False
        end = self.day_end if self.day_end is not None else self.day_start
        return self.day_start <= h_day <= end


# Curated registry — kept tight to universally-agreed Sunni mainstream
# practices. Each entry carries the prompt-facing sunnah + du'a hint so
# the LLM gets concrete handles to write Pesan Flyer 5 + 6 against,
# rather than re-deriving them from memory.
EVENT_REGISTRY: tuple[HijriEvent, ...] = (
    # ── Dzulhijjah ────────────────────────────────────────────────
    HijriEvent(
        month=12,
        day_start=1,
        day_end=7,
        name_id="10 hari awal Dzulhijjah (hari-hari paling dicintai Allah)",
        sunnah_hint=(
            "puasa sunnah 1-9 Dzulhijjah, perbanyak dzikir (takbir, tahlil, "
            "tahmid), sedekah, tilawah Al-Qur'an, qiyamul lail. Hadits: "
            "'Tidak ada hari di mana amal sholeh lebih dicintai Allah "
            "selain pada sepuluh hari ini' (HR. Bukhari 969)."
        ),
        dua_hint=(
            "dzikir 10 hari Dzulhijjah: تَكْبِير / تَهْلِيل / تَحْمِيد "
            "(Allahu akbar, La ilaha illallah, Alhamdulillah); du'a "
            "memohon istiqamah dan diterima ibadah."
        ),
    ),
    HijriEvent(
        month=12,
        day_start=8,
        day_end=8,
        name_id="Yaumut Tarwiyah (8 Dzulhijjah)",
        sunnah_hint=(
            "puasa Tarwiyah bagi yang tidak berhaji, perbanyak takbir, "
            "persiapan menyambut Yaumul Arafah."
        ),
        dua_hint=(
            "du'a persiapan Arafah, dzikir takbir / tahlil / tahmid, "
            "istighfar."
        ),
    ),
    HijriEvent(
        month=12,
        day_start=9,
        day_end=9,
        name_id="Yaumul Arafah (9 Dzulhijjah)",
        sunnah_hint=(
            "puasa Arafah bagi yang tidak berhaji — menghapus dosa setahun "
            "lalu dan setahun mendatang (HR. Muslim 1162). Perbanyak du'a, "
            "dzikir, istighfar — hari di mana du'a paling mustajab."
        ),
        dua_hint=(
            "du'a terbaik di hari Arafah: "
            "لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ "
            "الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ "
            "قَدِيرٌ (HR. Tirmidzi 3585 — sebaik-baik du'a hari Arafah)."
        ),
    ),
    HijriEvent(
        month=12,
        day_start=10,
        day_end=10,
        name_id="Idul Adha (10 Dzulhijjah)",
        sunnah_hint=(
            "sholat Idul Adha berjamaah, takbir muqayyad sejak Subuh "
            "Arafah hingga Ashar 13 Dzulhijjah, qurban (bagi yang mampu) "
            "sebagai sunnah muakkadah, makan setelah sholat Id (bukan "
            "sebelum). DILARANG puasa pada hari ini."
        ),
        dua_hint=(
            "lafadz takbir Idul Adha: اللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ "
            "اللَّهُ أَكْبَرُ، لَا إِلَٰهَ إِلَّا اللَّهُ، وَاللَّهُ "
            "أَكْبَرُ اللَّهُ أَكْبَرُ، وَلِلَّهِ الْحَمْدُ — di"
            " masjid, di jalan, di rumah."
        ),
    ),
    HijriEvent(
        month=12,
        day_start=11,
        day_end=13,
        name_id="Hari Tasyriq (11-13 Dzulhijjah)",
        sunnah_hint=(
            "lanjutkan takbir muqayyad setelah sholat fardhu, makan dan "
            "minum (DILARANG puasa pada hari Tasyriq — HR. Muslim 1141), "
            "sembelih qurban masih sah pada hari-hari ini."
        ),
        dua_hint=(
            "du'a Rabbana atina (QS. Al-Baqarah 201) — du'a yang paling "
            "sering dibaca Nabi pada hari Tasyriq: "
            "رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ "
            "حَسَنَةً وَقِنَا عَذَابَ النَّارِ."
        ),
    ),
    # ── Muharram ──────────────────────────────────────────────────
    HijriEvent(
        month=1,
        day_start=1,
        day_end=1,
        name_id="Tahun Baru Hijriah (1 Muharram)",
        sunnah_hint=(
            "muhasabah diri, niat memperbarui ibadah, sedekah, doa awal "
            "tahun. Tidak ada ibadah khusus yang muakkad — fokus pada "
            "muhasabah dan tekad untuk istiqamah."
        ),
        dua_hint=(
            "du'a awal dan akhir tahun (banyak dirawi tanpa sanad shahih "
            "yang kuat — disarankan du'a umum istighfar + memohon "
            "keberkahan tahun baru); doa Nabi Ibrahim QS. Asy-Syu'ara 83-87."
        ),
    ),
    HijriEvent(
        month=1,
        day_start=9,
        day_end=9,
        name_id="Hari Tasu'a (9 Muharram)",
        sunnah_hint=(
            "puasa Tasu'a — disunnahkan oleh Nabi ﷺ untuk membedakan dari "
            "puasa Yahudi yang hanya pada 10 Muharram (HR. Muslim 1134)."
        ),
        dua_hint=(
            "du'a umum istighfar dan memohon ampunan; tidak ada du'a "
            "khusus yang shahih untuk Tasu'a."
        ),
    ),
    HijriEvent(
        month=1,
        day_start=10,
        day_end=10,
        name_id="Hari Asyura (10 Muharram)",
        sunnah_hint=(
            "puasa Asyura — menghapus dosa setahun yang lalu (HR. Muslim "
            "1162). Sunnah digandeng dengan puasa Tasu'a (9 Muharram) atau "
            "11 Muharram untuk membedakan dari praktik Yahudi."
        ),
        dua_hint=(
            "du'a memohon ampunan dan rahmat Allah; lafal istighfar Nabi: "
            "اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَٰهَ إِلَّا أَنْتَ خَلَقْتَنِي "
            "وَأَنَا عَبْدُكَ (Sayyid al-Istighfar — HR. Bukhari 6306)."
        ),
    ),
    # ── Ramadhan ──────────────────────────────────────────────────
    HijriEvent(
        month=9,
        day_start=1,
        day_end=20,
        name_id="Bulan Ramadhan (paruh pertama hingga pertengahan)",
        sunnah_hint=(
            "puasa wajib, qiyam Ramadhan (tarawih), tilawah Al-Qur'an, "
            "sedekah dilipatgandakan, menyegerakan berbuka, mengakhirkan "
            "sahur."
        ),
        dua_hint=(
            "du'a berbuka: ذَهَبَ الظَّمَأُ وَابْتَلَّتِ الْعُرُوقُ "
            "وَثَبَتَ الْأَجْرُ إِنْ شَاءَ اللَّهُ (HR. Abu Dawud 2357); "
            "du'a memohon ampunan dan keberkahan."
        ),
    ),
    HijriEvent(
        month=9,
        day_start=21,
        day_end=30,
        name_id="10 Malam Terakhir Ramadhan (mencari Lailatul Qadr)",
        sunnah_hint=(
            "i'tikaf di masjid, qiyamul lail diperbanyak, tilawah Al-"
            "Qur'an, sedekah. Nabi ﷺ mengencangkan ikat pinggangnya pada "
            "10 malam terakhir (HR. Bukhari 2024). Carilah Lailatul Qadr "
            "pada malam ganjil."
        ),
        dua_hint=(
            "du'a Lailatul Qadr (HR. Tirmidzi 3513): "
            "اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي."
        ),
    ),
    # ── Syawal ────────────────────────────────────────────────────
    HijriEvent(
        month=10,
        day_start=1,
        day_end=1,
        name_id="Idul Fitri (1 Syawal)",
        sunnah_hint=(
            "sholat Id berjamaah, takbir mursal sejak terbenam matahari "
            "akhir Ramadhan hingga sholat Id, makan kurma ganjil sebelum "
            "berangkat sholat (HR. Bukhari 953), saling mengucapkan "
            "تَقَبَّلَ اللَّهُ مِنَّا وَمِنْكُمْ."
        ),
        dua_hint=(
            "ucapan Id antar Muslim: تَقَبَّلَ اللَّهُ مِنَّا وَمِنْكُمْ "
            "(Semoga Allah menerima [amal] kami dan kalian) — diriwayatkan "
            "dari para sahabat."
        ),
    ),
    HijriEvent(
        month=10,
        day_start=2,
        day_end=8,
        name_id="Puasa 6 hari Syawal",
        sunnah_hint=(
            "puasa 6 hari di bulan Syawal setelah Ramadhan — pahalanya "
            "seperti puasa sepanjang tahun (HR. Muslim 1164). Boleh "
            "berturut-turut atau terpisah selama masih di bulan Syawal."
        ),
        dua_hint=(
            "du'a istiqamah dan diterima ibadah; doa sapu jagat (Rabbana "
            "atina) yang biasa dibaca Nabi setelah puasa."
        ),
    ),
)


@dataclass(frozen=True)
class HijriToday:
    year: int
    month: int
    day: int
    month_name_id: str
    gregorian: date

    @property
    def label_id(self) -> str:
        return f"{self.day} {self.month_name_id} {self.year} H"


def get_hijri_today(g_date: date) -> HijriToday:
    """Convert a Gregorian date to its Umm al-Qura Hijri counterpart."""
    h = Gregorian(g_date.year, g_date.month, g_date.day).to_hijri()
    return HijriToday(
        year=h.year,
        month=h.month,
        day=h.day,
        month_name_id=HIJRI_MONTH_NAMES_ID[h.month],
        gregorian=g_date,
    )


@dataclass(frozen=True)
class WindowEvent:
    """An event that lands inside the lookahead window."""

    hijri: HijriToday
    days_from_today: int  # 0 = today
    event: HijriEvent


def upcoming_events(
    today: date,
    lookahead_days: int = 10,
) -> list[WindowEvent]:
    """Walk `today + 0..lookahead_days` (inclusive) and collect every
    event whose curated registry entry matches that Hijri date.

    An event-day with multiple matches (e.g. 9 Dzulhijjah falls inside
    BOTH "10 hari awal Dzulhijjah" and "Yaumul Arafah") returns both —
    the synthesis prompt benefits from seeing the layered context.
    """
    out: list[WindowEvent] = []
    for offset in range(lookahead_days + 1):
        g = today + timedelta(days=offset)
        h = get_hijri_today(g)
        for ev in EVENT_REGISTRY:
            if ev.match(h.month, h.day):
                out.append(
                    WindowEvent(hijri=h, days_from_today=offset, event=ev),
                )
    return out


def _always_on_weekly_hint(today: date) -> str:
    """Hints that apply EVERY week regardless of Hijri date — folded
    into the prompt when no high-impact event lands in the window so
    Pesan Flyer 5 still has concrete sunnah handles to write against.
    """
    return (
        "Sunnah pekanan (selalu relevan): puasa sunnah Senin dan Kamis, "
        "Ayyamul Bidh (puasa 13/14/15 bulan Hijriyah), sholat Dhuha, "
        "qiyamul lail, sedekah Subuh, dzikir pagi-petang (adhkar Hisnul "
        "Muslim), membaca Surat Al-Kahfi setiap Jumat."
    )


def format_calendar_context(
    today: date,
    lookahead_days: int = 10,
) -> tuple[str, str]:
    """Build the prompt block + short retrieval-bias string.

    Returns:
      (prompt_block, hijri_short_context)

    `prompt_block` is a multi-line markdown-ish block dropped into the
    user prompt near the top, so the LLM reads it BEFORE tackling
    Pesan Flyer 5 + 6.

    `hijri_short_context` is a one-line summary fed to `retrieve_dua`
    as `hijri_context=` — biases the embedding query so the adhkar
    pool includes seasonal du'a (e.g. du'a Arafah when Arafah is in
    the window).
    """
    h_today = get_hijri_today(today)
    events = upcoming_events(today, lookahead_days)

    # ── short retrieval-bias string ───────────────────────────────
    if events:
        # Use the soonest non-zero-day event name when today is plain,
        # else lead with today's event.
        primary = events[0]
        if primary.days_from_today == 0:
            short = f"hari ini {primary.event.name_id}"
        else:
            short = (
                f"{primary.days_from_today} hari menuju "
                f"{primary.event.name_id}"
            )
        # Layer in today's Hijri month so retrieval also sees the
        # raw calendar context (e.g. "bulan Dzulhijjah").
        short = f"bulan {h_today.month_name_id}; {short}"
    else:
        short = f"bulan {h_today.month_name_id} (pekan biasa)"

    # ── prompt block ──────────────────────────────────────────────
    lines: list[str] = [
        "KONTEKS KALENDER HIJRIYAH (untuk Pesan Flyer 5 — Ajakan Sunnah "
        "dan Pesan Flyer 6 — Doa Pekan Ini):",
        "",
        f"- Hari ini ({today.isoformat()}) = {h_today.label_id}.",
        f"- Lookahead {lookahead_days} hari ke depan:",
    ]

    if events:
        # Group by event so the same event spanning multiple days
        # (e.g. Tasyriq 11-13) renders once with its range.
        seen: set[tuple[int, int, int]] = set()
        for we in events:
            ev_key = (we.event.month, we.event.day_start, we.event.day_end or we.event.day_start)
            if ev_key in seen:
                continue
            seen.add(ev_key)
            when_label = (
                "hari ini"
                if we.days_from_today == 0
                else f"+{we.days_from_today} hari"
            )
            lines.append(
                f"  · {when_label} ({we.hijri.label_id}) — {we.event.name_id}"
            )
            lines.append(f"    Sunnah: {we.event.sunnah_hint}")
            lines.append(f"    Du'a yang relevan: {we.event.dua_hint}")
    else:
        lines.append("  · (tidak ada event Hijriyah utama dalam window ini)")
        lines.append(f"  · {_always_on_weekly_hint(today)}")

    lines.extend(
        [
            "",
            "INSTRUKSI: Pesan Flyer 5 (Ajakan Sunnah) HARUS menyebut sunnah "
            "yang TIMELY dengan event di atas — jangan tulis sunnah generik "
            "kalau ada event spesifik yang jatuh di window ini. Pesan Flyer "
            "6 (Doa Pekan Ini) HARUS pilih du'a yang sesuai konteks event "
            "tersebut. Ambil daleel dari ADHKAR POOL di bawah; kalau tidak "
            "ada entri yang persis cocok, sebutkan citation lengkap pada "
            "paragraf dan boleh kosongkan marker **Dalil:**.",
        ]
    )

    return "\n".join(lines), short
