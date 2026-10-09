# quran-data

## SUMMARY
- **Qur'an text:** the Tanzil Uthmani v1.1 text file is the cleanest base to self-host. I downloaded it and read its footer: CC BY 3.0, but only verbatim copies are allowed ("CHANGING IT IS NOT ALLOWED"), and it requires attribution plus a link to tanzil.net. The Quran Foundation (QF) API is fine for live display, but its Developer Terms (updated 2026-10-04) forbid keeping QF content for more than 1 week unless it comes through their Content Sync. That rule also covers RAG embeddings built from QF content.
- **QF API access:** it now needs OAuth2 client credentials, and going to production needs QF's approval. The old free API at api.quran.com/api/v4 is deprecated. It still answered most calls today, but returned 503 on some, so nothing should depend on it.
- **Word timing (for karaoke highlighting):** QF's word timings for Husary Mu'allim (recitation id 12) and Alafasy (id 7) have the same timestamps as cpfair/quran-align for all 7 ayat of Al-Fatihah. quran-align is CC BY 4.0 and covers 12 EveryAyah reciters, including Husary_Muallim_128kbps. So we can host these timings ourselves and are not bound by QF's 1-week caching rule.
- **Recordings:** none of the sources gives a clear licence for the recordings themselves. QuranicAudio allows personal use only and no commercial use. EveryAyah publishes no terms. QF's terms say audio URLs are "distinct from the underlying recordings". For v0, stream the audio and do not re-host it. Long term, commissioning our own imam/qari recording is the only clean-rights path.
- **Indonesian word-by-word:** the only machine-readable source is QF wbw id 100 / QUL resource 96, which lists the author as "Unknown". A third-party issue tracker names Greentech Apps Foundation as the rights holder; I could not confirm that. I also found errors in Al-Fatihah: عَلَيْهِمْ is glossed "kepadanya" (singular), and ٱلْحَمْدُ is glossed just "pujian". For Al-Fatihah's 29 words, write and review our own Indonesian glosses.
- **Kemenag 2019 translation:** the official LPMQ release is a set of per-surah DOCX files (v1122), which I downloaded and checked. QF translation 33 and QuranEnc `indonesian_affairs` read differently from it in 1:1, 1:2 and 1:6, so they must not be labelled "Kemenag 2019". The main platform currently uses Tanzil/AlQuran.cloud `id.indonesian`, which is the older edition and licensed for non-commercial use only.
- **Morphology:** the Quranic Arabic Corpus (QAC) 0.4 is the de-facto source, but its terms contradict each other: a GNU GPL label, "verbatim copies only", and an FAQ that says non-commercial use. The mustafa0x fork has no licence and gives different counts: root ح م د appears 68 times there against 63 on corpus.quran.com. Root رحم matches at 339.
- **I'rab:** there is no cleanly licensed machine-readable i'rab dataset. The Da'as i'rab SQLite was scraped from quran.ksu.edu.sa and has no licence. The NoorBayan treebank is labelled MIT but is derived from QAC. The i'rab for Al-Fatihah should be written by people and cited to the printed kitab.
- **Fonts:** the King Fahd Complex (KFGQPC) fonts "may not be reproduced, modified without the express written approval" of the Complex. QF allows caching or bundling its CDN fonts if we keep an active developer account and credit QF. Amiri Quran and Scheherazade New (OFL-1.1) are open fonts we can self-host. LPMQ's Isep Misbah font (Indonesian standard mushaf style) is © LPMQ with no licence text.
- **Cost:** none of the recommended data sources costs money. The budget items are a possible commissioned recording and audio bandwidth: full-Qur'an per-ayah audio is 1.7–3.1 GB per reciter, while Al-Fatihah alone is under 10 MB.

## RECOMMENDATIONS
- **Canonical text:** use Tanzil Uthmani v1.1, verbatim, with its copyright block. Key every record on `surah:ayah:word`. Normalise Arabic (strip diacritics and tatweel, map ٱ to ا) before any phrase search. Strip Tanzil's prepended basmalah from ayah 1 of surahs 2–114 when displaying them.
- **Word timings:** self-host the quran-align JSON files (Husary_Muallim_128kbps and Alafasy_128kbps first). Show the credit "Word timings: Collin Fair, quran-align (CC BY 4.0)". This avoids QF's 1-week caching limit.
- **Recitation in v0:** stream from QF (recitation ids 12, 7, 9). Do not mirror the mp3s until the recording rights are clear in writing.
- **Recordings:** in parallel, get a quote for our own recording by a local imam/qari (7 ayat and 29 isolated words, with a perpetual licence). It is the only clean-rights route for both word audio and kids-style call-and-response.
- **Word-level audio:** play the ayah file between its segment timestamps on the client, so no derived audio files exist. Never use ElevenLabs for any Qur'anic word: ElevenLabs narrates only the Indonesian explanation and must cut to human recitation for the Arabic.
- **Indonesian glosses for Al-Fatihah:** write our own and have them reviewed (29 words). Anchor them to Kemenag 2019 and QAC morphology. Do not ship QF wbw id 100 without review; it has errors (e.g. عَلَيْهِمْ → "kepadanya").
- **Kemenag 2019:** send the LPMQ formal letter now (lajnah@kemenag.go.id, cc quran.kemenag@gmail.com). Ask for API access, use of the 2019 DOCX v1122 text, and permission for the Isep Misbah font. Until it is granted, use QuranEnc `indonesian_affairs`, labelled exactly as QuranEnc names it and with its version number. Do not call it "Kemenag 2019", because its wording differs from the official v1122.
- **English translation:** use QuranEnc `english_saheeh` v1.1.2 under QuranEnc's 7 conditions, not Tanzil `en.sahih`, which is non-commercial only.
- **QAC morphology:** download the original QAC 0.4 file and use it as authoring input only. Every root, lemma and case tag shown to learners is checked by a person and attributed to corpus.quran.com. Do not ship the raw file or a modified copy of it.
- **I'rab:** the i'rab and the "why fathah/dammah/kasrah" lessons are written by people and cited with kitab + page, consistent with the "retrieve, never invent" rule. No LLM-generated i'rab and no scraped i'rab databases.
- **Intermezzo facts:** compute counts and occurrences locally and label every number with its source and method, e.g. "menurut Quranic Arabic Corpus" for root رحم = 339 or lemma ar-Rahman = 57. Use QUL mutashabihat and similar-ayah data only as internal candidate lists for human review.
- **QF account:** register a QF Developer Console backend app now (pre-live is immediate; production needs approval). Never use QF User APIs, so learner data stays on the Indonesian VPS. Credit Quran Foundation in the module's credits page.
- **Fonts:** self-host Amiri Quran (OFL) as the default Qur'an font. Optionally use the QF CDN Uthmanic Hafs / QCF fonts under QF's font clause.
- **Credits page:** add a per-source credits and licence page listing Tanzil, QF, QuranEnc (with version numbers), QAC, quran-align, LPMQ and each reciter. It is required by Tanzil, QAC, quran-align, QF and QuranEnc.
- **Budget:** none of these data sources costs money. Put the commissioned recording and any audio CDN/bandwidth on the module's own budget line. For Al-Fatihah the bandwidth is negligible; full-Qur'an per-ayah audio is 1.7–3.1 GB per reciter.
- **Main platform (separate follow-up):** `api/src/api/scripts/download_quran.py` currently pulls Tanzil/AlQuran.cloud `id.indonesian` (older edition, non-commercial only). Its own docstring says to swap to Kemenag once licensed. This module's LPMQ request could cover both.

## RISKS
- **Decision needed: free or paid?** If the module is paid (e.g. bundled with the Kelas platform), Tanzil translations, QAC data and QuranicAudio files are excluded or need new licences. QF allows paid apps but forbids redistribution.
- **Recording rights are UNVERIFIED** for Husary (Mu'allim and with children), Minshawi (incl. the unlisted EveryAyah `Minshawy_Teacher_128kbps`) and Alafasy. EveryAyah publishes no terms. QuranicAudio says personal, non-commercial use. QF says audio URLs are "distinct from the underlying recordings". Do we accept stream-only for v0, or commission our own recording?
- **QF Content Sync and mp3 files:** it is unclear whether Content Sync lets us mirror the mp3 bytes on our VPS or only sync metadata and URLs. Ask developers@quran.com.
- **QF production approval:** lead time unknown. The legacy api.quran.com/api/v4 is deprecated; it still answered most calls today but returned 503 on `/resources/chapter_reciters`. No build should depend on it.
- **QF's 1-week rule:** it covers any pre-generated lesson pipeline that embeds or stores QF text or translations, including RAG embeddings. That pushes us to Tanzil and QuranEnc as the stored sources.
- **QAC licence is self-contradictory:** a GPL label, a verbatim-only file header, and a non-commercial FAQ. The forks (mustafa0x with no licence, NoorBayan labelled MIT) do not fix the chain. Is "authoring input with attributed derived facts" acceptable, or should we write to the QAC maintainers?
- **Indonesian wbw rights holder:** possibly Greentech Apps Foundation, per a third-party issue tracker (UNVERIFIED); the data also has quality errors. Plan to write our own glosses.
- **Kemenag 2019 permission** requires a formal LPMQ letter; no licence text is published ("All Rights Reserved"). Sources labelled "Ministry" (QF 33, QuranEnc `indonesian_affairs`) differ from the official v1122 DOCX in 1:1, 1:2 and 1:6. Labelling them "Kemenag 2019" would mislead.
- **Fonts:** the KFGQPC fonts require written approval; QF's caching clause may or may not reach the KFGQPC rights (UNVERIFIED). The LPMQ Isep Misbah font has no licence text. Product decision: should learners see the Madani (KFGQPC) script or the Indonesian standard mushaf style many of them grew up reading?
- **Counting conventions must be explicit:**
  - Whether the basmalah is ayah 1:1 (Kufan/Hafs and Syafi'i usage vs other counts).
  - "114 basmalah" is 112 surah openings + 1:1 + 27:30.
  - Root counts vary by dataset (ح م د: 68 vs 63).

  Present any scholarly differences gently and without sectarian framing (rahma/hikmah).
- **Data defects found:**
  - QF chapter-level ("QDC") Alafasy segments for 1:3 are malformed (`[1],[2],[1]`).
  - QUL issue #796 reports out-of-order Al-Fatihah word ids.
  - QAC lemma oddities (e.g. LEM `اسْتَعِينُ`).

  Every timing and tag for Al-Fatihah needs a human check before publishing.
- **Datasets rejected for unclear rights:** Quran-MD (CC0 claim over third-party recordings) and tarteel-ai/everyayah on Hugging Face (no licence).
- **Governing law:** QF terms are New York law and courts; the operator should accept that knowingly. No personal data goes to QF if User APIs are avoided (UU PDP).
- **Budget:** no breach of the current IDR 1.5–2M/month cap comes from data sources. The commissioned recording (one-off fee unknown) and any audio CDN are new cost lines the operator must approve before any spend.

## REPORT
# Qur'an data sources and licences for the Al-Fatihah learning module

**How this was checked:** live API calls, file downloads and primary terms pages (checked 2026-10-09). Scratch evidence is in `/private/tmp/claude-501/-Users-mbairm3512-Documents-SuksesBerkah-dakwah-lens/4a866c63-6436-47d4-93e9-24426863518f/scratchpad/quranmod/`. Anything I could not confirm at a primary source is marked **UNVERIFIED**.

## 1. Comparison table

| Area | Source | What you get | Access | Licence / terms (verified) | Can we self-host? |
|---|---|---|---|---|---|
| (a) Text | **Tanzil Uthmani v1.1** | Full Uthmani Hafs text in pipe-delimited txt/xml/sql | Free download | CC BY 3.0, plus: verbatim copies only, "CHANGING IT IS NOT ALLOWED"; credit Tanzil and link tanzil.net; keep the notice (read from the downloaded file's footer) | **Yes**, verbatim with the notice |
| (a) Text + fonts | **QF Content API v4** | Text fields (`text_uthmani`, `text_qpc_hafs`), QCF glyph codes `code_v1`/`code_v2`, words, translations, tafsir, audio | OAuth2 client credentials, `scope=content`, 1-hour token, headers `x-auth-token` and `x-client-id`; production needs approval | No storage beyond **1 week** unless via Content Sync; no redistribution or selling; Qur'an text unmodified; no ML training without consent; RAG allowed, but embeddings remain subject to the storage limits; paid apps allowed; New York law (terms dated 2026-10-04) | Only via Content Sync (re-sync every 7 days). Fonts may be cached or bundled with an active developer account and credit to QF |
| (a) Fonts | KFGQPC Uthmanic Hafs / QCF | Mushaf fonts | fonts.qurancomplex.gov.sa | "may not be reproduced, modified without the express written approval" | Not without approval (or under QF's font clause) |
| (a) Fonts | Amiri Quran, Scheherazade New, Noto Arabic | Open Arabic fonts | GitHub | OFL-1.1 | **Yes** |
| (b) Word-by-word (wbw) | QF wbw (ID id 100, EN id 59) / QUL 96 and 92 | Per-word glosses and transliteration | API / JSON | QF terms. ID author listed as "Unknown". EN glosses match QAC verbatim (checked on 1:7) | Content Sync only |
| (c) Morphology | **QAC 0.4** (corpus.quran.com) | Segment-level POS, root, lemma, case, mood, verb form (77,429 words) | Download needs an email | "GNU public license" label, but the file says verbatim only, and the FAQ says "You do not use the data for commercial purposes" | Use internally; do not ship a modified file |
| (c) Morphology | mustafa0x/quran-morphology | Corrected QAC fork in Arabic script | GitHub | **No licence file** | Risky |
| (c) Treebank | NoorBayan/Quranic | Constituency + dependency layers, Arabic relation labels | GitHub (.rar) | Labelled MIT but derived from QAC | Risky |
| (c) I'rab | Mr-DDDAlKilanny/tafseer-sqlite-db | Da'as i'rab as prose | GitHub | No licence; scraped from quran.ksu.edu.sa | **No** |
| (d) Word timings | **cpfair/quran-align** (2016-11-24 release) | `[w_start,w_end,ms_start,ms_end]` per ayah for 12 reciters | GitHub release zip | **CC BY 4.0** (data), MIT (code) | **Yes**, with attribution |
| (d) Ayah audio | QF recitations (ids 7, 9, 12, …) | Per-ayah mp3 plus word segments | API; URLs on verses.quran.com / mirrors.quranicaudio.com | QF terms; "audio URLs are distinct from the underlying recordings" | Stream only (UNVERIFIED whether Content Sync permits mirroring the mp3s) |
| (d) Ayah audio | EveryAyah.com | Per-ayah mp3 for 80+ reciters, incl. `Husary_Muallim_128kbps` and the unlisted `Minshawy_Teacher_128kbps` | Direct URLs / zips | **No terms published** | UNVERIFIED |
| (d) Surah audio | QuranicAudio.com | Per-surah mp3, incl. Husary with children (id 142) and al-Azazy with children (id 55) | Direct URLs | "personal use… may not use these files for commercial purposes" | No |
| (d) Word audio | QF `audio.qurancdn.com/wbw/SSS_AAA_WWW.mp3` | One mp3 per word | Via the word `audio_url` field | QF terms; reciter **UNVERIFIED** | Stream only |
| (e) ID translation | **LPMQ Kemenag 2019** | Official DOCX per surah (`Terjemahan Al-Quran_v161122.rar`); LPMQ API with text, translation, tafsir ringkas/tahlili, transliteration | DOCX: open download. API: registration form + formal letter to LPMQ + survey | Site says "All Rights Reserved"; no licence stated | After written permission |
| (e) Translations | **QuranEnc** (`indonesian_affairs`, `indonesian_complex`, `indonesian_sabiq`, `english_saheeh` v1.1.2) | Per-aya JSON, SQLite downloads | Open API | Republishing allowed if: no modification, credit publisher and QuranEnc, state the version, keep transcript info, update to the latest version, no inappropriate ads | **Yes**, under those 7 conditions |
| (e) Translations | Tanzil `id.indonesian`, `en.sahih` (what AlQuran.cloud and our current `download_quran.py` use) | Ayah text | Download | "for non-commercial purposes only" | Non-commercial only |

## 2. What I verified, by area

### (a) Text and fonts

- **Tanzil footer.** The downloaded `quran-uthmani` file carries a copyright block: CC BY 3.0 with the verbatim-only condition. Its basmalah is ayah 1:1, which is the Kufan/Hafs count.
- **Tanzil prepends the basmalah to ayah 1 of every surah.** In the default download, ayah 1 of surahs 2–114 (except 9) starts with the basmalah. After stripping diacritics I counted 114 occurrences: 112 surah openings, plus 1:1, plus **27:30**. A plain-string search found 0, so Arabic must be normalised before any matching.
- **QF font URLs** all respond:
  - `https://verses.quran.foundation/fonts/quran/hafs/v2/woff2/p{1..604}.woff2`
  - the same path under `v1/`
  - `…/uthmanic_hafs/UthmanicHafs1Ver18.woff2`
- **Spelling differs between sources.** QF `text_uthmani` writes `ٱلرَّحْمَـٰنِ` (with a tatweel), while Tanzil writes `ٱلرَّحْمَٰنِ`. Join data on word location, not on the Arabic string.

### (b) Word-by-word

- QF `/resources/word_by_word_translations` lists Indonesian as id 100 with author "Unknown".
- My Al-Fatihah sample had errors: عَلَيْهِمْ → "kepadanya" (in 1:7, twice), ٱلْحَمْدُ → "pujian", and نَسْتَعِينُ → "kami mohon pertolongan" (acceptable).
- QF's English wbw (id 59) is word-for-word identical to the QAC glosses ("You have bestowed (Your) Favors", "on themselves"). QAC's FAQ says those glosses are "based on… Sahih International, Pickthall, Yusuf Ali".
- **No Kemenag word-by-word dataset exists.** LPMQ has approved printed per-kata mushafs (Suhuf journal, 13 such titles by 2011), but none is published as data.

### (c) Morphology and i'rab

- **QAC 0.4 terms quoted on the download page:** "copy and distribute verbatim copies… CHANGING IT IS NOT ALLOWED" plus attribution and a link to corpus.quran.com.
- **QAC FAQ:** "available freely for non-commercial use under the GNU public license".
- **The new QAC v2 repo** (kaisdukes/quranic-corpus) is GPL-3.0 for its code. Its syntax diagrams are about 50% complete, per an active fork.
- **QAC's web pages carry a short Arabic i'rab per word** (e.g. "فعل ماض والتاء ضمير متصل في محل رفع فاعل"). It is not in the 0.4 download.
- **Counts depend on the source.** I computed root counts locally:

  | Root | Local count (mustafa0x fork) | corpus.quran.com |
  |---|---|---|
  | ر ح م | 339 | 339 |
  | ح م د | 68 | 63 |

  The fork adds roots to proper nouns, which accounts for the difference. Every "how many times" fact on an intermezzo card must name its source and counting method.

### (d) Audio and word timing

**Timing provenance.** QF verse segments for recitations 12 (Husary Mu'allim) and 7 (Alafasy) matched quran-align exactly for 7 of 7 ayat.

**quran-align coverage** (12 reciters):

| | |
|---|---|
| Abdul Basit | Mujawwad, Murattal |
| Sudais | |
| Shaatree | |
| Alafasy | |
| Hani Rifai | |
| Husary | 64 kbps, **Mu'allim** |
| Minshawy | Mujawwad, Murattal |
| Tablaway | |
| Shuraym | |

**Data defects.** QF's chapter-level ("QDC") Alafasy segments for 1:3 contain malformed entries (`[1],[2],[1]`). QUL issue #796 (open) reports out-of-order word ids in the Al-Fatihah timestamps.

**Teaching recitations:**

| Recitation | Where | Granularity | Notes |
|---|---|---|---|
| Husary Mu'allim | EveryAyah / QF id 12 | Per ayah | Has segments. ID3 comment: "www.AllahsQuran.com" |
| Husary with children | QuranicAudio `husary_muallim_kids_repeat` | Per surah | |
| al-Azazy with children | QuranicAudio | Per surah | |
| `Minshawy_Teacher_128kbps` | EveryAyah | Per ayah | Folder exists and returns valid mp3s, but is not listed. Whether children are on it is UNVERIFIED (1:1 is about 8.8 s, which suggests not) |

**Rights holders for the Husary and Minshawi recordings: UNVERIFIED.** The claims I found (Internet Archive uploaders, app listings) are not authoritative.

### (e) Translations

**Kemenag 2019, Al-Fatihah, three versions compared:**

| | Official LPMQ DOCX v1122 | QF 33 / QuranEnc `indonesian_affairs` |
|---|---|---|
| 1:1 | "Dengan nama Allah Yang Maha Pengasih lagi Maha Penyayang." | "…Maha Pengasih, Maha Penyayang." |
| 1:2 | "…Tuhan semesta alam" | "…Tuhan seluruh alam" |
| 1:6 | "Bimbinglah kami ke jalan yang lurus" | "Tunjukilah kami jalan yang lurus" |

- QuranEnc `indonesian_complex` and Tanzil `id.indonesian` are the older edition ("Dengan menyebut nama Allah Yang Maha Pemurah…").
- **Sahih International:** QuranEnc's `english_saheeh` v1.1.2 is "Issued by Noor International Center". The original publisher was Abul-Qasim / Al-Muntada (print editions require written permission). The current rights chain is UNVERIFIED; QuranEnc's terms are the usable path.
- **QuranEnc also serves `indonesian_mokhtasar`** (Al-Mukhtasar fi Tafsir, Indonesian; checked on 1:2). It is relevant to the "light tafsir" track.

## 3. Recommended data stack (v0 = Al-Fatihah)

1. **Canonical text and keys.** Self-host Tanzil Uthmani v1.1 verbatim with its copyright block (`https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true`). Use the Hafs/Kufan count, with the basmalah as 1:1. Use one join key everywhere: `surah:ayah:word`. That key matches QF `location`, QAC `s:a:w:seg`, and quran-align's 0-based index on the Tanzil text split by spaces.
2. **Rendering.** Self-host Amiri Quran (OFL) for Tanzil text. Optionally, the QF CDN Uthmanic Hafs font with `text_qpc_hafs` for a Madani look (credit QF, keep the developer account active). Ask LPMQ for permission to use Isep Misbah if learners should see the Indonesian standard mushaf style.
3. **Morphology.** Download the original QAC 0.4 file and use it internally as authoring input: root, lemma, POS, case/mood. Show the derived facts with the attribution "Quranic Arabic Corpus (corpus.quran.com)". Do not publish a modified file. A human checks every tag for the 29 words.
4. **I'rab and the "why fathah/dammah" explanation.** Human-authored from printed i'rab kitab, cited with page numbers. Kitab selection belongs to the curriculum track. No scraped dataset.
5. **Ayah recitation.** Stream from the QF Content API: `GET https://apis.quran.foundation/content/api/v4/recitations/{12|7|9}/by_chapter/1?fields=segments`. The exact production path prefix is UNVERIFIED; the legacy path is `/api/v4/…`. Audio URLs come back relative to `https://verses.quran.com/` or as `//mirrors.quranicaudio.com/everyayah/…`.
6. **Karaoke timing.** Self-host the quran-align `Husary_Muallim_128kbps.json` and `Alafasy_128kbps.json` files (CC BY 4.0, credit "Collin Fair, quran-align").
7. **Word audio.** Preferred: play the ayah file between its segment timestamps on the client, so no new audio files are created. Alternative: stream QF `audio.qurancdn.com/wbw/001_AAA_WWW.mp3`. Long term: commission recordings from a local qari or imam (29 words and 7 ayat for v0) under a written licence.
8. **Translations.**
   - Indonesian: Kemenag 2019 from the official LPMQ DOCX v1122 or the LPMQ API, after a permission letter.
   - Until then: QuranEnc `indonesian_affairs`, labelled exactly as QuranEnc names it, with its version number.
   - English: QuranEnc `english_saheeh` v1.1.2.
   - Word glosses: write our own Indonesian, checked against Kemenag 2019 and QAC.
9. **Intermezzo / encyclopedia.** Compute locally:
   - phrase occurrences: normalised Tanzil text (e.g. basmalah in 27:30);
   - root and lemma counts: QAC, stating "according to the Quranic Arabic Corpus" (e.g. ar-Rahman as a lemma: 57 times).

   QUL mutashabihat (5,277) and similar-ayah (4,001) sets list no licence; use them only as internal candidate generators, reviewed by people.

## 4. Self-host vs fetch

| Self-host (in the module's own container, Indonesian VPS) | Fetch live / stream |
|---|---|
| Tanzil text + notice; quran-align JSON; QAC-derived lesson cards (our own authored content); Amiri/Scheherazade fonts; our own glosses, i'rab and lesson narration audio; QuranEnc translations (verbatim, versioned); LPMQ 2019 text (after permission) | QF API text, translations and wbw (≤1 week cache, or Content Sync); all third-party recitation mp3s; QF CDN fonts (may be cached under QF's font clause) |

**Personal data:** never call QF User APIs. Learner progress stays on the Indonesian VPS (UU PDP); only anonymous content requests leave it.

## 5. Licensing risk register

- **High: recording rights** for Husary, Minshawi and Alafasy are unknown; QuranicAudio's terms exclude commercial use.
- **High: if the module is paid** (e.g. bundled with the Kelas platform), Tanzil translations, QAC and QuranicAudio are excluded.
- **Medium: QF's 1-week rule** applies to any pre-built lesson cache and to RAG embeddings.
- **Medium:** rights holder and quality of the Indonesian wbw; the KFGQPC and LPMQ fonts; LPMQ 2019 needs a permission letter.
- **Low:** Tanzil verbatim-only rule (our own glosses are separate content, not modifications); quran-align attribution.

## SOURCES
- Tanzil Quran text license (and file footer of quran-uthmani v1.1) | https://tanzil.net/docs/text_license | CC BY 3.0 + verbatim-only ('CHANGING IT IS NOT ALLOWED'), attribution + link to tanzil.net, keep notice | Canonical self-hosted Uthmani Hafs text
- Tanzil translations page | https://tanzil.net/trans/ | 'for non-commercial purposes only'; link back if >3 translations | Licence status of id.indonesian / en.sahih currently used by api/src/api/scripts/download_quran.py
- Quran Foundation Developer Terms of Service (updated 2026-10-04) | https://api-docs.quran.foundation/legal/developer-terms/ | No caching >1 week except Content Sync; no redistribution/sale; Qur'an text unmodified; fonts cacheable with active account + credit; RAG allowed but embeddings subject to storage limits; NY law | Rules for QF API usage, caching, fonts, AI use
- QF Content APIs OAuth2 Quickstart | https://api-docs.quran.foundation/docs/quickstart/ | OAuth2 client credentials; production requires approval | Auth flow, base URLs, headers
- QF Content Sync getting started | https://api-docs.quran.foundation/docs/tutorials/content-sync/getting-started/ | Only permitted path for offline copies; re-sync ≤7 days | Offline/self-host path for QF translations, wbw, recitations
- QF chapter reciter audio file endpoint (segments) | https://api-docs.quran.foundation/docs/content_apis_versioned/4.0.0/chapter-reciter-audio-file/ | QF terms | Segment format [word_index,start_ms,end_ms]
- QF font rendering tutorial | https://api-docs.quran.foundation/docs/tutorials/fonts/font-rendering/ | QF terms (font cache clause) | QCF v1/v2 page font CDN usage
- cpfair/quran-align (release 2016-11-24) | https://github.com/cpfair/quran-align | Data CC BY 4.0; code MIT | Self-hosted word timestamps for 12 reciters incl. Husary Muallim
- EveryAyah recitations list | https://everyayah.com/recitations_ayat.html | No terms published (UNVERIFIED rights) | Per-ayah audio incl. Husary_Muallim_128kbps, Minshawy_Teacher_128kbps
- EveryAyah timing files disclaimer (VerseByVerseQuran) | https://everyayah.com/data/timings_files/000_disclaimer.txt | Must link back to versebyversequran.com | Alternative (ayah-level) timing data
- QuranicAudio.com About | https://quranicaudio.com/about | Personal use only; no commercial use | Surah-level audio incl. Husary with children (id 142)
- Quranic Arabic Corpus download page | https://corpus.quran.com/download/ | 'GNU General Public License' label + verbatim-only + attribution/link | Morphology 0.4 (roots, lemmas, POS, case)
- Quranic Arabic Corpus FAQ | https://corpus.quran.com/faq.jsp | 'available freely for non-commercial use under the GNU public license' | Licence contradiction evidence; wbw gloss provenance
- kaisdukes/quranic-corpus (QAC v2) | https://github.com/kaisdukes/quranic-corpus | GPL-3.0 (code) | QAC v2 status
- mustafa0x/quran-morphology | https://github.com/mustafa0x/quran-morphology | No licence file | Corrected QAC fork (comparison only)
- NoorBayan/Quranic treebank | https://github.com/NoorBayan/Quranic | MIT label; derived from QAC (doubtful) | Candidate syntactic/i'rab labels (reference only)
- Mr-DDDAlKilanny/tafseer-sqlite-db (Da'as i'rab) | https://github.com/Mr-DDDAlKilanny/tafseer-sqlite-db | No licence; scraped from quran.ksu.edu.sa | Evidence that no clean i'rab dataset exists
- QUL resources + FAQ | https://qul.tarteel.ai/faq | Per-resource licensing; many resources show none | Indonesian wbw (96), mutashabihat, similar ayahs, recitation segments
- QUL issue #729 (KFGQPC V2 licence unclear) | https://github.com/TarteelAI/quranic-universal-library/issues/729 | Open, unanswered | Evidence of font licence ambiguity
- QUL issue #796 (audio/timestamp licence; Fatihah id order) | https://github.com/TarteelAI/quranic-universal-library/issues/796 | Open, unanswered | Evidence of audio-rights ambiguity and timing defect
- J3ff4/quran-corpus issue #116 (wbw permission requests) | https://github.com/J3ff4/quran-corpus/issues/116 | Third-party claim: Indonesian wbw = GTAF | Indonesian wbw rights-holder lead (UNVERIFIED)
- KFGQPC Uthmanic Script licence (ScanCode LicenseDB) | https://scancode-licensedb.aboutcode.org/kfgqpc-uthmanic-script-hafs.html | Proprietary: no reproduction/modification without written approval | KFGQPC font restrictions
- Amiri (incl. Amiri Quran) | https://github.com/aliftype/amiri | OFL-1.1 | Self-hostable Qur'an font
- Scheherazade New | https://github.com/silnrsi/font-scheherazade | OFL-1.1 | Self-hostable Arabic font
- QuranEnc API + terms | https://quranenc.com/en/home/api/ | Republish allowed: no modification, credit publisher + QuranEnc, state version, keep transcript info, update, no inappropriate ads | Indonesian/English translations (indonesian_affairs, english_saheeh), indonesian_mokhtasar tafsir
- Qur'an Kemenag API (LPMQ) | https://quran-api.lpmqkemenag.id/ | Registration + formal letter to LPMQ; no licence text published | Official Kemenag 2019 translation, tafsir ringkas/tahlili, transliteration
- LPMQ downloads (Terjemah 2019 DOCX v1122, Font LPMQ Isep Misbah) | https://web.lpmqkemenag.id/unduhan | '© 2023 LPMQ. All Rights Reserved'; font name table: Copyright (c) 2018 LPMQ | Official 2019 wording verification; Indonesian mushaf font
- Quran Foundation legacy API v4 (live checks) | https://api.quran.com/api/v4/resources/word_by_word_translations | Deprecated; QF terms | Verified wbw id 100 'Unknown', recitation ids, segments
- Quran-MD dataset paper | https://arxiv.org/abs/2601.17880 | Paper CC0; dataset audio provenance unclear | Rejected as an audio source (rights unclear)