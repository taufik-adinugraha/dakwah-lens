import { describe, expect, it } from "vitest";

import {
  clipWords,
  daleelCitations,
  firstSermon,
  khutbahSteps,
  leadParagraph,
  sectionTitle,
  splitCitation,
} from "./khutbah-kultum";

// Shapes lifted from the 2026-10-08 batch (out_*.md), trimmed.
const KHUTBAH_NUMBERED = `#### Khutbah Pertama

إِنَّ الْحَمْدَ لِلّٰهِ، نَحْمَدُهُ وَنَسْتَعِيْنُهُ وَنَسْتَغْفِرُهُ، أَمَّا بَعْدُ.

Ma'asyiral muslimin rahimakumullah, jamaah Jumat yang dimuliakan Allah. Marilah kita buka khutbah siang ini dengan sebuah ayat dari surah Al-Anbiyaa. Allah berfirman:

وَأَيُّوبَ إِذْ نَادَىٰ رَبَّهُۥٓ أَنِّى مَسَّنِىَ ٱلضُّرُّ وَأَنتَ أَرْحَمُ ٱلرَّٰحِمِينَ

**QS. Al-Anbiyaa: 83**

"Dan (ingatlah kisah) Ayub, ketika ia menyeru Tuhannya."

Hadirin, Pertama, ayat ini dibuka dengan seruan, bukan keluhan.

1. **Jenguk satu orang sakit pekan ini.** Pilih satu nama sebelum hari ini berakhir.
2. **Hafalkan doa kesembuhan dan bacakan untuk yang sakit.** Doa yang tercatat dalam Sahih al-Bukhari 5675 tadi pendek.
3. **Kenali tetangga yang sedang sesak atau sakit.** Ketahuilah siapa di sekitar kita.
4. **Jangan menambah asap.** Sepakati bersama di tingkat RT.

#### Khutbah Kedua

اَلْحَمْدُ لِلّٰهِ عَلٰى إِحْسَانِهِ وَالشُّكْرُ لَهُ عَلٰى تَوْفِيْقِهِ وَامْتِنَانِهِ

**QS. Al-Ahzaab: 56**

1. **Langkah palsu dari khutbah kedua.** Tidak boleh terbaca.
`;

const KHUTBAH_ORDINAL = `**Khutbah Pertama**

Di hari Jumat yang mulia ini, marilah kita memperbarui takwa kita kepada Allah Subhanahu wa Ta'ala, takwa yang ikut pulang bersama kita.

Pertama, ayat ini menyebut amanah lebih dulu. Setelah itu disebut wahyu.

Kedua, amanah turun ke akar hati. Ini paparan, bukan langkah.

Ma'asyiral muslimin, dari sebatang jarum sampai sebuah kursi, semuanya kembali kepada ayat pembuka tadi.

Pertama, pakai ujian "rumah ayah dan ibu". Sebelum menerima parsel, tanyakan dulu.

Kedua, pisahkan yang dinas dari yang pribadi. Kendaraan kantor adalah titipan.

Ketiga, ambil yang menjadi hak, tinggalkan yang dilarang. Kita tidak perlu merasa bersalah.

Keempat, berkata adil tentang putusan dan tentang orang. Bedakan tiga hal.

**Khutbah Kedua**

Pertama, ini sudah khutbah kedua. Kedua, tidak boleh terbaca.
`;

const KULTUM = `أَعُوذُ بِاللهِ مِنَ الشَّيْطَانِ الرَّجِيْمِ، بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ، أَمَّا بَعْدُ.

Jamaah yang saya hormati, pekan ini sebuah unggahan bercerita bahwa penulisnya pernah dirujak karena membagikan prompt — perintah untuk mesin kecerdasan buatan — buat urusan akuntansi dan pajak. Dari cerita kecil itu, ada satu pesan tentang ilmu dan hati yang ingin saya bagikan malam ini.

وَلِيَعْلَمَ ٱلَّذِينَ أُوتُوا۟ ٱلْعِلْمَ أَنَّهُ ٱلْحَقُّ مِن رَّبِّكَ

**QS. Al-Hajj: 54**

قال أبو يوسف ـ رحمه الله ـ: يا قوم أريدوا بعلمكم الله تعالى

**Adab al-'Alim wa al-Muta'allim — الباب الثالث في أدب المتعلم / الثاني**

وَلِيَعْلَمَ ٱلَّذِينَ أُوتُوا۟ ٱلْعِلْمَ

**QS. Al-Hajj: 54**
`;

// Archive shapes (2026-07..09): citation before the Arabic, "Para jamaah"
// vocative, a closing du'a with its own citation.
const ARCHIVE_SHAPES = `Para jamaah yang saya hormati, di pekan yang baru saja kita lewati, kabar tentang tetangga yang saling tolong datang dari banyak arah.

Allah berfirman dalam **QS. An-Nisaa: 136**:

يَٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُوٓا۟ ءَامِنُوا۟ بِٱللَّهِ وَرَسُولِهِۦ

Artinya: "Wahai orang-orang yang beriman, tetaplah beriman kepada Allah dan Rasul-Nya."

**Sahih Muslim 1713a**

إِنَّكُمْ تَخْتَصِمُونَ إِلَىَّ وَلَعَلَّ بَعْضَكُمْ أَلْحَنُ بِحُجَّتِهِ

Dalam **'Aqidat al-'Awam — بيت 26-30**, sebuah nazham aqidah yang biasa dihafal anak-anak, tertulis:

وَكُلُّ مَا جَاءَ بِهِ الرَّسُوْلُ فَحَقُّهُ التَّسْلِيْمُ وَالْقَبُوْلُ

Ya Allah, kami memohon kepada-Mu dengan doa yang diajarkan Nabi ﷺ, sebagaimana diriwayatkan dalam **Sahih Muslim 2719a**:

اللَّهُمَّ اغْفِرْ لِي خَطِيئَتِي وَجَهْلِي
`;

// 2026-09-17 shape: no "Khutbah Kedua" heading; bold "Yang pertama, …"
// steps; an earlier exposition run; the second sermon's own ordinal run.
const KHUTBAH_NO_KEDUA = `إِنَّ الْحَمْدَ لِلّٰهِ نَحْمَدُهُ وَنَسْتَعِيْنُهُ

Marilah pada Jumat yang berkah ini kita awali pertemuan kita dengan satu ayat yang sangat menenangkan hati kita semua. Allah berfirman:

وَإِذَا مَرِضْتُ فَهُوَ يَشْفِينِ

Kabar yang sampai kepada kita pekan ini menguraikan banyak hal tentang kesehatan warga yang sedang diuji oleh kabut asap dan cuaca.

Pertama, makanan beracun itu sampai ke mulut manusia yang paling mulia di sisi Allah.

Kedua, lihatlah apa yang pertama kali beliau ﷺ lakukan setelah peristiwa itu: beliau bertanya.

Hadirin, mari kita bawa pulang beberapa langkah.

**Yang pertama, jadikan bertanya sebagai kebiasaan. Tanyakan kepada yang ahli.**

**Yang kedua, bereskan catatan. Pisahkan uang usaha dari uang rumah.**

**Yang ketiga, kembalikan yang bukan hak. Malam ini juga.**

بَارَكَ اللهُ لِيْ وَلَكُمْ فِي الْقُرْآنِ الْعَظِيْمِ، وَنَفَعَنِيْ وَإِيَّاكُمْ

اَلْحَمْدُ لِلّٰهِ عَلٰى إِحْسَانِهِ

Kedua, mari kita jaga cara kita marah kepada orang lain.

Ketiga, jangan biarkan sinisme menutup pintu kebaikan.
`;

describe("sectionTitle", () => {
  it("lifts the quoted theme title from an H3 heading", () => {
    expect(
      sectionTitle('Khutbah Jumat — "Langit Ditundukkan, Amanah Ditanam di Hati"'),
    ).toBe("Langit Ditundukkan, Amanah Ditanam di Hati");
    expect(sectionTitle("Kultum – “Iman yang Diukur di Rumah Sendiri”")).toBe(
      "Iman yang Diukur di Rumah Sendiri",
    );
    // Keeps inner apostrophes ("Jangan Berhenti di Kata 'Andai'").
    expect(sectionTitle(`Kultum — "Jangan Berhenti di Kata 'Andai'"`)).toBe(
      "Jangan Berhenti di Kata 'Andai'",
    );
  });

  it("returns null for a pre-title-rule heading", () => {
    expect(sectionTitle("Khutbah Jumat")).toBeNull();
    expect(sectionTitle("Kultum (7 menit)")).toBeNull();
  });
});

describe("khutbahSteps", () => {
  it("reads numbered bold leads from the first sermon only", () => {
    expect(khutbahSteps(KHUTBAH_NUMBERED)).toEqual([
      "Jenguk satu orang sakit pekan ini",
      "Hafalkan doa kesembuhan dan bacakan untuk yang sakit",
      "Kenali tetangga yang sedang sesak atau sakit",
    ]);
  });

  it("takes the LAST ordinal-paragraph run, not an earlier exposition", () => {
    expect(khutbahSteps(KHUTBAH_ORDINAL)).toEqual([
      'Pakai ujian "rumah ayah dan ibu"',
      "Pisahkan yang dinas dari yang pribadi",
      "Ambil yang menjadi hak, tinggalkan yang dilarang",
    ]);
  });

  it("reads bold 'Yang pertama, …' steps and ignores the 2nd sermon's run", () => {
    expect(khutbahSteps(KHUTBAH_NO_KEDUA)).toEqual([
      "Jadikan bertanya sebagai kebiasaan",
      "Bereskan catatan",
      "Kembalikan yang bukan hak",
    ]);
  });

  it("splits mid-paragraph ordinals and keeps the run whole", () => {
    const body = [
      "Hadirin, marilah kita bawa pulang beberapa langkah nyata untuk pekan ini. Pertama, jadikan diri kita orang yang aman untuk didatangi. Itu awal semuanya.",
      "Kedua, dengarkan dulu sebelum menasihati saudara kita.",
      "Ketiga, temani mereka menemui tenaga kesehatan terdekat.",
    ].join("\n\n");
    expect(khutbahSteps(body)).toEqual([
      "Jadikan diri kita orang yang aman untuk didatangi",
      "Dengarkan dulu sebelum menasihati saudara kita",
      "Temani mereka menemui tenaga kesehatan terdekat",
    ]);
  });

  it("strips a vocative inside a step and skips continuation paragraphs", () => {
    const body = [
      "Mari kita bawa pulang beberapa langkah.",
      "Yang pertama, kita jaga lisan kita di grup keluarga.",
      "Ini penting karena banyak kabar yang belum jelas beredar setiap hari.",
      "Yang kedua, jamaah, kita harus membuka mata terhadap tetangga kita.",
    ].join("\n\n");
    expect(khutbahSteps(body)).toEqual([
      "Kita jaga lisan kita di grup keluarga",
      "Kita harus membuka mata terhadap tetangga kita",
    ]);
  });

  it("splits at bold, italic and closing-quote ordinals", () => {
    const body = [
      'Perhatikan dua kejahatan. Yang pertama, memakan harta orang dengan jalan batil. Yang kedua, menimbun emas tanpa menafkahkannya.',
      'Marilah kita bawa pulang beberapa tindakan konkret pekan ini. **Pertama**, mari kita audit amanah kecil di rumah. *Kedua*, mari kita didik anak-anak dengan jujur. Tanyakan, "apakah aku sanggup?" Ketiga, jaga lisan kita di grup warga.',
    ].join("\n\n");
    expect(khutbahSteps(body)).toEqual([
      "Mari kita audit amanah kecil di rumah",
      "Mari kita didik anak-anak dengan jujur",
      "Jaga lisan kita di grup warga",
    ]);
  });

  it("trusts a cued run of terse steps; drops an uncued pair", () => {
    expect(
      khutbahSteps(
        "Ada beberapa langkah yang ingin saya tawarkan. Pertama, audit upah. Kita semua harus memeriksa. Kedua, audit janji. Tunaikan satu janji. Ketiga, audit takaran. Periksa timbangan.",
      ),
    ).toEqual(["Audit upah", "Audit janji", "Audit takaran"]);
    expect(
      khutbahSteps(
        "Hadits ini berisi dua larangan.\n\nPertama, tidak menzhalimi saudaranya dalam bentuk apa pun.\n\nKedua, tidak membiarkannya sendirian dalam kesulitan.",
      ),
    ).toEqual([]);
  });

  it("drops a gapped run and an exposition of bare terms", () => {
    expect(
      khutbahSteps("Pertama, satu dua tiga empat.\n\nKetiga, lima enam tujuh delapan."),
    ).toEqual([]);
    expect(
      khutbahSteps(
        "Pertama: *al-adl*. Para ulama mendefinisikannya.\n\nKedua: *al-ihsan*. Lebih dari adil.\n\nKetiga: *ita'i dzil qurba*. Memberi kerabat.",
      ),
    ).toEqual([]);
  });

  it("returns nothing when the khutbah has no step list", () => {
    expect(khutbahSteps("Ma'asyiral muslimin, satu paragraf saja.")).toEqual([]);
  });
});

describe("firstSermon", () => {
  it("cuts at an H4 or bold-only 'Khutbah Kedua'", () => {
    expect(firstSermon(KHUTBAH_NUMBERED)).not.toMatch(/Langkah palsu/);
    expect(firstSermon(KHUTBAH_ORDINAL)).not.toMatch(/sudah khutbah kedua/);
  });

  it("cuts at the closing formula when the second sermon is unannounced", () => {
    const first = firstSermon(KHUTBAH_NO_KEDUA);
    expect(first).toMatch(/Yang ketiga, kembalikan/);
    expect(first).not.toMatch(/Mari kita jaga cara kita marah/);
  });
});

describe("daleelCitations", () => {
  it("collects bold citation lines under Arabic blocks, verbatim, deduped", () => {
    // The kitab locator after " — " is part of the citation: kept whole.
    expect(daleelCitations(KULTUM)).toEqual([
      "QS. Al-Hajj: 54",
      "Adab al-'Alim wa al-Muta'allim — الباب الثالث في أدب المتعلم / الثاني",
    ]);
  });

  it("reads a citation printed before the Arabic, on its own line or inline", () => {
    expect(daleelCitations(ARCHIVE_SHAPES)).toEqual([
      "QS. An-Nisaa: 136",
      "Sahih Muslim 1713a",
      "'Aqidat al-'Awam — بيت 26-30",
    ]);
  });

  it("reads a citation on the translation line after the Arabic", () => {
    const body = [
      "Allah mengingatkan kita tentang kebun yang airnya surut.",
      "أَوْ يُصْبِحَ مَآؤُهَا غَوْرًا فَلَن تَسْتَطِيعَ لَهُۥ طَلَبًا",
      '"atau airnya menjadi surut ke dalam tanah". (**QS. Al-Kahf: 41**)',
      "Dan ayat lain mengingatkan tentang kebenaran.",
      "لِيُحِقَّ ٱلْحَقَّ وَيُبْطِلَ ٱلْبَٰطِلَ",
      '"Agar Allah menegakkan yang hak dan membatalkan yang batil" (QS. Al-Anfal: 8)',
      "Persaudaraan pun ditegaskan.",
      "إِنَّمَا ٱلْمُؤْمِنُونَ إِخْوَةٌ",
      '**QS. Al-Hujuraat: 10** — "Orang-orang beriman itu bersaudara."',
    ].join("\n\n");
    expect(daleelCitations(body)).toEqual([
      "QS. Al-Kahf: 41",
      "QS. Al-Anfal: 8",
      "QS. Al-Hujuraat: 10",
    ]);
  });

  it("reads the remaining translation-line citation shapes", () => {
    const ar = "إِنَّ ٱللَّهَ يَأْمُرُكُمْ أَن تُؤَدُّوا۟ ٱلْأَمَٰنَٰتِ";
    const pick = (line: string) => daleelCitations(`Pengantar.\n\n${ar}\n\n${line}`);
    expect(pick('"Sesungguhnya Allah menyuruh kamu menyampaikan amanat." — **QS. An-Nisaa: 58**.')).toEqual(["QS. An-Nisaa: 58"]);
    expect(pick("— **Sahih Muslim 1130c**")).toEqual(["Sahih Muslim 1130c"]);
    expect(pick('Allah berfirman dalam **QS. Al-Hujuraat: 9**: "Dan jika dua golongan…"')).toEqual(["QS. Al-Hujuraat: 9"]);
    expect(pick('"Sempurnakanlah takaran." **(QS. Ash-Shu\'araa: 183)**')).toEqual(["QS. Ash-Shu'araa: 183"]);
    expect(pick("**Dalil:** Ash-Shama'il al-Muhammadiyyah — 50- باب ما جاء في عيش رسول الله")).toEqual([
      "Ash-Shama'il al-Muhammadiyyah — 50- باب ما جاء في عيش رسول الله",
    ]);
  });

  it("does not take the next passage's citation from its intro line", () => {
    const body = [
      "إِنَّكُمْ تَخْتَصِمُونَ إِلَيَّ",
      "Dalam **Riyad as-Salihin 12** diriwayatkan kisah tiga orang di dalam gua:",
      "انْطَلَقَ ثَلَاثَةُ رَهْطٍ مِمَّنْ كَانَ قَبْلَكُمْ",
    ].join("\n\n");
    expect(daleelCitations(body)).toEqual(["Riyad as-Salihin 12"]);
  });

  it("takes an inline citation from the introducing line only", () => {
    const body = [
      "قَالَ اللَّهُ تَعَالَى أَنْفِقْ يَا ابْنَ آدَمَ",
      '"Berinfaklah, niscaya Aku berinfak kepadamu," dirawat **Sahih Muslim 6572**.\nNabi ﷺ juga bersabda:',
      "اتَّقُوا الظُّلْمَ فَإِنَّ الظُّلْمَ ظُلُمَاتٌ يَوْمَ الْقِيَامَةِ",
      '"Jauhilah kezaliman." (**Riyad as-Salihin 1420**)',
    ].join("\n\n");
    expect(daleelCitations(body)).toEqual(["Sahih Muslim 6572", "Riyad as-Salihin 1420"]);
  });

  it("judges a du'a by the speaker's petition, not a mention of doa", () => {
    // "QS." must not split the sentence: this is the speaker's own du'a.
    expect(
      daleelCitations(
        "Kami memohon dengan doa yang Engkau abadikan dalam **QS. Ash-Shu'araa: 169**:\n\nرَبِّ نَجِّنِى وَأَهْلِى مِمَّا يَعْمَلُونَ",
      ),
    ).toEqual([]);
    // A du'a recorded in the Qur'an, reported as firman, is daleel.
    expect(
      daleelCitations(
        "Allah berfirman tentang doa Nabi Ibrahim dalam **QS. Al-Baqara: 129**:\n\nرَبَّنَا وَٱبْعَثْ فِيهِمْ رَسُولًۭا مِّنْهُمْ",
      ),
    ).toEqual(["QS. Al-Baqara: 129"]);
    // A reported saying that opens with اللهم is not a petition.
    expect(
      daleelCitations(
        "Rasulullah ﷺ bersabda dalam **Riyad as-Salihin 270**:\n\nاللهم إني أحرج حق الضعيفين اليتيم والمرأة",
      ),
    ).toEqual(["Riyad as-Salihin 270"]);
    // رُبَّ ("many a …") is not the vocative رَبِّ.
    expect(
      daleelCitations(
        "Rasulullah ﷺ mengingatkan kita tentang orang yang tampak lusuh.\n\nرُبَّ أَشْعَثَ مَدْفُوعٍ بِالْأَبْوَابِ\n\n**Sahih Muslim 2622**",
      ),
    ).toEqual(["Sahih Muslim 2622"]);
  });

  it("tests the du'a intro on the introducing sentence only", () => {
    const body = [
      "Siapa di antara kita yang pekan ini ikut mengaminkan doa untuk persatuan umat. Allah berfirman dalam **QS. Al-Hujuraat: 9**:",
      "وَإِن طَآئِفَتَانِ مِنَ ٱلْمُؤْمِنِينَ ٱقْتَتَلُوا۟",
    ].join("\n\n");
    expect(daleelCitations(body)).toEqual(["QS. Al-Hujuraat: 9"]);
  });

  it("skips a du'a behind a bold citation line, and Arabic opening as a du'a", () => {
    const body = [
      "Apabila angin bertiup kencang, Rasulullah ﷺ berdoa:",
      "**Sahih Muslim 899b**",
      "اللَّهُمَّ إِنِّي أَسْأَلُكَ خَيْرَهَا وَخَيْرَ مَا فِيهَا",
      "**Sahih al-Bukhari 6377**",
      "رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً",
      "Allah berfirman dalam **QS. Al-Baqara: 201**:",
      "رَبَّنَآ ءَاتِنَا فِى ٱلدُّنْيَا حَسَنَةًۭ",
    ].join("\n\n");
    // The Qur'anic du'a cited as an ayat stays; the hadith du'a do not.
    expect(daleelCitations(body)).toEqual(["QS. Al-Baqara: 201"]);
  });

  it("skips a du'a's citation and non-citation bold labels", () => {
    expect(daleelCitations(ARCHIVE_SHAPES, 9)).not.toContain("Sahih Muslim 2719a");
    expect(daleelCitations(KHUTBAH_ORDINAL, 9)).toEqual([]);
  });

  it("ignores bold lines that do not follow Arabic", () => {
    expect(daleelCitations(firstSermon(KHUTBAH_ORDINAL))).toEqual([]);
    expect(daleelCitations(firstSermon(KHUTBAH_NUMBERED))).toEqual([
      "QS. Al-Anbiyaa: 83",
    ]);
  });
});

describe("leadParagraph", () => {
  it("skips a sentence that only introduces a quote, and 'Para jamaah'", () => {
    expect(leadParagraph(ARCHIVE_SHAPES)).toMatch(/^Di pekan yang baru saja kita lewati/);
  });

  it("prefers a paragraph matching `prefer` when given", () => {
    expect(
      leadParagraph(KHUTBAH_NO_KEDUA, { prefer: /\bpekan\b/i }),
    ).toMatch(/^Kabar yang sampai kepada kita pekan ini/);
  });

  it("skips the Arabic opener and strips the vocative", () => {
    const lead = leadParagraph(KULTUM);
    expect(lead).toMatch(/^Pekan ini sebuah unggahan bercerita/);
    expect(lead!.length).toBeLessThanOrEqual(220);
    expect(lead!.endsWith("…")).toBe(true);
  });

  it("strips chained vocatives", () => {
    expect(
      leadParagraph(
        "Ma'asyiral muslimin rahimakumullah, jamaah Jumat yang dimuliakan Allah. Kabar yang sampai kepada kita pekan ini menguraikan peran penting satelit, dari komunikasi hingga mitigasi bencana.",
      ),
    ).toMatch(/^Kabar yang sampai kepada kita pekan ini/);
  });

  it("skips a setting formula", () => {
    expect(
      leadParagraph(
        "Malam ini kita berkumpul di hari yang istimewa, setelah shalat isya berjamaah bersama.\n\nPekan ini kita mendengar kabar petugas rutan yang membantu pesta narkoba di dalam penjara.",
      ),
    ).toMatch(/^Pekan ini kita mendengar kabar/);
  });

  it("skips the khatib's opening formulas and quote introducers", () => {
    const body = [
      "Marilah kita buka khutbah pekan ini dengan satu ayat yang sangat menenangkan hati kita semua, para jamaah sekalian.",
      "Izinkan khatib membuka mimbar pekan ini dengan sebuah kisah yang dekat dengan kehidupan kita sehari-hari.",
      "Di hari Jumat yang mulia ini, marilah kita memperbarui takwa kita kepada Allah Subhanahu wa Ta'ala bersama-sama.",
      "Ayat ini memberi peringatan yang sangat tajam bagi siapa saja yang lalai, dan Allah Ta'ala berfirman,",
      "Pekan ini kabar tentang kabut asap datang dari banyak daerah, dan tetangga kita banyak yang sesak napas.",
    ].join("\n\n");
    expect(leadParagraph(body)).toMatch(/^Pekan ini kabar tentang kabut asap/);
    // The opener ending in "Allah berfirman:" only introduces a quote.
    expect(leadParagraph(KHUTBAH_NUMBERED)).toBeNull();
  });

  it("returns null when only Arabic and quotes remain", () => {
    expect(
      leadParagraph('بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ\n\n"Terjemahan saja."'),
    ).toBeNull();
  });
});

describe("clipWords", () => {
  it("clips at a word boundary", () => {
    expect(clipWords("satu dua tiga empat", 12)).toBe("satu dua…");
    expect(clipWords("pendek", 12)).toBe("pendek");
  });
});

describe("splitCitation", () => {
  it("separates an Arabic locator for right-to-left display", () => {
    expect(
      splitCitation("Adab al-'Alim wa al-Muta'allim — الباب الثالث في أدب المتعلم / الثاني"),
    ).toEqual({
      name: "Adab al-'Alim wa al-Muta'allim",
      locator: "الباب الثالث في أدب المتعلم / الثاني",
    });
    expect(splitCitation("'Aqidat al-'Awam — بيت 26-30")).toEqual({
      name: "'Aqidat al-'Awam",
      locator: "بيت 26-30",
    });
  });

  it("leaves a Latin commentary tail off a numbered citation", () => {
    expect(
      splitCitation("Riyad as-Salihin 1615, dari Abdullah bin Mas'ud radhiyallahu 'anhu, riwayat Muslim").name,
    ).toBe("Riyad as-Salihin 1615");
    expect(
      splitCitation("Riyad as-Salihin 1587 — dalam hadits qudsi ini Allah Ta'ala berfirman").name,
    ).toBe("Riyad as-Salihin 1587");
    expect(splitCitation("Sahih Muslim 2752c").name).toBe("Sahih Muslim 2752c");
    expect(splitCitation("Riyad as-Salihin 1417 / Sahih al-Bukhari 7086").name).toBe(
      "Riyad as-Salihin 1417 / Sahih al-Bukhari 7086",
    );
  });

  it("keeps a citation without an Arabic locator whole", () => {
    expect(splitCitation("QS. Luqman: 20")).toEqual({ name: "QS. Luqman: 20", locator: null });
    expect(splitCitation("Tafsir Ibn Kathir — QS. Al-Hajj: 54")).toEqual({
      name: "Tafsir Ibn Kathir — QS. Al-Hajj: 54",
      locator: null,
    });
  });
});
