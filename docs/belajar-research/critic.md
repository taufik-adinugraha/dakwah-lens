## GAPS
GAPS (brief requirements or decisions that no report closes)

1. **Who reviews the content, and how much work it is.** Every report says "ustadz reviews", but none names the roles, counts the hours or prices the work.
   - Roles needed: (a) nahwu-sharaf, (b) tajwid/qira'at with sanad (for the qari session and the audio QA), (c) hadith takhrij and grading, (d) a tafsir/aqidah editor (for 1:7 and the ikhtilaf framing).
   - Rough load (my estimate, unverified): about 29 words × 7 fields, 7 ayah tafsir notes, 10–26 encyclopedia facts each with a list of locations, about 10 hadith, 30–40 quiz items with feedback, 31–54 min of narration script and audio, and the qari session. That comes to about 20–40 reviewer-hours across 2–3 people.
   - This is the binding constraint on the critical path, and no report scheduled it.
2. **Indonesian standard text (MSI) vs Madani text is unresolved and blocks the build.** quran-data recommends Tanzil Madani + Amiri. PMA 44/2016 Pasal 4(1) (I read the official PDF) says publication "harus mengacu kepada Mushaf Standar". Indonesian learners also read the MSI's harakat and waqf marks. No report found a machine-readable MSI text. The only route is the LPMQ "API Qur'an Kemenag", which needs a formal request letter. Word segmentation, word timings and fonts all depend on this choice.
3. **The retrieval rule needs a written extension.** AGENTS.md says Islamic references are "retrieved from Qdrant". The i'rab sources (Darwish, al-Jadwal, al-Mujtaba) are copyrighted and cannot be bulk-ingested. The rule needs operator approval to read: "retrieved from Qdrant or from a pinned, checksummed snapshot, or a human-verified print citation (kitab/vol/page)".
4. **No success metrics or learner validation.** The brief asks for "simple" explanations, but no report sets a reading-level target, a comprehension pilot or a pre/post test.
5. **Children.** Parent–child mode, "Husary with kids" and kids' call-and-response all assume minors. No report designs for UU PDP Pasal 25 (children's data needs parental consent).
6. **Corrections after launch.** There is no errata or versioning workflow. Under PMA 44 Pasal 16(5), any change to "materi dan desain" restarts tashih, which conflicts with iterative releases. Nobody has defined which content counts as the tashih "master" and which can change freely.
7. **Platform-wide policy on synthetic Qur'an.** The module rule (no TTS, no voice conversion on Qur'an) may contradict existing practice. Memory references `qari-*-haidir-vc-norm.mp3` for kultum ayat. If "vc" means voice-converted, the main site may already ship AI-altered Qur'an audio. The operator must confirm before the module publishes a stricter rule.
8. **Hadith and other non-Qur'anic Arabic audio has no rule.** The existing pipeline TTS'd Arabic hadith (Haidir clone, wasl preprocessor). The audio report proposes human-only "Tier B". There is no decision either way.
9. **Indonesian hadith text.** Bukhari and Riyad have no ID translation in the corpus. Reviewed ID translations are needed for every hadith shown. That workload is unplanned.
10. **No engineering effort estimate or timeline** in any report. VPS RAM and disk are still unverified (`system_metrics` query not run).
11. **Analytics and telemetry.** Nothing defines which learner events are logged, the consent wording, or retention.
12. **Makna gandul (utawi/iku) is Javanese-pesantren specific.** The audience is national. It must be optional, not the default notation.
13. **Free vs paid** is raised by three reports and decided by none. It changes which sources are usable.
14. **Mukhtasar ID "Faedah ayat" cannot be trimmed.** QuranEnc's no-modification condition means each card must ship whole or not at all. Some cards name "Nasrani" for 1:7. No report notices that we cannot edit those lines out.

## CORRECTIONS
CORRECTIONS (claims I checked myself, 2026-10-09)

1. **The "Kemenag 2019" label is wrong in two reports.** The kitabs report says Kemenag 2019 was "verified in the QuranEnc API as indonesian_affairs v1.0.1"; fatihah-content says QF 33 "appears to be Kemenag 2019". Both are wrong.
   - Live QuranEnc API, indonesian_affairs v1.0.1: 1:6 = "Tunjukilah kami jalan yang lurus,[2]"; 1:1 = "…Maha Pengasih, Maha Penyayang."
   - Kemenag 2019: 1:6 = "Bimbinglah kami ke jalan yang lurus".
   - quran-data was right. Label it exactly as QuranEnc names it: "Indonesian Translation – Ministry of Religious Affairs (QuranEnc v1.0.1)".
2. **The tashih fee and lead time are understated or contradictory across reports.**
   - Official fee table (tashih.kemenag.go.id, "5 langkah"):
     - Juz 'Amma / short surah: Rp500k
     - Mushaf: Rp1M
     - With translation: Rp1.5M
     - Per-word translation: Rp2M
     - Translation + transliteration or tajwid colours: Rp2M
     - Each additional material: +Rp500k
   - Service standard: Digital 15 working days, Audio/Visual 30, per-word translation 45, with tafsir 45.
   - PMA 44 Pasal 14(2) (official PDF): pentashihan "paling singkat 1 (satu) bulan", and the plenary session (sidang reguler) meets at least every 2 months (14(4)).
   - So fatihah-content's "30 working days for digital apps" is the Audio/Visual figure. Pedagogy (Rp1M, 15 days) and audio (Rp0.5–1.5M) are low. A per-word module with audio is plausibly Rp2M + Rp500k per extra material, taking 1–3 months. LPMQ decides the category.
3. **PMA 44 says more than any report cited:**
   - Pasal 4(1): must follow the Mushaf Standar.
   - Pasal 17(4): the Mushaf Standar means the Standar Utsmani, Bahriyyah or Braille.
   - Pasal 5(3)–(4): supplementary material must name the responsible compiler and cite authoritative sources.
   - Pasal 5(1): the mushaf needs its own distinct identity.
   - Pasal 16(4)–(5): the tashih is valid 2 years, and any change restarts the process.
   - Pasal 20: sanctions are administrative, up to withdrawal and revocation.
4. **ElevenLabs plan quotas disagree everywhere; budget from list price only.**
   - Confirmed: v3 costs $0.08 per 1K characters. v4 launched 2026-09-28 with a $0.022 promo until Oct 12.
   - Plan quotas: audio says Starter 30k credits and Creator 121k; architecture says Creator "275k chars". The live pricing page now shows Starter 273k and Creator 1M "TTS v4 characters".
   - Al-Fatihah at $3.8–8.6 still holds.
5. **QAC counts are confirmed.**
   - ح م د = 63 (hamd 43, hamid 17, plus 3 single forms; Muhammad and Ahmad are not filed under this root).
   - ر ح م = 339; rahman 57; rahim 116.
6. **One encyclopedia fact is incomplete (fatihah-content #18, pedagogy Unit 5).** "Form X استعان only 4×" is true only for the verb. QAC root ع و ن (11×) also has the Form X passive participle al-musta'ān at 12:18 and 21:112, so Form X occurs 6×. The card must say "sebagai kata kerja". "Allāhu al-musta'ān" is a good extra link for the Jejak Kata exercise.
7. **quran-data missed an openly licensed i'rab dataset.** It said none exists, but MASAQ is CC BY 4.0 (confirmed on Mendeley). It is now at v6 (10.17632/9yvrzxktmr.6), not the v5 the kitabs report gave. Pin the current version. The upstream licence chain (QAC/Tanzil) is still unclear.
8. **quran-align is CC BY 4.0 (README confirmed), so the audio report's word-timing plan is unnecessary.** Its "store timings via Content Sync, re-sync every 7 days" can be dropped; use quran-align instead.
   - Caveat: check the timings against the exact file being streamed. QF Alafasy is 192 kbps; quran-align was built on the 128 kbps EveryAyah files, and encoder padding can shift offsets.
9. **QF terms confirmed, plus a clause every report missed.** The 1-week storage cap, Content Sync, fonts, paid apps and New York law are all as reported. Missed: "The text of the Quran is not modified in any way", and snippets "may not be arranged or displayed in a way that alters or misrepresents the intended message". This bears on the Perbaiki Harakat, Susun Ayat and Rumpang exercises. Tanzil's verbatim-only clause raises the same issue.
10. **Repo defects confirmed.**
    - quran.json 1:1 begins with U+FEFF.
    - 2:1 = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ الٓمٓ" (basmalah glued on).
    - The 27:30 Indonesian text reads "SuIaiman".
    - The only ElevenLabs code reference is `web/src/lib/cost-providers.ts`.
    - The memory body of `feedback_voice_render_settings.md` still shows multilingual_v2 / "on" / previous_text, and `feedback_voice_use_elevenlabs.md` shows style 0.45, not 0.35. Fix both before any render.
11. **27:30 framing.** The verse is the Queen of Saba' reading out Sulaiman's letter. The card should say "dalam surat Nabi Sulaiman yang dibacakan Ratu Saba'".
12. **Architecture's open "slug" and "build on VM?" questions are partly settled.** Today's memory (`feedback_build_on_vm_not_laptop`, 2026-10-09) shows the operator already calls the module "/belajar" and wants builds on the VM or CI, never the laptop. That rule authorises container deploys only, not spending. Build the image in Actions to also protect prod CPU.

## RISKS
RISKS (H = high, M = medium, L = low)

**Sharia and accuracy**
- **H – Unreviewed i'rab or tafsir reaching learners.** There are 11 documented ikhtilaf points (rabb, ghayr, the second ṣirāṭ, iyyāka and others). Two suspected source errors are already known: al-Jadwal's "حمد باب نصر", and the QF Indonesian gloss for أنعمت that drops "Engkau". Every value needs a human sign-off tied to the content hash.
- **H – AI-altered Qur'an.** Any TTS, voice conversion, denoising or baked tempo change on Qur'an audio. This includes the possible existing "vc" qari files.
- **M – Ayah-final i'rab cannot be heard.** All 7 ayah-final words are read with a waqf, so their case endings never sound. Without human example clips, the "why kasrah" lessons are visual only.
- **M – Weak narrations inside retrieved tafsir.** Ibn Kathir 1:1 has the 'Isa/bismillah report; the ash-Shifa' (Darimi) and Ibn Sa'd reports are ungraded. Grade every hadith before display.
- **M – Sectarian framing.** The maghdub/dallin identification (Tirmidhi 2954, Mukhtasar ID), the three-types-of-tawhid frame, the etymology of "Allah", and the basmalah-as-ayah question. Present views by attribution only, never as polemic.
- **M – Showing other qira'at.** Hafs-only learners may be confused, and Warsh audio is unlicensed. Keep it as a text-only intermezzo, mutawatir readings only.
- **M – Overclaiming in encyclopedia cards.**
  - "23 lemmas = 12.5% of the Qur'an" is mostly Allah, lā, alladhī and 'alā.
  - The Form X count is incomplete.
  - Letter counts are disputed (113 vs 120).
  - Every card needs its source and method shown, plus a clickable list of locations [NO OVERCLAIMING].

**Legal and licensing**
- **H – PMA 44 tashih.** Partial ayat in digital form are in scope. Mushaf Standar text is required. Lead time is 1–3 months. Any content change restarts the process. Sanctions run up to withdrawal.
- **H – Recitation rights.** Rights are unknown for Husary, Minshawi and Alafasy. QuranicAudio is personal use only and EveryAyah states no terms. Only stream-and-seek is defensible; no cut files and no offline packs.
- **M – Indonesian translation.** Kemenag 2019 needs LPMQ permission. The QuranEnc text must not be called Kemenag 2019.
- **M – QAC and Tanzil "verbatim only".** Exercises that show altered text (Perbaiki Harakat) or rearranged text (Susun Ayat) may breach the QF, Tanzil and QAC terms, as well as adab.
- **M – Copyright of modern i'rab works.** Darwish (protected to 2052) and al-Jadwal (to 2055): paraphrase and cite only, and never put them in Qdrant.
- **M – Cloned voices.** Syafiq Riza and Abdullah Haidir clones need documented consent. A voice can be biometric data under UU PDP. Professional clones may only be made by the voice owner.
- **L – Laws outside Indonesia** (Saudi life+50) differ from Indonesian copyright rules. QF terms fall under New York law.

**Privacy (UU PDP)**
- **M – Learner IPs reach foreign CDNs.** Streaming from QF or EveryAyah sends learners' IP addresses abroad; this must be disclosed in the privacy page and allowed in the CSP.
- **H if built – learner voice recordings.** Recordings (Rekam, Setor, teach-back) sent to Gemini or ElevenLabs are a cross-border transfer of possibly biometric data, often from minors.
- **M – Children's data.** Needs parental consent (Pasal 25).
- **M – Account deletion.** It must cascade into the module's own database.

**Cost (against the IDR 1.5–2M/month cap)**
- **Al-Fatihah one-time costs:**
  - ElevenLabs: about IDR 70–400k.
  - Tashih: Rp0.5–3M.
  - Commissioned qari: no quote yet.
  - Reviewer honoraria: no quote yet.
  - Illustrations: optional.
- **Breach flag:** realistically this exceeds one month's ~IDR 1M LLM line once tashih, the qari and honoraria are added. It needs a separate budget line approved before any spend [ALWAYS ASK PERMISSION].
- **Juz 'Amma narration** (IDR 3.5–5M) breaches the cap unless phased over at least 4–5 months.
- **Runtime cost** is about 0, provided no runtime LLM is used.

**Operations and technology**
- **H – Reviewer bandwidth and availability** is the critical path.
- **M – VPS RAM and disk are unknown.** A second Next server plus concurrent Docker builds on a "4-vCPU" machine needs a mem_limit, a flock and CI-built images.
- **M – Deploy coupling.** `--remove-orphans` would delete the module's containers unless it has its own compose project name. Without `paths-ignore`, every module commit triggers the user-facing update overlay.
- **M – Sign-in.** The spike on the `__Secure-` cookie over internal HTTP may fail; the fallback shares NEXTAUTH_SECRET, which widens the blast radius.
- **M – The TTS preprocessors are lost** (the /tmp scripts are gone). The first render risks the 2026-06-14 failure modes.
- **M – Vendor drift.** QF production approval has an unknown lead time and the legacy v4 API returns 503s. ElevenLabs v3 with-timestamps sometimes returns no audio, and v4 behaviour "may shift".

**Product (engagement vs adab)**
- **M – Gamification.** Hearts, leaderboards, paid random rewards, destructive animations and religious-status badges would breach adab. The pedagogy report's spec avoids them; keep it.
- **M – Wrong arrangements of ayat.** Showing them in mushaf typography is a risk; get an ustadz ruling before shipping Susun Ayat or Rumpang.
- **L – Too much ikhtilaf** shown to beginners undermines "simple". Show one main reading, with other views in a collapsed chip.

## DECISIONS
DECISIONS NEEDED BEFORE BUILD (options → recommended default)

D1. **Free or paid.** Options: free / freemium / bundled with Kelas. Default: free with no ads in v1. The paid seam is "Setor ke Ustadz" via Kelas later. Even if free, avoid Tanzil translations and QuranicAudio files.

D2. **Qur'an text and script.** Options: Mushaf Standar Indonesia (MSI) via LPMQ / Tanzil Madani. Default: send the LPMQ letter now, asking for the MSI text, the Kemenag 2019 translation, the Isep Misbah font, and a tashih ruling. Key all data rasm-agnostically on surah:ayah:word. A closed beta may run on Tanzil (verbatim). Public launch uses MSI if LPMQ requires it.

D3. **Tashih.** Options: ask first / launch and see. Default: ask first. Keep the module invite-only and noindex until LPMQ answers. Budget Rp0.5–3M and 1–3 months. Define a minimal "master" (Qur'an text + translation) so that quizzes and UI can change without triggering re-tashih, if LPMQ agrees.

D4. **Recitation source.** Options: stream QF / commission a qari / both. Default: both.
- v1 streams Husary Mu'allim (QF id 12) for listening, with the karaoke highlight and repeat-after-me (Tirukan) mode.
- In parallel, get a quote for an Indonesian qari with sanad, in Hafs: Al-Fatihah, the 29 isolated words, and the ayah-final forms, under a perpetual licence that allows cutting and offline use.
- Isolated-word drills wait for that recording.

D5. **How audio reaches the learner.** Options: browser hits the QF/EveryAyah CDN directly / server proxy with no cache over 7 days. Default: direct, disclosed on the privacy page, with a CSP media-src allowlist.

D6. **Word timings.** Default: self-host quran-align (CC BY 4.0) and validate it against the streamed file.

D7. **Indonesian translation.** Default: official Kemenag 2019 once permission is granted. Until then, QuranEnc indonesian_affairs, labelled exactly as QuranEnc names it with its version. Word glosses are written in-house and reviewed.

D8. **I'rab and morphology.** Default: human-authored and cited to Darwish / al-Jadwal / al-Mujtaba (vol/page), cross-checked against MASAQ v6 and QAC 0.4. Datasets are authoring aids only; any QAC corrections go in an overlay table. One main reading per word, with a collapsed "Pendapat lain" chip. Quizzes accept the alternative readings as "also valid".

D9. **Rule wording.** Default: the operator approves the extended retrieval rule (gap 3) and a module audio rule set (the audio report's A1–A12).

D10. **Non-Qur'anic Arabic audio** (hadith matn, grammar examples, tasrifan). Options: human / TTS. Default: human for v1, since the set is small. TTS speaks only Indonesian and letter names.

D11. **Narration voice.** Options: designed non-identifiable AI voice / a consented ustadz's professional clone / the existing clones. Default: designed voice labelled "Narasi: suara AI", unless written consent exists. Keep eleven_v3 and the house settings. Any v4 A/B test needs explicit operator approval.

D12. **Exercises that touch ayah text.**
- Perbaiki Harakat: drop from v1, or use only non-Qur'anic example words.
- Susun Ayat and Rumpang Audio: ship only after an ustadz ruling, with the presentation constraints (wrong arrangements never in mushaf type; the correct ayah is always replayed).

D13. **Runtime AI and learner audio.** Default: none in v1. No teach-back, no ASR, no server-side recordings.

D14. **Identity and placement.** Default: the `/belajar` path, served by its own container. Session introspection is spiked first. Anonymous use is first-class, with localStorage merged into the account on login. Progress goes in a separate `dakwah_belajar` database. Every database create, Caddy change and commit is asked first.

D15. **Minors.** Default: no child accounts in v1. Parent-led use goes through the parent's account.

D16. **Language.** Default: Indonesian only in v1; English in v2. English doubles review and narration work.

D17. **Gamification and certificates.** Default: adopt the pedagogy report's adab spec (weekly istiqamah goal with grace, no hearts or leaderboards). No certificate in v1.

D18. **Budget.** Default: a separate one-time pilot budget line that the operator caps. Every render and purchase shows a cost estimate and waits for the operator's go.

D19. **Reviewer panel.** Default: at least 2 named reviewers (nahwu-sharaf; tajwid/qira'at with sanad) plus a hadith check. Sign-off is recorded against the content sha256. Agree honorarium and turnaround before authoring starts.

D20. **Editorial policy.**
- Default numbering: Kufan/Hafs, with the basmalah as 1:1. Note the difference of views neutrally.
- 1:7: describe the traits first (Ibn Kathir). The scholar decides whether to cite Tirmidhi 2954.
- Avoid the Madarij three-types-of-tawhid framing.
- No numerology.
- Mukhtasar cards: whole or not at all.

D21. **Platform consistency.** The operator confirms what "vc" means in the qari-*-haidir-vc files, and decides whether the no-synthetic-Qur'an rule applies platform-wide.

## MVP_AND_METRICS
MVP BOUNDARY

**v1 — Al-Fatihah, closed beta, then public after LPMQ answers**
- **Content:** 7 ayat and 29 words. For each word: our own Indonesian gloss, root/lemma/wazn, case plus a one-line "why kasrah/dhammah/fathah" reason, and a collapsed ikhtilaf chip. One light tafsir note per ayah from retrieved sources (Ibn Kathir AR / al-Tabari snapshot, rendered in reviewed Indonesian; Kemenag Tafsir Ringkas once permitted).
- **Hadith:** only those retrievable by canonical citation, each with a reviewed Indonesian translation: Bukhari 756, 780, 4474, 4704, 5007; Muslim 394, 395, 806.
- **Audio:**
  - Streamed Husary Mu'allim, with quran-align karaoke highlighting.
  - In-context word replay by seeking within the file.
  - 0.75× speed with pitch preserved.
  - Tirukan mode using the recording's built-in gaps.
  - About 30–50 min of Indonesian narration on eleven_v3 with the house settings. Before the first render: the Quran-guard lint and the Python preprocessors must be rebuilt with tests, and the operator must approve the cost.
- **Visual:** case shown by colour plus shape, root letters highlighted, wazn shown as a slot overlay.
- **Exercises (no AI):** Dengar & Ketuk, Ikuti Imam, Susun Makna, Tebak Dulu, Detektif Akar, Pabrik Wazan, Kenapa Harakat Ini, Sortir Akhiran, Label Peran, Kereta Idafah, Ganjil Sendiri, Peta Struktur, Dialog Qasamtu, Skenario Hidup, Jejak Kata, Tahukah Kamu, FSRS Review Harian, the Ujian Al-Fatihah final exam, and the Peta Penguasaan mastery map. Susun Ayat and Rumpang only if the ustadz ruling allows.
- **Encyclopedia:** about 10–12 reviewed facts, each with its source and method and a clickable list of locations. Examples: basmalah at 1:1 / 27:30 / 11:41; Rahman 57; ṣirāṭ 45, never plural; al-maghḍūb appears once; yawm ad-dīn 13; the istaʿāna verbs plus al-mustaʿān; the names of Al-Fatihah, using graded hadith only.
- **Platform:** `/belajar` container, anonymous-first progress, a credits/licence page, the labels "AI-assisted, bukan fatwa otoritatif" and "Narasi: suara AI", noindex until sign-off, and link-backs from the main app (allowlisted to surah 1).

**v1.5**
- The commissioned qari: isolated-word drills, human clips of ayah-final i'rab, an offline pack.
- Setor ke Ustadz via Kelas.
- Parent and halaqah modes; a majelis taklim projector mode.
- A qira'at mini-lesson with licensed audio.
- A Peta Makhraj illustration set.

**v2**
- Al-Ikhlas, then An-Nas, Al-Falaq, Al-'Asr, Al-Kawthar and An-Nasr (narration phased to stay inside the budget line).
- English.
- A PDP-compliant teach-back.
- A memorization ASR pilot (words skipped or wrong only; never a tajwid score).
- Juz 'Amma.

SUCCESS METRICS (the targets are proposed hypotheses, to be set by the operator)

**Gates (must be 100%)**
- Every published value has a reviewer sign-off matching its content hash.
- Every Qur'an audio segment is human recitation (lint passes).
- Every fact and citation can be clicked through to its source.
- No unlicensed media is self-hosted.
- No unresolved LPMQ question at public launch.

**Quality after launch**
- Sharia or text errors reported by users are fixed within 7 days.
- No aqidah-level corrections.

**Learning**
- On a pre/post test (word meaning plus case reason), the median gain is at least 40 percentage points.
- At least 80% of exam takers pass every part.
- On a 30-day delayed re-test, at least 70% is retained.
- FSRS observed retention is about 0.85–0.9.

**Simplicity**
- A pilot with 10–20 learners from the target audiences (parents, majelis taklim, students, da'i) averages at least 4/5 on "penjelasannya jelas".
- At least 80% of pilot learners can explain the 3 case endings in their own words.

**Engagement (adab-compatible)**
- At least 40% of starters reach Unit 3.
- At least 15–20% of registered learners take the exam within 6 weeks.
- Weekly istiqamah goal hit rate and D7/D30 return are tracked.
- No streak-loss or leaderboard metrics.

**Reach**
- Click-through from briefing daleel chips and the khutbah/kultum library to lessons.
- Share of learners who log in.

**Cost**
- Pilot spend stays within the approved one-time line.
- Runtime LLM spend is about IDR 0.
- The module container stays under its mem_limit with no measurable impact on prod.