#!/usr/bin/env python3
"""Writes the guided-lesson narration manifests, belajar/content/narration/<slug>.json for every
lesson surah plus shared.json, from content/<slug>.json, content/library.json and the
pronunciation dictionary authored/pronunciation.json. Deterministic: templates + content fields,
no LLM, no network. Standard library only; run from belajar/pipeline:

    python3 build_narration.py           # write the manifests (audio of unchanged lines is kept)
    python3 build_narration.py --check   # exit 1 if a manifest on disk differs from a fresh build
    python3 build_narration.py --show al-fatihah:1:   # print the lines whose id starts with this

Manifest (version 2): {"version", "voice": null | {id, name, model}, "lines": {id: {"text",
"display", "highlight", "focus", "audio"?, "tokens"?}}}. Ids follow the step-id contract
(validate_narration.py docstring); a line whose spoken text would be longer than
validate_narration.MAX_LINE characters is split at sentence (then clause) ends into "<id>:a",
"<id>:b", …, which a player reads in order in place of "<id>".

Each line is written three ways, from one prose sentence:

1. the PROSE (Latin, quotes and brackets kept): the lesson's words of explanation with numbers
   spelled out, "QS" expanded, honorifics in full ("Allah subhanahu wa ta'ala", "Nabi Muhammad
   shallallahu 'alaihi wa sallam"), no Arabic script and no transliteration diacritics, every
   Qur'anic word replaced by its place ("kata kedua"), meanings introduced with "yang artinya",
   and "klik" (never "ketuk"). validate_narration.check_text guards it.
2. `text`, the SPOKEN text, exactly what is sent to the voice: each grammar term of the
   pronunciation dictionary (operator-approved by ear) said from its `speak` value — Arabic script
   (نَعْت, كَسْرَة, حَرْف جَرّ), or a fixed Latin respelling for a heavy letter (idhofah, mudhof
   ilaih, dhommah, dhomir) and the Name (Alloh) — then normalised for speech (tts_text: quotes
   dropped, brackets become commas).
3. `display`, the caption: the same sentence with each dictionary term in its display form
   ("na’t (نَعْت)", "idhafah (إِضَافَة)", "Allah") and a letter shown as in the ayah (بِ; the focus
   word's own first letter, لَ of lahu), never by its spelled-out name. Saying the display
   (validate_narration Lexicon.speech_of_display) gives `text` exactly.

The narrator never voices a Qur'anic word, in Arabic or in transliteration (plan §6.1 A1). Prose
from the lessons names words in SKB transliteration; `Sanitiser` replaces every such mention with
the word's place, which the screen highlights: "kata ini" (the word the line is about), "kata
kedua", "kata pertama dan kedua", "kata kedua sampai keempat", or, for a word of another ayah, its
meaning: "kata yang artinya “jalan” di ayat enam" (in another surah just "kata yang artinya “Dia
ciptakan”"). The prefixed particles are named by their letters (bi- → huruf ba', li- → huruf lam,
wa → wawu, the lā of wa lā → huruf nafi) and pronoun suffixes (-nā, -ta, -him, -hū) become
"akhiran". What stays is grammar vocabulary (mubtada', majrur, isim fa'il), scholars' names and
non-Qur'anic Arabic examples (abtadi'u, naffas), folded to plain letters; the ones the dictionary
has are then spoken from it.

`highlight` and `focus` say what the stage shows while the line plays (validate_narration.line_view):
the whole ayah ([0]) for intro/recite/structure/recap, word n (and its word card) for w${n}, the
words tagged with the concept and the words of its structure groups for concept:${id}.

Word composition and the harakat primer (operator 2026-10-10, narration rule 14; compose.py,
content/compose/<slug>.json): the ayah that opens with the primer gets "primer:${k}" lines after
"recite", one per `say` of the primer's frames; a word with a composition gets, after its w${n}
line, "w${n}:compose:${k}" lines, one per `say` of its frames, and its w${n} line becomes the gloss
plus the composition's `lead` ("Kata ini terdiri dari dua bagian.") instead of the word's `why`,
which the frames now say part by part. Each such line carries `frame` (the animation frame shown
while it plays). Its prose is authored to be spoken as written: the sanitiser runs in STRICT mode
(a Qur'anic word in it stops the build instead of being replaced by a place), and a letter term
is shown as the frame pins it or its tiles write it (validate_narration.line_letters). Letter names
are spoken from the dictionary too (huruf مِيم, the article "alif lam"; operator 2026-10-10: no
Latin letter names to the voice).
"""
from __future__ import annotations

import argparse
import json
import re
import sys

import validate_narration as V
from common import SURAHS

# Surahs cited in prose as "QS n:m" (fail loudly on any other): spoken "Surah <name> ayat <m>".
CITED_SURAH = {6: "Al-An'am"}

# ------------------------------------------------------------------ Indonesian numbers
_UNITS = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan",
          "sepuluh", "sebelas"]


def num_id(n: int) -> str:
    """Cardinal number in Indonesian words (0 – 999 999)."""
    if n < 0 or n >= 1_000_000:
        raise ValueError(f"number out of range: {n}")
    if n < 12:
        return _UNITS[n]
    if n < 20:
        return f"{_UNITS[n - 10]} belas"
    if n < 100:
        t, u = divmod(n, 10)
        return f"{_UNITS[t]} puluh" + (f" {_UNITS[u]}" if u else "")
    if n < 1000:
        h, r = divmod(n, 100)
        head = "seratus" if h == 1 else f"{_UNITS[h]} ratus"
        return head + (f" {num_id(r)}" if r else "")
    th, r = divmod(n, 1000)
    head = "seribu" if th == 1 else f"{num_id(th)} ribu"
    return head + (f" {num_id(r)}" if r else "")


def ordinal(n: int) -> str:
    """pertama, kedua, …, kesebelas, kedua belas."""
    return "pertama" if n == 1 else f"ke{num_id(n)}"


# Speech normalisation (quotes, brackets, ellipsis): validate_narration.tts_text, shared with the
# validator so both read a caption the same way.
tts_text = V.tts_text


# ------------------------------------------------------------------ prose → narration
AYN_LEAD = {"athaf", "athf", "illah", "abbas"}  # 'athaf etc.: an ayn apostrophe, not a quote
ARABIC_LETTER_NAME = {
    "ا": "alif", "ب": "ba'", "ت": "ta'", "ث": "tsa'", "ج": "jim", "ح": "ha'",
    "خ": "kha'", "د": "dal", "ذ": "dzal", "ر": "ra'", "ز": "zai", "س": "sin",
    "ش": "syin", "ص": "shad", "ض": "dhad", "ط": "tha'", "ظ": "zha'", "ع": "'ain",
    "غ": "ghain", "ف": "fa'", "ق": "qaf", "ك": "kaf", "ل": "lam", "م": "mim",
    "ن": "nun", "و": "wawu", "ه": "ha'", "ء": "hamzah", "ي": "ya'",
}
PARTICLE_NAME = {("wa",): "wawu", ("la",): "huruf nafi"}
CLASSIFIER = re.compile(r"(?:huruf jar|huruf|kata kerja|kata)\s$", re.I)
# A word class right before a mention: "kata perintah qul" reads "kata perintah, yaitu kata pertama".
NAMED_BY = re.compile(r"\b(?:kata (?:perintah|kerja|ganti|depan|sambung)|huruf (?:jar|nafi|'athaf))\s$", re.I)


# Phrasings of the lesson prose that cannot be spoken as they are, rewritten in the raw prose
# (SKB transliteration) before the mentions are mapped to places. Each says why.
PRE_REWRITES: list[tuple[str, str]] = [
    # ‘alā is the FRONT of ‘alaihim (1:7:4, 1:7:7), not the word: "kata ini adalah huruf jar"
    # would be wrong, and ‘alā itself is Qur'anic (validate_narration ALIASES). Name its meaning.
    # It is never spoken, in Arabic either (operator 2026-10-10: pronunciation.json has no عَلَى).
    (r"‘Alā adalah huruf jar\b", "Bagian depan kata ini adalah huruf jar yang artinya “atas”"),
    # The Huruf jar concept's third example is that same ‘alā. Renamed "huruf jar" it would define
    # the term by itself ("huruf jar … seperti …, dan huruf jar yang artinya atas"): the line keeps
    # the two examples this ayah shows, bi- and li- (fixer review, 2026-10-10).
    (r", li- “bagi”, dan ‘alā “atas”", " dan li- “bagi”"),
    # An open gloss ("yang banyak …") would be spoken as a fragment: 113:4's word card gives the
    # whole meaning of the same form, "yang banyak meniup".
    (r"bentuk mubalaghah \(“yang banyak …”\)", "bentuk mubalaghah (“yang banyak meniup”)"),
    # The lesson CARD's wording; the stage shows the mushaf line, not that card.
    (r" di kartu ini\b", ""),
    # A place inside a place ("kata kedua dalam kata kedua sampai keempat") cannot be followed by ear.
    (r"seperti huwa dalam huwa Allāhu aḥad menurut banyak ulama",
     "seperti huwa menurut banyak ulama, yang isinya ialah Allāhu aḥad"),
    # A title that is only the particle ("Lam: …") would be read "Kata pertama: …".
    (r"^Lam: menafikan dan menjazmkan", "Huruf yang menafikan dan menjazmkan"),
    # Concept titles that end in an open fragment ("kata pelaku: “yang ...”", "kata “yang di-”",
    # "kata kerja pasif: “di-…”") cannot be read aloud: spoken they end "yang....", "yang di.",
    # "berawalan di.". The title names the concept; its summary, the next sentence, explains it.
    (r"^Isim fa'il \(kata pelaku: “yang \.\.\.”\)$", "Isim fa'il, yaitu kata pelaku"),
    (r"^Isim maf'ul \(kata “yang di-”\)$", "Isim maf'ul, yaitu kata bagi yang dikenai perbuatan"),
    (r"^Fi'il majhul \(kata kerja pasif: “di-…”\)$", "Fi'il majhul, yaitu kata kerja pasif"),
    # The Kalimah title lists the three word classes with the gloss after the list; spoken, the
    # gloss goes with the name, and the classes read as a list ("…, dan huruf").
    (r"^Kalimah: isim, fi'il, huruf \(tiga jenis kata\)$", "Tiga jenis kalimah, atau kata: isim, fi'il, dan huruf"),
]


# How the narration words meanings and terms (operator review of the Al-Fatihah 1 preview,
# 2026-10-10), applied to the sanitised prose. A meaning is introduced with "yang artinya", never
# bare quotes or "yang berarti"; the letter of a prefixed preposition is named after "huruf jar".
_PLACE = (rf"(?:[Kk]ata (?:ini|{V.ORDINAL}(?: (?:dan|sampai) {V.ORDINAL})?)|[Aa]khiran)")
_GLOSSED = r"(?:[Hh]uruf (?:jar )?(?:ba'|lam)|[Hh]uruf jar|[Ww]awu|abtadi'u|ibtida'i|hada|naffas)"
PHRASING: list[tuple[str, object]] = [
    # The noun inside the line's own word glossed by one word ("kata ism (nama)" → "kata ini (nama)")
    # would read as the meaning of the whole word on screen: the line already gave that.
    (r"\b(kata ini) \([A-Za-z]+\)(?= didahului)", r"\1"),
    # A word place or a pronoun suffix with its meaning in brackets: "kata pertama, yang artinya
    # “katakanlah”, adalah …", "akhiran, yang artinya “kami”, …".
    (rf"\b({_PLACE}) \(“([^”()]+)”\)", r"\1, yang artinya “\2”,"),
    (rf"\b({_PLACE}) \(([A-Z][a-z]*)\)", r"\1, yang artinya “\2”,"),
    # A letter, a particle or a non-Qur'anic Arabic example with its meaning: "huruf lam yang
    # artinya “bagi”", "abtadi'u yang artinya “aku memulai” (pendapat ulama Kufah)".
    (rf"\b({_GLOSSED}) \(“([^”()]+)”(?:; ([^()]+))?\)",
     lambda m: f"{m.group(1)} yang artinya “{m.group(2)}”" + (f" ({m.group(3)})" if m.group(3) else "")),
    (rf"\b({_GLOSSED}) \(([a-z]+)\)", r"\1 yang artinya “\2”"),
    (rf"\b({_GLOSSED}) “", r"\1 yang artinya “"),
    (r"\byang berarti “", "yang artinya “"),
    # A grammar term with its meaning in brackets or bare quotes (fixer review, 2026-10-10):
    # "bentuk mubalaghah (“yang banyak meniup”)" → "bentuk mubalaghah, yang artinya “yang banyak
    # meniup”,", "(keterangan waktu “apabila”)" → "(keterangan waktu yang artinya “apabila”)",
    # "(pasif: “diperanakkan”)" → "(pasif), yang artinya “diperanakkan”,", "huruf jar (kata
    # depan) “dari”" → "huruf jar (kata depan) yang artinya “dari”". Not an example: "(misalnya
    # “tetap”)" and "(sandaran kata: “nama Allah”)" give an instance, not a meaning, and stay.
    (r"\b(bentuk [a-z']+|sya'n) \(“([^”()]+)”\)", r"\1, yang artinya “\2”,"),
    (r"\((?!(?:misalnya|seperti|contoh(?:nya)?)\b)([a-z][a-z' ]*[a-z']) “([^”()]+)”\)", r"(\1 yang artinya “\2”)"),
    (r"\(pasif: “([^”()]+)”\)", r"(pasif), yang artinya “\1”,"),
    (r"\) “", ") yang artinya “"),
    # "huruf jar ba'" → "huruf jar, yaitu huruf ba'" (right after another "yaitu": "huruf jar ba',").
    (r"(?<!yaitu )\b([Hh]uruf) jar (ba'|lam)(?![\w'])( yang artinya)?",
     lambda m: f"{m.group(1)} jar, yaitu huruf {m.group(2)}" + (", yang artinya" if m.group(3) else "")),
    (r"(?<=yaitu )([Hh]uruf jar (?:ba'|lam)) yang artinya", r"\1, yang artinya"),
    # A meaning followed by more of the sentence is closed by a comma ("huruf jar yang artinya
    # “dari”, yang mabni …"); a place right after it ("… di ayat dua") stays attached.
    (rf"(\b{_GLOSSED},? yang artinya “[^”]+”)(?= (?!di\b|pada\b)[a-z])", r"\1,"),
    # The case sign is what the ear hears: "Akhirnya dibaca kasrah, karena …".
    (r"\bAkhirnya (kasrah|dhammah|fathah|kasratain|dhammatain|fathatain|sukun)((?: bertanwin)?) karena\b",
     r"Akhirnya dibaca \1\2, karena"),
    # A Latin suffix glued to a term the dictionary speaks would be read as part of it.
    (r"\bmudhaf ilaih-nya\b", "mudhaf ilaih baginya"),
    (r",\s*([,.;:!?)])", r"\1"),
]


def phrasing(t: str) -> str:
    for pat, repl in PHRASING:
        t = re.sub(pat, repl, t)
    return t


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _at_sentence_start(out: str) -> bool:
    o = out.rstrip()
    return not o or o[-1] in ".!?" or o.endswith(("”.", "”"))  # noqa: E501


def quotes_to_typographic(t: str) -> str:
    """'kami' → “kami” (single-quoted Indonesian glosses); 'athaf, mubtada' stay."""
    def rep(m: re.Match) -> str:
        inner = m.group(1)
        if V.key(inner.split()[0]) in AYN_LEAD:
            return m.group(0)
        return f"“{inner}”"
    return re.sub(r"(?<![\w'‘’])'([A-Za-z][^'\n]*?[A-Za-z-])'(?![\w])", rep, t)


class Sanitiser:
    def __init__(self, lessons: dict[str, dict]):
        self.forms = V.Forms(lessons)
        self.order = {sp.surah: i for i, sp in enumerate(SURAHS)}
        # Each lesson word's gloss: a word of ANOTHER ayah is named by its meaning, because the
        # stage numbers only the words of the ayah on screen.
        self.gloss: dict[tuple[int, int, int], str] = {}
        for lesson in lessons.values():
            for a in lesson["ayat"]:
                for w in a["words"]:
                    s, ay, wi = (int(x) for x in w["loc"].split(":"))
                    self.gloss[(s, ay, wi)] = V.fold(w["gloss"])

    # -- resolving a mention to word places
    def _rank(self, loc, kind, S, A, W, prev, N, seen):
        """Lower is better. Inside the current ayah: the line's own word, then the word this line
        mentioned most recently, then the one nearest the previous mention of the same clause,
        then the full form before a part. Elsewhere: the explicit "di ayat N", the nearest
        preceding ayah of the surah, the following ones, then other surahs in mushaf order."""
        s, a, w = loc
        part = 0.001 if kind == "part" else 0.0
        if N is not None and s == S and a == N:
            return (0, 0, w + part)
        if (s, a) == (S, A):
            if W is not None and w == W:
                return (1, 0, 0)
            recent = len(seen) - max(i for i, x in enumerate(seen) if x == loc) if loc in seen else 999
            dist = abs(w - prev[2]) if prev and prev[:2] == (S, A) else 0
            return (2, recent, dist + part + w / 1000)
        if s == S and a < A:
            return (3, 0, (A - a) + part + w / 1000)
        if s == S:
            return (4, 0, (a - A) + part + w / 1000)
        return (5, 0, self.order.get(s, 99) * 1000 + a + part + w / 1000)

    def _resolve(self, group, S, A, W, prev, N, seen):
        """[(s, a, [w…])]: one place for a run of mentions, or one per mention."""
        if len(group) > 1:
            starts = []
            for loc0, kind0 in group[0][3]:
                s, a, w = loc0
                if all(any(c[0] == (s, a, w + j) for c in m[3]) for j, m in enumerate(group)):
                    starts.append((self._rank(loc0, kind0, S, A, None, prev, N, seen), loc0))
            if starts:
                s, a, w = min(starts)[1]
                return [(s, a, list(range(w, w + len(group))))]
        out = []
        for m in group:
            best = min(m[3], key=lambda c: self._rank(c[0], c[1], S, A, W, prev, N, seen))
            s, a, w = best[0]
            out.append((s, a, [w]))
            prev = best[0]
        return out

    def _phrase(self, place, S, A, W, prep, meaning=None):
        """A word of this ayah by its place, which the stage numbers ("kata kedua", "kata ketiga
        dan keempat"); a word of another ayah by its meaning ("kata yang artinya “bagi Allah” di
        ayat dua", "frasa yang artinya “dari kejahatan”"), which a listener can follow without
        seeing it. `meaning`: the gloss the prose already gives right after the mention."""
        s, a, ws = place
        if len(ws) == 1 and (s, a) == (S, A) and ws[0] == W:
            return "kata ini"
        if (s, a) == (S, A):
            if len(ws) == 1:
                return f"kata {ordinal(ws[0])}"
            if len(ws) == 2:
                return f"kata {ordinal(ws[0])} dan {ordinal(ws[1])}"
            return f"kata {ordinal(ws[0])} sampai {ordinal(ws[-1])}"
        g = meaning or " ".join(self.gloss[(s, a, w)] for w in ws)
        core = f"{'kata' if len(ws) == 1 else 'frasa'} yang artinya “{g}”"
        return f"{core} {prep or 'di'} ayat {num_id(a)}" if s == S else core

    def _where(self, place, S, prep) -> str:
        s, a, _ = place
        return f" {prep or 'di'} ayat {num_id(a)}" if s == S else ""

    def replace_mentions(self, t: str, S: int, A: int, W: int | None) -> str:
        found, toks = self.forms.mentions(t)
        keep = []
        for m in found:
            start, end, k, cands, i, n = m
            orig = t[start:end]
            if orig == "Allah" and not (i > 0 and toks[i - 1][0] == "lafaz"):
                continue  # Indonesian use of the Name (gets its honorific later), not a mention
            if k in self.forms.surah_name_keys and orig[:1].isupper():
                continue  # a surah name ("Surah " is added later)
            keep.append(m)
        groups: list[list] = []
        for m in keep:
            if groups and t[groups[-1][-1][1]:m[0]] == " ":
                groups[-1].append(m)
            else:
                groups.append([m])
        out = ""
        cur = 0
        prev = None  # (s, a, w) of the previous mention, and where it ended
        prev_end = 0
        seen: list[tuple[int, int, int]] = []
        for g in groups:
            start, end = g[0][0], g[-1][1]
            pre = t[cur:start]
            if prev and re.search(r"[.;]", t[prev_end:start]):
                prev = None  # proximity counts only inside one clause
            if len(g) == 1 and g[0][2] in PARTICLE_NAME:
                name = PARTICLE_NAME[g[0][2]]
                out += pre + (_cap(name) if _at_sentence_start(out + pre) else name)
                cur = end
                continue
            absorbed = None
            am = re.search(r"\b([Kk]ata|[Ll]afaz)\s$", pre)
            if am:
                absorbed = am.group(1)
                pre = pre[:am.start()]
            follow = t[end:]
            nm = re.match(r" (di|pada) ayat (\d+)", follow)
            N = int(nm.group(2)) if nm else None
            places = self._resolve(g, S, A, W, prev, N, seen)
            prep = None
            if nm and len(places) == 1 and places[0][0] == S and places[0][1] == N and N != A:
                prep = nm.group(1)
                end += len(nm.group(0))
            if t[end:end + 4] == "-nya":
                end += 4
            glossed = bool(re.match(r" ?\(?“", t[end:]))
            here = len(places) == 1 and places[0][:2] == (S, A)
            self_only = here and places[0][2] == [W]
            if glossed and CLASSIFIER.search(pre) and not absorbed and (self_only or not here):
                out += pre.rstrip()  # "huruf jar min (“dari”)" names the particle: "huruf jar (“dari”)"
                cur = end
                continue
            elsewhere = len(places) == 1 and not here
            meaning = None
            gm = re.match(r" \(“([^”]*)”\)| “([^”]*)”", t[end:]) if elsewhere else None
            if gm:
                # "a‘ūżu (“aku berlindung”)" in another ayah: that gloss IS the meaning to say.
                meaning = gm.group(1) or gm.group(2)
                end += len(gm.group(0))
            if elsewhere and absorbed and absorbed.lower() == "lafaz" and g[0][2] == ("allah",):
                # "lafaz Allah di ayat 2": the Name, said in Indonesian (quoted: not a recitation).
                phrase = "lafaz “Allah”" + self._where(places[0], S, prep)
            else:
                phrase = " ".join(self._phrase(p, S, A, W, prep, meaning) for p in places)
            if t[end:].startswith(" mashdariyyah"):
                phrase = "huruf"  # "mā mashdariyyah" names a kind of particle
            if phrase.endswith("kata ini") and t[end:].startswith(" ini"):
                end += 4  # "frasa lahū ini" → "frasa kata ini", not "kata ini ini"
            if not absorbed and phrase.startswith("kata") and NAMED_BY.search(pre):
                pre = pre.rstrip() + ", yaitu "  # "kata perintah qul" → "kata perintah, yaitu kata pertama"
            if absorbed and absorbed[0].isupper() or _at_sentence_start(out + pre):
                phrase = _cap(phrase)
            out += pre + phrase
            cur = end
            for p in places:
                seen.extend((p[0], p[1], w) for w in p[2])
            last = places[-1]
            prev = (last[0], last[1], last[2][-1])
            prev_end = end
        out += t[cur:]
        # "waswasa–yuwaswisu" (past–present of one verb) → one place, not "kata kedua–kata kedua"
        return re.sub(r"\b((?:[Kk]ata) [a-z]+(?: (?:di|pada) ayat [a-z]+)?)–\1\b", r"\1", out)

    # -- the other steps
    @staticmethod
    def particles(t: str) -> str:
        def rep(m: re.Match) -> str:
            name = {"b": "ba'", "l": "lam"}[m.group(1)[0].lower()]
            before = t[:m.start()]
            if re.search(r"\bhuruf(?: jar)?\s$", before, re.I):
                return name
            word = f"huruf {name}"
            return _cap(word) if _at_sentence_start(before) else word
        return re.sub(r"(?<![\w'‘’-])([Bb]i|[Ll]i)-(?![\w'‘’])", rep, t)

    @staticmethod
    def suffixes(t: str) -> str:
        t = re.sub(r"(?<![\w'‘’-])al-(?![\w'‘’])", "alif lam", t)  # the bare article "al-"
        t = t.replace("-ūna/-īna", "akhiran una dan ina")
        t = re.sub(r"(?<![\w'‘’])-(ūna|īna)(?![\w'‘’])",
                   lambda m: f"akhiran {V.fold(m.group(1))}", t)
        return re.sub(r"(?<![\w'‘’])-(nā|ta|him|hū)(?![\w'‘’])", "akhiran", t)

    @staticmethod
    def arabic_letters(t: str) -> str:
        def rep(m: re.Match) -> str:
            letters = m.group(0).split()
            if any(len(x) != 1 or x not in ARABIC_LETTER_NAME for x in letters):
                raise SystemExit(f"Arabic text in prose that is not a letter list: {m.group(0)!r}")
            names = [ARABIC_LETTER_NAME[x] for x in letters]
            return names[0] if len(names) == 1 else ", ".join(names[:-1]) + ", dan " + names[-1]
        return re.sub("[؀-ۿ]+(?: [؀-ۿ]+)*", rep, t)

    @staticmethod
    def qs(t: str) -> str:
        def rep(m: re.Match) -> str:
            s, a = int(m.group(1)), int(m.group(2))
            if s not in CITED_SURAH:
                raise SystemExit(f"QS {s}:{a}: add surah {s} to CITED_SURAH")
            return f"Surah {CITED_SURAH[s]} ayat {num_id(a)}"
        return re.sub(r"\bQS\.? (\d+):(\d+)\b", rep, t)

    @staticmethod
    def numbers(t: str) -> str:
        t = re.sub(r"\bke-(\d+)\b", lambda m: ordinal(int(m.group(1))), t)
        if re.search(r"\d+[:.]\d+", t):
            raise SystemExit(f"unexpected number pattern in prose: {t!r}")
        return re.sub(r"\d+", lambda m: num_id(int(m.group(0))), t)

    @staticmethod
    def honorifics(t: str) -> str:
        quoted = [(m.start(), m.end()) for m in V.QUOTED.finditer(t)]
        out, cur = "", 0
        for m in re.finditer(r"\bNabi(?: Muhammad)?\b(?! shallallahu)|\bAllah\b(?![\w'‘’-])(?! subhanahu)", t):
            if any(s <= m.start() < e for s, e in quoted):
                continue
            hon = " shallallahu 'alaihi wa sallam" if m.group(0).startswith("Nabi") else " subhanahu wa ta'ala"
            out += t[cur:m.end()] + hon
            cur = m.end()
        return out + t[cur:]

    @staticmethod
    def surah_names(t: str) -> str:
        for sp in SURAHS:
            t = re.sub(rf"(?<!Surah )\b{re.escape(sp.name_id)}\b", f"Surah {sp.name_id}", t)
        return t

    @staticmethod
    def tidy(t: str) -> str:
        t = re.sub(r"\s+", " ", t)
        t = re.sub(r"\s+([,.;:!?)])", r"\1", t)
        t = re.sub(r"\(\s+", "(", t)
        return t.strip()

    def strict_check(self, what: str, t: str) -> None:
        """Authored narration (a composition's `say`, its `lead`) names no Qur'anic word: the
        build stops rather than rewrite it, since the author wrote it to be said as it stands."""
        found, toks = self.forms.mentions(t)
        bad = []
        for start, end, k, _c, i, _n in found:
            orig = t[start:end]
            if orig == "Allah" and not (i > 0 and toks[i - 1][0] == "lafaz"):
                continue  # the Name in Indonesian (it gets its honorific)
            if k in self.forms.surah_name_keys and i > 0 and toks[i - 1][0] == "surah":
                continue  # "Surah Al-Ikhlas"
            if k == ("lam",) and V._letter_context(toks, i, t):
                continue  # the letter's name: "huruf lam", "alif lam"
            bad.append(orig)
        if bad:
            raise SystemExit(f"{what}: names the Qur'anic word(s) {bad} — say its place (kata pertama) or its "
                             "meaning (kata yang artinya …); the screen shows the Arabic and the transliteration")

    def prose(self, text: str, S: int, A: int, W: int | None = None, *, strict: str | None = None) -> str:
        t = re.sub(r"\s+", " ", text).strip()
        for pat, repl in PRE_REWRITES:
            t = re.sub(pat, repl, t)
        t = quotes_to_typographic(t)
        t = self.qs(t)
        if strict:
            # Nothing to map to a place: what is left (the Name, a surah name, "huruf lam") stays.
            self.strict_check(strict, t)
        else:
            t = self.replace_mentions(t, S, A, W)
        t = self.particles(t)
        t = self.suffixes(t)
        t = self.arabic_letters(t)
        t = self.numbers(t)
        t = self.surah_names(t)
        t = self.honorifics(t)
        t = V.fold(t)
        return phrasing(self.tidy(t))

    def plain_check(self, what: str, text: str) -> None:
        """A translation or gloss may carry 'Allah' and nothing else Qur'anic."""
        found, _ = self.forms.mentions(text)
        bad = [text[s:e] for s, e, k, *_ in found if k != ("allah",)]
        if bad:
            raise SystemExit(f"{what}: Qur'anic transliteration {bad} — cannot be spoken")


# ------------------------------------------------------------------ the dictionary in a line
# A line is first MARKED: each dictionary term the prose writes in Latin (Lexicon.latin_matches)
# becomes one private-use character standing for that term (and whether it was capitalised). The
# spoken text and the caption are both rendered from the marked line, so they say the same thing.
_MARK0 = 0xE000


class Speech:
    def __init__(self, lex: V.Lexicon):
        self.lex = lex
        self.index = {t.term: i for i, t in enumerate(lex.terms)}
        every = "".join(chr(_MARK0 + 2 * i + c) for i in range(len(lex.terms)) for c in (0, 1))
        boxed = "".join(chr(_MARK0 + 2 * i + c) for i, t in enumerate(lex.terms) if t.shown for c in (0, 1))
        self.any = f"[{every}]" if every else "(?!x)x"
        b = f"[{boxed}]" if boxed else "(?!x)x"
        # A term whose caption carries brackets ("na’t (نَعْت)") cannot sit inside brackets or right
        # before them: "sifat (na't)" → "sifat, atau na't,", "huruf jar (kata depan)" → "huruf jar,
        # yaitu kata depan,", "tandanya (dhammah, fathah, kasrah)" → "tandanya, yaitu …," — which
        # is also how the line is best said.
        self.brackets = [
            # "atau" (also called), unless an "atau" (or) follows: "kalimat kata kerja, yaitu
            # jumlah fi'liyyah, atau ibtida'i …".
            (re.compile(rf"(?<=\S) \(({b})\)(?=,? atau\b)"), r", yaitu \1,"),
            (re.compile(rf"(?<=\S) \(({b})\)"), r", atau \1,"),
            (re.compile(rf"({b}) \(((?:(?!{b})[^()])*)\)"), r"\1, yaitu \2,"),
            (re.compile(rf"(?<=\S) \(([^()]*{b}[^()]*)\)"), r", yaitu \1,"),
        ]

    def mark(self, prose: str) -> str:
        out, cur = "", 0
        for a, b, t, cap in self.lex.latin_matches(prose):
            out += prose[cur:a] + chr(_MARK0 + 2 * self.index[t.term] + int(cap))
            cur = b
        out += prose[cur:]
        for rx, repl in self.brackets:
            out = rx.sub(repl, out)
        out = re.sub(r",(?:\s*,)+", ",", out)
        out = re.sub(r",\s*([.;:!?])", r"\1", out)
        return out

    def _terms(self, marked: str, render) -> str:
        def rep(m: re.Match) -> str:
            i, cap = divmod(ord(m.group()) - _MARK0, 2)
            return render(self.lex.terms[i], bool(cap))
        return re.sub(self.any, rep, marked)

    def spoken(self, marked: str) -> str:
        return tts_text(self._terms(marked, self.lex.speak_of))

    def shown(self, marked: str, focus_ar: str | None) -> str:
        return self._terms(marked, lambda t, cap: self.lex.display_of(t, cap, focus_ar))


# ------------------------------------------------------------------ splitting long lines
_SENT = re.compile("([.!?…][”\"]?)\\s+(?=[A-Z“-])")


def _pieces(text: str, cut: str) -> list[str]:
    marked = re.sub(cut, lambda m: m.group(1) + "\0", text)
    return [p.strip() for p in marked.split("\0") if p.strip()]


def split_line(text: str, max_len: int = V.MAX_LINE, measure=len) -> list[str]:
    """Fewest parts with measure(part) ≤ max_len, cut at sentence ends (then '; ', then ', '), as
    even as possible. `measure`: the length that counts (the spoken text's)."""
    if measure(text) <= max_len:
        return [text]
    pieces: list[str] = []
    for s in _pieces(text, _SENT.pattern):
        if measure(s) <= max_len:
            pieces.append(s)
            continue
        for c in _pieces(s, r"(;)\s+"):
            if measure(c) <= max_len:
                pieces.append(c)
            else:
                pieces += _pieces(c, r"(,)\s+")
    if any(measure(p) > max_len for p in pieces):
        raise SystemExit(f"cannot split under {max_len} characters: {text[:80]!r}…")
    n = len(pieces)
    width = lambda i, j: measure(" ".join(pieces[i:j]))  # noqa: E731
    k = 1
    cur = ""
    for p in pieces:  # greedy count
        if cur and measure(cur + " " + p) > max_len:
            k += 1
            cur = p
        else:
            cur = f"{cur} {p}" if cur else p
    INF = float("inf")
    cost = [[INF] * (n + 1) for _ in range(k + 1)]
    back = [[-1] * (n + 1) for _ in range(k + 1)]
    cost[0][0] = 0
    for g in range(1, k + 1):
        for j in range(1, n + 1):
            for i in range(g - 1, j):
                if cost[g - 1][i] == INF:
                    continue
                w = width(i, j)
                if w > max_len:
                    continue
                c = cost[g - 1][i] + w * w
                if c < cost[g][j]:
                    cost[g][j], back[g][j] = c, i
    out, j = [], n
    for g in range(k, 0, -1):
        i = back[g][j]
        out.insert(0, " ".join(pieces[i:j]))
        j = i
    return out


# ------------------------------------------------------------------ the lines
SHARED_TEXT = {
    # No "fatwa" here: the page footer carries "Dibantu AI, bukan fatwa otoritatif" (operator,
    # 2026-10-10). Nothing promises a human review.
    "start": ("Mari kita mulai. Anda cukup mendengarkan dan memperhatikan layar; pelajaran berjalan sendiri, "
              "dan hanya latihan yang meminta Anda mengklik. Ayat Al-Qur'an selalu dibacakan oleh imam. "
              "Penjelasan ini dibacakan dengan suara kecerdasan buatan, disusun dengan bantuan kecerdasan "
              "buatan dari kitab-kitab yang disebutkan sumbernya."),
    "resume": "Kita lanjutkan pelajaran dari langkah terakhir.",
    "correct": "Benar.",
    "try_again": "Belum tepat. Coba pilih yang lain.",
    "revealed": "Ini jawabannya. Perhatikan sebentar.",
    "reminder": "Silakan lanjutkan latihannya. Bagian yang perlu diklik sedang diberi tanda di layar.",
    "skip_offer": "Jika ingin melewati latihan ini, klik tombol Lewati latihan.",
    # True however the learner got here (straight to the last ayah, every exercise skipped):
    # no claim that every ayah was studied; "kapan saja" is said once, on the end card.
    "surah_done": "Pilihan berikutnya ada di layar.",
}
_REVEAL = "Jika masih ragu, klik Tunjukkan jawaban. Anda juga boleh mencoba lagi."
# Only in the "Tunggu saya" pace: otherwise the next question comes by itself.
_NEXT = "Klik tombol yang diberi tanda untuk melanjutkan."
SHARED_EX_TEXT = {
    # The lesson's imam recites the word by itself (no click): the learner only answers.
    ("tap-word", "play"): "Dengarkan imam membacakan satu kata dari ayat ini.",
    ("tap-word", "options"): "Sekarang klik kata yang tadi dibacakan imam.",
    ("why-harakat", "options"): "Pilih alasan yang membuat akhir kata ini dibaca seperti itu.",
    ("sort-case", "words"): "Klik satu kata yang ingin Anda kelompokkan.",
    ("sort-case", "bins"): "Sekarang klik kelompok akhiran yang cocok untuk kata itu.",
    ("label-role", "options"): "Pilih peran kata ini dalam kalimat ayatnya.",
    ("wazn-factory", "options"): "Pilih bentuk kata yang sesuai dengan nama yang ditanyakan.",
}


def ex_intro(key: str, n: int) -> str:
    c = num_id(n)
    return {
        "tap-word": (f"Latihan dengar dan klik. Imam akan membacakan {c} kata dari ayat ini satu per satu, "
                     "dalam urutan acak. Setiap kali, klik kata yang Anda dengar."),
        "why-harakat": (f"Latihan kenapa harakat ini, {c} soal. Setiap soal menampilkan satu kata; pilih alasan "
                        "yang membuat akhirnya dibaca seperti itu."),
        "sort-case": (f"Latihan kelompokkan menurut akhiran, {c} kata. Klik satu kata, lalu klik kelompok "
                      "akhirannya."),
        "label-role": f"Latihan tebak peran kata, {c} soal. Untuk setiap kata, pilih perannya dalam kalimat ayat ini.",
        "wazn-factory": (f"Latihan bentuk-bentuk kata, {c} soal. Dari satu akar lahir beberapa bentuk kata; pilih "
                         "bentuk yang sesuai dengan namanya. Bentuk-bentuk ini kata Arab hasil tashrif, bukan "
                         "kutipan ayat."),
    }[key]


Line = tuple[str, str, dict | None, str]  # id, prose, ayah (None for shared lines), part


def surah_lines(lesson: dict, library: dict, san: Sanitiser, compose: dict | None = None) -> list[Line]:
    slug, S, name = lesson["slug"], lesson["surah"], lesson["name_id"]
    last = lesson["ayat"][-1]["ayah"]
    out: list[Line] = []
    for a in lesson["ayat"]:
        A = a["ayah"]
        base = f"{slug}:{A}"
        add = lambda part, text: out.append((f"{base}:{part}", text, a, part))  # noqa: E731
        tr = V.spoken_translation(a["translation"]["text"])
        san.plain_check(f"{a['loc']} translation", tr)
        n_words = len(a["words"])
        add("intro", f"Ayat {ordinal(A)} Surah {name}. Terjemahannya: “{V.fold(tr)}” Ayat ini terdiri "
                     f"dari {num_id(n_words)} kata, dan kita akan mempelajarinya satu per satu.")
        add("recite", f"Sekarang dengarkan imam membacakan ayat {ordinal(A)}.")
        primer = V.primer_of(compose, A)
        for k, ln in enumerate((primer or {}).get("lines") or [], 1):
            add(f"primer:{k}", san.prose(ln["say"], S, A, strict=f"{base}:primer:{k}"))
        for i, w in enumerate(a["words"], 1):
            san.plain_check(f"{w['loc']} gloss", w["gloss"])
            comp = V.composition_of(compose, w["loc"])
            gloss = f"Kata {ordinal(i)} artinya: “{V.fold(w['gloss'])}”."
            if comp is None:
                add(f"w{i}", f"{gloss} {san.prose(w['why'], S, A, i)}")
                continue
            # The frames say the why part by part (rule 14): the word line is the gloss and the lead.
            lead = san.prose(comp["lead"], S, A, i, strict=f"{base}:w{i} lead") if comp.get("lead") else ""
            add(f"w{i}", f"{gloss} {lead}".strip())
            for k, ln in enumerate(comp.get("lines") or [], 1):
                add(f"w{i}:compose:{k}", san.prose(ln["say"], S, A, i, strict=f"{base}:w{i}:compose:{k}"))
        for c in V.introduced_concepts(a["loc"], library):
            # The title starts with a capital: validate_narration._sentence_start shows a term
            # spoken from Arabic script right after TITLE_LEAD capitalised, as the caption does.
            add(f"concept:{c['id']}", f"{V.TITLE_LEAD} {_cap(san.prose(c['title'], S, A))}. {san.prose(c['summary'], S, A)}")
        if a.get("structure"):
            add("structure", f"Sekarang susunan kalimatnya. {san.prose(a['structure']['summary'], S, A)}")
        counts = V.exercise_counts(a, library)
        for k in V.EXERCISE_KEYS:
            if k in counts:
                add(f"ex:{k}:intro", ex_intro(k, counts[k]))
        add("recap", f"Dengarkan sekali lagi seluruh ayat {ordinal(A)} dibacakan imam.")
        if A == last:
            add("done", f"Pelajaran ayat {ordinal(A)} selesai. Ini ayat terakhir Surah {name}.")
        else:
            add("next", f"Pelajaran ayat {ordinal(A)} selesai. Berikutnya ayat {ordinal(A + 1)}; "
                        "pelajaran berlanjut sendiri.")
    return out


def shared_lines() -> list[Line]:
    out: list[Line] = [(f"shared:{k}", SHARED_TEXT[k], None, k) for k in V.SHARED_KEYS]
    for k in V.EXERCISE_KEYS:
        for p in V.EXERCISE_GUIDE_PARTS[k]:
            text = SHARED_EX_TEXT.get((k, p)) or {"reveal": _REVEAL, "next": _NEXT}[p]
            out.append((f"shared:ex:{k}:{p}", text, None, f"ex:{k}:{p}"))
    return out


def build_lines(lessons: dict[str, dict], library: dict, lex: V.Lexicon | None = None,
                compose: dict[str, dict] | None = None) -> dict[str, dict[str, dict]]:
    """manifest name → {id: {text, display, highlight, focus, frame?}}, in lesson order
    (deterministic). `compose`: content/compose/<slug>.json by slug (default: from disk). Stops,
    writing nothing, if a line fails a validate_narration check (a new mention or term the rules
    above do not cover)."""
    lex = lex or V.load_lexicon()
    compose = V.load_compose() if compose is None else compose
    san = Sanitiser(lessons)
    sp = Speech(lex)
    forms = san.forms
    errs: list[str] = list(lex.problems(forms))
    if errs:
        raise SystemExit("pronunciation.json:\n  " + "\n  ".join(errs))
    raw: dict[str, list[Line]] = {}
    for spec in SURAHS:
        if spec.slug in lessons:
            raw[spec.slug] = surah_lines(lessons[spec.slug], library, san, compose.get(spec.slug))
    raw["shared"] = shared_lines()
    out: dict[str, dict[str, dict]] = {}
    for name, rows in raw.items():
        lines: dict[str, dict] = {}
        comp = compose.get(name)
        for lid, prose, ayah, part in rows:
            errs += V.check_text(lid, prose, forms, max_len=None)
            highlight, focus = V.line_view(ayah, part, comp)
            frame = V.line_frame(ayah, part, comp)
            focus_ar = V.line_letters(ayah, part, focus, forms, comp)
            parts = split_line(sp.mark(prose), measure=lambda x: len(sp.spoken(x)))
            ids = [lid] if len(parts) == 1 else [f"{lid}:{chr(ord('a') + i)}" for i in range(len(parts))]
            for pid, marked in zip(ids, parts):
                text, display = sp.spoken(marked), sp.shown(marked, focus_ar)
                errs += V.check_spoken(pid, text, forms, lex)
                errs += V.check_display(pid, display, text, forms, lex, focus_ar)
                line = {"text": text, "display": display, "highlight": list(highlight), "focus": focus}
                if frame is not None:
                    line["frame"] = frame
                errs += V.check_animation_line(pid, line, ayah, part, comp, lex, len(parts) > 1)
                lines[pid] = line
        out[name] = lines
    if errs:
        raise SystemExit("narration lines the narrator must not say:\n  " + "\n  ".join(errs))
    return out


def retext_tokens(tokens: list, line: dict, lex: V.Lexicon, focus_ar: str | None) -> list:
    """The karaoke tokens of a kept render with their texts re-derived from the spoken text (a
    changed display form needs no new render); unchanged when the words no longer line up."""
    runs = lex.runs(line["text"])
    if len(runs) != len(tokens) or not all(isinstance(t, dict) for t in tokens):
        return tokens
    spans = lex.spoken_spans(line["text"])
    return [{**tk, "t": lex._render(line["text"], a, b, spans, focus_ar)} for tk, (a, b) in zip(tokens, runs)]


def manifest(lines: dict[str, dict], old: dict | None, lex: V.Lexicon, forms: V.Forms,
             letters=lambda lid, line: None) -> dict:
    """Keeps the voice, and the audio and tokens of every line whose spoken text did not change.
    `letters(lid, line)`: where the line's caption takes a letter's shape (V.line_letters)."""
    old_lines = (old or {}).get("lines") or {}
    out = {}
    for lid, line in lines.items():
        new = dict(line)
        prev = old_lines.get(lid)
        if isinstance(prev, dict) and prev.get("text") == line["text"] and "audio" in prev:
            new["audio"] = prev["audio"]
            if "tokens" in prev:
                new["tokens"] = retext_tokens(prev["tokens"], line, lex, letters(lid, line))
        out[lid] = new
    return {"version": V.MANIFEST_VERSION, "voice": (old or {}).get("voice"), "lines": out}


def dump(man: dict) -> str:
    return json.dumps(man, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the files on disk; write nothing")
    ap.add_argument("--show", metavar="ID_PREFIX", help="print the lines whose id starts with this")
    args = ap.parse_args()
    _, lessons, library = V.load_all()
    lex = V.load_lexicon()
    built = build_lines(lessons, library, lex)
    if args.show is not None:
        for lines in built.values():
            for lid, line in lines.items():
                if lid.startswith(args.show):
                    print(f"{lid}  highlight={line['highlight']} focus={line['focus']}\n"
                          f"    said:  {line['text']}\n    shown: {line['display']}\n")
        return 0
    forms = V.Forms(lessons)
    compose = V.load_compose()
    V.NARRATION_DIR.mkdir(parents=True, exist_ok=True)
    differ = []
    for name, lines in built.items():
        path = V.NARRATION_DIR / f"{name}.json"
        old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        new = dump(manifest(lines, old, lex, forms, V.letters_for(name, lessons, forms, compose)))
        chars = sum(len(x["text"]) for x in lines.values())
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != new:
                differ.append(name)
            continue
        if not path.exists() or path.read_text(encoding="utf-8") != new:
            path.write_text(new, encoding="utf-8")
        print(f"{name:12s} {len(lines):4d} lines  {chars:6d} spoken chars  -> {path.relative_to(V.BELAJAR.parent)}")
    if args.check:
        if differ:
            print("out of date:", ", ".join(differ))
            return 1
        print("narration manifests are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
