#!/usr/bin/env python3
"""Writes the guided-lesson narration manifests, belajar/content/narration/<slug>.json for every
lesson surah plus shared.json, from content/<slug>.json and content/library.json. Deterministic:
templates + content fields, no LLM, no network. Standard library only; run from belajar/pipeline:

    python3 build_narration.py           # write the manifests (audio of unchanged lines is kept)
    python3 build_narration.py --check   # exit 1 if a manifest on disk differs from a fresh build
    python3 build_narration.py --show al-fatihah:1:   # print the lines whose id starts with this

Manifest: {"version": 1, "voice": null | {id, name, model}, "lines": {id: {"text", "audio"?}}}.
Ids follow the step-id contract (validate_narration.py docstring); a line longer than
validate_narration.MAX_LINE characters is split at sentence (then clause) ends into "<id>:a",
"<id>:b", …, which a player reads in order in place of "<id>".

`text` is both the caption and what the narrator says, so it is already normalised for speech:
numbers spelled out, "QS" expanded, honorifics spoken in full ("Allah subhanahu wa ta'ala",
"Nabi Muhammad shallallahu 'alaihi wa sallam"), no Arabic script and no transliteration
diacritics. The only speech-only changes (Allah → Alloh, brackets and quotes dropped) are in
`tts_text`, applied by render_narration.py just before the API call, so captions keep normal
spelling.

The narrator never voices a Qur'anic word, in Arabic or in transliteration (plan §6.1 A1). Prose
from the lessons names words in SKB transliteration; `Sanitiser` replaces every such mention with
the word's place, which the screen highlights: "kata ini" (the word the line is about), "kata
kedua", "kata pertama dan kedua", "kata kedua sampai keempat", "kata kedua di ayat enam", or, for
a word of another surah, "kata keempat pada ayat dua Surah Al-Falaq" ("kata" alone when a gloss in
quotes follows). The prefixed particles are named by their letters (bi- → huruf ba', li- → huruf
lam, wa → wawu, the lā of wa lā → huruf nafi) and pronoun suffixes (-nā, -ta, -him, -hū) become
"akhiran". What stays is grammar vocabulary (mubtada', majrur, isim fa'il), scholars' names and
non-Qur'anic Arabic examples (abtadi'u, naffas), folded to plain letters.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import validate_narration as V
from common import SURAH_BY_NUM, SURAHS

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


# ------------------------------------------------------------------ speech text (render only)
# Pronunciation respellings applied only to what is sent to ElevenLabs (house rule: all
# normalisation in Python, apply_text_normalization "off"). Extend after the operator hears the
# approved sample; keep captions in normal spelling.
TTS_RESPELL = {"Allah": "Alloh"}


def tts_text(text: str) -> str:
    t = text
    for a, b in TTS_RESPELL.items():
        t = re.sub(rf"\b{re.escape(a)}\b", b, t)
    t = t.replace("“", "").replace("”", "").replace('"', "")
    # An ellipsis marks an open phrase ("yang banyak …"): it is not read as a full stop.
    t = t.replace("—", ", ").replace("–", ", ").replace("…", "").replace("/", " atau ")
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
    (r"‘Alā adalah huruf jar\b", "Bagian depan kata ini adalah huruf jar yang berarti “atas”"),
    (r"\bdan ‘alā “atas”", "dan huruf jar yang berarti “atas”"),
    # The lesson CARD's wording; the stage shows the mushaf line, not that card.
    (r" di kartu ini\b", ""),
    # A place inside a place ("kata kedua dalam kata kedua sampai keempat") cannot be followed by ear.
    (r"seperti huwa dalam huwa Allāhu aḥad menurut banyak ulama",
     "seperti huwa menurut banyak ulama, yang isinya ialah Allāhu aḥad"),
    # A title that is only the particle ("Lam: …") would be read "Kata pertama: …".
    (r"^Lam: menafikan dan menjazmkan", "Huruf yang menafikan dan menjazmkan"),
    # An open prefix in quotes ("“di-…”") cannot be read aloud.
    (r"“di-…”", "berawalan “di-”"),
]


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
        dan keempat"); a word of another ayah by its meaning ("kata yang berarti “bagi Allah” di
        ayat dua", "frasa yang berarti “dari kejahatan”"), which a listener can follow without
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
        core = f"{'kata' if len(ws) == 1 else 'frasa'} yang berarti “{g}”"
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

    def prose(self, text: str, S: int, A: int, W: int | None = None) -> str:
        t = re.sub(r"\s+", " ", text).strip()
        for pat, repl in PRE_REWRITES:
            t = re.sub(pat, repl, t)
        t = quotes_to_typographic(t)
        t = self.qs(t)
        t = self.replace_mentions(t, S, A, W)
        t = self.particles(t)
        t = self.suffixes(t)
        t = self.arabic_letters(t)
        t = self.numbers(t)
        t = self.surah_names(t)
        t = self.honorifics(t)
        t = V.fold(t)
        return self.tidy(t)

    def plain_check(self, what: str, text: str) -> None:
        """A translation or gloss may carry 'Allah' and nothing else Qur'anic."""
        found, _ = self.forms.mentions(text)
        bad = [text[s:e] for s, e, k, *_ in found if k != ("allah",)]
        if bad:
            raise SystemExit(f"{what}: Qur'anic transliteration {bad} — cannot be spoken")


# ------------------------------------------------------------------ splitting long lines
_SENT = re.compile("([.!?…][”\"]?)\\s+(?=[A-Z“])")


def _pieces(text: str, cut: str) -> list[str]:
    marked = re.sub(cut, lambda m: m.group(1) + "\0", text)
    return [p.strip() for p in marked.split("\0") if p.strip()]


def split_line(text: str, max_len: int = V.MAX_LINE) -> list[str]:
    """Fewest parts ≤ max_len, cut at sentence ends (then '; ', then ', '), as even as possible."""
    if len(text) <= max_len:
        return [text]
    pieces: list[str] = []
    for s in _pieces(text, _SENT.pattern):
        if len(s) <= max_len:
            pieces.append(s)
            continue
        for c in _pieces(s, r"(;)\s+"):
            if len(c) <= max_len:
                pieces.append(c)
            else:
                pieces += _pieces(c, r"(,)\s+")
    if any(len(p) > max_len for p in pieces):
        raise SystemExit(f"cannot split under {max_len} characters: {text[:80]!r}…")
    n = len(pieces)
    width = lambda i, j: sum(len(p) for p in pieces[i:j]) + (j - i - 1)  # noqa: E731
    k = 1
    cur = 0
    for p in pieces:  # greedy count
        if cur and cur + 1 + len(p) > max_len:
            k += 1
            cur = len(p)
        else:
            cur = cur + 1 + len(p) if cur else len(p)
    INF = float("inf")
    cost = [[INF] * (n + 1) for _ in range(k + 1)]
    back = [[-1] * (n + 1) for _ in range(k + 1)]
    cost[0][0] = 0
    for g in range(1, k + 1):
        for j in range(1, n + 1):
            for i in range(g - 1, j):
                w = width(i, j)
                if w > max_len or cost[g - 1][i] == INF:
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
    "start": ("Mari kita mulai. Anda cukup mendengarkan dan memperhatikan layar; pelajaran berjalan sendiri, "
              "dan hanya latihan yang meminta Anda mengetuk. Ayat Al-Qur'an selalu dibacakan oleh imam. "
              "Penjelasan ini dibacakan dengan suara kecerdasan buatan, disusun dengan bantuan kecerdasan "
              "buatan dari kitab-kitab yang disebutkan sumbernya, dan bukan fatwa."),
    "resume": "Kita lanjutkan pelajaran dari langkah terakhir.",
    "correct": "Benar.",
    "try_again": "Belum tepat. Coba pilih yang lain.",
    "revealed": "Ini jawabannya. Perhatikan sebentar.",
    "reminder": "Silakan lanjutkan latihannya. Bagian yang perlu diketuk sedang diberi tanda di layar.",
    "skip_offer": "Jika ingin melewati latihan ini, ketuk tombol Lewati latihan.",
    # True however the learner got here (straight to the last ayah, every exercise skipped):
    # no claim that every ayah was studied; "kapan saja" is said once, on the end card.
    "surah_done": "Pilihan berikutnya ada di layar.",
}
_REVEAL = "Jika masih ragu, ketuk Tunjukkan jawaban. Anda juga boleh mencoba lagi."
# Only in the "Tunggu saya" pace: otherwise the next question comes by itself.
_NEXT = "Ketuk tombol yang diberi tanda untuk melanjutkan."
SHARED_EX_TEXT = {
    # The lesson's imam recites the word by itself (no tap): the learner only answers.
    ("tap-word", "play"): "Dengarkan imam membacakan satu kata dari ayat ini.",
    ("tap-word", "options"): "Sekarang ketuk kata yang tadi dibacakan imam.",
    ("why-harakat", "options"): "Pilih alasan yang membuat akhir kata ini dibaca seperti itu.",
    ("sort-case", "words"): "Ketuk satu kata yang ingin Anda kelompokkan.",
    ("sort-case", "bins"): "Sekarang ketuk kelompok akhiran yang cocok untuk kata itu.",
    ("label-role", "options"): "Pilih peran kata ini dalam kalimat ayatnya.",
    ("wazn-factory", "options"): "Pilih bentuk kata yang sesuai dengan nama yang ditanyakan.",
}


def ex_intro(key: str, n: int) -> str:
    c = num_id(n)
    return {
        "tap-word": (f"Latihan dengar dan ketuk. Imam akan membacakan {c} kata dari ayat ini satu per satu, "
                     "dalam urutan acak. Setiap kali, ketuk kata yang Anda dengar."),
        "why-harakat": (f"Latihan kenapa harakat ini, {c} soal. Setiap soal menampilkan satu kata; pilih alasan "
                        "yang membuat akhirnya dibaca seperti itu."),
        "sort-case": (f"Latihan kelompokkan menurut akhiran, {c} kata. Ketuk satu kata, lalu ketuk kelompok "
                      "akhirannya."),
        "label-role": f"Latihan tebak peran kata, {c} soal. Untuk setiap kata, pilih perannya dalam kalimat ayat ini.",
        "wazn-factory": (f"Latihan bentuk-bentuk kata, {c} soal. Dari satu akar lahir beberapa bentuk kata; pilih "
                         "bentuk yang sesuai dengan namanya. Bentuk-bentuk ini kata Arab hasil tashrif, bukan "
                         "kutipan ayat."),
    }[key]


def surah_lines(lesson: dict, library: dict, san: Sanitiser) -> list[tuple[str, str]]:
    slug, S, name = lesson["slug"], lesson["surah"], lesson["name_id"]
    last = lesson["ayat"][-1]["ayah"]
    out: list[tuple[str, str]] = []
    for a in lesson["ayat"]:
        A = a["ayah"]
        base = f"{slug}:{A}"
        tr = V.spoken_translation(a["translation"]["text"])
        san.plain_check(f"{a['loc']} translation", tr)
        n_words = len(a["words"])
        out.append((f"{base}:intro",
                    f"Ayat {ordinal(A)} Surah {name}. Terjemahannya: “{V.fold(tr)}” Ayat ini terdiri "
                    f"dari {num_id(n_words)} kata, dan kita akan mempelajarinya satu per satu."))
        out.append((f"{base}:recite", f"Sekarang dengarkan imam membacakan ayat {ordinal(A)}."))
        for i, w in enumerate(a["words"], 1):
            san.plain_check(f"{w['loc']} gloss", w["gloss"])
            out.append((f"{base}:w{i}",
                        f"Kata {ordinal(i)} artinya “{V.fold(w['gloss'])}”. {san.prose(w['why'], S, A, i)}"))
        for c in V.introduced_concepts(a["loc"], library):
            out.append((f"{base}:concept:{c['id']}",
                        f"Konsep baru: {san.prose(c['title'], S, A)}. {san.prose(c['summary'], S, A)}"))
        if a.get("structure"):
            out.append((f"{base}:structure", f"Sekarang susunan kalimatnya. {san.prose(a['structure']['summary'], S, A)}"))
        counts = V.exercise_counts(a, library)
        for k in V.EXERCISE_KEYS:
            if k in counts:
                out.append((f"{base}:ex:{k}:intro", ex_intro(k, counts[k])))
        out.append((f"{base}:recap", f"Dengarkan sekali lagi seluruh ayat {ordinal(A)} dibacakan imam."))
        if A == last:
            out.append((f"{base}:done", f"Pelajaran ayat {ordinal(A)} selesai. Ini ayat terakhir Surah {name}."))
        else:
            out.append((f"{base}:next", f"Pelajaran ayat {ordinal(A)} selesai. Berikutnya ayat {ordinal(A + 1)}; "
                                        "pelajaran berlanjut sendiri."))
    return out


def shared_lines() -> list[tuple[str, str]]:
    out = [(f"shared:{k}", SHARED_TEXT[k]) for k in V.SHARED_KEYS]
    for k in V.EXERCISE_KEYS:
        for p in V.EXERCISE_GUIDE_PARTS[k]:
            text = SHARED_EX_TEXT.get((k, p)) or {"reveal": _REVEAL, "next": _NEXT}[p]
            out.append((f"shared:ex:{k}:{p}", text))
    return out


def _split_ids(lines: list[tuple[str, str]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for lid, text in lines:
        parts = split_line(text)
        if len(parts) == 1:
            out[lid] = text
        else:
            for i, p in enumerate(parts):
                out[f"{lid}:{chr(ord('a') + i)}"] = p
    return out


def build_texts(lessons: dict[str, dict], library: dict) -> dict[str, dict[str, str]]:
    """manifest name → {id: text}, in lesson order (deterministic). Stops, writing nothing, if a
    line fails validate_narration's text checks (a new mention the rules above do not cover)."""
    san = Sanitiser(lessons)
    out = {}
    for sp in SURAHS:
        if sp.slug in lessons:
            out[sp.slug] = _split_ids(surah_lines(lessons[sp.slug], library, san))
    out["shared"] = _split_ids(shared_lines())
    errs = [e for texts in out.values() for lid, text in texts.items() for e in V.check_text(lid, text, san.forms)]
    if errs:
        raise SystemExit("narration lines the narrator must not say:\n  " + "\n  ".join(errs))
    return out


def manifest(texts: dict[str, str], old: dict | None) -> dict:
    """Keeps the audio of every line whose text did not change, and the voice."""
    old_lines = (old or {}).get("lines") or {}
    lines = {}
    for lid, text in texts.items():
        line = {"text": text}
        prev = old_lines.get(lid)
        if isinstance(prev, dict) and prev.get("text") == text and "audio" in prev:
            line["audio"] = prev["audio"]
        lines[lid] = line
    return {"version": V.MANIFEST_VERSION, "voice": (old or {}).get("voice"), "lines": lines}


def dump(man: dict) -> str:
    return json.dumps(man, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the files on disk; write nothing")
    ap.add_argument("--show", metavar="ID_PREFIX", help="print the lines whose id starts with this")
    args = ap.parse_args()
    _, lessons, library = V.load_all()
    built = build_texts(lessons, library)
    if args.show is not None:
        for texts in built.values():
            for lid, text in texts.items():
                if lid.startswith(args.show):
                    print(f"{lid}\n    {text}\n")
        return 0
    V.NARRATION_DIR.mkdir(parents=True, exist_ok=True)
    differ = []
    for name, texts in built.items():
        path = V.NARRATION_DIR / f"{name}.json"
        old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        new = dump(manifest(texts, old))
        chars = sum(len(t) for t in texts.values())
        tts = sum(len(tts_text(t)) for t in texts.values())
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != new:
                differ.append(name)
            continue
        if not path.exists() or path.read_text(encoding="utf-8") != new:
            path.write_text(new, encoding="utf-8")
        print(f"{name:12s} {len(texts):4d} lines  {chars:6d} chars (speech {tts:6d})  -> {path.relative_to(V.BELAJAR.parent)}")
    if args.check:
        if differ:
            print("out of date:", ", ".join(differ))
            return 1
        print("narration manifests are up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
