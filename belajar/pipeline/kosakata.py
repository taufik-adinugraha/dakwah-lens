"""The Qur'an vocabulary list (operator 2026-11-03: every word of the Qur'an, ranked by frequency
only, meanings in Indonesian and English): format, build and checks. build_kosakata.py writes the
files, validate_kosakata.py checks them, test_validate_kosakata.py plants faults in copies.

Everything countable or verbatim is computed here from the pinned sources and never typed: rank,
counts, root, headword and transliteration (QAC 0.4), word forms and ayah text (Tanzil),
translation (QuranEnc). The meanings alone come from authored/kosakata_meanings.json, written with
Claude outside this pipeline (authoring/kosakata_generate.py): each sense cites ayat where the word
carries it, and a separate pass checked it. They are lighter than the lesson Kosakata in
library.json, which cites a kitab by page; the pages say so. Each word's recording is pinned in
kosakata_voice.json (kosakata_voice.py has the rule).

The output is split because the container has 256 MB (deploy/belajar/docker-compose.yml) and a
page needs one word at a time. The app reads these files per request and never bundles them:

    content/kosakata/index.json       every word's row, for the list and the search
    content/kosakata/words-NNN.json   100 words each, by rank
    content/kosakata/ayat-SSS.json    the cited ayat of one surah, for the ayah popup
    content/kosakata/path.json        the learning path's levels and batches, and Level 0 (kosakata_path.py)
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import ayat as AY
import kosakata_path as P
import kosakata_voice as V
from common import (
    AUTHORED_DIR,
    CONTENT_DIR,
    Tanzil,
    bw_to_ar,
    lesson_ayah,
    load_qac,
    require_pinned,
    root_letters,
    sha256_bytes,
)

KOSAKATA_DIR = CONTENT_DIR / "kosakata"
AUTHORED_FILE = AUTHORED_DIR / "kosakata_meanings.json"
LIBRARY_FILE = CONTENT_DIR / "library.json"
QAC_KEY = "qac_morphology"
WORDS_PER_FILE = 100
TOP_FORMS = 5
MAX_SENSES = 4
MAX_GLOSS_WORDS = 6
PIPELINE_LINE = "belajar/pipeline/build_kosakata.py (stdlib only, no LLM)"
REVIEWS = {"passed", "corrected", "disputed"}

# Operator 2026-11-03: where Allah is the subject, نَسِيَ keeps "abandon, disregard" rather than the
# translations' "forget" (7:51), since Allah does not forget (19:64). A checker may not undo it.
PINNED_SENSES = {"nasiYa": ("meninggalkan, mengabaikan", "abandon, disregard")}

_ARABIC = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿ]")
_SCREAM = re.compile(r"\b[A-Z]{3,}\b")
_CONS = {
    "b": "b", "t": "t", "v": "ṡ", "j": "j", "H": "ḥ", "x": "kh", "d": "d", "*": "ż", "r": "r",
    "z": "z", "s": "s", "$": "sy", "S": "ṣ", "D": "ḍ", "T": "ṭ", "Z": "ẓ", "E": "‘", "g": "g",
    "f": "f", "q": "q", "k": "k", "l": "l", "m": "m", "n": "n", "h": "h", "w": "w", "y": "y",
    "'": "’", ">": "’", "<": "’", "&": "’", "}": "’", "p": "h",
}
_HAMZA = set("'><&}")
_VOWELS = set("aiu")
# QAC stores these particles without their final vowel: ثُمّ is thumma, لَٰكِنّ is lakinna.
_FINAL_A_TAGS = {"ACC", "CONJ", "LOC"}
# Words the spelling alone can't give: QAC marks no long vowel in Allahumma, the second ya of بِأَيْيْدٍ
# is unread, مُحْىِ ends in a long vowel, and هُزُوًا and كُفُوًا keep their waw as a consonant.
_SPOKEN = {
    "{ll~ah": "Allāh",
    "{ll~ahum~a": "Allāhumma",
    ">ayoyd": "aid",
    "muHoY": "muḥyī",
    "huzuw": "huzuw",
    "kufuw": "kufuw",
}
# The article's "a" on a hamzat wasl is {l~ in every other word; these two names keep it before a sukun.
_WASL_A_NAMES = {"{loyasaEa", "{loEuz~aY`"}
_VOWEL_OR_TANWIN = _VOWELS | set("FNK")
_VOWEL_CLASH = re.compile("(?!ai|au)[aiuāīū][aiuāīū]")
_TRIPLED = re.compile(r"(.)\1\1")


def bare_lemma(bw: str) -> str:
    """QAC's lemma without its homograph number, and without the article's assimilation, which QAC
    keeps on the first letter (r~aHiym): no Arabic word starts with a shaddah."""
    return re.sub(r"^(.)~", r"\1", re.sub(r"\d+$", "", bw))


def headword(bw: str) -> str:
    return bw_to_ar(bare_lemma(bw))


def _spelled_as_read(s: str) -> str:
    """The lemma with its Uthmani spelling reduced to what is read, so the letter rules below see one
    spelling of each sound. Without this, نَبِىّ came out as nabīī and هُدًى as hudanā."""
    s = re.sub(r"^\{ll~", "{l~", s)  # ٱللَّٰت is one doubled lam
    s = re.sub(r"Y(?=[aiuo~])", "y", s)  # a dotless ya with a vowel or shaddah is the consonant: n~abiY~, xa$iYa
    s = re.sub(r"oY$", "oy", s)  # so is one after a sukun: waHoY
    s = re.sub(r"(?<!a)Y`", "`", s)  # one long vowel, not two: majorY`
    s = s.replace("u,", "uw").replace("i.", "iy")  # the small waw and ya lengthen the vowel: wu,riYa
    s = s.replace("A@", "").replace("iA}", "i}")  # a silent alif: yarojuwA@, miA}ap
    s = re.sub(r"(?<=uw)A$", "", s)  # the same, unmarked, after a plural's waw: SaAluwA
    s = re.sub(r"(?<=w`)A$", "", s)  # and after the long vowel of رِبَوٰا
    return re.sub(r"(?<=[FN])[AY]$", "", s)  # the seat of a tanwin: hudFY, >abadFA


def translit(bw: str, tags: set[str] | frozenset[str] = frozenset()) -> str:
    """A Buckwalter lemma in the module's transliteration, SKB 158/1987, by rule. An initial hamza
    is not written; a hamzat wasl is "a" in the article and "i" elsewhere."""
    spoken = _SPOKEN.get(bare_lemma(bw))
    if spoken:
        return spoken
    s = _spelled_as_read(bare_lemma(bw).replace("^", "").replace("_", ""))
    out: list[str] = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        nx = s[i + 1] if i + 1 < n else ""
        nx2 = s[i + 2] if i + 2 < n else ""
        if c == "{":
            out.append("a" if s.startswith("{l~") or bare_lemma(bw) in _WASL_A_NAMES else "i")
        elif c == "|":
            out.append("ā" if i == 0 else "’ā")
        elif c == "a":
            if nx == "w" and nx2 == "`":  # Uthmani waw + dagger alif: Salaw`p
                out.append("ā")
                i += 2
            elif nx in ("A", "Y", "`"):
                out.append("ā")
                i += 1
                if i + 1 < n and s[i + 1] == "`":
                    i += 1
            elif nx == "y" and nx2 in ("o", ""):
                out.append("ai")
                i += 1
            elif nx == "w" and nx2 in ("o", ""):
                out.append("au")
                i += 1
            else:
                out.append("a")
        elif c == "i":
            if nx == "y" and nx2 not in _VOWEL_OR_TANWIN and nx2 != "~":
                out.append("ī")
                i += 1
            elif nx == "Y":
                out.append("ī")
                i += 1
            else:
                out.append("i")
        elif c == "u":
            if nx == "w" and nx2 not in _VOWEL_OR_TANWIN and nx2 != "~":
                out.append("ū")
                i += 1
            else:
                out.append("u")
        elif c in ("A", "Y", "`"):
            out.append("ā")
        elif c == "F":
            out.append("an")
        elif c == "N":
            out.append("un")
        elif c == "K":
            out.append("in")
        elif c == "#":
            out.append("’")
        elif c == "~":
            if out:
                out.append(out[-1])
        elif c in _CONS and not (c in _HAMZA and i == 0):
            out.append(_CONS[c])
        i += 1
    t = "".join(out)
    if s.endswith("~") and set(tags) & _FINAL_A_TAGS:
        t += "a"
    return t


def fold(text: str) -> str:
    """What the search compares: lowercase, no diacritics or harakat, one form of each Arabic letter
    that is spelt several ways. src/lib/kosakata-core.ts foldSearch is the same rule."""
    bare = "".join(ch for ch in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(ch))
    bare = bare.replace("ٱ", "ا").replace("ى", "ي").replace("ة", "ه")
    bare = re.sub("[ءـۖ-ۭ‘’'`]", "", bare)
    return " ".join(bare.split())


def load_authored(path: Path = AUTHORED_FILE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def lexeme_ids() -> dict[str, str]:
    """QAC lemma → the lesson Kosakata entry that explains it in full (its count's method names the
    lemma: "LEM:r~aHiym")."""
    lib = json.loads(LIBRARY_FILE.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for lex in lib["lexicon"]:
        m = re.search(r"LEM:([^\s,)]+)", (lex.get("occurrences") or {}).get("method", ""))
        if m:
            out[m.group(1)] = lex["id"]
    return out


def lemma_table(segs: list, T: Tanzil) -> list[dict]:
    """Every lemma of QAC, most frequent first; ties by first occurrence. Rank, counts and forms are
    computed here and only here."""
    hits: dict[str, list] = defaultdict(list)
    for g in segs:
        lem = g.feat.get("LEM")
        if lem:
            hits[lem].append(g)
    tokens: dict[tuple[int, int], list[str]] = {}

    def word_at(g) -> str | None:
        key = (g.s, g.a)
        if key not in tokens:
            tokens[key] = lesson_ayah(T, g.s, g.a)[0].split(" ")
        toks = tokens[key]
        return toks[g.w - 1] if g.w <= len(toks) else None

    ranked = sorted(hits, key=lambda k: (-len(hits[k]), hits[k][0].s, hits[k][0].a, hits[k][0].w))
    table = []
    for rank, lem in enumerate(ranked, 1):
        gs = hits[lem]
        forms = Counter(w for w in map(word_at, gs) if w)
        roots = Counter(g.feat["ROOT"] for g in gs if g.feat.get("ROOT"))
        table.append(
            {
                "rank": rank,
                "lemma": lem,
                "ar": headword(lem),
                "translit": translit(lem, {g.tag for g in gs}),
                "count": len(gs),
                "ayat": len({(g.s, g.a) for g in gs}),
                "surahs": len({g.s for g in gs}),
                "root": root_letters(roots.most_common(1)[0][0]) if roots else [],
                "forms": [f for f, _ in forms.most_common(TOP_FORMS)],
                "_places": {f"{g.s}:{g.a}" for g in gs},
                "_tags": Counter(g.tag for g in gs),
            }
        )
    return table


def file_for_rank(rank: int) -> str:
    return f"words-{(rank - 1) // WORDS_PER_FILE + 1:03d}.json"


def file_for_sura(s: int) -> str:
    return f"ayat-{s:03d}.json"


def dump(content: dict) -> str:
    return json.dumps(content, ensure_ascii=False, indent=1) + "\n"


def entries_sha256(files: dict[str, dict]) -> str:
    """Hash of everything but the index's own versions, so a hand edit of a generated file shows."""
    h = hashlib.sha256()
    for name in sorted(files):
        if name != "index.json":
            h.update(name.encode() + dump(files[name]).encode())
    h.update(json.dumps(files["index.json"]["rows"], ensure_ascii=False, sort_keys=True).encode())
    return h.hexdigest()


def expected_versions(src: dict, files: dict[str, dict], authored_sha: str) -> dict[str, str]:
    I = src["inputs"]
    t, q, n = I["tanzil_uthmani"], I[QAC_KEY], I[AY.NAMES_KEY]
    tr = I[AY.QURAN_KEY]
    return {
        "tanzil": f"uthmani-{t['version']} sha256:{t['sha256']}",
        "qac": f"morphology-{q['version']} sha256:{q['sha256']}",
        "quranenc": f"indonesian_affairs {tr['version']} (last_update {tr['last_update_unix']})",
        "sura_names": f"QuranEnc Indonesian sura list, extracted text sha256:{n['text_sha256']}",
        "meanings": f"pipeline/authored/kosakata_meanings.json sha256:{authored_sha}",
        "voice": f"pipeline/kosakata_voice.json sha256:{sha256_bytes(V.PINS.read_bytes())}",
        "entries": f"sha256:{entries_sha256(files)}",
        "pipeline": PIPELINE_LINE,
    }


def example_of(word: dict, positions: dict[str, list[int]], corpus: AY.Corpus, tokens: dict) -> dict | None:
    """The ayah a learner sees the word in: the shortest cited ayah of its earliest sense that has one,
    with no footnote where possible. `hi` is where the word stands in it, from QAC. None for a word
    every citation of which falls in an ayah Tanzil and QAC count differently."""
    for sense in word["senses"]:
        usable = []
        for loc in sense["ayat"]:
            s, a = AY.parse_loc(loc)
            if (s, a) in tokens and positions.get(loc):
                row = corpus.rows[s][a]
                usable.append((bool(AY.split_footnotes(row.get("footnotes"))), len(lesson_ayah(corpus.T, s, a)[0]), AY.parse_loc(loc), loc))
        if usable:
            loc = min(usable)[3]
            return {"loc": loc, "hi": positions[loc]}
    return None


def build(authored: dict, authored_sha: str, corpus: AY.Corpus, segs: list, lexemes: dict[str, str]) -> dict[str, dict]:
    """All the files, by name. ValueError on any gap: a lemma without meanings, a citation that is
    not an ayah where the lemma occurs, a QuranEnc row whose footnotes do not match."""
    table = lemma_table(segs, corpus.T)
    lemmas = authored["lemmas"]
    pins = V.load_pins()["words"]
    unvoiced = [e["lemma"] for e in table if e["lemma"] not in pins]
    if unvoiced:
        raise ValueError(f"no recording pinned for {unvoiced[:5]} ({len(unvoiced)} in all): run build_kosakata_voice.py --fetch")
    missing = [e["lemma"] for e in table if e["lemma"] not in lemmas]
    extra = sorted(set(lemmas) - {e["lemma"] for e in table})
    if missing or extra:
        raise ValueError(f"authored meanings do not cover QAC: missing {missing[:5]}, extra {extra[:5]}")
    total = sum(e["count"] for e in table)
    running = 0
    rows, shards = [], defaultdict(list)
    cited: set[str] = set()
    tokens, word_count = V.counted_alike(corpus.T, segs)
    positions: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    for g in segs:
        lem = g.feat.get("LEM")
        if lem and g.w - 1 not in positions[lem][f"{g.s}:{g.a}"]:
            positions[lem][f"{g.s}:{g.a}"].append(g.w - 1)
    for e in table:
        a = lemmas[e["lemma"]]
        for sense in a["senses"]:
            for loc in sense["ayat"]:
                if loc not in e["_places"]:
                    raise ValueError(f"{e['lemma']}: cites {loc}, where QAC does not have it")
                cited.add(loc)
        running += e["count"]
        rows.append(
            {
                "rank": e["rank"],
                "ar": e["ar"],
                "translit": e["translit"],
                "count": e["count"],
                "id": "; ".join(s["id"] for s in a["senses"][:2]),
                "en": "; ".join(s["en"] for s in a["senses"][:2]),
                "cum": round(running * 10000 / total),
                "s": fold(" ".join([e["ar"], e["translit"]] + [s[k] for s in a["senses"] for k in ("id", "en")])),
                "v": V.row_voice(pins[e["lemma"]]),
                "k": P.kind_of(e["_tags"]),
            }
        )
        word = {k: v for k, v in e.items() if not k.startswith("_")}
        word["senses"] = a["senses"]
        word["review"] = a["review"]
        word["voice"] = V.word_voice(pins[e["lemma"]])
        word["kind"] = rows[-1]["k"]
        example = example_of(word, positions[e["lemma"]], corpus, tokens)
        if example:
            word["example"] = example
        if e["lemma"] in lexemes:
            word["lexeme"] = lexemes[e["lemma"]]
        shards[file_for_rank(e["rank"])].append(word)
    by_sura: dict[int, list] = defaultdict(list)
    for loc in sorted(cited, key=AY.parse_loc):
        s, a = AY.parse_loc(loc)
        row = corpus.rows.get(s, {}).get(a)
        if row is None:
            raise ValueError(f"{loc}: no QuranEnc row")
        footnotes = AY.split_footnotes(row.get("footnotes"))
        if AY.marker_problem(row["translation"], footnotes):
            raise ValueError(f"{loc}: QuranEnc {AY.marker_problem(row['translation'], footnotes)}")
        by_sura[s].append(
            {"loc": loc, "ar": lesson_ayah(corpus.T, s, a)[0], "translation": {"text": row["translation"], "footnotes": footnotes}}
        )
    names = AY.display_names(corpus.listing)
    meta = corpus.src["inputs"][AY.QURAN_KEY]
    index = {
        "status": "draft",
        "data_versions": {},
        "total_tokens": total,
        "translation": {"source_label": meta["title_id"], "version": meta["version"]},
        "names": {str(s): names[s] for s in range(1, 115)},
        "rows": rows,
    }
    files: dict[str, dict] = {"index.json": index}
    for name, words in shards.items():
        files[name] = {"words": words}
    parts = P.load_parts()
    files["path.json"] = P.path_file(
        [w for name in sorted(shards) for w in shards[name]],
        rows,
        parts,
        P.part_table(parts, segs, tokens, word_count, lemmas, V.load_pins()),
        P.attached_share(segs),
    )
    for s, entries in by_sura.items():
        files[file_for_sura(s)] = {"sura": s, "ayat": entries}
    index["data_versions"] = expected_versions(corpus.src, files, authored_sha)
    return files


def load_files(directory: Path = KOSAKATA_DIR) -> dict[str, dict]:
    return {p.name: json.loads(p.read_text(encoding="utf-8")) for p in sorted(directory.glob("*.json"))}


def write_files(files: dict[str, dict], directory: Path = KOSAKATA_DIR) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for p in directory.glob("*.json"):
        if p.name not in files:
            p.unlink()
    for name, content in files.items():
        (directory / name).write_text(dump(content), encoding="utf-8")


def load_corpus_and_qac() -> tuple[AY.Corpus, list]:
    corpus = AY.load_corpus()
    segs, _ = load_qac(require_pinned(corpus.src, QAC_KEY))
    return corpus, segs


def authored_problems(authored: dict) -> list[str]:
    """The meanings file alone: the shape and the rules every entry was written under."""
    out = []
    for lem, a in authored.get("lemmas", {}).items():
        if a.get("review") not in REVIEWS:
            out.append(f"{lem}: review is {a.get('review')!r}")
        senses = a.get("senses") or []
        if not 1 <= len(senses) <= MAX_SENSES:
            out.append(f"{lem}: {len(senses)} senses (1 to {MAX_SENSES})")
        for s in senses:
            for k in ("id", "en"):
                g = s.get(k, "")
                if not g.strip():
                    out.append(f"{lem}: empty {k} gloss")
                if _ARABIC.search(g):
                    out.append(f"{lem}: Arabic script in the {k} gloss: {g}")
                if _SCREAM.search(g):
                    out.append(f"{lem}: capitals for emphasis in the {k} gloss: {g}")
                if len(g.split()) > MAX_GLOSS_WORDS:
                    out.append(f"{lem}: {k} gloss longer than {MAX_GLOSS_WORDS} words: {g}")
            if not s.get("ayat"):
                out.append(f"{lem}: a sense with no ayah")
            for loc in s.get("ayat", []):
                if AY.parse_loc(loc) is None:
                    out.append(f"{lem}: {loc!r} is not a location")
    for lem, a in authored.get("lemmas", {}).items():
        for sense in a.get("senses") or []:
            if ";" in sense.get("id", "") or ";" in sense.get("en", ""):
                out.append(f"{lem}: {sense.get('id')!r} / {sense.get('en')!r} has a semicolon, which separates senses in the list")
    for lem, (gid, gen) in PINNED_SENSES.items():
        have = [(s.get("id"), s.get("en")) for s in authored.get("lemmas", {}).get(lem, {}).get("senses", [])]
        if (gid, gen) not in have:
            out.append(f"{lem}: the operator's sense {gid!r} / {gen!r} is gone")
    return out


def problems(files: dict[str, dict], authored: dict, authored_sha: str, src: dict) -> list[str]:
    """Everything that can be checked without pipeline/cache (CI runs this half)."""
    out = authored_problems(authored)
    index = files.get("index.json")
    if not index:
        return out + ["index.json is missing; run build_kosakata.py"]
    pins = V.load_pins()
    out += V.pin_problems(pins)
    rows = index["rows"]
    lemmas = authored["lemmas"]
    if index.get("status") != "draft":
        out.append(f"index status is {index.get('status')!r}: there is no review step (plan L11)")
    if len(rows) != len(lemmas):
        out.append(f"{len(rows)} rows for {len(lemmas)} authored lemmas")
    if [r["rank"] for r in rows] != list(range(1, len(rows) + 1)):
        out.append("ranks are not 1..N in order")
    if any(a["count"] < b["count"] for a, b in zip(rows, rows[1:])):
        out.append("rows are not most frequent first")
    if sum(r["count"] for r in rows) != index.get("total_tokens"):
        out.append("the counts do not add up to total_tokens")
    cum = [r["cum"] for r in rows]
    if cum != sorted(cum) or (cum and cum[-1] != 10000):
        out.append("the cumulative share does not climb to 100%")
    if len(index.get("names", {})) != 114:
        out.append("names does not hold 114 surahs")
    words = [w for n in sorted(files) if n.startswith("words-") for w in files[n]["words"]]
    if [w["rank"] for w in words] != [r["rank"] for r in rows]:
        out.append("the word files do not hold every rank in order")
    ayat = {e["loc"]: e for n, f in files.items() if n.startswith("ayat-") for e in f["ayat"]}
    cited: set[str] = set()
    for name in files:
        if name.startswith("words-") and len(files[name]["words"]) > WORDS_PER_FILE:
            out.append(f"{name} holds more than {WORDS_PER_FILE} words")
    for w, r in zip(words, rows):
        if file_for_rank(w["rank"]) not in files:
            out.append(f"rank {w['rank']}: {file_for_rank(w['rank'])} is missing")
        a = lemmas.get(w.get("lemma"))
        if a is None:
            out.append(f"rank {w['rank']}: lemma {w.get('lemma')!r} is not authored")
            continue
        if w["senses"] != a["senses"] or w.get("review") != a["review"]:
            out.append(f"rank {w['rank']}: the meanings differ from the authored file (hand edit?)")
        if (w["ar"], w["translit"], w["count"]) != (r["ar"], r["translit"], r["count"]):
            out.append(f"rank {w['rank']}: the word file and the index disagree")
        if r["id"] != "; ".join(s["id"] for s in w["senses"][:2]) or r["en"] != "; ".join(s["en"] for s in w["senses"][:2]):
            out.append(f"rank {w['rank']}: the index shows other meanings than the word file")
        if w["ar"] != headword(w["lemma"]) or w["translit"] != translit(w["lemma"], _tags_hint(w)):
            out.append(f"rank {w['rank']}: headword or transliteration was typed, not derived")
        if _VOWEL_CLASH.search(w["translit"]) or _TRIPLED.search(w["translit"]):
            out.append(f"rank {w['rank']}: {w['translit']!r} cannot be read (vowels side by side or a tripled letter)")
        if not w.get("forms"):
            out.append(f"rank {w['rank']}: no word forms")
        pin = pins["words"].get(w["lemma"])
        if pin is None:
            out.append(f"rank {w['rank']}: no recording pinned; run build_kosakata_voice.py --fetch")
        else:
            if w.get("voice") != V.word_voice(pin):
                out.append(f"rank {w['rank']}: the recording differs from pipeline/kosakata_voice.json")
            if r.get("v") != V.row_voice(pin):
                out.append(f"rank {w['rank']}: the index plays another recording than the word file")
        ex = w.get("example")
        if ex and (ex["loc"] not in {loc for s in w["senses"] for loc in s["ayat"]} or ex["loc"] not in ayat):
            out.append(f"rank {w['rank']}: its example {ex['loc']} is not an ayah it cites")
        elif ex and any(i >= len(ayat[ex["loc"]]["ar"].split(" ")) for i in ex["hi"]):
            out.append(f"rank {w['rank']}: its example marks a word {ex['loc']} does not have")
        if w.get("kind") not in {"verb", "noun", "particle", "name"} or r.get("k") != w.get("kind"):
            out.append(f"rank {w['rank']}: kind {w.get('kind')!r} / {r.get('k')!r}")
        for s in w["senses"]:
            cited.update(s["ayat"])
    out += P.path_problems(files.get("path.json"), words)
    for part in P.load_parts():
        have = (files.get("path.json") or {}).get("parts", {}).get(part["key"])
        for loc in (part["card"], part["test"]):
            pin = pins.get("parts", {}).get(loc)
            if pin is None:
                out.append(f"part {part['key']}: no recording pinned for {loc}")
            elif have and V.word_voice(pin) not in [e["voice"] for e in have.get("examples", [])]:
                out.append(f"part {part['key']}: its recording of {loc} differs from pipeline/kosakata_voice.json")
    for loc in sorted(cited - set(ayat)):
        out.append(f"{loc} is cited but has no entry in its ayat file")
    for loc in sorted(set(ayat) - cited):
        out.append(f"{loc} has an ayat entry that no word cites")
    for loc, e in ayat.items():
        p = AY.marker_problem(e["translation"]["text"], e["translation"]["footnotes"])
        if p:
            out.append(f"{loc}: QuranEnc {p}")
        if not _ARABIC.search(e["ar"]):
            out.append(f"{loc}: no Arabic text")
    want = expected_versions(src, files, authored_sha)
    if index.get("data_versions") != want:
        changed = [k for k in want if index.get("data_versions", {}).get(k) != want[k]]
        out.append(f"data_versions out of date ({', '.join(changed)}); run build_kosakata.py")
    return out


def _tags_hint(word: dict) -> set[str]:
    """The word file keeps no tags; a final-shaddah particle shows by its stored -a, so the check
    accepts what the rule gives with or without one."""
    return _FINAL_A_TAGS if word["translit"].endswith("a") and bare_lemma(word["lemma"]).endswith("~") else set()


def corpus_problems(files: dict[str, dict], authored: dict, authored_sha: str, corpus: AY.Corpus, segs: list, lexemes: dict[str, str]) -> list[str]:
    """The half that needs pipeline/cache: a fresh build must give these bytes exactly, which also
    proves every citation is an ayah where QAC has the lemma, and that Tanzil and QuranEnc are verbatim."""
    try:
        fresh = build(authored, authored_sha, corpus, segs, lexemes)
    except ValueError as e:
        return [str(e)]
    out = []
    for name in sorted(set(fresh) | set(files)):
        if name not in files:
            out.append(f"{name} is missing; run build_kosakata.py")
        elif name not in fresh:
            out.append(f"{name} should not exist; run build_kosakata.py")
        elif dump(fresh[name]) != dump(files[name]):
            out.append(f"{name} differs from a fresh build; run build_kosakata.py")
    return out


def authored_sha(path: Path = AUTHORED_FILE) -> str:
    return sha256_bytes(path.read_bytes())
