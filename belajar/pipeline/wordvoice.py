"""The voice of every Qur'anic word and form the module shows by itself (operator 2026-10-14).

Until now a word's voice was a TRUNCATION of the imam's recitation of its ayah (library.json
`clips`, the lessons' word segments: pipeline/clips.py). Listening to them the operator found that
"in some parts the truncation are not clean" — a word cut mid-vowel, a neighbour's sound at the
edge, a final harakah dropped where the imam pauses. So each word is now its own recording:

  the narrator Kang Nandar, eleven_multilingual_v2, the word written in PLAIN LETTERS.

Why plain letters (operator's listening test, 2026-10-14): eleven_v3 reads a lone word as the end
of a sentence and drops its last vowel ("bism" for bismi); eleven_multilingual_v2 reads it whole,
but reads the mushaf's alif wasla (U+0671) as nothing — "Allah" came out as "lillahi". So the
Uthmani marks the model does not know are written as the plain letters it does (`plain`):
alif wasla and dagger alif as alif, the small sukun as a sukun, the small high signs dropped,
the dotless ya after a kasrah (alladhī, fī: the mushaf writes the long ī with ى, U+0649, which
the model reads as a separate "ya" syllable: "alladziya", operator 2026-10-14) as a ya with its dots,
and a ta marbuta that carries a vowel (al-jinnati) as the open ta ت: the model reads ة as the final
"h" of a stop and loses the vowel ("al-jinnah", operator 2026-10-14). After a fathah the dotless ya
is a long ā (hudā) and stays; a ة with a sukun or no mark is a stop and stays. The mapping is tiny
and total; src/lib/wordvoice.ts is its twin and wordvoice.test.ts keeps the two
equal on the content's own words.

The set of strings to voice is DERIVED, never listed by hand (`inventory`): every word of every
lesson surah, every Qur'anic word the Konsep texts and pages show (library.json `quran`), every
run of words they cite (q:112:1:2-4), every form of a word's composition (the bentuk dasar, the
teaching forms no ayah has). One recording per distinct plain text, kept in
content/wordvoice.json:

  words[<plain text>].audio = {url, ms, sha256}   — the 64 kbps mono delivery file, served from the
  narration media store (/belajar/media/narration/kang-nandar/words/<id>-<sum>.mp3), id = the first
  16 hex digits of sha256(plain text), sum = the first 10 of the file's own sha256.

The imam's recitation of WHOLE ayat is not touched (the karaoke the lessons follow, the recap).
This module reads content only: no corpus, no cache, nothing outside pipeline/ and content/.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

BELAJAR = Path(__file__).resolve().parent.parent
CONTENT = BELAJAR / "content"
MANIFEST = CONTENT / "wordvoice.json"

VOICE_ID = "aK834gEOxQEtviMPgurT"
VOICE_NAME = "Kang Nandar"
MODEL = "eleven_multilingual_v2"
# The narration's own settings (validate_narration.VOICE_SETTINGS), no language_code (not accepted
# by this model), apply_text_normalization "off".
VOICE_SETTINGS = {"stability": 0.5, "style": 0.35, "similarity_boost": 0.75, "use_speaker_boost": True}
MASTER_FORMAT = "mp3_44100_128"
DELIVERY_PREFIX = "/belajar/media/narration/kang-nandar/words/"
PRICE_PER_1K = 0.08  # USD, list price (docs/belajar-research/audio.md §4)
MIN_MS, MAX_MS = 150, 30000  # a word is never shorter, a long run is never longer

# ---------------------------------------------------------------- the plain-letter rule
_TO_LETTER = {0x0671: "ا", 0x0670: "ا", 0x06E1: "ْ"}
# small high / low signs (stop signs, ornaments) the model reads as noise or not at all; U+06E2
# (small high meem, iqlab) is among them, so its sound is the next form's business, not the mark's.
_DROP = set(range(0x06D6, 0x06DD)) | {0x06DF, 0x06E0} | set(range(0x06E2, 0x06EE))


_VOWELS = {chr(c) for c in range(0x064B, 0x0652)}          # tanwin, fathah, dhammah, kasrah, shaddah
_MARKS = {chr(c) for c in range(0x064B, 0x0653)} | {"\u0670"} | {chr(c) for c in _DROP}
_MADD = "\u0627\u0649\u064A\u0648"                          # alif, alif maqsura, ya, waw


def _ends_in_madd(word: str) -> bool:
    """The word's last letter is a madd letter with no vowel of its own (fī, nā — not huwa, whose
    waw carries a fathah): the long vowel that a following hamzat wasl cuts short."""
    i = len(word) - 1
    tail = []
    while i >= 0 and word[i] in _MARKS:
        tail.append(word[i])
        i -= 1
    return i >= 0 and word[i] in _MADD and not any(c in _VOWELS for c in tail)


def plain(text: str) -> str:
    """The word as the voice model should read it (see the module docstring)."""
    words = text.strip().split()
    for i in range(1, len(words)):
        # alif wasla right after a long vowel is not read (fī al-'uqadi: "fil-'uqad"); the model
        # read the plain alif as a full "a" and said "fal" (operator 2026-10-14, #118: "alif
        # gugur, spasi" of four tries)
        if words[i].startswith("\u0671") and _ends_in_madd(words[i - 1]):
            words[i] = words[i][1:]
    out = "".join(_TO_LETTER.get(ord(c), c) for c in " ".join(words) if ord(c) not in _DROP)
    out = out.replace("\u0650\u0649", "\u0650\u064A")  # kasrah + alif maqsura: the long ī
    return re.sub("\u0629(?=[\u064B-\u0650])", "\u062A", out)  # ta marbuta + a vowel: the open ta


# ------------------------------------------------ what is SENT for a text (the manifest key stays the plain text)
DAL, SUKUN, KASRA = "\u062F", "\u0652", "\u0650"
PLURAL_INA = "\u064A\u0646\u064E"   # ya + nun + fathah: -ina
STOP = " \u06D4"                       # space + the Arabic full stop
# Per-text overrides, each decided by the operator's ear (a spelling cannot be derived from the
# content): what to send (`say`) or the seed (`seed`) of the take that sounds right where the
# model's default take does not.
OVERRIDES: dict[str, dict] = {
    # 1:7:3/2, the ta of an'amta: the default take said "to" (operator 2026-10-14, #92: of seeds 1-3,
    # a Latin "ta" and a comma, "Arab, seed 1" is right).
    "\u062A\u064E": {"seed": 1},
    # 1:7:8/2, the la of wa la: the default take read "la-am" (operator 2026-10-14, #125: of seeds 1
    # and 2, a Latin "la" / "laa" and a comma, "huruf Arab, seed 1" is right).
    "\u0644\u064E\u0627": {"seed": 1},
    # 1:7:9, ad-dallina: a madd lazim (six counts) that no Arabic spelling reached: the model ignores
    # the maddah mark and extra alifs plateau at 1.4 s. The pesantren respelling the narration
    # already uses for ض ("dho", as in idhofah) with the long vowel written out is right: of seven
    # tries (four more Latin, two split-and-stretched), "L5 ad-dhoooolliin" (operator 2026-10-14).
    # The composition form with the same mark (a teaching form) is not part of that decision.
    "\u0627\u0644\u0636\u0651\u064E\u0627\u0653\u0644\u0651\u0650\u064A\u0646\u064E": {"say": "ad-dhoooolliin"},
    # qala: the alif is two counts and the qaf heavy; the default take was short (549 ms). Of seven
    # tries (two and three alifs, two seeds, slower, a Latin "qoola"), "dua alif" is right
    # (operator 2026-10-14).
    "\u0642\u064E\u0627\u0644\u064E": {"say": "\u0642\u064E\u0627\u0627\u0644\u064E"},
}


# Words whose recording ends in a sound the model made up after the last vowel ("ihdi" came back
# "ihdis"): the take is kept and its tail is cut where the noise starts (wordvoice_qa.cut_tail). A
# retake is not the fix: another seed changes the whole word, and "ihdi" came back "ahdi" (operator
# 2026-10-14). Found by `build_wordvoice.py --qa`.
CUT_TAIL: frozenset[str] = frozenset({
    "\u0627\u0644\u0652\u062E\u064E\u0646\u0651\u064E\u0627\u0633\u0650",  # 11 chars
    "\u0627\u0647\u0652\u062F\u0650",  # 5 chars
    "\u0628\u0650\u0631\u064E\u0628\u0651\u0650 \u0627\u0644\u0646\u0651\u064E\u0627\u0633\u0650",  # 16 chars
    "\u0635\u064F\u062F\u064F\u0648\u0631\u0650 \u0627\u0644\u0646\u0651\u064E\u0627\u0633\u0650",  # 16 chars
})


def say_of(text: str) -> str:
    """What is sent to the voice model. A final dal with a sukun is a qalqalah letter: the model
    stops it dead, so it is written twice, which gives the released echo (yalid, operator
    2026-10-14: "dal ditulis dua kali" was the one of five tries that sounded right). Only where
    the operator confirmed it, the dal after a kasrah: for yūlad (the dal after a fathah) no
    spelling of five sounded right ("cannot find correct one … stay with current option"), so it
    is sent as it is. A text that ends in -ina gets a full stop (below)."""
    if "say" in OVERRIDES.get(text, {}):
        return OVERRIDES[text]["say"]
    if text.endswith(KASRA + DAL + SUKUN):
        return text + DAL + SUKUN
    # The end of the text is read as a stop and the fathah of -ina is lost ("na" came out "n"):
    # a full stop after it keeps the vowel (operator 2026-10-14, #109 1:7:1-2: "+ titik Arab" of
    # five tries, over a comma, the connected reading and a second seed).
    if text.endswith(PLURAL_INA):
        return text + STOP
    return text


def seed_of(text: str) -> int | None:
    return OVERRIDES.get(text, {}).get("seed")


def file_id(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def url_of(text: str, sha256: str) -> str:
    """The file's URL carries its checksum: the media store sends `immutable, max-age=1 year`, so a
    word recorded again (a retake) must not keep its old URL — a browser that has the old file would
    never ask for the new one."""
    return f"{DELIVERY_PREFIX}{file_id(text)}-{sha256[:10]}.mp3"


# ---------------------------------------------------------------- what has to be voiced
_RUN = re.compile(r"(?<![\d:])(\d{1,3}):(\d{1,3}):(\d{1,3})-(\d{1,3})(?![\d:])")


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def inventory(content: Path = CONTENT) -> tuple[dict[str, set[str]], list[str]]:
    """({plain text: {origin, …}}, [runs whose words are not all known]). Origins: lesson-word,
    konsep-word, run, compose-form."""
    out: dict[str, set[str]] = {}
    words: dict[str, str] = {}

    def add(text: str, origin: str) -> None:
        t = plain(text)
        if t:
            out.setdefault(t, set()).add(origin)

    for f in sorted(content.glob("*.json")):
        data = _load(f)
        if not isinstance(data, dict) or not isinstance(data.get("ayat"), list):
            continue
        for a in data["ayat"]:
            for w in a.get("words") or []:
                if isinstance(w, dict) and w.get("loc") and w.get("ar"):
                    words[w["loc"]] = w["ar"]
                    add(w["ar"], "lesson-word")

    library = _load(content / "library.json")
    for loc, ar in (library.get("quran") or {}).items():
        words.setdefault(loc, ar)
        add(ar, "konsep-word")

    texts = [json.dumps(library, ensure_ascii=False)]
    for f in sorted((content / "compose").glob("*.json")):
        comp = _load(f)
        texts.append(json.dumps(comp, ensure_ascii=False))
        for unit in (comp.get("words") or {}).values():
            for form in (unit.get("forms") or {}).values():
                if form.get("ar"):
                    add(form["ar"], "compose-form")

    unresolved: list[str] = []
    for m in sorted({m.group(0) for t in texts for m in _RUN.finditer(t)}):
        s, a, w1, w2 = (int(x) for x in re.split(r"[:\-]", m))
        if w2 <= w1 or m in (library.get("quran") or {}):
            continue  # a run the library itself carries (92:1:1-3) is already a "konsep-word"
        parts = [words.get(f"{s}:{a}:{i}") for i in range(w1, w2 + 1)]
        if all(parts):
            add(" ".join(parts), "run")
        else:
            unresolved.append(m)
    return out, unresolved


# ---------------------------------------------------------------- the manifest
def expected(inv: dict[str, set[str]], previous: dict | None) -> dict:
    prev = ((previous or {}).get("words")) or {}
    words = {}
    for t in sorted(inv):
        entry = {}
        if say_of(t) != t:
            entry["say"] = say_of(t)
        if seed_of(t) is not None:
            entry["seed"] = seed_of(t)
        if t in CUT_TAIL:
            entry["cut"] = "tail"
        old = prev.get(t) if isinstance(prev.get(t), dict) else {}
        # a recording is kept only while what was sent for it is still what would be sent
        if old.get("audio") and old.get("say") == entry.get("say") and old.get("seed") == entry.get("seed") and old.get("cut") == entry.get("cut"):
            entry["audio"] = old["audio"]
        words[t] = entry
    return {
        "_comment": "GENERATED by pipeline/build_wordvoice.py from the lesson and library content: one recording per distinct plain-letter text (pipeline/wordvoice.py). Do not edit.",
        "version": 1,
        "voice": {"id": VOICE_ID, "name": VOICE_NAME, "model": MODEL, "settings": dict(VOICE_SETTINGS)},
        "words": words,
    }


def load_manifest(path: Path = MANIFEST) -> dict | None:
    return _load(path) if path.exists() else None


def problems(manifest: dict | None, inv: dict[str, set[str]], require_audio: bool = False) -> list[str]:
    if manifest is None:
        return ["content/wordvoice.json is missing"]
    out: list[str] = []
    if manifest.get("version") != 1:
        out.append(f"version {manifest.get('version')!r} (expected 1)")
    want = expected(inv, None)["voice"]
    if manifest.get("voice") != want:
        out.append("the voice block differs from wordvoice.py (voice, model or settings changed: re-render)")
    have = manifest.get("words") or {}
    for t in sorted(set(inv) - set(have)):
        out.append(f"a text the content shows has no entry: {t!r} ({', '.join(sorted(inv[t]))})")
    for t in sorted(set(have) - set(inv)):
        out.append(f"an entry no content shows any more: {t!r}")
    for t, e in have.items():
        if t != plain(t):
            out.append(f"{t!r} is not in plain letters (wordvoice.plain)")
        if isinstance(e, dict) and (e.get("say") != (say_of(t) if say_of(t) != t else None) or e.get("seed") != seed_of(t) or e.get("cut") != ("tail" if t in CUT_TAIL else None)):
            out.append(f"{t!r}: say/seed {e.get('say')!r}/{e.get('seed')!r} differ from wordvoice.py (the rule or an override changed: record it again)")
        a = e.get("audio") if isinstance(e, dict) else None
        if a is None:
            if require_audio:
                out.append(f"{t!r} has no recording")
            continue
        if set(a) != {"url", "ms", "sha256"}:
            out.append(f"{t!r}: audio has keys {sorted(a)} (expected url, ms, sha256)")
            continue
        if not re.fullmatch(r"[0-9a-f]{64}", str(a["sha256"])):
            out.append(f"{t!r}: sha256 is not 64 hex digits")
        elif a["url"] != url_of(t, a["sha256"]):
            out.append(f"{t!r}: url {a['url']} is not {url_of(t, a['sha256'])} (the text's hash and the file's)")
        if not isinstance(a["ms"], int) or not MIN_MS <= a["ms"] <= MAX_MS:
            out.append(f"{t!r}: {a['ms']!r} ms is not a plausible length ({MIN_MS}–{MAX_MS})")
    return out
