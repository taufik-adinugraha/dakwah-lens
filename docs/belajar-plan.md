# Belajar Al-Qur'an (`/belajar`) — Product & Build Plan

- **Status:** Plan v0.1. Build starts with the foundation (M0–M1). Content publishing is gated by the decisions in §3 and by ustadz sign-off.
- **Date:** 2026-10-09
- **Owner:** Sukses & Berkah Group · Author: Taufik Adi
- **Scope:** a Qur'anic-Arabic + light-tafsir learning module, starting with Surah Al-Fatihah. It runs in its own container at `dakwah-lens.id/belajar` and is linked from the main site.
- **Evidence base:** six research tracks plus a critic, run 2026-10-09 (Qur'an data and licences, kitabs, pedagogy, audio, architecture, a verified Al-Fatihah inventory). Every claim below traces to those reports. Counts and i'rab come from data or kitab citations, not memory.

---

## 1. Executive summary

A learner opens Al-Fatihah and hears a real imam recite each ayah while the words light up. They then tap any word and see:
- the meaning;
- the root letters;
- the word pattern (wazn);
- **why it ends in fathah, dhammah or kasrah**, in one plain Indonesian sentence.

A short narrated clip explains it with matching visuals. They then practise:
- tapping words as the imam says them;
- sorting words into their case;
- building words from roots;
- matching each ayah to Allah's reply in the *qasamtu ash-shalah* hadith.

"Tahukah kamu" cards connect the surah to the rest of the Qur'an, for example the basmalah inside Sulaiman's letter (27:30) or *ṣirāṭ* appearing 45 times and never in the plural. Spaced review keeps it remembered, and a final *Ujian Al-Fatihah* checks it.

**Three things make it different from what exists today:**
- **Real sources.** Every word fact, i'rab reason, tafsir note and hadith is retrieved or cited from a named kitab or dataset and signed off by an ustadz. Nothing is invented.
- **Real recitation.** The Qur'an is only ever heard in a human imam's voice. The AI narrator speaks Indonesian explanation only.
- **Built for Indonesians.** It has an Indonesian-first explanation style and two entry tracks: "sudah bisa baca" (can already read) and "jembatan baca" (a reading bridge). The 2023 Kemenag survey found 38% of adults cannot read the Qur'an. Indonesian also shares Arabic's noun-first order, which makes *idafah* and *na't* easy to teach.

**Constraints the plan respects:**
- **PMA 44/2016 tashih.** Digital Qur'an material, including parts of a surah, needs an LPMQ *Surat Tanda Tashih* and the Mushaf Standar.
- **Recording rights.** No clear licence exists for famous reciters' recordings: stream them, don't re-host them.
- **Small VPS.** 2 vCPU, 1.9 GB RAM with about 630 MB free.
- **Cost cap.** The module gets its own budget line, outside the IDR 1.5–2M platform cap.
- **Reviewer time.** Ustadz review is the real critical path.

---

## 2. Locked decisions (operator, 2026-10-09)

| # | Decision | Choice |
|---|---|---|
| L1 | Placement | **Path `dakwah-lens.id/belajar/…`** (not a subdomain) |
| L2 | Isolation | **Own container** (own compose project), linked from the main site |
| L3 | Where builds run | **Never on the operator's laptop.** Build and test in CI (GitHub Actions) and run on the live VM. |
| L4 | First content | **Surah Al-Fatihah** |
| L5 | Narration engine | **ElevenLabs** using the house standard: `eleven_v3`, stability 0.5, style 0.35, similarity 0.75, speaker boost on, `apply_text_normalization: "off"`, with all normalisation done in Python |
| L6 | Recitation | **Real imam voice only.** Never TTS or voice-conversion for Qur'anic text. |

## 3. Decisions needed (recommended default in bold)

| # | Decision | Options | Recommended default |
|---|---|---|---|
| B1 | Free or paid | Free / freemium / bundled with Kelas | **Free, no ads in v1.** "Setor ke Ustadz" (send a recording to an ustadz) becomes the paid seam via Kelas later. |
| B2 | Legal path (PMA 44) | Ask LPMQ first / launch and see | **Ask first.** Send the LPMQ letter now: tashih ruling, Mushaf Standar text, Kemenag 2019 translation, Isep Misbah font. Run as a **closed, noindex beta** until LPMQ answers. Budget Rp0.5–3M and 1–3 months. |
| B3 | Qur'an text and script | Tanzil Uthmani (Madani) / Mushaf Standar Indonesia | **Tanzil verbatim for the beta**, with all data keyed `surah:ayah:word` so the rasm can be swapped. Switch to MSI if LPMQ requires it. |
| B4 | Recitation source | Stream / commission / both | **Both.** v1 streams Husary Mu'allim (+ Alafasy) with credit. In parallel, get a quote from an Indonesian qari with sanad (Hafs) for: Al-Fatihah, the 29 isolated words, and the ayah-final word forms, under a perpetual licence that allows cutting and offline use. |
| B5 | Narration voice | Designed non-identifiable AI voice / consented ustadz's own professional clone / existing workspace clones | **Designed voice labelled "Narasi: suara AI"**, unless an ustadz gives written consent covering scope, script approval, takedown and credit. Do not use the existing clones of public ustadz without consent. |
| B6 | Reviewer panel | — | **At least 2 named reviewers:** (a) nahwu-sharaf, (b) tajwid/qira'at with sanad. Plus a hadith check. Agree honorarium and turnaround before authoring. |
| B7 | Budget line | — | **A separate one-time pilot line, capped by the operator.** Every render or purchase shows its cost and waits for a go. See §9. |
| B8 | Exercises that touch ayah text | — | **Drop "Perbaiki Harakat" from v1** (non-Qur'anic examples only). "Susun Ayat" and "Rumpang Audio" ship only after an ustadz ruling, under the presentation rules in §4.7. |
| B9 | Wording of the retrieval rule | — | **Extend** to: "retrieved from Qdrant, or from a pinned, checksummed source snapshot, or a human-verified print citation (kitab/vol/page)". The i'rab kitabs are copyrighted and cannot be ingested into Qdrant. |
| B10 | Synthetic Qur'an, platform-wide | — | **Operator to confirm** what `qari-*-haidir-vc-norm.mp3` (used in earlier kultum renders) was. If it was a qari recording voice-converted to Haidir's voice, that is AI-altered Qur'an. Decide whether the no-synthetic-Qur'an rule applies platform-wide. |
| B11 | Non-Qur'an Arabic audio (hadith matn, grammar examples) | Human / TTS | **Human for v1** (the set is small). TTS speaks Indonesian only. |
| B12 | Language | ID only / ID + EN | **Indonesian only in v1.** English in v2, since it doubles review and narration work. |
| B13 | Children | Child accounts / parent-led | **No child accounts in v1.** Parent-led use goes through the parent's account (UU PDP Pasal 25). |
| B14 | Learner voice recordings or runtime AI | — | **None in v1.** No teach-back, no ASR, no server-side recordings. |

---

## 4. The learner experience

### 4.1 Anatomy of a word lesson
Each of the 29 words of Al-Fatihah gets a **word card**:

| Layer | Example (ٱلْحَمْدُ, 1:2:1) | Source |
|---|---|---|
| Arabic + recitation | The ayah streams in Husary Mu'allim and the word is highlighted. Tapping the word replays just that span (seek within the file; no cut file is created). | Tanzil text; quran-align timings |
| Meaning | "segala puji" (our reviewed gloss, anchored to the official translation) | In-house, reviewed |
| Root | ح م د, highlighted inside the word (QAC: 63 occurrences) | QAC 0.4 |
| Pattern | فَعْل (masdar) | Darwish / al-Jadwal, cited |
| Case badge | **marfū' — dhammah** (shown with colour + shape, readable for colour-blind learners) | Darwish 1/14; al-Jadwal |
| "Why" sentence | "Dibaca dhammah karena ia **mubtada'** — pokok kalimat." | Darwish; al-Jadwal (paraphrased and cited) |
| Pendapat lain | A collapsed chip for alternative readings, e.g. the scholars' views on the *al-* in al-ḥamd | ad-Durr al-Mashun |
| Narration | A 60–90 s Indonesian clip, with highlights synced to the screen | ElevenLabs, reviewed script |
| Tahukah kamu | "(Wa/fa) al-ḥamdu lillāh appears in 23 ayat, and 5 surahs open with it." | Tanzil query, method shown |

**Ayah layer:**
- one light tafsir note (Ibn Kathir AR / al-Tabari from the corpus, rendered into reviewed Indonesian);
- the official Indonesian translation, labelled exactly by its source;
- the ayah's place in the *qasamtu* dialogue (Muslim 395).

### 4.2 Al-Fatihah curriculum (9 units, ~19 micro-lessons + 2 checkpoints + final exam; ~3–4 weeks at 10 min/day)

| Unit | Ayah | New grammar | Tajwid micro-lesson | Intermezzo (source) |
|---|---|---|---|---|
| 0 | Orientation | Isim / fi'il / huruf (the Tamyiz entry point); reading bridge for "jembatan baca" learners (the 21 letters Al-Fatihah uses) | Listening | Names of Al-Fatihah (Bukhari 4704, Muslim 395, Ibn Kathir) |
| 1 | 1:1 | Huruf jar → majrūr, **kasrah**; idafah *ismi-llāh*; na't follows its noun ("sama seperti bahasa kita") | Alif-lam syamsiyyah; light lam in "Allāh" after a kasrah | Basmalah in Sulaiman's letter, 27:30; 114 basmalah in the mushaf |
| 2 | 1:2 | Mubtada' marfū', **dhammah**; a nominal sentence needs no "adalah"; the -īna plural | Alif-lam qamariyyah; ح vs ه | Muslim 395 "hamidanī 'abdī"; ح م د = 63× |
| 3 | 1:3 | Review; fa'lān vs fa'īl | — | Raḥmān 57×, Raḥīm 116×, root ر ح م 339× |
| ✓ | — | **Checkpoint 1** (≥80%, unlimited retries, no penalty) | | |
| 4 | 1:4 | Ism fā'il; a three-noun idafah chain (*kereta idafah*) | Natural mad; mad 'āriḍ at a stop | māliki / maliki both mutawātir (an-Nashr); yawm ad-dīn 13× |
| 5 | 1:5 | Present-tense verb marfū'; the prefix nūn = "kami"; fronted *iyyāka* = "hanya"; Form X = seeking | Shaddah; ع vs ء | *Iltifat* (from "Dia" to "Engkau"); *nasta'īn* also at 2:45, 2:153, 7:128 |
| 6 | 1:6 | Command used as du'a (the final yā' drops); object manṣūb, **fathah**; the describing word follows | ص vs س | ṣirāṭ 45×, never plural (6:153 "as-subul"); praise before asking |
| ✓ | — | **Checkpoint 2** | | |
| 7 | 1:7 | Badal; alladhīna (mabnī); Form IV *an'amta*; maf'ūl vs fā'il; ghayri | Iẓhār; mad lāzim (6 counts) on aḍ-ḍāllīn; makhraj ض | 4:69 names "those You favoured"; *Āmīn* is sunnah, not part of the surah (Bukhari 780) |
| 8 | Synthesis | — | Pausing at the end of each ayah | Al-Fatihah in every prayer (Bukhari 756); khushu' practice |
| 9 | **Ujian Al-Fatihah** | | | |

The three case endings arrive in a natural order: kasrah (1:1), then dhammah (1:2), then fathah (1:6).

### 4.3 Exercises (v1: no AI, no microphone)

| Skill | Mechanics |
|---|---|
| Listening & recitation | **Dengar & Ketuk** (tap the word the imam says), **Ikuti Imam** (karaoke at 0.75×, loop a word), **Tirukan** (repeat in the recording's built-in gaps) |
| Meaning | **Susun Makna** (assemble the Indonesian meaning), **Pasangkan Makna+Suara** (match meaning to sound), **Tebak Dulu** (guess first via Indonesian loanwords: rahmat, nikmat, hidayah…) |
| Root & pattern | **Detektif Akar** (words sharing a root, then into the concordance), **Pabrik Wazan** (drop root letters into a pattern; outputs are labelled "kata Arab", never ayat), **Ganjil Sendiri** (odd one out) |
| I'rab | **Kenapa Harakat Ini?** (choose the reason), **Sortir Akhiran** (sort into raf' / nasb / jarr / mabni bins; ṣirāṭ appears in all three cases across the Qur'an), **Label Peran** (tag the role), **Kereta Idafah** (watch the kasrah carry along the chain) |
| Tafsir & tadabbur | **Dialog Qasamtu** (match each ayah to Allah's reply, Muslim 395), **Peta Struktur** (praise / covenant / request), **Skenario Hidup** (a daily-life situation → which ayah or word speaks to it) |
| Cross-reference | **Jejak Kata** (follow a word to its other ayat), **Tahukah Kamu?** (encyclopedia card + one question) |
| Memory | **Review Harian** (FSRS spaced-review queue), **Tangga Murajaah** (text hides step by step: full → first letters → blank) |
| After an ustadz ruling | **Susun Ayat** (order the word tiles), **Rumpang Audio** (the ayah plays with a silent gap) |
| Later (v1.5–v2) | Dua Bacaan (needs licensed audio from another riwayah), Peta Makhraj (illustrations + a human teacher), Rekam & Bandingkan, Setor ke Ustadz (via Kelas), Ajarkan Kembali (teach-back), memorisation ASR (words skipped/wrong only; never a tajwid score) |

**Feedback design:**
- Every answer explains the rule. Retrieval with feedback has about double the effect of retrieval alone (g = 0.73 vs 0.39).
- New vocabulary is taught in blocks; case categories are interleaved.
- Each grammar point follows faded worked examples: full worked i'rab → one step blanked → the learner does it all.

### 4.4 Exam and mastery
- **Per lesson:** a 3–5 item exit ticket with a confidence tap.
- **Checkpoints:** ≥80% to unlock the next unit, with unlimited retries and no penalty.
- **Ujian Al-Fatihah** (~20 min, all parts mixed):
  - (A) listening;
  - (B) meaning;
  - (C) language: sort all 29 words by case, explain the reasons, find roots, build wazn;
  - (D) tadabbur: the qasamtu dialogue and a life scenario.
  - Pass mark ≥80% per part, with a delayed re-test about 30 days later.
- **Peta Penguasaan:** a private map of 29 words × skills, about 166 items scheduled by FSRS.

### 4.5 Encyclopedia ("Tahukah kamu")
**Every card follows these rules:**
- It shows the number, the **list of locations** (clickable), the dataset and version, and the counting rule (e.g. "menurut QAC 0.4; tidak menghitung basmalah awal surah").
- Use **lemma** counts for claims about meaning. Root counts are framed as "word family" facts.
- No numerology, and no letter-count claims (sources differ: 113 vs 120).
- Every hadith shown is graded.

**v1 set** (verified 2026-10-09, see Appendix B):
- basmalah ×114 in the mushaf (112 headings + 1:1 + 27:30; At-Tawbah has none);
- بسم الله also at 11:41 (Nuh's ark);
- Raḥmān 57× and Raḥīm 116×;
- رب العالمين in 42 verses;
- يوم الدين 13×;
- المغضوب appears only once;
- إيّاك (2nd person masculine singular) only in 1:5;
- the definite الصراط المستقيم only at 1:6 and 37:118;
- ṣirāṭ 45×, never plural;
- اهدنا only at 1:6 and 38:22;
- the *istaʿāna* verb at 1:5, 2:45, 2:153 and 7:128, plus *al-mustaʿān* at 12:18 and 21:112;
- the names of Al-Fatihah (graded hadith only).

### 4.6 Lesson ideas beyond the brief
- **Al-Fatihah as a dialogue.** An animated visual of the hadith qudsi *qasamtu ash-shalah* (Muslim 395).
- **Balaghah moments.** The *iltifat* from "Dia" to "Engkau"; fronting *iyyāka* to mean "hanya"; "praise, then ask" as the adab of du'a.
- **Kisah Surat Sulaiman** (27:28–31). Told in the third person, with no depiction of the prophet. The basmalah is read out by the Queen of Saba'.
- **"Kenapa terjemahan berbeda?"** Why translations differ, e.g. *māliki/maliki*, and what *ṣirāṭ* covers.
- **Fatihah dengan makna.** A slow-recitation mode with the meaning overlaid, for khushu' practice in shalat.
- **Mu'rab vs mabni by ear.** Hear *na'budu*'s ending change across ayat; *iyyāka* never changes.
- **Madd visualiser.** Bars drawn from the word timings: aḍ-ḍāllīn's mad lāzim lasts 2.3–6.1 s across reciters.
- **Qira'at intermezzo** (text only in v1; mutawatir readings only, from an-Nashr): مالك/ملك, الصراط with sin/sad/ishmam, عليهم/عليهُم.
- **Modes:**
  - **Parent–child co-op:** parent prompts and a printable worksheet.
  - **Majelis taklim projector mode:** team quiz without ranks.
  - **Khatib/da'i kit:** linked from the Khutbah & Kultum library and from briefing daleel chips that cite QS. Al-Fatihah.
  - **Creator word card:** Arabic copied verbatim from the source, with its citation.
- **Optional makna gandul overlay** (utawi/iku): familiar to pesantren learners, off by default because the audience is national.
- **Next surahs** (v2): Al-Ikhlas → An-Nas → Al-Falaq → Al-'Asr → Al-Kawthar → An-Nasr. An-Nas is the transfer test for the idafah and na't learned in Al-Fatihah.

### 4.7 Adab-aware engagement
**Avoid:**
- lives/hearts or waiting timers on Qur'an practice;
- global leaderboards (Muslim 1905 warns about reciting to be seen);
- gems you can buy, or random rewards (maysir);
- destructive or flippant animations on ayah text;
- sound effects over recitation;
- badges that carry religious status ("hafiz", "qari'", "ijazah");
- pictures of prophets or companions;
- music under recitation.

**Use instead:**
- a weekly *istiqamah* goal (e.g. 4 of 7 days) with automatic grace (Bukhari 6464–6465);
- a neutral "jeda" pause that never asks why;
- a private mastery map;
- shared family/halaqah goals (cooperative, no ranks);
- a reminder of niyyah at the start;
- encouragement drawn from "the one who struggles gets two rewards" (Bukhari 4937, Muslim 798).

**Ayah-text rules:**
- Tiles slide gently into place.
- After every assembly exercise, the correct ayah is shown and played in mushaf typography.
- **A wrong arrangement is never rendered in mushaf typography.**

---

## 5. References and data

### 5.1 Reference stack per lesson component

| Component | Primary | Cross-check / secondary | Status |
|---|---|---|---|
| Qur'an text | **Tanzil Uthmani v1.1** (verbatim; CC BY 3.0 with no-modification clause) | LPMQ Mushaf Standar (after the letter) | Pin by sha256 |
| Word segmentation, root, lemma, POS | **Quranic Arabic Corpus 0.4** (authoring input; attributed; file never modified; corrections kept in an overlay table) | MASAQ v6 (CC BY 4.0, i'rab layer) | Pin versions |
| I'rab and the harakat reason | **Darwish**, *I'rab al-Qur'an wa Bayanuh* (vol/page) + **Safi**, *al-Jadwal* — paraphrased and cited, never bulk-copied (copyright until 2052/2055) | al-Kharrat *al-Mujtaba*; an-Nahhas; as-Samin *ad-Durr al-Mashun* (classical) | Human-authored, ustadz sign-off |
| Grammar teaching frame | Public-domain pesantren texts: **al-Ajurrumiyyah**, **Mukhtashar Jiddan**, **al-Amtsilah at-Tashrifiyyah** (tasrifan), Imrithi (chanting), *Jawahir al-Balaghah* | Nahwu Wadhih / Mulakhkhas (style models only) | Our own words |
| Word glosses (ID) | **In-house**, reviewed, anchored to the official translation | QF word-by-word id 100 has known errors (عليهم → "kepadanya") | Do not ship it |
| Ayah translation (ID) | **Kemenag 2019** once LPMQ permits | Until then: QuranEnc `indonesian_affairs`, **labelled exactly as QuranEnc names it** (its 1:1, 1:2 and 1:6 differ from official 2019) | Never mislabel |
| Light tafsir | **Ibn Kathir (AR)** + **al-Tabari (AR)** from the platform corpus, rendered into reviewed Indonesian; **Tafsir Ringkas Kemenag** once permitted; Jalalayn; Marah Labid (Nawawi al-Bantani) | Al-Mukhtasar ID (QuranEnc). Its "Faedah ayat" cards must be shown whole or not at all, because QuranEnc forbids modification and some cards name groups for 1:7. | Al-Misbah and Al-Azhar: reading list only |
| Hadith | **Platform corpus** by canonical citation (`retrieve_by_citation`): Bukhari 756, 780, 4474, 4704, 5007; Muslim 394, 395, 806 | Reviewed Indonesian translations needed for Bukhari and Riyad (the corpus has none) | Graded before display |
| Counts and parallels | Computed from **QAC + Tanzil**, scripts committed, every number shown with its method | al-Mu'jam al-Mufahras | Re-run on any data version change |
| Qira'at | **an-Nashr** 1/271–273; al-Budur az-Zahirah pp. 15–16 | — | Text-only intermezzo; mutawatir readings only |
| Word timings | **cpfair/quran-align** (CC BY 4.0; Husary Mu'allim + Alafasy) | QF segments (identical for 1:1–7) | Validated per word by a human |
| Fonts | **Amiri Quran / Scheherazade New** (OFL) | KFGQPC needs written approval; Isep Misbah (LPMQ) via the letter | Self-hosted |

### 5.2 Data hygiene (inherited defects not to reuse)
- `api/data/quran.json` has three problems:
  - the basmalah is glued onto ayah 1 of 112 surahs;
  - 1:1 starts with U+FEFF;
  - 27:30 ID reads "SuIaiman".
  - The module reads Tanzil instead.
- The platform's ID translation is the older `id.indonesian` edition (non-commercial), not Kemenag 2019. The LPMQ letter (B2) can fix this platform-wide.
- The EN Ibn Kathir in the corpus is the abridged Mubarakpuri/Darussalam edition, which is copyrighted. The module shows the Arabic original plus our own reviewed Indonesian.
- The local `muslim.json` / `riyad-as-salihin.json` use non-canonical numbers. Always resolve by `citation_en`.
- Ibn Kathir 1:1 carries a weak narration (the 'Isa/bismillah report). Retrieved tafsir needs a grading filter before display.

---

## 6. Audio

### 6.1 Rules (enforced by lint, not by memory)
- **A1. Never synthesise Qur'an.** No TTS, voice conversion, denoising or tempo-baking on Qur'anic audio. That includes single words inside narration, in Arabic script or transliteration. A **quran-guard lint** fails the render if any narration segment contains Qur'anic text.
- **A2. Qur'anic sound only from human recitation.** Segments flagged `is_quranic` must have `audio.kind = recitation`; CI checks this.
- **A3. Word replay = seeking within the streamed ayah file** (no cut files) until we own a recording.
- **A4. Ayah-final i'rab is never heard** (all 7 ayah-final words are read with a stop). "Why kasrah" lessons for those words are visual only until human Tier-B clips (B4) exist. "Dengar & Pilih harakat" uses only the 22 mid-ayah words.
- **A5.** User-controlled slow playback (pitch preserved) is allowed. Chimes and music are never played over recitation.
- **A6.** Narration is labelled "Narasi: suara AI", and every page carries "AI-assisted, bukan fatwa otoritatif".

### 6.2 Recitation
- **v1:** stream **Husary Mu'allim** (QF recitation 12; per-ayah files with built-in repeat gaps) and **Alafasy** (listening) with credit.
  - Timings: self-host quran-align, validated against the exact streamed files.
  - Three famous reciter sets have broken Al-Fatihah timings; never ship an unvalidated reciter.
- The learner's browser fetches the audio directly. This is disclosed on the privacy page (learner IPs reach a foreign CDN) and allowed in the CSP `media-src`.
- **v1.5:** a **commissioned Indonesian qari** (with sanad, Hafs) under a perpetual licence. This unlocks: isolated-word drills, ayah-final i'rab clips, an offline pack, and children-style call-and-response. Submit it for LPMQ tashih.

### 6.3 Narration (ElevenLabs)
- **Model and settings:** `eleven_v3` with the house settings. v4 only after an A/B test on 10 segments approved by the operator; v4 has no style setting.
- **Normalisation:** in Python **before** the API call. The tools no longer exist (the `/tmp` reference scripts are gone), so they are **rebuilt in the repo with unit tests** before the first render:
  - number → words;
  - Allah → Alloh;
  - Arabic grammar terms → a reviewed Indonesian pronunciation list (fathah, dhammah, i'rab, isim, fi'il…);
  - citation expansion without parentheses.
- **Manifest-driven, not one MP3 per lesson.** A lesson is a list of segments (narration clips + recitation spans) so learners can replay a word, see highlights and use Tirukan. Highlight sync comes from `with-timestamps`. If v3 returns no audio (a known bug), fall back to Forced Alignment on the audio received.
- **Caching:** files are named by the hash of (text + voice + model + settings) and stored immutably, so unchanged segments are never re-rendered.
- **Size:** Al-Fatihah narration is about **31–54k characters (31–54 min)**.

---

## 7. Architecture

### 7.1 Placement and routing
Host **Caddy** (`deploy/Caddyfile`) gains three `handle` blocks. Caddy sorts the most specific path first:
```
handle /belajar/media/* { uri strip_prefix /belajar/media; root * /srv/dakwah-lens/data/belajar-media; file_server }
handle /belajar*        { reverse_proxy localhost:3200 }
handle                  { reverse_proxy localhost:3000 }
```
- The module stays up when `web` is down.
- `file_server` serves byte ranges, which audio seeking needs.
- `deploy.sh` remains the only owner of the Caddyfile.
- Cross-app links are plain `<a>`, never next-intl `<Link>` (Next multi-zones guide).

### 7.2 Container and runtime
- **New package `belajar/`** in the monorepo:
  - Next.js 16, React 19, Tailwind v4, next-intl;
  - `basePath: "/belajar"`, `output: "standalone"`, node:22-alpine, no Chromium.
- **Lessons are SSG**, prerendered from reviewed JSON in `belajar/content/`. Not `data/`: `.gitignore` swallows that name.
- **No LLM and no Qdrant at runtime.** The only server paths are progress, exam scoring and reviewer Draft Mode.
- **Measured VM:** 2 vCPU; 1.9 GB RAM with about 630 MB available; 4 GB swap; 8.8 GB disk free. The prod web container uses about 615 MB.
  - The module container gets `mem_limit: 256m` and `NODE_OPTIONS=--max-old-space-size=192`.
  - Media (narration + Al-Fatihah) is tens of MB, kept in a host directory and served by Caddy.
- **The image is built in GitHub Actions**, not on the VM (protects prod CPU and RAM) and not on the laptop. It is shipped with `docker save | ssh docker load`.

### 7.3 Identity
- **Anonymous use is first-class:** progress lives in localStorage and merges into the account on login.
- **Signed-in users:** the module's server calls `http://web:3000/api/auth/session` on the shared Docker network, forwarding the user's cookie (with `X-Forwarded-Proto: https`, so Auth.js reads the `__Secure-` cookie). This needs **zero changes to main-app auth**, and the NextAuth secret stays in one service.
- **Fallback, only if the spike fails:** shared-secret `getToken`. It widens the blast radius, so it is a last resort.
- **Pending users can learn.** Learning is not gated on admin approval.
- **Session expiry:** a learner who uses only the module for 30 days hits token expiry and must sign in again.

### 7.4 Data
- **New database `dakwah_belajar`** in the existing Postgres container, with its own role and no grants on `dakwah_lens`. Migrations are the module's own Drizzle migrations; the main alembic would otherwise propose dropping foreign tables.
- **Tables:**
  - `learners(user_id PK)`
  - `lesson_progress`
  - `quiz_attempts`
  - `srs_cards` (FSRS state, ts-fsrs, MIT)
  - `srs_reviews`
  - `exam_results`
- **Account deletion:** the main app's hard-delete posts an HMAC-signed `user-deleted` event to the module, backed by a nightly sweep of orphaned rows (UU PDP).

### 7.5 Content pipeline (offline; review-gated)

| Stage | Where | Output |
|---|---|---|
| 0. Source registry | `belajar/pipeline/sources.yaml` | URL, version, sha256, licence and attribution for every input |
| 1. Retrieve | Inside the prod `api` image, read-only against prod Qdrant (`retrieve_quran_ayah`, `retrieve_tafsir_for_ayah`, `retrieve_by_citation`) | `snapshots/*.json` with collection, point id, text and sha256 |
| 2. Assemble | `belajar/pipeline` (Python) | Word data from QAC/Tanzil; concordance counts and location lists; phrase parallels; the quiz bank. **No LLM in any counted or located fact.** |
| 3. Author | Claude in chat and/or ustadz | I'rab "why" sentences, glosses, tafsir notes, narration scripts. Every Arabic string or claim is a `{ref}` to a snapshot entry or a print citation. |
| 4. Render (costs money; asks first) | `belajar/pipeline/tts/` | Preprocess → quran-guard lint → ElevenLabs v3 with-timestamps → hashed media files |
| 5. Review gate | Draft Mode preview → `belajar/content/reviews/<lesson>.json` | Reviewer, date, `content_sha256`, `audio_manifest_sha256` |
| 6. Validate (CI) | `deploy-belajar.yml` | JSON schema; ref bytes match the snapshot; Qur'an text matches Tanzil; `is_quranic` ⇒ recitation; labels present; **every lesson hash has a matching sign-off, or the build fails** |
| 7. Publish | Module deploy | Content baked into the image; media rsynced to `/srv/dakwah-lens/data/belajar-media` |

### 7.6 Deploy and CI (no coupling to the main stack)
- **`deploy/belajar/docker-compose.yml`:**
  - `name: dakwah-belajar` (its own project name; otherwise the main deploy's `--remove-orphans` would delete the module);
  - service `belajar-web` on `127.0.0.1:3200`;
  - external network `dakwah-lens_dakwah`;
  - `mem_limit`.
- **`.github/workflows/deploy-belajar.yml`:**
  - `paths: [belajar/**, deploy/belajar/**]`;
  - its **own concurrency group**;
  - CI runs lint, type-check, tests and the content validators, builds the image, and ships it.
- **`deploy.yml`** gains `paths-ignore` for the same paths, so module commits do not trigger the main deploy's user-facing "update in progress" overlay.
- **A VM-level `flock`** (`/srv/dakwah-lens/.deploy.lock`) is shared by both deploy scripts.
- **`BELAJAR_PUBLIC=false`:** pages are noindex (crawlable, not robots-blocked) until the first ustadz-approved lesson ships.

### 7.7 Main-app touchpoints

| File | Change |
|---|---|
| `deploy/Caddyfile` | The three `handle` blocks |
| `.github/workflows/deploy.yml`, `deploy/deploy.sh` | `paths-ignore`; `flock` |
| `web/src/components/Header.tsx`, `Footer.tsx` | "Belajar" nav item as a plain `<a href="/belajar/{locale}">`, gated by an `app_settings` flag (toggles without a redeploy) |
| `web/messages/{id,en}.json` | `Nav.belajar` |
| `web/src/app/[locale]/m/[id]/Article.tsx`, `kitab/page.tsx`, `DaleelChips.tsx`, `khutbah-kultum/page.tsx` | "Pelajari kata per kata →" on `QS. Al-Faatiha: n`, via a resolver `/belajar/r?c=<citation>` with a surah-1 allowlist (no copied manifest, no drift) |
| `web/src/app/robots.ts` | Sitemap list includes `/belajar/sitemap.xml` (after launch) |
| `admin/actions.ts` | Signed `user-deleted` call to the module |
| `privacy`, `transparency` pages | Disclose module data, streamed-audio CDNs, sources and credits |

---

## 8. Sharia, compliance and review

- **Review gate:** every published value has a reviewer sign-off tied to its content hash; CI enforces it.
  - **Roles:** nahwu-sharaf; tajwid/qira'at with sanad (also does audio QA); hadith takhrij/grading; a tafsir/aqidah editor for 1:7 and how differences are framed.
  - **Estimated load:** about 20–40 reviewer-hours across 2–3 people for Al-Fatihah. This is the critical path.
- **Editorial policy:**
  - **Numbering:** Kufan/Hafs, with the basmalah as 1:1. Note the fiqh difference neutrally (Syafi'i: an ayah of Al-Fatihah; Maliki: not).
  - **I'rab:** one main reading per word, with a collapsed *Pendapat lain* chip. Quizzes accept the alternative readings as "juga benar".
  - **1:7:** describe the **traits** first (Ibn Kathir: knowing the truth and turning away, vs losing knowledge), framed as something to watch for in oneself. The reviewer decides whether and how to cite Tirmidhi 2954. Never polemical, and always attributed ("menurut …").
  - **Framing to avoid:** do not frame the lessons through the contested "three types of tawhid" (Madarij), and do not settle the etymology of "Allah" (scholars differ).
  - **Qira'at:** mutawatir readings only, as a text intermezzo. Shadhdh readings are excluded, or labelled "bukan Al-Qur'an".
  - **No unattributed claims and no numerology** [NO OVERCLAIMING].
- **PMA 44/2016:**
  - Under Pasal 1(1), a mushaf includes parts of a surah, printed or digital.
  - **Pasal 2** requires a Surat Tanda Tashih, and **Pasal 4(1)** requires the Mushaf Standar.
  - Supplementary material must name its compiler and cite authoritative sources (**Pasal 5(3)–(4)**).
  - A tashih letter is valid 2 years, and any change in "materi dan desain" restarts the process (**Pasal 16(4)–(5)**).
  - **Ask LPMQ to define a minimal "master"** (Qur'an text + translation + recitation) so that quizzes and UI can iterate without re-tashih.
- **Licensing:**
  - A credits/licence page lists: Tanzil, QAC, quran-align, QuranEnc (with version), Quran Foundation, each reciter, and LPMQ.
  - **No unlicensed media is self-hosted.**
- **Privacy (UU PDP):**
  - Only `user_id` is stored, on the Jakarta VPS.
  - No learner audio in v1.
  - No child accounts.
  - The privacy page discloses the streamed audio CDN.

## 9. Budget (separate one-time pilot line; nothing is spent without an explicit go)

| Item | Estimate | Notes |
|---|---|---|
| ElevenLabs narration (Al-Fatihah) | ≈ USD 4–9 of v3 usage; ≈ IDR 130–400k incl. one Starter/Creator month | Cost shown before each render; hash cache avoids re-renders |
| LPMQ tashih | Rp0.5–3M; 1–3 months | Category decided by LPMQ |
| Commissioned qari (with licence) | Quote needed | v1.5 |
| Reviewer honoraria | Quote needed (~20–40 h) | Critical path |
| Runtime | ≈ 0 | One small Node process; no runtime LLM |
| Scale-out (Juz 'Amma narration) | ≈ IDR 3.5–5M one-time | **Would breach the IDR 1.5–2M monthly cap** unless phased over 4–5 months or budgeted separately |

## 10. Build plan and milestones

| Milestone | Contents | Blocked by |
|---|---|---|
| **M0 — Foundation** | `belajar/` app scaffold (design tokens copied from `web/` with a parity check); container + compose + `deploy-belajar.yml` (CI-built image); Caddy route; `dakwah_belajar` DB + migrations; health check; noindex beta flag; credits page | — (deploy authorised 2026-10-09) |
| **M1 — Lesson engine** | Content schema (word / ayah / segment / exercise / fact, with refs); word-card UI (case colour + shape, root highlight, wazn overlay); ayah player with quran-align karaoke, seek-replay, 0.75× and Tirukan; exercises engine + the v1 no-AI mechanics; FSRS review queue; progress (anonymous → account merge) | — |
| **M2 — Al-Fatihah data (draft)** | Pinned Tanzil + QAC + quran-align; computed facts with location lists; the 29-word inventory (Appendix A) as **draft**, marked "menunggu tinjauan ustadz"; hadith snapshot via `retrieve_by_citation` | B3 (text) for the final version |
| **M3 — Narration pipeline** | Python preprocessors + tests; quran-guard lint; timing validator; ElevenLabs renderer with hash cache; Forced Alignment fallback. **One paid test call after approval.** | B5 (voice), B7 (budget) |
| **M4 — Review & beta** | Reviewer Draft Mode; sign-off records; CI gate; closed beta (invite-only, noindex) with 10–20 learners from the target audiences; pre/post test | B6 (reviewers), B8 (exercise rulings) |
| **M5 — Public launch** | LPMQ answer applied (MSI text / tashih); `BELAJAR_PUBLIC=true`; main-app nav flag on; sitemap; privacy/credits updates | B2 (LPMQ), all review gates green |

## 11. Top risks

| Risk | Level | Mitigation |
|---|---|---|
| Unreviewed i'rab or tafsir reaches learners (11 known ikhtilaf points; 2 suspected source errors already flagged) | High | Sign-off per content hash; CI gate; draft label |
| AI-altered Qur'an | High | Rules A1–A2 + lint; operator confirms the platform stance (B10) |
| PMA 44 tashih / Mushaf Standar | High | Closed beta + LPMQ letter now; rasm-agnostic keys |
| Recitation rights | High | Stream only with credit; commission our own recording |
| Reviewer bandwidth | High | Named panel + honorarium agreed before authoring |
| Second container on a 1.9 GB VM | Medium | `mem_limit`; CI-built images; no runtime LLM; `flock` |
| Deploy coupling (`--remove-orphans`, update overlay) | Medium | Own compose project; `paths-ignore`; own concurrency group |
| Weak narrations inside retrieved tafsir | Medium | Grading filter before display |
| Sectarian framing of 1:7 or tawhid categories | Medium | Editorial policy §8 |
| Gamification that conflicts with adab | Medium | Spec §4.7 |
| ElevenLabs drift (v4 changes, v3 with-timestamps bug) | Low–Medium | Archive masters; never re-render published audio without a script change; FA fallback |

## 12. Success metrics (proposed; operator sets the targets)

**Gates (must be 100%):**
- every published value is signed off;
- every Qur'an audio segment is human recitation;
- every fact is click-through to its source;
- no unlicensed self-hosted media;
- no open LPMQ question at public launch.

**Learning:**
- median pre/post gain ≥40 percentage points (word meaning + case reason);
- ≥80% of exam takers pass every part;
- ≥70% retention on the 30-day re-test;
- FSRS observed retention ≈ 0.85–0.9.

**Simplicity:**
- pilot average ≥4/5 on "penjelasannya jelas";
- ≥80% of pilot learners can explain the 3 case endings in their own words.

**Engagement (adab-compatible):**
- ≥40% of starters reach Unit 3;
- ≥15–20% of registered learners take the exam within 6 weeks;
- weekly istiqamah hit rate and D7/D30 return are tracked;
- no streak-loss or leaderboard metrics.

**Cost:**
- pilot spend stays within the approved line;
- runtime LLM ≈ IDR 0;
- the module stays under its `mem_limit` with no measurable impact on prod.

---

## Appendix A — Al-Fatihah word inventory (DRAFT — pending ustadz sign-off)

**Data and sources:**
- Hafs, Kufan count. 7 ayat, **29 words** (4+4+2+3+4+3+9); 25 without the basmalah (ad-Dani, Ibn Kathir).
- 23 distinct lemmas, 18 trilateral roots (QAC 0.4).
- **Source abbreviations:** D = Darwish, *I'rab al-Qur'an wa Bayanuh* (vol. 1 pp. 9, 14–15); J = Safi, *al-Jadwal*; M = al-Kharrat, *al-Mujtaba*; N = an-Nahhas; S = as-Samin, *ad-Durr al-Mashun*.
- Glosses are placeholders until our reviewed glosses replace them.

| Loc | Word | Root · POS | Wazn | Case · sign | Why (Indonesian, one line) | Src |
|---|---|---|---|---|---|---|
| 1:1:1 | بِسْمِ | س م و · P+N | — | majrūr · kasrah | Kasrah karena didahului huruf jar بِ. | D 1/9; J; M; N |
| 1:1:2 | ٱللَّهِ | أ ل ه · PN | — | majrūr · kasrah | Mudhaf ilaih dari *ismi*. | D; J; M |
| 1:1:3 | ٱلرَّحْمَٰنِ | ر ح م · ADJ | فَعْلان | majrūr · kasrah | Sifat (na't) yang mengikuti "Allāh". | D; J; M |
| 1:1:4 | ٱلرَّحِيمِ | ر ح م · ADJ | فَعِيل | majrūr · kasrah | Sifat kedua. | J; D |
| 1:2:1 | ٱلْحَمْدُ | ح م د · N | فَعْل (masdar) | marfū' · dhammah | Dhammah karena ia mubtada'. | D 1/14; J; N |
| 1:2:2 | لِلَّهِ | lām + PN | — | majrūr · kasrah | Kasrah karena huruf jar لِ; menjadi khabar tersirat. | D; J; S |
| 1:2:3 | رَبِّ | ر ب ب · N | فَعْل | majrūr · kasrah | Mengikuti "Allāh" (na't/badal). | N; J; D; M |
| 1:2:4 | ٱلْعَٰلَمِينَ | ع ل م · N MP | — | majrūr · yā' | Mudhaf ilaih; yā' karena mulhaq jamak mudzakkar salim. | D; J; M |
| 1:3:1–2 | ٱلرَّحْمَٰنِ ٱلرَّحِيمِ | ر ح م | — | majrūr · kasrah | Sifat lagi bagi "Allāh" (J: atau badal). | D; J |
| 1:4:1 | مَٰلِكِ | م ل ك · N (ism fā'il) | فاعِل | majrūr · kasrah | Sifat keempat bagi "Allāh". | D; M; J |
| 1:4:2 | يَوْمِ | ي و م · N | فَعْل | majrūr · kasrah | Mudhaf ilaih. | D; J |
| 1:4:3 | ٱلدِّينِ | د ي ن · N | فِعْل (masdar) | majrūr · kasrah | Mudhaf ilaih. | J |
| 1:5:1 | إِيَّاكَ | PRON 2MS | — | mabnī · mahall nashb | Objek yang didahulukan untuk makna "hanya". | D; J; M |
| 1:5:2 | نَعْبُدُ | ع ب د · V impf. I | نَفْعُلُ | marfū' · dhammah | Mudhari' tanpa penashab/penjazm; pelaku tersirat "kami". | D; J |
| 1:5:3 | وَإِيَّاكَ | wa + PRON | — | (sama) | Diulang agar "hanya" melekat pada kedua perbuatan. | J; D |
| 1:5:4 | نَسْتَعِينُ | ع و ن · V impf. X | نَسْتَفْعِلُ | marfū' · dhammah | Sama dengan *na'budu*. | D; J; M |
| 1:6:1 | ٱهْدِنَا | ه د ي · V impv. | — | mabnī (hadzf harf 'illah) | Kata perintah bermakna doa; yā' dibuang; pelaku "Engkau". | D; J; M |
| 1:6:2 | ٱلصِّرَٰطَ | ص ر ط · N | فِعال | manshūb · fathah | Objek kedua dari *ihdi*. | J; M; D |
| 1:6:3 | ٱلْمُسْتَقِيمَ | ق و م · ADJ (ism fā'il X) | مُسْتَفْعِل | manshūb · fathah | Sifat bagi *aṣ-ṣirāṭ*. | D; J |
| 1:7:1 | صِرَٰطَ | ص ر ط · N | — | manshūb · fathah | Badal dari *aṣ-ṣirāṭa*. | D; J; M; S |
| 1:7:2 | ٱلَّذِينَ | REL | — | mabnī · mahall jarr | Mudhaf ilaih dari *ṣirāṭa*. | D; J |
| 1:7:3 | أَنْعَمْتَ | ن ع م · V perf. IV | أَفْعَلْتَ | mabnī sukūn | Bersambung dengan تَ (= Engkau, pelaku); kalimat shilah. | D; J |
| 1:7:4 | عَلَيْهِمْ | على + هم | — | jar-majrūr | Keterangan bagi *an'amta*. | D; J |
| 1:7:5 | غَيْرِ | غ ي ر · N | — | majrūr · kasrah | Badal dari *alladhīna* (atau na't). | J; M; D; S |
| 1:7:6 | ٱلْمَغْضُوبِ | غ ض ب · N (ism maf'ūl) | مَفْعُول | majrūr · kasrah | Mudhaf ilaih dari *ghayri*. | D; J |
| 1:7:7 | عَلَيْهِمْ | على + هم | — | mahall raf' | Nā'ib fā'il bagi *al-maghḍūb*. | D; J; M |
| 1:7:8 | وَلَا | wa + NEG | — | — | *Lā* tambahan, menegaskan negasi *ghayr*. | D; J; M |
| 1:7:9 | ٱلضَّآلِّينَ | ض ل ل · N MP | فاعِلِين (idgham) | majrūr · yā' | Jamak mudzakkar salim, di-'athaf-kan. | D; M; J |

**Ikhtilaf points for the "Pendapat lain" chip:**
- what بسم attaches to;
- what puts الحمد in raf';
- the *al-* in الحمد;
- the lam of لله;
- رب (na't/badal);
- مالك (na't/badal);
- إيّاك (mabnī on fath vs sukūn);
- الصراط in 1:6 (second object vs *naz' al-khafidh*);
- صراط in 1:7 (badal vs 'atf bayān);
- غير (4 views);
- what الضالين is joined to.

**Flagged for the reviewer:**
- al-Jadwal gives حمد as "باب نصر", which looks wrong: حَمِدَ يَحْمَدُ is فَعِلَ–يَفْعَلُ.
- The QF ID gloss for أَنعَمتَ drops "Engkau".

## Appendix B — Encyclopedia facts verified 2026-10-09
Sources and methods: QAC 0.4 lemma/root counts, and Tanzil Simple-Clean regex with the prepended basmalah removed. The query scripts become `belajar/pipeline/facts/*.py`.

1. 7 ayat in every counting school; the counts differ only on the basmalah vs «أنعمت عليهم» (ad-Dani, *al-Bayan* p. 139).
2. 29 words; 25 without the basmalah.
3. The letters ث ج خ ز ش ظ ف never appear in it (show the fact only, without the popular interpretations).
4. Basmalah ×114 in the mushaf: 112 headings + 1:1 + 27:30; none in At-Tawbah. 27:30 is the only basmalah inside a verse, read out by the Queen of Saba' from Sulaiman's letter.
5. بسم الله in verse text: 1:1, 11:41, 27:30.
6. الرحمن الرحيم side by side: 1:1, 1:3, 2:163, 27:30, 41:2, 59:22.
7. Raḥmān 57× (16 in Maryam); Raḥīm 116×; root ر ح م 339×.
8. (Wa/fa) الحمد لله in 23 verses; 5 surahs open with it (1, 6, 18, 34, 35).
9. Full phrase الحمد لله رب العالمين at 1:2, 6:45, 10:10, 37:182, 39:75, 40:65.
10. رب العالمين: 42 verses. Rabb is the most frequent noun lemma after "Allah" (975 vs 2,699).
11. يوم الدين 13× (three in Al-Infitar).
12. مالك as ism fā'il 3×: 1:4, 3:26, 36:71.
13. إيّاك (2nd person masculine singular) only in 1:5 (twice).
14. *Istaʿāna* as a verb: 1:5, 2:45, 2:153, 7:128; plus *al-mustaʿān* at 12:18 and 21:112 (root ع و ن 11×).
15. اهدنا only at 1:6 and 38:22.
16. The definite الصراط المستقيم only at 1:6 and 37:118. Iblis says «صراطك المستقيم» at 7:16.
17. Ṣirāṭ 45×, always singular.
18. المغضوب appears only once in the Qur'an (root غ ض ب 24×).
19. "Those You have favoured" are named in 4:69 (Ibn Kathir links the two).
20. *Āmīn* is not part of the Qur'an.

**Do not show:**
- "23 lemmas = 12.5% of the Qur'an" without stating it is dominated by Allah / lā / alladhī / 'alā;
- any letter count.

## Appendix C — Hadith on Al-Fatihah (canonical sunnah.com numbering)
**In the platform corpus:**
- «لا صلاة لمن لم يقرأ بفاتحة الكتاب»: Bukhari 756, Muslim 394a.
- *Qasamtu ash-shalah* and *khidaj*: Muslim 395a.
- Greatest surah / as-Sab' al-Mathani: Bukhari 4474, Riyad 1009.
- «أم القرآن هي السبع المثاني والقرآن العظيم»: Bukhari 4704.
- Ruqyah: Bukhari 2276, 5007, 5736; Muslim 2201a.
- The two lights: Muslim 806, Riyad 1022.
- Āmīn: Bukhari 780, Muslim 410a.

**Not in the corpus** (add through ingest, or leave out): Tirmidhi 2875, 2953, 2954, 3124; Abu Dawud 1457; Nasa'i 914.

**Must be graded before use:** the ad-Darimi "ash-Shifa'" report; the Ibn Sa'd basmalah-stages report; the claim that Al-Fatihah was revealed twice.

## Appendix D — Key sources
- Tanzil text licence: https://tanzil.net/docs/text_license
- Quranic Arabic Corpus: https://corpus.quran.com/download/
- MASAQ (CC BY 4.0, v6): doi 10.17632/9yvrzxktmr.6
- quran-align (CC BY 4.0): https://github.com/cpfair/quran-align
- Quran Foundation developer terms (2026-10-04): https://api-docs.quran.foundation/legal/developer-terms/
- QuranEnc (Indonesian/English translations, Al-Mukhtasar): https://quranenc.com
- PMA 44/2016: https://tashih.kemenag.go.id/uploads/1/2018-05/pma_nomor_44_tahun_2016.pdf · LPMQ tashih service: https://tashih.kemenag.go.id
- I'rab works read via tafsir.app: Darwish, al-Jadwal, al-Mujtaba, an-Nahhas, ad-Durr al-Mashun, an-Nashr
- ts-fsrs (MIT): https://github.com/open-spaced-repetition/ts-fsrs
- ElevenLabs with-timestamps API: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- Full research reports (2026-10-09): session scratchpad `quranmod/out/*.md` (worth committing next to this plan if the operator wants the evidence trail kept)
