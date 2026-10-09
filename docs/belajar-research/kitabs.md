# kitabs

## SUMMARY
- Licensing, not availability, decides what the module can use. Almost every kitab is online (Shamela, archive.org, waqfeya). But Shamela's own terms say it grants no reuse rights, and Indonesian law (UU 28/2014 Pasal 40(1)(n)) explicitly protects terjemahan, tafsir and basis data as works. So each lesson component needs a source whose status is clear.
- A Qur'an learning module is probably a "Mushaf Al-Qur'an" under PMA 44/2016. Pasal 1(1) covers "bagian dari surah atau ayat-ayatnya, baik cetak maupun digital", and Pasal 2 requires a Surat Tanda Tashih from LPMQ. Pasal 4(1) also says publications must follow the Mushaf Standar Indonesia. Talk to LPMQ before building.
- MASAQ (Mendeley v5, CC BY 4.0) is the best open i'rab data: per word it gives mu'rab/mabni status, syntactic role (55 functions), case/mood and case marker. That is exactly the "why fathah/dammah" layer. EQTB (2025, CC BY 4.0) gives full-Qur'an syntax built from Darwish, Safi, al-Da'as, ad-Durr al-Masun, al-Nahhas and others. The Quranic Arabic Corpus (GPL, verbatim-only) adds roots and lemmas.
- The standard human i'rab references are Darwish's I'rab al-Qur'an wa Bayanuh (d. 1982) and Safi's al-Jadwal (d. 1985). Both are on Shamela with print-matching page numbers. Both remain under copyright in Indonesia until 2052 and 2055. Use short quotes with citations only (Pasal 44), never bulk ingestion.
- These pesantren curricula are public domain in Indonesia and fit the audience: Al-Ajurrumiyyah (d. 723H), Imrithi (d. ~989H), Mukhtashar Jiddan (Zaini Dahlan, d. 1304H), Al-Amtsilah at-Tashrifiyyah (KH Ma'shum Ali, d. 1933), Jawahir al-Balaghah (d. 1943) and Marah Labid (Nawawi al-Bantani, d. 1316H). Their modern Indonesian translations (e.g., Moch. Anwar) are copyrighted.
- Light tafsir in Indonesian:
  - Primary, with clear reuse terms: Kemenag Terjemah 2019 (verified in the QuranEnc API as indonesian_affairs v1.0.1) and Al-Mukhtasar Indonesian (QuranEnc, includes "Faedah Ayat").
  - Public domain: Jalalayn, Ibn Kathir AR, al-Tabari, Marah Labid. As-Sa'di becomes public domain in Indonesia on 1 Jan 2027.
  - Reference only, under copyright: Tafsir al-Misbah (living author) and Tafsir Al-Azhar (until end-2051).
- The platform's existing data has problems this module would inherit:
  - `api/data/quran.json` (AlQuran.cloud) adds the basmalah to the start of ayah 1 in 112 surahs. A naive basmalah count gives 114 ayat instead of 2 (1:1 and 27:30).
  - Uthmani spelling makes مَٰلِكِ normalize to ملك (0 hits for مالك).
  - The ID translation is the old "Maha Pemurah" edition, not Kemenag 2019.
  - The EN Ibn Kathir is the abridged Mubarakpuri (Darussalam) edition, which is copyrighted.
- Fatihah hadith already exist in the platform corpus: Bukhari 4474 (greatest surah), 756 (no prayer without it), 2276/5007 (ruqyah); Muslim "qasamtu as-salah" and "two lights"; Riyad as-Salihin. Muslim's local JSON numbers (878, 1877) are not canonical, so citations must go through the canonical mapping. Tirmidhi (maghdub/dallin) is not in the corpus.
- Corrections to the brief: "Metode Al-Bayan" (Surasman, 2008) teaches Qur'an reading/tajwid, not Arabic grammar. I could not identify a "Nahwu Shorof Quran" program (UNVERIFIED). Qur'an-to-grammar methods that are verified: Metode Tamyiz (Indramayu, song-based), Amtsilati (Jepara, copyrighted) and Understand Quran (copyrighted).

## RECOMMENDATIONS
- **Build the Al-Fatihah v0 by hand, using datasets only as a starting point.** Al-Fatihah has just 29 words. For each word, an ustadz writes the gloss, root, pattern, i'rab and the reason for its haraka. MASAQ and QAC are the starting point, and each word is checked against Darwish and Safi. Store every claim with a citation (kitab, volume/page) in the module's own database. This applies the "retrieved, never generated" rule at word level and needs no LLM spending.
- **Use MASAQ (CC BY 4.0) as the default i'rab layer, with QAC for roots and lemmas.** Pin the exact versions (MASAQ Mendeley v5; QAC 0.4) and display the attribution lines they require. Do not edit QAC files, because its license allows verbatim copies only. Keep any corrections in a separate overlay table.
- **Primary Indonesian tafsir: Kemenag Terjemah 2019 + Tafsir Ringkas, plus Al-Mukhtasar ID** (with its "Faedah ayat").
  - Indonesian-heritage and public-domain depth: Marah Labid and Jalalayn (AR).
  - Classical depth already in the corpus: Ibn Kathir AR and al-Tabari AR.
  - Add as-Sa'di AR after 1 Jan 2027.
  - Use Tafsir al-Misbah and Tafsir Al-Azhar for reading lists and links only.
- **Grammar teaching frames should use public-domain pesantren texts:** Ajurrumiyyah + Mukhtashar Jiddan (signs of i'rab), Imrithi (chanted), Al-Amtsilah at-Tashrifiyyah (tasrifan drills), Jawahir al-Balaghah. Write simple explanations in our own words. Use Nahwu Wadhih and Mulakhkhas as style models only.
- **Compute encyclopedia counts from lemma/root data in MASAQ/QAC, never from `api/data/quran.json`.** State the counting convention on screen (Hafs/Kufan numbering, basmalah counted only at 1:1, lemma vs root vs surface form) and cross-check against Al-Mu'jam al-Mufahras. The basmalah cross-reference (1:1 and 27:30) is verified.
- **Fix the module's own Qur'an source rather than reusing quran.json.** Take the Mushaf Standar text and Terjemah 2019 from the Kemenag API, or Tanzil Uthmani verbatim, and remove the prepended basmalahs. Make sure the harakat shown match the script being taught.
- **Hadith:** take Fatihah hadith from the existing Qdrant collections, which use canonical numbering. Re-confirm the Muslim numbers (local 878/1877 vs the commonly cited 395/806) through the existing canonical mapping before publishing. Cite Tirmidhi material only through Ibn Kathir's quotations, unless Jami' at-Tirmidhi is added to the corpus.
- **Licensing actions (operator approval needed):**
  - (a) Send the LPMQ request letter for the Kemenag API, and ask whether the module needs a Surat Tanda Tashih under PMA 44/2016.
  - (b) Email QuranEnc and Markaz Tafsir to confirm use in an app that may be paid.
  - (c) Ask the Darwish publishers (Dar al-Irshad, Dar Ibn Kathir, Dar al-Yamamah) and Safi's (Dar al-Rashid / Mu'assasat al-Iman) whether quotes longer than a short Pasal 44 quotation would be needed.
- **Do not use Quran Foundation, QUL or OpenITI content as stored or embedded retrieval sources.** QF limits caching to one week and restricts embeddings; QUL's per-resource licenses are undocumented; OpenITI is non-commercial and share-alike. Use them for discovery only.
- **Additional lesson types** taken from these sources:
  - a "makna gandul" colour overlay (utawi/iku/sopo/ing)
  - chanted tasrifan and nazham
  - a mini-lesson on the qira'at مَالِكِ/مَلِكِ (using al-Tabari)
  - an interactive version of the "qasamtu as-salah" hadith qudsi
  - a frequency badge for each Fatihah word
- **Budget:** the public-domain and CC BY sources cost nothing. The main cost is ustadz review time (about 29 words plus 7 ayat of tafsir). Only flag a budget breach if publisher permission fees come up, which is UNVERIFIED.

## RISKS
- **PMA 44/2016 compliance (decision needed).** A digital module that shows Qur'an portions probably counts as a "Mushaf Al-Qur'an" (Pasal 1(1)), which requires a Surat Tanda Tashih (Pasal 2) and the Mushaf Standar (Pasal 4(1)). The same question may already apply to the main dakwah-lens site. Ask LPMQ first. The 30-working-day standard service time comes from a search summary and is UNVERIFIED.
- **Free or paid module? (decision needed).** This decides whether Tanzil translations (non-commercial only), OpenITI (CC BY-NC-SA) and QuranEnc (commercial use not addressed) can be used.
- **Copyright on modern i'rab works.** Darwish is protected until end-2052, Safi until end-2055, and al-Da'as and al-I'rab al-Mufassal are also protected. Pasal 44 allows only cited excerpts that do not harm the rights holder's reasonable interests. Bulk-embedding them into Qdrant for public retrieval would likely go beyond that.
- **Indonesian law also protects databases and tafsir (Pasal 40(1)(n)).** Shamela's digitizations and muhaqqiq footnotes may be protected even when the base text is public domain. Transcribe public-domain passages against print scans, cite the edition and page, and leave out editor footnotes.
- **Existing platform data licensing.** The corpus's EN Ibn Kathir is the abridged Mubarakpuri (Darussalam) edition, mirrored from quran.com through spa5k/QUL. Sahih International EN is copyrighted. The ID translation in quran.json is not Kemenag. These are acceptable for internal briefing prose but not as public learning content. Their status is unclear (UNVERIFIED).
- **Datasets need review before use.**
  - MASAQ's own paper reports annotation inconsistencies and i'rab that depends on interpretation.
  - EQTB and MASAQ derive from QAC and Tanzil, whose upstream licenses are GPL/verbatim and CC BY 3.0/verbatim. That license chain is unclear even though both are labelled CC BY 4.0.
  - Every word must be checked by an ustadz before publishing.
- **Sectarian and aqidah sensitivity.**
  - Ibn al-Qayyim's "three types of tawhid" framing in Madarij is contested among Asy'ari/NU audiences.
  - Al-Kashshaf is Mu'tazili.
  - Whether the word "Allah" is derived from الإلاه (Safi presents this) is a matter on which scholars differ.
  - For al-maghdub/ad-dallin, Mukhtasar ID's benefits note names "Nasrani", while Kemenag 2019's footnote frames it by behaviour ("sengaja menentang ajaran Islam").
  - Decide how the module presents classical attributions while keeping the rahma/hikmah, non-sectarian voice. Always attribute views ("menurut …").
- **UNVERIFIED items:**
  - death year of Mustafa Amin (co-author of Nahwu Wadhih and Balaghah Wadhihah), and so their public-domain status
  - death year of Fu'ad Ni'mah
  - death date of Mundzir Nadzir
  - canonical sunnah.com numbers for the Muslim Fatihah hadith (fetch returned 403)
  - Understand Quran's Indonesian materials (page 404)
  - the existence of a "Nahwu Shorof Quran" program
  - license terms of QUL mutashabihat and word-by-word data
  - KFGQPC's own reuse policy for Tafsir al-Muyassar
  - whether Kemenag's printed terjemah or tafsir carries a "dilindungi" notice that would cancel the Pasal 43(b) exception
- **Hadith Arabic read by TTS.** The house rule bans TTS for Qur'an recitation only. Decide whether hadith Arabic (e.g., the hadith qudsi dialogue) may be narrated with ElevenLabs eleven_v3, or must use human audio as well.
- **Different countries' copyright rules.** The site is hosted in Indonesia but readable worldwide. Saudi Arabia (life+50) and Syria/Lebanon may differ from Indonesia's life+70. A short legal review is advisable before launch.

## REPORT
## 1. Legal frame for quoting on a public site (verified)

| Rule | Text / effect | Source |
|---|---|---|
| UU 28/2014 Pasal 58(1) | Books: author's life + 70 yrs, counted from 1 Jan of the following year | pasal.id |
| Pasal 58(2) | Joint works: the last-surviving author governs | pasal.id |
| Pasal 58(3) | Works owned by a badan hukum: 50 yrs from first publication | pasal.id |
| Pasal 40(1)(n) | "terjemahan, tafsir, saduran, bunga rampai, basis data…" are protected works | pasal.id |
| Pasal 43(b) | Works made by or for the government are free to reproduce "kecuali dinyatakan dilindungi" | pasal.id |
| Pasal 44(1) | Education, research and critique use is allowed **if the source is cited** and the creator's reasonable interests are not harmed | pasal.id |
| PMA 44/2016 Ps.1(1), 2, 4(1) | Mushaf = full Qur'an "dan/atau bagian dari surah atau ayat-ayatnya, baik cetak maupun digital"; needs a Surat Tanda Tashih; must follow the Mushaf Standar | tashih.kemenag.go.id PDF |
| PMA 44/2016 Ps.1(8), 8 | Tashih covers "terjemah dan tafsir Kementerian Agama". The Qur'an text has no copyright, but khat, tajwid/qira'at marks and illumination belong to the publisher | same |
| Shamela terms | "Rights in books… remain with their respective holders"; "These terms do not grant rights to reuse content" | shamela.ws/page/terms |

**Consequence:** sources fall into three tiers.
- **Tier A: public-domain classical base texts** (author died ≤1955). These can be quoted, but cite the print edition and page, and do not copy the muhaqqiq's footnotes, which are a protected adaptation.
- **Tier B: openly licensed datasets.**
- **Tier C: copyrighted modern works.** Short, attributed quotes only, or written permission.

The copyright dates below apply Indonesian law. Rules in other countries may differ (UNVERIFIED; get a legal review).

## 2. Machine-readable data available now

| Resource | What it gives the module | License / terms (verified) |
|---|---|---|
| Quranic Arabic Corpus v0.4 (Dukes, Leeds) | Root, lemma, POS and features per segment. Its syntax treebank covers only ~49% of the Qur'an | GPL; "verbatim copies… CHANGING IT IS NOT ALLOWED"; credit and link to corpus.quran.com |
| **MASAQ** (Sawalha et al., 2024) | 131K morphological and 123K syntactic entries; mu'rab/mabni, 55 syntactic roles, case/mood, **case marker**. Formats: TSV, SQLite, CSV, JSON | Mendeley v5: **CC BY 4.0** |
| **EQTB** (Nashir et al., 2025) | 100% syntactic coverage (~132,736 tokens), CoNLL-X format. Built from 7 i'rab books: Saber's al-I'rab al-Mufassal, Safi, al-Da'as, ad-Durr al-Masun, al-Lubab, Darwish, al-Nahhas | **CC BY 4.0** (Mendeley rk96pn66m4) |
| Tanzil Qur'an text | Uthmani text | CC BY 3.0, verbatim only, credit and link |
| Tanzil translations (ar.muyassar, ar.jalalayn, id.muntakhab, id.jalalayn) | Tafsir and translations | "for non-commercial purposes only"; no redistribution of the list |
| QuranEnc API | Kemenag 2019 (indonesian_affairs v1.0.1), Sabiq, Complex; Mukhtasar ID | 7 conditions: no modification, credit with version number, keep up to date, no inappropriate ads. Commercial use not addressed (UNVERIFIED) |
| Qur'an Kemenag API (LPMQ) | Rasm Usmani Mushaf Standar text, Terjemah 2019, Tafsir Ringkas and Tahlili | Formal request letter to the Kepala LPMQ; no license text published |
| Quran Foundation API | Many tafsirs and recitations | In-app display allowed, including in paid apps; no redistribution; **cache ≤1 week**; ML/embedding use is restricted, and content-derived embeddings stay "subject to storage and use restrictions" |
| QUL (Tarteel) | 115 tafsirs, 22 word-by-word translations, morphology, **mutashabihat (5,277 links)** | Licensing is per resource and undocumented. GitHub issue #772 on tafsir licensing has no answer |
| OpenITI | Shamela-derived classical texts | CC BY-NC-SA 4.0 (the NC and SA terms conflict with a paid tier) |
| Lane's Lexicon (Perseus XML) | English root lexicon (public domain, 1863–93) | CC BY-SA 3.0 US; Perseus asks to be offered any modifications |

## 3. Arabic-learning curricula

| Kitab | Author, era | Content, level | Digital | Status (ID) | Fit |
|---|---|---|---|---|---|
| Al-Ajurrumiyyah | Ibn Ajurrum, d. 723H | Nahwu basics, the signs of i'rab; beginner | Shamela (old 11371) | PD | The canonical "why dammah" frame in pesantren |
| Mukhtashar Jiddan | Ahmad Zaini Dahlan, d. 1304H | Short commentary on Ajurrumiyyah | PDFs; NU Online profile | PD | Simple explanations |
| Nadham al-Imrithi | Syarafuddin al-Imrithi, d. ~988–990H (dates disputed) | ~254-verse versification of Ajurrumiyyah | Many | PD | Chantable nazham |
| Ilmu Nahwu: Terj. Jurumiyah & Imrithi | KH Moch. Anwar, Sinar Baru Algensindo 1995 | Indonesian explanation | Print | © | Reference for Indonesian terms only |
| Al-Amtsilah at-Tashrifiyyah | KH Ma'shum Ali, Seblak; d. 24 Ramadan 1351H / 8 Jan 1933 | Sharaf paradigms (istilahi and lughawi) | Print, PDFs | **PD** (the base tables) | Core source for root and pattern drills |
| Qawa'id al-I'lal | Syaikh Mundzir Nadzir | 19 rules for weak letters | PDFs | UNVERIFIED (death date unknown) | Explains changes like قول→قال |
| Mulakhkhas Qawa'id al-Lughah | Fu'ad Ni'mah, Dar al-Thaqafah al-Islamiyyah | Concise rules; intermediate | Print | © (death date UNVERIFIED) | Consult only |
| An-Nahwu al-Wadhih | Ali al-Jarim (d. 1949) and Mustafa Amin | Inductive, example-first grammar; used at Gontor | Shamela 10018, archive.org | Joint work; status depends on Mustafa Amin's death year (UNVERIFIED). A search confused him with the journalist (d. 1997), who is a different person | Model for the teaching style, not for copying |
| Al-Balaghah al-Wadhihah | Same authors | Bayan, ma'ani, badi' | archive.org | Same as above | Balaghah teaching frame |
| Jawahir al-Balaghah | Ahmad al-Hashimi, d. 1362H/1943 | Full balaghah | Shamela 9256 | PD (since 2014) | Quotable balaghah definitions |
| Durus al-Lughah (Gontor) | KH Imam Zarkasyi and Imam Syubani | Direct-method Arabic | Print | © | Indonesian modern-pesantren reference |
| Durus al-Lughah (Madinah) | V. Abdur Rahim | Graded Arabic | archive.org, shared "with permission" | © | Structure reference |
| Al-'Arabiyyah Bayna Yadayk | Al-Fawzan et al., Arabic for All | Communicative course | Print | © | Not Qur'an-focused |
| Amtsilati | KH Taufiqul Hakim (b. 1975), Darul Falah Jepara, 2001 | Fast method for reading kitab | Print | © | Inspiration only |
| Metode Tamyiz | Darul Ma'arif, Indramayu | Nahwu-sharaf through songs, aimed at translating the Qur'an | tamyiz.com | © | Shows that chanting and play work |
| Understand Quran | Abdulazeez Abdulraheem | Frequency-first Qur'an words; Indonesian materials page (404 on fetch) | Site, archive.org | "© Understand Al Quran Academy" | Frequency idea; compute our own counts |
| Bayyinah Dream; Fundamentals of Classical Arabic | NAK / H. Abdul Sattar | 9-month nahw/sarf intensive | Commercial | © | Benchmark only |
| "Metode Al-Bayan" | Surasman, 2008 | **Qur'an-reading/tajwid method, not grammar** | Print | © | Out of scope |

## 4. Qur'an i'rab, vocabulary and roots

| Kitab | Notes | Digital | Status |
|---|---|---|---|
| **I'rab al-Qur'an wa Bayanuh**, Darwish (d. 1403H/1982) | Per verse group: اللغة / الإعراب / البلاغة / الفوائد; 10 vols; Fatihah at shamela.ws/book/2163/5 | Shamela, page numbers match print | © until end-2052 |
| **Al-Jadwal fi I'rab al-Qur'an**, Mahmud Safi (d. 1985) | الإعراب / الصرف / البلاغة / الفوائد (the last two added by others, per the preface); 16 vols; e.g. the derivation of "Allah" from الإلاه | Shamela 22916/12 | © until end-2055 |
| I'rab al-Qur'an al-Karim, al-Da'as, Hamidan, al-Qasim (1425H) | Concise | Shamela (old 23584) | © |
| Ad-Durr al-Masun, al-Samin al-Halabi (d. 756H) | I'rab plus qira'at; ed. al-Kharrat, 11 vols | Shamela 9057 | PD base text; © editor's apparatus |
| Ma'ani al-Qur'an, al-Farra' (d. 207H); Ma'ani al-Qur'an wa I'rabuh, al-Zajjaj (d. 311H) | Early grammar-meaning works | Shamela 23634, 922 | PD |
| Al-Mufradat, ar-Raghib (d. 502H) | Core meaning of Qur'anic words; ed. Dawudi | Shamela 23636 | PD base text |
| Al-Mu'jam al-Mufahras, Fu'ad 'Abd al-Baqi (d. 1967) | Occurrence index | waqfeya / archive.org scans | © until end-2037. The counts themselves are facts |
| Lisan al-'Arab; al-Kashshaf; al-Bahr al-Muhit | Roots; balaghah; grammar | Widely digitized (not re-checked this pass) | PD. Al-Kashshaf is Mu'tazili, so caution |

## 5. Light tafsir

| Tafsir | Language | Status / access |
|---|---|---|
| **Kemenag Terjemah 2019** | ID | Government work (Pasal 43b), subject to tashih. QuranEnc text verified: "Dengan nama Allah Yang Maha Pengasih, Maha Penyayang… Pemilik hari pembalasan" |
| Kemenag Tafsir Ringkas / Tahlili | ID | Kemenag API, by request letter |
| **Al-Mukhtasar fi at-Tafsir** (Markaz Tafsir; 6th, final-reviewed edition 1442H) | AR plus **ID** | QuranEnc conditions apply; includes "Beberapa Faedah Ayat-ayat" |
| Tafsir al-Muyassar (KFGQPC, 1998) | AR | Corporate © to ~2048; Tanzil copy is non-commercial; Shamela 1407 |
| Tafsir al-Jalalayn | AR (PD) | ID translation by Bahrun Abu Bakar (Sinar Baru) is © |
| **Marah Labid**, Nawawi al-Bantani (d. 1316H) | AR | PD; Shamela 22769; Indonesian scholar, with linguistic and i'rab notes |
| As-Sa'di, Taysir al-Karim ar-Rahman (d. 1376H/1956) | AR | **Public domain in Indonesia from 1 Jan 2027**; the Darul Haq ID translation is © |
| Ibn Kathir AR; al-Tabari AR | AR | PD; already in the platform's Qdrant |
| Tafsir al-Misbah (Quraish Shihab, living) | ID | © (Lentera Hati) |
| Tafsir Al-Azhar (Hamka, d. 24 Jul 1981) | ID | © until end-2051 |

## 6. Works on Al-Fatihah specifically, and hadith

- **Ibn Rajab, Tafsir Surat al-Fatihah** (d. 795H; Shamela 29574). Covers where it was revealed, number of verses, its names, virtues and rulings. Public domain.
- **Ibn al-Qayyim, Madarij as-Salikin** (Shamela 199/160). Has a chapter on how Al-Fatihah contains the types of tawhid, plus the "manazil iyyaka na'budu". Use the spiritual reflections; the tawhid-classification framing is contested among Asy'ari/NU readers.
- **Hadith in the platform corpus:**
  - Bukhari 4474 (أعظم سورة, as-sab' al-mathani), 756 (لا صلاة لمن لم يقرأ بفاتحة الكتاب), 2276/5007 (ruqyah).
  - Muslim: the "qasamtu as-salah" hadith qudsi (local sequence numbers 878/879) and "two lights" (local 1877). These are commonly cited as Muslim 395 and 806; that is UNVERIFIED because sunnah.com returned 403.
  - Riyad as-Salihin (local 330).
  - Tirmidhi is **not** in the corpus. However, the corpus's Ibn Kathir AR quotes the Tirmidhi material, so it can be retrieved through the tafsir.

## 7. Reference stack per lesson component

| Component | Primary | Secondary | Machine-readable now? | Public quoting |
|---|---|---|---|---|
| Word meaning (ID) | Ustadz-written per-word gloss, aligned to Kemenag 2019 | al-Mufradat; Mukhtasar ID; Kamus Al-Munawwir (verification only) | Kemenag yes (QuranEnc/API); glosses are manual (29 words) | Kemenag after tashih; Mufradat PD; Munawwir © |
| Root / sharaf | QAC root + lemma; MASAQ morphology | Amtsilah paradigms (PD); Safi's الصرف sections; Qawa'id al-I'lal | Yes | QAC verbatim + credit; Safi short quotes |
| I'rab / nahwu | MASAQ role + case + case marker, checked word by word against Darwish | Safi, al-Da'as, ad-Durr al-Masun, EQTB | Yes (MASAQ/EQTB) | Darwish/Safi: cite, quote briefly |
| Reason for each haraka | Ajurrumiyyah signs of i'rab + MASAQ case marker | Mukhtashar Jiddan; Nahwu Wadhih style; Amtsilah for internal vowels | Partial | PD frames; own wording |
| Balaghah | Darwish and Safi البلاغة sections | Jawahir al-Balaghah (PD); al-Kashshaf (with caution) | No (manual) | Short quotes |
| Light tafsir | Kemenag Tafsir Ringkas + Mukhtasar ID | Jalalayn, Marah Labid, Ibn Kathir, al-Tabari, Muyassar, as-Sa'di (2027+) | Kemenag via request; Mukhtasar via QuranEnc; corpus | As in §5 |
| Counts and cross-references | Computed from a pinned MASAQ/QAC lemma/root version | Checked against Mu'jam Mufahras; QUL mutashabihat (license UNVERIFIED) | Yes | Facts; credit the dataset |
| Hadith | Platform corpus with canonical citations | Ibn Kathir's quotations | Yes | Existing pipeline |
| Deep dive (tadabbur) | Ibn Rajab, Tafsir al-Fatihah | Madarij; Marah Labid | Shamela lookup | PD base text |

## 8. Problems in the existing dakwah-lens corpus that affect this module (verified locally)

- `api/data/quran.json` comes from AlQuran.cloud (`quran-uthmani`). It adds the basmalah to ayah 1 of 112 surahs.
  - A phrase search finds 114 "basmalah ayat"; the correct answer is 2 (1:1 and 27:30, which is verified as إِنَّهُۥ مِن سُلَيْمَٰنَ وَإِنَّهُۥ بِسْمِ ٱللَّهِ…).
  - Surface counts of الرحمن (157) are inflated by 112.
  - After normalization, مَٰلِكِ becomes ملك, so مالك returns 0 hits.
  - Encyclopedia counts must therefore be lemma-based and computed from a pinned dataset version.
- Its `id` field is the "Indonesian Society" text ("Maha Pemurah lagi Maha Penyayang"), not Kemenag 2019. It also has OCR errors ("SuIaiman" in 27:30) and a BOM at 1:1.
- The EN Ibn Kathir is "abridged — Mubarakpuri's edition" (comment in `download_tafsir.py`), mirrored from quran.com/QUL through spa5k/tafsir_api. That text is copyrighted, and Quran Foundation's terms may apply to it.
- Muslim's local `hadithnumber` values are sequential, not canonical.

## 9. Extra lesson ideas grounded in these sources

- **Makna gandul overlay.** Colour-coded i'rab using the pesantren symbols: utawi = mubtada' (م), iku = khabar (خ), sopo = fa'il (فا), ing = maf'ul (مف). This tradition is documented by alif.id and Lembaga Dakwah PBNU.
- **Tasrifan drills** from Al-Amtsilah, chanted. These are not Qur'an, so ElevenLabs narration is allowed.
- **Imrithi or Tamyiz-style songs** for the signs of i'rab.
- **Qira'at mini-lesson** on مَالِكِ vs مَلِكِ, using al-Tabari (already in the corpus) and ad-Durr al-Masun.
- **"Faedah ayat" takeaway cards** from Al-Mukhtasar ID.
- **Hadith-qudsi dialogue** ("qasamtu as-salah"): the learner recites an ayah and the app shows the retrieved response text.
- **Balaghah spotlights** on taqdim iyyaka and iltifat. Locate the exact pages in Darwish/Safi first (UNVERIFIED at page level).
- **Frequency badge** for the 29 Fatihah words, computed from MASAQ/QAC (Understand-Quran style).

## SOURCES
- Quranic Arabic Corpus – Data Download (morphology v0.4) | https://corpus.quran.com/download/ | GNU GPL; verbatim copies only, 'CHANGING IT IS NOT ALLOWED'; attribution + link to corpus.quran.com | Root/lemma/POS per word; encyclopedia counts
- Quranic Arabic Corpus v2 repository (Kais Dukes) | https://github.com/kaisdukes/quranic-corpus | GPL-3.0 (repo); data/code split not stated | Upstream status of QAC
- MASAQ dataset v5 (Mendeley Data) | https://data.mendeley.com/datasets/9yvrzxktmr/5 | CC BY 4.0 | Per-word i'rab: mu'rab/mabni, syntactic role, case/mood, case marker
- MASAQ paper (Data in Brief, PMC11741905) | https://pmc.ncbi.nlm.nih.gov/articles/PMC11741905/ | Open-access article; notes annotation inconsistencies | MASAQ fields, method, limitations
- Extended Quranic Treebank (EQTB) paper (PMC12361616) | https://pmc.ncbi.nlm.nih.gov/articles/PMC12361616/ | CC BY 4.0 (article) | Full-Qur'an syntax; list of 7 i'rab reference books used
- EQTB dataset (Mendeley rk96pn66m4) | https://data.mendeley.com/datasets/rk96pn66m4/1 | CC BY 4.0 | Complete syntactic annotation, CoNLL-X
- Tanzil Quran text license | https://tanzil.net/docs/text_license | CC BY 3.0, verbatim only, attribution + link (verified via search result; page not fetched directly) | Qur'an text licensing
- Tanzil translations page | https://tanzil.net/trans/ | Non-commercial only; permission from translator/publisher otherwise; no redistribution of list | ar.muyassar, ar.jalalayn, id.muntakhab, id.jalalayn availability
- QuranEnc API (Ensiklopedia Al-Qur'an Al-Karim) | https://quranenc.com/en/home/api/ | 7 conditions: no modification, cite publisher+QuranEnc, version number, keep metadata, report issues, update, no inappropriate ads; commercial use not addressed | Kemenag 2019 (indonesian_affairs v1.0.1) and other ID translations
- QuranEnc – Al-Mukhtasar Indonesian, Al-Fatihah | https://quranenc.com/id/browse/indonesian_mokhtasar/1 | QuranEnc reuse conditions | Light tafsir ID + 'Faedah ayat'
- Qur'an Kemenag API (LPMQ) | https://quran-api.lpmqkemenag.id/ | Registration + formal request letter to Kepala LPMQ; no license text published | Mushaf Standar text, Terjemah 2019, Tafsir Ringkas/Tahlili
- PMA No. 44 Tahun 2016 (Penerbitan, Pentashihan, Peredaran Mushaf) | https://tashih.kemenag.go.id/uploads/1/2018-05/pma_nomor_44_tahun_2016.pdf | Regulation (public) | Tashih obligation for digital/partial mushaf; Mushaf Standar; Pasal 8 copyright of text vs khat/marks
- UU 28/2014 Pasal 58 (term) | https://pasal.id/peraturan/uu/uu-no-28-tahun-2014/pasal-58 | Statute | Life+70, joint works, badan hukum 50 yrs
- UU 28/2014 Pasal 40 | https://pasal.id/peraturan/uu/uu-no-28-tahun-2014/pasal-40 | Statute | Terjemahan, tafsir, basis data protected
- UU 28/2014 Pasal 43 | https://pasal.id/peraturan/uu/uu-no-28-tahun-2014/pasal-43 | Statute | Government-work exception
- UU 28/2014 Pasal 44 | https://pasal.id/peraturan/uu/uu-no-28-tahun-2014/pasal-44 | Statute | Education/quotation exception with source citation
- Quran Foundation Developer Terms | https://api-docs.quran.foundation/legal/developer-terms/ | Display in-app OK (incl. paid); no redistribution; cache ≤1 week; ML/embedding restrictions | Constraints on QF tafsir/recitation content
- QUL FAQ | https://qul.tarteel.ai/faq | Per-resource licensing; 'review the licensing terms for each resource' | Mutashabihat, WBW, tafsir datasets
- QUL GitHub issue #772 (tafsir licensing) | https://github.com/TarteelAI/quranic-universal-library/issues/772 | Open question, no maintainer reply | Evidence QUL tafsir licensing is unclear
- spa5k/tafsir_api | https://github.com/spa5k/tafsir_api | MIT (code); content mostly from QUL exports, per-edition terms not stated | Provenance of platform's Ibn Kathir/Tabari data
- Shamela terms of use | https://shamela.ws/page/terms | Rights remain with holders; no reuse rights granted | Shamela = lookup/verification, not license
- Shamela – I'rab al-Qur'an wa Bayanuh (Darwish) | https://shamela.ws/book/2163 | Copyright (author d. 1982) | I'rab, lughah, balaghah, fawa'id per verse group
- Shamela – Al-Jadwal fi I'rab al-Qur'an (Safi) | https://shamela.ws/book/22916 | Copyright (author d. 1985) | I'rab + sharf per word
- Shamela – Mahmud Safi author page | https://shamela.ws/author/1112 | Reference | Death date 1405H/1985
- Shamela (old) – I'rab al-Qur'an (al-Da'as et al.) | https://old.shamela.ws/index.php/book/23584 | Copyright | Concise i'rab cross-check
- Shamela – Ad-Durr al-Masun (al-Samin al-Halabi) | https://shamela.ws/book/9057 | PD base text; tahqiq al-Kharrat apparatus copyrighted | I'rab + qira'at
- Shamela – Ma'ani al-Qur'an (al-Farra') | https://shamela.ws/book/23634 | PD base text | Early grammar-meaning
- Shamela – Ma'ani al-Qur'an wa I'rabuh (al-Zajjaj) | https://shamela.ws/book/922 | PD base text | Early grammar-meaning
- Shamela – Al-Mufradat fi Gharib al-Qur'an | https://shamela.ws/book/23636 | PD base text; tahqiq Dawudi copyrighted | Core word meanings
- Waqfeya – Al-Mu'jam al-Mufahras (Fu'ad 'Abd al-Baqi) | https://waqfeya.net/book.php?bid=1392 | Copyright in ID to end-2037 (d. 1967 per ar.wikipedia); counts are facts | Verifying occurrence counts
- Arabic Wikipedia – Al-Mu'jam al-Mufahras | https://ar.wikipedia.org/wiki/%D8%A7%D9%84%D9%85%D8%B9%D8%AC%D9%85_%D8%A7%D9%84%D9%85%D9%81%D9%87%D8%B1%D8%B3_%D9%84%D8%A3%D9%84%D9%81%D8%A7%D8%B8_%D8%A7%D9%84%D9%82%D8%B1%D8%A2%D9%86_%D8%A7%D9%84%D9%83%D8%B1%D9%8A%D9%85 | CC BY-SA (Wikipedia) | Author dates
- Shamela – Tafsir al-Muyassar | https://shamela.ws/book/1407 | KFGQPC corporate copyright | Simplified Arabic tafsir
- Shamela – Al-Mukhtasar fi Tafsir al-Qur'an | https://shamela.ws/book/18102 | Markaz Tafsir copyright | Arabic Mukhtasar
- Shamela – Marah Labid (Nawawi al-Bantani) | https://shamela.ws/book/22769 | PD (d. 1316H) | Indonesian-heritage tafsir with i'rab notes
- Shamela – Tafsir Surat al-Fatihah (Ibn Rajab) | https://shamela.ws/book/29574 | PD base text | Fatihah names, virtues, rulings
- Shamela – Madarij as-Salikin, Fatihah & tawhid chapter | https://shamela.ws/book/199/160 | PD base text; edition apparatus copyrighted | Fatihah tadabbur (with framing caution)
- Shamela (old) – Al-Ajurrumiyyah | https://old.shamela.ws/index.php/book/11371 | PD | Signs of i'rab framework
- NU Online – Mukhtasar Jiddan | https://www.nu.or.id/pustaka/mukhtasar-jiddan-syarah-jurumiyah-ringkas-untuk-pemula-rtk7N | Article (reference) | Zaini Dahlan sharh, d. 1304H
- Detik Hikmah – Mengenal Kitab Imrithi | https://www.detik.com/hikmah/khazanah/d-7168254/mengenal-kitab-imrithi-pengarang-alasan-penulisan-dan-isinya | Article (reference) | Imrithi author and content
- NU Online – Kiai Ma'shum bin Ali dan karya-karyanya | https://www.nu.or.id/tokoh/kiai-marsquoshum-bin-ali-dan-karya-karyanya-4bn30 | Article (reference) | Al-Amtsilah at-Tashrifiyyah
- NU Jombang – Mengenang 92 tahun wafat KH M Ma'shum Ali | https://jombang.nu.or.id/opini/mengenang-92-tahun-kh-m-ma-shum-ali-wafat-menyingkap-misteri-pembakaran-foto-diri-P9uVk | Article (reference) | Death date 1351H/1933 → PD
- IMMIM Pangkep – Mengenal Kitab Qowaidul I'lal | https://immimpangkep.ponpes.id/blogguru/blog/mengenal-kitab-shorof-qowaidul-ilal/ | Article (reference) | Qawa'id al-I'lal author/content
- Shamela – An-Nahwu al-Wadhih | https://shamela.ws/book/10018 | Joint work; status UNVERIFIED (co-author death date) | Inductive grammar style
- Shamela – Ali al-Jarim author page | https://shamela.ws/author/2012 | Reference | Al-Jarim d. 1949
- Internet Archive – Al-Balaghah al-Wadhihah | https://archive.org/details/ar114rhet43 | No license stated; status UNVERIFIED | Balaghah teaching frame
- Shamela – Jawahir al-Balaghah (al-Hashimi) | https://shamela.ws/book/9256 | PD in ID (d. 1943) | Balaghah definitions
- UIN Suska OPAC – Moch. Anwar, Ilmu Nahwu (Jurumiyah & Imrithi) | https://inlislite.uin-suska.ac.id/opac/detail-opac?id=6904 | Copyright (Sinar Baru Algensindo) | Indonesian nahwu terminology
- UIN Suka – KH Taufiqul Hakim & Amtsilati | https://digilib.uin-suka.ac.id/id/eprint/66106/ | Thesis (reference); Amtsilati copyrighted | Amtsilati background
- Metode Tamyiz official | https://tamyiz.com/2018/08/19/metode-tamyiz-mudah-terjemah-al-quran-dan-baca-kitab-kuning/ | Copyright | Song-based nahwu-sharaf method precedent
- Kepri library – Metode Al-Bayan (Surasman) | https://dpk.kepriprov.go.id/opac/detail/2c60n | Copyright | Shows Al-Bayan is a reading method
- Internet Archive – Durusul Lughah (V. Abdur Rahim) | https://archive.org/details/DurusulLughahAlArabiyah | Copyright; distributed with author permission per distributors | Graded Arabic structure
- ResearchGate – Durus al-Lughah Gontory | https://www.researchgate.net/publication/331352295_Durus_Al-Lughah_Gontory_Media_Pembelajaran_Bahasa_Arab_untuk_Pemula_Menggunakan_Metode_Langsung | Paper (reference) | Gontor curriculum
- Understand Al-Qur'an Academy | https://understandquran.com/ | © Understand Al Quran Academy | Frequency-first pedagogy
- Bayyinah Dream curriculum | https://dream.bayyinah.com/curriculum-3/ | Commercial | Benchmark curriculum
- Perseus – Lane's Arabic-English Lexicon | http://www.perseus.tufts.edu/hopper/text?doc=Perseus%3Atext%3A2002.02.0041 | CC BY-SA 3.0 US (XML; offer modifications to Perseus) | English root lexicon
- OpenITI primary release (Zenodo) | https://zenodo.org/records/10021513 | CC BY-NC-SA 4.0 | Machine-readable classical texts (NC caveat)
- Alukah – biography of as-Sa'di (1307–1376H) | https://www.alukah.net/social/0/50263/ | Article (reference) | Sa'di death → PD in ID from 2027
- Darul Haq – Tafsir as-Sa'di (ID) | https://www.darulhaq-online.com/product/tafsir-al-quran-syaikh-abdurrahman-as-sadi | Copyright | Indonesian Sa'di translation
- UIN Antasari – Biografi Hamka & Tafsir al-Azhar | https://idr.uin-antasari.ac.id/24539/6/BAB%20III.pdf | Thesis (reference) | Hamka death 1981 → © to end-2051
- Wikipedia – Tafsir al-Mishbah | https://en.wikipedia.org/wiki/Tafsir_al-Mishbah | CC BY-SA | Al-Misbah publisher/scope
- Jogja OPAC – Terjemah Tafsir Jalalain | https://opacperpustakaan.jogjakota.go.id/inlislite3/opac/detail-opac?id=36861 | Copyright (translation) | Indonesian Jalalayn translations exist
- alif.id – Sejarah makna kitab gandul | https://alif.id/read/nur-ahmad/sejarah-makna-kitab-gandul-dalam-tradisi-pesantren-b212819p/ | Article (reference) | Utawi-iki-iku i'rab notation idea
- Platform local data: api/data/quran.json, tafsir-ibn-kathir.json, muslim.json, bukhari.json; api/src/api/scripts/download_quran.py, download_tafsir.py | file:///Users/mbairm3512/Documents/SuksesBerkah/dakwah-lens/api/data/ | Mixed upstream (AlQuran.cloud, spa5k/QUL mirror of quran.com, hadith JSON) | Verified basmalah-prepend bug, old ID translation, Mubarakpuri EN, non-canonical Muslim numbering, Fatihah hadith presence