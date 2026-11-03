#!/usr/bin/env python3
"""Builds content/kosakata/ from the pinned sources and authored/kosakata_meanings.json. kosakata.py
has the format and the rules. Run from belajar/pipeline after fetch.py, and again whenever the
meanings change:

    python3 build_kosakata.py                     # write content/kosakata/
    python3 build_kosakata.py --check             # exit 1 if the files differ from a fresh build
    python3 build_kosakata.py --check --no-corpus # CI: exit 1 unless the files match the meanings
                                                  # and sources.json's pins (no cache needed)

Deterministic, stdlib only, no network, no LLM. A gap writes nothing and exits 1.
"""
from __future__ import annotations

import argparse
import sys

import kosakata as K
from common import load_sources


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="compare with the files on disk; write nothing")
    ap.add_argument("--no-corpus", action="store_true", help="with --check: only what the committed files can show")
    args = ap.parse_args()
    if args.no_corpus and not args.check:
        ap.error("--no-corpus goes with --check (writing the files needs the corpus)")
    authored = K.load_authored()
    sha = K.authored_sha()
    if args.check and args.no_corpus:
        errs = K.problems(K.load_files(), authored, sha, load_sources())
    elif args.check:
        corpus, segs = K.load_corpus_and_qac()
        errs = K.corpus_problems(K.load_files(), authored, sha, corpus, segs, K.lexeme_ids())
    else:
        corpus, segs = K.load_corpus_and_qac()
        try:
            files = K.build(authored, sha, corpus, segs, K.lexeme_ids())
        except ValueError as e:
            print(e, file=sys.stderr)
            return 1
        errs = K.authored_problems(authored)
        if errs:
            print("not written:\n  " + "\n  ".join(errs[:30]), file=sys.stderr)
            return 1
        K.write_files(files)
        rows = files["index.json"]["rows"]
        print(f"wrote {len(files)} files: {len(rows)} words, {sum(len(f['ayat']) for n, f in files.items() if n.startswith('ayat-'))} ayat")
        return 0
    if errs:
        print("out of date:\n  " + "\n  ".join(errs[:30]), file=sys.stderr)
        return 1
    print("content/kosakata is up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
