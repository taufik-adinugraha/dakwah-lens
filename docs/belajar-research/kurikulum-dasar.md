# Belajar Al-Qur'an: kurikulum dasar (the basic syllabus over five units)

Date: 2026-10-13.

This is the record of the basic level of the Belajar Qur'anic Arabic course: which nahwu topics it teaches, in what order, and at which ayah. The lesson rework, the cheat sheet and the curriculum page are built from it.

- **Scope.** Five units: Al-Fatihah (1:1–7), Al-Ikhlas (112), Al-Falaq (113), An-Nas (114) and Ayat al-Kursi (2:255). A lesson is one ayah, or one segment of 2:255, plus a "lesson zero" with no ayah.
- **What it holds.** Corpus evidence (where each topic occurs: sections A to D, G and H) and a proposal built on it (the classification in B, the distribution in E, the impact in F). The operator approved the proposal on 2026-10-13 with the decisions listed below.
- **Sources.** QAC 0.4 morphology and the Tanzil Uthmani text (both pinned in `belajar/pipeline/sources.json`); the course's own records in `belajar/content/` (`library.json`, the four lesson files, the narration manifests, the quiz files); and the Ajurrumiyyah matn pages cached at `belajar/pipeline/cache/shamela/11371`.
- **Measured on.** Commit `130b1ba` (branch `fix/belajar-lesson-fixes`). On this branch (`feat/belajar-kurikulum-dasar`, at `89e69d9`) `library.json`, the four lesson files and the quiz files are byte-identical. Its Al-Fatihah narration manifest has 14 more lines; section F counts them separately.

## The operator's words (2026-10-13, verbatim)

- "this is my plan, we will not cover all ayat in quran: we only cover alfatihah, 3qul, ayat qursi. can we cover all arabic lessons here? if not we can add some more ayat/surah. we distribute the lessons into these ayats"
- "or let's focus on the basic first for those ayats/surahs, the more advanced ones reserved for later in different surah/ayats"
- "we should also explain this curriculum in the page"
- On the cheat sheet: "of course we need to refer to valid kitab, my example is just example"
- "agree" (to the distribution in section E and to decisions 1 to 7 below)
- "next ayat, should review pervious lesson if exist in that ayat" (decision 8)
- "so the knowledge is accummulating and repeated" (decision 9)
- "but separate new vs already knows concept, this is what new, this is what we've learnt so far" (decision 9)

## Decisions (approved)

1. **A "lesson zero" with no ayah opens the course.** It teaches harakat and the three kinds of word (kalimah: isim, fi'il, huruf), so ayah 1 is lighter. The harakat primer and kalimah move out of 1:1 into lesson zero. 1:1 keeps two new steps, majrur (kasrah) and huruf jar, plus the first use of the kinds of word in an ayah. 1:1 has isim and huruf only; the first fi'il is at 1:5:2. Nothing else in the table moves: idhafah stays at 1:4 and na't at 1:3.
2. **Order after Al-Fatihah:** An-Nas, Al-Falaq, Al-Ikhlas, then Ayat al-Kursi.
3. **Fi'il amr is taught on qul (114:1),** not on ihdinā (1:6:1).
4. **Badal is taught at 114:2,** not at 1:7.
5. **Inna and nahy open the next level.** They occur nowhere in the five units (section C). Inna starts on Al-Kautsar and nahy on Ad-Duha 93:9–10. *This one is the assistant's reading of "agree"; the operator was told and may pull them into the basic level.*
6. **All sharaf is "tingkat lanjut".** That covers wazan dan tashrif, isim fa'il, isim maf'ul, bab istif‘āl, bab if‘āl, i'lal, fi'il majhul, shighat mubalaghah and ruba'i mujarrad: the nine records with `kind: sharaf`. A sharaf topic is named on a lesson's card and is not taught at the basic level. The wazan badge and the wazn-factory exercise leave the basic lessons. This settles the "borderline" class of `wazan-dan-tashrif` in section B, and it puts the 15 wazn-factory narration lines of section F inside the change.
7. **At most three new steps per lesson. No lesson line may use a term before the lesson that teaches it.**
8. **A lesson REVIEWS the earlier topics that occur in its ayah; it does not only name them.** Today the opening card lists them under "Mengulang" and a word card says "sudah dipelajari di ayat N". The rework makes it an active review, in three places: (a) the opening's "Mengulang" group shows each repeated topic with its short rule (the cheat-sheet formula), not just its name; (b) at the word where the topic occurs, the explanation says so in words ("seperti yang kita pelajari di ayat N") and applies the rule to this word; (c) the lesson's warm-up asks about them (at most three questions, on the repeated topics present in this ayah, preferring the ones taught most recently or practised least). Where an ayah repeats more than three earlier topics (the table in section E lists seven for 1:7 and six for S6), three are reviewed actively and the rest are only listed.
9. **New and already-learnt are always shown apart, and "learnt so far" is cumulative.** Every lesson presents two clearly separate things: (a) **Baru** — what this lesson teaches for the first time (at most three); (b) **Sudah kita pelajari** — everything taught up to this lesson, the whole list so far, with the ones that occur in this ayah marked as the ones being reviewed here (decision 8). The same separation holds wherever a topic is mentioned inside the lesson: a new topic is introduced with "Konsep baru", an earlier one with "Ulangan" (or the wording the rework settles on), on the opening card, at the word, in the warm-up and at the closing. The closing says what was new in this lesson and how much has been learnt in total. "Nanti" and "tingkat lanjut" stay a third, separate group.

## Notation

- Locations are `surah:ayah:word`.
- Words of 2:255 are given as w1–w50 with QAC's own Buckwalter forms, because the course has no transliteration for them. S1–S9 are the proposed segments of 2:255 (section D).
- "Matn" means the Ajurrumiyyah pages cached at `belajar/pipeline/cache/shamela/11371`.
- "Record" means a concept record in `library.json` (`concepts[]`, 37 today). A concept is introduced in the ayah of its first example.

## A. Basic syllabus, proposed (27 topics, dependency order)

| # | Topic | Needs | Record today | Class | Ajurrumiyyah as the records cite it |
|---|---|---|---|---|---|
| 1 | Harakat (fathah, kasrah, dhammah, sukun, tasydid, tanwin) | none | `basics: harakat` (not one of the 37; 9 primer lines in 1:1) | basic | none |
| 2 | Kalimah: isim, fi'il, huruf | 1 | `kalimah-isim-fiil-huruf` | basic | hlm. 5 |
| 3 | I'rab dan tandanya: majrur, marfu', manshub, majzum (four steps) | 2 | `tanda-irab` (one record for all four) | basic | hlm. 6–9 |
| 4 | Huruf jar dan isim majrur | 2, 3 | `huruf-jar` | basic | hlm. 5, 23 |
| 5 | Ma'rifah dan nakirah: alif lam, tanwin (two steps) | 1, 2 | none (terms `marifah`, `nakirah` only) | basic | hlm. 5, 14 |
| 6 | Jumlah ismiyyah: mubtada', khabar, khabar jar-majrur | 3, 4 | `jumlah-ismiyyah` (+ `syibhul-jumlah`) | basic | hlm. 12–13 |
| 7 | Mufrad, mutsanna, jamak (three jamak types) | 3 | `jamak-mudzakkar-salim` only | basic | hlm. 6–9 |
| 8 | Na't | 3, 5 | `naat` | basic | hlm. 14 |
| 9 | Idhafah | 3, 5 | `idhafah` | basic | hlm. 22–23 |
| 10 | Dhamir: munfashil, muttashil | 2 | `dhamir` | basic | hlm. 11, 17 |
| 11 | Mu'rab dan mabni | 3, 10 | `murab-mabni` | basic | record cites Ibnu Hisyam and Ibnu 'Aqil |
| 12 | Fi'il mudhari' | 2, 3 | `fiil-mudhari` | basic | hlm. 10 |
| 13 | Jumlah fi'liyyah: fi'il dan fa'il | 10, 12 | `jumlah-filiyyah` | basic | hlm. 11 |
| 14 | Maf'ul bih | 13, 3 | `maful-bih` | basic | hlm. 17 |
| 15 | Isim maushul dan shilah | 11, 13 | `isim-maushul` | basic | none cited |
| 16 | Fi'il madhi | 11, 13 | `fiil-madhi` | basic | hlm. 10 |
| 17 | 'Athaf | 3 | `athaf` | basic | hlm. 15 |
| 18 | Fi'il amr | 11, 13 | `fiil-amr` | basic | hlm. 10 |
| 19 | Badal | 3, 8 | `badal` | borderline | hlm. 16 |
| 20 | Mudzakkar dan mu'annats | 2, 7 | none | basic | no chapter in the cached pages |
| 21 | Nafi dan nahy: lam (+ majzum), lā | 12, 3 | `jazm-lam` (lam only) | basic | hlm. 8, 10 |
| 22 | Kāna | 5, 6, 12 | `kana-wa-akhawatuha` | basic | hlm. 13 |
| 23 | Istitsna' (illā) | 21 | none | basic | in the matn's manshubat list; no record cites it |
| 24 | Istifham | 13 | none | basic | not in the cached pages |
| 25 | Isim isyarah | 5, 11 | none | basic | hlm. 14 ("al-ism al-mubham") |
| 26 | Zharaf (zaman, makan) | 3, 9 | none (`zharaf-idza` is the advanced case) | borderline | in the matn's manshubat list |
| 27 | Inna | 6 | none | basic | in the matn's 'awamil list, beside kāna |

Corrections to the starting list, from the data:
- **I'rab** is one record but arrives in four steps. Majzum exists only at 112:3–4. A manshub fi'il occurs nowhere (QAC `MOOD:SUBJ`: 0).
- **Tanwin** is absent from Al-Fatihah and An-Nas (QAC `INDEF`: 0), which is why the primer borrows 97:5:1.
- **Mu'annats**: no feminine noun in Al-Fatihah or Al-Ikhlas.
- **Mutsanna** occurs only as a dhamir (2:255:47). No dual noun exists in the five units.
- **Kāna, istitsna', istifham, isim isyarah** each sit in one unit only.
- **Additions the data asks for**: badal (5 word roles depend on it) and zharaf (5 words tagged `T`/`LOC`).

## B. The 37 existing concepts

The course's own `kind` field marks 9 records as sharaf; all nine land outside "basic".

| Class | Concept | Reason |
|---|---|---|
| basic | kalimah-isim-fiil-huruf | Every other record is defined on it. |
| basic | tanda-irab | It is the "why this ending" of every word card. |
| basic | huruf-jar | 22 QAC `P` segments across all five units. |
| basic | idhafah | Most frequent cause of kasrah in the records. |
| basic | naat | 12 word roles. |
| basic | jumlah-ismiyyah | 1:2, 112:1–2, and 2:255. |
| basic | jamak-mudzakkar-salim | Without it the ya' of 1:2:4 and 1:7:9 breaks the kasrah rule. The "mulhaq" detail can wait. |
| basic | murab-mabni | 19 words carry the state "mabni". |
| basic | dhamir | QAC `PRON` on 21 words. |
| basic | fiil-mudhari | 13 verbs. |
| basic | jumlah-filiyyah | Applies to all 23 verbs. |
| basic | athaf | 13 `CONJ` prefixes. |
| basic | fiil-amr | ihdinā and qul ×3. |
| basic | maful-bih | 1:5, 1:6, 2:255. The two-object detail can wait. |
| basic | isim-maushul | 9 `REL` words. |
| basic | fiil-madhi | 6 `PERF` verbs. |
| basic | jazm-lam | The only source of majzum. |
| basic | kana-wa-akhawatuha | On the operator's list, but its single example (112:4) is majzum with the khabar placed first. |
| borderline | syibhul-jumlah | "A khabar can be a jar-majrur" is basic (1:2:2). The term and the unspoken-word theory can wait. |
| borderline | badal | Not on the operator's list, yet 1:7:1 and 1:7:5 need it, and 1:2:3, 114:2:1, 114:3:1 offer it. |
| borderline | wazan-dan-tashrif | Grammar basics do not need it, but the wazn badge and the wazn-factory exercise do. |
| advanced | isim-fail | Sharaf; a gloss is enough (5 words). |
| advanced | taqdim-maful | Balaghah; it explains "hanya", not an ending. |
| advanced | bab-istifal | Sharaf; 2 words. |
| advanced | ilal | Sharaf; a sound change. |
| advanced | bab-ifal | Sharaf; 1 word. |
| advanced | isim-maful | Sharaf; 1 word. |
| advanced | naib-fail | Needs majhul or isim maf'ul first (1:7:7, 112:3:4). |
| advanced | maqul-al-qaul | A whole sentence in the position of nashab. |
| advanced | dhamir-syan | One word (112:1:2), with ikhtilaf. |
| advanced | khabar-jumlah | Follows from the dhamir sya'n reading. |
| advanced | fiil-majhul | Sharaf; 1 verb (112:3:4). |
| advanced | zharaf-idza | iżā with a sentence as mudhaf ilaih. |
| advanced | sighat-mubalaghah | Sharaf; 2 words. |
| advanced | athaf-bayan | An alternative reading of 114:2–3. |
| advanced | rubai-mujarrad | Sharaf; 2 words. |
| advanced | hal | Its only example is an implied hal held by ikhtilaf (114:6:1). |

Totals: 18 basic, 3 borderline, 16 advanced.

## C. Where each basic topic occurs

Counts are words. Basis: Q = QAC tag, C = course record, I = inferred.

| # | Topic | Al-Fatihah per ayah | 112 | 113 | 114 | 2:255 | Basis |
|---|---|---|---|---|---|---|---|
| 2 | isim | 4, 4, 2, 3, 2, 2, 5 | 8 | 13 | 14 | 31 | Q |
| 2 | fi'il | 1:5 ×2, 1:6 ×1, 1:7 ×1 | 4 | 5 | 3 | 7 | Q |
| 2 | huruf | 1:1, 1:2, 1:5 ×1 each; 1:7 ×3 | 4 | 6 | 5 | 20 | Q |
| 3 | majrur | 4, 3, 2, 3, 0, 0, 3 | 0 | 10 | 13 | 6 | Q |
| 3 | marfu' (isim) | 1:2:1 only | 5 | 0 | 0 | 9 | Q |
| 3 | marfu' (fi'il mudhari') | 1:5 ×2 | 0 | 1 | 2 | 5 | Q (no `MOOD` tag) |
| 3 | manshub | 1:6:2, 1:6:3, 1:7:1 | 112:4:4 | 0 | 0 | w3, w43, w44 | Q |
| 3 | majzum | 0 | 112:3:2, 3:4, 4:2 | 0 | 0 | 0 | Q |
| 4 | huruf jar | 1:1:1, 1:2:2, 1:7:4, 1:7:7 | 112:4:3 | 6 | 4 | 7 | Q |
| 5 | alif lam | 2, 2, 2, 1, 0, 2, 2 | 1 | 3 | 8 | 8 | Q |
| 5 | tanwin | 0 | 112:1:4, 4:4, 4:5 | 113:3:3, 5:3 | 0 | w10, w12, w35 | Q |
| 6 | mubtada', khabar | 1:2:1, 1:2:2 | 5 (112:1:2–4, 2:1–2) | 0 | 0 | w1, w5–6, w13–14, w48–49 | C; 2:255 I |
| 6 | khabar jar-majrur | 1:2:2 | 0 | 0 | 0 | w13 | C; 2:255 I |
| 7 | jamak mudzakkar salim | 1:2:4 (mulhaq), 1:7:9 | 0 | 0 | 0 | 0 | C + Q (`MP`) |
| 7 | jamak mu'annats salim | 0 | 0 | 113:4:3 | 0 | w16, w43 | I (`FP` + form) |
| 7 | other jamak | 0 | 0 | 113:4:5 | 114:5:4; an-nāsi ×5 | w30 | I; C for 113:4:5 and 114:5:4 ("jamak dari") |
| 7 | mutsanna | 0 | 0 | 0 | 0 | w47 (dhamir, `3MD`) | Q |
| 8 | na't | 1:1 ×2, 1:2:3 (or badal), 1:3 ×2, 1:4:1, 1:6:3 | 112:2:2 (alternative view) | 0 | 114:4:4, 5:1; 2:1 and 3:1 as an option | w7, w50 tagged `ADJ` | C; 2:255 role unverified |
| 9 | idhafah | 1:1:2, 1:2:4, 1:4 ×3, 1:7:2, 1:7:6 | 0 | 12 | 10 | w24, 26, 30, 32, 37, 42, 47 | C; 2:255 I |
| 10 | dhamir munfashil | 1:5:1, 1:5:3 | 112:1:2 | 0 | 0 | w5, w48 | Q |
| 10 | dhamir muttashil | 1:6:1, 1:7:3, 1:7:4, 1:7:7 | 112:4:3 | 0 | 0 | 11 | Q |
| 11 | mabni | 1:5 ×2, 1:6 ×1, 1:7 ×4 | 3 | 7 | 2 | no record | C |
| 12 | fi'il mudhari' | 1:5:2, 1:5:4 | 3 | 113:1:2 | 114:1:2, 5:2 | 5 | Q |
| 13 | fa'il implied or a dhamir | all four verbs (-ta at 1:7:3) | all | all | all | w34 | C |
| 13 | fa'il that is an isim | 0 | 0 | 0 | 0 | w10, w42, w47 | I |
| 14 | maf'ul bih | 1:5:1, 1:5:3, 1:6:1, 1:6:2 | 0 | 0 | 0 | w9, w28, w43, w44, w46 | C; 2:255 I |
| 15 | isim maushul | 1:7:2 | 0 | 113:2:3 | 114:5:1 | 6 | Q |
| 16 | fi'il madhi | 1:7:3 | 0 | 113:2:4, 3:5, 5:5 | 0 | w40, w41 | Q |
| 17 | 'athaf | 1:5:3, 1:7:8 | 112:3:3, 4:1 | 3 | 114:6:3 | 5 | Q |
| 18 | fi'il amr | 1:6:1 | 112:1:1 | 113:1:1 | 114:1:1 | 0 | Q |
| 19 | badal | 1:7:1, 1:7:5; 1:2:3 as an option | 0 | 0 | 114:2:1, 3:1 (one of three views) | none | C |
| 20 | mu'annats | 0 | 0 | 113:4:3 | 114:6:2 | 6 nouns; verb w9 (`3FS`) | Q |
| 21 | lam | 0 | 112:3:1, 3:3, 4:1 | 0 | 0 | 0 | Q |
| 21 | lā | 1:7:8 (record: "penegas, tambahan") | 0 | 0 | 0 | w8, w11, w33, w45; w2 is `SP:<in~` | Q |
| 22 | kāna | 0 | 112:4:2 | 0 | 0 | 0 | Q |
| 23 | illā | 0 | 0 | 0 | 0 | w4, w25 (`EXP`), w38 (`RES`) | Q |
| 24 | istifham | 0 | 0 | 0 | 0 | w20 | Q |
| 25 | isim isyarah | 0 | 0 | 0 | 0 | w21 | Q |
| 26 | zharaf | 0 | 0 | 113:3:4, 5:4 | 0 | w24, w29, w32 | Q |
| 27 | inna | 0 | 0 | 0 | 0 | 0 | Q |

**Basic topics that occur nowhere in the five units** (shortest place QAC shows them, 93–114 first):

| Topic | Shortest places | QAC evidence |
|---|---|---|
| Inna | 108:1 (3 words; Al-Kautsar has 10); 103:2 (4 words; Al-'Asr has 14); 108:3; 110:3 | `POS:ACC LEM:<in~` |
| Nahy | 93:9 and 93:10 (4 words each; Ad-Duha has 40); 96:19 | `POS:PRO` + `MOOD:JUS` |
| Isim isyarah in a plain use | 95:3 (3 words); 106:3 (4; Quraisy has 17); 107:2 (4; Al-Ma'un has 25) | `DEM` hāżā / żālika |
| Mutsanna as a noun | 90:9, 90:10 (2 words each), 90:8 (4); in 93–114 only 111:1 | `FD` / `MD` |
| Manshub fi'il mudhari' | 99:6 (6 words) in 93–114; 78:15, 80:4 (4 words) outside | `MOOD:SUBJ` |
| Kāna in madhi form, usual order | 110:3 (7 words) | `LEM:kaAna PERF`, then `INDEF ACC` |

In the five units the only `DEM` is w21 inside w20–21 (`man *aA`), a lemma with 5 occurrences in the whole Qur'an.

## D. 2:255 segmented

The pinned Tanzil text has no pause marks in 2:255. Its 50 tokens are byte-identical to the 50 QAC words. Boundaries below are clause onsets; only w45 and w48 are marked by QAC itself (`REM`). The rest are inferred.

| Seg | Words | Count | Starts with | Natural place for |
|---|---|---|---|---|
| S1 | w1–7 | 7 | `{ll~ahu` (`PN NOM`) | istitsna' (w4); jumlah ismiyyah; alif lam |
| S2 | w8–12 | 5 | `laA` (`NEG`) | lā nafi with a marfu' fi'il; fa'il that is an isim (w10); maf'ul bih as dhamir (w9); tanwin; mu'annats |
| S3 | w13–19 | 7 | `l~ahu,` (`P`+`PRON`) | huruf jar + dhamir; isim maushul; jamak mu'annats salim, majrur (w16) |
| S4 | w20–26 | 7 | `man` (`INTG`) | istifham; isim isyarah; isim maushul + shilah; zharaf (w24); noun + dhamir (w26) |
| S5 | w27–32 | 6 | `yaEolamu` (`V`) | zharaf ×2 (w29, w32); noun + dhamir; jamak (w30) |
| S6 | w33–40 | 8 | `wa`+`laA` (`CONJ`+`NEG`) | repeats only: lā, huruf jar ×3, tanwin, illā, isim maushul, fi'il madhi |
| S7 | w41–44 | 4 | `wasiEa` (`V PERF`) | the one full fi'il + fa'il + maf'ul bih with nouns; w43 is `ACC` with a kasrah ending |
| S8 | w45–47 | 3 | `wa` (`REM`) | mutsanna (dhamir, w47); fa'il as an isim |
| S9 | w48–50 | 3 | `wa` (`REM`) | jumlah ismiyyah with a dhamir as mubtada' |

- **Kasrah on a manshub word (w43)**: the matn's 'alamat chapter states it: "وأما الكسرة: فتكون علامة للنصب في جمع المؤنث السالم".
- **Segment count**: S8 and S9 could merge into one 6-word lesson, or S1 could split after w5. Either needs a kitab.
- **Pipeline gap**: `build_surah.pos_label` has no label for the stem tags `EXP`, `RES` and `INTG`, so the build would stop on w4, w20, w25 and w38.

## E. Distribution, approved

Each i'rab state and each jamak type counts as one new step. Lesson zero comes first (decision 1). Order after Al-Fatihah: An-Nas, Al-Falaq, Al-Ikhlas, Ayat al-Kursi (decision 2).

| Lesson | New (max 3) | Repeated | Present but waiting (next place) | Named as tingkat lanjut |
|---|---|---|---|---|
| Lesson zero (no ayah) | harakat; kalimah (isim, fi'il, huruf) | none | none | none |
| 1:1 | i'rab step 1 (majrur, kasrah); huruf jar | kalimah (isim and huruf; 1:1 has no fi'il) | idhafah (1:4); na't and alif lam (1:3) | implied word behind bismi |
| 1:2 | i'rab step 2 (marfu', dhammah); jumlah ismiyyah with jar-majrur khabar; jamak mudzakkar salim (ya') | huruf jar, majrur | idhafah at 1:2:4 (1:4); na't at 1:2:3 (1:3); alif lam (1:3) | syibhul jumlah, mulhaq, wazan |
| 1:3 | alif lam (ma'rifah); na't | majrur | none | wazan dan tashrif |
| 1:4 | idhafah | na't, alif lam, majrur | none | isim fa'il |
| 1:5 | dhamir; fi'il mudhari'; mu'rab dan mabni | marfu' | jumlah fi'liyyah and maf'ul bih (1:6); 'athaf (1:7:8–9) | taqdim maf'ul, bab istif‘āl, i'lal |
| 1:6 | jumlah fi'liyyah; maf'ul bih; i'rab step 3 (manshub, fathah) | dhamir muttashil, na't, alif lam, mabni | fi'il amr (114:1:1) | isim fa'il, bab istif‘āl, i'lal |
| 1:7 | isim maushul dan shilah; fi'il madhi; 'athaf | idhafah, huruf jar, dhamir, jumlah fi'liyyah, mabni, jamak mudzakkar salim, manshub | badal (114:2:1) | bab if‘āl, isim maf'ul, na'ib fa'il, isim fa'il, lā tambahan |
| 114:1 | fi'il amr | fi'il mudhari', jumlah fi'liyyah, huruf jar, idhafah | none | maqul al-qaul |
| 114:2 | badal | idhafah, majrur | none | 'athaf bayan |
| 114:3 | none | badal, idhafah | none | 'athaf bayan |
| 114:4 | none | huruf jar, idhafah, na't, alif lam | none | shighat mubalaghah, wazan |
| 114:5 | jamak taksir (ṣudūri) | isim maushul + shilah, fi'il mudhari', huruf jar, idhafah | none | ruba'i mujarrad |
| 114:6 | mudzakkar dan mu'annats (al-jinnati) | 'athaf, huruf jar, alif lam | none | hal |
| 113:1 | none | fi'il amr, fi'il mudhari', huruf jar, idhafah | none | maqul al-qaul |
| 113:2 | none | huruf jar, idhafah, isim maushul, fi'il madhi | none | none |
| 113:3 | tanwin (nakirah) | 'athaf, idhafah, fi'il madhi | none | zharaf iżā, isim fa'il |
| 113:4 | jamak mu'annats salim | jamak taksir, mu'annats, huruf jar, 'athaf | none | shighat mubalaghah |
| 113:5 | none | tanwin, 'athaf, fi'il madhi | none | zharaf iżā, isim fa'il |
| 112:1 | none | fi'il amr, dhamir munfashil, jumlah ismiyyah, tanwin | none | maqul al-qaul, dhamir sya'n, khabar jumlah |
| 112:2 | none | jumlah ismiyyah, marfu', alif lam | none | wazan |
| 112:3 | nafi with lam; i'rab step 4 (majzum, sukun) | fi'il mudhari', 'athaf | none | fi'il majhul, na'ib fa'il, i'lal |
| 112:4 | kāna | lam + majzum, huruf jar + dhamir, tanwin, manshub | none | khabar placed first |
| S1 | istitsna' | jumlah ismiyyah, dhamir munfashil, alif lam | none | lā tagged `SP:<in~` with a manshub noun (w2–3) |
| S2 | lā nafi; fa'il that is an isim | fi'il mudhari', maf'ul bih, tanwin, 'athaf, mu'annats | none | none |
| S3 | none | huruf jar + dhamir, isim maushul, jamak mu'annats salim, 'athaf | none | khabar placed first (inferred) |
| S4 | istifham; isim isyarah | isim maushul, fi'il mudhari', istitsna', idhafah | zharaf at w24 (S5) | none |
| S5 | zharaf | fi'il mudhari', isim maushul, idhafah, jamak, 'athaf | none | none |
| S6 | none | lā nafi, huruf jar, tanwin, istitsna', isim maushul, fi'il madhi | none | verb form IV with wawu and nun (w34) |
| S7 | kasrah as the sign of manshub in jamak mu'annats salim | fi'il madhi, fa'il and maf'ul bih as nouns, 'athaf | none | none |
| S8 | mutsanna (dhamir) | lā nafi, maf'ul bih, fa'il as an isim, idhafah | none | none |
| S9 | none | jumlah ismiyyah, dhamir munfashil, alif lam | none | none |

That is 36 new steps over 32 lessons: 2 in lesson zero, 17 in Al-Fatihah (2, 3, 2, 1, 3, 3, 3), 4 in An-Nas, 2 in Al-Falaq, 3 in Al-Ikhlas and 8 in Ayat al-Kursi. 10 lessons carry no new step. Today the seven ayat of Al-Fatihah introduce 26 concept records (5, 3, 1, 1, 8, 2, 6).

**Review data (decision 8).** The Repeated column is what (a), (b) and (c) of decision 8 read. As written it lists the main repeated topics of each lesson, not all of them: 1:7, for example, also has alif lam (1:7:6, 1:7:9) and majrur (1:7:5, 1:7:6, 1:7:9), and the rows of 2:255 leave out more. The full list per lesson has to be generated from the word records and the QAC tags (section C) when the rework is built.

**Cumulative list (decision 9).** The "learnt so far" list of a lesson is the union of the New cells of all earlier lessons, in teaching order. The running count below is in steps (items of the New column), 36 in all. They belong to 26 of the 27 topics of section A: inna has no step, and nahy is the untaught half of topic 21.

| Lesson | New steps | Learnt before | Learnt after |
|---|---|---|---|
| Lesson zero | 2 | 0 | 2 |
| 1:1 | 2 | 2 | 4 |
| 1:2 | 3 | 4 | 7 |
| 1:3 | 2 | 7 | 9 |
| 1:4 | 1 | 9 | 10 |
| 1:5 | 3 | 10 | 13 |
| 1:6 | 3 | 13 | 16 |
| 1:7 | 3 | 16 | 19 |
| 114:1 | 1 | 19 | 20 |
| 114:2 | 1 | 20 | 21 |
| 114:3 | 0 | 21 | 21 |
| 114:4 | 0 | 21 | 21 |
| 114:5 | 1 | 21 | 22 |
| 114:6 | 1 | 22 | 23 |
| 113:1 | 0 | 23 | 23 |
| 113:2 | 0 | 23 | 23 |
| 113:3 | 1 | 23 | 24 |
| 113:4 | 1 | 24 | 25 |
| 113:5 | 0 | 25 | 25 |
| 112:1 | 0 | 25 | 25 |
| 112:2 | 0 | 25 | 25 |
| 112:3 | 2 | 25 | 27 |
| 112:4 | 1 | 27 | 28 |
| S1 | 1 | 28 | 29 |
| S2 | 2 | 29 | 31 |
| S3 | 0 | 31 | 31 |
| S4 | 2 | 31 | 33 |
| S5 | 1 | 33 | 34 |
| S6 | 0 | 34 | 34 |
| S7 | 1 | 34 | 35 |
| S8 | 1 | 35 | 36 |
| S9 | 0 | 36 | 36 |

Learnt at the end of each unit: lesson zero 2, Al-Fatihah 19, An-Nas 23, Al-Falaq 25, Al-Ikhlas 28, Ayat al-Kursi 36.

**Order of the four units.** An-Nas first, because 13 of its 20 words are majrur nouns repeating 1:1–1:4, and it has no tanwin, majzum or kāna. Al-Ikhlas goes third because it packs four first-example advanced records plus majzum and kāna into 15 words. The plan (§4.6) already calls An-Nas "the transfer test for the idafah and na't". Mushaf order (112, 113, 114) is also dependency-safe; it just puts the hardest surah first.

**Topics forced into one place**
- **Kāna and majzum**: only 112:3–4.
- **Jamak mudzakkar salim**: only 1:2:4 (mulhaq) and 1:7:9.
- **Badal, undisputed**: only 1:7, the most crowded ayah (9 words, 5 advanced items). The table teaches it at 114:2, where it is one of three views.
- **Istifham and isim isyarah**: only the adjacent pair w20–21.
- **Istitsna'**: first met inside S1, beside an advanced lā.

**Decisions put to the operator, now settled**
1. **1:1 carried the harakat primer plus 3 new steps.** Settled by decision 1: lesson zero takes harakat and kalimah. The option of keeping idhafah at 1:1 and leaving 1:4 as pure review is not taken.
2. **Fi'il amr.** Counting by records only, it could stay at 1:6, but then 1:6 has four new things (amr, jumlah fi'liyyah, maf'ul bih, fathah). Settled by decision 3: it is taught on qul, which is also the cleaner example.
3. **1:7.** If badal stayed there, fi'il madhi would have to wait for 113:2:4. Settled by decision 4: badal is taught at 114:2 and fi'il madhi stays at 1:7.

## F. Impact on what exists

| Fate | Concepts |
|---|---|
| Stay (10) | tanda-irab, huruf-jar (1:1); jumlah-ismiyyah, jamak-mudzakkar-salim (1:2); murab-mabni, dhamir, fiil-mudhari (1:5); maful-bih (1:6); isim-maushul, fiil-madhi (1:7) |
| Move to lesson zero (1) | kalimah-isim-fiil-huruf 1:1→lesson zero, together with the harakat primer (decision 1) |
| Move inside Al-Fatihah (4) | naat 1:1→1:3; idhafah 1:1→1:4; jumlah-filiyyah 1:5→1:6; athaf 1:5→1:7 |
| Move out (2) | fiil-amr 1:6→114:1; badal 1:7→114:2 |
| Tingkat lanjut (9) | syibhul-jumlah (1:2); wazan-dan-tashrif (1:3); isim-fail (1:4); taqdim-maful, bab-istifal, ilal (1:5); bab-ifal, isim-maful, naib-fail (1:7) |

Narration lines whose `display` names the term, at commit `130b1ba` (339 lines, 47.7 min recorded). "Must change" means before the new lesson for a moved concept, and every line for a demoted one.

| Concept | 1:1 | 1:2 | 1:3 | 1:4 | 1:5 | 1:6 | 1:7 | All | Must change |
|---|---|---|---|---|---|---|---|---|---|
| idhafah | 4 | 4 | 0 | 5 | 0 | 0 | 3 | 16 | 8 |
| naat | 4 | 2 | 0 | 1 | 0 | 1 | 0 | 8 | 6 |
| jumlah-filiyyah | 1 | 0 | 0 | 0 | 2 | 0 | 1 | 4 | 3 |
| athaf | 0 | 0 | 0 | 0 | 3 | 0 | 1 | 4 | 3 |
| fiil-amr | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 6 | 6 |
| badal | 0 | 1 | 1 | 0 | 0 | 0 | 6 | 8 | 8 |
| syibhul-jumlah | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| wazan-dan-tashrif | 0 | 0 | 1 | 0 | 2 | 1 | 2 | 6 | 6 |
| isim-fail | 0 | 0 | 0 | 1 | 3 | 2 | 2 | 8 | 8 |
| taqdim-maful | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 1 |
| bab-istifal | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 1 |
| ilal | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 1 |
| bab-ifal | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| isim-maful | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 3 |
| naib-fail | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 3 |
| **Unique lines to change** | **8** | **6** | **2** | **1** | **10** | **7** | **14** | | **48** |
| Seconds | 125 | 77 | 39 | 15 | 160 | 91 | 192 | | 699 (11.7 min) |
| Lines in the lesson | 55 | 50 | 24 | 28 | 49 | 44 | 89 | 339 | |

- **Wazn-factory exercise**: counting all 15 of its lines in ayat 5–7 raises the total to 52 lines (12.0 min). Six of its 12 quiz answers are "isim fa'il" or "isim maf'ul". Decision 6 removes the exercise from the basic lessons, so 52 is the figure that applies at this commit.
- **Lesson zero (decision 1)**: 10 more lines leave 1:1 for lesson zero, the 9 harakat primer lines and the kalimah "Konsep baru" line (90 s together). Three primer lines name "ayat ini" or "kata ketiga" (primer 4, 6, 8), and the first says "sebelum membahas kata demi kata"; those four need new wording in a lesson with no ayah.
- **Not counted**: paraphrases without the term ("sifat" is in 7 lines of 1:1, "sandar-" in 3), new lines for alif lam and the tingkat lanjut mentions, and the 1:1 i'rab line, which names all three signs at once.
- **Reuse**: audio files are named by a hash of the text, so a "Konsep baru" line moved with identical text is not rendered again. The four lines moving inside Al-Fatihah have no ayah-relative wording.
- **The nine demoted "Konsep baru" lines** total 158 s.
- **Other surahs**: the Qul manifests name demoted terms in 15, 31 and 9 lines, with no audio to redo. Only Al-Fatihah is recorded.
- **Existing forward reference**: maf'ul bih is already named at 1:5 (word 1:5:1 and one narration line) before its introduction at 1:6.

**The same count on this branch (`89e69d9`).** The Al-Fatihah manifest here has 353 lines (50.6 min). The 14 extra lines are a `map` line and a `learned` line per ayah; each one states how many topics the ayah has as new, repeated and later, so all 14 change with the distribution. One other line differs (`1:w1:compose:3`).

| Measure | 1:1 | 1:2 | 1:3 | 1:4 | 1:5 | 1:6 | 1:7 | Total |
|---|---|---|---|---|---|---|---|---|
| Lines in the lesson | 57 | 52 | 26 | 30 | 51 | 46 | 91 | 353 (50.6 min) |
| Lines naming a moved or demoted term | 9 | 8 | 4 | 3 | 12 | 9 | 16 | 61 (14.3 min) |
| With every `map` and `learned` line | 10 | 8 | 4 | 3 | 12 | 9 | 16 | 62 (14.5 min) |
| With every wazn-factory line as well (decision 6) | 10 | 8 | 4 | 3 | 14 | 10 | 17 | 66 (14.8 min) |

On this branch, then, 66 recorded lines change or go, and the same 10 lines (90 s) move to lesson zero.

## G. Advanced level, candidates only

The plan (§4.6) already names Al-'Asr, Al-Kautsar and An-Nasr as next surahs. "Widely memorised" is an assumption for the rest.

| Candidate | Size | What QAC shows it brings |
|---|---|---|
| Al-Kautsar (108) | 10 words | inna + dhamir (108:1:1); fi'il madhi with two dhamir (108:1:2, form IV); fi'il amr ×2; inna with a manshub isim and marfu' khabar (108:3) |
| Al-'Asr (103) | 14 | wawu qasam (103:1:1); inna + lam taukid (103:2); illā (103:3:1); four fi'il madhi with wawu jamak; jamak mu'annats salim manshub (103:3:5) |
| An-Nasr (110) | 19 | iżā (`T`); fa'il as an isim with idhafah (110:1, inferred); fi'il amr forms II and X; inna + kāna + manshub khabar (110:3:5–7) |
| Al-Kafirun (109) | 26 | nida' (109:1:2); jamak mudzakkar salim marfu' with wawu (109:1:3, 3:3, 5:3); lā nafi ×4; khabar jar-majrur placed first with noun + dhamir (109:6) |
| Ad-Duha (93) | 40 | nahy (93:9–10); nafi with mā; lam taukid and saufa; istifham with hamzah + lam (93:6); qasam |
| Al-Ma'un (107) | 25 | istifham (107:1:1); isim isyarah żālika (107:2:1); jamak mudzakkar salim both majrur (107:4:2) and marfu' (107:5:5) |
| Quraisy (106) | 17 | lam amr + majzum (106:3:1); isim isyarah hāżā (106:3:3) |
| Al-Balad 90:8–10 | 8 | three mutsanna nouns (`FD`/`MD`, `ACC`); istifham + lam + majzum |

QAC cannot label hal, tamyiz, taukid or maf'ul muthlaq, so no candidate is evidenced for them.

## H. Not determined, and every inference

**Needs a kitab (2:255 has no course record)**
- The role of w6–7 and w49–50: khabar, na't, or a second khabar.
- Whether w13–14 is a khabar placed before its mubtada'.
- Whether w21 is an isim isyarah or part of the question word.
- The kind of istitsna' at w4, and why QAC tags w38 `RES` but w4 and w25 `EXP`.
- Calling a dhamir attached to a noun "mudhaf ilaih" (7 words). The matn's ma'rifah list only implies it.
- The i'rab of w2–3.
- The traditional sentence count of the ayah.

**Inferred from QAC, not tagged**
- Fa'il as an isim: a verb followed by a `NOM` noun (w10 also agrees with the `3FS` verb).
- Maf'ul bih in 2:255: a suffix whose person differs from the verb's, or an `ACC` noun after it.
- Jamak types: number flag plus word ending. The course lexicon confirms "jamak dari" for 113:4:3, 113:4:5 and 114:5:4, and calls an-nās "isim untuk jamak", so an-nās is not used as the first jamak taksir.
- Marfu' for a fi'il mudhari': read from the absence of a `MOOD` tag.
- Mabni in 2:255.
- All clause boundaries except w45 and w48.

**Judgement, not data**
- The "Needs" column in A, and basic versus advanced for topics with no record.
- Rules for mudzakkar and mu'annats have no chapter in the cached matn and no course record.
- Whether zharaf and badal belong in the basic level.
- Spellings for terms with no course entry: nahy, istifham, istitsna', inna, mu'annats, jamak taksir, jamak mu'annats salim.

**Other limits**
- The line counts match term names only; they are a volume estimate.
- No timing or recitation check was made for 2:255.
- Nothing here was checked by an ustadz.
- Ajurrumiyyah page numbers are the print pages the records cite. The cached files use another numbering, and chapters named only in the matn's lists are not cached in full.

## Queued work that follows this table

- Rework Al-Fatihah to the distribution: about 48 recorded lines change by term match at `130b1ba`; on this branch 62, or 66 with the wazn-factory lines, plus 10 that move to lesson zero (section F).
- Structure explanations as separate items.
- The isim/fi'il/huruf warm-up per ayah.
- The cheat sheet ("Rumus singkat"), every line citing a kitab.
- The surah-end review with a shuffled quiz.
- Review of earlier topics inside each lesson (decision 8), built together with the warm-up exercise.
- The curriculum page built from this data.
- Recording the three Qul.
- Writing Ayat al-Kursi after kitab sourcing.
