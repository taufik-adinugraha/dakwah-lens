# Waris track: the dalil inventory

Researcher: DALIL · written 2026-10-09 · status: research input, **not reviewed by an ustadz**.

- **Companion data file:** `docs/waris-research/dalil.json`, one JSON array of 228 records:
  - 1 meta record;
  - 13 Qur'an ayat;
  - 46 hadith (Bukhari 18, Muslim 10, Bulugh 18);
  - 26 fiqh excerpts and 19 tafsir excerpts;
  - 82 section pointers;
  - 41 rule records.
- **Where the Arabic lives:** every Arabic string sits in the JSON, copied by script from the source files. Nothing was retyped.
- **Arabic in this page:** only the tables in sections 2.2 and 3.2 show Arabic, and those cells were generated from the JSON. Everything else here refers to record ids.
- **Every lesson citation must point to a record id in `dalil.json`.** If a rule isn't there, the lesson does not state it. Section 7 lists what is missing.

---

## 0. Key findings

1. **Every core share is grounded in the corpus.** The Qur'an text covers all six fixed shares: 4:11, 4:12 and 4:176.
   - The strongest hadith for "fixed shares first, the rest to the nearest male" (*'ashabah*) are in both Sahihs: Bukhari 6732 and Muslim 1615a.
   - The same goes for the difference-of-religion barrier (Bukhari 6764, Muslim 1614), the one-third cap on a bequest (*wasiat*: Bukhari 2742, Muslim 1628a), and Ibn Mas'ud's ruling on a daughter, a son's daughter and a sister (Bukhari 6736).

2. **Several famous dalil exist in the corpus only second-hand, or not at all.**
   - **Sa'd ibn ar-Rabi''s two daughters (2/3):** only via Fiqh as-Sunnah 840 and the two tafsirs.
   - **Abu Bakr and the grandmother's sixth (al-Mughira / Muhammad ibn Maslama):** not found.
   - **'Umar and the first *'aul* (proportional reduction):** Fiqh as-Sunnah says only *ruwiya*, "it was reported", with no chain.
   - **"Learn the fara'id":** found only without grades, or graded weak (*da'if*).
   - All four are marked **needs external source**.

3. **Some rules are not stated by any marfu' hadith in the corpus.** They rest on the *kalalah* ayat (4:12, 4:176) plus reported consensus (*ijma'*):
   - **That a father blocks the deceased's siblings:** Ibn Kathir 4:176 says "by consensus" (بالإجماع); al-Tabari 4:11 says "there is no disagreement" (لا خلاف).
   - **That debt comes before a bequest:** al-Shafi'i in al-Umm 572, and Ibn Kathir 4:11.
   - In both cases the lesson should say it as "para ulama sepakat" and cite those passages.

4. **Several rules are disputed (*khilaf*) inside the corpus itself.** The calculator needs an explicit MUI or KHI choice for each:
   - giving the surplus back to the share-holders (*radd*), including to a spouse;
   - relatives who are neither share-holders nor *'ashabah* (*dzawil arham*);
   - the grandfather together with the deceased's siblings;
   - an accidental killer;
   - a bequest to an heir that the other heirs approve.
   - `standard.md` (the STANDARD researcher) covers what the KHI says on each.

5. **The killer barrier is weaker as a hadith than people assume.**
   - Bulugh 1107 carries Ibn Hajar's own remark that "the correct view is that it is *mawquf* on 'Umar" (a Companion's ruling, not the Prophet's words). The editor's footnote says al-Albani authenticated it (*Irwa'* 1671).
   - The firmest line in the corpus is al-Shafi'i's statement that he knows of no disagreement for a *deliberate* killer (al-Umm 550).

6. **Qur'an text: the track cannot ship the Arabic in `api/data/quran.json` as-is.**
   - None of the 13 ayat in `quran.json` is byte-identical to the pinned Tanzil Uthmani v1.1 file the Belajar module uses (`belajar/pipeline/cache/tanzil/quran-uthmani.txt`, sha256 `bf4f57b9…`).
   - `quran.json` adds pause marks, the rub' al-hizb sign and the small tanwin/iqlab marks.
   - The JSON therefore carries the Tanzil bytes as `ar`, and keeps the platform string only for comparison.

7. **Indonesian translation:** `quran.json` "id" is the old `id.indonesian` edition, which is for non-commercial use and carries typos ("bagahian", "seduah", "mukmim").
   - I fetched QuranEnc `indonesian_affairs` v1.0.1 for surahs 2, 4, 8 and 33. Its version-list sha256 matches the Belajar pin.
   - Each Qur'an record carries that text and its footnotes, labelled exactly as QuranEnc names it.
   - Some QuranEnc footnotes are rulings in their own right, e.g. [180] "not more than 1/3", [182], [60] and [667]. A lesson that shows them must show them whole, and must not present them as Qur'an.

8. **Hadith numbering traps (both now handled in the JSON):**
   - **Sahih Muslim:** the local `muslim.json` keys and `citation_en` use the fawazahmed0 *sequential* number. For example, local "Sahih Muslim 4140" is canonical **1614**. I remapped with fawazahmed0's `arabicnumber`, the same rule as `download_hadith.py`, and checked the Arabic is byte-identical.
   - **Bulugh al-Maram:** the corpus still uses AhmedBaset's own numbers (inheritance section = local 1095–1110; bequests = 1111–1119).
     - **The sunnah.com canonical numbers are unresolved.** sunnah.com returned a Cloudflare challenge to curl and HTTP 403 to WebFetch.
     - tohed.com uses a third numbering (805–817).
     - **Do not show a Bulugh number to users until it is resolved.**

9. **Translations needing care:**
   - **Bukhari and Bulugh:** these have English only.
   - **Muslim:** the Indonesian is the operator's in-house translation (per project memory). It is not a published edition.
   - **Mistranslated English lines that must not be shown:**
     - Bukhari 6752 has "Wala' is for the *manumitted*"; the Arabic means the one who frees the slave.
     - Bulugh 1106 has "treated as a *hair*" (should be "heir").
     - Bukhari 6733 has a garbled "Onethird".

10. **Some parts of the fiqh sources are partial or foreign:**
    - **Fiqh as-Sunnah:** the corpus is chunked with gaps. Section 846 stops mid-list and 847 starts mid-sentence, so the full table of each heir's cases is missing.
    - **Egyptian law:** Fiqh as-Sunnah also quotes Egyptian inheritance law, including the *wasiyya wajiba* law No. 71/1946. That is **not** Indonesian law.
    - **Fath al-Mu'in:** its text has matn and commentary interleaved with print artefacts.
    - **Fath al-Qarib** is the cleanest source for the Syafi'i core: the heirs, the barriers, the six shares, who blocks whom (*hajb*), and bequests.

---

## 1. How this was built

### Inputs

| Input | Path | What I used it for |
|---|---|---|
| Qur'an text | `belajar/pipeline/cache/tanzil/quran-uthmani.txt` (Tanzil Uthmani v1.1, sha256 `bf4f57b968d0…312c8`, pinned in `belajar/pipeline/sources.json`) | Canonical `ar` of every Qur'an record |
| Platform Qur'an | `api/data/quran.json` (built by `api/src/api/scripts/download_quran.py` from AlQuran.cloud `quran-uthmani` / `id.indonesian` / `en.sahih`) | Comparison only (`ar_quran_json`, `id_quran_json`, `en_quran_json`) |
| QuranEnc ID | `https://quranenc.com/api/v1/translation/sura/indonesian_affairs/{2,4,8,33}`, fetched 2026-10-09 into the scratchpad. The version list (`translations/list/id`) has sha256 `2b147ba8…d2dc`, identical to the Belajar pin. | `translations.id_quranenc_indonesian_affairs` (+ footnotes) |
| Hadith | `api/data/bukhari.json`, `muslim.json`, `bulugh-al-maram.json` | `ar` and `en` (plus `id` for Muslim) copied as whole fields |
| Muslim canonical numbers | fawazahmed0 `editions/ara-muslim/sections/{23,25}.json` (jsDelivr CDN) | `hadithnumber` → `arabicnumber` → "1615a" style, using the same rule as `_muslim_canonical_citation` in `download_hadith.py`; Arabic checked byte-identical before mapping |
| Fiqh | `api/data/fath-al-qarib.json`, `fath-al-muin.json`, `fiqh-as-sunnah.json`, `al-umm.json` | Excerpts located by a harakat-insensitive regex between a start phrase and an end phrase; `char_range` stored |
| Tafsir | `api/data/tafsir-ibn-kathir.json`, `tafsir-al-tabari.json` (one record per ayah, Arabic) | Same excerpt method |

### Method

- **The build:** a script in the session scratchpad (`build_dalil.py`, with helper `ar.py`) builds the JSON, then checks itself.
  - **Qur'an:** each `ar` must equal the Tanzil line.
  - **Fiqh and tafsir:** each excerpt must equal `source[char_range]`.
- **Independent check:** a second script confirmed that all 275 copied strings (Arabic, translations, footnotes, grade words) are verbatim substrings of their source files. 0 failures.
- **Search:** Arabic search used normalised text (harakat and tatweel stripped; أ/إ/آ/ٱ→ا, ى→ي, ة→ه). The excerpt itself is always cut from the original, vocalised string.
- **Scratchpad:** the scripts are not in the repo. If the track needs the extraction to be re-runnable, the pipeline owner should move `build_dalil.py` into `belajar/pipeline/` (I was told not to edit there).

### What a record looks like (abridged)

```json
{"id": "H-MUSLIM-1615a", "kind": "hadith", "citation": "Sahih Muslim 1615a",
 "local_hadithnumber": 4141, "local_citation_en": "Sahih Muslim 4141",
 "ar": "<verbatim>", "translations": {"en": {...}, "id": {...}},
 "grade_field": "[]", "url": "https://sunnah.com/muslim:1615a",
 "grounds": ["R-furudh-then-asabah"], "gist_id": "...", "notes": []}
```

- **Rule records:** `{"id": "R-…", "kind": "rule", "statement_id", "strongest": [ids], "supporting": [ids], "status": "found|partial|external", "caveat"}`.
- **Bulugh records** also carry:
  - `ar_matn_and_ibn_hajar_attribution`: the hadith text plus Ibn Hajar's "rawahu…" attribution;
  - `ar_tahqiq_footnote`: the editor's notes on its sources and grade;
  - `grades_from_tahqiq_footnotes`: the grade words cut out of that footnote.

---

## 2. Qur'an

### 2.1 Which text and which translation, and what that means for this track

**What `api/data/quran.json` carries** (from its producer script `api/src/api/scripts/download_quran.py`):

| Field | Edition | Licence | Problems |
|---|---|---|---|
| `arabic` | AlQuran.cloud `quran-uthmani` (Tanzil Uthmani **with** optional marks) | Tanzil: CC BY 3.0 + verbatim only, https://tanzil.net/docs/text_license | 1:1 starts with U+FEFF; basmalah glued to ayah 1 (`docs/belajar-plan.md` §5.2) |
| `id` | Tanzil / AlQuran.cloud `id.indonesian` (the older Indonesian edition) | Non-commercial only, https://tanzil.net/trans/ | Typos in the waris ayat: "bagahian" and "seduah" (4:11–12), "mukmim" (33:6) |
| `en` | `en.sahih` (Sahih International) | Non-commercial only, https://tanzil.net/trans/ | — |

**Measured on the 13 waris ayat:**
- **No ayah is byte-identical** between `quran.json` and the pinned Tanzil v1.1 file. Across the whole Qur'an, 1,876 of 6,236 ayat are identical.
- **The extra code points in `quran.json` are all optional annotation marks:**
  - pause marks: U+06D6, U+06D7, U+06DA;
  - U+06DE (rub' al-hizb), at the start of 4:12;
  - U+06E2 and U+06ED (small meem marks for iqlab and idgham);
  - the spaces that go with them.
- **The pinned Tanzil file was fetched without those options** (see `belajar/pipeline/sources.json`), so each space-separated token in it is one word.

**What this means for the waris track:**
1. **Arabic text.**
   - Use the **Tanzil v1.1 bytes**, the `ar` field of every `Q-*` record, so the track obeys the module rule that Qur'anic text equals Tanzil Uthmani byte for byte (`docs/belajar-plan.md` §5.1 and the CI check in §7.5 stage 6).
   - Do not take Arabic from `quran.json`, from the RAG API, or from the briefing corpus.
   - Credit Tanzil and link https://tanzil.net, as its licence requires.
2. **Indonesian translation.**
   - Use **QuranEnc `indonesian_affairs` v1.0.1**, labelled exactly as QuranEnc names it ("Terjemahan Berbahasa Indonesia - Kementerian Agama"), with its version number.
   - Do **not** call it "Kemenag 2019": the official LPMQ v1122 text differs from it (`docs/belajar-research/quran-data.md`).
   - Do not use the `id.indonesian` text from `quran.json` (old edition, typos, non-commercial).
3. **QuranEnc footnotes are interpretations, not Qur'an.**
   - These footnotes state fiqh positions:
     - **[60] on 2:180:** that verse was abrogated for heirs, and a bequest stays within one third.
     - **[180] on 4:8:** a gift to the relatives present at the division stays within one third.
     - **[182] on 4:12:** what counts as harming the heirs.
     - **[251] on 4:176:** *kalalah* means someone with no father and no child.
     - **[667] on 33:6:** the kindness meant there is a bequest within one third.
   - QuranEnc forbids modification, so a lesson either shows a footnote **whole and labelled as the translator's note**, or leaves it out.
   - The rules themselves are grounded separately in the hadith and tafsir records.
4. **If the module becomes paid** (e.g. bundled with Kelas), the Tanzil translations are excluded and QuranEnc's conditions must be re-checked (`docs/belajar-research/quran-data.md`, "Decision needed: free or paid?").
5. **Qur'an 4:141 is included** because MUI Fatwa 5/MUNAS VII/MUI/9/2005 cites it for the difference-of-religion barrier (source: `standard.md` §1.1). Its wording is about the disbelievers' "way over the believers", not about inheritance. A lesson should present it as "dalil yang dikutip MUI", not as a verse *about* waris.

### 2.2 The ayat (Arabic = first words of the Tanzil bytes; full text, translations and footnotes in `dalil.json`)

| Record | Ayah | Opening (Tanzil v1.1) | What it grounds (gist, ID) | Rules |
|---|---|---|---|---|
| `Q-4-7` | QS An-Nisa' [4]: 7 | لِّلرِّجَالِ نَصِيبٌ مِّمَّا تَرَكَ ٱلْوَٰلِدَانِ … | Laki-laki dan perempuan sama-sama punya hak waris dari orang tua dan kerabat; bagiannya ditetapkan. | `R-women-inherit` |
| `Q-4-8` | QS An-Nisa' [4]: 8 | وَإِذَا حَضَرَ ٱلْقِسْمَةَ أُو۟لُوا۟ ٱلْقُرْبَىٰ … | Kerabat bukan ahli waris, anak yatim dan orang miskin yang hadir saat pembagian diberi sekadarnya dan dijawab dengan kata yang baik. | `R-gift-at-division` |
| `Q-4-11` | QS An-Nisa' [4]: 11 | يُوصِيكُمُ ٱللَّهُ فِىٓ أَوْلَٰدِكُمْ لِلذَّكَرِ … | Ayat inti: anak (2:1, satu putri 1/2, putri >2 2/3), ayah-ibu (1/6, ibu 1/3 atau 1/6), setelah wasiat dan utang. | `R-debt-wasiyya-first`, `R-2to1`, `R-daughters`, `R-parents`, `R-mother-third-sixth` |
| `Q-4-12` | QS An-Nisa' [4]: 12 | وَلَكُمْ نِصْفُ مَا تَرَكَ أَزْوَٰجُكُمْ … | Suami (1/2 atau 1/4), istri (1/4 atau 1/8), saudara seibu dalam kalalah (1/6 atau berbagi 1/3), wasiat tanpa menyusahkan ahli waris. | `R-spouses`, `R-maternal-siblings`, `R-debt-wasiyya-first`, `R-no-harm-wasiyya` |
| `Q-4-13` | QS An-Nisa' [4]: 13 | تِلْكَ حُدُودُ ٱللَّهِ وَمَن يُطِعِ … | Pembagian ini adalah batas-batas Allah; taat kepadanya dijanjikan surga. | `R-obligation` |
| `Q-4-14` | QS An-Nisa' [4]: 14 | وَمَن يَعْصِ ٱللَّهَ وَرَسُولَهُۥ وَيَتَعَدَّ … | Melanggar batas-batas ini diancam neraka. | `R-obligation` |
| `Q-4-33` | QS An-Nisa' [4]: 33 | وَلِكُلٍّ جَعَلْنَا مَوَٰلِىَ مِمَّا تَرَكَ … | Allah menetapkan ahli waris bagi setiap harta peninggalan; ayat ini juga dibahas sebagai penghapus waris karena sumpah setia (lihat Bukhari 6747/4580). | `R-kinship-priority`, `R-no-inheritance-by-oath` |
| `Q-4-141` | QS An-Nisa' [4]: 141 | ٱلَّذِينَ يَتَرَبَّصُونَ بِكُمْ فَإِن كَانَ … | Allah tidak memberi jalan bagi orang kafir atas orang mukmin - dikutip Fatwa MUI 5/MUNAS VII/MUI/9/2005 (kewarisan beda agama) sebagai dalil; lihat docs/waris-research/standard.md 1.1. Ayat ini sendiri tidak menyebut waris. | `R-barrier-religion` |
| `Q-4-176` | QS An-Nisa' [4]: 176 | يَسْتَفْتُونَكَ قُلِ ٱللَّهُ يُفْتِيكُمْ فِى … | Kalalah: saudari kandung/seayah 1/2, dua saudari 2/3, saudara laki-laki mewarisi semuanya, campuran 2:1. | `R-siblings-kalala`, `R-2to1`, `R-hajb-siblings` |
| `Q-8-75` | QS Al-Anfal [8]: 75 | وَٱلَّذِينَ ءَامَنُوا۟ مِنۢ بَعْدُ وَهَاجَرُوا۟ … | Kerabat lebih berhak satu sama lain dalam Kitab Allah. | `R-kinship-priority`, `R-dzawil-arham` |
| `Q-33-6` | QS Al-Ahzab [33]: 6 | ٱلنَّبِىُّ أَوْلَىٰ بِٱلْمُؤْمِنِينَ مِنْ أَنفُسِهِمْ … | Kerabat sedarah lebih berhak (waris-mewarisi) daripada ikatan iman/hijrah; kebaikan kepada saudara seagama lewat wasiat (catatan QuranEnc [667]). | `R-kinship-priority`, `R-no-inheritance-by-oath` |
| `Q-2-180` | QS Al-Baqarah [2]: 180 | كُتِبَ عَلَيْكُمْ إِذَا حَضَرَ أَحَدَكُمُ … | Kewajiban wasiat untuk orang tua dan kerabat; status hukumnya (nasakh) dibahas di tafsir. | `R-wasiyya-history` |
| `Q-2-240` | QS Al-Baqarah [2]: 240 | وَٱلَّذِينَ يُتَوَفَّوْنَ مِنكُمْ وَيَذَرُونَ أَزْوَٰجًا … | Wasiat nafkah setahun untuk janda; status hukumnya (nasakh) dibahas di tafsir. | `R-wasiyya-history` |

### 2.3 Abrogation (*naskh*): what the corpus actually says

Only cited tafsir and hadith records are used here. Each line is a "who said what"; none of it is a ruling. The lesson should present the result, and mention the discussion only if it helps.

**2:180: bequests to parents and relatives (*al-wasiyya lil-walidayn wal-aqrabin*)**

| View | Records |
|---|---|
| Abrogated by the inheritance ayat. Ibn Kathir says the obligation to bequeath to *inheriting* parents and relatives is abrogated "by consensus" and, beyond that, forbidden by "لا وصية لوارث". He also reports the view "abrogated for those who inherit, still in force for those who don't", and notes that by later usage this is not called *naskh*. | `T-IK-2-180-naskh` |
| Ibn 'Abbas: "the property used to go to the child and the bequest to the parents; Allah abrogated of that what He wished…" | `H-BUKHARI-6739` (= 2747, 4578) |
| Al-Tabari's own preference: a bequest is still *obligatory* for anyone leaving property, for parents and relatives **who do not inherit**. This is a minority position against the jumhur. | `T-TB-2-180-view` |

**2:240: a year's maintenance for the widow**

| View | Records |
|---|---|
| Most scholars: abrogated. Ibn 'Abbas: abrogated by the inheritance ayah, which gives the widow 1/8 or 1/4; the waiting period (*'iddah*) by 2:234. 'Uthman to Ibn az-Zubayr: "I do not change anything of it from its place." | `T-IK-2-240-naskh` |
| Al-Tabari: the maintenance was abrogated by the inheritance ayah; residence was reduced to four months and ten days. | `T-TB-2-240-naskh` |

**4:8: giving to relatives, orphans and the poor present at the division**

| View | Records |
|---|---|
| Ibn 'Abbas: *muhkamah wa laysat bi-mansukhah* (in force, not abrogated). | `H-BUKHARI-4576`; quoted in `T-IK-4-7-muhkam` |
| Al-Tabari: in force, and it concerns bequests. | `T-TB-4-8-muhkam` |
| "Abrogated by the inheritance ayat". Ibn Kathir attributes this to "the jumhur of the fuqaha and the four imams". | `T-IK-4-8-naskh` |

**Lesson consequence:** present 4:8 as a recommended kindness (sunnah, *adab*), never as a share.

**4:33 and 33:6: inheritance by oath or brotherhood**

| View | Records |
|---|---|
| The Muhajirun used to inherit from the Ansar through the brotherhood the Prophet made between them. "When *wa likullin ja'alna mawaliya* came down, it was abrogated". What remains is help, support, counsel and a bequest. | `H-BUKHARI-6747` (= 4580) |
| Inheritance by oath was an early-Islam ruling that was later abrogated. | `T-IK-4-33-hilf` |
| Ibn Kathir reports al-Tabari's view that the "share" in 4:33 means help, not inheritance, and he disputes it. | the same 4:33 record, `S-IK-4-33` |

---

## 3. Hadith

### 3.1 Numbering: read this before citing

- **Sahih al-Bukhari:** the corpus number equals sunnah.com (fawazahmed0 `hadithnumber`). Fara'id = book 85 (6723–6771); Wasaya = book 55 (2738–2781). URL pattern: `https://sunnah.com/bukhari:<n>`.
- **Sahih Muslim:** the local `muslim.json` is **not canonical**. Its `hadithnumber`, `citation_en` and `citation_id` all carry the fawazahmed0 sequential number.
  - Local 4140–4162 = Kitab al-Fara'id = canonical **1614–1619f**.
  - Local 4204–4234 = Kitab al-Wasiyya = canonical **1627a–1637c**.
  - The JSON id uses the canonical number and keeps `local_hadithnumber`.
  - Production Qdrant was migrated on 2026-06-23 (project memory), so `retrieve_by_citation("Sahih Muslim 1615a")` should resolve. The local JSON file was not migrated.
- **Bulugh al-Maram: unresolved.**
  - **What the corpus has:** AhmedBaset's own `idInBook` numbering. AhmedBaset scraped sunnah.com (https://github.com/AhmedBaset/hadith-json), but its numbering is known not to match sunnah.com canonical numbers (project memory, *hadith-canonical-numbering*).
  - **Where the chapter sits:** the inheritance chapter is corpus book 7. It follows the lost-property (luqata) entries (1093–1094), and entry 1121 closes the book.
  - **Corpus numbers:** the inheritance hadith are 1095–1110 and the bequest hadith 1111–1119.
  - **Why it is still open:** sunnah.com returned a Cloudflare challenge to `curl` and HTTP 403 to WebFetch, so I could not read the canonical numbers.
  - **Another numbering, not sunnah.com's:** tohed.com numbers the same 13 inheritance entries 805–817 (https://en.tohed.com/hadith/bulugh-al-maram/chapter/730/sub/22474/). This is stored as `cross_numbering`.
  - **Rule:** show users the *primary* source named in Ibn Hajar's attribution and the editor's footnote (e.g. "HR Abu Dawud 3565, at-Tirmidzi 2120"), not a Bulugh number, until the operator resolves the canonical numbers (sunnah.com API key, or a manual read of the Bulugh book 7 page).
- **Grades:**
  - The `grades` field is empty (`[]`) for every Bukhari, Muslim and Bulugh record used here.
  - For Bukhari and Muslim, the grade comes from the collection itself (both Sahih).
  - For Bulugh, the only grades in the corpus are in the **editor's footnote**, which the JSON splits out. The editor calls al-Albani "شيخنا" and refers to "بالأصل", his larger work. The edition and editor are **not named** in the corpus file (my web search did not settle it), so verify before attributing a grade to a named scholar.

### 3.2 The hadith set

Arabic column: about 10 words cut from the record, starting at the operative phrase. For Bulugh it is the text between Ibn Hajar's braces. The full text is in `dalil.json`.

| Record | Citation | Operative words | Grade in corpus | Gist (ID) | Rules |
|---|---|---|---|---|---|
| `H-BUKHARI-6732` | Sahih al-Bukhari 6732 = 6735, 6737, 6746 | أَلْحِقُوا الْفَرَائِضَ بِأَهْلِهَا، فَمَا بَقِيَ فَهْوَ لأَوْلَى رَجُلٍ ذَكَرٍ ‏"‏‏.‏ | Sahih collection (field empty) | Berikan bagian pasti kepada pemiliknya; sisanya untuk laki-laki terdekat. | `R-furudh-then-asabah` |
| `H-BUKHARI-6736` | Sahih al-Bukhari 6736 = 6742 | أَقْضِي فِيهَا بِمَا قَضَى النَّبِيُّ صلى الله عليه وسلم ‏ "‏ لِلاِبْنَةِ النِّصْفُ، وَلاِبْنَةِ … | Sahih collection (field empty) | Putri 1/2, cucu putri dari anak laki-laki 1/6 (penyempurna 2/3), sisanya untuk saudari - putusan Nabi menurut Ibnu Mas'ud. | `R-sons-daughter-sixth`, `R-sister-asabah-maal-ghayr` |
| `H-BUKHARI-6734` | Sahih al-Bukhari 6734 = 6741 | فَأَعْطَى الاِبْنَةَ النِّصْفَ وَالأُخْتَ النِّصْفَ‏.‏ | Sahih collection (field empty) | Mu'adh di Yaman: putri 1/2, saudari 1/2. *Putusan Mu'adh sendiri (atsar), bukan sabda Nabi ﷺ; Sulaiman's chain in 6741 omits "على عهد رسول الله" (review 2026-10-09).* | `R-sister-asabah-maal-ghayr` |
| `H-BUKHARI-6739` | Sahih al-Bukhari 6739 = 2747, 4578 | كَانَ الْمَالُ لِلْوَلَدِ، وَكَانَتِ الْوَصِيَّةُ لِلْوَالِدَيْنِ، فَنَسَخَ اللَّهُ مِنْ ذَلِكَ … | Sahih collection (field empty) | Ibnu Abbas: dulu harta untuk anak dan wasiat untuk orang tua; Allah menghapus sebagian dan menetapkan 2:1, 1/6 orang tua, 1/8-1/4 istri, 1/2-1/4 suami. | `R-2to1`, `R-parents`, `R-spouses`, `R-wasiyya-history` |
| `H-BUKHARI-6764` | Sahih al-Bukhari 6764 | لاَ يَرِثُ الْمُسْلِمُ الْكَافِرَ، وَلاَ الْكَافِرُ الْمُسْلِمَ ‏"‏‏.‏ | Sahih collection (field empty) | Muslim tidak mewarisi kafir dan kafir tidak mewarisi Muslim. | `R-barrier-religion` |
| `H-BUKHARI-2742` | Sahih al-Bukhari 2742 = 6733, 2744 | فَالثُّلُثُ، وَالثُّلُثُ كَثِيرٌ، إِنَّكَ أَنْ تَدَعَ وَرَثَتَكَ أَغْنِيَاءَ خَيْرٌ مِنْ … | Sahih collection (field empty) | Sa'd bin Abi Waqqash: wasiat sepertiga, dan sepertiga itu banyak; meninggalkan ahli waris kaya lebih baik. | `R-wasiyya-third` |
| `H-BUKHARI-2743` | Sahih al-Bukhari 2743 | لَوْ غَضَّ النَّاسُ إِلَى الرُّبْعِ، لأَنَّ رَسُولَ اللَّهِ صلى الله … | Sahih collection (field empty) | Ibnu Abbas: sebaiknya orang menurunkan wasiat ke seperempat. | `R-wasiyya-third` |
| `H-BUKHARI-2738` | Sahih al-Bukhari 2738 | مَا حَقُّ امْرِئٍ مُسْلِمٍ لَهُ شَىْءٌ، يُوصِي فِيهِ يَبِيتُ لَيْلَتَيْنِ، … | Sahih collection (field empty) | Muslim yang punya sesuatu untuk diwasiatkan hendaknya wasiatnya tertulis. | `R-write-wasiyya` |
| `H-BUKHARI-6731` | Sahih al-Bukhari 6731 = 6745, 6763 | فَمَنْ مَاتَ وَعَلَيْهِ دَيْنٌ، وَلَمْ يَتْرُكْ وَفَاءً، فَعَلَيْنَا قَضَاؤُهُ، وَمَنْ … | Sahih collection (field empty) | Nabi menanggung utang mukmin yang wafat tanpa harta; harta peninggalan untuk ahli waris. | `R-debt-wasiyya-first` |
| `H-BUKHARI-6745` | Sahih al-Bukhari 6745 | فَمَنْ مَاتَ وَتَرَكَ مَالاً فَمَالُهُ لِمَوَالِي الْعَصَبَةِ، وَمَنْ تَرَكَ كَلاًّ … | Sahih collection (field empty) | Siapa meninggalkan harta, hartanya untuk 'ashabah. | `R-furudh-then-asabah` |
| `H-BUKHARI-6738` | Sahih al-Bukhari 6738 | فَإِنَّهُ أَنْزَلَهُ أَبًا‏.‏ أَوْ قَالَ قَضَاهُ أَبًا‏.‏ | Sahih collection (field empty) | Abu Bakar menempatkan kakek seperti ayah (riwayat Ibnu Abbas). | `R-grandfather` |
| `H-BUKHARI-6744` | Sahih al-Bukhari 6744 | آخِرُ آيَةٍ نَزَلَتْ خَاتِمَةُ سُورَةِ النِّسَاءِ ‏{‏يَسْتَفْتُونَكَ قُلِ اللَّهُ يُفْتِيكُمْ … | Sahih collection (field empty) | Al-Bara': ayat terakhir yang turun adalah penutup An-Nisa' (4:176). | `R-siblings-kalala` |
| `H-BUKHARI-6723` | Sahih al-Bukhari 6723 = 6743 | كَيْفَ أَقْضِي فِي مَالِي فَلَمْ يُجِبْنِي بِشَىْءٍ حَتَّى نَزَلَتْ آيَةُ … | Sahih collection (field empty) | Jabir sakit dan bertanya tentang hartanya; lalu turun ayat waris (tanpa menyebut ayat mana). | `R-asbab-nuzul` |
| `H-BUKHARI-4577` | Sahih al-Bukhari 4577 | فَنَزَلَتْ ‏{‏يُوصِيكُمُ اللَّهُ فِي أَوْلاَدِكُمْ‏}‏ | Sahih collection (field empty) | Jabir: lalu turun "Yushikumullah fi auladikum" (4:11). | `R-asbab-nuzul` |
| `H-BUKHARI-6747` | Sahih al-Bukhari 6747 = 4580 | كَانَ الْمُهَاجِرُونَ حِينَ قَدِمُوا الْمَدِينَةَ يَرِثُ الأَنْصَارِيُّ الْمُهَاجِرِيَّ دُونَ ذَوِي … | Sahih collection (field empty) | Ibnu Abbas: waris Muhajirin-Anshar karena persaudaraan dihapus oleh 4:33. | `R-no-inheritance-by-oath` |
| `H-BUKHARI-4576` | Sahih al-Bukhari 4576 | هِيَ مُحْكَمَةٌ وَلَيْسَتْ بِمَنْسُوخَةٍ‏.‏ تَابَعَهُ سَعِيدٌ عَنِ ابْنِ عَبَّاسٍ‏.‏ | Sahih collection (field empty) | Ibnu Abbas: ayat 4:8 muhkam, tidak mansukh. | `R-gift-at-division` |
| `H-BUKHARI-2759` | Sahih al-Bukhari 2759 | إِنَّ نَاسًا يَزْعُمُونَ أَنَّ هَذِهِ الآيَةَ نُسِخَتْ، وَلاَ وَاللَّهِ مَا … | Sahih collection (field empty) | Ibnu Abbas: 'demi Allah ayat itu tidak mansukh, tetapi orang meremehkannya'. | `R-gift-at-division` |
| `H-BUKHARI-6752` | Sahih al-Bukhari 6752 | إِنَّمَا الْوَلاَءُ لِمَنْ أَعْتَقَ ‏"‏‏.‏ | Sahih collection (field empty) | Wala' hanya untuk orang yang memerdekakan. | `R-wala` |
| `H-MUSLIM-1614` | Sahih Muslim 1614 (local 4140) | لاَ يَرِثُ الْمُسْلِمُ الْكَافِرَ وَلاَ يَرِثُ الْكَافِرُ الْمُسْلِمَ ‏"‏ ‏.‏ | Sahih collection (field empty) | Muslim tidak mewarisi kafir dan sebaliknya. | `R-barrier-religion` |
| `H-MUSLIM-1615a` | Sahih Muslim 1615a (local 4141) | أَلْحِقُوا الْفَرَائِضَ بِأَهْلِهَا فَمَا بَقِيَ فَهُوَ لأَوْلَى رَجُلٍ ذَكَرٍ ‏"‏ … | Sahih collection (field empty) | Berikan bagian pasti kepada pemiliknya; sisanya untuk laki-laki terdekat. | `R-furudh-then-asabah` |
| `H-MUSLIM-1615c` | Sahih Muslim 1615c (local 4143) | اقْسِمُوا الْمَالَ بَيْنَ أَهْلِ الْفَرَائِضِ عَلَى كِتَابِ اللَّهِ فَمَا تَرَكَتِ … | Sahih collection (field empty) | Bagikan harta di antara ahli fara'idh sesuai Kitab Allah; sisanya untuk laki-laki terdekat. | `R-furudh-then-asabah` |
| `H-MUSLIM-1616a` | Sahih Muslim 1616a (local 4145) | كَيْفَ أَقْضِي فِي مَالِي فَلَمْ يَرُدَّ عَلَىَّ شَيْئًا حَتَّى نَزَلَتْ … | Sahih collection (field empty) | Jabir: Nabi tidak menjawab sampai turun ayat kalalah. | `R-asbab-nuzul`, `R-siblings-kalala` |
| `H-MUSLIM-1617a` | Sahih Muslim 1617a (local 4150) | أَلاَ تَكْفِيكَ آيَةُ الصَّيْفِ الَّتِي فِي آخِرِ سُورَةِ النِّسَاءِ ‏"‏ … | Sahih collection (field empty) | Umar: tidak ada yang lebih penting baginya daripada kalalah; Nabi: 'tidakkah cukup ayat shaif di akhir An-Nisa'?' | `R-siblings-kalala` |
| `H-MUSLIM-1618a` | Sahih Muslim 1618a (local 4152) | آخِرُ آيَةٍ أُنْزِلَتْ مِنَ الْقُرْآنِ ‏{‏ يَسْتَفْتُونَكَ قُلِ اللَّهُ يُفْتِيكُمْ … | Sahih collection (field empty) | Al-Bara': ayat terakhir yang turun adalah ayat kalalah. | `R-siblings-kalala` |
| `H-MUSLIM-1619e` | Sahih Muslim 1619e (local 4161) | مَنْ تَرَكَ مَالاً فَلِلْوَرَثَةِ وَمَنْ تَرَكَ كَلاًّ فَإِلَيْنَا ‏"‏ ‏.‏ | Sahih collection (field empty) | Siapa meninggalkan harta, untuk ahli waris; siapa meninggalkan tanggungan, kepada kami. *Supporting only: it states no order of debt and wasiat.* | `R-debt-wasiyya-first` |
| `H-MUSLIM-1627a` | Sahih Muslim 1627a (local 4204) | مَا حَقُّ امْرِئٍ مُسْلِمٍ لَهُ شَىْءٌ يُرِيدُ أَنْ يُوصِيَ فِيهِ … | Sahih collection (field empty) | Wasiat hendaknya tertulis. | `R-write-wasiyya` |
| `H-MUSLIM-1628a` | Sahih Muslim 1628a (local 4209) | الثُّلُثُ وَالثُّلُثُ كَثِيرٌ إِنَّكَ أَنْ تَذَرَ وَرَثَتَكَ أَغْنِيَاءَ خَيْرٌ مِنْ … | Sahih collection (field empty) | Sa'd: sepertiga, dan sepertiga itu banyak. | `R-wasiyya-third` |
| `H-MUSLIM-1629` | Sahih Muslim 1629 (local 4218) | غَضُّوا مِنَ الثُّلُثِ إِلَى الرُّبُعِ فَإِنَّ رَسُولَ اللَّهِ صلى الله … | Sahih collection (field empty) | Ibnu Abbas: sebaiknya diturunkan ke seperempat. | `R-wasiyya-third` |
| `H-BULUGH-1095` | Bulugh, local 1095 (tohed 805) | أَلْحِقُوا اَلْفَرَائِضَ بِأَهْلِهَا , فَمَا بَقِيَ فَهُوَ لِأَوْلَى رَجُلٍ ذَكَرٍ | footnote: صحيح | Alhiqu al-fara'idh (muttafaq 'alaih). | `R-furudh-then-asabah` |
| `H-BULUGH-1096` | Bulugh, local 1096 (tohed 806) | لَا يَرِثُ اَلْمُسْلِمُ اَلْكَافِرَ, وَلَا يَرِثُ اَلْكَافِرُ اَلْمُسْلِمَ | footnote: صحيح | Muslim tidak mewarisi kafir (muttafaq 'alaih). | `R-barrier-religion` |
| `H-BULUGH-1097` | Bulugh, local 1097 (tohed 807) | قَضَى اَلنَّبِيُّ ‏- صلى الله عليه وسلم ‏-" لِلِابْنَةِ اَلنِّصْفَ … | footnote: صحيح | Ibnu Mas'ud: putri 1/2, cucu putri 1/6, sisa untuk saudari (Bukhari). | `R-sons-daughter-sixth`, `R-sister-asabah-maal-ghayr` |
| `H-BULUGH-1098` | Bulugh, local 1098 (tohed 808) | لَا يَتَوَارَثُ أَهْلُ مِلَّتَيْنِ | footnote: حسن | Pemeluk dua agama tidak saling mewarisi. | `R-barrier-religion` |
| `H-BULUGH-1101` | Bulugh, local 1101 (tohed 809) | إِنَّ اِبْنَ اِبْنِي مَاتَ , فَمَا لِي مِنْ مِيرَاثِهِ ? … | footnote: ضعيف | Kakek: 'untukmu seperenam' lalu seperenam lagi sebagai tambahan (thu'mah). | `R-grandfather` |
| `H-BULUGH-1103` | Bulugh, local 1103 (tohed 810) | أَنَّ اَلنَّبِيَّ ‏- صلى الله عليه وسلم ‏-جَعَلَ لِلْجَدَّةِ اَلسُّدُسَ … | footnote: حسن | Nabi memberi nenek 1/6 bila tidak ada ibu. | `R-grandmother` |
| `H-BULUGH-1104` | Bulugh, local 1104 (tohed 811) | اَلْخَالُ وَارِثُ مَنْ لَا وَارِثَ لَهُ | footnote: صحيح | Paman dari pihak ibu (khal) adalah ahli waris orang yang tidak punya ahli waris. | `R-dzawil-arham` |
| `H-BULUGH-1105` | Bulugh, local 1105 (tohed 812) | كَتَبَ مَعِي عُمَرُ إِلَى أَبِي عُبَيْدَةَ ‏- رَضِيَ اَللَّهُ عَنْهُمْ‏- … | footnote: صحيح | Allah dan Rasul-Nya wali bagi yang tak punya wali; khal ahli waris bagi yang tak punya ahli waris. | `R-dzawil-arham` |
| `H-BULUGH-1106` | Bulugh, local 1106 (tohed 813) | إِذَا اِسْتَهَلَّ اَلْمَوْلُودُ وُرِّثَ | footnote: صحيح بطرقه وشواهده | Bayi yang lahir bersuara (istihlal) mewarisi. | `R-newborn` |
| `H-BULUGH-1107` | Bulugh, local 1107 (tohed 814) | لَيْسَ لِلْقَاتِلِ مِنَ الْمِيرَاثِ شَيْءٌ | footnote: صححه شيخنا | Pembunuh tidak mendapat warisan apa pun. | `R-barrier-killer` |
| `H-BULUGH-1108` | Bulugh, local 1108 (tohed 815) | مَا أَحْرَزَ اَلْوَالِدُ أَوْ اَلْوَلَدُ فَهُوَ لِعَصَبَتِهِ مَنْ كَانَ | footnote: حسن | Apa yang didapat ayah atau anak adalah untuk 'ashabahnya. *(The tahqiq story is about wala'.)* | `R-wala` |
| `H-BULUGH-1109` | Bulugh, local 1109 (tohed 816) | اَلْوَلَاءُ لُحْمَةٌ كَلُحْمَةِ اَلنَّسَبِ , لَا يُبَاعُ , وَلَا يُوهَبُ | footnote: ضعيف | Wala' adalah kekerabatan seperti nasab; tidak dijual, tidak dihibahkan. | `R-wala` |
| `H-BULUGH-1110` | Bulugh, local 1110 (tohed 817) | أَفْرَضُكُمْ زَيْدُ بْنُ ثَابِتٍ | footnote: ضعيف | Yang paling paham fara'idh di antara kalian adalah Zaid bin Tsabit. | `R-learn-faraid` |
| `H-BULUGH-1111` | Bulugh, local 1111 (tohed —) | مَا حَقُّ اِمْرِئٍ مُسْلِمٍ لَهُ شَيْءٌ يُرِيدُ أَنْ يُوصِيَ فِيهِ … | footnote: صحيح | Wasiat hendaknya tertulis (muttafaq 'alaih: Bukhari 2738, Muslim 1627). | `R-write-wasiyya` |
| `H-BULUGH-1112` | Bulugh, local 1112 (tohed —) | يَا رَسُولَ اَللَّهِ ! أَنَا ذُو مَالٍ , وَلَا يَرِثُنِي … | footnote: صحيح | Sa'd: sepertiga, dan sepertiga itu banyak (muttafaq 'alaih). | `R-wasiyya-third` |
| `H-BULUGH-1114` | Bulugh, local 1114 (tohed —) | إِنَّ اَللَّهَ قَدْ أَعْطَى كُلَّ ذِي حَقٍّ حَقَّهُ , فَلَا … | footnote: صحيح / منكر | Allah telah memberi setiap pemilik hak haknya; maka tidak ada wasiat untuk ahli waris. | `R-no-wasiyya-heir` |
| `H-BULUGH-1115` | Bulugh, local 1115 (tohed —) | إِلَّا أَنْ يَشَاءَ اَلْوَرَثَةُ | footnote: منكر | Tambahan 'kecuali bila ahli waris menghendaki' (riwayat ad-Daraquthni). | `R-no-wasiyya-heir` |
| `H-BULUGH-1116` | Bulugh, local 1116 (tohed —) | إِنَّ اَللَّهَ تَصَدَّقَ عَلَيْكُمْ بِثُلُثِ أَمْوَالِكُمْ عِنْدَ وَفَاتِكُمْ ; زِيَادَةً … | footnote: حسن بشواهده | Allah bersedekah kepada kalian dengan sepertiga harta saat wafat, sebagai tambahan kebaikan. | `R-wasiyya-third` |

*Arabic cells in 2.2 and 3.2 are copied from the JSON by script. Only runs of whitespace are collapsed; letters, harakat and marks are untouched.*

### 3.3 Grade and translation warnings, per record

**Do not use these as primary dalil**, because the editor's footnote grades them weak (*da'if*), or rejected (*munkar*) when a weak report contradicts stronger ones:
- **Bulugh 1101** (the grandfather's extra "sixth as a gift"): da'if.
- **Bulugh 1109** (*wala'* as a bond like lineage): da'if. Fiqh as-Sunnah 843 cites it as sahih via Ibn Hibban and al-Hakim, so the grades conflict.
- **Bulugh 1110** ("Zayd is the most learned in fara'id"): da'if.
- **Bulugh 1115**, the addition "unless the heirs wish so": munkar. Ibn Hajar himself called its chain *hasan*.

**Use, but show the caveat:**
- **Bulugh 1107**, "لَيْسَ لِلْقَاتِلِ مِنَ الْمِيرَاثِ شَيْءٌ":
  - Ibn Hajar, in the text itself: "وَأَعَلَّهُ النَّسَائِيُّ , وَالصَّوَابُ: وَقْفُهُ عَلَى عُمَرَ" (an-Nasa'i found a defect; the correct view is that it is 'Umar's ruling, not the Prophet's).
  - The footnote: al-Albani authenticated it, in *Irwa'* no. 1671.
  - For a deliberate killer, pair it with al-Umm 550.
- **Bulugh 1106** ("when the newborn cries, it inherits"):
  - The footnote: authentic through its several chains and supporting reports (*sahih bi-turuqihi*).
  - But the wording Ibn Hajar gives is Abu Hurayra's hadith, not Jabir's.
- **Bulugh 1103** (the grandmother's sixth): *hasan*; the footnote notes a disputed narrator (Abu al-Munib).

**Do not display these English lines:**
- **Bukhari 6752:** "for the manumitted" (wrong; the Arabic means the one who frees).
- **Bulugh 1106:** "hair".
- **Bukhari 6733:** a garbled sentence. Use 2742 or Muslim 1628a instead.

**Indonesian translations:**
- **Bukhari and Bulugh:** the corpus has no Indonesian. The lesson needs reviewed Indonesian, as the Fatihah track already requires (`docs/belajar-plan.md` §5.1, Hadith row).
- **Muslim:** the `id` texts are in-house. Show them only after ustadz review, labelled as the module's own translation.

**Jabir's revelation report exists in two versions:**
- Bukhari 4577 names **4:11**.
- Muslim 1616a names **4:176**.
- Bukhari 6723 says only "the inheritance verse".
- Do not merge them into one story, and do not add the Sa'd ibn ar-Rabi' story to Jabir's.

---

## 4. Fiqh texts: where the fara'id is, so lessons can cite it

Cite as *book, section_id / anchor*. The `F-*` records hold exact excerpts with a `char_range`; the `S-*` records are pointers only.

### 4.1 Fath al-Qarib (Syafi'i; the cleanest base for the core rules)

| section_id / anchor | Corpus title | Covers | Excerpt records |
|---|---|---|---|
| 116 / C138 | كتاب أحكام الفرائض والوصايا | Definitions of *fara'id* and *wasiyya*; the 10 male and 7 female heirs agreed on; who is never excluded (5: the spouses, the parents, the deceased's own children); who never inherits (7: slaves of all kinds, the killer, the apostate, people of two religions); the order of *'ashabah*; the freed slave's patron (*wala'*); then *bayt al-mal* | `F-FQARIB-116-heirs`, `-barriers`, `-asabah` |
| 117 / C139 | الفروض المقدرة | The six shares and who takes each (1/2: 5 heirs; 1/4: 2; 1/8: wives; 2/3: 4; 1/3: 2; 1/6: 7); exclusion (*hajb*) of grandmothers, grandfathers, maternal siblings, full siblings and paternal siblings; *'aul* mentioned only in passing ("إلا لعارض كالعول") | `F-FQARIB-117-furudh`, `-hajb` |
| 118 / C140 | الوصية | The four males who make their sisters *'ashabah* (2:1), and the four who inherit without their sisters; bequests: within 1/3, any excess needs the heirs' permission, none to an heir unless the other heirs permit, conditions for the testator, the beneficiary and the executor | `F-FQARIB-118-asabah-bil-ghayr`, `-wasiyya` |

**Not covered in Fath al-Qarib:**
- *radd*;
- *dzawil arham* (the text sends the residue to *bayt al-mal*);
- detailed *'aul* tables;
- special cases (*musytarakah*, *'umariyyatain*);
- the order of claims on the estate (funeral costs, then debts, then bequests).

### 4.2 Fath al-Mu'in (Syafi'i, later school; text interleaves matn and sharh)

| section_id / anchor | Corpus title | Covers | Excerpt records |
|---|---|---|---|
| 11 / C12 | فصل في الصلاة على الميت | Funeral costs (*tajhiz*) come from the estate; for a wife, a solvent husband pays | `F-FMUIN-11-tajhiz` |
| 33 / C38 | باب في الوصية | Bequest is *sunnah mu'akkadah*; Bukhari 2738 / Muslim 1627 quoted; more than 1/3 is disliked, and forbidden if meant to deprive heirs; a bequest to an heir is valid if the other heirs consent after the death; illness that makes death likely (*marad makhuf*) | `F-FMUIN-33-heir-consent`, `-above-third` |
| 34 / C39 | باب الفرائض | Heirs; the six shares; **radd + dzawil arham** (original Syafi'i doctrine says no; later scholars say yes when *bayt al-mal* is not well run; spouses get no radd; the 11 *dzawil arham*); ***'umariyyatain*** (the mother takes 1/3 of the remainder); detailed *hajb* list; grandmother is like the mother, grandfather like the father "except that he does not exclude siblings"; *'ashabah* order; 2:1 and the author's reason for it | `F-FMUIN-34-radd-dzawil-arham`, `-umariyyatain`, `-hajb`, `-jadd-like-ab`, `-asabah-order` |
| 35 / C40 | فصل في بيان اصول المسائل | Base numbers of a case (*asal masalah*: 2, 3, 4, 6, 8, 12, 24); **'aul** (6→7..10, 12→13/15/17, 24→27); *al-Minbariyyah* ('Ali: "the wife's eighth became a ninth") | `F-FMUIN-35-usul`, `-awl` |

**Caution:** section 33 also contains a "والحيلة" (legal stratagem) for passing wealth to a son without the other heirs' consent. Leave it out of any lesson: it cuts against 4:12 "غَيْرَ مُضَآرٍّ" and the *ijma'* Ibn Kathir reports (`T-IK-4-12-no-harm`).

### 4.3 Fiqh as-Sunnah (Sayyid Sabiq; corpus is chunked with gaps): section titles as they appear in the corpus

| section_id / anchor | qism | Corpus title | chars |
|---|---|---|---|
| 828 / C1068 | — | الوصية | 543 |
| 829 / C1069 | الوصية | وصية الصحابة | 608 |
| 830 / C1070 | الوصية | حكمها | 724 |
| 831 / C1071 | الوصية | ركنها | 809 |
| 832 / C1073 | الوصية | متى تستحق الوصية / الوصية المضافة أو المعلقة بالشرط | 655 |
| 833 / C1074 | الوصية | شروطها | 641 |
| 834 / C1075 | الوصية | شروط الموصى له | 733 |
| 835 / C1076 | الوصية | شروط الموصى به | 702 |
| 836 / C1078 | الوصية | مقدار المال الذي تستحب الوصية فيه / الوصية بالثلث | 694 |
| 837 / C1079 | الوصية | الوصية بأكثر من الثلث | 801 |
| 838 / C1080 | الوصية | بطلان الوصية | 635 |
| 839 / C1081 | — | الفرائض | 593 |
| 840 / C1082 | الفرائض | فضل العلم بالفرائض | 797 |
| 841 / C1083 | الفرائض | التركة | 739 |
| 842 / C1085 | الفرائض | أركان الميراث / أسباب الإرث | 985 |
| 843 / C1086 | الفرائض | شروط الميراث | 759 |
| 844 / C1087 | الفرائض | والموانع أربعة | 904 |
| 845 / C1088 | الفرائض | المستحقون للتركة | 364 |
| 846 / C1089 | الفرائض | 1 - أصحاب الفروض | 594 |
| 847 / C1090 | الفرائض | الزوجة المطلقة | 785 |
| 848 / C1091 | الفرائض | 2، 3 - العصبة | 530 |
| 849 / C1092 | الفرائض | كيفية توريث العصبة بالنفس | 796 |
| 850 / C1093 | الفرائض | العصبة السببية | 794 |
| 851 / C1094 | الفرائض | الحجب والحرمان | 436 |
| 852 / C1095 | الفرائض | العول | 489 |
| 853 / C1096 | الفرائض | طريقة حل مسائل العول | 541 |
| 854 / C1097 | الفرائض | 4 - الرد | 456 |
| 855 / C1098 | الفرائض | طريقة حل مسائل الرد | 834 |
| 856 / C1099 | الفرائض | 5 - ذوو الأرحام | 569 |
| 857 / C1101 | الفرائض | الحمل / حكمه في الميراث | 502 |
| 858 / C1102 | الفرائض | الحمل في بطن أمه | 713 |
| 859 / C1103 | الفرائض | أقل مدة الحمل وأكثرها | 768 |
| 860 / C1104 | الفرائض | المفقود | 556 |
| 861 / C1105 | الفرائض | ميراثه | 860 |
| 862 / C1107 | الفرائض | الخنثى / كيف يرث | 616 |
| 863 / C1108 | الفرائض | ميراث المرتد | 828 |
| 864 / C1109 | الفرائض | التخارج | 581 |
| 865 / C1110 | الفرائض | الوصية الواجبة | 579 |
| 866 / C1111 | الفرائض | طريقة حل المسائل التي تشتمل على الوصية الواجبة | 969 |

Topics, read from the text (sections 839–866):

- **Fara'id basics:** 839 definition; 839–840 *jahiliyyah* practice and the revelation of 4:11, with the Sa'd ibn ar-Rabi' report (`F-FSUNNAH-840-sad-rabi`).
- **Learning fara'id:** 840–841 hadith on learning it, with no grades.
- **The estate and inheritance:** 841 *tirkah*; 842 pillars and causes of inheritance; 843 conditions.
- **Barriers:** 843–844, four of them, with the *madhhab* differences on killing (`F-FSUNNAH-844-mawani`).
- **Heirs and shares:** 845–846 order of entitlement (Hanafi, and Egyptian law); 846–847 share-holders (the text is **truncated** between 846 and 847).
- **'Ashabah:** 848–850.
- **Exclusion and adjustment:** 851 *hajb*; 852–853 *'aul* (`F-FSUNNAH-852-awl-umar`); 854–855 *radd* (`F-FSUNNAH-854-radd-no-nass`); 856 *dzawil arham* (`F-FSUNNAH-856-dzawil-arham`).
- **Special heirs:** 857–859 the unborn child and the length of pregnancy (`F-FSUNNAH-859-pregnancy`); 860–861 the missing person; 862 the person of uncertain sex (*khuntsa*); 863 the apostate, the child of zina, the child of *li'an*; 864 an heir giving up a share for a settlement (*takharuj*).
- **Egyptian law:** 865–866 the *wasiyya wajiba* of **Egyptian Law 71/1946**. Do not present it as Indonesian law.
- **Bequests:** 828–838 the wasiyya chapter (its ruling, pillars, conditions, the 1/3 cap, more than 1/3, invalidation).

### 4.4 al-Umm (al-Shafi'i): Kitab al-Fara'id and the relevant Wasaya chapters

| section_id / anchor | qism | Corpus title | chars |
|---|---|---|---|
| 549 / C798 | كتاب الفرائض | من سمى الله تعالى له الميراث وكان يرث ومن خرج من ذلك | 3436 |
| 550 / C799 | كتاب الفرائض | باب الخلاف في ميراث أهل الملل وفيه شيء يتعلق بميراث العبد والقاتل | 4438 |
| 551 / C800 | كتاب الفرائض | باب من قال لا يورث أحد حتى يموت | 1514 |
| 552 / C801 | كتاب الفرائض | باب رد المواريث | 4538 |
| 553 / C802 | كتاب الفرائض | باب الخلاف في رد المواريث | 4399 |
| 554 / C803 | كتاب الفرائض | باب المواريث | 5130 |
| 555 / C804 | كتاب الفرائض | الرد في المواريث | 4807 |
| 556 / C805 | كتاب الفرائض | باب ميراث الجد | 4739 |
| 557 / C807 | كتاب الفرائض | ميراث ولد الملاعنة / ميراث المجوس | 4401 |
| 558 / C808 | كتاب الفرائض | ميراث المرتد | 2531 |
| 559 / C809 | كتاب الفرائض | ميراث المشركة | 4592 |
| 572 / C831 | كتاب الوصايا | باب الوصية بالثلث وأقل من الثلث وترك الوصية | 4847 |
| 580 / C842 | كتاب الوصايا | باب الوصية للوارث / باب ما يجوز من إجازة الوصية للوارث وغيره وما لا يجوز | 4235 |
| 581 / C843 | كتاب الوصايا | باب ما يجوز من إجازة الورثة للوصية وما لا يجوز | 4345 |
| 584 / C848 | كتاب الوصايا | باب الوصية المطلقة والوصية على الشيء / باب الوصية للوارث | 4305 |
| 585 / C850 | كتاب الوصايا | باب تفريغ الوصايا للوارث / الوصية للوارث | 4304 |

Excerpts used: `F-ALUMM-572` (debt before bequests and inheritance, by the ayah and *ijma'*); `F-ALUMM-550-killer`; `F-ALUMM-903-umar` (in كتاب جراح العمد, section 903 / C1315). al-Umm is long and dense; use it to support claims about the Syafi'i position, not for lay lesson text.

---

## 5. Tafsir: passages on the inheritance ayat

- **The files:** both tafsir files hold one Arabic record per ayah, keyed `surah:ayah`.
- **Ibn Kathir** groups some ayat: for example, the 4:8 discussion begins inside the 4:7 record.
- **Al-Tabari** is the Shakir edition, with the editor's `[[…]]` notes inline. Strip those notes before display, and check whether they are still under copyright (Shakir d. 1958).
- **English Ibn Kathir:** the corpus's EN text is the copyrighted abridged edition (`docs/belajar-plan.md` §5.2). Do not use it.

| Record key | Ibn Kathir (chars) | al-Tabari (chars) |
|---|---|---|
| 4:11 | `S-IK-4-11` (9258) | `S-TB-4-11` (26367) |
| 4:12 | `S-IK-4-12` (5188) | `S-TB-4-12` (22642) |
| 4:176 | `S-IK-4-176` (10338) | `S-TB-4-176` (22756) |
| 4:7 | `S-IK-4-7` (2253) | `S-TB-4-7` (3600) |
| 4:8 | `S-IK-4-8` (2447) | `S-TB-4-8` (15447) |
| 4:33 | `S-IK-4-33` (7797) | `S-TB-4-33` (26080) |
| 2:180 | `S-IK-2-180` (5281) | `S-TB-2-180` (19703) |
| 2:240 | `S-IK-2-240` (4478) | `S-TB-2-240` (15838) |
| 8:75 | `S-IK-8-75` (778) | `S-TB-8-75` (3167) |
| 33:6 | `S-IK-33-6` (4325) | `S-TB-33-6` (8203) |

Excerpt records (exact `char_range` into the record above):

| Record | Ayah record | What the passage says (gist, ID) | Rules |
|---|---|---|---|
| `T-IK-2-180-naskh` | Tafsir Ibn Kathir 2:180 @0–2432 | Wasiat wajib untuk orang tua/kerabat dihapus oleh ayat waris; pendapat "mansukh bagi yang mewarisi, tetap bagi yang tidak mewarisi"; Ibnu Katsir: kewajiban wasiat kepada kerabat yang mewarisi dihapus secara ijma'. | `R-wasiyya-history`, `R-no-wasiyya-heir` |
| `T-IK-2-240-naskh` | Tafsir Ibn Kathir 2:240 @0–881 | Mayoritas: 2:240 dihapus (iddah oleh 2:234; nafkah setahun oleh ayat waris: istri 1/8 atau 1/4). | `R-wasiyya-history`, `R-spouses` |
| `T-IK-4-7-muhkam` | Tafsir Ibn Kathir **on 4:8** (stored in the 4:7 record) @640–1134 | 4:8: ada dua pendapat (mansukh atau tidak); Bukhari dari Ibnu Abbas: muhkam. | `R-gift-at-division` |
| `T-IK-4-8-naskh` | Tafsir Ibn Kathir 4:8 @2–1351 | Pendapat yang menyatakan 4:8 mansukh; Ibnu Katsir menisbatkannya kepada jumhur dan imam empat. | `R-gift-at-division` |
| `T-IK-4-11-dayn` | Tafsir Ibn Kathir 4:11 @7921–8455 | Ijma' salaf dan khalaf: utang didahulukan atas wasiat; hadits Ali (Ahmad, Tirmidzi, Ibnu Majah) dengan catatan tentang al-Harits. | `R-debt-wasiyya-first` |
| `T-IK-4-12-kalala` | Tafsir Ibn Kathir 4:12 @937–1537 | Kalalah = tidak punya anak dan ayah; dihikayatkan ijma'; 'akh au ukht' di 4:12 = saudara seibu. | `R-maternal-siblings`, `R-hajb-siblings` |
| `T-IK-4-12-musytaraka` | Tafsir Ibn Kathir 4:12 @2214–2643 | Masalah musyarakah (himariyah) di masa Umar. | `R-special-cases` |
| `T-IK-4-12-no-harm` | Tafsir Ibn Kathir 4:12 @5052–5186 | Wasiat/pengakuan sebagai siasat menambah atau mengurangi bagian ahli waris: haram secara ijma' dan nash 4:12. | `R-no-harm-wasiyya` |
| `T-IK-4-176-father-blocks` | Tafsir Ibn Kathir 4:176 @3388–3647 | Kalalah = tanpa anak dan ayah; ayah menghalangi saudari 'bil-ijma''. | `R-hajb-siblings` |
| `T-IK-4-176-two-daughters` | Tafsir Ibn Kathir 4:176 @5292–5469 | Dua saudari mendapat 2/3; 'dari sinilah jumhur mengambil hukum dua putri' (2/3), sebagaimana hukum saudari diambil dari ayat anak perempuan. | `R-daughters`, `R-siblings-kalala` |
| `T-IK-4-176-zayd-husband-sister` | Tafsir Ibn Kathir 4:176 @3739–3899 | Zaid bin Tsabit: suami 1/2 dan saudari kandung 1/2, 'aku menyaksikan Rasulullah memutuskan demikian' (Ahmad saja dari jalur ini). | `R-siblings-kalala`, `R-spouses` |
| `T-IK-4-33-hilf` | Tafsir Ibn Kathir 4:33 @640–747 | Waris karena sumpah setia (hilf) pada awal Islam lalu dihapus. | `R-no-inheritance-by-oath` |
| `T-TB-2-180-view` | Tafsir al-Tabari, Jami' al-Bayan 2:180 @19317–19702 | Ath-Thabari: wasiat wajib bagi yang punya harta, sedikit atau banyak, untuk kerabat yang tidak mewarisi (pandangan beliau; berbeda dengan jumhur). | `R-wasiyya-history` |
| `T-TB-2-240-naskh` | Tafsir al-Tabari, Jami' al-Bayan 2:240 @11589–11894 | Ath-Thabari: nafkah setahun dihapus oleh ayat waris; tempat tinggal dikembalikan ke 4 bulan 10 hari. | `R-wasiyya-history` |
| `T-TB-4-8-muhkam` | Tafsir al-Tabari, Jami' al-Bayan 4:8 @6284–6440 | Ath-Thabari: 4:8 muhkam, berkaitan dengan wasiat untuk kerabat; yatim dan miskin diberi kata yang baik. | `R-gift-at-division` |
| `T-TB-4-11-ikhwa-two` | Tafsir al-Tabari, Jami' al-Bayan 4:11 @13467–13713 | 'Ikhwah' yang menurunkan ibu ke 1/6 = dua saudara atau lebih (bukan pendapat Ibnu Abbas). | `R-mother-third-sixth` |
| `T-TB-4-11-father-blocks` | Tafsir al-Tabari, Jami' al-Bayan 4:11 @19524–19645 | Tidak ada perbedaan: saudara tidak mewarisi bersama ayah mayit. | `R-hajb-siblings` |
| `T-TB-4-12-kalala` | Tafsir al-Tabari, Jami' al-Bayan 4:12 @11538–11636 | Kalalah = ahli waris selain anak dan ayah. | `R-maternal-siblings`, `R-hajb-siblings` |
| `T-TB-4-176-daughter-sister` | Tafsir al-Tabari, Jami' al-Bayan 4:176 @19344–19525 | Kesepakatan (kecuali Ibnu Abbas dan Ibnu az-Zubair): putri 1/2, sisanya untuk saudari kandung/seayah. | `R-sister-asabah-maal-ghayr` |

**Other topics in these records, not yet excerpted** (found by a normalised keyword scan; read them before citing):

- **Ibn Kathir 4:11:**
  - the Sa'd ibn ar-Rabi' report;
  - "تعلموا الفرائض";
  - Ibn Kathir's rejection of "فوق زائدة" (فوق is redundant);
  - Ibn 'Abbas's definition of *kalalah*;
  - the *jahiliyyah* practice of giving only to those who fight.
- **Ibn Kathir 4:12:**
  - maternal siblings differ from other heirs "in several ways";
  - the grandmother and the mother in the *musytarakah* case.
- **Ibn Kathir 4:176:**
  - Ibn 'Abbas and Ibn az-Zubayr's minority view on daughter + sister;
  - "آخر آية" (al-Bara').
- **Al-Tabari 4:11:**
  - the Sa'd ibn ar-Rabi' report;
  - his preferred reading of "يُوصِي بِهَا أَوْ دَيْنٍ" (@22677);
  - the reason for the mother's 1/6 with siblings (@19268).
- **Al-Tabari 4:12:** the grammar of *kalalah* (@9150).
- **Al-Tabari 4:176:**
  - the brother inheriting a sister who dies as *kalalah* (@20435);
  - "يُبَيِّنُ اللَّهُ لَكُمْ أَنْ تَضِلُّوا" read as about inheritance (@21204).

---

## 6. Rule → strongest dalil

- **Status:**
  - `found`: the rule's strongest dalil is in the corpus.
  - `partial`: part of the rule, or one of its common dalil, is missing or disputed. See the caveat.
  - `external`: needs an outside source.
- **Order of the "Strongest" column:** the Qur'an comes first, then sahih hadith, then reported *ijma'*, then fiqh.
- **For the questionnaire engine:** every result line in the report should carry one rule id. The report then cites that rule's first `strongest` record (Arabic from the JSON, with its translation label).

| Rule | Statement (ID) | Strongest | Supporting | Status | Caveat |
|---|---|---|---|---|---|
| `R-debt-wasiyya-first` | Harta dibagi sesudah utang dilunasi dan wasiat (yang sah) ditunaikan; utang didahulukan atas wasiat. | `Q-4-11` (QS An-Nisa' [4]: 11); `Q-4-12` (QS An-Nisa' [4]: 12); `F-ALUMM-572`; `T-IK-4-11-dayn` | `H-BUKHARI-6731` (Sahih al-Bukhari 6731); `H-MUSLIM-1619e` (Sahih Muslim 1619e) | **found** | The order debt > wasiyya rests on the ayat + reported ijma' (al-Umm 572, Ibn Kathir 4:11). The marfu' report of Ali ('qada bid-dayn qabl al-wasiyya') is judged not established by al-Shafi'i and criticised via al-Harith (Ibn Kathir) - do not present it as the main dalil. |
| `R-tajhiz` | Biaya pengurusan jenazah diambil dari harta peninggalan. | `F-FMUIN-11-tajhiz` | — | **partial** | Corpus states tajhiz comes from the estate (and that a wife's tajhiz falls on a solvent husband). Its priority BEFORE debts is not stated in any corpus text found -> needs external source (classical Syafi'i order of huquq al-tarika / KHI). |
| `R-wasiyya-third` | Wasiat paling banyak sepertiga harta; lebih kecil lebih baik. | `H-BUKHARI-2742` (Sahih al-Bukhari 2742); `H-MUSLIM-1628a` (Sahih Muslim 1628a) | `H-BUKHARI-2743` (Sahih al-Bukhari 2743); `H-MUSLIM-1629` (Sahih Muslim 1629); `H-BULUGH-1112` (Bulugh al-Maram 1112 (local AhmedBaset numbering)); `H-BULUGH-1116` (Bulugh al-Maram 1116 (local AhmedBaset numbering)); `F-FQARIB-118-wasiyya`; `F-FMUIN-33-above-third` | **found** | `Q-33-6` removed in review 2026-10-09: it does not state the 1/3 limit. |
| `R-no-wasiyya-heir` | Tidak ada wasiat untuk ahli waris. | `H-BULUGH-1114` (Bulugh al-Maram 1114 (local AhmedBaset numbering)); `T-IK-2-180-naskh` | `H-BUKHARI-6739` (Sahih al-Bukhari 6739); `F-FQARIB-118-wasiyya`; `F-FMUIN-33-heir-consent`; `H-BULUGH-1115` (Bulugh al-Maram 1115 (local AhmedBaset numbering)) | **partial** | Bulugh 1114 (Abu Umamah) is graded sahih in the tahqiq footnote, which names Abu Dawud 3565, Tirmidhi 2120, Ibn Majah 2713 - those primaries are NOT in the corpus. Exception 'unless the other heirs consent': the hadith addition (1115) is graded munkar in the tahqiq, but Syafi'i fiqh in the corpus allows it with the other heirs' consent after death. Which one the calculator follows is an MUI/KHI decision. |
| `R-write-wasiyya` | Orang yang punya sesuatu untuk diwasiatkan hendaknya menuliskannya. | `H-BUKHARI-2738` (Sahih al-Bukhari 2738); `H-MUSLIM-1627a` (Sahih Muslim 1627a) | `H-BULUGH-1111` (Bulugh al-Maram 1111 (local AhmedBaset numbering)) | **found** | — |
| `R-no-harm-wasiyya` | Wasiat tidak boleh dipakai untuk merugikan ahli waris. | `Q-4-12` (QS An-Nisa' [4]: 12); `T-IK-4-12-no-harm` | `F-FMUIN-33-above-third` | **found** | — |
| `R-furudh-then-asabah` | Bagian pasti (furudh) diberikan dulu; sisanya untuk 'ashabah (laki-laki terdekat). | `H-BUKHARI-6732` (Sahih al-Bukhari 6732); `H-MUSLIM-1615a` (Sahih Muslim 1615a) | `H-MUSLIM-1615c` (Sahih Muslim 1615c); `H-BULUGH-1095` (Bulugh al-Maram 1095 (local AhmedBaset numbering)); `H-BUKHARI-6745` (Sahih al-Bukhari 6745) | **found** | — |
| `R-six-shares` | Enam bagian pasti dalam Al-Qur'an: 1/2, 1/4, 1/8, 2/3, 1/3, 1/6. | `Q-4-11` (QS An-Nisa' [4]: 11); `Q-4-12` (QS An-Nisa' [4]: 12); `Q-4-176` (QS An-Nisa' [4]: 176) | `F-FQARIB-117-furudh` | **found** | — |
| `R-2to1` | Bila anak (atau saudara kandung/seayah) laki-laki dan perempuan bersama, laki-laki mendapat dua kali bagian perempuan. | `Q-4-11` (QS An-Nisa' [4]: 11); `Q-4-176` (QS An-Nisa' [4]: 176) | `H-BUKHARI-6739` (Sahih al-Bukhari 6739); `F-FQARIB-118-asabah-bil-ghayr`; `F-FMUIN-34-asabah-order` | **found** | Maternal siblings share EQUALLY (Q 4:12; F-FQARIB-118 says the maternal brother does not make his sister 'asabah). Reasons for 2:1 in the corpus are scholars' explanations (Fath al-Mu'in; QuranEnc footnote 181), not part of the dalil. |
| `R-daughters` | Satu putri 1/2; dua putri atau lebih 2/3; bersama putra: 2:1. | `Q-4-11` (QS An-Nisa' [4]: 11); `T-IK-4-176-two-daughters` | `F-FSUNNAH-840-sad-rabi`; `S-IK-4-11`; `S-TB-4-11`; `F-FQARIB-117-furudh` | **partial** | 'Fawqa ithnatayn' (more than two) vs two daughters: the two-thirds for TWO daughters is grounded in the Sa'd ibn ar-Rabi' report, which the corpus has only second-hand (Fiqh as-Sunnah 840: 'rawahu al-khamsah illa an-Nasa'i'; Ibn Kathir/Tabari 4:11). Primary (Abu Dawud/Tirmidhi/Ibn Majah) number and grade: needs external source. Ibn Kathir 4:176 gives the corpus-internal argument: the jumhur took the two daughters' 2/3 from the two sisters' 2/3 in 4:176. |
| `R-sons-daughter-sixth` | Cucu perempuan dari anak laki-laki mendapat 1/6 bersama satu putri (penyempurna 2/3). | `H-BUKHARI-6736` (Sahih al-Bukhari 6736) | `H-BULUGH-1097` (Bulugh al-Maram 1097 (local AhmedBaset numbering)); `F-FQARIB-117-furudh` | **found** | — |
| `R-sister-asabah-maal-ghayr` | Saudari kandung/seayah bersama putri (atau cucu putri) menjadi 'ashabah: mengambil sisa. | `H-BUKHARI-6736` (Sahih al-Bukhari 6736); `H-BUKHARI-6734` (Sahih al-Bukhari 6734) | `T-TB-4-176-daughter-sister`; `H-BULUGH-1097` (Bulugh al-Maram 1097 (local AhmedBaset numbering)); `F-FMUIN-34-hajb` | **found** | Al-Tabari notes Ibn Abbas and Ibn az-Zubayr dissented; present as the majority/consensus position, not unanimous. |
| `R-parents` | Ayah dan ibu masing-masing 1/6 bila ada anak. | `Q-4-11` (QS An-Nisa' [4]: 11) | `H-BUKHARI-6739` (Sahih al-Bukhari 6739) | **found** | — |
| `R-mother-third-sixth` | Ibu 1/3 bila tidak ada anak dan tidak ada (dua atau lebih) saudara; 1/6 bila ada. Kasus 'Umariyyatain: 1/3 sisa. | `Q-4-11` (QS An-Nisa' [4]: 11); `T-TB-4-11-ikhwa-two` | `F-FMUIN-34-umariyyatain`; `F-FQARIB-117-furudh` | **found** | — |
| `R-spouses` | Suami 1/2 (tanpa anak) atau 1/4 (ada anak); istri 1/4 atau 1/8, dibagi rata bila lebih dari satu. | `Q-4-12` (QS An-Nisa' [4]: 12) | `H-BUKHARI-6739` (Sahih al-Bukhari 6739); `F-FQARIB-117-furudh` | **found** | — |
| `R-maternal-siblings` | Saudara seibu (dalam kalalah): satu orang 1/6, dua atau lebih berbagi 1/3 sama rata. | `Q-4-12` (QS An-Nisa' [4]: 12); `T-IK-4-12-kalala` | `F-FQARIB-117-furudh`; `T-TB-4-12-kalala` | **found** | That 'akh aw ukht' in 4:12 means maternal siblings is from tafsir (Sa'd's reading, Abu Bakr), not the Tanzil text itself. |
| `R-siblings-kalala` | Kalalah: saudari kandung/seayah 1/2, dua atau lebih 2/3; saudara laki-laki mewarisi semuanya; campuran 2:1. | `Q-4-176` (QS An-Nisa' [4]: 176) | `H-MUSLIM-1618a` (Sahih Muslim 1618a); `H-BUKHARI-6744` (Sahih al-Bukhari 6744); `H-MUSLIM-1617a` (Sahih Muslim 1617a); `H-MUSLIM-1616a` (Sahih Muslim 1616a) | **found** | — |
| `R-hajb-siblings` | Saudara (kandung, seayah, seibu) terhalang oleh anak laki-laki, cucu laki-laki dari anak laki-laki, dan ayah; saudara seibu juga terhalang oleh anak perempuan, cucu (laki-laki maupun perempuan) dari anak laki-laki, dan kakek. *(amended in review 2026-10-09: Fath al-Qarib §117 "ومع ولد الابن كذلك")* | `T-IK-4-176-father-blocks`; `T-TB-4-11-father-blocks`; `Q-4-176` (QS An-Nisa' [4]: 176) | `F-FQARIB-117-hajb`; `F-FMUIN-34-hajb`; `T-IK-4-12-kalala`; `T-TB-4-12-kalala` | **found** | No marfu' hadith in the corpus states it directly; it rests on the kalala ayat (4:12, 4:176) plus reported ijma' (Ibn Kathir 4:176; al-Tabari 4:11 'la khilaf'). |
| `R-hajb-grandparents` | Nenek terhalang oleh ibu; nenek dari pihak ayah juga terhalang oleh ayah; kakek terhalang oleh ayah; cucu terhalang oleh anak laki-laki. *(amended in review 2026-10-09: Fath al-Mu'in §34 "وجدة لأب بأب")* | `F-FQARIB-117-hajb`; `F-FMUIN-34-hajb` | `H-BULUGH-1103` (Bulugh al-Maram 1103 (local AhmedBaset numbering)) | **found** | — |
| `R-grandmother` | Nenek mendapat 1/6 bila tidak ada ibu (beberapa nenek berbagi 1/6). | `H-BULUGH-1103` (Bulugh al-Maram 1103 (local AhmedBaset numbering)) | `F-FQARIB-117-furudh`; `F-FMUIN-34-jadd-like-ab` | **partial** | Bulugh 1103 is graded hasan in the tahqiq (cites Abu Dawud 2895; primary not in corpus). The Abu Bakr / al-Mughira / Muhammad ibn Maslama report on the grandmother's sixth was NOT found in the corpus -> needs external source. |
| `R-grandfather` | Kakek menggantikan ayah (1/6 bila ada anak, atau ashabah) bila ayah tidak ada; bersama saudara ada perbedaan pendapat. | `F-FQARIB-117-furudh`; `F-FMUIN-34-jadd-like-ab` | `H-BUKHARI-6738` (Sahih al-Bukhari 6738); `S-AL-UMM-556` | **partial** | Grandfather + siblings is a classical khilaf (Abu Bakr's view in Bukhari 6738 vs the Syafi'i muqasama rules in al-Umm 556 / Fath al-Qarib 117). The calculator needs an explicit MUI/KHI choice. Bulugh 1101 (grandson's sixth) is da'if - do not use. |
| `R-barrier-religion` | Beda agama menghalangi saling mewarisi. | `H-BUKHARI-6764` (Sahih al-Bukhari 6764); `H-MUSLIM-1614` (Sahih Muslim 1614) | `H-BULUGH-1096` (Bulugh al-Maram 1096 (local AhmedBaset numbering)); `H-BULUGH-1098` (Bulugh al-Maram 1098 (local AhmedBaset numbering)); `Q-4-141` (QS An-Nisa' [4]: 141); `F-FQARIB-116-barriers`; `F-FSUNNAH-844-mawani` | **found** | MUI Fatwa 5/MUNAS VII/MUI/9/2005 cites Q 4:11, Q 4:141, the Usama hadith and the 'Abdullah ibn 'Amr hadith (= Bulugh 1098) - all four are in this file (see standard.md 1.1 for the fatwa source). |
| `R-barrier-killer` | Pembunuh tidak mewarisi dari orang yang dibunuhnya. | `F-ALUMM-550-killer`; `H-BULUGH-1107` (Bulugh al-Maram 1107 (local AhmedBaset numbering)) | `F-ALUMM-903-umar`; `F-FQARIB-116-barriers`; `F-FSUNNAH-844-mawani`; `H-BULUGH-1098` (Bulugh al-Maram 1098 (local AhmedBaset numbering)) | **partial** | Deliberate killing: al-Shafi'i reports no disagreement (al-Umm 550). Accidental killing: khilaf (al-Shafi'i: also barred; Maliki: only deliberate wrongful). The marfu' wording in Bulugh 1107 is disputed (Ibn Hajar: correct is mawquf on Umar; tahqiq: authenticated by al-Albani, Irwa' 1671). Which killing types bar inheritance in the questionnaire is an MUI/KHI decision. |
| `R-asabah-order` | Urutan 'ashabah: jalur anak, lalu ayah/kakek, lalu saudara, lalu paman; yang lebih dekat menghalangi yang jauh. | `F-FQARIB-116-asabah`; `F-FMUIN-34-asabah-order` | `H-BUKHARI-6732` (Sahih al-Bukhari 6732); `S-FIQH-AS-SUNNAH-849`; `S-FIQH-AS-SUNNAH-850` | **found** | — |
| `R-awl` | 'Aul: bila jumlah bagian melebihi harta, semua bagian dikurangi secara proporsional. | `F-FMUIN-35-awl`; `F-FSUNNAH-852-awl-umar` | `S-FIQH-AS-SUNNAH-853` | **partial** | No Qur'an/hadith text; it is the ijtihad of the Companions as reported. The corpus gives no chain for 'the first 'awl under Umar' (Fiqh as-Sunnah: 'ruwiya') -> primary report needs external source. |
| `R-radd` | Radd: sisa harta (tanpa ashabah) dikembalikan kepada ashabul furudh selain suami/istri, proporsional. | `F-FSUNNAH-854-radd-no-nass`; `F-FMUIN-34-radd-dzawil-arham` | `S-AL-UMM-552`; `S-AL-UMM-553`; `S-AL-UMM-555` | **partial** | Fiqh as-Sunnah: 'there is no nass on radd'. Original Syafi'i doctrine (al-Umm): no radd, surplus to bayt al-mal; later Syafi'i (Fath al-Mu'in): radd when bayt al-mal is not orderly. Radd to a spouse is a further khilaf. MUI/KHI decision needed. |
| `R-dzawil-arham` | Kerabat yang bukan ashabul furudh dan bukan ashabah (dzawil arham) mewarisi bila tidak ada keduanya (menurut sebagian ulama). | `Q-8-75` (QS Al-Anfal [8]: 75); `Q-33-6` (QS Al-Ahzab [33]: 6); `H-BULUGH-1104` (Bulugh al-Maram 1104 (local AhmedBaset numbering)) | `H-BULUGH-1105` (Bulugh al-Maram 1105 (local AhmedBaset numbering)); `F-FSUNNAH-856-dzawil-arham`; `F-FMUIN-34-radd-dzawil-arham` | **partial** | Khilaf: Malik and al-Shafi'i (original) did not give dzawil arham; Abu Hanifa and Ahmad did; later Syafi'i accept it when bayt al-mal is not orderly. |
| `R-newborn` | Bayi yang lahir hidup mewarisi; selama masih janin, bagian terbesar dicadangkan. | `H-BULUGH-1106` (Bulugh al-Maram 1106 (local AhmedBaset numbering)) | `F-FSUNNAH-859-pregnancy`; `S-FIQH-AS-SUNNAH-857`; `S-FIQH-AS-SUNNAH-858` | **found** | Bulugh 1106: tahqiq says sahih by routes/witnesses but notes the wording belongs to Abu Hurayra's hadith, not Jabir's. |
| `R-women-inherit` | Laki-laki dan perempuan sama-sama berhak waris (berbeda dengan adat jahiliyah). | `Q-4-7` (QS An-Nisa' [4]: 7) | `S-FIQH-AS-SUNNAH-839`; `H-BUKHARI-6739` (Sahih al-Bukhari 6739) | **found** | — |
| `R-obligation` | Pembagian waris adalah batas-batas Allah; menaatinya berpahala, melanggarnya berdosa. | `Q-4-13` (QS An-Nisa' [4]: 13); `Q-4-14` (QS An-Nisa' [4]: 14) | `Q-4-11` (QS An-Nisa' [4]: 11) | **found** | — |
| `R-gift-at-division` | Kerabat bukan ahli waris, anak yatim, dan orang miskin yang hadir saat pembagian diberi sekadarnya dan disapa dengan baik. | `Q-4-8` (QS An-Nisa' [4]: 8); `H-BUKHARI-4576` (Sahih al-Bukhari 4576) | `T-IK-4-7-muhkam`; `T-IK-4-8-naskh`; `T-TB-4-8-muhkam`; `H-BUKHARI-2759` (Sahih al-Bukhari 2759) | **found** | Khilaf on whether 4:8 is abrogated: Ibn Abbas (Bukhari 4576) and al-Tabari: muhkam; Ibn Kathir attributes 'abrogated' to the jumhur and the four imams. Present it as a recommended kindness, not a fixed share. |
| `R-kinship-priority` | Kerabat lebih berhak satu sama lain dalam hal waris. | `Q-8-75` (QS Al-Anfal [8]: 75); `Q-33-6` (QS Al-Ahzab [33]: 6) | `Q-4-33` (QS An-Nisa' [4]: 33) | **found** | — |
| `R-no-inheritance-by-oath` | Waris karena sumpah setia atau persaudaraan Muhajirin-Anshar dihapus; yang tersisa adalah tolong-menolong dan wasiat. | `H-BUKHARI-6747` (Sahih al-Bukhari 6747); `T-IK-4-33-hilf` | `Q-4-33` (QS An-Nisa' [4]: 33); `Q-33-6` (QS Al-Ahzab [33]: 6) | **found** | — |
| `R-wasiyya-history` | Ayat wasiat untuk orang tua/kerabat (2:180) dan wasiat nafkah janda (2:240) dibahas para mufassir sebagai mansukh oleh ayat waris (dengan rincian perbedaan). | `T-IK-2-180-naskh`; `T-IK-2-240-naskh`; `H-BUKHARI-6739` (Sahih al-Bukhari 6739) | `Q-2-180` (QS Al-Baqarah [2]: 180); `Q-2-240` (QS Al-Baqarah [2]: 240); `T-TB-2-180-view`; `T-TB-2-240-naskh` | **found** | Ibn Kathir: wajib wasiyya to inheriting parents/relatives is abrogated by ijma'; some held it remains for non-inheriting relatives; al-Tabari holds wasiyya to non-inheriting relatives is still obligatory. Present as tafsir discussion, not a ruling. |
| `R-asbab-nuzul` | Sebab turunnya ayat waris (Jabir; istri Sa'd bin ar-Rabi'). | `H-BUKHARI-6723` (Sahih al-Bukhari 6723); `H-MUSLIM-1616a` (Sahih Muslim 1616a) | `F-FSUNNAH-840-sad-rabi`; `H-BUKHARI-4577` (Sahih al-Bukhari 4577) | **found** | Jabir's reports in Bukhari/Muslim name different verses (Bukhari 4577: 4:11; Muslim 1616a: 4:176). Do not merge them into one story. |
| `R-heirs-list` | Daftar ahli waris yang disepakati (10 laki-laki, 7 perempuan secara ringkas). | `F-FQARIB-116-heirs` | — | **found** | — |
| `R-calc-method` | Cara hitung: asal masalah dari penyebut bagian (2, 3, 4, 6, 8, 12, 24). | `F-FMUIN-35-usul` | — | **found** | A method, not a dalil. |
| `R-special-cases` | Kasus khusus: musyarakah (himariyah), 'umariyyatain, minbariyyah. | `T-IK-4-12-musytaraka`; `F-FMUIN-34-umariyyatain`; `F-FMUIN-35-awl` | `S-AL-UMM-559` | **found** | Musyarakah is a khilaf case (Ibn Kathir 4:12). |
| `R-wala` | Wala' (hak waris bekas tuan atas budak yang dimerdekakan). | `H-BUKHARI-6752` (Sahih al-Bukhari 6752) | `H-BULUGH-1109` (Bulugh al-Maram 1109 (local AhmedBaset numbering)); `H-BULUGH-1108` (moved here from `R-asabah-order` in review 2026-10-09: its tahqiq story is a dispute over wala') | **found** | Historical; leave out of a lay lesson. |
| `R-learn-faraid` | Keutamaan belajar fara'idh. | — | `H-BULUGH-1110` (Bulugh al-Maram 1110 (local AhmedBaset numbering)); `S-FIQH-AS-SUNNAH-840`; `S-FIQH-AS-SUNNAH-841` | **external** | The corpus has these reports only via Fiqh as-Sunnah (no grades) and Bulugh 1110 (graded da'if). Needs external takhrij before any use; do not use as lesson motivation. |
| `R-ext-mui-khi` | Ketentuan khas Indonesia (KHI/MUI): ahli waris pengganti, wasiat wajibah, harta bersama, dsb. | — | `S-FIQH-AS-SUNNAH-865`; `S-FIQH-AS-SUNNAH-866` | **external** | Not in the corpus. Fiqh as-Sunnah 865-866 describe EGYPTIAN wasiyya wajiba law (no. 71/1946), not Indonesian law. Must be sourced by the MUI/KHI researcher. |

---

## 7. Not found in the corpus: **needs external source**

Do not fill any of these from memory. Each needs a real source, with its number and grade, before a lesson or the report states it.

| # | Item | What the corpus has | What is needed |
|---|---|---|---|
| E1 | **Sa'd ibn ar-Rabi''s daughters: 2/3 to the two daughters, 1/8 to the widow, the rest to the uncle** (the classic *sabab al-nuzul* of 4:11) | Second-hand only: Fiqh as-Sunnah 840 ("رواه الخمسة إلا النسائي"); Ibn Kathir and al-Tabari 4:11 | Primary source (Abu Dawud, at-Tirmidzi, Ibn Majah), its number and a grade from a named muhaddith |
| E2 | **Abu Bakr gave the grandmother 1/6 on the testimony of al-Mughira and Muhammad ibn Maslama** | Not found. Searched (normalised) for the phrases ja'at al-jaddah, Muhammad ibn Maslamah (in fara'id contexts) and at'im al-jaddah | Primary source (Muwatta', Abu Dawud, Tirmidzi) and a grade. Meanwhile, the grandmother's 1/6 rests on Bulugh 1103 (*hasan*) and on fiqh |
| E3 | **'Umar's first *'aul* case (husband + two sisters), with 'Abbas, 'Ali or Zayd advising** | Fiqh as-Sunnah 852 says only "وروي" (it was reported), with no chain | Primary report and a grade, if a lesson wants to tell the story |
| E4 | **The order: funeral costs, then debts, then bequests, then shares** | Debts before bequests: found (al-Umm 572, Ibn Kathir 4:11). Funeral costs from the estate: found (Fath al-Mu'in 11). That funeral costs come **first**: not found in the corpus | A Syafi'i source for the order of claims on the estate. `standard.md` §1.5 reports KHI Pasal 175 and a DSN-MUI fatwa giving this order |
| E5 | **Canonical sunnah.com numbers for the Bulugh fara'id/wasaya hadith** | Local AhmedBaset numbers (1095–1119); tohed.com numbers 805–817 | A sunnah.com API key, or a manual read of sunnah.com/bulugh/7, then a mapping |
| E6 | **Primary sources behind Bulugh entries that are not Bukhari or Muslim** (Abu Dawud 2895, 2899, 3565; Tirmidzi 2103, 2120; Ibn Majah 2713, 2737; ad-Daraqutni 4/98; an-Nasa'i al-Kubra) | Only as numbers inside the Bulugh editor's footnote | Those collections are not in the corpus. Show them as "dikutip dalam Bulugh al-Maram" until they are added and checked |
| E7 | **Hadith on the virtue of learning fara'id** ("تعلموا الفرائض…", "نصف العلم") | Fiqh as-Sunnah 840–841, with no grades; Bulugh 1110 (a related report) graded *da'if* | External grading. Until then, do not use these in a lesson |
| E8 | **Indonesian translations of the Bukhari and Bulugh texts** | None | Reviewed in-house translations, signed off by an ustadz (the Fatihah track has the same requirement) |
| E9 | **Indonesian-specific provisions:** KHI substitute heirs, *wasiat wajibah*, joint marital property, the father's share under the SEMA ruling, *radd* to a spouse | Not in the corpus. Fiqh as-Sunnah 865–866 is **Egyptian** law | `standard.md` (STANDARD researcher) |
| E10 | **Zayd ibn Thabit, husband + sister** (in Ibn Kathir 4:176: "تفرد به أحمد") | Second-hand only | A grade, if it is used. The rule itself (husband 1/2, sister 1/2) follows from the Qur'an text |
| E11 | **The newborn's sign of life** (*istihlal*): which narration and which wording | Bulugh 1106's footnote cites at-Tirmidzi 1032, Ibn Majah 2750–2751 and Ibn Hibban 1223. It also says that the wording Ibn Hajar gives belongs to Abu Hurayra's hadith, and that Abu Dawud narrated Abu Hurayra's version, not Jabir's | The primary texts, to settle which wording to quote; see E6. Fiqh as-Sunnah 857 quotes it as Abu Hurayra's |

---

## 8. Open questions

**For the operator:**
1. **Bulugh numbering (E5).** Get a sunnah.com API key, or accept "cite the primary source, not the Bulugh number" for this track?
2. **Should the extraction script live in the repo?** Moving `build_dalil.py` and `ar.py` from the scratchpad into `belajar/pipeline/` (for example as a `waris_dalil.py` stage) would make `dalil.json` reproducible, and lets CI check the Tanzil bytes. I could not do this, because the pipeline directory is being edited by other agents.
3. **QuranEnc for surahs 2, 4, 8 and 33** was fetched into the session scratchpad, not pinned in `belajar/pipeline/sources.json` (only surah 1 is pinned). The pipeline owner should add these to the registry with their sha256 values (listed in the JSON `META.sources.quranenc`).

**For the ustadz reviewer:**

4. Is Bulugh 1107 ("لَيْسَ لِلْقَاتِلِ…"), whose grade is disputed, acceptable as the displayed dalil for the killer barrier? Or should the lesson lead with al-Shafi'i's report of no disagreement (al-Umm 550)?
5. For "a father excludes the siblings" and "debt before bequest", the corpus has reported consensus but no explicit marfu' text. Is "para ulama sepakat (Ibnu Katsir, Tafsir 4:176; asy-Syafi'i, al-Umm)" the right register for lay readers?
6. 4:8 (giving to relatives present at the division): may the lesson present it as *sunnah/adab* while noting the *khilaf* (Ibn 'Abbas: still in force; Ibn Kathir: the jumhur say abrogated)? Or should it leave the *naskh* question out?

**For the STANDARD (MUI/KHI) researcher and the engine:** where the corpus shows *khilaf*, the questionnaire must follow one documented choice:

| # | Question | Disputed records |
|---|---|---|
| 7 | Accidental killer | `R-barrier-killer` |
| 8 | Bequest to an heir that the other heirs approve | `R-no-wasiyya-heir`: the hadith addition is graded *munkar*, while Syafi'i fiqh allows it |
| 9 | *Radd*, including to a spouse | `R-radd` |
| 10 | *Dzawil arham* | `R-dzawil-arham` |
| 11 | Grandfather with the deceased's siblings | `R-grandfather` |
| 12 | *Musytarakah* | `R-special-cases` |

---

## 9. Sources consulted (outside the repo)

| Source | URL | Used for |
|---|---|---|
| Tanzil text licence | https://tanzil.net/docs/text_license | Licence of the Qur'an text (also quoted in the pinned file's footer) |
| Tanzil translations | https://tanzil.net/trans/ | Licence of `id.indonesian` / `en.sahih` (non-commercial; see `docs/belajar-research/quran-data.md`) |
| QuranEnc API, `indonesian_affairs` per surah | https://quranenc.com/api/v1/translation/sura/indonesian_affairs/4 (also /2, /8, /33) | Indonesian translation text + footnotes (retrieved 2026-10-09) |
| QuranEnc translations list (ID) | https://quranenc.com/api/v1/translations/list/id?localization=id | Version 1.0.1, title as QuranEnc names it |
| fawazahmed0 hadith-api, Muslim sections 23 and 25 | https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-muslim/sections/23.json (and /25.json) | Sequential → Fuad Abd al-Baqi numbers for Muslim |
| sunnah.com canonical URLs | https://sunnah.com/bukhari:6732 · https://sunnah.com/muslim:1615a (pattern) | Stored as `url` for Bukhari and Muslim. **Not fetched**: sunnah.com returned 403 / a Cloudflare challenge on 2026-10-09 |
| tohed.com Bulugh, Bab al-Fara'id | https://en.tohed.com/hadith/bulugh-al-maram/chapter/730/sub/22474/ | Shows a third numbering (805–817) for the 13 fara'id entries |
| AhmedBaset hadith-json | https://github.com/AhmedBaset/hadith-json | Origin of the corpus's Bulugh data (scraped from sunnah.com, per the repo) |
| MUI Fatwa 5/MUNAS VII/MUI/9/2005 (via `standard.md` §1.1) | https://fatwamui.com/storage/305/39.-Kewarisan-Beda-Agama.pdf | Why Q 4:141 and Bulugh 1098 are in the set. I did not re-read the fatwa; the citation is the STANDARD researcher's |

*AI-assisted research, not an authoritative fatwa. All rule statements above are summaries for lesson authors and must be checked by an ustadz before publication.*
