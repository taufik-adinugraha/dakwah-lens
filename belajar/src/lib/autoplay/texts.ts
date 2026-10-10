/**
 * Default Indonesian captions of the autoplay lesson (ON-SCREEN text).
 *
 * Plain Indonesian for adults ("Anda"), sentence case, no ALL CAPS, no
 * Arabic script. Captions may show digits and Latin transliteration (the
 * word currently recited); the SPOKEN narration is written separately in
 * content/narration/*.json and carries neither. Every control is "ketuk"
 * (tap), as in the narration. Nothing here promises a human review (plan
 * L11), and nothing claims more than is true however the learner got here.
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
      intro: "Latihan: Dengar dan ketuk. Imam membacakan satu kata dari ayat ini, lalu Anda mengetuk kata itu.",
      // The lesson's imam recites the word by itself: nothing to tap yet.
      play: "Dengarkan imam membacakan satu kata dari ayat ini.",
      options: "Sekarang ketuk kata yang baru saja dibacakan imam.",
      reveal: "Coba pilih lagi, atau ketuk “Tunjukkan jawaban” yang ditandai.",
      // Only in "Tunggu saya": otherwise the next question comes by itself.
      next: "Ketuk tombol yang ditandai untuk melanjutkan.",
    },
    "why-harakat": {
      intro: "Latihan: Kenapa harakat ini? Pilih alasan yang membuat akhir kata dibaca seperti itu.",
      options: "Ketuk salah satu alasan yang ditandai.",
      reveal: "Coba pilih lagi, atau ketuk “Tunjukkan jawaban” yang ditandai.",
      next: "Ketuk tombol yang ditandai untuk melanjutkan.",
    },
    "sort-case": {
      intro: "Latihan: Kelompokkan menurut akhiran. Setiap kata dimasukkan ke kelompok akhirannya.",
      words: "Ketuk dulu satu kata yang ditandai.",
      bins: "Lalu ketuk kelompok akhiran yang cocok untuk kata itu.",
      reveal: "Coba kelompok lain, atau ketuk “Tunjukkan jawaban” yang ditandai.",
    },
    "label-role": {
      intro: "Latihan: Tebak peran kata. Pilih peran setiap kata dalam kalimat ayat ini.",
      options: "Ketuk salah satu peran yang ditandai.",
      reveal: "Coba pilih lagi, atau ketuk “Tunjukkan jawaban” yang ditandai.",
      next: "Ketuk tombol yang ditandai untuk melanjutkan.",
    },
    "wazn-factory": {
      intro: "Latihan: Bentuk-bentuk kata. Pilih bentuk kata yang sesuai dengan namanya.",
      options: "Ketuk salah satu bentuk kata yang ditandai.",
      reveal: "Coba pilih lagi, atau ketuk “Tunjukkan jawaban” yang ditandai.",
      next: "Ketuk tombol yang ditandai untuk melanjutkan.",
    },
  },
  recap: "Dengarkan sekali lagi seluruh ayatnya, dan ikuti bacaan imam.",
  next: ({ ayah }) => `Pelajaran ayat ini selesai. Berikutnya, ayat ${ayah}.`,
  done: ({ surah }) => `Pelajaran ayat ini selesai. Ini ayat terakhir surah ${surah}.`,
  shared: {
    start: "Pelajaran dimulai. Anda cukup mendengarkan dan memperhatikan layar; saat ada latihan, Anda akan dipandu.",
    resume: "Kita lanjutkan.",
    correct: "Benar.",
    try_again: "Belum tepat. Silakan coba lagi.",
    revealed: "Ini jawabannya. Perhatikan sebentar.",
    reminder: "Silakan dicoba, tidak perlu terburu-buru.",
    skip_offer: "Jika ingin melanjutkan tanpa latihan ini, ketuk “Lewati latihan”.",
    surah_done: "Pilihan berikutnya ada di layar.",
  },
  guide: {
    mushafLine: "Ayat yang dibacakan",
    mushafWord: (n) => `Kata ke-${n}`,
    wordCard: "Kata ini",
    skip: "Lewati latihan",
    lanjut: "Ketuk Lanjut",
    part: {
      play: "Dengarkan imam",
      options: "Pilih salah satu",
      words: "1. Pilih kata",
      bins: "2. Pilih kelompok",
      reveal: "Atau lihat jawaban",
      next: "Ketuk untuk lanjut",
    },
  },
};
