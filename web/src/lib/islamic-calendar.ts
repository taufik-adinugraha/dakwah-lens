/**
 * Hijri-calendar awareness for the user-facing brief generator (mirrors
 * `api/src/api/services/islamic_calendar.py`).
 *
 * The Insights pipeline (Python) injects today's Hijri date + a
 * 7-14-day lookahead of curated Islamic events into the Pro synthesis
 * prompt so the brief leans on TIMELY sunnah/du'a rather than the
 * LLM's parametric memory. This module is the TypeScript port for the
 * on-demand /briefs/new generator.
 *
 * Hijri conversion uses Node's built-in `Intl` with the
 * `islamic-umalqura` calendar (V8/ICU-backed). Zero external deps.
 *
 * Manhaj-contested events (Mawlid, Isra Mi'raj, Nisfu Sya'ban) are
 * intentionally omitted per AGENTS.md sharia-compliance rule "no
 * divisive / sectarian messaging".
 */

export const HIJRI_MONTH_NAMES_ID: Record<number, string> = {
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
};

export type HijriDate = {
  year: number;
  /** 1-indexed. */
  month: number;
  /** 1-indexed. */
  day: number;
  monthNameId: string;
  gregorian: Date;
};

export type HijriEvent = {
  month: number;
  dayStart: number;
  /** null for single-day events. */
  dayEnd: number | null;
  nameId: string;
  sunnahHint: string;
  duaHint: string;
};

const EVENT_REGISTRY: HijriEvent[] = [
  // Dzulhijjah
  {
    month: 12,
    dayStart: 1,
    dayEnd: 7,
    nameId: "10 hari awal Dzulhijjah (hari-hari paling dicintai Allah)",
    sunnahHint:
      "puasa sunnah 1-9 Dzulhijjah, perbanyak dzikir (takbir, tahlil, tahmid), sedekah, tilawah Al-Qur'an, qiyamul lail (HR. Bukhari 969).",
    duaHint:
      "dzikir 10 hari Dzulhijjah: Allahu akbar, La ilaha illallah, Alhamdulillah; du'a memohon istiqamah.",
  },
  {
    month: 12,
    dayStart: 8,
    dayEnd: 8,
    nameId: "Yaumut Tarwiyah (8 Dzulhijjah)",
    sunnahHint:
      "puasa Tarwiyah bagi yang tidak berhaji, perbanyak takbir, persiapan menyambut Yaumul Arafah.",
    duaHint: "du'a persiapan Arafah, dzikir takbir/tahlil/tahmid, istighfar.",
  },
  {
    month: 12,
    dayStart: 9,
    dayEnd: 9,
    nameId: "Yaumul Arafah (9 Dzulhijjah)",
    sunnahHint:
      "puasa Arafah bagi yang tidak berhaji — menghapus dosa setahun lalu dan setahun mendatang (HR. Muslim 1162). Perbanyak du'a, dzikir, istighfar.",
    duaHint:
      "du'a terbaik di hari Arafah: La ilaha illallah wahdahu la sharika lah (HR. Tirmidzi 3585).",
  },
  {
    month: 12,
    dayStart: 10,
    dayEnd: 10,
    nameId: "Idul Adha (10 Dzulhijjah)",
    sunnahHint:
      "sholat Idul Adha berjamaah, takbir muqayyad Subuh Arafah-Ashar 13 Dzulhijjah, qurban bagi yang mampu, makan setelah sholat Id. DILARANG puasa.",
    duaHint: "lafadz takbir Idul Adha di masjid, di jalan, di rumah.",
  },
  {
    month: 12,
    dayStart: 11,
    dayEnd: 13,
    nameId: "Hari Tasyriq (11-13 Dzulhijjah)",
    sunnahHint:
      "lanjutkan takbir muqayyad setelah sholat fardhu, makan dan minum (DILARANG puasa Tasyriq — HR. Muslim 1141), sembelih qurban masih sah.",
    duaHint:
      "du'a Rabbana atina (QS. Al-Baqarah 201) — du'a yang paling sering Nabi baca pada hari Tasyriq.",
  },
  // Muharram
  {
    month: 1,
    dayStart: 1,
    dayEnd: 1,
    nameId: "Tahun Baru Hijriah (1 Muharram)",
    sunnahHint:
      "muhasabah diri, niat memperbarui ibadah, sedekah. Tidak ada ibadah khusus yang muakkad — fokus pada muhasabah.",
    duaHint:
      "du'a umum istighfar + memohon keberkahan tahun baru; doa Nabi Ibrahim QS. Asy-Syu'ara 83-87.",
  },
  {
    month: 1,
    dayStart: 9,
    dayEnd: 9,
    nameId: "Hari Tasu'a (9 Muharram)",
    sunnahHint:
      "puasa Tasu'a — disunnahkan Nabi ﷺ untuk membedakan dari puasa Yahudi (HR. Muslim 1134).",
    duaHint: "du'a istighfar dan memohon ampunan.",
  },
  {
    month: 1,
    dayStart: 10,
    dayEnd: 10,
    nameId: "Hari Asyura (10 Muharram)",
    sunnahHint:
      "puasa Asyura — menghapus dosa setahun yang lalu (HR. Muslim 1162). Gandeng dengan puasa Tasu'a atau 11 Muharram.",
    duaHint: "Sayyid al-Istighfar (HR. Bukhari 6306).",
  },
  // Ramadhan
  {
    month: 9,
    dayStart: 1,
    dayEnd: 20,
    nameId: "Bulan Ramadhan (paruh pertama hingga pertengahan)",
    sunnahHint:
      "puasa wajib, qiyam Ramadhan (tarawih), tilawah Al-Qur'an, sedekah, menyegerakan berbuka, mengakhirkan sahur.",
    duaHint:
      "du'a berbuka: Dzahabaz zhama'u wabtallatil-'uruq (HR. Abu Dawud 2357).",
  },
  {
    month: 9,
    dayStart: 21,
    dayEnd: 30,
    nameId: "10 Malam Terakhir Ramadhan (mencari Lailatul Qadr)",
    sunnahHint:
      "i'tikaf di masjid, qiyamul lail diperbanyak, tilawah, sedekah. Carilah Lailatul Qadr pada malam ganjil (HR. Bukhari 2024).",
    duaHint:
      "du'a Lailatul Qadr (HR. Tirmidzi 3513): Allahumma innaka 'afuwwun tuhibbul 'afwa fa'fu 'anni.",
  },
  // Syawal
  {
    month: 10,
    dayStart: 1,
    dayEnd: 1,
    nameId: "Idul Fitri (1 Syawal)",
    sunnahHint:
      "sholat Id berjamaah, takbir mursal sejak terbenam akhir Ramadhan hingga sholat Id, makan kurma ganjil sebelum sholat (HR. Bukhari 953), saling mengucapkan taqabbalallahu minna wa minkum.",
    duaHint: "ucapan Id antar Muslim: Taqabbalallahu minna wa minkum.",
  },
  {
    month: 10,
    dayStart: 2,
    dayEnd: 8,
    nameId: "Puasa 6 hari Syawal",
    sunnahHint:
      "puasa 6 hari di bulan Syawal setelah Ramadhan — pahalanya seperti puasa sepanjang tahun (HR. Muslim 1164).",
    duaHint:
      "du'a istiqamah dan diterima ibadah; doa sapu jagat Rabbana atina.",
  },
];

const HIJRI_FORMATTER = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Jakarta",
});

export function getHijriToday(g: Date = new Date()): HijriDate {
  const parts = HIJRI_FORMATTER.formatToParts(g);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  const month = get("month");
  return {
    year: get("year"),
    month,
    day: get("day"),
    monthNameId: HIJRI_MONTH_NAMES_ID[month] ?? "?",
    gregorian: g,
  };
}

function matchEvent(ev: HijriEvent, month: number, day: number): boolean {
  if (ev.month !== month) return false;
  const end = ev.dayEnd ?? ev.dayStart;
  return day >= ev.dayStart && day <= end;
}

export type WindowEvent = {
  hijri: HijriDate;
  daysFromToday: number;
  event: HijriEvent;
};

export function upcomingEvents(
  today: Date,
  lookaheadDays = 10,
): WindowEvent[] {
  const out: WindowEvent[] = [];
  for (let offset = 0; offset <= lookaheadDays; offset++) {
    const g = new Date(today.getTime() + offset * 86_400_000);
    const h = getHijriToday(g);
    for (const ev of EVENT_REGISTRY) {
      if (matchEvent(ev, h.month, h.day)) {
        out.push({ hijri: h, daysFromToday: offset, event: ev });
      }
    }
  }
  return out;
}

const WEEKLY_HINT =
  "Sunnah pekanan (selalu relevan): puasa sunnah Senin dan Kamis, Ayyamul Bidh (13/14/15), sholat Dhuha, qiyamul lail, sedekah Subuh, dzikir pagi-petang (adhkar Hisnul Muslim), Surat Al-Kahfi setiap Jumat.";

/**
 * Build the prompt-ready calendar block + a short bias string for
 * downstream retrieval. Returned shape mirrors the Python version's
 * `(prompt_block, hijri_short_context)` tuple.
 */
export function formatCalendarContext(
  today: Date = new Date(),
  lookaheadDays = 10,
): { promptBlock: string; hijriShort: string } {
  const hToday = getHijriToday(today);
  const events = upcomingEvents(today, lookaheadDays);

  let hijriShort: string;
  if (events.length > 0) {
    const primary = events[0];
    hijriShort = primary.daysFromToday === 0
      ? `bulan ${hToday.monthNameId}; hari ini ${primary.event.nameId}`
      : `bulan ${hToday.monthNameId}; ${primary.daysFromToday} hari menuju ${primary.event.nameId}`;
  } else {
    hijriShort = `bulan ${hToday.monthNameId} (pekan biasa)`;
  }

  const lines: string[] = [
    "KONTEKS KALENDER HIJRIYAH (untuk rekomendasi sunnah/du'a yang TIMELY dalam brief — jika ada event di window ini, prioritaskan amalan terkait):",
    "",
    `- Hari ini (${today.toISOString().slice(0, 10)}) = ${hToday.day} ${hToday.monthNameId} ${hToday.year} H.`,
    `- Lookahead ${lookaheadDays} hari ke depan:`,
  ];

  if (events.length > 0) {
    const seen = new Set<string>();
    for (const we of events) {
      const key = `${we.event.month}-${we.event.dayStart}-${we.event.dayEnd ?? we.event.dayStart}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const whenLabel =
        we.daysFromToday === 0 ? "hari ini" : `+${we.daysFromToday} hari`;
      lines.push(
        `  · ${whenLabel} (${we.hijri.day} ${we.hijri.monthNameId} ${we.hijri.year} H) — ${we.event.nameId}`,
      );
      lines.push(`    Sunnah: ${we.event.sunnahHint}`);
      lines.push(`    Du'a yang relevan: ${we.event.duaHint}`);
    }
  } else {
    lines.push("  · (tidak ada event Hijriyah utama dalam window ini)");
    lines.push(`  · ${WEEKLY_HINT}`);
  }

  return { promptBlock: lines.join("\n"), hijriShort };
}
