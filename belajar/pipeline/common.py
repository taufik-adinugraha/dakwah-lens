"""Shared helpers for the Belajar content pipeline (stdlib only).

Nothing here retypes Qur'anic text. Arabic strings reach the output only by
slicing the pinned Tanzil file; QAC data arrives in Buckwalter and is
converted with QAC's own published transliteration table.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent
BELAJAR = PIPELINE.parent
CACHE = PIPELINE / "cache"
SOURCES_JSON = PIPELINE / "sources.json"
CONTENT_DIR = BELAJAR / "content"
AUTHORED_DIR = PIPELINE / "authored"
SCHEMA_TS = BELAJAR / "src" / "content" / "schema.ts"
CONTENT_TS = BELAJAR / "src" / "lib" / "content.ts"
ROUTES_TS = BELAJAR / "src" / "lib" / "routes.ts"


# ---------------------------------------------------------------- surahs with a lesson
@dataclass(frozen=True)
class SurahSpec:
    slug: str
    surah: int
    name_id: str
    # Words per ayah as taught: Tanzil tokens (surah-heading basmalah removed) = QAC 0.4 words.
    # Checked against both by build_surah.py and validate.py; a change here is a deliberate edit.
    words: tuple[int, ...]

    @property
    def n_ayat(self) -> int:
        return len(self.words)


# Mushaf order. src/lib/content.ts loads the same slugs in the same order and src/lib/routes.ts
# lists them in SURAH_SLUGS (validate.py checks both).
SURAHS: tuple[SurahSpec, ...] = (
    SurahSpec("al-fatihah", 1, "Al-Fatihah", (4, 4, 2, 3, 4, 3, 9)),
    SurahSpec("al-ikhlas", 112, "Al-Ikhlas", (4, 2, 4, 5)),
    SurahSpec("al-falaq", 113, "Al-Falaq", (4, 4, 5, 5, 5)),
    SurahSpec("an-nas", 114, "An-Nas", (4, 2, 2, 4, 5, 3)),
)
SURAH_BY_SLUG = {s.slug: s for s in SURAHS}
SURAH_BY_NUM = {s.surah: s for s in SURAHS}


def authored_file(slug: str, kind: str) -> Path:
    """authored/<slug>.<kind>.json (kind: words, structure, concepts-map, facts.generated, hadith)."""
    return AUTHORED_DIR / f"{slug}.{kind}.json"


def authored_surahs() -> list[SurahSpec]:
    """Registered surahs whose hand-authored word file exists (mushaf order)."""
    return [s for s in SURAHS if authored_file(s.slug, "words").exists()]


# ---------------------------------------------------------------- sources.json
def load_sources() -> dict:
    return json.loads(SOURCES_JSON.read_text(encoding="utf-8"))


def save_sources(data: dict) -> None:
    SOURCES_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    return sha256_bytes(p.read_bytes())


QURANENC = "quranenc_indonesian_affairs"


def quranenc_sura(src: dict, surah: int) -> tuple[dict, Path]:
    """QuranEnc indonesian_affairs for one sura: (meta, verified cache path).

    Sura 1 is the input's own entry (pinned first, kept unchanged). Every other sura sits under
    the input's `suras` map with its own url, cache_path, sha256 and bytes; version, title and
    last_update come from the one translations list and are shared."""
    meta = src["inputs"][QURANENC]
    if surah == 1:
        return meta, require_pinned(src, QURANENC)
    sm = (meta.get("suras") or {}).get(str(surah))
    if not sm:
        raise SystemExit(f"[{QURANENC}] sura {surah} is not in sources.json `suras`; add it and run fetch.py")
    p = PIPELINE / sm["cache_path"]
    if not p.exists():
        raise SystemExit(f"[{QURANENC}] missing {p}; run fetch.py first")
    if not sm.get("sha256"):
        raise SystemExit(f"[{QURANENC}] sura {surah} sha256 not pinned; run fetch.py first")
    got = sha256_file(p)
    if got != sm["sha256"]:
        raise SystemExit(f"[{QURANENC}] sura {surah} sha256 mismatch: pinned {sm['sha256']} but cache has {got}")
    return {**{k: v for k, v in meta.items() if k != "suras"}, **sm}, p


def require_pinned(src: dict, key: str) -> Path:
    """Return the cached path for input `key`, failing if it is missing or its sha256 drifted."""
    meta = src["inputs"][key]
    p = PIPELINE / meta["cache_path"]
    if not p.exists():
        raise SystemExit(f"[{key}] missing {p}; run fetch.py first")
    if not meta.get("sha256"):
        raise SystemExit(f"[{key}] sha256 not pinned in sources.json; run fetch.py first")
    got = sha256_file(p)
    if got != meta["sha256"]:
        raise SystemExit(f"[{key}] sha256 mismatch: pinned {meta['sha256']} but cache has {got}")
    return p


# ---------------------------------------------------------------- Tanzil
@dataclass
class Tanzil:
    raw: str  # full decoded file, verbatim
    verses: dict[tuple[int, int], str]  # (surah, ayah) -> verse text exactly as in the file
    footer: str  # the copyright block, verbatim


def load_tanzil(path: Path) -> Tanzil:
    raw = path.read_bytes().decode("utf-8")
    verses: dict[tuple[int, int], str] = {}
    footer_lines: list[str] = []
    for line in raw.split("\n"):
        if not line.strip():
            continue
        if line.startswith("#"):
            footer_lines.append(line)
            continue
        s, a, t = line.split("|", 2)
        verses[(int(s), int(a))] = t
    return Tanzil(raw=raw, verses=verses, footer="\n".join(footer_lines))


def lesson_ayah(T: Tanzil, s: int, a: int) -> tuple[str, int]:
    """The ayah as taught, and how many leading tokens were removed.

    Tanzil prepends the basmalah to ayah 1 of every surah except 1 and 9 (it is the surah
    heading, not part of the ayah: QAC 0.4 and quran-align number the words without it). When
    the first four tokens of such a line equal the tokens of 1:1 under `normalise` (byte-equal
    in 110 surahs; 95 and 97 carry a shaddah on the ba'), the heading is cut off by slicing the
    line after its fourth space, so the result is a byte-exact suffix of the Tanzil line."""
    line = T.verses[(s, a)]
    if a != 1 or s in (1, 9):
        return line, 0
    bas = T.verses[(1, 1)].split(" ")
    toks = line.split(" ")
    if len(toks) > len(bas) and [normalise(t) for t in toks[:len(bas)]] == [normalise(t) for t in bas]:
        cut = len(" ".join(toks[:len(bas)])) + 1
        return line[cut:], len(bas)
    return line, 0


# ---------------------------------------------------------------- Arabic normalisation (for searching only)
# Stripped: tatweel, harakat and Qur'anic annotation marks. Unified: alif forms.
_STRIP = re.compile("[\u0640\u064B-\u065F\u06D6-\u06ED]")
_ALIF = str.maketrans({"\u0671": "\u0627", "\u0623": "\u0627", "\u0625": "\u0627", "\u0622": "\u0627", "\u0670": "\u0627"})


def normalise(s: str) -> str:
    """Search key only — never displayed. Superscript (dagger) alif U+0670 counts as an alif form,
    so Uthmani spellings such as the one of ṣirāṭ match their full-alif equivalents."""
    return _STRIP.sub("", s.translate(_ALIF))


NORMALISATION_RULE = (
    "kunci pencarian: tatweel (U+0640), harakat dan tanda baca Qur'ani (U+064B–U+065F, U+06D6–U+06ED) dibuang; "
    "bentuk alif (\u0671 \u0623 \u0625 \u0622 dan alif kecil U+0670) disamakan menjadi \u0627"
)


# ---------------------------------------------------------------- QAC 0.4
# QAC's extended Buckwalter table (corpus.quran.com/java/buckwalter.jsp).
BUCKWALTER = {
    "'": "\u0621", "|": "\u0622", ">": "\u0623", "&": "\u0624", "<": "\u0625", "}": "\u0626",
    "A": "\u0627", "b": "\u0628", "p": "\u0629", "t": "\u062A", "v": "\u062B", "j": "\u062C",
    "H": "\u062D", "x": "\u062E", "d": "\u062F", "*": "\u0630", "r": "\u0631", "z": "\u0632",
    "s": "\u0633", "$": "\u0634", "S": "\u0635", "D": "\u0636", "T": "\u0637", "Z": "\u0638",
    "E": "\u0639", "g": "\u063A", "_": "\u0640", "f": "\u0641", "q": "\u0642", "k": "\u0643",
    "l": "\u0644", "m": "\u0645", "n": "\u0646", "h": "\u0647", "w": "\u0648", "Y": "\u0649",
    "y": "\u064A", "F": "\u064B", "N": "\u064C", "K": "\u064D", "a": "\u064E", "u": "\u064F",
    "i": "\u0650", "~": "\u0651", "o": "\u0652", "^": "\u0653", "#": "\u0654", "`": "\u0670",
    "{": "\u0671", ":": "\u06DC", "@": "\u06DF", '"': "\u06E0", "[": "\u06E2", ";": "\u06E3",
    ",": "\u06E5", ".": "\u06E6", "!": "\u06E8", "-": "\u06EA", "+": "\u06EB", "%": "\u06EC",
    "]": "\u06ED",
}
# Roots on corpus.quran.com render the root letter 'A' as hamza-on-alif (e.g. "\u0623 \u0644 \u0647").
ROOT_LETTER_OVERRIDE = {"A": "\u0623"}


def bw_to_ar(s: str) -> str:
    out = []
    for ch in s:
        if ch not in BUCKWALTER:
            raise ValueError(f"unknown Buckwalter char {ch!r} in {s!r}")
        out.append(BUCKWALTER[ch])
    return "".join(out)


def root_letters(bw_root: str) -> list[str]:
    return [ROOT_LETTER_OVERRIDE.get(c, BUCKWALTER[c]) for c in bw_root]


@dataclass
class Segment:
    s: int
    a: int
    w: int
    seg: int
    form: str  # Buckwalter
    tag: str
    features: str
    feat: dict = field(default_factory=dict)  # key:value features
    flags: list = field(default_factory=list)  # bare features (STEM, PREFIX, GEN, ...)


def load_qac(path: Path) -> tuple[list[Segment], str]:
    segs: list[Segment] = []
    header_lines = []
    for line in path.read_text(encoding="utf-8").split("\n"):
        if line.startswith("#"):
            header_lines.append(line)
            continue
        if not line.startswith("("):
            continue
        loc, form, tag, features = line.rstrip("\r").split("\t")
        s, a, w, g = (int(x) for x in loc.strip("()").split(":"))
        feat, flags = {}, []
        for part in features.split("|"):
            if ":" in part:
                k, v = part.split(":", 1)
                feat[k] = v
            else:
                flags.append(part)
        segs.append(Segment(s, a, w, g, form, tag, features, feat, flags))
    return segs, "\n".join(header_lines)


def qac_words(segs: list[Segment]) -> dict[tuple[int, int, int], list[Segment]]:
    words: dict[tuple[int, int, int], list[Segment]] = {}
    for g in segs:
        words.setdefault((g.s, g.a, g.w), []).append(g)
    return words


def stem_of(word_segs: list[Segment]) -> Segment:
    stems = [g for g in word_segs if "STEM" in g.flags]
    if len(stems) != 1:
        raise ValueError(f"expected one STEM segment, got {len(stems)}: {[g.features for g in word_segs]}")
    return stems[0]


# ---------------------------------------------------------------- misc
def ayah_ref(s: int, a: int) -> str:
    return f"{s}:{a}"


def sorted_refs(refs) -> list[str]:
    pairs = sorted({tuple(int(x) for x in r.split(":")) for r in refs})
    return [f"{s}:{a}" for s, a in pairs]


ARABIC_RUN = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+(?:\s+[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+)*")


# ---------------------------------------------------------------- MP3 duration (frame walk; validation only)
_BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
_BR_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
_SR = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def mp3_duration_ms(b: bytes) -> dict:
    """Walk MPEG audio Layer III frames and sum their samples. A leading Xing/Info
    (VBR/LAME header) frame carries no audio and is not counted. Accuracy is about one
    frame (~26 ms); encoder delay/padding is not subtracted."""
    i = 0
    if b[:3] == b"ID3":
        size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]
        i = 10 + size + (10 if b[5] & 0x10 else 0)
    samples = frames = skipped = 0
    sr_seen = None
    first = True
    while i + 4 <= len(b):
        h = int.from_bytes(b[i:i + 4], "big")
        ver, layer = (h >> 19) & 3, (h >> 17) & 3
        br_idx, sr_idx, pad = (h >> 12) & 0xF, (h >> 10) & 3, (h >> 9) & 1
        if (h >> 21) & 0x7FF != 0x7FF or ver == 1 or layer != 1 or br_idx in (0, 15) or sr_idx == 3:
            i += 1
            skipped += 1
            continue
        sr = _SR[ver][sr_idx]
        if ver == 3:
            br, spf, flen = _BR_V1_L3[br_idx], 1152, 144 * _BR_V1_L3[br_idx] * 1000 // sr + pad
        else:
            br, spf, flen = _BR_V2_L3[br_idx], 576, 72 * _BR_V2_L3[br_idx] * 1000 // sr + pad
        frame = b[i:i + flen]
        if first and (b"Xing" in frame[:64] or b"Info" in frame[:64]):
            first = False
            i += flen
            continue
        first = False
        sr_seen = sr
        samples += spf
        frames += 1
        i += flen
    if not sr_seen:
        raise ValueError("no MPEG Layer III frames found")
    return {"duration_ms": round(samples * 1000 / sr_seen), "frames": frames, "sample_rate": sr_seen,
            "unsynced_bytes": skipped}
