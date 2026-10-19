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
python3 test_validate.py           # mutation tests: plants 74 faults in copies of the outputs and of the source registry (a second reciter in content or pinned in sources.json among them), each must fail validate
python3 build_ayat.py              # ../content/ayat/locations.json: every ayah a fact card locates, for its popup (see "Ayat popup"); after the lessons, whose facts it reads
python3 validate_ayat.py           # the popup data against Tanzil, QuranEnc, the lessons and the pins (CI: --no-corpus); exit 1 on any failure
python3 test_validate_ayat.py      # plants 28 faults (a missing or extra entry, another ayah's bytes, a stale pin, a name the cards spell otherwise, …) (CI: --no-corpus)
python3 build_compose.py           # word compositions + harakat primer + the imam's voice of each bentuk dasar ../content/compose/*.json, and fixtures/compose_examples.json (see "Komposisi kata"); after build_library.py, whose library.json it reads
python3 validate_compose.py        # composition checks against the corpus, the example voices included (CI: --no-corpus); exit 1 on any failure
python3 test_validate_compose.py   # plants 78 faults in copies of the compositions and of the examples' fixture (a base frame without its voice, a hamzat-washal form played alone, a clip shifted to the next word, a word that ends its ayah, an untrue reason, …), each must fail (CI: --no-corpus, 66 of them)
python3 validate_terms.py          # Konsep terms in Arabic script + inline markup (CI: --no-corpus); see "Konsep"
python3 test_validate_terms.py     # plants 54 faults (retyped term, unmarked term, wrong word bytes, a ref whose Latin names other bytes, ketuk, a gloss variant whose ref does not resolve, Arabic typed by hand, a marked lesson or Kosakata twin that drifted, …)
python3 validate_clips.py          # the imam's voice of every Konsep example: library.json `clips` (CI: --no-corpus); see "Suara contoh"
python3 test_validate_clips.py     # plants 58 faults (an example with no voice, an unwanted clip, another ayah's or reciter's file, a word's timing off by one in a lesson or outside the lessons, an implausible length, a Harakat sign that is not heard where its example is, an ayah's last word without `last`, a hamzat-washal tile played alone, a fixture that drifted, a stale pin, …) (CI: --no-corpus)
python3 build_curriculum.py        # the curriculum ../content/curriculum.json from authored/curriculum.json (see "Kurikulum"); after the lessons and the library, BEFORE the quizzes, the lesson map and the narration, which read it
python3 validate_curriculum.py     # the curriculum: every step in one lesson, at most three a lesson, every Konsep placed once, term owners, a step's own text and sources, the lists derived per lesson; prints the table; exit 1 on any failure
python3 test_validate_curriculum.py # plants 88 faults (a step in two lessons, a fourth step, a record placed twice or not at all, a term with two owners, a text with no source or with a Qur'anic word, a derived list that drifted, a lesson-zero slide on an ayah's step, a card showing a later lesson's term, an example the record does not have, …), each must fail
python3 build_rumus.py             # the cheat sheet ../content/rumus.json from authored/rumus.json (see "Rumus singkat"): the kitab's own words quoted from the pinned pages; after build_curriculum.py and build_surah.py; `--check` compares, `--check --no-corpus` (CI) takes the quotes from the file
python3 validate_rumus.py          # the cheat sheet: every formula's terms against its lesson, every quote the pinned page's own bytes (CI: --no-corpus); see "Rumus singkat"
python3 test_validate_rumus.py     # plants 40 faults (a typed quote, an anchor not on its page or found twice, a term of a later lesson, a pointer to an earlier step, Qur'anic Arabic in a formula, a step missing or listed twice, the wrong example, a changed pin …) + unit tests of the folding, the term rule, the pointers and the coverage (`--no-corpus` skips the 2 faults only the cache can catch)
python3 build_quiz.py              # the quizzes ../content/quiz/*.json (see "Kuis"); before the narration, which reads them
python3 build_map.py               # the lesson maps ../content/map/*.json, for the surahs switched on (see "Peta pelajaran"); before the narration, which reads them
python3 build_narration.py         # narration manifests ../content/narration/*.json (see "Narasi"); stops on a term said before its lesson that authored/curriculum.pending.json does not list (`--write-pending` writes that list: see "Kurikulum")
python3 validate_narration.py      # narration checks; exit 1 on any failure
python3 test_validate_narration.py # plants 296 faults in copies of the manifests, the lessons, the dictionary, the compositions, the lesson maps, the curriculum, the pending list and the continuation data (`continues`), each must fail (`--only <text>`: the faults and unit tests whose name holds <text>, while iterating)
python3 validate_map.py            # the lesson maps: new / learnt so far / later / next-level against the curriculum, the names against the captions
python3 test_validate_map.py       # plants 46 faults (a step in the wrong group, one taught later listed as learnt, a learnt step left out, `here` on a step that does not occur, a name that says a Qur'anic word, the kinds of word of an ayah wrong, …)
python3 validate_quiz.py           # the quiz guard: every question TAUGHT before it is asked (Al-Fatihah), or listed in authored/curriculum.pending.json; exit 1 on any failure
python3 test_validate_quiz.py      # plants 65 faults (an untaught state, an untaught option, two correct options, an untaught question not listed, a listed one that is taught, the wazan exercise in a basic lesson; an explanation shown that names an untaught term; the warm-up: a pos that disagrees with the QAC tag, a part left out, a wrong answer, a sign before its lesson, an edited sentence, the general definition "yaitu nama benda, orang, atau sifat" again, a wrong class for a tag, a class said of the Name / a participle / a relative / gair, a class not taught before it is asked), each must fail
python3 render_narration.py        # DRY RUN: characters and cost; never calls the API without --render --i-approve-spend
python3 build_wordvoice.py --check # the word voices (content/wordvoice.json): Quran.com's word file of every word at a place, the narrator's for the rest; locally also Tanzil and the downloaded copies (CI: --require-audio --no-network); --fetch-quran-com refreshes the fixture and the copies (read-only downloads)
python3 test_validate_wordvoice.py # plants 28 manifest faults (a Quran.com entry for a part or a run, another place, another host, our copy under the narrator's prefix, a missing entry, …) + the place rule, the fixture, a stale pin, the hosted pins
python3 host_media.py --check      # every hosted recording the content references (our copies of the imam's ayat and of Quran.com's words) is pinned (CI: --no-network); --fetch pins new ones, --deliver writes out/delivery + files-hosted.txt (see "Hosted recordings")
python3 encode_narration.py --check # the delivered audio (64 kbps mono) on disk is what the manifests describe (add --reencode to encode the masters again and compare); needs ffmpeg and pipeline/out, so not in CI (see "Narasi", Delivery)
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
`fetch.py --repin <id>` deliberately accepts new bytes for one input; `fetch.py --only <id>`
(repeatable) fetches or verifies only that input and leaves the others as they are (e.g.
`--only quranenc_indonesian_affairs_quran --only quranenc_sura_names` for the ayah popup's inputs on
a machine whose cache predates them). `cache/` is git-ignored.

## Files

| File | Stage | Role |
|---|---|---|
| `sources.json` | 0 | Every input: URL, version, sha256 (pinned after download), bytes, retrieval date, licence, attribution |
| `fetch.py` | 1 | Downloads into `cache/`, checks headers/licence footers, pins or verifies sha256; per-surah inputs follow `common.SURAHS` |
| `common.py` | — | Paths, the surah registry (`SURAHS`), sha256, Tanzil and QAC loaders, `lesson_ayah` (surah-heading basmalah), QuranEnc per-sura lookup, QAC Buckwalter table, search normalisation, MP3 duration probe |
| `authored/<slug>.words.json` | 3 | Hand-authored per-word values: translit, gloss, wazn, case, why, ikhtilaf, kitab sources, review notes; optionally `why_basic`, the reason as the narrator says it (see "why_basic") |
| `authored/<slug>.structure.json` | 3 | Hand-authored `Ayah.structure` (type, summary, word groups, sources) and `Word.role`, with `role_src` / pipeline review notes (never shipped); optionally `structure.items`, the same analysis as separate narrated items (see "Susunan kalimat per butir") |
| `authored/<slug>.concepts-map.json` | 3 | Word loc -> Konsep ids (`Word.concepts`); generated from the concepts' `examples`, re-checked both ways by `validate.py` |
| `authored/<slug>.facts.generated.json` | 2/3 | Facts for a surah other than Al-Fatihah: `{"facts": [Fact, …]}` in `schema.ts` shape, passed through after the `validate.py` fact checks (optional) |
| `authored/<slug>.facts.marked.json` | 3 | A marked lesson's facts with their terms and Qur'anic words marked (an overlay on the computed facts: fact id → title / body / method, each stripping to the computed text); see "Konsep" |
| `authored/<slug>.hadith.json` | 1/3 | Hadith for the lesson: `{"hadith": [Hadith, …]}`, retrieved from the platform corpus (optional; `hadith: []` without it) |
| `facts.py` | 2 | Recomputes the plan's Appendix B "Tahukah kamu?" facts for Al-Fatihah from Tanzil + QAC |
| `facts_muawwidzat.py` | 1/2 | Writes the Al-Mu'awwidzat facts and hadith files from Tanzil + QAC + the platform corpus (`--corpus api/data`); every figure is re-derived a second way, and `--check` fails if a written file differs from a fresh run |
| `ayat.py` | — | The fact cards' ayah popup data: which ayat (every fact location), the Arabic (Tanzil, heading sliced as `lesson_ayah`), the translation (QuranEnc, footnotes split as the lessons), the surah names (QuranEnc's list, folded), the build and every check, with and without the corpus |
| `build_ayat.py` | 2 | Writes `belajar/content/ayat/locations.json`; `--check` compares with a fresh build; `--check --no-corpus` (CI) only that it still covers exactly the facts' locations with the pins of `sources.json` |
| `validate_ayat.py` | 6 | The popup data checks (`--no-corpus` in CI: coverage, order, Arabic script, footnote markers, the lesson ayat byte for byte, the credit, pins, versions, the entries hash, names; locally also Tanzil, QuranEnc, the sura list and a fresh build) |
| `test_validate_ayat.py` | 6 | Planted-fault tests for `validate_ayat.py` (`--no-corpus` skips the 5 faults only the cache can catch) + unit tests of the name folding and the sura list |
| `build_surah.py` | 2 | `build_surah.py <slug>` joins everything into `belajar/content/<slug>.json` |
| `build_fatihah.py` | 2 | Wrapper: `build_surah.py al-fatihah` |
| `validate.py` | 6 | Independent re-check of every lesson and the library against Tanzil, QAC, quran-align, QuranEnc, the pins and `schema.ts` (a Python mirror of its zod rules), of every link between them, and of the app wiring |
| `test_validate.py` | 6 | Mutation tests for `validate.py` (stdlib `unittest`; `python3 test_validate.py` prints the table) |
| `authored/library.lexicon.json` | 3 | Hand-authored Kosakata + Akar values: translit, meaning, tashrif rows, i'lal, root meanings, kitab refs, review notes |
| `authored/library.concepts.json` | 3 | Hand-authored Konsep records (separate author); passed through by `build_library.py`, minus each record's reviewer-only `review_notes` |
| `build_library.py` | 2 | Joins QAC 0.4 + the authored library files into `belajar/content/library.json` (`Library`) |
| `authored/<slug>.compose.json` | 3 | Hand-authored word compositions and the harakat primer: named FORMS (each by where its bytes come from — never typed Arabic), FRAMES (the animation's stages) and the narration sentences said over each frame (see "Komposisi kata") |
| `compose.py` | — | Pieces (a letter + its marks), the deterministic edits, form resolution (lesson word / Tanzil / QAC / edit / join), chips, and every composition check, with and without the corpus |
| `build_compose.py` | 2 | Writes `belajar/content/compose/<slug>.json` — the compositions, the primer and `examples` (the imam's voice of each bentuk dasar, from the pinned quran-align file; reads `content/library.json` for the transliteration typed for a word outside the lessons) — and `fixtures/compose_examples.json`; prints every base frame with its voice or the reason it has none; `--show <loc>` prints a word's pieces and QAC segments, `--find <loc>` where that token stands in the Qur'an |
| `fixtures/compose_examples.json` | — | Written by `build_compose.py`: the Tanzil line and the quran-align Alafasy entry of every ayah an example clip of the lessons uses outside the lessons (7 ayat), exactly as the pinned files have them, so CI (no cache) can check those clips too. Never edited by hand |
| `validate_compose.py` | 6 | Composition checks (local: Tanzil/QAC bytes, attestations, parts = QAC segments, equality with a fresh build; `--no-corpus` in CI: replays, stages, last frame = the word, authored hash) and the example voices (every base frame has its entry; what is heard; the clips through `clips.problems`: the lessons' own timings, the fixture, the pin — locally also a fresh cut and the fixture against the pinned files) |
| `test_validate_compose.py` | 6 | Mutation tests for `validate_compose.py` (`--no-corpus` skips the corpus-only faults by name) + unit tests of the voice rules (which place, the run with the word before it) |
| `authored/library.terms.json` | 3 | The ONE table of grammar terms in Arabic script (latin, forms, ar, group, harakah reminder), each spelling attested by the pronunciation dictionary or a pinned Shamela excerpt; unverified terms have `ar: null` + a reason |
| `authored/library.basics.json` | 3 | Dasar membaca: the Harakat page (signs with an example letter as a q-ref into Tanzil) |
| `authored/library.parts.json` | 3 | Words explained by their parts (rule 14): tiles as q-refs (each part's bentuk dasar), the letters that change and the letters not written, sourced steps |
| `terms.py` | — | Term table checks (folded attestation, vowel compatibility, confirmed harakat), Shamela page-text extraction, the `[[…]]` markup (parse, strip, unmarked forms, a term ref's surface, a q-ref's Latin against its bytes), meanings ("yang artinya"), q-ref resolution, letters, parts arithmetic, the Harakat signs |
| `validate_terms.py` | 6 | Konsep terms + markup + Qur'anic bytes; `--no-corpus` in CI, full with the cache locally |
| `test_validate_terms.py` | 6 | Mutation tests for `validate_terms.py` (`--no-corpus` skips the 2 faults only the cache can catch) |
| `clips.py` | — | The imam's voice of every example the static pages show (library.json `clips`): which examples, the clip of each from the pinned quran-align file (build_surah.word_segments / everyayah_url, the lessons' own mapping), what is HEARD there (the imam's stop at an ayah's end, a Harakat sign that must sound, hamzat washal), the fixture of the ayat outside the lessons, and every check, with and without the corpus |
| `fixtures/clips_outside_lessons.json` | — | Written by `build_library.py`: the Tanzil line and the quran-align Alafasy entry of every ayah a clip uses outside the lessons (5 ayat), exactly as the pinned files have them, so CI (no cache) can check those clips too. Never edited by hand |
| `validate_clips.py` | 6 | The clip checks (`--no-corpus` in CI: coverage, URLs, lengths, the lessons' own timings, the clips outside the lessons against the fixture, the heard rules, the pin; locally also a fresh build, the Tanzil tokens and the fixture against the pinned files) |
| `test_validate_clips.py` | 6 | Planted-fault tests for `validate_clips.py` (`--no-corpus` skips the 2 faults only the cache can catch, and a test shows those two do pass without it) + unit tests of the keys, the length caps, what a pause drops, the hamzat-washal run and the fixture |
| `build_narration.py` | 3 | Writes the guided-lesson narration manifests `belajar/content/narration/<slug>.json` + `shared.json` (spoken text, caption, highlight, word card) from the lessons, the library and `authored/pronunciation.json` (templates + content fields; see "Narasi") |
| `validate_narration.py` | 6 | Narration checks: step-id coverage, the pronunciation dictionary, no Qur'anic word in any spelling or script, Arabic only from the dictionary, caption = speech, highlight/focus, audio entries and karaoke tokens, manifests equal a fresh build; the "Konsep baru" lines and the lesson-map lines against the curriculum; no term before its lesson (or listed in `authored/curriculum.pending.json`, both ways) |
| `test_validate_narration.py` | 6 | Mutation tests for `validate_narration.py` + unit tests of the speech text, dictionary rendering, tokens, numbers and render request |
| `render_narration.py` | 4 | ElevenLabs renderer with word timings (`/with-timestamps`; dry run by default; spends only with `--render --i-approve-spend`); keeps the 128 kbps render as the master and delivers it through `encode_narration.deliver` |
| `encode_narration.py` | 4 | The delivery encode: each master → 64 kbps mono MP3 with ffmpeg (fixed flags, same bytes every run), named by its text, format and bytes; writes the manifests' `audio {url, ms, sha256}`; refuses a drift over 80 ms or a karaoke token that no longer fits |
| `authored/curriculum.json` | 3 | THE BASIC CURRICULUM (operator-approved 2026-10-13): the units, the 32 lessons in teaching order, the 36 steps (each in one lesson; a Konsep record, a part of one with its own `teach` text and kitab sources, or a basics record), where a step occurs (`occurs`), the terms each step owns, the free terms and the next-level records (see "Kurikulum") |
| `authored/curriculum.pending.json` | — | What is still said before its lesson: `lines` (narration line id → the terms) and `quiz` (question → the terms). Written by `build_narration.py --write-pending`, never by hand; the build and the validators fail on a use that is not listed and on a listed one that is gone, so it only shrinks (see "Kurikulum") |
| `curriculum.py` | — | The curriculum's rules (stdlib): teaching order, which lesson teaches a step, where a step occurs (case state, QAC tag, always, the record's tags and structure groups), the lists derived per written lesson (`lines`; `map`: new, learnt so far with `here`, later, next-level), who owns a term, what is too early, the pending list both ways |
| `build_curriculum.py` | 2 | Writes `belajar/content/curriculum.json` (the authored file + each step's spoken name and text through the narration's sanitiser and dictionary + the derived lists); `--show` prints the table |
| `validate_curriculum.py` | 6 | The curriculum checks, each on its own (see "Kurikulum"); equality with a fresh build; prints the per-lesson table and the totals |
| `test_validate_curriculum.py` | 6 | Planted-fault tests for the curriculum + unit tests of the occurrence rule, the teaching order and the pending list |
| `authored/rumus.json` | 3 | THE CHEAT SHEET "Rumus singkat" (operator 2026-10-13/14): per curriculum step a short formula (`rumus`, Konsep markup), its limit (`awas`, only where a quoted sentence says it) and `sumber` — a pinned Shamela page and, per sentence, the FOLDED consonant skeleton of the kitab's words (never the words); a step with no sourced formula has no entry. Generated once, edited by hand |
| `rumus.py` | — | The cheat sheet's rules (stdlib): folding and finding an anchor as a run of whole words in the pinned page's matn, taking the page's own bytes, the term rule through `curriculum.too_early`, the `{{di:step}}` pointers, the example word, the build and the checks |
| `build_rumus.py` | 2 | Writes `belajar/content/rumus.json`; `--check` compares with a fresh build; `--check --no-corpus` (CI) takes each quote from the file and holds it to its anchor; `--show` prints the sheet |
| `validate_rumus.py` | 6 | The cheat sheet checks, each on its own; `--no-corpus` in CI; the per-unit count of formulas with and without |
| `test_validate_rumus.py` | 6 | Planted-fault tests for `validate_rumus.py` + unit tests (`--no-corpus` skips the faults only the cache can catch) |
| `authored/<slug>.map.json` | 3 | The per-surah switch of the lesson map (Al-Fatihah only): its existence switches the surah on. It holds only `names`, an explicit short name for a next-level record whose caption title gives none (Al-Fatihah needs none); the authored "later" items of version 1 are refused (marfu' is a step of the curriculum now) |
| `lessonmap.py` | — | The lesson map (version 2): the curriculum's four lists per ayah (new, learnt so far with what comes up again, later, next-level) with each step's and record's name, the name cut, the file format and its checks |
| `build_map.py` | 2 | Writes `belajar/content/map/<slug>.json` for the surahs switched on (names through the narration's sanitiser and dictionary); `--show` prints the table |
| `validate_map.py` | 6 | The lesson map checks: every rule on its own against the curriculum, the names against the "Konsep baru" captions, no Qur'anic word in a name, equality with a fresh build |
| `test_validate_map.py` | 6 | Planted-fault tests for the lesson map + the Al-Fatihah table pinned |
| `authored/<slug>.quiz.json` | 3 | Hand-authored quiz plan (Al-Fatihah): per ayah the exercises kept, each question's word and the words whose reason / role are its wrong options, the sort bins (see "Kuis"; no wazan exercise since 2026-10-13: decision 6 of the curriculum) |
| `quiz.py` | — | The quiz plan: resolving an authored plan (the mechanical one without it), the Arabic of its labels from the term table, TAUGHT (from the narration) and REQUIRED (per question), and every rule |
| `build_quiz.py` | 2 | Writes `belajar/content/quiz/<slug>.json`; `--show <slug> <ayah>` prints one ayah's questions |
| `validate_quiz.py` | 6 | The quiz guard: fresh build, the rules, TAUGHT(ayah) ⊇ REQUIRED(question) or the question listed in `authored/curriculum.pending.json` (both ways), the narration's exercise lines; prints the per-ayah quiz, what each ayah teaches and the tolerated list |
| `test_validate_quiz.py` | 6 | Planted-fault tests for the guard + unit tests of TAUGHT, the cause classes, the labels and the shuffle port |
| `wordvoice.py` | — | The word voices: the plain-letter rule, the inventory, a text's PLACE in the Qur'an (`places`, `quran_com_choice`: ayah-final first, then lesson order, then the Konsep words), the manifest (`expected`) and its checks (`problems`, `fixture_problems`) |
| `build_wordvoice.py` | 2/4 | Writes / checks `content/wordvoice.json`; `--fetch-quran-com` (the fixture from api.quran.com, the word files from audio.qurancdn.com, measured); `--render` the narrator's takes (spend) |
| `fixtures/quran_com_words.json` | — | Written by `build_wordvoice.py --fetch-quran-com`: Quran.com's word list of every ayah a voiced text stands in (text_uthmani, audio_url, retrieval date). Never edited by hand |
| `host_media.py` | 4 | Our unaltered copies of the recordings we did not make (the imam's ayat, Quran.com's words): the references in the content, the pins, the delivery and its upload list |
| `hosted.json` | — | Written by `host_media.py --fetch`: the pins (upstream URL, sha256, bytes, ms) of our copies of the imam's ayat; a lesson ayah's equals `sources.json`'s |

## Inputs (see `sources.json` for the pinned sha256 values)

| id | What | Version / pin |
|---|---|---|
| `tanzil_uthmani` | Tanzil Quran Text (Uthmani), txt with ayah numbers and the licence footer, kept verbatim | 1.1; URL `https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true` |
| `tanzil_metadata` | Tanzil `quran-data.xml` (surah Arabic name; ayah counts cross-check) | 1.0 |
| `qac_morphology` | Quranic Arabic Corpus morphology, GitHub mirror of the unmodified file (official download needs an email) | 0.4 (header checked) |
| `quran_align` | cpfair/quran-align release zip; `Alafasy_128kbps.json` (the one imam, plan L21) checked against the SHA-1 in the release README | release-2016-11-24 |
| `quranenc_indonesian_affairs` | QuranEnc API: sura 1 (top-level fields, unchanged) and suras 112, 113, 114 (`suras` map, one pinned file each, same endpoint), plus the translations list for the version and title | 1.0.1 as reported by `translations/list` |
| `quranenc_indonesian_affairs_quran` | The same translation for every sura 1..114 (the fact cards' ayah popup: the facts locate ayat in 103 suras), one pinned file per sura in `cache/quranenc/`; a file another input pins too must carry the same pin | 1.0.1 (sura 1's translations list) |
| `quranenc_sura_names` | QuranEnc's Indonesian sura list (`/id/browse/indonesian_affairs`), cached and pinned as the extracted `number\|ayat\|arabic\|name` text (the HTML carries tokens); ayah counts checked against Tanzil | `text_sha256` |
| `everyayah_alafasy` | The 22 MP3s of the imam (his file of each of the 22 lesson ayat), downloaded to measure their length; since 2026-10-15 also the files our server serves, unaltered (`host_media.py`: their pins must equal these; never committed); url pattern `{SSS}{AAA}.mp3` | per-file sha256 + duration |

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

**One entry per ayah: one imam everywhere, and no reciter setting** (operator 2026-10-13, plan
L21: "better to use alafasy for all? no need to give option to user to change"). The entry is
Mishary Rashid Alafasy's file of the ayah from EveryAyah (`Alafasy_128kbps`;
`build_surah.RECITER`) — since 2026-10-15 our unaltered copy of it, `/belajar/media/narration/alafasy/<SSS><AAA>.mp3`
("Hosted recordings" below; until then streamed from EveryAyah), in a `recitation` list of exactly one (`schema.ts`: `.length(1)`, and the
reciter's id is the only value its enum has). `validate.py` (check 3) refuses a second reciter in
an ayah, another reciter in the imam's place, another reciter's file or credit line in the imam's
entry, and another reciter's quran-align member or EveryAyah probes pinned in `sources.json`;
`test_validate.py` plants each. It also re-derives every segment list from the pinned quran-align
file and fails on any difference.

Until that day every ayah carried two entries (Husary Mu'allim first, Alafasy second, the default
since plan L7) and "Pengaturan" offered the choice. Husary's entries, his quran-align member and
his 22 EveryAyah probes were removed from the content and from `sources.json`
(`data_versions.quran_align` of each lesson no longer names his member); nothing reads the files
of his that an older `pipeline/cache` still holds, and `fetch.py` no longer downloads them. The
example clips (`clips.py`) and the ayah popup were Alafasy's already.

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
Kathir; āmīn per al-Mujtaba and Darwisy; "Na't atau shifah?", below) say so in `method`.

**The aside "Na't atau shifah?"** (`naat-atau-shifah`, operator 2026-10-13: "then we need
explanation about na't vs shifah, just intermezo"; shown with ayat 1, 3 and 6; not a count, no
narration line, no quiz question, no concept record). It says only what three pinned Shamela
pages say (`sources.json` `shamela_istilah`, read in `cache/shamela`): Ibnu Ajurrum's chapter is
"باب النَّعتِ" and his na't follows the word it describes "في رَفعِهِ، ونصبِهِ، وخفضِهِ، وتعريفِهِ،
وتنكيرِهِ" (11371/15, hlm. 14); Darwisy writes "(المستقيم) صفة للصراط" and, on the same page,
"(غير) بدل من الضمير في عليهم أو من الذين أو نعت للذين" (2163/12, jil. 1 hlm. 15); as-Samin, on the
same gairi, writes "وتكون صفة … متى اجتمع البدل والوصف قُدِّم الوصف" (9057/67, jil. 1 hlm. 74).
Left out for lack of a pinned source: which school of grammar prefers which word (the
attribution of na't to Kufah and shifah / washf to Bashrah), and the dictionary meaning of the
two words. Ibnu Hisyam's page (6970/16, Syarh Qathr an-Nada hlm. 28: "حذف الموصوف وصفته") only
attests the spelling صِفَة in another discussion (ni'ma and bi'sa) and is not cited by the aside.

Al-Mu'awwidzat facts and hadith come from `facts_muawwidzat.py` (its docstring gives the rules).
The lesson's `data_versions.pipeline` names `build_surah.py` plus the script in the
`_generated_by` line of those files. Hadith records without a corpus Indonesian translation
(Bukhari, Riyad as-Salihin) are kept out of `hadith` (under `_needs_indonesian`), but nine of them
are paraphrased in Indonesian in fact bodies (Bukhari 4974, 5013, 5016, 5017, 5748, 7375; Riyad
1013, 1015, 1456); whether that is allowed is an open operator decision (Al-Fatihah has no
hadith facts). Corpus defects are listed in each hadith file's `_anomalies` and kept byte for
byte: Riyad 1013's English stops mid-quotation, and Muslim 813's Arabic (as in the fawazahmed0
section file it came from) opens the Prophet's quoted saying and never closes it.

## Ayat popup (the fact cards' locations)

Operator 2026-10-12: a location chip on a "Tahukah Anda?" card ("QS 2:255") opened quran.com in a
new tab or app; it now opens a dialog with the ayah itself — Arabic, translation, the imam's
recitation (`src/components/surah/AyahDialog.tsx`). `build_ayat.py` writes what that dialog shows,
`belajar/content/ayat/locations.json` (about 1.08 MB: 1,629 ayat in 103 suras, 237 of them with
QuranEnc footnotes); the app serves it one ayah at a time from `GET /belajar/api/ayah?loc=S:A`
(`src/app/api/ayah/route.ts`, `src/lib/ayat.ts`, server only), so no page carries the file.

- **Which ayat:** every `Fact.locations` entry of every lesson file — all surahs in `common.SURAHS`,
  the ones `BELAJAR_SURAHS` hides included, so showing a surah stays an env change — once each, in
  mushaf order. No other entry. A fact that gains a location fails CI until the file is rebuilt.
- **Arabic:** the Tanzil Uthmani 1.1 line, byte for byte, with the surah-heading basmalah sliced off
  exactly as the lessons do (`common.lesson_ayah`; a byte-exact suffix of the line). The facts are
  counted without the heading ("Lima surah dibuka dengan qul" lists 72:1, which starts with qul),
  and the EveryAyah ayah-1 recordings carry none.
- **Translation:** QuranEnc `indonesian_affairs` 1.0.1 (`quranenc_indonesian_affairs_quran`), the
  row's `translation` verbatim with its `[n]` markers, and its `footnotes` field split per marker by
  `build_surah.split_footnotes` — the same treatment as a lesson, so an ayah that has a lesson
  (the 22 of Al-Fatihah and Al-Mu'awwidzat) is byte-identical here (checked, without the corpus
  too). The credit is QuranEnc's own title and version, as on the lessons.
- **Surah names** for the dialog's reference ("QS Al-Baqarah [2]: 255"): QuranEnc's Indonesian
  sura list (`quranenc_sura_names`), folded to plain letters (diacritics dropped, \` written ':
  "Āli 'Imrān" → "Ali 'Imran", "An-Nisā\`" → "An-Nisa'"). Where the module already writes a name
  itself, that spelling wins so a card and its dialog never disagree: a lesson's `name_id`, and
  `ayat.WRITTEN` (35 "Fathir", 82 "Al-Infithar", as the fact cards print them). Every
  "<name> (<surah>:<ayah>)" the facts write is checked against the table.
- **Provenance:** `data_versions` (Tanzil pin, QuranEnc version + translations list, the sura list
  pin, the facts it covers, the hash of the entries, the pipeline) and `sura_files` (the pin of
  every QuranEnc sura file used). CI has no `cache/`, so it runs `build_ayat.py --check --no-corpus`,
  `validate_ayat.py --no-corpus` and `test_validate_ayat.py --no-corpus` (coverage, order, Arabic
  script, footnote markers, the lesson ayat, the credit, pins, versions, the entries hash — a hand
  edit shows — and the names); Tanzil's bytes, QuranEnc's text and a fresh build run locally.

The recitation is not in the file: the dialog streams Mishary Alafasy's file of the ayah from
EveryAyah (`Alafasy_128kbps/SSSAAA.mp3`, the lessons' one imam and URL scheme), only once the
learner presses play, never stored on our server. (The lessons play our copies since 2026-10-15;
the popup does not: its 1,629 ayat average 342 KB, about 556 MB — "Hosted recordings".)

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

## Komposisi kata (word composition) and the harakat primer

Operator, 2026-10-10 (narration rule 14): "when explaining bismi … it has 2 components, harf jar and
ismi; ismi in its root is not read as kasrah but dhommah, but because of harf jar it's read kasrah;
provide visualization/animation bi + ismu → bismi". Say **bentuk dasar** (base form: the marfu'
form, اسْمُ with dhammah), never "akar" (in grammar the akar is the root letters س م و). And, because
the first lesson's learners do not know the marks yet, a **harakat primer** opens the course —
in Al-Fatihah 1 until 2026-10-13, in lesson zero since (its `"lesson": "0"`; see "Pelajaran nol"):
each mark on a dotted circle, where it sits and the sound it gives (fathah a, kasrah i, dhammah u;
sukun, syaddah and the small upright alif of ٱلرَّحْمَٰنِ too, since the ayah carries them — the
small alif is a letter the mushaf leaves out in writing but which is read, a long a: Sya'ban
Isma'il, Rasm al-Mushaf hlm. 97; SKB maddah), with an example letter.

`authored/<slug>.compose.json` → `build_compose.py` → `content/compose/<slug>.json` →
`build_narration.py` (lines) and the stage (`src/components/lesson/WordComposition.tsx`, in the
word card's slot, as tall as the word's tallest frame — every frame is laid out invisibly under the
one on screen, so nothing jumps and nothing is clipped at any text size; CI measures it; the
sequence step `w${n}:compose` after `w${n}`, its last line said over the last frame, the joined
word — the imam does not recite the word again there: he says it once, when the word's step opens
(`w${n}:recite`; operator 2026-10-13, plan L24); the step `primer` after the opening line of
lesson zero — after the imam's ayah, when a primer is played in an ayah's lesson). Only
an ayah's LAST word is recited once more, after the last line of its composition, its tile filled
forest: the composition that ends on the frame whose note is "imam berhenti di sini", said over
by its last line (`src/lib/composition.ts` `STOP_NOTE`). Keep exactly that note for that frame,
and write it nowhere else: the build refuses it on any other frame (`composeFileProblems`).

**‹ Sebelumnya / Berikutnya › move frame by frame** on the primer and on every composition
(operator report 2026-10-15: on the primer's kasrah frame, Sebelumnya went back to the lesson's
first page and Berikutnya left the primer for "Konsep baru: tiga jenis kalimah"). A frame is the
run of the step's plan said or heard over it — its lines, then the example beats that follow them
and the pauses after them (`machine.ts` `frameRuns`); the current frame is the one the stage shows
(`frameNow`, the rule of `caption.ts` `stageFrame`). Berikutnya starts the next frame from its
first line, Sebelumnya the previous one, playing or paused as the lesson was; Sebelumnya on the
first frame goes to the previous step, Berikutnya on the last to the next one, as everywhere. The
button and Media Session's next track send `next` with `jump`: in "Tunggu saya", while a caption
waits for Lanjut, Berikutnya moves by frame too, and Lanjut (plain `next`) still moves by caption.
"↺ Ulangi langkah ini" still plays the whole step from its first frame; "Langkah n dari N" and
"Lanjutkan dari langkah N" count steps. ‹ Sebelumnya is unavailable only on the lesson's very
first frame (`viewAutoplay` `hasPrev`). Tests: `src/components/autoplay/frames.test.ts` (every
frame of every step with frames, every pace and phase, with planted faults) and `ahead.test.ts`
(the look-ahead and the warmed recordings after a frame jump are what then plays). The CI walks
press Berikutnya until the STEP changes (`linebreaks.mjs` `leaveStep`, `screenshots.mjs` `toStep`).

**Forms, never typed Arabic.** Each named form says where its bytes come from (`compose.py` has
the grammar): a lesson word or a slice of it in whole pieces (`{"word": "1:1:1", "pieces": [0,
1]}` = بِ), a Tanzil token elsewhere (`{"tanzil": "55:78:2"}` = ٱسْمُ, its marfu' base form), a QAC
segment (`{"qac": "1:1:3:2"}`), or a deterministic edit of another form (`{"from": "ismu", "ops":
[{"mark": -1, "to": "kasrah"}]}`), or forms written together (`{"join": ["bi", "ismi"]}`). The build
records where each form stands as a token in the Qur'an (`attested`; `[]` = a teaching form such as
رَحْمَٰن without article or ending). Ops: `mark`+`to` (swap the one vowel of a piece), `letter`+`to` (one long-vowel letter for
another, by name — `wawu`, `ya` — its marks kept: the ya' of a jamak that is majrur back to the
wawu of its bentuk dasar, ٱلْعَٰلَمِينَ → ٱلْعَٰلَمُونَ; 2026-10-17; and since 2026-10-18 the
dotless final ya' of the Uthmani text, ى, as the ya' a learner knows, ي — the same letter in its
other shape: Tanzil's يَهْدِى (2:142:16) → يَهْدِي), `remove`+`piece`
(a mark taken off; `"vowel"` = its one vowel), `add`+`piece` (a mark put on; syaddah right after
the letter), `drop` (a piece left out). An edit of a Tanzil token is a form of its own on top of
the quoted one (`yahdi-uthmani` → `yahdi`): CI has no Tanzil text and replays the edit from the
quoted form's bytes.

**A letter said to be dropped is SEEN dropped** (operator 2026-10-18: "in ayat-6, it says something
like ihdina, lose 'ya' but not explained about the original word of ihdi, so it's unclear what it
means by losing 'ya'. Check any similar cases."): a line that says a letter is dropped or not
written ("huruf/alif … dibuang / tidak ditulis", "dibuangnya huruf") is said over a `drop` frame or
a later one, whose tile shows the form WITH the letter fading into the form without it and whose
chip names the letter (`compose.say_problems`, `_DROPPED`; faults "ihdi's ya' said to be dropped with
no frame that shows it, as until 2026-10-18" and its kin). Al-Fatihah since 2026-10-18: ihdinā
(1:6:1) — parts, then a `drop` frame ٱهْدِي → ٱهْدِ ("Kata kerja ini berasal dari يَهْدِي (yahdī), yang
artinya “Dia menunjuki”; di akhirnya ada huruf ي." · "Pada kata perintah, huruf ي itu dibuang,
sehingga tertulis ٱهْدِ (ihdi)."; an-Nahhas 1/20, as-Samin 1/61–62), then the join with نَا;
lillāhi (1:2:2) — a join لِ + ٱللَّهِ → لِٱللَّهِ (the alif not read), then a `drop` لِٱللَّهِ → لِلَّهِ (the
alif and one lam not written; Ibnu Qutaibah, al-'Ukbari); aḍ-ḍāllīna (1:7:9) names its original
form, ٱلضَّالِلِينَ (an-Nahhas 1/22), where the two lams merge. A sound not heard at a pause, a
hamzat washal or lam not read in a join are on their frames already (the word as written, the
join's chips; the imam recites the word). The sweep of every such line: the operator's report of
2026-10-18.

**Frames** (stages): `parts` (the parts in reading order, "+" between; locally checked against
QAC's segments, letter for letter), `base` (one part ringed as its bentuk dasar, with its last
vowel and sound; it ends in dhammah, the marfu' form, unless `base_mark` names the fixed ending of
a mabni word: an‘ama, fathah), `change` (`from` → `to`: exactly one vowel of one piece; the build cuts the piece
of each, مُ → مِ, and names the marks: dhammah → kasrah, u → i), `join` (`from`: the parts, one
tile: their letters; pieces that change in the join are cut, لْ رَ → ل رَّ, and the one letter
written in its other shape, the alif maqsura of عَلَى as ya' before a pronoun, ى → يْ; `silent`:
pieces written but not read), `drop` (a piece left out in writing), `whole` (the word as written,
with a note); any frame may pin, in `letters` ([form, piece]), the piece its lines' letter terms
show (the doubled لِّ of ٱلضَّآلِّينَ, not the article's lam);
the primer has `overview` (marks with their sounds), `bare` (a mark beside the example letter
WITHOUT it) and `mark` (one or two marks with example tiles carrying them, taken from the ayah's
own letters when they are slices). Since 2026-10-15 every mark is shown in two frames, the letter
first and then the letter with the mark (operator: the definition, then "Contohnya huruf ba'"
over ب, then "jika dibaca kasrah, maka terdengar bi" over بِ): a `bare` frame is followed by the
`mark` frame of the same marks, whose every tile is the bare tile with exactly those marks put on
(`compose.bare_problems`, `src/lib/composition.ts`); the bare letter is a deterministic edit of
the marked one (`{"from": "sin", "ops": [{"remove": "sukun", "piece": 0}]}`: ب, س, رَ, مَ), never
typed. Lesson zero's primer: the overview, then fathah, kasrah, dhammah (ب → بَ بِ بُ), sukun
(س → سْ), syaddah (رَ → رَّ), the small alif (مَ → مَٰ): 13 frames, 14 lines. Each frame has
`say`: the sentences narrated while it shows (one manifest line each; caption ≤ 170 characters
beside the animation — longer: two sentences), an optional `note` (≤ 60 characters, on screen).
The LAST frame of a word shows the word exactly as the ayah writes it. A word's composition may
have a `lead` (said on its `w${n}` line after the gloss). Sources: ≥ 1 SourceRef per composition
(the kitab behind each claim: Darwisy for the i'rab, Ajurrumiyyah for the signs, as-Samin for the
alif of the basmalah, QAC for the parts, Tanzil for the orthography, SKB 158/1987 for the sounds).

**What the lines say against what the frames show** (`compose.say_problems`, run by
`validate_compose.py` in both modes; review of 2026-10-10): the first use of each harakah in a
word's lead and lines carries its sound ("kasrah, bunyi i"; operator: learners do not know the marks
— the primer opens the course, a reminder follows at each word); a line over a `base` frame names only
the bentuk dasar's ending and its sound, over a `change` frame only the change's marks and sounds;
"bentuk dasar" is said over a base or change frame, or one whose note names it; "ditulis bersambung"
/ "bersambung dengan" over a join, or the whole word after its parts; "bagian pertama / kedua" over
the parts; never "akar"; each form's transliteration ends with the vowel of its last letter (ismu:
u). Lines are written to be rendered as they stand: an Arabic term, pattern or letter name said in
Latin and not from the dictionary fails them (`validate_narration.latin_terms`, rule 1), as does a
heavy letter + a without its respelling (rule 9: "mushaf" too).

**Narration rules for `say`** (checked by `build_narration.py` / `validate_narration.py`): no
Qur'anic word in any spelling (strict: the build stops instead of replacing it; name a word by its
place, "kata pertama", and — since 2026-10-17 — by itself with the named-word markup, never by its
meaning alone: "Bagian pertama adalah huruf jar, yaitu {{1:1:1/bi}}, yang artinya “dengan”", "Bagian
kedua adalah isim, yaitu {{1:1:3/rahman}}, yang artinya …", the frame's own tile form, {{!…}} for a
heavy-letter one; a part named by its kind and meaning only fails, `part_meaning_only`, wording rule
5); never a syllable the tiles show
in transliteration (bi, ismu, ismi, ar-raḥmānu …: the screen shows them, the imam recites the
word) except where the caption names it with the markup, nor one of another word of the same ayah ("hum"), in any spelling — with ONE exception
(operator 2026-10-15: "jika dibaca kasrah, maka terdengar bi"): a primer line over a `mark` frame
may say that frame's own example after "terdengar" when it is one letter with one short vowel
(بَ بِ بُ: ba, bi, bu; `validate_narration.primer_sounds`), and there the syllable is a sound,
not the letter's name, for the Latin-term check too (`latin_terms`); a longer form (rra, mā),
another frame's syllable, or the syllable without "terdengar" still fails; never a letter's name
read as a sound ("dibaca ba"); the narrator says vowel SOUNDS ("bunyi a", "i", "u"), letter names
("huruf mim", "huruf ra'", "alif lam" — spoken from the dictionary: مِيم, رَاء; alif and the article
in a fixed respelling, since أَلِف is the front of ٱلْفَلَقِ) and the dictionary's terms written by
their caption head ("kasrah", "dhammah", "fathah", "huruf jar", "majrur", "mudhaf ilaih", "na't",
"isim", "huruf ba'", "huruf lam" — spoken from `pronunciation.json`); a term not in the dictionary
is described in plain Indonesian ("huruf mati", "dibaca dobel") until the operator approves its
sound; a letter term is shown as the frame pins it or its tiles write it (the bare lam of
ٱلرَّحْمَٰن). Explain a rule in full the first time and briefly after ("sama seperti kata ketiga");
several short lines rather than one long one.

**Later lessons and the harakat primer (design, not wired yet; written before lesson zero —
the link would point at `/quran/pengantar` now, and `primer_ref` at lesson zero).** Only lesson
zero plays the primer; a learner may start at Al-Ikhlas from the hub, whose word lines say "dhammah" with no sound.
When a surah other than Al-Fatihah gets `authored/<slug>.compose.json`, it carries
`"primer_ref": {"slug": "al-fatihah", "ayah": 1}` instead of a primer: `build_compose.py` checks
that the target opens with a primer; `build_narration.py` adds one line before its first word,
"Harakat sudah dikenalkan di awal Surah Al-Fatihah: fathah bunyi a, kasrah bunyi i, dhammah bunyi
u." (dictionary terms, no new sound to approve); the stage shows a "Lihat pengenalan harakat" link
to `/quran/al-fatihah/1` beside it; and each word's first harakah carries its sound, as in
Al-Fatihah. Until then those surahs' narration is unchanged.

**Al-Fatihah: every word composed (ayat 1–7, 29 words; 2026-10-10).** Each rule is explained in
full once, at its first word, and later words refer back by MEANING when it is in another ayah
("seperti pada kata yang artinya “seluruh alam” di ayat kedua"; `validate_narration` reads "kata
ketiga" as a place in the current ayah): huruf jar → kasrah (1:1:1), mudhaf ilaih (1:1:2), alif lam
with a silent lam and a doubled letter, and na't following its noun (1:1:3), the pause at the end of
an ayah (1:1:4), alif lam with the lam read (1:2:1), the ayah-initial alif read (1:2:1), a letter as
the case sign, ya' for kasrah with wawu as its bentuk dasar (1:2:4), a word whose ending never
changes and an object put first for "hanya" (1:5:1), the first fi'il (1:5:2), the first change to
fathah (1:6:2), badal, "pengganti" (1:7:1). Shared wordings stay identical, so the same sentence is
rendered once (audio is content-addressed): "Bentuk dasarnya berakhir dengan dhammah, bunyi u.",
the pause line "Ini kata terakhir ayat, dan imam berhenti padanya, jadi … ini hanya terlihat dalam
tulisan, tidak terdengar.", "Karena ayat ini dimulai dari kata ini, alif di awalnya dibaca, …". The
article's alif in the middle of an ayah is tagged on screen (`silent: [0]` on the join frame) at
every such word. The first harakah of each word's explanation carries its sound ("kasrah, bunyi i").

**The imam's voice of each bentuk dasar** (operator 2026-10-12: "e.g ismu (read by voice + show
visual) when combined with harf jar, it becomes ismi (read by voice + visual). in principel, each
explanation should be followed by examples (visual + voice)", "not only for harakah, but also for
all rules"; plan L20). When a `base` frame is on the stage the imam recites that base form — never
the narrator. (Until plan L24, 2026-10-13, the step also ended with him reciting the joined word;
the lesson's own word is now recited once, when its step opens — an ayah's last word once more,
after the line that says he stops on it.) The build writes one
entry of `examples[<word loc>]` per base frame (`compose.build_examples`), chosen by what is HEARD
(the rules of "Suara contoh" below, `clips.py`; never a hand list):

| the base form | its voice |
|---|---|
| is the lesson word itself (`{"word": <this loc>}`: al-ḥamdu, na‘budu, nasta‘īnu) | `unvoiced: "own"` — the imam recites that very word when its step opens (until plan L24 also at the end of its composition; nasta‘īnu, its ayah's last word, still is) |
| quotes a place (`{"tanzil": loc}`, another lesson's `{"word": loc}`) | that place, the one the frame's note names; it must be heard as shown or the build stops |
| is derived (an edit, a join) and stands in the Qur'an | the place with a clean alignment, then in the shortest ayah (the browser streams that ayah's file for one word), then mushaf order |
| is derived and stands nowhere (māliku, aṣ-ṣirāṭu, al-mustaqīmu, al-magḍūbu) | `unvoiced: "unattested"`: a teaching form, no reciter says it |
| stands only where it is not heard as shown | `unvoiced: "unheard"` |

*Heard as shown* (`compose.place_voice`): not its ayah's last word (the imam stops there and the
ending a base frame shows is not pronounced); a word that starts with hamzat washal (ٱ) is used at
the start of its ayah (ar-raḥmānu, QS 20:5:1: the alif is read) or, mid-ayah, played with the word
before it and shipped with what is heard (`washal`, `clips.washal_of`: ismu, QS 55:78:1-2,
"tabārakasmu") — `before`, that word's transliteration, is the lessons' own or the one typed in the
library's base-form tile of the same place, so a place with neither is not usable. An entry:
`{"frame": 2, "form": "ismu", "loc": "55:78:2", "key": "55:78:1-2", "clip": {"url": "https://everyayah.com/data/Alafasy_128kbps/055078.mp3", "start": 30, "end": 1490}, "washal": {"run": "55:78:1-2", "before": "tabāraka", "heard": "tabārakasmu"}}`.
Al-Fatihah has 16 base frames: 9 voiced (ismu 55:78:1-2 · Allāhu 112:2:1, twice · ar-raḥmānu 20:5:1
· rabbu 41:9:13 · yaumu 37:20:4 · ṣirāṭu 6:126:2 · an‘ama 5:23:6 · gairu 74:10:3), 3 "own", 4
"unattested". Two quoted places moved for it, display only (their frame notes; the narration names
no ayah, and its manifests are byte-identical): **an‘ama** from 4:69:8 to **5:23:6**, the Konsep
diagram's place (plan L19), and **rabbu** from 7:54:31 (alignment: insertions 4) to **41:9:13**,
"żālika rabbu al-‘ālamīna", a clean alignment with the same phrase the line speaks of ("dalam
ungkapan yang artinya “Tuhan seluruh alam”").
The clips are checked as library.json's are, through `clips.problems` over the examples as a library
of their own (`compose.voice_library`): url, integers, a plausible length, the lessons' own timing
in a lesson ayah (112:2:1), the committed fixture `fixtures/compose_examples.json` for the 7 ayat
outside the lessons (5:23, 6:126, 20:5, 37:20, 41:9, 55:78, 74:10), the quran-align pin
(`data_versions.quran_align`), one clip per place; with the cache a fresh cut from the pinned file,
the Tanzil tokens, the fixture against the pinned files and equality with a fresh build (which is
what proves a derived form's place is the rule's choice). A quoted place whose alignment is not clean
is a warning. Which beats the lesson then plays, and how: "Contoh di dalam pelajaran" below.

## Konsep: istilah dalam huruf Arab, kata Qur'an dari byte konten

Operator, 2026-10-10, on /belajar/id/konsep: "mention the arabic word like majrur in arabic letter
etc, not only the transliteration" — and the narration review's rules the same day (Arabic with
transliteration, meanings with "yang artinya", "klik", letters as in the ayah, harakat for
beginners, words explained by their parts).

- **One term table.** `authored/library.terms.json` holds every grammar term the Konsep prose
  uses: its Latin surface forms, its Arabic, its group (`harakah` terms carry a short reminder,
  "tanda bunyi i di bawah huruf", shown at their first use on a page and linked to the Harakat
  page). No page types a term's Arabic. Each spelling is attested: `{"pron": …}` = byte-equal to
  the operator-approved pronunciation dictionary (a term the dictionary has must equal it, so
  captions and Konsep agree), or `{"page": "book/id", "text": …}` = a verbatim excerpt (≤ 12
  words) of a Shamela page of a kitab the library cites. Shamela HTML carries per-request
  tokens, so `fetch.py` pins the EXTRACTED page text (`sources.json` `shamela_istilah`, cache
  `cache/shamela/<book>/<id>.txt`). The check (`terms.attest_match`) folds harakat and alif
  forms, matches whole tokens (a clitic or the article may stand before the first token, only
  the article before a later one), and rejects a vowel the excerpt writes that differs from the
  term's, except on a declining token's case ending (its last letter; the لًا of an -an wazan,
  which the kitab may cite without its alif). It proves the letters, not the sense: the
  excerpts were chosen by hand to use the word in its grammatical sense. A mark counts as
  CONFIRMED only where the dictionary or a vocalised excerpt writes it; `validate_terms.py`
  counts both and lists every unconfirmed mark ("HARAKAT UNCONFIRMED"), so a spelling whose
  vowels no source writes is never called verified. The table also holds the sharaf wazan
  (fā‘ilun, maf‘ūlun, istaf‘ala, …, from Syadza al-'Arf), the bab names, kāna and its sisters,
  and the particles and pronouns of Ibnu Ajurrum's lists. 6 terms have no attestation and are
  shown in Latin only: dhamir al-majhul and lam doa (only in un-pinned sources), and the wazan
  yastaf‘ilu, nastaf‘ilu, yuf‘ilu and yufa‘lilu (no pinned page writes them; al-Amtsilah is an
  image scan). fi'il majhul and shighat mubalaghah are marked as their verified parts.
- **Inline markup** in the authored concepts, the Harakat page and the parts diagrams:
  `[[majrur]]` (a term by form), `[[bertanwin|tanwin]]` (by id), `[[bismi|q:1:1:1]]` (a
  Qur'anic word), `[[huwa Allāhu aḥad|q:112:1:2-4]]` (a run; the last word may be pausal),
  `[[bi-|q:1:1:1/1]]` (a QAC 0.4 segment), `[[ya'|q:1:2:4#6]]` (a letter as in the ayah; its
  surface must name that letter). `build_library.py` checks every field (unknown refs, a term
  form left unmarked — except a term's `ambiguous_forms`: huruf, hal, sifat, bab, jumlah, syarat
  are ordinary Indonesian words too, and the particles min, ilā, fī … are Qur'anic words too —,
  an explicit term ref whose surface names another term, "ketuk", "yang berarti", a Qur'anic
  word's meaning in bare quotes instead of "yang artinya" (`terms.BARE_QUOTE_OK` lists the
  recorded-narration exceptions), a q-ref whose Latin does not name its bytes
  (`terms.surface_matches`, a consonant-skeleton comparison: `[[bi-|q:1:1:1/2]]` fails because
  the segment is سْمِ), writes the stripped text to the plain fields (narration, metadata and the
  older prose checks read those) and ships the marked text, with every term named by id, in
  `marked`; `validate_terms.py` rebuilds that explicit form from the authored text and compares
  it byte for byte, so a hand-edited `library.json` fails in CI. Every q-ref's bytes go to
  `library.json` `quran` from the pinned Tanzil text and QAC.
- **Parts diagrams** (`authored/library.parts.json`, six words: bismi, lillāhi, ‘alaihim, lahū,
  birabbi, an‘amta): each tile is a part's bentuk dasar, and the tiles, with `changes` (a letter
  replaced by the word's letter: the same consonant with another vowel, or the alif maqsurah of
  عَلَىٰ written ya') and `drops` (letters the word does not write: an alif, and after it the lam
  of al-, as in لِلَّهِ) applied, must spell the word's Tanzil bytes exactly
  (`terms.parts_problems`; `src/lib/terms.ts partsProblems` repeats it in vitest). A base form
  is a Tanzil token elsewhere in the Qur'an chosen by its QAC lemma and case (ٱسْمُ marfu'), or,
  for an attached pronoun, an attached QAC segment of another word (the هُمْ of رَزَقْنَٰهُمْ, never
  the standalone هُمْ). Each tile's `translit` must name its bytes; the steps say "bentuk dasar",
  never "akar" (refused). WordParts names each change by where it is ("Akhir ismu berubah",
  "Huruf pertama -hum berubah"). The al- and wa- words are not diagrammed: joining them changes
  no letter of the part (the article's assimilation is tajwid, which the Harakat page leaves to
  the ilmu tajwid).
- **Kept on purpose:** titles, and the summaries of the five concepts whose narration is rendered
  (al-fatihah:1: kalimah, tanda-irab, huruf-jar, idhafah, naat), are byte-identical, so no
  rendered MP3 went stale. Two other summaries (fi'il amr, isim maushul) keep their bare quotes:
  the narration already says "kata yang artinya …" for a word of another ayah, and a written
  "yang artinya" would be spoken twice.
- **The role is always na't (2026-10-13, plan L25).** Operator: "in quiz of ayat 1 (the last
  question) it says ‘sifat’ , you write shifah in arabic instead of na’t, which one is correct?
  because in other explanations its written as na't". The table had two terms for one role, `naat`
  (na't, نَعْت) and `sifat` (sifat, صِفَة), and an author's `[[sifat]]` drew "sifat (صِفَة)" on the
  word cards, the structure, the Konsep pages and, built into the files, the quiz. Now the
  Indonesian word "sifat" is a form of `naat` itself (`forms`, and `ambiguous_forms`: still an
  ordinary word an author marks only where it names the role), so `[[sifat]]` draws "sifat (نَعْت)"
  at its first use in a text and stays bare once na't has been shown ("sifat (na't نَعْت) …, dan
  sifat mengikuti …"); no prose changed, so no narration did. صِفَة stays in the table as the term
  `shifah`, the other name of the same thing: only the aside "Na't atau shifah?" marks it
  (see "Facts"). `quiz.SAME_CAUSE` lost its "sifat" alias, and `src/lib/terms.test.ts` fails if
  صِفَة is shown beside "sifat" in any quiz string or drawn marked field, or if `shifah` is marked
  anywhere but that aside.
- **A meaning is written in “…” (2026-10-13, plan L22).** Operator: "sometimes found this: yang
  artinya “dengan” (which is correct), some sentence dont use “ and without color". Every
  Indonesian gloss inside a sentence is in curly double quotes, in every authored file and in
  `facts.py` — after a cue word ("artinya “kabulkanlah”", "bermakna “ibadah”", "berarti “turun” dan
  “datang”") and without one ("gaḍiba “marah”", "(“atas mereka”)") — never in straight quotes and
  never bare: the app emphasises what is quoted (`src/lib/emphasis.ts`: a quotation after a cue
  word, and any “…” of at most five words that is not a translation, a kitab's wording, a named
  term or a word mentioned), and `src/lib/emphasis.test.ts` fails on a gloss in straight quotes
  after a cue word and lists every quotation left plain. Straight single quotes stay for what is
  not an Indonesian gloss: a transliteration's apostrophes ('Athaf, ya'), a kitab's own phrase in
  Latin letters ('wa huwa babun wahidun'), a title ('Order of Genitive and Noun'), a kitab's
  verdict in a reference ('keduanya baik'). The 89 glosses changed that day (45 from straight
  quotes, 27 that had none, 17 in source references) changed no narration: `build_narration.py`
  already turned a straight-quoted gloss into “…” (`quotes_to_typographic`), so every manifest
  line is byte-identical. Where a gloss follows a Qur'anic word, rule 4 applies ("…, yang artinya
  “kami”, …": words 1:6:1 and 1:7:4); word 1:7:3 keeps its bracket ("-ta (“Engkau”, pelakunya)"),
  whose wording is recorded narration, and is listed in `terms.BARE_QUOTE_OK`. A gloss in plain
  brackets after a transliteration ("samā’ (langit)") was left as it is.
- **Glosses and the other static pages (2026-10-12).** Operator, on /konsep/idhafah: "better
  provide example, not only the translation 'nama Allah', but also write in arabic 'bismillah'
  … check also other parts", and on ‘alaihim's word card: "better to write the arabic words, not
  only the transliteration". So:
  - the GLOSS variant `[[“nama Allah”|q:1:1:1-2]]`: an example the prose gives only as its
    Indonesian translation keeps its plain text and shows the Arabic of the ayah words it
    translates after it, “nama Allah” (بِسْمِ ٱللَّهِ). Only for a surface that is one quotation “…”
    and a word, run or segment ref; the ref is resolved and byte-checked, its Latin is not
    compared with the bytes (`terms.is_gloss`, `gloss_problems`).
  - the lessons of `terms.MARKED_SURAHS` (Al-Fatihah; the hidden Mu'awwidzat are not marked yet)
    carry the same markup in their authored prose: a word's `why`, `wazn`, `case.sign` and
    `ikhtilaf` (`<slug>.words.json`), its `role` and the ayah structure's `type`, `summary` and
    group labels (`<slug>.structure.json`), and the facts through an overlay,
    `<slug>.facts.marked.json` (the facts are computed, so the overlay must strip to them;
    every fact is checked). `build_surah.py` ships each as a `marked` twin with its own `quran`
    and `segments` byte maps; WordCard, StructureSection and FactCard draw them (one first-use
    scope per card or section; the case chip "majrūr (مَجْرُور) · kasrah (كَسْرَة)" from the
    term table, `src/lib/cases.ts`), and the quiz texts (`quiz.Terms.annotate_marked`) show the
    Qur'anic words' Arabic too. Lesson fields whose recorded narration has a bare quote after
    a word are listed in `terms.BARE_QUOTE_OK`.
  - the Kosakata prose (`library.lexicon.json`: meanings, tashrif `bab`, i'lal rules, root
    meanings) is marked by its author, without the style rules (its wording is kept); the word
    class and the tashrif labels, a closed vocabulary built here, are marked by
    `terms.mark_terms`. A lexeme's own lemma cited bare is the page's Arabic headword already
    and stays Latin; a lemma no ayah writes as cited (raḥmah, milk, …) stays Latin.
  - no plain field changed: the narration manifests are byte-identical and `build_narration.py
    --check` stays clean.

## Suara contoh (the imam's voice of every example, 2026-10-12)

Operator, 2026-10-12: "in explanation, for example when explaining dhommah, kasrah, etc provide
example + additional voice. e.g ismu (read by voice + show visual) when combined with harf jar, it
becomes ismi (read by voice + visual). in principel, each explanation should be followed by
examples (visual + voice)", then "not only for harakah, but also for all rules" (plan L19).

- **What has a voice** (`clips.wanted`): every concept example (200 rows over 84 lesson words),
  the word of every Harakat sign's example letter (8 signs, 7 words: a letter alone is never
  recited, so بِ of kasrah plays بِسْمِ), every parts diagram's joined word (6) and each tile that
  is a whole Tanzil token, the bentuk dasar (5: ٱسْمُ 55:78:2, ٱللَّهُ 112:1:3, عَلَىٰ 2:5:2, رَبُّ 26:24:2,
  أَنْعَمَ 5:23:6). 90 clips over 27 ayat. **Without one** (`clips.unvoiced`, listed by the
  validator): the 7 tiles that are a QAC segment (bi-, li-, -hum, li-, -hū, bi-, -ta), since no
  reciter says a prefix or suffix on its own; the joined word's clip voices it inside the word.
- **The clip** (`library.json` `clips`, keyed by the word's location; a run is "55:78:1-2"):
  `{"url": "https://everyayah.com/data/Alafasy_128kbps/097005.mp3", "start": 200, "end": 1080}`,
  plus `"last": true` when its word ends the ayah — Mishary Alafasy (L7), the first word's start
  and the last word's end from the pinned `Alafasy_128kbps.json` of quran-align, read with
  `build_surah.word_segments` (segment [wordStart0, wordEndExclusive0, startMs, endMs] → word
  wordStart0 + 1 = the Tanzil token index of `common.lesson_ayah`, basmalah heading removed), the
  URL by `build_surah.everyayah_url`. The browser seeks to `start` and stops at `end`
  (`src/hooks/useClipPlayer.ts`), the way the lesson plays one word; nothing is downloaded here or
  stored on our server. `data_versions.quran_align` pins the member.
- **What is HEARD** (review 2026-10-12: all 88 clips pointed at the right word, yet the tanwin card
  showed دٌ = d + un "dari أَحَدٌ (aḥadun)" and played "aḥad", and "ismu" played "smu"). An example
  is chosen and labelled by tajwid, not only by its bytes:
  - **Waqf.** The imam stops on an ayah's last word, so a final harakah or tanwin is not
    pronounced there. `last` marks those clips (22, from the ayah's word count) and the page adds
    one line under the button, also its `aria-describedby` (messages `Clip.waqf_note`: "Di akhir
    ayat imam berhenti (waqaf), jadi harakat akhirnya tidak terdengar."), when the word's ending
    is one the pause drops (`clips.pause_drop` = `src/lib/heard.ts` `waqfDrop`: "harakat" for a
    short vowel or a dhammah/kasrah tanwin; 21 of the 22). يُولَدْ (112:3:4) ends on a sukun: heard
    as written, no line. An ending the line has no wording for ("other": fathatain read ā, ta'
    marbuthah read h, a pronoun's long vowel) stops the build. 47 of the 200 example rows (21
    concept pages) are such words; 43 carry the line.
  - **A Harakat sign card teaches the sound of its sign** (`clips.sign_heard_problems`): a sign
    on its word's last letter may not use an ayah's last word; a tanwin's word must be followed
    in its ayah by a letter that keeps the n clearly heard (izhar: ء ه ع ح غ خ), as كُفُوًا أَحَدٌۢ
    and غَاسِقٍ إِذَا are. The tanwin dhammah card uses مٌ of سَلَٰمٌ, QS 97:5:1 ("salāmun hiya":
    followed by ha'; word 1 of a 5-word ayah, so no other word runs into it; a clean alignment; a
    word every learner knows; considered: نَارٌ حَامِيَةٌۢ 101:11, سَلَٰمٌ عَلَىٰٓ إِبْرَٰهِيمَ 37:109,
    عَذَابٌ أَلِيمٌۢ 2:10, all clean). A sign whose word is outside the lessons carries `translit`
    (checked against its Tanzil bytes, as a parts tile's is) for the card's "dari … (…)" line.
  - **Hamzat washal.** A word that starts with ٱ loses that alif in mid-recitation. A base-form
    tile whose word starts with ٱ and is not its ayah's first word (ٱسْمُ after تَبَٰرَكَ, ٱللَّهُ after
    هُوَ) plays the run with the word before it and ships what is heard — `washal: {"run":
    "55:78:1-2", "before": "tabāraka", "heard": "tabārakasmu"}` (`clips.washal_of`: `before` +
    the tile's transliteration without its first vowel; the word before must end in one short
    vowel). The button is named by the heard form and the line under it says so (`Clip.washal_note`:
    "Di tengah bacaan, alif di awal kata ini tidak dibaca: bersama kata sebelumnya terdengar
    “tabārakasmu”."), in the words of the diagram's own hamzah-washal step. Type only `before` in
    `library.parts.json`, and only when that word is not a lesson word. A base-form tile is never
    an ayah's last word (its ending is what the diagram shows).
  - **A clean alignment where the Qur'an has one.** أَنْعَمَ is taken from 5:23:6, not 4:69:8
    (`insertions: 6, transpositions: 1` there; 4:72:10 is clean too, 19:58:3 and 33:37:4 are not).
    All 5 ayat outside the lessons now have clean matcher statistics; a non-zero one is a warning.
- **The fixture** (`fixtures/clips_outside_lessons.json`, written by the build): the Tanzil line
  and the quran-align entry of the 5 ayat outside the lessons (2:5, 5:23, 26:24, 55:78, 97:5).
  `pipeline/cache` is git-ignored, so before it CI could not see a shifted timing in those clips.
- **Checks** (`validate_clips.py`, the same as the build's): every wanted example has a clip and
  no clip is unwanted, mushaf order; the url is the reciter's file of that ayah; integers,
  0 ≤ start < end; 150 ms–4 s a word, 7 s for an ayah's last word (the imam holds the madd at the
  pause: ad-ḍāllīna, 1:7:9, is 5,680 ms), a run's cap being the sum of its words' caps; a lesson
  ayah's clip equals the lesson's own Alafasy timing of that word, its `last` the lessons' word
  count (`common.SURAHS`), and that lesson word is the one the page shows; a clip outside the
  lessons equals the one the fixture gives, and every word, run and letter the library resolves
  there is the fixture's bytes; the heard rules above; the fixture holds exactly those ayat under
  the current pins. With the cache: a fresh build equals the file, quran-align's single-word
  segments cover the ayah's Tanzil tokens exactly once, no segment joins a clip word to another,
  the Tanzil token(s) at the clip's index are the bytes the page shows, and the fixture equals the
  pinned files.
- **The app**: ConceptCard example rows, HarakatChart sign cards and WordParts tiles show the
  example as before and add `ClipButton` ("▶ Dengarkan") and, where what is heard differs,
  `ClipNote`; one `ClipPlayerProvider` per page; the lesson's "Materi lengkap" shows concept cards
  compact (no examples), so it has none. The player stops at the word's end by a timer set for
  the predicted end (a frame could come 16.7 ms late, the next word starts 10 ms on), with
  `timeupdate` as the backstop and a stop when the tab is hidden. vitest (`src/lib/clips.test.ts`,
  `src/lib/heard.test.ts`) checks that every concept, sign and diagram has an example with Arabic
  and a clip, that every sign is heard where its example is, that the rendered pages carry the
  two lines exactly where the data says, and the fixture; `scripts/ci/screenshots.mjs`
  (`clipChecks`: idhafah, Harakat, huruf jar) that nothing is fetched before a press, a press
  fetches that ayah, a second press stops the first while it still plays, the player stops the
  second within 150 ms after its word's end (the element's own clock at the pause, on a clip that
  does not end its ayah), and the lines are shown under their buttons.
- **By ear** (no check can hear): each clip's cut, above all the two runs (tabāraka-smu,
  huwa-llāhu) and the tiles whose NEXT word starts with hamzat washal (rabbu → s-samāwāti,
  an‘ama → llāhu), whose last consonant runs into the next word's doubled letter.

## Contoh di dalam pelajaran (examples inside the autoplay lesson, 2026-10-12)

Operator, 2026-10-12, the same request as "Suara contoh" ("in principel, each explanation should
be followed by examples (visual + voice)" — "not only for harakah, but also for all rules"), now
INSIDE the autoplay lesson, where the narrator explains each word, each new concept and each word
by its parts (plan L20). An example BEAT is the stage showing the example and the IMAM reciting
it, with an on-screen caption ("Contoh: …"). It has no narration line: nothing was written for the
narrator and nothing is rendered; `content/narration/*.json` did not change.

- **Which beats** (`src/lib/autoplay/examples.ts` `lessonExamples`, derived from the content):
  (a) after each "Konsep baru" line, its example in THIS ayah, in a step of its own
  (`concept:<id>:ex`, kind `example`): a Konsep taught whole shows its own example in this ayah,
  and a step with a text of its own — or a record with no example here — the first word of the
  ayah it occurs on (since the basic curriculum, 2026-10-13, which lesson says a "Konsep baru"
  line is the curriculum's, no longer "the ayah of the record's first example":
  `src/lib/autoplay/curriculum.ts taughtIn`; a step that occurs on no word of its ayah —
  jumlah fi'liyyah at Al-Fatihah 6 — has no beat and is listed with the reason) — and, when that word ends its ayah and the example is about its last harakah (its
  note names the word's own harakah), one more from the concept's other examples that does not
  end its ayah (a clip of `library.json` `clips`; none in the lessons today); (b) in a word's
  composition, the bentuk dasar after the last line of its `base` frame (`content/compose`
  `examples`, above). The lesson's OWN word is recited once, when its step opens
  (`w${n}:recite`), and not again (operator 2026-10-13, plan L24: "when transation from word X to
  X+1, i think we dont need to recite the X, just directly to X+1"): neither at the end of its
  composition nor — the former rule (c), for a word WITHOUT a composition — as a beat after the
  line that explains its harakah. The one exception is an ayah's last word, recited once more
  after the composition line that says the imam stops on it (all seven ayat of Al-Fatihah). At
  most two beats per rule; a rule without a beat of its own is listed with its reason.
- **Al-Fatihah**: 25 beats — 16 concept examples (this ayah's own word, on the stage's recitation
  player) and 9 bentuk dasar clips from other ayat (the example player) — adding 104 s in Biasa
  (231 s in Pelan) to a lesson of about 68 minutes: 26 · 25 · 8 · 7 · 10 · 7 · 21 s for ayat 1–7
  (35 beats and 153 s until the basic curriculum, 2026-10-13, when the lessons said 26 "Konsep
  baru" lines; 240 s until plan L24, when a beat was held for its caption's `captionMs`).
  7 base frames have no beat of their own (3 "own", 4 "unattested"), and one step: jumlah
  fi'liyyah, taught at ayah 6, occurs on no word of that ayah. `npx tsx
  scripts/autoplay-check.ts --examples` lists every beat and every reason.
- **What is heard**: a beat on an ayah's last word says "Di akhir ayat imam berhenti, jadi harakat
  akhirnya tidak terdengar." (al-‘ālamīna 1:2:4; nasta‘īnu 1:5:4, twice) and never names an ending
  as heard there; a bentuk dasar is never an ayah's last word; ismu is played with tabāraka and
  the caption says "Bersama kata sebelumnya terdengar “tabārakasmu”, karena alif di awalnya tidak
  dibaca."
- **The engine** (`machine.ts`): an `example` action issues a recite activity that names the beat
  (target `word`, or `clip` for another ayah's word); one activity at a time, so it never plays
  over the narrator or another recording; at least its caption's reading time — the reading
  alone, 10 / 6 characters a second (`timing.ts` `exampleReadMs`, plan L24) —; twice in "Pelan";
  "Tunggu saya" waits for Lanjut after it; pause / resume, "↺ Ulangi langkah ini" and ‹ › work on
  its step (on a composition ‹ › move by frame, and a bentuk dasar's beat belongs to its frame). A recording that fails, or does not sound within 6 s (`EXAMPLE_LOAD_LIMIT_MS`), is
  given up: the example stays on screen 3 s with "Suara contoh ini belum bisa diputar." and the
  lesson goes on — never the dead stop of the ayah's own recitation failing. A beat is running
  time for the screen lock, and is never in the narration look-ahead; the clip its step is about
  to play is fetched ahead on the example player only while the lesson runs, 1.2 s after the step
  began, and never with Save-Data / 2G (`warm.ts` `exampleToWarm`).
- **The stage**: `ExampleCard` in the word card's slot for a concept's example ("Contoh" · "Kata
  ke-1" · the word's Tanzil bytes · transliteration · "yang artinya …", and "akhirnya kasrah
  (كَسْرَة) · bunyi i" when the example is about that harakah and it is heard); for a bentuk dasar
  the composition stays on its base frame and the ringed tile is filled while the imam recites
  it. `useExamplePlayer` is a third kept Audio element, unlocked in the "Mulai" tap with a moment
  of silence (a blob, no request) and kept across the hand-off like the other two.
- **Checks**: `src/lib/autoplay/checks.ts` `exampleProblems` over every lesson (coverage, one
  recording that exists, the content's bytes, what is heard, no narration line, at most two per
  rule) and `transitionProblem` (a failed example never stops the lesson) — run by
  `scripts/autoplay-check.ts` and vitest; `src/components/autoplay/examples.test.ts` (which beats;
  28 planted faults; the machine at every beat and pace: recited once, reachable, replayed,
  skipped cleanly, the screen on, not in the look-ahead; the stage's frame and marks; the warm
  rule; the seconds added); `pipeline/validate_compose.py` for the clips; in the browser
  `scripts/ci/screenshots.mjs` `exampleChecks` (the base form's recording requested by its base
  frame and not before the step plays; a held-back recording shows "Memuat bacaan imam…", is given
  up at the limit and the lesson goes on; a concept's line is followed by its example card by
  itself, and the lesson goes on) and `linebreaks.mjs` (the example card and the bentuk dasar's
  caption at the three text sizes).
- **By ear, and on a phone** (no check can): each of the 9 clips' cut (above all the run
  tabāraka-smu, and rabbu → l-‘ālamīna, an‘ama → llāhu, whose last consonant runs into the next
  word); that iOS Safari lets the example player sound after the one "Mulai" tap and across the
  hand-off.

## Kurikulum (which lesson teaches what)

Operator, 2026-10-13 (plan L26; the record and its evidence: `docs/belajar-research/kurikulum-dasar.md`,
decisions 1–9 and table E): "this is my plan, we will not cover all ayat in quran: we only cover
alfatihah, 3qul, ayat qursi … we distribute the lessons into these ayats"; "or let's focus on the
basic first for those ayats/surahs, the more advanced ones reserved for later in different
surah/ayats"; "next ayat, should review pervious lesson if exist in that ayat"; "so the knowledge is
accummulating and repeated"; "but separate new vs already knows concept, this is what new, this is
what we've learnt so far".

**One place says which lesson teaches what**: `authored/curriculum.json` →
`content/curriculum.json` (`curriculum.py`, `build_curriculum.py`). Until then three places each
derived "the Konsep whose first example is in this ayah" (`validate_narration.introduced_concepts`,
`lessonmap.taught_at`, `src/lib/library.ts conceptsIntroducedIn`); all three are gone and read the
curriculum (`validate_narration.taught_lines`, `lessonmap.build`, `src/lib/curriculum.ts taughtAt`),
and `src/components/autoplay/curriculum.test.ts` holds the TypeScript derivation
(`src/lib/autoplay/curriculum.ts deriveLesson`) to the lists the Python wrote into the file.

- **Lessons**, in teaching order (32): `"0"` the lesson with no ayah (decision 1), `"S:A"` an
  ayah, `"S:A/N"` a segment of a long ayah (Ayat al-Kursi, nine). Order: lesson zero, Al-Fatihah,
  An-Nas, Al-Falaq, Al-Ikhlas, Ayat al-Kursi (decision 2).
- **Steps** (36), each taught in exactly one lesson, at most three a lesson (decision 7); 10
  lessons teach none. A step is one of: a Konsep record taught WHOLE (`concept`; its "Konsep
  baru" line is the record's, id `concept:<record id>`); a step with a text of its own (`teach`:
  title, summary, kitab sources — a PART of a record, numbered with `part` (the i'rab record
  arrives as majrur, marfu', manshub, majzum), or a step with no record (alif lam); line id
  `concept:<step id>`); a `basics` record (harakat); or a step not written yet (no line).
- **Where a step occurs** (`occurs`, `curriculum.occurs`) is a rule, never a list: `case` (the
  word's i'rab state), `qac` (a tag of the word's Quranic Arabic Corpus segments, read from the
  word's own `sources` line: `DET` for alif lam), `always` (the three kinds of word), and for a
  record taught whole the record's tags on the words and its structure groups. A `basics` step
  (the harakat) occurs on every word, since 2026-10-17 (it occurred nowhere until then: the map
  said "Tidak ada di ayat ini: Harakat" of every ayah).
- **Terms**: `terms` on a step are the `library.terms.json` ids it owns (86, each owned by at most
  one step); `free` terms belong to no step and may be said anywhere (4); a term nobody owns is
  next-level (76).
- **Next level** (`lanjut`, 18 records; all nine sharaf records: decision 6): never taught by a
  basic lesson, never given a "Konsep baru" line; listed on a lesson's card where they are tagged.
- **Derived, written into the content file** for every lesson that has a page (22 today): `lines`
  (its "Konsep baru" lines in order, each with its step and the words it lights), `before` /
  `after` (how many steps are learnt), and `map` — `new`, `learnt` (EVERY earlier step, `here`
  where it occurs in this ayah), `later` (a later lesson's step that occurs here), `lanjut`.

**The learner reads it too** (operator, 2026-10-13: "we should also explain this curriculum in the
page"; plan L30): `/belajar/{locale}/quran/kurikulum` draws this file and nothing else — the units
in lesson order, each lesson's steps by their `name`, `after` as the running total, `map.learnt`
(`here`) as what a review lesson repeats, `lanjut` as the closing list
(`src/lib/curriculumOutline.ts`). A step's `name` is therefore on a public page for every unit,
written or not.

`validate_curriculum.py` checks, each on its own: lesson ids unique and in a documented form;
every step in one lesson that exists, at most three a lesson; concept and basics ids exist; a
Konsep record is taught whole, or split into numbered parts, or next-level — never two of them,
and all 37 are placed; terms exist and have at most one owner, free terms exist and have none; a
`teach` has a title, a summary and at least one source with kitab, ref and url, its markup
resolves, and it says no Qur'anic word; `occurs` is a documented form; the derived lists equal a
fresh derivation. A step of a surah whose lesson map is switched on must be teachable (a line to
say) and its name sayable: two names ("Lam nafi", "La nafi") name a Qur'anic word and are listed
as notes until their surahs are switched on, when they fail.

```bash
python3 build_curriculum.py            # write content/curriculum.json (after build_surah / build_library; BEFORE build_quiz, build_map, build_narration)
python3 build_curriculum.py --check    # exit 1 if the file differs from a fresh build
python3 build_curriculum.py --show     # the table: per lesson what is new, learnt, later, next-level
python3 validate_curriculum.py         # the rules, each on its own; the table; the totals
python3 test_validate_curriculum.py    # 71 planted faults + unit tests
```

**Placement in the narration.** A step's "Konsep baru" line is said in the step's lesson and
nowhere else, in the curriculum's order; a next-level record gets no line. A `teach` text goes
through the narration's sanitiser and dictionary like every other line (it may name the letter
lam after "huruf" or "alif": `Sanitiser.replace_mentions` reads a letter's name as the guard
does). When a line moves to another ayah with its text unchanged, `build_narration.manifest`
carries its audio over (the file is named by its text); a line whose text changed has none until
it is rendered.

**No term before its lesson** (decision 7: "No lesson line may use a term before the lesson that
teaches it"). For every narration line of a lesson, `validate_narration.term_order_found` finds
the grammar terms its prose says — through the pronunciation dictionary (`lexicon.latin_matches`:
any spelling the dictionary knows), each mapped to its `library.terms.json` id by its Arabic —
and `curriculum.too_early` names those whose step is taught in a LATER lesson, or in no basic
lesson. The build also holds each line's caption to the same terms as its prose. One exemption:
a `map:later` line may name the later steps it announces. The dictionary alone left a hole: a
library term it has no entry for stands in a line in Latin (nafi, zharaf, mubalaghah, maqul
al-qaul, majhul, sahih, mashdariyyah), and so does a dictionary term in a form it does not
match ("fa'il-nya"). So what a line USES is the dictionary's matches and, in the text between
them, the term table's own forms (`terms.TermForms`, the rule of `terms.unmarked`: whole words,
with -nya, the longest form; a term's `ambiguous_forms` stay the author's call) —
`validate_narration.prose_terms` / `caption_terms` through `TermIds.forms`.

The uses that exist today are listed in `authored/curriculum.pending.json`: `lines` (line id →
the term ids) and `quiz` (`<slug>:<ayah>:<exercise>:<n>` → the terms a question needs untaught).
The file is written by the build, never by hand, and is held BOTH ways — `build_narration.py`,
`validate_narration.py` and `validate_quiz.py` fail on a use that is not listed, and on a listed
one that is no longer found — so it can only shrink as the lines are reworded, down to
`{"lines": {}, "quiz": {}}` with the check as strict as today.

```bash
python3 build_narration.py --write-pending   # rewrite authored/curriculum.pending.json from what is found now, then build
```

2026-10-13, first: 48 lines (75 uses) and 13 questions, 25 of the lines and every question in
Al-Fatihah. The same day Al-Fatihah was reworded and replanned (the structure told item by item,
`why_basic`, the quiz plan): **no Al-Fatihah line is left**, and the quiz list was empty until
the explanation shown after an answer joined the guard, which found three questions of
Al-Fatihah 7 — cleared the same day with content (see "Kuis"): **no Al-Fatihah entry is left**,
lines or quiz. What remains is the Mu'awwidzat's lines (hidden; rewritten when their lessons
are): 39 lines, 58 uses —
Al-Ikhlas 1: 1, 3: 5; Al-Falaq 1: 5, 2: 1, 3: 5, 4: 5, 5: 8; An-Nas 1: 5, 5: 4 (16 of them found
only by the term table's forms).

**Not built yet.** An-Nas, Al-Falaq and Al-Ikhlas follow the placement mechanically (their steps
without a text have no line yet); the segments of Ayat al-Kursi have no page.

## Pelajaran nol (lesson zero: the lesson with no ayah)

Decision 1 of `kurikulum-dasar.md` (operator-approved 2026-10-13): "A 'lesson zero' with no ayah
opens the course. It teaches harakat and the three kinds of word (kalimah: isim, fi'il, huruf),
so ayah 1 is lighter. The harakat primer and kalimah move out of 1:1 into lesson zero." Until it
had a page the primer opened Al-Fatihah 1, that ayah's lesson map said "two things already
learnt" of things no lesson had taught, and the kalimah record's line was said nowhere.

- **Who hosts it**: the surah whose harakat primer says `"lesson": "0"`
  (`authored/al-fatihah.compose.json` → `content/compose/al-fatihah.json`; `compose.LESSON_ZERO`).
  The primer's `ayah` stays the ayah whose words its frames show (the letters of 1:1); `lesson`
  says who PLAYS it. `validate_narration.primer_of(compose, ayah)` gives it to "ayah 0" only, so
  Al-Fatihah 1 no longer plays it. One source: the primer is not copied anywhere.
- **Its lines** are the lines of "ayah 0" of that surah, in that surah's own manifest
  (`validate_narration.lesson_zero`, `zero_parts`): `al-fatihah:0:intro`, `:primer:1` … `:primer:14`,
  `:concept:kalimah-isim-fiil-huruf:lead`, `:concept:kalimah-isim-fiil-huruf`,
  `:concept:kalimah-isim-fiil-huruf:ex:1` … `:ex:5`, `:next` — first in the file. In the surah's manifest and
  not one of their own because a recorded file is named by its text and lives in its manifest's
  folder: five primer lines and the kalimah line moved there with their text and kept their
  audio. Nothing is lit (no ayah on that stage: `highlight` `[]`, `focus` `null`).
- **The text written for it** is two sentences, in `build_narration.py`: `ZERO_INTRO` ("Ini
  pelajaran pengantar, sebelum kita masuk ke ayat pertama Surah Al-Fatihah. Ada dua hal yang kita
  kenali di sini: harakat, dan tiga jenis kata dalam bahasa Arab.") and `ZERO_NEXT` ("Pelajaran
  pengantar selesai. Berikutnya ayat pertama Surah Al-Fatihah; pelajaran berlanjut sendiri.", the
  words of an ayah's `next` line). Four primer lines were reworded for a lesson with no "ayat
  ini" (main session's texts: "Sebelum mulai, …", "Huruf pertama Surah Al-Fatihah …", "… di ayat
  pertama surah itu.", "… pada kata ketiga ayat itu."). The third of them (`primer:6`) also
  NAMES sukun since the same day ("Tanda kecil di atas huruf sin disebut sukun: ia menandakan
  huruf mati, …"): the harakat step owns the term, later lines say it, and until then no line
  had named it (the quiz guard found it: "Kuis"). Since 2026-10-15 the primer shows each sign on
  its letter without it first (see "Komposisi kata"): the line over the bare sin defines it,
  "Sukun adalah tanda huruf mati, …" (`primer:9`, which the quiz guard reads as teaching it).
- **Its slides** (operator 2026-10-15; `curriculum.LEAD_KEYS`, check 5b of
  `validate_curriculum.py`): a step of lesson zero taught as a whole record may carry `lead` — a
  slide said BEFORE its "Konsep baru" line ("<line>:lead") — and `examples` — the examples its card
  shows after the line, each with the narrator's line about it ("<line>:ex:<k>"). The kalimah step
  has both. `lead` ("we need another page/slide to explain that kalimah in Arabic is different:
  kalimah in Arabic means word, while in bahasa it means sentence/kalimat"): kalimah (كَلِمَة) is one
  word; a string of words with a complete meaning, Indonesian "kalimat", is kalam (كَلَام) —
  Qathr an-Nada hlm. 11 «al-kalimah qaul mufrad» (and Ibnu Hisyam's note that in the language,
  not the term, kalimah is also used of meaningful sentences) and Ajurrumiyyah hlm. 5 «al-kalam
  huwa al-lafzh al-murakkab al-mufid bil-wadh'»; the cheat sheet quotes both sentences from the
  pinned pages. Its two cards (`src/components/lesson/TermContrastCard.tsx`, in the word card's
  slot): "Bahasa Arab · كَلِمَة · kalimah · “satu kata”" and "Bahasa Indonesia · kalimat ·
  “rangkaian kata yang bermakna utuh” · dalam bahasa Arab: kalam (كَلَام)" — each term the term
  table's Arabic, never typed; a card may name only a term the step owns or a free one.
  `examples` (operator: "ṣirāṭ, yang artinya jalan, adalah sebuah isim, yaitu nama benda"; "better
  to provide OTHER examples of isim as nama sifat etc."): ṣirāṭa (isim, nama benda),
  al-mustaqīma (isim, nama sifat), iyyāka (isim, kata ganti), na‘budu (fi'il, kata kerja), wa lā
  (two huruf) — each one of the record's own examples (al-mustaqīma and iyyāka joined the record
  that day, with their QAC tags ADJ and PRON), its line naming the kind of word the record's note
  names, the word itself never voiced ("Kata ini, yang artinya “jalan”, adalah isim, yaitu nama
  benda."): the example step plays line k over example k's card, then example k's recording
  (beat k after cue k; `src/lib/autoplay/sequence.ts`, `checks.ts`). Each line ≤ 400 characters,
  one file. The new term كَلَام is in `pronunciation.json` as "pending-ear-check 2026-10-15".
- **The curriculum** marks lesson "0" as written when a primer is played there
  (`curriculum.zero_written`, `written`): its `lines` (the kalimah record's line, no word to
  light) and its `map` (`new`: harakat, kalimah; nothing learnt, postponed or next-level). The
  file's format did not change: lesson "0" gained the two keys every written lesson has.
  `curriculum.ayah_lesson(surah, 0)` is `"0"`, so the term check holds its lines to lesson "0".
- **The app**: `/quran/pengantar` (`src/lib/routes.ts introHref`), the same stage as an ayah's
  lesson; `src/lib/autoplay/zero.ts` (`zeroAyah`, `hostsZero`, `primerAyah`),
  `buildAutoplaySequence({ zero: true })` — intro → primer → `concept:<id>:lead` (the slide, when
  the step has one) → `concept:<id>` → `concept:<id>:ex` (the step's examples, each the narrator's
  line and then the word's recording: Quran.com's, since 2026-10-15, for all five) → next, which leads to ayah 1 like an ayah to the next. Listed first on the
  track page and on Al-Fatihah's page; Al-Fatihah 1 says "Belum mengenal harakat? Mulai dari
  Pengantar."

## Susunan kalimat per butir (the structure told item by item)

Operator, 2026-10-13: "can we make this kind of explanation in items: harfjar in one item, idhafah
in next item etc, it's kind of confusing which for which in this paragraph". An ayah's
`structure` may carry `items: [{words, say}]` (authored in `<slug>.structure.json`, carried by
`build_surah.structure_items` into `content/<slug>.json`; `schema.ts`). When it does:

- its narration is ONE LINE PER ITEM, `structure:1` … `structure:n`
  (`validate_narration.structure_parts`), INSTEAD of the one `structure` line built from
  `summary`; the first opens with `STRUCTURE_LEAD` ("Sekarang susunan kalimatnya.");
- a `say` is spoken as it stands, like a composition's: through the strict sanitiser (a Qur'anic
  word stops the build — positions and meanings instead), never split (a longer item is two
  items), and held to rule 1 (`validate_narration.authored`: no Latin term the dictionary does
  not speak, so "fa'il-nya" is refused);
- each line lights its item's `words` (`line_view`) and is a step of the lesson of its own, with
  those words on the stage's card (`StructureItemCard`); "Ulangi" replays the item;
- the quiz reads these lines as teaching lines (`quiz.TEACHING_PART`): ayah 1's first item ends
  "Gabungan seperti ini disebut jar-majrur", which teaches the term.

`summary` and `groups` stay the reference text of the page. An ayah without items is told from
its summary as before (the Mu'awwidzat). Al-Fatihah: 24 items (4, 4, 2, 3, 3, 3, 5).

## why_basic (a word's reason as the narrator says it)

A word's `why` is its reference text, with every term and its sources; it is what the word's
card shows. Its optional `why_basic` (authored in `<slug>.words.json`, 2026-10-13) is the same
reason in the lesson's own vocabulary — only terms taught by then — and is what the NARRATED
lines say instead (`build_narration.said_why`): a quiz question's explanation
(`ex:<key>:<n>:why` of why-harakat, sort-case and label-role) and the `w<n>` line of a word
without a composition. Plain prose spoken as it stands: strict (no Qur'anic word), no markup,
no marked twin (it is never drawn), and held to rule 1. A `why_basic` that names a term taught
later fails through the term check like any line. Nine words of Al-Fatihah have one. The
exercise's own on-screen feedback (`content/quiz` `why`) still shows `why`.

## Peta pelajaran (the lesson map: what is new, what we have learnt so far, what comes later)

Operator, 2026-10-13 (plan L23): "at the beginning of the ayat, better to inform what concept we
will learn in this ayat, also explain maybe we skip some concept and will visit later in next ayat
instead of explaining all concepts in 1 ayat … so at the beginning we inform what will be learnt, in
the end recap what we've learnt". With the basic curriculum (plan L26, decisions 8 and 9): "next
ayat, should review pervious lesson if exist in that ayat"; "so the knowledge is accummulating and
repeated"; "but separate new vs already knows concept, this is what new, this is what we've learnt
so far". Version 2 (2026-10-13) is built on the curriculum; version 1 derived its three lists from
the Konsep records' first examples and was one line and one card for the whole opening.

**The four lists are the curriculum's** (`curriculum.lesson_entry` → `content/curriculum.json`
`lessons[].map`; `lessonmap.py` adds the names). Per ayah: `new` = the steps its lesson teaches, in
the order of its "Konsep baru" lines (at most three); `learnt` = EVERY step taught before this
lesson, in teaching order, each with `here` — it occurs in this ayah (decision 9: "learnt so far"
is cumulative; decision 8: the ones that occur here are the ones reviewed); `later` = a step a
LATER lesson teaches that occurs in this ayah; `lanjut` = the next-level records tagged on its
words. A step is in exactly one of new / learnt / later. Al-Fatihah:

| ayat | new | learnt so far (met again here) | later | tingkat lanjut | total after |
|---|---|---|---|---|---|
| 1 | 2: majrur, huruf jar | 2 (2: harakat, tiga jenis kata) | 3: alif lam, na't, idhafah | 1 | 4 |
| 2 | 3: jumlah ismiyyah, marfu', jamak mudzakkar salim | 4 (4) | 4: alif lam, na't, idhafah, badal | 2 | 7 |
| 3 | 2: alif lam, na't | 7 (3) | 0 | 1 | 9 |
| 4 | 1: idhafah | 9 (5) | 0 | 2 | 10 |
| 5 | 3: dhamir, fi'il mudhari', mu'rab dan mabni | 10 (3) | 3: jumlah fi'liyyah, maf'ul bih, 'athaf | 3 | 13 |
| 6 | 3: jumlah fi'liyyah, maf'ul bih, manshub | 13 (5) | 1: fi'il amr | 3 | 16 |
| 7 | 3: isim maushul, fi'il madhi, 'athaf | 16 (11) | 1: badal | 4 | 19 |

(The 2 learnt before ayah 1 are lesson zero's steps, harakat and the three kinds of word.
"Tiga jenis kata" occurs in every ayah, by its `occurs.always`, and since 2026-10-17 so do the
harakat, a `basics` step, which sit on every letter — operator, on ayah 1's card "Tidak ada di ayat
ini: Harakat": "in alfatihah ayat-1 it says no harakat?". The step "tiga jenis kata" is named with
its members since the same day, "Tiga jenis kata (isim, fi'il, dan huruf)", said and shown "tiga
jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف)" by the bracket rule of "Narasi" — the
operator: "add in parenthesis what are tiga jenis kata; if i read this majrur and huruf jar is part
of tiga jenis kata, make the sentence more clear"; a name may list its members in brackets beyond
the four-word limit, `lessonmap.name_words`. "Mu’rab dan mabni" names both its members already and
is joined by ", serta" in a list.)

**The switch** (`authored/<slug>.map.json`; Al-Fatihah only). The file's existence switches a
surah on: `build_map.py` then writes `content/map/<slug>.json`, `build_narration.py` adds the map
lines, the app shows the cards. A surah without it gets none of this. The file holds only `names`:
an explicit short name for a NEXT-LEVEL record whose "Konsep baru" title opens with no clean name
(`lessonmap.cut_name`, the prose twin of `src/lib/emphasis.ts` `conceptName`: the title's words up
to its `,` `:` `.` `;` or the ` (` of its gloss, at most four). A step's name is the curriculum's
(`steps[].name`, the form its own caption opens with). The `later` key of version 1 — an authored
item for something an ayah shows without explaining — is refused: its one use, marfu' in ayah 1,
is a step of the curriculum now, listed under "Nanti" by the rule.

**File** (`content/map/<slug>.json`, version 2): `steps` (every step the ayat list: `name` its
caption form, `latin` the prose, `lesson` the curriculum lesson that teaches it), `lanjut` (every
next-level record listed: `name`, `latin`, `from` title | authored), `ayat` (`{ayah, new,
learnt: [{id, here}], later, lanjut, kinds}`, ids; `kinds` the kinds of word the ayah's words are
made of, below) and `kinds` (the step of the three kinds of word: `{step, name, latin, members:
{isim, fiil, huruf: {name, latin}}}`, its name without its members and each kind's name from the
pronunciation dictionary; null when no ayah lists that step). Self-contained on purpose: the page needs no second
file to draw a card. Read by the narration build and validator, by the page
(`src/lib/map-content.ts`: zod, then `lessonMapProblems` against the curriculum in TypeScript — a
file that disagrees with it fails `next build`) and by the engine checks.

**The lines** (operator 2026-10-15; `build_narration.map_new` / `map_again` /
`map_later` / `map_focus` / `map_closing` / `map_total`; ids `${slug}:${ayah}:map:new`,
`:map:again`, `:map:later`, `:map:focus` right after `recite`, and
`${slug}:${ayah}:learned`, `:map:total` right before `recap`; highlight `[]`, no word card; never
split). The operator's rule: a sentence that COUNTS steps also NAMES every one of them — "Sebelum
ayat ini, kita sudah mempelajari dua hal, yaitu XXX dan YYY. Yang kita temui lagi di ayat ini adalah
YYY."; "Dengan itu, sudah empat hal yang kita pelajari, yaitu A, B, C, D" — "similar sentences
should follow this pattern, always re-mention what they are". No "di antaranya" any more, and no
"ada satu: X". Every list is in TEACHING ORDER, the order the card lists the steps in (the steps
met again: until 2026-10-15 the most recent first, a few of them); the running total is the learnt
steps in teaching order, then the ayah's new ones. A next-level topic is still counted, never named
(decision 6: the card names it). Since a full list is long (Al-Fatihah 7: sixteen learnt, nineteen
in all), each such sentence is ONE LINE of its own, so no line is split (MAX_LINE 400 spoken
characters; the longest, `al-fatihah:7:map:total`, is 321). A step of the lesson keeps its card
while its lines are said one after the other (src/lib/autoplay/lessonMap.ts `MAP_LINES`: the step
`map:learnt` says `map:again` alone since 2026-10-17, `map:later` says `map:later` + `map:focus`, `learned`
says `learned` + `map:total`). And what an ayah puts aside is followed by a reassurance (operator,
the same day: "Sekarang Anda tidak perlu menghafal ketiganya, mari kita fokus pada pelajaran XXX
dan YYY terlebih dahulu" — and the same for the next-level topics, and with nothing new "we focus
on repeating what we already learnt"). A group with nothing in it has no line
(`validate_narration.map_opening_parts`, `map_closing_parts`; twin `lessonMap.ts mapOpening`,
`MAP_LINES`). A name with a "dan" of its own is joined by ", serta". The templates (N, T: the
counts in words; lists `_names`):

| line | when | template |
|---|---|---|
| `map:new` | always | "Di ayat ini ada N hal baru: A, B, dan C." · none: "Di ayat ini tidak ada hal baru." |
| `map:again` | something was learnt before (the step `map:learnt`) | "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah A dan B." (every one met again; one: "… adalah A."; it stands on its own: until 2026-10-17 it followed the line below and opened "Yang kita temui lagi …") · none: "Tidak ada yang kita temui lagi di ayat ini." · the three kinds of word as the ayah has them (since 2026-10-18, below): with all three "tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف)"; with fewer the step bare, "tiga jenis kata", and a last sentence "Dari tiga jenis kata itu, di ayat ini hanya ada isim (اِسْم)." (the same in the reassurance and the closing of an ayah with nothing new) |
| ~~`map:learnt`~~ | removed 2026-10-17 | was "Sebelum ayat ini, kita sudah mempelajari N hal, yaitu A, B, …, dan P."; the count of everything learnt so far is said only by `map:total` |
| `map:later` | a step is postponed or a next-level topic is here | postponed, every one named — all taught in ONE ayah of this surah: "Ada N hal lagi di ayat ini, yaitu Z dan W, tetapi baru akan diajarkan lebih lengkap di ayat ketiga."; in several ayat of it: "Ada N hal lagi di ayat ini, tetapi baru akan diajarkan lebih lengkap nanti: Z di ayat ketiga, serta W di ayat ketujuh."; any of them taught in another surah (or no whole ayah): "Ada N hal lagi di ayat ini, yaitu Z dan W, tetapi baru akan diajarkan lebih lengkap nanti." (until 2026-10-17 "baru kita bahas …"; operator: "better to say konsep ini baru akan diajari lebih lengkap di ayat keXX") — then the next-level count: "Ada juga N hal tingkat lanjut, yang tidak kita bahas di tingkat dasar." (alone: "Di ayat ini ada N hal tingkat lanjut, …") |
| `map:focus` | with `map:later` | "Sekarang Anda tidak perlu menghafal ⟨P⟩[, dan tidak perlu memikirkan hal tingkat lanjut tadi]." — ⟨P⟩ by the count of the postponed steps: 1 "yang satu ini", 2 "keduanya", 3 "ketiganya", more "semuanya"; the bracket when next-level topics are there too; next-level topics alone: "Sekarang Anda tidak perlu memikirkan ⟨P⟩." (⟨P⟩ by their count) — then "Mari kita fokus pada pelajaran A dan B terlebih dahulu." (the ayah's new steps, every one; at most three, the curriculum's limit) · nothing new: "Mari kita fokus mengulang A dan B terlebih dahulu." (the steps met again) · nothing new and nothing met again: "Mari kita fokus pada ayat ini terlebih dahulu." |
| `learned` | always | "Di ayat ini kita mempelajari N hal baru: A, B, dan C." · nothing new: "Di ayat ini tidak ada hal baru; kita mengulang N hal yang sudah kita pelajari, yaitu A dan B." · nothing met again either: "Di ayat ini tidak ada hal baru." |
| `map:total` | always | "Dengan itu, sudah T hal yang kita pelajari, yaitu A, B, …, dan S." (every step learnt by the end of the ayah) · nothing new: "Sampai ayat ini, sudah T hal …, yaitu …" |

Al-Fatihah, all seven ayat, as built (caption forms; the spoken text says each term from Arabic
script or its respelling, "Narasi"): ayah 1 —

- `map:new` "Di ayat ini ada dua hal baru: majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ)." (kept)
- `map:again` "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah harakat, serta tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف)."
- `map:later` "Ada tiga hal lagi di ayat ini, tetapi baru akan diajarkan lebih lengkap nanti: alif lam (ال) di
  ayat ketiga, na’t (نَعْت) di ayat ketiga, dan idhafah (إِضَافَة) di ayat keempat. Ada juga satu hal tingkat
  lanjut, yang tidak kita bahas di tingkat dasar."
- `map:focus` "Sekarang Anda tidak perlu menghafal ketiganya, dan tidak perlu memikirkan hal tingkat
  lanjut tadi. Mari kita fokus pada pelajaran majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ) terlebih dahulu."
- `learned` "Di ayat ini kita mempelajari dua hal baru: majrur (مَجْرُور) dan huruf jar (حَرْف جَرّ)."
- `map:total` "Dengan itu, sudah empat hal yang kita pelajari, yaitu harakat, tiga jenis kata, yaitu isim (اِسْم), fi’il (فِعْل), dan huruf (حَرْف), majrur
  (مَجْرُور), serta huruf jar (حَرْف جَرّ)."

(`python3 build_narration.py --show al-fatihah:7:map` prints the longest ones.)

`validate_narration.map_problems` reads the lines back from their captions: each count; that the
names after it are EVERY step of the group, in the map's order, each once (a step left out, another
order, a selection after "di antaranya", a count that disagrees with the names given, the old
shapes "ada satu: X" / a bare count, all fail with their reason; names parsed against the map's
names, the longest first); that the new ones are the ayah's `concept:*` lines and are named as their
own captions name them; each postponed one's ayah; that no next-level topic is named; the
reassurance's verb, pronoun, next-level clause and focus; that the closing names the new steps and
the total line every step learnt by then, opening "Dengan itu" exactly when the ayah taught
something. The caption-only fallback (src/lib/autoplay/texts.ts, a line without a narration display:
a surah without narration) says the same sentences with digits for the counts and the names without
their Arabic (lesson-map.test.ts holds it equal to every Al-Fatihah map line's display, the numbers
aside); the English captions (src/components/autoplay/texts.ts) translate them.

**On the stage** (`LessonMapCard.tsx`, in the word card's slot): ONE GROUP AT A TIME, in step
with the narrator, so new and already-learnt are never on screen together — "Baru di ayat ini";
"Sudah kita pelajari (N hal)" with "Kita temui lagi di ayat ini (n):" (up to `MAP_HERE_FULL` = 3
names one per row with their Arabic and a repeat mark, more as one flowing line of Latin names)
and "Tidak ada di ayat ini (n)"; "Nanti" (each with its ayah; up to `MAP_LATER_FULL` = 2 rows) with
"Tingkat lanjut (N hal)" and "Tidak kita bahas di tingkat dasar."; and at the closing "Baru saja
kita pelajari" with a tick per step and "Sudah N hal kita pelajari." Built for a phone's small
room (measured in CI at 390×844: about 270px above the caption panel): what a phone does not
show — the names not met again, the next-level names — takes no box there (`max-sm:hidden`, never
a visually hidden 1px box: the line-break check would measure its text), and a count stands in
brackets beside its heading as one piece, so no line starts with a separator. A map line's
karaoke caption goes one ≤180-character part at a time (`caption.ts karaokeParts`). On a word's
card (Materi lengkap) a concept an earlier lesson taught says "sudah dipelajari di ayat N".

**The kinds of word met HERE** (operator 2026-10-18: "we always say in this ayat we find 3 jenis
kata: isim, fi'il, huruf. But actually in that ayat (example ayat-3) we only have isim, no harf or
fi'il. Fix this in all lessons."). The step "Tiga jenis kata (isim, fi'il, dan huruf)" occurs in
every ayah (`occurs.always`), but an ayah need not have all three kinds. Each map entry carries
`kinds`, the kinds its words' parts are (`lessonmap.kinds_of` → `quiz.part_kinds`: each part's QAC
tag through `quiz.QAC_KIND`, the article counted with its part — the warm-up's own rule, so the
warm-up and the map always agree). Al-Fatihah: 1 and 2 isim and huruf, 3 and 4 isim only, 5 and 7
all three, 6 isim and fi'il. Where a line or the card says the step is MET HERE it names those
(`build_narration._said_here` / `kinds_sentence`, `lessonmap.KINDS_SENTENCE`; the card's row "Tiga
jenis kata: di ayat ini hanya isim (اِسْم)", in a flowing line "Tiga jenis kata (di ayat ini hanya
isim)", messages `Guided.map_kinds_here` / `map_kinds_flow`; TS `lessonMap.ts mapKindsPartial`,
`mapHereSaid`, `mapKindsSaid`). Where the line is the DEFINITION — what was learnt (`map:total`),
lesson zero's Konsep line, the warm-up's three buttons — the three stay. Held by
`validate_narration.map_kinds_here` (fewer kinds named whole, "names isim, fi'il, huruf as met in
this ayah"; a kind the ayah does not have, one left out; the sentence left out; the sentence where
all three occur; the step named bare where all three occur) and `lessonmap.problems` (the entry's
`kinds` against the words, the `kinds` table), each with planted faults; a new surah is covered the
day its map is switched on (the rule needs only each word's QAC line).

```bash
python3 build_map.py            # write content/map/*.json (after build_curriculum, BEFORE build_narration)
python3 build_map.py --check    # exit 1 if a file differs from a fresh build
python3 build_map.py --show     # the table and every name
python3 validate_map.py         # the rules, each on its own; the names against the captions; a fresh build
python3 test_validate_map.py    # 46 planted faults
```

**Rendering the lines (2026-10-13: prepared, NOT rendered).** After the curriculum (21 map lines,
four new "Konsep baru" texts, the seven closings that say the running total) and, the same day,
the rework on it — the structure told item by item (24 lines for 7), `why_basic` in the quiz
explanations, the new quiz plan, the reworded compositions and "Konsep baru" texts, lesson zero
(two new lines, four reworded primer lines) and the warm-up (44 lines: an introduction and one
sentence per question) — Al-Fatihah has 402 lines, 270 with `audio`, and **132 without** (120
distinct texts: identical lines are rendered once — the label-role intro of ayat 2 and 6, and
most of the warm-up's sentences, which are the same from ayah to ayah). A line that moved with
its text kept its audio, under whatever id it has now (`build_narration.manifest`: a recorded
file is named by its text, so a line without a recording under its own id takes the recording of
any line that said exactly its text): the five primer lines that were not reworded, the kalimah
record's line, the moved "Konsep baru" lines. The 132 play caption-only until rendered:

| lesson | lines without audio |
|---|---|
| 0 (6) | `intro`, `primer:1`, `primer:4`, `primer:6`, `primer:8`, `next` |
| 1 (20) | `map:new`, `map:learnt`, `map:later`, the warm-up (6), `w2:compose:2`, `w2:compose:3`, `w3:compose:1`, `w3:compose:6`, `w3:compose:7`, `concept:majrur`, `structure:1`–`4`, `learned` |
| 2 (22) | the three `map:` lines, the warm-up (6), `w3:compose:3`, `w4:compose:5`, `concept:marfu`, `concept:jamak-mudzakkar-salim`, `structure:1`–`4`, `ex:sort-case:2:why`, `ex:sort-case:3:why`, `ex:label-role:intro`, `ex:label-role:2:why`, `learned` |
| 3 (11) | the three `map:` lines, the warm-up (3), `w1:compose:4`, `concept:alif-lam`, `structure:1`–`2`, `learned` |
| 4 (11) | the three `map:` lines, the warm-up (4), `structure:1`–`3`, `learned` |
| 5 (18) | the three `map:` lines, the warm-up (6), `concept:fiil-mudhari`, `structure:1`–`3`, `ex:sort-case:1:why` … `4:why`, `learned` |
| 6 (17) | the three `map:` lines, the warm-up (5), `concept:manshub`, `structure:1`–`3`, `ex:sort-case:1:why`, `ex:label-role:intro`, `ex:label-role:1:why`, `ex:label-role:2:why`, `learned` |
| 7 (27) | the three `map:` lines, the warm-up (14), `structure:1`–`5`, `ex:sort-case:1:why`, `ex:sort-case:3:why`, `ex:label-role:1:why` (1:7:2's `why_basic`: its recording is of the older text), `ex:label-role:3:why`, `learned` |

("the warm-up (n)": `ex:word-kind:intro` and `ex:word-kind:1:why` … of that ayah.) One shared
line is new too: `shared:ex:word-kind:options` (its `reveal` and `next` prompts say what the
other exercises' say, and took their recordings).

Dry run: 120 distinct texts, 14,752 characters, USD 1.18 for Al-Fatihah, and 1 text, 41
characters for `shared` — 121 texts, 14,793 characters, about USD 1.18; none is refused (no
heavy letter without a respelling, no Latin term outside the dictionary). `--render` sends only the lines without
`audio`, so the whole surah is the selection. In order, from `belajar/pipeline` (`OUT`: where the
masters of record are, so the upload list sees every delivered file; without `--out` the files go
to `pipeline/out` of this checkout):

```bash
OUT=/path/to/the/checkout/with/the/masters/belajar/pipeline/out

# 0. What would be sent (no key read, nothing sent): must say 120 distinct texts, then 1.
python3 render_narration.py --surah al-fatihah
python3 render_narration.py --surah shared
# 1. Render (the one step that costs money) and deliver: the masters to $OUT/narration/kang-nandar/al-fatihah/<audio_name>.mp3
#    (+ .json alignment), the delivered files to $OUT/delivery/kang-nandar/al-fatihah/<delivery_name>.mp3; the manifest
#    gets each line's audio {url, ms, sha256} and tokens.
python3 render_narration.py --render --i-approve-spend --voice-id aK834gEOxQEtviMPgurT --voice-name "Kang Nandar" \
    --env-file /path/to/dakwah-lens/.env --out "$OUT" --surah al-fatihah
#    … and the same command with --surah shared (one line: the warm-up's prompt).
# 2. The manifests are what the build gives, and valid (402 of 402 Al-Fatihah lines with audio, 26 of 26 shared).
python3 build_narration.py --check && python3 validate_narration.py
# 3. Every delivered file is on this machine as described; write the upload list.
python3 encode_narration.py --check --out "$OUT" --list "$OUT/delivery/files.txt"
# 4. Upload the listed files, check each as served ("Before a deploy", steps 3 and 4), commit the manifest, push.
```

Four lines got their `audio` entry back from the repository's history through that carry-over
(their texts are again exactly what was recorded: `0:concept:kalimah-isim-fiil-huruf`, said as
`1:concept:kalimah-isim-fiil-huruf` until the curriculum; `7:ex:label-role:intro`, `:1:why`,
`:2:why`). Step 3 (`encode_narration.py --check`) is what proves their files are still on the
machine with the masters, and "Before a deploy" that they are still served.

`[[ma'rifah]]` (the alif lam text says it) is in the pronunciation dictionary with `approved:
"pending-ear-check 2026-10-13"`: listen to `al-fatihah:3:concept:alif-lam` after the render.

Until then: `scripts/ci/screenshots.mjs` `aheadChecks` (phone) stops at its first line — it follows
the lesson map's first line of ayah 1 (`al-fatihah:1:map:new`) as the file fetched two steps ahead
and needs it rendered. Every pipeline check, the vitest suite and the other browser checks pass
rendered or not (a line without audio is caption-only by design).

### The words are the narrator's (2026-10-14): the lines that said "imam" of a single word

Operator 2026-10-14: every Qur'anic word played on its own is the narrator Kang Nandar's recording
of it (content/wordvoice.json, "Suara contoh" / src/lib/wordvoice.ts), never a cut of the imam's
recitation; whole ayat stay the imam's. The lines that said the IMAM recites or stops on one word
were reworded, and only those: `shared:ex:tap-word:play` ("Dengarkan satu kata dari ayat ini."),
`shared:ex:tap-word:options` ("… yang tadi dibacakan."), every `ex:tap-word:intro` ("Akan dibacakan
N kata …"), the seven stop lines of Al-Fatihah's compositions ("… dan bacaan berhenti padanya, …",
with the frame note "bacaan berhenti di sini", composition.ts STOP_NOTE) and `shared:start`
("Ayat Al-Qur'an dibacakan oleh imam; kata-kata yang dibacakan satu per satu disuarakan oleh
narator dengan suara kecerdasan buatan."), which is now longer than MAX_LINE and split into
`shared:start:a` and `:b`. The lines about the whole ayah ("Sekarang dengarkan imam membacakan
ayat …", the recap) are unchanged. 17 lines of Al-Fatihah and shared lost their audio (12 distinct
texts, 1,551 characters, about USD 0.12); the Mu'awwidzat's `ex:tap-word:intro` lines were never
rendered. Until the render: those lines are caption-only, and `loadingChecks` / `aheadChecks`
(browser) stop at `shared:start:a`, which they need rendered. The dry run of exactly those lines,
and nothing else (every other line keeps its audio and is not selected):

```bash
python3 render_narration.py --only shared:start --only shared:ex:tap-word:play --only shared:ex:tap-word:options \
    --only al-fatihah:1:ex:tap-word:intro --only al-fatihah:2:ex:tap-word:intro --only al-fatihah:3:ex:tap-word:intro \
    --only al-fatihah:4:ex:tap-word:intro --only al-fatihah:5:ex:tap-word:intro --only al-fatihah:6:ex:tap-word:intro \
    --only al-fatihah:1:w4:compose:4 --only al-fatihah:2:w4:compose:9 --only al-fatihah:3:w2:compose:5 \
    --only al-fatihah:4:w3:compose:4 --only al-fatihah:5:w4:compose:3 --only al-fatihah:6:w3:compose:7 \
    --only al-fatihah:7:w9:compose:8
# must say: 12 distinct texts, 1551 characters. The render is the same command with
#   --render --i-approve-spend --voice-id aK834gEOxQEtviMPgurT --voice-name "Kang Nandar" --env-file … --out "$OUT"
```

### The words are Quran.com's (2026-10-15), and the recordings are on our server

Operator 2026-10-15, after listening to the narrator's word takes: "still lacking"; "use
quran.com, mention the credit"; then "it's on me, they will allow us to copy and distribute for
educational non-profit purposes; we copy to our server so latency is minimum"; "just make sure no
latency (preload before page is opened)". So:

- **Every text that is a word at a real place in the Qur'an plays Quran.com's (Quran Foundation)
  word-by-word recording of that place** (`wordvoice.py`, module docstring). The place comes from
  the content, never a search: a lesson word, a composition form quoting a whole word, a
  composition example's bentuk dasar, a Konsep word (library.json `quran`, whole-word keys). Of a
  text's places, an AYAH-FINAL one first (its recording is then the stop form the lessons
  describe), else the first in lesson order (curriculum.json), else the Konsep words in mushaf
  order. A form built by edits is not placed by its `attested` list (operator: "teaching forms
  built by ops such as ismi, bi+ismi" stay the narrator's). 2026-10-15: **83 of 193 texts** are
  Quran.com's — every one of the 65 lesson words, and the Konsep words and bentuk dasar with a
  place (ismu → 55:78:2, ar-raḥmānu → 20:5:1, …); **110 stay the narrator's**: 51 runs of several
  words (no word file holds two words), 19 parts of words (bi-, -hum, -ta, …, also where those
  bytes are a word elsewhere: لَا, هُمْ; 2 of them also a Harakat card's letter), 15 more letters
  of the Harakat cards, and 25 composition forms with no place (built by edits: ismi, bi+ismi,
  raḥmān, maliku, aṣ-ṣirāṭu, al-mustaqīmu, al-maghḍūbu …; pieces: ḥamdu, ihdi …). No text has
  places both ending an ayah and inside one (`wordvoice.choice_conflicts` is empty).
- **The file is the word's POSITION, not the API's `audio_url`**: in 9 of the 40 ayat
  (2:5, 2:30, 5:23, 6:90, 6:126, 17:78, 26:24, 33:37, 41:9) api.quran.com counts pause marks /
  a rub' al-hizb sign and names files the CDN does not have (wbw/041_009_015.mp3 and _016 answer
  404; the CDN holds one file per word, _001 … _014 — checked for all nine, 2026-10-15). The one
  chosen place among them, 41:9:13 (rabbu), plays wbw/041_009_013.mp3. Every chosen place's word
  in the fixture is the text (folded skeleton), and Quran.com counts each ayah's words as Tanzil
  does (`build_wordvoice.py --check`, locally).
- **Unaltered.** A word plays [start, end] of its file (`audio.start`/`end`: the leading and
  trailing silence under -45 dB left out, 30 ms kept); the file itself is upstream's, sha256 and
  all. 83 files, 4.90 MB (320 kbps stereo). The imam's ayat likewise: every ayah a lesson recites
  and every ayah a Konsep / composition example clip is cut from, 32 files, 3.95 MB, our copy of
  EveryAyah's `Alafasy_128kbps/<SSS><AAA>.mp3` (`build_surah.everyayah_url` now gives our URL;
  the quran-align timings time the same file). The compositions' source citations of his recording
  ("Rekaman imam pelajaran: Mishary Alafasy, EveryAyah 001001.mp3", `authored/al-fatihah.compose.json`,
  13 of them) link our copy too (absolute, https://dakwah-lens.id/belajar/media/narration/alafasy/…:
  a SourceRef url is a full URL, schema.ts): no file of the content names an EveryAyah address, so a lesson page
  carries none (`stage.test.ts`; CI `surahs-smoke.mjs` oneImam failed on those 13 links on PR #116).
  The fact cards' ayah popup is NOT copied (any of
  1,629 ayat; a sample of 40 averaged 342 KB: about 556 MB, past the operator's 60 MB line) and
  still streams from EveryAyah — the only reason `everyayah.com` is still in the CSP's `media-src`
  (`audio.qurancdn.com` and `verses.quran.com` are no longer listed: nothing plays from them).
- **Fetched before it is asked for** (`src/lib/media-prefetch.ts`): an ayah page fetches its
  recitation and every word / example file of the lesson at idle, before "Mulai" (3–13 files,
  135 KB – 1.04 MB per ayah; Al-Fatihah 7 is the largest: 13 files, ~1,039 KB; lesson zero, the
  Pengantar, its 5 kalimah examples' word files, ~355 KB — wa lā, 1:7:8, is one written word and
  one Quran.com file, not a run), the next ayah's
  from two thirds of the lesson on; a Konsep / Harakat page its example files (at most 12). Not
  with Save-Data / 2G.

Paths: `/belajar/media/narration/quran-com/wbw/<SSS>_<AAA>_<WWW>.mp3` and
`/belajar/media/narration/alafasy/<SSS><AAA>.mp3`, under the prefix Caddy already serves from
`/srv/dakwah-lens/data/belajar-media/narration` with `Cache-Control: public, max-age=31536000,
immutable` (deploy/Caddyfile `@narration`): nothing to configure. The names are upstream's, not
content-hashed, so a file is never replaced under its name: should upstream change one, its pin
fails first, and the copy gets a new name.

```bash
# The word voices and their places (no spend; --fetch-quran-com only reads api.quran.com and audio.qurancdn.com):
python3 build_wordvoice.py --fetch-quran-com   # fixture + copies in out/upstream/quran-com/wbw + the manifest
python3 build_wordvoice.py --check             # + Tanzil bytes of every place, every copy against its pin
python3 host_media.py --fetch                  # the imam's copies (lesson ayat from fetch.py's cache), pinned in hosted.json
python3 host_media.py --check
python3 host_media.py --deliver --out "$OUT"   # $OUT/delivery/{alafasy,quran-com/wbw}/… + $OUT/delivery/files-hosted.txt
```

The narration's opening line said the words were the narrator's AI voice: `shared:start` now reads
"… Ayat Al-Qur'an dibacakan imam; suara kata per kata dari rekaman Quran.com, kecuali bentuk
latihan. Penjelasan ini dan bentuk latihan dibacakan dengan suara kecerdasan buatan, …" (399
characters: one file, MAX_LINE 400). It lost its audio (caption-only until rendered, and the
browser checks that follow it, `loadingChecks` / `aheadChecks`, stop there until then). The dry
run of exactly that line must say 1 distinct text, 399 characters, USD 0.03:

```bash
python3 render_narration.py --only shared:start
#   render: … --render --i-approve-spend --voice-id aK834gEOxQEtviMPgurT --voice-name "Kang Nandar" --env-file … --out "$OUT" --only shared:start
```

### Every counted step named, and the reassurance (2026-10-15): prepared, NOT rendered

The lines of "The lines" above (operator 2026-10-15) changed the text of 15 lines of Al-Fatihah and added 21
(`map:again`, `map:focus`, `map:total` of each ayah; `learned` lost its second sentence to
`map:total`); `map:new` of every ayah and `map:later` of ayat 1 and 3–7 kept their text, and their
audio. **36 lines have no audio** until the operator approves the render: per ayah `map:learnt`,
`map:again`, `map:focus`, `learned`, `map:total`, and `al-fatihah:2:map:later` (its four postponed
steps are all named now, "di antaranya" is gone). Dry run (exactly those, nothing else): **36
distinct texts, 5,254 characters, about USD 0.42** (eleven_v3 list price, first take), none refused
— no new dictionary term: every Arabic term they speak is one the narrator already says elsewhere.
One new Indonesian word sits in a heavy-letter guard's way: "menghafal" (meng- + hafal, the
operator's own wording) reads as gh + a to `HEAVY_LATIN`, so it is in `validate_narration.NOT_HEAVY`
with that reason; listen to `al-fatihah:1:map:focus` after the render (it should be plain
Indonesian "meng-hafal").

```bash
# must say: 36 distinct texts, 5254 characters
python3 render_narration.py --surah al-fatihah --only al-fatihah:1:map:learnt \
    --only al-fatihah:1:map:again --only al-fatihah:1:map:focus --only al-fatihah:1:learned \
    --only al-fatihah:1:map:total --only al-fatihah:2:map:learnt --only al-fatihah:2:map:again \
    --only al-fatihah:2:map:later --only al-fatihah:2:map:focus --only al-fatihah:2:learned \
    --only al-fatihah:2:map:total --only al-fatihah:3:map:learnt --only al-fatihah:3:map:again \
    --only al-fatihah:3:map:focus --only al-fatihah:3:learned --only al-fatihah:3:map:total \
    --only al-fatihah:4:map:learnt --only al-fatihah:4:map:again --only al-fatihah:4:map:focus \
    --only al-fatihah:4:learned --only al-fatihah:4:map:total --only al-fatihah:5:map:learnt \
    --only al-fatihah:5:map:again --only al-fatihah:5:map:focus --only al-fatihah:5:learned \
    --only al-fatihah:5:map:total --only al-fatihah:6:map:learnt --only al-fatihah:6:map:again \
    --only al-fatihah:6:map:focus --only al-fatihah:6:learned --only al-fatihah:6:map:total \
    --only al-fatihah:7:map:learnt --only al-fatihah:7:map:again --only al-fatihah:7:map:focus \
    --only al-fatihah:7:learned --only al-fatihah:7:map:total
# the render: the same command with
#   --render --i-approve-spend --voice-id aK834gEOxQEtviMPgurT --voice-name "Kang Nandar" --env-file … --out "$OUT"
# then build_narration.py --check, validate_narration.py, encode_narration.py --check --out "$OUT" --list …,
# and the upload steps of "Rendering the lines" above.
```

Until then the 36 lines play caption-only at reading pace (each lesson-map step still says its
`map:new`, and ayat 1, 3–7 their `map:later`, in the narrator's voice). CI does not need them: the
pipeline checks and vitest pass either way, `lessonMapChecks` works rendered or not (it reads each
step's FIRST line's caption), `aheadChecks` follows `al-fatihah:1:map:new` (kept its audio) and, at
its step 6, the next file due after it — `al-fatihah:1:map:later`, two steps on, kept too — and
`loadingChecks` uses `shared:start` and word 1.

### The review of 2026-10-17 (Pengantar and Al-Fatihah 1–2): prepared, NOT rendered

The operator's review of lesson zero and of ayat 1–2, item by item (his rules are numbered in
"Operator's lesson-wording rules" below):

1. **The letter alone on screen** ("i think we dont need to write “ba’” here, only the arabic one is
   enough, also apply this rule to similar sentences"): "Contohnya huruf ba’ (ب) ini, tanpa harakat."
   reads "Contohnya huruf ب ini, tanpa harakat.", and so does every caption that showed a single
   letter as "<Latin name> (<letter>)" (`Term.bare`; the article keeps "alif lam (ال)", grammar terms
   keep "fathah (فَتْحَة)"). Display only: the spoken text is unchanged, every such line kept its
   delivered file (url, sha256, ms), and the karaoke words of the rendered ones were re-derived by
   `build_narration.py` from their existing timings (`retext_tokens`; the timings byte-identical).
2. **sin** ("you read it siiiin, i think sin is enough"): سِين was spoken from Arabic script and the
   voice drew the long ī out (its karaoke word in `primer:9` lasted 560 ms, the ba’ of `primer:3`
   240 ms). Now `speak: "sin"`, "pending-ear-check 2026-10-17". Lines: `al-fatihah:0:primer:9`,
   `:primer:10` (`al-fatihah:2:w1:compose:3` said it too, until item F struck its comparison). Not
   changed, the same shape: مِيم (200–360 ms in `primer:13`/`14`) and نُون.
3. **Two cut takes**, `al-fatihah:0:primer:1` and `al-fatihah:4:w1:compose:2` ("A take cut short").
4. **Harakat met again in every ayah**; **"tiga jenis kata" named with its members**; **"baru akan
   diajarkan lebih lengkap"** for what a later ayah teaches — the lesson map (all `map:learnt`,
   `map:again`, `map:total`, five `map:later`) and the compositions / structure items that said
   "kita pelajari di ayat …" (see "Peta pelajaran").
5. **Named words** ("Narasi", the named word): ayah 1's structure items, the explanation of بِ, ٱسْمِ,
   ٱللَّهِ, the alif of بِٱسْمِ (cause → effect, the alif of ٱسْمُ not read after بِ), the base forms said
   with their words (ٱللَّهُ, رَبُّ, ٱلْعَٰلَمُونَ, ٱلضَّآلُّونَ — the last two only named in the caption, a
   form no frame shows), the particles بِ, لِ, وَ, لَا said by their sound, and every "kata yang artinya
   …" of Al-Fatihah shown with its word.
6. **Ayah 2 without back-references** ("better to remove this lines to make it less complicated"):
   ", seperti di ayat pertama" (`w1:compose:1`), "seperti di atas huruf sin pada ayat pertama"
   (`w1:compose:3`), the sentence "Huruf sesudahnya pun tidak dibaca dobel, berbeda dengan huruf ra’
   …" (word 1's lines after it are renumbered and kept their recordings, by text), and "seperti di ayat
   pertama" in the alif sentence; the base-form lines that pointed at another ayah (ٱللَّهُ, رَبُّ, an‘ama)
   lost their pointer.
7. **The operator's rulings on the rest** (same day): (1) every back-reference to an earlier ayah
   goes, in Al-Fatihah 2–7 and in the other surahs' authored text ("remove the comparison, keep
   the sentence complete"; wording rule 8 below); (2) every word named by its place and meaning also shows
   and says the word, "even when the stage highlights that word" — every word line ("Kata pertama,
   yaitu بِسْمِ (bismi), artinya: …"), every quiz "Itu kata …", the structure items, the Konsep
   examples of lesson zero (wording rule 5 below); (3) the Al-'Alaq wording stays; (4) the screen reader
   reading "huruf ini" for a bare letter is accepted for now; (5) ٱلْعَٰلَمُونَ and ٱلضَّآلُّونَ named in
   captions only, with no example voice, are accepted. The named words whose sound waits for his ear
   stayed HELD for the first render (the 118 texts below, rendered 2026-10-17).
8. **Heavy-letter words are shown and explained, never said** (same day, the operator: "better not
   to use heavy-letter words with elevenlabs, we just explain but not read them; simple words so
   far is ok"). A named Qur'anic word with ص ض ط ظ ق خ غ among its Arabic letters — or whose plain
   spelling the heavy-letter guard would still refuse — is named in the caption ("Kata pertama,
   yaitu صِرَٰطَ (ṣirāṭa), artinya: “jalan”") and left out of the spoken text with its connector
   ("Kata pertama artinya: jalan"); a simple word is said as it is written (bismi, ismi, rabbi,
   al-hamdu, na'budu, 'alaihim, alladzina, al-'alamina, a'udzu …). The one rule is
   `validate_narration.named_is_said` (mirrored by the TS `namedIsSaid`); the markup says it
   ({{s:a:w}} said, {{!s:a:w}} shown only, and must agree); the respellings tried for a few hours
   the same day (ash-shirotho, ghoiri, adh-dhollina, kholaqo; pronunciation.json `named`) are
   retired. By side, as built: Al-Fatihah shows only aṣ-ṣirāṭa, ṣirāṭa, al-mustaqīma, gairi,
   al-magḍūbi, aḍ-ḍāllīna, aḍ-ḍāllūna, khalaqa; Al-Ikhlas aṣ-ṣamadu, qul; Al-Falaq qul, al-falaqi,
   gāsiqin, waqaba, al-‘uqadi, khalaqa; An-Nas qul, al-khannāsi, ṣudūri. Every other named word is
   said.

The renders of 2026-10-17: 118 distinct texts (13,331 characters, about USD 1.07; with
`--skip-held`), then the 30 lines that named a held word, in the respellings of that afternoon (30
texts, 3,360 characters, USD 0.27). Item 8 takes the heavy words out of the speech again: 16
Al-Fatihah lines change their spoken text and lose that audio — **16 distinct texts, 1,586
characters, USD 0.13** in the dry run, of which 11 are texts recorded before (their masters are on
disk: the render reuses them, paying nothing), so about 5 texts, 562 characters, USD 0.05 are new.
No shared line changed; the other surahs have no audio yet.

```bash
OUT=/path/to/the/checkout/with/the/masters/belajar/pipeline/out
# must say: 16 distinct texts, 1586 characters, no "refused by --render"
python3 render_narration.py --surah al-fatihah
# the render: the same command with
#   --render --i-approve-spend --voice-id aK834gEOxQEtviMPgurT --voice-name "Kang Nandar" --env-file … --out "$OUT"
# It exits 1 and lists the line under REFUSED if ElevenLabs cuts a take (kept as <file>.cut-<k>.mp3); run
# the same render once more for those. The cut masters of primer:1 and 4:w1:compose:2 in $OUT are found
# ("cut    <id>"), moved aside as <file>.cut-1.mp3, and the lines rendered anew. Then build_narration.py
# --check, validate_narration.py, encode_narration.py --check --out "$OUT" --list …, listen (sin, the named
# words, the cut lines), and the upload steps of "Rendering the lines" above.
```

### Sibling lines (2026-10-17): its 26 lines rendered; the follow-ups prepared, NOT rendered

The operator's "finish this: Sibling lines" — the leftovers of "name the word, not only its
meaning" (wording rule 5):

- **A. The parts of a composition named by themselves.** 21 composition lines of ayat 1–7 named a
  tile by its kind and meaning only ("Bagian kedua adalah isim yang artinya “Maha Pengasih”", "Alif lam
  bersambung dengan isim yang artinya “jalan”", "Bagian pertama adalah huruf jar yang artinya “kepada”",
  "Dhamir yang artinya “mereka” ini …"); each now names the frame's form, "isim, yaitu رَحْمَٰن (raḥmān),
  yang artinya …" (the parts of a join frame by its `from` forms; ṣirāṭ, mustaqīm, magḍūb, ḍāllīna
  caption-only). 1:7:4 got the form `him` (هِمْ, its own bytes, as 1:7:7 has), which the warm-up's
  part 2 of ‘alaihim now names too (`7:ex:word-kind:6:why`). Two `why_basic` of the same shape were
  named the same way: 1:2:2 (لِ) and 1:6:1 (نَا).
- **B. A word named once.** An-Nas 4:w1 and 5:w3 said the word twice (the word line, then its why's
  "Kata ini, yaitu …"): `build_narration.named_once`. Al-Fatihah 1's structure item 2 named ٱسْمِ again
  right after item 1 ("Isim itu disandarkan …"); Al-Falaq 3's structure (split :a/:b) named أَعُوذُ
  twice ("… dikaitkan dengan kata kerja tempat frasa ini bergantung, menurut al-Mujtaba …").
- **C. A word's meaning is the word's.** Al-Falaq 1:4's `why` gave rabbi the phrase's meaning, so the
  line said "kata ketiga, yaitu بِرَبِّ (birabbi), yang artinya “Tuhan yang menguasai subuh”": now
  "dari birabbi (“kepada Tuhan”)", the word's gloss (113:1:3). The same defect in Al-Falaq 5:3:
  ḥasada was glossed “yang dengki” (ḥāsid's meaning); now “dia dengki” (113:5:5's gloss, ayah 5's
  structure summary). The lesson glosses themselves are word glosses (none is a phrase's).

Its 26 lines (25 texts, 2,555 characters, USD 0.20) were rendered the same day. Then, prepared
and NOT rendered:

- **One Arabic unit per karaoke word** (found by the TS textUnits test once those lines had tokens):
  a caption-only word that followed a word already showing Arabic was glued to it, "isim (اِسْم),
  yaitu صِرَٰط (ṣirāṭ)," — one karaoke word with two Arabic units, where a line could break inside
  it (wording rule 15 of the memory: clean line breaks). `Lexicon.token_entries` makes such a piece a
  karaoke word of its own, cut at the piece's first space, with the SAME timing as the word it is
  shown with (no time made up); beside a plain word it still joins it ("pertama, yaitu صِرَٰطَ
  (ṣirāṭa),"). `build_narration.retext_tokens` re-derives a kept render's tokens either way, the
  timings byte-identical; `check_tokens` holds the tokens to `token_entries` one by one and gives a
  piece its word's timing (faults "a shown-only piece glued to a word that shows Arabic, as rendered
  2026-10-17", "… its own token with a time made up"). Tokens changed in 5 rendered lines
  (`6:w2:compose:1`, `6:w3:compose:1`, `7:w6:compose:1`, `7:w9:compose:1`, `7:w9:compose:4`); every
  audio file, its url and sha256 unchanged.
- **The Allah rule** (wording rule 13): `2:ex:word-kind:4:why` "… رَبِّ (rabbi), yang artinya “Tuhan”,
  adalah isim (اِسْم)." (was "…, karena ia nama benda.").
- **The learnt-so-far line removed** (wording rule 1, operator 2026-10-17: "better to remove this
  line in every ayat beginning"): the seven `map:learnt` lines are gone (their files simply no
  longer referenced) and the seven `map:again` lines open "Dari yang sudah kita pelajari, …".

**8 lines, 8 distinct texts, 1,208 characters, USD 0.10** in the dry run, all new texts:

```bash
args=(--surah al-fatihah
  --only al-fatihah:1:map:again --only al-fatihah:2:map:again --only al-fatihah:2:ex:word-kind:4:why
  --only al-fatihah:3:map:again --only al-fatihah:4:map:again --only al-fatihah:5:map:again
  --only al-fatihah:6:map:again --only al-fatihah:7:map:again)
# must say: 8 distinct texts, 1208 characters, no "refused by --render"
python3 render_narration.py "${args[@]}"
# the render (an array: a "$n:ex:" inside one string breaks the command):
#   python3 render_narration.py "${args[@]}" --render --i-approve-spend --voice-id aK834gEOxQEtviMPgurT \
#     --voice-name "Kang Nandar" --env-file … --out "$OUT"
# then build_narration.py --check, validate_narration.py, encode_narration.py --check --out "$OUT" --list …,
# listen, and the upload steps of "Rendering the lines" above.
```

### Continuations (2026-10-18): an ayah that continues an earlier one says so; prepared, NOT rendered

The operator, refining wording rule 8 (rule 29 of the session memory): "we need to remind some
ayat is continuing previous ayat. So when we explain for example ayat 3 Al-Fatihah, why it kasrah
because it's na't of Allah in previous ayat and mention which word. Apply this to similar cases."
**Note for whoever works on a lesson next** (it overturns part of the 2026-10-17 sweep, which also
took dependencies out): a COMPARISON with an earlier ayah stays out; a DEPENDENCY on one is said —
"Ayat ini melanjutkan ayat kedua." at the opening of the structure part, and in the affected word's
explanation the earlier word named and its ayah cited, "bagi ٱللَّهِ (Allāhi) di ayat kedua". Which
ayat continue which is DATA (`continues` in `authored/<slug>.structure.json`, from the kitab the
lesson cites), and the validator holds the lines to it both ways (wording rule 8 below).

- **The sweep**: every cross-ayah dependency in the four surahs, from the authored `why`s, roles,
  summaries, structure items and review notes (the pipeline reads no QAC syntax data; QAC 0.4 is
  morphology only): 15 ayat, 21 links — Al-Fatihah 3, 4 (na't of Allāhi, ayah 2) and 7 (badal of
  aṣ-ṣirāṭa, ayah 6); Al-Ikhlas 2, 3 (khabar of huwa, ayah 1, "menurut al-Mujtaba dan al-Jadwal",
  and Darwisy's link of lam yalid to aṣ-ṣamad, ayah 2) and 4 ('athaf on lam yalid, ayah 3); Al-Falaq
  2–5 (min syarri on a‘ūżu, ayah 1; 3 also 'athaf on min syarri, ayah 2; iżā on a‘ūżu per al-Mujtaba
  / as-Samin); An-Nas 2, 3 (badal of birabbi / maliki), 4 (min syarri on a‘ūżu), 5 (allażī na't of
  al-waswāsi, ayah 4), 6 (hal of the doer of yuwaswisu, ayah 5). Not data, on purpose: dependencies
  inside one ayah; Al-Fatihah 5 and 6 (new sentences); the 'athaf target of Al-Falaq 4 and 5 (the
  authored text never said which earlier min syarri, so none is named; their ta'alluq on a‘ūżu is).
- **The text**: Al-Fatihah's lines are authored — structure items 3:1, 4:1, 7:1 open with the
  sentence and cite the word; the compositions' reason lines 1:3:1 and 1:3:2 (frame `change`, line
  4), 1:4:1 (line 2), 1:7:1 (line 3) cite it ("Sebabnya, kata ini na’t (نَعْت), yaitu sifat, bagi
  ٱللَّهِ (Allāhi) di ayat kedua." — the operator's one-sentence example would be 182 characters,
  over the 170 a caption beside the animation may have, so the base-form sentence before it stays
  its own line, with its recording); new `why_basic` for 1:3:1, 1:3:2, 1:4:1 and "di ayat keenam"
  in 1:7:1's (the quiz explanations, shown and said: "Akhirnya kasrah karena menjadi na't, yaitu
  sifat, bagi {{1:2:2/allahi}} di ayat kedua, yang majrur."). The Mu'awwidzat are told from their summaries: each opens with
  "Ayat ini melanjutkan ayat N." (Al-Ikhlas 2 and 3 hedged "Menurut al-Mujtaba dan al-Jadwal, …",
  their sentences reordered so the continuation comes first), and the sanitiser cites each earlier
  word and names an earlier phrase by its words. On-screen reference texts (summaries, why cards)
  that already cited the ayah are unchanged; the `type`s too.
- **The audio**: 11 Al-Fatihah lines change their spoken text and lose their audio:
  `3:w1:compose:4`, `3:w2:compose:4`, `3:structure:1`, `3:ex:why-harakat:1:why`,
  `3:ex:why-harakat:2:why`, `4:w1:compose:2`, `4:structure:1`, `4:ex:why-harakat:1:why`,
  `7:w1:compose:3`, `7:structure:1`, `7:ex:sort-case:1:why`. Dry run: **11 distinct texts, 1,350
  characters, USD 0.11**; two of them (`7:w1:compose:3`, `7:ex:sort-case:1:why`, the texts of before
  2026-10-17) have their masters on disk and are reused, so 9 texts, 1,058 characters, about USD 0.08
  are new. No shared line changed; the other surahs have no audio. No line id changed or was added
  in Al-Fatihah (the Mu'awwidzat's summary lines split anew, :a … :c, caption-only).

```bash
OUT=/path/to/the/checkout/with/the/masters/belajar/pipeline/out
args=(--surah al-fatihah)
# must say: 11 distinct texts, 1350 characters, no "refused by --render"
python3 render_narration.py "${args[@]}"
# the render:
#   python3 render_narration.py "${args[@]}" --render --i-approve-spend --voice-id aK834gEOxQEtviMPgurT \
#     --voice-name "Kang Nandar" --env-file /path/to/dakwah-lens/.env --out "$OUT"
# then build_narration.py --check, validate_narration.py, encode_narration.py --check --out "$OUT" --list …,
# listen (Allohi in the cited lines; manshub, pending its ear check, in 7:ex:sort-case:1:why), and the
# upload steps of "Rendering the lines" above.
```

### Clarity (2026-10-18): the dropped ya' of ihdi, a reminder of the earlier ayah, the kinds of word met here; prepared, NOT rendered

The operator's three findings of 2026-10-18 (wording rules 14–16 below):

- **The dropped letter shown** ("in ayat-6, it says something like ihdina, lose 'ya' but not
  explained about the original word of ihdi … Check any similar cases"): Komposisi kata, "A letter
  said to be dropped is SEEN dropped" — ihdinā, lillāhi, aḍ-ḍāllīna; the quiz explanation of 1:6:1
  names يَهْدِي (yahdī) and ٱهْدِ (ihdi) too. Not changed: Al-Falaq 2's dropped returning pronoun
  (khalaqahū, a word outside the lesson surahs: no composition there to show it) — for the operator.
- **The reminder card** ("it becomes na'at from lafaz Allah in ayat-2, better to remind user what
  that previous ayat looks like and give more clear explanation"): while a line says the
  continuation ("Ayat ini melanjutkan ayat kedua.") or cites a word of an earlier ayah (a word's
  line, one of its composition lines, a structure line — never an exercise's), the stage shows that
  ayah in the word card's slot: "Ayat 2", its words in the content's bytes and order with the cited
  word(s) highlighted (a border, a tint and a ring), its marker, and its translation (the content's,
  verbatim). DATA: the manifest line's `reminder`, `[{ayah, words}]`, derived by
  `validate_narration.reminder_of` from the line's citations and, for the opening sentence, from the
  `continues` links on the ayah it continues; the page hands the stage the bytes and translations of
  just those ayat (`src/lib/autoplay/reminder.ts reminderTexts`), the stage draws
  `src/components/lesson/ReminderCard.tsx` (a composition or a structure item gives it the slot for
  that line; a word line keeps its word card above it). 35 lines carry one: Al-Fatihah 10, Al-Ikhlas
  5, Al-Falaq 10, An-Nas 10; two lines show two ayat (Al-Falaq 3: min syarri of ayah 2, a‘ūżu of ayah
  1; An-Nas 3's structure). Held by `continuation_problems` (a line that says or cites without its
  card, a card on a line that cites nothing or on an exercise, a card of a later ayah or of a word the
  ayah does not have, a highlighted word the line does not cite, a continuing ayah with no card at
  all — each a planted fault), by `parseNarrationManifest` and `reminder.ts reminderProblems` in TS,
  `src/components/autoplay/reminder.test.ts`, and `scripts/ci/screenshots.mjs reminderChecks` (Al-Fatihah
  3's opening: the card, its words, its highlight, its translation, nothing sideways; whether it is
  wholly above the panel is reported, not failed — NOT measured yet).
- **The clearer reason** (the same message): the line that says the dependency now says why the
  earlier word ends as it does, with the words shown — only what the authored data gives:
  Al-Fatihah 3 and 4: "ٱللَّهِ (Allāhi) di ayat kedua, yang disifati kata ini, berakhir kasrah karena
  didahului huruf jar, yaitu لِ (li)." + "Sifat selalu mengikuti akhiran kata yang disifatinya, jadi
  kata ini juga berakhir kasrah." (compositions 1:3:1 and 1:4:1; structure items 3:1 and 4:1 with
  لِلَّهِ and the dependents named); Al-Fatihah 7: aṣ-ṣirāṭa of ayah 6 "berakhir fathah, karena menjadi
  maf'ul bih kedua bagi ٱهْدِنَا (ihdinā)" (1:7:1, item 7:1); the Mu'awwidzat from their summaries and
  whys: huwa is the mubtada' that the khabar describes (Al-Ikhlas 2, 3), the meaning the ta'alluq
  gives (Al-Falaq 2, An-Nas 4), birabbi majrur after its huruf jar (An-Nas 2), al-waswāsi majrur as
  mudhaf ilaih and the na't following it (An-Nas 5), the doer of yuwaswisu that the hal describes
  (An-Nas 6). A word of the cited ayah may be named beside the citation to give the reason (the
  validator allows a named word, or a further citation, of an ayah the line cites as a dependency;
  `DEPENDENCY` also reads "disifati", "digantikan", "maf'ul bih"). Judged sufficient as they are:
  Al-Ikhlas 4, Al-Falaq 3–5 ("disambungkan …, sehingga/jadi bergantung pada a‘ūżu"), An-Nas 3 (its
  maliki's case is explained in ayah 2's lesson).
- **The kinds of word met here** ("we always say in this ayat we find 3 jenis kata … in that ayat
  (example ayat-3) we only have isim"): "Peta pelajaran", "The kinds of word met HERE".

**The audio**: 20 Al-Fatihah lines change their spoken text or are new and have no recording (5
`map:again` lines of ayat 1, 2, 3, 4, 6; the compositions 2:w2 (3), 3:w1 (2 new), 4:w1 (2), 6:w1 (2 new),
7:w1 (1 new), 7:w9 (1); structure items 3:1, 4:1, 7:1; `6:ex:sort-case:1:why`). Every other line kept
its recording, under its new id where a composition's lines were renumbered. Dry run: **18 distinct
texts, 2,940 characters, USD 0.24** (3:w1:compose:5/6 and 4:w1:compose:3/4 say the same two texts);
nothing refused. No shared line changed; the other surahs have no audio.

```bash
OUT=/path/to/the/checkout/with/the/masters/belajar/pipeline/out
args=(--surah al-fatihah
  --only al-fatihah:1:map:again --only al-fatihah:2:map:again --only al-fatihah:2:w2:compose:4
  --only al-fatihah:2:w2:compose:5 --only al-fatihah:2:w2:compose:6 --only al-fatihah:3:map:again
  --only al-fatihah:3:w1:compose:5 --only al-fatihah:3:w1:compose:6 --only al-fatihah:3:structure:1
  --only al-fatihah:4:map:again --only al-fatihah:4:w1:compose:3 --only al-fatihah:4:w1:compose:4
  --only al-fatihah:4:structure:1 --only al-fatihah:6:map:again --only al-fatihah:6:w1:compose:3
  --only al-fatihah:6:w1:compose:4 --only al-fatihah:6:ex:sort-case:1:why --only al-fatihah:7:w1:compose:4
  --only al-fatihah:7:w9:compose:3 --only al-fatihah:7:structure:1)
# must say: 18 distinct texts, 2940 characters, no "refused by --render"
python3 render_narration.py "${args[@]}"
# the render:
#   python3 render_narration.py "${args[@]}" --render --i-approve-spend --voice-id aK834gEOxQEtviMPgurT \
#     --voice-name "Kang Nandar" --env-file /path/to/dakwah-lens/.env --out "$OUT"
# then build_narration.py --check, validate_narration.py, encode_narration.py --check --out "$OUT" --list …,
# listen (yahdi, ihdi, Allohi, the Arabic terms of the kinds sentence), and the upload steps of
# "Rendering the lines" above.
```

**Two word voices** too: the new tiles ٱهْدِي (ihdī, the drop frame's form before) and لِٱللَّهِ (the join
of lillāhi) are teaching forms no reciter says, so content/wordvoice.json (`build_wordvoice.py
--write`, done) lists them as the narrator's, without a recording yet: 2 texts, 15 characters.
`build_wordvoice.py --check --require-audio` (CI) fails until they are recorded —
`python3 build_wordvoice.py --render --i-approve-spend --env-file /path/to/dakwah-lens/.env --out "$OUT/words"`,
then the delivery steps in its docstring.

## Operator's lesson-wording rules (2026-10)

The rules the operator gave while reviewing the lessons, kept here so that work on any lesson
follows them (until now they lived only in the session's memory). One rule each; where a check
enforces it, its name; otherwise "not enforced: review by reading".

1. **A count is always followed by its names** (2026-10-15: "Dengan itu, sudah empat hal yang kita
   pelajari, yaitu A, B, C, D … always re-mention what they are"): every map line that counts steps
   names each, in teaching order; never "di antaranya", never "ada satu: X". **The count of what was
   learnt so far is said only in the closing recap, `map:total`** (operator 2026-10-17: "better to
   remove this line in every ayat beginning: 'Sebelum ayat ini, kita sudah mempelajari XX hal, yaitu
   …'"): the opening's `map:learnt` line is gone; its STEP `map:learnt` stays (the card "Sudah kita
   pelajari" and the CI walks by that step id) and says one line, `map:again`, worded to stand on
   its own: "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah …". Enforced:
   `validate_narration.map_problems` (a "Sebelum ayat ini, kita sudah mempelajari …" line anywhere
   fails; `map:again` in the old wording fails; faults "the learnt-so-far line back at an ayah's
   opening, as until 2026-10-17" and its kin) and `lessonMap.ts` `MAP_LINES` (and the caption-only
   fallback, `texts.ts`). See "Peta pelajaran".
2. **Reassure after postponing** (2026-10-15: "Sekarang Anda tidak perlu menghafal ketiganya, mari
   kita fokus pada pelajaran XXX dan YYY terlebih dahulu"): `map:focus` after `map:later`, its pronoun
   by the count. Enforced: `map_problems` (`_map_focus`).
3. **Plain words for a grammatical estimate** (2026-10-15: "memperkirakan … your sentence is
   confusing"): "para ulama memahaminya (antara lain) sebagai …", never "memperkirakannya", never
   "menafsirkan" (tafsir is not taqdir). Enforced: `check_display` `ESTIMATE_WORDING` (fault "a
   grammatical estimate in jargon"); the rest of the phrasing: review by reading.
4. **Letters: the Arabic only on screen, the sound for a letter with its harakat, a short "sin"**
   (2026-10-17: "we dont need to write “ba’” here, only the arabic one is enough"; "better to say bi
   instead of ba"; "you read it siiiin, i think sin is enough"): a single letter is shown alone
   ("huruf ب ini", the article keeps "alif lam (ال)"); a letter with its harakat that is a part of a
   word (the bi- of بِسْمِ, li-, wa) is a named word, "بِ (bi)", said "bi"; sin is said "sin"
   (`pronunciation.json`). Enforced: `check_display` (a single letter with its Latin name beside it,
   faults "a lesson-zero caption with the letter's Latin name beside it" and its kin) and the
   dictionary (fault "sin spoken from Arabic script again"); which letters are parts and which carry
   a mark ("tanda bunyi u di atas huruf مُ", kept as a name): review by reading. See "Narasi".
5. **Name the example word, not only its meaning** (2026-10-17: "Kata pertama diawali huruf jar yaitu
   XXX yang artinya …, sehingga isim sesudahnya, YYY, yang artinya …"; "should also mention the
   arabic word not only artinya. apply this in similar sentences"): the Arabic from the content in
   the caption, the transliteration said. **Every one, by place too** (operator's ruling of
   2026-10-17: "'Kata ketiga, yaitu رَبِّ (rabbi), yang artinya “Tuhan”' … even when the stage
   highlights that word"): a word named by its place and its meaning — the word's own line ("Kata
   pertama, yaitu بِسْمِ (bismi), artinya: …"), the quiz's "Itu kata pertama, yaitu …", a structure
   item, a composition, a Konsep example ("Kata ini, yaitu …") — shows and says the word between the
   two. `Sanitiser.name_places` adds it wherever it can resolve the place (a run of words names each
   word; "kata ini" is the line's own word); what it cannot, the author marks ({{s:a:w}}). **Heavy-letter
   words are shown and explained but never said by the narrator** (operator 2026-10-17: "we just
   explain but not read them"): a word with ص ض ط ظ ق خ غ is named in the caption only ({{!s:a:w}};
   "Kata pertama, yaitu صِرَٰطَ (ṣirāṭa), artinya: “jalan”" is said "Kata pertama artinya: jalan"),
   a simple word is shown and said; `PLACE_MEANING` reads the caption, so a caption-only name
   satisfies it. Enforced:
   `check_display` `MEANING_ONLY` ("kata / huruf yang artinya …" fails), `PLACE_MEANING` ("kata
   ketiga, yang artinya …", "Kata pertama artinya: …", "kata ketiga dan keempat, yang artinya …",
   "Kata ini, yang artinya …", "yang pertama artinya …" fail; faults "a word line by its place and
   meaning only, as until 2026-10-17" and its six kin) and the named-word checks (`Named`,
   `named_said`). See "Narasi", the named word. **A part is named too, and a word only once**
   (operator 2026-10-17, "Sibling lines"): a composition line that names a part (a tile) by its kind
   and its meaning — "Bagian kedua adalah isim yang artinya “Maha Pengasih”", "Alif lam bersambung
   dengan isim yang artinya …", "dhamir yang artinya “kami”" — names the part itself between the two,
   by the composition form the frame shows ("Bagian kedua adalah isim, yaitu رَحْمَٰن (raḥmān), yang
   artinya …"; a heavy-letter part caption-only, {{!1:6:2/sirat}}); and a line names a word once: the
   word line that has just said "Kata pertama, yaitu مِن (min), artinya: “dari”." goes on "Kata ini
   adalah huruf jar …", not "Kata ini, yaitu مِن (min), yang artinya “dari”, adalah …"
   (`build_narration.named_once`; the quiz explanation, which says the why alone, keeps the name),
   and a word named in one part of a line split into :a/:b is not named again in the other. A word
   named in two consecutive lines of one step (structure item 2 of 1:1 after item 1) is reworded
   in its source. Enforced: `check_display` `part_meaning_only` (`:compose:` lines: a kind word —
   isim, fi'il, dhamir, huruf (jar), akhiran, kata benda/kerja/ganti — before "(yang) artinya" with
   no named word since the clause or the meaning before it; "Kata ini adalah kata penghubung yang
   artinya …" and "ungkapan yang artinya …" hold no kind word) and `named_twice` (one line, and the
   parts of a split line; faults "a composition part by its kind and meaning only, as until
   2026-10-17", its three kin, "a word named twice in its own line, as until 2026-10-17 (An-Nas 4)",
   "a word named in two parts of one split line …"); outside the compositions (a `why_basic`, a
   Konsep text): review by reading. And a named word's meaning is the WORD's: a gloss in prose
   after a word ("rabbi (“…”)") is that word's own meaning, never the phrase's (Al-Falaq 1:4 said
   "kata ketiga, yaitu بِرَبِّ (birabbi), yang artinya “Tuhan yang menguasai subuh”"): review by
   reading (see "Sibling lines" above).
6. **Name the members of a group step** (2026-10-17: "add in parenthesis what are tiga jenis kata"):
   "Tiga jenis kata (isim, fi'il, dan huruf)". Enforced for this step by its test
   (`test_validate_curriculum` test_names); other group names: review by reading.
7. **What a later ayah teaches: "baru akan diajarkan lebih lengkap di ayat ke-N"** (2026-10-17:
   "better to say konsep ini baru akan diajari lebih lengkap di ayat keXX"). Enforced:
   `check_display` `LATER_WORDING` (faults "what a later ayah teaches said the old way", "… baru kita
   bahas nanti") and the `map:later` template in `map_problems`.
8. **No comparisons with earlier ayat; dependencies on them are said** (2026-10-17, on ayah 2:
   "better to remove this lines to make it less complicated"; the ruling on the rest, the same
   day: "YES — remove them all … remove the comparison, keep the sentence complete"; REFINED
   2026-10-18: "we need to remind some ayat is continuing previous ayat. So when we explain for
   example ayat 3 Al-Fatihah, why it kasrah because it's na't of Allah in previous ayat and mention
   which word. Apply this to similar cases."). Two kinds of pointer at an earlier ayah, told apart:
   - (a) a **comparison** goes, removed, not rephrased: "seperti di ayat pertama", "sekali lagi",
     "Polanya sama dengan ayat tiga", "berbeda dengan … di ayat …", "Kata yang sama sudah kita
     pelajari di ayat pertama", "juga terdiri dari dua bagian" where no earlier word of the same ayah
     has two; and "ayat sebelumnya" (say which ayah, and only for a dependency);
   - (b) a **dependency** is said, required: where an ayah continues an earlier one — a word's
     ending, case or role CAUSED by a word of an earlier ayah (na't of …, badal of …, 'athaf on …,
     khabar / mudhaf ilaih relations across ayat, a phrase hanging on an earlier verb) — (1) the
     ayah's structure part opens with "Ayat ini melanjutkan ayat kedua." (the ordinal of the ayah
     the data says; hedged where the kitab differ, "Menurut al-Mujtaba dan al-Jadwal, ayat ini
     melanjutkan ayat pertama: …"), and (2) the explanation of the affected word gives the reason
     with the earlier word NAMED and its ayah cited after it: "Sebabnya, kata ini na’t (نَعْت),
     yaitu sifat, bagi ٱللَّهِ (Allāhi) di ayat kedua." (a citation beside a SHOWN word, which rule
     12 allows; a heavy-letter word is caption-only, rule 5: "pengganti bagi kata ٱلصِّرَٰطَ
     (aṣ-ṣirāṭa) yang artinya “jalan” di ayat keenam" is said "… bagi kata yang artinya jalan di ayat
     keenam"); the structure item that says the dependency names the word and the ayah the same way.
     The word described is the SOURCE's (Darwisy, al-Jadwal, al-Mujtaba …): where the kitab differ the
     lesson says what the main source says and keeps the hedge the authored text has ("menurut …",
     "sebagian ulama …"); a dependency the authored data and its kitab do not state is never said.
   **The data**: `continues` beside an ayah's `structure` in `authored/<slug>.structure.json`
   (reviewer-only: `build_surah.py` reads only `structure`) — the ayah it continues, the hedge
   (`per`), and each link: the word(s) of this ayah, the kind, the earlier word(s) by named-word ref
   (`on`, one earlier ayah; a run for a phrase: lam yalid, min syarri), the kitab (`src`, the surah's
   abbreviations) and where it is said (`said_in`: `word` — the word's own line or one of its
   composition lines —, `structure`). Every continuation of the four surahs: "Continuations
   (2026-10-18)" above (15 ayat, 21 links).
   **The build**: an authored line (a composition's `say`, a structure item, a `why_basic`) writes
   the citation itself ("bagi {{1:2:2/allahi}} di ayat kedua"); in a `why` or a summary the
   sanitiser cites a word of an earlier ayah by its ordinal (`Sanitiser._where`; a comma closes the
   citation before "yang …" goes on) and names a phrase of an earlier ayah by its words; "Ayat ini
   melanjutkan ayat 1" in a summary is said with the ordinal (PRE_REWRITES).
   Enforced: `check_display` `back_references` — a line of a later ayah may say "ayat <earlier>"
   only as "Ayat ini melanjutkan ayat <N>" (CONTINUES) or as a CITATION, a named word (or a run of
   them, with its gloss) right before "di ayat <N>", in a line that says a dependency (DEPENDENCY:
   na’t / sifat bagi, badal / pengganti bagi, ‘athaf / disambungkan pada, bergantung pada,
   disandarkan kepada, khabar bagi, dikaitkan dengan, menguatkan …); a comparison form (COMPARISON:
   "seperti / sama dengan / berbeda dengan / sekali lagi / sudah kita pelajari … ayat") in the line
   fails it all, and "ayat sebelumnya" always fails; and `continuation_problems`, on the data and the
   lines: the data's shape (an earlier ayah, refs that resolve, one earlier ayah per link, kitab of
   the surah's table); an ayah whose structure type says "lanjutan" has data, and "lanjutan jumlah
   ayat N" agrees with it (so a new surah cannot forget it); the structure part of an ayah with data
   opens with the sentence (hedged by `per`), said once, and no other ayah says it ("melanjutkan
   ayat N" where the data has no continuation of ayah N fails); every citation is of a word of
   that ayah and is a link of the data; every named word that stands only in an earlier ayah of
   the surah is cited (a word's own lines cite only that word's links); every link is said where
   `said_in` says. Faults: "a comparison with an earlier ayah", "“ayat sebelumnya”", "… in a
   composition", "a dependency's citation taken out, as 2026-10-17 to 2026-10-18", "… in a quiz
   explanation (An-Nas 2)", "… in a structure line (An-Nas 6, a phrase's hal)", "the continuation
   sentence taken out", "… said of an ayah the data does not continue", "… the wrong ayah", "a hedged
   continuation said without its hedge", "a continuation in a later structure line", "a citation of
   a word that is not in that ayah", "a citation the data does not have (its link taken out)", "a
   citation inside a comparison", "a lanjutan ayah without data", "data that continues the ayah
   itself", "data that disagrees with the ayah's structure type", "data with a ref that does not
   resolve", "data with a kitab the surah does not cite"; unit tests `test_back_references` and
   `test_continuations` (the operator's example line, the counts per surah).
   Comparisons worded without an ayah ("sekali lagi", "juga"): review by reading.
9. **Foundation steps count as met again in every ayah** (2026-10-17: "in alfatihah ayat-1 it says
   no harakat?"): the harakat, like the three kinds of word, occur on every word. Enforced:
   `curriculum.occurs` / `stepOccurs`, held by `validate_curriculum.py` and `validate_map.py`
   (faults "the harakat said not to occur in an ayah"). See "Kurikulum".
10. **An audio take must not end before its last word** (2026-10-17: "the voice is cut slightly
    before the sentence finished"): `validate_narration.CUT_TOLERANCE_MS` (20 ms). Enforced:
    `check_tokens`, `build_narration.manifest` (a cut take is not carried over),
    `render_narration.py` (a fresh cut take is refused and kept aside) and
    `encode_narration.deliver`. See "Narasi", "A take cut short".
11. **Each narration line ≤ 400 characters; a long list is its own line, never :a/:b** (2026-10-15).
    Enforced: `MAX_LINE` (`check_spoken`), and a map / learned / structure-item line is never split
    (build and `check_manifest`).
12. **Never point at something that is not on screen** (rule 21, 2026-10-14: "it's mention 'surah
    itu', 'ayat 3' etc, but no ayat shown actually"): a line refers to what the frame or card shows;
    a place may be CITED on a card ("QS 41:9" in a frame note), not used as a pointer in speech.
    Enforced in part: `_places` (no "kata kedua di ayat …", no "di kartu ini"), `MEANING_ONLY`
    (a word of another ayah is shown, not only meant); the rest: review by reading.
13. **Say WHICH one, not the category's definition** (2026-10-17, on the warm-up's ٱلرَّحِيمِ: "you
    should say this word is isim karena kata sifat, yang artinya Maha Penyayang. no need to say
    'yaitu nama benda, orang, atau sifat', directly show which one. Fix this in similar cases"): an
    explanation of an answer says the concrete class or reason of THIS word, and the word itself
    with its meaning — never the general definition of the category it belongs to. The warm-up:
    "Kata keempat, yaitu ٱلرَّحِيمِ (ar-raḥīmi), yang artinya “Maha Penyayang”, adalah isim (اِسْم),
    karena ia nama sifat." The class is the one the Kalimah record teaches for the part's QAC tag,
    in the lessons' own words ("nama sifat", what lesson zero teaches, not the operator's "kata
    sifat"); a tag it teaches no class for says the kind alone, and so does a word whose tag the
    class does not fit: the Name of Allah, a participle noun, and gair (غَيْرِ, “bukan”, 1:7:5; operator
    2026-10-17 on the coordinator's recommendation) — a plain QAC N, but a word meaning “bukan” /
    “selain” is an isim by its place (always annexed: al-Jadwal, Darwisy, as-Samin; ar-Raghib: for
    negation or exception, Kosakata `ghayr`), not a nama benda; it is listed by its QAC lemma in
    `quiz.CLASS_WITHHELD` with that reason, the one list of its kind. A category's definition stays where
    the category is TAUGHT (the Kalimah record's "isim (nama benda, orang, atau sifat)", lesson
    zero's examples). Enforced: `quiz.warmup_problems` (faults "the general definition again, the
    shape of until 2026-10-17", a wrong class for a tag, a class said of the Name / a participle /
    a relative / gair) and `quiz.class_problems` (a class not taught before the warm-up asks it). The other
    exercises' explanations are a word's `why_basic` / `why`, the reason of THIS word, with at most
    a term's gloss after the term ("mubtada', yaitu pokok kalimat"): review by reading. See
    "Pemanasan". **An isim that names, titles or describes Allah says the kind ONLY** (operator
    2026-10-17: "when ism is related to Allah, dont say it's nama benda"; "just say, it's ism."):
    "Kata ketiga, yaitu رَبِّ (rabbi), yang artinya “Tuhan”, adalah isim (اِسْم)." — no "nama benda"
    (a thing), and no other class in its place. Listed by PLACE in `quiz.ALLAH_KIND_ONLY`, each with
    its QAC lemma and a one-line reason, because the context decides (aḥad at 112:1:4 "Yang Maha Esa"
    is listed, 112:4:5 "sesuatu" is not): rabbi 1:2:3, māliki 1:4:1, aḥadun 112:1:4, aṣ-ṣamadu
    112:2:2, the rabbi of birabbi 113:1:3 and 114:1:3, maliki 114:2:1, ilāhi 114:3:1; the Name Allāh
    already said the kind alone. The distinction kept on purpose: ar-raḥmāni and ar-raḥīmi keep "nama
    sifat" (the operator's own example, "isim karena kata sifat, yang artinya Maha Penyayang"; an
    attribute of Allah is accurately a sifat, QAC ADJ). `quiz.part_class` is the one rule;
    `quiz.allah_kind_only_problems` holds each entry to its lesson word (it exists, and has an isim
    part with that lemma), run by `validate_quiz.py`; faults "the warm-up: “nama benda” said of rabbi
    …, as until 2026-10-17", "… its sentence as it was", and three on the list (a lemma typo, a place
    with no word, a fi'il). Left as it is, for the operator: the fact card "Rabb: kata benda tersering
    setelah lafaz Allah" (`facts.py`, a frequency among QAC noun lemmas, N + PN; "isim" there would
    count pronouns and relatives too and the statement would no longer hold). The part is named by
    the composition's form of its bytes (`quiz.part_named`):
    since 2026-10-17 the back هِمْ of ‘alaihim (1:7:4) is the form `him`, as at 1:7:7, so "Bagian
    kedua kata keempat, yaitu هِمْ (him), yang artinya “mereka”, adalah isim …"; the front عَلَيْ
    of both has no form of its own (the composition shows عَلَى) and says its kind and class only.

14. **A letter said to be dropped is shown dropped** (2026-10-18: "it says something like ihdina,
    lose 'ya' but not explained about the original word of ihdi … Check any similar cases"): the form
    WITH the letter and the form without it are on screen (a `drop` frame, its chip naming the
    letter) or named in the line ("berasal dari يَهْدِي (yahdī) … sehingga tertulis ٱهْدِ (ihdi)").
    Enforced: `compose.say_problems` `_DROPPED` (compositions); outside them (a `why`, a summary):
    review by reading. See "Komposisi kata".
15. **An ayah that continues an earlier one shows it, and says why** (2026-10-18: "better to remind
    user what that previous ayat looks like and give more clear explanation"): the reminder card of
    the earlier ayah on every line that says the continuation or cites its word, and the reason the
    earlier word ends as it does with the words shown, from the authored data only. Enforced:
    `continuation_problems` (the card both ways); the reason itself: review by reading. See
    "Clarity (2026-10-18)".
16. **"Met here" names what is here** (2026-10-18: "we always say in this ayat we find 3 jenis kata …
    actually in that ayat (example ayat-3) we only have isim"): a line or card that says a step is
    met in this ayah names the kinds of word the ayah has; a definition (what was learnt, what a
    lesson teaches, the warm-up's choices) keeps the three. Enforced: `map_kinds_here`,
    `lessonmap.problems`. See "Peta pelajaran".

## Narasi (guided-lesson narration)

The autoplay lesson ("Mulai" once, then no clicks except exercise answers) speaks an Indonesian
narration line for every step. `build_narration.py` writes the scripts; `render_narration.py` turns
them into audio, with word timings for the karaoke caption, once the operator has approved the
spend. The voice is Kang Nandar (ElevenLabs `aK834gEOxQEtviMPgurT`, `eleven_v3`, mode A). A line
without `audio` plays caption-only: the runner shows `display` at reading pace.

**Manifest** (`belajar/content/narration/<slug>.json` per lesson surah, `shared.json` for generic
lines; `version` is the format version, 2):

```json
{ "version": 2,
  "voice": { "id": "aK834gEOxQEtviMPgurT", "name": "Kang Nandar", "model": "eleven_v3" },
  "lines": { "al-fatihah:1:w3": {
      "text": "Kata ketiga artinya: Yang Maha Pengasih. Akhirnya dibaca كَسْرَة, karena menjadi sifat, atau نَعْت, bagi kata kedua, …",
      "display": "Kata ketiga artinya: “Yang Maha Pengasih”. Akhirnya dibaca kasrah (كَسْرَة), karena menjadi sifat, atau na’t (نَعْت), bagi kata kedua, …",
      "highlight": [3], "focus": "1:1:3",
      "audio": { "url": "/belajar/media/narration/kang-nandar/al-fatihah/<16 hex: delivery_name>.mp3", "ms": 9120, "sha256": "…" },
      "tokens": [ { "t": "Kata", "s": 0.0, "e": 0.24 }, …, { "t": "kasrah (كَسْرَة),", "s": 4.44, "e": 5.12 }, … ] } } }
```

| field | what it is |
|---|---|
| `text` | the SPOKEN text, exactly what is sent to the voice (dictionary applied, normalised for speech) |
| `display` | the caption: the same sentence with dictionary terms in their display form ("na’t (نَعْت)", "idhafah (إِضَافَة)", "Allah"), a letter as in the ayah and alone (بِ, لِ; the focus word's own first letter, لَّ of lahu; never "ba’ (بِ)" since 2026-10-17), quotes kept; the fallback when there are no `tokens` |
| `highlight` | word numbers of this ayah the stage highlights while the line plays; `[0]` the whole ayah, `[]` none |
| `focus` | the word (`"1:1:3"`) of the large word card (its Arabic from the content bytes, transliteration, "yang artinya “gloss”"), or `null` |
| `frame` | primer and compose lines only: the 1-based frame of the animation shown in the word card's slot while the line plays (`content/compose/<slug>.json` `lines[k].frame`) |
| `audio` | after a render: `{url, ms, sha256}` of the DELIVERED file (64 kbps mono, see "Delivery" below), never of the master; `voice` is then `{id, name, model: "eleven_v3"}` |
| `tokens` | after a render: the karaoke caption, `[{t, s, e}]`, one per spoken word (a multi-word term such as حَرْف جَرّ is one word), `t` its display text, `s`/`e` seconds from the start of that file |

**Ids** (the step-id contract shared with the runner and the exercises): `${slug}:${ayah}:${part}`,
in lesson order — `ayah` an ayah's number, or `0` for the lines of lesson zero in the surah that
hosts it (intro, primer:k, concept:<id>, next; see "Pelajaran nol"):

| part | when | says | highlight / focus |
|---|---|---|---|
| `intro` | every ayah | which ayah, its translation (QuranEnc, in quotes on the caption), how many words | `[0]` |
| `recite` | every ayah | one line before the imam recites the ayah | `[0]` |
| `map:new`, `map:again`, `map:later`, `map:focus` | every ayah of a surah with a lesson map (`content/map/<slug>.json`; "Peta pelajaran"), one step per group, ONE SENTENCE PER LINE (2026-10-15); `map:again` (the step `map:learnt`; its learnt-so-far line `map:learnt` was removed 2026-10-17) once anything was learnt, `map:later` + `map:focus` when the ayah has a postponed or a next-level topic | what is new in the ayah; how many steps were learnt before it, then which come up again here; what a later lesson teaches (with the ayah) and how many next-level topics there are (counted, never named); the reassurance: that need not be learnt now, focus on the new steps — every counted step named, in teaching order | `[]`, focus `null` (its card is on the stage) |
| `primer:${k}` | the lesson the harakat primer plays in: lesson zero ("ayah 0" of Al-Fatihah) since 2026-10-13, where its lines light nothing | the k-th sentence of the primer's frames | `[]` in lesson zero (no ayah on the stage); in an ayah's lesson the words whose letters its frame shows as they are (بِ: `[1]`); focus `null` |
| `w${n}` | every word | "Kata ke-n artinya: “gloss”." + the word's `why`, sanitised (its `why_basic` when it has one: see "why_basic") — or, when the word has a composition, + its `lead` ("Kata ini terdiri dari dua bagian."), since the frames say the why part by part | `[n]`, focus = that word |
| `w${n}:compose:${k}` | a word with a composition | the k-th sentence of its frames (strict: no Qur'anic word, spoken as authored) | `[n]`, focus = that word (the animation takes the card's place) |
| `concept:${id}` | each step the ayah's lesson teaches that has a text, in the curriculum's order (`content/curriculum.json` `lessons[].lines`; "Kurikulum"): `id` the Konsep record's for a record taught whole, the step's for a step with a text of its own (`teach`) | "Konsep baru: title. summary" (a term spoken from Arabic script right after "Konsep baru:" is shown capitalised, as the caption shows it) | the words the step occurs on in this ayah (the curriculum's `words`: every majrur word for the step majrur; for a record, the words whose `concepts` list it and the words of the ayah's `structure.groups` of that concept — idhafah of 1:4: [1, 2, 3]) |
| `structure` | every ayah with `structure` and no `structure.items` | the structure summary, sanitised | `[0]` |
| `structure:${k}` | each item of an ayah whose `structure` has `items` (see "Susunan kalimat per butir") | the item's `say`, spoken as authored (strict), the first after "Sekarang susunan kalimatnya." | the item's `words`, focus `null` |
| `ex:${key}:intro` | each exercise of the ayah's quiz (`content/quiz/<slug>.json`): the warm-up `word-kind` BEFORE the first word's lines (after `map:*` and the primer), every other one after the structure | what the exercise is, how many questions, the case groups of a sort (the form names of a wazan quiz: no basic lesson has one since 2026-10-13) | `[0]` for `tap-word` and `word-kind`, else `[]` |
| `ex:${key}:${n}:why` | each question n of those exercises | the ONE short explanation of the correct answer, said after "Benar." and after "Ini jawabannya." (operator 2026-10-10): warm-up — its one sentence, built from data in `quiz.py` (the part's place, its kind, the kind's plain meaning, a sign an earlier lesson taught); tap — the word's place and gloss; why / sort — the word's `why_basic` when it has one, else its `why` (+ "Jadi, kata ini <state>." when it does not name the state); role — "Perannya: <role head>." + the `why`; wazan — "Itu bentuk <label>" + its Konsep card's title. Only sourced fields, sanitised like every line | `[]` |
| `learned`, `map:total` | every ayah of a surah with a lesson map | what the ayah taught: its new steps, as the `map:new` line named them; then the running total with every step learnt by then ("Dengan itu, sudah empat hal yang kita pelajari, yaitu harakat, tiga jenis kata, majrur, dan huruf jar.") | `[]`, focus `null` |
| `recap` | every ayah | before the imam recites the ayah again | `[0]` |
| `next` / `done` | `next` on every ayah but the last, `done` on the last | | `[]` |

Exercise keys: `tap-word`, `why-harakat`, `sort-case`, `label-role` — and `wazn-factory`, which no
basic lesson's plan has any more (curriculum decision 6; `quiz.BASIC_EXERCISES`).
`shared.json` holds `shared:start`, `resume`, `correct` ("Benar."), `revealed` ("Ini
jawabannya.", after "Tunjukkan jawaban"; a wrong pick is not voiced since 2026-10-11, so there is no
`try_again`), `reminder`, `skip_offer`, `surah_done` (true however the learner
got there: no claim that every ayah was studied), and one prompt per guide part,
`shared:ex:${key}:${part}`, with the parts of `src/components/exercises/guide.ts`
`EXERCISE_GUIDE_PARTS` (play, options, words, bins, reveal, next; `validate_narration.py`
compares its mirror with that file); all with `highlight: []`, `focus: null`. A runner looks for
`${slug}:${ayah}:ex:${key}:${part}` first and falls back to `shared:ex:${key}:${part}`; only
`intro` is per ayah today. The learner only answers: the lesson's imam recites Dengar dan klik's
word by itself (the `play` prompt asks for listening, not a click), and a settled question moves
on by itself; the `next` prompt ("Klik tombol yang diberi tanda…") is spoken only in the "Tunggu
saya" pace. The start line says what the narration is (an AI voice, composed with AI help from the
cited kitab) and nothing about fatwa: the page footer keeps "Dibantu AI, bukan fatwa otoritatif".
Nothing anywhere promises a human review.

**Split lines.** A line whose spoken text would be longer than 400 characters is cut at sentence
ends (then `; `, then `, `) into the fewest even parts, stored as `<id>:a`, `<id>:b`, … (never next
to the unsplit `<id>`), each with the line's `highlight` and `focus`. A player that does not find
`<id>` plays `<id>:a`, `<id>:b`, … in order. Today 17 lines are split (into 39 parts; mostly
`structure`).

**One sentence, three forms.** Each line starts as PROSE (Latin, quotes and brackets kept) and is
written out twice from it, so caption and voice always say the same thing:

1. *Prose* (house rule: all normalisation in Python, ElevenLabs `apply_text_normalization` stays
   "off"): numbers spelled out (`ayat 6` → "ayat enam", `ke-3` → "ketiga"), `QS 6:112` → "Surah
   Al-An'am ayat seratus dua belas" (`CITED_SURAH` lists the cited surahs; any other fails the
   build), honorifics in full ("Allah subhanahu wa ta'ala", "Nabi Muhammad shallallahu 'alaihi wa
   sallam"), "Anda", no Arabic script, no ALL CAPS, no transliteration diacritics (folded: ā → a,
   ‘ → '), every Qur'anic word replaced by its place (below), and the house phrasing
   (`build_narration.PHRASING`, operator review 2026-10-10): a meaning is introduced with "yang
   artinya" ("huruf lam yang artinya “bagi”", "kata pertama, yang artinya “katakanlah”, …"), never
   bare quotes or "yang berarti" — also after a grammar term ("bentuk mubalaghah, yang artinya
   “yang banyak meniup”,", "keterangan waktu yang artinya “apabila”", "kata depan yang artinya
   “dari”"), while an example stays an example ("misalnya “tetap”", "sandaran kata: “nama
   Allah”"); "huruf jar ba'" reads "huruf jar, yaitu huruf ba'"; "Akhirnya dibaca kasrah, karena
   …"; "klik / mengklik / diklik", never "ketuk"; no open fragment ("yang....", "kata yang di."):
   the spoken text may carry no ellipsis and no phrase that ends on a bare "di".
2. `text`, *spoken*: each grammar term of the **pronunciation dictionary**
   (`authored/pronunciation.json`, the kamus pelafalan the operator approved by ear on the
   Al-Fatihah 1 preview) is written as its `speak` value — Arabic script for most (كَسْرَة,
   إِعْرَاب, مَجْرُور, حَرْف جَرّ, نَعْت, كَلِمَة, اِسْم, فِعْل, تَصْرِيف, جُمْلَة فِعْلِيَّة …; eleven_v3 mispronounced
   the Latin na't, idhafah, mudhaf ilaih), a fixed Latin respelling for a heavy letter (ص ض ط ظ ق خ غ)
   with fathah or alif, which v3 reads light and inconsistently (إِضَافَة → idhofah, مُضَاف إِلَيْه →
   mudhof ilaih, ضَمَّة → dhommah, ضَمِير → dhomir), and the Name as "Alloh" (tafkhim, house rule);
   a letter of a preposition is said by its name (بَاء, لَام). Then `tts_text`: quotes dropped,
   brackets and dashes become commas, an ellipsis is dropped (not read as a full stop), "/" reads
   "atau", "+" reads "dan", an open prefix loses its hyphen ("di-" → "di").
3. `display`, *caption*: the prose with each term in its `display` form and the letter as in the
   ayah — never its spelled-out name (the operator caught "ba’ (بَاء)" beside بِسْمِ), and since
   2026-10-17 ALONE, without its Latin name beside it: "Contohnya huruf ب ini", "huruf jar (حَرْف
   جَرّ), yaitu huruf بِ," (operator, on the Pengantar: "we dont need to write “ba’” here, only the
   arabic one is enough, also apply this rule to similar sentences"; `Term.bare`: every letter term
   of the dictionary whose bracket is ONE letter; the article keeps "alif lam (ال)", a step's name).
   `pronunciation.json` keeps "ba’ (بِ)": its head is how the prose writes the letter, the bracket
   its default shape. Display only: the spoken text, and so every file name, is unchanged, and the
   karaoke words are re-derived from the existing timings by the build (`retext_tokens`), never
   rendered again. `check_display` refuses a single letter with its Latin name beside it. A term whose
   caption has brackets is not left inside or right before brackets: "sifat (na't)" becomes
   "sifat, atau na’t (نَعْت)," (spoken "sifat, atau نَعْت,"), "huruf jar (kata depan)" becomes "huruf
   jar (حَرْف جَرّ), yaitu kata depan,", which is also how the line is best said.

Where a term counts (`validate_narration.LATIN_CONTEXT`): its caption head ("kasrah", "na't",
"huruf jar", "mudhaf ilaih", "isim majrur") as a whole word anywhere, except "huruf" (plain
Indonesian: "huruf ba'", "empat huruf", "huruf 'athaf"; the word class only in the Kalimah
concept's list), ba'/lam (only after "huruf" or "jar": "alif lam" and root letters stay), and
isim/fi'il as the head of a longer term the dictionary does not have (isim fa'il, isim maushul,
fi'il mudhari', fi'il amr, fi'il madhi, fi'il majhul stay Latin). Grammar vocabulary the dictionary
does not have stays Latin, folded (mubtada', khabar, mabni, sukun, badal, mudhaf, mudhari', manshub
…): **new terms are added only after the operator approves their sound** on the preview page, and
are then spoken from the dictionary wherever their caption head appears. Every term records
`approved`: the date of the ear check, or "pending-ear-check 2026-10-10 — operator waived the
pre-render review" for the letter names added on 2026-10-10 (مِيم نُون رَاء دَال كَاف هَاء يَاء وَاو
تَاء فَاء عَيْن هَمْزَة, and alif / alif lam in a fixed respelling; sin too until 2026-10-17, when the
operator heard سِين drawn out, "you read it siiiin, i think sin is enough", and chose the Latin
"sin": "pending-ear-check 2026-10-17"): they render, and
`validate_narration.py` and `render_narration.py` list them, with their lines, until the operator
has heard them and dates them. Such a Latin term (mubtada', sukun, fa'il, wazan, isim maushul, a
letter name; `validate_narration.latin_terms`) is held back like a heavy letter: a line with audio
or one written to be rendered as it stands (primer, compose, a composed word's lead) fails, any
other is refused by `render_narration.py --render` and listed by `validate_narration.py` (Al-Fatihah
2026-10-10: 20 concept lines and 7 structure lines of ayat 2–7). A Latin word with a heavy
letter + a (dh zh kh gh sh th q + a: khabar, mudhaf, mudhari', 'athaf, nashab, zharaf, qaul,
shallallahu …; `validate_narration.heavy_latin`) is the same problem as إِضَافَة: v3 reads it light.
Such a line stays caption-only until the dictionary has an approved respelling for the word:
`render_narration.py --render` refuses it before anything is sent, a line with audio may not carry
one, and `validate_narration.py` lists the words waiting for the operator (`NOT_HEAVY` holds the
spellings that only look heavy: fathatain is ta + ha). عَلَى was removed (2026-10-10): it is the
front of عَلَيْهِمْ (1:7), a Qur'anic word, so the narrator never says ‘ala as a TERM ("Bagian
depan kata ini adalah huruf jar yang artinya “atas”"; the Huruf jar concept names only its bi- and
li- examples, never "huruf jar yang artinya atas", which would define the term by itself). Since
2026-10-17 the compositions of 1:7:4 and 1:7:7 name it as a part, a named word ("huruf jar, yaitu
عَلَى (‘alā), yang artinya “kepada”", said "'ala"; "Sibling lines").

**The narrator never voices a Qur'anic word** (plan §6.1 A1; the imam's recording carries every
Qur'anic word) — **with one exception since 2026-10-17, the named word**: where an explanation
names the word or the part it explains, the caption shows it from the content's bytes with its
transliteration and the narrator says the transliteration ("Kata pertama diawali huruf jar, yaitu
بِ (bi) yang artinya “dengan”, sehingga isim sesudahnya, yaitu ٱسْمِ (ismi) yang artinya “nama” …";
operator: "make the sentence clear with examples", "it's better to say bi instead of ba, and only
show the arabic one", "should also mention the arabic word not only artinya"). Only from markup —
`{{s:a:w}}` (a lesson word) or `{{s:a:w/form}}` (a named form of its composition: بِ, ٱسْمِ, بِٱسْمِ,
ٱلْعَٰلَمُونَ) in an authored `say` / `lead` / `why_basic` / structure item or a PRE_REWRITE — and
from the sanitiser's name for a word of another ayah ("kata ٱللَّهِ (Allāhi) yang artinya “Allah” di
ayat pertama"; a phrase is still named by its meaning). What relaxed and what still guards it
(`validate_narration` "named words"): `check_spoken` masks the transliterations the caption names
(`named_said`), in order, once each, and nothing else — any other mention is still "Qur'anic word …
in narration"; the caption's "<Arabic> (<translit>)" must be one of the content's own pairs
(`Named`, `check_display`); Qur'anic Arabic script in the spoken text stays forbidden; a tile
syllable may be said only where it is so named (`check_animation_line`). The transliteration is
said plain (`named_speech`; the Name at a word's start "Alloh": Allāhi → Allohi). **A word with a
heavy letter is never said** (operator 2026-10-17: "better not to use heavy-letter words with
elevenlabs, we just explain but not read them; simple words so far is ok"): `named_is_said(ar,
translit)` is false when one of ص ض ط ظ ق خ غ is among the word's Arabic letters (or its plain
spelling keeps a heavy letter + a, `HEAVY_LATIN`), and then the caption names the word while the
spoken text leaves it out with its connector (`UNSAID`, `unsay`: "Kata kedua, yaitu X, artinya" →
"Kata kedua artinya", "…, yaitu X, yang artinya" → "…, yang artinya", "kata X yang artinya" →
"kata yang artinya", "bunyi u: X." → "bunyi u."). Its markup is {{!s:a:w}} / {{!s:a:w/form}}, and a
mismatch stops the build either way (`Speech._named_mark`); generated lines write it with
`named_markup`. The karaoke tokens: each left-out piece (", yaitu ٱلصِّرَٰطَ (aṣ-ṣirāṭa),") joins the
token it falls in or follows and shows with that token's timing — or, where that token already
shows Arabic ("isim (اِسْم),"), is a token of its own with the same timing, so a karaoke word holds
at most one Arabic unit, at its end (2026-10-17) — no timing is made up (`Lexicon.text_cuts`,
`token_entries`, used by `tokens`, `render_display`, `check_tokens` and
`build_narration.retext_tokens`, the path a kept render's tokens take). A line that says such a
word anyway (`said_heavy`) fails validation and is refused by `render_narration.py`; the TS checks
and the screen-reader text use the same rule (`namedIsSaid`, `unsayCaption`). Planted faults: "a
heavy-letter word said in its plain spelling", "… in a pesantren respelling", "… the caption as it
was", "a rendered line saying a heavy-letter word", "a heavy-letter word named with the markup of
a said one", "a simple word named as shown only", "a shown-only word without its token". A caption that
names a word only by its meaning, "kata yang artinya …" / "huruf yang artinya …", fails
(`MEANING_ONLY`). Planted faults: "a named word whose Arabic is not the content's", "… with another
transliteration", "a lesson word said in Latin where the caption does not name it", "a named word
said from Arabic script", "a word named only by its meaning". The lesson prose names words in SKB transliteration, so `build_narration.Sanitiser`
replaces each mention with the word's place, which the stage numbers under each mushaf word
(1, 2, 3… right to left, word 1 rightmost):

- the word the line is about → "kata ini"; another word of the ayah → "kata kedua"; a run →
  "kata pertama dan kedua", "kata kedua sampai keempat". A word of ANOTHER ayah is not on screen,
  so since 2026-10-17 it is a named word, shown and said with its meaning: "kata ٱلصِّرَٰطَ
  (aṣ-ṣirāṭa) yang artinya “jalan” di ayat keenam" in an ayah before the sixth (an existing "di ayat
  6" is reused); a word of an EARLIER ayah is cited by its ayah's ordinal, because the line says
  what this ayah depends on (rule 8 of the operator's wording rules, as refined 2026-10-18:
  "pengganti bagi kata ٱلصِّرَٰطَ (aṣ-ṣirāṭa) yang artinya “jalan” di ayat keenam" in ayah 7; from
  2026-10-17 to 2026-10-18 the ayah was left out), and in another surah no "di ayat"; a phrase of
  several words is still named by its meaning alone, "frasa yang artinya “dan dari kejahatan” di
  ayat tiga", except a phrase of an EARLIER ayah, which is a dependency and named by its words too,
  "frasa لَمْ (lam) يَلِدْ (yalid) yang artinya “tidak beranak” di ayat ketiga"; a word of the ayah named by its place and its meaning is shown too
  ("kata ketiga, yaitu رَبِّ (rabbi), yang artinya “Tuhan”", `name_places`, rule 5); a gloss the prose already gives right after the mention is
  that meaning; the quiz shows a `why_basic` that names a word the same way (`quiz.named_words`),
  and the stage's own check refuses a caption that still carries the markup (`checks.ts`
  sequenceProblems); "lafaz Allah" in another ayah reads "lafaz “Allah” di ayat dua". A preceding
  "kata"/"lafaz" is absorbed, "kata perintah qul" reads "kata perintah, yaitu kata pertama", and a
  particle name followed by its gloss ("huruf jar min (“dari”)") keeps only the gloss.
- `PRE_REWRITES` (in `build_narration.py`) fix the phrasings no place can: the ‘alā of ‘alaihim
  ("Bagian depan kata ini adalah huruf jar yang artinya “atas”"), the lesson card's "di kartu
  ini", a place inside a place (dhamir sya'n), a concept title that is only the particle ("Lam: …"
  → "Huruf yang menafikan…"), the concept titles that end in an open fragment ("Isim fa'il, yaitu
  kata pelaku", "Isim maf'ul, yaitu kata bagi yang dikenai perbuatan", "Fi'il majhul, yaitu kata
  kerja pasif"; the summary that follows explains them), the Huruf jar concept's examples (bi- and
  li- only), an open gloss ("yang banyak …" → "yang banyak meniup", as 113:4's word card says), the
  Kalimah title ("Tiga jenis kalimah, atau kata: isim, fi'il, dan huruf").
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
run together as recited are prefixes (huwallahu, bismillahi). In Arabic script: any Arabic in the
spoken text that is not a dictionary `speak` value fails, and says so when it is a lesson word, one
without its proclitic or article, or the front of one (`Forms.quranic_arabic`); no dictionary term
may be one either. The guard runs on the spoken text and on the caption, dictionary terms masked.
Allowed exceptions, decided here: **in the caption, "Allah" (no case ending) only inside “…” — the
translation and the quoted glosses are Indonesian — or followed by "subhanahu wa ta'ala"**; the
spoken text says the dictionary's "Alloh", and saying the caption must give the spoken text, so
every "Alloh" is one of those. Also allowed: the honorific phrases, a surah name right after
"Surah", and "lam" as the letter name ("huruf … lam", "alif lam").

**Arabic that stays Latin (operator decision pending).** Non-Qur'anic Arabic in the prose that the
dictionary does not have is kept, folded: wazan names (fa'lala–yufa'lilu, istaf'ala, af'ala,
if'al, istif'al), the i'lal origin nasta'winu, the plural markers una/ina, the pattern examples
naffas/naffasah, and four dictionary forms that are also Qur'anic words elsewhere in the mushaf but
not in these lessons: hada (lemma of ihdinā), kana (yakun; "kāna dan saudaranya"), 'uqdah
(singular of al-‘uqadi). The scholars' supplied verbs for 1:1 (abtadi'u, ibtida'i) are dictionary
terms (أَبْتَدِئُ, اِبْتِدَائِي). The i'lal origin nasta'winu is close in sound to nasta‘īnu (1:5:4):
still waiting on the operator. If those count as Qur'anic words, add them to `ALIASES` (or the
form set) and the build stops until each mention has a rule.

**Checks.** `build_narration.py` refuses to write a line that fails `validate_narration.check_text`
(prose), `check_spoken` or `check_display`, or when the dictionary breaks its own rules.
`validate_narration.py` re-checks everything independently of the files' history: shape (v2),
id contract and coverage (every ayah/word/shown exercise and every "Konsep baru" line the
curriculum gives the lesson, no extras), split
parts; the dictionary (an Arabic `speak` is the term itself; a heavy letter + fathah/alif has a
Latin respelling; no term, in Arabic or in its Latin caption head, is a lesson word or its front);
the spoken text (≤ 400 characters, Arabic only from the dictionary, no dictionary term left in its
Latin spelling, "Alloh" not "Allah", ASCII letters and `. , ; : ! ? ' -` only, no digits, ALL
CAPS, open prefix, "ketuk", "yang berarti", "fatwa" or review promise, the forbidden set, word
places); the caption (says what is spoken, Arabic only in display forms, a letter as in the ayah,
alone, never by its name, the forbidden set with the Allah rule, word places); that the intro reads
the translation and each `w${n}` gives the gloss (in quotes on the caption, as said in the spoken
text); `highlight`/`focus` as the table above; audio entries (`url` =
`/belajar/media/narration/<voice-slug>/<slug>/<delivery_name>.mp3`, the name of the DELIVERED file:
a hash of the master's name — text, voice, settings — the delivery format and the entry's own
`sha256`, so audio of an older text cannot survive, a url naming the 128 kbps master fails, and so
does a `sha256` the file is not named by or a name made with another format tag; `ms` > 0, sha256)
and tokens (with audio only, in time order, joined by spaces equal to
`Lexicon.render_display(text)`, and within the clip: a take whose audio ends more than
`CUT_TOLERANCE_MS`, 20 ms, before its last token does was cut short by ElevenLabs — see "A take cut
short" below); and that the manifests equal a fresh build (no
hand edits; edit the templates, the dictionary or the lesson content instead). None of this needs
an audio file: CI has neither the masters nor the delivered files, and checks the manifests alone.
`test_validate_narration.py` plants its faults (one per rule; the lesson map's and the
curriculum's, 2026-10-13: a missing or stray map line, the one map line of version 1, a wrong
count, a step named in the wrong group, a postponed step's wrong ayah, a next-level topic named,
a closing that names other steps or another total, a "Konsep baru" line in a lesson the
curriculum does not give it, a step's own text that drifted, a term before its lesson that the
pending list does not have, a listed line that says nothing too early, a stale term on a listed
line; 28 came with format 2: the
dictionary, captions, tokens, content-addressed audio, copy rules and the stage view; 14 with the
compositions: primer/compose coverage, `frame`, caption length beside the animation, tile
syllables, splits, letter shapes, strict prose; 3 with the delivery format, 2026-10-11: a url
naming the master, a sha256 of other bytes, another format tag; 8 with the Pengantar review,
2026-10-17: a single letter with its Latin name beside it in a lesson-zero caption, in an ayah's, in a
karaoke word, sin spoken from Arabic script again, a take cut 111 ms and one cut just past
`CUT_TOLERANCE_MS`; 236 in all) and unit-tests numbers, `tts_text`, the
dictionary rendering (spoken text, caption, tokens), the sanitiser, the word places, the content
addresses (master and delivery), the request body, the delivery encode's fixed flags, drift limit
and token fit, the rule that lines sharing a file carry one set of timings (`settle` refuses twins
whose timings differ) and the upload command the scripts print (the listed files only, never
`scp -r`) and — on a machine with ffmpeg, so not on the CI runner — one real encode of a
generated tone, one `render` of a line whose master is on disk (nothing sent, the manifest gets
the delivered file, a second run keeps that file without encoding it again, a third with the master
gone skips the line), the rule that a published name stands (`settle`: kept whatever the master or
the encoder would give today, encoded again only with `--reencode` or when damaged, a failure when
damaged with no master, "absent" when neither file is here), `encode_narration.py --check` on an
empty output directory (it says nothing was checked, and with `--list` it fails and lists nothing),
and the rules of the 2026-10-11 review, each with the voice API mocked: audio and tokens move
together when a master and its alignment are replaced by hand, when a line is rendered fresh over
a file the manifest already names, and when a text two lines share is retaken (both lines selected,
or one, which `settle` then refuses until the other is rendered); a line whose entry still names
its master is rendered, not skipped; a published file that is lost or damaged is restored as the
published bytes or refused when the encoder writes other bytes (`settle`, `render` and the script
itself, with LAME quality 3 standing in for another build); and `encode_narration.py --check`
exits 1 with "out of date" on a damaged file, `--list` leaves that file out, and a failed run
leaves no list from an earlier run behind.
CI (`.github/workflows/deploy-belajar.yml`, verify job) runs
`build_narration.py --check`, `validate_narration.py` and `test_validate_narration.py`; the
TypeScript guard in `src/lib/autoplay/narration.ts` (`spokenTextProblems`, run by `npm test`) is a
lighter mirror of the same rules. The image job's screenshots (`scripts/ci/screenshots.mjs`) drive
Al-Fatihah ayah 1 in a real browser to mid-explanation of word 1 and fail unless the word card and
the karaoke caption show (al-fatihah:1:w1 needs its render for that), then through the harakat
primer and word 1's composition (parts, the change mid-way and settled, the join, the change with
reduced motion), failing if the animation never shows or sits under the bottom panel; the MP3s are not on the runner, so that script answers the narration URLs
in the browser itself (a Playwright route, test-only; `scripts/ci/narration-route.mjs`) with the
delivered file from `pipeline/out/delivery/` when present (the manifests name the delivered files
since 2026-10-11, no longer the masters in `pipeline/out/narration/`), else a silent WAV as long as
the line's `ms`, so the word timings play out against a real audio clock.

**Render (`render_narration.py`; costs money, asks first).** Default is a dry run: characters and
cost per manifest at USD 0.08/1K (eleven_v3 list price), plus the distinct texts it would actually
send (identical lines, e.g. the same exercise intro on several ayat, are rendered once and copied).
A render needs `--render --i-approve-spend --voice-id <id> --voice-name "<name>"` and reads
`ELEVENLABS_API_KEY` only then, from the repo `.env` or `--env-file` (a worktree has none). The
request is fixed in `validate_narration.request_body`: `eleven_v3`, `language_code: "id"` (mode A,
operator 2026-10-10), stability 0.5, style 0.35, similarity_boost 0.75, use_speaker_boost true,
`apply_text_normalization: "off"`; no `previous_text`/`next_text` (v3 rejects them). One request
per line (v3 limit 5,000 characters; lines are ≤ 400) to `POST /v1/text-to-speech/{voice}/with-timestamps`,
whose character alignment is 1:1 with the text sent; `Lexicon.tokens` turns it into the line's
`tokens`. The render is the MASTER (`mp3_44100_128`, mono): it goes to
`pipeline/out/narration/<voice-slug>/<slug>/<file>.mp3` (git-ignored) with
the alignment beside it as `<file>.json`, where `<file>` is `audio_name` (16 hex of the sha256 of
the text, voice and settings): an unchanged line is never paid for twice (skipped when the
manifest already names its delivered file, re-used from disk otherwise, copied between manifests), and
a changed line gets a new name, never a stale cached file. Each master is then encoded for
delivery, in the same run (`encode_narration.deliver`, below; a render checks for ffmpeg before it
sends anything), and the manifest line gets `audio {url, ms, sha256}` of the DELIVERED file
(duration by ffprobe) and `tokens` after each line. Audio and tokens always come from one take:
the tokens are derived each time from the alignment beside the master, and the delivered file the
manifest already names is kept only when the line was not rendered in this run and those tokens
have the timings the manifest already has; otherwise the master is delivered anew (a fresh render,
a master and its `.json` replaced by hand, a second line of a text that was just retaken);
`build_narration.py` keeps both while the spoken text is unchanged (re-deriving token texts if a
display form changes). `--surah` and `--only <id-prefix>` (repeatable) narrow a run, e.g.
`--only al-fatihah:1: --only shared:`; a selection with held-back lines (a heavy letter or a Latin
Arabic term not from the dictionary) is refused whole, unless `--skip-held` leaves those lines out
and lists them (`--surah al-fatihah --skip-held` renders the rest); a manifest already voiced by
another voice needs `--switch-voice`. The run prints the characters sent and the `character-cost` header total. The
upload is printed, never run: the two commands of "Before a deploy" below (the list of the
delivered files the manifests reference, then those files and no others; never the masters, never
a whole directory).

**A take cut short (2026-10-17).** Operator, on `al-fatihah:0:primer:1`: "the voice is cut slightly
before the sentence finished: Pertama, harakat, yaitu tanda bunyi pada huruf Arab." The cut is in
what ElevenLabs returned: the MASTER is 4.049 s while its own alignment ends the last letter (the b
of "Arab") at 4.16 s; our encode keeps every length (0 ms drift). Over the 460 rendered lines of that
day every whole take ends 26–51 ms AFTER its last token (the last MP3 frame; three lines 0.5–0.9 s,
trailing silence) and exactly two end BEFORE it: `al-fatihah:0:primer:1` (111 ms) and
`al-fatihah:4:w1:compose:2` (131 ms, the "one line" of the delivery notes below). So
`validate_narration.CUT_TOLERANCE_MS` is 20 ms (under one 26.1 ms MP3 frame, under two 11.6 ms
alignment steps: rounding); a take that ends more than that before its last token is cut, and:

- `validate_narration.check_tokens` fails a manifest line that carries one ("tokens run past the end
  of the audio: the take is cut, …"; until then it allowed 0.5 s);
- `build_narration.manifest` does not carry one over (`V.is_cut`): the line plays caption-only, as a
  changed line does, until it has a new take — which is what the two lines do now;
- `render_narration.py` writes a fresh take beside its master as `<file>.new.mp3`, measures it
  (ffprobe) against its alignment BEFORE it takes the master's place, and refuses a cut one: kept as
  `<file>.cut-<k>.mp3` (+ `.json`; paid for, there to listen to), nothing delivered, nothing in the
  manifest, the line listed under "REFUSED" and the run's exit status 1. A take already on disk
  (reuse, or a twin copied from another manifest) is measured the same way, and a cut one is never
  used again: moved aside as `<file>.cut-<k>.mp3` and the line rendered anew. Nothing is retried by
  itself: each run pays for at most one take per text; run the same command again for another;
- `encode_narration.deliver` refuses to deliver a cut master ("its master is cut short").

The RETAKE of a cut line is therefore an ordinary render of it: the build has taken its audio away,
so the dry run counts it and `--render` sends it ("The review of 2026-10-17", above).

**Delivery (`encode_narration.py`; ffmpeg on this machine, no cost).** Operator, 2026-10-11, on
"how to reduce the loading time?": "do all three" — fetch the imam's recitation early, deliver the
narration at 64 kbps mono, and let browsers keep the files for good (plan L15). The narration was
served as rendered, mono at 128 kbps, twice what speech needs: the opening line was 372 KB. Now:

- **Masters stay masters.** `pipeline/out/narration/<voice-slug>/<slug>/<audio_name>.mp3` and its
  `.json` alignment are what ElevenLabs returned; they are never served and never re-encoded in
  place. A later change of the delivery format encodes from them again, not from a lossy copy.
- **One fixed encode** (`encode_narration.ENCODE`; constants, not flags): `ffmpeg -threads 1 -i
  <master> -map 0:a:0 -vn -map_metadata -1 -map_chapters -1 -c:a libmp3lame -b:a 64000 -ac 1 -ar
  44100 -compression_level 2 -flags +bitexact -fflags +bitexact -id3v2_version 0 -write_xing 1 -f
  mp3`: 64 kbps CBR, mono, 44.1 kHz, LAME quality 2, no metadata, no ID3 tag, no encoder version
  strings. The same master gives the same bytes on this machine (ffmpeg 7.1.1; `--check
  --reencode` encodes every master again and compares). The Info frame is kept on purpose: it
  carries the encoder delay and padding, so a player starts the delivered file at the same instant
  of sound as the master.
- **0.45 dB quieter than the master, on purpose left alone.** LAME scales its input by 0.95 at
  bitrates like this one (review 2026-10-11, all 335 master/delivered pairs decoded: gain
  0.944–0.953, mean 0.9495, the same below 4 kHz, zero lag; the same flags on `shared:start` give
  0.950 at 64, 96 and 128 kbps and 1.000 at 256 kbps). It is uniform and inaudible, not a fault to
  fix. Do not compensate with `-af volume=…`: the loudest delivered file already peaks at 0.95 of
  full scale, so ×1/0.95 would clip it, and any change of level gives all 335 files new names.
- **Its own name, by content.** `<out>/delivery/<voice-slug>/<slug>/<delivery_name>.mp3`, where
  `validate_narration.delivery_name` is 16 hex of the sha256 of `{master: audio_name,
  delivery_format: "mp3_44100_64_mono", sha256: <the delivered bytes>}`. It is never the master's
  name (the 128 kbps files already on the VM under the old names are simply no longer referenced),
  and no name ever means two files: a changed text, another format, a retake of the same text or
  an ffmpeg that writes other bytes each give a new name. That is what lets the server answer
  `/belajar/media/narration/*` with `Cache-Control: public, max-age=31536000, immutable`.
- **A published name stands** (review 2026-10-11). Because the name carries the bytes, encoding a
  file again with another ffmpeg or LAME build would rename it: learners would download everything
  again despite the immutable cache, 22.6 MB would have to be uploaded before the next deploy, and
  CI could not notice a missed upload (the validators pass on the renamed manifests). So a line
  whose manifest entry already names a delivered file, with that file on disk and intact (sha256,
  length, format, decode), is **kept**, master on disk or not, by this script, and by
  `render_narration.py` for a master it re-uses while that master is still the take the file was
  made from (the same token timings). Only a line without a valid delivered file is
  encoded: a new or changed text, a fresh render or retake, a file lost or damaged.
  A **lost or damaged** file is made again only as the bytes the manifest publishes (the same
  sha256, so the same name): on the build that published it that is a silent restore. When this
  machine's ffmpeg writes other bytes for the master, the step fails ("this ffmpeg writes other
  bytes") instead of renaming the file, in both scripts: fetch the published file back from the
  server (`https://dakwah-lens.id` + its `audio.url`) into its place under `out/delivery/`. So
  `out/delivery/` is not a cache to delete on a machine with another ffmpeg.
  `--reencode` encodes every line whose master is here and takes what comes out; it is for a
  deliberate change of `ENCODE` (a new format: give `DELIVERY_FORMAT` a new tag with it) and for
  nothing else.
- **The manifest describes what is served.** `audio.url` is the delivered file's, `audio.sha256`
  the sha256 of its bytes, `audio.ms` its length by ffprobe, rounded to the millisecond. `tokens`
  are untouched: they are seconds from the start of the clip, and the clip did not move.
- **`encode_narration.py` never touches tokens; a retake goes through `render_narration.py`.** A
  master replaced by hand (another take put in the master's place, with its alignment `.json`) is
  not a case for `--reencode` alone: that would deliver the new take's audio under the old take's
  word timings, and neither validator would notice unless the new take is shorter than the timings
  by more than `CUT_TOLERANCE_MS` (20 ms since 2026-10-17; 0.5 s before). Run the render on that line first:
  `python3 render_narration.py --render --i-approve-spend --voice-id <id> --voice-name "<name>" --only <line id>`.
  Nothing is sent or paid for while the master and its `.json` are on disk (the run prints `reuse`);
  it re-derives the tokens from the `.json` and delivers the master, so the line gets its audio
  and its timings together, under the new name the new bytes give. Lines of one manifest with the
  same text share one master and one delivered file (12 texts on 2026-10-11), so select every one
  of them: if one is left on the older take, `encode_narration.py` refuses that file ("their token
  timings differ") and names the lines, instead of giving the new audio to a line that still has
  the old timings.
- **What stops the step** (no manifest is written): a freshly encoded file that is not MP3 / 64 kbps /
  mono / 44.1 kHz by ffprobe, whose frames do not add up to ffprobe's length, or that does not
  decode cleanly (`ffmpeg -v error -i f -f null -`); a length more than 80 ms from its master's
  (`MAX_DRIFT_MS`); a karaoke token that no longer fits, i.e. ends later after the end of the
  delivered file than it did after the end of the master. Also a kept file that is damaged while
  its master is not on the machine to make it again; a lost or damaged published file that this
  ffmpeg cannot make again as the published bytes (above); and lines that share a text but carry
  different token timings (above).

```bash
python3 encode_narration.py                    # deliver what the manifests reference (keep what stands, encode the rest), update their audio entries
python3 encode_narration.py --check            # the same, writing nothing; exit 1 if anything would change
python3 encode_narration.py --list files.txt   # also list the delivered files on this machine, relative to out/delivery, for the upload; exit 1 if a referenced file is not here as described
python3 encode_narration.py --check --reencode # every master encoded again and compared with the manifests and the files on disk (this ffmpeg still writes the published bytes)
```

`render_narration.py --render` calls the same `deliver` on every line it renders, so a new surah
is delivered at 64 kbps without this step; run it by hand to re-check a machine's files, or with
`--reencode` after changing `ENCODE` (with a new `DELIVERY_FORMAT` tag). A line with neither its
master nor its delivered file on the machine (another one rendered it) is left as the manifest has
it and reported as NOT checked: the run still exits 0, and its last line says how many were kept,
encoded and unchecked. `--list` is the gate before an upload: it writes only files that are on
this machine as the manifests describe them, names every referenced file that is not, and then
exits 1, because an upload from a short list leaves those lines without audio (a 404,
caption-only) unless the server already has them. Under `--check` nothing is repaired, so a file
found damaged or absent is left out of the list as well. The list of an earlier run is removed
when the run starts: a run that fails before it writes its own list leaves none behind.

**Before a deploy.** CI has no audio: it checks the manifests alone and cannot see a file that was
never uploaded, and a line whose file is missing on the server plays caption-only (a 404). So
whenever a manifest's `audio` entries changed (a render, a retake, a new delivery format), do
these in order, from `belajar/pipeline`, and deploy only after the last one. Nothing here costs
money, and only step 3 writes to the server (it adds files and replaces none).

```bash
# 1. The manifests are what the build gives, and valid.
python3 build_narration.py --check && python3 validate_narration.py

# 2. Every delivered file the manifests reference is on this machine as described (sha256, length,
#    format, decode), and the upload list is written. Go on only if this exits 0. If it says "out
#    of date", run `python3 encode_narration.py` (no --check), commit the manifests if they
#    changed, and start again at 1.
python3 encode_narration.py --check --list out/delivery/files.txt

# 3. Upload the listed files and no others (the directory also holds files no manifest references
#    any more). The script prints this command with its paths filled in; it never runs it.
cd out/delivery
COPYFILE_DISABLE=1 tar --no-mac-metadata -cf - -T files.txt | ssh <vm-host> 'sudo -n -u deploy tar -x --skip-old-files -C /srv/dakwah-lens/data/belajar-media/narration'

# 4. Every listed file is served, byte for byte (still in out/delivery). Step 2 has just checked
#    the local files against the manifests' sha256, so equal to the local file is equal to the
#    manifest. The last line must say "0 of N".
bad=0; while read -r f; do
  served=$(curl -fsS "https://dakwah-lens.id/belajar/media/narration/$f" | shasum -a 256 | cut -d' ' -f1)
  [ "$served" = "$(shasum -a 256 "$f" | cut -d' ' -f1)" ] || { echo "NOT SERVED AS LISTED: $f"; bad=$((bad+1)); }
done < files.txt; echo "$bad of $(wc -l < files.txt | tr -d ' ') listed files are not served as listed"

# 4b. The same for our copies of the recordings we did not make (host_media.py): every file in
#     out/delivery/files-hosted.txt (the imam's ayat, Quran.com's words) uploaded with step 3's
#     command and that list, and served byte for byte (step 4's loop with files-hosted.txt).
python3 host_media.py --check && python3 host_media.py --deliver --out out
cd out/delivery
COPYFILE_DISABLE=1 tar --no-mac-metadata -cf - -T files-hosted.txt | ssh <vm-host> 'sudo -n -u deploy tar -x --skip-old-files -C /srv/dakwah-lens/data/belajar-media/narration'
bad=0; while read -r f; do
  served=$(curl -fsS "https://dakwah-lens.id/belajar/media/narration/$f" | shasum -a 256 | cut -d' ' -f1)
  [ "$served" = "$(shasum -a 256 "$f" | cut -d' ' -f1)" ] || { echo "NOT SERVED AS LISTED: $f"; bad=$((bad+1)); }
done < files-hosted.txt; echo "$bad of $(wc -l < files-hosted.txt | tr -d ' ') listed files are not served as listed"

# 5. Only now merge and deploy.
```

About step 3 (the 335 files were uploaded with it on 2026-10-11, `-k` then in place of
`--skip-old-files`, into a directory that held none of them): the VM's ssh alias logs in as
an admin user, while `/srv/dakwah-lens/data/belajar-media` belongs to the user `deploy` and is
world-readable for Caddy (`deploy/belajar/deploy.sh`), hence `sudo -n -u deploy` on the receiving
side: files written as another user would not be `deploy`'s. `tar -T files.txt` reads the paths
relative to `out/delivery` (`<voice-slug>/<slug>/<name>.mp3`), which is the layout under
`narration/` on the server. `--skip-old-files` keeps a file that is already there: names are
content-addressed, so a name never means two files and nothing ever needs replacing; that also
makes the upload safe to run again. Measured on the VM's GNU tar 1.35 (2026-10-11): extracting a
file that exists exits 0 with `--skip-old-files` and 2 with `-k`, which is why `-k` is not used. A
non-zero status from step 3 is therefore a real failure; step 4 decides either way.
`COPYFILE_DISABLE=1` and `--no-mac-metadata` are for macOS's tar, which would otherwise add `._*`
files and extended attributes to the archive.

Encoded on 2026-10-11 (everything rendered: Al-Fatihah and the shared lines; 362 lines, 335
files): 45,282,075 → 22,633,255 bytes (50.0%); the largest, `al-fatihah:4:structure`, 491,146 →
245,550; the opening line `shared:start` 372,445 → 186,199. Length drift against the masters: 0 ms
on every file (the same frame count; `ms` did not change on any line). All 335 decode cleanly.
Checked once beyond what the step checks: decoded, every delivered file has exactly its master's
number of samples, and master − delivered is quietest at zero offset (about −24 dB against the
signal, the codec's noise; one sample off is already louder), so the two play on the same
timeline to the sample. One line's last token ends 131 ms after its MASTER does
(`al-fatihah:4:w1:compose:2`: ElevenLabs' alignment, there before the encode and unchanged by it;
`check_tokens` allowed 0.5 s then). It was a CUT TAKE, as the operator heard on another line on
2026-10-17: see "A take cut short".

Dry run on 2026-10-10 (spoken characters, first take): Al-Fatihah 19,814 (USD 1.59), Al-Ikhlas
10,475 (0.84), Al-Falaq 12,247 (0.98), An-Nas 12,660 (1.01), shared 1,520 (0.12); total 56,716
characters in 381 lines (USD 4.54), of which 43,971 characters in 253 distinct texts are sent
(USD 3.52). Retakes come on top.

Rendered on 2026-10-10 (operator-approved sample, Kang Nandar, mode A): Al-Fatihah ayah 1 (20
lines) and every shared line (24 lines, 17 distinct texts) — 37 requests, 4,334 characters sent,
`character-cost` header total 952; 37 MP3s in `pipeline/out/narration/kang-nandar/`, waiting for
the upload. Every other ayah stays caption-only until the operator approves its render. Since the
review fix of 2026-10-10 the Huruf jar concept line (`al-fatihah:1:concept:huruf-jar`) no longer
gives "huruf jar yang artinya atas" as its third example (the term defined by itself); its new text (226 characters, about USD 0.02)
is caption-only until the operator approves that one render (`--only
al-fatihah:1:concept:huruf-jar`), and its old file `08d5205d14fcad8e.mp3` is no longer used.

## Kuis (the exercises' questions)

Operator, 2026-10-10 (narration rule 16): "make sure all questions in quiz already have lesson
beforehand when exploring ayat"; "in quiz, give narration/voice only for the correct answer, to
give auditory explanation"; "better to write the arabic word in quiz as well like majrur in
arabic". The quiz audit of 2026-10-11 rebuilt every question and the main session's decisions
fixed the plan; `quiz.py`'s docstring has the rules.

- **One plan** per surah, `content/quiz/<slug>.json` (`build_quiz.py`): each ayah's exercises with
  every question, its answer first and its wrong options. The lesson page, its exercises
  (`src/lib/quiz-content.ts`), the autoplay engine (`availableExercises`, the explanation cue of
  each question) and the narration build all read it; nothing re-derives a question at render time.
- **Authored** for Al-Fatihah (`authored/al-fatihah.quiz.json`): 46 questions (63 until the plan
  of 2026-10-13, on the basic curriculum: ayah 1 keeps tap-word only — no wrong option of
  why-harakat is taught by then — and the roles asked are the ones each lesson taught) in 1–3
  exercises an ayah; wrong options only from ayat already studied, of another cause (why-harakat) or sharing no
  term with the answer (label-role: never two correct options); sort bins = the case states taught
  so far (none at ayat 1, 3, 4). **Mechanical** for the Mu'awwidzat: the components' old rules,
  the wrong options drawn from the ayat studied so far (a question left without one is dropped);
  not taught-checked. **No wazan exercise in a basic lesson** (curriculum decision 6, 2026-10-13:
  all sharaf is tingkat lanjut): `quiz.BASIC_EXERCISES` leaves `wazn-factory` out, the mechanical
  plan no longer emits it, the three blocks left `authored/al-fatihah.quiz.json` (ayat 5–7), and
  `plan_problems` refuses one that comes back; the component and its narration templates stay
  for the next level.
- **TAUGHT** is derived from the narration the lesson plays before its exercises (the intro …
  structure lines of every ayah ≤ n in `content/narration/<slug>.json`): a term is taught where a
  line names or defines it — a concept step's title, "<term> adalah …", "… disebut <term>", or ", atau
  <term>" in a concept's summary. Mentioned ("ia manshub") or glossed after an Indonesian word
  ("pengganti (badal)") does not count (decision 6). marfu', mabni and manshub are named at the
  word that first shows them (al-ḥamdu 2:w1, iyyāka 5:w1, aṣ-ṣirāṭa 6:w2: one `say` each in
  `authored/al-fatihah.compose.json`). **REQUIRED**: the answer's case state and sign, every bin,
  every term an option's text names, every form label. `validate_quiz.py` fails on any gap that
  `authored/curriculum.pending.json` does not list (`quiz`: "<slug>:<ayah>:<exercise>:<n>" → the
  untaught terms) — and on a listed question that is taught by now. The 13 questions of
  Al-Fatihah went with the new plan (2026-10-13). REQUIRED then grew by the terms of **the
  explanation shown after an answer** (below), which found three questions of Al-Fatihah 7:
  `7:sort-case:2` and `7:label-role:2` (the reason of 1:7:3 names "sukun", which no line named:
  the primer said "huruf mati") and `7:label-role:1` (1:7:2's named "jar"). Cleared with
  content, not with an exemption: the harakat primer of lesson zero now NAMES sukun ("Tanda
  kecil di atas huruf sin disebut sukun: …", `al-fatihah:0:primer:6` — lesson zero's lines are
  "ayah 0" of that manifest, teaching lines like any other), and 1:7:2 has a `why_basic` that
  says majrur. The list has no question.
- **What the learner reads after answering is what the narrator says** (main session
  2026-10-13): a question's `why` in `content/quiz` is the word's `why_basic` where it has one
  (`quiz.py` `explained`; its terms with their Arabic from the table), else its `why`. Until
  then the voice said the basic reason and the screen showed the reference one, with terms of
  later lessons (mudhaf ilaih in ayah 2, badal in ayah 7). An OPTION is still the word's `why`
  (options are compared by cause).
- **Labels** carry the term table's Arabic at a term's first use in a text ("majrur (مَجْرُور)",
  merged with the text's own gloss: "na't (نَعْت, sifat)").

## Pemanasan (the warm-up: isim, fi'il, atau huruf?)

Operator, 2026-10-13: "i think it's better in every ayat we identify first each words fall into
which category: ismu, fi'il or harf. it's kind of exercise, kind of warming up" — and he approved
the main session's proposal: the learner guesses first, and the answer gives the visible sign.
An exercise with the key `word-kind` that OPENS every ayah lesson of a surah with a lesson map
(`authored/<slug>.map.json`): after the map's lines, before the first word. It also gives
Al-Fatihah 1 a grammar exercise again (it had tap-word only). `quiz.py` ("the warm-up") has the
rules; it is **derived, never authored** (a plan that lists it stops the build).

- **What is asked**: each PART of each word, in order. A word's parts are its QAC 0.4 segments
  (the QAC line in the word's `sources`), the article (DET) counted with the part it stands on:
  "dengan" + "nama" are two questions, a word with alif lam is one. The part's Arabic is the
  lesson content's bytes — the word, or its QAC segments (`segments` of `content/<slug>.json`,
  which `build_surah.py` writes for a word whose part the marked prose names; a compound word
  without them stops the build). Al-Fatihah: 29 words, 8 of two parts, 37 questions (5 / 5 / 2 /
  3 / 5 / 4 / 13).
- **The answer** is the part's QAC tag as one of three kinds (`QAC_KIND`: N, PN, ADJ, PRON, DEM,
  REL, T, LOC → isim; V → fi'il; P, CONJ, NEG → huruf; any other tag stops the build until it is
  added with its class). It must agree with what the lesson says about the word, its `pos`, part
  by part (`POS_KIND`): a disagreement stops the build. 26 isim, 4 fi'il, 7 huruf.
- **The explanation** is ONE sentence, built once (`quiz.warmup_marked`) and used twice: the quiz
  file shows it after the answer (`why`), the narration says it (`ex:word-kind:<n>:why`,
  `build_narration.ex_why`, which is given the lesson and its composition to name the part): the
  part by its place ("Kata keempat", "Bagian pertama kata pertama"), **the part itself with its
  meaning** where the content names it (`quiz.part_named`; rule 5 of "Operator's lesson-wording
  rules": "yaitu ٱلرَّحِيمِ (ar-raḥīmi), yang artinya “Maha Penyayang”"), its kind, **which class of
  the kind it is** ("karena ia nama sifat"; rule 13, operator 2026-10-17 — never the kind's
  general definition "yaitu nama benda, orang, atau sifat", as until then), and a **visible sign**
  only where the data shows one and the step that teaches it belongs to an EARLIER lesson:
  "didahului huruf jar" (the part before it is a huruf jar; from Al-Fatihah 2 on) and "memakai alif
  lam" (it carries the article; from Al-Fatihah 4 on). These are the matn's own signs of an isim
  (Ajurrumiyyah, Shamela 11371/1: «فالاسم يُعرَفُ: بالخَفضِ، والتنوينِ، ودخولِ الألف واللام، وحروفِ
  الخَفضِ»); no other sign is given, and none for a fi'il or a huruf. The operator's question,
  Al-Fatihah 1: "Kata keempat, yaitu ٱلرَّحِيمِ (ar-raḥīmi), yang artinya “Maha Penyayang”, adalah
  isim (اِسْم), karena ia nama sifat." A heavy-letter word is named on screen and left unsaid
  (rule 5): "Kata kedua, yaitu ٱلصِّرَٰطَ (aṣ-ṣirāṭa), yang artinya “jalan”, …" is said "Kata kedua,
  yang artinya jalan, adalah isim, karena ia nama benda. …".
- **The part named** (`quiz.part_named`, from the content only): a word of one part is the lesson
  word, with its gloss; a part of a word is the composition form (`content/compose`) with the
  part's own bytes (بِ, لِ, وَ, ٱهْدِ, نَا, أَنْعَمْ, تَ, هِمْ, لَا), else the form at the part's place
  in the join the composition builds the word from (bi + ismi → bismi: the part سْمِ is named
  ٱسْمِ (ismi), whose hamzat washal the join drops), with that form's gloss. Not named: the Name of
  Allah (below) and a part no form names — both parts of ‘alaihim at 1:7:4 (the composition has
  ‘alā and hum, not عَلَيْ and هِمْ) and the ‘alā of 1:7:7: those sentences give the place, the kind
  and the class, and no meaning (a meaning without its word is what rule 5 refuses).
- **Which class** (one rule, `quiz.part_class`; the classes from `quiz.kind_classes`, nothing
  typed): the class the Kalimah record teaches for the part's QAC tag — an isim's from the
  record's own examples, each a note "<word>: isim, <class>." on a word whose tag the record's QAC
  source gives: N "nama benda" (ṣirāṭa, 1:7:1), ADJ "nama sifat" (al-mustaqīma, 1:6:3), PRON
  "kata ganti" (iyyāka, 1:5:1); a fi'il's and a huruf's from its summary, "kata kerja" (V), "kata
  tugas" (P, CONJ, NEG). The kind alone: a tag the record teaches no class for (PN other than the
  Name, REL, DEM, T, LOC — Al-Fatihah: allażīna), the **Name of Allah** (QAC lemma `{ll~ah`;
  1:1:2, 1:2:2 — the rule of 2026-10-13 kept: its sentence says the kind and stops, no class, no
  name, no meaning; both lines are unchanged and keep their audio), and a **noun QAC marks as a
  participle** (N with ACT/PASS PCPL, the lesson's "isim fa'il" / "isim maf'ul": māliki,
  al-magḍūbi, aḍ-ḍāllīna) — the record's "nama benda" example is a plain noun, and whether a
  participle is a nama benda or a nama sifat no source here says (an ADJ participle, al-mustaqīma,
  is the record's own "nama sifat"), and a lemma of **`quiz.CLASS_WITHHELD`**, each with its
  reason: gair (QAC lemma `gayor`, 1:7:5, “bukan”; operator 2026-10-17) — a plain QAC N, but a word
  meaning “bukan” / “selain” is an isim by its place (always annexed: al-Jadwal, Darwisy, as-Samin;
  ar-Raghib: for negation or exception; Kosakata `ghayr`), not a nama benda. The question carries
  `class` where its sentence names one: 30 of Al-Fatihah's 37 (nama benda 8, nama sifat 5, kata
  ganti 6, kata kerja 4, kata tugas 7); 7 say the kind alone (the Name twice, the three
  participles, allażīna, gair) — each with the word and its meaning but the Name's. The
  operator's word was "kata sifat"; the lessons teach "nama sifat" (lesson zero, al-mustaqīma), and
  a warm-up says what was taught (operator: kept).
- **A class is held to what was taught before it**, like a term: it is plain Indonesian, no term
  of the table, so `quiz.class_problems` holds it on its own — a line of an EARLIER ayah (a
  teaching line, or a Konsep card's lead or example line) must name the class together with its
  kind. All five are lesson zero's ("ayah 0"): the Kalimah line ("isim (اِسْم), yaitu nama benda,
  …", "fi’il (فِعْل), yaitu kata kerja", "huruf (حَرْف), yaitu kata tugas") and its examples ("…
  juga isim (اِسْم), tetapi nama sifat", "… juga isim (اِسْم), yaitu kata ganti").
- **The introduction** (`build_narration.ex_intro`): "Latihan pemanasan, lima soal. Setiap soal
  menampilkan satu kata atau satu bagian kata dari ayat ini; tebak dulu jenisnya: isim, fi'il,
  atau huruf." ("satu kata" alone in an ayah with no word of two parts). The prompt of its three
  buttons is the shared line `shared:ex:word-kind:options` ("Pilih jenisnya: isim, fi'il, atau
  huruf."). In these sentences "huruf" is the word class and is said from the dictionary (حَرْف):
  `validate_narration.LATIN_CONTEXT` names the contexts (the list of the three, "… adalah huruf,
  karena ia kata tugas", lesson zero's "… adalah huruf, yaitu kata tugas"); a letter is still
  "huruf". A named part said as its sound is no letter's name: "yaitu تَ (ta)" says the syllable
  ta, and the render guard (`validate_narration.held_line`) masks a named word the caption shows
  before it looks for letter names, as `check_renderable` already did.
- **Held to what earlier lessons taught**, twice: the three answers and every term of the
  sentence must be TAUGHT by the lessons BEFORE this one (`quiz.untaught_reasons`: an opening
  exercise counts lines of earlier ayat only; lesson zero's are "ayah 0"), and a warm-up line
  that uses a term of its own lesson fails the term check (`curriculum.too_early(before=True)`).
- **In the app** it is an exercise like the others (`OPENING_EXERCISES` in
  `src/lib/autoplay/types.ts`; step `ex:word-kind`; `src/components/exercises/WordKind.tsx`): the
  lesson waits for the answer, "Lewati latihan" leaves it, "Ulangi" starts it again, it resumes
  by its step id, and it is first in the page's "Latihan" list. A question shows the word cut
  into its parts — each one whole piece, the one asked in a thick frame and named by its number
  — with the word's place, transliteration and meaning; the transliteration is the WORD's (the
  lesson content has none per part).
- **Other question kinds later** (decision 8 wants up to three questions on earlier topics met
  again in the ayah; not built): every question carries `ask` ("kind" today). A new kind is a
  new value of `ask` with its own fields — a member of the union in `quiz-schema.ts`, a branch in
  `quiz.warmup` and in the component — numbered on in the same exercise, so its explanation line
  is `ex:word-kind:<n>:why` like every question's.

## Rumus singkat (the cheat sheet, 2026-10-14)

The operator, 2026-10-13: "we can make some 'cheat sheet' to explain the rules, for example: harf
jar + ism = kasrah (give examples), isim followed by another ism is mudhof ilaih etc. this cheat
sheet is explained also along with formal explanation" — "of course we need to refer to valid
kitab, my example is just example"; 2026-10-14: "release cheat sheet". The draft table and what
the matn says of each row is `docs/belajar-research/rumus-singkat.md`; the decision is
`docs/belajar-plan.md` L32; the page is `/belajar/{locale}/quran/rumus`.

**What a row is.** One formula per step of the basic curriculum, in teaching order, with its
example word and the kitab's own sentences it restates. `authored/rumus.json`:

```json
{"version": 1, "steps": {"majrur": {
    "rumus": "[[Isim]] [[majrur]] umumnya berakhir [[kasrah]]. …",
    "awas":  "Jamak laki-laki beraturan [[majrur]] dengan ya', bukan [[kasrah]] (kita pelajari {{di:jamak-mudzakkar-salim}}).",
    "sumber": [{"page": "11371/6", "match": ["folded sentence", "…"]}]}}}
```

- **Nothing about grammar is typed.** The kitab's words are never in the authored file: a `match`
  is the sentence's consonant skeleton (alif forms unified, no harakat; at least three words), and
  `build_rumus.py` finds it as a run of whole words in the pinned page's matn (the editor's
  footnotes are cut at the mark `terms.HAMESH_MARK`), once, and takes the page's own bytes —
  harakat and all, the footnote digit dropped, spaces collapsed. An anchor not found, or found
  twice, stops the build. A `quote` key is refused. The kitab's name, print page, section and
  address come from the pin (`sources.json` `shamela_istilah.books/pages`), never typed twice.
- **Pins.** 19 pages, 18 of Ibnu Ajurrum's *Matn al-Ajurrumiyyah* (book 11371: pages 1–7, 9, 11–13,
  15, 16, 18, 20, 22, 30, 31) and one of 6970 (page 15, for a limit the matn does not state). The
  eight pages new with this release (11371/9, 10, 11, 14, 17, 18, 22, 31) were read from
  shamela.ws on 2026-10-13 and are pinned by `fetch.py --only shamela_istilah` (the sha256 of the
  extracted text); five of them are quoted (9, 11, 18, 22, 31), 10, 14 and 17 are pinned and
  quoted by no shipped row. `content/rumus.json` `data_versions.pages` holds the hash each quote
  was taken from.
- **The term rule of the lessons applies.** A formula uses only terms taught up to its own lesson
  (plus the free terms), through `curriculum.too_early`; a term of a later lesson is not said but
  pointed to: `{{di:<step id>}}` becomes "di Al-Fatihah ayat 4" from the curriculum (a pointer must
  name a LATER step). Every term form is marked (`terms.check_markup`) and no Qur'anic word is
  written: Arabic reaches the reader only as a dictionary term or as the quoted kitab.
- **The limit (`awas`) is shown only where a quoted sentence says it.** An awas the matn does not
  state was dropped, not softened (the draft's dropped items are listed in
  `docs/belajar-research/rumus-singkat.md`). 5 steps have one (majrur, marfu, alif-lam, manshub,
  fiil-madhi). The fi'il madhi's (the last letter is not always fathah: sukun when a doer's dhamir
  with a vowel is attached, dhammah with the plural wawu) comes from the pinned 6970/15 page, because
  the matn's "always fathah" is contradicted by the lesson's own 1:7:3.
- **The example is derived**: the first word of the step's lesson that the step occurs on (the
  curriculum's `lines[].words`, else `curriculum.occurs`); the app draws the word's Arabic,
  transliteration and meaning from the lesson file and links its ayah page.
- **Left out** (no entry; the page says "Rumus belum tersedia"): harakat (a reading convention with
  a primer, not a kitab rule), murab-mabni and isim-maushul (the records cite Ibnu Hisyam and Ibnu
  'Aqil, not yet quoted), mudzakkar-muannats, istitsna, la-nafi and istifham (no sentence of the matn
  was found). 29 of 36 steps have a formula: pengantar 1 of 2, Al-Fatihah 15 of 17, An-Nas 3 of 4,
  Al-Falaq 2 of 2, Al-Ikhlas 3 of 3, Ayat Kursi 5 of 8. Four of the 29 (idhafah, fi'il madhi,
  jamak taksir, isim isyarah) are shown only in the part the matn states.

```bash
python3 build_rumus.py            # write content/rumus.json (needs pipeline/cache; stops on any gap)
python3 build_rumus.py --check    # exit 1 if the file differs from a fresh build
python3 build_rumus.py --check --no-corpus   # CI: quotes from the file, each held to its anchor
python3 build_rumus.py --show     # the sheet as built
python3 validate_rumus.py         # each rule on its own (CI: --no-corpus)
python3 test_validate_rumus.py    # planted faults + unit tests (CI: --no-corpus)
```

**In the app.** `src/lib/rumus.ts` parses the file (zod, `src/content/rumus-schema.ts`) and checks
it against the curriculum at load; `src/lib/rumusSheet.ts` turns it into what the page draws.
**Availability is data**: a step shows its formula only when `lessonLink` (`src/lib/curriculumOutline.ts`,
the ONE rule the curriculum page's links use) gives its lesson a page — a written ayah of a
published surah (`BELAJAR_SURAHS`, read per request), or lesson zero while `introOpen`; every other
step is named and marked "Belum tersedia" and carries nothing of the file, so a hidden surah's
formulas are in no HTML and no RSC payload. The page is a list (never a table), the kitab's quote
is an isolated right-to-left block at the 24px floor, the sources are always visible (a printed
sheet has no disclosure to open), a print stylesheet drops the header and keeps each step whole,
and the footer carries the module's AI-assisted label. It is linked from the track page and the
curriculum page header through `rumusHref()` (`src/lib/routes.ts`).

**Not in this release**: the formulas are not in lesson narration (that would change a recorded
line and cost a re-render), the opening card does not show them, and no formula that is not in the
draft table was added. A formula the matn does not state stays out until a kitab sentence is found.

## Not built here

- `tafsir` (per ayah) comes from the platform-corpus retrieval stage (plan §7.5 stage 1); this
  build leaves it out, and `validate.py` fails if a tafsir appears. `hadith` is passed through from
  `authored/<slug>.hadith.json` when that file exists (retrieved from the corpus by its author;
  `validate.py` checks status, that `ar` is Arabic only and that `id` carries no Arabic words),
  otherwise `hadith: []`.
- Narration audio beyond the approved sample: only Al-Fatihah ayah 1 and the shared lines are
  rendered ("Narasi"); every other line runs caption-only until the operator approves its render.
  There are no review sign-off records (plan L11).

## Known data issues

- QAC 0.4 lemma spellings carry context marks: `r~aHoma`n`, `r~aHiym`, `m~usotaqiym` start with a
  shaddah (from assimilation), and the Form X verb lemma is `{sotaEiynu` (shown as ٱسْتَعِينُ).
  Shown verbatim; a correction overlay (plan §5.1) would be the place to fix them.
- QAC root counts mix meanings: ر ح م includes arḥām (wombs), ع و ن includes ‘awān (2:68). The
  root-family cards say so instead of implying one meaning.
- quran-align covers every word of 112–114 for Alafasy, one word per segment, no gap over
  1.5 s and no word under 0.2 s. He holds the last word of every An-Nas ayah for 3.8–4.5 s (madd
  at the pause plus the breath) — expected, but it inflates a word-length "madd" display. (The
  issues once listed here for Husary Mu'allim — a 4.1 s gap in 1:7, non-zero matcher statistics
  on 1:1, 1:7, 112:2, 113:2 and 114:6, 347 stray bytes in his 113:5 file — left with his
  recordings, plan L21.)
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
