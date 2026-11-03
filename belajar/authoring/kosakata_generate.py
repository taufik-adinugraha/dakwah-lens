"""Writes the meanings of the Qur'an vocabulary list with Claude: the one LLM step, kept out of
belajar/pipeline, whose rule is no LLM and no paid API (pipeline/README.md). Run once, 2026-11-03;
kept to show how the meanings were made and to rerun them. Not part of any build or CI step.

Code supplies everything countable or verbatim. Claude Sonnet 5.5 writes the meanings from up to 12
sampled ayat with QuranEnc and Saheeh International; Claude Opus 5.5 checks each entry and corrects
it; every correction is checked again. All through the Message Batches API, with each batch id saved
so a restart resumes it instead of paying twice. Paid from ANTHROPIC_API_KEY.

    cd api && uv run --env-file ../.env python ../belajar/authoring/kosakata_generate.py build <dir> all
    cd api && uv run --env-file ../.env python ../belajar/authoring/kosakata_generate.py run <dir> all
    cd api && uv run --env-file ../.env python ../belajar/authoring/kosakata_generate.py second <dir>
    python3 belajar/authoring/kosakata_export.py <dir> final2.json belajar/pipeline/authored/kosakata_meanings.json
    cd belajar/pipeline && python3 build_kosakata.py && python3 validate_kosakata.py
"""
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(__file__).resolve().parent
ALL_LEMMAS = len(sys.argv) > 3 and sys.argv[3] == "all"
PIPELINE = Path(__file__).resolve().parents[1] / "pipeline"
QURAN_JSON = PIPELINE.parents[1] / "api" / "data" / "quran.json"
sys.path.insert(0, str(PIPELINE))
import common  # noqa: E402

WRITER = "claude-sonnet-5-5"
VERIFIER = "claude-opus-5-5"
# ($ per MTok: input, output, cache read). Batch = half; a 1h cache write = 2x input.
PRICE = {WRITER: (2.0, 10.0, 0.20), VERIFIER: (4.0, 20.0, 0.20)}
SAMPLE_AYAT = 12
AUDIT_SIZE = 200
TIERS = [(1, 300), (301, 1500), (1501, 4832)]

# Words that test the rules: particles with several jobs, words used of Allah, names, polysemy.
TRICKY = [
    "{ll~ah", "rab~", "maA", "min", "laA", "<in~", "qaAla", "kaAna", ">aw", "fiY",
    "yad", "wajoh", '{sotawaY`^', "diyn", "nafos", ">um~ap", "'aAyap", "*ikor", "Salaw`p",
    "muwsaY`", "firoEawon", "jan~ap", "$aYo'", "ruwH", "Eayon",
]

CONS = {
    "b": "b", "t": "t", "v": "ṡ", "j": "j", "H": "ḥ", "x": "kh", "d": "d", "*": "ż", "r": "r",
    "z": "z", "s": "s", "$": "sy", "S": "ṣ", "D": "ḍ", "T": "ṭ", "Z": "ẓ", "E": "‘", "g": "g",
    "f": "f", "q": "q", "k": "k", "l": "l", "m": "m", "n": "n", "h": "h", "w": "w", "y": "y",
    "'": "’", ">": "’", "<": "’", "&": "’", "}": "’", "p": "h",
}
VOWEL = {"a", "i", "u"}


def translit(bw: str) -> str:
    """Buckwalter lemma to SKB 158/1987, by rule. Initial hamza is not written."""
    s = re.sub(r"\d+$", "", bw).replace("^", "").replace("_", "")  # QAC numbers homographs
    s = re.sub(r"^(.)~", r"\1", s)  # QAC keeps the article's assimilation: r~aHiym
    out, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        nx = s[i + 1] if i + 1 < n else ""
        nx2 = s[i + 2] if i + 2 < n else ""
        if c == "{":
            out.append("a" if nx == "l" else "i")  # the article vs hamzat wasl of verbs and ism
        elif c == "|":
            out.append("ā" if i == 0 else "’ā")
        elif c == "a":
            if nx == "Y" and nx2 == "o":  # QAC writes shay' as $aYo'
                out.append("ai")
                i += 1
            elif nx == "w" and nx2 == "`":  # Uthmani waw + dagger alif: Salaw`p
                out.append("ā")
                i += 2
            elif nx in ("A", "Y", "`"):
                out.append("ā")
                i += 1
                if i + 1 < n and s[i + 1] == "`":
                    i += 1
            elif nx == "y" and (nx2 == "o" or nx2 == ""):
                out.append("ai")
                i += 1
            elif nx == "w" and (nx2 == "o" or nx2 == ""):
                out.append("au")
                i += 1
            else:
                out.append("a")
        elif c == "i":
            if nx == "y" and nx2 not in VOWEL and nx2 != "~":
                out.append("ī")
                i += 1
            elif nx == "Y":
                out.append("ī")
                i += 1
            else:
                out.append("i")
        elif c == "u":
            if nx == "w" and nx2 not in VOWEL and nx2 != "~":
                out.append("ū")
                i += 1
            else:
                out.append("u")
        elif c == "A":
            out.append("ā")
        elif c == "Y":
            out.append("ā")
        elif c == "`":
            out.append("ā")
        elif c == "F":
            out.append("an")
        elif c == "N":
            out.append("un")
        elif c == "K":
            out.append("in")
        elif c == "#":
            out.append("’")
        elif c in ("o", "@"):
            pass
        elif c == "~":
            if out:
                out.append(out[-1])
        elif c in CONS:
            if c in ("'", ">", "<", "&", "}") and i == 0:
                pass
            else:
                out.append(CONS[c])
        i += 1
    t = "".join(out)
    if bw in ("<in~", ">an~"):  # QAC stores these particles without their final vowel
        t += "a"
    return "Allāh" if bw == "{ll~ah" else t


def headword(bw: str) -> str:
    return common.bw_to_ar(re.sub(r"^(.)~", r"\1", re.sub(r"\d+$", "", bw)))


def quranenc_ayat() -> dict[tuple[int, int], str]:
    out = {}
    for f in (PIPELINE / "cache" / "quranenc").glob("indonesian_affairs_sura*.json"):
        for r in json.loads(f.read_text(encoding="utf-8"))["result"]:
            out[(int(r["sura"]), int(r["aya"]))] = r["translation"]
    return out


def build() -> None:
    src = common.load_sources()["sources"] if "sources" in common.load_sources() else None
    _ = src
    T = common.load_tanzil(PIPELINE / "cache" / "tanzil" / "quran-uthmani.txt")
    segs, _h = common.load_qac(PIPELINE / "cache" / "qac" / "quranic-corpus-morphology-0.4.txt")
    id_tr = quranenc_ayat()
    en_tr = {(r["surah"], r["ayah"]): r["en"] for r in json.loads(QURAN_JSON.read_text(encoding="utf-8"))}

    hits: dict[str, list] = defaultdict(list)
    for g in segs:
        lem = g.feat.get("LEM")
        if lem:
            hits[lem].append(g)
    ranked = sorted(hits, key=lambda k: (-len(hits[k]), (hits[k][0].s, hits[k][0].a, hits[k][0].w)))
    rank = {k: i + 1 for i, k in enumerate(ranked)}
    print("lemmas", len(ranked), "| first ranks", ranked[:6])

    chosen = [k for k in TRICKY if k in hits]
    if ALL_LEMMAS:
        chosen = list(ranked)
    missing = [k for k in TRICKY if k not in hits]
    if missing:
        print("not in QAC under that spelling:", missing)
    plan = [] if ALL_LEMMAS else [(1, 300, 30), (301, 1500, 30), (1501, len(ranked), 100 - 60 - len(chosen))]
    for lo, hi, want in plan:
        pool = [k for k in ranked[lo - 1 : hi] if k not in chosen]
        step = len(pool) / max(want, 1)
        chosen += [pool[int(j * step)] for j in range(want)]

    tokens = {}
    mismatch = 0

    def ayah_tokens(s: int, a: int) -> list[str]:
        if (s, a) not in tokens:
            text, _cut = common.lesson_ayah(T, s, a)
            tokens[(s, a)] = text.split(" ")
        return tokens[(s, a)]

    evidence = []
    for k in chosen:
        gs = hits[k]
        by_tag: dict[str, list] = defaultdict(list)
        for g in gs:
            by_tag[g.tag].append(g)
        # Every word class gets its share, then even spread, preferring short ayat.
        quota = {t: max(1, round(SAMPLE_AYAT * len(v) / len(gs))) for t, v in by_tag.items()}
        picked, seen = [], set()
        for t, v in sorted(by_tag.items(), key=lambda kv: -len(kv[1])):
            step = max(1, len(v) // quota[t])
            for b in range(0, len(v), step):
                bucket = v[b : b + step]
                best = min(bucket, key=lambda g: len(id_tr.get((g.s, g.a), "")))
                if (best.s, best.a) not in seen and len(picked) < SAMPLE_AYAT:
                    seen.add((best.s, best.a))
                    picked.append(best)
        picked.sort(key=lambda g: (g.s, g.a))
        ayat = []
        for g in picked:
            toks = ayah_tokens(g.s, g.a)
            if g.w <= len(toks):
                marked = list(toks)
                marked[g.w - 1] = f"⟦{toks[g.w - 1]}⟧"
                ar = " ".join(marked)
            else:
                mismatch += 1
                ar = " ".join(toks)
            ayat.append(
                {"loc": f"{g.s}:{g.a}", "ar": ar, "id": id_tr[(g.s, g.a)], "en": en_tr[(g.s, g.a)], "tag": g.tag}
            )
        forms = Counter()
        for g in gs:
            toks = ayah_tokens(g.s, g.a)
            if g.w <= len(toks):
                forms[toks[g.w - 1]] += 1
        roots = Counter(g.feat.get("ROOT") for g in gs if g.feat.get("ROOT"))
        root = roots.most_common(1)[0][0] if roots else None
        evidence.append(
            {
                "id": f"l{rank[k]:04d}",
                "lemma_bw": k,
                "rank": rank[k],
                "count": len(gs),
                "ayat_count": len({(g.s, g.a) for g in gs}),
                "surah_count": len({g.s for g in gs}),
                "headword": headword(k),
                "translit": translit(k),
                "root": common.root_letters(root) if root else [],
                "tags": dict(Counter(g.tag for g in gs).most_common()),
                "top_forms": [f for f, _ in forms.most_common(5)],
                "ayat": ayat,
            }
        )
    evidence.sort(key=lambda e: e["rank"])
    (HERE / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=1), encoding="utf-8")
    print("lemmas chosen", len(evidence), "| word position mismatches", mismatch)
    for e in evidence[:6] + evidence[50:53] + evidence[-3:]:
        print(e["rank"], e["count"], e["lemma_bw"], e["headword"], e["translit"], e["root"], e["tags"], len(e["ayat"]))


WRITER_SYSTEM = """You write entries for a Qur'anic vocabulary list on dakwah-lens.id, for adults in Indonesia and English readers learning to read the Qur'an in Arabic. The list is ranked by how often each word occurs. An entry tells a learner what one lemma means where the Qur'an uses it, and a reader can open the ayat you cite and see that meaning there.

You receive one lemma: its Arabic form, root, word classes with their counts, its total count, and a sample of ayat. In each ayah the word is marked \u27e6like this\u27e7, followed by an Indonesian translation (QuranEnc, Ministry of Religious Affairs) and an English one (Saheeh International).

Ground every meaning in the sample. Do not add a meaning from memory, however well known, if no sampled ayah shows it: a later check compares each meaning with the ayat you cite.

Gloss the marked word itself
A sense says what the marked word means by itself, not what its phrase or sentence means. Most errors in this list break this rule.
- Meaning that comes from a neighbouring word is not a sense. In yawm ad-din ("Day of Judgment"), yawm still means "day". In bi-ghairi haqq ("unjustly"), haqq still means "right".
- A word the translators add, often in brackets, is not part of the word.
- One meaning that translators word differently, or that takes different objects, is one sense. "Know", "be aware" and "realise" are one sense of alima. Helping a person and helping a cause are one sense of nasara.
- A translator's free rendering in one ayah is not a sense. Gloss what the word means there.
- The exception is a fixed idiom whose meaning cannot be reached from its words. It may be a sense, and the gloss gives the idiom's meaning.

Senses
- Write 1 to 4 senses, the most common in the sample first. Most words need one or two.
- gloss_id and gloss_en are 1 to 4 words each, in lowercase apart from names and "Allah". Prefer the translators' own words where they fit. No Arabic script or transliteration.
- gloss_id and gloss_en must mean the same thing, even where the two translations of an ayah differ. If they disagree about this word, gloss what the Arabic word itself means in the sample.
- ayat: 1 to 3 locations from the sample where the word carries this sense. Never cite a location outside the sample.
- For a particle or pronoun, the sense is what it does in the sentence, such as "dari" / "from", or "tidak (penafian)" / "not (negation)". Different jobs are different senses.
- For a proper name, the gloss is the name as Indonesian and English readers know it, such as "Musa" / "Moses", "Mekah" / "Makkah".
- For a word used of Allah (hand, face, rising over the Throne and the like), keep to the plain wording of the translations. Do not interpret it, do not compare Allah with creatures, and do not mention theological disputes.

Write plain text: no markdown, no capitals for emphasis, no Arabic script."""

VERIFIER_SYSTEM = """You check entries in a Qur'anic vocabulary list on dakwah-lens.id, written by another model for adult learners. Readers trust these meanings, so your job is to find what is wrong rather than to confirm the entry.

You receive one lemma, a sample of ayat where it occurs (the word marked \u27e6like this\u27e7, with an Indonesian and an English translation), and the entry.

Check:
1. Each sense against the ayat it cites: does the marked word itself carry that meaning there, judged from the Arabic and both translations? Meaning that comes from a neighbouring word, or a word the translators added, is an error unless the phrase is a fixed idiom whose meaning cannot be reached from its words.
2. Whether a clearly common meaning in the sample is missing, or one sense is really two, or two are really one. One meaning that translators word differently, or that takes different objects, is one sense.
3. Whether each gloss is accurate and natural in its language. A gloss_id and gloss_en that do not mean the same thing is an error.
4. For words used of Allah: no interpretation, no comparison with creatures, no theological dispute. Plain wording only.
5. Nothing in the entry contradicts established aqidah or takes a sectarian side.

Severity: "error" means a learner would be misled (a wrong meaning, a citation that does not show the sense, a missing major meaning, an aqidah problem). "minor" means style or a better word, with the meaning still right.

If you find any error, set verdict to "needs_fix" and give a corrected entry using only locations from the sample and the same rules: 1 to 4 senses, glosses of 1 to 4 words with the same meaning in both languages, 1 to 3 locations per sense, no Arabic script. If there are only minor issues or none, set verdict to "ok" and corrected to null."""

SENSE = {
    "type": "object",
    "properties": {
        "gloss_id": {"type": "string"},
        "gloss_en": {"type": "string"},
        "ayat": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["gloss_id", "gloss_en", "ayat"],
    "additionalProperties": False,
}
ENTRY = {
    "type": "object",
    "properties": {"senses": {"type": "array", "items": SENSE}},
    "required": ["senses"],
    "additionalProperties": False,
}
VERDICT = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["ok", "needs_fix"]},
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["error", "minor"]},
                    "problem": {"type": "string"},
                },
                "required": ["severity", "problem"],
                "additionalProperties": False,
            },
        },
        "corrected": {"anyOf": [ENTRY, {"type": "null"}]},
    },
    "required": ["verdict", "issues", "corrected"],
    "additionalProperties": False,
}


def lemma_block(e: dict) -> str:
    tags = ", ".join(f"{t} {n}" for t, n in e["tags"].items())
    lines = [
        f"Lemma: {e['headword']} ({e['translit']})",
        f"Root: {' '.join(e['root']) or 'none'}",
        f"Word classes (Quranic Arabic Corpus tags, with counts): {tags}",
        f"Occurs {e['count']} times in {e['ayat_count']} ayat across {e['surah_count']} surahs.",
        "",
        "Sampled ayat:",
    ]
    for a in e["ayat"]:
        lines += [f"[{a['loc']}] ({a['tag']}) {a['ar']}", f"  ID: {a['id']}", f"  EN: {a['en']}"]
    return "\n".join(lines)


def params(model: str, system: str, user: str, schema: dict, effort: str) -> dict:
    return {
        "model": model,
        "max_tokens": 8000,
        "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral", "ttl": "1h"}}],
        "messages": [{"role": "user", "content": user}],
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    }


def writer_params(e: dict) -> dict:
    return params(WRITER, WRITER_SYSTEM, lemma_block(e), ENTRY, "medium")


def verifier_params(e: dict, entry: dict) -> dict:
    user = lemma_block(e) + "\n\nEntry to check:\n" + json.dumps(entry, ensure_ascii=False, indent=1)
    return params(VERIFIER, VERIFIER_SYSTEM, user, VERDICT, "medium")


def client():
    import anthropic

    return anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], max_retries=6)


def text_of(msg) -> str:
    return next((b.text for b in msg.content if b.type == "text"), "")


def probe() -> None:
    ev = json.loads((HERE / "evidence.json").read_text(encoding="utf-8"))
    e = next(x for x in ev if x["lemma_bw"] == "yad")
    c = client()
    m = c.messages.create(**writer_params(e))
    entry = json.loads(text_of(m))
    print("writer", m.stop_reason, m.usage.input_tokens, m.usage.output_tokens)
    print(json.dumps(entry, ensure_ascii=False))
    m = c.messages.create(**verifier_params(e, entry))
    print("verifier", m.stop_reason, m.usage.input_tokens, m.usage.output_tokens)
    print(text_of(m)[:900])


def run_batch(c, name: str, reqs: list[dict]) -> list:
    # The batch id is saved before polling, so a restart resumes this batch instead of paying again.
    id_file = HERE / f"{name}.batch"
    if id_file.exists():
        b = c.messages.batches.retrieve(id_file.read_text().strip())
        print(name, "resuming batch", b.id, flush=True)
    else:
        b = c.messages.batches.create(requests=reqs)
        id_file.write_text(b.id)
        print(name, "batch", b.id, "requests", len(reqs), flush=True)
    while True:
        b = c.messages.batches.retrieve(b.id)
        if b.processing_status == "ended":
            break
        time.sleep(45)
    print(name, "ended", b.request_counts, flush=True)
    return list(c.messages.batches.results(b.id))


def usage_dict(u) -> dict:
    return {
        "in": u.input_tokens or 0,
        "out": u.output_tokens or 0,
        "cw": getattr(u, "cache_creation_input_tokens", 0) or 0,
        "cr": getattr(u, "cache_read_input_tokens", 0) or 0,
    }


def collect(c, name: str, reqs: list[dict], key: str) -> dict:
    out = {}
    for r in run_batch(c, name, reqs):
        rec = {"type": r.result.type}
        if r.result.type == "succeeded":
            m = r.result.message
            rec |= {"stop": m.stop_reason, "usage": usage_dict(m.usage)}
            if m.stop_reason == "end_turn":
                try:
                    rec[key] = json.loads(text_of(m))
                except json.JSONDecodeError:
                    rec["bad_json"] = True
        out[r.custom_id] = rec
    return out


def save(name: str, data: dict) -> None:
    (HERE / name).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def load(name: str) -> dict:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def run() -> None:
    """Write, check, then re-check every correction. Each stage is saved, and a stage whose
    file already exists is not paid for twice, so a rerun resumes where it stopped."""
    ev = json.loads((HERE / "evidence.json").read_text(encoding="utf-8"))
    by = {e["id"]: e for e in ev}
    c = client()
    if (HERE / "writer.json").exists():
        written = load("writer.json")
    else:
        written = collect(c, "writer", [{"custom_id": e["id"], "params": writer_params(e)} for e in ev], "entry")
        save("writer.json", written)
    if (HERE / "verifier.json").exists():
        checked = load("verifier.json")
    else:
        reqs = [{"custom_id": k, "params": verifier_params(by[k], v["entry"])} for k, v in written.items() if "entry" in v]
        checked = collect(c, "verifier", reqs, "check")
        save("verifier.json", checked)
    if (HERE / "recheck.json").exists():
        rechecked = load("recheck.json")
    else:
        reqs = [
            {"custom_id": k, "params": verifier_params(by[k], v["check"]["corrected"])}
            for k, v in checked.items()
            if v.get("check", {}).get("verdict") == "needs_fix" and v["check"].get("corrected")
        ]
        rechecked = collect(c, "recheck", reqs, "check") if reqs else {}
        save("recheck.json", rechecked)
    report()
    if ALL_LEMMAS and not (HERE / "audit.json").exists():
        final = load("final.json")
        # A fresh check of a fixed random sample, across every status, to measure what remains.
        picked = sorted(by, key=lambda k: hashlib.md5(k.encode()).hexdigest())[:AUDIT_SIZE]
        reqs = [{"custom_id": k, "params": verifier_params(by[k], final[k]["entry"])} for k in picked if final[k]["entry"]]
        save("audit.json", collect(c, "audit", reqs, "check"))
    if (HERE / "audit.json").exists():
        audit_report()


def second() -> None:
    """A second full check of the final entries; corrections are re-checked once more.
    Operator decisions stay pinned: nasiya keeps "abandon, disregard" where Allah is the subject."""
    ev = json.loads((HERE / "evidence.json").read_text(encoding="utf-8"))
    by = {e["id"]: e for e in ev}
    final = load("final.json")
    pinned = {k for k, e in by.items() if e["lemma_bw"] == "nasiYa"}
    print("pinned", [by[k]["translit"] for k in pinned], flush=True)
    c = client()
    if (HERE / "second.json").exists():
        sec = load("second.json")
    else:
        reqs = [{"custom_id": k, "params": verifier_params(by[k], x["entry"])} for k, x in final.items() if k not in pinned]
        sec = collect(c, "second", reqs, "check")
        save("second.json", sec)
    if (HERE / "second_recheck.json").exists():
        rec = load("second_recheck.json")
    else:
        reqs = [
            {"custom_id": k, "params": verifier_params(by[k], v["check"]["corrected"])}
            for k, v in sec.items()
            if v.get("check", {}).get("verdict") == "needs_fix" and v["check"].get("corrected")
        ]
        rec = collect(c, "second_recheck", reqs, "check") if reqs else {}
        save("second_recheck.json", rec)
    out, verdicts = {}, Counter()
    for k, x in final.items():
        chk = sec.get(k, {}).get("check")
        out[k] = dict(x)
        if not chk or chk["verdict"] == "ok" or not chk.get("corrected"):
            verdicts["kept"] += 1
            continue
        re_chk = rec.get(k, {}).get("check")
        if re_chk and re_chk["verdict"] == "ok":
            out[k] = {"status": "corrected", "entry": chk["corrected"], "second_fixed": True}
            verdicts["changed"] += 1
        else:
            latest = (re_chk or {}).get("corrected") or chk["corrected"]
            out[k] = {"status": "flagged", "entry": latest, "second_fixed": True}
            verdicts["still_disputed"] += 1
    save("final2.json", out)
    spend = sum(cost(VERIFIER, r["usage"]) for d in (sec, rec) for r in d.values() if "usage" in r)
    print("second check verdicts:", dict(Counter((x.get("check") or {}).get("verdict") for x in sec.values())))
    print("outcome:", dict(verdicts), "| final statuses:", dict(Counter(x["status"] for x in out.values())))
    tiers = Counter()
    for k, x in out.items():
        if x.get("second_fixed"):
            r_ = by[k]["rank"]
            tiers["1-300" if r_ <= 300 else "301-1500" if r_ <= 1500 else "1501+"] += 1
    print("changed by tier:", dict(tiers), f"| cost ${spend:.2f}")
    print("mechanical failures:", [(by[k]["translit"], mech(by[k], x["entry"])) for k, x in out.items() if mech(by[k], x["entry"])][:10])


def audit_report() -> None:
    ev = {e["id"]: e for e in json.loads((HERE / "evidence.json").read_text(encoding="utf-8"))}
    final, audit = load("final.json"), load("audit.json")
    by_status = defaultdict(Counter)
    spend = 0.0
    lines = []
    for k, x in audit.items():
        spend += cost(VERIFIER, x["usage"]) if "usage" in x else 0.0
        chk = x.get("check")
        if not chk:
            continue
        by_status[final[k]["status"]][chk["verdict"]] += 1
        if chk["verdict"] == "needs_fix":
            e = ev[k]
            lines.append(f"#{e['rank']} {e['translit']} [{final[k]['status']}]: " + "; ".join(f"{s['gloss_id']} / {s['gloss_en']}" for s in final[k]["entry"]["senses"]))
            lines += [f"   ERR: {i['problem']}" for i in chk["issues"] if i["severity"] == "error"]
    print("audit by status:", {s: dict(c) for s, c in by_status.items()}, f"cost ${spend:.2f}")
    (HERE / "audit.txt").write_text("\n".join(lines), encoding="utf-8")


def cost(model: str, u: dict) -> float:
    i, o, r = PRICE[model]
    return 0.5 * (u["in"] * i + u["cw"] * i * 2 + u["cr"] * r + u["out"] * o) / 1e6


def mech(e: dict, entry: dict) -> list[str]:
    locs = {a["loc"] for a in e["ayat"]}
    probs = []
    if not 1 <= len(entry["senses"]) <= 4:
        probs.append(f"{len(entry['senses'])} senses")
    ar = re.compile(r"[؀-ۿ]")
    for s in entry["senses"]:
        bad = [x for x in s["ayat"] if x not in locs]
        if bad or not s["ayat"]:
            probs.append(f"citation outside sample {bad or 'none'}")
        for f in ("gloss_id", "gloss_en"):
            if not s[f].strip():
                probs.append("empty gloss")
            if ar.search(s[f]):
                probs.append("Arabic in gloss")
            if len(s[f].split()) > 6:
                probs.append(f"long gloss: {s[f]}")
    return probs


def finalise() -> dict:
    """The entry that ships for each lemma, with how it got there."""
    ev = json.loads((HERE / "evidence.json").read_text(encoding="utf-8"))
    w, v, r = load("writer.json"), load("verifier.json"), load("recheck.json")
    out = {}
    for e in ev:
        k = e["id"]
        draft = w.get(k, {}).get("entry")
        chk = v.get(k, {}).get("check")
        re_chk = r.get(k, {}).get("check")
        if draft is None or chk is None:
            out[k] = {"status": "missing", "entry": draft}
        elif chk["verdict"] == "ok":
            out[k] = {"status": "passed", "entry": draft}
        elif not chk.get("corrected"):
            out[k] = {"status": "flagged", "entry": draft}
        elif re_chk and re_chk["verdict"] == "ok":
            out[k] = {"status": "corrected", "entry": chk["corrected"]}
        else:
            # Disputed twice: keep the latest correction and list it for a human read.
            latest = (re_chk or {}).get("corrected") or chk["corrected"]
            out[k] = {"status": "flagged", "entry": latest}
    return out


def report() -> None:
    ev = json.loads((HERE / "evidence.json").read_text(encoding="utf-8"))
    w, v, r = load("writer.json"), load("verifier.json"), load("recheck.json")
    final = finalise()
    save("final.json", final)
    tiers = {t: {"n": 0, "w": 0.0, "v": 0.0} for t in TIERS}
    verdicts, sev, re_verdicts = Counter(), Counter(), Counter()
    per_tier = Counter()
    mech_fail = []
    for e in ev:
        k = e["id"]
        t = next(t for t in TIERS if t[0] <= e["rank"] <= t[1])
        tiers[t]["n"] += 1
        for rec, field, model in ((w, "w", WRITER), (v, "v", VERIFIER), (r, "v", VERIFIER)):
            if "usage" in rec.get(k, {}):
                tiers[t][field] += cost(model, rec[k]["usage"])
        chk = v.get(k, {}).get("check")
        if chk:
            verdicts[chk["verdict"]] += 1
            if chk["verdict"] == "needs_fix":
                per_tier[t] += 1
            for i in chk["issues"]:
                sev[i["severity"]] += 1
        if r.get(k, {}).get("check"):
            re_verdicts[r[k]["check"]["verdict"]] += 1
        if final[k]["entry"]:
            p = mech(e, final[k]["entry"])
            if p:
                mech_fail.append((e["rank"], e["translit"], p))
    print("results: writer", dict(Counter(x.get("type") for x in w.values())), "| verifier", dict(Counter(x.get("type") for x in v.values())))
    print("first check:", dict(verdicts), "| issues", dict(sev))
    print("needs_fix by rank tier:", {f"{t[0]}-{t[1]}": f"{per_tier[t]}/{tiers[t]['n']}" for t in TIERS})
    print("re-check of corrections:", dict(re_verdicts))
    print("final status:", dict(Counter(x["status"] for x in final.values())))
    print("mechanical failures in final entries:", len(mech_fail), mech_fail[:10])
    tw, tv = sum(x["w"] for x in tiers.values()), sum(x["v"] for x in tiers.values())
    print(f"cost: writer ${tw:.3f} checks ${tv:.3f} total ${tw + tv:.3f}")
    full = 0.0
    for t, x in tiers.items():
        if x["n"]:
            size = t[1] - t[0] + 1
            each = (x["w"] + x["v"]) / x["n"]
            print(f"  ranks {t[0]}-{t[1]}: n={x['n']} ${each:.4f} per lemma; all {size}: ${size * each:.1f}")
            full += size * each
    print(f"projected all 4,832: ${full:.1f}")
    lines = []
    for e in ev:
        k = e["id"]
        f = final[k]
        lines.append(f"\n#{e['rank']} {e['headword']} {e['translit']} {e['count']}x [{f['status']}]")
        for s in (f["entry"] or {}).get("senses", []):
            lines.append(f"  - {s['gloss_id']} / {s['gloss_en']}  [{', '.join(s['ayat'])}]")
        chk = v.get(k, {}).get("check") or {}
        for i in chk.get("issues", []):
            if i["severity"] == "error":
                lines.append(f"    ERR: {i['problem']}")
        for i in (r.get(k, {}).get("check") or {}).get("issues", []):
            if i["severity"] == "error":
                lines.append(f"    RE-ERR: {i['problem']}")
    (HERE / "review.txt").write_text("\n".join(lines), encoding="utf-8")
    print("wrote", HERE / "review.txt")


if __name__ == "__main__":
    {"build": build, "probe": probe, "run": run, "report": report, "second": second}[sys.argv[1]]()
