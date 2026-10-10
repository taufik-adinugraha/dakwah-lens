"""Grammar terms in Arabic script, and the inline markup of the Konsep library (stdlib only).

Operator, 2026-10-10 (on /belajar/id/konsep): "you should also mention the arabic word like
majrur in arabic letter etc, not only the transliteration". A grammar term is shown as
"majrur (مَجْرُور)", a Qur'anic word as "bismi (بِسْمِ)", a letter as in the ayah, "ba’ (بِ)".

The Arabic of a GRAMMAR TERM is never typed per page: it comes from ONE term table,
authored/library.terms.json, where each spelling is checked against a pinned source the module
already cites, and the source is recorded with it:

  {"pron": "<term>"}               the operator-approved pronunciation dictionary
                                   (authored/pronunciation.json, approved by ear 2026-10-10):
                                   the spelling must be byte-equal to that entry's term;
  {"page": "<book>/<id>", "text": "<excerpt>"}
                                   a verbatim excerpt (≤ 12 words) of a Shamela page of a cited
                                   kitab, pinned by the sha256 of its extracted text
                                   (sources.json `shamela_istilah`, fetched by fetch.py).
                                   The folded term must occur in the excerpt as a run of whole
                                   tokens (a clitic و ف ب ك ل or the article may stand before a
                                   token), and no vowel the excerpt writes on a matched letter may
                                   differ from the term's, except on a token's last letter (the
                                   case ending); a shaddah the excerpt writes must be in the term.
                                   With the cache, the excerpt must also be a substring of the
                                   pinned page text, in the matn (not the editor's footnotes)
                                   unless the attestation says "part": "hamesh".

A term no source verifies has "ar": null and an "unverified" reason; it is shown in Latin only
and listed by validate_terms.py. A term spelled in pronunciation.json (same Latin head) must be
byte-equal to it, so the narration captions and the Konsep pages never disagree.

INLINE MARKUP in the authored Konsep prose (title, summary, explanation, bridge, example notes;
the harakat page and the word-parts diagrams too):

  [[majrur]]                 a term, found by its surface form (the `forms` of one term)
  [[bertanwin|tanwin]]       a surface that is not one of the term's forms, or an ambiguous one
  [[bismi|q:1:1:1]]          a Qur'anic word: the Tanzil token at that loc (any surah)
  [[bi-|q:1:1:1/1]]          the k-th QAC 0.4 segment of that word (a part of it)
  [[ya’|q:1:2:4#7]]          the n-th letter of that word, with its marks (rule 7: the letter
                             as in the ayah, never its spelled-out name)

build_library.py strips the markup into today's plain fields (narration, metadata titles and the
older prose checks read those, byte-identical) and ships the marked text beside them; the bytes
of every q-ref go to library.json `quran`, resolved here from the pinned Tanzil file and QAC.
A term form left UNMARKED in prose fails the build (`unmarked`), except the forms marked
`ambiguous` in the table (huruf, hal, sifat, bab, jumlah, syarat: ordinary Indonesian words
too), which an author marks only where they are the term.

A letter is a base letter with the marks that follow it (بِ | سْ | مِ); a mark of the mushaf's
annotation set (U+06D6–U+06ED) or the dagger alif stays with the letter it follows.

Review 2026-10-10 added: an explicit term ref's surface must name that term (names_term); every
word, run and segment q-ref's Latin must name its bytes (surface_matches, by consonant skeleton);
a Qur'anic word's meaning is "yang artinya “…”", never a bare quote or "berarti"
(meaning_problems); a mark of a term's spelling counts as confirmed only where a source writes it
(check_table reports the rest); the Harakat page's signs and reminders are checked against their
marks (sign_problems, hint_problems); a parts diagram may change several letters and drop al-.
"""
from __future__ import annotations

import html
import json
import re
import unicodedata
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent
TERMS_JSON = PIPELINE / "authored" / "library.terms.json"
PRONUNCIATION_JSON = PIPELINE / "authored" / "pronunciation.json"

# ------------------------------------------------------------------ letters and marks
MARKS = {
    "ً": "fathatain", "ٌ": "dhammatain", "ٍ": "kasratain",
    "َ": "fathah", "ُ": "dhammah", "ِ": "kasrah",
    "ّ": "shaddah", "ْ": "sukun",
}
VOWEL_MARKS = {c for c, n in MARKS.items() if n != "shaddah"}
# Combining marks a letter can carry in the Tanzil Uthmani text: harakat, the dagger alif, the
# small high/low annotation signs, the maddah, hamza above/below.
_COMBINING = set(chr(c) for c in range(0x064B, 0x0660)) | {"ٰ"} | set(chr(c) for c in range(0x06D6, 0x06EE))
# Typed Arabic in the term table: letters U+0621–U+063A, U+0641–U+064A, harakat and tanwin
# U+064B–U+0652, and spaces. No tatweel, alif wasla, dagger alif or Qur'anic marks: a term is
# never mushaf text.
_LETTERS = set(chr(c) for c in range(0x0621, 0x063B)) | set(chr(c) for c in range(0x0641, 0x064B))
TYPED = _LETTERS | set(MARKS) | {" "}


def letters(word: str) -> list[str]:
    """The word cut into letters, each with the marks that follow it (بِسْمِ → بِ | سْ | مِ)."""
    out: list[str] = []
    for ch in word:
        if ch in _COMBINING and out:
            out[-1] += ch
        else:
            out.append(ch)
    return out


def letter_of(word: str, n: int) -> str:
    """The n-th letter (1-based) of a word, with its marks. src/lib/terms.ts letterOf is the same."""
    ls = letters(word)
    if not 1 <= n <= len(ls):
        raise ValueError(f"letter {n} of {word!r}: the word has {len(ls)} letters")
    return ls[n - 1]


# ------------------------------------------------------------------ folding and attestation
_ALIF = str.maketrans({"ٱ": "ا", "أ": "ا", "إ": "ا", "آ": "ا"})
_TOKEN_SPLIT = re.compile(r"[\s،؛؟.,:;!?()\[\]{}«»\"'“”‘’/\-–—*]+")
# What may stand before the FIRST token of a term in a kitab and still be the same word: the
# article, a clitic conjunction or preposition, or both (و + ال, ب + ال, ل + ل for li + al).
# A later token may carry only the article (حرف الجر, جمع المذكر السالم): a conjunction there
# would make two words of one term («خبر والجملة» is not خَبَر جُمْلَة).
PROCLITICS = ("", "ال", "و", "ف", "ب", "ك", "ل", "وال", "فال", "بال", "كال", "لل", "ولل", "فلل", "وب", "ول", "فب",
              "فل")
PROCLITICS_NEXT = ("", "ال")


def _base(ch: str) -> str:
    return ch.translate(_ALIF)


def fold_letters(s: str) -> list[tuple[str, set[str]]]:
    """[(base letter with alif forms unified, its harakat)] — tatweel and non-harakat marks dropped."""
    out: list[tuple[str, set[str]]] = []
    for ch in s:
        if ch == "ـ":
            continue
        if ch in _COMBINING:
            if out and ch in MARKS:
                out[-1][1].add(ch)
            continue
        out.append((_base(ch), set()))
    return out


def fold(s: str) -> str:
    return "".join(b for b, _ in fold_letters(s))


SHADDAH = "ّ"
# Tokens of a term whose last mark does NOT move with the term's role: a preposition or a
# preposition + pronoun inside the term (مَفْعُول بِهِ, مُضَاف إِلَيْه, بَدَل كُلّ مِنْ كُلّ) and the
# zharf of تَفْسِير بَعْدَ إِبْهَام. Their last letter is checked like any other (review 2026-10-10:
# the old rule exempted every token's last letter, so a planted بِهُ passed).
FIXED_ENDING = {"به", "اليه", "من", "بعد"}


def _declines(term_tok: list[tuple[str, set[str]]]) -> bool:
    return "".join(b for b, _ in term_tok) not in FIXED_ENDING


def _ending_from(term_tok: list[tuple[str, set[str]]]) -> int:
    """Index of the first letter of a declining token's case ending: its last letter, or the
    letter before a final bare alif that follows fathatain (اِسْتِفْعَالًا: the ending is لًا)."""
    if not _declines(term_tok):
        return len(term_tok)
    n = len(term_tok) - 1
    if n >= 1 and term_tok[n][0] == "ا" and not term_tok[n][1] and "ً" in term_tok[n - 1][1]:
        return n - 1
    return n


def _compatible(term_tok: list[tuple[str, set[str]]], src_tok: list[tuple[str, set[str]]],
                after_article: bool = False) -> str | None:
    """None when the source's vocalisation agrees with the term's; else what differs. After the
    article, a shaddah on the first letter is the article's assimilation (الصَّرف), not the word's.
    The ending of a declining token is the case ending, which moves with the word's role."""
    end = _ending_from(term_tok)
    for j, ((tb, tm), (_sb, sm)) in enumerate(zip(term_tok, src_tok)):
        last = j >= end
        if j == 0 and after_article and SHADDAH not in tm:
            sm = sm - {SHADDAH}
        if SHADDAH in sm and SHADDAH not in tm:
            return f"letter {j + 1} ({tb}): the source writes a shaddah the term lacks"
        if last:
            continue  # the case ending moves with the word's role
        tv, sv = tm & VOWEL_MARKS, sm & VOWEL_MARKS
        if tv and sv and tv != sv:
            names = lambda v: "/".join(MARKS[c] for c in sorted(v))  # noqa: E731
            return f"letter {j + 1} ({tb}): term {names(tv)}, source {names(sv)}"
    return None


def _confirmed(term_tok: list[tuple[str, set[str]]], src_tok: list[tuple[str, set[str]]],
               after_article: bool = False) -> set[tuple[int, str]]:
    """(letter index, mark) of the term token that the source writes too: the marks it confirms."""
    out = set()
    for j, ((_tb, tm), (_sb, sm)) in enumerate(zip(term_tok, src_tok)):
        if j == 0 and after_article:
            sm = sm - {SHADDAH}
        out |= {(j, c) for c in tm & sm}
    return out


def attest_match(term_ar: str, text: str) -> tuple[bool, str]:
    """Does the excerpt contain the term as whole tokens (proclitics allowed) with compatible
    vowels? Returns (ok, why-not or the matched source words)."""
    ok, why, _conf = attest_match_marks(term_ar, text)
    return ok, why


def attest_match_marks(term_ar: str, text: str) -> tuple[bool, str, set[tuple[int, int, str]]]:
    """attest_match, plus the marks of the term the matched source words write themselves:
    {(token index, letter index, mark)}. An unvocalised excerpt confirms the letters only."""
    want = [fold_letters(t) for t in term_ar.split()]
    toks = [t for t in _TOKEN_SPLIT.split(text) if t]
    src = [fold_letters(t) for t in toks]
    conflicts = []
    for i in range(len(src) - len(want) + 1):
        ok, why, conf = True, None, set()
        for k, w in enumerate(want):
            s = src[i + k]
            wb = "".join(b for b, _ in w)
            sb = "".join(b for b, _ in s)
            pre = next((p for p in (PROCLITICS if k == 0 else PROCLITICS_NEXT) if sb == p + wb), None)
            if pre is None and _ending_from(w) == len(w) - 2:
                # a wazan cited with its -an ending (اِسْتِفْعَالًا) is the kitab's bare اِسْتِفْعَال:
                # the final alif only carries the tanwin
                pre = next((p for p in (PROCLITICS if k == 0 else PROCLITICS_NEXT) if sb == p + wb[:-1]), None)
                w = w[:-1] if pre is not None else w
            if pre is None:
                ok = False
                break
            art = pre.endswith("ال") or pre.endswith("لل")
            why = _compatible(w, s[len(pre):], after_article=art)
            if why:
                conflicts.append(f"«{toks[i + k]}»: {why}")
                ok = False
                break
            conf |= {(k, j, c) for j, c in _confirmed(w, s[len(pre):], after_article=art)}
        if ok:
            return True, " ".join(toks[i:i + len(want)]), conf
    return False, ("; ".join(conflicts) if conflicts else "the folded term does not occur as whole tokens"), set()


def marks_to_confirm(term_ar: str) -> set[tuple[int, int, str]]:
    """Every mark of the term a source must confirm: all harakat and shaddah, except the case
    ending (the last letter of a declining token), which mirrors the Latin form shown with it."""
    out = set()
    for k, tok in enumerate(term_ar.split()):
        ls = fold_letters(tok)
        end = _ending_from(ls)
        for j, (_b, ms) in enumerate(ls):
            if j >= end:
                continue
            out |= {(k, j, c) for c in ms}
    return out


def mark_label(term_ar: str, where: tuple[int, int, str]) -> str:
    k, j, c = where
    b = fold_letters(term_ar.split()[k])[j][0]
    return f"{b}+{MARKS[c]}"


# ------------------------------------------------------------------ Shamela page text (fetch.py)
_NASS = re.compile(r'<div class="nass[^"]*"[^>]*data-page-num="([^"]*)"[^>]*>(.*?)</div>', re.S)
_TITLE = re.compile(r"<title>(.*?)</title>", re.S)
HAMESH_MARK = "\n[هامش]\n"


def _clean(fragment: str) -> str:
    fragment = re.sub(r'<a [^>]*class="btn_tag[^"]*"[^>]*>.*?</a>', "", fragment, flags=re.S)
    fragment = re.sub(r"<br\s*/?>", "\n", fragment)
    fragment = re.sub(r"</p>", "\n", fragment)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    fragment = html.unescape(fragment).replace(" ", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in fragment.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def extract_shamela(page_html: str) -> dict:
    """The text of one shamela.ws/book/<book>/<id> page: the matn paragraphs, then the editor's
    footnotes (p.hamesh) after HAMESH_MARK. The page HTML carries per-request tokens, so this
    extracted text (UTF-8, NFC as served) is what fetch.py pins."""
    m = _NASS.search(page_html)
    if not m:
        raise ValueError("no <div class=\"nass\"> with a data-page-num on this page")
    body = m.group(2)
    cut = body.find('<p class="hamesh"')
    matn, hamesh = (body[:cut], body[cut:]) if cut >= 0 else (body, "")
    text = _clean(matn)
    if hamesh:
        text += HAMESH_MARK + _clean(hamesh)
    title = _TITLE.search(page_html)
    return {"print_page": m.group(1), "title": html.unescape(title.group(1)).strip() if title else "",
            "text": unicodedata.normalize("NFC", text) + "\n"}


# ------------------------------------------------------------------ the term table
def load_terms(path: Path = TERMS_JSON) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_pronunciation(path: Path = PRONUNCIATION_JSON) -> dict[str, str]:
    """Latin head (lowercase, apostrophes as ASCII) → Arabic term, for the dictionary's Arabic terms."""
    out = {}
    for t in json.loads(path.read_text(encoding="utf-8"))["terms"]:
        m = re.match(r"^(.+?) \((.+)\)$", t.get("display", ""))
        if m and re.search(r"[؀-ۿ]", t["term"]) and m.group(2) == t["term"]:
            out[latin_key(m.group(1))] = t["term"]
    return out


def latin_key(s: str) -> str:
    return s.lower().replace("’", "'").replace("‘", "'").strip()


def check_table(table: dict, pron: dict[str, str], pages: dict[str, dict], kitab: dict,
                page_text: dict[str, str] | None = None, stats: dict | None = None) -> tuple[list[str], list[str]]:
    """(errors, report). page_text = {"book/id": pinned text} when the cache is present.

    Harakat (review 2026-10-10: "only the consonants are checked"): an attestation proves the
    letters, and a vowel it writes may not contradict the term's; a mark is CONFIRMED only where a
    source writes it on that letter: the operator-approved dictionary (the whole term, or a token
    of it, byte-equal to a dictionary token) or a vocalised excerpt. The case ending of a declining
    token is not asked for (it mirrors the Latin form beside it). Terms with marks no source
    confirms are listed in the report ("HARAKAT UNCONFIRMED"), not refused: their letters are
    attested and their harakat follow the dictionary convention; `stats` counts both kinds."""
    errors: list[str] = []
    report: list[str] = []
    unconfirmed: list[str] = []
    ids, forms = set(), {}
    pron_tokens = {tok for v in pron.values() for tok in v.split()}
    n_full = n_ar = 0
    for t in table.get("terms", []):
        where = f"term {t.get('id')!r}"
        if not re.fullmatch(r"[a-z0-9-]+", t.get("id") or ""):
            errors.append(f"{where}: id must match [a-z0-9-]+")
        if t.get("id") in ids:
            errors.append(f"{where}: id used twice")
        ids.add(t.get("id"))
        if t.get("group") not in ("istilah", "harakah"):
            errors.append(f"{where}: group must be istilah or harakah")
        if t.get("group") == "harakah" and not (t.get("hint") or "").strip():
            errors.append(f"{where}: a harakah term needs its short reminder (hint)")
        elif t.get("group") == "harakah":
            errors += hint_problems(t, where)
        if not t.get("latin") or not t.get("forms"):
            errors.append(f"{where}: needs latin and forms")
        for f in t.get("forms", []):
            key = f.lower()
            if key in forms:
                errors.append(f"{where}: form {f!r} also belongs to term {forms[key]!r}")
            forms[key] = t.get("id")
        ar = t.get("ar")
        if ar is None:
            if not (t.get("unverified") or "").strip():
                errors.append(f"{where}: ar is null but no `unverified` reason is given")
            report.append(f"UNVERIFIED  {t.get('latin')}: {t.get('unverified')}")
            continue
        bad = sorted({c for c in ar if c not in TYPED})
        if bad or not set(ar) & _LETTERS:
            errors.append(f"{where}: ar {ar!r} has characters outside typed Arabic letters + harakat + spaces: "
                          + ", ".join(f"U+{ord(c):04X}" for c in bad))
        if unicodedata.normalize("NFC", ar) != ar:
            errors.append(f"{where}: ar is not NFC")
        p = pron.get(latin_key(t.get("latin", "")))
        if p is not None and p != ar:
            errors.append(f"{where}: ar {ar!r} differs from the pronunciation dictionary's {p!r} for "
                          f"{t.get('latin')!r} (captions and Konsep must agree)")
        attests = t.get("attest") or []
        if not attests:
            errors.append(f"{where}: no attestation; give a source or set ar to null with a reason")
        verified = 0
        need = marks_to_confirm(ar)
        conf = {(k, j, c) for k, tok in enumerate(ar.split()) if tok in pron_tokens
                for j, (_b, ms) in enumerate(fold_letters(tok)) for c in ms}
        for i, a in enumerate(attests):
            aw = f"{where}.attest[{i}]"
            if "pron" in a:
                if a["pron"] != ar or ar not in pron.values():
                    errors.append(f"{aw}: {a['pron']!r} is not the pronunciation dictionary's spelling of this term")
                else:
                    verified += 1
                    conf |= need
                continue
            pg, text = a.get("page"), a.get("text") or ""
            meta = pages.get(pg)
            if not meta:
                errors.append(f"{aw}: page {pg!r} is not pinned in sources.json shamela_istilah")
                continue
            if meta.get("book") is None or str(meta["book"]) not in kitab:
                errors.append(f"{aw}: page {pg!r} names no cited kitab")
            if len(text.split()) > 12:
                errors.append(f"{aw}: excerpt longer than 12 words")
            ok, why, got = attest_match_marks(ar, text)
            if not ok:
                errors.append(f"{aw}: {ar!r} not attested in «{text}»: {why}")
                continue
            if page_text is not None:
                body = page_text.get(pg)
                if body is None:
                    errors.append(f"{aw}: page {pg} is not in the cache; run fetch.py")
                    continue
                matn, _, hamesh = body.partition(HAMESH_MARK)
                part = a.get("part", "matn")
                if text not in (hamesh if part == "hamesh" else matn):
                    errors.append(f"{aw}: excerpt is not a verbatim substring of the pinned page {pg} ({part})")
                    continue
            verified += 1
            conf |= got
        if attests and not verified:
            errors.append(f"{where}: no attestation verifies {ar!r}")
            continue
        n_ar += 1
        missing = sorted(need - conf)
        if missing:
            unconfirmed.append(f"HARAKAT UNCONFIRMED  {t.get('latin')} {ar}: "
                               + ", ".join(mark_label(ar, m) for m in missing))
        else:
            n_full += 1
    if stats is not None:
        stats.update(attested=n_ar, harakat_confirmed=n_full, harakat_unconfirmed=n_ar - n_full)
    return errors, report + unconfirmed


# ------------------------------------------------------------------ markup
MARKUP = re.compile(r"\[\[([^\[\]|]+?)(?:\|([^\[\]|]+))?\]\]")
# q:S:A:W (a word), q:S:A:W1-W2 (consecutive words of one ayah), q:S:A:W/k (k-th QAC segment),
# q:S:A:W#n (n-th letter, with its marks).
QREF = re.compile(r"^q:(\d{1,3}):(\d{1,3}):(\d{1,3})(?:-(\d{1,3})|/(\d{1,2})|#(\d{1,2}))?$")
_WORD_CHARS = r"A-Za-zĀāĪīŪūḤḥṢṣḌḍṬṭẒẓṠṡŻż'‘’\-"


def strip(text: str) -> str:
    """The plain text: each [[surface|ref]] becomes its surface."""
    return MARKUP.sub(lambda m: m.group(1), text)


def spans(text: str) -> list[tuple[str, str | None]]:
    """[(surface, ref or None)] for every markup span, in order."""
    return [(m.group(1), m.group(2)) for m in MARKUP.finditer(text)]


def term_index(table: dict) -> tuple[dict[str, dict], dict[str, dict]]:
    """(id → term, lowercased form → term)."""
    by_id = {t["id"]: t for t in table.get("terms", [])}
    by_form = {f.lower(): t for t in table.get("terms", []) for f in t.get("forms", [])}
    return by_id, by_form


def resolve(surface: str, ref: str | None, by_id: dict, by_form: dict) -> tuple[str, str] | None:
    """("term", id) | ("q", ref) | None when the span names nothing. A bare [[surface]] is looked
    up by its form; marking an ambiguous form is itself the author's statement that it is the term."""
    if ref and ref.startswith("q:"):
        return ("q", ref) if QREF.match(ref) else None
    if ref:
        return ("term", ref) if ref in by_id else None
    t = by_form.get(surface.lower())
    return ("term", t["id"]) if t is not None else None


def unmarked(text: str, table: dict) -> list[str]:
    """Term forms written in the prose without markup (outside every [[…]]). Forms listed as
    `ambiguous_forms` are left to the author (they are ordinary Indonesian words too)."""
    rest = MARKUP.sub(lambda m: " " * len(m.group(0)), text)
    found = []
    pats = []
    for t in table.get("terms", []):
        amb = {f.lower() for f in t.get("ambiguous_forms", [])}
        for f in t.get("forms", []):
            if f.lower() in amb:
                continue
            pats.append(f)
    # Longest first, so "huruf jar" is reported once, not as "jar" too.
    pats.sort(key=len, reverse=True)
    taken = [False] * len(rest)
    for f in pats:
        rx = re.compile(rf"(?<![{_WORD_CHARS}]){re.escape(f)}(?:-?nya)?(?![{_WORD_CHARS}])", re.I)
        for m in rx.finditer(rest):
            if any(taken[m.start():m.end()]):
                continue
            for i in range(m.start(), m.end()):
                taken[i] = True
            found.append(m.group(0))
    return found


def names_term(surface: str, term: dict) -> bool:
    """Does the surface name this term (one of its forms or its Latin, maybe with an Indonesian
    affix: "isimnya", "mashdar-nya")? Review 2026-10-10: an explicit [[majrur|marfu]] passed
    every check and rendered "majrur (مَرْفُوع)"."""
    s = latin_key(surface)
    return any(latin_key(f) in s for f in [term.get("latin", ""), *term.get("forms", [])] if f)


def check_markup(text: str, where: str, by_id: dict, by_form: dict, table: dict) -> list[str]:
    """Errors for one marked prose field: unresolved spans, nested or broken brackets, a term ref
    whose surface names another term, unmarked forms."""
    errs = []
    if text.count("[[") != text.count("]]") or "[[" in strip(text) or "]]" in strip(text):
        errs.append(f"{where}: unbalanced or nested [[…]] markup")
    for surface, ref in spans(text):
        r = resolve(surface, ref, by_id, by_form)
        if r is None:
            errs.append(f"{where}: [[{surface}{'|' + ref if ref else ''}]] names no term in library.terms.json "
                        f"and no q:<surah>:<ayah>:<word>[/segment|#letter]")
        elif r[0] == "term" and not names_term(surface, by_id[r[1]]):
            errs.append(f"{where}: [[{surface}|{ref}]]: the surface does not name the term {r[1]!r} "
                        f"(its forms: {', '.join(by_id[r[1]].get('forms', []))})")
    for f in unmarked(text, table):
        errs.append(f"{where}: term {f!r} is in library.terms.json but written without [[…]] markup")
    return errs


def explicit(text: str, by_id: dict, by_form: dict) -> str:
    """The shipped marked text names every term by id ([[majrur|majrur]]), so the app needs no
    form table; q-refs are explicit already. validate_terms.py rebuilds it from the authored text
    and compares it with library.json byte for byte."""
    def one(m):
        r = resolve(m.group(1), m.group(2), by_id, by_form)
        return f"[[{m.group(1)}|{r[1]}]]" if r else m.group(0)
    return MARKUP.sub(one, text)


# ------------------------------------------------------------------ a q-ref's Latin against its bytes
# Review 2026-10-10: only lesson whole-word refs and letter refs were compared with their surface,
# so [[bi-|q:1:1:1/2]] rendered "bi- (سْمِ)". Every word, run and segment ref is now compared by
# its consonant skeleton: the surface (SKB transliteration) and the Arabic bytes reduced to the
# consonants a reader hears. Vowels, hamzah and ‘ain are left out on both sides (the prose writes
# them inconsistently: "aḥad", "an‘ama"); long vowels, diphthongs (و ي without a vowel of their
# own), hamzah washal, a silent lam of al- (before a letter with shaddah), the dagger alif and the
# mushaf's small signs are not consonants; shaddah doubles, except on a token's first letter (the
# mushaf's mark of idgham with the word before: لَّهُۥ is "lahū"); tanwin is an n the Latin may drop
# at the very end (pausal "aḥad"); ة is t, or h at the end.
_AR_CONS = {
    "ب": "b", "ت": "t", "ث": "s", "ج": "j", "ح": "h", "خ": "x", "د": "d", "ذ": "z", "ر": "r", "ز": "z",
    "س": "s", "ش": "$", "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "غ": "g", "ف": "f", "ق": "q", "ك": "k",
    "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y", "ة": "T",
}
_LAT_DIGRAPH = (("kh", "x"), ("sy", "$"), ("dz", "z"), ("ts", "s"), ("sh", "s"), ("dh", "d"), ("th", "t"),
                ("zh", "z"), ("gh", "g"))
_TANWIN = {"ً", "ٌ", "ٍ"}
_VOWELS = {"َ", "ُ", "ِ"}


def skeleton_ar(text: str) -> str:
    """The consonants of Arabic bytes (one word, a run of words or a segment), see above."""
    out = []
    for tok in text.split():
        ls = letters(tok)
        for j, cl in enumerate(ls):
            base, marks = cl[0], set(cl[1:])
            c = _AR_CONS.get(base)
            if c is None:
                continue  # alif forms, hamzah, alif maqsurah, ‘ain, tatweel
            if base in "وي" and not (marks & (_VOWELS | _TANWIN | {SHADDAH})):
                continue  # a long vowel or a diphthong
            nxt = ls[j + 1] if j + 1 < len(ls) else ""
            if base == "ل" and not marks and SHADDAH in nxt:
                continue  # the lam of al- before a letter it assimilates to
            out.append(c * (2 if SHADDAH in marks and j > 0 else 1))
            if marks & _TANWIN:
                out.append("N")
    return "".join(out)


def skeleton_latin(surface: str) -> str:
    s = unicodedata.normalize("NFD", surface.lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    for a, b in _LAT_DIGRAPH:
        s = s.replace(a, b)
    return re.sub(r"[^bcdfghjklmnpqrstvwxyz$]", "", s)


def surface_matches(surface: str, ar: str) -> bool:
    """Does the transliteration name these Arabic bytes? (consonant skeletons, see above)"""
    a, lat = skeleton_ar(ar), skeleton_latin(surface)
    for cand in {a, a.replace("N", "n"), re.sub("N$", "", a).replace("N", "n")}:
        for t in {cand.replace("T", "t"), re.sub("T$", "h", cand).replace("T", "t")}:
            if t == lat:
                return True
    return False


# ------------------------------------------------------------------ meanings (rules 4, 14)
# A Qur'anic word's meaning follows it as "yang artinya “…”" (rule 4). These fields keep a bare
# quote because their text is recorded narration (Al-Fatihah ayah 1, rendered 2026-10-10) or the
# narrator already says "kata … yang artinya" before them (build_narration.py); changing them
# re-renders audio (operator approval) or doubles the phrase.
BARE_QUOTE_OK = {
    "concepts[huruf-jar].summary",      # al-fatihah:1:concept:huruf-jar has audio
    "concepts[fiil-amr].summary",       # narrated "seperti kata … yang artinya …" (another ayah's word)
    "concepts[isim-maushul].summary",   # the same
}
_BARE_QUOTE = re.compile(r"\[\[[^\[\]|]+\|q:[^\[\]]+\]\],? \(?“")
_BERARTI = re.compile(r"\[\[[^\[\]|]+\|q:[^\[\]]+\]\],? \(?berarti\b", re.I)
# A quote after a word that a kitab is quoted ABOUT is not its meaning: "Darwisy menyebut
# [[iyyāka|q:1:5:1]] “objek yang didahulukan …”".
_QUOTED_ABOUT = re.compile(r"\bmenyebut(?:nya)? $")
AKAR = re.compile(r"\bakar\b", re.I)


def meaning_problems(marked: str, where: str) -> list[str]:
    """Rule 4 on the marked text: no bare quote and no "berarti" right after a Qur'anic word
    ("[[bi-|q:1:1:1/1]] “dengan”" → "yang artinya “dengan”"; review 2026-10-10)."""
    out = []
    for m in _BARE_QUOTE.finditer(marked):
        if where in BARE_QUOTE_OK or _QUOTED_ABOUT.search(marked[:m.start()]):
            continue
        out.append(f"{where}: a Qur'anic word's meaning in bare quotes ({m.group(0)!r}); "
                   f"write \"yang artinya “…”\" (operator 2026-10-10)")
    for m in _BERARTI.finditer(marked):
        out.append(f"{where}: \"berarti\" after a Qur'anic word ({m.group(0)!r}); meanings use \"yang artinya\" "
                   f"(operator 2026-10-10)")
    return out


def q_refs(text: str) -> list[str]:
    return [ref for _s, ref in spans(text) if ref and ref.startswith("q:")]


def resolve_q(ref: str, tanzil_token, qac_segments) -> str:
    """Bytes of a q-ref. tanzil_token(s, a, w) → the Tanzil token (None past the ayah's end);
    qac_segments(s, a, w) → its QAC segments in Arabic."""
    m = QREF.match(ref)
    if not m:
        raise ValueError(f"bad q-ref {ref!r}")
    s, a, w = int(m.group(1)), int(m.group(2)), int(m.group(3))
    word = tanzil_token(s, a, w)
    if word is None:
        raise ValueError(f"{ref}: no word {w} in {s}:{a}")
    if m.group(4):
        w2 = int(m.group(4))
        if w2 <= w:
            raise ValueError(f"{ref}: a run must name a later last word")
        toks = [tanzil_token(s, a, k) for k in range(w, w2 + 1)]
        if None in toks:
            raise ValueError(f"{ref}: {s}:{a} has fewer than {w2} words")
        return " ".join(toks)
    if m.group(5):
        segs = qac_segments(s, a, w)
        if "".join(segs) != word:
            raise ValueError(f"{ref}: QAC segments {segs} do not join to the Tanzil token {word}")
        k = int(m.group(5))
        if not 1 <= k <= len(segs):
            raise ValueError(f"{ref}: the word has {len(segs)} QAC segments")
        return segs[k - 1]
    if m.group(6):
        return letter_of(word, int(m.group(6)))
    return word


# ------------------------------------------------------------------ word parts (rule 14)
ALIF_FORMS = {"ا", "ٱ", "أ", "إ", "آ"}
# The one letter (not vowel) change a join makes in these diagrams: the alif maqsurah of عَلَىٰ
# written ya' before a pronoun (عَلَيْهِمْ).
LETTER_CHANGES = {("ى", "ي")}


def parts_problems(tiles: list[str], changes: list[dict], drops: list[dict], word: str) -> list[str]:
    """A parts diagram must add up to the word as the ayah writes it: the tiles' letters, with the
    dropped letters left out (an alif: the hamzah washal of ٱسْمُ in بِسْمِ; with it, the bare lam
    of al- after it: ٱللَّهُ in لِلَّهِ) and each changed letter replaced by the word's own letter
    (same consonant, another vowel: مُ → مِ; or alif maqsurah → ya': ىٰ → يْ), spell `word` byte for
    byte. src/lib/terms.ts partsProblems is the same check, run by vitest in CI."""
    out = []
    cut = [letters(t) for t in tiles]
    flat = [(i, j, ch) for i, ls in enumerate(cut) for j, ch in enumerate(ls)]
    wl = letters(word)
    seen = set()
    for change in changes:
        ti, li, to = change.get("tile", 0) - 1, change.get("letter", 0), change.get("to", 0) - 1
        if not 0 <= ti < len(cut) or not cut[ti]:
            return [f"change.tile {ti + 1} is not a tile"]
        lj = len(cut[ti]) - 1 if li == -1 else li - 1
        if not 0 <= lj < len(cut[ti]) or not 0 <= to < len(wl):
            return [f"change names letter {li} of tile {ti + 1} / letter {to + 1} of the word: out of range"]
        if (ti, lj) in seen:
            out.append(f"change: letter {li} of tile {ti + 1} is changed twice")
        seen.add((ti, lj))
        a, b = cut[ti][lj], wl[to]
        if fold(a) != fold(b) and (fold(a), fold(b)) not in LETTER_CHANGES:
            out.append(f"change: {a} and {b} are not the same letter")
        elif fold(a) == fold(b) and {c for c in a if c in VOWEL_MARKS} == {c for c in b if c in VOWEL_MARKS}:
            out.append(f"change: {a} → {b} does not change the vowel")
        flat = [(i, j, b if (i, j) == (ti, lj) else ch) for i, j, ch in flat]
    dropped = set()
    for drop in drops:
        di, dj = drop.get("tile", 0) - 1, drop.get("letter", 0) - 1
        if not 0 <= di < len(cut) or not 0 <= dj < len(cut[di]):
            return out + [f"drop names letter {dj + 1} of tile {di + 1}: out of range"]
        dropped.add((di, dj))
    for di, dj in sorted(dropped):
        ch = cut[di][dj]
        article_lam = ch == "ل" and dj == 1 and (di, 0) in dropped and cut[di][0][0] == "ٱ"
        if ch[0] not in ALIF_FORMS and not article_lam:
            out.append(f"drop: {ch} is not an alif or the lam of al- after its hamzah washal")
    flat = [x for x in flat if (x[0], x[1]) not in dropped]
    spelled = "".join(ch for _i, _j, ch in flat)
    if spelled != word:
        out.append(f"the tiles spell {spelled}, not the ayah's {word}")
    return out


# ------------------------------------------------------------------ the Harakat page's signs
# Review 2026-10-10: a sign's sound, place, reading and the terms' reminders were free text; a
# kasrah card saying "a, di atas huruf" passed. Each is now checked against the mark it names.
SIGN_RULES = {  # mark → (sound, side of the letter)
    "fathah": ("a", "atas"), "kasrah": ("i", "bawah"), "dhammah": ("u", "atas"),
    "fathatain": ("-an", "atas"), "kasratain": ("-in", "bawah"), "dhammatain": ("-un", "atas"),
    "sukun": (None, "atas"), "shaddah": (None, "atas"),
}
# The Latin consonant a reading starts with ("b + i"), per base letter (SKB 158/1987).
READING_CONS = {
    "ب": "b", "ت": "t", "ث": "ts", "ج": "j", "ح": "h", "خ": "kh", "د": "d", "ذ": "dz", "ر": "r", "ز": "z",
    "س": "s", "ش": "sy", "ص": "sh", "ض": "dh", "ط": "th", "ظ": "zh", "غ": "gh", "ف": "f", "ق": "q",
    "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y",
}
HINT_RULES = {  # harakah term → words its reminder must carry
    "fathah": (" a ", "atas"), "kasrah": (" i ", "bawah"), "dhammah": (" u ", "atas"),
    "sukun": ("mati",), "tanwin": ("bunyi n",), "tasydid": ("dobel",), "harakat": ("vokal",),
}
_ARABIC_CHAR = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")


def sign_problems(sign: dict, letter: str, where: str) -> list[str]:
    """One Harakat sign against its example letter (the bytes of its letter q-ref)."""
    out = []
    for fld in ("sound", "place", "shape", "reading"):
        if _ARABIC_CHAR.search(sign.get(fld, "")):
            out.append(f"{where}.{fld}: typed Arabic in a sign's text ({sign.get(fld)!r}); the sign is drawn from "
                       f"the example letter's bytes")
    vowels = [MARKS[c] for c in letter if c in MARKS and MARKS[c] not in ("shaddah",)]
    for m in sign.get("marks", []):
        sound, side = SIGN_RULES.get(m, (None, None))
        other = "bawah" if side == "atas" else "atas"
        place = sign.get("place", "")
        if side and (side not in place or other in place):
            out.append(f"{where}: {m} sits {side} the letter, but place says {place!r}")
        if sound and sign.get("sound") != sound:
            out.append(f"{where}: {m} sounds {sound!r}, but sound says {sign.get('sound')!r}")
    cons = READING_CONS.get(letter[:1], "")
    if SHADDAH in letter:
        cons *= 2
    vowel = next((SIGN_RULES[v][0] for v in vowels if SIGN_RULES.get(v, (None,))[0]), None)
    want = f"{cons} + {vowel.lstrip('-')}" if vowel else cons
    if cons and sign.get("reading") != want:
        out.append(f"{where}: the example letter {letter} reads {want!r}, but reading says {sign.get('reading')!r}")
    return out


def hint_problems(term: dict, where: str) -> list[str]:
    """A harakah term's reminder names its sound and side; no typed Arabic in it."""
    out = []
    hint = term.get("hint") or ""
    if _ARABIC_CHAR.search(hint):
        out.append(f"{where}: typed Arabic in the reminder {hint!r}")
    for word in HINT_RULES.get(term.get("id"), ()):
        if word not in f" {hint} ":
            out.append(f"{where}: the reminder {hint!r} should say {word.strip()!r}")
    side = {"fathah": "bawah", "kasrah": "atas", "dhammah": "bawah"}.get(term.get("id"))
    if side and side in hint:
        out.append(f"{where}: the reminder {hint!r} puts the sign on the wrong side")
    return out


# ------------------------------------------------------------------ wording (rules 4, 5)
KETUK = re.compile(r"\b(ketuk|mengetuk|diketuk|ketuklah)\b", re.I)
YANG_BERARTI = re.compile(r"\byang berarti\b", re.I)


def wording(text: str, where: str) -> list[str]:
    """Rule 5: "klik", never "ketuk"; rule 4: "yang artinya", never "yang berarti"."""
    out = []
    if KETUK.search(text):
        out.append(f"{where}: says {KETUK.search(text).group(0)!r} (operator 2026-10-10: klik, never ketuk)")
    if YANG_BERARTI.search(text):
        out.append(f"{where}: says 'yang berarti' (operator 2026-10-10: meanings use 'yang artinya')")
    return out
