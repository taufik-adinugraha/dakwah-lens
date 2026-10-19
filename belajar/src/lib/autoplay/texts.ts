/**
 * Default Indonesian captions of the autoplay lesson (ON-SCREEN text), used
 * where a line has no narration display text (content/narration/*.json).
 *
 * Plain Indonesian for adults ("Anda"), sentence case, no ALL CAPS, no
 * Arabic script. Captions may show digits and Latin transliteration (the
 * word currently recited); the SPOKEN narration is written separately in
 * content/narration/*.json. Every control is "klik" (operator, 2026-10-10:
 * never "ketuk"), as in the narration. Nothing here promises a human review
 * (plan L11), and nothing claims more than is true however the learner got
 * here.
 */
import { mapLaterWhere, mapListId, mapPronounId, type MapKindsSaid, type MapLaterName } from "./lessonMap";
import type { AutoplayTexts } from "./types";

/** The sentence about the steps here and taught later, as the narration words it
 *  (build_narration.py map_later): every one named; one ayah of this surah for all ("…, tetapi
 *  baru akan diajarkan lebih lengkap di ayat 3."), several ("…: alif lam di ayat 3, na’t di ayat 3,
 *  dan idhafah di ayat 4."), or one taught elsewhere ("…, tetapi baru akan diajarkan lebih lengkap
 *  nanti."; operator 2026-10-17, until then "baru kita bahas …"). */
function laterId(later: readonly MapLaterName[]): string {
  const lead = `Ada ${later.length} hal lagi di ayat ini`;
  const names = mapListId(later.map((x) => x.name));
  const where = mapLaterWhere(later);
  if (where === null) return `${lead}, yaitu ${names}, tetapi baru akan diajarkan lebih lengkap nanti.`;
  if (where !== "each") return `${lead}, yaitu ${names}, tetapi baru akan diajarkan lebih lengkap di ayat ${where}.`;
  return `${lead}, tetapi baru akan diajarkan lebih lengkap nanti: ${mapListId(later.map((x) => `${x.name} di ayat ${x.ayah}`))}.`;
}

/** After a list of the steps met here, when the ayah has fewer than all three kinds of word
 *  (pipeline/lessonmap.py KINDS_SENTENCE; operator 2026-10-18). */
const kindsId = (k: MapKindsSaid | null | undefined) => (k && Array.isArray(k.kinds) ? ` Dari ${k.step} itu, di ayat ini hanya ada ${mapListId(k.kinds)}.` : "");

export const ID_TEXTS: AutoplayTexts = {
  intro: ({ surah, ayah, total }) => `${surah}, ayat ${ayah} dari ${total}. Dengarkan, dan perhatikan layar.`,
  recite: "Dengarkan imam membacakan ayat ini. Kata yang sedang dibaca ditandai.",
  // A word heard on its own is the narrator's recording of it, never the imam's (operator 2026-10-14).
  wordIntro: ({ n, translit }) => `Kata ke-${n}: ${translit}. Dengarkan kata ini.`,
  meaning: ({ n, gloss }) => `Kata ke-${n} artinya “${gloss}”.`,
  structure: (summary) => `Susunan kalimat ayat ini: ${summary}`,
  // As the narration opens it (pipeline/validate_narration.py STRUCTURE_LEAD).
  structureItems: (item) => `Sekarang susunan kalimatnya. ${item}`,
  structureBrief: "Susunan kalimat ayat ini dijelaskan di bagian Pelajari lebih dalam.",
  concept: (title, summary) => `Konsep baru — ${title}: ${summary}`,
  conceptBrief: (title) => `Konsep baru — ${title}. Penjelasannya ada di bagian Pelajari lebih dalam.`,
  exercise: {
    "word-kind": {
      intro: "Pemanasan: isim, fi'il, atau huruf? Tebak dulu jenis setiap kata di ayat ini.",
      options: "Klik salah satu jenis yang ditandai.",
      reveal: "Coba pilih lagi, atau klik “Tunjukkan jawaban” yang ditandai.",
      next: "Klik tombol yang ditandai untuk melanjutkan.",
    },
    "tap-word": {
      intro: "Latihan: Dengar dan klik. Satu kata dari ayat ini dibacakan, lalu Anda mengklik kata itu.",
      // The lesson plays the word by itself (the narrator's recording of it): nothing to tap yet.
      play: "Dengarkan satu kata dari ayat ini.",
      options: "Sekarang klik kata yang baru saja dibacakan.",
      reveal: "Coba pilih lagi, atau klik “Tunjukkan jawaban” yang ditandai.",
      // Only in "Tunggu saya": otherwise the next question comes by itself.
      next: "Klik tombol yang ditandai untuk melanjutkan.",
    },
    "why-harakat": {
      intro: "Latihan: Kenapa harakat ini? Pilih alasan yang membuat akhir kata dibaca seperti itu.",
      options: "Klik salah satu alasan yang ditandai.",
      reveal: "Coba pilih lagi, atau klik “Tunjukkan jawaban” yang ditandai.",
      next: "Klik tombol yang ditandai untuk melanjutkan.",
    },
    "sort-case": {
      intro: "Latihan: Kelompokkan menurut akhiran. Setiap kata dimasukkan ke kelompok akhirannya.",
      words: "Klik dulu satu kata yang ditandai.",
      bins: "Lalu klik kelompok akhiran yang cocok untuk kata itu.",
      reveal: "Coba kelompok lain, atau klik “Tunjukkan jawaban” yang ditandai.",
    },
    "label-role": {
      intro: "Latihan: Tebak peran kata. Pilih peran setiap kata dalam kalimat ayat ini.",
      options: "Klik salah satu peran yang ditandai.",
      reveal: "Coba pilih lagi, atau klik “Tunjukkan jawaban” yang ditandai.",
      next: "Klik tombol yang ditandai untuk melanjutkan.",
    },
    "wazn-factory": {
      intro: "Latihan: Bentuk-bentuk kata. Pilih bentuk kata yang sesuai dengan namanya.",
      options: "Klik salah satu bentuk kata yang ditandai.",
      reveal: "Coba pilih lagi, atau klik “Tunjukkan jawaban” yang ditandai.",
      next: "Klik tombol yang ditandai untuk melanjutkan.",
    },
  },
  // One caption per line of the lesson map (lessonMap.ts MAP_LINES), in the narration's own
  // templates (pipeline/build_narration.py map_new … map_total; README "Peta pelajaran"), with
  // digits for the counts: operator 2026-10-15, every counted step is named, in teaching order
  // ("always re-mention what they are"), and what is put aside is followed by the reassurance.
  // A next-level topic is counted, never named (the card names it).
  lessonMap: {
    new: ({ new: fresh }) => (fresh.length ? `Di ayat ini ada ${fresh.length} hal baru: ${mapListId(fresh)}.` : "Di ayat ini tidak ada hal baru."),
    // The learnt-so-far count is said only in the closing recap (map:total): operator 2026-10-17,
    // "better to remove this line in every ayat beginning" — the learnt step says what comes up again.
    again: ({ again, kinds }) =>
      again.length ? `Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah ${mapListId(again)}.${kindsId(kinds)}` : "Tidak ada yang kita temui lagi di ayat ini.",
    later: ({ later, lanjut }) =>
      [
        later.length ? laterId(later) : "",
        lanjut ? `${later.length ? "Ada juga" : "Di ayat ini ada"} ${lanjut} hal tingkat lanjut, yang tidak kita bahas di tingkat dasar.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    focus: ({ later, lanjut, new: fresh, again, kinds }) =>
      [
        later
          ? `Sekarang Anda tidak perlu menghafal ${mapPronounId(later)}${lanjut ? ", dan tidak perlu memikirkan hal tingkat lanjut tadi" : ""}.`
          : `Sekarang Anda tidak perlu memikirkan ${mapPronounId(lanjut)}.`,
        fresh.length
          ? `Mari kita fokus pada pelajaran ${mapListId(fresh)} terlebih dahulu.`
          : again.length
            ? `Mari kita fokus mengulang ${mapListId(again)} terlebih dahulu.${kindsId(kinds)}`
            : "Mari kita fokus pada ayat ini terlebih dahulu.",
      ].join(" "),
  },
  learned: ({ new: fresh, again, kinds }) =>
    fresh.length
      ? `Di ayat ini kita mempelajari ${fresh.length} hal baru: ${mapListId(fresh)}.`
      : again.length
        ? `Di ayat ini tidak ada hal baru; kita mengulang ${again.length} hal yang sudah kita pelajari, yaitu ${mapListId(again)}.${kindsId(kinds)}`
        : "Di ayat ini tidak ada hal baru.",
  total: ({ total, fresh }) => `${fresh ? "Dengan itu" : "Sampai ayat ini"}, sudah ${total.length} hal yang kita pelajari, yaitu ${mapListId(total)}.`,
  recap: "Dengarkan sekali lagi seluruh ayatnya, dan ikuti bacaan imam.",
  next: ({ ayah }) => `Pelajaran ayat ini selesai. Berikutnya, ayat ${ayah}.`,
  done: ({ surah }) => `Pelajaran ayat ini selesai. Ini ayat terakhir surah ${surah}.`,
  // As the narration says them (pipeline/build_narration.py ZERO_INTRO, ZERO_NEXT).
  zeroIntro: ({ surah }) =>
    `Ini pelajaran pengantar, sebelum kita belajar Surah ${surah}. Ada dua hal yang kita kenali di sini: harakat, lalu tiga jenis kata dalam bahasa Arab.`,
  zeroNext: ({ surah }) => `Pelajaran pengantar selesai. Berikutnya ayat pertama Surah ${surah}; pelajaran berlanjut sendiri.`,
  // Short on purpose: the card beside it shows the word, its transliteration and its meaning, and
  // a beat lasts at least its caption's reading time (25 beats in Al-Fatihah).
  example: {
    word: ({ n, translit }) => `Contoh: kata ke-${n}, ${translit}.`,
    other: ({ translit, surah, ayah }) => `Contoh lain: ${translit}, di QS ${surah}:${ayah}.`,
    // Lesson zero has no ayah, so its examples are not "another" one, and the card cites the
    // place: the caption says what the word is an example OF (the record's note).
    zero: ({ translit, about }) => `Contoh — ${translit}: ${about}`,
    base: ({ translit, surah, ayah }) => `Contoh: ${translit}, di QS ${surah}:${ayah}.`,
    form: ({ translit }) => `Contoh bentuk dasar: ${translit}.`,
    // What is heard where it is not what is written, as the Konsep pages say it beside an
    // example's button (messages Clip.waqf_note, washal_note).
    waqf: "Di akhir ayat imam berhenti, jadi harakat akhirnya tidak terdengar.",
    washal: ({ heard }) => `Bersama kata sebelumnya terdengar “${heard}”, karena alif di awalnya tidak dibaca.`,
  },
  shared: {
    start: "Pelajaran dimulai. Anda cukup mendengarkan dan memperhatikan layar; saat ada latihan, Anda akan dipandu.",
    resume: "Kita lanjutkan.",
    correct: "Benar.",
    revealed: "Ini jawabannya.",
    reminder: "Silakan dicoba, tidak perlu terburu-buru.",
    skip_offer: "Jika ingin melanjutkan tanpa latihan ini, klik “Lewati latihan”.",
    surah_done: "Pilihan berikutnya ada di layar.",
  },
  guide: {
    mushafLine: "Ayat yang dibacakan",
    mushafWord: (n) => `Kata ke-${n}`,
    wordCard: "Kata ini",
    skip: "Lewati latihan",
    lanjut: "Klik Lanjut",
    part: {
      play: "Dengarkan kata",
      options: "Pilih salah satu",
      words: "1. Pilih kata",
      bins: "2. Pilih kelompok",
      reveal: "Atau lihat jawaban",
      next: "Klik untuk lanjut",
    },
  },
};
