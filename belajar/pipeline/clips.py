"""The imam's voice of every example the static library pages show (operator, 2026-10-12: "in
explanation, for example when explaining dhommah, kasrah, etc provide example + additional voice.
e.g ismu (read by voice + show visual) when combined with harf jar, it becomes ismi (read by voice +
visual). in principel, each explanation should be followed by examples (visual + voice)" — "not
only for harakah, but also for all rules").

A clip is one ayah's streamed recording and the place of one word (or one run of words) in it:
`{"url": <EveryAyah file of that ayah>, "start": ms, "end": ms}`, keyed by the word's location
("55:78:2", or "112:1:2-4" for a run). The voice is the IMAM, never the narrator: Mishary Alafasy
(`Alafasy_128kbps`, the module's default reciter, plan L7), the very files and the very timing
convention the lessons use — the pinned quran-align release, read through build_surah.word_segments
(segment [wordStart0, wordEndExclusive0, startMs, endMs] → word wordStart0 + 1, the Tanzil token
index of common.lesson_ayah) and build_surah.everyayah_url. Nothing is cut, copied or stored: the
browser seeks within the streamed file and stops at `end` (src/components/library/ClipButton.tsx),
the way the lesson plays one word (src/hooks/useSegmentPlayer.ts).

Which examples (`wanted`), in the order the pages show them:
  - every concept example (`concepts[].examples[].loc`, a lesson word): the Konsep example rows;
  - the word of every Harakat sign's example letter (`basics[].signs[].example`, a letter q-ref
    "q:1:1:1#1"): a letter alone is never recited, so its voice is the word it is cut from;
  - every parts diagram's joined word (`parts[].loc`) and each tile that is a whole Tanzil token
    (ٱسْمُ at q:55:78:2, the bentuk dasar). A tile that is a QAC segment (bi-, li-, -hu, -hum, -ta) is
    never recited on its own, so it has no clip (`unvoiced` lists them and why); the joined word's
    clip voices it inside the word.

Checks (`clip_problems`, `problems`; run by build_library.py and validate_clips.py):
  - every wanted example has a clip and no clip is unwanted; keys in mushaf order;
  - url = the reciter's EveryAyah file of that ayah; start, end integers, 0 ≤ start < end;
  - duration plausible: MIN_MS–MAX_MS for a word, up to MAX_LAST_MS for the last word of a lesson
    ayah (the imam holds the madd at the pause: ad-ḍāllīna, 1:7:9, measures 5,680 ms). Whether a
    word is its ayah's last is read from common.SURAHS (the lessons' word counts), so the rule is the
    same with and without the corpus; a word of any other ayah keeps the MAX_MS cap;
  - a lesson ayah's clip equals the lesson's own Alafasy recitation entry (its url, the segment of
    the word), and that lesson word is the one the page shows (its loc, its bytes = library
    `quran` where the library names it): corpus-free, so CI checks it;
  - library data_versions.quran_align pins the reciter's quran-align member (sources.json);
  - with the corpus (pipeline/cache): every clip equals a fresh one from the pinned quran-align file;
    that ayah's single-word segments cover its Tanzil tokens 1..N exactly once (the index mapping
    the lessons rely on), no segment joins a clip's word to another, and the Tanzil token(s) at the
    clip's index are the bytes the page shows for that example. A non-zero quran-align matcher
    statistic for the ayah is a warning ("check by ear"), as build_surah.py warns for the lessons.

Standard library only; no network (the MP3s are never downloaded here).
"""
from __future__ import annotations

import json
import re

import terms as TM
from build_surah import everyayah_url, word_segments
from common import PIPELINE, SURAH_BY_NUM, lesson_ayah, sha256_file

RECITER = "Alafasy_128kbps"  # plan L7: the default voice (build_surah.RECITERS, src/lib/ayah.ts)
ALIGN_MEMBER = f"{RECITER}.json"
MIN_MS = 150
MAX_MS = 4000
MAX_LAST_MS = 7000
KEY = re.compile(r"^(\d{1,3}):(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$")
WORD_LOC = re.compile(r"^(\d{1,3}):(\d{1,3}):(\d{1,3})$")
DATA_VERSION = "quran_align"


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
            k = key_of(t.get("q", ""))
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
    """Is word w the last word of ayah s:a by the lessons' word counts (common.SURAHS)? False for
    an ayah without a lesson (its clip keeps the MAX_MS cap, in every mode)."""
    spec = SURAH_BY_NUM.get(s)
    return bool(spec and 1 <= a <= spec.n_ayat and spec.words[a - 1] == w)


def clip_problems(key: str, clip) -> list[str]:
    """The corpus-free checks of one clip: key, url, integers, order, plausible duration."""
    where = f"clips[{key}]"
    p = parse_key(key)
    if not p:
        return [f"{where}: key must be s:a:w or s:a:w1-w2 with w1 ≤ w2"]
    s, a, w, w2 = p
    if not isinstance(clip, dict) or set(clip) != {"url", "start", "end"}:
        return [f"{where}: must be exactly {{url, start, end}}, got {clip!r}"]
    out = []
    if clip["url"] != everyayah_url(RECITER, s, a):
        out.append(f"{where}: url {clip['url']!r} is not {RECITER}'s file of {s}:{a} ({everyayah_url(RECITER, s, a)})")
    st, en = clip["start"], clip["end"]
    if not all(isinstance(x, int) and not isinstance(x, bool) for x in (st, en)):
        return out + [f"{where}: start and end must be integers (ms), got {st!r}, {en!r}"]
    if st < 0 or en <= st:
        return out + [f"{where}: start {st} must be ≥ 0 and before end {en}"]
    cap = MAX_LAST_MS if is_last(s, a, w2) else MAX_MS
    n = w2 - w + 1
    if not MIN_MS * n <= en - st <= cap * n:
        out.append(f"{where}: {en - st} ms is not a plausible length for {n} word(s) "
                   f"({MIN_MS}–{cap} ms a word{', the ayah’s last word' if cap == MAX_LAST_MS else ''})")
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
    """(clip, errors, warnings) for one key from the pinned quran-align entry of its ayah: the
    first word's start and the last word's end, after checking that the ayah's single-word
    segments cover its Tanzil tokens 1..N exactly once and that no segment joins a clip word
    to another (build_surah.check_segments' coverage rule for the lessons)."""
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


def lesson_word(lessons: dict, s: int, a: int, w: int) -> dict | None:
    for les in lessons.values():
        if les.get("surah") != s:
            continue
        for ay in les.get("ayat", []):
            if ay.get("ayah") == a:
                words = ay.get("words", [])
                return words[w - 1] if 1 <= w <= len(words) else None
    return None


def lesson_recitation(lessons: dict, s: int, a: int) -> dict | None:
    for les in lessons.values():
        if les.get("surah") != s:
            continue
        for ay in les.get("ayat", []):
            if ay.get("ayah") == a:
                return next((r for r in ay.get("recitation", []) if r.get("reciter") == RECITER), None)
    return None


def problems(lib: dict, lessons: dict, src: dict, align: dict | None = None, T=None) -> tuple[list[str], list[str]]:
    """(errors, warnings) of library.json `clips`. Without `align` and `T` (CI: --no-corpus) the
    corpus-free checks only; with them, also a fresh build and the Tanzil tokens."""
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
            for i in range(w, w2 + 1):
                lw = lesson_word(lessons, s, a, i)
                if not lw or lw.get("loc") != f"{s}:{a}:{i}":
                    errs.append(f"clips[{key}]: word {i} of the lesson ayah {s}:{a} is not {s}:{a}:{i}")
            if w == w2 and key in lib.get("quran", {}):
                lw = lesson_word(lessons, s, a, w)
                if lw and lw.get("ar") != lib["quran"][key]:
                    errs.append(f"clips[{key}]: the page shows {lib['quran'][key]} but the lesson word "
                                f"at that index is {lw.get('ar')}")
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
