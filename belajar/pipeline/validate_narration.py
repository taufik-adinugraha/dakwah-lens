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
- Ids follow the contract: "${slug}:${ayah}:${part}" with part in intro | recite | primer:${k} |
  w${n} | w${n}:compose:${k} | structure | concept:${conceptId} | ex:${exerciseKey}:${lineKey} |
  ex:${exerciseKey}:${n}:why | recap | next | done, and "shared:${key}" in shared.json. A line longer than MAX_LINE is split
  into "<id>:a", "<id>:b", … (at least two parts, letters contiguous from a, never next to the
  unsplit id); a primer or compose line is never split (one line per animation frame's sentence).
- Coverage: every ayah has intro, recite, primer:1…k when content/compose/<slug>.json opens the
  ayah with the harakat primer, one w${n} per word followed by w${n}:compose:1…k when the word has
  a composition (one per `say` of its frames), structure, concept:${id} for each Konsep whose
  first example is in that ayah, ex:${key}:intro for each exercise of the ayah's quiz
  (content/quiz/<slug>.json, build_quiz.py) and ex:${key}:${n}:why for each of its questions (the
  explanation of the correct answer, said after "Benar." / "Ini jawabannya."; operator 2026-10-10),
  recap, and next (or done on the last ayah). Nothing else. shared.json holds SHARED_KEYS plus
  ex:${key}:${part} for every guide part of every exercise (mirrors src/components/exercises/guide.ts).
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
  which renders and is listed by main() and render_narration.py until it is dated.
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
  by its spelled-out name (بَاء); the same Qur'anic-word guard and word-place rules.
- Word places: a line names a word of its own ayah by its place ("kata kedua"), never more places
  than the ayah has words, never a place in another ayah (it is named by its meaning there), never a
  place inside a place, and never "di kartu ini" (the stage shows no card); a concept's title is
  never turned into a place.
- What the stage shows (operator review, 2026-10-10): intro, recite, structure and recap highlight
  the whole ayah ([0]); w${n} and w${n}:compose:${k} highlight word n and put it on the word card
  slot (focus; the composition animation takes the card's place); primer:${k} highlights the words
  whose letters its frame shows as they are; a concept
  line highlights the words whose `concepts` list that concept and the words of the ayah's
  structure groups of that concept; the Dengar dan klik intro the whole ayah; every other line
  nothing. Shared lines: [] and null.
- Audio (when present): url = /belajar/media/narration/<voice-slug>/<slug>/<file>.mp3 with <file>
  the content address of the request (audio_name: sha256 of the spoken text, voice and settings),
  so a line whose text changed can never keep old audio; ms > 0; 64-hex sha256; the manifest names
  its voice. `tokens` (with audio only): [{t, s, e}] in time order within the clip, whose texts
  joined by spaces equal the display rendering of the spoken text (render_display).
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
import quiz as QUIZ
from common import AUTHORED_DIR, BELAJAR, CONTENT_DIR, SURAHS, normalise

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
OUTPUT_FORMAT = "mp3_44100_128"


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
    """The file name (without .mp3) of a line's audio: the first 16 hex of the sha256 of the request
    (text, voice, model, language, settings, output format). Unchanged text → same file, never
    rendered twice; changed text → a new file, never a stale cached one."""
    key = {**request_body(text), "voice_id": voice_id, "output_format": OUTPUT_FORMAT}
    return hashlib.sha256(json.dumps(key, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


# ------------------------------------------------------------------ the exercises (mirrors the app)
EXERCISE_KEYS = ("tap-word", "why-harakat", "sort-case", "label-role", "wazn-factory")
# src/components/exercises/guide.ts EXERCISE_GUIDE_PARTS (checked against the file when it exists).
EXERCISE_GUIDE_PARTS: dict[str, tuple[str, ...]] = {
    "tap-word": ("play", "options", "reveal", "next"),
    "why-harakat": ("options", "reveal", "next"),
    "sort-case": ("words", "bins", "reveal"),
    "label-role": ("options", "reveal", "next"),
    "wazn-factory": ("options", "reveal", "next"),
}
# Which exercises an ayah shows, and their questions: content/quiz/<slug>.json (quiz.py; the
# reciter order and the case states the components used to count with live there since 2026-10-11).

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


def _quiz_of(ayah: dict, quiz: dict[str, dict] | None) -> dict | None:
    surah = int(str(ayah["loc"]).split(":")[0])
    slug = next((sp.slug for sp in SURAHS if sp.surah == surah), None)
    return (load_quiz() if quiz is None else quiz).get(slug or "")


def exercise_counts(ayah: dict, library: dict, quiz: dict[str, dict] | None = None) -> dict[str, int]:
    """Questions each exercise asks on this ayah (content/quiz, default from disk); an exercise the
    page does not show is left out. `library` is unused since the plan moved to content/quiz."""
    return QUIZ.question_counts(_quiz_of(ayah, quiz), ayah["ayah"])


def introduced_concepts(ayah_loc: str, library: dict) -> list[dict]:
    """Konsep records whose FIRST example is in this ayah (src/lib/library.ts conceptsIntroducedIn)."""
    out = []
    for c in library["concepts"]:
        ex = c.get("examples") or []
        if ex and ":".join(ex[0]["loc"].split(":")[:2]) == ayah_loc:
            out.append(c)
    return out


def primer_of(compose: dict | None, ayah: int) -> dict | None:
    """The harakat primer that opens this ayah, if any (content/compose/<slug>.json)."""
    p = (compose or {}).get("primer")
    return p if isinstance(p, dict) and p.get("ayah") == ayah else None


def composition_of(compose: dict | None, loc: str) -> dict | None:
    c = ((compose or {}).get("words") or {}).get(loc)
    return c if isinstance(c, dict) else None


def expected_parts(lesson: dict, library: dict, compose: dict | None = None,
                   quiz: dict | None = None) -> dict[int, list[str]]:
    """Part names each ayah's narration must have, in lesson order. `compose`: the surah's
    content/compose/<slug>.json (the primer and the word compositions), or None; `quiz`: its
    content/quiz/<slug>.json (default: from disk)."""
    quiz = quiz if quiz is not None else QUIZ.load_content(lesson["slug"])
    out: dict[int, list[str]] = {}
    last = lesson["ayat"][-1]["ayah"]
    for a in lesson["ayat"]:
        parts = ["intro", "recite"]
        p = primer_of(compose, a["ayah"])
        if p:
            parts += [f"primer:{k}" for k in range(1, len(p.get("lines") or []) + 1)]
        for i, w in enumerate(a["words"], 1):
            parts.append(f"w{i}")
            c = composition_of(compose, w["loc"])
            if c:
                parts += [f"w{i}:compose:{k}" for k in range(1, len(c.get("lines") or []) + 1)]
        parts += [f"concept:{c['id']}" for c in introduced_concepts(a["loc"], library)]
        if a.get("structure"):
            parts.append("structure")
        for ex in QUIZ.ayah_plan(quiz, a["ayah"]):
            parts += [f"ex:{ex['key']}:intro"] + [f"ex:{ex['key']}:{q['n']}:why" for q in ex["questions"]]
        parts += ["recap", "done" if a["ayah"] == last else "next"]
        out[a["ayah"]] = parts
    return out


def expected_shared() -> list[str]:
    return list(SHARED_KEYS) + [f"ex:{k}:{p}" for k in EXERCISE_KEYS for p in EXERCISE_GUIDE_PARTS[k]]


WHOLE_AYAH = [0]


COMPOSE_PART = re.compile(r"w([1-9]\d*):compose:([1-9]\d*)")
PRIMER_PART = re.compile(r"primer:([1-9]\d*)")


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


def line_view(ayah: dict | None, part: str, compose: dict | None = None) -> tuple[list[int], str | None]:
    """(highlight, focus) of a line (operator review of the Al-Fatihah 1 preview, 2026-10-10): the
    whole ayah ([0]) while it is introduced, recited, analysed or recited again; word n, on the word
    card too, while it is explained; the words tagged with a concept while that concept is
    introduced (concept_words: tagged, or in a structure group of that concept); the whole ayah
    while Dengar dan klik is announced; nothing otherwise."""
    if ayah is None:
        return [], None
    if part in ("intro", "recite", "structure", "recap", "ex:tap-word:intro"):
        return list(WHOLE_AYAH), None
    m = re.fullmatch(r"w([1-9]\d*)(?::compose:[1-9]\d*)?", part)
    if m:
        n = int(m.group(1))
        return [n], ayah["words"][n - 1]["loc"] if n <= len(ayah["words"]) else None
    if PRIMER_PART.fullmatch(part):
        k = line_frame(ayah, part, compose)
        p = primer_of(compose, ayah["ayah"])
        return (list(p["frames"][k - 1].get("words") or []) if p and k else []), None
    if part.startswith("concept:"):
        return concept_words(ayah, part.split(":", 1)[1]), None
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
# its name and shown as the letter in the ayah (بِ). Terms are added only after the operator has
# approved their sound (README "Narasi").
_DISPLAY = re.compile(r"^(?P<head>[^()؀-ۿ]+?)(?: \((?P<ar>[^()]+)\))?$")
_CONT = f"\\w{AR_MARKS}'‘’ʼ`´\\-"  # characters that continue a word on either side of a term
# A heavy letter (tafkhim) with fathah (or fathatan, either order with a shadda) or followed by alif.
HEAVY_A = re.compile("[صضطظقخغ](?:\u0651?[\u064E\u064B]|[\u064E\u064B]\u0651|\u0627)")
ARABIC_WORD = re.compile("[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+")
AR_LETTERS = "\u0621-\u065f\u0670-\u06ff"  # Arabic letters and their marks (a shown letter in brackets)
MASK = "istilah"  # what a dictionary term becomes for the word guard (a plain Indonesian word)

# Where the lesson prose (Latin) carries a dictionary term, by the term's caption head ("kasrah",
# "na't", "huruf jar"; build_narration.mark speaks it from the dictionary there). Most heads count
# anywhere as a whole word; these only in the contexts given ({h} is the head):
_COMPOUND_NEXT = r"(?! (?:maushul|fa'il|maf'ul|mudhari'|amr|madhi|majhul)(?![\w']))"
LATIN_CONTEXT: dict[str, str] = {
    # "huruf" is also plain Indonesian ("huruf ba'", "empat huruf", "huruf 'athaf"): the word
    # class is said from the dictionary only where the Kalimah concept lists the three classes.
    "حَرْف": r"(?:(?<=fi'il, dan ){h}|(?<=atau ){h}(?= \(kata tugas\)))",
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


def _capitalised(s: str) -> bool:
    """Does `s` start with a capital (after a leading 'ain apostrophe)?"""
    i = 1 if s[:1] in APOS and s[1:2].isalpha() else 0
    return s[i:i + 1].isupper()


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
        self._groups: dict[str, Term] = {}
        speak_alts, display_alts = [], []
        for i, t in enumerate(sorted(self.terms, key=lambda t: -len(t.speak))):
            self._groups[f"s{i}"] = t
            speak_alts.append(f"(?P<s{i}>{re.escape(t.speak) if t.arabic_speak else _ci(t.speak)})")
        for i, t in enumerate(sorted(self.terms, key=lambda t: -len(t.display))):
            self._groups[f"d{i}"] = t
            if t.letter:
                # The letter as the screen writes it (any of its shapes: ٱ, لِّ, the article ٱلْ);
                # check_display compares it with shown_letter.
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
        s = f"{t.head} ({self.shown_letter(t, focus_ar)})" if t.letter else t.display
        return _cap(s) if cap else s

    def speak_of(self, t: Term, cap: bool) -> str:
        return _cap(t.speak) if cap and not t.arabic_speak else t.speak

    def runs(self, text: str) -> list[tuple[int, int]]:
        """The spoken words of a line: runs of non-space characters, a multi-word term (حَرْف جَرّ,
        mudhof ilaih) being one word. These are the karaoke tokens."""
        runs = [[m.start(), m.end()] for m in re.finditer(r"\S+", text)]
        for a, b, _t in self.spoken_spans(text):
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
            cap = _capitalised(text[s:e]) if not t.arabic_speak else _sentence_start(text, s)
            out += text[cur:s] + self.display_of(t, cap, focus_ar)
            cur = e
        return out + text[cur:b]

    def render_display(self, text: str, focus_ar: str | None = None) -> str:
        """The caption of a spoken line, word by word: each dictionary `speak` value in its display
        form (a capital at a sentence start), "Alloh" as "Allah"; what the karaoke tokens join to."""
        spans = self.spoken_spans(text)
        return " ".join(self._render(text, a, b, spans, focus_ar) for a, b in self.runs(text))

    def tokens(self, text: str, starts: list[float], ends: list[float], focus_ar: str | None = None) -> list[dict]:
        """Karaoke tokens from a character alignment of `text` (ElevenLabs /with-timestamps:
        one start and end per input character): {t: display text, s: start, e: end} seconds."""
        if len(starts) != len(text) or len(ends) != len(text):
            raise ValueError("alignment does not match the text character for character")
        spans = self.spoken_spans(text)
        return [{"t": self._render(text, a, b, spans, focus_ar), "s": round(starts[a], 3), "e": round(ends[b - 1], 3)}
                for a, b in self.runs(text)]

    def speech_of_display(self, display: str) -> str:
        """What a caption says: each display form back to its `speak` value, then tts_text."""
        def rep(m: re.Match) -> str:
            t = self._groups[m.lastgroup]
            return self.speak_of(t, _capitalised(m.group()))
        return tts_text(self.display_rx.sub(rep, display))

    def mask_spoken(self, text: str) -> str:
        return self.speak_rx.sub(MASK, text)

    def mask_display(self, display: str) -> str:
        """Display forms with Arabic masked; a plain Latin one ("Allah") stays, for the guard's own
        rule on the Name (inside “…” or with its honorific)."""
        return self.display_rx.sub(lambda m: MASK if self._groups[m.lastgroup].shown else m.group(), display)

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
    for k, _a, _b, orig in tokens(masked):
        base = k[:-3] if k.endswith("nya") and len(k) > 5 else k
        term = base in GRAMMAR_LATIN or k in GRAMMAR_LATIN
        letter = base in LETTER_NAMES and (base not in _LETTER_NEEDS_APOSTROPHE or orig.endswith(("'", "’")))
        if (term or letter) and orig not in out:
            out.append(orig)
    return out


def held(text: str, lex: Lexicon) -> list[str]:
    """What keeps a spoken line from being rendered: heavy letters without a respelling and Latin
    Arabic terms or letter names the dictionary does not speak (render_narration refuses it)."""
    out = heavy_latin(text, lex)
    return out + [w for w in latin_terms(text, lex) if w not in out]


# ------------------------------------------------------------------ checks
SLUG_ID = re.compile(
    r"^(?P<slug>[a-z-]+):(?P<ayah>[1-9]\d*):(?P<part>intro|recite|primer:[1-9]\d*|w[1-9]\d*(?::compose:[1-9]\d*)?"
    r"|structure|concept:[a-z0-9-]+"
    r"|ex:(?:" + "|".join(EXERCISE_KEYS) + r"):(?:[a-z][a-z_]+|[1-9]\d*:why)|recap|next|done)(?::(?P<split>[a-z]))?$"
)
SHARED_ID = re.compile(r"^shared:(?P<part>[a-z_]+(?::[a-z-]+:[a-z_]+)?)(?::(?P<split>[a-z]))?$")
HONORIFIC_RE = re.compile("|".join(re.escape(h) for h in HONORIFICS))
QUOTED = re.compile("“[^”]*”")
SHA = re.compile(r"^[0-9a-f]{64}$")
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
    dictionary terms masked): no Arabic, digits, diacritics or Qur'anic words; word places."""
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


def check_spoken(lid: str, text, forms: Forms, lex: Lexicon) -> list[str]:
    """The spoken text, exactly as sent to the voice."""
    errs = _basic(lid, text, MAX_LINE)
    if errs and errs[0].endswith("empty text"):
        return errs
    masked = lex.mask_spoken(text)
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


def check_display(lid: str, display, text, forms: Forms, lex: Lexicon, focus_ar: str | None) -> list[str]:
    """The caption: what is spoken, dictionary terms in display form, letters as in the ayah."""
    errs = _basic(lid, display, None, "display")
    if errs and errs[0].endswith("empty display"):
        return errs
    for t in lex.terms:
        if t.letter and t.term in display:
            errs.append(f"{lid}: caption shows the letter {t.head} by its name ({t.term}); show it as in the ayah "
                        f"({lex.shown_letter(t, focus_ar)})")
    for m in lex.display_rx.finditer(display):
        t = lex._groups[m.lastgroup]
        if t.letter:
            want = lex.shown_letter(t, focus_ar)
            got = m.group()[m.group().index("(") + 1:-1]
            if got != want:
                errs.append(f"{lid}: caption shows {m.group()!r}; the letter as in the ayah is {want}")
    masked = lex.mask_display(display)
    if ARABIC.search(masked):
        errs.append(f"{lid}: Arabic script in the caption that is not a dictionary display form")
    errs += [e.replace(" in narration", " in caption") for e in check_text(lid, masked, forms, max_len=None)
             if not e.endswith("Arabic script in narration")]
    if isinstance(text, str):
        said = lex.speech_of_display(display)
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
            and isinstance(text, str):
        want = f"{MEDIA_PREFIX}{slugify(voice['name'])}/{manifest_slug}/{audio_name(text, voice['id'])}.mp3"
        if url != want:
            errs.append(f"{lid}: audio url {url!r} is not {want!r} (the file is named by the spoken text, voice and "
                        "settings: a changed line needs a new render)")
    if not isinstance(audio["ms"], int) or isinstance(audio["ms"], bool) or audio["ms"] <= 0:
        errs.append(f"{lid}: audio ms must be a positive integer")
    if not isinstance(audio["sha256"], str) or not SHA.match(audio["sha256"]):
        errs.append(f"{lid}: audio sha256 must be 64 lower-case hex characters")
    return errs


def check_tokens(lid: str, toks, audio, text, lex: Lexicon, focus_ar: str | None) -> list[str]:
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
    if isinstance(audio, dict) and isinstance(audio.get("ms"), int) and toks[-1]["e"] > audio["ms"] / 1000 + 0.5:
        errs.append(f"{lid}: tokens run past the end of the audio")
    if isinstance(text, str):
        joined, want = " ".join(tk["t"] for tk in toks), lex.render_display(text, focus_ar)
        if joined != want:
            errs.append(f"{lid}: tokens do not join to the display rendering of the spoken text ({joined!r} ≠ {want!r})")
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
        masked = HONORIFIC_RE.sub(MASK, lex.mask_spoken(text))
        said = [orig for k, _a, _b, orig in tokens(masked) if k in banned or sound(k) in banned]
        if said:
            errs.append(f"{lid}: says {said[0]!r}, a syllable the tiles show in transliteration (the narrator names "
                        "letters and sounds; the imam recites the word)")
        letter_speak = {t.speak for t in lex.terms if t.letter}
        for m in _READ_AS.finditer(text):
            w = m.group(1)
            if w in letter_speak or key(w) in LETTER_NAMES:
                errs.append(f"{lid}: reads a letter's name as a sound (“dibaca {w}”): say the sound, “bunyi a”")
    return errs


def authored(ayah: dict | None, part: str, compose: dict | None) -> bool:
    """A line written to be rendered as it stands (operator 2026-10-10: these lines are voiced right
    after they are written): a primer / compose line, or the word line of a composed word (its
    gloss and the composition's lead)."""
    if ayah is None:
        return False
    if animation_of(ayah, part, compose) is not None:
        return True
    m = re.fullmatch(r"w([1-9]\d*)", part)
    return bool(m) and int(m.group(1)) <= len(ayah["words"]) and \
        composition_of(compose, ayah["words"][int(m.group(1)) - 1]["loc"]) is not None


def check_renderable(lid: str, line: dict, ayah: dict | None, part: str, compose: dict | None, lex: "Lexicon") -> list[str]:
    """An authored line, and any line with audio, says every Arabic term from the dictionary: no
    Latin grammar term or letter name (rule 1), no heavy letter + a without its respelling (rule 9)."""
    text = line.get("text")
    if not isinstance(text, str) or not ("audio" in line or authored(ayah, part, compose)):
        return []
    errs = [f"{lid}: says {w!r} in Latin, an Arabic term or letter name the pronunciation dictionary does not "
            "speak (rule 1: add it to pronunciation.json, or say it in plain Indonesian)" for w in latin_terms(text, lex)]
    if "audio" not in line:
        errs += [f"{lid}: says {w!r}, a heavy letter + a with no approved respelling (rule 9), in a line written to "
                 "be rendered" for w in heavy_latin(text, lex)]
    return errs


def check_view(lid: str, line: dict, ayah: dict | None, part: str, compose: dict | None = None) -> list[str]:
    errs = []
    hl, focus = line.get("highlight"), line.get("focus")
    n = len(ayah["words"]) if ayah else 0
    if not isinstance(hl, list) or not all(isinstance(x, int) and not isinstance(x, bool) for x in hl):
        return [f"{lid}: highlight must be a list of word numbers"]
    if hl != sorted(set(hl)) or (0 in hl and hl != [0]) or any(x < 0 or x > n for x in hl):
        errs.append(f"{lid}: highlight {hl} must be [0] (the whole ayah), [] or word numbers 1–{n} in order")
    if focus is not None and (not isinstance(focus, str) or not ayah or focus not in {w["loc"] for w in ayah["words"]}):
        errs.append(f"{lid}: focus {focus!r} is not a word of this ayah")
    want_hl, want_focus = line_view(ayah, part, compose)
    if not errs and (hl != want_hl or focus != want_focus):
        errs.append(f"{lid}: highlight/focus {hl}/{focus!r} is not what the stage shows for this step "
                    f"({want_hl}/{want_focus!r})")
    want_frame = line_frame(ayah, part, compose)
    if line.get("frame") != want_frame or ("frame" in line) != (want_frame is not None):
        errs.append(f"{lid}: frame {line.get('frame')!r} is not the animation frame this line plays over "
                    f"({want_frame!r}; only primer / compose lines have one)")
    return errs


def check_manifest(name: str, man, forms: Forms, lesson: dict | None, library: dict, lex: Lexicon,
                   compose: dict | None = None, quiz: dict | None = None) -> list[str]:
    errs: list[str] = []
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
    ayat = {a["ayah"]: a for a in lesson["ayat"]} if lesson else {}
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
        errs += check_spoken(lid, line["text"], forms, lex)
        errs += check_display(lid, line["display"], line["text"], forms, lex, focus_ar)
        if m and (name == "shared" or ayah is not None):
            errs += check_view(lid, line, ayah, part, compose)
            errs += check_animation_line(lid, line, ayah, part, compose, lex, bool(m.group("split")))
            errs += check_renderable(lid, line, ayah, part, compose, lex)
        if "audio" in line:
            if voice is None:
                errs.append(f"{lid}: audio present but the manifest names no voice")
            if isinstance(line["text"], str):
                for w in heavy_latin(line["text"], lex):
                    errs.append(f"{lid}: rendered with {w!r}, a heavy letter + a with no approved respelling in "
                                "pronunciation.json")
            errs += check_audio(lid, line["audio"], slug, voice, line["text"])
            if "tokens" not in line:
                errs.append(f"{lid}: audio without tokens (render with /with-timestamps)")
        if "tokens" in line:
            if "audio" not in line:
                errs.append(f"{lid}: tokens without audio")
            errs += check_tokens(lid, line["tokens"], line.get("audio"), line["text"], lex, focus_ar)
    # coverage
    if name == "shared":
        want = {f"shared:{k}" for k in expected_shared()}
        have = set(groups)
        for lid in sorted(want - have):
            errs.append(f"shared: missing line {lid}")
        for lid in sorted(have - want):
            errs.append(f"shared: unexpected line {lid}")
    elif lesson is not None:
        want = {f"{slug}:{n}:{p}" for n, parts in expected_parts(lesson, library, compose, quiz).items() for p in parts}
        have = set(groups)
        for lid in sorted(want - have):
            errs.append(f"{name}: missing line {lid}")
        for lid in sorted(have - want):
            errs.append(f"{name}: unexpected line {lid}")
        errs += check_content(name, lines, lesson, lex)
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
                compose: dict[str, dict] | None = None, quiz: dict[str, dict] | None = None) -> list[str]:
    """Every line equals a fresh build (text, display, highlight, focus, frame), and nothing else is there."""
    import build_narration as B  # local import: build_narration imports this module

    errs = []
    # The build depends only on the lessons, the library, the compositions, the quizzes and the
    # dictionary (not on the manifests): one build per distinct input (the mutation tests check many
    # manifest copies against one).
    quiz = load_quiz() if quiz is None else quiz
    key = hashlib.sha256(json.dumps([lessons, library, compose or {}, quiz, [(t.term, t.speak, t.display) for t in lex.terms]],
                                    sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    if key not in _BUILDS:
        try:
            _BUILDS[key] = B.build_lines(lessons, library, lex, compose or {}, quiz)
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
    ayat = {a["ayah"]: a for a in (lessons.get(name) or {}).get("ayat", [])}

    def letters(lid: str, line: dict):
        m = SLUG_ID.match(lid)
        focus = line.get("focus") if isinstance(line.get("focus"), str) else None
        if not m or name == "shared":
            return forms.word_ar.get(focus) if focus else None
        return line_letters(ayat.get(int(m.group("ayah"))), m.group("part"), focus, forms, compose.get(name), library)
    return letters


def check(manifests: dict[str, dict], lessons: dict[str, dict], library: dict, *, build: bool = True,
          lex: Lexicon | None = None, compose: dict[str, dict] | None = None,
          quiz: dict[str, dict] | None = None) -> list[str]:
    forms = Forms(lessons)
    lex = lex or load_lexicon()
    compose = load_compose() if compose is None else compose
    quiz = load_quiz() if quiz is None else quiz
    errs: list[str] = lex.problems(forms)
    for sp in SURAHS:
        if sp.slug in lessons and sp.slug not in manifests:
            errs.append(f"{sp.slug}: narration manifest missing")
    if "shared" not in manifests:
        errs.append("shared: narration manifest missing")
    for name, man in manifests.items():
        if name != "shared" and name not in lessons:
            errs.append(f"{name}: narration manifest for a surah without a lesson")
            continue
        errs += check_manifest(name, man, forms, lessons.get(name), library, lex, compose.get(name), quiz.get(name))
    errs += check_guide_ts()
    if build:
        errs += check_build(manifests, lessons, library, lex, compose, quiz)
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
                for w in held(line["text"], lex):
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
        print(f"\nnot renderable yet: {n} lines speak a heavy letter + a with no approved respelling, or an Arabic term "
              "or letter name in Latin (render_narration.py refuses them until pronunciation.json speaks it):")
        print("  " + ", ".join(f"{w} ×{len(ids)}" for w, ids in sorted(pending.items(), key=lambda x: (-len(x[1]), x[0]))))
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
