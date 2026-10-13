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
| L8 | Audience of the narration | **Adults (default).** No parent–child mode for now (operator, 2026-10-09). |
| L7 | The imam (reciter) | **Mishary Rashid Alafasy** (EveryAyah `Alafasy_128kbps`, the exact files quran-align's timings were made from) — **the only reciter, everywhere** since 2026-10-13 (L21). First decided (2026-10-09) as the *default* reciter, with Husary Mu'allim "a selectable second voice for its built-in repeat gaps"; that second voice and the setting that chose it are gone. |
| L9 | Information architecture | **`/belajar` is a hub of learning tracks**; Qur'anic Arabic (L13) is the first track, under `/belajar/{locale}/quran/{surah}/{ayah}` (old `/belajar/{locale}/{surah}…` URLs redirect). The Konsep / Kosakata / Akar library stays at hub level so later tracks reuse it. Future self-paced tracks live in the same container; paid live cohorts (`docs/kelas-plan.md`, `/kelas`) appear as a card on the hub (operator, 2026-10-09). |
| L10 | Main-site header link | **"Belajar" goes in the dakwah-lens.id header (after "Khutbah & Kultum") when the operator says so.** First decided (option b, 2026-10-09) as "after the first ustadz sign-off"; **superseded the same day: there is no human review** — content is AI-assisted and labelled "Dibantu AI · bukan fatwa", never "menunggu tinjauan ustadz". The module stays noindex and unlinked until the operator asks. |
| L11 | Review model | **No human (ustadz) review.** Outputs are AI-assisted learning material and recommendations, sourced from named kitabs and checked by deterministic tests and independent AI verification; the UI must not promise a review (operator, 2026-10-09). The `status: "draft"` field stays as pipeline state; the BELAJAR_PUBLIC draft gate must be revisited before any indexed build. |
| L12 | Ilmu Waris visibility | **Hidden on the live site until the operator says to show it** (operator, 2026-10-10: "let's hide warisan at the moment"). The code, content and checks stay. While hidden, the hub lists no Ilmu Waris card and every `/belajar/{locale}/waris…` URL answers the module's 404 (`belajar/src/proxy.ts`). To show it: add `BELAJAR_WARIS=on` to `/srv/dakwah-lens/belajar.env` on the VM and recreate the container (`up -d --force-recreate`; no rebuild, the switch is read per request — `belajar/src/lib/features.ts`). CI keeps testing the track (smoke, screenshots, end-to-end) on a container started with the switch on, and checks that the default container hides it. |
| L13 | Track name | **"Bahasa Arab Al-Qur'an" (en "Qur'anic Arabic"), not "… & Tafsir"** (operator, 2026-10-10: "if tafsir is not deep better to rephrase as learning arabic only, not plus tafsir"). Checked that day: no ayah of Al-Fatihah or the Mu'awwidzat carries a tafsir note; the lessons teach word meanings, roots, i'rab and sentence structure, with the Kemenag translation and some hadith-based facts. Ibn Kathir and the i'rab books are cited as sources for meanings, not as a tafsir layer. The "Catatan tafsir" slot stays in the code, empty. A tafsir layer may come later; the name changes back only if it is deep enough to earn it. |
| L14 | Surahs on the live site | **Al-Fatihah first** (operator, 2026-10-10: "let's focus on alfatihah first, show cards for other surah as 'segera hadir', but not clickable"). Al-Ikhlas, Al-Falaq and An-Nas (the Mu'awwidzat) keep their lessons, content and checks, but until `BELAJAR_SURAHS` lists them: the track page shows each as a card labelled "Segera hadir" that is not a link (a plain element: nothing to click or focus); the hub's "Tersedia sekarang" names Al-Fatihah only, with one "Segera hadir" line for the others; no ayah chip, concept example or word page links into them (their places show as plain text); the end of Al-Fatihah's lesson says the next surah is coming soon and offers "Ulangi Al-Fatihah", with no link and no move on; and every `/belajar/{locale}/quran/{surah}…` URL of theirs answers the module's 404 (`belajar/src/proxy.ts`; the old `/belajar/{locale}/{surah}` URLs 308 there first). To show a surah: set `BELAJAR_SURAHS` in `/srv/dakwah-lens/belajar.env` to every surah to show (e.g. `BELAJAR_SURAHS=al-fatihah,al-ikhlas,al-falaq,an-nas`) and recreate the container (`up -d --force-recreate`; no rebuild, read per request — `belajar/src/lib/features.ts`). Unset, the default, is Al-Fatihah only. CI keeps testing the Mu'awwidzat (smoke, screenshots) on a container started with every surah listed, and checks that the default container hides them. |
| L15 | Narration delivery | **Delivered at 64 kbps mono, from the 128 kbps masters** (operator, 2026-10-11, on "how to reduce the loading time? upgrade VM?": "do all three" — fetch the imam's recitation early, halve the narration files, let browsers keep them). The VM was idle; the wait was the download. The ElevenLabs renders (`mp3_44100_128`, mono) stay as masters in `belajar/pipeline/out/narration/` and are never served; `belajar/pipeline/encode_narration.py` encodes each once with ffmpeg (fixed flags, no re-recording, no ElevenLabs cost) to `mp3_44100_64_mono`, and the manifest's `audio {url, ms, sha256}` describes that delivered file. Its name hashes the text, the voice and settings, the delivery format and its own bytes, so no name ever means two files and `/belajar/media/narration/*` can be served `immutable`. The karaoke timings are unchanged (same length to the millisecond on all 335 files; 45.3 MB → 22.6 MB). A new render is delivered the same way by `render_narration.py`. A file already published is kept, never encoded again in passing: its name carries its bytes, and another ffmpeg build would rename it (`--reencode` is the deliberate way; review 2026-10-11). Delivered files are 0.45 dB quieter than their masters (LAME's own 0.95 input scale at this bitrate): uniform, inaudible, left alone. The imam's recitation is untouched: still streamed from the provider, not stored on our server. |
| L16 | Sign-in | **No sign-in and no account in the module** (operator, 2026-10-12: "there should be no login feature here"). Everything works without an account; progress and settings stay in the learner's browser (localStorage). The header Menu's "Masuk" row, `/belajar/api/me` and the session lookup against the main app (`lib/session.ts`) were removed; §7.3 and §7.4 record what that leaves. |
| L17 | Fact-card locations | **A location chip opens the ayah in a popup on the page, not quran.com** (operator, 2026-10-12: "when click these, now it opens new tab and redirect to another app. better to just show popup and show the verse (arabic + translation + play qari voice)"). The chip ("QS 2:255") is a button for a modal dialog: the reference ("QS Al-Baqarah [2]: 255"), the ayah's Tanzil Arabic and its QuranEnc (Kemenag) translation exactly as a lesson shows an ayah (footnotes, credit), and one play button for Mishary Alafasy's recitation of that ayah, streamed from EveryAyah only once pressed and stopped when the dialog closes. The data (`belajar/content/ayat/locations.json`: every ayah any fact locates, hidden surahs included; ~1 MB) is built by `belajar/pipeline/build_ayat.py` from the pinned Tanzil file and the whole pinned QuranEnc translation, checked by `validate_ayat.py` (CI: corpus-free half), and served one ayah at a time by `/belajar/api/ayah`, so no page carries it. |
| L18 | Screen awake, narration ahead | **While a lesson runs the screen stays on, and the narration of the next steps is downloaded ahead** (operator, 2026-10-12: "why my phone goes inactive while opening the app and listening to the lesson? it's like it's considered idle so the screen is lock. also why not loading future voice in advance? Now it download when i open the page or come to the slide? should be, for example when i'm still in slide 1, it already start downloading for slide 2 or even 3"). **Screen:** a Screen Wake Lock (`navigator.wakeLock.request("screen")`, `belajar/src/hooks/useWakeLock.ts`) is held while the lesson runs — started and neither paused nor finished, so also while "Tunggu saya" waits for Lanjut and while an exercise waits for the learner (`belajar/src/lib/autoplay/wake.ts`, unit-tested over every step of every Al-Fatihah lesson). **It has a time limit where the lesson waits for the learner** (review 2026-10-12: with none, a phone left at an exercise kept its screen on until the battery died): the lock is let go after 120 s of silence (`SCREEN_IDLE_LIMIT_MS`, `timing.ts`). At an exercise that is 60 s after its third and last reminder (the exercise's own `idleMs`, which starts over with any answer, right or wrong, "Tunjukkan jawaban" or another control); at a caption held by "Tunggu saya" it is the same 120 s (`heldMs`, counted by the same one-a-second idle ticks, starting over with every Lanjut). Only the lock is let go: the lesson waits where it is for as long as the learner likes, and their next action takes the lock again. It is released on pause (including a blocked sound or a failed recitation, which pause the lesson), at the end of the surah, and when the page is left mid-lesson. It is asked for again when the page becomes visible while the lesson still runs (browsers drop it on hiding), and at once when the browser takes it back while the page is still visible (the sentinel's `release` event) — unless the lock dropped had been held less than 5 s (`WAKE_REASK_MIN_HELD_MS`), so a browser that grants and drops every lock is not asked in a loop; a refused request is never repeated. It is never asked for on a page view alone. **It is kept across the hand-off to the next ayah** (review 2026-10-12: releasing it for even a moment on a phone left untouched for minutes can let the system turn the screen off right at the transition). The hand-off is a client-side navigation, so the document stays: one holder per document (module level) keeps the lock, and the next ayah's lesson adopts it without a new request. If that lesson is not running within `WAKE_HANDOFF_GRACE_MS` (10 s) of its page appearing, the lock is released, so a learner who lands there and stops does not keep the screen on. A real page leave (reload, hard navigation) ends the document, and the browser releases the lock itself. Supported by Chrome / Android 84+, Safari 16.4+ and Firefox 126+; elsewhere, or when the browser refuses, nothing happens and nothing is shown. There is no "NoSleep" video trick. **Narration ahead:** the page lists the narration the lesson will play next along its own path (`belajar/src/lib/autoplay/lookahead.ts`: the rest of this step, the next line included, then the next 2 steps — 1 with Save-Data or a 2G connection — past the exercises already done; following the pace, the remembered place and an exercise's own opening lines; never caption-only lines, never the imam's recitation, never another ayah's file), capped at ~1.5 MB by the manifests' durations at 64 kbps. **It fetches that list into the page and plays it from there** (review 2026-10-12; `prefetch.ts`, `ahead.ts`): one file at a time, `fetch(url, { cache: "force-cache" })`, same-origin only, each body read whole into a Blob and kept as url → object URL (the CSP's `media-src` allows `blob:`). The narration player (`voice.ts`, run by `useNarrationPlayer`) points its element at the copy held when there is one for the line — the same bytes, no request at all, on every browser — and at the network URL exactly as before when there is none. So what was fetched ahead no longer depends on the browser's HTTP cache serving a media request (unmeasured on iOS, and production answers narration with `Vary: Accept-Encoding`), nor on iOS preloading a media element it has not played. A new fetch starts only while the lesson runs and no sound it plays is loading or stalled, and after the line just started has been heard plus 0.5 s. A copy is kept while its file is still ahead or is playing, and revoked (`URL.revokeObjectURL`) once it has been played or the learner has jumped away from it; everything is revoked when the lesson finishes and when the page unmounts (the hand-off). What is held is at most the look-ahead's ~1.5 MB plus the file playing. **A fetch is cancelled only when its file has left the lesson's path** (a jump, the lesson finished, unmount) — never because it became the next line (the first version cancelled it there and the preload element downloaded the same file again from its first byte; the preload element is now left alone while the page fetches the next line, and given the network URL only for a file the page will not fetch). The one other case: a line that must start before its own fetch has ended streams from the network URL as before, and that fetch is cancelled rather than left to finish — the stream plays from its first bytes while a copy is of use only once whole, and two downloads of one file would share a link that is already too slow. A fetch that fails (HTTP error, network, a body shorter than `Content-Length`) is not repeated on that page: its line plays from the network. A copy that does not play is dropped and the same line starts again from the network URL — never silence. Nothing is fetched before "Mulai" beyond the idle warm of the first line (rule 19; still the preload element and the HTTP cache, unchanged). Measured on Al-Fatihah: at most ~768 KB is ahead at any moment, so the cap never cuts today; in simulated lessons at 800 kbps (every ayah, pace and start) every line after the one playing at the start plays from its copy, with one fetch per line and none cancelled. Found by those simulations and fixed: during the second part of a split line the runner warmed the first part again (`ahead.ts` `nextNarration` now follows the lesson's own path). CI (`belajar/scripts/ci/screenshots.mjs` aheadChecks, Chromium) checks on Al-Fatihah 1: nothing before "Mulai"; with the opening line's own load held back 3 s, no `fetch()` until it was answered plus the settle time; then this step's next line and the next two steps fetched one request at a time, each once, with no audio element asking for any of them; the intro line, reached by the lesson itself, playing (karaoke running) with one request in all — the page's fetch, none by the player; a line whose `fetch()` was made to fail playing from the network with "Memuat suara narator…" shown, and no new `fetch()` while that load is held back 4 s. A stubbed `navigator.wakeLock` shows a request on "Mulai", a re-request when dropped while visible, a release on "Jeda", a re-request on "Lanjutkan", none when dropped again at once, none while hidden, a re-request when visible again, none on a page view, no release across the hand-off to Al-Fatihah 2 (adopted there), and a release about 10 s after a hand-off whose next lesson does not run. **Only a real phone shows:** the screen itself staying on and going off after two minutes at an unanswered exercise (the rule is unit-tested over every Al-Fatihah exercise; too long to wait for in CI), and Safari on iOS playing the copies (object URLs on its kept audio element; CI runs Chromium). |
| L19 | Examples have a voice | **Every example a rule is explained with is shown AND heard: the imam's recitation of exactly that word, beside it — and it is chosen and labelled by what the learner HEARS** (operator, 2026-10-12: "in explanation, for example when explaining dhommah, kasrah, etc provide example + additional voice. e.g ismu (read by voice + show visual) when combined with harf jar, it becomes ismi (read by voice + visual). in principel, each explanation should be followed by examples (visual + voice)"; then "not only for harakah, but also for all rules"). On the static pages: every Konsep example row, each Harakat sign's example word, and each parts diagram's bentuk dasar tile and joined word (بِسْمِ) carry "▶ Dengarkan" (a 48px forest button; aria-label "Dengarkan bacaan imam: bismi"). The voice is never the narrator's: it is Mishary Alafasy (L7) reciting that word, cut from that ayah's EveryAyah recording by the pinned quran-align timings the lessons use — the file streams from EveryAyah only when pressed, the browser seeks to the word and stops at its end (a timer set for the end itself, `timeupdate` as the backstop, and a hidden tab stops), nothing is stored on our server. One player per page, never over another (the module's audio-start event, both ways); "Memuat bacaan imam…" once a load lasts 0.6 s, what to do from 8 s, "Coba lagi" on failure. A part of a word (bi-, -hum: a QAC segment) has no voice of its own: no imam recites it alone, the joined word voices it. **What is heard (tajwid), after a review on 2026-10-12** — every clip pointed at the right word, yet the tanwin card played "aḥad" for aḥadun and the tile ismu played "smu": (1) *Waqf.* The imam stops on an ayah's last word, so a final harakah or tanwin is not pronounced there. Example rows keep their words (the lesson's own), but a row whose word ends its ayah says so under its button, visibly and as the button's description: "Di akhir ayat imam berhenti (waqaf), jadi harakat akhirnya tidak terdengar." (en: "At the end of an ayah the imam stops (waqf), so the final vowel sign is not heard."). Decided from data, never a list: clips carry `last: true` (the ayah's word count) and the line shows when the word's ending is one the pause drops — 22 clips end their ayah, 21 carry the line (yūlad, 112:3:4, ends on a sukun: heard as written); 47 of the 200 example rows on 21 concept pages are such words, 43 with the line. An ending the line has no wording for (fathatain read ā, ta' marbuthah, a pronoun's long vowel) stops the build. (2) *A Harakat sign card teaches the sound of its sign*, so its example is a place where the sign is heard: a sign on its word's last letter never uses an ayah's last word, and a tanwin's word is followed in its ayah by an izhar letter (ء ه ع ح غ خ), as kufuwan aḥad and gāsiqin iżā are. The tanwin dhammah card now shows مٌ = m + un from سَلَٰمٌ (salāmun), QS 97:5 word 1 ("salāmun hiya": followed by ha', the ayah's first word, a clean alignment, a word every learner knows), instead of أَحَدٌ of 112:1. (3) *Hamzat washal.* A base-form tile whose word starts with ٱ and is not its ayah's first word (ismu after tabāraka, Allāhu after huwa) is played with the word before it, its button named by what is heard, with one line under it: "Di tengah bacaan, alif di awal kata ini tidak dibaca: bersama kata sebelumnya terdengar “tabārakasmu”." (en: "In mid-recitation the alif at the start of this word is not read: with the word before it you hear “tabārakasmu”."). 2 tiles (tabārakasmu, huwallāhu); derived by the build from the tile's bytes. A base-form tile is never an ayah's last word, and comes from an ayah whose alignment is clean where the Qur'an has one (an‘ama: 5:23:6, not 4:69:8). Data: `belajar/content/library.json` `clips` (word location → {url, start, end, last?}; 90 for 200 examples, 8 signs, 6 diagrams; runs "55:78:1-2", "112:1:2-3") and `parts[].tiles[].washal`, built by `build_library.py` (`pipeline/clips.py`), which also writes `pipeline/fixtures/clips_outside_lessons.json` (the Tanzil lines and quran-align entries of the 5 ayat outside the lessons), so CI — which has no corpus cache — checks those clips too; checked by `validate_clips.py` (57 planted faults, 55 of them caught without the cache) and in the browser by `scripts/ci/screenshots.mjs` (nothing fetched before a press; a press fetches that ayah; a second press stops the first while it still plays; the player stops the second within 150 ms after its word's end, measured on the element's own clock on a clip that does not end its ayah; the two lines are shown under their buttons). Still by ear only: each clip's cut (the two runs; rabbu and an‘ama, whose next word starts with hamzat washal). Not labelled yet: an example ROW whose own word starts with hamzat washal mid-ayah (46 rows, 23 words such as Allāhi after bismi) is heard without its alif, as the lesson itself plays that word. Inside the autoplay lesson: L20. |
| L20 | Examples inside the lesson | **Inside the autoplay lesson too, every rule the narrator explains is followed by an example that is shown AND recited by the imam — an example BEAT: caption + imam, no new narrator text** (operator, 2026-10-12: "in explanation, for example when explaining dhommah, kasrah, etc provide example + additional voice. e.g ismu (read by voice + show visual) when combined with harf jar, it becomes ismi (read by voice + visual). in principel, each explanation should be followed by examples (visual + voice)" and "not only for harakah, but also for all rules"; L19 did this on the static pages). Where a beat goes is derived from the content (`src/lib/autoplay/examples.ts`), never listed by hand: **(a) a concept** — after each "Konsep baru" line, a step of its own ("Contoh", so "↺ Ulangi langkah ini" plays the example again and ‹ › reach it) shows the concept's example in THIS ayah, the lesson's own word, lit on the mushaf line and recited on the stage's recitation player; when that word ends its ayah and the example is about its last harakah, one more follows from the concept's other examples, one that does not end its ayah (none needed in the lessons today). **(b) a word by its parts** — when the composition's `base` frame is on screen and its lines are said, the imam recites that bentuk dasar where the Qur'an has it (a clip of that ayah's streamed EveryAyah recording, cut by the pinned quran-align timings; nothing stored on our server), its ringed tile filled as he does; the joined word is the step's own recitation at the last frame, as before: "ismu (read by voice + show visual) … becomes ismi (read by voice + visual)". **(c) a word whose own line explains its harakah** (a word without a composition) is recited again right after that line; every Al-Fatihah word has a composition, whose step already ends with the imam reciting the word, so none there. At most two beats per rule. **Chosen and labelled by what is HEARD** (the rules of L19's review, reused, `src/lib/heard.ts` and `pipeline/clips.py`): a bentuk dasar is never voiced on an ayah's last word; ismu is played with the word before it and the caption says so ("Contoh: ismu, di QS 55:78. Bersama kata sebelumnya terdengar “tabārakasmu”, karena alif di awalnya tidak dibaca."); ar-raḥmānu is taken where it opens its ayah (QS 20:5), so its alif is read; a concept's example that ends its ayah says "Di akhir ayat imam berhenti, jadi harakat akhirnya tidak terdengar." and never names an ending as heard there (al-‘ālamīna; nasta‘īnu). The narrator never voices a Qur'anic word: the captions are on-screen text (id + en), and `content/narration/*.json` is byte-identical — nothing was rendered. **Al-Fatihah: 35 beats** — 26 concept examples and 9 bentuk dasar clips (ismu 55:78:1-2 · Allāhu 112:2:1 twice · ar-raḥmānu 20:5:1 · rabbu 41:9:13 · yaumu 37:20:4 · ṣirāṭu 6:126:2 · an‘ama 5:23:6 · gairu 74:10:3) — adding **4 minutes** (240 s in Biasa, 445 s in Pelan) to a lesson of about 73: 57 · 37 · 6 · 12 · 62 · 12 · 55 s for ayat 1–7. Seven base frames have no beat of their own, each listed with its reason: 3 are the lesson word itself, recited at the end of its step (al-ḥamdu, na‘budu, nasta‘īnu), 4 are teaching forms no word of the Qur'an has (māliku, aṣ-ṣirāṭu, al-mustaqīmu, al-magḍūbu). Two base forms moved to another place of the same bytes for a clean alignment, display only (their on-screen note): an‘ama to QS 5:23:6, the Konsep diagram's place (L19), from 4:69:8; rabbu to QS 41:9:13 ("żālika rabbu al-‘ālamīna") from 7:54:31 (alignment: insertions 4). **Behaviour**: one activity at a time, so a beat never plays over the narrator or another recording; it lasts at least its caption's reading time and is heard twice in "Pelan"; "Tunggu saya" waits for Lanjut after it; pause, resume, ↺, ‹ ›, the remembered step and the hand-off work as before; it counts as running for the screen lock (L18) and is never in the narration look-ahead (a recitation, not narration) — the clip its step is about to play is fetched ahead on the example player only while the lesson runs, 1.2 s after the step began, never with Save-Data / 2G. **Never a dead stop**: "Memuat bacaan imam…" shows as for any recitation, and a clip that fails or does not sound within 6 s is given up — the example stays 3 s with "Suara contoh ini belum bisa diputar. Pelajaran berlanjut sendiri." and the lesson goes on (unlike the ayah's own recitation, without which there is no lesson). Clips of other ayat play on a third Audio element kept for the visit and unlocked in the one "Mulai" tap with a moment of silence (a blob: no request), like the stage's and the narrator's. Data: `belajar/content/compose/<slug>.json` `examples` (per base frame: the place, the clip, `washal`; or why it has none), built by `build_compose.py` with `pipeline/fixtures/compose_examples.json` (the 7 ayat outside the lessons, so CI checks the clips without the corpus cache). Checked by `validate_compose.py` (65 planted faults), `src/lib/autoplay/checks.ts` `exampleProblems` over every lesson (every concept line and every composition followed by an example with its Arabic and a recording, or listed with the reason), `src/components/autoplay/examples.test.ts` (28 planted faults; the machine at every beat and pace) and in the browser by `scripts/ci/screenshots.mjs` `exampleChecks` and `linebreaks.mjs`. The Mu'awwidzat lessons (hidden, L14) get the mechanism — concept examples and (c) — with no content work yet. Still by ear and on a phone only: each clip's cut, and iOS Safari letting the example player sound after the one tap and across the hand-off. Optional, not done (paid): a spoken lead-in before each beat ("Contohnya:"), which needs a narration render. |
| L21 | One imam, no reciter setting | **Mishary Rashid Alafasy is the one imam of every recitation in the module, and the learner is given no reciter to choose** (operator, 2026-10-13: "better to use alafasy for all? no need to give option to user to change" — asked after a report that an example's base form was always recited by Alafasy even when the learner had chosen Al-Husary). So: the lesson's "⚙ Pengaturan" panel has no "Suara imam (qari)" choice (it keeps the pace, the imam's speed and the text size); every lesson ayah ships exactly ONE recitation, Alafasy's EveryAyah file with its quran-align word timings (`content/<surah>.json` `recitation`: a list of one; `schema.ts` and `pipeline/validate.py` refuse a second reciter or another one in his place, and `validate.py` refuses another reciter's quran-align member or EveryAyah probes pinned in `sources.json`); the stage, the standalone "Dengar dan klik", the word cards' "Dengar", the examples' clips (L19, L20) and the ayah popup (L17) all play the same imam. Husary Mu'allim's entries, his pinned timings and duration probes, his credit on the Kredit page and the messages that described his repeat gaps were removed, and each lesson's `data_versions.quran_align` (Kredit → "Versi data") no longer names his timing file; nothing else of the content changed (words, Alafasy's timings, translations, narration, quizzes, compositions and clips are byte-identical). Supersedes the second sentence of L7, the "Husary Mu'allim (+ Alafasy)" of B4 and of §6.2's v1. CI proves the early fetch of the recitation (L15) on the next ayah's page instead of on the second reciter: the lesson reaches it by itself, with no click there, so only the early fetch asks for its recording — which the imam's step then plays with the reciters' host held back. |
| L23 | The lesson map: what an ayah brings, what it taught | **Every ayah lesson OPENS by saying what is new in it, what it repeats from earlier ayat and what it shows but only teaches later, and CLOSES by saying what it taught — one narrated line each, with a card on the stage** (operator, 2026-10-13: "at the beginning of the ayat, better to inform what concept we will learn in this ayat, also explain maybe we skip some concept and will visit later in next ayat instead of explaining all concepts in 1 ayat. for example marfu’ also exist in ayat-1, but we skipt the lesson to be done in ayat2. so at the beginning we inform what will be learnt, in the end recap what we’ve learnt"; "if some concept already done in previous ayat, we say we repeat what we've learnt before"; "cost approved, do it"; and the same day: "in ayat-1, it mentions 'bentuk tertentu' but no explanation about marfu' itself, better to inform it will be learnt later"). Nothing is written per ayah: the map is DERIVED from what the lessons already carry (`pipeline/lessonmap.py`, twin `src/lib/autoplay/lessonMap.ts`) — *new* = the Konsep whose first example is in this ayah (its "Konsep baru" lines, in that order); *review* = on this ayah's words, first taught in an earlier ayah; *later* = on its words, first taught in a later ayah (the lessons already postponed these silently). Al-Fatihah: new 5 / 3 / 1 / 1 / 8 / 2 / 6, review 0 / 4 / 1 / 3 / 1 / 6 / 9, later 1 / 2 / 0 / 0 / 1 / 0 / 0. One thing an ayah postpones is no Konsep and cannot be derived: ayah 1 shows that a base form ends in dhammah and never says why, the state being named marfu' only by a word's line of ayah 2. Such an item is AUTHORED (`pipeline/authored/<slug>.map.json` `later`: name, what is left open, the line that teaches it) and held to that line — it must exist, lie in a later ayah and really name the thing — so no pointer can be written to something no line teaches; ayah 1's base-form line now ends "Mengapa dhammah, kita pelajari di ayat kedua." (one pointer per lesson). Two new steps per ayah: `map` right after the imam's recitation (before the harakat primer and the words) and `learned` right before the recap; each ONE line built by the pipeline through the narration's own sanitiser and dictionary. The narrator names at most three new concepts (all of them up to three, else "di antaranya …") and two of more than three repeated or postponed ones; a postponed one is named with the ayah that teaches it; the card lists every one — "Baru di ayat ini", "Mengulang" (each with its ayah), "Nanti" (each with its ayah, an authored item with what is left open), and at the closing "Sudah dipelajari" with a tick per concept. A concept is called by the name its "Konsep baru: …" caption already opens with (what `src/lib/emphasis.ts` emphasises there); a title that gives no clean name needs an explicit one in the authored file — the build stops rather than guess (Al-Fatihah needs none). A map line's karaoke caption is shown one ≤180-character part at a time, so the card keeps room on a phone; on a word's card, a concept an earlier ayah taught is marked "sudah dipelajari di ayat N" (text only). **Per-surah switch in the content, Al-Fatihah only:** a surah has a map only when `pipeline/authored/<slug>.map.json` exists (→ `content/map/<slug>.json`); the Mu'awwidzat have none, and their manifests are byte-identical. The map is data for what comes next (a surah's end review is the union of its ayat's *new*). Costs 14 new narration lines and one changed line (≈2,200 characters, about USD 0.18 at list price), rendered by the operator, never by the build. Guards: `validate_map.py` and `validate_narration.py` (the opening's new concepts are the ayah's concept lines; review really earlier, later really later and on the ayah's words; the closing names what the opening named; planted faults for each), vitest (`lesson-map.test.ts`: the table above pinned, the two steps' places, the card), and a browser check on ayat 1 and 2 (`scripts/ci/screenshots.mjs` `lessonMapChecks`). |

## 3. Decisions needed (recommended default in bold)

| # | Decision | Options | Recommended default |
|---|---|---|---|
| B1 | Free or paid | Free / freemium / bundled with Kelas | **Free, no ads in v1.** "Setor ke Ustadz" (send a recording to an ustadz) becomes the paid seam via Kelas later. |
| B2 | Legal path (PMA 44) | Ask LPMQ first / launch and see | **Ask first.** Send the LPMQ letter now: tashih ruling, Mushaf Standar text, Kemenag 2019 translation, Isep Misbah font. Run as a **closed, noindex beta** until LPMQ answers. Budget Rp0.5–3M and 1–3 months. |
| B3 | Qur'an text and script | Tanzil Uthmani (Madani) / Mushaf Standar Indonesia | **Tanzil verbatim for the beta**, with all data keyed `surah:ayah:word` so the rasm can be swapped. Switch to MSI if LPMQ requires it. |
| B4 | Recitation source | Stream / commission / both | **Both.** v1 streams Husary Mu'allim (+ Alafasy) with credit (since 2026-10-13 Alafasy only: L21). In parallel, get a quote from an Indonesian qari with sanad (Hafs) for: Al-Fatihah, the 29 isolated words, and the ayah-final word forms, under a perpetual licence that allows cutting and offline use. |
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
| Arabic + recitation | The ayah streams in the imam's recitation (Mishary Alafasy, L21; first planned as Husary Mu'allim) and the word is highlighted. Tapping the word replays just that span (seek within the file; no cut file is created). | Tanzil text; quran-align timings |
| Meaning | "segala puji" (our reviewed gloss, anchored to the official translation) | In-house, reviewed |
| Root | ح م د, highlighted inside the word (QAC: 63 occurrences) | QAC 0.4 |
| Pattern | فَعْل (masdar) | Darwish / al-Jadwal, cited |
| Case badge | **marfū' — dhammah** (shown with colour + shape, readable for colour-blind learners) | Darwish 1/14; al-Jadwal |
| "Why" sentence | "Dibaca dhammah karena ia **mubtada'** — pokok kalimat." | Darwish; al-Jadwal (paraphrased and cited) |
| Pendapat lain | A collapsed chip for alternative readings, e.g. the scholars' views on the *al-* in al-ḥamd | ad-Durr al-Mashun |
| Narration | A 60–90 s Indonesian clip, with highlights synced to the screen | ElevenLabs, reviewed script |
| Tahukah kamu | "(Wa/fa) al-ḥamdu lillāh appears in 23 ayat, and 5 surahs open with it." | Tanzil query, method shown |

**Ayah layer:**
- one light tafsir note (Ibn Kathir AR / al-Tabari from the corpus, rendered into reviewed Indonesian) — not built; deferred, and the track is named for Arabic only (L13);
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
| Listening & recitation | **Dengar & Ketuk** (tap the word the imam says), **Ikuti Imam** (karaoke at 0.75×, loop a word), **Tirukan** (repeat in the recording's built-in gaps: Husary Mu'allim's had them, the one imam's of L21 has none, so this idea needs another design) |
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
| Word timings | **cpfair/quran-align** (CC BY 4.0; Alafasy — Husary Mu'allim too until L21) | QF segments (identical for 1:1–7) | Validated per word by a human |
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
- **v1:** stream **Husary Mu'allim** (QF recitation 12; per-ayah files with built-in repeat gaps) and **Alafasy** (listening) with credit. *Superseded 2026-10-13 (L21): Alafasy only, one imam everywhere, no reciter setting.*
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
- **Caching:** the renders (masters) are named by the hash of (text + voice + model + settings) and kept, so unchanged segments are never re-rendered. What is served is each master's 64 kbps mono delivery encode, named by that hash, the delivery format and its own bytes, and cacheable for good (L15).
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
- **No sign-in (L16, operator 2026-10-12).** The module never asks who the learner is: no "Masuk" link, no session lookup against the main app, no account. Progress, the remembered step of each ayah and the text size are kept in the learner's browser (localStorage) and stay on that device.
- Until 2026-10-12 a signed-in main-site user was recognised by forwarding their cookie to `http://web:3000/api/auth/session` (lib/session.ts, `/belajar/api/me`) and named in the Menu. That code is gone; bringing sign-in back is a new decision, not a switch.

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
- **Unused since L16 (2026-10-12):** every table above is keyed by a main-app `user_id`, and with no sign-in nothing reads or writes them (no code ever did). The database stays for `/belajar/api/health`; dropping the tables is a separate step that needs the operator's go.

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
- **A VM-level `flock`** (`/srv/dakwah-lens/.deploy.lock`) is taken by every writer: `deploy.yml`, `deploy-belajar.yml`, `rollback.yml` and the weekly `refresh-base-images.sh` cron. The lock is taken in the workflow YAML, which comes from the pushed commit, so it applies from the first merge. Scripts never re-take it, because a nested `flock` deadlocks.
- **The module deploy never touches the main checkout** (`/srv/dakwah-lens/repo`). CI ships a self-contained release dir (image + deploy script + compose file) to `/srv/dakwah-lens/belajar/incoming-<sha>/`. Otherwise a module deploy would move the tree the weekly root cron builds from, shipping unverified main code.
- **Image smoke test on every run, PRs included:** the real image runs against a throwaway Postgres to check migrations, health, pages and the bare-`/belajar` redirect. This catches runtime-only defects that `next build` cannot, such as a dependency Turbopack bundled away from `node_modules`.
- **DB isolation is enforced, not assumed:** PUBLIC's default CONNECT/TEMP is revoked on every database. The only other login role is the main stack's superuser. The `belajar` role gets CONNECT on `dakwah_belajar` only and a connection limit of 10.
- **`BELAJAR_PUBLIC=false`:** pages are noindex (crawlable, not robots-blocked) until the first ustadz-approved lesson ships.
- **`BELAJAR_WARIS` (L12):** unset in production, so the Ilmu Waris track is hidden (no hub card; every `/waris` URL is a 404). It is a runtime switch in `/srv/dakwah-lens/belajar.env`, not a build argument: `BELAJAR_WARIS=on` plus a container recreate shows the track. CI's smoke test checks the default container hides it, and a second container started with `-e BELAJAR_WARIS=on` runs the waris smoke, screenshots and end-to-end checks.
- **`BELAJAR_SURAHS` (L14):** unset in production, so only Al-Fatihah is published (the Mu'awwidzat show as "Segera hadir" cards, not links, and their URLs are a 404). It is a runtime switch in `/srv/dakwah-lens/belajar.env` as well: a comma-separated list of the surahs to show, plus a container recreate. The lesson pages stay prerendered; the pages that list or link surahs (hub, track, Konsep and Kosakata pages, credits) render per request, and the end of a surah's lesson asks `/belajar/api/surahs` in the browser. CI's smoke test checks the default container hides them, and a container started with `-e BELAJAR_SURAHS=al-fatihah,al-ikhlas,al-falaq,an-nas` runs their smoke and screenshot checks.

### 7.7 Main-app touchpoints

| File | Change |
|---|---|
| `deploy/Caddyfile` | The three `handle` blocks |
| `.github/workflows/deploy.yml`, `deploy/deploy.sh` | `paths-ignore`; `flock` |
| `web/src/components/Header.tsx`, `Footer.tsx` | "Belajar" nav item as a plain `<a href="/belajar/{locale}">`, gated by an `app_settings` flag (toggles without a redeploy) |
| `web/messages/{id,en}.json` | `Nav.belajar` |
| `web/src/app/[locale]/m/[id]/Article.tsx`, `kitab/page.tsx`, `DaleelChips.tsx`, `khutbah-kultum/page.tsx` | "Pelajari kata per kata →" on `QS. Al-Faatiha: n`, via a resolver `/belajar/r?c=<citation>` with a surah-1 allowlist (no copied manifest, no drift) |
| `web/src/app/robots.ts` | Sitemap list includes `/belajar/sitemap.xml` (after launch) |
| `admin/actions.ts` | ~~Signed `user-deleted` call to the module~~ — not needed: the module has no sign-in (L16) |
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
