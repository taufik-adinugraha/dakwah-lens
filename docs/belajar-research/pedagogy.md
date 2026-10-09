# pedagogy

## SUMMARY
- **The gap in the market.** I did not find an Indonesian-language product that ties each word of an ayah to a "why this harakat" explanation, plays a real reciter's audio for that word, cites tafsir from a named kitab, schedules reviews (SRS) and keeps its game design adab-aware. Each piece exists somewhere on its own:
  - Greentech: Indonesian word-by-word with root and morphology.
  - BISA: nahwu-sharaf taught in Indonesian.
  - Quranle and Quranic: gamified vocabulary, in English.
  - Tarteel: speech-based recitation checking, behind a paywall.
- **Two kinds of learner.** Kemenag's 2023 survey (10,347 respondents) found 38.49% cannot read the Qur'an and only 48.96% read ayat fluently. The module needs a "sudah bisa baca" track and a "jembatan baca" (reading bridge) track. Al-Fatihah uses 21 of the 28 base letters (computed), which keeps the bridge small.
- **Indonesian speakers have a head start.** Indonesian puts the noun first, both before an adjective and before a possessor (WALS 87A and 86A). Arabic na't and idafah work the same way ("nama Allah" = bismi-llāh), so these can be taught as "same as our language".
- **What the learning science says.**
  - Retrieval practice with feedback (Rowland 2014: g=0.73 with feedback vs 0.39 without).
  - Scheduling with FSRS (MIT-licensed libraries in Python and TypeScript).
  - Teach new vocabulary in blocks, but mix case categories together, because mixing only helps when categories are easy to confuse (Brunmair & Richter 2019: g=0.42 overall, −0.39 for word lists).
  - Worked examples that fade step by step; mastery gates (+0.57 SD on course tests); short narrated lessons (Mayer).
- **Exercise catalog: 31 mechanics.** Only one, a spoken "teach-back" explanation, needs AI in the first release.
  - It costs well under USD 0.01 per submission: one minute of audio is about 1,920 tokens at USD 0.30 per 1M on Gemini Flash-Lite.
  - Recitation feedback should come from a human tahsin teacher (the planned Kelas platform). A 2025 review judges automatic tajwid scoring unreliable.
- **Adab-aware game design.**
  - Avoid: lives/hearts, global leaderboards (Muslim 1905), paid random rewards (maysir/gharar), destructive animations on ayah text (Mufti WP Irsyad 768), and titles like "hafiz" or "ijazah".
  - Use instead: a weekly consistency goal with built-in grace (Bukhari 6464–6465), group goals that are cooperative rather than ranked, and encouragement drawn from "the one who struggles gets two rewards" (Bukhari 4937 / Muslim 798).
- **Al-Fatihah plan.** 9 units, about 19 micro-lessons plus 2 checkpoints plus a final exam, roughly 3–4 weeks at 10 minutes a day.
  - The three case endings arrive in order: kasrah at 1:1, dammah at 1:2, fathah at 1:6.
  - Verb patterns build up: fā'il at 1:4, Form X at 1:5 (reused at 1:6), then Form IV and maf'ūl at 1:7.
  - Suggested next surahs: Al-Ikhlas, An-Nas, Al-Falaq, Al-'Asr, Al-Kawthar, An-Nasr.
- **Regulatory risk.** PMA 44/2016 Pasal 1(1) defines a mushaf as including parts of surahs "baik cetak maupun digital", and Pasal 2 requires an LPMQ Surat Tanda Tashih. The module very likely falls in scope; this needs a legal check.
- **Data problem in the repo.** `api/data/quran.json` glues the basmalah onto ayah 1 of 112 surahs. Counts built on it come out inflated, and word-by-word tagging of ayah 1 would be wrong. The module needs a clean, pinned Hafs text.

## RECOMMENDATIONS
- **Two entry tracks.**
  - "Sudah bisa baca" goes straight to the 9-unit Al-Fatihah sequence.
  - "Jembatan baca" first teaches the 21 letters Al-Fatihah uses, using the word audio, before Unit 1. Write our own content in an Iqro-style order; do not reproduce Iqro, Ummi or Tilawati.
- **Author lessons offline and freeze them.**
  - Claude composes each lesson in chat from retrieved sources: QAC or a named i'rab kitab, Ibn Kathir / al-Tabari, and Bukhari / Muslim from the existing corpus.
  - An ustadz reviews: a mutqin for tajwid and a nahwu teacher for grammar.
  - Ship the result as static JSON. At runtime the only LLM use is the teach-back check. This keeps running costs near zero and follows [NEVER SKIP THE REVIEW].
- **Model learner knowledge as 166 small items:** 29 words × {meaning, root, wazn, case + reason, recognising the audio} plus 7 ayat × {word order, recitation, tafsir}. Schedule them with ts-fsrs or py-fsrs (MIT). Block new vocabulary; mix the case categories.
- **Phase the exercises.**
  - v1: mechanics 1–15, 17, 19, 21, 23–31 (no AI, no audio from a second riwayah).
  - v1.5: #16 Dua Bacaan (once the second-riwayah audio is licensed), #18 Peta Makhraj (once the illustrations exist), #20 Setor ke Ustadz (via Kelas), #22 Ajarkan Kembali (label it "AI-assisted, bukan fatwa otoritatif").
  - v2: pilot speech recognition for memorization only (word skipped/wrong), never a tajwid score.
- **Game-design spec.**
  - No hearts, lives, gems, currency or global leaderboard.
  - A weekly istiqamah goal with automatic grace, a neutral "jeda" pause, a private mastery map, shared family/halaqah goals, and a teach-others mode.
  - Badge names must carry no religious-status titles; certificate wording is "menyelesaikan modul".
- **Rules for handling Qur'an text in exercises.**
  - Tiles slide gently into place; no destructive animations.
  - Silence instead of sound effects over recitation.
  - After every assembly exercise, show and play the correct ayah in mushaf typography.
  - A wrong arrangement is never shown in mushaf styling.
  - TTS never voices Qur'anic Arabic; splice in the human reciter's word clips instead.
- **One visual language across all units.**
  - Case shown by colour plus shape: raf' / nasb / jarr / mabni, readable for colour-blind learners.
  - Root letters highlighted.
  - Wazn shown as a slot overlay.
  - A consistent gesture animation for raf' (raise), nasb and jarr.
  - Lean on the shared head-first order of Indonesian and Arabic (WALS) when teaching idafah and na't.
- **Narration.**
  - Indonesian narration in 60–90 s clips, using the house ElevenLabs settings and the Python preprocessor.
  - Captions optional (Mayer's redundancy principle) but available for accessibility.
  - Have an ustadz review how the narration pronounces Arabic grammar terms.
- **Encyclopedia cards.**
  - Compute every count from a pinned clean Hafs text plus QAC, with the counting rule printed on the card ("menurut QAC", "tidak menghitung basmalah awal surah").
  - No numerology.
  - Check hadith grading before using any name or merit narration (e.g., the ash-Shifa' narration via Darimi).
- **Editorial policy for 1:7 (rahma).** Lead with Ibn Kathir's description by trait — people who know the truth and turn from it, and people who lost true knowledge — as something to watch for in oneself. Mention the hadith identification accurately, with its source, and never as polemic.
- **Next surahs:** Al-Ikhlas, then An-Nas, Al-Falaq, Al-'Asr, Al-Kawthar, An-Nasr. Use An-Nas as the transfer test for idafah and na't learned in Al-Fatihah.
- **Link to the Kelas plan** (`docs/kelas-plan.md`): Setor ke Ustadz is where the learning module hands over to paid tahsin cohorts, keeping the module's own costs separate.
- **Usage modes alongside the core app:**
  - Parent–child co-op.
  - Majelis taklim projector mode with team quizzes and no ranks.
  - Khatib/da'i teaching kit linked to the Khutbah & Kultum library.
  - Creator word cards (Arabic copied verbatim from source, citation included).

## RISKS
- **LPMQ tashih (legal).** PMA 44/2016 Pasal 1(1) counts partial ayat in digital form as a "mushaf", and Pasal 2 requires a Surat Tanda Tashih. Decide whether to apply before public launch: the service page, as summarised, gives Rp1,000,000 base + Rp500,000 per extra feature and 15 working days for digital. Note Pasal 16(5): a change in content or design restarts the tashih process, and Pasal 16(4): the letter is valid for 2 years. Get an Indonesian legal opinion.
- **Text licensing.** Pasal 8: the Qur'an text has no copyright, but the script, tajwid/qira'at marks and ornaments belong to the publisher. Font and script choice (Mushaf Standar Indonesia vs Madani/KFGQPC) has both licensing and familiarity effects for Indonesian readers. This belongs to the data track.
- **QAC licence.** GPL v3 plus "verbatim copies only, changing it is not allowed" and an attribution link. Simplifying i'rab labels into Indonesian may count as "changing". Decide whether to use QAC only as reference and author our own i'rab from a classical kitab (al-'Ukbari), with ustadz review.
- **Ibn Kathir English text.** The repo's English Ibn Kathir appears to be an abridged commercial translation (UNVERIFIED). Public display in a learning module may need permission. A safer route is to show the Arabic original (public domain) plus our own reviewed Indonesian rendering.
- **Weak narrations in retrieved tafsir.** Ibn Kathir 1:1 includes a weak narration (Jesus explaining the letters of bismillah). A grading/editorial filter is needed before anything retrieved is shown to learners.
- **Repo data defects.**
  - `quran.json` glues the basmalah onto ayah 1 of 112 surahs, so counts and word segmentation built on it will be wrong.
  - `muslim.json` IDs are not canonical (repo 878 = Muslim 395; 1862 = 798; 4923 = 1905).
  - Fix or replace both before building lessons.
- **Exercises that alter or rearrange ayat** (Perbaiki Harakat, Susun Ayat, Rumpang Audio). Get a ruling from an ustadz / Dewan Syariah on whether these are acceptable as "latihan", and under which presentation constraints.
- **Fiqh-sensitive design.** The neutral pause for women in haid (views on recitation differ), background music, and visuals in story cards need an advisor's decision, not an engineering one.
- **Recitation feedback.** Automatic tajwid scoring is not reliable (arXiv 2510.12858). Any "skor bacaan" risks miseducating learners. Human review through Kelas costs honorarium per review, which needs pricing and capacity planning.
- **Voice data and UU PDP.** Recordings for Rekam & Bandingkan, Setor ke Ustadz and Ajarkan Kembali are personal data. Sending them to Gemini or OpenAI is a cross-border transfer. Needed: consent, retention limits, storage in Indonesia, and a parental-consent flow for parent–child mode.
- **Budget line.**
  - The pedagogy design keeps runtime LLM cost tiny (teach-back is under USD 0.01 per submission).
  - Costs that are real and must be estimated by the cost track: one-time ElevenLabs narration rendering, licensing audio from a second riwayah, makhraj illustrations, ustadz review hours, and tashih fees.
  - This should be a separate learning-module budget line, not charged to the IDR 1.5–2M platform cap.
- **Audio licensing.** Word-level timestamped audio (QUL) and second-riwayah audio have per-resource licences that I did not verify. This is a blocker for exercises 1, 2, 3, 5, 15, 16 and 17.
- **UNVERIFIED items:**
  - Exact canonical numbers for Muslim 798 and 1905 (sunnah.com returned 403; numbers come from search results).
  - The Mufti WP loot-box Irsyad #626 (seen only via a secondary source).
  - KBBI labels for loanwords beyond "rahmat".
  - Mayer's principles (cited from a secondary summary).
  - Phrase counts computed from the defective `quran.json`; re-run them on a clean text.
- **Open product decisions:**
  - Whether the module's default language is Indonesian only or also English.
  - Whether certificates are issued at all.
  - Whether learners log in with the existing NextAuth account (shared identity with Kelas) or use a separate module account.

## REPORT
## 1. Scope and method
This covers the pedagogy track only. Web claims were checked on 2026-10-09. Islamic references were checked against the repo's own retrieval corpus (`api/data/tafsir-ibn-kathir.json`, `bukhari.json`, `muslim.json`, `quran.json`) because sunnah.com returned HTTP 403. The repo's Muslim IDs are not the canonical sunnah.com numbers, so both are given. Anything I could not confirm is marked UNVERIFIED.

## 2. Existing products and what Indonesian learners lack
| Product | What works | What it lacks for us |
|---|---|---|
| Quran.com Learning Plans | Free bite-sized daily plans with a progress tracker; two Al-Fatihah plans (one is 7 days) | Reflection only; no grammar; no quizzes found |
| Quranic (getquranic.com) | "80% of words through Stories of Prophets"; word-strength shown in the reader; family plan | Lives system (free users wait); leaderboards; English |
| Quranle | 3–5 min lessons starting from Al-Fatihah; phrase arrangement; tap-along to recitation; transliteration fades out | Streaks, gems, lives, leaderboards; USD 9.99/month; vocabulary, not i'rab |
| Kalaam | Spaced repetition and translation challenges | Competitive; English |
| Tarteel | Flags wrong, skipped and mis-voweled words; hidden-verse mode; mistake history | Detection is paywalled (USD 14.99/month to USD 99/year); no meaning or grammar |
| Bayyinah Dream | 9 months; claims 80%+ vocabulary, 90%+ constructions, 95%+ morphological forms | Heavy, live, English |
| Understand Quran Academy | Starts from words said in salah: 125 words ≈ 40,000 occurrences ≈ 52% of the text; teaches grammar with gestures | English; grammar is light |
| Greentech Al Quran | Indonesian word-by-word; root, lemma and verb form; free and ad-free | A reference tool: no curriculum, no assessment |
| BISA (Yayasan BISA) | Nahwu-sharaf in Indonesian via books, video and quizzes | General grammar, not anchored to ayat |

Indonesian methods already in use, worth borrowing from:
- **Ummi / Tilawati / Iqro** (reading): direct method plus repetition.
- **Tamyiz**: sorting words into isim / fi'il / huruf, sung, aimed at fast translation.
- **Amtsilati**: practical nahwu distilled from the Alfiyah.
- **Al-Amtsilah at-Tashrifiyyah**: the standard pesantren sharaf tables. Familiar to santri, so a wazn-builder exercise will feel natural to them.

Indonesian learner context:
- Kemenag 2023: 61.51% recognise letters and harakat; 48.96% read ayat fluently; 44.57% read with tajwid; 38.49% lack reading literacy; about 55% can write the letters.
- Pronunciation studies: the most common errors are on ض, ظ, غ, ع and ح (ض at 100% in one tahfidz sample). One of the studies is specifically about reciting Al-Fatihah.
- Indonesian is Noun–Adjective and Noun–Genitive (WALS), so it has the same head-first order as Arabic na't and idafah.

## 3. Learning science and the design rule each one implies
| Evidence | Design rule |
|---|---|
| Retrieval practice: Rowland 2014, 61 studies, g=0.50 overall; 0.73 with feedback vs 0.39 without | Every item gives feedback that names the rule, not just right/wrong |
| Dunlosky 2013: practice testing and spaced practice rated high utility; rereading and highlighting low | No "read the tafsir again" loops; test instead |
| Spacing: Cepeda 2006 (839 assessments) — the best gap between reviews grows with how long you need to remember | FSRS scheduler (py-fsrs and ts-fsrs, MIT; default target retention 0.9). srs-benchmark, ~10k users / ~727M reviews: FSRS-6 log-loss 0.346, FSRS-7 0.337 |
| Interleaving: Brunmair & Richter 2019 — g=0.42 overall; bigger when categories are easy to confuse; blocking wins for word lists (g=−0.39) | Teach new vocabulary in blocks; mix raf' / nasb / jarr / mabni and look-alike wazn |
| Worked examples and the expertise-reversal effect (Kalyuga; Renkl & Atkinson): gradual fading beats an abrupt switch; adaptive fading is best | Each grammar point: full worked i'rab → one step blanked → learner does it all |
| Mastery learning: Kulik et al. 1990, 108 studies — +0.57 SD on local tests, +0.29 on standardised; weaker students gain more | Unlock the next unit at ≥80%, with a remediation loop |
| Mayer's multimedia principles (from a secondary source): modality, redundancy, segmenting, signaling, coherence | Narration over visuals; captions optional; one concept per 60–90 s clip; case shown by colour and shape |
| Pretesting / errorful generation (Pan & Sana 2021) | "Tebak dulu" (guess first) before the meaning is revealed, always followed by the correction |
| Gamification: Sailer & Homner 2020 — g=0.49 cognitive, 0.36 motivational, 0.25 behavioral; which game element helps is inconclusive. Mogavi et al. 2022 — misuse driven by competitiveness, playfulness, herding, dark nudges | Keep the game layer thin; learning comes first |

## 4. Exercise catalog
Codes for what each exercise trains: M meaning, R root, W wazn, I i'rab case, H harakat reason, L listening, T tajwid/recitation, Z memorization, F tafsir/tadabbur, X cross-reference.

Codes for what each exercise needs: SEG = per-word timestamps for a reciter's audio (e.g., QUL segmented audio); REC = microphone recording.

| # | Mechanic | How it works | Trains | Needs | Cost |
|---|---|---|---|---|---|
|1|Dengar & Ketuk|Hear the imam say a word; tap it in the ayah|L,Z|SEG|low|
|2|Ikuti Imam|Word highlighting as the ayah plays; slow down to 0.75×; loop a word|L,T|SEG|low|
|3|Susun Ayat|Put Arabic word tiles in order with the audio, later from memory|Z,L|SEG|low|
|4|Susun Makna|Assemble the Indonesian meaning under the Arabic|M|–|low|
|5|Pasangkan Makna+Suara|Match an audio clip to its meaning|M,L|SEG|low|
|6|Tebak Dulu / Jembatan Serapan|Guess from Indonesian loanwords (rahmat is labelled Ar in KBBI; nikmat, hidayah, ibadah, alam, istikamah need checking)|M,R|–|low|
|7|Detektif Akar|Highlight words that share a root, then jump to the concordance|R,X|QAC|low|
|8|Pabrik Wazan|Drop root letters into fā'il / maf'ūl / fa'lān / fa'īl / istaf'ala / af'ala; words built this way are labelled "kata Arab", not ayat|W|–|low|
|9|Kenapa Harakat Ini?|Choose why a word ends the way it does (after a preposition / topic of the sentence / object / describes the word before / never changes)|H,I|–|low|
|10|Sortir Akhiran|Sort words into raf' / nasb / jarr / mabni bins; ṣirāṭ occurs 45× in all three cases|I|QAC|low|
|11|Perbaiki Harakat|Fix one wrong vowel and give the reason (an'amta "Engkau" vs an'amtu "aku")|H|–|low; needs adab review|
|12|Label Peran|Tag each word's role (mubtada', khabar, maf'ūl, muḍāf ilayh, na't, badal)|I|–|low|
|13|Kereta Idafah|Build the mālik → yawm → dīn chain and watch the kasrah carry through|I|–|low|
|14|Ganjil Sendiri|Odd one out by root, pattern or case|R,W,I|–|low|
|15|Rumpang Audio|The ayah plays with a silent gap (no sound effect); pick the missing word|L,Z|SEG|low|
|16|Dua Bacaan|Hear mālik and malik — both valid; spot the difference and the nuance in meaning|L,F|audio from another riwayah|medium (licensing)|
|17|Hitung Mad|Tap along to the 2 / 4–5 / 6 counts of a long vowel (mad)|T|SEG|low|
|18|Peta Makhraj|Animated cross-section of the mouth and throat; sound pairs ح/ه, ع/ء, ض/د, ص/س|T|illustrations + a human teacher's audio|medium|
|19|Rekam & Bandingkan|Record yourself, compare A/B with the imam, rate yourself on a rubric|T|REC|low (storage, data protection)|
|20|Setor ke Ustadz|Send a recording to a tahsin teacher on Kelas|T|REC + human|honorarium per review|
|21|Tangga Murajaah|Text hides step by step: full → first letters → blank|Z|– (speech recognition in v2)|low|
|22|Ajarkan Kembali|30–60 s spoken explanation in Indonesian, checked against a rubric built from the retrieved lesson|F,H|speech-to-text + LLM|<USD 0.01 per submission|
|23|Dialog Qasamtu|Match each ayah to Allah's reply in Muslim 395|F|–|low|
|24|Peta Struktur|Sort ayat into praise (1–4) / covenant (5) / request (6–7)|F|–|low|
|25|Skenario Hidup|A daily-life scenario → which word or ayah speaks to it|F|–|low|
|26|Jejak Kata|Follow nasta'īn to 2:45, 2:153 and 7:128|X,F|QAC|low|
|27|Tahukah Kamu?|An encyclopedia card plus one question|X|QAC/QUL|low|
|28|Tulis Huruf|Trace key words by hand|reading/writing|canvas|low–medium|
|29|Review Harian|Mixed FSRS review queue|all|ts-fsrs|low|
|30|Ujian Al-Fatihah + Peta Penguasaan|Final exam, plus a map of 29 words × skills|all|–|low|
|31|Halaqah Bersama|Shared family or halaqah goal, no individual ranks|motivation|–|low|

Speech recognition — what exists:
- `tarteel-ai/whisper-base-ar-quran` (Apache-2.0) reports WER 5.75, but its training data is not documented.
- Tarteel says its own model reaches 4% WER, but I found no public API (QUL's FAQ says it has no API).
- Quran Muaalem (arXiv 2509.00094): 848 hours of audio, phoneme error 0.21%, tajweed F1 75.8%. The licence for its model and data is UNVERIFIED.
- A 2025 review (arXiv 2510.12858) argues that automatic recitation assessment rewards recognising words rather than judging sound quality, and is unreliable.

Conclusion: no automatic tajwid scoring in v1.

## 5. Adab-aware game design
**Avoid:**
- Lives/hearts and waiting timers on Qur'an practice. They punish struggle, while the hadith gives the struggling reciter two rewards (Bukhari 4937; Muslim 798, repo id 1862).
- Global or public leaderboards for recitation or memorization. Muslim 1905 (repo id 4923) warns of the man who "recited so it would be said he is a qari'"; Mogavi et al. document herding and competitiveness.
- Gems you can buy, gacha, spin-the-wheel, paid random rewards. Fatwas classify these as maysir/gharar (Islamweb fatwa 379243).
- Destructive or flippant animations on ayah text: exploding tiles, ayat "thrown away", confetti made of ayah words, buzzers played over recitation. Mufti WP Irsyad Hukum 768 forbids writing ayat on toys on sadd adh-dhari'ah grounds (blocking the means to disrespect), citing al-Nawawi's al-Tibyan.
- Never show a wrong arrangement in mushaf typography; never have TTS voice an ayah.
- No badges carrying religious status ("hafiz", "qari'", "ustadz", "ijazah/sanad").
- No numerology in the trivia.
- No pictures of prophets or companions — use calligraphy, maps, or abstract art.
- Music under Qur'an audio: avoid by default; operator to decide.

**Use instead:**
- A weekly *istiqamah* goal (e.g., 4 of 7 days) with automatic grace. Bukhari 6464–6465: the deeds Allah loves most are the regular ones, even if small, and "take on only what you can".
- A neutral "jeda" (pause) that never asks why. This covers illness, travel and haid; views on reciting during haid differ, so this needs an advisor.
- A private mastery map, shared halaqah/family goals, and a teach-others mode (Bukhari 5027).
- A reminder of niyyah (intention) at the start (Bukhari 1).
- Certificates worded "telah menyelesaikan modul" (has completed the module).

## 6. Al-Fatihah lesson sequence
Micro-lessons run 6–8 minutes each, followed by 3–5 minutes of FSRS review. Grammar points are a draft: each must be sourced per word from a named i'rab kitab before publishing.

| Unit (ayah) | Lessons | New grammar / morphology | Tajwid micro-lesson | Tafsir / intermezzo (source) |
|---|---|---|---|---|
|0 Orientation|2|Isim / fi'il / huruf (the Tamyiz starting point)|Listening only|Names of Al-Fatihah (Ibn Kathir 1:1); 7 ayat agreed, basmalah counted by the Kufans but not the Madinans (Ibn Kathir 1:1); reading bridge|
|1 (1:1)|2|bi → majrūr, **kasrah**; idafah ismi-llāhi; na't follows its noun|Alif lam shamsiyyah; the lam in "Allah" is light after a kasrah (tarqīq)|27:30 Sulaiman's letter (quran.com); scholars agree the basmalah is part of an ayah in An-Naml (Ibn Kathir 1:1); root r-ḥ-m occurs 339× (QAC)|
|2 (1:2)|2|Mubtada' marfū', **dammah**; a nominal sentence needs no "is"; khabar as a prepositional phrase; -īna plural (case shown by letters, not vowels)|Alif lam qamariyyah; ح vs ه|The full phrase appears in 6 verses; ḥ-m-d occurs 63× (QAC); "My servant has praised Me" (Muslim 395)|
|3 (1:3)|1 + checkpoint 1|Mixed review; fa'lān vs fa'īl|–|Raḥmān and Raḥīm both derive from raḥmah, Raḥmān with the broader meaning (Ibn Kathir 1:1)|
|4 (1:4)|2|Ism fā'il (wazn fā'il); a three-noun idafah chain|Natural mad (ṭabī'ī); mad 'āriḍ when stopping|Mālik and malik are both mutawātir (Ibn Kathir 1:4); yawm ad-dīn occurs 13×|
|5 (1:5)|2|Present-tense verb marfū' (dammah on verbs); prefix nūn = "kami"; iyyāka fronted to mean "only You" (mabnī); Form X = seeking|Shaddah; ع vs ء|Iltifat — the switch from "He" to "You" (Ibn Kathir 1:5); nasta'īn also at 2:45, 2:153, 7:128 (QAC)|
|6 (1:6)|2 + checkpoint 2|Command used as du'a, ending dropped; -nā as object; object manṣūb, **fathah**; the describing word follows in nasb; mustaqīm (Form X, reused)|ص vs س|ṣirāṭ also read with sīn and zāy (Ibn Kathir 1:6); ṣirāṭ occurs 45× → full case sort; praise comes before asking (Ibn Kathir 1:6)|
|7 (1:7)|3|Badal ("according to the grammarians", Ibn Kathir 1:7); alladhīna (mabnī); Form IV an'amta; maf'ūl (maghḍūb) vs fā'il (ḍāllīn); ghayri majrūr|Iẓhār ḥalqī (an'amta); iẓhār syafawī; mad lāzim, 6 counts (aḍ-ḍāllīn); makhraj ض|Āmīn is sunnah, not part of the surah (Bukhari 780, 4475; Ibn Kathir 1:7)|
|8 Synthesis|2|–|Pausing at the end of each ayah (Umm Salamah, cited by Ibn Kathir 1:1)|Fatihah is required in every prayer (Bukhari 756); khushu' practice|
|9 Exam|1|–|–|–|

**Formative assessment:**
- A 3–5 item exit ticket per lesson, with a confidence tap.
- The daily FSRS queue.
- Checkpoints that require ≥80%, with unlimited retries and no penalty.

**Summative assessment — "Ujian Al-Fatihah"** (about 20 minutes, all parts mixed together):
- (A) Listening: tap the word, name the ayah from audio, fill the audio gap.
- (B) Meaning: assemble and match.
- (C) Language: sort all 29 words by case, explain the reason, find roots, build wazn.
- (D) Tadabbur: the Muslim 395 dialogue, a life scenario, a 60-second teach-back.
- Optional (E): a recitation recording reviewed by an ustadz.
- Pass mark is ≥80% per part. A delayed re-test follows at about +30 days.

## 7. Encyclopedia / intermezzo
**Verified facts:**
- Al-Fatihah is "25 words, 113 letters" (Ibn Kathir 1:1, quoting "they said"). It is 29 space-separated words including the basmalah (computed).
- The letters ث ج خ ز ش ظ ف do not appear in it (computed). Show the count only, without the popular interpretations attached to it.
- Root counts (QAC): ع ب د 275; ه د ي 316; ص ر ط 45; ع و ن 11.
- Names of Al-Fatihah (Ibn Kathir 1:1): Umm al-Kitāb, Umm al-Qur'ān, as-Sab' al-Mathānī, al-Qur'ān al-'Aẓīm, al-Ḥamd, aṣ-Ṣalāh, ash-Shifā', ar-Ruqyah, Asās al-Qur'ān, al-Wāqiyah, al-Kāfiyah, al-Kanz. Check the hadith grading for each name before showing it.
- Hadith: greatest surah (Bukhari 4474, 5006); ruqyah story (Bukhari 2276, 5007, 5736).

**Counting rules:**
- State the unit being counted (root, lemma, exact phrase, or verse), the text edition, and how the basmalah is handled.
- QAC's 63 for ḥ-m-d does not list Muḥammad or Aḥmad among its forms, so say "menurut QAC" (according to QAC).

## 8. Which surah next
| Order | Surah | Why | New material, linked back to Al-Fatihah |
|---|---|---|---|
|1|Al-Ikhlas|Worth a third of the Qur'an (Bukhari 5013, 5015); recited at bedtime (5017)|Jussive with sukun (lam yalid) — a fourth ending state; kāna; "Allāh" pronounced heavy after a dammah, contrasting with Al-Fatihah's light lam|
|2|An-Nas|Bedtime trio (5017)|rabb / malik / ilāh an-nās mirror rabb al-'ālamīn / mālik — tests whether idafah transfers|
|3|Al-Falaq|Bedtime trio|mā as a relative pronoun; idhā; ism fā'il reused|
|4|Al-'Aṣr|3 ayat|Oath with wāw; inna + manṣūb; illā; alladhīna reused|
|5|Al-Kawthar|Shortest surah|inna-nā; command after fa|
|6|An-Nasr|Short|Conditional idhā with its answer|

## 9. More lesson ideas
- **Balaghah moments:** iltifat; fronting iyyāka; "praise, then ask" as the adab of du'a.
- **Fatihah as a dialogue:** a visual of Muslim 395.
- **Story card:** "Kisah Surat Sulaiman" (27:28–31), told third-person and without depicting the prophet.
- **"Kenapa terjemahan berbeda?"** — why translations differ.
- **Fatihah dengan makna** — slow-recitation mode with the meaning overlaid.
- **Parent–child co-op:**
  - Parent prompts.
  - Printable worksheet.
- **Khatib/da'i teaching kit:** link to the Khutbah & Kultum library (#76).
- **Majelis taklim projector mode:** team quiz without ranks.
- **Creator word card:** Arabic copied verbatim from the source, with its citation.

## 10. Repo observations
- `quran.json` glues the basmalah onto ayah 1 of every surah except 1 and 9 (e.g., 2:1 and 112:1). A naive search for "ar-raḥmān ar-raḥīm" returns 118 verses.
- `muslim.json` IDs differ from sunnah.com: repo 878 = Muslim 395; 1862 = 798; 4923 = 1905.
- The English Ibn Kathir text is an abridged translation of unknown provenance.
- Ibn Kathir 1:1 contains a weak narration (Jesus explaining the letters of bismillah). Retrieved tafsir therefore needs a grading filter before display.

## SOURCES
- Quran.com - Introducing Learning Plans | https://quran.com/en/product-updates/introducing-learning-plans | Proprietary website; reference only | Benchmark: bite-sized daily plans, progress tracker (no quizzes found)
- Quran.com Learning Plans list | https://quran.com/learning-plans | Proprietary; reference only | Benchmark: two Al-Fatihah plans incl. 7-day
- Quranic app | https://www.getquranic.com/ | Proprietary; reference only | Benchmark: 80% words via prophet stories, lives system, leaderboards
- Quranle: Quranic Arabic Game (App Store) | https://apps.apple.com/us/app/quranle-quranic-arabic-game/id1669973704 | Proprietary; reference only | Benchmark: Fatihah-first 3-5 min lessons, tap-along, lives/leaderboards, USD 9.99/mo
- Kalaam - Learn Quranic Arabic (Google Play) | https://play.google.com/store/apps/details?id=com.areebb.Kalaam&hl=en_US | Proprietary; reference only | Benchmark: SRS + competition
- Tarteel: AI Quran Memorization (App Store) | https://apps.apple.com/us/app/tarteel-ai-quran-memorization/id1391009396 | Proprietary; reference only | Benchmark: word-level mistake detection, paywall pricing
- Bayyinah Dream curriculum | https://dream.bayyinah.com/curriculum-3/ | Proprietary; reference only (claims via search snippet) | Benchmark: 9-month program coverage claims
- Understand Quran Academy - How we got started | https://understandquran.com/got-started-birth-understand-quran-academy/ | Copyrighted course materials; inspiration only, do not reproduce | Salah-words-first method; 125 words ~52% claim; TPI gestures
- Greentech Al Quran (Tafsir & By Word) | https://gtaf.org/apps/quran/ | Proprietary app; reference only | Benchmark: Indonesian WBW, root/lemma, free
- Quran Progress | https://www.quranprogress.com/en/ | Proprietary; reference only | Benchmark: 125-word focus, 1-3-7 SRS
- BISA - Aplikasi Android Resmi | https://www.bisa.id/aplikasi-android-resmi-bisa/ | Proprietary; reference only | Indonesian incumbent for nahwu-sharaf
- Metode Tamyiz (Neliti PDF) | https://media.neliti.com/media/publications/103789-ID-metode-tamyiz-sebuah-formulasi-teori-nah.pdf | Academic article; cite only | Indonesian method: isim/fi'il/huruf, songs, fast translation
- Taufiqul Hakim 'Amtsilati' dan Pengajaran Nahwu-sharaf | https://www.researchgate.net/publication/325317183_Taufiqul_Hakim_Amtsilati_dan_Pengajaran_Nahwu-sharaf | Academic article; cite only | Indonesian pesantren nahwu method
- NU Jabar - Mengenal Kitab al-Amtsilah at-Tashrifiyah | https://jabar.nu.or.id/ubudiyah/mengenal-kitab-al-amtsilah-at-tashrifiyah-belajar-dasar-dasar-ilmu-sharaf-Ihzim | News article; cite only | Pesantren sharaf standard (wazn-builder familiarity)
- Detik - Metode Iqra, Tilawati, Ummi | https://www.detik.com/hikmah/khazanah/d-7567175/mengenal-metode-iqra-tilawati-dan-ummi-dalam-mengaji-di-natieva | News; cite only; methods are trademarked/certified programs - do not reproduce | Indonesian reading-method context
- Antara - Kemampuan baca tulis Al Quran 2023 (Kemenag survey) | https://www.antaranews.com/berita/3768246/kemampuan-baca-tulis-al-quran-masyarakat-indonesia-tinggi-pada-2023 | News; cite only | Learner literacy stats (38.49% lack reading literacy etc.)
- Articulatory Errors in Qur'anic Recitation among Indonesian Tahfizh Students | https://al-adabiyah.uinkhas.ac.id/index.php/adabiyah/article/view/1444 | OJS journal; cite only | Makhraj error rates (dad 100%)
- Phonetic Analysis of Makharij Errors in Al-Fatihah (SMPIT Nurul Yaqien) | https://doi.org/10.30997/tjpba.v6i2.20429 | Journal; cite only | Fatihah-specific pronunciation errors
- WALS 87A / 86A Indonesian datapoints | https://wals.info/datapoint/87A/wals_code_ind | WALS Online CC BY 4.0 | Indonesian Noun-Adjective and Noun-Genitive order (idafah/na't bridge)
- Rowland 2014 testing-effect meta-analysis | https://www.semanticscholar.org/paper/The-effect-of-testing-versus-restudy-on-retention:-Rowland/5d4dd1c73554ff1c5c493c2795aadd5aa8bfda17 | Journal article; cite only | g=0.50; feedback 0.73 vs 0.39
- Dunlosky et al. 2013 Improving Students' Learning | https://www.whz.de/fileadmin/lehre/hochschuldidaktik/docs/dunloskiimprovingstudentlearning.pdf | Journal article; cite only | High-utility techniques
- Cepeda et al. 2006 Distributed practice | https://www.yorku.ca/ncepeda/publications/CPVWR2006.html | Journal article; cite only | Spacing evidence
- Brunmair & Richter 2019 interleaving meta-analysis | https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf | Preprint; cite only | g=0.42; blocking better for words (-0.39); similarity moderator
- Salden et al. - Expertise reversal effect and worked examples | http://www.cee.uma.pt/ron/Salden%20et%20al.%20-%20The%20Expertise%20Reversal%20Effect%20and%20Worked%20Examples.pdf | Paper; cite only | Fading worked examples; adaptive fading
- Kulik, Kulik & Bangert-Drowns 1990 mastery learning | https://www.uky.edu/~gmswan3/575/kulik_kulik_Bangert-Drowns_1990.pdf | Journal article; cite only | +0.57 SD local tests; mastery gating
- Mayer's 12 principles (secondary summary) | https://www.devlinpeck.com/content/mayers-principles-of-multimedia-learning | Secondary blog; primary = Mayer, Multimedia Learning (book) | Modality/redundancy/segmenting/signaling/coherence
- Pan & Sana 2021 pretesting vs posttesting | https://www.researchgate.net/publication/348155988_Pan_and_Sana_2021_Pretesting_vs_posttesting_Errorful_generation_prequestions_and_retrieval_practice | Journal article; cite only | Guess-first prompts
- Sailer & Homner 2020 The Gamification of Learning: a Meta-analysis | https://d-nb.info/1202307655/34 | Open-access article; cite only | Gamification effect sizes; element effects inconclusive
- Mogavi et al. 2022 When Gamification Spoils Your Learning (L@S) | https://arxiv.org/pdf/2203.16175 | arXiv preprint; cite only | Misuse taxonomy (competitiveness, herding, dark nudges)
- py-fsrs | https://github.com/open-spaced-repetition/py-fsrs | MIT | FSRS scheduler (Python), default retention 0.9
- ts-fsrs | https://github.com/open-spaced-repetition/ts-fsrs | MIT | FSRS scheduler (TypeScript/web)
- open-spaced-repetition srs-benchmark | https://github.com/open-spaced-repetition/srs-benchmark | Open repo; cite only | FSRS-6/7 log-loss on ~10k users/727M reviews
- Quranic Arabic Corpus - root dictionary & word-by-word | https://corpus.quran.com/qurandictionary.jsp?q=rHm | GNU GPL v3; data file terms: verbatim copies only, 'CHANGING IT IS NOT ALLOWED', must cite QAC and link corpus.quran.com | Root counts (r-h-m 339, h-m-d 63, '-b-d 275, h-d-y 316, s-r-t 45, '-w-n 11) and case tags
- Quranic Arabic Corpus download terms | https://corpus.quran.com/download/ | GPL + verbatim/attribution clause | Licence constraints for morphology/i'rab data
- Quranic Universal Library (QUL) + FAQ | https://qul.tarteel.ai/faq | Per-resource licences - must check each; UNVERIFIED individually | Segmented audio (word timestamps), mutashabihat, WBW; commercial use allowed per-resource
- tarteel-ai/whisper-base-ar-quran | https://huggingface.co/tarteel-ai/whisper-base-ar-quran | Apache-2.0 (training data undocumented) | Possible v2 memorization ASR
- Quran Muaalem paper (arXiv 2509.00094) | https://arxiv.org/abs/2509.00094 | Paper CC BY 4.0; model/dataset licence UNVERIFIED | Open phoneme/tajweed model state of art
- Critical review of Quranic recitation evaluation (arXiv 2510.12858) | https://arxiv.org/abs/2510.12858 | arXiv; cite only | Why no auto-tajwid scoring in v1
- Gemini API pricing | https://ai.google.dev/gemini-api/docs/pricing | Google API terms | Flash-Lite audio input USD 0.30/1M tokens
- Gemini audio understanding (32 tokens/s) | https://ai.google.dev/gemini-api/docs/audio | Google API terms | Teach-back cost estimate
- OpenAI API pricing | https://developers.openai.com/api/docs/pricing | OpenAI API terms | gpt-4o-mini-transcribe est. USD 0.003/min
- PMA No. 44 Tahun 2016 (Penerbitan, Pentashihan, Peredaran Mushaf) | https://tashih.kemenag.go.id/uploads/1/2018-05/pma_nomor_44_tahun_2016.pdf | Public regulation | Pasal 1(1) digital mushaf incl. parts of surah; Pasal 2 tashih required; Pasal 8 text not copyrighted but script/marks are publisher's
- LPMQ - Standar pelayanan Surat Tanda Tashih | https://tashih.kemenag.go.id/info-layanan-pentashihan/read/standar-pelayanan-permohonan-surat-tanda-tashih | Government service page | Digital tashih: 15 working days; Rp1,000,000 + Rp500,000 per extra feature (as summarised; confirm)
- Mufti WP Irsyad Hukum 768 - ayat Al-Quran atas alat permainan | https://www.muftiwp.gov.my/ms/artikel/irsyad-hukum/umum/5636-irsyad-al-fatwa-siri-ke-768-hukum-penulisan-ayat-al-quran-atas-alat-permainan | Official fatwa page; cite only | Adab: sadd al-dhari'ah against Qur'an text on play objects
- Islamweb fatwa 379243 - loot boxes | https://www.islamweb.net/en/fatwa/379243/playing-video-games-with-loot-boxes | Fatwa site; cite only | No paid random rewards (maysir)
- Quran.com 27:30 | https://quran.com/27/30 | Display text/translation licences per Quran.com; verify for reuse | Basmalah in Sulaiman's letter
- HadeethEnc - Muslim 395 (qasamtu as-salah) | https://hadeethenc.com/en/browse/hadith/65099 | Site terms UNVERIFIED; cite only, display from repo corpus | Canonical number for the Fatihah dialogue hadith (repo id 878)
- Sunnah.com Muslim 798a / 1905a | https://sunnah.com/muslim:1905a | Fetch returned 403; numbers via search result | Canonical numbers for two-rewards hadith (repo 1862) and riya' warning (repo 4923)
- Repo corpus - Tafsir Ibn Kathir (local) | file:///Users/mbairm3512/Documents/SuksesBerkah/dakwah-lens/api/data/tafsir-ibn-kathir.json | Arabic original public domain; EN abridged translation provenance/licence UNVERIFIED for public display | Names of Fatihah, 25 words/113 letters, basmalah counting, malik/maalik, iltifat, sirat variants, badal, Amin, Rahman vs Rahim, two groups in 1:7
- Repo corpus - Sahih al-Bukhari / Sahih Muslim / Quran (local) | file:///Users/mbairm3512/Documents/SuksesBerkah/dakwah-lens/api/data/bukhari.json | Per existing platform corpus terms | Bukhari 1, 756, 780, 2276, 4474, 4475, 4704, 4937, 5006, 5007, 5013, 5015, 5017, 5027, 5736, 6464, 6465; Muslim repo ids 878/1862/4923; phrase counts from quran.json
- at-Tibyan fi I'rab al-Qur'an (al-'Ukbari) - Shamela | https://shamela.ws/book/22928 | Classical text public domain; edited edition/digital terms UNVERIFIED | Candidate classical i'rab source per word
- Tuhfat al-Athfal (al-Jamzuri) - Internet Archive | https://archive.org/details/citamujahid88_gmail_201711 | Classical matn public domain; scan terms per uploader | Candidate tajwid rule source for micro-lessons
- Madinah Arabic course books (Dr V. Abdur Rahim) - Internet Archive | https://archive.org/details/ArabicLanguageCourseBooks | IA lists CC BY-NC-ND 2.5 CA (uploader-declared, not verified as publisher licence) - do not reproduce | Curricular sequencing reference only
- KBBI (unofficial mirror) - rahmat | https://kbbi.web.id/rahmat | Unofficial mirror; verify on official KBBI (official site unreachable during research) | Loanword bridge idea (rahmat labelled Ar)