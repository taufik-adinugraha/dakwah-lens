"""The ayat the "Tahukah Anda?" fact cards locate, for the ayah popup (content/ayat/locations.json).

Operator 2026-10-12: a location chip on a fact card ("QS 2:255") opened quran.com in a new tab or
app; it now opens a popup with the ayah itself (Arabic, translation, the imam's recitation). This
module builds and checks what that popup shows; src/app/api/ayah/route.ts serves it one ayah at a
time (the whole file never reaches the browser).

- WHICH AYAT: every `Fact.locations` entry of every lesson file (content/<slug>.json for each
  surah in common.SURAHS, the ones BELAJAR_SURAHS hides included, so showing one stays an env
  change), each once, in mushaf order. Nothing else ("no extra entries").
- ARABIC: the Tanzil Uthmani 1.1 line, verbatim, with the surah-heading basmalah sliced off as the
  lessons do (common.lesson_ayah: a byte-exact suffix of the line). The facts are counted without
  the heading, and the EveryAyah ayah-1 recordings carry none.
- TRANSLATION: QuranEnc indonesian_affairs, verbatim: `text` is the row's `translation`, footnote
  markers ("[96]") kept; `footnotes` its `footnotes` field, split per marker by the lessons' own
  build_surah.split_footnotes. So the popup shows an ayah exactly as a lesson shows it (checked
  against the lesson files for the ayat that have one). Credit: QuranEnc's own title + version.
- SURAH NAMES, for the popup's reference ("QS Al-Baqarah [2]: 255"): QuranEnc's Indonesian sura
  list (pinned as extracted text), folded to plain letters (diacritics dropped, ` → '), except
  where the module already writes the name: a lesson's name_id, and the spellings in WRITTEN that
  the fact cards print, so a card and its popup never spell a surah two ways.
- PROVENANCE: every input pinned in sources.json and recorded in the file (data_versions,
  sura_files); `data_versions.entries` hashes the entries, so a hand edit shows without the corpus.

Standard library only, no network (fetch.py downloads), no LLM.
"""
from __future__ import annotations

import hashlib
import html as htmllib
import json
import re
import unicodedata
from dataclasses import dataclass

from build_surah import split_footnotes
from common import CONTENT_DIR, PIPELINE, SURAHS, Tanzil, lesson_ayah, load_sources, load_tanzil, require_pinned, sha256_bytes

AYAT_DIR = CONTENT_DIR / "ayat"
AYAT_FILE = AYAT_DIR / "locations.json"
SURA1_KEY = "quranenc_indonesian_affairs"
QURAN_KEY = "quranenc_indonesian_affairs_quran"
NAMES_KEY = "quranenc_sura_names"
PIPELINE_LINE = "belajar/pipeline/build_ayat.py (stdlib only, no LLM)"

TOP_KEYS = ["data_versions", "translation", "sura_files", "names", "ayat"]
ENTRY_KEYS = ["loc", "ar", "translation"]
TR_KEYS = ["text", "footnotes"]
VERSION_KEYS = ["tanzil", "quranenc", "sura_names", "facts", "entries", "pipeline"]

LOC = re.compile(r"^(\d{1,3}):(\d{1,3})$")
MARKER = re.compile(r"\[\d+\]")
_AR = "؀-ۿݐ-ݿࢠ-ࣿ"
# Arabic script only, words separated by single spaces (Tanzil's lines are exactly that).
AR_ONLY = re.compile(f"[{_AR}]+(?: [{_AR}]+)*")
AR_ANY = re.compile(f"[{_AR}]")
# A popup name: plain Latin letters, hyphen, apostrophe, space (what fold_name leaves).
NAME_TEXT = re.compile(r"[A-Z][A-Za-z' -]*[A-Za-z']")
# A place a fact's prose names with its number, "Al-Jinn (72:1)", "Surah Al-Infithar (82:19)".
MENTION = re.compile(r"\((\d{1,3}):\d{1,3}")

# Spellings the module's fact cards already print for a surah whose QuranEnc name folds otherwise
# (QuranEnc "Fāṭir" → "Fatir"; facts.py writes "Fathir"). Kept so a card and its popup never spell
# one surah two ways; each must fold-match QuranEnc's name (loose_key), and validate_ayat.py checks
# every "<name> (<surah>:<ayah>)" the facts write against the table.
WRITTEN = {35: "Fathir", 82: "Al-Infithar"}


class AyatError(Exception):
    pass


def sura_file_name(s: int) -> str:
    return f"indonesian_affairs_sura{s}.json"


def parse_loc(loc) -> tuple[int, int] | None:
    m = LOC.match(loc) if isinstance(loc, str) else None
    if not m:
        return None
    s, a = int(m.group(1)), int(m.group(2))
    return (s, a) if 1 <= s <= 114 and a >= 1 else None


# ---------------------------------------------------------------- what the facts locate
def load_lessons() -> dict[str, dict]:
    """slug -> content/<slug>.json, for every registered surah that has a lesson file."""
    out = {}
    for sp in SURAHS:
        p = CONTENT_DIR / f"{sp.slug}.json"
        if p.exists():
            out[sp.slug] = json.loads(p.read_text(encoding="utf-8"))
    return out


def fact_locations(lessons: dict[str, dict]) -> dict[str, list[str]]:
    """loc -> the facts that locate it ("content/al-fatihah.json fact rabb"), in mushaf order. A
    malformed location stops here (schema.ts AyahLoc would refuse it at build time anyway)."""
    by: dict[str, list[str]] = {}
    for slug, lesson in lessons.items():
        for f in lesson.get("facts", []):
            for loc in f.get("locations", []):
                if parse_loc(loc) is None:
                    raise AyatError(f"content/{slug}.json fact {f.get('id')}: location {loc!r} is not surah:ayah")
                by.setdefault(loc, []).append(f"content/{slug}.json fact {f.get('id')}")
    return {loc: by[loc] for loc in sorted(by, key=parse_loc)}


# ---------------------------------------------------------------- surah names
_NAME_ROW = re.compile(
    r'<span class="surah_number">(\d+)</span>.*?<span class="hidden">\d+ ([^<]+)</span>.*?'
    r'<span class="fs14 text_secondary">(\d+) Ayat</span>.*?<h2 class="fs20 fw-bolder">([^<]+)</h2>',
    re.S,
)


def extract_sura_names(page: str) -> str:
    """QuranEnc's Indonesian browse page -> the pinned text: one "number|ayat|arabic|name" line per
    sura, in the page's order (the HTML itself carries per-request tokens, so it is not pinned)."""
    rows = _NAME_ROW.findall(page)
    if len(rows) != 114:
        raise AyatError(f"QuranEnc sura list: {len(rows)} suras found on the page, expected 114 (markup changed?)")
    lines = []
    for n, ar, ayat, name in rows:
        ar, name = htmllib.unescape(ar).strip(), htmllib.unescape(name).strip()
        if "|" in ar + name or not ar or not name:
            raise AyatError(f"QuranEnc sura list: unexpected row {n}: {ar!r} {name!r}")
        lines.append(f"{int(n)}|{int(ayat)}|{ar}|{name}\n")
    return "".join(lines)


def parse_sura_names(text: str) -> dict[int, dict]:
    """The pinned text -> {number: {"ayat", "ar", "name"}}; 114 rows numbered 1..114 or AyatError."""
    out: dict[int, dict] = {}
    for line in text.splitlines():
        n, ayat, ar, name = line.split("|")
        out[int(n)] = {"ayat": int(ayat), "ar": ar, "name": name}
    if list(out) != list(range(1, 115)):
        raise AyatError("QuranEnc sura list: the rows are not suras 1..114 in order")
    return out


def fold_name(s: str) -> str:
    """QuranEnc's transliterated name in plain letters: every diacritic dropped (Fāṭir → Fatir,
    Aż-Żāriyāt → Az-Zariyat, Āli 'Imrān → Ali 'Imran), its backtick hamzah written ' (An-Nisā` →
    An-Nisa'), as the module writes surah names (Al-Fatihah, An-Nas)."""
    bare = "".join(ch for ch in unicodedata.normalize("NFD", s) if not unicodedata.combining(ch))
    return unicodedata.normalize("NFC", bare.replace("`", "'"))


def loose_key(s: str) -> str:
    """For matching two spellings of one name (Fathir / Fātir, Al-Infithar / Al-Infiṭār): letters
    only, lower case, the pesantren digraphs (th dh sh zh ts dz) as one letter."""
    t = re.sub(r"[^a-z]", "", fold_name(s).lower())
    return re.sub(r"(t|d|s|z)h|t(s)|d(z)", lambda m: m.group(1) or m.group(2) or m.group(3), t)


def display_names(listing: dict[int, dict]) -> dict[int, str]:
    """Surah number -> the name the popup prints: QuranEnc's, folded; a lesson's name_id; WRITTEN."""
    out = {n: fold_name(r["name"]) for n, r in listing.items()}
    for n, written in [*WRITTEN.items(), *((sp.surah, sp.name_id) for sp in SURAHS)]:
        if loose_key(written) != loose_key(out[n]):
            raise AyatError(f"surah {n}: {written!r} is not a spelling of QuranEnc's {listing[n]['name']!r}")
        out[n] = written
    return out


# ---------------------------------------------------------------- the corpus (pipeline/cache)
@dataclass
class Corpus:
    src: dict
    T: Tanzil
    rows: dict[int, dict[int, dict]]  # sura -> ayah -> QuranEnc row
    listing: dict[int, dict]  # the pinned QuranEnc sura list


def load_corpus(suras: set[int] | None = None) -> Corpus:
    """Tanzil, the QuranEnc sura files (`suras`, default all pinned) and the sura list, each verified
    against its sources.json pin. Exits with what to run when a file is missing or drifted."""
    src = load_sources()
    I = src["inputs"]
    T = load_tanzil(require_pinned(src, "tanzil_uthmani"))
    meta = I[QURAN_KEY]
    rows: dict[int, dict[int, dict]] = {}
    for name, f in meta.get("files", {}).items():
        s = int(re.fullmatch(r"indonesian_affairs_sura(\d+)\.json", name).group(1))
        if suras is not None and s not in suras:
            continue
        p = PIPELINE / meta["cache_dir"] / name
        if not p.exists():
            raise SystemExit(f"[{QURAN_KEY}] missing {p}; run fetch.py --only {QURAN_KEY}")
        b = p.read_bytes()
        if not f.get("sha256") or sha256_bytes(b) != f["sha256"]:
            raise SystemExit(f"[{QURAN_KEY}] {name}: sha256 {sha256_bytes(b)} does not match its pin {f.get('sha256')}")
        rows[s] = {int(r["aya"]): r for r in json.loads(b)["result"]}
    nm = I[NAMES_KEY]
    p = PIPELINE / nm["cache_path"]
    if not p.exists():
        raise SystemExit(f"[{NAMES_KEY}] missing {p}; run fetch.py --only {NAMES_KEY}")
    b = p.read_bytes()
    if not nm.get("text_sha256") or sha256_bytes(b) != nm["text_sha256"]:
        raise SystemExit(f"[{NAMES_KEY}] sha256 {sha256_bytes(b)} does not match its pin {nm.get('text_sha256')}")
    return Corpus(src=src, T=T, rows=rows, listing=parse_sura_names(b.decode("utf-8")))


# ---------------------------------------------------------------- the file
def entries_sha256(content: dict) -> str:
    """Hash of what the popup shows (names + entries), canonical JSON."""
    body = {"names": content.get("names"), "ayat": content.get("ayat")}
    return hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def expected_versions(src: dict, content: dict) -> dict[str, str]:
    """data_versions as build_ayat.py writes them, from sources.json and the entries."""
    I = src["inputs"]
    t, q, s1, n = I["tanzil_uthmani"], I[QURAN_KEY], I[SURA1_KEY], I[NAMES_KEY]
    return {
        "tanzil": f"uthmani-{t['version']} sha256:{t['sha256']}",
        "quranenc": (f"indonesian_affairs {q['version']} (last_update {q['last_update_unix']}); translations list "
                     f"sha256:{s1['version_sha256']}; one file per sura, its sha256 in sura_files"),
        "sura_names": f"QuranEnc Indonesian sura list ({n['url']}), extracted text sha256:{n['text_sha256']}",
        # Not the files by name: the Kredit page shows these, and names no surah BELAJAR_SURAHS hides.
        "facts": "every Fact.locations of every lesson file (common.SURAHS), each ayah once, in mushaf order",
        "entries": f"sha256:{entries_sha256(content)}",
        "pipeline": PIPELINE_LINE,
    }


def build(lessons: dict[str, dict], corpus: Corpus) -> dict:
    """content/ayat/locations.json from the lessons' facts and the corpus. AyatError on any gap."""
    cited = fact_locations(lessons)
    I = corpus.src["inputs"]
    meta = I[QURAN_KEY]
    entries = []
    for loc, by in cited.items():
        s, a = parse_loc(loc)
        if (s, a) not in corpus.T.verses:
            raise AyatError(f"{loc} is not an ayah in Tanzil ({by[0]})")
        ar, _cut = lesson_ayah(corpus.T, s, a)
        row = corpus.rows.get(s, {}).get(a)
        if row is None:
            raise AyatError(f"{loc}: no QuranEnc row (is {sura_file_name(s)} pinned and fetched?)")
        text = row["translation"]
        footnotes = split_footnotes(row.get("footnotes"))
        if marker_problem(text, footnotes):
            raise AyatError(f"{loc}: QuranEnc {marker_problem(text, footnotes)}")
        entries.append({"loc": loc, "ar": ar, "translation": {"text": text, "footnotes": footnotes}})
    used = sorted({parse_loc(e["loc"])[0] for e in entries})
    names = display_names(corpus.listing)
    content = {
        "data_versions": {},
        "translation": {"source_label": meta["title_id"], "version": meta["version"]},
        "sura_files": {str(s): meta["files"][sura_file_name(s)]["sha256"] for s in used},
        "names": {str(s): names[s] for s in used},
        "ayat": entries,
    }
    content["data_versions"] = expected_versions(corpus.src, content)
    return content


def dump(content: dict) -> str:
    return json.dumps(content, ensure_ascii=False, indent=2) + "\n"


def load_content() -> dict | None:
    return json.loads(AYAT_FILE.read_text(encoding="utf-8")) if AYAT_FILE.exists() else None


# ---------------------------------------------------------------- checks
def marker_problem(text: str, footnotes: list) -> str | None:
    """The lessons' rule (build_surah, validate.py check 8): the [n] markers in the text, in order,
    are the footnotes' own markers, and every footnote starts with its marker."""
    if not all(isinstance(f, str) and MARKER.match(f) for f in footnotes):
        return "a footnote does not start with its [n] marker"
    got, want = MARKER.findall(text), [MARKER.match(f).group(0) for f in footnotes]
    return None if got == want else f"footnote markers in the text {got} != the footnotes' markers {want}"


def differ(have: list[str], want: list[str]) -> str:
    """How a list of sura numbers differs from the one the entries need."""
    extra, missing = [s for s in have if s not in want], [s for s in want if s not in have]
    if extra or missing:
        return f"suras without an entry {extra[:10]}, suras with entries but none here {missing[:10]}"
    return "not in sura order"


def currency_problems(content: dict, lessons: dict[str, dict], src: dict) -> list[str]:
    """Is the file current, from committed files alone (CI: no corpus)? Its entries are exactly the
    facts' locations, its pins and versions are sources.json's, and its entries are the ones the
    build wrote (the entries hash)."""
    errs: list[str] = []
    cited = fact_locations(lessons)
    have = [e.get("loc") for e in content.get("ayat") or [] if isinstance(e, dict)]
    have_set = set(have)
    missing = [loc for loc in cited if loc not in have_set]
    for loc in missing[:20]:
        by = cited[loc]
        errs.append(f"ayat: no entry for {loc}, which {by[0]}{f' (and {len(by) - 1} more)' if len(by) > 1 else ''} "
                    f"locates (run build_ayat.py)")
    if len(missing) > 20:
        errs.append(f"ayat: … {len(missing) - 20} more locations without an entry")
    for loc in [x for x in have if x not in cited][:20]:
        errs.append(f"ayat {loc}: no fact locates it, an extra entry (run build_ayat.py)")
    used = sorted({p[0] for p in map(parse_loc, have) if p})
    files = src["inputs"][QURAN_KEY].get("files", {})
    sf = content.get("sura_files") or {}
    if list(sf) != [str(s) for s in used]:
        errs.append(f"sura_files: {differ(list(sf), [str(s) for s in used])}")
    for s, sha in sf.items():
        pin = files.get(sura_file_name(int(s)) if s.isdigit() else "", {}).get("sha256")
        if sha != pin:
            errs.append(f"sura_files {s}: {sha} is not the sources.json pin of {sura_file_name(int(s)) if s.isdigit() else s} ({pin})")
    dv = content.get("data_versions") or {}
    want = expected_versions(src, content)
    if list(dv) != VERSION_KEYS:
        errs.append(f"data_versions: keys {list(dv)} != {VERSION_KEYS}")
    for k, v in want.items():
        if dv.get(k) != v:
            what = ("the entries are not the ones build_ayat.py wrote (hand-edited? rebuild, do not edit)"
                    if k == "entries" else f"{dv.get(k)!r} != {v!r} (sources.json)")
            errs.append(f"data_versions.{k}: {what}")
    return errs


def problems(content, lessons: dict[str, dict], src: dict, corpus: Corpus | None = None) -> list[str]:
    """Every check of content/ayat/locations.json. Without `corpus` (CI) only what the committed
    files prove; with it, also Tanzil's and QuranEnc's bytes and equality with a fresh build."""
    if not isinstance(content, dict):
        return ["ayat: the file is not a JSON object"]
    errs: list[str] = []
    if list(content) != TOP_KEYS:
        errs.append(f"ayat: top-level keys {list(content)} != {TOP_KEYS}")
    entries: dict[str, dict] = {}
    prev = None
    for i, e in enumerate(content.get("ayat") or []):
        if not isinstance(e, dict) or list(e) != ENTRY_KEYS:
            errs.append(f"ayat[{i}]: keys {list(e) if isinstance(e, dict) else type(e).__name__} != {ENTRY_KEYS}")
            continue
        loc, p = e["loc"], parse_loc(e["loc"])
        if p is None:
            errs.append(f"ayat[{i}]: loc {loc!r} is not surah:ayah")
            continue
        if loc in entries:
            errs.append(f"ayat {loc}: listed twice")
        elif prev and p <= parse_loc(prev):
            errs.append(f"ayat {loc}: not in mushaf order (after {prev})")
        entries.setdefault(loc, e)
        prev = loc
        if not isinstance(e["ar"], str) or not AR_ONLY.fullmatch(e["ar"]):
            errs.append(f"ayat {loc}: the Arabic is not Arabic script in single-spaced words (Tanzil's form)")
        tr = e["translation"]
        if not isinstance(tr, dict) or list(tr) != TR_KEYS:
            errs.append(f"ayat {loc}: translation keys {list(tr) if isinstance(tr, dict) else tr!r} != {TR_KEYS}")
            continue
        if not isinstance(tr["text"], str) or not tr["text"].strip():
            errs.append(f"ayat {loc}: empty translation")
            continue
        if not isinstance(tr["footnotes"], list):
            errs.append(f"ayat {loc}: footnotes is not a list")
            continue
        mp = marker_problem(tr["text"], tr["footnotes"])
        if mp:
            errs.append(f"ayat {loc}: {mp}")
    errs += currency_problems(content, lessons, src)

    # The translation and its credit: QuranEnc's own title and version, as on the lessons.
    q = src["inputs"][QURAN_KEY]
    tr = content.get("translation")
    if tr != {"source_label": q["title_id"], "version": q["version"]}:
        errs.append(f"translation: {tr!r} is not QuranEnc's title and version in sources.json")
    if "2019" in str((tr or {}).get("source_label", "")):
        errs.append("translation: the label must be QuranEnc's own, never 'Kemenag 2019'")

    # A lesson ayah looks the same in the popup as in its lesson (byte for byte: the lesson files are
    # themselves checked against the corpus by validate.py).
    for slug, lesson in lessons.items():
        for a in lesson.get("ayat", []):
            e = entries.get(a["loc"])
            if not e or not isinstance(e.get("translation"), dict):
                continue
            ltr = a["translation"]
            if e["ar"] != a["ar"]:
                errs.append(f"ayat {a['loc']}: the Arabic differs from content/{slug}.json (the lesson shows it otherwise)")
            if e["translation"].get("text") != ltr["text"] or e["translation"].get("footnotes") != ltr.get("footnotes", []):
                errs.append(f"ayat {a['loc']}: the translation differs from content/{slug}.json (the lesson shows it otherwise)")
            if tr != {"source_label": ltr["source_label"], "version": ltr.get("version")}:
                errs.append(f"translation: {tr!r} differs from the credit content/{slug}.json gives {a['loc']}")

    # Names: one per surah with an entry; a lesson's name_id; what the fact cards write.
    names = content.get("names") or {}
    used = sorted({parse_loc(loc)[0] for loc in entries})
    if list(names) != [str(s) for s in used]:
        errs.append(f"names: {differ(list(names), [str(s) for s in used])}")
    for s, name in names.items():
        if not isinstance(name, str) or not NAME_TEXT.fullmatch(name):
            errs.append(f"names {s}: {name!r} is not a plain-letter name")
    for sp in SURAHS:
        if str(sp.surah) in names and names[str(sp.surah)] != sp.name_id:
            errs.append(f"names {sp.surah}: {names[str(sp.surah)]!r} != the lesson's name_id {sp.name_id!r}")
    for slug, lesson in lessons.items():
        for f in lesson.get("facts", []):
            for field in ("title", "body", "method"):
                text = f.get(field) or ""
                for m in MENTION.finditer(text):
                    name = names.get(m.group(1))
                    if not isinstance(name, str):
                        continue
                    # The word or two before "(s:a": "Al-Jinn", "Ali 'Imran" (not "(1:2), Al-An'am").
                    words = [w.strip(",.;:!?()«»“”\"") for w in text[max(0, m.start() - 60):m.start()].split()]
                    words = words[-2:] if all(re.match(r"[A-Za-z']", w) for w in words[-2:]) else words[-1:]
                    for cand in (words[-1] if words else "", " ".join(words)):
                        if cand and re.match(r"[A-Za-z']", cand) and loose_key(cand) == loose_key(name):
                            if cand != name:
                                errs.append(f"names {m.group(1)}: the popup says {name!r}, but content/{slug}.json fact "
                                            f"{f.get('id')} writes {cand!r}")
                            break

    if corpus is not None:
        errs += corpus_problems(content, entries, lessons, corpus)
    return errs


def corpus_problems(content: dict, entries: dict[str, dict], lessons: dict[str, dict], corpus: Corpus) -> list[str]:
    errs: list[str] = []
    for loc, e in entries.items():
        s, a = parse_loc(loc)
        line = corpus.T.verses.get((s, a))
        if line is None:
            errs.append(f"ayat {loc}: not an ayah in Tanzil")
            continue
        want, _cut = lesson_ayah(corpus.T, s, a)
        if e["ar"] != want or not line.endswith(e["ar"]):
            errs.append(f"ayat {loc}: the Arabic is not Tanzil's bytes (the line, its surah-heading basmalah sliced off "
                        f"as common.lesson_ayah does)")
        row = corpus.rows.get(s, {}).get(a)
        tr = e.get("translation") if isinstance(e.get("translation"), dict) else {}
        if row is None:
            errs.append(f"ayat {loc}: no QuranEnc row in the pinned {sura_file_name(s)}")
            continue
        if tr.get("text") != row["translation"]:
            errs.append(f"ayat {loc}: translation.text is not byte-identical to QuranEnc's (sura {s})")
        # Verbatim footnotes, as validate.py checks a lesson's: in order, nothing skipped, nothing left.
        raw, pos = row.get("footnotes") or "", 0
        for i, fn in enumerate(tr.get("footnotes") or []):
            j = raw.find(fn, pos) if isinstance(fn, str) else -1
            if j < 0 or raw[pos:j].strip():
                errs.append(f"ayat {loc}: footnote {i} is not QuranEnc's next footnote, verbatim")
                break
            pos = j + len(fn)
        else:
            if raw[pos:].strip():
                errs.append(f"ayat {loc}: QuranEnc footnote text not shipped: {raw[pos:][:40]!r}")
        if tr.get("footnotes") != split_footnotes(row.get("footnotes")):
            errs.append(f"ayat {loc}: footnotes are not QuranEnc's split as the lessons split them (split_footnotes)")
    # The sura list: 114 suras whose ayah counts are Tanzil's; the names the popup prints.
    counts: dict[int, int] = {}
    for (s, _a) in corpus.T.verses:
        counts[s] = counts.get(s, 0) + 1
    for n, r in corpus.listing.items():
        if r["ayat"] != counts.get(n):
            errs.append(f"QuranEnc sura list: sura {n} has {r['ayat']} ayat there, {counts.get(n)} in Tanzil")
    try:
        shown = display_names(corpus.listing)
        for s, name in (content.get("names") or {}).items():
            if s.isdigit() and shown.get(int(s)) != name:
                errs.append(f"names {s}: {name!r} != {shown.get(int(s))!r} (QuranEnc's name, folded; WRITTEN; name_id)")
    except AyatError as err:
        errs.append(f"names: {err}")
    try:
        if dump(build(lessons, corpus)) != dump(content):
            errs.append("ayat: differs from a fresh build_ayat.py run (rebuild, do not hand-edit)")
    except AyatError as err:
        errs.append(f"ayat: the build fails: {err}")
    return errs
