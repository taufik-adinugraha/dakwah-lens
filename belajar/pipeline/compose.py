"""Word composition ("kata dari bagian-bagiannya") and the harakat primer — the shared code of
build_compose.py and validate_compose.py (stdlib only, no network, no LLM).

Operator, 2026-10-10 (feedback_belajar_narration_style rule 14): a word made of parts is explained
part by part — each part, its BENTUK DASAR (base form: the marfu' form, "never akar"), the change
of its ending and the cause, how the parts join — with an animation on the lesson stage:
[بِ] + [ٱسْمُ] → the dhammah turns into kasrah → joined → the alif drops → [بِسْمِ]. Words that
are not made of parts get the same treatment where it applies (base form → the ending's change).
And, because the first lesson's learners do not know the harakat (operator, same day), a short
HARAKAT PRIMER at the start of Al-Fatihah 1 shows each mark with its sound.

Every Arabic string the stage shows comes from bytes, never typed: authored/<slug>.compose.json
names each FORM by where its bytes come from, and this module resolves it:

    {"word": "1:1:1"}                      a lesson word (content/<slug>.json, Tanzil-verified)
    {"word": "1:1:1", "pieces": [0, 1]}    a slice of it, in PIECES (a base letter + the marks
                                           that follow it: بِسْمِ = بِ | سْ | مِ); end may be null
    {"tanzil": "55:78:2"}                  a Tanzil token anywhere in the Qur'an (local check;
                                           the surah-heading basmalah is not a token, as in
                                           common.lesson_ayah), optionally with "pieces"
    {"qac": "1:1:3:2"}                     a QAC 0.4 segment (Buckwalter converted, local check)
    {"from": <form name | spec>, "ops": [op, ...]}   a deterministic edit of another form
    {"join": [<form name>, ...], "ops": [op, ...]?}  forms written together, then edits

    op = {"mark": i, "to": "kasrah"}       piece i's one vowel mark becomes another
         {"remove": "shaddah", "piece": i} a mark taken off ("vowel" = its one vowel mark)
         {"add": "shaddah", "piece": i}    a mark put on (shaddah right after the letter)
         {"drop": i}                       piece i (letter and marks) left out

Piece indices may be negative (-1 = the last piece). The build records, for each form, where in
the Qur'an exactly those bytes stand as a token (`attested`, Tanzil), so a reviewer sees which
forms are quotations and which are teaching forms (رَحْمَٰن without article or ending is one).

A composition is a list of FRAMES (what the stage shows) and, inside each frame, the narration
lines said while it is on screen (`say`, Indonesian prose; build_narration.py turns each into one
line "${slug}:${ayah}:w${n}:compose:${k}", primer lines "${slug}:${ayah}:primer:${k}"). Stages:

    parts    the parts side by side, in reading order, "+" between them
    base     one part ringed as its bentuk dasar ("focus"), with its ending's mark and sound
    change   a part's ending changes ("from" → "to"; "cause" names the part that causes it): the
             build cuts the changed piece of each (مُ → مِ) and names both marks (dhammah →
             kasrah, u → i)
    join     parts written together ("from": the parts, "tiles": [the joined form]); pieces that
             change in the join (لْ + رَ → ل + رَّ) are cut by the build; "silent": pieces of the
             joined form that are written but not read (the alif of بِٱسْمِ)
    drop     a piece left out in writing ("from" → the tile): the build cuts the dropped piece
    whole    the word as the ayah writes it (a note on how it is read, e.g. at a pause)
  primer only:
    overview the marks side by side ("marks"), each with its sound
    bare     a mark ("marks") beside example letters ("tiles") that do NOT carry it yet: the
             letter as it is before the mark (operator 2026-10-15: "Contohnya huruf ba'" over ب,
             then "jika dibaca kasrah, maka terdengar bi" over بِ). The next frame is a `mark`
             frame with the same marks whose every tile is this frame's tile with them put on
    mark     one or two marks ("marks") with examples ("tiles") that carry them

The checks (`problems`) run in two modes: with the pinned corpus (local: Tanzil and QAC bytes,
attestations, the parts against QAC's segments) and without it (CI: everything the content and
the lesson files can prove — derived forms replayed, word slices, stage semantics, the last
frame equal to the word, the cut chips, the line plan).

THE IMAM'S VOICE OF A BENTUK DASAR (operator 2026-10-12: "e.g ismu (read by voice + show visual)
when combined with harf jar, it becomes ismi (read by voice + visual). in principel, each
explanation should be followed by examples (visual + voice)" — "not only for harakah, but also for
all rules"; plan L20). In the lesson, when a `base` frame is on screen, the imam recites that base
form: a clip of one word (or a run) of an ayah's streamed recording, as on the Konsep pages
(clips.py: the same reciter, the same pinned quran-align timings, nothing cut or stored; the
narrator never voices a Qur'anic word). The build writes, for every `base` frame, one entry of
`examples[<word loc>]`: {frame, form, loc, key, clip[, washal]} — or {frame, form, unvoiced: why}.
Which place, by what is HEARD there (clips.py "WHAT IS HEARD"; never a hand list):
  - the base form is the lesson word itself ({"word": <this loc>}): `unvoiced: "own"` — the imam
    recites that very word when its step opens (and, until plan L24 of 2026-10-13, again at the
    end of its step), which is its example;
  - the base form QUOTES a place ({"tanzil": loc} or another lesson's {"word": loc}, whole): that
    place, the one the frame's note names ("seperti di QS 55:78"). It must be heard as shown, or
    the build stops and the author quotes another place;
  - a derived form (an edit or a join): among the places where exactly those bytes stand as a
    word and are heard as shown, one whose quran-align alignment is clean before any other, then
    the one in the SHORTEST ayah (fewest words: the learner's browser streams that ayah's file to
    play one word of it, and learners on mobile data pay for every byte), then mushaf order;
    `unvoiced: "unattested"` when no word of the Qur'an has those bytes (a teaching form),
    `unvoiced: "unheard"` when none of its places is heard as shown.
  HEARD AS SHOWN (`place_voice`): not its ayah's last word (the imam stops there and the ending,
  the very thing a base frame shows, is not pronounced); and a word that starts with hamzat
  washal (ٱ) and is not its ayah's first word is played with the word before it and ships what is
  heard (`washal` {run, before, heard}, clips.washal_of: ismu after tabāraka → "tabārakasmu") —
  `before`, that word's transliteration, is the lessons' own or the one typed in the library's
  base-form tile of the same place (authored/library.parts.json); without one the place is not
  usable. A quoted place whose alignment is not clean is a warning ("check by ear").
The clips' ayat outside the lessons are written, as the pinned files have them, to
fixtures/compose_examples.json, so CI (no cache) checks those clips too (`voice_problems`, through
clips.problems: url, lengths, the lessons' own timings, the fixture, the pin; with the corpus also a
fresh build and the Tanzil tokens).
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import clips as CL
from common import (AUTHORED_DIR, CONTENT_DIR, PIPELINE, SURAH_BY_SLUG, bw_to_ar, lesson_ayah, load_qac, load_sources,
                    load_tanzil, normalise, qac_words, require_pinned, sha256_file)

COMPOSE_DIR = CONTENT_DIR / "compose"
VERSION = 1
# The curriculum's lesson with no ayah (authored/curriculum.json lesson "0", kurikulum-dasar.md
# decision 1: "A 'lesson zero' with no ayah opens the course. It teaches harakat and the three
# kinds of word"). A primer whose `lesson` is this is played there, not by its ayah's lesson.
LESSON_ZERO = "0"

# ------------------------------------------------------------------ marks
MARKS: dict[str, str] = {
    "fathah": "\u064e", "dhammah": "\u064f", "kasrah": "\u0650",
    "fathatain": "\u064b", "dhammatain": "\u064c", "kasratain": "\u064d",
    "sukun": "\u0652", "shaddah": "\u0651",
    # The small upright alif (U+0670) of ٱلرَّحْمَٰنِ, مَٰلِكِ: a letter the Uthmani mushaf leaves
    # out in writing but which must be read (Sya'ban Isma'il, Rasm al-Mushaf, hlm. 97) — after a
    # fathah, a long a (SKB 158/1987, maddah: fathah + alif = ā). Shown by the primer only.
    "small_alif": "\u0670",
}
MARK_OF = {v: k for k, v in MARKS.items()}
VOWELS = ("fathah", "dhammah", "kasrah", "fathatain", "dhammatain", "kasratain")
# The sound each vowel mark gives (shown on screen, never spoken as a syllable).
SOUND = {"fathah": "a", "kasrah": "i", "dhammah": "u", "fathatain": "an", "kasratain": "in", "dhammatain": "un",
         "small_alif": "a panjang"}
# The marks the stage can explain, with the pronunciation-dictionary term that names each (its
# display form goes on screen, "kasrah (كَسْرَة)"); sukun, shaddah and the small alif have no
# approved term yet (their names are shown in Latin; the narration describes them in plain
# Indonesian).
MARK_TERM = {"fathah": "فَتْحَة", "kasrah": "كَسْرَة", "dhammah": "ضَمَّة"}
MARK_LATIN = {"sukun": "sukun", "shaddah": "syaddah", "small_alif": "alif kecil"}
EXPLAINED_MARKS = ("fathah", "kasrah", "dhammah", "sukun", "shaddah", "small_alif")
# The case ending of a bentuk dasar (rule 14: the marfu' form) — unless the frame declares
# `base_mark`, the fixed ending of a mabni word (an‘ama: fathah).
BASE_ENDINGS = ("dhammah", "dhammatain")
# Two letters that are one letter in two shapes: the alif maqsura of عَلَى is written ya' before
# a pronoun (عَلَيْهِمْ). A join may change one into the other (Tanzil bytes on both sides).
SAME_LETTER = {("\u0649", "\u064a"), ("\u064a", "\u0649")}

WORD_STAGES = ("parts", "base", "change", "join", "drop", "whole")
PRIMER_STAGES = ("overview", "bare", "mark")
FORM_KEYS = {"ar", "translit", "label", "gloss"}
FRAME_KEYS = {"stage", "tiles", "marks", "focus", "from", "to", "cause", "note", "silent", "base_mark", "letters", "say"}
# The frame keys the built file carries (all but `say`, which becomes `lines`).
BUILT_FRAME_KEYS = ("stage", "tiles", "marks", "focus", "from", "to", "cause", "note", "silent", "base_mark", "letters")
# Display budget of one line's caption beside the animation on a phone (CI's phone shot: the
# 165-character w1 caption fills the panel's six lines); a longer line is split by the author.
MAX_DISPLAY = 170
LOC = re.compile(r"^(\d{1,3}):(\d{1,3}):(\d{1,3})$")
QAC_LOC = re.compile(r"^(\d{1,3}):(\d{1,3}):(\d{1,3}):(\d{1,2})$")
ARABIC = re.compile("[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")


def is_mark(c: str) -> bool:
    """A character that belongs to the letter before it: a combining mark (harakat, shaddah,
    sukun, the dagger alif, Qur'anic annotation marks) or the small waw / ya of the Uthmani text."""
    return unicodedata.category(c) == "Mn" or c in "ۥۦ"


def pieces(ar: str) -> list[str]:
    """A word cut into pieces, each a base letter and every mark after it (never inside a letter's
    marks, so a piece is a whole shaped cluster): ٱلرَّحْمَٰنِ → ٱ | ل | رَّ | حْ | مَٰ | نِ."""
    out: list[str] = []
    for c in ar:
        if out and is_mark(c):
            out[-1] += c
        else:
            out.append(c)
    return out


def vowels_of(piece: str) -> list[str]:
    return [MARK_OF[c] for c in piece if MARK_OF.get(c) in VOWELS]


def marks_of(piece: str) -> list[str]:
    return [MARK_OF[c] for c in piece if c in MARK_OF]


class ComposeError(ValueError):
    pass


def _idx(ps: list[str], i, what: str) -> int:
    if not isinstance(i, int) or isinstance(i, bool):
        raise ComposeError(f"{what}: piece index must be an integer, got {i!r}")
    j = i + len(ps) if i < 0 else i
    if not 0 <= j < len(ps):
        raise ComposeError(f"{what}: piece {i} is outside the {len(ps)} pieces of {''.join(ps)!r}")
    return j


def apply_op(ar: str, op: dict, what: str = "op") -> str:
    """One deterministic edit (module docstring)."""
    ps = pieces(ar)
    if not isinstance(op, dict):
        raise ComposeError(f"{what}: an op is an object, got {op!r}")
    keys = set(op)
    if keys == {"mark", "to"}:
        j = _idx(ps, op["mark"], what)
        if op["to"] not in VOWELS:
            raise ComposeError(f"{what}: 'to' must be a vowel mark {VOWELS}, got {op['to']!r}")
        vs = vowels_of(ps[j])
        if len(vs) != 1:
            raise ComposeError(f"{what}: piece {op['mark']} {ps[j]!r} has {len(vs)} vowel marks, not one")
        if vs[0] == op["to"]:
            raise ComposeError(f"{what}: piece {op['mark']} already carries {op['to']}")
        ps[j] = ps[j].replace(MARKS[vs[0]], MARKS[op["to"]])
    elif keys == {"remove", "piece"}:
        j = _idx(ps, op["piece"], what)
        name = op["remove"]
        if name == "vowel":
            vs = vowels_of(ps[j])
            if len(vs) != 1:
                raise ComposeError(f"{what}: piece {op['piece']} {ps[j]!r} has {len(vs)} vowel marks, not one")
            name = vs[0]
        if name not in MARKS or MARKS[name] not in ps[j]:
            raise ComposeError(f"{what}: piece {op['piece']} {ps[j]!r} carries no {name}")
        ps[j] = ps[j].replace(MARKS[name], "", 1)
    elif keys == {"add", "piece"}:
        j = _idx(ps, op["piece"], what)
        name = op["add"]
        if name not in MARKS:
            raise ComposeError(f"{what}: unknown mark {name!r}")
        if MARKS[name] in ps[j]:
            raise ComposeError(f"{what}: piece {op['piece']} already carries {name}")
        if name == "shaddah":
            ps[j] = ps[j][0] + MARKS[name] + ps[j][1:]
        else:
            if vowels_of(ps[j]) or "ْ" in ps[j]:
                raise ComposeError(f"{what}: piece {op['piece']} {ps[j]!r} already has a vowel or sukun")
            k = 2 if len(ps[j]) > 1 and ps[j][1] == MARKS["shaddah"] else 1
            ps[j] = ps[j][:k] + MARKS[name] + ps[j][k:]
    elif keys == {"drop"}:
        j = _idx(ps, op["drop"], what)
        del ps[j]
        if not ps:
            raise ComposeError(f"{what}: nothing left after the drop")
    else:
        raise ComposeError(f"{what}: unknown op {op!r} (mark+to, remove+piece, add+piece or drop)")
    return "".join(ps)


def slice_pieces(ar: str, sl, what: str) -> str:
    if sl is None:
        return ar
    if not (isinstance(sl, list) and len(sl) == 2 and isinstance(sl[0], int)
            and (sl[1] is None or isinstance(sl[1], int))):
        raise ComposeError(f"{what}: pieces must be [start, end] (end may be null), got {sl!r}")
    ps = pieces(ar)
    out = ps[sl[0]:sl[1]]
    if not out:
        raise ComposeError(f"{what}: pieces {sl} of {ar!r} are empty")
    return "".join(out)


# ------------------------------------------------------------------ the corpus (local only)
class Corpus:
    """The pinned Tanzil text and QAC 0.4 (sha256-verified by common.require_pinned)."""

    def __init__(self):
        src = load_sources()
        self.tanzil_sha = src["inputs"]["tanzil_uthmani"]["sha256"]
        self.qac_sha = src["inputs"]["qac_morphology"]["sha256"]
        self.T = load_tanzil(require_pinned(src, "tanzil_uthmani"))
        segs, _ = load_qac(require_pinned(src, "qac_morphology"))
        self.W = qac_words(segs)
        self._tokens: dict[tuple[int, int, int], str] = {}
        self.index: dict[str, list[str]] = {}
        for (s, a) in sorted(self.T.verses):
            line, _cut = lesson_ayah(self.T, s, a)
            for w, tok in enumerate(line.split(" "), 1):
                self._tokens[(s, a, w)] = tok
                self.index.setdefault(tok, []).append(f"{s}:{a}:{w}")

    def token(self, loc: str) -> str:
        m = LOC.match(loc or "")
        k = tuple(int(x) for x in m.groups()) if m else None
        if k not in self._tokens:
            raise ComposeError(f"Tanzil has no word {loc!r}")
        return self._tokens[k]

    def segment(self, loc4: str) -> str:
        m = QAC_LOC.match(loc4 or "")
        if not m:
            raise ComposeError(f"QAC segment must be 'surah:ayah:word:segment', got {loc4!r}")
        s, a, w, g = (int(x) for x in m.groups())
        segs = self.W.get((s, a, w)) or []
        if not 1 <= g <= len(segs):
            raise ComposeError(f"QAC has no segment {loc4}")
        return bw_to_ar(segs[g - 1].form)

    def segments(self, loc: str) -> list:
        m = LOC.match(loc)
        return self.W.get(tuple(int(x) for x in m.groups()), []) if m else []

    def attested(self, ar: str, limit: int = 5) -> list[str]:
        return self.index.get(ar, [])[:limit]


def lesson_words(lessons: dict[str, dict]) -> dict[str, str]:
    """Every lesson word's Arabic (content bytes, Tanzil-verified by validate.py) by loc."""
    return {w["loc"]: w["ar"] for lesson in lessons.values() for a in lesson["ayat"] for w in a["words"]}


class Resolver:
    """Resolves the forms of one composition. Without a corpus, a Tanzil / QAC form takes the
    bytes the content already holds (`given`), which CI cannot re-read — everything derived from
    them is still replayed."""

    def __init__(self, words: dict[str, str], corpus: Corpus | None, specs: dict, given: dict[str, str] | None = None):
        self.words, self.corpus, self.specs, self.given = words, corpus, specs, given or {}
        self.done: dict[str, str] = {}
        self._busy: set[str] = set()

    def form(self, name: str) -> str:
        if name in self.done:
            return self.done[name]
        if name not in self.specs:
            raise ComposeError(f"unknown form {name!r}")
        if name in self._busy:
            raise ComposeError(f"form {name!r} is derived from itself")
        self._busy.add(name)
        try:
            ar = self.spec(self.specs[name]["ar"] if isinstance(self.specs[name], dict) else None, name)
        finally:
            self._busy.discard(name)
        self.done[name] = ar
        return ar

    def spec(self, sp, name: str) -> str:
        what = f"form {name!r}"
        if not isinstance(sp, dict):
            raise ComposeError(f"{what}: 'ar' must be a source object, got {sp!r}")
        keys = set(sp)
        if keys <= {"word", "pieces"} and "word" in keys:
            if sp["word"] not in self.words:
                raise ComposeError(f"{what}: {sp['word']!r} is not a lesson word")
            return slice_pieces(self.words[sp["word"]], sp.get("pieces"), what)
        if keys <= {"tanzil", "pieces"} and "tanzil" in keys:
            if self.corpus is None:
                return self._given(name, what)
            return slice_pieces(self.corpus.token(sp["tanzil"]), sp.get("pieces"), what)
        if keys <= {"qac", "pieces"} and "qac" in keys:
            if self.corpus is None:
                return self._given(name, what)
            return slice_pieces(self.corpus.segment(sp["qac"]), sp.get("pieces"), what)
        if keys <= {"from", "ops"} and "from" in keys:
            base = self.form(sp["from"]) if isinstance(sp["from"], str) else self.spec(sp["from"], name)
            return self._ops(base, sp.get("ops"), what, need=True)
        if keys <= {"join", "ops"} and "join" in keys:
            if not isinstance(sp["join"], list) or len(sp["join"]) < 2 or not all(isinstance(x, str) for x in sp["join"]):
                raise ComposeError(f"{what}: 'join' lists two or more form names")
            return self._ops("".join(self.form(x) for x in sp["join"]), sp.get("ops"), what, need=False)
        raise ComposeError(f"{what}: source must be word, tanzil, qac, from+ops or join (+ops), got {sp!r}")

    def _given(self, name: str, what: str) -> str:
        if name not in self.given or not ARABIC.search(self.given[name]):
            raise ComposeError(f"{what}: no corpus here and no bytes in the content to check")
        return self.given[name]

    @staticmethod
    def _ops(ar: str, ops, what: str, need: bool) -> str:
        if ops is None and not need:
            return ar
        if not isinstance(ops, list) or (need and not ops):
            raise ComposeError(f"{what}: 'ops' must be a non-empty list")
        for i, op in enumerate(ops):
            ar = apply_op(ar, op, f"{what} op {i + 1}")
        return ar


def refs_of(sp) -> list[str]:
    """The form names a source spec is derived from."""
    if not isinstance(sp, dict):
        return []
    if isinstance(sp.get("join"), list):
        return [x for x in sp["join"] if isinstance(x, str)]
    f = sp.get("from")
    return [f] if isinstance(f, str) else refs_of(f)


def word_src(specs: dict, name: str) -> tuple[str, list | None] | None:
    """(loc, pieces) when the form shows bytes of a lesson word as they are (no edit)."""
    sp = (specs.get(name) or {}).get("ar")
    if isinstance(sp, dict) and set(sp) <= {"word", "pieces"} and "word" in sp:
        return sp["word"], sp.get("pieces")
    return None


# ------------------------------------------------------------------ chips (cut by the pipeline, never by the browser)
def diff_pieces(a: str, b: str) -> list[dict]:
    """The pieces that differ between two forms of the same letters: [{from, to, marks: [m1, m2]}].
    `marks` names the vowel (or sukun / shaddah) each side carries, for the sound it gives."""
    pa, pb = pieces(a), pieces(b)
    if len(pa) != len(pb):
        raise ComposeError(f"{a!r} and {b!r} have {len(pa)} and {len(pb)} pieces")
    out = []
    for x, y in zip(pa, pb):
        if x == y:
            continue
        if x[0] != y[0] and (x[0], y[0]) not in SAME_LETTER:
            raise ComposeError(f"{a!r} → {b!r}: the letter {x[0]!r} became {y[0]!r} (only marks may change)")
        out.append({"from": x, "to": y, "marks": [_only(marks_of(x), marks_of(y)), _only(marks_of(y), marks_of(x))]})
    return out


def _only(ms: list[str], other: list[str]) -> str | None:
    """The mark `ms` has that `other` lacks (the one the change is about), or None."""
    d = [m for m in ms if m not in other]
    return d[0] if d else None


def dropped_pieces(a: str, b: str) -> list[dict]:
    """The pieces of `a` left out in `b` (b = a without them, in order)."""
    pa, pb = pieces(a), pieces(b)
    out, j = [], 0
    for x in pa:
        if j < len(pb) and pb[j] == x:
            j += 1
        else:
            out.append({"from": x, "to": ""})
    if j != len(pb) or not out:
        raise ComposeError(f"{b!r} is not {a!r} with pieces left out")
    return out


def skeleton(s: str) -> str:
    return normalise(s).replace("ى", "ي").replace("ة", "ه")


# ------------------------------------------------------------------ building one composition
def _frame_lines(frames: list[dict]) -> list[dict]:
    lines = []
    for k, fr in enumerate(frames, 1):
        for say in fr.get("say") or []:
            lines.append({"frame": k, "say": say})
    return lines


def build_unit(unit: dict, words: dict[str, str], corpus: Corpus | None, *, given: dict | None = None,
               kind: str) -> dict:
    """One composition (kind "word") or the primer (kind "primer") from its authored record."""
    specs = unit.get("forms") or {}
    if not isinstance(specs, dict):
        raise ComposeError("'forms' must be an object of named forms")
    R = Resolver(words, corpus, specs, given)
    forms = {}
    for name, f in specs.items():
        if not isinstance(f, dict):
            raise ComposeError(f"form {name!r} must be an object")
        extra = set(f) - FORM_KEYS
        if extra:
            raise ComposeError(f"form {name!r}: unknown keys {sorted(extra)}")
        ar = R.form(name)
        out = {"ar": ar, "translit": f.get("translit"), "src": f["ar"]}
        for k in ("label", "gloss"):
            if f.get(k):
                out[k] = f[k]
        out["attested"] = corpus.attested(ar) if corpus else list((given or {}).get(f"{name}#attested") or [])
        forms[name] = out
    frames = []
    for i, fr in enumerate(unit.get("frames") or [], 1):
        if not isinstance(fr, dict):
            raise ComposeError(f"frame {i} must be an object")
        extra = set(fr) - FRAME_KEYS
        if extra:
            raise ComposeError(f"frame {i}: unknown keys {sorted(extra)}")
        out = {k: fr[k] for k in BUILT_FRAME_KEYS if k in fr}
        out.setdefault("tiles", [])
        chips = frame_chips(out, forms, i)
        if chips:
            out["chips"] = chips
        if kind == "primer":
            shown = sorted({int(ws[0].split(":")[2]) for t in out["tiles"] if (ws := word_src(specs, t))})
            out["words"] = shown
        frames.append(out)
    return {"forms": forms, "frames": frames, "lines": _frame_lines(unit.get("frames") or [])}


def frame_chips(fr: dict, forms: dict, i: int) -> list[dict]:
    """The pieces a frame's change is about, cut from the forms' bytes (none when the frame does
    not hold together: stage_problems then says why)."""
    try:
        return _frame_chips(fr, forms)
    except ComposeError:
        return []


def _frame_chips(fr: dict, forms: dict) -> list[dict]:
    st = fr.get("stage")
    get = lambda n: forms[n]["ar"] if n in forms else None  # noqa: E731
    if st == "change" and get(fr.get("from")) and get(fr.get("to")):
        return diff_pieces(get(fr["from"]), get(fr["to"]))
    if st == "join" and isinstance(fr.get("from"), list) and len(fr.get("tiles") or []) == 1:
        joined = "".join(get(n) or "" for n in fr["from"])
        to = get(fr["tiles"][0])
        chips = []
        if to and len(pieces(joined)) == len(pieces(to)) and joined != to:
            chips = diff_pieces(joined, to)
        for p in fr.get("silent") or []:
            ps = pieces(to or "")
            if isinstance(p, int) and -len(ps) <= p < len(ps):
                chips.append({"from": ps[p], "to": ps[p], "marks": [None, None], "silent": True})
        return chips
    if st == "drop" and get(fr.get("from")) and fr.get("tiles"):
        return dropped_pieces(get(fr["from"]), get(fr["tiles"][0]))
    return []


# ------------------------------------------------------------------ the imam's voice of a bentuk dasar
# (operator 2026-10-12, plan L20; rules: the module docstring, "THE IMAM'S VOICE OF A BENTUK DASAR")
EXAMPLES_FIXTURE = PIPELINE / "fixtures" / "compose_examples.json"
EXAMPLES_FIXTURE_COMMENT = (
    "The ayat of the lessons' example clips OUTSIDE the lessons (content/compose/<slug>.json `examples`: the imam's "
    "voice of a bentuk dasar, played when its `base` frame is on the lesson stage), exactly as the pinned files have "
    "them: `tanzil` = the Tanzil Uthmani line, `segments` and `stats` = the quran-align Alafasy_128kbps entry. "
    "pipeline/cache is git-ignored, so without this file CI could not tell a shifted timing or a wrong word in "
    "these clips. Written by build_compose.py (compose.examples_fixture); validate_compose.py checks it against the "
    "pinned files when the cache is present, and the clips against it in every run. Never edit by hand."
)
# Why a `base` frame has no voice of its own (the lesson says nothing false there: nothing plays).
UNVOICED = {
    "own": "the bentuk dasar is this very word, which the imam recites when its step opens",
    "unattested": "no word of the Qur'an has these bytes (a teaching form)",
    "unheard": "the Qur'an has these bytes, but in no place are they heard as shown (each ends its ayah, starts "
               "with a hamzat washal in mid-recitation, or has no timing of its own)",
}
EXAMPLE_KEYS_VOICED = {"frame", "form", "loc", "key", "clip"}
EXAMPLE_KEYS_UNVOICED = {"frame", "form", "unvoiced"}


class Voices:
    """What the voice of a bentuk dasar is chosen with, beside the corpus: the pinned quran-align
    entries of the imam (None in CI: no cache), the lessons' transliterations and the
    `washal` of the library's base-form tiles — where the transliteration of a word outside the
    lessons is typed (authored/library.parts.json `before`; content/library.json, built first)."""

    def __init__(self, align: dict | None, lessons: dict[str, dict], library: dict | None):
        self.align = align
        self.translit = CL.lesson_translit(lessons)
        self.tiles: dict[str, dict] = {}
        for part in (library or {}).get("parts", []):
            for tile in part.get("tiles", []):
                key = CL.key_of(tile.get("q", ""))
                if key and isinstance(tile.get("washal"), dict):
                    self.tiles[key] = tile["washal"]

    @classmethod
    def load(cls, lessons: dict[str, dict], *, corpus: bool = True) -> "Voices":
        align = None
        if corpus:
            align, why = CL.load_alignment(load_sources())
            if align is None:
                raise ComposeError(why)
        lib = CONTENT_DIR / "library.json"
        return cls(align, lessons, json.loads(lib.read_text(encoding="utf-8")) if lib.exists() else None)

    def before(self, loc: str) -> str | None:
        """The transliteration of the word before `loc`: the lessons' own, else the one typed in
        the library's tile of `loc`."""
        s, a, w = loc.split(":")
        return self.translit.get(f"{s}:{a}:{int(w) - 1}") or (self.tiles.get(loc) or {}).get("before")


def quoted_place(sp) -> str | None:
    """The one place a form's source quotes whole: {"word": loc} or {"tanzil": loc}; None for a
    slice, a QAC segment, an edit or a join."""
    if not isinstance(sp, dict) or set(sp) - {"word", "tanzil"} or len(sp) != 1:
        return None
    loc = sp.get("word") or sp.get("tanzil")
    return loc if isinstance(loc, str) and LOC.match(loc) else None


def washal_run(translit: str, word: str, loc: str, prev: str | None, before: str | None) -> tuple[dict | None, list[str]]:
    """clips.washal_of for the word at `loc`."""
    s, a, w = (int(x) for x in loc.split(":"))
    return CL.washal_of(translit, word, (s, a, w), prev, before)


def place_voice(loc: str, translit: str, corpus: Corpus, voices: Voices) -> tuple[dict | None, str | None, list[str]]:
    """(example, None, warnings) when the word at `loc` is HEARD as a base frame shows it, else
    (None, why not, []). The example: {loc, key, clip[, washal]}."""
    s, a, w = (int(x) for x in loc.split(":"))
    tokens = lesson_ayah(corpus.T, s, a)[0].split(" ")
    word = tokens[w - 1]
    if w == len(tokens):
        return None, "ends its ayah: the imam stops there (waqf), so its ending is not heard", []
    key, washal = loc, None
    if word.startswith(CL.WASHAL) and w > 1:
        washal, errs = washal_run(translit, word, loc, tokens[w - 2], voices.before(loc))
        if washal is None:
            return None, ("starts with hamzat washal in mid-recitation, where its alif is not read, and cannot be "
                          "played with the word before it: " + "; ".join(errs)), []
        key = washal["run"]
    clip, errs, warns = CL.clip_from(key, voices.align or {}, corpus.T)
    if errs or clip is None:
        return None, "has no clip: " + "; ".join(errs), []
    return ({"loc": loc, "key": key, "clip": clip, **({"washal": washal} if washal else {})}, None, warns)


def base_voice(word_loc: str, name: str, form: dict, corpus: Corpus, voices: Voices) -> tuple[dict, list[str]]:
    """(the `examples` entry of one base frame, without its frame number; warnings): rules in the
    module docstring."""
    quoted = quoted_place(form.get("src"))
    if quoted == word_loc:
        return {"unvoiced": "own"}, []
    if quoted:
        ex, why, warns = place_voice(quoted, form["translit"], corpus, voices)
        if ex is None:
            raise ComposeError(f"{word_loc}: the bentuk dasar {name!r} quotes {quoted} ({form['ar']}), which {why}; "
                               f"quote another place (build_compose.py --find {quoted})")
        return ex, [f"{word_loc}: bentuk dasar {name!r}: {x}" for x in warns]
    places = corpus.index.get(form["ar"], [])
    if not places:
        return {"unvoiced": "unattested"}, []
    usable = []
    for i, loc in enumerate(places):
        ex, _why, warns = place_voice(loc, form["translit"], corpus, voices)
        if ex is not None:
            s, a, _w = (int(x) for x in loc.split(":"))
            # a clean alignment before any other, then the shortest ayah, then mushaf order
            usable.append((bool(warns), len(lesson_ayah(corpus.T, s, a)[0].split(" ")), i, ex, warns))
    if not usable:
        return {"unvoiced": "unheard"}, []
    _unclean, _words, _i, ex, warns = min(usable, key=lambda u: u[:3])
    return ex, [f"{word_loc}: bentuk dasar {name!r}: {x}" for x in warns]


def build_examples(words: dict[str, dict], corpus: Corpus, voices: Voices) -> tuple[dict[str, list[dict]], list[str]]:
    """`examples` of a built file ({word loc: [one entry per base frame]}), and the warnings."""
    out: dict[str, list[dict]] = {}
    warns: list[str] = []
    for loc, unit in words.items():
        rows = []
        for k, fr in enumerate(unit["frames"], 1):
            if fr.get("stage") != "base" or fr.get("focus") not in unit["forms"]:
                continue
            entry, w = base_voice(loc, fr["focus"], unit["forms"][fr["focus"]], corpus, voices)
            warns += w
            rows.append({"frame": k, "form": fr["focus"], **entry})
        if rows:
            out[loc] = rows
    return out, warns


def example_keys(contents: dict[str, dict]) -> list[str]:
    """The clip key of every voiced example of the built files, each once, in mushaf order."""
    keys = {e["key"] for c in contents.values() for rows in (c.get("examples") or {}).values()
            for e in rows if isinstance(e, dict) and isinstance(e.get("key"), str)}
    return sorted(keys, key=lambda k: (CL.order(k), k))


def examples_fixture(contents: dict[str, dict], corpus: Corpus, voices: Voices) -> dict:
    """EXAMPLES_FIXTURE's content for these built files (clips.fixture_from: the same shape as the
    library's fixture)."""
    return CL.fixture_from(example_keys(contents), voices.align or {}, corpus.T, load_sources(),
                           comment=EXAMPLES_FIXTURE_COMMENT)


def load_examples_fixture() -> dict | None:
    if not EXAMPLES_FIXTURE.exists():
        return None
    try:
        return json.loads(EXAMPLES_FIXTURE.read_text(encoding="utf-8"))
    except ValueError:
        return None


def _ayah_tokens(s: int, a: int, lessons: dict[str, dict], T) -> list[str] | None:
    """An ayah's words: a lesson ayah's own (Tanzil-verified by validate.py), else the Tanzil line
    of `T` (the fixture's in CI, the pinned file's locally)."""
    return CL.tokens_reader(lessons, T)(s, a)


def example_problems(content: dict, lessons: dict[str, dict], voices: Voices, T) -> list[str]:
    """The `examples` of one built file, from the content, the lessons, the library's tiles and the
    Tanzil lines of the ayat outside the lessons (`T`: the fixture's, or the pinned file's): every
    base frame has exactly one entry and no other frame has one; an unvoiced entry says why, truly;
    a voiced one names a place whose bytes are the base form's, heard as shown (never an ayah's
    last word; a hamzat-washal word mid-ayah played with the word before it, `washal` exactly as
    derived). The clips themselves: `voice_problems`."""
    where = f"compose/{content.get('slug')}"
    ex = content.get("examples")
    if not isinstance(ex, dict):
        return [f"{where}: no `examples` (the imam's voice of each bentuk dasar; rebuild: build_compose.py)"]
    errs: list[str] = []
    units = content.get("words") or {}
    for loc in ex:
        if loc not in units:
            errs.append(f"{where}: examples[{loc}] is not a composed word of this file")
    for loc, unit in units.items():
        if not isinstance(unit, dict) or not isinstance(unit.get("frames"), list) or not isinstance(unit.get("forms"), dict):
            continue
        w = f"{where} {loc}"
        base = [(k, fr.get("focus")) for k, fr in enumerate(unit["frames"], 1) if isinstance(fr, dict) and fr.get("stage") == "base"]
        rows = ex.get(loc, [])
        if not isinstance(rows, list) or not all(isinstance(e, dict) for e in rows):
            errs.append(f"{w}: examples must be a list of entries")
            continue
        if [(e.get("frame"), e.get("form")) for e in rows] != base:
            errs.append(f"{w}: examples {[(e.get('frame'), e.get('form')) for e in rows]} are not one entry per base "
                        f"frame {base} (every bentuk dasar shown has its voice, or says why not; rebuild: build_compose.py)")
            continue
        for e in rows:
            f = f"{w} frame {e['frame']}"
            form = unit["forms"].get(e["form"])
            if not isinstance(form, dict):
                continue
            quoted = quoted_place(form.get("src"))
            if "unvoiced" in e:
                why = e["unvoiced"]
                if set(e) != EXAMPLE_KEYS_UNVOICED or why not in UNVOICED:
                    errs.append(f"{f}: an unvoiced entry is exactly {{frame, form, unvoiced}}, unvoiced one of {sorted(UNVOICED)}")
                elif (why == "own") != (quoted == loc):
                    errs.append(f"{f}: unvoiced {why!r}, but the bentuk dasar {e['form']!r} "
                                f"{'is' if quoted == loc else 'is not'} the lesson word itself")
                elif why != "own" and quoted:
                    errs.append(f"{f}: unvoiced {why!r}, but the bentuk dasar quotes {quoted}: that place is its voice")
                elif (why == "unattested") != (not form.get("attested")) and why != "own":
                    errs.append(f"{f}: unvoiced {why!r}, but the form's attested list is {form.get('attested')}")
                continue
            if not EXAMPLE_KEYS_VOICED <= set(e) <= EXAMPLE_KEYS_VOICED | {"washal"} or not isinstance(e.get("loc"), str) \
                    or not LOC.match(e["loc"]) or not isinstance(e.get("key"), str) or not CL.parse_key(e["key"]):
                errs.append(f"{f}: a voiced entry is exactly {{frame, form, loc, key, clip[, washal]}}")
                continue
            if quoted == loc:
                errs.append(f"{f}: the bentuk dasar is the lesson word itself, whose own recitation ends the step; "
                            "no second voice of it")
            if quoted and quoted != e["loc"]:
                errs.append(f"{f}: the bentuk dasar quotes {quoted}, but its voice is {e['loc']}")
            s, a, n = (int(x) for x in e["loc"].split(":"))
            tokens = _ayah_tokens(s, a, lessons, T)
            if not tokens or n > len(tokens):
                errs.append(f"{f}: cannot tell what is heard at {e['loc']}: the ayah's words are not known (a lesson "
                            f"ayah, or one of {EXAMPLES_FIXTURE.name}; run build_compose.py)")
                continue
            word = tokens[n - 1]
            if word != form.get("ar"):
                errs.append(f"{f}: the word at {e['loc']} is {word}, not the bentuk dasar {form.get('ar')}")
            if n == len(tokens):
                errs.append(f"{f}: {word} ({e['loc']}) is its ayah's last word: the imam stops there (waqf), so the "
                            "ending a base frame shows is not heard; use another place")
            ws = e.get("washal")
            if word.startswith(CL.WASHAL) and n > 1:
                before = ws.get("before") if isinstance(ws, dict) else None
                want, werrs = washal_run(form.get("translit") or "", word, e["loc"], tokens[n - 2], before)
                errs += [f"{f}: {x}" for x in werrs]
                if ws is None:
                    errs.append(f"{f}: {word} ({e['loc']}) starts with hamzat washal mid-ayah, where the imam does not "
                                "read its alif: it is played with the word before it (`washal`)")
                elif not werrs and ws != want:
                    errs.append(f"{f}: washal {ws!r} is not what the bytes give, {want!r} (rebuild: build_compose.py)")
                elif not werrs and e["key"] != want["run"]:
                    errs.append(f"{f}: plays {e['key']}, not the run with the word before it ({want['run']})")
                if before is not None and voices.before(e["loc"]) not in (None, before):
                    errs.append(f"{f}: before {before!r} is not the transliteration on record of the word before "
                                f"{e['loc']}, {voices.before(e['loc'])!r}")
            else:
                if ws is not None:
                    errs.append(f"{f}: `washal` on a word that does not start with hamzat washal mid-ayah")
                if e["key"] != e["loc"]:
                    errs.append(f"{f}: plays {e['key']}, not the word itself ({e['loc']})")
    return errs


def voice_library(contents: dict[str, dict], lessons: dict[str, dict], T) -> dict:
    """The voiced examples of the built files as a library of their own, so that clips.problems
    checks them exactly as it checks library.json's: `clips` (by key, mushaf order), `quran` (the
    bytes the stage shows for each key: the base form, with the word before it for a run), one
    concept whose examples are the keys, and the quran-align pin."""
    clips, quran, pins = {}, {}, set()
    for c in contents.values():
        pins.add((c.get("data_versions") or {}).get(CL.DATA_VERSION, ""))
        for loc, rows in (c.get("examples") or {}).items():
            for e in rows if isinstance(rows, list) else []:
                if not isinstance(e, dict) or not isinstance(e.get("key"), str) or "clip" not in e:
                    continue
                form = ((c.get("words") or {}).get(loc) or {}).get("forms", {}).get(e.get("form")) or {}
                shown = form.get("ar") or ""
                p = CL.parse_key(e["key"])
                if p and p[2] != p[3]:
                    tokens = _ayah_tokens(p[0], p[1], lessons, T) or []
                    shown = " ".join([*tokens[p[2] - 1:p[3] - 1], shown])
                clips[e["key"]] = e["clip"]
                quran[e["key"]] = shown
    keys = sorted(clips, key=lambda k: (CL.order(k), k))
    return {"concepts": [{"id": "bentuk-dasar", "examples": [{"loc": f"q:{k}"} for k in keys]}], "basics": [], "parts": [],
            "clips": {k: clips[k] for k in keys}, "quran": quran,
            "data_versions": {CL.DATA_VERSION: " ".join(sorted(pins))}}


def voice_problems(contents: dict[str, dict], lessons: dict[str, dict], corpus: Corpus | None,
                   fixture: dict | None, voices: Voices | None = None) -> tuple[list[str], list[str]]:
    """(errors, warnings) of the example clips of every built file: clips.problems over
    `voice_library`, with EXAMPLES_FIXTURE for the ayat outside the lessons."""
    src = load_sources()
    T = corpus.T if corpus is not None else None
    align = voices.align if voices is not None and corpus is not None else None
    fx_T = CL.fixture_sources(fixture)[1]
    lib = voice_library(contents, lessons, T or fx_T)
    errs, warns = CL.problems(lib, lessons, src, align, T, fixture, EXAMPLES_FIXTURE.name)
    # One place, one clip: two base frames that play the same word play the same cut of it.
    seen: dict[str, tuple[str, dict]] = {}
    for slug, c in contents.items():
        for loc, rows in (c.get("examples") or {}).items():
            for e in rows if isinstance(rows, list) else []:
                if not isinstance(e, dict) or not isinstance(e.get("key"), str) or "clip" not in e:
                    continue
                first = seen.setdefault(e["key"], (f"{slug} {loc}", e["clip"]))
                if first[1] != e["clip"]:
                    errs.append(f"{slug} {loc} frame {e.get('frame')}: plays {e['key']} as {e['clip']}, but {first[0]} "
                                f"plays the same place as {first[1]} (rebuild: build_compose.py)")
    fix = lambda x: x.replace("build_library.py", "build_compose.py").replace("library.json", "content/compose")  # noqa: E731
    return [f"compose examples: {fix(x)}" for x in errs], [f"compose examples: {fix(x)}" for x in warns]


def example_summary(contents: dict[str, dict]) -> list[str]:
    """One line per base frame of every built file: its voice, or why it has none."""
    out = []
    for slug, c in contents.items():
        for loc, rows in (c.get("examples") or {}).items():
            for e in rows:
                form = c["words"][loc]["forms"][e["form"]]
                head = f"{slug} {loc} frame {e['frame']} {form['translit']}"
                if "unvoiced" in e:
                    out.append(f"{head}: no voice of its own — {UNVOICED.get(e['unvoiced'], e['unvoiced'])}")
                else:
                    heard = f" heard “{e['washal']['heard']}”" if e.get("washal") else ""
                    out.append(f"{head}: {e['key']}{heard} [{e['clip']['start']}–{e['clip']['end']} ms of "
                               f"{e['clip']['url'].rsplit('/', 1)[-1]}]")
    return out


def build(slug: str, lessons: dict[str, dict], corpus: Corpus, authored_path: Path | None = None,
          voices: Voices | None = None, warnings: list[str] | None = None) -> dict:
    """content/compose/<slug>.json from authored/<slug>.compose.json. `voices`: what the example
    voices are chosen with (default: the pinned quran-align file, the lessons, library.json);
    `warnings`: collects the build's warnings (an example whose alignment is not clean)."""
    path = authored_path or AUTHORED_DIR / f"{slug}.compose.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    spec = SURAH_BY_SLUG[slug]
    words = lesson_words(lessons)
    out: dict = {"version": VERSION, "slug": slug, "surah": spec.surah, "marks": marks_table()}
    if raw.get("primer"):
        p = raw["primer"]
        built = build_unit(p, words, corpus, kind="primer")
        # `lesson`: the lesson that plays the primer when that is not its ayah's (LESSON_ZERO).
        out["primer"] = {"ayah": p.get("ayah"), **({"lesson": p["lesson"]} if "lesson" in p else {}), **built,
                         "sources": p.get("sources") or [], "status": "draft"}
    else:
        out["primer"] = None
    out["words"] = {}
    for loc, unit in (raw.get("words") or {}).items():
        if loc not in words:
            raise ComposeError(f"{loc}: not a word of a lesson")
        built = build_unit(unit, words, corpus, kind="word")
        rec = {"loc": loc, "ar": words[loc]}
        if unit.get("lead"):
            rec["lead"] = unit["lead"]
        out["words"][loc] = {**rec, **built, "sources": unit.get("sources") or [], "status": "draft"}
    voices = voices or Voices.load(lessons)
    out["examples"], warns = build_examples(out["words"], corpus, voices)
    if warnings is not None:
        warnings += [f"{slug}: {x}" for x in warns]
    qa = load_sources()["inputs"]["quran_align"]
    out["data_versions"] = {
        "tanzil": f"uthmani sha256:{corpus.tanzil_sha}",
        "qac": f"0.4 sha256:{corpus.qac_sha}",
        "authored_compose": f"authored/{path.name} sha256:{sha256_file(path)}",
        CL.DATA_VERSION: f"{qa['version']} {CL.ALIGN_MEMBER} sha256:{qa['members'][CL.ALIGN_MEMBER]['sha256']} "
                         "(examples: the imam's voice of a bentuk dasar)",
    }
    return out


def marks_table() -> dict:
    """The marks the stage names, with their sounds and (when the pronunciation dictionary has
    the term) the term's display form, "kasrah (كَسْرَة)"."""
    lex = json.loads((AUTHORED_DIR / "pronunciation.json").read_text(encoding="utf-8"))
    display = {t["term"]: t["display"] for t in lex["terms"]}
    out = {}
    for m in EXPLAINED_MARKS:
        out[m] = {"char": MARKS[m], "sound": SOUND.get(m), "display": display.get(MARK_TERM.get(m, ""), MARK_LATIN.get(m, m))}
    return out


def dump(content: dict) -> str:
    return json.dumps(content, ensure_ascii=False, indent=2) + "\n"


def load_content(slug: str) -> dict | None:
    p = COMPOSE_DIR / f"{slug}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def load_all_content() -> dict[str, dict]:
    """content/compose/<slug>.json of every lesson surah that has one."""
    out = {}
    for slug in SURAH_BY_SLUG:
        c = load_content(slug)
        if c is not None:
            out[slug] = c
    return out


def authored_slugs() -> list[str]:
    return [s for s in SURAH_BY_SLUG if (AUTHORED_DIR / f"{s}.compose.json").exists()]


# ------------------------------------------------------------------ what the lines say about the frames
# The harakat as `say` writes them (their caption heads; build_narration speaks them from the
# dictionary), with the sound each gives. Operator 2026-10-10: a learner who does not know the marks
# hears each one's sound at its first use in a word's explanation ("kasrah, bunyi i").
_SAY_MARK = re.compile(r"\b(fathah|kasrah|dhammah)\b", re.I)
_SOUND_AFTER = re.compile(r",? (?:tanda )?bunyi ([aiu])\b")
_SOUNDS = re.compile(r"\bbunyi ([aiu])\b")
# A frame that shows a base form (or a change from it), or says what it is in its note.
_BENTUK_DASAR = re.compile(r"\bbentuk dasar", re.I)
# Writing the parts together (not "bacaan bersambung", reading on from the word before).
_JOINED = re.compile(r"\b(?:ditulis bersambung|bersambung dengan|keduanya bersambung)\b", re.I)
_PART_N = re.compile(r"\bBagian (?:pertama|kedua)\b", re.I)
_AKAR = re.compile(r"\bakar\w*", re.I)


def _plain(m: str | None) -> str | None:
    """A tanwin as its vowel (dhammatain → dhammah), for comparing with what a line names."""
    return {"fathatain": "fathah", "kasratain": "kasrah", "dhammatain": "dhammah"}.get(m or "", m)


def frame_marks(fr: dict, forms: dict) -> set[str] | None:
    """The harakat a line over this frame may name: the bentuk dasar's ending (base), the marks
    of the change (change); None for the other stages (nothing to compare with)."""
    if fr.get("stage") == "base" and fr.get("focus") in forms:
        last = vowels_of(pieces(forms[fr["focus"]]["ar"])[-1])
        return {_plain(last[0])} if last else set()
    if fr.get("stage") == "change":
        return {_plain(m) for c in fr.get("chips") or [] for m in c.get("marks") or [] if m}
    return None


def say_problems(unit: dict, w: str) -> list[str]:
    """What a word's lines say against what its frames show (findings of the 2026-10-10 review):
    the first use of each harakah in the word carries its sound; a line over a base / change frame
    names only the marks that frame shows, and only their sounds; "bentuk dasar" is said over a
    frame that shows one (or names it in its note), "ditulis bersambung" over a join (or the whole
    word after its parts were shown), "bagian pertama / kedua" over the parts; never "akar"."""
    errs: list[str] = []
    frames, forms = unit.get("frames") or [], unit.get("forms") or {}
    said = [("lead", None, unit["lead"])] if isinstance(unit.get("lead"), str) else []
    said += [(f"line {k}", ln.get("frame"), ln.get("say") or "") for k, ln in enumerate(unit.get("lines") or [], 1)
             if isinstance(ln, dict)]
    first: set[str] = set()
    for where, k, text in said:
        if _AKAR.search(text):
            errs.append(f"{w} {where}: say “bentuk dasar”, never “akar” (in grammar the akar is the root letters)")
        for m in _SAY_MARK.finditer(text):
            name = m.group(1).lower()
            if name in first:
                continue
            first.add(name)
            snd = _SOUND_AFTER.match(text, m.end())
            if not snd or snd.group(1) != SOUND[name]:
                errs.append(f"{w} {where}: the word's first {name} without its sound (“{name}, bunyi {SOUND[name]}”)")
        fr = frames[k - 1] if isinstance(k, int) and 0 < k <= len(frames) and isinstance(frames[k - 1], dict) else None
        if fr is None:
            continue
        allowed = frame_marks(fr, forms)
        if allowed is not None:
            named = {m.group(1).lower() for m in _SAY_MARK.finditer(text)}
            sounds = set(_SOUNDS.findall(text))
            if named - allowed:
                errs.append(f"{w} {where}: names {sorted(named - allowed)} over a {fr['stage']} frame that shows "
                            f"{sorted(allowed) or 'no harakah'}")
            if sounds - {SOUND[m] for m in allowed if m in SOUND}:
                errs.append(f"{w} {where}: says the sound {sorted(sounds)} over a {fr['stage']} frame whose marks give "
                            f"{sorted(SOUND[m] for m in allowed if m in SOUND)}")
        st = fr.get("stage")
        if _BENTUK_DASAR.search(text) and st not in ("base", "change") and not _BENTUK_DASAR.search(fr.get("note") or ""):
            errs.append(f"{w} {where}: speaks of the bentuk dasar over a {st} frame that does not show it "
                        "(show it in a base frame, or name it in the note)")
        before = frames[:k - 1]
        shown_parts = any(isinstance(b, dict) and (b.get("stage") == "parts" or len(b.get("tiles") or []) > 1) for b in before)
        if _JOINED.search(text) and st != "join" and not (st == "whole" and shown_parts):
            errs.append(f"{w} {where}: says the parts are written together over a {st} frame (a join frame, or the "
                        "whole word after its parts)")
        if _PART_N.search(text) and not (st == "parts" or len(fr.get("tiles") or []) > 1):
            errs.append(f"{w} {where}: names a part over a {st} frame that does not show the parts")
    return errs


def translit_ending(ar: str, translit: str) -> str | None:
    """A form's transliteration ends with the vowel its last piece carries (ismu: u, ismi: i), or a
    problem. A piece without a short vowel (sukun, a long vowel's letter) is not compared."""
    vs = vowels_of(pieces(ar)[-1])
    if not vs:
        return None
    t = unicodedata.normalize("NFD", translit)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    want = SOUND[vs[0]]
    return None if t.endswith(want) else f"transliteration {translit!r} does not end in {want!r}, the {vs[0]} of its last letter"


# ------------------------------------------------------------------ the checks
def _given_of(unit: dict) -> dict:
    g = {}
    for name, f in (unit.get("forms") or {}).items():
        if isinstance(f, dict):
            g[name] = f.get("ar")
            g[f"{name}#attested"] = f.get("attested") or []
    return g


def problems(content: dict, lessons: dict[str, dict], corpus: Corpus | None = None, *,
             voices: Voices | None = None, fixture: dict | None = None) -> list[str]:
    """Everything wrong with one built composition file. `corpus` None = CI mode. `voices` (default:
    the lessons and library.json, no alignment) and `fixture` (default: EXAMPLES_FIXTURE on disk):
    what the example voices are checked with (`example_problems`; their clips: `voice_problems`,
    once over all the files)."""
    errs: list[str] = []
    slug = content.get("slug") if isinstance(content, dict) else None
    where = f"compose/{slug}"
    if not isinstance(content, dict) or slug not in SURAH_BY_SLUG:
        return [f"{where}: not a composition file of a lesson surah"]
    keys = {"version", "slug", "surah", "marks", "primer", "words", "examples", "data_versions"}
    if set(content) != keys:
        errs.append(f"{where}: keys {sorted(content)} must be exactly {sorted(keys)}")
    if content.get("version") != VERSION or content.get("surah") != SURAH_BY_SLUG[slug].surah:
        errs.append(f"{where}: version must be {VERSION} and surah {SURAH_BY_SLUG[slug].surah}")
    if content.get("marks") != marks_table():
        errs.append(f"{where}: marks differ from the mark table (rebuild: build_compose.py)")
    words = lesson_words(lessons)
    lesson = lessons.get(slug) or {}
    ayat = {a["ayah"]: a for a in lesson.get("ayat", [])}
    p = content.get("primer")
    if p is not None:
        w = f"{where} primer"
        if not isinstance(p, dict) or p.get("ayah") not in ayat:
            errs.append(f"{w}: needs the ayah whose words it shows (one of the lesson's ayat)")
        elif "lesson" in p and p["lesson"] != LESSON_ZERO:
            errs.append(f"{w}: `lesson` is {LESSON_ZERO!r}, the lesson with no ayah that opens the course, or is left out "
                        "(the primer then opens its own ayah's lesson)")
        else:
            errs += unit_problems(p, words, corpus, w, kind="primer", ayah=ayat[p["ayah"]])
    for loc, unit in (content.get("words") or {}).items():
        w = f"{where} {loc}"
        if loc not in words or not loc.startswith(f"{SURAH_BY_SLUG[slug].surah}:"):
            errs.append(f"{w}: not a word of this surah's lesson")
            continue
        if not isinstance(unit, dict):
            errs.append(f"{w}: must be an object")
            continue
        if unit.get("loc") != loc or unit.get("ar") != words[loc]:
            errs.append(f"{w}: loc/ar must be the lesson word's own ({words[loc]!r})")
        errs += unit_problems(unit, words, corpus, w, kind="word", word_ar=words[loc])
    voices = voices or Voices.load(lessons, corpus=False)
    if fixture is None:
        fixture = load_examples_fixture()
    errs += example_problems(content, lessons, voices, corpus.T if corpus is not None else CL.fixture_sources(fixture)[1])
    return errs


def unit_problems(unit: dict, words: dict[str, str], corpus: Corpus | None, w: str, *, kind: str,
                  word_ar: str | None = None, ayah: dict | None = None) -> list[str]:
    errs: list[str] = []
    want = {"forms", "frames", "lines", "sources", "status"} | ({"loc", "ar", "lead"} if kind == "word" else {"ayah", "lesson"})
    need = {"forms", "frames", "lines", "sources", "status"} | ({"loc", "ar"} if kind == "word" else {"ayah"})
    if not need <= set(unit) or set(unit) - want:
        errs.append(f"{w}: keys {sorted(unit)} (need {sorted(need)}, may also have {sorted(want - need)})")
        return errs
    if unit["status"] != "draft":
        errs.append(f"{w}: status must be 'draft' (pipeline state; plan L11)")
    if not isinstance(unit["sources"], list) or not unit["sources"] or not all(
            isinstance(s, dict) and isinstance(s.get("kitab"), str) and len(s["kitab"]) >= 2
            and set(s) <= {"kitab", "ref", "url"} for s in unit["sources"]):
        errs.append(f"{w}: sources must be ≥1 SourceRef {{kitab, ref?, url?}} (retrieved, never invented)")
    if "lead" in unit and (not isinstance(unit["lead"], str) or not unit["lead"].strip() or ARABIC.search(unit["lead"])):
        errs.append(f"{w}: lead must be Indonesian prose without Arabic script")
    # Rebuild the unit from its own authored parts (forms' sources, frames, says) and compare.
    authored = {"forms": {n: {k: v for k, v in {"ar": f.get("src"), "translit": f.get("translit"),
                                                 "label": f.get("label"), "gloss": f.get("gloss")}.items() if v}
                          for n, f in (unit["forms"] or {}).items() if isinstance(f, dict)},
                "frames": []}
    lines = unit["lines"] if isinstance(unit["lines"], list) else []
    for k, fr in enumerate(unit["frames"] or [], 1):
        if not isinstance(fr, dict):
            errs.append(f"{w}: frame {k} must be an object")
            return errs
        a = {x: fr[x] for x in BUILT_FRAME_KEYS if x in fr}
        a["say"] = [ln.get("say") for ln in lines if isinstance(ln, dict) and ln.get("frame") == k]
        authored["frames"].append(a)
    try:
        again = build_unit(authored, words, corpus, given=_given_of(unit), kind=kind)
    except ComposeError as e:
        return errs + [f"{w}: {e}"]
    for name, f in again["forms"].items():
        have = unit["forms"].get(name) or {}
        if have.get("ar") != f["ar"]:
            errs.append(f"{w}: form {name!r} is {have.get('ar')!r}, its source gives {f['ar']!r}")
        if corpus is not None and have.get("attested") != f["attested"]:
            errs.append(f"{w}: form {name!r} attested {have.get('attested')} ≠ the corpus {f['attested']}")
        if not isinstance(f.get("translit"), str) or not f["translit"].strip() or ARABIC.search(f["translit"]):
            errs.append(f"{w}: form {name!r} needs a Latin transliteration (shown, never spoken)")
        elif (bad := translit_ending(f["ar"], f["translit"])):
            errs.append(f"{w}: form {name!r} {bad}")
        for k2 in ("label", "gloss"):
            if k2 in have and (not isinstance(have[k2], str) or ARABIC.search(have[k2])):
                errs.append(f"{w}: form {name!r} {k2} must be Indonesian text without Arabic script")
    if [fr.get("chips") for fr in unit["frames"]] != [fr.get("chips") for fr in again["frames"]]:
        errs.append(f"{w}: the cut pieces (chips) differ from a fresh cut (rebuild: build_compose.py)")
    if kind == "primer" and [fr.get("words") for fr in unit["frames"]] != [fr.get("words") for fr in again["frames"]]:
        errs.append(f"{w}: the words each primer frame shows differ from a fresh build")
    if lines != again["lines"]:
        errs.append(f"{w}: lines must be the frames' says in order, one per line ({len(again['lines'])} expected)")
    errs += stage_problems(unit, w, kind=kind, word_ar=word_ar, corpus=corpus, words=words, ayah=ayah)
    return errs


def without_marks(ar: str, marks: list[str]) -> str | None:
    """`ar` with one of each of `marks` taken off (the letter as it was before them), or None when
    it does not carry one of them."""
    for m in marks:
        if m not in MARKS or MARKS[m] not in ar:
            return None
        ar = ar.replace(MARKS[m], "", 1)
    return ar


def bare_problems(f: str, fr: dict, nxt: dict | None, ar) -> list[str]:
    """A primer `bare` frame (module docstring): its example letters do not carry its marks yet,
    and the next frame puts exactly those marks on exactly those letters — so the learner sees the
    letter first and then the same letter with the mark, and hears what it does to the sound."""
    errs: list[str] = []
    ms = [m for m in fr.get("marks") or [] if m in MARKS]
    tiles = fr.get("tiles") or []
    if not tiles:
        return [f"{f}: a bare frame shows the letter before its mark"]
    for t in tiles:
        if any(MARKS[m] in (ar(t) or "") for m in ms):
            errs.append(f"{f}: the bare letter {t!r} already carries the mark it shows before")
    if not nxt or nxt.get("stage") != "mark" or list(nxt.get("marks") or []) != list(fr.get("marks") or []):
        return errs + [f"{f}: a bare frame is followed by the mark frame of the same marks"]
    after = nxt.get("tiles") or []
    if len(after) != len(tiles):
        return errs + [f"{f}: the mark frame after it shows {len(after)} tiles for its {len(tiles)} bare letters"]
    for t, u in zip(tiles, after):
        if without_marks(ar(u) or "", ms) != ar(t):
            errs.append(f"{f}: the next frame's {u!r} is not the bare letter {t!r} with {', '.join(ms)} put on")
    return errs


def stage_problems(unit: dict, w: str, *, kind: str, word_ar: str | None, corpus: Corpus | None,
                   words: dict[str, str], ayah: dict | None) -> list[str]:
    errs: list[str] = []
    forms = unit["forms"]
    frames = unit["frames"]
    stages = PRIMER_STAGES if kind == "primer" else WORD_STAGES
    if not frames:
        return [f"{w}: needs at least one frame"]
    ar = lambda n: forms[n]["ar"] if isinstance(n, str) and n in forms else None  # noqa: E731
    used: set[str] = set()
    for k, fr in enumerate(frames, 1):
        f = f"{w} frame {k}"
        st = fr.get("stage")
        if st not in stages:
            errs.append(f"{f}: stage {st!r} is not one of {stages}")
            continue
        tiles = fr.get("tiles") or []
        if not isinstance(tiles, list) or any(t not in forms for t in tiles):
            errs.append(f"{f}: tiles must name forms of this composition, got {tiles!r}")
            continue
        used |= set(tiles)
        for key in ("from", "to", "cause", "focus"):
            v = fr.get(key)
            for n in (v if isinstance(v, list) else [v] if v is not None else []):
                if n not in forms:
                    errs.append(f"{f}: {key} {n!r} is not a form of this composition")
                used.add(n)
        if "note" in fr and (not isinstance(fr["note"], str) or not fr["note"].strip() or ARABIC.search(fr["note"])
                             or len(fr["note"]) > 60):
            errs.append(f"{f}: note must be short Indonesian text (≤ 60 characters, no Arabic script)")
        if not any(ln.get("frame") == k for ln in unit["lines"] if isinstance(ln, dict)):
            errs.append(f"{f}: no narration line is said while it shows (every frame is explained)")
        if st == "parts":
            if len(tiles) < 2:
                errs.append(f"{f}: parts shows two or more parts")
            if corpus is not None and kind == "word":
                segs = corpus.segments(unit["loc"])
                if len(segs) != len(tiles):
                    errs.append(f"{f}: {len(tiles)} parts, QAC 0.4 gives {unit['loc']} {len(segs)} segments")
                else:
                    for t, g in zip(tiles, segs):
                        a, b = skeleton(ar(t)), skeleton(bw_to_ar(g.form))
                        if a not in (b, "ا" + b):
                            errs.append(f"{f}: part {t!r} ({ar(t)}) is not QAC's segment {bw_to_ar(g.form)!r}")
        elif st == "base":
            last = vowels_of(pieces(ar(fr["focus"]))[-1]) if fr.get("focus") in tiles else None
            want = fr.get("base_mark")
            if fr.get("focus") not in tiles:
                errs.append(f"{f}: base rings one of its tiles (focus)")
            elif not last:
                errs.append(f"{f}: the bentuk dasar {ar(fr['focus'])!r} must end in a vowel mark")
            elif want is None and last[0] not in BASE_ENDINGS:
                errs.append(f"{f}: the bentuk dasar {ar(fr['focus'])!r} ends in {last[0]}; the marfu' form ends in "
                            "dhammah (declare `base_mark` for the fixed ending of a mabni word)")
            elif want is not None and want != last[0]:
                errs.append(f"{f}: base_mark {want!r} is not the ending of {ar(fr['focus'])!r} ({last[0]})")
        elif st == "change":
            if fr.get("to") not in tiles or not ar(fr.get("from")):
                errs.append(f"{f}: change names 'from' (before) and 'to' (one of its tiles)")
            else:
                try:
                    d = diff_pieces(ar(fr["from"]), ar(fr["to"]))
                    if len(d) != 1 or not all(m in VOWELS for m in d[0]["marks"]):
                        errs.append(f"{f}: change must change exactly one vowel mark ({d})")
                except ComposeError as e:
                    errs.append(f"{f}: change must change one vowel mark of the same letters ({e})")
            if "cause" in fr and fr["cause"] not in tiles:
                errs.append(f"{f}: the cause must be a tile on screen")
        elif st == "join":
            src = fr.get("from")
            if not isinstance(src, list) or len(src) < 2 or len(tiles) != 1:
                errs.append(f"{f}: join writes two or more parts ('from') as one tile")
            elif skeleton("".join(ar(n) or "" for n in src)) != skeleton(ar(tiles[0])):
                errs.append(f"{f}: the joined tile's letters are not the parts' letters")
            for p in fr.get("silent") or []:
                if not isinstance(p, int) or not tiles or not -len(pieces(ar(tiles[0]))) <= p < len(pieces(ar(tiles[0]))):
                    errs.append(f"{f}: silent piece {p!r} is not a piece of the joined tile")
        elif st == "drop":
            if not ar(fr.get("from")) or len(tiles) != 1:
                errs.append(f"{f}: drop names 'from' and shows one tile")
            else:
                try:
                    dropped_pieces(ar(fr["from"]), ar(tiles[0]))
                except ComposeError as e:
                    errs.append(f"{f}: {e}")
        elif st == "whole":
            if len(tiles) != 1:
                errs.append(f"{f}: whole shows the word as one tile")
        elif st in ("overview", "bare", "mark"):
            ms = fr.get("marks") or []
            if not ms or any(m not in EXPLAINED_MARKS for m in ms) or len(set(ms)) != len(ms):
                errs.append(f"{f}: marks must name marks from {EXPLAINED_MARKS}")
            if st == "mark":
                if not tiles:
                    errs.append(f"{f}: a mark frame shows an example of each mark")
                for m in ms:
                    if m in MARKS and not any(MARKS[m] in ar(t) for t in tiles):
                        errs.append(f"{f}: no example tile carries the {m}")
            if st == "bare":
                errs += bare_problems(f, fr, frames[k] if k < len(frames) else None, ar)
        if st not in ("overview",) and kind == "word" and not tiles:
            errs.append(f"{f}: shows no tile")
        if "base_mark" in fr and (st != "base" or fr["base_mark"] not in VOWELS):
            errs.append(f"{f}: base_mark names the vowel a base frame's bentuk dasar ends in")
        for pin in fr.get("letters") or []:
            ok = isinstance(pin, list) and len(pin) == 2 and pin[0] in forms and isinstance(pin[1], int) \
                and not isinstance(pin[1], bool) and -len(pieces(ar(pin[0]))) <= pin[1] < len(pieces(ar(pin[0])))
            if not ok:
                errs.append(f"{f}: letters pins [form, piece] of this composition, got {pin!r}")
    if kind == "word":
        last = frames[-1]
        joined = "".join(ar(t) or "" for t in last.get("tiles") or [])
        if joined != word_ar:
            errs.append(f"{w}: the last frame shows {joined!r}, not the word as the ayah writes it ({word_ar!r})")
    if kind == "word":
        errs += say_problems(unit, w)
    derived_from = {n for f2 in forms.values() for n in refs_of(f2.get("src"))}
    for name in forms:
        if name not in used and name not in derived_from:
            errs.append(f"{w}: form {name!r} is never shown nor used")
    # The primer's examples from the ayah: only letters of its own words.
    if kind == "primer" and ayah is not None:
        own = {x["loc"] for x in ayah["words"]}
        for name, f in forms.items():
            ws = word_src({n: {"ar": g.get("src")} for n, g in forms.items()}, name)
            if ws and ws[0] not in own:
                errs.append(f"{w}: form {name!r} comes from {ws[0]}, not from ayah {ayah['loc']}")
    return errs


# ------------------------------------------------------------------ helpers for authors
def show(loc: str, corpus: Corpus) -> str:
    """A word's pieces with their indices, and QAC's segments: what an author cuts and names."""
    tok = corpus.token(loc)
    ps = pieces(tok)
    rows = [f"{loc}  {tok}  ({len(ps)} pieces)"]
    for i, p in enumerate(ps):
        rows.append(f"  piece {i:2d} / {i - len(ps):3d}  {p}  {' '.join(f'U+{ord(c):04X}' for c in p)}  "
                    f"marks: {', '.join(marks_of(p)) or '—'}")
    for i, g in enumerate(corpus.segments(loc), 1):
        rows.append(f"  QAC segment {loc}:{i}  {bw_to_ar(g.form)}  {g.tag} {g.features}")
    rows.append(f"  this exact token stands at: {', '.join(corpus.attested(tok, 8))}")
    return "\n".join(rows)
