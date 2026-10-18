#!/usr/bin/env python3
"""Validator for the guided-lesson narration manifests (belajar/content/narration/*.json).

Checks every line the AI narrator may speak, what the caption shows for it, the coverage of the
step-id contract and any rendered audio. Exit 1 on any failure. Standard library only; run from
belajar/pipeline:

    python3 validate_narration.py

What it enforces (README "Narasi" has the reasons):

- Manifest shape (version 2): {version, voice: null | {id, name, model: "eleven_v3"}, lines: {id:
  {text, display, highlight, focus, audio?, tokens?}}}. `text` is the SPOKEN text, exactly what is
  sent to the voice; `display` the caption (dictionary terms in their display form, letters as in
  the ayah); `highlight` the word numbers of the ayah the stage highlights ([0] the whole ayah, []
  none); `focus` the word ("1:1:3") of the large word card, or null.
- Ids follow the contract: "${slug}:${ayah}:${part}" with part in intro | recite | map:new |
  map:again | map:later | map:focus | primer:${k} | w${n} | w${n}:compose:${k} | structure | structure:${k} | concept:${id} |
  ex:${exerciseKey}:${lineKey} | ex:${exerciseKey}:${n}:why | learned | map:total | recap | next | done, and
  "shared:${key}" in shared.json. A line longer than MAX_LINE is split into "<id>:a", "<id>:b", …
  (at least two parts, letters contiguous from a, never next to the unsplit id); a primer or
  compose line is never split (one line per animation frame's sentence), nor a map or learned
  line (one line with its card).
- Coverage: every ayah has intro, recite, the map's opening lines when the surah has a lesson map
  (content/map/<slug>.json: map:new always, map:again when something was learnt before (the
  learnt-so-far line "map:learnt" went 2026-10-17), map:later and map:focus when a step is postponed or a next-level topic is present),
  primer:1…k when
  content/compose/<slug>.json opens the ayah with the harakat primer, one w${n} per word followed
  by w${n}:compose:1…k when the word has a composition (one per `say` of its frames), structure,
  concept:${id} for each step the CURRICULUM teaches in that ayah's lesson and that has a text
  (content/curriculum.json `lessons[].lines`: a whole Konsep record's id, or the id of a step with
  its own text; operator 2026-10-13, plan L26 — until then: each Konsep whose first example was
  in the ayah), ex:${key}:intro for each exercise of the ayah's quiz (content/quiz/<slug>.json,
  build_quiz.py) and ex:${key}:${n}:why for each of its questions (the explanation of the correct
  answer, said after "Benar." / "Ini jawabannya."; operator 2026-10-10), learned and map:total
  when the surah has a lesson map, recap, and next (or done on the last ayah). Nothing else. The lines of the
  WARM-UP (ex:word-kind:…, quiz.OPENING_EXERCISES; operator 2026-10-13: "in every ayat we
  identify first each words fall into which category: ismu, fi'il or harf") stand where the
  lesson says them: after the map's lines and the primer, BEFORE the first word's — and may use
  only the terms of EARLIER lessons (term_order_found). shared.json holds
  SHARED_KEYS plus ex:${key}:${part} for every guide part of every exercise (mirrors
  src/components/exercises/guide.ts).
- The lesson map (operator 2026-10-13, plan L23: "at the beginning we inform what will be learnt,
  in the end recap what we've learnt"; plan L26, the basic curriculum: "separate new vs already
  knows concept, this is what new, this is what we've learnt so far"; lessonmap.py; map_problems
  below): in a surah with content/map/<slug>.json an ayah opens with up to three steps, one per
  group of its card, ONE SENTENCE PER LINE. Since 2026-10-15 (operator: "always re-mention what
  they are") a sentence that counts steps names EVERY one, in teaching order, and the count is the
  number of names: "map:new" says how many steps are NEW and names every one (at most three, the
  curriculum's limit) — they are the steps of that ayah's concept:* lines, in that order, each
  named as its "Konsep baru: …" caption names it. "map:again" names every step learnt so far that comes up again
  in this ayah, standing on its own ("Dari yang sudah kita pelajari, yang kita temui lagi di ayat
  ini adalah …") — or, plainly, that none does. The count of everything learnt so far is said only
  in the closing "map:total" (operator 2026-10-17: "better to remove this line in every ayat
  beginning: 'Sebelum ayat ini, kita sudah mempelajari XX hal, yaitu …'"); a line in that shape
  fails (map_problems).
  "map:later" names every step present here and taught LATER, with the ayah that will teach it,
  and gives the COUNT of the next-level topics: a next-level name is never spoken. "map:focus"
  follows it: what was put aside need not be learnt now (its pronoun by the count: yang satu ini,
  keduanya, ketiganya, semuanya), and what to focus on — the ayah's new steps by name. And nothing
  else: a step named in a group the map does not list it in fails. The "learned" line says what
  was new, by name — or, with nothing new, which learnt steps the ayah repeated — and "map:total"
  the running total with every step learnt by then.
  The map file itself is held to the curriculum (lessonmap.problems). A surah without a map file
  has none of these lines.
- No term before its lesson (decision 7 of the basic curriculum; term_order_problems below,
  build_narration.build_lines): every dictionary term a line of an ayah shows (its caption's
  display forms, each mapped to its authored/library.terms.json id through its Arabic; a term
  with no library term — a letter's name, "Allah", an example word — is free) is owned by a step
  taught in that ayah's lesson or an earlier one, or is free. A term of a later step, or of none
  (the next level), is a violation — unless authored/curriculum.pending.json lists it, and an
  entry there that no longer violates fails as stale. The one exemption: a map:later line names
  the later steps it announces.
- Word composition and the harakat primer (operator 2026-10-10, narration rule 14; compose.py):
  a primer / compose line carries `frame`, the 1-based frame of its animation shown while it
  plays (no other line has one); its caption fits beside the animation on a phone (≤
  compose.MAX_DISPLAY characters); its spoken text never says a syllable the tiles show in
  transliteration (bi, ismu, ismi, ar-raḥmānu… — the narrator says vowel sounds a / i / u,
  letter names and dictionary terms; the imam recites the word), nor one of another
  composition of the same ayah ("hum" of word 4 in word 7), in any spelling; never a letter's
  name read as a sound ("dibaca ba"); a letter term is shown as the frame pins it (`letters`:
  the doubled لِّ of ٱلضَّآلِّينَ) or as its tiles write it (the bare lam of ٱلرَّحْمَٰن, بَ in the
  fathah frame). What its lines say against what its frames show (the first harakah of a word
  with its sound, "bentuk dasar" over a base form, the marks a base / change frame shows) is
  checked on the authored lines by compose.py (validate_compose.py).
- Arabic terms in Latin (latin_terms; rule 1, eleven_v3 mispronounced Latin "na't", "idhafah"):
  a grammar term, morphological pattern, Arabic example word or letter name said in Latin and not
  from the dictionary (mubtada', sukun, fa'il, wazan, mim). A line written to be rendered as it
  stands — a primer / compose line, a composed word's w${n} line — or a line with audio may not
  say one, nor (without audio) a heavy letter + a; any other line that does is held back
  (render_narration.py refuses it) and main() lists it, until the term is in the dictionary or
  the line is reworded.
- The pronunciation dictionary (authored/pronunciation.json, the kamus pelafalan the operator
  approved by ear): every term spoken from Arabic script is spoken as the term itself; a term with a
  heavy letter (ص ض ط ظ ق خ غ) + fathah or alif has a fixed Latin respelling (idhofah, dhommah);
  no term (Arabic, or its Latin caption head) is a word of any lesson surah, nor the front of one
  (a letter's spelled name that is neither said nor shown in Arabic script — alif, said "alif" —
  is not compared); every term carries `approved`: the date of the operator's ear check, or
  "pending-ear-check <date> …" for one added when he waived the pre-render review (2026-10-10),
  which renders and is listed by main() and render_narration.py until it is dated. A named
  Qur'anic word with a heavy letter is not in it: it is never said (named_is_said).
- Spoken text: non-empty, trimmed, at most MAX_LINE characters; Arabic script only as a dictionary
  `speak` value (any other Arabic is an error, a Qur'anic word in Arabic says so); a dictionary
  term's Latin spelling never stays in the spoken text (it is said from the dictionary); "Allah" is
  said "Alloh"; no digits; ASCII letters and . , ; : ! ? ' - only (no brackets, quotes, ellipsis,
  dashes or open prefix: render-ready); no ellipsis ("yang....") and no phrase ending on a bare
  "di" ("kata yang di."): an open fragment cannot be read aloud; no ALL-CAPS word except ACRONYMS;
  "klik", never "ketuk"; meanings with "yang artinya", never "yang berarti"; no "fatwa" and no
  promise of a human review.
- Heavy letters in Latin (heavy_latin): a spoken word with dh zh kh gh sh th q + a (khabar,
  mudhaf, 'athaf, nashab) that the dictionary does not respell may not have audio, and
  render_narration.py refuses to render it: eleven_v3 reads it light (pronunciation rule 2). The
  operator approves a respelling (pronunciation.json) first; main() lists what is waiting.
- No Qur'anic word in any spelling the narrator could voice: the normalised `translit` of every
  word of every lesson surah, plus its i'rab-stripped form (al-ḥamdu → al-ḥamd), its form without
  the article (ṣirāṭ), its space-separated parts (the wa of wa lā) and ALIASES (ism inside bismi).
  Matching is on whole tokens after folding (diacritics and apostrophes dropped, lower case), and a
  token that merely starts with such a form (alhamdulillah, bismillah) fails too. Spelling- and
  ending-blind as well (`sound`, `stem`): Indonesian digraphs (a'udzu, ash-shirath, ghairi,
  adh-dhollin), other case endings (rabbu, rabbil), pausal forms of mabni words (khalaq, hasad), a
  ta marbuta spelled -ah (al-jinnah) and two words run together as recited (huwallahu). Run on the
  spoken text and on the caption, with dictionary terms masked. Exceptions, and only these:
    * in the caption, "Allah" (no case ending) inside “…” (the translation and quoted glosses are
      Indonesian, not Qur'an) or followed by the honorific "subhanahu wa ta'ala"; in the spoken
      text the Name is the dictionary's "Alloh", which the caption must show as one of those;
    * the honorifics HONORIFICS themselves;
    * a surah name right after "Surah" (Surah An-Nas, Surah Al-Falaq);
    * "lam" as the name of the letter, i.e. with "huruf" (or "alif": "alif lam", the article)
      among the four tokens before it.
- Caption (`display`): says what is spoken — replacing its dictionary display forms by their
  `speak` values and normalising for speech gives `text` exactly; Arabic only inside those display
  forms; a letter shown as in the ayah (بِ, or the focus word's own first letter, لَ of lahu), never
  by its spelled-out name (بَاء), and a single letter ALONE, without its Latin name beside it
  ("Contohnya huruf ب ini", never "huruf ba’ (ب)"; operator 2026-10-17 — the article keeps "alif
  lam (ال)"); the same Qur'anic-word guard and word-place rules.
- Word places: a line names a word of its own ayah by its place ("kata kedua"), never more places
  than the ayah has words, never a place in another ayah (it is named by its meaning there), never a
  place inside a place, and never "di kartu ini" (the stage shows no card); a concept's title is
  never turned into a place.
- An earlier ayah (README wording rule 8, refined by the operator 2026-10-18): never a comparison
  ("seperti di ayat pertama", "ayat sebelumnya"); only a dependency, in its two forms — the
  structure part's opening "Ayat ini melanjutkan ayat <N>." and a citation, a named word right
  before "di ayat <N>" in a line that says the dependency — and both as the authored `continues`
  data says (continuation_problems: the opening where the data has it and nowhere else, every link
  said where its `said_in` says, every citation a link of the data, every named word of an earlier
  ayah only cited, a "lanjutan" structure with data).
- What the stage shows (operator review, 2026-10-10): intro, recite, structure and recap highlight
  the whole ayah ([0]); w${n} and w${n}:compose:${k} highlight word n and put it on the word card
  slot (focus; the composition animation takes the card's place); primer:${k} highlights the words
  whose letters its frame shows as they are; a concept
  line highlights the words whose `concepts` list that concept and the words of the ayah's
  structure groups of that concept; the Dengar dan klik intro the whole ayah; every other line
  nothing. Shared lines: [] and null.
- Audio (when present): {url, ms, sha256} of the DELIVERED file (operator 2026-10-11: the
  narration is delivered at 64 kbps mono, DELIVERY_FORMAT; encode_narration.py makes it from the
  128 kbps master render, which stays in pipeline/out and is never served). url =
  /belajar/media/narration/<voice-slug>/<slug>/<file>.mp3 with <file> = delivery_name: the content
  address of the master's request (audio_name: sha256 of the spoken text, voice and settings), the
  delivery format and the sha256 of the delivered bytes. So a line whose text changed can never
  keep old audio, a url with the master's own name fails, and so does a sha256 that is not the one
  the file is named by, or a name made with another format tag: the three are bound together, with
  no audio file needed to check them (CI has none). ms > 0; 64-hex sha256; the manifest names its
  voice. `tokens` (with audio only): [{t, s, e}] in time order within the clip, whose texts joined
  by spaces equal the display rendering of the spoken text (render_display), and never past its
  end: a take whose audio ends more than CUT_TOLERANCE_MS before its last token does was cut short
  by ElevenLabs (operator 2026-10-17: "the voice is cut slightly before the sentence finished").
- The manifests equal a fresh build_narration.py run (no hand edits, no stale lines).
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import compose as COMPOSE
import curriculum as CUR
import lessonmap as LESSONMAP
import quiz as QUIZ
import terms as TERMS
from common import AUTHORED_DIR, BELAJAR, CONTENT_DIR, SURAHS, normalise, num_id, ordinal

NARRATION_DIR = CONTENT_DIR / "narration"
PRONUNCIATION_JSON = AUTHORED_DIR / "pronunciation.json"
GUIDE_TS = BELAJAR / "src" / "components" / "exercises" / "guide.ts"
MEDIA_PREFIX = "/belajar/media/narration/"
MANIFEST_VERSION = 2
MAX_LINE = 400
TTS_MAX = 5000  # eleven_v3 characters per request

# ------------------------------------------------------------------ the voice request (house standard)
# Fixed here, not flags (feedback_voice_render_settings; operator chose mode A, 2026-10-10). The
# content address of every audio file hashes these with the spoken text and the voice id.
MODEL = "eleven_v3"
TTS_LANGUAGE = "id"  # mode A: language_code "id"
VOICE_SETTINGS = {"stability": 0.5, "style": 0.35, "similarity_boost": 0.75, "use_speaker_boost": True}
TEXT_NORMALIZATION = "off"
OUTPUT_FORMAT = "mp3_44100_128"  # the MASTER render (mono), kept in pipeline/out/narration
# What the learner downloads (operator 2026-10-11, "do all three": at 128 kbps the files were twice
# what speech needs, and each line took that much longer to arrive on mobile data). Every master is
# re-encoded once, with fixed flags, by encode_narration.py; the masters are never served.
DELIVERY_FORMAT = "mp3_44100_64_mono"


def request_body(text: str) -> dict:
    """Exactly what is POSTed for one line (no previous_text / next_text: eleven_v3 rejects them)."""
    return {
        "text": text,
        "model_id": MODEL,
        "language_code": TTS_LANGUAGE,
        "voice_settings": dict(VOICE_SETTINGS),
        "apply_text_normalization": TEXT_NORMALIZATION,
    }


def audio_name(text: str, voice_id: str) -> str:
    """The file name (without .mp3) of a line's MASTER render: the first 16 hex of the sha256 of the
    request (text, voice, model, language, settings, output format). Unchanged text → same file,
    never rendered twice; changed text → a new file, never a stale cached one. The master is not
    what is served: see delivery_name."""
    key = {**request_body(text), "voice_id": voice_id, "output_format": OUTPUT_FORMAT}
    return hashlib.sha256(json.dumps(key, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def delivery_name(text: str, voice_id: str, sha256: str, fmt: str = DELIVERY_FORMAT) -> str:
    """The file name (without .mp3) of the audio a line is DELIVERED as, the one in the manifest's
    url: the first 16 hex of the sha256 of the master's name (audio_name: the text, voice and
    settings), the delivery format and the sha256 of the delivered file's bytes. Never the master's
    name. A changed text, another format, or other bytes for the same text (a retake, an encoder
    that writes differently) each give a new name, so no name ever means two files and the server
    may let browsers keep them for good (Cache-Control immutable; operator 2026-10-11)."""
    key = {"master": audio_name(text, voice_id), "delivery_format": fmt, "sha256": sha256}
    return hashlib.sha256(json.dumps(key, sort_keys=True).encode("utf-8")).hexdigest()[:16]


def master_url(voice: dict, slug: str, text: str) -> str:
    """Where a line's master would be served from, were it served (it is not): the url the
    manifests carried until 2026-10-11, and the master's path under pipeline/out/narration."""
    return f"{MEDIA_PREFIX}{slugify(voice['name'])}/{slug}/{audio_name(text, voice['id'])}.mp3"


def delivery_url(voice: dict, slug: str, text: str, sha256: str) -> str:
    """The url of a line's delivered file (`sha256` of that file's bytes)."""
    return f"{MEDIA_PREFIX}{slugify(voice['name'])}/{slug}/{delivery_name(text, voice['id'], sha256)}.mp3"


# ------------------------------------------------------------------ the exercises (mirrors the app)
EXERCISE_KEYS = QUIZ.EXERCISE_KEYS
# The exercises a lesson asks before its words (the warm-up: quiz.OPENING_EXERCISES); the others
# follow the structure.
OPENING_EXERCISES = QUIZ.OPENING_EXERCISES
# src/components/exercises/guide.ts EXERCISE_GUIDE_PARTS (checked against the file when it exists).
EXERCISE_GUIDE_PARTS: dict[str, tuple[str, ...]] = {
    "word-kind": ("options", "reveal", "next"),
    "tap-word": ("play", "options", "reveal", "next"),
    "why-harakat": ("options", "reveal", "next"),
    "sort-case": ("words", "bins", "reveal"),
    "label-role": ("options", "reveal", "next"),
    "wazn-factory": ("options", "reveal", "next"),
}
# Which exercises an ayah shows, and their questions: content/quiz/<slug>.json (quiz.py; the
# timed words and the case states the components used to count with live there since 2026-10-11).

# Generic lines, shared by every lesson (shared.json, "shared:${key}"). The exercise prompts
# "shared:ex:${key}:${part}" are added from EXERCISE_GUIDE_PARTS.
# No "try_again" since 2026-10-11: a wrong pick is not voiced (operator 2026-10-10: "give
# narration/voice only for the correct answer").
SHARED_KEYS = ("start", "resume", "correct", "revealed", "reminder", "skip_offer", "surah_done")
ACRONYMS = {"AI"}
HONORIFICS = ("subhanahu wa ta'ala", "shallallahu 'alaihi wa sallam")


def load_quiz() -> dict[str, dict]:
    """content/quiz/<slug>.json of every lesson surah (build_quiz.py): the exercises each ayah
    shows and their questions, the one plan the page, the engine and the narration all read."""
    return QUIZ.load_all_content()


def load_map() -> dict[str, dict]:
    """content/map/<slug>.json of every lesson surah that has one (build_map.py, lessonmap.py): the
    lesson map — per ayah, the steps that are new, learnt so far or taught later, and the
    next-level topics (plan L23, L26). A surah without one has no map / learned line."""
    return LESSONMAP.load_all_content()


def load_curriculum() -> dict:
    """content/curriculum.json (build_curriculum.py, curriculum.py): where each step is taught —
    the "Konsep baru" lines of every lesson, and who owns each term."""
    content = CUR.load_content()
    if content is None:
        raise SystemExit("content/curriculum.json is missing: run build_curriculum.py first")
    return content


def _quiz_of(ayah: dict, quiz: dict[str, dict] | None) -> dict | None:
    surah = int(str(ayah["loc"]).split(":")[0])
    slug = next((sp.slug for sp in SURAHS if sp.surah == surah), None)
    return (load_quiz() if quiz is None else quiz).get(slug or "")


def exercise_counts(ayah: dict, library: dict, quiz: dict[str, dict] | None = None) -> dict[str, int]:
    """Questions each exercise asks on this ayah (content/quiz, default from disk); an exercise the
    page does not show is left out. `library` is unused since the plan moved to content/quiz."""
    return QUIZ.question_counts(_quiz_of(ayah, quiz), ayah["ayah"])


def taught_lines(ayah: dict, curriculum: dict | None) -> list[dict]:
    """The "Konsep baru" lines the lesson of this ayah says, in order: [{line: "concept:<id>",
    step, words}] — the steps the curriculum teaches there that have a text (content/curriculum.json
    `lessons[].lines`; src/lib/curriculum.ts taughtIn). Until 2026-10-13: the Konsep records whose
    FIRST example was in the ayah."""
    surah, n = (int(x) for x in str(ayah["loc"]).split(":")[:2])
    return CUR.lesson_lines(curriculum, surah, n)


def primer_of(compose: dict | None, ayah: int) -> dict | None:
    """The harakat primer this lesson plays, if any (content/compose/<slug>.json): the primer of
    the lesson of its own `ayah` — or, when it says `lesson: "0"`, of lesson zero ("ayah 0":
    lesson_zero) and of no ayah's lesson."""
    p = (compose or {}).get("primer")
    if not isinstance(p, dict):
        return None
    plays = CUR.ZERO_AYAH if p.get("lesson") == CUR.LESSON_ZERO else p.get("ayah")
    return p if plays == ayah else None


def lesson_zero(lesson: dict | None, compose: dict | None) -> dict | None:
    """LESSON ZERO, as the narration sees it (decision 1 of kurikulum-dasar.md: "A 'lesson zero'
    with no ayah opens the course. It teaches harakat and the three kinds of word (kalimah: isim,
    fi'il, huruf), so ayah 1 is lighter. The harakat primer and kalimah move out of 1:1 into
    lesson zero."): a pseudo-ayah with number 0 and no word, of the surah whose harakat primer
    is played there (primer.lesson == "0"), or None for every other surah.

    Its lines are "<slug>:0:<part>" in that surah's own manifest: intro, primer:1 … primer:n, the
    "Konsep baru" line of each step the curriculum teaches in lesson "0" that has one (the
    kalimah record), next. In the surah's manifest and not one of their own, so that a primer
    line that moved there with its text unchanged keeps its recorded file (a file is named by
    its text and lives in its manifest's folder)."""
    if not lesson or primer_of(compose, CUR.ZERO_AYAH) is None:
        return None
    return {"ayah": CUR.ZERO_AYAH, "loc": f"{lesson['surah']}:{CUR.ZERO_AYAH}", "words": [], "zero": True}


def lesson_ayat(lesson: dict | None, compose: dict | None) -> list[dict]:
    """The lessons a surah's manifest narrates, in order: lesson zero when this surah hosts it,
    then its ayat."""
    zero = lesson_zero(lesson, compose)
    return ([zero] if zero else []) + list((lesson or {}).get("ayat") or [])


def zero_parts(zero: dict, compose: dict | None, curriculum: dict | None) -> list[str]:
    """The parts of lesson zero's narration, in order: intro, the primer, and for each step it
    teaches its slide before the "Konsep baru" line ("<line>:lead", the step's `lead`: kalimah is
    not the Indonesian kalimat, operator 2026-10-15), the line, then one line per example its card
    shows ("<line>:ex:<k>", the step's `examples`: the narrator explains each, operator
    2026-10-15) — and next."""
    p = primer_of(compose, CUR.ZERO_AYAH) or {}
    taught: list[str] = []
    for t in taught_lines(zero, curriculum):
        step = CUR.step_of(curriculum, t["step"]) or {}
        taught += CUR.zero_line_parts(step, t["line"])
    return ["intro"] + [f"primer:{k}" for k in range(1, len(p.get("lines") or []) + 1)] + taught + ["next"]


def composition_of(compose: dict | None, loc: str) -> dict | None:
    c = ((compose or {}).get("words") or {}).get(loc)
    return c if isinstance(c, dict) else None


def map_opening_parts(entry: dict | None) -> list[str]:
    """The opening lines an ayah's map entry has, in order: what is new always; what was learnt so
    far, then what of it comes up again here, when something was; what is postponed or
    next-level, then the reassurance that goes with it, when there is any. (One sentence per line
    since 2026-10-15: every step is named, and a list of sixteen is a line of its own.)"""
    if entry is None:
        return []
    return (["map:new"] + (["map:again"] if entry.get("learnt") else [])
            + (["map:later", "map:focus"] if entry.get("later") or entry.get("lanjut") else []))


def map_closing_parts(entry: dict | None) -> list[str]:
    """The closing lines an ayah's map entry has: what the ayah taught, then the running total
    with every step learnt so far."""
    return [] if entry is None else ["learned", "map:total"]


def expected_parts(lesson: dict, library: dict, compose: dict | None = None,
                   quiz: dict | None = None, lessonmap: dict | None = None,
                   curriculum: dict | None = None) -> dict[int, list[str]]:
    """Part names each ayah's narration must have, in lesson order. `compose`: the surah's
    content/compose/<slug>.json (the primer and the word compositions), or None; `quiz`: its
    content/quiz/<slug>.json (default: from disk); `lessonmap`: its content/map/<slug>.json (the
    lesson map, plan L23), or None: then no map / learned part; `curriculum`:
    content/curriculum.json (default: from disk), which says which concept lines an ayah has."""
    quiz = quiz if quiz is not None else QUIZ.load_content(lesson["slug"])
    curriculum = load_curriculum() if curriculum is None else curriculum
    out: dict[int, list[str]] = {}
    zero = lesson_zero(lesson, compose)
    if zero:
        out[CUR.ZERO_AYAH] = zero_parts(zero, compose, curriculum)
    last = lesson["ayat"][-1]["ayah"]
    for a in lesson["ayat"]:
        entry = LESSONMAP.ayah_entry(lessonmap, a["ayah"])
        parts = ["intro", "recite"] + map_opening_parts(entry)
        p = primer_of(compose, a["ayah"])
        if p:
            parts += [f"primer:{k}" for k in range(1, len(p.get("lines") or []) + 1)]
        # The warm-up (operator 2026-10-13: "in every ayat we identify first each words fall into
        # which category"): asked before the first word, after what the ayah brings.
        plan = QUIZ.ayah_plan(quiz, a["ayah"])
        for ex in plan:
            if ex["key"] in OPENING_EXERCISES:
                parts += [f"ex:{ex['key']}:intro"] + [f"ex:{ex['key']}:{q['n']}:why" for q in ex["questions"]]
        for i, w in enumerate(a["words"], 1):
            parts.append(f"w{i}")
            c = composition_of(compose, w["loc"])
            if c:
                parts += [f"w{i}:compose:{k}" for k in range(1, len(c.get("lines") or []) + 1)]
        parts += [t["line"] for t in taught_lines(a, curriculum)]
        parts += structure_parts(a)
        for ex in plan:
            if ex["key"] not in OPENING_EXERCISES:
                parts += [f"ex:{ex['key']}:intro"] + [f"ex:{ex['key']}:{q['n']}:why" for q in ex["questions"]]
        parts += map_closing_parts(entry) + ["recap", "done" if a["ayah"] == last else "next"]
        out[a["ayah"]] = parts
    return out


def expected_shared() -> list[str]:
    return list(SHARED_KEYS) + [f"ex:{k}:{p}" for k in EXERCISE_KEYS for p in EXERCISE_GUIDE_PARTS[k]]


WHOLE_AYAH = [0]

# ------------------------------------------------------------------ the lesson map's lines
# Operator 2026-10-13 (plan L23): an ayah opens by saying what it brings (right after the imam's
# recitation) and closes by saying what it taught ("learned", right before the recap). Since the
# basic curriculum (plan L26: "separate new vs already knows concept, this is what new, this is
# what we've learnt so far") the opening is one step per group of the card — "map:new",
# "map:learnt", "map:later" — and the card shows that one group while its lines are said.
# Operator 2026-10-15: every sentence that COUNTS steps also NAMES every one of them, in teaching
# order ("Dengan itu, sudah empat hal yang kita pelajari, yaitu A, B, C, D" — "similar sentences
# should follow this pattern, always re-mention what they are"; no "di antaranya" any more), and
# what is put aside is followed by a reassurance ("Sekarang Anda tidak perlu menghafal ketiganya,
# mari kita fokus pada pelajaran XXX dan YYY terlebih dahulu"). A full list of sixteen steps is a
# line of its own, so each such sentence is its own line (never split, each ≤ MAX_LINE): the
# learnt step says "map:again" (what of what was learnt comes up here; until 2026-10-17 after
# "map:learnt", the count of everything learnt so far, which the operator removed), the later step
# "map:later" then "map:focus" (the reassurance), the closing step "learned" then "map:total"
# (the running total, every step named). build_narration.map_new / map_again /
# map_later / map_focus / map_closing / map_total write the lines; map_problems below reads them
# back against content/map.
MAP_OPENING = ("map:new", "map:again", "map:later", "map:focus")
MAP_CLOSING = ("learned", "map:total")
MAP_PARTS = (*MAP_OPENING, *MAP_CLOSING)
# The pronoun the reassurance uses for what the line before it put aside (operator 2026-10-15:
# "ketiganya / keduanya / semuanya to match the count … 1: yang satu ini").
FOCUS_PRONOUN = {1: "yang satu ini", 2: "keduanya", 3: "ketiganya"}
FOCUS_ALL = "semuanya"


def focus_pronoun(n: int) -> str:
    """The reassurance's word for `n` things set aside: yang satu ini, keduanya, ketiganya, semuanya."""
    return FOCUS_PRONOUN.get(n, FOCUS_ALL)


COMPOSE_PART = re.compile(r"w([1-9]\d*):compose:([1-9]\d*)")
PRIMER_PART = re.compile(r"primer:([1-9]\d*)")
# The sentence structure told as SEPARATE items (operator 2026-10-13: "can we make this kind of
# explanation in items: harfjar in one item, idhafah in next item etc, it's kind of confusing
# which for which in this paragraph"): an ayah whose `structure` has `items` gets one line per
# item, "structure:1" … "structure:n", INSTEAD of the one "structure" line built from its summary.
# Each lights its item's words; the first opens with STRUCTURE_LEAD; none is ever split (one item,
# one line, one step that "Ulangi" replays).
STRUCTURE_ITEM = re.compile(r"structure:([1-9]\d*)")
STRUCTURE_LEAD = "Sekarang susunan kalimatnya."


def structure_items(ayah: dict | None) -> list[dict]:
    """The narrated items of an ayah's structure ([{words, say}]); [] for an ayah told from its
    summary (or with no structure at all)."""
    items = ((ayah or {}).get("structure") or {}).get("items")
    return list(items) if isinstance(items, list) else []


def structure_parts(ayah: dict) -> list[str]:
    """The structure lines of an ayah: one per item, or the one line of its summary, or none."""
    items = structure_items(ayah)
    if items:
        return [f"structure:{k}" for k in range(1, len(items) + 1)]
    return ["structure"] if ayah.get("structure") else []


def line_frame(ayah: dict | None, part: str, compose: dict | None) -> int | None:
    """The animation frame (1-based) a primer / compose line plays over; None for other lines."""
    if ayah is None:
        return None
    m = COMPOSE_PART.fullmatch(part)
    if m:
        n, k = int(m.group(1)), int(m.group(2))
        c = composition_of(compose, ayah["words"][n - 1]["loc"]) if n <= len(ayah["words"]) else None
    else:
        m = PRIMER_PART.fullmatch(part)
        if not m:
            return None
        k = int(m.group(1))
        c = primer_of(compose, ayah["ayah"])
    lines = (c or {}).get("lines") or []
    return lines[k - 1]["frame"] if 0 < k <= len(lines) else None


def frame_tiles(ayah: dict | None, part: str, compose: dict | None) -> list[str]:
    """The Arabic of the tiles a primer / compose line's frame shows (pipeline bytes)."""
    k = line_frame(ayah, part, compose)
    if k is None:
        return []
    m = COMPOSE_PART.fullmatch(part)
    c = composition_of(compose, ayah["words"][int(m.group(1)) - 1]["loc"]) if m else primer_of(compose, ayah["ayah"])
    fr = c["frames"][k - 1]
    names = list(fr.get("tiles") or []) + [x for x in ([fr["from"]] if isinstance(fr.get("from"), str) else fr.get("from") or [])]
    return [c["forms"][x]["ar"] for x in names if x in c["forms"]]


def frame_pins(ayah: dict | None, part: str, compose: dict | None) -> list[str]:
    """The pieces a frame pins for its letter terms (`letters`: [form, piece]; the doubled لِّ in
    the middle of ٱلضَّآلِّينَ, not the article's bare lam), searched before its tiles."""
    k = line_frame(ayah, part, compose)
    if k is None:
        return []
    m = COMPOSE_PART.fullmatch(part)
    c = composition_of(compose, ayah["words"][int(m.group(1)) - 1]["loc"]) if m else primer_of(compose, ayah["ayah"])
    out = []
    for name, i in c["frames"][k - 1].get("letters") or []:
        ps = COMPOSE.pieces(c["forms"][name]["ar"]) if name in c["forms"] else []
        if -len(ps) <= i < len(ps):
            out.append(ps[i])
    return out


def concept_letters(library: dict | None, part: str) -> tuple[str, ...]:
    """The Arabic a concept's own title and summary write (library bytes): the root letters ف ع ل
    of the wazan concept, which its line names "fa', 'ain, dan lam" and shows as written there."""
    if not library or not part.startswith("concept:"):
        return ()
    c = next((x for x in library.get("concepts") or [] if x.get("id") == part.split(":", 1)[1]), None)
    return tuple(ARABIC_WORD.findall(f"{(c or {}).get('title', '')} {(c or {}).get('summary', '')}"))


def line_letters(ayah: dict | None, part: str, focus: str | None, forms: "Forms", compose: dict | None,
                 library: dict | None = None):
    """Where a caption takes the shape of a letter term it shows (rule 7: the letter as on
    screen): for a primer / compose line, the pieces the frame pins, then its tiles' (a tuple,
    searched letter by letter: the bare lam of ٱلرَّحْمَٰن); for a concept line, the Arabic its
    summary writes (concept_letters; else the dictionary's letter); otherwise the focus word (its
    first letter)."""
    tiles = frame_tiles(ayah, part, compose)
    if tiles:
        return tuple(frame_pins(ayah, part, compose) + tiles + ([forms.word_ar[focus]] if focus in forms.word_ar else []))
    own = concept_letters(library, part)
    if own:
        return own
    return forms.word_ar.get(focus) if focus else None


def line_view(ayah: dict | None, part: str, compose: dict | None = None,
              curriculum: dict | None = None) -> tuple[list[int], str | None]:
    """(highlight, focus) of a line (operator review of the Al-Fatihah 1 preview, 2026-10-10): the
    whole ayah ([0]) while it is introduced, recited, analysed or recited again; word n, on the word
    card too, while it is explained; the words a step occurs on while that step is taught (the
    curriculum's `lines[].words`: the words tagged with a whole record and those of its structure
    groups, the majrur words for the step majrur, the words with alif lam for alif lam); the whole
    ayah while Dengar dan klik is announced; nothing otherwise. `curriculum`:
    content/curriculum.json; without it, or for a concept line the lesson does not have, the
    record's own words (concept_words)."""
    if ayah is None:
        return [], None
    if ayah.get("zero") and not PRIMER_PART.fullmatch(part):
        return [], None  # lesson zero: no ayah, so nothing to light and no word card
    if part in ("intro", "recite", "structure", "recap", "ex:tap-word:intro", f"ex:{QUIZ.WARMUP}:intro"):
        return list(WHOLE_AYAH), None
    m = re.fullmatch(r"w([1-9]\d*)(?::compose:[1-9]\d*)?", part)
    if m:
        n = int(m.group(1))
        return [n], ayah["words"][n - 1]["loc"] if n <= len(ayah["words"]) else None
    if PRIMER_PART.fullmatch(part):
        k = line_frame(ayah, part, compose)
        p = primer_of(compose, ayah["ayah"])
        # In lesson zero there is no ayah on the stage to light a word of (the frames show the
        # letters themselves).
        return (list(p["frames"][k - 1].get("words") or []) if p and k and not ayah.get("zero") else []), None
    if part.startswith("concept:"):
        own = next((t for t in (taught_lines(ayah, curriculum) if curriculum else []) if t["line"] == part), None)
        return (list(own["words"]) if own else concept_words(ayah, part.split(":", 1)[1])), None
    m = STRUCTURE_ITEM.fullmatch(part)
    if m:
        # The words the item is about, and no word card: the item is about how they fit together.
        items = structure_items(ayah)
        k = int(m.group(1))
        return (list(items[k - 1]["words"]) if k <= len(items) else []), None
    return [], None


def concept_words(ayah: dict, cid: str) -> list[int]:
    """The words a concept line highlights: those whose `concepts` list it, and every word of the
    ayah's structure groups named after it (the idhafah of bismi + Allāhi is [1, 2] although only
    Allāhi is tagged). Mirrors kindHighlight in src/lib/autoplay/sequence.ts."""
    n = len(ayah["words"])
    out = {i for i, w in enumerate(ayah["words"], 1) if cid in (w.get("concepts") or [])}
    for g in (ayah.get("structure") or {}).get("groups") or []:
        if g.get("concept") == cid:
            out |= {x for x in g.get("words") or [] if isinstance(x, int) and 1 <= x <= n}
    return sorted(out)


# ------------------------------------------------------------------ text folding and tokens
APOS = "'‘’ʼʿʾ`´"
_APOS = re.compile(f"[{APOS}]")
TOKEN = re.compile(f"[{APOS}]?[^\\W\\d_]+(?:[{APOS}][^\\W\\d_]+)*[{APOS}]?")
ARABIC = re.compile("[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
AR_MARKS = "ً-ٰٟۖ-ۭ"
EXTRA_CHARS = set("“”—–…")  # “ ” — – …
SPOKEN_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,;:!?'-")


def fold(s: str) -> str:
    """Drop combining marks (ā→a, ḥ→h, ż→z) and turn every apostrophe-like mark into '."""
    d = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return unicodedata.normalize("NFC", _APOS.sub("'", d))


def key(token: str) -> str:
    return fold(token).replace("'", "").lower()


def tokens(text: str) -> list[tuple[str, int, int, str]]:
    """(key, start, end, original) for every word token; apostrophes stay inside a token
    (fi'il, na‘budu, mubtada'), hyphens and spaces separate tokens (al-ḥamdu = al + hamdu)."""
    return [(key(m.group()), m.start(), m.end(), m.group()) for m in TOKEN.finditer(text)]


def keys_of(s: str) -> tuple[str, ...]:
    return tuple(t[0] for t in tokens(s))


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", fold(name).lower()).strip("-")
    return s or "voice"


def ar_skeleton(s: str) -> str:
    """Arabic letters only, for comparing a term with the lesson words: harakat, Qur'anic marks and
    tatweel dropped, alif forms (and the dagger alif) → ا, alif maqsura → ي, ta marbuta → ه."""
    return normalise(s).replace("ى", "ي").replace("ة", "ه").replace(" ", "")


def first_letter(ar: str) -> str | None:
    """The first letter of an Arabic word with its own harakat, as the ayah shows it (بِ of bismi,
    لَ of lahu)."""
    m = re.match("([ء-يٱ])([ً-ْ]*)", ar)
    return m.group(1) + m.group(2) if m else None


# ------------------------------------------------------------------ Qur'anic word forms
ARTICLES = {"al", "ar", "ad", "as", "an", "at", "az", "asy"}
TANWIN = {"dhammatain", "fathatain", "kasratain"}
I_RAB_STATES = {"marfu", "manshub", "majrur"}
# Prose names some words by a piece of the token (the noun inside a prefixed word, the verb without
# its pronoun suffix). Each alias is a "part" of that word, so the narration maps it like one.
ALIASES: dict[str, tuple[str, ...]] = {
    "1:1:1": ("ism", "ismi"),            # bismi = bi- + ismi
    "1:2:2": ("Allāh", "Allāhi"),        # lillāhi = li- + (al)lāhi
    "1:6:1": ("ihdi",),                  # ihdinā = ihdi + -nā
    "1:7:4": ("‘alā",),                  # ‘alaihim = ‘alā + -him (the preposition, named in the prose)
    "1:7:7": ("‘alā",),
    "113:1:3": ("rabb", "rabbi"),        # birabbi = bi- + rabbi
    "114:1:3": ("rabb", "rabbi"),
    "114:5:2": ("waswasa",),             # the past form named beside yuwaswisu ("waswasa–yuwaswisu")
    "114:6:1": ("min",),                 # mina = min with a linking fathah
}


def _strip_ending(k: tuple[str, ...], sign: str) -> tuple[str, ...] | None:
    last = k[-1]
    if sign in TANWIN and last[-2:] in ("un", "an", "in") and len(last) - 2 >= 3:
        return k[:-1] + (last[:-2],)
    if last[-1:] in ("a", "i", "u") and len(last) - 1 >= 3:
        return k[:-1] + (last[:-1],)
    return None


# ------------------------------------------------------------------ spelling-blind variants
# The narrator's script is Indonesian, and Indonesian spells Arabic its own way: a‘ūżu is
# "a'udzu", aṣ-ṣirāṭa "ash-shirath", gairi "ghairi", aḍ-ḍāllīna "adh-dhollin". `sound` maps both
# the lesson transliteration (already folded: ż→z, ṣ→s, ḍ→d, ṭ→t, ṡ→s) and every narration token
# onto one spelling, so those variants are caught too. Doubled letters are NOT collapsed: the
# grammar term 'illah ("huruf 'illah") would then read as ilāh, and both spellings keep the shadda.
_DIGRAPH = re.compile(r"sy|sh|ts|dz|dh|zh|th|gh|kh")
_DIGRAPH_TO = {"sy": "s", "sh": "s", "ts": "s", "dz": "z", "dh": "d", "zh": "z", "th": "t", "gh": "g", "kh": "h"}


def sound(k: str) -> str:
    """A folded token (key()) in one spelling: Indonesian digraphs → the folded letter, o → a."""
    return _DIGRAPH.sub(lambda m: _DIGRAPH_TO[m.group()], k).replace("o", "a")


_CONSONANT_NOT_H = "bcdfgjklmnpqrstvwxyz"


def spellings(k: str) -> list[str]:
    """A folded token as written and in the other Indonesian spellings of the same sounds: a long
    vowel doubled (maaliki, mustaqiim, dholliin), and the ‘ain written k before a consonant
    (nakbudu, ankamta) or ng between vowels (nastangin)."""
    ain = re.sub(rf"k(?=[{_CONSONANT_NOT_H}])", "", k)
    ain = re.sub(r"(?<=[aiueo])ng(?=[aiueo])", "", ain)
    out = [k]
    for v in (re.sub(r"([aiueo])\1+", r"\1", k), ain, re.sub(r"([aiueo])\1+", r"\1", ain)):
        if v not in out:
            out.append(v)
    return out


def stem(k: str, min_len: int = 3) -> str | None:
    """A token without its case ending: a final short vowel (rabbu, rabba → rabb), tanwin
    (aḥadan → aḥad) or a joined article vowel (rabbil, rabbul → rabb); None when too short."""
    for end, need in (("un", 3), ("an", 3), ("in", 3), ("il", 4), ("ul", 4), ("al", 4), ("a", 3), ("i", 3), ("u", 3)):
        if k.endswith(end) and len(k) - len(end) >= max(need, min_len):
            return k[: -len(end)]
    return None


_PROCLITICS = "وفبلك"


class Forms:
    """Every spelling of a lesson word the narrator must not voice, mapped to the words it names.

    forms[key tuple] = [((surah, ayah, word), kind), …], kind "full" (the word itself, with or
    without its i'rab ending or article) or "part" (a piece of a multi-word token or an alias).
    `arabic`: every lesson word's Arabic skeleton, also without a one-letter proclitic and the
    article, for the Arabic check (`quranic_arabic`). `word_ar`: each word's Arabic by its loc."""

    def __init__(self, lessons: dict[str, dict]):
        self.forms: dict[tuple[str, ...], list[tuple[tuple[int, int, int], str]]] = {}
        self.translit: dict[tuple[int, int, int], str] = {}
        self.word_ar: dict[str, str] = {}
        self.arabic: set[str] = set()
        self.surah_names = {key(sp.name_id) for sp in SURAHS}
        self.surah_name_keys = {keys_of(sp.name_id) for sp in SURAHS}
        self.stems: set[str] = set()
        self.extra: set[str] = set()
        for sp in SURAHS:
            lesson = lessons.get(sp.slug)
            if not lesson:
                continue
            for a in lesson["ayat"]:
                for w in a["words"]:
                    s, ay, wi = (int(x) for x in w["loc"].split(":"))
                    loc = (s, ay, wi)
                    self.translit[loc] = w["translit"]
                    self.word_ar[w["loc"]] = w["ar"]
                    for piece in w["ar"].split():
                        sk = ar_skeleton(piece)
                        variants = {sk}
                        if len(sk) > 2 and sk[0] in _PROCLITICS:
                            variants.add(sk[1:])
                        for v in list(variants):
                            if v.startswith("ال") and len(v) > 3:
                                variants.add(v[2:])
                        self.arabic |= {v for v in variants if len(v) >= 2}
                    graded = w["case"]["state"] in I_RAB_STATES
                    sign = w["case"]["sign"]
                    full = keys_of(w["translit"])
                    self._add(full, loc, "full")
                    stripped = _strip_ending(full, sign) if graded else None
                    if stripped:
                        self._add(stripped, loc, "full")
                    for base in (full, stripped):
                        if base and len(base) >= 2 and base[0] in ARTICLES and len("".join(base[1:])) >= 4:
                            self._add(base[1:], loc, "full")
                    parts = w["translit"].split(" ")
                    if len(parts) > 1:
                        for p in parts:
                            pk = keys_of(p)
                            self._add(pk, loc, "part")
                            if len(pk) >= 2 and pk[0] in ARTICLES and len("".join(pk[1:])) >= 4:
                                self._add(pk[1:], loc, "part")
                    for alias in ALIASES.get(w["loc"], ()):
                        self._add(keys_of(alias), loc, "part")
                    # Validator-only spellings (never used to rewrite prose): every part of the
                    # word without its last vowel — mabni words too, as they are recited at a
                    # pause (khalaqa → khalaq, ḥasada → ḥasad) — and a ta marbuta in its pausal
                    # Indonesian spelling (al-jinnati → al-jinnah; not a long -āti plural).
                    for p in [*parts, *ALIASES.get(w["loc"], ())]:
                        pk = keys_of(p)
                        if not pk:
                            continue
                        last = pk[-1]
                        st = stem(last)
                        if st:
                            self.stems.add(sound(st))
                        # "at" + vowel with a SHORT a (NFC: ā is one character, never "a").
                        if re.search(r"at[aiu]n?$", unicodedata.normalize("NFC", p)) and len(last) >= 5:
                            self.extra.add(sound(re.sub(r"at[aiu]n?$", "ah", last)))
        self.maxlen = max((len(k) for k in self.forms), default=1)
        self.joined = {"".join(k) for k in self.forms if len("".join(k)) >= 5}
        # Spelling-blind single tokens and prefixes (sound()): every form's last token, alone and
        # without its article.
        self.sound_forms = {sound(k[-1]) for k in self.forms if len(k[-1]) >= 3} | self.extra
        self.sound_joined = {sound(j) for j in self.joined}
        # Two words run together as they are recited, the hamzat wasl of the second dropped
        # (huwa + allāhu → "huwallahu", bismi + allāhi → "bismillahi"): flagged as a prefix.
        self.wasl: set[str] = set()
        for sp in SURAHS:
            for a in (lessons.get(sp.slug) or {}).get("ayat", []):
                ks = ["".join(keys_of(w["translit"])) for w in a["words"]]
                for x, y in zip(ks, ks[1:]):
                    if y.startswith("a") and len(x) >= 2:
                        self.wasl.add(sound(x + y[1:]))

    def _add(self, k: tuple[str, ...], loc, kind: str) -> None:
        if not k:
            return
        lst = self.forms.setdefault(k, [])
        if (loc, kind) not in lst:
            lst.append((loc, kind))

    def quranic_arabic(self, word: str) -> bool:
        """An Arabic word (or run) that is a lesson word, one without its proclitic or article, or
        the front (3+ letters) of one: على is the front of عليهم (1:7:4)."""
        sk = ar_skeleton(word)
        if len(sk) < 2:
            return False
        return sk in self.arabic or (len(sk) >= 3 and any(a.startswith(sk) for a in self.arabic))

    def mentions(self, text: str):
        """Longest-first matches of a form, left to right: (start, end, key, candidates, i, n)."""
        toks = tokens(text)
        out = []
        i = 0
        while i < len(toks):
            hit = None
            for n in range(min(self.maxlen, len(toks) - i), 0, -1):
                k = tuple(t[0] for t in toks[i:i + n])
                if k in self.forms and all(
                    text[toks[j][2]:toks[j + 1][1]] in (" ", "-") for j in range(i, i + n - 1)
                ):
                    hit = n
                    break
            if hit:
                out.append((toks[i][1], toks[i + hit - 1][2], tuple(t[0] for t in toks[i:i + hit]),
                            self.forms[tuple(t[0] for t in toks[i:i + hit])], i, hit))
                i += hit
            else:
                i += 1
        return out, toks


# ------------------------------------------------------------------ named words (operator 2026-10-17)
# An explanation may NAME the word or the part of a word it explains, with the word itself: "Kata
# pertama diawali huruf jar, yaitu بِ (bi) yang artinya “dengan”, sehingga isim sesudahnya, yaitu
# ٱسْمِ (ismi) …" (operator, on Al-Fatihah 1: "make the sentence clear with examples"; "it's better to
# say bi instead of ba, and only show the arabic one"; "should also mention the arabic word not only
# artinya"). The ONE exception to "the narrator never voices a Qur'anic word" (plan §6.1 A1), and
# a narrow one:
#   - only where narration was written to name it: the markup {{s:a:w}} (a lesson word) or
#     {{s:a:w/form}} (a named form of that word's composition, content/compose: بِ, ٱسْمِ, بِٱسْمِ …)
#     in an authored `say` / `lead` / `why_basic` or a PRE_REWRITE, and the sanitiser's name for a
#     word of another ayah ("kata ٱللَّهِ (Allāhi), yang artinya …"); never found in or typed into prose;
#   - the caption shows the content's own bytes and the transliteration, "<Arabic> (<translit>)", and
#     it must be one of those pairs (check_display with `named`); Arabic SCRIPT of a Qur'anic word in
#     the spoken text stays forbidden;
#   - the spoken text says the transliteration (named_speech) exactly where the caption names it
#     (check_spoken `named_said`) — and nowhere else: every other mention is still a fault;
#   - a word with a heavy (tafkhim) letter, ص ض ط ظ ق خ غ (rule 9), is NEVER said (operator
#     2026-10-17: "better not to use heavy-letter words with elevenlabs, we just explain but not read
#     them; simple words so far is ok"): its caption still names it, the spoken text leaves it out and
#     reads on without it ("Kata pertama, yaitu صِرَٰطَ (ṣirāṭa), artinya: “jalan”" is said "Kata
#     pertama artinya: jalan"). Its markup says so, {{!s:a:w}} / {{!s:a:w/form}} — and must, both
#     ways (named_is_said decides, from the word's Arabic letters: the one rule, mirrored by the TS
#     namedIsSaid); a simple word whose plain spelling the heavy-letter guard would still refuse
#     (HEAVY_LATIN) counts as heavy. What is left out and where: UNSAID (unsay).
NAMED_REF = re.compile(r"\{\{!?(\d{1,3}:\d{1,3}:\d{1,3})(?:/([^{}\s/]+))?\}\}")
_NAMED_AR = "ء-ۓە-ۭ"
NAMED_SHOWN = re.compile(rf"(?<![؀-ۿ])(?P<ar>[{_NAMED_AR}]+) \((?P<lat>[^()؀-ۿ]+)\)")
# The heavy (tafkhim) letters of rule 9: a Qur'anic word with one is shown, never said.
TAFKHIM = "صضطظقخغ"
_NAMED_RESPELL = {"ṣ": "sh", "ḍ": "dh", "ṭ": "th", "ẓ": "zh", "ż": "dz", "ṡ": "ts",
                  "‘": "'", "ʿ": "'", "g": "gh", "ḫ": "kh"}


# What a later ayah teaches, worded the old way ("Ini kita pelajari di ayat ketiga", "baru kita bahas
# nanti"); "sudah kita pelajari di ayat pertama" (past) and "di ayat ini" are not that.
LATER_WORDING = re.compile(r"(?<!sudah )\bkita (?:pelajari|bahas) (?:di ayat (?!ini\b)|nanti\b)")
# A grammatical estimate said in jargon (operator 2026-10-15: "memperkirakan … your sentence is confusing").
ESTIMATE_WORDING = re.compile(r"\b(?:memperkirakan\w*|diperkirakan|menafsirkan\w*|ditafsirkan)\b", re.I)
# "kata yang artinya …", "huruf yang artinya …": a word or a part named only by what it means.
MEANING_ONLY = re.compile(r"\b(?:[Kk]ata|[Hh]uruf) yang artinya\b")
# A word named by its place and its meaning and nothing else (operator 2026-10-17, rule 26: "Kata
# ketiga, yaitu رَبِّ (rabbi), yang artinya “Tuhan”" — every one, "even when the stage highlights that
# word"): "kata ketiga, yang artinya …", "Kata pertama artinya: …", "kata ketiga dan keempat, yang
# artinya …", "kata ini, yang artinya …", "yang pertama artinya …". A named word between the place
# and "artinya" ("kata ketiga, yaitu رَبِّ (rabbi), yang artinya") is what the rule asks, and no match.
ORDINAL_NUM = {ordinal(n): n for n in range(1, 31)}
_ORDS = "|".join(sorted(ORDINAL_NUM, key=len, reverse=True))
PLACE_MEANING_SAN = re.compile(rf"\b([Kk]ata) ({_ORDS}|ini)(?: (dan|sampai) (?:kata )?({_ORDS}))?(,?) (yang )?(artinya|berarti)\b")
PLACE_MEANING = re.compile(rf"\b(?:[Kk]ata (?:{_ORDS}|ini|itu)(?: (?:dan|sampai) (?:kata )?(?:{_ORDS}))?|[Yy]ang (?:{_ORDS})),? "
                           r"(?:yang )?(?:artinya|berarti)\b")
# A PART of a word named by its kind and its meaning only, in a composition line (operator
# 2026-10-17, "Sibling lines": "Bagian kedua adalah isim yang artinya “Maha Pengasih”" names the
# tile on the stage by what it is and what it means, not by itself — "Bagian kedua adalah isim,
# yaitu رَحْمَٰن (raḥmān), yang artinya …", as "Bagian pertama adalah huruf jar, yaitu بِ (bi), yang
# artinya “dengan”" already did): each "(yang) artinya" of a `:compose:` line whose stretch since
# the clause's start (or the meaning before it) holds a kind word and no named word. "Kata ini
# adalah kata penghubung yang artinya …" (the line's own word, named on the line before) and a
# phrase ("ungkapan yang artinya …") hold no kind word.
PART_KIND = re.compile(r"\b(?:[Ii]sim|[Ff]i[’']il|[Dd]hamir|[Hh]uruf(?: jar)?|[Aa]khiran|[Kk]ata (?:benda|kerja|ganti))\b")
_MEANS = re.compile(r"\b(?:yang )?artinya\b")


def part_meaning_only(display: str) -> list[str]:
    """The stretches of a composition caption that name a part by its kind and its meaning only."""
    out, start = [], 0
    for m in _MEANS.finditer(display):
        b = max([start] + [x.end() for x in re.finditer(r"[.;:]", display[:m.start()])])
        seg = display[b:m.start()]
        if PART_KIND.search(seg) and not NAMED_SHOWN.search(seg):
            out.append(seg.strip(" ,"))
        q = re.match(r":? ?“[^”]*”", display[m.end():])
        start = m.end() + (q.end() if q else 0)
    return out


def named_twice(display) -> list[str]:
    """The named words a caption names more than once (operator 2026-10-17, "Sibling lines": "Kata
    pertama, yaitu مِن (min), artinya: “dari”. Kata ini, yaitu مِن (min), yang artinya …" names the
    word twice in one line; the second naming goes)."""
    if not isinstance(display, str):
        return []
    names = [m.group() for m in NAMED_SHOWN.finditer(display)]
    return sorted({n for n in names if names.count(n) > 1})
# An earlier ayah in a line of a later one (README wording rule 8). Operator 2026-10-17 (rule 29:
# "A lesson stands on its own screen: no back-references to earlier ayat"; "remove the comparison,
# keep the sentence complete"), REFINED 2026-10-18 ("we need to remind some ayat is continuing
# previous ayat. So when we explain for example ayat 3 Al-Fatihah, why it kasrah because it's na't
# of Allah in previous ayat and mention which word. Apply this to similar cases."):
#   - a COMPARISON with an earlier ayah still goes: "seperti di ayat pertama", "sama dengan ayat
#     tiga", "berbeda dengan … di ayat …", "sekali lagi" (COMPARISON), and "ayat sebelumnya" (say
#     which ayah, and why);
#   - a DEPENDENCY is said, in one of two forms only: the opening of the ayah's structure part,
#     "Ayat ini melanjutkan ayat kedua." (CONTINUES), and a CITATION, a named word of that ayah
#     right before "di ayat <N>" ("na’t (نَعْت), yaitu sifat, bagi ٱللَّهِ (Allāhi) di ayat kedua"),
#     in a line that says the dependency (DEPENDENCY: na't / sifat bagi, badal / pengganti bagi,
#     'athaf / disambungkan pada, bergantung pada, disandarkan kepada, khabar bagi, …).
# Which ayat continue which, and on which words, is the authored data (structure.json `continues`,
# continuation_problems below): a citation the data does not have fails, and so does a dependency
# of the data that its word's explanation does not say. A citation of another surah ("Surah
# Al-'Alaq") and what a LATER ayah teaches are not back-references; the lesson map's own lines are
# its recap, not a pointer.
AYAT_NUM = {**{num_id(n): n for n in range(1, 287)}, **{ordinal(n): n for n in range(1, 287)}}
_AYAT_WORDS = "|".join(sorted(AYAT_NUM, key=len, reverse=True))
AYAT_NAMED = re.compile(rf"\bayat ({_AYAT_WORDS})\b")
AYAT_BEFORE = re.compile(r"\bayat sebelum(?:nya|\b)")
BACKREF_FREE_PARTS = {"map", "learned", "intro", "next", "done", "recap", "recite"}
# "Ayat ini melanjutkan ayat kedua." — the hedged form, where the kitab differ, is "Menurut
# al-Mujtaba dan al-Jadwal, ayat ini melanjutkan ayat pertama."
CONTINUES = re.compile(rf"\b[Aa]yat ini (?:masih )?melanjutkan ayat ({_AYAT_WORDS})\b")
# What a line says when it names a word of an earlier ayah because this ayah depends on it.
DEPENDENCY = re.compile(r"\b(?:na[’']t|sifat|badal|pengganti|[’'‘]athaf|[’'‘]athf|disambungkan|menyambungkan|melanjutkan|"
                        r"disandarkan|bergantung|dikaitkan|mengaitkan|mengikuti|menerangkan|menguatkan|khabar|mudhaf ilaih|"
                        r"keterangan keadaan|penjelas)\b", re.I)
COMPARISON = re.compile(r"\b(?:seperti|sama (?:seperti|dengan)|berbeda dengan|sekali lagi|polanya sama|"
                        r"sudah (?:kita )?(?:pelajari|bahas|lihat|temui))\b[^.;]*\bayat\b"
                        r"|\bayat\b[^.;]*\b(?:seperti|sama (?:seperti|dengan)|berbeda dengan)\b", re.I)
# A named word as a caption shows it (NAMED_SHOWN without its groups), a run of them, and the
# citation that follows one: "ٱللَّهِ (Allāhi) di ayat kedua", "kata بِرَبِّ (birabbi) yang artinya
# “kepada Tuhan” di ayat pertama", "frasa لَمْ (lam) يَلِدْ (yalid) yang artinya “tidak beranak” di ayat ketiga".
_NAMED_ONE = rf"(?<![؀-ۿ])[{_NAMED_AR}]+ \([^()؀-ۿ]+\)"
CITATION = re.compile(rf"(?P<run>{_NAMED_ONE}(?: {_NAMED_ONE})*)(?:,? (?:yang )?artinya “[^”]*”)?,? (?:di|pada) "
                      rf"ayat (?P<n>{_AYAT_WORDS})\b")


def _line_ayah(lid: str) -> int | None:
    """The ayah of a line whose earlier-ayah pointers are checked (None: a shared line, lesson zero,
    or a part that is the lesson map's or the ayah's frame, BACKREF_FREE_PARTS)."""
    parts = lid.split(":")
    if len(parts) < 3 or not parts[1].isdigit() or parts[2] in BACKREF_FREE_PARTS:
        return None
    return int(parts[1]) or None


def _surah_citation(display: str, start: int) -> bool:
    return bool(re.search(r"\bSurah [^\s,.;:]+(?: [^\s,.;:]+)? $", display[:start]))


def citations(lid: str, display) -> list[tuple[list[str], int]]:
    """The citations of a line of ayah A at an earlier ayah of its surah: ([named words], N)."""
    A = _line_ayah(lid)
    if A is None or not isinstance(display, str):
        return []
    out = []
    for m in CITATION.finditer(display):
        n = AYAT_NUM[m.group("n")]
        if n < A:
            out.append(([x.group() for x in NAMED_SHOWN.finditer(m.group("run"))], n))
    return out


def back_references(lid: str, display) -> list[str]:
    """The pointers of a line of ayah A at an earlier ayah of its surah that are not a dependency in
    one of its two forms (rule 8 as refined 2026-10-18), as written: a comparison, "ayat
    sebelumnya", or an "ayat <earlier>" that is neither "Ayat ini melanjutkan ayat <N>" nor a
    citation after a named word in a line that says the dependency."""
    A = _line_ayah(lid)
    if A is None or not isinstance(display, str):
        return []
    compared = bool(COMPARISON.search(display))
    cited = {m.end() for m in CITATION.finditer(display)}
    depends = bool(DEPENDENCY.search(display))
    out = []
    for m in AYAT_NAMED.finditer(display):
        if AYAT_NUM[m.group(1)] >= A or _surah_citation(display, m.start()):
            continue
        cont = any(c.end() == m.end() for c in CONTINUES.finditer(display))
        if not compared and (cont or (m.end() in cited and depends)):
            continue
        out.append(m.group())
    return out + [m.group() for m in AYAT_BEFORE.finditer(display)]


# ------------------------------------------------------------------ continuations (rule 8, 2026-10-18)
# authored/<slug>.structure.json, per ayah beside its `structure`: `continues`, the ayah this one
# continues and what in it depends on which earlier word, from the kitab the lesson cites:
#   {"ayah": 2, "per": null | "al-Mujtaba dan al-Jadwal",
#    "links": [{"words": [1], "kind": "na't", "on": ["1:2:2/allahi"], "src": ["D", "J"],
#               "said_in": ["word", "structure"]}, …]}
# `ayah` is the ordinal the opening sentence says ("Ayat ini melanjutkan ayat kedua."); `per` the
# hedge that sentence carries where the kitab differ ("Menurut al-Mujtaba dan al-Jadwal, ayat ini
# melanjutkan ayat pertama."); each link: the word(s) of this ayah, the kind of dependency, the
# named word(s) of ONE earlier ayah it is on (the named-word refs, a run for a phrase), the kitab
# (the surah's `kitab` abbreviations) and where it is said — "word": the explanation of each of
# `words` (its w<n> line or one of its composition lines) cites `on` "di ayat <N>"; "structure":
# one of the ayah's structure lines does. Reviewer-only (build_surah.py reads only `structure`).
CONTINUES_KEYS = {"ayah", "per", "links"}
LINK_KEYS = {"words", "kind", "on", "src", "said_in"}
SAID_IN = ("word", "structure")


def load_continues() -> dict[str, dict]:
    """{slug: {"ayat": {A: continues}, "kitab": {abbr}}} from the authored structure and words files."""
    out: dict[str, dict] = {}
    for sp in SURAHS:
        p = AUTHORED_DIR / f"{sp.slug}.structure.json"
        if not p.exists():
            continue
        st = json.loads(p.read_text(encoding="utf-8"))
        wp = AUTHORED_DIR / f"{sp.slug}.words.json"
        kitab = set((json.loads(wp.read_text(encoding="utf-8")).get("kitab") or {}) if wp.exists() else ())
        out[sp.slug] = {"ayat": {int(a): v["continues"] for a, v in (st.get("ayat") or {}).items() if "continues" in v},
                        "kitab": kitab}
    return out


def continuation_problems(manifests: dict[str, dict], lessons: dict[str, dict], named: "Named",
                          continues: dict[str, dict]) -> list[str]:
    """Rule 8 as refined 2026-10-18, on the data and on the lines: every ayah the data says continues
    an earlier one opens its structure part with "Ayat ini melanjutkan ayat <N>." (hedged as the data
    says), and no other ayah says it; every dependency of the data is said where the data says (its
    word's explanation, its structure lines), the earlier word named and its ayah cited; every
    citation of an earlier ayah's word is a dependency of the data; every named word of an earlier
    ayah only is cited; and an ayah whose structure is a "lanjutan" has data at all."""
    errs: list[str] = []
    for sp in SURAHS:
        slug, S = sp.slug, sp.surah
        lesson, man = lessons.get(slug), manifests.get(slug)
        if lesson is None or not isinstance(man, dict) or not isinstance(man.get("lines"), dict):
            continue
        lines = man["lines"]
        data = (continues.get(slug) or {}).get("ayat") or {}
        kitab = (continues.get(slug) or {}).get("kitab") or set()
        n_words = {a["ayah"]: len(a["words"]) for a in lesson["ayat"]}
        # The data itself.
        links_of: dict[int, list[tuple[tuple[str, ...], int, dict]]] = {}
        for A, c in sorted(data.items()):
            where = f"{slug} structure.json ayah {A} continues"
            if A not in n_words:
                errs.append(f"{where}: the lesson has no ayah {A}")
                continue
            if not isinstance(c, dict) or set(c) != CONTINUES_KEYS:
                errs.append(f"{where}: must be exactly {sorted(CONTINUES_KEYS)}")
                continue
            if not isinstance(c["ayah"], int) or isinstance(c["ayah"], bool) or not 1 <= c["ayah"] < A:
                errs.append(f"{where}: ayah {c['ayah']!r} is not an earlier ayah")
            if c["per"] is not None and (not isinstance(c["per"], str) or not c["per"].strip()):
                errs.append(f"{where}: per must be null or the kitab the hedge names")
            if not isinstance(c["links"], list) or not c["links"]:
                errs.append(f"{where}: links must be a non-empty list (what in this ayah depends on which word)")
                continue
            for i, ln in enumerate(c["links"]):
                lw = f"{where}.links[{i}]"
                if not isinstance(ln, dict) or set(ln) != LINK_KEYS:
                    errs.append(f"{lw}: must be exactly {sorted(LINK_KEYS)}")
                    continue
                ws = ln["words"]
                if (not isinstance(ws, list) or not ws or ws != sorted(set(ws))
                        or any(not isinstance(w, int) or isinstance(w, bool) or not 1 <= w <= n_words[A] for w in ws)):
                    errs.append(f"{lw}: words {ws!r} must be ascending word numbers of ayah {A}")
                    continue
                if not isinstance(ln["kind"], str) or not ln["kind"].strip():
                    errs.append(f"{lw}: kind must name the dependency (na't, badal, 'athaf, …)")
                if not isinstance(ln["src"], list) or not ln["src"] or any(x not in kitab for x in ln["src"]):
                    errs.append(f"{lw}: src {ln['src']!r} must be kitab of the surah's `kitab` table (the source of the dependency)")
                if not isinstance(ln["said_in"], list) or not ln["said_in"] or any(x not in SAID_IN for x in ln["said_in"]):
                    errs.append(f"{lw}: said_in must list where it is said, of {list(SAID_IN)}")
                    continue
                on = ln["on"]
                if not isinstance(on, list) or not on or any(not isinstance(r, str) or r not in named.refs for r in on):
                    errs.append(f"{lw}: on {on!r} must be named-word refs (\"1:2:2/allahi\") of the lesson")
                    continue
                ayat_on = {(int(r.split("/")[0].split(":")[0]), int(r.split("/")[0].split(":")[1])) for r in on}
                if len(ayat_on) != 1 or next(iter(ayat_on))[0] != S or not next(iter(ayat_on))[1] < A:
                    errs.append(f"{lw}: on {on!r} must be words of ONE earlier ayah of this surah")
                    continue
                pairs = tuple(named_shown(*named.refs[r]) for r in on)
                links_of.setdefault(A, []).append((pairs, next(iter(ayat_on))[1], ln))
        # An ayah whose structure the lesson calls a continuation ("lanjutan jumlah ayat 2") has data,
        # and the ayah the type names is the data's.
        for a in lesson["ayat"]:
            t = ((a.get("structure") or {}).get("type") or "")
            if re.match(r"\s*lanjutan\b", t) and a["ayah"] not in data:
                errs.append(f"{slug}:{a['ayah']}: its structure is a continuation ({t!r}): give the ayah `continues` in "
                            f"authored/{slug}.structure.json (which ayah it continues, and what depends on which word)")
            m = re.match(r"\s*lanjutan jumlah ayat (\d+)\b", t)
            c = data.get(a["ayah"])
            if m and isinstance(c, dict) and c.get("ayah") != int(m.group(1)):
                errs.append(f"{slug}:{a['ayah']}: its structure type continues ayat {m.group(1)}, `continues` says ayah {c.get('ayah')!r}")
        # Where each named word stands: the ayat of this surah it is a word (or form) of.
        places: dict[str, set[int]] = {}
        for ref, word in named.refs.items():
            s, a = (int(x) for x in ref.split("/")[0].split(":")[:2])
            if s == S:
                places.setdefault(named_shown(*word), set()).add(a)
        for A in sorted(n_words):
            base = f"{slug}:{A}"
            c = data.get(A) if isinstance(data.get(A), dict) else None
            own = {lid: ln for lid, ln in lines.items() if lid.startswith(base + ":") and isinstance(ln, dict)
                   and isinstance(ln.get("display"), str)}
            # The opening sentence: where the data has it — the structure part's first words after its
            # lead, across its split parts — and nowhere else.
            parts = [lid for lid in own if lid.startswith(f"{base}:structure")]
            opening = re.sub(rf"^{re.escape(STRUCTURE_LEAD)}\s*", "", " ".join(own[lid]["display"] for lid in parts))
            said_at = [(lid, m) for lid, ln in own.items() for m in CONTINUES.finditer(ln["display"])]
            for lid, m in said_at:
                n = AYAT_NUM[m.group(1)]
                if c is None or n != c.get("ayah"):
                    errs.append(f"{lid}: says {m.group()!r}, but the data has no continuation of ayah {n} "
                                f"(authored/{slug}.structure.json `continues` of ayah {A})")
            if c is not None and isinstance(c.get("ayah"), int) and 1 <= c["ayah"] < A:
                want = f"ayat ini melanjutkan ayat {ordinal(c['ayah'])}"
                lead = f"menurut {c['per'].lower()}, " if isinstance(c.get("per"), str) and c["per"].strip() else ""
                head = opening.lower()
                if not (head.startswith(lead + want) or head.startswith(lead + want.replace("ini ", "ini masih "))):
                    say = (f"Menurut {c['per']}, a" if lead else "A") + want[1:]
                    errs.append(f"{parts[0] if parts else base + ':structure'}: ayah {A} continues ayah {c['ayah']} (the data): its "
                                f"structure part opens with “{say}.” (rule 8, operator 2026-10-18)")
                elif len(said_at) > 1:
                    errs.append(f"{said_at[1][0]}: {said_at[1][1].group()!r} again: the continuation is said once, at the "
                                f"opening of the structure part ({parts[0]})")
            known = links_of.get(A, [])
            # Every citation is a dependency of the data, of words of the ayah it names — in a word's own
            # lines, a dependency of THAT word.
            for lid, ln in own.items():
                wm = re.match(rf"{re.escape(base)}:w(\d+)(?::|$)", lid)
                mine = [x for x in known if wm is None or int(wm.group(1)) in x[2]["words"]]
                for run, n in citations(lid, ln["display"]):
                    if any(n not in places.get(w, set()) for w in run):
                        errs.append(f"{lid}: cites {' '.join(run)!r} “di ayat {ordinal(n)}”, which is not a word of ayah {n}")
                    elif not any(tuple(run) == pairs and n == on_a for pairs, on_a, _ in mine):
                        errs.append(f"{lid}: cites {' '.join(run)!r} of ayah {n} as a dependency the data does not have "
                                    f"(authored/{slug}.structure.json `continues` of ayah {A}): never one the kitab do not state")
                # … and a named word that stands only in an earlier ayah says which.
                cited_spans = [m.span("run") for m in CITATION.finditer(ln["display"])]
                if _line_ayah(lid) is None:
                    continue
                for m in NAMED_SHOWN.finditer(ln["display"]):
                    at = places.get(m.group(), set())
                    if at and max(at) < A and not any(s <= m.start() and m.end() <= e for s, e in cited_spans):
                        errs.append(f"{lid}: names {m.group()!r}, a word of ayah {max(at)}, without saying which ayah "
                                    f"(“… di ayat {ordinal(max(at))}”: rule 8, operator 2026-10-18)")
            # Every dependency of the data is said where the data says.
            for pairs, on_a, ln in known:
                def cite(lid: str, pairs: tuple[str, ...] = pairs, on_a: int = on_a) -> bool:
                    return any(tuple(run) == pairs and n == on_a for run, n in citations(lid, own[lid]["display"]))
                if "word" in ln["said_in"]:
                    for w in ln["words"]:
                        mine = [lid for lid in own if re.fullmatch(rf"{re.escape(base)}:w{w}(?::compose:\d+)?(?::[a-z])?", lid)]
                        if not any(cite(lid) for lid in mine):
                            errs.append(f"{base}:w{w}: depends on {' '.join(pairs)!r} of ayah {on_a} ({ln['kind']}, the data): its "
                                        f"explanation says so, “… {pairs[-1]} di ayat {ordinal(on_a)}” (rule 8, operator 2026-10-18)")
                if "structure" in ln["said_in"]:
                    mine = [lid for lid in own if lid.startswith(f"{base}:structure")]
                    if not any(cite(lid) for lid in mine):
                        errs.append(f"{base}:structure: words {ln['words']} depend on {' '.join(pairs)!r} of ayah {on_a} "
                                    f"({ln['kind']}, the data): a structure line says so, “… di ayat {ordinal(on_a)}”")
    return errs


def default_named_speech(translit: str) -> str:
    """A named word's transliteration in plain letters, as the narrator says a simple one (‘ → ', ż
    → dz, ṡ → ts, …) — and the Name at a word's start in its house spelling (Allāhi → Allohi;
    lillāhi stays light)."""
    t = "".join(_NAMED_RESPELL.get(c, c) for c in translit)
    return re.sub(r"(?<![\w'])([Aa])llah", r"\1lloh", fold(t))


def named_speech(translit: str) -> str:
    """What the narrator says for a named word that is said (named_is_said)."""
    return default_named_speech(translit)


def named_is_said(ar: str, translit: str) -> bool:
    """THE rule for a named Qur'anic word (operator 2026-10-17): said by the narrator only when it
    is simple — no heavy (tafkhim) letter, ص ض ط ظ ق خ غ, among its Arabic letters, and a plain
    spelling (default_named_speech) that the heavy-letter guard accepts as it is; else it is shown
    and explained, never said. Used by build_narration (which words a line says), the checks below,
    render_narration's guard (held_line) and, mirrored, the TS namedIsSaid."""
    if any(c in TAFKHIM for c in ar):
        return False
    said = default_named_speech(translit).lower()
    return not (HEAVY_LATIN.search(said) and said not in NOT_HEAVY)


def named_markup(ref: str, ar: str, translit: str) -> str:
    """The markup that names a word (ref "1:6:2" or "1:7:9/ad-dalluna"): {{ref}} when it is said,
    {{!ref}} when it is shown only (named_is_said) — what generated lines write."""
    return f"{{{{{'' if named_is_said(ar, translit) else '!'}{ref}}}}}"


def named_shown(ar: str, translit: str) -> str:
    """How a caption shows a named word: the content's bytes, then the transliteration."""
    return f"{ar} ({translit})"


def named_in_display(display) -> list[tuple[str, str]]:
    """The named words of a caption that are said, in order: (what is said, what is shown)."""
    if not isinstance(display, str):
        return []
    return [(named_speech(m.group("lat")), m.group()) for m in NAMED_SHOWN.finditer(display)
            if named_is_said(m.group("ar"), m.group("lat"))]


def named_unsaid(display) -> list[re.Match]:
    """The named words of a caption that are shown only (heavy letters, named_is_said)."""
    if not isinstance(display, str):
        return []
    return [m for m in NAMED_SHOWN.finditer(display) if not named_is_said(m.group("ar"), m.group("lat"))]


# What the spoken text leaves out with a word shown only, in order of preference ({x}: the word):
# "Kata kedua, yaitu X, artinya: …" → "Kata kedua artinya: …"; "kata pertama, yaitu X, yang artinya"
# and the apposition "kata pertama, X, yang artinya" → "kata pertama, yang artinya"; "kata X yang
# artinya" → "kata yang artinya"; "bunyi u: X." → "bunyi u."; anywhere else the word and its "yaitu".
# Each is a deletion, so the caption is the spoken text with these pieces put back (unsay's cuts):
# the karaoke tokens carry each piece in the token it falls in or follows (Lexicon.tokens `cuts`).
UNSAID = (
    r", (?:yaitu )?{x},(?= artinya\b)",
    r", (?:yaitu )?{x}(?=,)",
    r" {x}(?= yang artinya\b)",
    r": {x}(?=[.;,!?”]|$)",
    r",? (?:yaitu )?{x}",
    r"^{x} ?",
)


def unsay(text: str, x: str) -> tuple[str, list[tuple[int, str]]]:
    """`text` with each word shown only (`x`: a regex for one, a placeholder in the text) and its
    connector deleted (UNSAID), and the cuts: (position in the result, the deleted piece)."""
    rx = re.compile("|".join(f"(?:{r.format(x=x)})" for r in UNSAID))
    out, cuts, cur = "", [], 0
    for m in rx.finditer(text):
        out += text[cur:m.start()]
        cuts.append((len(out), m.group()))
        cur = m.end()
    return out + text[cur:], cuts


_UNSAID0 = 0xF5000  # a shown-only word's placeholder while a line is cut (one per word)


def _unsaid_rx(n: int) -> str:
    return f"[{chr(_UNSAID0)}-{chr(_UNSAID0 + max(n, 1) - 1)}]"


class Named:
    """The words a line may name (NAMED_REF): every lesson word ("1:1:1") and every named form of a
    composition ("1:1:1/bi"), with their bytes and transliteration, from the content files only (CI
    has no cache)."""

    def __init__(self, lessons: dict[str, dict], compose: dict[str, dict] | None = None):
        self.refs: dict[str, tuple[str, str]] = {}
        for lesson in lessons.values():
            for a in lesson.get("ayat") or []:
                for w in a.get("words") or []:
                    self.refs[w["loc"]] = (w["ar"], w["translit"])
        for c in (compose or {}).values():
            for loc, unit in ((c or {}).get("words") or {}).items():
                for name, f in (unit.get("forms") or {}).items():
                    if isinstance(f, dict) and f.get("ar") and f.get("translit"):
                        self.refs[f"{loc}/{name}"] = (f["ar"], f["translit"])
        self.pairs = {named_shown(ar, tr) for ar, tr in self.refs.values()}

    def resolve(self, loc: str, form: str | None = None) -> tuple[str, str]:
        ref = f"{loc}/{form}" if form else loc
        if ref not in self.refs:
            raise SystemExit(f"{{{{{ref}}}}}: no lesson word or composition form of that name (content/<slug>.json, content/compose)")
        return self.refs[ref]


def spoken_translation(text: str) -> str:
    """QuranEnc text as the narrator reads it: footnote markers and straight double quotes are not
    spoken (QuranEnc opens the Al-Mu'awwidzat quotation in ayah 1 and closes it in the last ayah),
    and a trailing comma becomes a full stop. Nothing else changes."""
    t = re.sub(r"\[\d+\]", "", text).replace('"', "")
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"[,;:]$", ".", t)
    if t and t[-1] not in ".!?":
        t += "."
    return t


def tts_text(text: str) -> str:
    """The caption made render-ready (house rule: all normalisation in Python, the voice's own
    normaliser stays "off"): quotes dropped, brackets and dashes become commas, an ellipsis (an open
    phrase, "yang banyak …") is dropped, not read as a full stop, "/" reads "atau", "+" reads "dan",
    an open prefix loses its hyphen ("berawalan di-" → "berawalan di"). Pronunciation (the
    dictionary, Allah → Alloh) is applied before this, by build_narration.speech."""
    t = text.replace("“", "").replace("”", "").replace('"', "")
    t = t.replace("—", ", ").replace("–", ", ").replace("…", "").replace("/", " atau ").replace(" + ", " dan ")
    t = re.sub(r"(?<=\w)-(?=[\s,.;:!?)]|$)", "", t)  # "berawalan di-" → "berawalan di"
    t = t.replace("(", ", ").replace(")", ", ")
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"\s+([,.;:!?])", r"\1", t)
    t = re.sub(r",(?:\s*,)+", ",", t)
    t = re.sub(r",\s*([.;:!?])", r"\1", t)
    t = re.sub(r"([.;:!?])\s*,", r"\1", t)
    t = re.sub(r"^\s*,\s*", "", t)
    t = re.sub(r",(?=\S)", ", ", t)
    return re.sub(r"\s+", " ", t).strip()


# ------------------------------------------------------------------ pronunciation dictionary
# authored/pronunciation.json (kamus pelafalan): each grammar term the narrator says, `speak` the
# exact form sent to the voice (Arabic script, or a fixed Latin respelling where eleven_v3 reads a
# heavy letter light), `display` its caption form, "na’t (نَعْت)". A letter term (بَاء) is spoken by
# its name and shown as the letter in the ayah, alone (بِ; Term.bare, operator 2026-10-17). Terms are
# added only after the operator has approved their sound (README "Narasi").
_DISPLAY = re.compile(r"^(?P<head>[^()؀-ۿ]+?)(?: \((?P<ar>[^()]+)\))?$")
_CONT = f"\\w{AR_MARKS}'‘’ʼ`´\\-"  # characters that continue a word on either side of a term
# A heavy letter (tafkhim) with fathah (or fathatan, either order with a shadda) or followed by alif.
HEAVY_A = re.compile("[صضطظقخغ](?:\u0651?[\u064E\u064B]|[\u064E\u064B]\u0651|\u0627)")
ARABIC_WORD = re.compile("[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+")
AR_LETTERS = "\u0621-\u065f\u0670-\u06ff"  # Arabic letters and their marks (a shown letter in brackets)
# A karaoke word that already shows Arabic: a shown-only piece next to it is a karaoke word of its own
# (Lexicon.token_entries; one Arabic unit per karaoke word, at its end).
KARAOKE_OWN_PIECE = re.compile(f"[{AR_LETTERS}]")
MASK = "istilah"  # what a dictionary term becomes for the word guard (a plain Indonesian word)
_LETTER_CHARS = [chr(x) for x in range(0x0621, 0x064B)] + ["\u0671"]  # the letters (and ٱ), no marks


def letter_shapes(shown: str) -> str:
    """The body of a regex character class of every letter whose skeleton is the one letter of
    `shown` (ب → ب; ا → ا ٱ أ إ آ; ه → ه ة): the shapes a letter shown alone takes on screen."""
    want = ar_skeleton(shown)
    return "".join(re.escape(c) for c in _LETTER_CHARS if ar_skeleton(c) == want)

# Where the lesson prose (Latin) carries a dictionary term, by the term's caption head ("kasrah",
# "na't", "huruf jar"; build_narration.mark speaks it from the dictionary there). Most heads count
# anywhere as a whole word; these only in the contexts given ({h} is the head):
_COMPOUND_NEXT = r"(?! (?:maushul|fa'il|maf'ul|mudhari'|amr|madhi|majhul)(?![\w']))"
LATIN_CONTEXT: dict[str, str] = {
    # "huruf" is also plain Indonesian ("huruf ba'", "empat huruf", "huruf 'athaf"): the word
    # class is said from the dictionary only where the Kalimah concept lists the three classes.
    # … and where the warm-up names the three (quiz.warmup_marked, build_narration.ex_intro:
    # "isim, fi'il, atau huruf"; "… adalah huruf, karena ia kata tugas", and lesson zero's "…
    # adalah huruf, yaitu kata tugas").
    "حَرْف": r"(?:(?<=fi'il, dan ){h}|(?<=atau ){h}(?= \(kata tugas\))|(?<=fi'il, atau ){h}|(?<=adalah ){h}(?=, (?:yaitu|karena ia) ))",
    # The letter of a prefixed preposition (bi-, li-), never "alif lam" or a root letter (fa', 'ain, lam).
    "بَاء": r"(?:(?<=[Hh]uruf )|(?<=jar )){h}",
    # … and the last of a wazan's three root letters as build_narration names them ("tiga huruf fa',
    # 'ain, dan lam", the wazan-dan-tashrif concept; shown as its summary writes it, line_letters).
    "لَام": r"(?:(?<=[Hh]uruf )|(?<=jar )|(?<='ain, dan )){h}",
    # The head of a longer term the dictionary does not have (fi'il majhul) stays as written until
    # that term is in the dictionary; a longer term it has (isim fa'il, fi'il mudhari', added
    # 2026-10-11) is matched whole anyway (the longest match wins), and "isim manshub" is two terms.
    "اِسْم": "{h}" + _COMPOUND_NEXT,
    "فِعْل": "{h}" + _COMPOUND_NEXT,
}


def _ci(s: str) -> str:
    """`s` as a regex whose first letter matches either case (after a leading 'ain apostrophe:
    "'athaf" also matches the title's "'Athaf")."""
    i = 1 if s[:1] in APOS and s[1:2].isalpha() else 0
    if s[i:i + 1].isalpha() and s[i:i + 1].lower() != s[i:i + 1].upper():
        return re.escape(s[:i]) + f"[{s[i].upper()}{s[i].lower()}]" + re.escape(s[i + 1:])
    return re.escape(s)


def _cap(s: str) -> str:
    """The first letter capitalised, after a leading 'ain apostrophe too ("‘Athaf")."""
    i = 1 if s[:1] in APOS and s[1:2].isalpha() else 0
    return s[:i] + s[i:i + 1].upper() + s[i + 1:]


def _low(s: str) -> str:
    """The first letter in lower case, after a leading 'ain apostrophe too: a concept's name inside
    a sentence ("‘Athaf (عَطْف)" → "‘athaf (عَطْف)")."""
    i = 1 if s[:1] in APOS and s[1:2].isalpha() else 0
    return s[:i] + s[i:i + 1].lower() + s[i + 1:]


def _capitalised(s: str) -> bool:
    """Does `s` start with a capital (after a leading 'ain apostrophe)?"""
    i = 1 if s[:1] in APOS and s[1:2].isalpha() else 0
    return s[i:i + 1].isupper()


def letter_name_rx(t: "Term") -> str:
    """A letter's Latin name as a caption could write it — either case, any apostrophe ("ba’",
    "Ba'", "‘ain") — as a regex."""
    return _ci(fold(t.head)).replace("'", f"[{APOS}]")


# `approved` of a dictionary term: the date the operator approved its sound by ear, or PENDING and the
# date he waived the pre-render review (the term renders and is always reported).
PENDING = "pending-ear-check"
APPROVED = re.compile(rf"^(?:{PENDING} )?\d{{4}}-\d{{2}}-\d{{2}}(?: .+)?$")


# A concept line opens "Konsep baru: <title>" (build_narration.surah_lines); the title starts with
# a capital in the caption, so a term spoken from Arabic script right there is shown capitalised.
TITLE_LEAD = "Konsep baru:"


def _sentence_start(text: str, i: int) -> bool:
    before = text[:i].rstrip()
    return not before or before[-1] in ".!?" or before == TITLE_LEAD


@dataclass(frozen=True)
class Term:
    term: str
    speak: str
    display: str
    head: str            # the caption's Latin head ("na’t", "ba’", "Allah")
    shown: str | None    # the Arabic the caption shows in brackets, or None
    approved: str = ""   # the date the operator approved its sound by ear, or "pending-ear-check …"

    @property
    def pending(self) -> bool:
        """Added without the operator's ear check (he waived the pre-render review, 2026-10-10):
        it renders, and every validate / render run lists it until it is dated."""
        return self.approved.startswith(PENDING)

    @property
    def latin(self) -> str:
        """The head as the lesson prose writes it (folded: "na't")."""
        return fold(self.head)

    @property
    def arabic_speak(self) -> bool:
        return bool(ARABIC.search(self.speak))

    @property
    def letter(self) -> bool:
        """A letter: its NAME is spoken (bā’), the letter as in the ayah is shown (بِ)."""
        return bool(self.shown) and ar_skeleton(self.shown) != ar_skeleton(self.term)

    @property
    def bare(self) -> bool:
        """A single letter (بِ, س, و, ا …; not the article ال, named by its two letters): the caption
        shows the letter ALONE, as on screen, without its Latin name — "Contohnya huruf ب ini", never
        "huruf ba’ (ب) ini" (operator 2026-10-17, on the Pengantar: "we dont need to write “ba’”
        here, only the arabic one is enough, also apply this rule to similar sentences"). The
        `display` of pronunciation.json keeps the name ("ba’ (بِ)"): its head is how the lesson prose
        writes the letter, its bracket the letter's default shape. The spoken text still names it."""
        return self.letter and len(ar_skeleton(self.shown or "")) == 1


class Lexicon:
    def __init__(self, data, source: str = "pronunciation.json"):
        self.source = source
        self.shape: list[str] = []
        self.terms: list[Term] = []
        raw_terms = data.get("terms") if isinstance(data, dict) else None
        if not isinstance(raw_terms, list):
            self.shape.append(f"{source}: needs a list of terms")
            raw_terms = []
        for i, raw in enumerate(raw_terms):
            if not isinstance(raw, dict) or not all(
                isinstance(raw.get(k), str) and raw[k] and raw[k] == raw[k].strip() for k in ("term", "speak", "display")
            ):
                self.shape.append(f"{source}: term {i} needs non-empty, trimmed term, speak and display")
                continue
            m = _DISPLAY.match(raw["display"])
            if not m:
                self.shape.append(f"{source}: {raw['term']}: display must be “latin” or “latin (arabic)”, got {raw['display']!r}")
                continue
            if not isinstance(raw.get("approved"), str) or not raw["approved"].strip():
                self.shape.append(f"{source}: {raw['term']}: needs `approved`, the date the operator approved its sound "
                                  f"by ear (or \"{PENDING} <date> …\")")
            self.terms.append(Term(raw["term"], raw["speak"], raw["display"], m.group("head"), m.group("ar"),
                                   str(raw.get("approved") or "")))
        self.by_term = {t.term: t for t in self.terms}
        if isinstance(data, dict) and "named" in data:
            self.shape.append(f"{source}: `named` is retired (operator 2026-10-17: a heavy-letter word is shown and "
                              "explained, never said; a simple one is said as it is written): remove it")
        self._groups: dict[str, Term] = {}
        speak_alts, display_alts = [], []
        for i, t in enumerate(sorted(self.terms, key=lambda t: -len(t.speak))):
            self._groups[f"s{i}"] = t
            speak_alts.append(f"(?P<s{i}>{re.escape(t.speak) if t.arabic_speak else _ci(t.speak)})")
        for i, t in enumerate(sorted(self.terms, key=lambda t: -len(t.display))):
            self._groups[f"d{i}"] = t
            if t.bare:
                # The letter alone, as the screen writes it (any of its shapes and marks: ب بِ, ٱ,
                # لِّ, مَٰ); check_display compares it with shown_letter.
                body = f"[{letter_shapes(t.shown or '')}][{AR_MARKS}]*"
            elif t.letter:
                # The article: its name and, in brackets, as the screen writes it (ال, ٱلْ).
                body = f"{_ci(t.head)} \\([{AR_LETTERS}]+\\)"
            else:
                body = _ci(t.display)
            display_alts.append(f"(?P<d{i}>{body})")
        never = "(?!x)x"
        self.speak_rx = re.compile(f"(?<![{_CONT}])(?:{'|'.join(speak_alts) or never})(?![{_CONT}])")
        self.display_rx = re.compile(f"(?<![{_CONT}])(?:{'|'.join(display_alts) or never})(?![{_CONT}])")
        rules = []
        for t in sorted(self.terms, key=lambda t: -len(t.latin)):
            if t.latin == t.speak and not t.letter:
                continue  # said as written (Bashrah): nothing to convert (a letter, alif, is still shown as on screen)
            pat = LATIN_CONTEXT.get(t.term, "{h}").replace("{h}", _ci(t.latin))
            rules.append((t, re.compile(f"(?<![\\w'‘’\\-]){pat}(?![\\w'‘’\\-])")))
        self.latin_rules = rules

    # -- finding terms
    def latin_matches(self, text: str) -> list[tuple[int, int, Term, bool]]:
        """Non-overlapping (start, end, term, capitalised) of the dictionary terms the lesson
        prose writes in Latin (the longest at each place)."""
        found = [(m.start(), m.end(), t, _capitalised(m.group())) for t, rx in self.latin_rules for m in rx.finditer(text)]
        found.sort(key=lambda x: (x[0], -(x[1] - x[0])))
        out, end = [], -1
        for f in found:
            if f[0] >= end:
                out.append(f)
                end = f[1]
        return out

    def spoken_spans(self, text: str) -> list[tuple[int, int, Term]]:
        return [(m.start(), m.end(), self._groups[m.lastgroup]) for m in self.speak_rx.finditer(text)]

    # -- forms
    def shown_letter(self, t: Term, focus_ar) -> str:
        """The letter a letter term shows: the focus word's own first letter when it is that letter
        (لَ of lahu), else the dictionary's (بِ, لِ). `focus_ar` may instead be a tuple of the
        strings an animation frame shows (line_letters): then the first piece, in any of them,
        whose letter is that letter (the bare lam of ٱلرَّحْمَٰن, the مَٰ of the primer), as the frame
        writes it; a two-letter term (the article) takes the first run of two such pieces."""
        want = ar_skeleton(t.shown or "")
        n = max(len(want), 1)
        letters = lambda ps: "".join(ar_skeleton(p[0]) for p in ps)  # noqa: E731
        if isinstance(focus_ar, tuple):
            for s in focus_ar:
                ps = COMPOSE.pieces(s)
                for i in range(len(ps) - n + 1):
                    if letters(ps[i:i + n]) == want:
                        return "".join(ps[i:i + n])
            return t.shown or ""
        if focus_ar and n > 1:
            ps = COMPOSE.pieces(focus_ar)
            return "".join(ps[:n]) if letters(ps[:n]) == want else (t.shown or "")
        fl = first_letter(focus_ar) if focus_ar else None
        return fl if fl and ar_skeleton(fl) == want else (t.shown or "")

    def display_of(self, t: Term, cap: bool, focus_ar: str | None = None) -> str:
        if t.bare:
            return self.shown_letter(t, focus_ar)  # the letter alone (Term.bare); no case to give it
        s = f"{t.head} ({self.shown_letter(t, focus_ar)})" if t.letter else t.display
        return _cap(s) if cap else s

    def speak_of(self, t: Term, cap: bool) -> str:
        return _cap(t.speak) if cap and not t.arabic_speak else t.speak

    def _spans(self, text: str, named=()) -> list[tuple[int, int, "Term | str"]]:
        """The dictionary terms of a spoken text and, in order, its named words (`named`: [(said,
        shown)], named_in_display of its caption), as (start, end, the Term | the words as shown)."""
        spans: list = list(self.spoken_spans(text))
        pos = 0
        for said, shown in named:
            m = re.compile(rf"(?<![\w'‘’-]){re.escape(said)}(?![\w'‘’-])").search(text, pos)
            if m:
                spans.append((m.start(), m.end(), shown))
                pos = m.end()
        return sorted(spans, key=lambda x: x[0])

    def runs(self, text: str, named=()) -> list[tuple[int, int]]:
        """The spoken words of a line: runs of non-space characters, a multi-word term (حَرْف جَرّ,
        mudhof ilaih) or named word (wa la) being one word. These are the karaoke tokens."""
        runs = [[m.start(), m.end()] for m in re.finditer(r"\S+", text)]
        for a, b, _t in self._spans(text, named):
            inside = [r for r in runs if r[1] > a and r[0] < b]
            if len(inside) > 1:
                first = inside[0]
                first[1] = inside[-1][1]
                runs = [r for r in runs if r is first or r not in inside]
        return [(a, b) for a, b in runs]

    def _render(self, text: str, a: int, b: int, spans, focus_ar) -> str:
        out, cur = "", a
        for s, e, t in spans:
            if s < a or e > b:
                continue
            if isinstance(t, str):  # a named word, as its caption shows it
                out += text[cur:s] + t
            else:
                cap = _capitalised(text[s:e]) if not t.arabic_speak else _sentence_start(text, s)
                out += text[cur:s] + self.display_of(t, cap, focus_ar)
            cur = e
        return out + text[cur:b]

    def render_display(self, text: str, focus_ar: str | None = None, named=(), cuts=()) -> str:
        """The caption of a spoken line, word by word: each dictionary `speak` value in its display
        form (a capital at a sentence start), "Alloh" as "Allah", each named word as its caption shows
        it (`named`: named_in_display of the caption), each shown-only word put back where the caption
        has it (`cuts`: text_cuts of the caption); what the karaoke tokens join to."""
        return " ".join(self._pieces(text, focus_ar, named, cuts))

    def _pieces(self, text: str, focus_ar, named, cuts) -> list[str]:
        """The karaoke words' texts (token_entries)."""
        return [t for t, _i in self.token_entries(text, focus_ar, named, cuts)]

    def token_entries(self, text: str, focus_ar, named, cuts) -> list[tuple[str, int]]:
        """Each spoken word (runs) as the caption shows it, with the shown-only pieces put back, as
        (the karaoke word's text, the index of the run whose timing it takes). A piece joins the
        word it falls in (": X" before a full stop) or the one before it (", yaitu X," after
        "kedua") — shown while that word is heard, with that word's timing. Except where that word
        already shows Arabic (a term, "isim (اِسْم)", or a named word): one karaoke word holds at
        most one Arabic unit, at its end (operator 2026-10-17, rule 15, clean line breaks; the TS
        textUnits test), so there the piece is a karaoke word of its own, cut from the word at the
        piece's first space — "isim (اِسْم)," + "yaitu صِرَٰط (ṣirāṭ)," — with the SAME timing as the
        spoken word: shown while it is heard, as before, and no time made up (KARAOKE_OWN_PIECE)."""
        spans = self._spans(text, named)
        runs = self.runs(text, named)
        out = [self._render(text, a, b, spans, focus_ar) for a, b in runs]
        # Per run: the pieces split off before it and after it (each a karaoke word of its own).
        before: list[list[str]] = [[] for _ in runs]
        after: list[list[str]] = [[] for _ in runs]
        for pos, piece in sorted(cuts, key=lambda c: c[0], reverse=True):
            i = max((k for k, (a, _b) in enumerate(runs) if a <= pos), default=0)
            a, b = runs[i] if runs else (0, 0)
            own = bool(runs) and bool(KARAOKE_OWN_PIECE.search(out[i]))
            if pos >= b:
                sp = piece.find(" ")
                if own and sp >= 0 and piece[sp + 1:].strip():
                    out[i] = out[i] + piece[:sp]
                    after[i].insert(0, piece[sp + 1:])
                else:
                    out[i] = out[i] + piece
            elif pos <= a:
                if own and piece.rstrip() != piece:
                    before[i].append(piece.rstrip())
                else:
                    out[i] = piece.rstrip() + " " + out[i] if piece.rstrip() == piece else piece + out[i]
            else:  # inside the word: before its last (b - pos) characters, punctuation as spoken
                k = len(out[i]) - (b - pos)
                sp = piece.find(" ")
                if own and sp >= 0 and piece[sp + 1:].strip():
                    after[i].insert(0, piece[sp + 1:] + out[i][k:])
                    out[i] = out[i][:k] + piece[:sp]
                else:
                    out[i] = out[i][:k] + piece + out[i][k:]
        entries: list[tuple[str, int]] = []
        for i, t in enumerate(out):
            entries += [(p, i) for p in before[i]] + [(t, i)] + [(p, i) for p in after[i]]
        return entries

    def tokens(self, text: str, starts: list[float], ends: list[float], focus_ar: str | None = None,
               named=(), cuts=()) -> list[dict]:
        """Karaoke tokens from a character alignment of `text` (ElevenLabs /with-timestamps:
        one start and end per input character): {t: display text, s: start, e: end} seconds.
        `named`: the named words of the line's caption (named_in_display); `cuts`: its shown-only
        words (text_cuts), each carried by the token it falls in or follows (its timing, none made up)."""
        if len(starts) != len(text) or len(ends) != len(text):
            raise ValueError("alignment does not match the text character for character")
        runs = self.runs(text, named)
        return [{"t": t, "s": round(starts[runs[i][0]], 3), "e": round(ends[runs[i][1] - 1], 3)}
                for t, i in self.token_entries(text, focus_ar, named, cuts)]

    def _said_with_holes(self, display: str) -> tuple[str, list[str]]:
        """What a caption says (see speech_of_display), each shown-only word a placeholder still in
        place; and those words as the caption shows them."""
        held: list[str] = []

        def named(m: re.Match) -> str:
            if named_is_said(m.group("ar"), m.group("lat")):
                return named_speech(m.group("lat"))
            held.append(m.group())
            return chr(_UNSAID0 + len(held) - 1)
        said = NAMED_SHOWN.sub(named, display)

        def rep(m: re.Match) -> str:
            t = self._groups[m.lastgroup]
            return self.speak_of(t, _sentence_start(said, m.start()) if t.bare else _capitalised(m.group()))
        return tts_text(self.display_rx.sub(rep, said)), held

    def speech_of_display(self, display: str) -> str:
        """What a caption says: each named word that is said as it is said (named_speech), each one
        shown only left out with its connector (unsay), each display form back to its `speak` value,
        then tts_text. A letter shown alone (Term.bare) carries no case: a name spoken in Latin
        (alif, sin) takes its capital from where it stands, as the prose wrote it — at a sentence
        start."""
        said, held = self._said_with_holes(display)
        return unsay(said, _unsaid_rx(len(held)))[0] if held else said

    def text_cuts(self, display) -> list[tuple[int, str]]:
        """Where a caption's shown-only words go back into its spoken text: (position in the spoken
        text, the cut piece as the caption shows it: ", yaitu ٱلصِّرَٰطَ (aṣ-ṣirāṭa),"). The karaoke
        tokens carry each piece in the token it falls in or follows (tokens, render_display)."""
        if not isinstance(display, str):
            return []
        said, held = self._said_with_holes(display)
        if not held:
            return []
        rx = _unsaid_rx(len(held))
        return [(pos, re.sub(rx, lambda c: held[ord(c.group()) - _UNSAID0], piece)) for pos, piece in unsay(said, rx)[1]]

    def mask_spoken(self, text: str) -> str:
        return self.speak_rx.sub(MASK, text)

    @staticmethod
    def unnamed(display: str) -> str:
        """A caption with its named words masked (their Arabic is a lesson word's, never a term)."""
        return NAMED_SHOWN.sub(MASK, display)

    def mask_display(self, display: str) -> str:
        """Display forms with Arabic masked, and the named words; a plain Latin one ("Allah") stays,
        for the guard's own rule on the Name (inside “…” or with its honorific)."""
        return self.display_rx.sub(lambda m: MASK if self._groups[m.lastgroup].shown else m.group(), self.unnamed(display))

    # -- the dictionary's own rules
    def problems(self, forms: Forms) -> list[str]:
        errs = list(self.shape)
        src = self.source
        for what in ("term", "speak", "display"):
            seen: set[str] = set()
            for t in self.terms:
                v = getattr(t, what).lower()
                if v in seen:
                    errs.append(f"{src}: {what} {getattr(t, what)!r} appears twice")
                seen.add(v)
        for t in self.terms:
            if ARABIC.search(t.head):
                errs.append(f"{src}: {t.term}: the display's head must be Latin, Arabic goes in brackets")
            if t.arabic_speak and t.speak != t.term:
                errs.append(f"{src}: {t.term}: speak must be the term itself (Arabic script) or a Latin respelling")
            if HEAVY_A.search(t.term) and t.arabic_speak:
                errs.append(f"{src}: {t.term}: heavy letter with fathah/alif needs a fixed Latin respelling in speak "
                            "(eleven_v3 reads it light and inconsistently)")
            if ARABIC.search(t.term) and not t.shown:
                errs.append(f"{src}: {t.term}: display must show the Arabic in brackets")
            if t.shown and not t.letter and t.shown != t.term:
                errs.append(f"{src}: {t.term}: display shows {t.shown!r}, not the term")
            if t.approved and not APPROVED.match(t.approved):
                errs.append(f"{src}: {t.term}: approved must be a date (YYYY-MM-DD) or \"{PENDING} <date> …\", "
                            f"got {t.approved!r}")
            # A letter's spelled-out name with a Latin respelling (alif) is neither said nor shown in
            # Arabic script (the caption shows the letter), so only what IS said and shown is checked.
            spelled = t.term if (t.arabic_speak or not t.letter) else ""
            arabic = {w for s in (spelled, t.speak, "" if t.letter else (t.shown or "")) for w in ARABIC_WORD.findall(s)}
            hit = sorted(w for w in arabic if forms.quranic_arabic(w))
            if hit:
                errs.append(f"{src}: {t.term}: Qur'anic word {hit[0]!r} (a lesson word or its front) cannot be a term")
            if t.term != "Allah":
                for latin in {t.head, t.speak} - {t.term} if t.arabic_speak else {t.head, t.speak}:
                    if ARABIC.search(latin):
                        continue
                    # A letter's name is said after "huruf" ("huruf lam"), where the guard allows it.
                    found = _guard(t.term, ("huruf " if t.letter else "") + fold(latin), forms, captions=False)
                    if found:
                        errs.append(f"{src}: {t.term}: {found[0].split(': ', 1)[1]} (in its Latin form {latin!r})")
        return errs


def load_lexicon(path: Path = PRONUNCIATION_JSON) -> Lexicon:
    return Lexicon(json.loads(path.read_text(encoding="utf-8")), path.name)


# A heavy letter (tafkhim) in the lesson's Latin spelling, followed by a (fathah or alif): dh ض,
# zh ظ, kh خ, gh غ, sh ص, th ط, q ق. eleven_v3 reads these light and inconsistently (operator
# 2026-10-10, pronunciation rule 2), so a spoken Latin word with one may be RENDERED only from an
# operator-approved respelling, i.e. as a pronunciation.json `speak` value ("mudhof ilaih",
# "idhofah"; added only after the operator approves its sound). Until then the line stays
# caption-only: render_narration.py refuses it, and a line with audio may not contain one.
HEAVY_LATIN = re.compile(r"(?:dh|zh|kh|gh|sh|th|q)a")
# Spoken words whose letters only look heavy (decided here, with the reason).
NOT_HEAVY = {
    "fathatain": "fat-hatain: ta then ha (فَتْحَتَيْن), not tha'",
    # The lesson map's reassurance, in the operator's own words (2026-10-15: "Sekarang Anda tidak
    # perlu menghafal ketiganya …"): the Indonesian prefix meng- then hafal, not ghain.
    "menghafal": "meng-hafal: the prefix's ng, then ha (Indonesian 'to learn by heart'), not غ + a",
}


def heavy_latin(text: str, lex: Lexicon) -> list[str]:
    """The spoken Latin words of `text` with a heavy letter + a that the dictionary does not
    respell, in order of first use (dictionary `speak` values are masked first)."""
    out: list[str] = []
    for k, _a, _b, orig in tokens(lex.mask_spoken(text)):
        if k not in NOT_HEAVY and HEAVY_LATIN.search(k) and orig not in out:
            out.append(orig)
    return out


# Arabic grammar terms, morphological patterns and Arabic example words in the lesson's Latin
# spelling (folded keys: no apostrophe, lower case). Rule 1 (operator 2026-10-10): eleven_v3
# mispronounced Latin "na't", "idhafah", "mudhaf ilaih", so an Arabic term is said from the
# dictionary (Arabic script or a fixed respelling) once the operator has its sound; until then a
# line that says one in Latin is held back (latin_terms): it fails validation when it has audio or
# was authored to be rendered as written (a primer / compose line, a composed word's lead), and
# render_narration.py refuses it. Indonesian words of Arabic origin (harakat, lafaz, huruf, jamak,
# ayat, hukum) are Indonesian, not terms; so are the pesantren verbs built on one (dijarkan,
# menjazmkan, penashab). A term followed by -nya (khabarnya, isimnya) counts.
GRAMMAR_LATIN = {
    # i'rab and its states, the sentence parts
    "irab", "murab", "mabni", "marfu", "manshub", "majrur", "majzum", "raf", "rafa", "nashab", "jar", "jazm",
    "mubtada", "khabar", "fail", "naib", "maful", "bih", "badal", "athaf", "athf", "naat", "nat", "idhafah",
    "mudhaf", "ilaih", "zharaf", "dzaraf", "tamyiz", "mustatsna", "munada", "taukid", "maqul", "qaul",
    # word classes and kinds
    "isim", "fiil", "harf", "amr", "madhi", "mudhari", "majhul", "maushul", "shilah", "mashdar", "mashdariyyah",
    "dhamir", "munfashil", "muttashil", "mustatir", "syan", "nakirah", "marifah", "jamid", "musytaq", "mudzakkar",
    "muannats", "salim", "taksir", "mufrad", "mutsanna", "jumlah", "syibhul", "ismiyyah", "filiyyah", "kana",
    "mahall", "taqdir", "muqaddar", "mutaalliq",
    # morphology
    "wazan", "tashrif", "ilal", "illah", "mubalaghah", "shighat", "sighat", "rubai", "tsulatsi", "mujarrad", "mazid",
    "faala", "falala", "yufalilu", "afala", "ifal", "istafala", "istifal", "faul",
    # marks and reading
    "sukun", "syaddah", "tasydid", "tanwin", "dhammatain", "fathatain", "kasratain", "washal", "washl", "qamariyyah",
    "syamsiyyah", "idgham",
    # rhetoric
    "taqdim", "takhir", "takhshish", "ikhtishash", "hashr",
    # Arabic example words said in Latin (not Qur'anic, but Arabic all the same)
    "naffas", "naffasah", "hada", "nastawinu",
}
# Letter names an Indonesian line also uses as a word: counted only as the letter's name ("ya'").
_LETTER_NEEDS_APOSTROPHE = {"ya"}


def latin_terms(text: str, lex: Lexicon) -> list[str]:
    """The Arabic grammar terms and letter names a spoken text says in Latin, i.e. not from the
    pronunciation dictionary (whose `speak` values are masked first, and the honorifics), in order
    of first use. Heavy-letter words have their own list (heavy_latin)."""
    masked = HONORIFIC_RE.sub(MASK, lex.mask_spoken(text))
    out: list[str] = []
    for k, a, _b, orig in tokens(masked):
        base = k[:-3] if k.endswith("nya") and len(k) > 5 else k
        term = base in GRAMMAR_LATIN or k in GRAMMAR_LATIN
        # "… maka terdengar ba." is the SOUND b + a the primer teaches (operator 2026-10-15), said as an
        # Indonesian syllable, not the letter's name (which the dictionary speaks, بَاء): what follows
        # "terdengar" is heard. Which sounds a line may say there is check_animation_line's (_HEARD).
        heard = _HEARD.search(masked[:a]) is not None and not orig.endswith(("'", "’"))
        letter = base in LETTER_NAMES and not heard and (base not in _LETTER_NEEDS_APOSTROPHE or orig.endswith(("'", "’")))
        if (term or letter) and orig not in out:
            out.append(orig)
    return out


def said_heavy(line: dict) -> list[str]:
    """The named words a caption shows only (heavy letters, named_is_said) that the spoken text
    still says — in their plain spelling or their transliteration — as the caption shows them."""
    text = (line.get("text") if isinstance(line.get("text"), str) else "").lower()
    says = lambda w: re.search(rf"(?<![\w'‘’-]){re.escape(w.lower())}(?![\w'‘’-])", text)  # noqa: E731
    return [m.group("lat") for m in named_unsaid(line.get("display"))
            if says(default_named_speech(m.group("lat"))) or says(fold(m.group("lat")))]


def held_line(line: dict, lex: "Lexicon") -> list[str]:
    """What keeps a manifest line from being rendered: held(text), and a named word with a heavy
    letter that the spoken text says (said_heavy: never said, operator 2026-10-17). A named word
    the caption shows and the text says is said in Latin on purpose — its sound, not a letter's
    name (the part تَ (ta) of an‘amta is "ta", not the letter ta’) — and is masked first, as
    check_renderable masks it (the two read a line alike since 2026-10-17)."""
    text = line.get("text")
    out = held(mask_named_said(text, [s for s, _ in named_in_display(line.get("display"))]), lex) if isinstance(text, str) else []
    return out + [w for w in said_heavy(line) if w not in out]


def held(text: str, lex: Lexicon) -> list[str]:
    """What keeps a spoken line from being rendered: heavy letters without a respelling and Latin
    Arabic terms or letter names the dictionary does not speak (render_narration refuses it)."""
    out = heavy_latin(text, lex)
    return out + [w for w in latin_terms(text, lex) if w not in out]


# ------------------------------------------------------------------ checks
SLUG_ID = re.compile(
    r"^(?P<slug>[a-z-]+):(?P<ayah>0|[1-9]\d*):(?P<part>intro|recite|map:(?:new|again|later|focus|total)|primer:[1-9]\d*|w[1-9]\d*(?::compose:[1-9]\d*)?"
    r"|structure(?::[1-9]\d*)?|concept:[a-z0-9-]+(?::lead|:ex:[1-9]\d*)?|learned"
    r"|ex:(?:" + "|".join(EXERCISE_KEYS) + r"):(?:[a-z][a-z_]+|[1-9]\d*:why)|recap|next|done)(?::(?P<split>[a-z]))?$"
)
SHARED_ID = re.compile(r"^shared:(?P<part>[a-z_]+(?::[a-z-]+:[a-z_]+)?)(?::(?P<split>[a-z]))?$")
HONORIFIC_RE = re.compile("|".join(re.escape(h) for h in HONORIFICS))
QUOTED = re.compile("“[^”]*”")
SHA = re.compile(r"^[0-9a-f]{64}$")


def is_sha(x) -> bool:
    return isinstance(x, str) and SHA.match(x) is not None
KETUK = re.compile(r"\b(?:ketuk|ketuklah|mengetuk|diketuk|ketukan)\b", re.I)
REVIEW = re.compile(r"\b(?:ditinjau|direview|ditelaah|ditashih|tinjauan|review|diperiksa ulang)\b", re.I)
ORDINAL = r"(?:pertama|ke(?:dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas)(?: belas)?)"
_ORD = {"pertama": 1, "kedua": 2, "ketiga": 3, "keempat": 4, "kelima": 5, "keenam": 6, "ketujuh": 7,
        "kedelapan": 8, "kesembilan": 9, "kesepuluh": 10, "kesebelas": 11}


def _letter_context(toks, i: int, text: str) -> bool:
    """`toks[i]` is "lam" naming the letter: "huruf" (or "alif", as in "alif lam", the article) is
    among the four tokens before it, with no sentence end in between."""
    for j in range(max(0, i - 4), i):
        if toks[j][0] in ("huruf", "alif") and not re.search(r"[.!?]", text[toks[j][2]:toks[i][1]]):
            return True
    return False


def _guard(lid: str, text: str, forms: Forms, *, captions: bool) -> list[str]:
    """No Qur'anic word in any spelling. `captions`: the text keeps its quotes (a caption or the
    build's prose), so "Allah" inside “…” is the Indonesian translation; spoken text has none."""
    errs: list[str] = []
    honor = [(m.start(), m.end()) for m in HONORIFIC_RE.finditer(text)]
    quoted = [(m.start(), m.end()) for m in QUOTED.finditer(text)]
    inside = lambda spans, a, b: any(s <= a and b <= e for s, e in spans)  # noqa: E731
    found, toks = forms.mentions(text)
    covered: set[int] = set()
    for start, end, k, _cands, i, n in found:
        covered.update(range(i, i + n))
        if inside(honor, start, end):
            continue
        if k == ("allah",) and captions and (inside(quoted, start, end) or text[end:].startswith(" subhanahu wa ta'ala")):
            continue
        if k in forms.surah_name_keys and i > 0 and toks[i - 1][0] == "surah":
            continue
        if k == ("lam",) and _letter_context(toks, i, text):
            continue
        errs.append(f"{lid}: Qur'anic word {text[start:end]!r} in narration")
    for j, (k, start, end, orig) in enumerate(toks):
        if j in covered or inside(honor, start, end):
            continue
        hit = next((jf for jf in forms.joined if k != jf and k.startswith(jf)), None)
        if hit:
            errs.append(f"{lid}: Qur'anic phrase {orig!r} (starts with {hit!r}) in narration")
            continue
        # The same words in another spelling or with another ending (a'udzu, ash-shirath,
        # rabbu, rabbil, khalaq, maaliki, nakbudu): spelling-blind, ending-blind.
        found_word = found_phrase = None
        for v in spellings(k):
            sk = sound(v)
            st = stem(sk)
            if sk in forms.sound_forms or sk in forms.stems or (st and (st in forms.stems or st in forms.sound_forms)):
                found_word = True
                break
            found_phrase = found_phrase or next((jf for jf in forms.sound_joined if sk != jf and sk.startswith(jf)), None) \
                or next((x for x in forms.wasl if len(x) >= 7 and sk.startswith(x[:7])), None)
        if found_word:
            errs.append(f"{lid}: Qur'anic word {orig!r} (another spelling or ending) in narration")
        elif found_phrase:
            errs.append(f"{lid}: Qur'anic phrase {orig!r} (starts with {found_phrase!r}) in narration")
    return errs


def _places(lid: str, text: str) -> list[str]:
    """How the narration names words: by their place in THIS ayah, which the screen numbers. A
    place in another ayah cannot be found on screen (name it by its meaning instead), a place
    inside a place cannot be followed by ear, and the stage shows no word card to point at."""
    errs = []
    if re.search(rf"\b[Kk]ata {ORDINAL}(?: (?:dan|sampai) {ORDINAL})? (?:di|pada) ayat\b", text):
        errs.append(f"{lid}: names a word of another ayah by its place (say its meaning)")
    if re.search(rf"\b[Kk]ata {ORDINAL} dalam (?:frasa )?kata\b", text):
        errs.append(f"{lid}: a word place inside another word place")
    if ":concept:" in lid and re.match(rf"Konsep baru: [Kk]ata (?:ini|{ORDINAL})\b", text):
        errs.append(f"{lid}: the concept's title became a word place")
    if re.search(r"\bdi kartu ini\b", text):
        errs.append(f"{lid}: refers to a card the lesson stage does not show")
    return errs


def _basic(lid: str, text, max_len: int | None, what: str = "text") -> list[str]:
    if not isinstance(text, str) or not text.strip():
        return [f"{lid}: empty {what}"]
    errs = []
    if text != text.strip() or "  " in text:
        errs.append(f"{lid}: stray whitespace in {what}")
    if max_len is not None and len(text) > max_len:
        errs.append(f"{lid}: {len(text)} characters, more than {max_len} (split it into :a/:b)")
    return errs


def _caps(lid: str, text: str) -> list[str]:
    return [f"{lid}: ALL-CAPS word {m.group()!r}" for m in re.finditer(r"\b[A-Z]{2,}\b", text) if m.group() not in ACRONYMS]


def check_text(lid: str, text, forms: Forms, *, max_len: int | None = MAX_LINE) -> list[str]:
    """Latin narration prose with its quotes (the build's input to `speech`, or a caption with its
    dictionary terms masked): no Arabic, digits, diacritics or Qur'anic words; word places. A named
    word's markup ({{1:1:1/bi}}) stands for the word, which the Speech renders: it is masked here."""
    if isinstance(text, str):
        text = NAMED_REF.sub(MASK, text)
    errs = _basic(lid, text, max_len)
    if errs and errs[0].endswith("empty text"):
        return errs
    if ARABIC.search(text):
        errs.append(f"{lid}: Arabic script in narration")
    if re.search(r"\d", text):
        errs.append(f"{lid}: digit in narration (spell numbers out)")
    odd = sorted({c for c in text if not (" " <= c <= "~") and c not in EXTRA_CHARS and not ARABIC.match(c)})
    if odd:
        if any(unicodedata.category(c) in ("Ll", "Lu") for c in odd) or any(c in APOS for c in odd):
            errs.append(f"{lid}: transliteration diacritic {''.join(odd)!r} (fold to plain letters)")
        else:
            errs.append(f"{lid}: character not allowed {''.join(odd)!r}")
    errs += _caps(lid, text)
    errs += _guard(lid, text, forms, captions=True)
    errs += _places(lid, text)
    return errs


def mask_named_said(text: str, named_said) -> str:
    """The spoken text with its named words masked, in order, once each: the words the caption
    names with their Arabic (named_in_display), and those only."""
    pos = 0
    for said in named_said:
        m = re.compile(rf"(?<![\w'‘’-]){re.escape(said)}(?![\w'‘’-])").search(text, pos)
        if m:
            text = text[:m.start()] + MASK + text[m.end():]
            pos = m.start() + len(MASK)
    return text


def check_spoken(lid: str, text, forms: Forms, lex: Lexicon, named_said=()) -> list[str]:
    """The spoken text, exactly as sent to the voice. `named_said`: what the line's caption names
    with its Arabic (named_in_display), the one place a lesson word may be said in Latin."""
    errs = _basic(lid, text, MAX_LINE)
    if errs and errs[0].endswith("empty text"):
        return errs
    masked = lex.mask_spoken(mask_named_said(text, named_said))
    for w in ARABIC_WORD.findall(masked):
        if forms.quranic_arabic(w):
            errs.append(f"{lid}: Qur'anic word {w!r} (Arabic script) in spoken text")
        else:
            errs.append(f"{lid}: Arabic script in spoken text that is not a pronunciation-dictionary term: {w!r}")
    # On the text with the dictionary's own `speak` values masked: a Latin respelling may hold a
    # term's Latin head ("fi'il mudhori'", the respelling of فِعْل مُضَارِع, holds "fi'il").
    for a, b, t, _cap_ in lex.latin_matches(masked):
        if t.latin.lower() != t.speak.lower():  # alif, alif lam: spoken as the caption writes them
            errs.append(f"{lid}: {masked[a:b]!r} must be spoken from the pronunciation dictionary ({t.speak})")
    if re.search(r"\d", text):
        errs.append(f"{lid}: digit in narration (spell numbers out)")
    odd = sorted({c for c in ARABIC_WORD.sub(MASK, masked) if c not in SPOKEN_CHARS})
    if odd:
        if any(unicodedata.category(c) in ("Ll", "Lu") for c in odd) or any(c in APOS and c != "'" for c in odd):
            errs.append(f"{lid}: transliteration diacritic {''.join(odd)!r} in spoken text (fold to plain letters)")
        else:
            errs.append(f"{lid}: character not allowed in spoken text {''.join(odd)!r} (brackets, quotes, ellipses "
                        "and dashes are normalised away before the render)")
    if re.search(r"\w-(?=[\s,.;:!?]|$)", text):
        errs.append(f"{lid}: spoken text keeps an open prefix")
    if ".." in text:
        errs.append(f"{lid}: spoken text keeps an ellipsis (an open phrase cannot be read aloud)")
    if re.search(r"\b[Dd]i(?=[.;:!?]|$)", text):
        errs.append(f"{lid}: spoken text ends a phrase on a bare “di” (an open prefix cannot be read aloud)")
    errs += _caps(lid, text)
    if KETUK.search(text):
        errs.append(f"{lid}: say “klik” (klik / mengklik / diklik), not “ketuk”")
    if re.search(r"\byang berarti\b", text):
        errs.append(f"{lid}: a meaning is introduced with “yang artinya”, not “yang berarti”")
    if re.search(r"\bfatwa\b", text, re.I):
        errs.append(f"{lid}: the narration does not speak of fatwa (the page footer carries the label)")
    if REVIEW.search(text):
        errs.append(f"{lid}: promises a human review")
    errs += _guard(lid, masked, forms, captions=False)
    errs += _places(lid, masked)
    return errs


def check_display(lid: str, display, text, forms: Forms, lex: Lexicon, focus_ar: str | None,
                  named: "Named | None" = None) -> list[str]:
    """The caption: what is spoken, dictionary terms in display form, letters as in the ayah, a
    named word as the content writes it (`named`: Named; without it, any named word fails)."""
    errs = _basic(lid, display, None, "display")
    if errs and errs[0].endswith("empty display"):
        return errs
    for m in NAMED_SHOWN.finditer(display):
        if named is None or m.group() not in named.pairs:
            errs.append(f"{lid}: caption names {m.group()!r}, which is no lesson word or composition form with its "
                        "transliteration (content bytes only, never typed: the markup {{s:a:w}} or {{s:a:w/form}})")
    # A word named only by its meaning (operator 2026-10-17: "should also mention the arabic word not
    # only artinya. apply this in similar sentences"): "kata yang artinya “jalan”" shows nothing of
    # the word; name it ({{s:a:w}}: "kata ٱلصِّرَٰطَ (aṣ-ṣirāṭa) yang artinya “jalan”"). A phrase may still
    # be named by its meaning ("frasa yang artinya …").
    if MEANING_ONLY.search(display):
        errs.append(f"{lid}: names a word only by its meaning ({MEANING_ONLY.search(display).group()!r}): show the word "
                    "itself, its Arabic from the content and its transliteration (the markup {{s:a:w}} or {{s:a:w/form}})")
    m = PLACE_MEANING.search(display)
    if m:
        errs.append(f"{lid}: names a word by its place and meaning only ({m.group()!r}): show and say the word itself "
                    "too, “kata ketiga, yaitu <the word>, yang artinya …” (rule 26; the markup {{s:a:w}})")
    if ":compose:" in lid:
        for seg in part_meaning_only(display):
            errs.append(f"{lid}: names a part by its kind and meaning only ({seg!r} … artinya): show and say the part "
                        "itself, “isim, yaitu <the form>, yang artinya …” (the frame's tile, the markup {{s:a:w/form}}; "
                        "operator 2026-10-17)")
    for w in named_twice(display):
        errs.append(f"{lid}: names {w!r} twice in one line: name it once (“Kata ini adalah …” after the word line's "
                    "“Kata pertama, yaitu …”; operator 2026-10-17)")
    for ref in back_references(lid, display):
        errs.append(f"{lid}: points back at an earlier ayah ({ref!r}): remove the comparison, keep the sentence "
                    "complete (rule 29, operator 2026-10-17); an earlier ayah is named only for a dependency, "
                    "“Ayat ini melanjutkan ayat …” or “<the named word> di ayat …” in a line that says it "
                    "(na’t / badal / ‘athaf / bergantung …: rule 8, 2026-10-18)")
    # The operator's wording (README "Operator's lesson-wording rules"): what a later ayah teaches is
    # "baru akan diajarkan lebih lengkap di ayat …" (2026-10-17), not "kita pelajari / bahas di
    # ayat …"; a grammatical estimate is what "para ulama memahaminya (antara lain) sebagai …"
    # (2026-10-15), not "memperkirakannya" — and never "menafsirkan" (tafsir is not taqdir).
    m = LATER_WORDING.search(display)
    if m:
        errs.append(f"{lid}: says {m.group()!r} of what a later ayah teaches: say “baru akan diajarkan lebih lengkap di "
                    "ayat …” (operator 2026-10-17)")
    m = ESTIMATE_WORDING.search(display)
    if m:
        errs.append(f"{lid}: says {m.group()!r}: say “para ulama memahaminya (antara lain) sebagai …” (operator 2026-10-15)")
    whole = display
    display = lex.unnamed(display)  # the checks below are the terms' and the letters'; named words were checked above
    # The display forms of the other terms (the article "alif lam (ال)" holds the name lam).
    held_by = [(m.start(), m.end()) for m in lex.display_rx.finditer(display) if not lex._groups[m.lastgroup].bare]
    for t in lex.terms:
        # A letter's NAME as a whole Arabic word: لَام inside كَلَام (kalam, 2026-10-15) is not the letter lam.
        if t.letter and re.search(rf"(?<![؀-ۿ]){re.escape(t.term)}(?![؀-ۿ])", display):
            errs.append(f"{lid}: caption shows the letter {t.head} by its name ({t.term}); show it as in the ayah "
                        f"({lex.shown_letter(t, focus_ar)})")
        # … nor its Latin name beside it: a single letter is shown alone (Term.bare; operator 2026-10-17).
        beside = [x for x in re.finditer(rf"(?<![\w'‘’]){letter_name_rx(t)} \([{AR_LETTERS}]+\)", display)
                  if not any(a <= x.start() < b for a, b in held_by)] if t.bare else []
        if beside:
            errs.append(f"{lid}: caption names the letter in Latin beside it ({beside[0].group()!r}); show the letter alone, "
                        f"as on screen: {lex.shown_letter(t, focus_ar)} (operator 2026-10-17)")
    for m in lex.display_rx.finditer(display):
        t = lex._groups[m.lastgroup]
        if t.letter:
            want = lex.shown_letter(t, focus_ar)
            got = m.group() if t.bare else m.group()[m.group().index("(") + 1:-1]
            if got != want:
                errs.append(f"{lid}: caption shows {m.group()!r}; the letter as in the ayah is {want}")
    masked = lex.mask_display(display)
    if ARABIC.search(masked):
        errs.append(f"{lid}: Arabic script in the caption that is not a dictionary display form")
    errs += [e.replace(" in narration", " in caption") for e in check_text(lid, masked, forms, max_len=None)
             if not e.endswith("Arabic script in narration")]
    if isinstance(text, str):
        said = lex.speech_of_display(whole)
        if said != text:
            errs.append(f"{lid}: display does not say what is spoken (spoken form of the display: {said!r})")
    return errs


def ordinal_value(word: str) -> int:
    """pertama → 1, kedua belas → 12 (the ordinals build_narration.ordinal writes)."""
    if word.endswith(" belas"):
        return _ORD[word[:-len(" belas")]] + 10
    return _ORD[word]


def word_places(text: str) -> list[int]:
    """Word places a line names in its own ayah ("kata kedua", "kata ketiga dan keempat", "kata
    kedua sampai keempat"), in order of first mention. Mirrors wordRefs() in
    src/lib/autoplay/narration.ts."""
    out: list[int] = []
    for m in re.finditer(rf"\b[Kk]ata ({ORDINAL})(?: (dan|sampai) ({ORDINAL}))?\b", text):
        if re.match(r" (?:di|pada) ayat\b", text[m.end():]):
            continue  # another ayah's word (the validator rejects these anyway)
        a = ordinal_value(m.group(1))
        b = ordinal_value(m.group(3)) if m.group(3) else None
        ns = [a] if b is None else ([a, b] if m.group(2) == "dan" else list(range(a, b + 1)))
        out += [n for n in ns if n not in out]
    return out


def check_audio(lid: str, audio, manifest_slug: str, voice, text) -> list[str]:
    if not isinstance(audio, dict) or set(audio) != {"url", "ms", "sha256"}:
        return [f"{lid}: audio must be exactly {{url, ms, sha256}}"]
    errs = []
    url = audio["url"]
    if not isinstance(url, str) or not url.startswith(MEDIA_PREFIX) or ".." in url or not url.endswith(".mp3"):
        errs.append(f"{lid}: audio url must be an .mp3 under {MEDIA_PREFIX}")
    elif isinstance(voice, dict) and isinstance(voice.get("name"), str) and isinstance(voice.get("id"), str) \
            and isinstance(text, str) and is_sha(audio["sha256"]):
        # The url, the text and the sha256 are bound together by the name (delivery_name), so this
        # one comparison needs no audio file: CI has neither the masters nor the delivered files.
        want = delivery_url(voice, manifest_slug, text, audio["sha256"])
        if url == master_url(voice, manifest_slug, text):
            errs.append(f"{lid}: audio url {url!r} is the name of the {OUTPUT_FORMAT} master, not of the delivered file "
                        f"({DELIVERY_FORMAT}): run encode_narration.py")
        elif url != want:
            errs.append(f"{lid}: audio url {url!r} is not {want!r} (the file is named by the spoken text, voice and "
                        f"settings, the delivery format {DELIVERY_FORMAT} and the sha256 of its bytes: a changed line "
                        "needs a new render, a changed file a new name)")
    if not isinstance(audio["ms"], int) or isinstance(audio["ms"], bool) or audio["ms"] <= 0:
        errs.append(f"{lid}: audio ms must be a positive integer")
    if not is_sha(audio["sha256"]):
        errs.append(f"{lid}: audio sha256 must be 64 lower-case hex characters")
    return errs


def is_delivery(audio, voice: dict, manifest_slug: str, text: str) -> bool:
    """Whether `audio` is the delivered file of this spoken text: its url is the delivery name of the
    text and of its own sha256 (what check_audio asks of a manifest line)."""
    return (isinstance(audio, dict) and is_sha(audio.get("sha256"))
            and audio.get("url") == delivery_url(voice, manifest_slug, text, audio["sha256"]))


# A take ElevenLabs CUT SHORT (operator 2026-10-17, on al-fatihah:0:primer:1: "the voice is cut
# slightly before the sentence finished"): the master itself ends before its own alignment does —
# 4.049 s of audio, its last letter (the b of "Arab") aligned to end at 4.16 s — so the cut is in
# what ElevenLabs returned, not in our encode (which keeps the length: 0 ms drift on every file).
# Measured over the 460 rendered lines of 2026-10-17: every whole take ends 26–51 ms AFTER its last
# token (the last MP3 frame; three lines end 0.5–0.9 s after it, on trailing silence), and exactly
# two end before it, by 111 ms (al-fatihah:0:primer:1) and 131 ms (al-fatihah:4:w1:compose:2). So a
# take may end at most CUT_TOLERANCE_MS before its last token does — less than one 26.1 ms MP3
# frame and under two 11.6 ms alignment steps: rounding, not speech — and anything more is a cut
# take. It is held to this everywhere: validate_narration (a manifest line, check_tokens),
# build_narration.manifest (a cut take is not carried over: the line plays caption-only until it is
# rendered again), encode_narration.deliver and render_narration.py (a fresh take that is cut is
# refused and kept aside, never put in the master's place or in a manifest).
CUT_TOLERANCE_MS = 20


def cut_ms(tokens, ms) -> int:
    """How many milliseconds of a take's alignment lie past the end of its audio of `ms`: its last
    token's end minus the length (≤ 0: the audio holds every word; > CUT_TOLERANCE_MS: cut)."""
    return round(max(tk["e"] for tk in tokens) * 1000 - ms)


def is_cut(tokens, ms) -> bool:
    """Whether a take whose audio is `ms` long was cut short of its own alignment (`tokens`, or any
    list of {e: seconds}); False when there is nothing to tell (no tokens, no length)."""
    try:
        return bool(tokens) and cut_ms(tokens, ms) > CUT_TOLERANCE_MS
    except (TypeError, KeyError, ValueError):
        return False


def check_tokens(lid: str, toks, audio, text, lex: Lexicon, focus_ar: str | None, named=(), cuts=()) -> list[str]:
    if not isinstance(toks, list) or not toks:
        return [f"{lid}: tokens must be a non-empty list of {{t, s, e}}"]
    errs = []
    num = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)  # noqa: E731
    prev = 0.0
    for i, tk in enumerate(toks):
        if not isinstance(tk, dict) or set(tk) != {"t", "s", "e"} or not isinstance(tk["t"], str) or not tk["t"].strip() \
                or tk["t"] != tk["t"].strip() or not num(tk["s"]) or not num(tk["e"]):
            return errs + [f"{lid}: token {i} must be {{t: text, s: start, e: end}}"]
        if tk["s"] < 0 or tk["e"] < tk["s"]:
            errs.append(f"{lid}: token {i} ({tk['t']!r}) ends before it starts")
        if tk["s"] < prev:
            errs.append(f"{lid}: token {i} ({tk['t']!r}) starts before the token before it")
        prev = tk["s"]
    if isinstance(audio, dict) and isinstance(audio.get("ms"), int) and not isinstance(audio["ms"], bool) \
            and is_cut(toks, audio["ms"]):
        errs.append(f"{lid}: tokens run past the end of the audio: the take is cut, its last word ends "
                    f"{cut_ms(toks, audio['ms'])} ms after the file does (a whole take ends after its last word; at most "
                    f"{CUT_TOLERANCE_MS} ms the other way is rounding). Render the line again (render_narration.py: a cut "
                    "take is refused, a new one is checked before it is kept)")
    if isinstance(text, str):
        joined, want = " ".join(tk["t"] for tk in toks), lex.render_display(text, focus_ar, named, cuts)
        if joined != want:
            errs.append(f"{lid}: tokens do not join to the display rendering of the spoken text ({joined!r} ≠ {want!r})")
        else:
            # … and are its karaoke words one by one: a shown-only piece beside a word that already
            # shows Arabic is a word of its own (token_entries), with that word's timing exactly.
            entries = lex.token_entries(text, focus_ar, named, cuts)
            if [tk["t"] for tk in toks] != [t for t, _i in entries]:
                errs.append(f"{lid}: tokens are not the karaoke words of the spoken text ({[tk['t'] for tk in toks]!r} ≠ "
                            f"{[t for t, _i in entries]!r}): a karaoke word holds at most one Arabic unit, at its end — a "
                            "shown-only piece beside a word that shows Arabic is a token of its own (build_narration.py)")
            else:
                own: dict[int, tuple] = {}
                for tk, (_t, i) in zip(toks, entries):
                    if own.setdefault(i, (tk["s"], tk["e"])) != (tk["s"], tk["e"]):
                        errs.append(f"{lid}: token {tk['t']!r}, a shown-only piece, does not have the timing of the "
                                    f"word it is shown with ({own[i]}): no time is made up")
    return errs


def _split_groups(ids: list[str], rx: re.Pattern, name: str) -> tuple[dict[str, list[str]], list[str]]:
    """base id → split letters ([] = unsplit); plus id-format errors."""
    errs: list[str] = []
    groups: dict[str, list[str]] = {}
    for lid in ids:
        m = rx.match(lid)
        if not m:
            errs.append(f"{name}: id {lid!r} does not follow the step-id contract")
            continue
        base = lid[:-2] if m.group("split") else lid
        groups.setdefault(base, [])
        if m.group("split"):
            groups[base].append(m.group("split"))
    for base, letters in groups.items():
        if letters:
            if base in ids:
                errs.append(f"{name}: {base!r} exists both whole and split")
            want = [chr(ord("a") + i) for i in range(len(letters))]
            if letters != want or len(letters) < 2:
                errs.append(f"{name}: split parts of {base!r} must be :a, :b, … in order (got {letters})")
    return groups, errs


LINE_KEYS = {"text", "display", "highlight", "focus"}
LINE_OPTIONAL = {"frame", "audio", "tokens"}
# Letter names (build_narration.ARABIC_LETTER_NAME, folded): a primer / compose line may say them
# although a tile's transliteration is the same syllable ("ba" of بَ is the letter's name).
LETTER_NAMES = {"alif", "ba", "ta", "tsa", "jim", "ha", "kha", "dal", "dzal", "ra", "zai", "sin", "syin", "shad",
                "dhad", "tha", "zha", "ain", "ghain", "fa", "qaf", "kaf", "lam", "mim", "nun", "wawu", "hamzah", "ya"}


def animation_of(ayah: dict | None, part: str, compose: dict | None) -> dict | None:
    """The composition (or primer) whose frames a line plays over."""
    if ayah is None:
        return None
    m = COMPOSE_PART.fullmatch(part)
    if m:
        n = int(m.group(1))
        return composition_of(compose, ayah["words"][n - 1]["loc"]) if n <= len(ayah["words"]) else None
    return primer_of(compose, ayah["ayah"]) if PRIMER_PART.fullmatch(part) else None


def tile_syllables(anim: dict, *, articles: bool = True) -> set[str]:
    """Every syllable the animation's tiles show in transliteration (bi, ismu, ismi, ar, raḥmānu…),
    folded: shown on screen, never spoken (the narrator says vowel sounds, letter names and terms;
    the imam recites the word). `articles=False` leaves out the article's spellings (al, ar, …),
    which another word's line may say inside a name (as-Samin al-Halabi)."""
    out = set()
    for f in (anim.get("forms") or {}).values():
        for k, *_ in tokens(fold(str(f.get("translit") or ""))):
            if len(k) >= 2 and k not in LETTER_NAMES and (articles or k not in ARTICLES):
                out.add(k)
    return out


def ayah_syllables(ayah: dict, compose: dict | None, own: dict | None) -> set[str]:
    """What no primer / compose line of this ayah may say: the syllables of its own animation's
    tiles, and of every other composition (and the primer) of the same ayah — a later word that
    reuses a form ("hum" of word 4, said in word 7) is still shown on screen in this lesson."""
    out = tile_syllables(own) if own else set()
    units = [composition_of(compose, w["loc"]) for w in ayah["words"]] + [primer_of(compose, ayah["ayah"])]
    for u in units:
        if u is not None and u is not own:
            out |= tile_syllables(u, articles=False)
    return out


# "Huruf ba' … dibaca ba": a letter's NAME read as the sound of a syllable (the screen shows bi / ba).
_READ_AS = re.compile(r"\bdibaca ([^\s,.;:!?]+)")
# The one place a syllable a tile shows is said (operator 2026-10-15: "Contohnya huruf ba'" over ب, then
# "jika dibaca kasrah, maka terdengar bi" over بِ): a PRIMER line over a `mark` frame says the sound of
# that frame's own example — one letter with one short vowel and nothing else (بَ بِ بُ: ba, bi, bu) —
# right after "terdengar". Not a word of the Qur'an: the sound a harakah gives a letter, which is what
# the primer teaches. Anywhere else, and for any longer form (rra, mā), the rule stands.
_HEARD = re.compile(r"\bterdengar $")
PRIMER_SOUND_VOWELS = ("fathah", "kasrah", "dhammah")


def primer_sounds(anim: dict | None, frame) -> set[str]:
    """The syllables a primer line may say after "terdengar" over `frame` (1-based): the folded
    transliteration of each tile of that `mark` frame that is one letter with one short vowel."""
    frames = (anim or {}).get("frames") or []
    if not isinstance(frame, int) or isinstance(frame, bool) or not 1 <= frame <= len(frames):
        return set()
    fr = frames[frame - 1]
    if fr.get("stage") != "mark":
        return set()
    out = set()
    for t in fr.get("tiles") or []:
        f = ((anim or {}).get("forms") or {}).get(t) or {}
        ps = COMPOSE.pieces(str(f.get("ar") or ""))
        if len(ps) == 1 and COMPOSE.marks_of(ps[0]) in ([m] for m in PRIMER_SOUND_VOWELS):
            out.add(key(str(f.get("translit") or "")))
    return out


def check_animation_line(lid: str, line: dict, ayah: dict | None, part: str, compose: dict | None, lex: "Lexicon",
                         split: bool) -> list[str]:
    """Rules of a primer / compose line (module docstring)."""
    anim = animation_of(ayah, part, compose)
    if anim is None:
        return []
    errs = []
    if split:
        errs.append(f"{lid}: a primer / compose line is never split (shorten its `say` or make it two)")
    display = line.get("display")
    if isinstance(display, str) and len(display) > COMPOSE.MAX_DISPLAY:
        errs.append(f"{lid}: caption of {len(display)} characters, more than {COMPOSE.MAX_DISPLAY} beside the "
                    "animation (split the `say` into two lines)")
    banned = ayah_syllables(ayah, compose, anim)
    text = line.get("text")
    if isinstance(text, str):
        # A word the caption names with its Arabic (named_in_display) is said on purpose there.
        masked = HONORIFIC_RE.sub(MASK, lex.mask_spoken(mask_named_said(text, [s for s, _ in named_in_display(display)])))
        heard = primer_sounds(anim, line.get("frame")) if PRIMER_PART.fullmatch(part) else set()
        said = [orig for k, a, _b, orig in tokens(masked)
                if (k in banned or sound(k) in banned) and not (k in heard and _HEARD.search(masked[:a]))]
        if said:
            errs.append(f"{lid}: says {said[0]!r}, a syllable the tiles show in transliteration (the narrator names "
                        "letters and sounds; the imam recites the word)")
        letter_speak = {t.speak for t in lex.terms if t.letter}
        for m in _READ_AS.finditer(text):
            w = m.group(1)
            if w in letter_speak or key(w) in LETTER_NAMES:
                errs.append(f"{lid}: reads a letter's name as a sound (“dibaca {w}”): say the sound, “bunyi a”")
    return errs


EX_WHY_PART = re.compile(r"ex:(why-harakat|sort-case|label-role):([1-9]\d*):why")


def why_basic_word(ayah: dict | None, part: str, quiz: dict | None) -> dict | None:
    """The word whose `why_basic` a line says (build_narration.said_why), or None: the word line
    of a word that has one, or the explanation of a quiz question about such a word."""
    if ayah is None:
        return None
    words = ayah["words"]
    m = re.fullmatch(r"w([1-9]\d*)", part)
    if m:
        n = int(m.group(1))
    else:
        m = EX_WHY_PART.fullmatch(part)
        if not m:
            return None
        ex = next((x for x in QUIZ.ayah_plan(quiz, ayah["ayah"]) if x["key"] == m.group(1)), None)
        q = next((x for x in (ex or {}).get("questions") or [] if x["n"] == int(m.group(2))), None)
        n = q.get("word") if q else None
    w = words[n - 1] if isinstance(n, int) and 1 <= n <= len(words) else None
    return w if w and w.get("why_basic") else None


def authored(ayah: dict | None, part: str, compose: dict | None, quiz: dict | None = None) -> bool:
    """A line written to be rendered as it stands (operator 2026-10-10: these lines are voiced right
    after they are written): a primer / compose line, the word line of a composed word (its
    gloss and the composition's lead), an item of the ayah's structure (2026-10-13: its `say`
    is spoken as authored, like a composition's), or a line that says a word's `why_basic` (the
    reason written for the narrator: a quiz explanation, the word line of a word without a
    composition)."""
    if ayah is None:
        return False
    if animation_of(ayah, part, compose) is not None:
        return True
    k = STRUCTURE_ITEM.fullmatch(part)
    if k:
        return int(k.group(1)) <= len(structure_items(ayah))
    if why_basic_word(ayah, part, quiz) is not None:
        return True
    m = re.fullmatch(r"w([1-9]\d*)", part)
    return bool(m) and int(m.group(1)) <= len(ayah["words"]) and \
        composition_of(compose, ayah["words"][int(m.group(1)) - 1]["loc"]) is not None


def check_renderable(lid: str, line: dict, ayah: dict | None, part: str, compose: dict | None, lex: "Lexicon",
                     quiz: dict | None = None) -> list[str]:
    """An authored line, and any line with audio, says every Arabic term from the dictionary: no
    Latin grammar term or letter name (rule 1), no heavy letter + a without its respelling (rule 9)."""
    text = line.get("text")
    if not isinstance(text, str) or not ("audio" in line or authored(ayah, part, compose, quiz)):
        return []
    # A named word is said in Latin on purpose; one whose sound waits for the operator holds the
    # line (said_heavy: an error of check_manifest, refused by render_narration.py), not this check's.
    text = mask_named_said(text, [s for s, _ in named_in_display(line.get("display"))])
    errs = [f"{lid}: says {w!r} in Latin, an Arabic term or letter name the pronunciation dictionary does not "
            "speak (rule 1: add it to pronunciation.json, or say it in plain Indonesian)" for w in latin_terms(text, lex)]
    if "audio" not in line:
        errs += [f"{lid}: says {w!r}, a heavy letter + a with no approved respelling (rule 9), in a line written to "
                 "be rendered" for w in heavy_latin(text, lex)]
    return errs


def check_view(lid: str, line: dict, ayah: dict | None, part: str, compose: dict | None = None,
               curriculum: dict | None = None) -> list[str]:
    errs = []
    hl, focus = line.get("highlight"), line.get("focus")
    n = len(ayah["words"]) if ayah else 0
    if not isinstance(hl, list) or not all(isinstance(x, int) and not isinstance(x, bool) for x in hl):
        return [f"{lid}: highlight must be a list of word numbers"]
    if hl != sorted(set(hl)) or (0 in hl and hl != [0]) or any(x < 0 or x > n for x in hl):
        errs.append(f"{lid}: highlight {hl} must be [0] (the whole ayah), [] or word numbers 1–{n} in order")
    if focus is not None and (not isinstance(focus, str) or not ayah or focus not in {w["loc"] for w in ayah["words"]}):
        errs.append(f"{lid}: focus {focus!r} is not a word of this ayah")
    want_hl, want_focus = line_view(ayah, part, compose, curriculum)
    if not errs and (hl != want_hl or focus != want_focus):
        errs.append(f"{lid}: highlight/focus {hl}/{focus!r} is not what the stage shows for this step "
                    f"({want_hl}/{want_focus!r})")
    want_frame = line_frame(ayah, part, compose)
    if line.get("frame") != want_frame or ("frame" in line) != (want_frame is not None):
        errs.append(f"{lid}: frame {line.get('frame')!r} is not the animation frame this line plays over "
                    f"({want_frame!r}; only primer / compose lines have one)")
    return errs


def check_manifest(name: str, man, forms: Forms, lesson: dict | None, library: dict, lex: Lexicon,
                   compose: dict | None = None, quiz: dict | None = None, lessonmap: dict | None = None,
                   curriculum: dict | None = None, named: "Named | None" = None) -> list[str]:
    errs: list[str] = []
    curriculum = load_curriculum() if curriculum is None else curriculum
    if not isinstance(man, dict) or set(man) != {"version", "voice", "lines"}:
        return [f"{name}: manifest must be exactly {{version, voice, lines}}"]
    if man["version"] != MANIFEST_VERSION:
        errs.append(f"{name}: version must be {MANIFEST_VERSION}")
    voice = man["voice"]
    if voice is not None:
        if (not isinstance(voice, dict) or set(voice) != {"id", "name", "model"}
                or not all(isinstance(voice[k], str) and voice[k].strip() for k in ("id", "name", "model"))):
            errs.append(f"{name}: voice must be null or {{id, name, model}} strings")
        elif voice["model"] != MODEL:
            errs.append(f"{name}: voice model {voice['model']!r} is not the house standard {MODEL}")
    lines = man["lines"]
    if not isinstance(lines, dict) or not lines:
        return errs + [f"{name}: lines must be a non-empty object"]
    slug = name
    rx = SHARED_ID if name == "shared" else SLUG_ID
    groups, gerrs = _split_groups(list(lines), rx, name)
    errs += gerrs
    # A line split into :a, :b, … is one text: a word is named once in it all (named_twice).
    for base, letters in groups.items():
        parts = [lines.get(f"{base}:{x}") for x in letters]
        if len(parts) > 1 and all(isinstance(p, dict) and isinstance(p.get("display"), str) for p in parts):
            for w in named_twice(" ".join(p["display"] for p in parts)):
                if not any(w in named_twice(p["display"]) for p in parts):
                    errs.append(f"{base}: names {w!r} in more than one of its parts ({', '.join(letters)}): one line "
                                "names a word once (operator 2026-10-17)")
    ayat = {a["ayah"]: a for a in lesson_ayat(lesson, compose)}
    for lid, line in lines.items():
        if not isinstance(line, dict) or not LINE_KEYS <= set(line) or set(line) - LINE_KEYS - LINE_OPTIONAL:
            errs.append(f"{lid}: a line is {{text, display, highlight, focus, frame?, audio?, tokens?}}")
            continue
        m = rx.match(lid)
        ayah, part = None, (m.group("part") if m else "")
        if name != "shared" and m:
            if m.group("slug") != slug:
                errs.append(f"{lid}: id belongs to {m.group('slug')!r}, not {slug!r}")
            ayah = ayat.get(int(m.group("ayah")))
        focus = line["focus"] if isinstance(line.get("focus"), str) else None
        focus_ar = line_letters(ayah, part, focus, forms, compose, library)
        names = named_in_display(line["display"])
        for w in said_heavy(line):
            errs.append(f"{lid}: says the heavy-letter word {w!r}: a word with ص ض ط ظ ق خ غ is shown and explained, never "
                        "said (operator 2026-10-17; named_is_said, its markup {{!s:a:w}})")
        errs += check_spoken(lid, line["text"], forms, lex, [said for said, _shown in names])
        errs += check_display(lid, line["display"], line["text"], forms, lex, focus_ar, named)
        if m and (name == "shared" or ayah is not None):
            errs += check_view(lid, line, ayah, part, compose, curriculum)
            errs += check_animation_line(lid, line, ayah, part, compose, lex, bool(m.group("split")))
            errs += check_renderable(lid, line, ayah, part, compose, lex, quiz)
            if part in MAP_PARTS and m.group("split"):
                errs.append(f"{lid}: a map / learned line is never split (one line with its card: name fewer concepts)")
            if STRUCTURE_ITEM.fullmatch(part) and m.group("split"):
                errs.append(f"{lid}: a structure item is never split (one item, one line: shorten its `say` or make it two items)")
        if "audio" in line:
            if voice is None:
                errs.append(f"{lid}: audio present but the manifest names no voice")
            if isinstance(line["text"], str):
                for w in heavy_latin(mask_named_said(line["text"], [said for said, _shown in names]), lex):
                    errs.append(f"{lid}: rendered with {w!r}, a heavy letter + a with no approved respelling in "
                                "pronunciation.json")
            errs += check_audio(lid, line["audio"], slug, voice, line["text"])
            if "tokens" not in line:
                errs.append(f"{lid}: audio without tokens (render with /with-timestamps)")
        if "tokens" in line:
            if "audio" not in line:
                errs.append(f"{lid}: tokens without audio")
            errs += check_tokens(lid, line["tokens"], line.get("audio"), line["text"], lex, focus_ar, names,
                                 lex.text_cuts(line["display"]))
    # coverage
    if name == "shared":
        want = {f"shared:{k}" for k in expected_shared()}
        have = set(groups)
        for lid in sorted(want - have):
            errs.append(f"shared: missing line {lid}")
        for lid in sorted(have - want):
            errs.append(f"shared: unexpected line {lid}")
    elif lesson is not None:
        want = {f"{slug}:{n}:{p}" for n, parts in expected_parts(lesson, library, compose, quiz, lessonmap, curriculum).items() for p in parts}
        have = set(groups)
        for lid in sorted(want - have):
            errs.append(f"{name}: missing line {lid}")
        for lid in sorted(have - want):
            errs.append(f"{name}: unexpected line {lid}")
        errs += check_content(name, lines, lesson, lex)
        if lessonmap is not None:
            errs += map_problems(name, lines, lesson, lessonmap, curriculum)
    return errs


def _field_of(lines: dict, base: str, field: str) -> str:
    """A line's field, its split parts joined."""
    if base in lines:
        return str(lines[base].get(field, "")) if isinstance(lines[base], dict) else ""
    parts = [str(lines[k].get(field, "")) for k in sorted(lines) if k.startswith(base + ":") and len(k) == len(base) + 2
             and isinstance(lines[k], dict)]
    return " ".join(parts)


def _says(text: str, phrase: str) -> bool:
    """`phrase`'s words, in order and contiguous, among the words of `text`."""
    t, p = keys_of(text), keys_of(phrase)
    return bool(p) and any(t[i:i + len(p)] == p for i in range(len(t) - len(p) + 1))


def check_content(name: str, lines: dict, lesson: dict, lex: Lexicon) -> list[str]:
    """The intro reads the ayah's translation and each w${n} line gives the word's gloss (in the
    caption in quotes, in the spoken text as said); no line names a place past the ayah's words."""
    errs = []
    for a in lesson["ayat"]:
        base = f"{lesson['slug']}:{a['ayah']}"
        tr = fold(spoken_translation(a["translation"]["text"]))
        shown, said = _field_of(lines, f"{base}:intro", "display"), _field_of(lines, f"{base}:intro", "text")
        if (shown and f"“{tr}”" not in shown) or (said and not _says(said, lex.speech_of_display(tr))):
            errs.append(f"{base}:intro: does not read the translation “{tr}”")
        for i, w in enumerate(a["words"], 1):
            g = fold(w["gloss"])
            shown, said = _field_of(lines, f"{base}:w{i}", "display"), _field_of(lines, f"{base}:w{i}", "text")
            if (shown and f"“{g}”" not in shown) or (said and not _says(said, lex.speech_of_display(g))):
                errs.append(f"{base}:w{i}: does not give the gloss “{g}”")
        n = len(a["words"])
        for lid in lines:
            if lid.startswith(base + ":") and isinstance(lines[lid], dict):
                over = [p for p in word_places(str(lines[lid].get("text", ""))) if p > n]
                if over:
                    errs.append(f"{lid}: names word {over[0]} of an ayah with {n} words")
    return errs


# ------------------------------------------------------------------ what the map's two lines say
_UNIT = {w: i for i, w in enumerate(("nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan",
                                    "sepuluh", "sebelas"))}


def count_value(words: str) -> int | None:
    """A count as the narration writes it (build_narration.num_id), 0 – 99: "tiga" → 3, "dua belas"
    → 12, "dua puluh satu" → 21; None for anything else."""
    t = words.split()
    if len(t) == 1:
        return _UNIT.get(t[0])
    if len(t) == 2 and t[1] == "belas" and 2 <= _UNIT.get(t[0], 0) <= 9:
        return _UNIT[t[0]] + 10
    if len(t) in (2, 3) and t[1] == "puluh" and 2 <= _UNIT.get(t[0], 0) <= 9 and (len(t) == 2 or 1 <= _UNIT.get(t[2], 0) <= 9):
        return _UNIT[t[0]] * 10 + (_UNIT[t[2]] if len(t) == 3 else 0)
    return None


_MAP_JOIN = re.compile(r", serta |, dan | serta | dan |, ")
_MAP_PLACE = re.compile(rf" di ayat ({ORDINAL})")
_MAP_NEW = re.compile(r"^Di ayat ini ada (?P<n>[a-z ]+?) hal baru: (?P<list>.+)\.$")
_MAP_NONE = "Di ayat ini tidak ada hal baru."
# The opening's learnt-so-far line, removed 2026-10-17 (operator: "better to remove this line in
# every ayat beginning"): a line of this shape anywhere fails; the count is map:total's alone.
_MAP_SOFAR_SAID = re.compile(r"\bSebelum ayat ini, kita sudah mempelajari\b")
# "map:again": every step met again by name — or, plainly, none. The shapes of before ("ada satu:
# X", "ada tiga, di antaranya X dan Y") are read too, so a line in them fails with its reason.
_MAP_AGAIN_LEAD = "Dari yang sudah kita pelajari, yang kita temui lagi di ayat ini adalah"
_MAP_AGAIN = re.compile(rf"^{_MAP_AGAIN_LEAD} (?P<list>.+)\.$")
# … as it was worded after the learnt-so-far line, which it no longer follows.
_MAP_AGAIN_BARE = re.compile(r"^Yang kita temui lagi di ayat ini adalah .+\.$")
_MAP_AGAIN_OLD = re.compile(r"^(?:Dari yang sudah kita pelajari, yang|Yang) kita temui lagi di ayat ini ada [a-z ]+?(?:, di antaranya|:) .+\.$")
_MAP_NOT_AGAIN = "Tidak ada yang kita temui lagi di ayat ini."
_MAP_LATER = re.compile(rf"^Ada (?P<n>[a-z ]+?) hal lagi di ayat ini, (?P<some>di antaranya|yaitu) (?P<list>.+), tetapi baru akan "
                        rf"diajarkan lebih lengkap (?:di ayat (?P<ayah>{ORDINAL})|nanti)\.$")
_MAP_LATER_EACH = re.compile(r"^Ada (?P<n>[a-z ]+?) hal lagi di ayat ini, tetapi baru akan diajarkan lebih lengkap nanti: (?P<list>.+)\.$")
_MAP_LANJUT = re.compile(r"^(?P<lead>Ada juga|Di ayat ini ada) (?P<n>[a-z ]+?) hal tingkat lanjut, yang tidak kita bahas di "
                         r"tingkat dasar\.$")
# The same sentence with something between the count and its end: a next-level topic named.
_MAP_LANJUT_MORE = re.compile(r"^(?:Ada juga|Di ayat ini ada) [a-z ]+? hal tingkat lanjut(?P<more>.+), yang tidak kita bahas di "
                              r"tingkat dasar\.$")
# "map:focus" (operator 2026-10-15): after what the ayah puts aside, that it need not be learnt
# by heart now, and what to focus on instead — the ayah's new steps, by name.
_MAP_KEEP = re.compile(r"^Sekarang Anda tidak perlu (?P<verb>menghafal|memikirkan) (?P<pron>[a-z ]+?)"
                       r"(?P<also>, dan tidak perlu memikirkan hal tingkat lanjut tadi)?\.$")
MAP_ALSO = ", dan tidak perlu memikirkan hal tingkat lanjut tadi"
_MAP_FOCUS = re.compile(r"^Mari kita fokus pada pelajaran (?P<list>.+) terlebih dahulu\.$")
_MAP_FOCUS_REVIEW = re.compile(r"^Mari kita fokus mengulang (?P<list>.+) terlebih dahulu\.$")
MAP_FOCUS_AYAH = "Mari kita fokus pada ayat ini terlebih dahulu."
_MAP_LEARNED = re.compile(r"^Di ayat ini kita mempelajari (?P<n>[a-z ]+?) hal baru: (?P<list>.+)\.$")
_MAP_NONE_REVIEW = re.compile(r"^Di ayat ini tidak ada hal baru; kita mengulang (?P<n>[a-z ]+?) hal yang sudah kita pelajari"
                              r"(?:, yaitu (?P<list>.+))?\.$")
# "map:total": the running total and EVERY step learnt by then, by name (operator 2026-10-15).
MAP_TOTAL_LEAD = "Dengan itu"         # after an ayah that taught something new
MAP_TOTAL_LEAD_NONE = "Sampai ayat ini"  # after one that did not
_MAP_TOTAL = re.compile(rf"^(?P<lead>{MAP_TOTAL_LEAD}|{MAP_TOTAL_LEAD_NONE}), sudah (?P<n>[a-z ]+?) hal yang kita pelajari"
                        r"(?:, (?P<some>yaitu|di antaranya) (?P<list>.+))?\.$")


def named_concepts(text: str, known: dict[str, str], *, places: bool = False) -> list[tuple[str, int | None]] | None:
    """The steps a list of names gives, in order: [(id, the ayah said after it or None)]. `known`:
    name as shown inside a sentence → step id. The longest name at each place counts ("fi’il
    (فِعْل) mudhari’" before "fi’il (فِعْل)"), so a name with a "dan" of its own is one name. None
    when the text is not such a list (a name the map does not have, a stray word)."""
    names = sorted(known, key=len, reverse=True)
    out: list[tuple[str, int | None]] = []
    at = 0
    while True:
        hit = next((n for n in names if text.startswith(n, at)), None)
        if hit is None:
            return None
        at += len(hit)
        ayah = None
        m = _MAP_PLACE.match(text, at) if places else None
        if m:
            ayah = ordinal_value(m.group(1))
            at = m.end()
        out.append((known[hit], ayah))
        if at == len(text):
            return out
        j = _MAP_JOIN.match(text, at)
        if not j:
            return None
        at = j.end()


def _map_names(lid: str, what: str, text: str | None, want: list[str], known: dict[str, str], said: int | None = None) -> list[str]:
    """A list of step names in a map line against the map: EVERY step of the group, in the map's
    order (teaching order; the new steps in the order of their lines), each once (2026-10-15: no
    "di antaranya" — a counted group is named whole). `said`: the count the sentence gives, which
    must be the number of names it says."""
    if text is None:
        return [f"{lid}: says how many {what} there are and does not name them (each one is named, in teaching order)"]
    got = named_concepts(text, known)
    if got is None:
        return [f"{lid}: its {what} are not a list of the map's step names (“{text}”)"]
    ids = [sid for sid, _a in got]
    errs = []
    if said is not None and said != len(ids):
        errs.append(f"{lid}: says {num_id(said)} {what} and names {len(ids)}: the count and the names disagree")
    if ids != want:
        missing = [sid for sid in want if sid not in ids]
        why = (f" ({', '.join(missing)} left out)" if missing else "") + \
              (" (another order: the map's is teaching order)" if not missing and sorted(ids) == sorted(want) else "")
        errs.append(f"{lid}: names {ids} as {what}; the lesson map gives {want}{why}")
    return errs


def _map_count(lid: str, what: str, m: re.Match, want: list[str]) -> list[str]:
    n = count_value(m.group("n"))
    return [] if n == len(want) else [f"{lid}: says {m.group('n')} {what}, the lesson map has {len(want)}"]


def _map_all_named(lid: str, what: str, m: re.Match, want: list[str], known: dict[str, str]) -> list[str]:
    """A counted group named after "yaitu": the count, then every name (`m` has n, some, list)."""
    errs = _map_count(lid, what, m, want)
    if m.group("some") == "di antaranya":
        errs.append(f"{lid}: says “di antaranya”: every one of the {what} is named (no selection since 2026-10-15)")
    return errs + _map_names(lid, what, m.group("list"), want, known, count_value(m.group("n")))


def _one_sentence(shown: str) -> bool:
    return len(re.split(r"(?<=\.) ", shown)) == 1


def map_problems(name: str, lines: dict, lesson: dict, lessonmap: dict, curriculum: dict | None = None) -> list[str]:
    """The map and learned lines of every ayah of a surah with a lesson map, read back from their
    captions against content/map/<slug>.json (module docstring, "The lesson map"). The captions
    say what is spoken (check_display), so the spoken text is held to the same."""
    errs: list[str] = []
    steps = lessonmap.get("steps") if isinstance(lessonmap, dict) else None
    if not isinstance(steps, dict) \
            or not all(isinstance(c, dict) and isinstance(c.get("name"), str) and isinstance(c.get("lesson"), str)
                       for c in steps.values()):
        return [f"{name}: content/map/{name}.json has no step names"]
    known = {_low(c["name"]): sid for sid, c in steps.items()}
    surah = lesson["surah"]
    for a in lesson["ayat"]:
        entry = LESSONMAP.ayah_entry(lessonmap, a["ayah"])
        if entry is None:
            continue
        base = f"{lesson['slug']}:{a['ayah']}"
        new, later, lanjut = (list(entry.get(g) or []) for g in ("new", "later", "lanjut"))
        learnt = [x.get("id") for x in entry.get("learnt") or [] if isinstance(x, dict)]
        again = LESSONMAP.here_ids(entry)
        if any(sid not in steps for sid in new + learnt + later):
            errs.append(f"{base}: the lesson map lists a step it has no name for")
            continue
        # The new steps are the ones this ayah's "Konsep baru" lines teach, named alike.
        said = list(dict.fromkeys(re.sub(r":[a-z]$", "", lid)[len(base) + 1:] for lid in lines if lid.startswith(f"{base}:concept:")))
        line_of = {sid: (CUR.step_of(curriculum, sid) or {}).get("line") for sid in new}
        want_lines = [line_of[sid] for sid in new if line_of[sid]]
        if curriculum is not None and said != want_lines:
            errs.append(f"{base}:map:new: the lesson map's new steps {new} are not this ayah's concept lines {said}")
        for sid in new:
            c = steps[sid]
            shown = _field_of(lines, f"{base}:{line_of[sid]}", "display") if line_of[sid] else ""
            head = f"{TITLE_LEAD} {c['name']}"
            if shown and not (shown.startswith(head) and re.match(r"(?:$|[,.:;]| \()", shown[len(head):])):
                errs.append(f"{base}:map:new: {sid} is named “{c['name']}”, and its own caption does not open with that name "
                            f"(“{shown[:60]}”)")
        # --- what is new
        lid = f"{base}:map:new"
        shown = _field_of(lines, lid, "display")
        if shown:
            m = _MAP_NEW.match(shown)
            if not new:
                if shown != _MAP_NONE:
                    errs.append(f"{lid}: the lesson map has no new step here, and the line does not say so (and nothing else)")
            elif not m or not _one_sentence(shown):
                errs.append(f"{lid}: does not say, in one sentence, how many steps are new, and which")
            else:
                errs += _map_count(lid, "new step(s)", m, new)
                errs += _map_names(lid, "new step(s)", m.group("list"), new, known, count_value(m.group("n")))
        # --- the learnt-so-far line is gone (operator 2026-10-17): not under its id, nor in any line
        for lid in [x for x in lines if x.startswith(f"{base}:")]:
            shown = _field_of(lines, lid, "display")
            if shown and _MAP_SOFAR_SAID.search(shown):
                errs.append(f"{lid}: says how many steps were learnt before this ayah (“Sebelum ayat ini, kita sudah "
                            "mempelajari …”): that line was removed from every ayah's opening (operator 2026-10-17); the "
                            "count is said only in the closing, map:total")
        # --- what of it comes up again here, every step by name
        lid = f"{base}:map:again"
        shown = _field_of(lines, lid, "display")
        if shown:
            m = _MAP_AGAIN.match(shown)
            if not learnt:
                errs.append(f"{lid}: nothing was learnt before this ayah, and it has a line about what comes up again")
            elif not again:
                if shown != _MAP_NOT_AGAIN:
                    errs.append(f"{lid}: no learnt step comes up again in this ayah, and the line does not say so plainly")
            elif _MAP_AGAIN_BARE.match(shown):
                errs.append(f"{lid}: does not stand on its own (“Yang kita temui lagi …” followed the learnt-so-far line, "
                            f"removed 2026-10-17): say “{_MAP_AGAIN_LEAD} …”")
            elif _MAP_AGAIN_OLD.match(shown):
                errs.append(f"{lid}: counts the learnt steps that come up again (“ada …”) instead of naming every one "
                            f"(“{_MAP_AGAIN_LEAD} …”, 2026-10-15)")
            elif not m or not _one_sentence(shown):
                errs.append(f"{lid}: does not name, in one sentence, the learnt steps that come up again here "
                            f"({len(again)} in the lesson map)")
            else:
                errs += _map_names(lid, "repeated step(s)", m.group("list"), again, known)
        # --- what is taught later, and how many next-level topics there are
        lid = f"{base}:map:later"
        shown = _field_of(lines, lid, "display")
        if shown:
            sentences = re.split(r"(?<=\.) ", shown)
            want = bool(later) + bool(lanjut)
            if len(sentences) != want:
                errs.append(f"{lid}: {len(sentences)} sentence(s); the lesson map has"
                            f"{' postponed steps' if later else ''}{' and' if later and lanjut else ''}"
                            f"{' next-level topics' if lanjut else ''}: {want}")
            rest = sentences
            if later:
                errs += _map_later(lid, rest[0] if rest else "", later, steps, known, surah)
                rest = rest[1:]
            if lanjut:
                m = _MAP_LANJUT.match(rest[0]) if rest else None
                more = _MAP_LANJUT_MORE.match(rest[0]) if rest and not m else None
                if more:
                    # Decision 6: a next-level topic is named on the card, never by the narrator.
                    errs.append(f"{lid}: says more of the next-level topics than their count (“{more.group('more').strip(' ,')}”): "
                                "the narrator never names one")
                elif not m:
                    errs.append(f"{lid}: does not say how many next-level topics the ayah has ({len(lanjut)} in the lesson map)")
                else:
                    if count_value(m.group("n")) != len(lanjut):
                        errs.append(f"{lid}: says {m.group('n')} next-level topic(s), the lesson map has {len(lanjut)}")
                    if (m.group("lead") == "Ada juga") != bool(later):
                        errs.append(f"{lid}: “Ada juga” is said exactly when the ayah has postponed steps as well")
        # --- the reassurance: what was put aside need not be learnt now; what to focus on
        lid = f"{base}:map:focus"
        shown = _field_of(lines, lid, "display")
        if shown:
            errs += _map_focus(lid, shown, entry, known)
        # --- the closing: what was new
        lid = f"{base}:learned"
        shown = _field_of(lines, lid, "display")
        if shown:
            m = _MAP_LEARNED.match(shown)
            if not new:
                r = _MAP_NONE_REVIEW.match(shown)
                if not again:
                    if shown != _MAP_NONE:
                        errs.append(f"{lid}: the lesson map has no new step here and none comes up again, and the line does not "
                                    "say so (and nothing else)")
                elif not r:
                    errs.append(f"{lid}: the lesson map has no new step here ({len(again)} learnt step(s) come up again), and the "
                                "line does not say so")
                else:
                    errs += _map_count(lid, "repeated step(s)", r, again)
                    errs += _map_names(lid, "repeated step(s)", r.group("list"), again, known, count_value(r.group("n")))
            elif not m or not _one_sentence(shown):
                errs.append(f"{lid}: does not say, in one sentence, how many new steps the ayah taught, and which "
                            "(the running total is the next line, map:total)")
            else:
                # Held to the map, as map:new is: the two name the same steps in the same order.
                errs += _map_count(lid, "new step(s)", m, new)
                errs += _map_names(lid, "new step(s)", m.group("list"), new, known, count_value(m.group("n")))
        # --- the running total, every step learnt by then by name
        lid = f"{base}:map:total"
        shown = _field_of(lines, lid, "display")
        if shown:
            total = learnt + new
            m = _MAP_TOTAL.match(shown)
            if not m or not _one_sentence(shown):
                errs.append(f"{lid}: does not say, in one sentence, the running total ({len(total)} steps learnt) and which they are")
            else:
                if (m.group("lead") == MAP_TOTAL_LEAD) != bool(new):
                    errs.append(f"{lid}: opens “{MAP_TOTAL_LEAD}” exactly when the ayah taught something new "
                                f"(else “{MAP_TOTAL_LEAD_NONE}”)")
                errs += _map_all_named(lid, "step(s) learnt in all", m, total, known)
    return errs


def _map_focus(lid: str, shown: str, entry: dict, known: dict[str, str]) -> list[str]:
    """The reassurance after the map:later line (operator 2026-10-15): "Sekarang Anda tidak perlu
    menghafal <ketiganya>[, dan tidak perlu memikirkan hal tingkat lanjut tadi]. Mari kita fokus
    pada pelajaran <the new steps> terlebih dahulu." — the pronoun counts the postponed steps
    (menghafal), or with none the next-level topics (memikirkan); the focus is the ayah's new
    steps, every one by name, or with none the learnt steps met again ("fokus mengulang …")."""
    new, later, lanjut = (list(entry.get(g) or []) for g in ("new", "later", "lanjut"))
    again = LESSONMAP.here_ids(entry)
    if not later and not lanjut:
        return [f"{lid}: the ayah puts nothing aside (no postponed step, no next-level topic), and it has a reassurance"]
    sentences = re.split(r"(?<=\.) ", shown)
    if len(sentences) != 2:
        return [f"{lid}: {len(sentences)} sentence(s); a reassurance is two: that what was put aside need not be learnt now, "
                "then what to focus on"]
    errs = []
    k = _MAP_KEEP.match(sentences[0])
    if not k:
        errs.append(f"{lid}: does not open by saying that what this ayah puts aside need not be learnt now "
                    "(“Sekarang Anda tidak perlu menghafal …”)")
    else:
        verb, n = ("menghafal", len(later)) if later else ("memikirkan", len(lanjut))
        if k.group("verb") != verb:
            errs.append(f"{lid}: says “{k.group('verb')}”; the verb is “menghafal” for postponed steps, “memikirkan” for "
                        "next-level topics alone")
        if k.group("pron") != focus_pronoun(n):
            errs.append(f"{lid}: says “{k.group('pron')}” of {n} thing(s) put aside: “{focus_pronoun(n)}”")
        if bool(k.group("also")) != bool(later and lanjut):
            errs.append(f"{lid}: adds “{MAP_ALSO.lstrip(', ')}” exactly when the ayah has postponed steps and next-level "
                        "topics both")
    if new:
        f = _MAP_FOCUS.match(sentences[1])
        if not f:
            errs.append(f"{lid}: does not end with the ayah's new steps to focus on (“Mari kita fokus pada pelajaran … "
                        "terlebih dahulu.”)")
        else:
            errs += _map_names(lid, "new step(s) to focus on", f.group("list"), new, known)
    elif again:
        f = _MAP_FOCUS_REVIEW.match(sentences[1])
        if not f:
            errs.append(f"{lid}: the ayah has nothing new, and the line does not end with the learnt steps it repeats "
                        "(“Mari kita fokus mengulang … terlebih dahulu.”)")
        else:
            errs += _map_names(lid, "repeated step(s) to focus on", f.group("list"), again, known)
    elif sentences[1] != MAP_FOCUS_AYAH:
        errs.append(f"{lid}: the ayah has nothing new and repeats nothing, and the line does not end “{MAP_FOCUS_AYAH}”")
    return errs


def _map_later(lid: str, sentence: str, later: list[str], steps: dict, known: dict[str, str], surah: int) -> list[str]:
    """The sentence about the steps present here and taught later: their count, EVERY name (in
    teaching order), and where they are taught — one ayah of this surah for all: "…, yaitu Z dan
    W, tetapi baru akan diajarkan lebih lengkap di ayat ketiga."; several ayat of this surah: "…,
    tetapi baru akan diajarkan lebih lengkap nanti: Z di ayat ketiga, serta W di ayat ketujuh."; any
    of them in another surah (or in no whole ayah): "…, yaitu Z dan W, tetapi baru akan diajarkan
    lebih lengkap nanti." (operator 2026-10-17: "better to say konsep ini baru akan diajari lebih
    lengkap di ayat keXX"; until then "baru kita bahas …")\""""
    what = "postponed step(s)"
    where = [LESSONMAP.taught_ayah(steps[c], surah) for c in later]
    each = _MAP_LATER_EACH.match(sentence)
    m = _MAP_LATER.match(sentence)
    places = None not in where and len(set(where)) > 1
    if each:
        errs = []
        if count_value(each.group("n")) != len(later):
            errs.append(f"{lid}: says {each.group('n')} {what}, the lesson map has {len(later)}")
        got = named_concepts(each.group("list"), known, places=True)
        if got is None:
            return errs + [f"{lid}: its {what} are not a list of the map's step names, each with its ayah"]
        ids = [sid for sid, _a in got]
        if count_value(each.group("n")) is not None and count_value(each.group("n")) != len(ids):
            errs.append(f"{lid}: says {each.group('n')} {what} and names {len(ids)}: the count and the names disagree")
        if ids != later:
            errs.append(f"{lid}: names {ids} as {what}; the lesson map gives {later}")
        else:
            for (sid, ayah), want in zip(got, where):
                if ayah != want:
                    errs.append(f"{lid}: says {sid} is taught in ayah {ayah}; the lesson map says "
                                f"{'ayah ' + str(want) if want else 'another surah'}")
        if not places:
            errs.append(f"{lid}: gives each postponed step its own ayah, which is said only for steps taught in different "
                        "ayat of this surah")
        return errs
    if not m:
        return [f"{lid}: does not say which steps are in this ayah but taught later ({len(later)} in the lesson map)"]
    errs = _map_all_named(lid, what, m, later, known)
    said = ordinal_value(m.group("ayah")) if m.group("ayah") else None
    one = where[0] if None not in where and len(set(where)) == 1 else None
    if said != one:
        if said is not None:
            errs.append(f"{lid}: says the postponed steps are taught in ayah {said}; the lesson map says "
                        f"{'ayah ' + str(one) if one else ', '.join(str(w) for w in where)}")
        elif one is not None or places:
            errs.append(f"{lid}: does not say where the postponed steps are taught (ayah {', '.join(str(w) for w in where)})")
    return errs


# ------------------------------------------------------------------ no term before its lesson
# Decision 7 of the basic curriculum (operator-approved 2026-10-13, kurikulum-dasar.md; plan L26):
# "No lesson line may use a term before the lesson that teaches it." The build finds each line's
# terms in its prose (Lexicon.latin_matches, before the line is split); a manifest shows the same
# terms in its caption, each as its display form (build_narration.build_lines checks that the two
# agree, line by line), so a manifest can be held to the rule on its own (term_order_found).
def term_ids(lex: "Lexicon", table: list[dict] | None = None) -> dict[str, str]:
    """A dictionary term (its Arabic, the pronunciation dictionary's `term`) → its
    authored/library.terms.json id: the two tables spell a term's Arabic alike, byte for byte
    (validate_terms.py). A narrated term the term table does not have — a letter's name, "Allah",
    an example word, "alif lam" — has no id: it is free."""
    table = QUIZ.load_terms() if table is None else table
    by_ar = {t["ar"]: t["id"] for t in table if t.get("ar")}
    out = TermIds({t.term: by_ar[t.term] for t in lex.terms if t.term in by_ar})
    out.forms = TERMS.TermForms(table)
    return out


class TermIds(dict):
    """term_ids' answer, with the term table's own forms beside it (`forms`: terms.TermForms).

    2026-10-13: the pronunciation dictionary alone left a hole in the rule "no term before its
    lesson". A library term the dictionary has no entry for is written in Latin in a line (nafi,
    zharaf, mubalaghah, maqul al-qaul …), and a dictionary term the prose writes in a form the
    dictionary does not match ("fa'il-nya") stays in Latin too: neither was found. What a line
    USES is therefore the dictionary's matches AND, in the text between them, the term table's
    forms (terms.unmarked's rule: whole words, with -nya, the longest form, ambiguous forms left
    to the author)."""

    forms: "TERMS.TermForms | None" = None


def _with_latin(text: str, found: list[tuple[int, int, str | None]], ids: dict[str, str]) -> list[str]:
    """The term ids of `found` — (start, end, id or None) of the dictionary's matches in `text` —
    together with the term table's forms in the rest of the text, in the order they stand."""
    forms = getattr(ids, "forms", None)
    out = [(a, tid) for a, _b, tid in found if tid is not None]
    if forms is not None:
        rest = list(text)
        for a, b, _tid in found:
            rest[a:b] = " " * (b - a)
        out += [(a, tid) for a, _b, tid in forms.spans("".join(rest))]
    return [tid for _a, tid in sorted(out, key=lambda x: x[0])]


def prose_terms(prose: str, lex: "Lexicon", ids: dict[str, str]) -> list[str]:
    """The library terms a line's prose uses, in order (each as often as it is used): the
    dictionary terms it writes in Latin, and the term table's forms beside them (TermIds)."""
    return _with_latin(prose, [(a, b, ids.get(t.term)) for a, b, t, _cap_ in lex.latin_matches(prose)], ids)


def caption_terms(display: str, lex: "Lexicon", ids: dict[str, str]) -> list[str]:
    """The library terms a caption shows, in order: its dictionary display forms, and the term
    table's forms in the Latin text between them (what the dictionary did not turn into a
    display form stands in the caption as the prose wrote it)."""
    display = lex.unnamed(display)
    return _with_latin(display, [(m.start(), m.end(), ids.get(lex._groups[m.lastgroup].term)) for m in lex.display_rx.finditer(display)], ids)


def later_allowance(entry: dict | None, lessonmap: dict | None, terms_of) -> set[str]:
    """The terms an ayah's map:later line may say although their lesson comes later: the ones in
    the names of the postponed steps it announces (`terms_of(name record)` → term ids)."""
    out: set[str] = set()
    for sid in (entry or {}).get("later") or []:
        rec = ((lessonmap or {}).get("steps") or {}).get(sid)
        if isinstance(rec, dict):
            out |= set(terms_of(rec))
    return out


def term_order_found(uses: dict[str, list[str]], lesson: dict, curriculum: dict, allowance) -> dict[str, list[str]]:
    """{line id: the terms it uses before the lesson that teaches them} for the lines of one
    surah. `uses`: line id (never a split part) → the terms it uses; `allowance(ayah number)` →
    the terms that ayah's map:later line may say. A line of an ayah that is no lesson of the
    curriculum is not held to it."""
    rank = CUR.ranks(curriculum)
    out: dict[str, list[str]] = {}
    for lid, terms in uses.items():
        m = SLUG_ID.match(lid)
        if not m:
            continue
        lesson_id = CUR.ayah_lesson(lesson["surah"], int(m.group("ayah")))
        if lesson_id not in rank:
            continue
        ok = allowance(int(m.group("ayah"))) if m.group("part") == "map:later" else frozenset()
        # A line of the warm-up is said before the lesson teaches anything: a term of this very
        # lesson is too early there (main session 2026-10-13: "a warm-up line of ayat N may use
        # only terms of lessons before N plus lesson zero's").
        opening = any(m.group("part").startswith(f"ex:{k}:") for k in OPENING_EXERCISES)
        bad = CUR.too_early(curriculum, lesson_id, terms, allowed=ok, before=opening)
        if bad:
            out[lid] = bad
    return out


def manifest_term_uses(lines: dict, lex: "Lexicon", ids: dict[str, str]) -> dict[str, list[str]]:
    """line id (split parts joined) → the library terms its caption shows."""
    out: dict[str, list[str]] = {}
    for lid in lines:
        m = SLUG_ID.match(lid)
        if not m or not isinstance(lines[lid], dict):
            continue
        base = lid[:-2] if m.group("split") else lid
        if base not in out:
            out[base] = caption_terms(_field_of(lines, base, "display"), lex, ids)
    return out


def term_order_problems(manifests: dict[str, dict], lessons: dict[str, dict], lex: "Lexicon", curriculum: dict,
                        lessonmap: dict[str, dict], pending: dict | None = None, table: list[dict] | None = None) -> list[str]:
    """Every surah's manifest against the rule, and against authored/curriculum.pending.json both
    ways (curriculum.pending_problems): a violation that is not listed, a listed one that is gone."""
    ids = term_ids(lex, table)
    found: dict[str, list[str]] = {}
    for name, man in manifests.items():
        lesson = lessons.get(name)
        lines = man.get("lines") if isinstance(man, dict) else None
        if lesson is None or not isinstance(lines, dict):
            continue
        mp = lessonmap.get(name)
        allowance = lambda ayah, mp=mp: later_allowance(LESSONMAP.ayah_entry(mp, ayah), mp,  # noqa: E731
                                                        lambda rec: caption_terms(str(rec.get("name", "")), lex, ids))
        found.update(term_order_found(manifest_term_uses(lines, lex, ids), lesson, curriculum, allowance))
    listed = (CUR.load_pending() if pending is None else pending).get("lines") or {}
    return CUR.pending_problems("line", found, listed, lambda t: CUR.term_home(curriculum, t))


def check_guide_ts() -> list[str]:
    """EXERCISE_KEYS / EXERCISE_GUIDE_PARTS above must match src/components/exercises/guide.ts."""
    if not GUIDE_TS.exists():
        return []
    ts = GUIDE_TS.read_text(encoding="utf-8")
    errs = []
    m = re.search(r"EXERCISE_KEYS\s*=\s*\[([^\]]*)\]", ts)
    if m and tuple(re.findall(r'"([a-z-]+)"', m.group(1))) != EXERCISE_KEYS:
        errs.append(f"guide.ts EXERCISE_KEYS differ from {EXERCISE_KEYS}")
    m = re.search(r"EXERCISE_GUIDE_PARTS[^=]*=\s*\{(.*?)\n\};", ts, re.S)
    if m:
        got = {k: tuple(re.findall(r'"([a-z]+)"', v)) for k, v in re.findall(r'"([a-z-]+)":\s*\[([^\]]*)\]', m.group(1))}
        if got != EXERCISE_GUIDE_PARTS:
            errs.append(f"guide.ts EXERCISE_GUIDE_PARTS differ from the narration mirror: {got}")
    return errs


_BUILDS: dict[str, dict | str] = {}


def check_build(manifests: dict[str, dict], lessons: dict[str, dict], library: dict, lex: Lexicon,
                compose: dict[str, dict] | None = None, quiz: dict[str, dict] | None = None,
                lessonmap: dict[str, dict] | None = None, curriculum: dict | None = None,
                pending: dict | None = None) -> list[str]:
    """Every line equals a fresh build (text, display, highlight, focus, frame), and nothing else is there."""
    import build_narration as B  # local import: build_narration imports this module

    errs = []
    # The build depends only on the lessons, the library, the compositions, the quizzes, the lesson
    # maps, the curriculum (with what it tolerates for now) and the dictionary (not on the
    # manifests): one build per distinct input (the mutation tests check many manifest copies
    # against one).
    quiz = load_quiz() if quiz is None else quiz
    lessonmap = load_map() if lessonmap is None else lessonmap
    curriculum = load_curriculum() if curriculum is None else curriculum
    pending = CUR.load_pending() if pending is None else pending
    key = hashlib.sha256(json.dumps([lessons, library, compose or {}, quiz, lessonmap, curriculum, pending.get("lines") or {},
                                     [(t.term, t.speak, t.display) for t in lex.terms]],
                                    sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    if key not in _BUILDS:
        try:
            _BUILDS[key] = B.build_lines(lessons, library, lex, compose or {}, quiz, lessonmap, curriculum, pending)
        except SystemExit as e:
            _BUILDS[key] = f"build_narration.py fails: {e}"
    want = _BUILDS[key]
    if isinstance(want, str):
        return [want]
    for name, lines in want.items():
        man = manifests.get(name)
        got = man.get("lines", {}) if isinstance(man, dict) else {}
        if not isinstance(got, dict):
            continue
        for lid, line in lines.items():
            have = got.get(lid)
            if isinstance(have, dict) and any(have.get(k) != line.get(k) for k in LINE_KEYS | {"frame"}):
                errs.append(f"{lid}: line is out of date with build_narration.py (rebuild, do not hand-edit)")
        for lid in set(got) - set(lines):
            errs.append(f"{lid}: not produced by build_narration.py")
    return errs


def load_compose() -> dict[str, dict]:
    """content/compose/<slug>.json of every lesson surah that has one (compose.py)."""
    return COMPOSE.load_all_content()


def letters_for(name: str, lessons: dict[str, dict], forms: Forms, compose: dict[str, dict],
                library: dict | None = None):
    """(lid, line) → where that line of manifest `name` takes a letter term's shape
    (line_letters): what build_narration, render_narration and check_manifest all use, so the
    karaoke tokens of a render join to the caption the validator expects."""
    ayat = {a["ayah"]: a for a in lesson_ayat(lessons.get(name), compose.get(name))}

    def letters(lid: str, line: dict):
        m = SLUG_ID.match(lid)
        focus = line.get("focus") if isinstance(line.get("focus"), str) else None
        if not m or name == "shared":
            return forms.word_ar.get(focus) if focus else None
        return line_letters(ayat.get(int(m.group("ayah"))), m.group("part"), focus, forms, compose.get(name), library)
    return letters


def check(manifests: dict[str, dict], lessons: dict[str, dict], library: dict, *, build: bool = True,
          lex: Lexicon | None = None, compose: dict[str, dict] | None = None,
          quiz: dict[str, dict] | None = None, lessonmap: dict[str, dict] | None = None,
          curriculum: dict | None = None, pending: dict | None = None,
          continues: dict[str, dict] | None = None) -> list[str]:
    """Every check of the module docstring. `curriculum`: content/curriculum.json, `pending`:
    authored/curriculum.pending.json, `continues`: the continuation data of the authored structure
    files (load_continues; all default: from disk)."""
    forms = Forms(lessons)
    lex = lex or load_lexicon()
    compose = load_compose() if compose is None else compose
    quiz = load_quiz() if quiz is None else quiz
    lessonmap = load_map() if lessonmap is None else lessonmap
    curriculum = load_curriculum() if curriculum is None else curriculum
    pending = CUR.load_pending() if pending is None else pending
    errs: list[str] = lex.problems(forms)
    named = Named(lessons, compose)
    # The lesson maps are held to the curriculum before their lines are read back.
    for slug, mp in lessonmap.items():
        errs += LESSONMAP.problems(mp, lessons, library, curriculum) if slug in lessons else [f"map/{slug}: a lesson map for a surah without a lesson"]
    for sp in SURAHS:
        if sp.slug in lessons and sp.slug not in manifests:
            errs.append(f"{sp.slug}: narration manifest missing")
    if "shared" not in manifests:
        errs.append("shared: narration manifest missing")
    for name, man in manifests.items():
        if name != "shared" and name not in lessons:
            errs.append(f"{name}: narration manifest for a surah without a lesson")
            continue
        errs += check_manifest(name, man, forms, lessons.get(name), library, lex, compose.get(name), quiz.get(name),
                               lessonmap.get(name), curriculum, named=named)
    # No term before its lesson (decision 7), on the manifests as they stand.
    errs += term_order_problems(manifests, lessons, lex, curriculum, lessonmap, pending)
    # Which ayat continue which, said where the data says (rule 8 as refined 2026-10-18).
    errs += continuation_problems(manifests, lessons, named, load_continues() if continues is None else continues)
    errs += check_guide_ts()
    if build:
        errs += check_build(manifests, lessons, library, lex, compose, quiz, lessonmap, curriculum, pending)
    return errs


def load_all() -> tuple[dict[str, dict], dict[str, dict], dict]:
    lessons = {sp.slug: json.loads((CONTENT_DIR / f"{sp.slug}.json").read_text(encoding="utf-8"))
               for sp in SURAHS if (CONTENT_DIR / f"{sp.slug}.json").exists()}
    library = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
    order = {sp.slug: i for i, sp in enumerate(SURAHS)} | {"shared": len(SURAHS)}
    paths = sorted(NARRATION_DIR.glob("*.json"), key=lambda p: (order.get(p.stem, 99), p.stem))
    manifests = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in paths}
    return manifests, lessons, library


def pending_respellings(manifests: dict[str, dict], lex: Lexicon) -> dict[str, list[str]]:
    """Heavy-letter words (heavy_latin) and Latin Arabic terms (latin_terms) → the lines without
    audio that speak them: what the operator has to approve a dictionary entry for (or what has to
    be reworded) before those lines can be rendered."""
    out: dict[str, list[str]] = {}
    for man in manifests.values():
        for lid, line in (man.get("lines") or {}).items() if isinstance(man, dict) else ():
            if isinstance(line, dict) and "audio" not in line and isinstance(line.get("text"), str):
                for w in held_line(line, lex):
                    out.setdefault(key(w), []).append(lid)
    return out


def pending_terms(manifests: dict[str, dict], lex: Lexicon) -> dict[str, list[str]]:
    """Dictionary terms not yet heard by the operator (Term.pending) → the lines that speak them."""
    out: dict[str, list[str]] = {}
    for man in manifests.values():
        for lid, line in (man.get("lines") or {}).items() if isinstance(man, dict) else ():
            if isinstance(line, dict) and isinstance(line.get("text"), str):
                for _a, _b, t in lex.spoken_spans(line["text"]):
                    if t.pending and lid not in out.setdefault(t.term, []):
                        out[t.term].append(lid)
    return out


def main() -> int:
    manifests, lessons, library = load_all()
    errs = check(manifests, lessons, library)
    for name, man in manifests.items():
        lines = man.get("lines", {}) if isinstance(man, dict) else {}
        n_audio = sum(1 for x in lines.values() if isinstance(x, dict) and "audio" in x)
        chars = sum(len(x.get("text", "")) for x in lines.values() if isinstance(x, dict))
        print(f"{name:12s} {len(lines):4d} lines  {chars:6d} spoken chars  {n_audio:4d} with audio")
    lex = load_lexicon()
    pending = pending_respellings(manifests, lex)
    if pending:
        n = len({lid for ids in pending.values() for lid in ids})
        print(f"\nnot renderable yet: {n} lines speak a heavy letter + a with no approved respelling, an Arabic term "
              "or letter name in Latin, or a named Qur'anic word with a heavy letter said "
              "(render_narration.py refuses them until pronunciation.json speaks it, or the operator approves the sound):")
        print("  " + ", ".join(f"{w} ×{len(ids)}" for w, ids in sorted(pending.items(), key=lambda x: (-len(x[1]), x[0]))))
    # What the lessons written before the curriculum still say before its lesson (decision 7):
    # tolerated, listed, and meant to shrink to nothing.
    listed = CUR.load_pending()["lines"]
    if listed:
        per: dict[str, int] = {}
        for lid in listed:
            per[":".join(lid.split(":")[:2])] = per.get(":".join(lid.split(":")[:2]), 0) + 1
        print(f"\ntolerated for now (authored/curriculum.pending.json): {len(listed)} lines use {sum(map(len, listed.values()))} "
              "term(s) before the lesson that teaches them — reword them, then `build_narration.py --write-pending`:")
        print("  " + ", ".join(f"{k} ×{n}" for k, n in per.items()))
    unheard = pending_terms(manifests, lex)
    if unheard:
        print(f"\npending ear check ({PENDING}: rendered, not yet approved by the operator's ear):")
        for t in lex.terms:
            if t.term in unheard:
                print(f"  {t.term} → speak {t.speak!r}, caption {t.display!r}: {len(unheard[t.term])} lines")
    if errs:
        print(f"\nFAIL: {len(errs)} problem(s)")
        for e in errs:
            print("  -", e)
        return 1
    print("\nOK: narration manifests valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
