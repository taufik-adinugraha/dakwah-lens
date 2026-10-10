#!/usr/bin/env python3
"""Validator for the guided-lesson narration manifests (belajar/content/narration/*.json).

Checks every line the AI narrator may speak, the coverage of the step-id contract and any
rendered audio. Exit 1 on any failure. Standard library only; run from belajar/pipeline:

    python3 validate_narration.py

What it enforces (README "Narasi" has the reasons):

- Manifest shape: {version: 1, voice: null | {id, name, model: "eleven_v3"}, lines: {id: {text, audio?}}}.
- Ids follow the contract: "${slug}:${ayah}:${part}" with part in intro | recite | w${n} |
  structure | concept:${conceptId} | ex:${exerciseKey}:${lineKey} | recap | next | done, and
  "shared:${key}" in shared.json. A line longer than MAX_LINE is split into "<id>:a", "<id>:b", …
  (at least two parts, letters contiguous from a, never next to the unsplit id).
- Coverage: every ayah has intro, recite, one w${n} per word, structure, concept:${id} for each
  Konsep whose first example is in that ayah, ex:${key}:intro for each exercise the ayah shows,
  recap, and next (or done on the last ayah). Nothing else. shared.json holds SHARED_KEYS plus
  ex:${key}:${part} for every guide part of every exercise (mirrors src/components/exercises/guide.ts).
- Text: non-empty, trimmed, at most MAX_LINE characters; no Arabic script; no digits (numbers are
  spelled out); no transliteration diacritics (ā ḥ ṣ ‘ …); ASCII plus “ ” — – … only; no ALL-CAPS
  word except ACRONYMS.
- No Qur'anic word, in any spelling the narrator could voice: the normalised `translit` of every
  word of every lesson surah, plus its i'rab-stripped form (al-ḥamdu → al-ḥamd), its form without
  the article (ṣirāṭ), its space-separated parts (the wa of wa lā) and ALIASES (ism inside bismi).
  Matching is on whole tokens after folding (diacritics and apostrophes dropped, lower case), and a
  token that merely starts with such a form (alhamdulillah, bismillah) fails too. Spelling- and
  ending-blind as well (`sound`, `stem`): Indonesian digraphs (a'udzu, ash-shirath, ghairi,
  adh-dhollin), other case endings (rabbu, rabbil), pausal forms of mabni words (khalaq, hasad), a
  ta marbuta spelled -ah (al-jinnah) and two words run together as recited (huwallahu). Exceptions,
  and only these:
    * "Allah" (no case ending) inside “…” (the spoken translation and quoted glosses are
      Indonesian, not Qur'an) or followed by the honorific "subhanahu wa ta'ala";
    * the honorifics HONORIFICS themselves;
    * a surah name right after "Surah" (Surah An-Nas, Surah Al-Falaq);
    * "lam" as the name of the letter, i.e. with "huruf" (or "alif": "alif lam", the article)
      among the four tokens before it.
- Word places: a line names a word of its own ayah by its place ("kata kedua"), never more places
  than the ayah has words, never a place in another ayah (it is named by its meaning there), never a
  place inside a place, and never "di kartu ini" (the stage shows no card); a concept's title is
  never turned into a place.
- Audio (when present): url = /belajar/media/narration/<voice-slug>/<slug>/<file>.mp3 with <file>
  the id with every ":" written "__" (media_file), ms > 0, 64-hex sha256, and the manifest names
  its voice.
- The manifests equal a fresh build_narration.py run (no hand edits, no stale lines), and the
  speech text render_narration.py would send (build_narration.tts_text) carries no digits, Arabic,
  brackets or quotes.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

from common import BELAJAR, CONTENT_DIR, SURAHS

NARRATION_DIR = CONTENT_DIR / "narration"
GUIDE_TS = BELAJAR / "src" / "components" / "exercises" / "guide.ts"
MEDIA_PREFIX = "/belajar/media/narration/"
MANIFEST_VERSION = 1
MAX_LINE = 400
TTS_MAX = 5000  # eleven_v3 characters per request
MODEL = "eleven_v3"

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
# Ayah page: Alafasy first (plan L7); TapWord uses the first source.
RECITER_ORDER = ("Alafasy_128kbps", "Husary_Muallim_128kbps")
# WhyHarakat GRADED == cases.ts SORT_BINS.
GRADED = ("marfu", "manshub", "majrur", "mabni")

# Generic lines, shared by every lesson (shared.json, "shared:${key}"). The exercise prompts
# "shared:ex:${key}:${part}" are added from EXERCISE_GUIDE_PARTS.
SHARED_KEYS = ("start", "resume", "correct", "try_again", "revealed", "reminder", "skip_offer", "surah_done")
ACRONYMS = {"AI"}
HONORIFICS = ("subhanahu wa ta'ala", "shallallahu 'alaihi wa sallam")


def exercise_counts(ayah: dict, library: dict) -> dict[str, int]:
    """Questions each exercise asks on this ayah, by the components' own rules; an exercise the
    page does not show (too few items) is left out."""
    words = ayah["words"]
    rank = {r: i for i, r in enumerate(RECITER_ORDER)}
    srcs = sorted(ayah["recitation"], key=lambda r: rank.get(r["reciter"], len(RECITER_ORDER)))
    timed = {seg[0] for seg in srcs[0]["segments"]} if srcs else set()
    lex = {x["id"]: x for x in library["lexicon"]}
    lemma_ids: list[str] = []
    for w in words:
        if w.get("lemma_id") and w["lemma_id"] not in lemma_ids:
            lemma_ids.append(w["lemma_id"])
    wazn_items = 0
    for lid in lemma_ids:
        forms = ((lex.get(lid) or {}).get("tashrif") or {}).get("forms") or []
        if len(forms) >= 3:
            wazn_items += len(forms)
    raw = {
        "tap-word": (sum(1 for i in range(1, len(words) + 1) if i in timed), 2),
        "why-harakat": (sum(1 for w in words if w["case"]["state"] in GRADED), 1),
        "sort-case": (sum(1 for w in words if w["case"]["state"] in GRADED), 2),
        "label-role": (sum(1 for w in words if w.get("role")), 2),
        "wazn-factory": (wazn_items, 2),
    }
    return {k: n for k, (n, need) in raw.items() if n >= need}


def introduced_concepts(ayah_loc: str, library: dict) -> list[dict]:
    """Konsep records whose FIRST example is in this ayah (src/lib/library.ts conceptsIntroducedIn)."""
    out = []
    for c in library["concepts"]:
        ex = c.get("examples") or []
        if ex and ":".join(ex[0]["loc"].split(":")[:2]) == ayah_loc:
            out.append(c)
    return out


def expected_parts(lesson: dict, library: dict) -> dict[int, list[str]]:
    """Part names each ayah's narration must have, in lesson order."""
    out: dict[int, list[str]] = {}
    last = lesson["ayat"][-1]["ayah"]
    for a in lesson["ayat"]:
        parts = ["intro", "recite"] + [f"w{i}" for i in range(1, len(a["words"]) + 1)]
        parts += [f"concept:{c['id']}" for c in introduced_concepts(a["loc"], library)]
        if a.get("structure"):
            parts.append("structure")
        parts += [f"ex:{k}:intro" for k in EXERCISE_KEYS if k in exercise_counts(a, library)]
        parts += ["recap", "done" if a["ayah"] == last else "next"]
        out[a["ayah"]] = parts
    return out


def expected_shared() -> list[str]:
    return list(SHARED_KEYS) + [f"ex:{k}:{p}" for k in EXERCISE_KEYS for p in EXERCISE_GUIDE_PARTS[k]]


# ------------------------------------------------------------------ text folding and tokens
APOS = "'‘’ʼʿʾ`´"
_APOS = re.compile(f"[{APOS}]")
TOKEN = re.compile(f"[{APOS}]?[^\\W\\d_]+(?:[{APOS}][^\\W\\d_]+)*[{APOS}]?")
ARABIC = re.compile("[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
EXTRA_CHARS = set("“”—–…")  # “ ” — – …


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


def media_file(lid: str) -> str:
    """File name of a line's audio: the id with ':' written '__' ("al-fatihah__1__w1.mp3"), so every
    path segment is [A-Za-z0-9_-] (colons break scp host parsing and the app's same-origin path rule)."""
    return lid.replace(":", "__") + ".mp3"


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", fold(name).lower()).strip("-")
    return s or "voice"


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


def stem(k: str, min_len: int = 3) -> str | None:
    """A token without its case ending: a final short vowel (rabbu, rabba → rabb), tanwin
    (aḥadan → aḥad) or a joined article vowel (rabbil, rabbul → rabb); None when too short."""
    for end, need in (("un", 3), ("an", 3), ("in", 3), ("il", 4), ("ul", 4), ("al", 4), ("a", 3), ("i", 3), ("u", 3)):
        if k.endswith(end) and len(k) - len(end) >= max(need, min_len):
            return k[: -len(end)]
    return None


class Forms:
    """Every spelling of a lesson word the narrator must not voice, mapped to the words it names.

    forms[key tuple] = [((surah, ayah, word), kind), …], kind "full" (the word itself, with or
    without its i'rab ending or article) or "part" (a piece of a multi-word token or an alias)."""

    def __init__(self, lessons: dict[str, dict]):
        self.forms: dict[tuple[str, ...], list[tuple[tuple[int, int, int], str]]] = {}
        self.translit: dict[tuple[int, int, int], str] = {}
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


# ------------------------------------------------------------------ checks
SLUG_ID = re.compile(
    r"^(?P<slug>[a-z-]+):(?P<ayah>[1-9]\d*):(?P<part>intro|recite|w[1-9]\d*|structure|concept:[a-z0-9-]+"
    r"|ex:(?:" + "|".join(EXERCISE_KEYS) + r"):[a-z][a-z_]+|recap|next|done)(?::(?P<split>[a-z]))?$"
)
SHARED_ID = re.compile(r"^shared:(?P<part>[a-z_]+(?::[a-z-]+:[a-z_]+)?)(?::(?P<split>[a-z]))?$")
HONORIFIC_RE = re.compile("|".join(re.escape(h) for h in HONORIFICS))
QUOTED = re.compile("“[^”]*”")
SHA = re.compile(r"^[0-9a-f]{64}$")


def _letter_context(toks, i: int, text: str) -> bool:
    """`toks[i]` is "lam" naming the letter: "huruf" (or "alif", as in "alif lam", the article) is
    among the four tokens before it, with no sentence end in between."""
    for j in range(max(0, i - 4), i):
        if toks[j][0] in ("huruf", "alif") and not re.search(r"[.!?]", text[toks[j][2]:toks[i][1]]):
            return True
    return False


def check_text(lid: str, text, forms: Forms) -> list[str]:
    errs: list[str] = []
    if not isinstance(text, str) or not text.strip():
        return [f"{lid}: empty text"]
    if text != text.strip() or "  " in text:
        errs.append(f"{lid}: stray whitespace")
    if len(text) > MAX_LINE:
        errs.append(f"{lid}: {len(text)} characters, more than {MAX_LINE} (split it into :a/:b)")
    if ARABIC.search(text):
        errs.append(f"{lid}: Arabic script in narration")
    if re.search(r"\d", text):
        errs.append(f"{lid}: digit in narration (spell numbers out)")
    odd = sorted({c for c in text if not (" " <= c <= "~") and c not in EXTRA_CHARS})
    if odd:
        if any(unicodedata.category(c) == "Ll" or unicodedata.category(c) == "Lu" for c in odd) or any(c in APOS for c in odd):
            errs.append(f"{lid}: transliteration diacritic {''.join(odd)!r} (fold to plain letters)")
        else:
            errs.append(f"{lid}: character not allowed {''.join(odd)!r}")
    for m in re.finditer(r"\b[A-Z]{2,}\b", text):
        if m.group() not in ACRONYMS:
            errs.append(f"{lid}: ALL-CAPS word {m.group()!r}")
    honor = [(m.start(), m.end()) for m in HONORIFIC_RE.finditer(text)]
    quoted = [(m.start(), m.end()) for m in QUOTED.finditer(text)]
    inside = lambda spans, a, b: any(s <= a and b <= e for s, e in spans)  # noqa: E731
    found, toks = forms.mentions(text)
    covered: set[int] = set()
    for start, end, k, _cands, i, n in found:
        covered.update(range(i, i + n))
        if inside(honor, start, end):
            continue
        if k == ("allah",) and (inside(quoted, start, end) or text[end:].startswith(" subhanahu wa ta'ala")):
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
        # rabbu, rabbil, khalaq): spelling-blind, ending-blind.
        sk = sound(k)
        st = stem(sk)
        if sk in forms.sound_forms or sk in forms.stems or (st and (st in forms.stems or st in forms.sound_forms)):
            errs.append(f"{lid}: Qur'anic word {orig!r} (another spelling or ending) in narration")
            continue
        hit = next((jf for jf in forms.sound_joined if sk != jf and sk.startswith(jf)), None)
        hit = hit or next((x for x in forms.wasl if len(x) >= 7 and sk.startswith(x[:7])), None)
        if hit:
            errs.append(f"{lid}: Qur'anic phrase {orig!r} (starts with {hit!r}) in narration")
    # How the narration names words: by their place in THIS ayah, which the screen numbers. A
    # place in another ayah cannot be found on screen (name it by its meaning instead), a place
    # inside a place cannot be followed by ear, and the stage shows no word card to point at.
    if re.search(rf"\b[Kk]ata {ORDINAL}(?: (?:dan|sampai) {ORDINAL})? (?:di|pada) ayat\b", text):
        errs.append(f"{lid}: names a word of another ayah by its place (say its meaning)")
    if re.search(rf"\b[Kk]ata {ORDINAL} dalam (?:frasa )?kata\b", text):
        errs.append(f"{lid}: a word place inside another word place")
    if ":concept:" in lid and re.match(rf"Konsep baru: [Kk]ata (?:ini|{ORDINAL})\b", text):
        errs.append(f"{lid}: the concept's title became a word place")
    if re.search(r"\bdi kartu ini\b", text):
        errs.append(f"{lid}: refers to a card the lesson stage does not show")
    return errs


ORDINAL = r"(?:pertama|ke(?:dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas)(?: belas)?)"
_ORD = {"pertama": 1, "kedua": 2, "ketiga": 3, "keempat": 4, "kelima": 5, "keenam": 6, "ketujuh": 7,
        "kedelapan": 8, "kesembilan": 9, "kesepuluh": 10, "kesebelas": 11}


def ordinal_value(word: str) -> int:
    """pertama → 1, kedua belas → 12 (the ordinals build_narration.ordinal writes)."""
    if word.endswith(" belas"):
        return _ORD[word[:-len(" belas")]] + 10
    return _ORD[word]


def word_places(text: str) -> list[int]:
    """Word places a line names in its own ayah ("kata kedua", "kata ketiga dan keempat", "kata
    kedua sampai keempat"), in order of first mention; the stage rings them while the line plays.
    Mirrors wordRefs() in src/lib/autoplay/narration.ts."""
    out: list[int] = []
    for m in re.finditer(rf"\b[Kk]ata ({ORDINAL})(?: (dan|sampai) ({ORDINAL}))?\b", text):
        if re.match(r" (?:di|pada) ayat\b", text[m.end():]):
            continue  # another ayah's word (the validator rejects these anyway)
        a = ordinal_value(m.group(1))
        b = ordinal_value(m.group(3)) if m.group(3) else None
        ns = [a] if b is None else ([a, b] if m.group(2) == "dan" else list(range(a, b + 1)))
        out += [n for n in ns if n not in out]
    return out


def check_audio(lid: str, audio, manifest_slug: str, voice) -> list[str]:
    if not isinstance(audio, dict) or set(audio) != {"url", "ms", "sha256"}:
        return [f"{lid}: audio must be exactly {{url, ms, sha256}}"]
    errs = []
    url = audio["url"]
    if not isinstance(url, str) or not url.startswith(MEDIA_PREFIX) or ".." in url or not url.endswith(".mp3"):
        errs.append(f"{lid}: audio url must be an .mp3 under {MEDIA_PREFIX}")
    elif isinstance(voice, dict) and isinstance(voice.get("name"), str):
        want = f"{MEDIA_PREFIX}{slugify(voice['name'])}/{manifest_slug}/{media_file(lid)}"
        if url != want:
            errs.append(f"{lid}: audio url {url!r} is not {want!r}")
    if not isinstance(audio["ms"], int) or isinstance(audio["ms"], bool) or audio["ms"] <= 0:
        errs.append(f"{lid}: audio ms must be a positive integer")
    if not isinstance(audio["sha256"], str) or not SHA.match(audio["sha256"]):
        errs.append(f"{lid}: audio sha256 must be 64 lower-case hex characters")
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


def check_manifest(name: str, man, forms: Forms, lesson: dict | None, library: dict) -> list[str]:
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
    for lid, line in lines.items():
        if not isinstance(line, dict) or "text" not in line or set(line) - {"text", "audio"}:
            errs.append(f"{lid}: a line is {{text, audio?}}")
            continue
        if name != "shared":
            m = SLUG_ID.match(lid)
            if m and m.group("slug") != slug:
                errs.append(f"{lid}: id belongs to {m.group('slug')!r}, not {slug!r}")
        errs += check_text(lid, line["text"], forms)
        if "audio" in line:
            if voice is None:
                errs.append(f"{lid}: audio present but the manifest names no voice")
            errs += check_audio(lid, line["audio"], slug, voice)
    # coverage
    if name == "shared":
        want = {f"shared:{k}" for k in expected_shared()}
        have = set(groups)
        for lid in sorted(want - have):
            errs.append(f"shared: missing line {lid}")
        for lid in sorted(have - want):
            errs.append(f"shared: unexpected line {lid}")
    elif lesson is not None:
        want = {f"{slug}:{n}:{p}" for n, parts in expected_parts(lesson, library).items() for p in parts}
        have = set(groups)
        for lid in sorted(want - have):
            errs.append(f"{name}: missing line {lid}")
        for lid in sorted(have - want):
            errs.append(f"{name}: unexpected line {lid}")
        errs += check_content(name, lines, lesson)
    return errs


def _text_of(lines: dict, base: str) -> str:
    if base in lines:
        return lines[base].get("text", "") if isinstance(lines[base], dict) else ""
    parts = [lines[k].get("text", "") for k in sorted(lines) if k.startswith(base + ":") and len(k) == len(base) + 2
             and isinstance(lines[k], dict)]
    return " ".join(parts)


def check_content(name: str, lines: dict, lesson: dict) -> list[str]:
    """The intro reads the ayah's translation and each w${n} line gives the word's gloss."""
    errs = []
    for a in lesson["ayat"]:
        base = f"{lesson['slug']}:{a['ayah']}"
        intro = _text_of(lines, f"{base}:intro")
        tr = fold(spoken_translation(a["translation"]["text"]))
        if intro and f"“{tr}”" not in intro:
            errs.append(f"{base}:intro: does not read the translation “{tr}”")
        for i, w in enumerate(a["words"], 1):
            txt = _text_of(lines, f"{base}:w{i}")
            g = fold(w["gloss"])
            if txt and f"“{g}”" not in txt:
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


def check_build(manifests: dict[str, dict], lessons: dict[str, dict], library: dict) -> list[str]:
    """Manifest text == a fresh build, and the speech text is clean."""
    import build_narration as B  # local import: build_narration imports this module

    errs = []
    want = B.build_texts(lessons, library)
    for name, lines in want.items():
        man = manifests.get(name)
        got = man.get("lines", {}) if isinstance(man, dict) else {}
        if not isinstance(got, dict):
            continue
        for lid, text in lines.items():
            line = got.get(lid)
            if isinstance(line, dict) and line.get("text") != text:
                errs.append(f"{lid}: text is out of date with build_narration.py (rebuild, do not hand-edit)")
        for lid in set(got) - set(lines):
            errs.append(f"{lid}: not produced by build_narration.py")
    for name, man in manifests.items():
        for lid, line in (man.get("lines") or {}).items() if isinstance(man, dict) else ():
            if not isinstance(line, dict) or not isinstance(line.get("text"), str):
                continue
            tts = B.tts_text(line["text"])
            if re.search(r"\d", tts) or ARABIC.search(tts) or re.search("[()\"“”\\[\\]]", tts):
                errs.append(f"{lid}: speech text keeps a digit, Arabic, bracket or quote: {tts!r}")
            if "…" in tts or re.search(r"\w-(?=[\s,.;:!?]|$)", tts):
                errs.append(f"{lid}: speech text keeps an ellipsis or an open prefix: {tts!r}")
            if len(tts) > TTS_MAX:
                errs.append(f"{lid}: speech text longer than {TTS_MAX} characters")
    return errs


def check(manifests: dict[str, dict], lessons: dict[str, dict], library: dict, *, build: bool = True) -> list[str]:
    forms = Forms(lessons)
    errs: list[str] = []
    for sp in SURAHS:
        if sp.slug in lessons and sp.slug not in manifests:
            errs.append(f"{sp.slug}: narration manifest missing")
    if "shared" not in manifests:
        errs.append("shared: narration manifest missing")
    for name, man in manifests.items():
        if name != "shared" and name not in lessons:
            errs.append(f"{name}: narration manifest for a surah without a lesson")
            continue
        errs += check_manifest(name, man, forms, lessons.get(name), library)
    errs += check_guide_ts()
    if build:
        errs += check_build(manifests, lessons, library)
    return errs


def load_all() -> tuple[dict[str, dict], dict[str, dict], dict]:
    lessons = {sp.slug: json.loads((CONTENT_DIR / f"{sp.slug}.json").read_text(encoding="utf-8"))
               for sp in SURAHS if (CONTENT_DIR / f"{sp.slug}.json").exists()}
    library = json.loads((CONTENT_DIR / "library.json").read_text(encoding="utf-8"))
    order = {sp.slug: i for i, sp in enumerate(SURAHS)} | {"shared": len(SURAHS)}
    paths = sorted(NARRATION_DIR.glob("*.json"), key=lambda p: (order.get(p.stem, 99), p.stem))
    manifests = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in paths}
    return manifests, lessons, library


def main() -> int:
    manifests, lessons, library = load_all()
    errs = check(manifests, lessons, library)
    for name, man in manifests.items():
        lines = man.get("lines", {}) if isinstance(man, dict) else {}
        n_audio = sum(1 for x in lines.values() if isinstance(x, dict) and "audio" in x)
        chars = sum(len(x.get("text", "")) for x in lines.values() if isinstance(x, dict))
        print(f"{name:12s} {len(lines):4d} lines  {chars:6d} chars  {n_audio:4d} with audio")
    if errs:
        print(f"\nFAIL: {len(errs)} problem(s)")
        for e in errs:
            print("  -", e)
        return 1
    print("\nOK: narration manifests valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
