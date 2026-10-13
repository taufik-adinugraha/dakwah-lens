"""The imam's voice of every example the static library pages show (operator, 2026-10-12: "in
explanation, for example when explaining dhommah, kasrah, etc provide example + additional voice.
e.g ismu (read by voice + show visual) when combined with harf jar, it becomes ismi (read by voice +
visual). in principel, each explanation should be followed by examples (visual + voice)" — "not
only for harakah, but also for all rules").

A clip is one ayah's streamed recording and the place of one word (or one run of words) in it:
`{"url": <EveryAyah file of that ayah>, "start": ms, "end": ms}` and `"last": true` when its (last)
word ends the ayah, keyed by the word's location ("5:23:6", or "55:78:1-2" for a run). The voice is
the IMAM, never the narrator: Mishary Alafasy (`Alafasy_128kbps`, the module's default reciter, plan
L7), the very files and the very timing convention the lessons use — the pinned quran-align
release, read through build_surah.word_segments (segment [wordStart0, wordEndExclusive0, startMs,
endMs] → word wordStart0 + 1, the Tanzil token index of common.lesson_ayah) and
build_surah.everyayah_url. Nothing is cut, copied or stored: the browser seeks within the streamed
file and stops at `end` (src/hooks/useClipPlayer.ts), the way the lesson plays one word
(src/hooks/useSegmentPlayer.ts).

Which examples (`wanted`), in the order the pages show them:
  - every concept example (`concepts[].examples[].loc`, a lesson word): the Konsep example rows;
  - the word of every Harakat sign's example letter (`basics[].signs[].example`, a letter q-ref
    "q:1:1:1#1"): a letter alone is never recited, so its voice is the word it is cut from;
  - every parts diagram's joined word (`parts[].loc`) and each tile that is a whole Tanzil token
    (the bentuk dasar): that word, or — when it starts with hamzat washal mid-ayah — the run with
    the word before it (`tiles[].washal.run`, below). A tile that is a QAC segment (bi-, li-, -hu,
    -hum, -ta) is never recited on its own, so it has no clip (`unvoiced` lists them and why); the
    joined word's clip voices it inside the word.

WHAT IS HEARD (review 2026-10-12: all 88 clips pointed at the right word, yet "aḥadun" played
"aḥad" and "ismu" played "smu"). An example is chosen and labelled by what the learner hears
(tajwid), not only by the word's bytes:
  - waqf: the imam stops on an ayah's last word, so a final harakah or tanwin is not pronounced
    there. `last` marks those clips (from the ayah's word count), and the page says so beside the
    button when the word's ending is one the pause drops (`pause_drop`; src/lib/heard.ts is its
    twin). An ending the note has no wording for (fathatain read ā, ta' marbuthah read h, a
    pronoun's long vowel) stops the build until it has one.
  - a Harakat sign card teaches the SOUND of its sign (`sign_heard_problems`): a sign on its
    word's last letter may not use an ayah's last word; a tanwin's word must be followed in its
    ayah by a letter that keeps the n clearly heard (izhar: ء ه ع ح غ خ).
  - hamzat washal: a word that starts with ٱ loses that alif in mid-recitation ("tabāraka-smu").
    A base-form tile whose word starts with ٱ and is not its ayah's first word plays the run with
    the word before it and ships the heard form (`washal_of`: tiles[].washal {run, before, heard});
    a base-form tile is never an ayah's last word, its ending is what the diagram shows
    (`tile_problems`).

Checks (`clip_problems`, `problems`; run by build_library.py and validate_clips.py):
  - every wanted example has a clip and no clip is unwanted; keys in mushaf order;
  - url = the reciter's EveryAyah file of that ayah; start, end integers, 0 ≤ start < end; `last`
    absent or true;
  - duration plausible: MIN_MS–MAX_MS a word, and MAX_LAST_MS for an ayah's last word (the imam
    holds the madd at the pause: ad-ḍāllīna, 1:7:9, measures 5,680 ms). A run's cap is the sum of
    its words' caps: only its last word can be the ayah's last;
  - a lesson ayah's clip equals the lesson's own Alafasy recitation entry (its url, the segment of
    the word), `last` is the lessons' word count (common.SURAHS), and that lesson word is the one
    the page shows (its loc, its bytes = library `quran` where the library names it);
  - an ayah without a lesson (ٱسْمُ of 55:78, سَلَٰمٌ of 97:5 …): the clip equals a build from the
    committed fixture (FIXTURE: those ayat's Tanzil lines and quran-align entries), and the bytes
    the page shows are the fixture's tokens — corpus-free, so CI catches a shifted timing there too;
  - the heard rules above;
  - library data_versions.quran_align pins the reciter's quran-align member (sources.json), and
    the fixture names the same pins;
  - with the corpus (pipeline/cache): every clip equals a fresh one from the pinned quran-align
    file; that ayah's single-word segments cover its Tanzil tokens 1..N exactly once (the index
    mapping the lessons rely on), no segment joins a clip's word to another, the Tanzil token(s) at
    the clip's index are the bytes the page shows for that example, and the fixture equals the
    pinned files. A non-zero quran-align matcher statistic for the ayah is a warning ("check by
    ear"), as build_surah.py warns for the lessons.

Standard library only; no network (the MP3s are never downloaded here).
"""
from __future__ import annotations

import json
import re

import terms as TM
from build_surah import everyayah_url, word_segments
from common import PIPELINE, SURAH_BY_NUM, Tanzil, lesson_ayah, sha256_file

RECITER = "Alafasy_128kbps"  # plan L7: the default voice (build_surah.RECITERS, src/lib/ayah.ts)
ALIGN_MEMBER = f"{RECITER}.json"
MIN_MS = 150
MAX_MS = 4000
MAX_LAST_MS = 7000
KEY = re.compile(r"^(\d{1,3}):(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$")
WORD_LOC = re.compile(r"^(\d{1,3}):(\d{1,3}):(\d{1,3})$")
DATA_VERSION = "quran_align"
# The ayat of the clips outside the lessons, as the pinned files have them (see `fixture_from`).
FIXTURE = PIPELINE / "fixtures" / "clips_outside_lessons.json"

# ---------------------------------------------------------------- what is heard (tajwid)
# Letters and marks by code point (a combining mark alone in a string literal is hard to see).
WASHAL = "\u0671"  # ٱ, alif with hamzat washal: read only when the recitation starts at its word
# Izhar halqi: after a tanwin these six letters keep its n clearly heard. Hamzah as the Tanzil text
# writes it at a word's start (ء أ إ آ: U+0621, 0623, 0625, 0622), then ha' ‘ain ḥa' ghain kha'
# (U+0647, 0639, 062D, 063A, 062E); never ٱ, a hamzat washal, before which a tanwin takes a helping
# kasrah ("aḥadunillāh").
IZHAR = frozenset("\u0621\u0623\u0625\u0622\u0647\u0639\u062D\u063A\u062E")
TANWIN = frozenset({"fathatain", "kasratain", "dhammatain"})
_MARK = {name: ch for ch, name in TM.MARKS.items()}  # "fathah" → U+064E …
SHORT_VOWEL = {_MARK["fathah"]: "a", _MARK["kasrah"]: "i", _MARK["dhammah"]: "u"}
_FATHATAIN = _MARK["fathatain"]
_DROPPED_TANWIN = {_MARK["dhammatain"], _MARK["kasratain"]}
_TA_MARBUTHAH = "\u0629"
_SILAH = {"\u06E5", "\u06E6"}  # the small waw / ya' after a pronoun's ha': its long vowel


def key_of(ref: str) -> str | None:
    """The clip key of something a page shows: a word loc "1:1:1" or word q-ref "q:55:78:2" →
    "55:78:2"; a letter q-ref "q:1:1:1#1" → its word "1:1:1"; a run "q:112:1:2-4" → "112:1:2-4";
    a QAC segment "q:1:1:1/1" → None (never recited on its own), and anything else None."""
    m = WORD_LOC.match(ref)
    if m:
        return ref
    m = TM.QREF.match(ref)
    if not m or m.group(5):
        return None
    loc = ":".join(m.groups()[:3])
    return f"{loc}-{m.group(4)}" if m.group(4) else loc


def parse_key(key: str) -> tuple[int, int, int, int] | None:
    """(surah, ayah, first word, last word) of a clip key; None when malformed."""
    m = KEY.match(key)
    if not m:
        return None
    s, a, w = int(m.group(1)), int(m.group(2)), int(m.group(3))
    w2 = int(m.group(4)) if m.group(4) else w
    return (s, a, w, w2) if w2 >= w >= 1 and s >= 1 and a >= 1 else None


def order(key: str) -> list[int]:
    return [int(x) for x in re.findall(r"\d+", key)]


def tile_key(tile: dict) -> str | None:
    """The clip key of a parts tile: its word, or the run with the word before it when the word
    starts with hamzat washal mid-ayah (`washal.run`); None for a QAC segment (no clip)."""
    key = key_of(tile.get("q", ""))
    ws = tile.get("washal")
    return ws["run"] if key and isinstance(ws, dict) and isinstance(ws.get("run"), str) else key


def wanted(lib: dict) -> list[tuple[str, str]]:
    """[(clip key, where)] of every example the static pages show (see the module docstring), in
    page order; one key may be wanted from several places."""
    out = []
    for c in lib.get("concepts", []):
        for i, x in enumerate(c.get("examples", [])):
            out.append((key_of(x.get("loc", "")) or x.get("loc", ""), f"concepts[{c.get('id')}].examples[{i}]"))
    for b in lib.get("basics", []):
        for i, sg in enumerate(b.get("signs", [])):
            out.append((key_of(sg.get("example", "")) or sg.get("example", ""), f"basics[{b.get('id')}].signs[{i}]"))
    for p in lib.get("parts", []):
        for i, t in enumerate(p.get("tiles", [])):
            k = tile_key(t)
            if k:
                out.append((k, f"parts[{p.get('loc')}].tiles[{i}]"))
        out.append((p.get("loc", ""), f"parts[{p.get('loc')}].word"))
    return out


def unvoiced(lib: dict) -> list[tuple[str, str, str]]:
    """[(where, ref, why)] of the examples shown without a clip: the parts tiles that are a QAC
    segment of a word (a prefix or a suffix), which no reciter says on its own."""
    out = []
    for p in lib.get("parts", []):
        for i, t in enumerate(p.get("tiles", [])):
            if key_of(t.get("q", "")) is None:
                out.append((f"parts[{p.get('loc')}].tiles[{i}]", t.get("q", ""),
                            f"{t.get('translit')} is a part of a word (QAC segment), never recited on its own; "
                            f"the joined word's clip ({p.get('loc')}) voices it"))
    return out


def is_last(s: int, a: int, w: int) -> bool:
    """Is word w the last word of the lesson ayah s:a, by the lessons' word counts
    (common.SURAHS)? False for an ayah without a lesson: its count comes from the Tanzil line
    (the corpus, or FIXTURE)."""
    spec = SURAH_BY_NUM.get(s)
    return bool(spec and 1 <= a <= spec.n_ayat and spec.words[a - 1] == w)


def max_ms(n: int, last: bool) -> int:
    """The longest plausible clip of n words: MAX_MS a word, and MAX_LAST_MS for the ayah's last
    word (only a run's LAST word can be that; review 2026-10-12: the allowance was multiplied by
    the run's word count)."""
    return MAX_MS * (n - 1) + (MAX_LAST_MS if last else MAX_MS)


def clip_problems(key: str, clip) -> list[str]:
    """The corpus-free checks of one clip: key, url, integers, order, plausible duration. Whether
    `last` is right for the ayah is checked where its word count is known (`problems`)."""
    where = f"clips[{key}]"
    p = parse_key(key)
    if not p:
        return [f"{where}: key must be s:a:w or s:a:w1-w2 with w1 ≤ w2"]
    s, a, w, w2 = p
    if not isinstance(clip, dict) or not {"url", "start", "end"} <= set(clip) <= {"url", "start", "end", "last"}:
        return [f"{where}: must be exactly {{url, start, end}}, with `last` only on an ayah's last word, got {clip!r}"]
    out = []
    if "last" in clip and clip["last"] is not True:
        out.append(f"{where}: `last` is true or absent, got {clip['last']!r}")
    if clip["url"] != everyayah_url(RECITER, s, a):
        out.append(f"{where}: url {clip['url']!r} is not {RECITER}'s file of {s}:{a} ({everyayah_url(RECITER, s, a)})")
    st, en = clip["start"], clip["end"]
    if not all(isinstance(x, int) and not isinstance(x, bool) for x in (st, en)):
        return out + [f"{where}: start and end must be integers (ms), got {st!r}, {en!r}"]
    if st < 0 or en <= st:
        return out + [f"{where}: start {st} must be ≥ 0 and before end {en}"]
    last = clip.get("last") is True
    n = w2 - w + 1
    if not MIN_MS * n <= en - st <= max_ms(n, last):
        out.append(f"{where}: {en - st} ms is not a plausible length for {n} word(s) "
                   f"({MIN_MS * n}–{max_ms(n, last)} ms: {MIN_MS}–{MAX_MS} ms a word"
                   f"{f', up to {MAX_LAST_MS} ms for the ayah’s last word' if last else ''})")
    return out


def load_alignment(src: dict) -> tuple[dict | None, str | None]:
    """({(surah, ayah): entry} of the reciter's pinned quran-align member, sha256), or (None, the
    reason) when the cache does not hold it as pinned."""
    qa = src["inputs"]["quran_align"]
    want = qa["members"][ALIGN_MEMBER]["sha256"]
    p = (PIPELINE / qa["cache_path"]).parent / ALIGN_MEMBER
    if not p.exists():
        return None, f"quran-align {ALIGN_MEMBER} is not in the cache ({p}); run fetch.py"
    if sha256_file(p) != want:
        return None, f"quran-align {ALIGN_MEMBER} does not match its pin; run fetch.py"
    return {(e["surah"], e["ayah"]): e for e in json.loads(p.read_text())}, want


def data_version(src: dict) -> str:
    qa = src["inputs"]["quran_align"]
    return f"{qa['version']} {ALIGN_MEMBER} sha256:{qa['members'][ALIGN_MEMBER]['sha256']} (clips: Konsep example voices)"


def clip_from(key: str, align: dict, T) -> tuple[dict | None, list[str], list[str]]:
    """(clip, errors, warnings) for one key from the quran-align entry of its ayah: the first
    word's start and the last word's end, `last` when that word ends the ayah (the Tanzil line's
    word count), after checking that the ayah's single-word segments cover its Tanzil tokens 1..N
    exactly once and that no segment joins a clip word to another (build_surah.check_segments'
    coverage rule for the lessons). `align`, `T`: the pinned files, or the fixture's
    (`fixture_sources`)."""
    p = parse_key(key)
    if not p:
        return None, [f"clips[{key}]: not a word location"], []
    s, a, w, w2 = p
    if (s, a) not in T.verses:
        return None, [f"clips[{key}]: {s}:{a} is not an ayah of the Tanzil text"], []
    tokens = lesson_ayah(T, s, a)[0].split(" ")
    if w2 > len(tokens):
        return None, [f"clips[{key}]: {s}:{a} has {len(tokens)} words"], []
    e = align.get((s, a))
    if not e:
        return None, [f"clips[{key}]: quran-align {RECITER} has no entry for {s}:{a}"], []
    segs, joined = word_segments(e)
    errs, warns = [], []
    for first, last in joined:
        if first <= w2 and last >= w:
            errs.append(f"clips[{key}]: quran-align times words {first}..{last} of {s}:{a} together; "
                        f"no clip of its own for word(s) {w}..{w2}")
    covered = sorted(x[0] for x in segs) + [i for f, l in joined for i in range(f, l + 1)]
    if sorted(covered) != list(range(1, len(tokens) + 1)):
        errs.append(f"clips[{key}]: quran-align's words of {s}:{a} do not cover its {len(tokens)} Tanzil tokens "
                    f"exactly once (word index ≠ token index)")
    if errs:
        return None, errs, warns
    by_w = {x[0]: x for x in segs}
    clip = {"url": everyayah_url(RECITER, s, a), "start": by_w[w][1], "end": by_w[w2][2]}
    if w2 == len(tokens):
        clip["last"] = True  # the imam stops here (waqf): a final harakah or tanwin is not heard
    stats = e.get("stats", {})
    if any(stats.get(k) for k in ("insertions", "deletions", "transpositions")):
        warns.append(f"clips[{key}]: quran-align matcher stats {stats} for {s}:{a} (alignment not clean; check by ear)")
    return clip, clip_problems(key, clip), warns


def build(lib: dict, align: dict, T) -> tuple[dict, list[str], list[str]]:
    """(clips in mushaf order, errors, warnings) for every wanted example of `lib`."""
    clips, errs, warns = {}, [], []
    for key, where in wanted(lib):
        if key in clips:
            continue
        if not parse_key(key):
            errs.append(f"{where}: {key!r} names no word, so it has no clip")
            continue
        clip, e, w = clip_from(key, align, T)
        errs += [f"{where}: {x}" for x in e]
        warns += w
        if clip and not e:
            clips[key] = clip
    return {k: clips[k] for k in sorted(clips, key=lambda k: (order(k), k))}, errs, warns


# ---------------------------------------------------------------- what is heard: the rules
def pause_drop(word: str) -> str:
    """What the imam's stop on this word (an ayah's last) does to its ending, read from its
    Tanzil bytes. "harakat": its last letter carries a short vowel or a dhammah/kasrah tanwin,
    which is not pronounced at the pause (nasta‘īnu is heard "nasta‘īn", aḥadun "aḥad") — the
    page's waqf note says exactly that; "none": nothing is dropped (a sukun, a long vowel: yūlad);
    "other": the pause changes it another way (fathatain is read ā, ta' marbuthah h, a pronoun's
    ha' loses its long vowel), which the note has no wording for. src/lib/heard.ts waqfDrop is the
    same rule (the page decides the note from the bytes it shows)."""
    ls = TM.letters(word)
    if not ls:
        return "none"
    end, before = ls[-1], (ls[-2] if len(ls) > 1 else "")
    marks = set(end[1:])
    if _FATHATAIN in marks or end[0] == _TA_MARBUTHAH or marks & _SILAH:
        return "other"
    if not marks & set(TM.MARKS) and _FATHATAIN in before:  # kufuwan: the tanwin's alif ends the word
        return "other"
    if marks & _DROPPED_TANWIN or marks & set(SHORT_VOWEL):
        return "harakat"
    return "none"


def sign_heard_problems(basics: list[dict], tokens_of) -> list[str]:
    """A Harakat sign card teaches the sound of its sign, so its example is a place where the sign
    is HEARD (review 2026-10-12: دٌ = d + un "dari أَحَدٌ (aḥadun)" played "aḥad"):
      - a sign on its word's last letter may not use an ayah's last word (the imam stops there);
      - a tanwin's word is followed, in its ayah, by a letter that keeps the n clearly heard
        (izhar: ء ه ع ح غ خ), as كُفُوًا أَحَدٌۢ and غَاسِقٍ إِذَا are.
    `tokens_of(s, a)`: the ayah's words (Tanzil tokens), or None when they are not known."""
    out = []
    for b in basics:
        for i, sg in enumerate(b.get("signs", [])):
            where = f"basics[{b.get('id')}].signs[{i}]"
            m = TM.QREF.match(sg.get("example", ""))
            if not m or not m.group(6):
                continue  # not a letter ref: build_library.py and validate_terms.py say so
            s, a, w, n = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(6))
            toks = tokens_of(s, a)
            if not toks or w > len(toks):
                out.append(f"{where}: cannot tell what is heard at {s}:{a}:{w}: the ayah's words are not known "
                           f"(a lesson ayah, or one of {FIXTURE.name}; run build_library.py)")
                continue
            word, marks = toks[w - 1], sg.get("marks", [])
            ls = TM.letters(word)
            names = ", ".join(marks)
            if TANWIN & set(marks):
                if w == len(toks):
                    out.append(f"{where}: {word} ({s}:{a}:{w}) is its ayah's last word: the imam stops there (waqf), "
                               f"so the tanwin ({names}) is not heard; use a word followed in its ayah by one of "
                               f"ء ه ع ح غ خ")
                elif toks[w][0] not in IZHAR:
                    out.append(f"{where}: {word} ({s}:{a}:{w}) is followed by {toks[w]}: before {toks[w][0]} the n of the "
                               f"tanwin ({names}) is not clearly heard (izhar needs one of ء ه ع ح غ خ)")
            elif n == len(ls) and w == len(toks):
                out.append(f"{where}: the sign ({names}) sits on the last letter of {word} ({s}:{a}:{w}), its ayah's "
                           f"last word: the imam stops there (waqf), so it is not heard")
    return out


def washal_of(translit: str, word: str, loc: tuple[int, int, int], prev: str | None,
              before: str | None) -> tuple[dict | None, list[str]]:
    """(`washal`, errors) of a base-form tile: None unless its word starts with hamzat washal (ٱ)
    and is not its ayah's first word. There the imam does not read the alif ("ismu" cut from
    tabāraka-smu, 55:78:2, plays "smu"; review 2026-10-12), so the tile plays the run with the
    word before it and says what is heard: {"run": "55:78:1-2", "before": "tabāraka", "heard":
    "tabārakasmu"}. `before`: the transliteration of the word before (the lesson's own, or typed
    in the tile); `heard`: `before` + the tile's transliteration without its first vowel — right
    only when the word before ends in a short vowel, which is required (a tanwin, a sukun or a
    long vowel there joins differently)."""
    s, a, w = loc
    if not word.startswith(WASHAL) or w == 1:
        return None, []
    where = f"{word} ({s}:{a}:{w})"
    if not prev or not before:
        return None, [f"{where} starts with hamzat washal mid-ayah, where its alif is not read: the tile needs "
                      f"`before`, the transliteration of the word before it ({prev or f'{s}:{a}:{w - 1}'})"]
    errs = []
    if not TM.surface_matches(before, prev):
        errs.append(f"{where}: before {before!r} does not name the word before it, {prev} "
                    f"(consonants {TM.skeleton_latin(before)!r} vs {TM.skeleton_ar(prev)!r})")
    end = set(TM.letters(prev)[-1][1:])
    vowel = [SHORT_VOWEL[c] for c in end if c in SHORT_VOWEL]
    if len(vowel) != 1 or end - set(SHORT_VOWEL) - {TM.SHADDAH} or not before.endswith(vowel[0]):
        errs.append(f"{where}: the word before it, {prev} ({before}), does not end in one short vowel, so the heard "
                    f"form is not the two transliterations joined; use another occurrence of the word")
    if len(translit) < 2 or translit[0].lower() not in "aiu":
        errs.append(f"{where}: translit {translit!r} does not start with the vowel of its hamzat washal")
    if errs:
        return None, errs
    heard = before + translit[1:]
    if not TM.surface_matches(heard, f"{prev} {word}"):
        return None, [f"{where}: the heard form {heard!r} does not name {prev} {word}"]
    return {"run": f"{s}:{a}:{w - 1}-{w}", "before": before, "heard": heard}, []


def tile_problems(lib: dict, translit: dict[str, str]) -> list[str]:
    """The heard rules of the parts diagrams' base-form tiles (the tiles that are a whole word),
    from library.json alone: `washal` is exactly what `washal_of` derives from the tile's bytes
    (library `quran`) and the word before it — present when the word starts with ٱ mid-ayah, absent
    otherwise; and no base-form tile is an ayah's last word (its ending, the thing the diagram
    shows changing, would not be heard). `translit`: lesson loc → its transliteration."""
    out = []
    quran, clips = lib.get("quran", {}), lib.get("clips", {})
    for p in lib.get("parts", []):
        for i, t in enumerate(p.get("tiles", [])):
            where = f"parts[{p.get('loc')}].tiles[{i}]"
            key = key_of(t.get("q", ""))
            ws = t.get("washal")
            if key is None or "-" in key:
                if ws is not None:
                    out.append(f"{where}: `washal` on a tile that is not one whole word")
                continue
            s, a, w, _ = parse_key(key)
            word = quran.get(key)
            if word is None:
                continue  # validate_terms.py: a ref without bytes
            prev_key = f"{s}:{a}:{w - 1}"
            prev = quran.get(prev_key)
            before = ws.get("before") if isinstance(ws, dict) else None
            if word.startswith(WASHAL) and w > 1 and ws is None:
                out.append(f"{where}: {word} ({key}) starts with hamzat washal mid-ayah, where the imam does not "
                           f"read its alif: the tile needs `washal` (the run with the word before it; run "
                           f"build_library.py)")
                continue
            want, errs = washal_of(t.get("translit", ""), word, (s, a, w), prev, before)
            out += [f"{where}: {x}" for x in errs]
            if not errs and ws != want:
                out.append(f"{where}: washal {ws!r} is not what the tile's bytes give, {want!r} "
                           f"(run build_library.py)")
            if want and translit.get(prev_key) not in (None, before):
                out.append(f"{where}: before {before!r} is not the lesson's transliteration of {prev_key}, "
                           f"{translit[prev_key]!r}")
            if want and quran.get(want["run"]) != f"{prev} {word}":
                out.append(f"{where}: library quran has no bytes {prev} {word} for the run {want['run']} it plays")
            clip = clips.get(tile_key(t) or "")
            if isinstance(clip, dict) and clip.get("last"):
                out.append(f"{where}: {word} ({key}) is its ayah's last word: the imam stops there (waqf), so the "
                           f"ending the diagram shows is not heard; use another occurrence of the word")
    return out


def pause_problems(clips: dict, word_of) -> list[str]:
    """Every clip that ends its ayah has an ending the waqf note can describe (`pause_drop`):
    "other" stops here until the note has the wording (messages Clip.waqf_note, src/lib/heard.ts).
    `word_of(key)`: the Arabic of the clip's last word as the page shows it."""
    out = []
    for key, clip in clips.items():
        if not parse_key(key) or not isinstance(clip, dict) or not clip.get("last"):
            continue
        word = word_of(key)
        if word and pause_drop(word) == "other":
            out.append(f"clips[{key}]: {word} ends its ayah, where the pause changes its ending in a way the waqf "
                       f"note has no wording for (fathatain, ta' marbuthah or a pronoun's long vowel); add the "
                       f"wording (messages Clip, src/lib/heard.ts, clips.pause_drop) or use another example")
    return out


# ---------------------------------------------------------------- the fixture (ayat without a lesson)
FIXTURE_COMMENT = (
    "The ayat of the example clips OUTSIDE the lessons (content/library.json `clips`: a parts diagram's bentuk "
    "dasar, a Harakat sign's word), exactly as the pinned files have them: `tanzil` = the Tanzil Uthmani line, "
    "`segments` and `stats` = the quran-align Alafasy_128kbps entry. pipeline/cache is git-ignored, so without "
    "this file CI could not tell a shifted timing or a wrong word in these clips (review 2026-10-12). Written "
    "by build_library.py (clips.fixture_from); validate_clips.py checks it against the pinned files when the "
    "cache is present, and the clips against it in every run. Never edit by hand."
)


def outside_ayat(keys) -> list[tuple[int, int]]:
    """The ayat of the clip keys that no lesson covers, in mushaf order."""
    out = set()
    for key in keys:
        p = parse_key(key)
        if p and p[0] not in SURAH_BY_NUM:
            out.add((p[0], p[1]))
    return sorted(out)


def fixture_pins(src: dict) -> dict:
    I = src["inputs"]
    qa = I["quran_align"]
    return {"tanzil_uthmani": f"{I['tanzil_uthmani']['version']} sha256:{I['tanzil_uthmani']['sha256']}",
            "quran_align": f"{qa['version']} {ALIGN_MEMBER} sha256:{qa['members'][ALIGN_MEMBER]['sha256']}"}


def needs_basmalah(ayat) -> bool:
    """Does common.lesson_ayah need the line of 1:1 to cut the surah-heading basmalah off one of them?"""
    return any(a == 1 and s not in (1, 9) for s, a in ayat)


def fixture_from(keys, align: dict, T, src: dict, comment: str = FIXTURE_COMMENT) -> dict:
    """The fixture for the clips `keys`, from the pinned files. `comment`: the file's own note
    (the lessons' example voices keep a fixture of their own, compose.EXAMPLES_FIXTURE)."""
    ayat = outside_ayat(keys)
    out = {"_comment": comment, "pins": fixture_pins(src)}
    if needs_basmalah(ayat):
        out["basmalah"] = T.verses[(1, 1)]
    out["ayat"] = {f"{s}:{a}": {"tanzil": T.verses[(s, a)], "segments": align[(s, a)]["segments"],
                              "stats": align[(s, a)].get("stats", {})}
                   for s, a in ayat if (s, a) in T.verses and (s, a) in align}
    return out


def fixture_text(fx: dict) -> str:
    """The fixture file's text: one line per ayah field, so a diff shows the word that moved."""
    j = lambda v: json.dumps(v, ensure_ascii=False)
    lines = ["{", f' "_comment": {j(fx["_comment"])},', f' "pins": {j(fx["pins"])},']
    if "basmalah" in fx:
        lines.append(f' "basmalah": {j(fx["basmalah"])},')
    lines.append(' "ayat": {')
    ayat = list(fx["ayat"].items())
    for i, (k, v) in enumerate(ayat):
        lines += [f'  {j(k)}: {{', f'   "tanzil": {j(v["tanzil"])},', f'   "segments": {j(v["segments"])},',
                  f'   "stats": {j(v["stats"])}', "  }" + ("," if i < len(ayat) - 1 else "")]
    lines += [" }", "}"]
    return "\n".join(lines) + "\n"


def fixture_sources(fx: dict | None) -> tuple[dict, Tanzil]:
    """The fixture as `clip_from` reads the pinned files: ({(s, a): entry}, Tanzil)."""
    align, verses = {}, {}
    for k, v in ((fx or {}).get("ayat") or {}).items():
        m = re.match(r"^(\d{1,3}):(\d{1,3})$", k)
        if not m or not isinstance(v, dict) or not isinstance(v.get("tanzil"), str) or not isinstance(v.get("segments"), list):
            continue
        s, a = int(m.group(1)), int(m.group(2))
        verses[(s, a)] = v["tanzil"]
        align[(s, a)] = {"surah": s, "ayah": a, "segments": v["segments"], "stats": v.get("stats", {})}
    if isinstance((fx or {}).get("basmalah"), str):
        verses.setdefault((1, 1), fx["basmalah"])
    return align, Tanzil(raw="", verses=verses, footer="")


def fixture_problems(fx, keys, src: dict, align: dict | None = None, T=None, name: str | None = None) -> list[str]:
    """The fixture holds exactly the ayat of the clips outside the lessons, under the current pins;
    with the corpus, each is the pinned Tanzil line and quran-align entry. `name`: the fixture
    file's name in the messages (default: FIXTURE's)."""
    name = name or FIXTURE.name
    if not isinstance(fx, dict) or not isinstance(fx.get("ayat"), dict):
        return [f"{name}: missing or not a fixture (run build_library.py)"]
    out = []
    if fx.get("pins") != fixture_pins(src):
        out.append(f"{name}: pins {fx.get('pins')!r} are not those of sources.json (run build_library.py)")
    want = [f"{s}:{a}" for s, a in outside_ayat(keys)]
    for k in want:
        if k not in fx["ayat"]:
            out.append(f"{name}: no entry for {k}, the ayah of a clip outside the lessons (run build_library.py)")
    for k in fx["ayat"]:
        if k not in want:
            out.append(f"{name}: {k} is not the ayah of any clip outside the lessons (run build_library.py)")
    fa, fT = fixture_sources(fx)
    for k in want:
        s, a = map(int, k.split(":"))
        if k in fx["ayat"] and (s, a) not in fa:
            out.append(f"{name}: {k} must be {{tanzil, segments, stats}}")
    if needs_basmalah(outside_ayat(keys)) and (1, 1) not in fT.verses:
        out.append(f"{name}: no `basmalah` (the line of 1:1), needed to read an ayah 1 (run build_library.py)")
    if align is None or T is None:
        return out
    for (s, a), e in fa.items():
        if fT.verses[(s, a)] != T.verses.get((s, a)):
            out.append(f"{name}: {s}:{a} is not the pinned Tanzil line (run build_library.py)")
        pinned = align.get((s, a)) or {}
        if e["segments"] != pinned.get("segments") or e["stats"] != pinned.get("stats", {}):
            out.append(f"{name}: {s}:{a} is not the pinned quran-align entry of {RECITER} (run build_library.py)")
    if "basmalah" in fx and fx["basmalah"] != T.verses.get((1, 1)):
        out.append(f"{name}: basmalah is not the pinned Tanzil line of 1:1 (run build_library.py)")
    return out


# ---------------------------------------------------------------- the lessons' side
def shown_bytes(key: str, lib: dict, lessons: dict) -> str | None:
    """The Arabic a page shows for the example `key`: the library's resolved bytes where it names
    them (a parts tile, a run), else the lesson word's own `ar` (an example row, a sign's word)."""
    if key in lib.get("quran", {}):
        return lib["quran"][key]
    p = parse_key(key)
    if not p or p[2] != p[3]:
        return None
    w = lesson_word(lessons, p[0], p[1], p[2])
    return w["ar"] if w else None


def lesson_ayah_of(lessons: dict, s: int, a: int) -> dict | None:
    for les in lessons.values():
        if les.get("surah") != s:
            continue
        for ay in les.get("ayat", []):
            if ay.get("ayah") == a:
                return ay
    return None


def lesson_word(lessons: dict, s: int, a: int, w: int) -> dict | None:
    words = (lesson_ayah_of(lessons, s, a) or {}).get("words", [])
    return words[w - 1] if 1 <= w <= len(words) else None


def lesson_recitation(lessons: dict, s: int, a: int) -> dict | None:
    ay = lesson_ayah_of(lessons, s, a)
    return next((r for r in ay.get("recitation", []) if r.get("reciter") == RECITER), None) if ay else None


def lesson_translit(lessons: dict) -> dict[str, str]:
    return {w["loc"]: w["translit"] for les in lessons.values() for ay in les.get("ayat", [])
            for w in ay.get("words", []) if "loc" in w and "translit" in w}


def tokens_reader(lessons: dict, T):
    """tokens_of(s, a) → the ayah's words: a lesson ayah's own words (validate.py holds them to the
    Tanzil text), else the Tanzil line of `T` (the pinned file, or the fixture's)."""
    def tokens_of(s: int, a: int) -> list[str] | None:
        if s in SURAH_BY_NUM:
            ay = lesson_ayah_of(lessons, s, a)
            return [w.get("ar", "") for w in ay.get("words", [])] if ay else None
        if T is not None and (s, a) in T.verses:
            return lesson_ayah(T, s, a)[0].split(" ")
        return None
    return tokens_of


def heard_problems(lib: dict, lessons: dict, T) -> list[str]:
    """Every rule about what the learner hears (the module docstring), from library.json, the
    lessons and the Tanzil lines of the ayat outside them (`T`: the fixture's, or the pinned file)."""
    return (sign_heard_problems(lib.get("basics", []), tokens_reader(lessons, T))
            + tile_problems(lib, lesson_translit(lessons))
            + pause_problems(lib.get("clips", {}), lambda key: (shown_bytes(key, lib, lessons) or "").split(" ")[-1]))


def problems(lib: dict, lessons: dict, src: dict, align: dict | None = None, T=None,
             fixture: dict | None = None, fixture_name: str | None = None) -> tuple[list[str], list[str]]:
    """(errors, warnings) of library.json `clips`. Without `align` and `T` (CI: --no-corpus) the
    corpus-free checks only — the lessons' own timings, and the fixture for the ayat outside them;
    with them, also a fresh build and the Tanzil tokens. `fixture`: FIXTURE's content.
    `fixture_name`: that file's name in the messages, when it is not FIXTURE (the lessons' example
    voices are checked through here too, as a library of their own: compose.voice_problems)."""
    fixture_name = fixture_name or FIXTURE.name
    errs, warns = [], []
    clips = lib.get("clips")
    if not isinstance(clips, dict):
        return [f"library.json has no clips (run build_library.py)"], []
    want = wanted(lib)
    keys = {k for k, _ in want}
    for key, where in want:
        if key not in clips:
            errs.append(f"{where}: {key} has no clip (an example with no voice; run build_library.py)")
    for key in clips:
        if key not in keys:
            errs.append(f"clips[{key}]: no page shows this example (an unwanted clip)")
    if list(clips) != sorted(clips, key=lambda k: (order(k), k)):
        errs.append("clips: keys are not in mushaf order (run build_library.py)")
    errs += fixture_problems(fixture, keys | set(clips), src, align, T, fixture_name)
    fx_align, fx_T = fixture_sources(fixture)
    for key, clip in clips.items():
        errs += clip_problems(key, clip)
        p = parse_key(key)
        if not p or not isinstance(clip, dict):
            continue
        s, a, w, w2 = p
        # A lesson ayah: the lesson's own recitation entry, already checked by validate.py against
        # quran-align, the Tanzil tokens and the streamed file's length.
        if s in SURAH_BY_NUM:
            rec = lesson_recitation(lessons, s, a)
            if not rec:
                errs.append(f"clips[{key}]: the lesson of {s}:{a} has no {RECITER} recitation entry")
                continue
            seg = {x[0]: x for x in rec.get("segments", [])}
            if clip.get("url") != rec.get("url"):
                errs.append(f"clips[{key}]: url {clip.get('url')!r} is not the lesson's {rec.get('url')!r}")
            if w not in seg or w2 not in seg:
                errs.append(f"clips[{key}]: the lesson's recitation of {s}:{a} has no timing for word(s) {w}..{w2}")
            elif (clip.get("start"), clip.get("end")) != (seg[w][1], seg[w2][2]):
                errs.append(f"clips[{key}]: [{clip.get('start')}, {clip.get('end')}] is not the lesson's timing of "
                            f"word(s) {w}..{w2} of {s}:{a} [{seg[w][1]}, {seg[w2][2]}]")
            if (clip.get("last") is True) != is_last(s, a, w2):
                n = SURAH_BY_NUM[s].words[a - 1] if 1 <= a <= SURAH_BY_NUM[s].n_ayat else "?"
                errs.append(f"clips[{key}]: `last` must be true exactly on the ayah's last word ({s}:{a} has {n} "
                            f"words): the page's waqf note depends on it (run build_library.py)")
            for i in range(w, w2 + 1):
                lw = lesson_word(lessons, s, a, i)
                if not lw or lw.get("loc") != f"{s}:{a}:{i}":
                    errs.append(f"clips[{key}]: word {i} of the lesson ayah {s}:{a} is not {s}:{a}:{i}")
            if w == w2 and key in lib.get("quran", {}):
                lw = lesson_word(lessons, s, a, w)
                if lw and lw.get("ar") != lib["quran"][key]:
                    errs.append(f"clips[{key}]: the page shows {lib['quran'][key]} but the lesson word "
                                f"at that index is {lw.get('ar')}")
        # An ayah without a lesson: the committed fixture's Tanzil line and quran-align entry.
        elif (s, a) in fx_align:
            fresh, e, _ = clip_from(key, fx_align, fx_T)
            errs += [f"{fixture_name}: {x}" for x in e]
            if not e and fresh != clip:
                errs.append(f"clips[{key}]: {clip} is not the clip the fixture's quran-align entry of {s}:{a} gives, "
                            f"{fresh} (a shifted timing, another ayah's file or a wrong `last`; run build_library.py)")
            tokens = lesson_ayah(fx_T, s, a)[0].split(" ")
            shown = shown_bytes(key, lib, lessons)
            if w2 <= len(tokens) and shown is not None and shown != " ".join(tokens[w - 1:w2]):
                errs.append(f"clips[{key}]: the page shows {shown} but the fixture's Tanzil token(s) at the clip's "
                            f"index are {' '.join(tokens[w - 1:w2])}")
    # Every word, run and letter the library resolves in a fixture ayah is the fixture's bytes (the
    # word before a hamzat washal, a sign's letter): corpus-free too.
    for qk, shown in lib.get("quran", {}).items():
        m = TM.QREF.match("q:" + qk)
        if not m or m.group(5) or (int(m.group(1)), int(m.group(2))) not in fx_T.verses or int(m.group(1)) in SURAH_BY_NUM:
            continue
        toks = lesson_ayah(fx_T, int(m.group(1)), int(m.group(2)))[0].split(" ")
        try:
            want_bytes = TM.resolve_q("q:" + qk, lambda s_, a_, w_: toks[w_ - 1] if 1 <= w_ <= len(toks) else None,
                                      lambda *_: [])
        except ValueError as x:
            errs.append(f"library quran[{qk}]: {x}")
            continue
        if want_bytes != shown:
            errs.append(f"library quran[{qk}] {shown} is not the fixture's Tanzil bytes {want_bytes}")
    errs += heard_problems(lib, lessons, fx_T)
    pin = src["inputs"]["quran_align"]["members"][ALIGN_MEMBER]["sha256"]
    if pin not in lib.get("data_versions", {}).get(DATA_VERSION, ""):
        errs.append(f"library.json data_versions.{DATA_VERSION} does not pin {ALIGN_MEMBER} sha256:{pin[:12]}… "
                    f"(run build_library.py)")
    if align is None or T is None:
        return errs, warns
    fresh, e, w = build(lib, align, T)
    errs += [f"fresh build: {x}" for x in e]
    warns += w
    for key in sorted(set(fresh) | set(clips), key=lambda k: (order(k), k)):
        if fresh.get(key) != clips.get(key):
            errs.append(f"clips[{key}]: {clips.get(key)} differs from a fresh build from quran-align "
                        f"{fresh.get(key)} (run build_library.py)")
    for key in clips:
        p = parse_key(key)
        if not p or (p[0], p[1]) not in T.verses:
            continue
        s, a, w, w2 = p
        tokens = lesson_ayah(T, s, a)[0].split(" ")
        tanzil = " ".join(tokens[w - 1:w2])
        shown = shown_bytes(key, lib, lessons)
        if shown is None:
            errs.append(f"clips[{key}]: no bytes a page shows for this example (library quran, lesson words)")
        elif shown != tanzil:
            errs.append(f"clips[{key}]: the page shows {shown} but the Tanzil token(s) at the clip's index are {tanzil}")
    return errs, warns
