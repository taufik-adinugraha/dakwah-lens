/**
 * Every data/content source the module uses or plans to use, with the credit
 * line its licence requires. Rendered on /kredit. Single source of truth: the
 * content pipeline (belajar/pipeline/sources.yaml) pins the same entries by
 * version + sha256; keep both in sync when a source is added.
 *
 * Research basis: docs/belajar-research/quran-data.md, kitabs.md, audio.md.
 */
export type Source = {
  name: string;
  role: string;
  licence: string;
  credit: string;
  url: string;
  status: "in_use" | "planned";
};

export const SOURCES: Source[] = [
  {
    name: "Tanzil Quran Text (Uthmani, v1.1)",
    role: "Teks Al-Qur'an (rasm Utsmani, riwayat Hafs)",
    licence: "CC BY 3.0 — salinan verbatim, tanpa perubahan",
    credit: "Tanzil Quran Text — tanzil.net",
    url: "https://tanzil.net/docs/text_license",
    status: "planned",
  },
  {
    name: "Quranic Arabic Corpus 0.4",
    role: "Akar kata, lemma, jenis kata (bahan penyusunan; ditinjau manusia)",
    licence: "GNU GPL; salinan verbatim; wajib menyebut dan menautkan sumber",
    credit: "Quranic Arabic Corpus — corpus.quran.com",
    url: "https://corpus.quran.com",
    status: "planned",
  },
  {
    name: "quran-align (Collin Fair)",
    role: "Penanda waktu per kata pada bacaan qari",
    licence: "CC BY 4.0",
    credit: "Word timings: Collin Fair, quran-align (CC BY 4.0)",
    url: "https://github.com/cpfair/quran-align",
    status: "planned",
  },
  {
    name: "Bacaan Syaikh Mishary Rasyid Alafasy",
    role: "Bacaan imam utama (diputar langsung dari EveryAyah.com, tidak disimpan di server kami)",
    licence: "Diputar dari server penyedia; hak rekaman tetap pada pemiliknya",
    credit: "Recitation: Mishary Rashid Alafasy via EveryAyah.com",
    url: "https://everyayah.com",
    status: "planned",
  },
  {
    name: "Bacaan Syaikh Mahmud Khalil al-Husary (Mu'allim)",
    role: "Bacaan imam untuk mendengar dan menirukan (diputar langsung, tidak disimpan)",
    licence: "Diputar dari server penyedia; hak rekaman tetap pada pemiliknya",
    credit: "Recitation: Mahmoud Khalil Al-Husary (Mu'allim)",
    url: "https://quran.com",
    status: "planned",
  },
  {
    name: "QuranEnc — Terjemahan Indonesia (Kementerian Agama)",
    role: "Terjemahan ayat, dicantumkan persis dengan nama dan versinya",
    licence: "Ketentuan QuranEnc (tanpa perubahan, sebut sumber)",
    credit: "QuranEnc.com",
    url: "https://quranenc.com",
    status: "planned",
  },
  {
    name: "Kitab rujukan i'rab dan tafsir",
    role: "Darwish (I'rab al-Qur'an wa Bayanuh), Safi (al-Jadwal), al-Kharrat (al-Mujtaba), an-Nahhas, as-Samin (ad-Durr al-Mashun), Ibn Katsir, ath-Thabari, Ibnul Jazari (an-Nasyr)",
    licence: "Dikutip seperlunya dan diparafrasekan, dengan rujukan jilid/halaman",
    credit: "Rujukan dicantumkan pada setiap kata dan ayat",
    url: "https://dakwah-lens.id/belajar/id/kredit",
    status: "planned",
  },
];
