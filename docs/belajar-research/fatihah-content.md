# fatihah-content

## SUMMARY
- **Verified word inventory.** Al-Fatihah (Hafs, Kufan count) has 7 ayat and **29 words** (4+4+2+3+4+3+9). Without the basmalah that is 25 words, the same figure ad-Dani and Ibn Kathir give. In the Quranic Arabic Corpus (QAC) these words come from 23 distinct stem lemmas and 18 trilateral roots. The full word table (root, lemma, POS, wazn, case sign, a one-sentence Indonesian i'rab reason) was checked against 4 i'rab works (Darwish, al-Jadwal, al-Mujtaba, an-Nahhas) plus as-Samin's *ad-Durr al-Masun*.
- **Where scholars differ:** رَبِّ (na't or badal), غَيْرِ (badal from الذين, badal from the pronoun in عليهم, na't, or exceptive), the second صِرَاطَ (badal or 'atf bayan), the lam of لِلّٰهِ (istihqaq vs ikhtisas), إِيَّاكَ (mabni on fath vs sukun), what الضالين is joined to, and what بسم attaches to. Each option is sourced.
- **Basmalah, verified from data.** It appears 114 times in the mushaf: 112 unnumbered surah headings, plus 1:1, plus 27:30 (Sulaiman's letter). 27:30 is the only place it occurs inside a verse. At-Tawbah has none, and بسم الله alone also occurs at 11:41 (Nuh's ark).
- **25+ "Tahukah kamu" facts**, each with its dataset and exact query, for example:
  - المغضوب occurs only once in the Qur'an.
  - إِيَّاكَ addressed to Allah occurs only in 1:5.
  - The definite الصراط المستقيم occurs only at 1:6 and 37:118, and ṣirāṭ is never plural (45 times).
  - The 23 Fatihah lemmas make up 12.5% of all Qur'an word tokens.
- **Qira'at (only the mutawatir readings).** Three places differ: مالك/ملك, الصراط read with sin/sad/ishmam, and عليهم (dammah on the ha for Hamzah and Ya'qub; joining the mim with a waw for Ibn Kathir, Abu Ja'far and Qalun). Sources: an-Nashr 1/271–273 and al-Budur az-Zahirah pp. 15–16. Non-canonical (shadhdh) readings are kept in a separate category.
- **Hadith.** 13 references checked against sunnah.com numbering. 10 are already in the platform's corpus (Bukhari, Muslim, Riyad as-Salihin). However, the local JSON still uses the old numbers for Muslim and Riyad, and Bukhari and Riyad have no Indonesian text.
- **Names.** 25 names are listed in al-Itqan (1/187–191), and about 9 of them come from hadith.
- **Compliance flags:**
  - PMA 44/2016 defines a mushaf as including part of a surah, in print or digital, and requires an LPMQ tashih.
  - The Quran Foundation API allows caching for at most 1 week and no redistribution.
  - The QAC data is GPL with a "no changes" header.
  - The modern i'rab books are copyrighted.
- **Possible errors for the scholar to check:** al-Jadwal gives the verb class of حمد as "باب نصر", which looks wrong. Quran.com's Indonesian word-by-word gloss for أَنْعَمْتَ ("diberi nikmat") drops the subject "Engkau" (You).

## RECOMMENDATIONS
- **Use one data stack and record versions.**
  - Text: Tanzil Uthmani, or the LPMQ Mushaf Standar Indonesia (see risks).
  - Morphology: QAC v0.4 for root, lemma and POS.
  - Glosses and i'rab: written by the team from D, J and M, then reviewed by a scholar; do not copy from the books verbatim.
  - Store the source version with every value (for example `qac=0.4`, `tanzil=uthmani-1.1`).
- **Treat each encyclopedia fact as a record:** count, list of locations, dataset and version, exact query, and the date it was checked. Re-run the scripts whenever a data version changes. Ship only facts whose list of locations a reviewer can click through.
- **Use lemma counts for claims about meaning.** Show root counts only as "word family" facts, with the caveat that, for example, قوم and مستقيم share a root.
- **Never present letter counts, and no numerology.** ad-Dani gives 120 letters and IK reports 113, which shows the convention is not fixed. Do not use claims like "yawm = 365".
- **Show i'rab as a main reading plus a "Pendapat lain" chip,** using the table in section 3. In every quiz, mark the main reading only as correct, but accept the alternatives as "also valid".
- **Keep the "why kasrah/dhammah/fathah" sentence to one line per word** (the reasons in section 2). Use them for the narration script and for "explain the case sign" quiz items.
- **Gate the qira'at intermezzo to the 3 mutawatir places in section 5,** cited from an-Nashr and al-Budur. Exclude shadhdh readings from beginner lessons. If they are shown at all, label them "bacaan syādz — bukan Al-Qur'an".
- **Hadith must be retrieved, never generated:**
  - Retrieve by the canonical citation string, as `retrieve_by_citation` already does: Muslim 394a/395a/410a/806/2201a and Riyad 1009/1022.
  - Do not use the local JSON `hadithnumber`.
  - Tirmidhi 2875/2953/3124, Abu Dawud 1457 and Nasa'i 914 are not in the v0 corpus. Either add those collections through the normal ingest path or leave those hadith out.
- **Commission reviewed Indonesian translations for the Bukhari and Riyad hadith used.** The local files have none; Muslim already has manual Indonesian.
- **For الْمَغْضُوب and الضَّالِّين, lead with Ibn Kathir's description of the traits:** knowing the truth and turning away, versus lacking knowledge. This fits the rahma/hikmah and "hate the deed" rules. The scholar should decide whether and how to cite the 'Adi b. Hatim hadith (Tirmidhi 2954).
- **For the Indonesian transliteration column, follow SKB 158/1987 rather than Quran.com's corpus-style transliteration.** Use Kemenag wording for full-verse translations.
- **Send the two flagged items to the scholar:** al-Jadwal's verb class for حمد, and the Quran.com Indonesian gloss for أَنْعَمْتَ ("diberi nikmat"). A suggested replacement for the latter is "Engkau beri nikmat", with عليهم as "kepada mereka".
- **Quiz content this inventory supports directly:**
  - "Find the hapax" (المغضوب, إياك 2MS).
  - "Where else does this phrase appear?" (basmalah at 27:30 and 11:41; اهدنا at 38:22; الصراط المستقيم at 37:118; Iblis at 7:16).
  - "Root family sorting" with the 18 roots.
  - "Case-sign detective" with the 29 words.
  - A "12.5% of the Qur'an" vocabulary-progress meter.

## RISKS
- **PMA 44/2016 (operator decision; likely blocking for public launch).** Pasal 1(1) defines a mushaf as including "bagian dari surah atau ayat-ayatnya, baik cetak maupun digital", and Pasal 2 requires a Surat Tanda Tashih or Izin Edar from LPMQ. A Fatihah learning module that displays ayat may need a tashih, and LPMQ reviews digital apps (30 working days per its service standard). Ask LPMQ or a lawyer before going public.
- **Which rasm (operator and scholar decision).** Tanzil, QAC and Quran.com use the Madani mushaf's orthography and harakat. Indonesian users and LPMQ expect the Mushaf Standar Indonesia, which has different conventions and marks. Choose one before building word segmentation or audio-to-text alignment.
- **Quran Foundation API terms:** no redistribution, and caching for at most 1 week unless through the Content Sync APIs. Permanently storing word glosses or audio URLs pulled from api.quran.com would breach this. Either use Content Sync or source the data elsewhere (QAC/Tanzil plus our own glosses).
- **QAC license is ambiguous:** GPL v3 plus a header saying "changing it is not allowed". Is adding Indonesian glosses, or joining the data into our own tables, a "change"? Get a legal read. Display with attribution is clearly fine.
- **Copyright:** Darwish, al-Jadwal, al-Mujtaba, al-Budur and al-Abyari are modern copyrighted works. Cite them and paraphrase; do not show long verbatim excerpts. Hadith English translations (USC-MSA/Darussalam) are also copyrighted.
- **Counts depend on the data version.** QAC 0.4 (2011) gives root ح م د as 63, while other sources quote different figures. Later QAC corrections may change counts slightly. Always show the version.
- **Basmalah status is a fiqh difference.** Whether it is an ayah of the Fatihah differs (D: ash-Shafi'i yes; Malik no; Abu Hanifah and Ahmad: an ayah of the Fatihah only). Present this neutrally. The Kufan count used for Hafs counts it as ayah 1.
- **Sensitive content:** the "Jews/Christians" identification for maghdub and dallin (Tirmidhi 2954; al-Jadwal's balagha section; IK) raises interfaith and sectarian concerns under the hikmah rule. The scholar decides the wording.
- **Unauthenticated reports that must not ship without grading:**
  - the Ibn Sa'd report of the basmalah being adopted in stages (cited in D and J);
  - the ad-Darimi "ash-Shifa'" hadith;
  - the claim that the Fatihah was revealed twice (J).
- **Verification gaps:**
  - sunnah.com returned HTTP 403 (Cloudflare), so numbers were confirmed through the amrayn.com mirror and search snippets instead.
  - Print page numbers for J, M, N, S and Ibn Kathir are not verified.
  - The edition behind Quran.com translation id 33 (probably Kemenag 2019) is not verified.
  - The license of Quran.com's word-by-word glosses and word audio is unknown.
- **Corpus drift** (follow-up for the existing platform): local `muslim.json` and `riyad-as-salihin.json` keep the old numbering while Qdrant was migrated. Any new module code must match on the canonical `citation_en`.
- **Budget:** this inventory needs no paid API. The scripts run on free data. ElevenLabs narration and LPMQ tashih are separate budget lines for the plan; it is unknown whether LPMQ charges a fee.

## REPORT
## 1. Scope and method

- **Text:** Quran.com API v4 (`/verses/by_chapter/1?words=true`, word type = word), Tanzil Uthmani / Simple-Clean v1.1, and the Quranic Arabic Corpus (QAC) morphology file v0.4. The QAC website dictionary gives the same root counts as the v0.4 file.
- **Counts:** computed from QAC 0.4 for roots and lemmas, and from Tanzil Simple-Clean for phrases. For phrase counts I removed the basmalah that Tanzil adds to the start of verse 1 of each surah (except surahs 1 and 9).
- **Scripts** (session scratchpad, which is temporary): `/private/tmp/claude-501/-Users-mbairm3512-Documents-SuksesBerkah-dakwah-lens/4a866c63-6436-47d4-93e9-24426863518f/scratchpad/quranmod/{phrases.py,more.py,roots.py}`.
- **Abbreviations for i'rab sources:**
  - **D** = Darwish, *I'rab al-Qur'an wa Bayanuh*, 4th ed. 1415H, vol. 1 (p. 9 = basmalah; pp. 14–15 = 1:2–7; Shamela page numbers match the print).
  - **J** = Mahmud Safi, *al-Jadwal*.
  - **M** = al-Kharrat, *al-Mujtaba*.
  - **N** = an-Nahhas, *I'rab al-Qur'an*.
  - **S** = as-Samin, *ad-Durr al-Masun*.
  - **IK** = Ibn Kathir.
  - All of these were read on tafsir.app (URLs are in the sources).
- **Glosses** are from Quran.com's word-by-word layer, Indonesian and English.

## 2. Word inventory (29 words)

| Loc | Word | Translit. | ID / EN gloss | Root · lemma · POS (QAC) | Wazn | Case and sign | Simple reason (ID) | Source |
|---|---|---|---|---|---|---|---|---|
|1:1:1|بِسْمِ|bismi|dengan nama / In (the) name|س م و · اسم · P+N|asal سِمْو (Bashri) / وَسْم (Kufi)|majrur, kasrah|Kasrah karena didahului huruf jar بِ.|D 1/9; J; M; N|
|1:1:2|ٱللَّهِ|Allāhi|Allah|أ ل ه · الله · PN|asal الإله (J); murtajal (opsi di D)|majrur, kasrah|Mudhaf ilaih dari *ismi*.|D; J; M|
|1:1:3|ٱلرَّحْمَٰنِ|ar-Raḥmāni|Maha Pengasih / Most Gracious|ر ح م · رحمن · ADJ|فَعْلان|majrur, kasrah|Sifat (na't) yang mengikuti "Allāh".|D; J; M|
|1:1:4|ٱلرَّحِيمِ|ar-Raḥīmi|Maha Penyayang / Most Merciful|ر ح م · رحيم · ADJ|فَعِيل|majrur, kasrah|Sifat kedua.|J; D|
|1:2:1|ٱلْحَمْدُ|al-ḥamdu|pujian / All praises|ح م د · حمد · N|فَعْل (masdar)|marfu', dhammah|Dhammah karena ia mubtada'.|D 1/14; J; N|
|1:2:2|لِلَّهِ|lillāhi|bagi Allah / to Allah|lām + PN|—|majrur, kasrah|Kasrah karena huruf jar لِ; menjadi khabar tersirat.|D; J; S|
|1:2:3|رَبِّ|rabbi|Tuhan / the Lord|ر ب ب · رب · N|فَعْل|majrur, kasrah|Mengikuti "Allāh" (na't/badal).|N; J; D; M|
|1:2:4|ٱلْعَٰلَمِينَ|al-'ālamīna|alam semesta / the universe|ع ل م · عالمين · N MP|jamak عالَم|majrur, yā'|Mudhaf ilaih; yā' karena mulhaq jamak mudzakkar salim.|D; J; M|
|1:3:1-2|ٱلرَّحْمَٰنِ ٱلرَّحِيمِ|—|sama|sama|—|majrur, kasrah|Sifat lagi bagi "Allāh" (J: atau badal).|D; J|
|1:4:1|مَٰلِكِ|māliki|Penguasa / Master|م ل ك · مالك · N (ism fā'il)|فاعِل|majrur, kasrah|Sifat keempat bagi "Allāh"; idhafah-nya menjadikannya ma'rifah.|D; M; J|
|1:4:2|يَوْمِ|yawmi|hari / Day|ي و م · يوم · N|فَعْل|majrur, kasrah|Mudhaf ilaih.|D; J|
|1:4:3|ٱلدِّينِ|ad-dīni|pembalasan / Judgment|د ي ن · دين · N|فِعْل (masdar)|majrur, kasrah|Mudhaf ilaih.|J|
|1:5:1|إِيَّاكَ|iyyāka|hanya kepada-Mu / You alone|إيا · PRON 2MS|—|mabni; mahall nashb|Objek yang didahulukan untuk makna "hanya".|D; J; M|
|1:5:2|نَعْبُدُ|na'budu|kami menyembah|ع ب د · عبد · V impf. I|نَفْعُلُ|marfu', dhammah|Mudhari' tanpa penashab/penjazm; pelaku tersirat "kami".|D; J|
|1:5:3|وَإِيَّاكَ|wa-iyyāka|dan hanya kepada-Mu|wa + PRON|—|sama|Diulang agar "hanya" melekat pada kedua perbuatan.|J; D|
|1:5:4|نَسْتَعِينُ|nasta'īnu|kami mohon pertolongan|ع و ن · استعان · V impf. X|نَسْتَفْعِلُ ← نَسْتَعْوِنُ|marfu', dhammah|Sama dengan na'budu.|D; J; M|
|1:6:1|ٱهْدِنَا|ihdinā|tunjukkan kami|ه د ي · هدى · V impv. + نا|افْعِنا|mabni (hadzf harf 'illah)|Kata perintah bermakna doa; yā' dibuang; pelaku "Engkau".|D; J; M|
|1:6:2|ٱلصِّرَٰطَ|aṣ-ṣirāṭa|jalan|ص ر ط · صراط · N|فِعال|manshub, fathah|Objek kedua dari *ihdi*.|J; M; D|
|1:6:3|ٱلْمُسْتَقِيمَ|al-mustaqīma|lurus|ق و م · مستقيم · ADJ (ism fā'il X)|مُسْتَفْعِل ← مُسْتَقْوِم|manshub, fathah|Sifat bagi aṣ-ṣirāṭ.|D; J|
|1:7:1|صِرَٰطَ|ṣirāṭa|jalan|ص ر ط|—|manshub, fathah|Badal dari aṣ-ṣirāṭa.|D; J; M; S|
|1:7:2|ٱلَّذِينَ|alladhīna|orang-orang yang|الذي · REL|—|mabni; mahall jarr|Mudhaf ilaih dari ṣirāṭa.|D; J|
|1:7:3|أَنْعَمْتَ|an'amta|(Engkau) beri nikmat|ن ع م · أنعم · V perf. IV + تَ|أَفْعَلْتَ|mabni sukun|Bersambung dengan تَ (= Engkau, pelaku); kalimat shilah.|D; J|
|1:7:4|عَلَيْهِمْ|'alayhim|kepada mereka|على + هم|—|jar-majrur|Keterangan bagi *an'amta*.|D; J|
|1:7:5|غَيْرِ|ghayri|bukan|غ ي ر · غير · N|—|majrur, kasrah|Badal dari "alladhīna" (atau na't).|J; M; D; S|
|1:7:6|ٱلْمَغْضُوبِ|al-maghḍūbi|yang dimurkai|غ ض ب · مغضوب · N (ism maf'ul)|مَفْعُول|majrur, kasrah|Mudhaf ilaih dari *ghayri*.|D; J|
|1:7:7|عَلَيْهِمْ|'alayhim|(atas) mereka|على + هم|—|mahall raf'|Nā'ib fā'il bagi *al-maghḍūb*.|D; J; M|
|1:7:8|وَلَا|wa-lā|dan bukan (pula)|wa + NEG|—|—|Lā tambahan, menegaskan negasi *ghayr*.|D; J; M|
|1:7:9|ٱلضَّآلِّينَ|aḍ-ḍāllīna|orang yang sesat|ض ل ل · ضالّ · N MP|فاعِلِين (idgham)|majrur, yā'|Jamak mudzakkar salim, di-'athaf-kan.|D; M; J|

## 3. Where the authorities differ

| Point | Options | Source |
|---|---|---|
|What بسم attaches to|An implied verb أبتدئ (Kufi) vs an implied khabar ابتدائي (Bashri). D says both are good.|D 1/9; N; J; M|
|What puts الحمد in raf'|Ibtida' (Bashri), with differing views from al-Kisa'i and al-Farra'|N|
|The *al-* in الحمد|Istighraq / jins (preferred by az-Zamakhshari) / 'ahd|S|
|The lam of لله|Istihqaq (S); in rhetorical terms, ikhtisas (D, J)|S; D; J|
|رب|Na't (N) / badal (M) / either (D, J, S)|—|
|مالك|Na't (D, M) / or badal (J)|—|
|إياك|Mabni on fath, with the kaf part of the pronoun (J); or إيّا mabni on sukun with kaf as a particle of address (M; J's 2nd option)|J; M|
|الصراط (1:6)|Second object (J, M) / manshub bi-naz' al-khafidh (D)|—|
|صراط (1:7)|Badal kull min kull (D, J, M, S) / 'atf bayan (IK)|IK on 1:7|
|غير|Badal from الذين (J, M, S) / badal from the pronoun in عليهم (D, J) / na't of الذين (D, J, S; al-Mubarrad objected, two answers given) / munqati' exception (IK, S)|—|
|الضالين is joined to|المغضوب (D, M) / غير (J)|—|

## 4. Encyclopedia facts ("Tahukah kamu")

| # | Fact | Data and method |
|---|---|---|
|1|7 ayat in every counting school. Makki and Kufi count the basmalah as an ayah; the others count «أنعمت عليهم» as an ayah end instead.|ad-Dani, *al-Bayan* p.139|
|2|29 words; 25 without the basmalah (ad-Dani and IK also say 25)|Quran.com words; QAC|
|3|Reported letter counts conflict: 120 (ad-Dani) vs 113 (IK, "qalu"). Do not teach a single figure.|ad-Dani p.139; IK 1:1|
|4|7 letters never appear in the surah: ث ج خ ز ش ظ ف|Character set of Tanzil 1:1–7; also mentioned in al-Itqan 1/189–190, where it is called a weak explanation of the name|
|5|Basmalah appears 114× in the mushaf: 112 headings + 1:1 + 27:30. At-Tawbah has none.|Quran.com `bismillah_pre` (true for 112; false for 1 and 9); Tanzil|
|6|27:30 (Sulaiman's letter) is the only in-verse basmalah, so An-Naml contains it twice|Regex on Tanzil after removing headings|
|7|بسم الله in verse text: 1:1, 11:41 (Nuh's ark), 27:30|Regex|
|8|الرحمن الرحيم side by side: 1:1, 1:3, 2:163, 27:30, 41:2, 59:22|Regex|
|9|Ar-Rahman 57× (16 of them in Maryam); ar-Rahim 116×; root ر ح م 339×|QAC lemma and root counts|
|10|(wa/fa) الحمد لله in 23 verses. 5 surahs open with it: 1, 6, 18, 34, 35.|Regex; check of each surah's first verse|
|11|Full phrase الحمد لله رب العالمين: 1:2, 6:45, 10:10 (last words of the people of Paradise), 37:182, 39:75, 40:65|Regex allowing a wa- prefix|
|12|رب العالمين (any prefix): 42 verses|Regex|
|13|رَبّ occurs 975×, the most frequent noun lemma after "Allah" (2,699)|QAC ranking of nominal lemmas|
|14|عالمين 73×; root ع ل م 854×|QAC|
|15|يوم الدين 13×, three of them in Al-Infitar (82:15, 17, 18)|Regex|
|16|مالك (ism fa'il) 3×: 1:4, 3:26 «مالك الملك», 36:71. Separately, Malik the angel at 43:77.|QAC|
|17|إِيَّاكَ (2nd person masculine singular) only at 1:5, twice (out of 24 forms of إيا)|QAC person features|
|18|Form X استعان only 4×: 1:5, 2:45, 2:153, 7:128; root ع و ن only 11×|QAC|
|19|اهدنا only at 1:6 and 38:22 («واهدنا إلى سواء الصراط»)|Regex|
|20|Definite الصراط المستقيم only at 1:6 and 37:118 (Musa and Harun). Iblis says «صراطك المستقيم» at 7:16.|Regex|
|21|ṣirāṭ occurs 45×, always singular. Contrast «ولا تتبعوا السبل» (6:153).|QAC (one lemma, no plural form); Tanzil|
|22|المغضوب occurs only once in the whole Qur'an; root غ ض ب 24×|QAC|
|23|"Those You have favored" are named in 4:69 (prophets, siddiqin, shuhada', salihin). IK links the two verses.|IK 1:7; Tanzil|
|24|The 23 Fatihah lemmas make up 9,704 of 77,429 word tokens (12.5%)|QAC stem-lemma count|
|25|Makki (revelation order 5 in Quran.com metadata). Madani is also reported, from Abu Hurayrah and Mujahid.|Quran.com chapters; IK; ad-Dani|
|26|"Amin" is not part of the Qur'an|M 1:7; IK|

Caution: a root count groups words with distant meanings (قوم "people" and مستقيم "straight" share a root, as do ملك and مَلَك "angel"). Use lemma counts when a claim is about meaning.

## 5. Qira'at (mutawatir only)

| Place | Reading | Readers | Source |
|---|---|---|---|
|1:4|مَالِكِ (with alif)|'Asim, al-Kisa'i, Ya'qub, Khalaf|Nashr 1/271; Budur p.15|
| |مَلِكِ (no alif)|Nafi', Ibn Kathir, Abu 'Amr, Ibn 'Amir, Hamzah, Abu Ja'far|same|
|1:6–7|السراط (with sin)|Ruways; Qunbul (path of Ibn Mujahid / Shatibiyyah; other paths from Qunbul read sad)|Nashr 1/271–272|
| |Ishmam (sad mixed with a zay sound)|Khalaf 'an Hamzah everywhere. Khallad: the first place only per at-Taysir and ash-Shatibiyyah; other paths differ.|Nashr; Budur pp.15–16|
|1:7 عليهم|Dammah on the ha (عليهُم)|Hamzah, Ya'qub|Nashr 1/272–273; Budur p.16|
| |Mim al-jam' joined with a waw before a voweled letter|Ibn Kathir, Abu Ja'far, Qalun (khulf)|Nashr 1/273|
|1:7 الضالين|Madd lazim of 6 counts|All readers|Budur p.16|

Non-canonical (shadhdh) readings, such as الحمدَ, الحمدِ لِله, مَلَكَ يومَ and يُعبَد, are listed in al-Abyari's qira'at encyclopedia and in an-Nahhas. They must be labelled *shādhdh*, not Qur'an.

## 6. Authentic hadith

| Topic | Reference (sunnah.com numbering) | In platform corpus? |
|---|---|---|
|«لا صلاة لمن لم يقرأ بفاتحة الكتاب»|Bukhari 756; Muslim 394a|Yes (Muslim local id 874)|
|«قسمت الصلاة…» + «خداج»|Muslim 395a; Tirmidhi 2953|Muslim yes (local 878); Tirmidhi no|
|Greatest surah, as-Sab' al-Mathani|Bukhari 4474 (also 4647, 4703, 5006); Riyad 1009|Yes (Riyad local 330)|
|«أم القرآن هي السبع المثاني والقرآن العظيم»|Bukhari 4704|Yes|
|Ruqyah with the Fatihah|Bukhari 2276, 5007, 5736, 5749; Muslim 2201a|Yes (Muslim local 5733)|
|Two lights: the Fatihah and the end of al-Baqarah|Muslim 806; Riyad 1022|Yes (local 1877, 343)|
|Saying "Amin"|Bukhari 780; Muslim 410a|Yes|
|Fatihah in the funeral prayer|Bukhari 1335|Yes|
|"Nothing like it in the Tawrah/Injil…"|Tirmidhi 2875 (Tirmidhi grades it hasan sahih); Nasa'i 914|No|
|«الحمد لله أم القرآن…»|Tirmidhi 3124; Abu Dawud 1457|No|
|'Adi b. Hatim: maghdub / dallin|Tirmidhi 2954 (graded hasan by the mirror)|No (sensitive)|

Notes on the corpus files:
- How the numbers were checked: Muslim numbers were mapped with hadith-api's `arabicnumber` field and confirmed on amrayn.com, a sunnah.com mirror. sunnah.com itself returned HTTP 403.
- The local `api/data/muslim.json` and `riyad-as-salihin.json` still carry the old numbering. Per project memory, only the Qdrant payloads were migrated.
- `bukhari.json` and `riyad-as-salihin.json` have no Indonesian text.

## 7. Names of the Fatihah

| Name | Basis |
|---|---|
|Fatihat al-Kitab|Bukhari 756; Muslim 806|
|Umm al-Qur'an|Bukhari 4704; Muslim 395a|
|Umm al-Kitab|Bukhari 5007; Abu Dawud 1457. Ibn Sirin disliked this name (IK; Itqan).|
|As-Sab' al-Mathani|Q 15:87; Bukhari 4474/4704|
|Al-Qur'an al-'Azim|Bukhari 4474/4704|
|As-Salah|Muslim 395a (via IK)|
|Ar-Ruqyah|Bukhari 5007/5736|
|Al-Hamd|IK; ad-Dani's heading «سورة الحمد»|
|Ash-Shifa'|ad-Darimi report via IK (grade UNVERIFIED)|
|Al-Asas / al-Wafiyah / al-Kafiyah / al-Kanz|Ibn 'Abbas / Ibn 'Uyaynah / Yahya b. Abi Kathir / az-Zamakhshari (via IK)|
|25 names in total|as-Suyuti, al-Itqan 1/187–191|

## 8. UNVERIFIED

- Print page numbers for J, M, N, S and Ibn Kathir (URLs are given instead).
- The Indonesian translation (Quran.com resource 33 "Indonesian Islamic Affairs Ministry") appears to be the Kemenag 2019 edition, judging only from its wording ("Maha Pengasih, Maha Penyayang").
- The license and reciter of Quran.com's word-by-word glosses and word audio.
- The as-Susi idgham "الرحيم ملك".
- The Ibn Sa'd report (in D and J) that the basmalah was adopted in stages.
- al-Jadwal's «حمد يحمد باب نصر»: حَمِدَ يَحْمَدُ belongs to the فَعِلَ–يَفْعَلُ class, so this looks like an error.

## SOURCES
- Quran.com API v4 — verses by chapter 1 with words (ID + EN word-by-word, Kemenag tr. id 33) | https://api.quran.com/api/v4/verses/by_chapter/1?words=true&language=id | Quran Foundation Developer Terms (effective 2026-10-04): revocable non-sublicensable license; no sale/redistribution of raw data; cache ≤1 week unless via Content Sync APIs; attribution required | Word segmentation (29 words), Uthmani word text, ID/EN word glosses, Kemenag translation
- Quran Foundation Developer Terms of Service | https://api-docs.quran.foundation/legal/developer-terms/ | Terms document | Licensing constraints for any Quran.com-sourced data
- Quran.com API v4 — chapters metadata | https://api.quran.com/api/v4/chapters?language=id | Quran Foundation Developer Terms | bismillah_pre (112 true; false for 1 and 9), revelation_place/order
- Quranic Arabic Corpus — word by word, chapter 1 | https://corpus.quran.com/wordbyword.jsp?chapter=1 | GNU GPL v3 + header: verbatim copies only, cite source and link corpus.quran.com | POS, case, Arabic grammar labels per word
- Quranic Arabic Corpus — Quran Dictionary root pages (e.g. q=Hmd) | https://corpus.quran.com/qurandictionary.jsp?q=Hmd | GNU GPL v3 (as above) | Root occurrence counts and derived-form breakdowns (matched the v0.4 file)
- Quranic Arabic Corpus morphology v0.4 (GitHub mirror; official download corpus.quran.com/download) | https://raw.githubusercontent.com/bnjasim/quranic-corpus/master/quranic-corpus-morphology-0.4.txt | GPL; Copyright 2011 Kais Dukes; 'CHANGING IT IS NOT ALLOWED'; attribution + link | Reproducible root/lemma/person counts, lemma coverage (12.5%)
- Quranic Arabic Corpus license page | https://corpus.quran.com/license.jsp | GNU GPL v3 | License verification
- Tanzil Quran text (Uthmani and Simple-Clean v1.1) | https://tanzil.net/download/ | CC BY 3.0 with no-modification clause; cite Tanzil and link tanzil.net | Phrase searches and counts, letter-absence check
- Darwish, I'rab al-Qur'an wa Bayanuh (tafsir.app view) | https://tafsir.app/iraab-aldarweesh/1/2 | Modern copyrighted work (Dar al-Irshad / al-Yamamah / Ibn Kathir, 4th ed. 1415H); cite and paraphrase only | I'rab of 1:2–1:7 (also /1/1 for the basmalah)
- Darwish on Shamela (bibliographic card; vol. 1 pp. 9, 14–15) | https://shamela.ws/book/2163 | Copyrighted; Shamela page numbers match the print | Edition and page verification
- Mahmud Safi, al-Jadwal fi I'rab al-Qur'an | https://tafsir.app/aljadwal/1/1 | Modern copyrighted work; cite and paraphrase | I'rab, sarf (wazn), balagha for each ayah
- al-Kharrat, al-Mujtaba min Mushkil I'rab al-Qur'an | https://tafsir.app/mujtaba-mushkil-iraab/1/7 | King Fahd Complex publication; copyright, terms UNVERIFIED | Concise i'rab (رب as badal; غير as badal; Amin not Qur'an)
- an-Nahhas, I'rab al-Qur'an | https://tafsir.app/iraab-alnahas/1/2 | Classical text in public domain; editor's footnotes copyrighted | Classical Basran/Kufan positions; non-canonical readings
- as-Samin al-Halabi, ad-Durr al-Masun | https://tafsir.app/aldur-almasoon/1/2 | Classical, public domain; edition apparatus copyrighted | Lam of istihqaq; al- in al-hamd; options for غير (1:7)
- Ibn al-Jazari, an-Nashr fi al-Qira'at al-'Ashr | https://tafsir.app/alnashir/1/6 | Classical, public domain | Mutawatir variants: مالك/ملك, الصراط, عليهم, mim al-jam' (1/271–273)
- 'Abd al-Fattah al-Qadi, al-Budur az-Zahirah (islamweb) | https://www.islamweb.net/ar/library/content/229/8/%D8%A7%D9%84%D8%B1%D8%A8%D8%B9-%D8%A7%D9%84%D8%A3%D9%88%D9%84-%D9%85%D9%86-%D8%A7%D9%84%D8%AC%D8%B2%D8%A1-%D8%A7%D9%84%D8%A3%D9%88%D9%84 | Modern work; copyright UNVERIFIED | Summary of the ten mutawatir readings in the Fatihah (pp. 15–16)
- al-Abyari, al-Qira'at — al-Mawsu'ah al-Qur'aniyyah | https://tafsir.app/qiraat-almawsoah/1/4 | Modern copyrighted work | Shadhdh readings list (to label, not to teach as Qur'an)
- Ibn Kathir, Tafsir al-Qur'an al-'Azim (platform corpus api/data/tafsir-ibn-kathir.json; also tafsir.app/ibn-katheer) | https://tafsir.app/ibn-katheer/1/1 | Classical text public domain; digital edition source UNVERIFIED | Names, Makki/Madani, 7 ayat, 25 words, 4:69 link, 'atf bayan option, trait-based framing of maghdub/dallin
- ad-Dani, al-Bayan fi 'Add Ay al-Qur'an, Surat al-Hamd (p.139) | https://shamela.ws/book/5542/121 | Classical; ed. Ghanim Qadduri al-Hamad (Kuwait 1414H) | Verse-count differences (basmalah vs أنعمت عليهم), 25 words, 120 letters
- as-Suyuti, al-Itqan, Naw' 17 (vol. 1 pp. 187–191) | https://shamela.ws/book/11728/180 | Classical, public domain | 25 names of the Fatihah; 7 absent letters report
- Sahih Muslim 395a (sunnah.com; verified via amrayn mirror) | https://sunnah.com/muslim:395a | Arabic matn public domain; English translations copyrighted by publishers; sunnah.com terms UNVERIFIED | Qasamtu as-salah; khidaj
- amrayn.com hadith mirror (sunnah.com numbering) | https://amrayn.com/muslim:394a | Mirror; terms UNVERIFIED | Confirming Muslim 394a/395a/410a/806/2201a, Bukhari 756/4474/4704/5007, Tirmidhi 2875/2953/2954/3124, Abu Dawud 1457, Nasa'i 914
- Riyad as-Salihin 1009 (sunnah.com) | https://sunnah.com/riyadussalihin:1009 | As sunnah.com | Canonical number of the greatest-surah hadith (local id 330)
- Riyad as-Salihin 1022 (sunnah.com) | https://sunnah.com/riyadussalihin:1022 | As sunnah.com | Canonical number of the two-lights hadith (local id 343)
- fawazahmed0 hadith-api (eng-muslim/878.json) | https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/eng-muslim/878.json | Repo license UNVERIFIED; translations' underlying copyright unclear | Mapping local Muslim ids to Abdul Baqi numbers (arabicnumber)
- Platform hadith corpus files (local, read-only) | file:///Users/mbairm3512/Documents/SuksesBerkah/dakwah-lens/api/data/ | Internal | Checking which Fatihah hadith exist in Bukhari/Muslim/Riyad and whether they have Indonesian text
- PMA No. 44 Tahun 2016 tentang Penerbitan, Pentashihan, dan Peredaran Mushaf Al-Qur'an | https://tashih.kemenag.go.id/uploads/1/2018-05/pma_nomor_44_tahun_2016.pdf | Indonesian regulation | Pasal 1(1): a mushaf includes parts of surahs/ayat, print or digital; Pasal 2: Surat Tanda Tashih required; Pasal 8: the text itself has no copyright
- Pedoman Transliterasi Arab-Latin (SKB Menag & Mendikbud 158/1987, 0543b/U/1987) | https://lib.ui.ac.id/detail?id=20501763&lokasi=lokal | Government standard | Indonesian transliteration standard for the translit column