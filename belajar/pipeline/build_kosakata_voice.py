#!/usr/bin/env python3
"""Pins Quran.com's recording of one place for every word in the Kosakata list (kosakata_voice.py has
the rule), of the places Level 0 plays, and of the places the test's ayah questions play where the
word's own recording is not the marked token. Run from belajar/pipeline:

    python3 build_kosakata_voice.py --fetch [--max-rank N]   # read-only downloads, then writes the pins
    python3 build_kosakata_voice.py --check                  # the rule's places against the pins (needs cache)
    python3 build_kosakata_voice.py --check --no-corpus      # CI: the pins alone
    python3 build_kosakata_voice.py --upload-list            # every copy against its pin, then the list to upload

--fetch reads Quran.com's word list by surah (api.quran.com) to confirm each file number is the word,
downloads each chosen file into out/upstream/quran-com/wbw/ unaltered, and measures it. A file already
there is not fetched again. It never writes to the server: host_media.py --deliver prints the upload.
No LLM, no paid API.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import kosakata as K
import kosakata_path as P
import kosakata_voice as V
from build_wordvoice import QC_CACHE, UA, word_span

CHAPTERS = Path(__file__).resolve().parent / "out" / "upstream" / "quran-com" / "chapters"
API = "https://api.quran.com/api/v4/verses/by_chapter/{ch}?words=true&word_fields=text_uthmani&per_page=50&page={page}"
THREADS = 4  # a public CDN, and nothing here is urgent


def get(url: str, tries: int = 4) -> bytes:
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404 or i == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if i == tries - 1:
                raise
        time.sleep(2 ** i)
    raise AssertionError


def chapter_words(ch: int) -> dict[str, list[str]]:
    """{"s:a": [Quran.com's text of each word]}, words only, in its order. Kept on disk."""
    CHAPTERS.mkdir(parents=True, exist_ok=True)
    f = CHAPTERS / f"{ch:03d}.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    out: dict[str, list[str]] = {}
    page: int | None = 1
    while page:
        data = json.loads(get(API.format(ch=ch, page=page)))
        for v in data["verses"]:
            out[v["verse_key"]] = [w["text_uthmani"] for w in v["words"] if w.get("char_type_name") == "word"]
        page = data["pagination"].get("next_page")
        time.sleep(0.15)
    f.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def fetch(max_rank: int | None) -> int:
    corpus, segs = K.load_corpus_and_qac()
    table = K.lemma_table(segs, corpus.T)
    wanted = V.places(segs, corpus.T, K.headword)
    missing = [e["lemma"] for e in table if e["lemma"] not in wanted]
    if missing:
        print(f"no usable place for {missing}", file=sys.stderr)
        return 1
    scope = [e for e in table if max_rank is None or e["rank"] <= max_rank]
    surahs = sorted({int(wanted[e["lemma"]]["loc"].split(":")[0]) for e in scope})
    words: dict[str, list[str]] = {}
    for ch in surahs:
        words.update(chapter_words(ch))
    print(f"{len(scope)} words, Quran.com's word lists of {len(surahs)} surahs read", flush=True)
    QC_CACHE.mkdir(parents=True, exist_ok=True)

    def one(e: dict) -> tuple[str, dict | None, str | None]:
        w = wanted[e["lemma"]]
        s, a, n = w["loc"].split(":")
        listed = words.get(f"{s}:{a}") or []
        if int(n) > len(listed):
            return e["lemma"], None, f"Quran.com has {len(listed)} words in {s}:{a}, not word {n}"
        f = QC_CACHE / V.upstream_of(w["loc"]).rsplit("/", 1)[1]
        if not f.exists():
            try:
                f.write_bytes(get(V.upstream_of(w["loc"])))
            except urllib.error.HTTPError as err:
                return e["lemma"], None, f"{V.upstream_of(w['loc'])}: HTTP {err.code}"
        body = f.read_bytes()
        ms, start, end = word_span(f)
        pin = {"loc": w["loc"], "form": w["form"], "qc_text": listed[int(n) - 1], "sha256": hashlib.sha256(body).hexdigest(),
               "bytes": len(body), "ms": ms, "start": start, "end": end}
        if w["final"]:
            pin["final"] = True
        return e["lemma"], pin, None

    pins = V.load_pins()
    errs: list[str] = []
    done = 0
    with ThreadPoolExecutor(THREADS) as pool:
        for lem, pin, err in pool.map(one, scope):
            done += 1
            if err:
                errs.append(f"{lem}: {err}")
            else:
                pins["words"][lem] = pin
            if done % 500 == 0:
                print(f"  {done} of {len(scope)}", flush=True)
    # Level 0 plays other places: each word's part, which no lemma's rule would choose.
    tokens, _ = V.counted_alike(corpus.T, segs)
    places = P.part_places(P.load_parts())
    for ch in sorted({int(loc.split(":")[0]) for loc in places}):
        words.update(chapter_words(ch))

    def one_part(loc: str) -> tuple[str, dict | None, str | None]:
        s, a, n = (int(x) for x in loc.split(":"))
        listed = words.get(f"{s}:{a}") or []
        if (s, a) not in tokens or n > len(listed):
            return loc, None, f"{loc}: not a word both Tanzil and Quran.com have"
        f = QC_CACHE / V.upstream_of(loc).rsplit("/", 1)[1]
        if not f.exists():
            f.write_bytes(get(V.upstream_of(loc)))
        body = f.read_bytes()
        ms, start, end = word_span(f)
        return loc, {"loc": loc, "form": tokens[(s, a)][n - 1], "qc_text": listed[n - 1], "sha256": hashlib.sha256(body).hexdigest(),
                     "bytes": len(body), "ms": ms, "start": start, "end": end}, None

    pins.setdefault("parts", {})
    with ThreadPoolExecutor(THREADS) as pool:
        for loc, pin, err in pool.map(one_part, places):
            if err:
                errs.append(err)
            else:
                pins["parts"][loc] = pin
    # The test's ayah questions play the marked word: where the word's own recording is not spelt as the
    # marked token, that place's own recording (kosakata.example_recordings decides, kosakata_voice.py says why).
    wanted_examples = K.example_recordings(table, K.load_authored()["lemmas"], K.lemma_positions(segs), corpus, tokens, pins["words"])
    for ch in sorted({int(loc.split(":")[0]) for loc in wanted_examples}):
        words.update(chapter_words(ch))

    def one_example(item: tuple[str, str]) -> tuple[str, dict | None, str | None]:
        loc, form = item
        s, a, n = (int(x) for x in loc.split(":"))
        listed = words.get(f"{s}:{a}") or []
        if n > len(listed):
            return loc, None, f"example at {loc}: Quran.com has {len(listed)} words in {s}:{a}, not word {n}"
        f = QC_CACHE / V.upstream_of(loc).rsplit("/", 1)[1]
        if not f.exists():
            try:
                f.write_bytes(get(V.upstream_of(loc)))
            except urllib.error.HTTPError as err:
                return loc, None, f"example at {loc}: {V.upstream_of(loc)}: HTTP {err.code}"
        body = f.read_bytes()
        ms, start, end = word_span(f)
        return loc, {"loc": loc, "form": form, "qc_text": listed[n - 1], "sha256": hashlib.sha256(body).hexdigest(),
                     "bytes": len(body), "ms": ms, "start": start, "end": end}, None

    pins["examples"] = {}
    with ThreadPoolExecutor(THREADS) as pool:
        for n_done, (loc, pin, err) in enumerate(pool.map(one_example, wanted_examples.items()), 1):
            if err:
                errs.append(err)
            else:
                pins["examples"][loc] = pin
            if n_done % 200 == 0:
                print(f"  {n_done} of {len(wanted_examples)} example places", flush=True)
    pins["_comment"] = ("Written by pipeline/build_kosakata_voice.py --fetch: for each word of the Kosakata list, the one place whose Quran.com "
                        "recording it plays (the rule is in kosakata_voice.py), what Quran.com calls that word, and the file's sha256 and length; "
                        "`parts` the places Level 0 plays; `examples` the places the test's ayah questions play where the word's own recording is not the "
                        "marked token. Never edited by hand.")
    pins["words"] = dict(sorted(pins["words"].items()))
    pins["parts"] = dict(sorted(pins["parts"].items()))
    pins["examples"] = dict(sorted(pins["examples"].items()))
    V.PINS.write_text(json.dumps(pins, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    problems = V.pin_problems(pins, None, wanted_examples)
    size = sum(p["bytes"] for p in [*pins["words"].values(), *pins["parts"].values(), *pins["examples"].values()])
    print(f"pinned {len(pins['words'])} words, {len(pins['parts'])} places of Level 0 and {len(pins['examples'])} of the ayah questions, {size / 1e6:.1f} MB; {len(errs)} failed, {len(problems)} pin problems", flush=True)
    for line in (errs + problems)[:40]:
        print("  " + line, file=sys.stderr)
    return 1 if errs or problems else 0


def upload_list() -> int:
    """Writes out/upstream/files-kosakata.txt, the paths under the media store's narration/, once every
    local copy is its pin byte for byte. The copies are uploaded from here rather than through
    host_media.py --deliver, which also wants the imam's ayah files on this machine and copies 289 MB
    a second time. Prints the upload; never runs it."""
    pins = V.load_pins()
    words = {
        **pins["words"],
        **{f"part at {k}": v for k, v in (pins.get("parts") or {}).items()},
        **{f"example at {k}": v for k, v in (pins.get("examples") or {}).items()},
    }
    root = QC_CACHE.parents[1]
    bad, listed = [], []
    for lem, p in sorted(words.items(), key=lambda kv: kv[1]["loc"]):
        name = V.upstream_of(p["loc"]).rsplit("/", 1)[1]
        f = QC_CACHE / name
        if not f.exists():
            bad.append(f"{lem}: {f} is missing (--fetch)")
        elif hashlib.sha256(f.read_bytes()).hexdigest() != p["sha256"]:
            bad.append(f"{lem}: {f} is not its pin")
        else:
            if f"quran-com/wbw/{name}" not in listed:
                listed.append(f"quran-com/wbw/{name}")
    if bad:
        print(f"{len(bad)} problem(s):\n  " + "\n  ".join(bad[:30]), file=sys.stderr)
        return 1
    out = root / "files-kosakata.txt"
    out.write_text("\n".join(listed) + "\n", encoding="utf-8")
    print(f"{len(listed)} files, each its pin byte for byte, {sum(p['bytes'] for p in words.values()) / 1e6:.1f} MB: {out}")
    print(f"upload (not run): cd {root} && COPYFILE_DISABLE=1 tar --no-mac-metadata -cf - -T files-kosakata.txt | ssh <vm-host> "
          "'sudo -n -u deploy tar -x --skip-old-files -C /srv/dakwah-lens/data/belajar-media/narration'")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--no-corpus", action="store_true")
    ap.add_argument("--max-rank", type=int)
    ap.add_argument("--upload-list", action="store_true")
    a = ap.parse_args()
    if a.fetch:
        return fetch(a.max_rank)
    if a.upload_list:
        return upload_list()
    pins = V.load_pins()
    if a.no_corpus:
        errs = V.pin_problems(pins)
    else:
        corpus, segs = K.load_corpus_and_qac()
        tokens, _ = V.counted_alike(corpus.T, segs)
        wanted_examples = K.example_recordings(
            K.lemma_table(segs, corpus.T), K.load_authored()["lemmas"], K.lemma_positions(segs), corpus, tokens, pins["words"]
        )
        errs = V.pin_problems(pins, V.places(segs, corpus.T, K.headword), wanted_examples)
    if errs:
        print(f"{len(errs)} problem(s):\n  " + "\n  ".join(errs[:40]), file=sys.stderr)
        return 1
    print(f"kosakata voice: {len(pins['words'])} words pinned, every check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
