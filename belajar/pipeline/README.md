# Belajar content pipeline (Al-Fatihah)

Offline, review-gated pipeline that produces `belajar/content/al-fatihah.json`, a `SurahContent`
record as defined in `belajar/src/content/schema.ts`. It implements the "source registry",
"assemble" and local "validate" stages of plan §7.5 (`docs/belajar-plan.md`).

Ground rules, enforced in code:

- **Qur'anic text is never typed.** Ayah and word strings are sliced from the pinned Tanzil file;
  fact cards quote Qur'anic phrases only as «…» slices of that file. `validate.py` byte-checks all of it.
- **Every explanatory value carries sources** (kitab + volume/page, or dataset + version + query).
- **Nothing is invented.** Counts and location lists are recomputed from data; i'rab text comes from
  the sourced inventory (plan Appendix A, research `fatihah-content.md` §2–§3). Gaps and doubts are
  recorded as `review_notes` in the authored file, never filled by guesswork.
- **Every record is `status: "draft"`** until an ustadz signs it off (plan §8).
- Python 3 standard library only. No LLM, no paid API, no npm, no docker.

## Run

```bash
cd belajar/pipeline
python3 fetch.py            # download into cache/ and verify (or, first time, pin) sha256
python3 build_fatihah.py    # write ../content/al-fatihah.json; prints data warnings
python3 validate.py         # re-check the output; exits 1 on any failure
```

`fetch.py --refresh` re-downloads everything and compares with the pins (upstream drift check);
`fetch.py --repin <id>` deliberately accepts new bytes for one input. `cache/` is git-ignored.

## Files

| File | Stage | Role |
|---|---|---|
| `sources.json` | 0 | Every input: URL, version, sha256 (pinned after download), bytes, retrieval date, licence, attribution |
| `fetch.py` | 1 | Downloads into `cache/`, checks headers/licence footers, pins or verifies sha256 |
| `common.py` | — | Paths, sha256, Tanzil and QAC loaders, QAC Buckwalter table, search normalisation, MP3 duration probe |
| `authored/al-fatihah.words.json` | 3 | Hand-authored per-word values: translit, gloss, wazn, case, why, ikhtilaf, kitab sources, review notes |
| `facts.py` | 2 | Recomputes the plan's Appendix B "Tahukah kamu?" facts from Tanzil + QAC |
| `build_fatihah.py` | 2 | Joins everything into `belajar/content/al-fatihah.json` |
| `validate.py` | 6 | Independent re-check of the output against Tanzil, the pins and `schema.ts` |

## Inputs (see `sources.json` for the pinned sha256 values)

| id | What | Version / pin |
|---|---|---|
| `tanzil_uthmani` | Tanzil Quran Text (Uthmani), txt with ayah numbers and the licence footer, kept verbatim | 1.1; URL `https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true` |
| `tanzil_metadata` | Tanzil `quran-data.xml` (surah Arabic name; ayah counts cross-check) | 1.0 |
| `qac_morphology` | Quranic Arabic Corpus morphology, GitHub mirror of the unmodified file (official download needs an email) | 0.4 (header checked) |
| `quran_align` | cpfair/quran-align release zip; `Husary_Muallim_128kbps.json` and `Alafasy_128kbps.json` checked against the SHA-1s in the release README | release-2016-11-24 |
| `quranenc_indonesian_affairs` | QuranEnc API, sura 1, plus the translations list for the version and title | 1.0.1 as reported by `translations/list` |
| `everyayah_*` | The 14 streamed MP3s, downloaded only to measure their length (never committed or served) | per-file sha256 + duration |

**Tanzil download options.** On tanzil.net/download the four checkboxes (pause marks, sajdah
signs, rub-el-hizb signs, tatweel before superscript alef) are left unticked, so every
space-separated token is one word. Tatweel still occurs in the text as the carrier of a hamza or
small yeh; that is part of the text, not the option. `fetch.py` asserts the options took effect.

**Tanzil behaviour verified by the build.** Tanzil prepends the basmalah to ayah 1 of 112 surahs
(all except 1 and 9). In 110 of them the four tokens are byte-identical to 1:1; in surahs 95 and
97 the first token carries a shaddah on the ba'. `facts.py` removes these headings by comparing
normalised tokens, so both spellings are handled. 1:1 is the basmalah itself (Kufan count).

## Word data

**Alignment.** For every word of surah 1 the QAC segments, joined and converted from Buckwalter,
are byte-identical to the Tanzil token (29/29), and QAC's word numbering equals the Tanzil token
index. The build stops if this ever fails.

**Root and lemma** come from the QAC `STEM` segment, converted with QAC's own extended Buckwalter
table (`common.BUCKWALTER`). Root letter `A` is shown as `أ`, as corpus.quran.com displays it
(e.g. `أ ل ه`). Lemmas are shown exactly as QAC spells them, including its oddities (see below).

**Word class (`pos`)** is mapped mechanically from the QAC tags of all segments of the word, joined
with ` + ` (e.g. `huruf jar + isim`). The alif-lam prefix (`DET`) is not shown as a separate class.

| QAC | Learner label |
|---|---|
| `N` | isim; `ACT PCPL` → isim fa'il; `PASS PCPL` → isim maf'ul; `VN` → mashdar; number `MP/FP` → "(jamak)", `MD/FD` → "(mutsanna)" |
| `PN` | isim 'alam; lemma Allah → isim 'alam (lafaz Allah) |
| `ADJ` | isim sifat; with `ACT PCPL` → isim sifat (isim fa'il); with `PASS PCPL` → isim sifat (isim maf'ul) |
| `PRON` stem / suffix | dhamir munfashil / dhamir muttashil |
| `REL`, `DEM` | isim maushul, isim isyarah |
| `V` | `PERF` fi'il madhi, `IMPF` fi'il mudhari', `IMPV` fi'il amr |
| `P` (prefix or stem) | huruf jar |
| `CONJ` | huruf 'athaf |
| `NEG` | huruf nafi |

Other QAC prefix tags (`REM`, `EMPH`, `INTG`, `VOC`, `FUT`, `RSLT`, `CAUS`, `SUP`, `IMPV`, `PRP`)
already have labels for later surahs; an unmapped tag stops the build.

**Wazn, case, why, ikhtilaf** are authored in `authored/al-fatihah.words.json` from plan Appendix A
and research §2–§3, re-read against the kitab texts (Darwisy, al-Jadwal, al-Mujtaba, an-Nahhas,
as-Samin, Ibn Kathir). `why` is one plain Indonesian sentence. Words are referred to in
transliteration, never in Arabic script. `ikhtilaf` options name who holds each view. Each word's
`sources` = the kitab refs + the QAC 0.4 location and tags (+ the QAC verb-form ref for a verb
with a wazn) + the gloss anchor. A kitab ref in `src` is `[abbr]`, `[abbr, ref]` or
`[abbr, ref, url_ayah]`: abbr D/J/M/N/S/IK expands to the kitab name, the ref defaults to
volume/page (or "halaman cetak belum diverifikasi"), and the tafsir.app URL points at the ayah
page that holds the passage (`url_ayah`, when the kitab discusses the word under another ayah;
`null` = no URL because no page is known).

- **Wazn** is shown only when a cited kitab states it (al-Jadwal for most nouns, e.g. fā‘al for
  al-‘ālamīna) or, for verbs, from the QAC 0.4 verb-form tag (QAC marks forms II–XII; no tag =
  form I) with the vowels read from the Tanzil token; that ref is added automatically. yaumi,
  aṣ-ṣirāṭa and ṣirāṭa have `wazn: null` because no cited kitab states their wazn.
- **pos** may be overridden in the authored file (`pos` + a required `pos_note`) when the kitab
  label differs from the QAC mapping: 1:2:4 is "isim (isim jam')" per al-Jadwal and as-Samin
  (QAC: N|MP).
- **Mabni words** carry the built-in vowel as `sign` where the main view states it (iyyāka:
  fathah, al-Jadwal; allażīna: fathah; an‘amta: sukun). For ‘alaihim (1:7:4, 1:7:7) the `mahall`
  is the jar-majrur phrase's (1:7:4 nashb per as-Samin; 1:7:7 raf' as na'ib fa'il) and `why`
  says so; `sign` is "—" because the unit is a phrase.

**Page numbers.** Darwisy, *I'rab al-Qur'an wa Bayanuh* jil. 1 (cet. 4, 1415 H) was checked on
Shamela, whose pagination follows the print: i'rab 1:1 hlm. 9; 1:2–1:6 hlm. 14 except the end of 1:6 (the naz' al-khafiḍ option for aṣ-ṣirāṭa and the i'rab of al-mustaqīma), which is on hlm. 15; 1:7 hlm. 15; the balaghah note on lillāhi (ikhtishash) hlm. 16;
al- in al-ḥamd as jins hlm. 19; āmīn (al-Fawa'id) hlm. 20. ad-Dani, *al-Bayan* hlm. 139 and
as-Suyuthi, *al-Itqan* 1/189 are confirmed. Pages for al-Jadwal, al-Mujtaba, an-Nahhas, as-Samin
and Ibn Kathir still say "halaman cetak belum diverifikasi".

**Gloss** is a short in-house Indonesian draft for the word in this ayah, anchored to the QuranEnc
ayah translation (`build_fatihah.py` warns when a gloss word does not occur in the translation,
unless the authored entry gives a `gloss_exception`). Quran.com's word-by-word layer is not used.

## Transliteration (SKB Menag–Mendikbud 158/1987 and 0543b/U/1987)

| Arabic | Latin | Arabic | Latin | Arabic | Latin |
|---|---|---|---|---|---|
| ا | (not written) | ر | r | غ | g |
| ب | b | ز | z | ف | f |
| ت | t | س | s | ق | q |
| ث | ṡ | ش | sy | ك | k |
| ج | j | ص | ṣ | ل | l |
| ح | ḥ | ض | ḍ | م | m |
| خ | kh | ط | ṭ | ن | n |
| د | d | ظ | ẓ | و | w |
| ذ | ż | ع | ‘ (U+2018) | ه | h |
| | | | | ء | ’ (U+2019); not written at the start of a word |
| | | | | ي | y |

- Short vowels a, i, u; long vowels ā, ī, ū (also for the superscript alif, e.g. raḥmān, ṣirāṭ);
  diphthongs ai, au (yaumi, ‘alaihim, gairi).
- Shaddah doubles the consonant (rabbi, iyyāka, aḍ-ḍāllīna).
- Article: `al-` before qamariyah letters; assimilated before syamsiyah letters (ar-, ad-, aṣ-,
  aḍ-), always joined with a hyphen and in lower case.
- Word-level form: each word is written as it reads on its own, with its full i'rab ending
  (al-‘ālamīna, ar-raḥīmi), not its pausal form and not the connected-reading form; a word-initial
  hamzat al-wasl is written with its vowel (al-, ihdinā, allażīna).
- Prefixed wa- is written as a separate word (wa iyyāka, wa lā); prefixed bi-/li- stay joined
  (bismi, lillāhi), following the SKB examples.
- Capital letter only for the name Allah (Allāhi, lillāhi).
- `validate.py` restricts `translit` to this character set and rejects `sh dh th gh ts dz` and ASCII
  apostrophes. Grammar terms inside Indonesian prose (mudhaf ilaih, dhammah, na't…) use the usual
  pesantren spelling and are not transliterations. Transliterated words inside prose (abtadi’u,
  ibtidā’ī, istaf‘ala, al-musta‘ān, hadā, ilā) follow SKB: `validate.py` fails on an ASCII
  apostrophe in such a word, on an ASCII spelling of a word written elsewhere in SKB, and on a
  capital after the article hyphen (ar-raḥīm, not ar-Raḥīm).

## Translation

`translation.text` is the QuranEnc `indonesian_affairs` text byte for byte, footnote markers
(`[1]` in 1:4, `[2]` in 1:6, `[3]` in 1:7) included, because QuranEnc's terms forbid modifying it.
`translation.footnotes` holds that ayah's QuranEnc `footnotes` field verbatim, split into one item
per `[n]` marker (only whitespace between footnotes is dropped). `validate.py` checks both against
the pinned cache. `source_label` is QuranEnc's own title in its Indonesian
localisation, "Terjemahan Berbahasa Indonesia - Kementerian Agama" (English: "Indonesian
Translation - Ministry of Religious Affairs"); it is **not** labelled "Kemenag 2019", because its
1:1, 1:2 and 1:6 differ from the official LPMQ 2019 text. `version` is what QuranEnc reports.

## Recitation

Two entries per ayah, streamed from EveryAyah (`Husary_Muallim_128kbps`, `Alafasy_128kbps`).
quran-align segments `[wordStart0, wordEndExclusive0, startMs, endMs]` become
`[wordIndex1, startMs, endMs]`; a segment spanning more than one word stops the build. Checked:
integers, sorted, non-overlapping, endMs > startMs, word indices cover 1..N exactly once, and the
last segment ends before the measured length of the exact streamed MP3 (frame walk, ±1 frame).
Warnings (not failures): silences over 1.5 s between words, words under 0.2 s, and non-zero
quran-align matcher statistics. Credit lines follow the plan.

## Facts

`facts.py` recomputes each Appendix B fact. Phrase searches use the Tanzil text with the
surah-heading basmalah removed and a normalised key (tatweel, harakat and Qur'anic marks
U+064B–U+065F and U+06D6–U+06ED removed; ٱ أ إ آ and the superscript alif U+0670 folded to ا); the
search keys are the normalised Al-Fatihah tokens themselves. Lemma and root counts use QAC 0.4
`STEM` segments. Each card stores its full location list, the exact counting rule in `method`,
and its sources. When a count is larger than the number of ayat in the location list (an ayah
holds the word more than once), the body says "N kali dalam M ayat" (e.g. raḥmān 57 kali dalam
56 ayat, because 25:60 has two); `validate.py` re-derives these from QAC. Methods that count with
QAC state its basis: QAC 0.4 was built on Tanzil Uthmani 1.0.2 (its header says so), and its
surah-1 words are byte-identical to the Tanzil 1.1 tokens used here (checked by the build and the
validator). The mālik card counts LEM:ma`lik with POS N (3 forms: māliki 1:4, mālika 3:26,
mālikūna 36:71); Mālik in 43:77 is a different QAC lemma (ma`lik2, PN) and is not counted. `build_fatihah.py` prints every recomputed figure that differs from the plan.
Facts that are citations rather than counts (seven ayat per ad-Dani/Ibn Kathir; 4:69 per Ibn
Kathir; āmīn per al-Mujtaba and Darwisy) say so in `method`.

## Not built here

- `tafsir` (per ayah) and `hadith` come from the platform-corpus retrieval stage (plan §7.5 stage 1);
  this build leaves them out (`hadith: []`), and `validate.py` fails if a tafsir appears.
- Narration, quizzes and review sign-off records are later stages.

## Known data issues (for the reviewer)

- QAC 0.4 lemma spellings carry context marks: `r~aHoma`n`, `r~aHiym`, `m~usotaqiym` start with a
  shaddah (from assimilation), and the Form X verb lemma is `{sotaEiynu` (shown as ٱسْتَعِينُ).
  Shown verbatim; a correction overlay (plan §5.1) would be the place to fix them.
- QAC root counts mix meanings: ر ح م includes arḥām (wombs), ع و ن includes ‘awān (2:68). The
  root-family cards say so instead of implying one meaning.
- quran-align Husary Mu'allim 1:7 has a 4.1 s gap before word 5 (gairi, 0.3 s long) and non-zero
  matcher stats; 1:1 has one deletion. Check by ear before shipping.
- QuranEnc footnotes are shipped verbatim with their markers; the app must render them under the
  ayah (schema `translation.footnotes`).
