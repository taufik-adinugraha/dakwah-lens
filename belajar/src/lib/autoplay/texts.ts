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
import type { AutoplayTexts } from "./types";

export const ID_TEXTS: AutoplayTexts = {
  intro: ({ surah, ayah, total }) => `${surah}, ayat ${ayah} dari ${total}. Dengarkan, dan perhatikan layar.`,
  recite: "Dengarkan imam membacakan ayat ini. Kata yang sedang dibaca ditandai.",
  wordIntro: ({ n, translit }) => `Kata ke-${n}: ${translit}. Dengarkan imam membacanya.`,
  meaning: ({ n, gloss }) => `Kata ke-${n} artinya “${gloss}”.`,
  structure: (summary) => `Susunan kalimat ayat ini: ${summary}`,
  structureBrief: "Susunan kalimat ayat ini dijelaskan di bagian Pelajari lebih dalam.",
  concept: (title, summary) => `Konsep baru — ${title}: ${summary}`,
  conceptBrief: (title) => `Konsep baru — ${title}. Penjelasannya ada di bagian Pelajari lebih dalam.`,
  exercise: {
    "tap-word": {
      intro: "Latihan: Dengar dan klik. Imam membacakan satu kata dari ayat ini, lalu Anda mengklik kata itu.",
      // The lesson's imam recites the word by itself: nothing to tap yet.
      play: "Dengarkan imam membacakan satu kata dari ayat ini.",
      options: "Sekarang klik kata yang baru saja dibacakan imam.",
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
  // The card beside the caption names the steps (the narration's own lines name them, or a few of
  // a long group); one caption per group of the card.
  lessonMap: {
    new: ({ new: fresh }) => (fresh ? `Di ayat ini ada ${fresh} hal baru. Daftarnya ada di layar.` : "Di ayat ini tidak ada hal baru."),
    learnt: ({ learnt, here }) =>
      `Sebelum ayat ini, kita sudah mempelajari ${learnt} hal. ` +
      (here ? `Yang kita temui lagi di ayat ini ada ${here}; daftarnya ada di layar.` : "Tidak ada yang kita temui lagi di ayat ini."),
    later: ({ later, lanjut }) =>
      [
        later ? `Ada ${later} hal lagi di ayat ini, tetapi baru kita bahas nanti.` : "",
        lanjut ? `${later ? "Ada juga" : "Di ayat ini ada"} ${lanjut} hal tingkat lanjut, yang tidak kita bahas di tingkat dasar.` : "",
      ]
        .filter(Boolean)
        .join(" "),
  },
  learned: ({ new: fresh, total, here }) =>
    fresh
      ? `Di ayat ini kita mempelajari ${fresh} hal baru. Dengan itu, sudah ${total} hal yang kita pelajari.`
      : here
        ? `Di ayat ini tidak ada hal baru; kita mengulang ${here} hal yang sudah kita pelajari.`
        : "Di ayat ini tidak ada hal baru.",
  recap: "Dengarkan sekali lagi seluruh ayatnya, dan ikuti bacaan imam.",
  next: ({ ayah }) => `Pelajaran ayat ini selesai. Berikutnya, ayat ${ayah}.`,
  done: ({ surah }) => `Pelajaran ayat ini selesai. Ini ayat terakhir surah ${surah}.`,
  // Short on purpose: the card beside it shows the word, its transliteration and its meaning, and
  // a beat lasts at least its caption's reading time (25 beats in Al-Fatihah).
  example: {
    word: ({ n, translit }) => `Contoh: kata ke-${n}, ${translit}.`,
    other: ({ translit, surah, ayah }) => `Contoh lain: ${translit}, di QS ${surah}:${ayah}.`,
    base: ({ translit, surah, ayah }) => `Contoh: ${translit}, di QS ${surah}:${ayah}.`,
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
      play: "Dengarkan imam",
      options: "Pilih salah satu",
      words: "1. Pilih kata",
      bins: "2. Pilih kelompok",
      reveal: "Atau lihat jawaban",
      next: "Klik untuk lanjut",
    },
  },
};
