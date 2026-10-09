# audio

## SUMMARY
- **Teaching reciter:** use Husary Mu'allim (Quran.com/QF recitation id 12) as the main voice. The Al-Fatihah word timings are clean, it's 128 kbps, and every ayah has a built-in "repeat after me" gap (measured on 1:1: speech ends at 4.13 s, silence runs to 7.84 s). Add Minshawi "with kids" for children and Alafasy for listening mode. Three famous sets (Abdul Basit murattal/mujawwad, Minshawi mujawwad) have broken word timings in Al-Fatihah, so every timing file needs an automatic check.
- **Rights are the main blocker, not technology.** The Quran Foundation terms (updated 2026-10-04) let us stream inside our app with credit. They forbid storing QF content longer than one week except through their Content Sync, and they say "audio URLs are distinct from the underlying recordings". QuranicAudio allows personal use only, and EveryAyah states no licence. Self-hosting, offline packs and saving cut word clips as new files all need written permission, or a qari we commission ourselves.
- **Cutting words out of an ayah is a tajwid problem too.** A word cut from continuous recitation is not the stand-alone word (in 1:1 the cut starts "r-raḥmāni" because of hamzat al-wasl and lam shamsiyyah). Also, all 7 ayah-final words are read with a stop, so their fathah/dammah/kasrah is never heard in any per-ayah recording. Stand-alone word drills and i'rab examples need separately recorded human audio.
- **Sharia rule: zero synthetic Qur'an.** Dar al-Ifta Egypt fatwa 8874 (Jan 2026) allows AI recitation only under strict conditions, including prior review by the official mushaf body. Al-Azhar forbids Qur'an with music. The module is stricter: the AI narrator never says Qur'anic text in Arabic script or in Latin transliteration. This is enforced by an automatic check (lint) before every render.
- **Indonesian rules may also apply.** Under PMA 44/2016 a "Mushaf" includes parts of a surah, printed or digital. LPMQ's tashih service lists "Al-Qur'an Audio/Visual" and "Mushaf Al-Qur'an Digital". Fees: Rp 500k for short surahs, plus Rp 500k for each extra material. Ask LPMQ before launch.
- **Model choice:** keep eleven_v3, the house standard, for the Al-Fatihah pilot. ElevenLabs now pushes eleven_v4 as its main model, but v4 has no style setting (so the house style 0.35 cannot carry over), its behaviour "may shift over time", and it handles accents across languages differently. A/B test v4 before scaling up. v3/v4 do not support SSML pauses, and IPA pronunciation outside English needs v4. So control pronunciation with a reviewed word list in Python, which matches the house normalisation rule.
- **Cost:** Al-Fatihah narration is about 31k–54k characters (31–54 min). With retakes that is about $4–9 of v3 API usage, or about IDR 130k–400k one-time including a Starter or Creator plan month. Scaling to Juz 'Amma (2,308 words) is about IDR 3.5–5.0M one-time. That **breaches the ~IDR 1M/month LLM line** unless it is spread over 4–5 months or given its own budget line.
- **Sync:** word highlighting during recitation uses the QF word timings. Narration uses ElevenLabs with-timestamps character timings plus hidden markers that trigger on-screen highlights. If v3 returns no audio (a known with-timestamps bug), run Forced Alignment on the audio we actually got (supports Arabic and Indonesian).
- **Delivery:** the Al-Fatihah pack is about 20–30 MB at 64 kbps mono MP3. Serve static files with byte-range support from the module's own container on the Indonesian VPS. Offline caching must use precaching plus Workbox range requests, and only for audio we own or license.

## RECOMMENDATIONS
- **Pilot with streamed audio.** Register a QF Developer Console app (OAuth2, pre-live, then production), stream Husary Mu'allim plus Alafasy and Minshawi with credit, and store word timings only via Content Sync with a sync every 7 days.
- **Ask QF in writing** about offline use, cutting word clips, and who recorded the word-by-word audio.
- **Commission our own recording for the practice lane.** Hire an Indonesian qari with sanad, in Hafs, for one studio session covering:
  - Al-Fatihah murattal and mu'allim versions;
  - the 29 words recorded on their own;
  - about 30–60 Tier-B clips (roots, verb patterns, ayah-final words in their joined form for the i'rab lessons, and the 27:30 basmalah).
  - The written licence must cover cutting, offline use, perpetual use and credit. Then submit the recording to LPMQ for tashih.
- **Ask LPMQ** whether a text+audio learning module needs a Surat Tanda Tashih (Audio/Visual or Digital category). Budget Rp 0.5–1.5M and 15–30 working days.
- **Keep eleven_v3 and the house settings for Al-Fatihah.** Before Juz 'Amma, A/B test v4 on 10 representative segments (Indonesian with loan terms) and write a new house standard if it wins. Remember v4 has no style setting.
- **Control pronunciation in Python, not in ElevenLabs.** Build a reviewed Indonesian term list (Allah→Alloh, fathah, dhammah, i'rab, isim, fi'il, Ar-Rahman, and so on) and do not upload pronunciation dictionaries to ElevenLabs. This follows the "normalize outside ElevenLabs" house rule.
- **Build the Quran-guard lint** (report §8, step 3) and the timing validator before the first render. Both must fail loudly.
- **Make lessons manifest-driven, not baked into single MP3s.** Segments should play individually so users can replay a word, see highlights and use Tirukan mode. Offer one baked MP3 per lesson only as an optional audio-only download.
- **Narration voice:** use either an ustadz who creates and verifies his own professional clone and shares it, with a written consent covering scope, script approval, takedown and credit; or a designed, non-identifiable voice clearly labelled as AI. Do not use existing clones of public ustadz without written consent.
- **ElevenLabs plan:** use Starter plus pay-as-you-go for the pilot (about IDR 130k–220k). Use Creator for the month a professional clone is needed. Print a cost estimate before every render and wait for the operator's go.
- **Delivery:** 64 kbps mono MP3 for narration, 96–128 kbps for recitation. Use content-hashed, immutable filenames, nginx/Caddy with byte-range support, and Workbox precache with RangeRequestsPlugin, for owned audio only.
- **Extra lesson ideas built on audio:**
  - **Tirukan:** use Husary Mu'allim's built-in gaps, or Minshawi with kids.
  - **Dengar & Pilih harakat:** only for the 22 mid-ayah words, where the ending is actually heard.
  - **Mu'rab vs mabni:** contrast audible endings, e.g. na'budu vs iyyāka.
  - **Madd visualiser** from word timings. Measured in 1:7: the aḍ-ḍāllīn segment runs 2.3–6.1 s across 4 reciters, against ≤1.6 s for the other words (includes trailing breath).
  - **Bandingkan qari:** the same ayah from different reciters.
  - **"Muncul juga di…":** play 27:30 words 5–8 (Husary Mu'allim 6.43–11.69 s).
  - **Qira'at intermezzo:** māliki vs maliki using a Warsh 1:4 file (exists on EveryAyah); verify the reading against a qira'at source first.
- **Scaling to Juz 'Amma:** schedule narration renders over at least 4–5 months, or get a separate module budget line approved first.

## RISKS
- **Recitation rights are unresolved.** QuranicAudio is personal use only, EveryAyah has no licence statement, and QF says audio URLs are separate from the recordings. Self-hosting, offline use or saving cut clips of famous reciters without written permission is an IP and moral-rights risk (UU 28/2014 Pasal 22). Expiry of rights on 1960s recordings needs a legal opinion. If the module ever becomes paid, for example through the planned Kelas platform, the non-commercial clauses bite harder.
- **QF terms are brand new** (updated 2026-10-04) and access needs production approval. Re-check before launch. A breach can lead to credentials being revoked immediately.
- **The current QF word-by-word reciter is UNVERIFIED.** The files were modified 2024-11-24, around a reported removal of Wisam Sharieff's recordings. QuranWBW needed special permission from Tafsir Center for its word audio.
- **LPMQ tashih may be required.** PMA 44/2016 covers digital material and parts of surahs, and LPMQ has an Audio/Visual category. This is an operator decision: ask LPMQ before going public.
- **The sharia boundary needs scholar sign-off.** Which loan terms may the AI narrator say (e.g. "Ar-Rahman" as a name of Allah, "basmalah", root letters)? Does slowing recitation playback (user-controlled, pitch preserved) count as acceptable playback? Should UI chimes exist at all? The proposed rules (Tiers A/B/C, A1–A12) should be approved by the reviewing ustadz.
- **Possible synthetic-Qur'an issue in existing work.** House memory references `qari-*-haidir-vc-norm.mp3`. If "vc" means a voice-converted qari recording, that is AI-altered Qur'an and must not be reused in this module. Operator to confirm what "vc" means.
- **Cloned-voice consent.** Existing workspace clones of named public ustadz (Syafiq Riza, Abdullah Haidir) are only usable publicly with documented consent (ElevenLabs policy §5; voice may be biometric data under UU PDP Pasal 4). A professional clone cannot be made of someone else's voice at all.
- **ElevenLabs tier is unknown.** `web/src/lib/cost-providers.ts` labels ElevenLabs "pay-as-you-go". The free tier with pay-as-you-go gives non-commercial use with attribution and no cloning, so confirm the account is Starter or higher. The per-plan pay-as-you-go conversion rate is UNVERIFIED; check the dashboard before committing.
- **Model drift and bugs.** v4 behaviour "may shift over time" and has no style setting. The v3 with-timestamps call sometimes returns no audio. Mitigation: archive masters, never re-render published audio without a script change, and fall back to Forced Alignment on the audio actually received.
- **Timing data quality.** Defects were found in 3 famous sets (Abdul Basit murattal/mujawwad 1:4, Minshawi mujawwad 1:1). Do not ship any reciter whose timings fail validation.
- **Pedagogy limit.** Ayah-final i'rab is never heard in recitation, so it needs human-recorded Tier-B examples; a cost quote for the qari/ustadz session is UNVERIFIED. The claim that Minshawi "Teacher" contains children's repetition is inferred from duration and silence analysis; confirm by listening.
- **Budget.** Al-Fatihah fits comfortably (≈IDR 130k–400k one-time for ElevenLabs). Juz 'Amma narration (≈IDR 3.5–5.0M one-time) breaches the ~IDR 1M/month LLM cap unless it is phased or separately budgeted. The operator must approve before any scale-out.
- **Future learner-recording features** (tajwid feedback) would capture biometric data, often from children (UU PDP). Default to on-device only. Do not send learner audio to ElevenLabs Scribe, which is US-hosted by default; its Singapore data residency is Enterprise-only.
- **Unverified pages.** The IDCloudHost object-storage and pricing pages returned 403. The "Rp 500/GB" storage figure and the bandwidth terms are unverified.
- **Unrelated note.** Several claude.ai connectors (Asana, Atlassian, Box, Canva, Figma, HubSpot, Intercom, Linear, Notion, monday.com) need authorisation in claude.ai connector settings. They were not needed for this research.

## REPORT
# AUDIO track: Qur'an Arabic + light tafsir module (pilot: Al-Fatihah)

Everything below was checked on 2026-10-09 unless marked UNVERIFIED. "Measured" means the files were downloaded and analysed with ffprobe/ffmpeg in `/private/tmp/claude-501/-Users-mbairm3512-Documents-SuksesBerkah-dakwah-lens/4a866c63-6436-47d4-93e9-24426863518f/scratchpad/quranmod/`. No repo files were changed.

## 1. Real recitation: candidates (measured)

| Reciter / style | Source | Format | Al-Fatihah total | Word timings | Check of 1:1–1:7 timings |
|---|---|---|---|---|---|
| Husary **Mu'allim** | QF recitation 12 → EveryAyah file | 128 kbps / 44.1 kHz | 64.8 s, 1.05 MB | QF API + QUL | clean |
| Husary murattal | QF 6 | 128 kbps (QF URL is 64 kbps) | 47.7 s | QF | clean |
| Minshawi murattal | QF 9 | 128 kbps | 44.0 s | QF | clean |
| Minshawi "Teacher" / with kids | EveryAyah `Minshawy_Teacher_128kbps`; QUL "with kids, with segments" | 128 kbps | 74.6 s, 1.19 MB | QUL only | not checked |
| Alafasy | QF 7 | 192 kbps on QF | 46.5 s | QF | clean |
| Abdul Basit murattal / mujawwad, Minshawi mujawwad | QF 2 / 1 / 8 | — | — | QF | **defects:** 1:4 has 3 words in one segment; 1:1 is merged |
| Ayman Suwaid | EveryAyah `Ayman_Sowaid_64kbps` | 64 kbps, **24 kHz** | 55.6 s | none found | n/a |
| QF word-by-word (isolated words) | `audio.qurancdn.com/wbw/001_001_001.mp3`… | 320 kbps, 29 clips | 57.6 s, 2.31 MB | one file per word | reciter UNVERIFIED |
| Muammar ZA (Indonesian qari) | blogs, archive.org | — | — | none | no licensed per-ayah source found |

**Teaching fit**
- Husary Mu'allim has a built-in repeat gap: on 1:1 speech ends at 4.13 s and silence runs to 7.84 s. That gives a ready-made "Tirukan" (repeat after me) mode.
- Minshawi's Mushaf al-Mu'allim is the recording with children repeating after him (archive.org). The EveryAyah file is 1.7× the murattal length with no long silences, which fits that. Confirm by listening.
- Ayman Suwaid would need his own word alignment and a quality upgrade.

**Data facts**
- Al-Fatihah has 29 words (QF API): 22 mid-ayah and 7 ayah-final.
- QF v4 timings arrive as `[fromIdx, toIdxExclusive, startMs, endMs]` (observed). QUL's docs describe `[wordNumber, startMs, endMs]`. We need an adapter that handles both, plus a validator.
- Loudness ranges from −18.9 LUFS (Husary Mu'allim) to −13.8 LUFS (wbw), so gain must be normalised.
- QUL lists 133 recitations: 59 with word timings, 2 mu'allim, 5 kids-repeat.
- quran-align's timing data is CC BY 4.0, within <73 ms of a reference on average, and segments 98.5–99.9% of words. It was last updated in 2017.

## 2. Rights and terms (the binding constraint)

| Source | Allowed | Not allowed / unknown |
|---|---|---|
| QF Developer Terms (updated 2026-10-04) | Use inside the app, free or paid; serving from your own backend inside the app is not redistribution; social video with credit | Storing QF content longer than 1 week unless via Content Sync (re-sync at least every 7 days); snippets that alter context; building ML models without consent; redistribution as data, downloads or packages. "Recitation metadata and audio URLs are distinct from the underlying recordings." Access needs OAuth2 client credentials, starting in pre-live, with production approval |
| QuranicAudio | "personal use free of charge" | No commercial use; files "hand ripped from cds" or taken from other sites |
| EveryAyah | — | No licence statement found (UNVERIFIED) |
| QUL | Commercial use allowed "subject to each resource's licence" | Recitation pages show no per-resource terms |
| QF word-by-word audio | Streaming via the API | QuranWBW needed "special permission" from Tafsir Center (Wahy app) for its word audio. QF's current word-audio reciter is UNVERIFIED: files are Last-Modified 2024-11-24, and Wisam Sharieff's recordings were reportedly removed in Nov 2024 (UNVERIFIED) |
| UU 28/2014 (Copyright Law) | Economic rights of performers and phonogram producers last 50 years from fixation (Pasal 63) | Performers keep a moral right against "distorsi, mutilasi, modifikasi" (Pasal 22). Husary-era recordings came from Egyptian state radio, and Sono Cairo had access to those recordings. Assuming the rights have expired is not safe without a legal opinion |
| PMA 44/2016 + LPMQ | — | A "Mushaf" includes "bagian dari surah… cetak maupun digital". Every Mushaf published or distributed needs a Surat Tanda Tashih (Pasal 2). LPMQ services include "Al-Qur'an Audio/Visual" (30 working days) and "Digital" (15 working days). PNBP fees: Rp 500k (Juz 'Amma/short surahs), Rp 1M (Mushaf), plus Rp 500k per extra material |

**Can we cut a reciter's words into a lesson?**
- **Legally:** seeking to a time range inside the unmodified streamed file, in the browser, is just playback. Saving cut files and hosting them is modification plus redistribution, so it needs written permission from QF and the rights holder.
- **Tajwid:** a word cut from continuous recitation is not the stand-alone word. In 1:1, the hamzat al-wasl and lam shamsiyyah of ٱلرَّحْمَـٰنِ merge into the word before it ("…llāhir-raḥmāni"), so the cut begins at "r-raḥmāni". Cut ranges are fine for highlighting and replay in context. Stand-alone word drills need stand-alone recordings.
- **Waqf:** the 7 ayah-final words (ar-raḥīm ×2, al-'ālamīn, ad-dīn, nasta'īn, al-mustaqīm, aḍ-ḍāllīn) are read with a stop. Their case vowel is never heard in any per-ayah file. Their i'rab has to be taught visually, plus a short human-recorded example.

## 3. Sharia: synthetic recitation

- **Dar al-Ifta Egypt, fatwa 8874 (18 Jan 2026, Mufti Nazir 'Ayyad):** AI-made recitation is allowed to help memorisation, but only with tajwid and waqf/ibtida' compliance, prior submission to the official Mushaf review body, respect for intellectual property, and no lessening of the Qur'an's sanctity.
- **Dar al-Ifta (Sept 2025, reported by El Watan):** AI produces "synthesized sounds", and recitation must come from an accountable human.
- **Dar al-Ifta (Mar 2026):** generating voices cannot replace the reciter; it set strict controls.
- **Al-Azhar Observatory (Sept 2024):** reading the Qur'an with music in any form is forbidden; it flagged AI "Quranic songs".
- **MUI:** no fatwa specifically on AI recitation was found. A "Fatwa 30/2023" cited by one site is UNVERIFIED.
- **Our stance:** stricter than the permissive fatwa. There is no synthetic Qur'an at all, because even that fatwa requires review equivalent to LPMQ's.

## 4. ElevenLabs narration (official docs)

| Model | id / ar supported | Characters per request | Pauses | Pronunciation control | Settings | API $/1K characters |
|---|---|---|---|---|---|---|
| eleven_v3 (house standard) | ✓ 70+ languages | 5,000 | no SSML break; use tags/punctuation | dictionary phonemes; IPA outside English needs v4 | stability, similarity, style | $0.08 |
| eleven_v4 (new flagship) | ✓ 90+ languages | 10,000 | no SSML | inline IPA `"/…/"` | stability + similarity only; **no style or speed** | $0.08 list ($0.022 promo until Oct 12) |
| multilingual_v2 | ✓ 29 languages | 10,000 | SSML break | alias only | full | $0.08 |
| flash_v2_5 | ✓ 32 languages | 40,000 | SSML break | alias only; normalisation off by default | full | $0.04 |

**What the docs say**
- Alias rules work on every model. Up to 3 pronunciation-dictionary locators per request.
- `apply_text_normalization` takes auto, on or off.
- `language_code` exists (not on v2); `seed` gives best-effort repeatable output.
- v4: the vendor says "strongly recommend switching", but also that behaviour "may shift over time". It deliberately changes accent handling when generating a language different from the source voice.
- v4 audio tags include sound effects and `[sings]`. That alone justifies a tag whitelist.

**Should the narrator say Arabic at all?** Three tiers:
- **Tier A — Qur'anic text in Qur'anic form:** reciter audio only.
- **Tier B — non-Qur'anic Arabic** (roots, verb patterns, grammar examples, ayah-final wasl forms): short clips recorded by a human ustadz or qari.
- **Tier C — Indonesian narration (ElevenLabs):** may use only reviewed loan terms (e.g., "fathah", "i'rab", "Al-Fatihah") written in a respelled form from the lexicon, and root letters spoken by their letter names.

**Voice and consent**
- A Professional Voice Clone (PVC) can only be made of your own voice, "even with their consent". The ustadz must create and verify it on his own account and share it.
- The Prohibited Use Policy (updated 17 Aug 2026, §5) bans replicating someone's voice "without consent or legal right", and requires telling users the audio is AI.
- Commercial rights come only with paid plans; the free plan is non-commercial with attribution. Pay-as-you-go top-ups on the free tier do not unlock cloning.
- A voice can count as biometric data, which UU PDP Pasal 4(2) treats as specific personal data.

**Timestamps**
- `/with-timestamps` returns character-level `alignment` and `normalized_alignment`.
- Known v3 bug: it sometimes returns HTTP 200 with no `audio_base64`. The fallback must time the audio we actually received, not reuse timings from a different render (Jellypod PR #149).
- Forced Alignment supports Arabic and Indonesian and is priced like speech-to-text (Scribe v2 at $0.22/hour).

## 5. Character and cost estimate

**Assumptions**
- Indonesian text runs about 7.1 characters per word, measured on 311 translation strings in the repo's `dua_library.json`. I use 7.5 to allow for normalisation.
- Speech runs about 1,000 characters per minute (docs: 5,000 characters ≈ 5 min).
- 1 USD = IDR 17,900 (JISDOR on 8 Oct 2026 was 17,890).

| Al-Fatihah narration block | Words |
|---|---|
| 29 word explanations × 60–90 words | 1,740–2,610 |
| 7 ayah intros × 80–120 words | 560–840 |
| Surah intro and closing | 300–500 |
| 8–10 intermezzo cards × 60–100 words | 480–1,000 |
| 30–40 quiz prompts + feedback × 35–55 words | 1,050–2,200 |
| **Total** | **4,130–7,150 words ≈ 31k–54k characters ≈ 31–54 min** |

| Cost line | Al-Fatihah | Juz 'Amma (564 ayahs, 2,308 words) |
|---|---|---|
| Characters including 1.5–2× retakes | 47k–107k | 2.4M–3.5M (700–1,000 characters per word × 1.5) |
| v3 at $0.08 per 1K characters | $3.8–8.6 (IDR 68k–154k) | $194–277 (**IDR 3.5–5.0M**) |
| Plan | Starter $6/mo (30k credits included, instant clone, commercial use) plus pay-as-you-go: **IDR 132k–218k**. Or Creator $22/mo (121k credits, professional clone): **IDR 394k** | Production months only. Per-plan pay-as-you-go conversion is UNVERIFIED |
| Speech-to-text / alignment QA | < IDR 5k | about IDR 150k |
| LPMQ tashih (if it applies) | Rp 500k + Rp 500k per extra material | per certificate |
| Commissioned qari plus human Tier-B clips | operator to get a quote (UNVERIFIED) | — |
| Storage and traffic | about 20–30 MB per learner | about 1–1.3 GB |

**Budget flag:** Juz 'Amma narration done in a single month breaches the ~IDR 1M/month LLM cap. Spread it over at least 4–5 months, or give the module its own budget line.

## 6. Syncing sound with what's on screen

**Recitation highlighting**
- Use QF word timings, validated for coverage, order and duration. Store them via Content Sync to stay within QF terms.
- Highlight by checking `currentTime` on every animation frame (`requestAnimationFrame`).
- Replay a word or ayah by seeking within the file.
- Slow playback uses `playbackRate` with pitch preserved, set by the user and never baked into the files.

**Narration**
- The script carries hidden markers such as `{hl:1:2:1}`. They are stripped before rendering, but their character positions are recorded. The returned character timings then tell the player exactly when to highlight that Arabic word on screen.
- Keep two strings per segment, `display_text` and `tts_text`. Spoken citations differ from displayed ones, so captions (WebVTT) are built from the alignment of `tts_text`.

## 7. Storage and delivery

- **Narration masters** come out as ElevenLabs' default `mp3_44100_128` (192 kbps needs Creator; PCM needs Pro). About 30–52 MB for Al-Fatihah.
- **Delivery format:** MP3 at 64 kbps mono, about 0.48 MB per minute, so 15–26 MB for Al-Fatihah and about 0.8–1.1 GB for Juz 'Amma. Opus has only partial support in macOS Safari (full on iOS 18.4+), so MP3 is the baseline.
- **Serving:** iOS requires byte-range support for media. Serve from nginx or Caddy with long-lived cache headers and content-hashed filenames.
- **IDCloudHost** advertises unlimited bandwidth on Cloud VPS; check the actual plan.
- **Offline (PWA):** precache with Workbox `RangeRequestsPlugin` and `crossorigin`. Caching while streaming does not work because the browser only receives partial (206) responses. Only cache owned or licensed packs, never QF-streamed audio (1-week rule).

## 8. Recommended audio architecture

- **Module container** (separate service on the Indonesian VPS):
  - static lesson packs: manifest JSON, narration MP3, timing JSON, WebVTT;
  - a small backend holding the QF OAuth token;
  - no ElevenLabs key in the web container.
- **Two recitation lanes:**
  1. **Dengar (listen):** stream famous imams via the QF API, with credit, and no offline.
  2. **Latihan (practice):** audio from a commissioned Indonesian qari with sanad, under a written licence that allows cutting, offline use and credit; submitted to LPMQ for tashih.
- **Audio build pipeline:** an offline Python command-line tool, never on the request path.

**Per-lesson pipeline (gates follow house rules)**
1. **Script** as typed segments: `narr`, `quran_ayah{ref, reciter}`, `quran_word{ref, isolated|in-context}`, `ar_human{clip}`, `pause`, `hl`.
2. **Review:** ustadz approves content and sharia; the content hash is then frozen. This is the house NEVER SKIP THE REVIEW rule.
3. **Quran-guard lint.** It fails the build on any of these:
   - Arabic script inside `narr`;
   - Latin transliteration of 2 or more consecutive Qur'anic words from the lesson's ayat;
   - audio tags outside the whitelist (sound effects, `[sings]`, music);
   - raw digits, brackets or abbreviations;
   - any `quran_*` segment without a citation.
4. **Normalise in Python**, versioned: numbers to Indonesian words, Allah→Alloh, citation expansion without brackets, SWT/SAW expansion, the reviewed term list. Set `apply_text_normalization:"off"` and fail loudly on anything unmatched.
5. **Show the cost estimate and wait for the operator's explicit go** (house rules ALWAYS ASK PERMISSION and NO-RENDER GATE).
6. **Render** on v3 with-timestamps, house voice settings, `language_code:"id"`, a fixed seed, and a cache key of sha256(text + voice + model + settings + preprocessor version). Never re-render a segment that hasn't changed.
7. **QA:** automated checks find problems (character/duration ratio, gaps over 1.5 s, clipping, LUFS, timing coverage, a speech-to-text back-check against the script). A reviewer who knows Arabic decides. Re-render only the segments that failed.
8. **Recitation assets:** validate timings and normalise gain only. No AI processing at all: no voice changer, no voice isolator, no upscaling.
9. **Package and publish** an immutable pack with credits and the AI labels.

## 9. Audio rules (proposed)

- **A1.** Qur'an audio is human recitation only, riwayah Hafs.
- **A2.** No TTS, speech-to-speech conversion, AI denoising, or baked pitch/time changes on Qur'an audio.
- **A3.** The narrator never vocalises Qur'anic text. The lint in pipeline step 3 enforces this.
- **A4.** No music under or next to Qur'an audio. UI sounds are non-musical and muted around recitation.
- **A5.** Every Qur'an clip shows surah:ayah[:word], the reciter and the source.
- **A6.** Stand-alone word drills use only stand-alone recordings. Cut ranges are for in-context use only.
- **A7.** I'rab of ayah-final words is taught visually plus a human Tier-B clip.
- **A8.** Labels: "Narasi: suara AI (ElevenLabs)", "Tilawah: <qari>", and "AI-assisted, bukan fatwa otoritatif".
- **A9.** Clone a voice only with written consent; a professional clone must be created by the voice owner.
- **A10.** Render only from the approved, hashed script.
- **A11.** Every render needs the operator's action verb.
- **A12.** QF-streamed audio is never self-hosted or cached offline for more than 7 days.

## SOURCES
- Quran Foundation Developer Terms of Service (last updated 2026-10-04) | https://api-docs.quran.foundation/legal/developer-terms/ | QF licence: non-exclusive, revocable; no sale/sublicence/redistribution as data | Caching (1-week / Content Sync), redistribution definition, snippet-context rule, attribution, ML-training ban, 'audio URLs distinct from recordings'
- Quran Foundation Content APIs OAuth2 Quickstart | https://api-docs.quran.foundation/docs/quickstart/ | Same QF Developer Terms | Auth model (client credentials, x-auth-token/x-client-id, pre-live → production)
- Quran.com API v4: recitations, per-ayah audio + word timings (queried live) | https://api.quran.com/api/v4/recitations/12/by_chapter/1?fields=segments | QF Content under the QF Developer Terms | Measured reciter list, Al-Fatihah audio URLs, word-timing format and timing defects (QF ids 1, 2, 8)
- QF Audio API docs | https://api-docs.quran.foundation/docs/sdk/javascript/audio/ | QF Developer Terms | Chapter and verse recitation endpoints, timing metadata
- QUL — recitations listing | https://qul.tarteel.ai/resources/recitation | Per-resource; not stated on page | 133 recitations, 59 with timings, mu'allim and kids-repeat sets (Husary Mu'allim, Minshawi with kids)
- QUL FAQ | https://qul.tarteel.ai/faq | QUL code MIT (GitHub TarteelAI/quranic-universal-library); data per resource | Licensing varies per resource; commercial use subject to each resource's terms
- QUL docs — With segments | https://qul.tarteel.ai/docs/with-segments | Tarteel terms of use | Timing tuple format [word, startMs, endMs]
- cpfair/quran-align | https://github.com/cpfair/quran-align | Code MIT; timing data CC BY 4.0 | Self-alignment option for EveryAyah-style audio; accuracy figures
- QuranicAudio.com — About | https://quranicaudio.com/about | Personal use only; no commercial use; files ripped from CDs and other sites | Rights posture of famous reciter mp3s
- EveryAyah recitations index | https://everyayah.com/data/recitations.js | No licence statement found (UNVERIFIED) | Availability of Husary Muallim, Minshawy Teacher, Ayman Sowaid (64 kbps), Warsh sets
- QuranWBW ABOUT.md (credits) | https://github.com/marwan/quranwbw/blob/main/src/routes/about/ABOUT.md | 'Permission must be obtained from [owners] before copying any content' | Evidence that word-by-word audio required special permission (Tafsir Center via Wahy); LPMQ font copyright note
- Wisam Sharieff Podcast — 'You Really Recorded Every Word in the Quran?' | https://www.pandora.com/podcast/the-wisam-sharieff-podcast/you-really-recorded-every-word-in-the-quran/PE:4958364 | n/a | History of Quran.com word audio (reported removal Nov 2024 — UNVERIFIED)
- Minshawi Al-Mushaf Al-Mu'allim for children (archive.org) | https://archive.org/details/Al-MushafAl-MualimForChildrenRecitedByMohamedSiddiqEl-Minshawi | Rights holder unknown | Confirms the with-children teaching recording exists
- New Lines — Rise and fall of Sawt el-Qahira (Sono Cairo) | https://newlinesmag.com/argument/the-rise-and-fall-of-sawt-el-qahira-the-arab-worlds-first-record-label/ | n/a | Provenance of Egyptian-radio-era recordings (rights-holder inference, UNVERIFIED)
- Muammar Z.A. (Wikipedia) | https://en.wikipedia.org/wiki/Muammar_Z.A. | CC BY-SA (article); recordings' rights holder UNVERIFIED | Indonesian qari candidate background
- UU 28/2014 Hak Cipta — Pasal 22 | https://pasal.id/peraturan/uu/uu-no-28-tahun-2014/pasal-22 | Public law | Performer moral rights (no distortion/mutilation/modification) → splicing risk
- UU 28/2014 Hak Cipta — Pasal 63 | https://pasal.id/peraturan/uu/uu-no-28-tahun-2014/pasal-63 | Public law | 50-year term for performers/phonogram producers
- UU 27/2022 PDP — Pasal 4 | https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-4 | Public law | Biometric data as specific personal data (voice clones, learner recordings)
- PMA 44/2016 Penerbitan, Pentashihan, Peredaran Mushaf | https://tashih.kemenag.go.id/uploads/1/2018-05/pma_nomor_44_tahun_2016.pdf | Public regulation | Mushaf definition incl. digital and parts of surahs; Pasal 2 tashih obligation; Pasal 8 text has no copyright
- LPMQ — Standar Pelayanan Surat Tanda Tashih | https://tashih.kemenag.go.id/info-layanan-pentashihan/read/standar-pelayanan-permohonan-surat-tanda-tashih | Government service standard | Audio/Visual + Digital tashih categories, processing days, PNBP fees
- Dar al-Ifta Egypt fatwa 8874 (via Darasna, Indonesian) | https://darasna.net/2026/04/07/hukum-penggunaan-kecerdasan-buatan-ai-dalam-pembuatan-mushaf-elektronik-atau-bacaan-al-quran-buatan/ | News/translation; primary fatwa text not fetched (Arabic sites returned 403) | Conditions on AI-synthesised recitation
- El Watan — Dar al-Ifta on AI Qur'an and adhan (Sept 2025) | https://www.elwatannews.com/news/details/8144661 | News | Recitation must come from an accountable human
- Ahl Masr News — Dar al-Ifta warns against synthesising recitations (Mar 2026) | https://ahlmasrnews.com/news/religion/13454227/%D9%82%D8%B1%D9%86 | News | Synthesis cannot replace the reciter; strict controls
- Egypt Independent — Al-Azhar forbids AI 'Quranic songs' (Sept 2024) | https://www.egyptindependent.com/al-azhar-issues-statement-forbidding-ai-generated-quranic-songs/ | News | No music with Qur'an
- ElevenLabs — Models | https://elevenlabs.io/docs/overview/models | ElevenLabs ToS | Model ids, languages, character limits, deprecations, v4 availability
- ElevenLabs — Eleven v4 | https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4 | ElevenLabs ToS | No style/speed setting, no SSML, behaviour may shift, accent handling, PVC rollout
- ElevenLabs — TTS best practices | https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices | ElevenLabs ToS | No SSML break on v3/v4, IPA with v4, alias tags, normalisation, audio tags incl. sound effects
- ElevenLabs — Using pronunciation dictionaries | https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries | ElevenLabs ToS | Phoneme dictionaries only on v4/flash_v2/v3; IPA outside English needs v4
- ElevenLabs Help — Do pauses and SSML phoneme tags work with the API? | https://elevenlabs.io/docs/help-center/technical/do-pauses-and-ssml-phoneme-tags-work-with-the-api | ElevenLabs ToS | Break-tag support per model; phonemes English-only on v2-era models
- ElevenLabs API — Create speech with timing | https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps | ElevenLabs ToS | alignment / normalized_alignment, apply_text_normalization, language_code, seed, output formats per tier, 3 dictionary locators
- ElevenLabs — Forced Alignment (overview + API reference) | https://elevenlabs.io/docs/api-reference/forced-alignment/create | ElevenLabs ToS | Timing fallback; Arabic + Indonesian supported; priced as speech-to-text
- ElevenLabs Pricing | https://elevenlabs.io/pricing | Paid plans grant commercial rights | Plan prices and included credits (Starter $6/30k, Creator $22/121k, Pro $99/600k, Scale $299/1.8M)
- ElevenLabs API Pricing | https://elevenlabs.io/pricing/api | ElevenLabs ToS | $0.08 per 1K characters (v3, v2, v4 list), $0.04 Flash, v4 promo, Scribe $0.22/h
- ElevenLabs — Billing and Pay As You Go | https://elevenlabs.io/docs/overview/administration/pay-as-you-go | ElevenLabs ToS | Pay-as-you-go mechanics, credit priority, free-tier limits; billing doc: free plan non-commercial with attribution
- ElevenLabs Help — Can I create a PVC of someone else's voice? | https://elevenlabs.io/docs/help-center/product/voices/voice-cloning/can-i-create-a-professional-voice-clone-of-someone-elses-voice | ElevenLabs ToS | Professional clone of own voice only; sharing flow
- ElevenLabs Prohibited Use Policy (updated 17 Aug 2026) | https://elevenlabs.io/use-policy | Binding policy | Consent for voice replication; AI disclosure
- ElevenLabs — Data residency | https://elevenlabs.io/docs/overview/administration/data-residency | Enterprise feature | Singapore isolated environment (Enterprise) option
- Jellypod speech-sdk PR #149 (v3 with-timestamps missing audio) | https://github.com/Jellypod-Inc/speech-sdk/pull/149 | n/a | Known v3 bug and why reusing timings from a different render is invalid
- Chrome Developers — Serving cached audio and video (Workbox) | https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video | Docs (CC BY 4.0 / Apache 2.0 samples) | PWA offline audio: range requests, crossorigin, precache-only
- Apple — Creating Video for Safari on iPhone (byte-range requirement) | https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/CreatingVideoforSafarioniPhone/CreatingVideoforSafarioniPhone.html | Apple docs | Server must support byte-range requests for media
- caniuse — Opus | https://caniuse.com/opus | CC BY 4.0 | Safari Opus support caveats → MP3 baseline
- IDCloudHost — VPS unlimited bandwidth (blog) | https://idcloudhost.com/blog/vps-unlimited-bandwidth/ | Marketing claim | Delivery traffic assumption (verify plan terms; pricing pages returned 403)
- Pintu News — Kurs rupiah 8 Oktober 2026 | https://pintu.co.id/news/294256-kurs-rupiah-hari-ini-8-oktober-2026-melemah-tipis-ke-rp17-893-usd | News | FX assumption (~IDR 17,900/USD)
- tafsircenter/tafsir-mcp (i'rab/sarf/root data, LICENSE-DATA) | https://github.com/tafsircenter/tafsir-mcp | Code MIT; data under Tafsir Center LICENSE-DATA (attribution required) | Cross-track pointer: certified i'rab/morphology data and Tafsir Center contact (also holds word audio rights via Wahy)