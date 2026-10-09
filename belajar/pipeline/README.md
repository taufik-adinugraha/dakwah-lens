# Belajar content pipeline (Al-Fatihah)

Offline, review-gated pipeline that produces `belajar/content/al-fatihah.json`, a `SurahContent`
record, and `belajar/content/library.json`, the shared `Library` (Konsep, Kosakata, Akar), as
defined in `belajar/src/content/schema.ts`. It implements the "source registry",
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
python3 build_library.py    # write ../content/library.json (Kosakata, Akar, + Konsep if authored)
python3 build_fatihah.py    # write ../content/al-fatihah.json; prints data warnings
python3 validate.py         # re-check both outputs and the links between them; exits 1 on any failure
python3 test_validate.py    # mutation tests: plants 50 faults in copies of the outputs, each must fail validate
```

Run them in this order after editing any authored file: the lesson build reads the lexicon and
concept ids, and `validate.py` fails when an output is older than an authored file it was built from.

`fetch.py --refresh` re-downloads everything and compares with the pins (upstream drift check);
`fetch.py --repin <id>` deliberately accepts new bytes for one input. `cache/` is git-ignored.

## Files

| File | Stage | Role |
|---|---|---|
| `sources.json` | 0 | Every input: URL, version, sha256 (pinned after download), bytes, retrieval date, licence, attribution |
| `fetch.py` | 1 | Downloads into `cache/`, checks headers/licence footers, pins or verifies sha256 |
| `common.py` | — | Paths, sha256, Tanzil and QAC loaders, QAC Buckwalter table, search normalisation, MP3 duration probe |
| `authored/al-fatihah.words.json` | 3 | Hand-authored per-word values: translit, gloss, wazn, case, why, ikhtilaf, kitab sources, review notes |
| `authored/al-fatihah.structure.json` | 3 | Hand-authored `Ayah.structure` (type, summary, word groups, sources) and `Word.role`, with `role_src` / review notes for the reviewer |
| `authored/al-fatihah.concepts-map.json` | 3 | Word loc -> Konsep ids (`Word.concepts`); generated from the concepts' `examples`, re-checked both ways by `validate.py` |
| `facts.py` | 2 | Recomputes the plan's Appendix B "Tahukah kamu?" facts from Tanzil + QAC |
| `build_fatihah.py` | 2 | Joins everything into `belajar/content/al-fatihah.json` |
| `validate.py` | 6 | Independent re-check of both outputs against Tanzil, QAC, the pins and `schema.ts` (a Python mirror of its zod rules), and of every link between them |
| `test_validate.py` | 6 | Mutation tests for `validate.py` (stdlib `unittest`; `python3 test_validate.py` prints the table) |
| `authored/library.lexicon.json` | 3 | Hand-authored Kosakata + Akar values: translit, meaning, tashrif rows, i'lal, root meanings, kitab refs, review notes |
| `authored/library.concepts.json` | 3 | Hand-authored Konsep records (separate author); passed through by `build_library.py`, minus each record's reviewer-only `review_notes` |
| `build_library.py` | 2 | Joins QAC 0.4 + the authored library files into `belajar/content/library.json` (`Library`) |

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
  label differs from the QAC mapping. No word uses an override now: 1:2:4 had "isim (isim jam')",
  but only as-Samin calls al-‘ālamīna an isim jam' (Darwisy, al-Jadwal and al-Mujtaba: plural of
  ‘ālam, mulhaq), so it carries the QAC label "isim (jamak)" and as-Samin's view sits in its
  `ikhtilaf`. `validate.py` fails when a word's pos disagrees with its lexeme's pos.
- **Mabni words** carry the built-in vowel as `sign` where the main view states it (iyyāka:
  fathah, al-Jadwal; allażīna: fathah; an‘amta: sukun). For ‘alaihim (1:7:4, 1:7:7) the `mahall`
  is the jar-majrur phrase's (1:7:4 nashb per as-Samin; 1:7:7 raf' as na'ib fa'il) and `why`
  says so; `sign` is "—" because the unit is a phrase.

**Page numbers.** Darwisy, *I'rab al-Qur'an wa Bayanuh* jil. 1 (cet. 4, 1415 H) was checked on
Shamela, whose pagination follows the print: i'rab 1:1 hlm. 9; 1:2–1:6 hlm. 14 except the end of 1:6 (the naz' al-khafiḍ option for aṣ-ṣirāṭa and the i'rab of al-mustaqīma), which is on hlm. 15; 1:7 hlm. 15; the balaghah note on lillāhi (ikhtishash) hlm. 16;
al- in al-ḥamd as jins hlm. 19; āmīn (al-Fawa'id) hlm. 20. ad-Dani, *al-Bayan* hlm. 139 and
as-Suyuthi, *al-Itqan* 1/189 are confirmed. Pages for al-Jadwal, al-Mujtaba, an-Nahhas, as-Samin
and Ibn Kathir still say "halaman cetak belum diverifikasi".

**Library links.** `lemma_id` is the authored-lexicon id of the word's QAC STEM `LEM` (the build
stops if a word's lemma has no lexicon entry). `concepts` is copied from
`authored/al-fatihah.concepts-map.json` (every id must be a Konsep id). `role` and each ayah's
`structure` come from `authored/al-fatihah.structure.json`; group `words` are 1-based indices
inside the ayah, ascending, at least two; a group `concept` must be a Konsep id; every `role_src`
abbreviation must already be in that word's `src`. `role_src`, `role_note` and `review_notes`
never reach the output. All 29 words have a role and all 7 ayat a structure; the build stops otherwise.

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

## Shared library: Kosakata (lexicon) and Akar (roots)

`build_library.py` writes `belajar/content/library.json`, a `Library` record (`schema.ts`): one
`Lexeme` per QAC lemma and one `Root` per QAC root used by the covered surahs (`SURAHS = [1]`:
23 lemmas, 18 roots for Al-Fatihah), plus the Konsep records from `authored/library.concepts.json`
when that file exists (otherwise `concepts: []`). Run it after `fetch.py`; it needs no network.
`python3 build_library.py --word-map` prints word loc -> lexicon id; `build_fatihah.py` sets
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

- **pos**: `build_fatihah.pos_label` on the lemma's first covered STEM; verbs get the lemma-level
  label `fi'il` (aspect belongs to a word); "(jamak)"/"(mutsanna)" is dropped unless every QAC
  occurrence of the lemma has that number (so ‘ālamīn, plural in all 73, is "isim (jamak)"). An
  authored `pos` needs a `pos_note`.
- **occurrences**: STEM segments with that `LEM`, ayat counted once; the `method` carries the
  `facts.QAC_BASIS` note, lists the QAC POS tags when a lemma has more than one (yaum: N/T;
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
  mujarrad, IV = أَفْعَلَ, X = اِسْتَفْعَلَ); `verb_lem` and every `attest` lemma share the
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
- **i'lal** (7): ism ← simw (ibdal; J 27, MB 290, D 8), nasta‘īnu ← nasta‘winu (J 32, D 14,
  al-Mujtaba 1/5 on 1:6), ihdinā ← tahdīnā (ta- dropped, hamzah washal, i'lal bil-hadzf; J 34, D 14,
  al-Hamalawi 36–37, an-Nahhas 1/20, as-Samin 1/62), ṣirāṭ ← sirāṭ (ibdal;
  J 34, MQ 3/349 and 3/152, MB 274), mustaqīm ← mustaqwim (J 34, D 15), ‘alaihi ← ‘alāhu
  (MB 2/428), ḍāll ← ḍālil (idgham; J 35). The Kosakata card shows ibdal and idgham under the
  i'lal heading; the Konsep `ilal` record says so (al-Hamalawi 121–122: every i'lal is an ibdal,
  not the reverse).

**Spelling convention shared with the lesson and Konsep text.** Letter names and grammar terms are
written in pesantren spelling (ya', 'ain, tha', shad, sin, lam, qaf; fa'il, maf'ul), and wazan
names in prose carry their ending (fa‘īlun, fā‘ilun, maf‘ūlun), so they are never read as an ASCII
spelling of an SKB word. `build_library.py` and `validate.py` check the lexicon, root and concept
prose together with the lesson prose, as the app shows them side by side.

**Left out on purpose, or open for the reviewer** (details in each entry's `review_notes`):
no tashrif for ism, rabb (its origin is disputed: D 13 gives three views, J 29 one), Allah
(origin not decided, plan §8), ‘ālamīn, yaum, ṣirāṭ, gair or the particles; no isim fa'il for
gaḍiba (the dictionaries cited give gaḍbān/gaḍūb, the Qur'an uses gaḍbān); no isim maf'ul for
istaqāma or ḍalla (intransitive), and only madhi–mudhari'–mashdar for dāna (its participles
mean debtor/creditor). al-Jadwal (hlm. 29) puts ḥamida in bab naṣara; Mukhtar ash-Shihah
(fahima) and Maqayis (aḥmaduhu) support bab 4, which the row uses. The al-Mujtaba refs give the
tafsir.app ayah page; printed pages, checked on Shamela 9617's page markers: QS 1:1–1:5 hlm. 4, 1:6–1:7 hlm. 5. The `review_notes` of word 1:5:4 in
`authored/al-fatihah.words.json` write the origin of nasta‘īnu as "nasta‘wanu"; D, J and
al-Mujtaba all say nasta‘winu (kasrah on the wawu).

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
