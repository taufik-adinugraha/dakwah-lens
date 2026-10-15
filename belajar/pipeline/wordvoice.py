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
This module reads content only: no corpus, no cache, nothing outside pipeline/ and content/
(the local checks of build_wordvoice.py add the Tanzil file and the downloaded copies).

QURAN.COM'S OWN RECORDING OF A WORD (operator 2026-10-15, after listening to the narrator's word
takes: "still lacking"; "use quran.com, mention the credit"; then "they will allow us to copy and
distribute for educational non-profit purposes; we copy to our server so latency is minimum").
Every text that is A WORD AT A REAL PLACE IN THE QUR'AN plays Quran.com's word-by-word recording
of that place (audio.qurancdn.com/wbw/…), copied UNALTERED to our media store
(/belajar/media/narration/quran-com/wbw/<the upstream file name>; sha256 = upstream's, no
re-encode: trimming is only the [start, end] markers below). Everything else keeps the narrator's
recording: parts of words (bi-, -hum, -ta), letters, teaching forms built by edits (ismi,
bi+ismi), runs of several words (no word-by-word file holds two words), anything with no place.

  A text's place (`quran_com_choice`) comes from the CONTENT, never a search: the places the
  content itself puts those bytes — a lesson word (its loc), a composition form that quotes a
  whole word ({"word": loc} / {"tanzil": loc}, no pieces), a composition example's bentuk dasar
  (its loc), a Konsep word (library.json `quran`, a whole-word key). A form built by edits is
  not placed by the `attested` list (operator 2026-10-15: "teaching forms built by ops such as
  ismi, bi+ismi" stay the narrator's) — it reaches Quran.com only when its bytes are ALSO one of
  the places above (the manifest is keyed by the text). Of a text's places:
    1. the AYAH-FINAL ones, when there are any (the recording is then the stop form the lessons
       describe at an ayah's end);
    2. else, and among those, the first in lesson order (curriculum.json: lesson words, then the
       compositions' forms and examples of that lesson), then the Konsep words in mushaf order.
  Whether a place ends its ayah is Quran.com's own word list of the ayah
  (fixtures/quran_com_words.json, fetched by build_wordvoice.py --fetch-quran-com from
  api.quran.com; its count is Tanzil's, checked locally). The FILE is the word's position,
  wbw/<SSS>_<AAA>_<WWW>.mp3 (qc_upstream) — not the API's `audio_url`, which in 9 of the 40 ayat
  counts pause marks / a rub' al-hizb sign and names files the CDN does not have (41:9 word 13:
  the API says _015, a 404; the CDN's _013 is the word).

  words[<plain text>] = {"source": "quran.com", "loc": "1:1:1", "audio": {url, upstream, ms,
  sha256, start, end}}: `url` our copy, `upstream` where it was copied from, `ms` the file's
  length, `start`/`end` the word inside it (silence trimmed by ffmpeg silencedetect, 30 ms kept).
  words[<plain text>] = {"source": "elevenlabs", say?, seed?, cut?, "audio": {url, ms, sha256}}.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

BELAJAR = Path(__file__).resolve().parent.parent
CONTENT = BELAJAR / "content"
MANIFEST = CONTENT / "wordvoice.json"
QC_FIXTURE = BELAJAR / "pipeline" / "fixtures" / "quran_com_words.json"
VERSION = 2

# ---------------------------------------------------------------- Quran.com's word recordings
QC_UPSTREAM = "https://audio.qurancdn.com/"
QC_PREFIX = "/belajar/media/narration/quran-com/wbw/"
QC_FILE = re.compile(r"wbw/(\d{3})_(\d{3})_(\d{3})\.mp3")
SOURCES = ("quran.com", "elevenlabs")
QC_AUDIO_KEYS = {"url", "upstream", "ms", "sha256", "start", "end"}
TRIM_MARGIN_MS = 30
_WORD_LOC = re.compile(r"\d{1,3}:\d{1,3}:\d{1,3}")

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
DAL, SUKUN, KASRA, TA = "\u062F", "\u0652", "\u0650", "\u062A"
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
    # The same for an open ta with a kasrah (al-jinnati, written ة before `plain`): the kasrah was
    # lost at the end of the text ("aljinnat"); "1 kata + titik Arab" of seven tries (operator
    # 2026-10-14).
    if text.endswith(TA + KASRA):
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


# ---------------------------------------------------------------- a text's place in the Qur'an (Quran.com)
def _lesson_order(content: Path) -> dict[str, int]:
    cur = _load(content / "curriculum.json")
    ids = [l["id"] for l in cur.get("lessons") or [] if re.fullmatch(r"\d{1,3}:\d{1,3}", str(l.get("id")))]
    return {k: i for i, k in enumerate(ids)}


def places(content: Path = CONTENT) -> dict[str, list[tuple[tuple, str, str]]]:
    """{plain text: [(rank, loc, origin), …]}: every place the content itself puts those bytes as a
    WHOLE word (module docstring). rank: (0, lesson, word) a lesson word; (1, lesson, word) a
    composition form quoting a whole word or a composition example; (2, s, a, w) a Konsep word."""
    order = _lesson_order(content)
    out: dict[str, list[tuple[tuple, str, str]]] = {}

    def lesson_of(loc: str) -> tuple[int, int]:
        s, a, w = (int(x) for x in loc.split(":"))
        return order.get(f"{s}:{a}", len(order)), w

    def add(ar: str, loc: str, origin: str, rank: tuple) -> None:
        if ar and _WORD_LOC.fullmatch(loc or ""):
            out.setdefault(plain(ar), []).append((rank, loc, origin))

    for f in sorted(content.glob("*.json")):
        data = _load(f)
        if not isinstance(data, dict) or not isinstance(data.get("ayat"), list):
            continue
        for a in data["ayat"]:
            for w in a.get("words") or []:
                if isinstance(w, dict) and w.get("loc") and w.get("ar"):
                    add(w["ar"], w["loc"], "lesson-word", (0, *lesson_of(w["loc"])))
    for f in sorted((content / "compose").glob("*.json")):
        comp = _load(f)
        for wl, unit in (comp.get("words") or {}).items():
            forms = unit.get("forms") or {}
            for name, form in forms.items():
                sp = form.get("src")
                if isinstance(sp, dict) and len(sp) == 1 and set(sp) <= {"word", "tanzil"}:
                    add(form.get("ar", ""), sp.get("word") or sp.get("tanzil"), f"compose-form {wl} {name}", (1, *lesson_of(wl)))
            for ex in (comp.get("examples") or {}).get(wl) or []:
                form = forms.get(ex.get("form")) or {}
                if ex.get("loc"):
                    add(form.get("ar", ""), ex["loc"], f"compose-example {wl} {ex.get('form')}", (1, *lesson_of(wl)))
    library = _load(content / "library.json")
    for k, ar in (library.get("quran") or {}).items():
        if _WORD_LOC.fullmatch(k):
            s, a, w = (int(x) for x in k.split(":"))
            add(ar, k, "konsep-word", (2, s, a, w))
    return out


def load_qc(path: Path = QC_FIXTURE) -> dict | None:
    return _load(path) if path.exists() else None


def qc_word(qc: dict | None, loc: str) -> dict | None:
    """Quran.com's word at `loc` (its own list of the ayah, words only), or None."""
    s, a, w = (int(x) for x in loc.split(":"))
    words = ((qc or {}).get("ayat") or {}).get(f"{s}:{a}")
    return words[w - 1] if words and 1 <= w <= len(words) else None


def qc_final(qc: dict | None, loc: str) -> bool:
    s, a, w = (int(x) for x in loc.split(":"))
    words = ((qc or {}).get("ayat") or {}).get(f"{s}:{a}") or []
    return bool(words) and w == len(words)


def ayat_of_places(pl: dict[str, list[tuple[tuple, str, str]]], inv: dict[str, set[str]]) -> list[str]:
    """Every ayah (S:A) a place of a voiced text stands in: the ayat the fixture must hold."""
    keys = {":".join(loc.split(":")[:2]) for t, ps in pl.items() if t in inv for _, loc, _ in ps}
    return sorted(keys, key=lambda k: tuple(int(x) for x in k.split(":")))


def quran_com_choice(inv: dict[str, set[str]], qc: dict | None, content: Path = CONTENT) -> dict[str, str]:
    """{plain text: loc} for every voiced text that is a word at a real place (module docstring:
    the ayah-final places first, then lesson order, then the Konsep words in mushaf order). A text
    whose ayah is not in the fixture yet has no place (build_wordvoice.py --fetch-quran-com)."""
    pl = places(content)
    out: dict[str, str] = {}
    for t in sorted(inv):
        ps = [p for p in pl.get(t, []) if qc_word(qc, p[1]) is not None]
        if not ps:
            continue
        finals = [p for p in ps if qc_final(qc, p[1])]
        out[t] = min(finals or ps)[1]
    return out


def choice_conflicts(inv: dict[str, set[str]], qc: dict | None, content: Path = CONTENT) -> list[str]:
    """Texts whose places both end an ayah and stand inside one: the ayah-final recording is
    chosen, and plays where the same bytes stand mid-ayah too (reported, never silent)."""
    pl = places(content)
    out = []
    for t in sorted(inv):
        ps = [p for p in pl.get(t, []) if qc_word(qc, p[1]) is not None]
        fin = sorted({p[1] for p in ps if qc_final(qc, p[1])})
        mid = sorted({p[1] for p in ps if not qc_final(qc, p[1])})
        if fin and mid:
            out.append(f"{t!r}: ends its ayah at {', '.join(fin)}; inside an ayah at {', '.join(mid)}")
    return out


def qc_upstream(qc: dict | None, loc: str) -> str | None:
    """The CDN's file of the word at `loc`: wbw/<SSS>_<AAA>_<WWW>.mp3 by the word's position in
    Quran.com's list (= the Tanzil number: fixture_problems). Not the API's `audio_url`, which in
    41:9 counts a rub' al-hizb sign and a pause mark and names files the CDN does not have
    (wbw/041_009_015.mp3 and _016 answer 404; the CDN holds _001 … _014, one per word — checked
    2026-10-15)."""
    if qc_word(qc, loc) is None:
        return None
    s, a, w = (int(x) for x in loc.split(":"))
    return f"{QC_UPSTREAM}wbw/{s:03d}_{a:03d}_{w:03d}.mp3"


def qc_numbering_notes(qc: dict | None) -> list[str]:
    """The ayat whose API audio_url is not the word's position (reported, see qc_upstream)."""
    out = []
    for k, words in ((qc or {}).get("ayat") or {}).items():
        s, a = (int(x) for x in k.split(":"))
        off = [i for i, w in enumerate(words, 1) if w.get("audio_url") != f"wbw/{s:03d}_{a:03d}_{i:03d}.mp3"]
        if off:
            out.append(f"{k}: the API's audio_url is not the word's position for words {off[0]}–{off[-1]} (the CDN file by position is used)")
    return out


def qc_url(upstream: str) -> str:
    """Our copy of an upstream word file: the same file name under QC_PREFIX."""
    return QC_PREFIX + upstream.rsplit("/", 1)[1]


# ---------------------------------------------------------------- the manifest
def expected(inv: dict[str, set[str]], previous: dict | None, qc: dict | None | bool = True) -> dict:
    """The manifest the content gives. `qc`: the Quran.com fixture (True: the committed one; None:
    none, every text is the narrator's). A recording is carried over from `previous` only while it
    is still of what would be played: the narrator's while what was sent is unchanged, Quran.com's
    while its place and upstream file are."""
    if qc is True:
        qc = load_qc()
    choice = quran_com_choice(inv, qc) if qc else {}
    prev = ((previous or {}).get("words")) or {}
    words = {}
    for t in sorted(inv):
        old = prev.get(t) if isinstance(prev.get(t), dict) else {}
        if t in choice:
            entry: dict = {"source": "quran.com", "loc": choice[t]}
            up = qc_upstream(qc, choice[t])
            a = old.get("audio") if old.get("source") == "quran.com" and old.get("loc") == choice[t] else None
            if isinstance(a, dict) and a.get("upstream") == up and a.get("url") == qc_url(up):
                entry["audio"] = a
            words[t] = entry
            continue
        entry = {"source": "elevenlabs"}
        if say_of(t) != t:
            entry["say"] = say_of(t)
        if seed_of(t) is not None:
            entry["seed"] = seed_of(t)
        if t in CUT_TAIL:
            entry["cut"] = "tail"
        # a recording is kept only while what was sent for it is still what would be sent
        if (old.get("source", "elevenlabs") == "elevenlabs" and old.get("audio") and old.get("say") == entry.get("say")
                and old.get("seed") == entry.get("seed") and old.get("cut") == entry.get("cut")):
            entry["audio"] = old["audio"]
        words[t] = entry
    return {
        "_comment": "GENERATED by pipeline/build_wordvoice.py from the lesson and library content: one recording per distinct plain-letter text (pipeline/wordvoice.py) — Quran.com's word-by-word recording of the text's place in the Qur'an (copied unaltered to our media store), or the narrator's (ElevenLabs) for a part of a word, a letter, a teaching form or a run. Do not edit.",
        "version": VERSION,
        "voice": {"id": VOICE_ID, "name": VOICE_NAME, "model": MODEL, "settings": dict(VOICE_SETTINGS)},
        "quran_com": {
            "credit": "Word-by-word recordings: Quran.com / Quran Foundation (https://quran.com), copied unaltered to our server for non-profit educational use",
            "upstream": QC_UPSTREAM,
            "prefix": QC_PREFIX,
        },
        "words": words,
    }


def load_manifest(path: Path = MANIFEST) -> dict | None:
    return _load(path) if path.exists() else None


def _qc_audio_problems(t: str, e: dict, choice: dict[str, str], qc: dict | None) -> list[str]:
    out: list[str] = []
    loc = e.get("loc")
    if t not in choice:
        return [f"{t!r}: source quran.com, but the text is a word at no place in the content (a part, a letter, a built form or a run is the narrator's)"]
    if loc != choice[t]:
        out.append(f"{t!r}: loc {loc!r} is not the place the rule chooses ({choice[t]})")
    for k in ("say", "seed", "cut"):
        if k in e:
            out.append(f"{t!r}: a Quran.com recording has no {k!r} (that is what is sent to ElevenLabs)")
    a = e.get("audio")
    if a is None:
        return out
    if not isinstance(a, dict) or set(a) != QC_AUDIO_KEYS:
        return out + [f"{t!r}: audio has keys {sorted(a) if isinstance(a, dict) else a!r} (expected {', '.join(sorted(QC_AUDIO_KEYS))})"]
    up = qc_upstream(qc, choice[t])
    if not str(a["upstream"]).startswith(QC_UPSTREAM) or not QC_FILE.search(str(a["upstream"])):
        out.append(f"{t!r}: upstream {a['upstream']!r} is not a word file on {QC_UPSTREAM}wbw/")
    elif a["upstream"] != up:
        out.append(f"{t!r}: upstream {a['upstream']} is not Quran.com's file of {choice[t]} ({up}, fixtures/quran_com_words.json)")
    if not str(a["url"]).startswith(QC_PREFIX):
        out.append(f"{t!r}: url {a['url']!r} is not under {QC_PREFIX} (our copy of Quran.com's file)")
    elif a["url"] != qc_url(str(a["upstream"])):
        out.append(f"{t!r}: url {a['url']} is not the upstream file's name under {QC_PREFIX}")
    if not re.fullmatch(r"[0-9a-f]{64}", str(a["sha256"])):
        out.append(f"{t!r}: sha256 is not 64 hex digits")
    ms, s0, s1 = a["ms"], a["start"], a["end"]
    if not all(isinstance(x, int) and not isinstance(x, bool) for x in (ms, s0, s1)):
        out.append(f"{t!r}: ms/start/end {ms!r}/{s0!r}/{s1!r} are not whole milliseconds")
    elif not (0 <= s0 < s1 <= ms) or not MIN_MS <= s1 - s0 <= MAX_MS:
        out.append(f"{t!r}: [{s0}, {s1}] of {ms} ms is not a plausible word inside its file ({MIN_MS}–{MAX_MS} ms)")
    return out


def problems(manifest: dict | None, inv: dict[str, set[str]], require_audio: bool = False, qc: dict | None | bool = True) -> list[str]:
    if manifest is None:
        return ["content/wordvoice.json is missing"]
    if qc is True:
        qc = load_qc()
    choice = quran_com_choice(inv, qc) if qc else {}
    out: list[str] = []
    if manifest.get("version") != VERSION:
        out.append(f"version {manifest.get('version')!r} (expected {VERSION})")
    want = expected(inv, None, qc)
    if manifest.get("voice") != want["voice"]:
        out.append("the voice block differs from wordvoice.py (voice, model or settings changed: re-render)")
    if manifest.get("quran_com") != want["quran_com"]:
        out.append("the quran_com block (credit, upstream, prefix) differs from wordvoice.py")
    have = manifest.get("words") or {}
    for t in sorted(set(inv) - set(have)):
        out.append(f"a text the content shows has no entry: {t!r} ({', '.join(sorted(inv[t]))})")
    for t in sorted(set(have) - set(inv)):
        out.append(f"an entry no content shows any more: {t!r}")
    for t, e in have.items():
        if t != plain(t):
            out.append(f"{t!r} is not in plain letters (wordvoice.plain)")
        if not isinstance(e, dict) or e.get("source") not in SOURCES:
            out.append(f"{t!r}: source {e.get('source') if isinstance(e, dict) else e!r} is not one of {', '.join(SOURCES)}")
            continue
        if e["source"] == "quran.com":
            out += _qc_audio_problems(t, e, choice, qc)
            if e.get("audio") is None and require_audio:
                out.append(f"{t!r} has no recording (build_wordvoice.py --fetch-quran-com)")
            continue
        if t in choice:
            out.append(f"{t!r}: the narrator's, but the text is a word at {choice[t]} (Quran.com's recording: build_wordvoice.py --write)")
        if "loc" in e:
            out.append(f"{t!r}: a narrator's recording has no loc")
        if e.get("say") != (say_of(t) if say_of(t) != t else None) or e.get("seed") != seed_of(t) or e.get("cut") != ("tail" if t in CUT_TAIL else None):
            out.append(f"{t!r}: say/seed {e.get('say')!r}/{e.get('seed')!r} differ from wordvoice.py (the rule or an override changed: record it again)")
        a = e.get("audio")
        if a is None:
            if require_audio:
                out.append(f"{t!r} has no recording")
            continue
        if not isinstance(a, dict) or set(a) != {"url", "ms", "sha256"}:
            out.append(f"{t!r}: audio has keys {sorted(a) if isinstance(a, dict) else a!r} (expected url, ms, sha256)")
            continue
        if not re.fullmatch(r"[0-9a-f]{64}", str(a["sha256"])):
            out.append(f"{t!r}: sha256 is not 64 hex digits")
        elif a["url"] != url_of(t, a["sha256"]):
            out.append(f"{t!r}: url {a['url']} is not {url_of(t, a['sha256'])} (the text's hash and the file's)")
        if not isinstance(a["ms"], int) or not MIN_MS <= a["ms"] <= MAX_MS:
            out.append(f"{t!r}: {a['ms']!r} ms is not a plausible length ({MIN_MS}–{MAX_MS})")
    return out


def fixture_problems(qc: dict | None, inv: dict[str, set[str]], content: Path = CONTENT) -> list[str]:
    """The Quran.com fixture without the network: it holds every ayah a place stands in, each a
    list of words with a wbw audio_url of that ayah, and every chosen place's word is the text
    (folded: the consonant skeleton; Quran.com and Tanzil write the Uthmani marks differently)."""
    if qc is None:
        return ["fixtures/quran_com_words.json is missing (build_wordvoice.py --fetch-quran-com)"]
    out: list[str] = []
    ayat = qc.get("ayat") or {}
    for k in ayat_of_places(places(content), inv):
        if k not in ayat:
            out.append(f"fixtures/quran_com_words.json has no word list of {k}")
    for k, words in ayat.items():
        s, a = (int(x) for x in k.split(":"))
        for i, w in enumerate(words, 1):
            m = QC_FILE.fullmatch(str(w.get("audio_url")))
            if not m or (int(m.group(1)), int(m.group(2))) != (s, a):
                out.append(f"fixtures/quran_com_words.json {k} word {i}: audio_url {w.get('audio_url')!r} is not a wbw file of {k}")
    for t, loc in quran_com_choice(inv, qc, content).items():
        w = qc_word(qc, loc)
        if fold(w.get("text_uthmani", "")) != fold(t):
            out.append(f"{t!r}: Quran.com's word at {loc} is {w.get('text_uthmani')!r} (another word: the numbering differs)")
    return out


_FOLD_DROP = re.compile("[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED\u0640\u06DE\u06E9\u200C\u200D\u00A0 ]")
_FOLD_LETTER = str.maketrans({"\u0670": "\u0627", "\u0671": "\u0627", "\u0623": "\u0627", "\u0625": "\u0627", "\u0622": "\u0627",
                              "\u0649": "\u064A", "\u0629": "\u062A", "\u06CC": "\u064A"})


def fold(s: str) -> str:
    """Consonant skeleton (search only): marks, tatweel, pause signs and spaces dropped; alif forms
    (the dagger alif among them), the dotless ya and the ta marbuta unified."""
    return _FOLD_DROP.sub("", s or "").translate(_FOLD_LETTER)
