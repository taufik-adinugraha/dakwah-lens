# Belajar content pipeline (Al-Fatihah and Al-Mu'awwidzat)

Offline pipeline that produces one `SurahContent` record per surah with a lesson —
`belajar/content/al-fatihah.json`, `al-ikhlas.json`, `al-falaq.json`, `an-nas.json` — and
`belajar/content/library.json`, the shared `Library` (Konsep, Kosakata, Akar), as defined in
`belajar/src/content/schema.ts`. It implements the "source registry", "assemble" and local
"validate" stages of plan §7.5 (`docs/belajar-plan.md`).

The surahs are registered once, in mushaf order, in `common.SURAHS` (slug, surah number,
Indonesian name, words per ayah). `fetch.py`, `build_library.py`, `build_surah.py` and
`validate.py` all read that table; `src/lib/content.ts` and `SURAH_SLUGS` in `src/lib/routes.ts`
list the same slugs in the same order (`validate.py` checks both).

| Slug | Surah | Ayat | Words per ayah (QAC 0.4 = Tanzil tokens) | Total |
|---|---|---|---|---|
| `al-fatihah` | 1 | 7 | 4+4+2+3+4+3+9 | 29 |
| `al-ikhlas` | 112 | 4 | 4+2+4+5 | 15 |
| `al-falaq` | 113 | 5 | 4+4+5+5+5 | 23 |
| `an-nas` | 114 | 6 | 4+2+2+4+5+3 | 20 |

Ground rules, enforced in code:

- **Qur'anic text is never typed.** Ayah and word strings are sliced from the pinned Tanzil file;
  fact cards quote Qur'anic phrases only as «…» slices of that file. `validate.py` byte-checks all of it.
- **Every explanatory value carries sources** (kitab + volume/page, or dataset + version + query).
- **Nothing is invented.** Counts and location lists are recomputed from data; i'rab text comes from
  the sourced inventory (plan Appendix A, research `fatihah-content.md` §2–§3). Gaps and doubts are
  recorded as `review_notes` in the authored file, never filled by guesswork.
- **Every record is `status: "draft"`.** That is pipeline state: there is no human review step
  (plan L11), and nothing here or in the app may promise one.
- Python 3 standard library only. No LLM, no paid API, no npm, no docker.

## Run

```bash
cd belajar/pipeline
python3 fetch.py                   # download into cache/ and verify (or, first time, pin) sha256
python3 facts_muawwidzat.py --corpus /path/to/api/data  # Al-Mu'awwidzat facts + hadith files (api/data is git-ignored; --check compares only)
python3 build_library.py           # write ../content/library.json (Kosakata, Akar, + Konsep if authored)
python3 build_surah.py al-fatihah  # write ../content/al-fatihah.json; prints data warnings
python3 build_surah.py al-ikhlas   # … and the same for al-falaq, an-nas
python3 validate.py                # re-check every lesson, the library and the links between them; exit 1 on any failure
python3 test_validate.py           # mutation tests: plants 66 faults in copies of the outputs, each must fail validate
python3 build_narration.py         # narration manifests ../content/narration/*.json (see "Narasi")
python3 validate_narration.py      # narration checks; exit 1 on any failure
python3 test_validate_narration.py # plants 43 faults in copies of the manifests, each must fail
python3 render_narration.py        # DRY RUN: characters and cost; never calls the API without --render --i-approve-spend
```

Run them in this order after editing any authored file: the lesson build reads the lexicon and
concept ids, and `validate.py` fails when an output is older than an authored file it was built from,
when a surah has authored input but no built lesson, and when the app does not load every lesson.
`python3 build_fatihah.py` is kept as a wrapper for `build_surah.py al-fatihah`: it is the entry
point named in `al-fatihah.json`'s `data_versions.pipeline`, and the generalised build reproduces
that file byte for byte (checked with `cmp` when the build was generalised).

`build_library.py` covers every registered surah whose `authored/<slug>.words.json` exists;
`build_library.py --only al-fatihah` narrows it (that run reproduces the Al-Fatihah-only
`library.json` byte for byte). `build_library.py --word-map <slug>` prints word loc -> lexicon id
for one surah (`null` = no lexicon entry yet, or a QAC stem with no lemma).

`fetch.py --refresh` re-downloads everything and compares with the pins (upstream drift check);
`fetch.py --repin <id>` deliberately accepts new bytes for one input. `cache/` is git-ignored.

## Files

| File | Stage | Role |
|---|---|---|
| `sources.json` | 0 | Every input: URL, version, sha256 (pinned after download), bytes, retrieval date, licence, attribution |
| `fetch.py` | 1 | Downloads into `cache/`, checks headers/licence footers, pins or verifies sha256; per-surah inputs follow `common.SURAHS` |
| `common.py` | — | Paths, the surah registry (`SURAHS`), sha256, Tanzil and QAC loaders, `lesson_ayah` (surah-heading basmalah), QuranEnc per-sura lookup, QAC Buckwalter table, search normalisation, MP3 duration probe |
| `authored/<slug>.words.json` | 3 | Hand-authored per-word values: translit, gloss, wazn, case, why, ikhtilaf, kitab sources, review notes |
| `authored/<slug>.structure.json` | 3 | Hand-authored `Ayah.structure` (type, summary, word groups, sources) and `Word.role`, with `role_src` / pipeline review notes (never shipped) |
| `authored/<slug>.concepts-map.json` | 3 | Word loc -> Konsep ids (`Word.concepts`); generated from the concepts' `examples`, re-checked both ways by `validate.py` |
| `authored/<slug>.facts.generated.json` | 2/3 | Facts for a surah other than Al-Fatihah: `{"facts": [Fact, …]}` in `schema.ts` shape, passed through after the `validate.py` fact checks (optional) |
| `authored/<slug>.hadith.json` | 1/3 | Hadith for the lesson: `{"hadith": [Hadith, …]}`, retrieved from the platform corpus (optional; `hadith: []` without it) |
| `facts.py` | 2 | Recomputes the plan's Appendix B "Tahukah kamu?" facts for Al-Fatihah from Tanzil + QAC |
| `facts_muawwidzat.py` | 1/2 | Writes the Al-Mu'awwidzat facts and hadith files from Tanzil + QAC + the platform corpus (`--corpus api/data`); every figure is re-derived a second way, and `--check` fails if a written file differs from a fresh run |
| `build_surah.py` | 2 | `build_surah.py <slug>` joins everything into `belajar/content/<slug>.json` |
| `build_fatihah.py` | 2 | Wrapper: `build_surah.py al-fatihah` |
| `validate.py` | 6 | Independent re-check of every lesson and the library against Tanzil, QAC, quran-align, QuranEnc, the pins and `schema.ts` (a Python mirror of its zod rules), of every link between them, and of the app wiring |
| `test_validate.py` | 6 | Mutation tests for `validate.py` (stdlib `unittest`; `python3 test_validate.py` prints the table) |
| `authored/library.lexicon.json` | 3 | Hand-authored Kosakata + Akar values: translit, meaning, tashrif rows, i'lal, root meanings, kitab refs, review notes |
| `authored/library.concepts.json` | 3 | Hand-authored Konsep records (separate author); passed through by `build_library.py`, minus each record's reviewer-only `review_notes` |
| `build_library.py` | 2 | Joins QAC 0.4 + the authored library files into `belajar/content/library.json` (`Library`) |
| `build_narration.py` | 3 | Writes the guided-lesson narration scripts `belajar/content/narration/<slug>.json` + `shared.json` from the lessons and the library (templates + content fields; see "Narasi") |
| `validate_narration.py` | 6 | Narration checks: step-id coverage, no Qur'anic word in any spelling, no Arabic/digits/diacritics/ALL CAPS, audio entries, manifests equal a fresh build |
| `test_validate_narration.py` | 6 | Mutation tests for `validate_narration.py` + unit tests of the speech text, numbers and render request |
| `render_narration.py` | 4 | ElevenLabs renderer (dry run by default; spends only with `--render --i-approve-spend`) |

## Inputs (see `sources.json` for the pinned sha256 values)

| id | What | Version / pin |
|---|---|---|
| `tanzil_uthmani` | Tanzil Quran Text (Uthmani), txt with ayah numbers and the licence footer, kept verbatim | 1.1; URL `https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true` |
| `tanzil_metadata` | Tanzil `quran-data.xml` (surah Arabic name; ayah counts cross-check) | 1.0 |
| `qac_morphology` | Quranic Arabic Corpus morphology, GitHub mirror of the unmodified file (official download needs an email) | 0.4 (header checked) |
| `quran_align` | cpfair/quran-align release zip; `Husary_Muallim_128kbps.json` and `Alafasy_128kbps.json` checked against the SHA-1s in the release README | release-2016-11-24 |
| `quranenc_indonesian_affairs` | QuranEnc API: sura 1 (top-level fields, unchanged) and suras 112, 113, 114 (`suras` map, one pinned file each, same endpoint), plus the translations list for the version and title | 1.0.1 as reported by `translations/list` |
| `everyayah_*` | The 44 streamed MP3s (2 reciters × 22 ayat), downloaded only to measure their length (never committed or served); url pattern `{SSS}{AAA}.mp3` | per-file sha256 + duration |

**Tanzil download options.** On tanzil.net/download the four checkboxes (pause marks, sajdah
signs, rub-el-hizb signs, tatweel before superscript alef) are left unticked, so every
space-separated token is one word. Tatweel still occurs in the text as the carrier of a hamza or
small yeh; that is part of the text, not the option. `fetch.py` asserts the options took effect.

**Tanzil behaviour verified by the build.** Tanzil prepends the basmalah to ayah 1 of 112 surahs
(all except 1 and 9). In 110 of them the four tokens are byte-identical to 1:1; in surahs 95 and
97 the first token carries a shaddah on the ba'. `facts.py` removes these headings by comparing
normalised tokens, so both spellings are handled. 1:1 is the basmalah itself (Kufan count).

The heading is not part of the ayah: QAC 0.4 numbers 112:1 as four words (qul huwa Allāhu
aḥad) and quran-align's word indices and the EveryAyah ayah-1 files (speech starts 30–250 ms in)
have no basmalah either. So a lesson ayah is `common.lesson_ayah`: the Tanzil line with the
four heading tokens sliced off after the fourth space (a byte-exact suffix of the line, never
retyped). For 112:1, 113:1 and 114:1 the heading is byte-identical to the 1:1 tokens. The app
plays and shows no basmalah before ayah 1; adding one later would need its own recitation
entry (EveryAyah 001001), not a change to the ayah.

## Word data

**Alignment.** For every lesson word the QAC segments, joined and converted from Buckwalter,
are byte-identical to the Tanzil token (Al-Fatihah 29/29, Al-Ikhlas 15/15, Al-Falaq 23/23, An-Nas
20/20), and QAC's word numbering equals the token index of the lesson ayah. The build stops if
this ever fails; `validate.py` re-checks it for every lesson surah.

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
| `V` | `PERF` fi'il madhi, `IMPF` fi'il mudhari', `IMPV` fi'il amr; with `PASS` + " (majhul)" (yūlad 112:3:4) |
| `P` (prefix or stem) | huruf jar |
| `CONJ` | huruf 'athaf |
| `NEG` | huruf nafi |
| `T`, `LOC` | zharaf zaman, zharaf makan (idzā 113:3:4, 113:5:4) |
| `PRON` stem after a `P` prefix | dhamir muttashil (the -hu of lahu 112:4:3, which QAC tags STEM because the word has no other stem) |

QAC 0.4 gives two pronoun stems no lemma: huwa (112:1:2) and the -hu of lahu (112:4:3). They have
`lemma: null`, `lemma_id: null` and no Kosakata entry (a lexeme's `lemma_ar` must be a QAC
lemma); both builds print a warning for them.

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
  aṣ-ṣirāṭa and ṣirāṭa have `wazn: null` because no cited kitab states their wazn. When the
  pattern's vowels are not the token's, the authored entry gives `wazn_basis`, which replaces the
  ref's closing clause "harakat pola wazan mengikuti token Tanzil …" (`{loc}` is filled in; the
  build stops if `wazn_basis` is given for a word that is not a verb with a wazn). a‘ūżu (113:1:2,
  114:1:2, af‘ulu) uses it: the vowels follow the verb's bab, fa‘ala–yaf‘ulu (Mukhtar ash-Shihah
  hlm. 221, al-Amtsilah bab 1, both cited on the card), and the ref says how the token differs.
  Al-Fatihah's nasta‘īnu (1:5:4, nastaf‘ilu) has the same mismatch but keeps the default clause,
  because `al-fatihah.json` is kept byte-identical.
- **pos** may be overridden in the authored file (`pos` + a required `pos_note`) when the kitab
  label differs from the QAC mapping. No word uses an override now: 1:2:4 had "isim (isim jam')",
  but only as-Samin calls al-‘ālamīna an isim jam' (Darwisy, al-Jadwal and al-Mujtaba: plural of
  ‘ālam, mulhaq), so it carries the QAC label "isim (jamak)" and as-Samin's view sits in its
  `ikhtilaf`. `validate.py` fails when a word's pos disagrees with its lexeme's pos.
- **Mabni words** carry the built-in vowel as `sign` where the main view states it (iyyāka:
  fathah, al-Jadwal; allażīna: fathah; an‘amta: sukun). For ‘alaihim (1:7:4, 1:7:7) the `mahall`
  is the jar-majrur phrase's (1:7:4 nashb per as-Samin; 1:7:7 raf' as na'ib fa'il) and `why`
  says so; `sign` is "—" because the unit is a phrase.
- **Standalone huruf** (a particle with no noun or verb in the same word: wa lā 1:7:8, lam,
  min, fī, mina) have `case: {state: "none", sign: "—"}` in every lesson, following Al-Fatihah;
  where a source states it, `why` may still say the particle is mabni di atas sukun (An-Nas,
  Ibnu 'Aqil jil. 1 hlm. 40). Tanwin endings use `dhammatain` / `fathatain` / `kasratain`.
- **The three qul cards** (112:1:1, 113:1:1, 114:1:1) match ihdinā (1:6:1): `mabni`, no
  mabni/majzum ikhtilaf, and al-Ajurrumiyyah (which calls fi'il amr "majzum") is not cited for
  the mabni claim. The Konsep `fiil-amr` explains Ibnu Ajurrum's term (Ahmad Zaini Dahlan's
  syarh) and the Bashrah/Kufah difference (as-Samin).

**Page numbers.** Darwisy, *I'rab al-Qur'an wa Bayanuh* jil. 1 (cet. 4, 1415 H) was checked on
Shamela, whose pagination follows the print: i'rab 1:1 hlm. 9; 1:2–1:6 hlm. 14 except the end of 1:6 (the naz' al-khafiḍ option for aṣ-ṣirāṭa and the i'rab of al-mustaqīma), which is on hlm. 15; 1:7 hlm. 15; the balaghah note on lillāhi (ikhtishash) hlm. 16;
al- in al-ḥamd as jins hlm. 19; āmīn (al-Fawa'id) hlm. 20. ad-Dani, *al-Bayan* hlm. 139 and
as-Suyuthi, *al-Itqan* 1/189 are confirmed. Pages for al-Jadwal, al-Mujtaba, an-Nahhas, as-Samin
and Ibn Kathir still say "halaman cetak belum diverifikasi".

**Library links.** `lemma_id` is the authored-lexicon id of the word's QAC STEM `LEM` (the build
stops if a word's lemma has no lexicon entry; a stem without a QAC lemma gets `null`). `concepts` is copied from
`authored/al-fatihah.concepts-map.json` (every id must be a Konsep id). `role` and each ayah's
`structure` come from `authored/al-fatihah.structure.json`; group `words` are 1-based indices
inside the ayah, ascending, at least two; a group `concept` must be a Konsep id; every `role_src`
abbreviation must already be in that word's `src`. `role_src`, `role_note` and `review_notes`
never reach the output. All 29 words have a role and all 7 ayat a structure; the build stops otherwise.

**Gloss** is a short in-house Indonesian draft for the word in this ayah, anchored to the QuranEnc
ayah translation (`build_surah.py` warns when a gloss word does not occur in the translation,
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

`translation.text` is the QuranEnc `indonesian_affairs` text of that sura and ayah byte for byte
(sura 1 and suras 112–114 are pinned separately, same translation and version), footnote markers
(`[1]` in 1:4, `[2]` in 1:6, `[3]` in 1:7; none in 112–114) included, because QuranEnc's terms
forbid modifying it.
`translation.footnotes` holds that ayah's QuranEnc `footnotes` field verbatim, split into one item
per `[n]` marker (only whitespace between footnotes is dropped). `validate.py` checks both against
the pinned cache. `source_label` is QuranEnc's own title in its Indonesian
localisation, "Terjemahan Berbahasa Indonesia - Kementerian Agama" (English: "Indonesian
Translation - Ministry of Religious Affairs"); it is **not** labelled "Kemenag 2019", because its
1:1, 1:2 and 1:6 differ from the official LPMQ 2019 text. `version` is what QuranEnc reports.

## Recitation

Two entries per ayah, streamed from EveryAyah (`Husary_Muallim_128kbps`, `Alafasy_128kbps`;
Alafasy is the default voice, plan L7). `validate.py` also re-derives every segment list from the
pinned quran-align file and fails on any difference.
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
mālikūna 36:71); Mālik in 43:77 is a different QAC lemma (ma`lik2, PN) and is not counted. `build_surah.py al-fatihah` prints every recomputed figure that differs from the plan.
Facts that are citations rather than counts (seven ayat per ad-Dani/Ibn Kathir; 4:69 per Ibn
Kathir; āmīn per al-Mujtaba and Darwisy) say so in `method`.

Al-Mu'awwidzat facts and hadith come from `facts_muawwidzat.py` (its docstring gives the rules).
The lesson's `data_versions.pipeline` names `build_surah.py` plus the script in the
`_generated_by` line of those files. Hadith records without a corpus Indonesian translation
(Bukhari, Riyad as-Salihin) are kept out of `hadith` (under `_needs_indonesian`), but nine of them
are paraphrased in Indonesian in fact bodies (Bukhari 4974, 5013, 5016, 5017, 5748, 7375; Riyad
1013, 1015, 1456); whether that is allowed is an open operator decision (Al-Fatihah has no
hadith facts). Corpus defects are listed in each hadith file's `_anomalies` and kept byte for
byte: Riyad 1013's English stops mid-quotation, and Muslim 813's Arabic (as in the fawazahmed0
section file it came from) opens the Prophet's quoted saying and never closes it.

## Shared library: Kosakata (lexicon) and Akar (roots)

`build_library.py` writes `belajar/content/library.json`, a `Library` record (`schema.ts`): one
`Lexeme` per QAC lemma and one `Root` per QAC root used by the covered surahs (every registered
surah with an authored words file; Al-Fatihah alone: 23 lemmas, 18 roots; Al-Mu'awwidzat add 29
lemmas and 20 roots that are not in Al-Fatihah), plus the Konsep records from
`authored/library.concepts.json` when that file exists (otherwise `concepts: []`). Lemmas and roots
are listed in reading order of first occurrence (surah order), so a later surah appends records
and a root's `lemmas` list grows (Allāh then ilāh under أ ل ه; malik of 1:4 and malik of 114:2 are
different QAC lemmas under م ل ك). Run it after `fetch.py`; it needs no network.
`python3 build_library.py --word-map [slug]` prints word loc -> lexicon id; `build_surah.py` sets
`Word.lemma_id` from the same key (the QAC LEM of the word's STEM looked up in the authored
lexicon), and `validate.py` checks that the lexeme's `lemma_ar` and `root` equal the word's.

**Data-derived (never typed).** The lemma list (every STEM `LEM` of the covered surahs, in reading
order of first occurrence), `lemma_ar` (the QAC `LEM` string through `common.bw_to_ar`, shown with
QAC's own spelling, e.g. the assimilation shaddah in رَّحْمَٰن), `root` letters, `pos`, both
`occurrences` blocks, root ids, each root's `lemmas`, and the QAC source refs. The authored
entries are keyed by the exact QAC 0.4 `LEM` / `ROOT` string (`qac_lem`, `qac_root`); the build
fails if a needed lemma or root has no entry or an entry matches nothing in QAC.

| QAC LEM | id | QAC LEM | id | QAC LEM | id |
|---|---|---|---|---|---|
| `{som` | ism | `yawom` | yawm | `m~usotaqiym` | mustaqim |
| `{ll~ah` | allah | `diyn` | din | `{l~a*iY` | alladhi |
| `` r~aHoma`n `` | rahman | `<iy~aA` | iyya | `>anoEama` | anama |
| `r~aHiym` | rahim | `Eabada` | abada | `` EalaY` `` | ala |
| `Hamod` | hamd | `{sotaEiynu` | istaana | `gayor` | ghayr |
| `rab~` | rabb | `hadaY` | hada | `magoDuwb` | maghdub |
| `` Ea`lamiyn `` | alamin | `` Sira`T `` | sirat | `laA` | la |
| `` ma`lik `` | malik | | | `DaA^l~` | dall |

- **pos**: `build_surah.pos_label` on the lemma's first covered STEM; verbs get the lemma-level
  label `fi'il` (aspect belongs to a word); "(jamak)"/"(mutsanna)" is dropped unless every QAC
  occurrence of the lemma has that number (so ‘ālamīn, plural in all 73, is "isim (jamak)"). An
  authored `pos` needs a `pos_note`.
- **occurrences**: STEM segments with that `LEM`, ayat counted once; the `method` carries the
  `facts.QAC_BASIS` note (for more than Al-Fatihah it names every covered surah: "surah 1, 112,
  113 dan 114 identik byte-per-byte …"; `validate.py` fails if it names a surah without a lesson), lists the QAC POS tags when a lemma has more than one (yaum: N/T;
  lā: NEG/PRO; allażī: REL/COND), and says QAC has no surah-heading basmalah (only 1:1 and 27:30).
  Root counts are STEM segments with that `ROOT`; the method says the count merges every lemma
  of the root, including distant meanings, and names the lemmas already in Kosakata.
- **Root ids** are the QAC Buckwalter root, one ASCII token per letter joined by `-`
  (`r-hh-m`, `ain-b-d`, `sh-r-th`). Tokens: ء a, ب b, ت t, ث ts, ج j, ح hh, خ kh, د d, ذ dz,
  ر r, ز z, س s, ش sy, ص sh, ض dh, ط th, ظ zh, ع ain, غ gh, ف f, ق q, ك k, ل l, م m, ن n, ه h,
  و w, ي y. Each letter has its own token, so ids never collide. The app finds a root by its
  letters (`lib/library.ts rootFor`), not by id.
- **QAC source refs** (added to every lexeme and root): the `LEM`/`ROOT` query with the sha256
  prefix and a corpus.quran.com link (root dictionary page, or the word-by-word page for the four
  rootless lemmas); the tags of the first covered word; for pronoun/relative lemmas the
  person-gender-number features QAC covers (the basis for "laki-laki dan perempuan, tunggal, dua,
  jamak" under allażī); for a tashrif row, the verb lemma's verb form, aspect counts and the
  `attest` lemmas (other forms of the row the Qur'an uses), each with its count; for a root, the
  `mentions` lemmas its meaning names, and `mentions_without_root` (Muḥammad, Aḥmad have no
  root in QAC 0.4).

**Authored (`authored/library.lexicon.json`).** `translit` (SKB, same character set as word
cards), `meaning` (core meaning across the Qur'an, plain Indonesian, terms defined where used),
`tashrif`, `ilal`, root `meaning`, kitab refs and `review_notes` (never shipped). Prose names
words in transliteration only; `validate.check_prose` and `check_translit_prose` run on every
meaning and rule (no unquoted Arabic words, «…» must be Tanzil bytes, no ASCII apostrophe in an
SKB word). Kitab refs are `[abbr, ref, url_id]`; `kitab` expands the abbreviation, and every
Shamela id was matched to the printed volume/page in the page title (2026-10-09). The al-Amtsilah
url is the archive.org scan (no per-page url); its refs give printed page and PDF page (printed =
PDF − 3, checked on the scan). In the output, refs that support the tashrif row or an i'lal entry
are prefixed "(tashrif)" / "(i'lal)" (the schema has one `sources` list per lexeme).

- **tashrif** follows the al-Amtsilah row order: fi'il madhi, fi'il mudhari', mashdar, isim fa'il,
  isim maf'ul, fi'il amr (then fi'il nahi, isim zaman/makan, isim alat, unused so far); a row may
  skip forms, never reorder them. Only forms the cited kitab support are given. Checked by the
  build: the QAC verb form of `verb_lem` matches the wazan named in `bab` (form I = tsulatsi
  mujarrad, IV = أَفْعَلَ, X = اِسْتَفْعَلَ; QAC also leaves the basic form of a four-letter root
  unmarked, so an unmarked verb on such a root must name "Ruba'i mujarrad", as waswasa does,
  and `build_surah.verb_form_src` says so in the word card's VF ref); `verb_lem` and every `attest` lemma share the
  lexeme's root; a fi'il amr appears only if QAC tags that verb IMPV somewhere (so ‘abada,
  ista‘āna, hadā, istaqāma, raḥima have one; ḥamida, malaka, an‘ama, gaḍiba, ḍalla, dāna do not).
  Typed Arabic (forms, i'lal before/after, wazan in `bab`) must be imla'i letters + harakat only;
  superscript alif, alif wasla, tatweel and Qur'anic marks are rejected, so a form can never pass
  for mushaf text.
- **Rows included** (12 lexemes; raḥmān and raḥīm share raḥima's row): raḥima (bab 4), ḥamida
  (bab 4), malaka (bab 2), dāna (bab 2, ajwaf), ‘abada (bab 1), ista‘āna (istaf‘ala, ajwaf),
  hadā (bab 2, naqish), istaqāma (istaf‘ala, ajwaf), an‘ama (af‘ala), gaḍiba (bab 4), ḍalla
  (bab 2, mudha'af). Bab per al-Jadwal's ash-Sharf notes (jil. 1, hlm. 27–36) and dictionary
  entries; row patterns per al-Amtsilah (bab 1/2 hlm. 2–3, bab 4 hlm. 4–5, af‘ala hlm. 16–17,
  istaf‘ala hlm. 27–29).
  Al-Mu'awwidzat add 8 rows: qāla, kāna and ‘āża (bab 1, ajwaf wawi, row ṣāna–yaṣūnu, hlm. 2–3;
  bab from MQ 5/42 and MB 2/519, MQ 5/148 and MS 275, MS 221 "min bāb qāla"), khalaqa and ḥasada
  (bab 1; MS 95 "bābuhu naṣara", MS 72 "bābuhu dakhala"), walada and waqaba (bab 2, mitsal wawi,
  row wa‘ada–ya‘idu; MB 2/671 "min bāb wa‘ada", MS 343 "bābuhu wa‘ada"; waqaba gives only madhi
  and mudhari'), and waswasa (ruba'i mujarrad, al-Amtsilah hlm. 8–9 = PDF 11–12, its own example
  row; isim maf'ul muwaswas ilaihi per MB 2/658). The scan's rows were read on the page images.
- **i'lal** (10): ism ← simw (ibdal; J 27, MB 290, D 8), nasta‘īnu ← nasta‘winu (J 32, D 14,
  al-Mujtaba 1/5 on 1:6), ihdinā ← tahdīnā (ta- dropped, hamzah washal, i'lal bil-hadzf; J 34, D 14,
  al-Hamalawi 36–37, an-Nahhas 1/20, as-Samin 1/62), ṣirāṭ ← sirāṭ (ibdal;
  J 34, MQ 3/349 and 3/152, MB 274), mustaqīm ← mustaqwim (J 34, D 15), ‘alaihi ← ‘alāhu
  (MB 2/428), ḍāll ← ḍālil (idgham; J 35), and for Al-Mu'awwidzat: aḥad ← waḥad (ibdal, the
  known view per S 11/149–150, with Abu al-Baqa's dissent; D 10/614, MQ 1/67, R 67), yalidu ←
  yawlidu (wawu dropped between ya' and kasrah; N 5/196), lam yakun ← lam yakūn (two sakin letters;
  MS 275). The Kosakata card shows ibdal and idgham under the
  i'lal heading; the Konsep `ilal` record says so (al-Hamalawi 121–122: every i'lal is an ibdal,
  not the reverse).
- **Al-Mu'awwidzat sources.** Meanings come from ar-Raghib (R), Maqayis (MQ), al-Mishbah (MB),
  Mukhtar ash-Shihah (MS) and the al-Lughah / ash-Sharf parts of Darwisy jil. 10 and al-Jadwal
  jil. 15; particles from Ibnu Hisyam's Mughni (MG: lam 365, min 419, mā 390/402, iżā 120/127,
  fī 223), al-Ajurrumiyyah (AJ) and Ibnu 'Aqil (IA). New abbreviations MG, AJ, IA, IK (Ibnu
  Katsir) and T (ath-Thabari, whose "qadim" is not used, per the muhaqqiq's footnote). Ids:
  `malik-raja` is malik (king, 114:2), distinct from `malik` (mālik, 1:4); `adha` is QAC `Eu*o`.

**Spelling convention shared with the lesson and Konsep text.** Letter names and grammar terms are
written in pesantren spelling (ya', 'ain, tha', shad, sin, lam, qaf; fa'il, maf'ul), and wazan
names in prose carry their ending (fa‘īlun, fā‘ilun, maf‘ūlun), so they are never read as an ASCII
spelling of an SKB word. `build_library.py` and `validate.py` check the lexicon, root and concept
prose together with the lesson prose, as the app shows them side by side.

**Left out on purpose** (details in each entry's `review_notes`):
no tashrif for ism, rabb (its origin is disputed: D 13 gives three views, J 29 one), Allah
(origin not decided, plan §8), ‘ālamīn, yaum, ṣirāṭ, gair or the particles; no isim fa'il for
gaḍiba (the dictionaries cited give gaḍbān/gaḍūb, the Qur'an uses gaḍbān); no isim maf'ul for
istaqāma or ḍalla (intransitive), and only madhi–mudhari'–mashdar for dāna (its participles
mean debtor/creditor). al-Jadwal (hlm. 29) puts ḥamida in bab naṣara; Mukhtar ash-Shihah
(fahima) and Maqayis (aḥmaduhu) support bab 4, which the row uses. The al-Mujtaba refs give the
tafsir.app ayah page; printed pages, checked on Shamela 9617's page markers: QS 1:1–1:5 hlm. 4, 1:6–1:7 hlm. 5. The `review_notes` of word 1:5:4 in
`authored/al-fatihah.words.json` write the origin of nasta‘īnu as "nasta‘wanu"; D, J and
al-Mujtaba all say nasta‘winu (kasrah on the wawu).
Al-Mu'awwidzat, left out: the i'lal of qul and of a‘ūżu (no cited kitab states it; al-Jadwal on
QS 2:67 does not either); a fi'il amr for ‘āża, walada, khalaqa, ḥasada and waswasa (QAC has no
IMPV for them); the mashdar and participles of waqaba (not in the dictionaries cited); the
"not hollow" and similar readings of aṣ-ṣamad (aqidah wording, as on the word card); the origin of
lafaz Allah under ilāh (plan §8); a wazan for al-khannās.

## Narasi (guided-lesson narration)

The autoplay lesson ("Mulai" once, then no clicks except exercise answers) speaks an Indonesian
narration line for every step. `build_narration.py` writes the scripts; `render_narration.py` turns
them into audio once the operator has chosen a voice and approved the spend. Until then
`voice` is `null`, no line has `audio`, and the runner shows `text` as a caption at reading pace.

**Manifest** (`belajar/content/narration/<slug>.json` per lesson surah, `shared.json` for generic
lines; `version` is the format version, 1):

```json
{ "version": 1,
  "voice": null,
  "lines": { "al-fatihah:1:w1": { "text": "Kata pertama artinya “dengan nama”. …",
                                  "audio": { "url": "/belajar/media/narration/<voice-slug>/al-fatihah/al-fatihah__1__w1.mp3",
                                             "ms": 6120, "sha256": "…" } } } }
```

`audio` appears only after a render; `voice` is then `{id, name, model: "eleven_v3"}`.

**Ids** (the step-id contract shared with the runner and the exercises): `${slug}:${ayah}:${part}`,
in lesson order:

| part | when | says |
|---|---|---|
| `intro` | every ayah | which ayah, its translation (QuranEnc, read in quotes), how many words |
| `recite` | every ayah | one line before the imam recites the ayah |
| `w${n}` | every word | "Kata ke-n artinya “gloss”." + the word's `why`, sanitised |
| `concept:${id}` | each Konsep whose first example is in this ayah (`library.ts conceptsIntroducedIn`) | "Konsep baru: title. summary" |
| `structure` | every ayah with `structure` | the structure summary, sanitised |
| `ex:${key}:intro` | each exercise the page shows on this ayah (same thresholds as the components) | what the exercise is and how many questions |
| `recap` | every ayah | before the imam recites the ayah again |
| `next` / `done` | `next` on every ayah but the last, `done` on the last | |

Exercise keys: `tap-word`, `why-harakat`, `sort-case`, `label-role`, `wazn-factory`.
`shared.json` holds `shared:start`, `resume`, `correct`, `try_again`, `revealed` (a settled
question whose answer was shown), `reminder`, `skip_offer`, `surah_done` (true however the learner
got there: no claim that every ayah was studied), and one prompt per guide part,
`shared:ex:${key}:${part}`, with the parts of `src/components/exercises/guide.ts`
`EXERCISE_GUIDE_PARTS` (play, options, words, bins, reveal, next; `validate_narration.py`
compares its mirror with that file). A runner looks for `${slug}:${ayah}:ex:${key}:${part}` first
and falls back to `shared:ex:${key}:${part}`; only `intro` is per ayah today. The learner only
answers: the lesson's imam recites Dengar dan ketuk's word by itself (the `play` prompt asks for
listening, not a tap), and a settled question moves on by itself; the `next` prompt ("Ketuk tombol
yang diberi tanda…") is spoken only in the "Tunggu saya" pace.

**Split lines.** A line longer than 400 characters is cut at sentence ends (then `; `, then `, `)
into the fewest even parts, stored as `<id>:a`, `<id>:b`, … (never next to the unsplit `<id>`).
A player that does not find `<id>` plays `<id>:a`, `<id>:b`, … in order. Today 17 lines are split
(into 39 parts; mostly `structure`).

**Text = caption = speech.** `text` is already normalised in Python (house rule: ElevenLabs
`apply_text_normalization` stays "off"): numbers spelled out (`ayat 6` → "ayat enam", `ke-3` →
"ketiga"), `QS 6:112` → "Surah Al-An'am ayat seratus dua belas" (`CITED_SURAH` lists the cited
surahs; any other fails the build), honorifics in full ("Allah subhanahu wa ta'ala", "Nabi
Muhammad shallallahu 'alaihi wa sallam"), "Anda", no Arabic script, no ALL CAPS, no
transliteration diacritics (folded: ā → a, ‘ → '). Speech-only changes live in
`build_narration.tts_text`, applied by the renderer just before each request: `TTS_RESPELL`
(Allah → Alloh, plan §6.3), brackets become commas, quotes are dropped, an ellipsis is dropped
(not read as a full stop) and an open prefix loses its hyphen ("di-" → "di"). Extend `TTS_RESPELL`
(e.g. grammar terms) only after the operator has heard the approved sample.

**The narrator never voices a Qur'anic word** (plan §6.1 A1; the imam's recording carries every
Qur'anic word). The lesson prose names words in SKB transliteration, so `build_narration.Sanitiser`
replaces each mention with the word's place, which the stage numbers under each mushaf word while
the lesson runs and rings while the line plays (`validate_narration.word_places` ↔
`src/lib/autoplay/narration.ts wordRefs`):

- the word the line is about → "kata ini"; another word of the ayah → "kata kedua"; a run →
  "kata pertama dan kedua", "kata kedua sampai keempat". A word of ANOTHER ayah is not on screen,
  so it is named by its meaning: "kata yang berarti “jalan” di ayat enam" (an existing "di ayat 6"
  is reused), "frasa yang berarti “dari kejahatan” di ayat dua", and in another surah just "kata
  yang berarti “Dia ciptakan”"; a gloss the prose already gives right after the mention is that
  meaning; "lafaz Allah" in another ayah reads "lafaz “Allah” di ayat dua". A preceding
  "kata"/"lafaz" is absorbed, "kata perintah qul" reads "kata perintah, yaitu kata pertama", and a
  particle name followed by its gloss ("huruf jar min (“dari”)") keeps only the gloss.
- `PRE_REWRITES` (in `build_narration.py`) fix the phrasings no place can: the ‘alā of ‘alaihim
  ("Bagian depan kata ini adalah huruf jar yang berarti “atas”"), the lesson card's "di kartu
  ini", a place inside a place (dhamir sya'n), a concept title that is only the particle ("Lam: …"
  → "Huruf yang menafikan…"), an open prefix ("“di-…”" → "berawalan “di-”").
- Which occurrence a repeated form means (‘alaihim in 1:7, lam in 112:3): the line's own word,
  then the one the line mentioned last, then the nearest in the same clause; outside the ayah, an
  explicit "di ayat N", then the nearest preceding ayah.
- Prefixes and suffixes are named, not voiced: bi- → "huruf ba'", li- → "huruf lam", wa →
  "wawu", the lā of wa lā → "huruf nafi", -nā/-ta/-him/-hū → "akhiran", al- → "alif lam",
  -ūna/-īna → "akhiran una/ina"; an Arabic letter list (ف ع ل) → "fa', 'ain, dan lam".
- `ALIASES` (in `validate_narration.py`) lists the pieces prose uses for a word: ism/ismi (bismi),
  Allāh (lillāhi), ihdi (ihdinā), rabb (birabbi), waswasa (yuwaswisu), min (mina), ‘alā
  (‘alaihim).

**What counts as a Qur'anic word** (the validator's forbidden set): every word's `translit` in
every lesson surah, folded (diacritics and apostrophes dropped, lower case) and matched on whole
tokens; plus its form without the i'rab ending (al-ḥamd, rabb, aḥad), without the article
(ṣirāṭ, falaq; only stems of 4+ letters), its space-separated parts (wa, lā) and the aliases; and
any token that starts with one of these (bismillah, alhamdulillah). The validator is also
spelling- and ending-blind (never used to rewrite prose): Indonesian digraphs map to the folded
letter (a'udzu, ash-shirath, ghairi, adh-dhollin), other case endings and joined article vowels
match the stem (rabbu, rabba, rabbil), mabni words match without their last vowel as recited at a
pause (khalaq, hasad, waqab), a ta marbuta matches in its -ah spelling (al-jinnah), and two words
run together as recited are prefixes (huwallahu, bismillahi). Allowed exceptions, decided
here: **"Allah" (no case ending) only inside “…” — the spoken translation and the quoted glosses
are Indonesian — or followed by "subhanahu wa ta'ala"**; the narrator's own prose always uses
the honorific, and "lafaz Allah" (a mention of the word) becomes a place like any other. Also
allowed: the honorific phrases, a surah name right after "Surah", and "lam" as the letter name
("huruf … lam", "alif lam").

**Arabic that stays (operator decision pending).** Non-Qur'anic Arabic in the prose is kept,
folded: wazan names (fa'lala–yufa'lilu, istaf'ala, af'ala, if'al, istif'al), the scholars'
supplied verbs for 1:1 (abtadi'u, ibtida'i), the i'lal origin nasta'winu, the plural markers una/ina,
the pattern examples naffas/naffasah, and four dictionary forms that are also Qur'anic words
elsewhere in the mushaf but not in these lessons: hada (lemma of ihdinā), kana (yakun; "kāna dan
saudaranya"), 'uqdah (singular of al-‘uqadi). ('ala, the particle in ‘alaihim, is taught as part
of that word, so it is an alias now and is named by its meaning.) The i'lal origin nasta'winu is
close in sound to nasta‘īnu (1:5:4): still waiting on the operator. If those count as Qur'anic
words, add them to `ALIASES` (or the form set) and the build stops until each mention has a rule.

**Checks.** `build_narration.py` refuses to write a line that fails `validate_narration.check_text`.
`validate_narration.py` re-checks everything independently of the files' history: shape, id
contract and coverage (every ayah/word/introduced concept/shown exercise, no extras), split parts,
text rules, the forbidden set, that the intro reads the translation and each `w${n}` gives the
gloss, audio entries (`url` = `/belajar/media/narration/<voice-slug>/<slug>/<file>.mp3`, `ms` > 0,
sha256), that the manifests equal a fresh build (no hand edits; edit the templates or the lesson
content instead), that `tts_text` leaves no digit, Arabic, bracket, quote, ellipsis or open
prefix, and the word places (none past the ayah's last word, none in another ayah, none inside
another place, no "di kartu ini", no concept title turned into a place).
`test_validate_narration.py` plants 43 faults (one per rule) and unit-tests numbers, `tts_text`,
the sanitiser, the word places and the request body. CI (`.github/workflows/deploy-belajar.yml`,
verify job) runs `build_narration.py --check`, `validate_narration.py` and
`test_validate_narration.py`; the TypeScript guard in `src/lib/autoplay/narration.ts`
(`spokenTextProblems`, run by `npm test`) is a lighter mirror of the same rules.

**Render (`render_narration.py`; costs money, asks first).** Default is a dry run: characters and
cost per manifest at USD 0.08/1K (eleven_v3 list price), plus the distinct texts it would actually
send (identical lines, e.g. the same exercise intro on several ayat, are rendered once and copied).
A render needs `--render --i-approve-spend --voice-id <id> --voice-name "<name>"` and reads
`ELEVENLABS_API_KEY` from the repo `.env` only then. Settings are fixed in code: `eleven_v3`,
stability 0.5, style 0.35, similarity_boost 0.75, use_speaker_boost true,
`apply_text_normalization: "off"`; no `previous_text`/`next_text` (v3 rejects them). One request
per line (v3 limit 5,000 characters; lines are ≤ 400). MP3s go to
`pipeline/out/media/narration/<voice-slug>/<slug>/<file>.mp3` (git-ignored), where `<file>` is the
line id with every `:` written `__` (`al-fatihah__1__w1.mp3`; colons break scp and the app's
same-origin audio path rule `[A-Za-z0-9_-]`), the manifest line gets
`audio {url, ms, sha256}` (duration from `common.mp3_duration_ms`) after each line, and
`render-ledger.json` beside the MP3s records the sha256 of the text sent, the voice and the
settings, so an unchanged line is never paid for twice. `--surah` and `--only <id-prefix>` narrow
a run (e.g. the one-ayah sample: `--surah al-fatihah --only al-fatihah:1:`); a manifest already
voiced by another voice needs `--switch-voice`. The upload is printed, never run:
`scp -r …/narration/<voice-slug> <vm-host>:/srv/dakwah-lens/data/belajar-media/narration/`.

Dry run on 2026-10-10 (speech characters, first take): Al-Fatihah 19,121 (USD 1.53), Al-Ikhlas
10,300 (0.82), Al-Falaq 11,632 (0.93), An-Nas 12,097 (0.97), shared 1,597 (0.13); total 54,747
characters in 380 lines (USD 4.38), of which 41,967 characters in 252 distinct texts are sent
(USD 3.36). Retakes come on top.

## Not built here

- `tafsir` (per ayah) comes from the platform-corpus retrieval stage (plan §7.5 stage 1); this
  build leaves it out, and `validate.py` fails if a tafsir appears. `hadith` is passed through from
  `authored/<slug>.hadith.json` when that file exists (retrieved from the corpus by its author;
  `validate.py` checks status, that `ar` is Arabic only and that `id` carries no Arabic words),
  otherwise `hadith: []`.
- Narration audio: the scripts exist ("Narasi") but nothing is rendered; the guided lesson runs
  caption-only until the operator approves a voice and a sample. There are no review sign-off
  records (plan L11).

## Known data issues

- QAC 0.4 lemma spellings carry context marks: `r~aHoma`n`, `r~aHiym`, `m~usotaqiym` start with a
  shaddah (from assimilation), and the Form X verb lemma is `{sotaEiynu` (shown as ٱسْتَعِينُ).
  Shown verbatim; a correction overlay (plan §5.1) would be the place to fix them.
- QAC root counts mix meanings: ر ح م includes arḥām (wombs), ع و ن includes ‘awān (2:68). The
  root-family cards say so instead of implying one meaning.
- quran-align Husary Mu'allim 1:7 has a 4.1 s gap before word 5 (gairi, 0.3 s long) and non-zero
  matcher stats; 1:1 has one deletion. Check by ear before shipping.
- quran-align covers every word of 112–114 for both reciters, one word per segment, no gap over
  1.5 s and no word under 0.2 s. Husary Mu'allim has non-zero matcher stats on 112:2 (1 deletion),
  113:2 (1 deletion) and 114:6 (3 insertions); check by ear. Alafasy holds the last word of every
  An-Nas ayah for 3.8–4.5 s (madd at the pause plus the breath) — expected, but it inflates a
  word-length "madd" display. The Husary 113:5 file has 347 bytes outside MPEG frames (the
  duration probe skips them).
- QAC 0.4 spells the lemma of a‘ūżu (113:1:2, 114:1:2) `Eu*o` (عُذْ, an imperative form) and gives
  ṣamad, nās and naffāṡāt their assimilation shaddah (`S~amad`, `n~aAs`, `n~af~a`va`t`); shown
  verbatim, like the Al-Fatihah lemma oddities above.
- QuranEnc's Al-Mu'awwidzat translations open the quotation after "Katakanlah" in ayah 1 and close
  it at the end of the last ayah (112:4, 113:5, 114:6); shipped verbatim, so a single ayah shows an
  unbalanced quotation mark. None of the three suras has footnotes.
- QuranEnc footnotes are shipped verbatim with their markers; the app must render them under the
  ayah (schema `translation.footnotes`).

## Ilmu Waris (dalil pipeline)

The dalil half of the Ilmu Waris track's M1 (`docs/waris-plan.md` §8–§10; research in
`docs/waris-research/dalil.md`, `dalil.json` and `architecture.md` §4). Same ground rules as above:
no Arabic is typed, every string is a whole source field or an offset slice of one, stdlib only,
no LLM or paid API, every record draft until the fara'id reviewer signs.

```bash
cd belajar/pipeline
python3 fetch.py --skip-audio   # also pins QuranEnc suras 2, 4, 8, 33, 42, 49, 60 and fawazahmed0 Muslim sections 23-25
python3 build_waris.py          # writes ../content/waris/{dalil,dalil-gaps,dalil-provenance,rules}.json; exit 1 if dalil.json != the docs copy
python3 build_waris.py --rules-only   # rules.json only (from authored/waris.rules.json)
python3 validate_waris.py       # independent re-check against Tanzil, QuranEnc, api/data and the pins; exit 1 on any failure
python3 validate_waris.py --no-corpus  # what CI runs: every check that needs neither api/data nor cache/; prints what it skipped
python3 validate_waris.py --rules-only # RuleNotes only
python3 test_validate_waris.py  # mutation tests: plants 52 faults in copies of the outputs, each must fail validate_waris.py
python3 test_validate_waris.py --no-corpus  # what CI runs: the 33 corpus-free faults; the 19 corpus-only ones skipped by name
node ../scripts/check-waris-vector-parity.mjs   # research-phase parity (docs copy vs belajar copy), skipped where docs/ is absent
```

| File | Role |
|---|---|
| `ar.py` | Arabic search key and harakat-insensitive regex for the corpus (moved from the DALIL researcher's scratchpad; same patterns, written with escapes); the printed editions' running heads that excerpts are cut around (`running_head_spans`, `elide`) |
| `build_dalil.py` | The research stage, moved from the scratchpad: rebuilds `docs/waris-research/dalil.json` byte for byte from the pinned inputs, including the 2026-10-09 review edits (`apply_review_2026_10_09`, each edit asserts the value it replaces) |
| `build_waris.py` | Writes the three files below; extracts the plan §8 gap list; fails unless `dalil.json` equals the docs copy while that exists |
| `validate_waris.py` | Independent re-check (its docstring lists the 10 checks); warns about two known research-file defects (below). `--no-corpus` runs the corpus-free subset; without it a missing `api/data` file is a failure, never a skip |
| `test_validate_waris.py` | Mutation tests for `validate_waris.py` (stdlib `unittest`; `python3 test_validate_waris.py` prints the table). A full run also proves `NEEDS_CORPUS` exact: every other fault is caught by `--no-corpus` too |
| `authored/waris.rules.json` | The RuleNote drafts (one per engine rule id in `src/lib/waris/registry.ts`), written by hand; `build_waris.py` copies them to `../content/waris/rules.json` in registry order |
| `../content/waris/dalil.json` | 228 research records (13 ayat, 46 hadith, 26 fiqh, 19 tafsir excerpts, 82 section pointers, 41 rules); byte-identical to `docs/waris-research/dalil.json`, which is canonical during the research phase |
| `../content/waris/dalil-gaps.json` | The plan §8 gap list: 26 extracted records (9 ayat, 6 hadith, 11 kitab/tafsir excerpts) in the `dalil.json` shapes, plus 13 `kind: "gap"` records for what the corpus cannot ground (E1–E11, Akdariyyah, 'Umariyyatain with the grandfather). The 2026-10-09 review added one excerpt (`F-FSUNNAH-855-radd-zawj`) and one gap (`G-RADD-SEMUA-UTSMAN`) for the `radd.semua` note. Ids never collide with `dalil.json`: readers take the union. `would_ground` names the rule an extracted record supports; the rule records stay unchanged until the docs copy stops being canonical |
| `../content/waris/dalil-provenance.json` | For every record that copies or points at corpus bytes: source, locator, sha256 of the whole source field, sha256 of the copied bytes, and the span when it is a slice (with `omit` / `source_truncated` when the excerpt carries the marks below) |
| `../content/waris/rules.json` | Generated RuleNotes (95) plus the 22 legal sources; all draft |
| `../content/waris/test-vectors.json` | Byte copy of `docs/waris-research/test-vectors.json` (the engine's vectors, 99 since the 12 plan §4 case-study vectors were merged in on 2026-10-09; parity-checked). The engine runs them with `npx --yes tsx@4.19.2 scripts/waris-check.ts` from `belajar/` |

**Inputs.** `tanzil_uthmani` is the whole Qur'an (6236 verse lines), so the Arabic needs no new
download. `quranenc_indonesian_affairs_waris` pins the seven QuranEnc sura files; the sura-1 entry is
untouched, and the version (1.0.1) is the one read from its pinned translations list.
`fawazahmed0_muslim_sections` maps `api/data/muslim.json`'s sequential numbers to the Fuad Abd al-Baqi
numbers (1615a style); the Arabic is checked byte-identical before a number is used. The hadith,
kitab and tafsir bytes come from `api/data/*.json`, the platform corpus, which is git-ignored: each
file's sha256 is in META.sources and each copied field's sha256 in `dalil-provenance.json`, so a
changed corpus fails `validate_waris.py`. For the same reason the corpus checks run locally (like
`validate.py`); CI (`.github/workflows/deploy-belajar.yml`, verify job) runs the parity script,
`validate_waris.py --no-corpus` and `test_validate_waris.py --no-corpus`. Run the full
`validate_waris.py` before committing any change to the dalil files.

**Known data issues (for the reviewer and the research owner).**
- `dalil.json` META still names the scratchpad (`generator`, `sources.quranenc.files`). The strings are
  kept so the rebuild is byte-identical; the bytes now come from the pinned cache and have the same
  sha256, which `validate_waris.py` checks.
- `H-BULUGH-1114` and `H-BULUGH-1116`: the shown matn span (`ar_matn_and_ibn_hajar_attribution`)
  carries the editor's in-text footnote marker ("1" + RLM) mid-matn. The display must strip it, or the
  span must be split; `validate_waris.py` warns for these two and fails for any other record.
- Five Arabic quotations in four review notes of `dalil.json` (H-BUKHARI-6734, T-IK-4-7-muhkam,
  R-hajb-siblings, R-asabah-order) are in a cleaned form that is not a byte-exact substring of the corpus
  (brackets and spacing removed). They are reviewer notes, never dalil; do not display them.
- Several corpus records are chunked mid-sentence (Fiqh as-Sunnah 860, 861; al-Umm 559): the
  extracted spans stop at the last complete clause and say so in `notes`. Fiqh as-Sunnah 854 breaks off
  inside the sentence the excerpt needs: `F-FSUNNAH-854-radd-no-nass` carries `source_truncated` and
  its `ar` ends with " …" (review 2026-10-09).
- **Running heads (review 2026-10-09).** The Fath al-Qarib and Fath al-Mu'in corpus texts carry the
  printed edition's title line at every page break, mid-sentence (Fath al-Mu'in sometimes followed by
  ~33 zero digits). Five excerpts crossed one (`F-FQARIB-116-heirs`, `-116-barriers`, `-117-furudh`,
  `F-FMUIN-35-awl`, `-35-usul`). An excerpt is now cut around each head: `omit` lists the source spans
  removed, `ar` shows each cut as "…", and `validate_waris.py` checks that every omitted span is exactly a
  running head (corpus) and that no shown Arabic field carries a head or a 6+ digit run (corpus-free).
  `docs/waris-research/dalil.json` was regenerated from `build_dalil.py` for this (META.excerpt_marks).
