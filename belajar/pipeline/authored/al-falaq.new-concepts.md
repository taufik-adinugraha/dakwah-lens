# Al-Falaq (QS 113): Konsep work for the integrator

Input for whoever edits `authored/library.concepts.json`. It covers two jobs:

1. Author three new Konsep records. They are already used in `al-falaq.concepts-map.json` and in `al-falaq.structure.json` group `concept` fields.
2. Add the new Al-Falaq example locs to existing Konsep records.

`validate.py` checks the concepts map against each concept's `examples` in both directions. The build fails until both jobs are done.

Every page below was opened on Shamela on 2026-10-09; the page title shows the printed volume and page. Records stay `status: "draft"` as pipeline state. There is no human review step (plan L11), so no text may promise one.

Word numbering follows QAC 0.4, which is the Tanzil text after the surah-heading basmalah: 4 + 4 + 5 + 5 + 5 = 23 words.

## Coordination with the Al-Ikhlas and An-Nas authors

- **`maqul-al-qaul`**: also fits 112:1 (qul + huwa Allāhu aḥadun) and 114:1 (qul + a‘ūżu birabbi an-nāsi). If the other authors proposed another id for the same idea (`maqul-qaul`, `jumlah-maqul-al-qaul` …), keep one id and update all three maps.
- **`sighat-mubalaghah`**: the orchestrator's task text spells it "sighat mubalaghah". It also fits 114:4 al-khannās (fa‘‘ālun). The library's pesantren spelling would be `shighat`, written with sh for shad as in "shilah". Pick one spelling for all surahs.
- **`zharaf-idza`**: spelled "zharaf" to match the build's QAC label for tag T (`build_surah.pos_label`: "zharaf zaman"). The task text wrote "zharf idzā". A general id `zharaf` would also work if later surahs bring other zharaf words.

## 1. New concepts (mapped)

### `maqul-al-qaul` (kind: nahwu)

- **Suggested title:** Maqul al-qaul (isi ucapan setelah qul/qāla)
- **Suggested summary:** Kalimat yang menjadi isi ucapan setelah kata kerja "berkata" (seperti qul, "katakanlah") disebut maqul al-qaul; seluruh kalimat itu berkedudukan nashab, seperti objek.
- **Points the explanation can make, each with its source:**
  - Qul is a fi'il amr whose doer is implied, "engkau" (anta). The sentence a‘ūżu birabbi al-falaqi is maqul al-qaul and stands in nashab: Darwisy jil. 10 hlm. 623; al-Jadwal jil. 15 hlm. 427; ad-Da'as jil. 3 hlm. 476.
  - The qul sentence itself is ibtida'iyyah, with no i'rab position: al-Jadwal jil. 15 hlm. 427; ad-Da'as jil. 3 hlm. 476.
  - Rule: of the sentences that have an i'rab position, the third is the one that stands as maf'ul, and its position is nashab. One place it occurs is "bab al-hikayah bil-qaul": Ibnu Hisyam, *Mughni al-Labib* hlm. 538. Mughni adds that grammarians disagree on whether it is maf'ul bih or maf'ul muthlaq; the record may leave that out.
- **Examples:**
  - `113:1:1`: "qul: perintah “katakanlah”; kalimat sesudahnya adalah isi ucapannya."
  - `113:1:2`: "a‘ūżu: awal kalimat a‘ūżu birabbi al-falaqi, isi ucapan yang berkedudukan nashab."
- **Related:** `fiil-amr`, `jumlah-filiyyah`, `maful-bih`
- **Sources (SourceRef):**
  - Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H). Ref: jil. 10, hlm. 623 (al-I'rab QS 113:1: jumlah a‘ūżu maqul al-qaul). URL: https://shamela.ws/book/2163/5781
  - Mahmud Shafi, al-Jadwal fi I'rab al-Qur'an wa Sharfihi wa Bayanihi (Damaskus: Dar ar-Rasyid; Beirut: Mu'assasat al-Iman, cet. 3, 1416 H/1995 M). Ref: jil. 15, hlm. 427 (jumlah qul ibtida'iyyah; jumlah a‘ūżu berkedudukan nashab, maqul al-qaul). URL: https://shamela.ws/book/22916/5919
  - Ahmad 'Ubaid ad-Da'as, Ahmad Muhammad Humaidan dan Isma'il Mahmud al-Qasim, I'rab al-Qur'an al-Karim (Damaskus: Dar al-Munir dan Dar al-Farabi, cet. 1, 1425 H). Ref: jil. 3, hlm. 476 (jumlah a‘ūżu maqul al-qaul). URL: https://shamela.ws/book/23584/1398
  - Ibnu Hisyam, Mughni al-Labib 'an Kutub al-A'arib (tahqiq Mazin al-Mubarak dan Muhammad 'Ali Hamdullah; Dar al-Fikr, Damaskus, cet. 6, 1985). Ref: hlm. 538 (jumlah yang menjadi maf'ul, kedudukannya nashab; bab hikayah dengan qaul). URL: https://shamela.ws/book/6972/526

### `zharaf-idza` (kind: nahwu)

- **Suggested title:** Zharaf iżā (keterangan waktu “apabila”)
- **Suggested summary:** Iżā adalah keterangan waktu (zharaf) untuk masa yang akan datang, mabni di atas sukun, yang selalu disandarkan kepada kalimat sesudahnya; di Al-Falaq ia keterangan waktu murni, tanpa makna syarat.
- **Points:**
  - Iżā is a zharaf for future time, usually carrying a conditional sense, and is mabni on sukun: al-Jadwal jil. 1 hlm. 57 (QS 2:11). It can lose the conditional sense, for example in QS 92:1: al-Jadwal jil. 1 hlm. 58. Mughni hlm. 135–136 (al-Fashl ats-Tsalits) discusses the same point.
  - In 113:3 and 113:5 iżā is a pure time adverb with no condition: Darwisy jil. 10 hlm. 623 ("zharaf untuk sekadar keterangan waktu"); al-Jadwal jil. 15 hlm. 427 (nashab, free of the condition); al-Mujtaba jil. 4 hlm. 1492 ("zharaf murni").
  - The sentence after iżā (waqaba, ḥasada) is mudhaf ilaih in jar: Darwisy hlm. 623; al-Jadwal jil. 15 hlm. 428; ad-Da'as jil. 3 hlm. 476. Rule: a sentence can be mudhaf ilaih, in jar, and according to the majority iżā must be annexed to a sentence: Mughni hlm. 547.
  - Scholars differ on what iżā attaches to. Al-Mujtaba says a‘ūżu ("aku berlindung … pada waktu itu"), and as-Samin jil. 11 hlm. 159 says it is manshub by a‘ūżu. Al-Jadwal hlm. 427 attaches it to the mashdar syarri.
- **Examples:**
  - `113:3:4`: "iżā: keterangan waktu murni, mabni di atas sukun, kedudukannya nashab."
  - `113:3:5`: "waqaba: kalimat sesudah iżā, berkedudukan jar sebagai mudhaf ilaih."
  - `113:5:4`: "iżā: pola yang sama di ayat 5."
  - `113:5:5`: "ḥasada: kalimat sesudah iżā, mudhaf ilaih."
- **Related:** `murab-mabni`, `idhafah`, `fiil-madhi`
- **Sources:**
  - al-Jadwal jil. 1, hlm. 57–58. URL: https://shamela.ws/book/22916/42
  - al-Jadwal jil. 15, hlm. 427–428. URLs: https://shamela.ws/book/22916/5919 and /5920
  - Darwisy jil. 10, hlm. 623. URL: https://shamela.ws/book/2163/5781
  - al-Mujtaba jil. 4, hlm. 1492. URLs: https://shamela.ws/book/9617/6025 and /6027
  - as-Samin jil. 11, hlm. 159. URL: https://shamela.ws/book/9057/10762
  - Mughni hlm. 547. URL: https://shamela.ws/book/6972/535
  - Mughni hlm. 135–136. URL: https://shamela.ws/book/6972/124
  - ad-Da'as jil. 3, hlm. 476. URL: https://shamela.ws/book/23584/1398

### `sighat-mubalaghah` (kind: sharaf)

- **Suggested title:** Shighat mubalaghah (bentuk “sangat/banyak” dari isim fa'il)
- **Suggested summary:** Dari isim fa'il (fā‘ilun) dibentuk wazan seperti fa‘‘ālun untuk makna “banyak/sering melakukan”; bentuk ini bekerja seperti kata kerja.
- **Points:**
  - Ibnu 'Aqil lists five wazan (fa‘‘ālun, mif‘ālun, fa‘ūlun, fa‘īlun, fa‘ilun) that are formed from fā‘ilun to mean "a lot". They work like the fi'il, the first three more often than the last two: *Syarh Ibn 'Aqil* jil. 3 hlm. 111.
  - An-naffāṡāt is the plural of an-naffāṡah, the feminine of an-naffāṡ, a mubalaghah of the isim fa'il from nafaṡa ("meniup"), wazan fa‘‘ālun: al-Jadwal jil. 15 hlm. 428. As-Samin jil. 11 hlm. 159 calls it a "mithal mubalaghah" and glosses nafaṡa as nafakha ("meniup").
  - Because the form works like a verb, fī al-‘uqadi attaches to an-naffāṡāti (Darwisy hlm. 623; al-Jadwal hlm. 427; al-Mujtaba hlm. 1492; ad-Da'as hlm. 476). The rule behind it is Ibnu 'Aqil's.
  - The meaning, as the kitab give it: women sorcerers who blow on knots. Sources: Darwisy hlm. 623 (al-Lughah); al-Jadwal hlm. 428; an-Nahhas jil. 5 hlm. 197; Ibnu Katsir jil. 8 hlm. 536, from Mujahid, 'Ikrimah, al-Hasan, Qatadah and adh-Dhahhak.
    - Keep the frame protective: the surah teaches seeking refuge in Allah from this evil.
    - Do not use an-Nahhas's remark "adapun sihir itu batil" or Ibnu Katsir's sihr narrations in a grammar record.
- **Examples:**
  - `113:4:3`: "an-naffāṡāti: jamak dari naffāṡah, bentuk mubalaghah “yang banyak meniup”, wazan fa‘‘ālun (bentuk tunggal mudzakkar)."
  - `113:4:4`: "fī: frasa fī al-‘uqadi bergantung pada an-naffāṡāti, karena bentuk mubalaghah bekerja seperti fi'il."
  - Candidate from An-Nas: 114:4 al-khannās.
- **Related:** `isim-fail`, `wazan-dan-tashrif`, `huruf-jar`
- **Sources:**
  - Ibnu 'Aqil, Syarh Ibn 'Aqil 'ala Alfiyyah Ibn Malik (tahqiq Muhammad Muhyiddin 'Abd al-Hamid, Kairo: Dar at-Turats, cet. 20, 1400 H/1980 M). Ref: jil. 3, hlm. 111, bab I'mal Ism al-Fa'il. URL: https://shamela.ws/book/9904/789
  - al-Jadwal jil. 15, hlm. 428. URL: https://shamela.ws/book/22916/5920
  - as-Samin al-Halabi, ad-Durr al-Mashun (tahqiq Ahmad Muhammad al-Kharrath; Damaskus: Dar al-Qalam). Ref: jil. 11, hlm. 159. URL: https://shamela.ws/book/9057/10763
  - Darwisy jil. 10, hlm. 623. URL: https://shamela.ws/book/2163/5781

## 2. New examples for existing concepts

Each row needs an entry in that concept's `examples`. The notes are suggestions in the house style.

| concept | loc | suggested note |
|---|---|---|
| `fiil-amr` | 113:1:1 | qul: fi'il amr “katakanlah”, mabni di atas sukun; pelakunya “engkau” tersirat. |
| `fiil-mudhari` | 113:1:2 | a‘ūżu: awalan hamzah (“aku”), marfu' dengan dhammah. |
| `jumlah-filiyyah` | 113:1:2 | a‘ūżu: fi'il + fa'il tersirat “aku”. |
| `jumlah-filiyyah` | 113:2:4 | khalaqa: fi'il + fa'il tersirat “Dia”; kalimatnya menjadi shilah. |
| `huruf-jar` | 113:1:3 | bi- + rabbi: majrur dengan kasrah; frasanya bergantung pada a‘ūżu. |
| `huruf-jar` | 113:2:1 | min “dari”: frasa min syarri bergantung pada a‘ūżu. |
| `huruf-jar` | 113:2:2 | syarri: majrur karena min, sekaligus mudhaf. |
| `huruf-jar` | 113:4:4 | fī “pada”: frasa fī al-‘uqadi bergantung pada an-naffāṡāti. |
| `huruf-jar` | 113:4:5 | al-‘uqadi: majrur karena fī. |
| `idhafah` | 113:1:4 | al-falaqi: mudhaf ilaih dari rabbi (“Tuhan subuh”). |
| `idhafah` | 113:2:2 | syarri: mudhaf, disandarkan kepada mā. |
| `idhafah` | 113:3:3 | gāsiqin: mudhaf ilaih dari syarri (“kejahatan malam”). |
| `idhafah` | 113:4:3 | an-naffāṡāti: mudhaf ilaih dari syarri. |
| `idhafah` | 113:5:3 | ḥāsidin: mudhaf ilaih dari syarri. |
| `wazan-dan-tashrif` | 113:1:4 | al-falaqi: wazan fa‘alun bermakna maf‘ūlun, “yang dibelah” (as-Samin). |
| `murab-mabni` | 113:2:3 | mā: mabni di atas sukun, kedudukannya jar. |
| `murab-mabni` | 113:3:4 | iżā: mabni di atas sukun, kedudukannya nashab. |
| `isim-maushul` | 113:2:3 | mā: isim maushul “yang”, mudhaf ilaih; kata ganti penghubungnya dibuang. |
| `isim-maushul` | 113:2:4 | khalaqa: shilah bagi mā (“yang Dia ciptakan”). |
| `fiil-madhi` | 113:2:4 | khalaqa: fi'il madhi mabni di atas fathah (bandingkan an‘amta yang sukun). |
| `fiil-madhi` | 113:3:5 | waqaba: fi'il madhi mabni di atas fathah, sesudah iżā. |
| `fiil-madhi` | 113:5:5 | ḥasada: fi'il madhi mabni di atas fathah. |
| `athaf` | 113:3:1 | wa: menyambungkan wa min syarri … pada min syarri di ayat 2. |
| `athaf` | 113:4:1 | wa: penyambungan yang sama di ayat 4. |
| `athaf` | 113:5:1 | wa: penyambungan yang sama di ayat 5. |
| `isim-fail` | 113:3:3 | gāsiqin: isim fa'il dari gasaqa, wazan fā‘ilun (al-Jadwal). |
| `isim-fail` | 113:5:3 | ḥāsidin: isim fa'il dari ḥasada, wazan fā‘ilun (al-Jadwal). |

Three existing titles read narrowly for the Al-Falaq examples. The integrator may want to widen them.

- `fiil-amr` is titled "bentuk perintah yang menjadi doa". Qul is a real command from Allah, not a du'a, so the explanation could add a line on that. Sources: Darwisy hlm. 623 (qul fi'il amr) and Qathr an-Nada hlm. 31, which is already among the concept's sources.
- `fiil-madhi` explains only the sukun case (an‘amta). Khalaqa, waqaba and ḥasada show the basic fathah. The concept already cites Qathr an-Nada hlm. 27 and al-Ajurrumiyyah hlm. 10 for that.
- `isim-maushul` covers only allażīna. Mā is the maushul for non-rational things. The surah pages do not state that rule, so add a source (for example Syarh Ibn 'Aqil, bab al-Maushul) before writing it.

## 3. Optional concepts (not mapped)

These can be authored later. If one is created, add its locs to `al-falaq.concepts-map.json` too.

- **`nakirah-marifah`** (nahwu): makna nakirah dan ma'rifah.
  - Ajurrumiyyah hlm. 14 defines nakirah and the five kinds of ma'rifah. URL: https://shamela.ws/book/11371/15
  - As-Samin jil. 11 hlm. 160 explains why gāsiqin and ḥāsidin are nakirah: harm may not come from them, so the indefinite means "some". He says an-naffāṡāti is ma'rifah for 'ahd (the ones narrated in tafsir) or to stress the evil. URL: https://shamela.ws/book/9057/10764
  - Darwisy jil. 10 hlm. 623 (al-Fawa'id) reads ma'rifah as general and nakirah as specific. Every peniup buhul is evil, but hasad has a praiseworthy and a blameworthy kind. URL: https://shamela.ws/book/2163/5781
  - Locs: 113:3:3, 113:4:3, 113:5:3. This content already sits in the shared ikhtilaf of those words.
- **`jamak-muannats-salim`** (nahwu):
  - Ajurrumiyyah hlm. 7: kasrah marks khafdh in jamak mu'annats salim, and hlm. 9: it also takes kasrah in nashab. URLs: https://shamela.ws/book/11371/4 and /6
  - Loc 113:4:3. No cited page labels an-naffāṡāt "jamak mu'annats salim" in those words. An-Nahhas jil. 5 hlm. 197 contrasts it with the broken plural nawāfiṡ, and al-Jadwal hlm. 428 calls it the plural of an-naffāṡah.
  - This would be the natural pair of `jamak-mudzakkar-salim`.
- **`jamak-taksir`** (nahwu):
  - Ajurrumiyyah hlm. 6–7: dhammah, fathah and kasrah work as signs in jamak taksir.
  - Loc 113:4:5 al-‘uqadi, the plural of ‘uqdah according to QAC 0.4 (LEM ‘uqdah, MP).
- **`huruf-mashdari`** or `ma-mashdariyyah` (nahwu): the second view on mā in 113:2:3. An-Nahhas jil. 5 hlm. 197 gives it first; Darwisy and as-Samin allow it, and al-Jadwal records it from al-'Ukbari. It is not mapped because the main view is isim maushul.
