#!/usr/bin/env python3
"""Checks content/kosakata/ against the meanings file, the sources' pins and, unless --no-corpus,
a fresh build from pipeline/cache (which is git-ignored, so CI runs the corpus-free half). Exit 1 on
any problem. Stdlib only, no network, no LLM.

    python3 validate_kosakata.py               # with pipeline/cache (local)
    python3 validate_kosakata.py --no-corpus   # CI
"""
from __future__ import annotations

import sys

import kosakata as K
from common import load_sources


def main() -> int:
    no_corpus = "--no-corpus" in sys.argv
    authored = K.load_authored()
    sha = K.authored_sha()
    files = K.load_files()
    errs = K.problems(files, authored, sha, load_sources())
    if not no_corpus:
        corpus, segs = K.load_corpus_and_qac()
        errs += K.corpus_problems(files, authored, sha, corpus, segs, K.lexeme_ids())
    if errs:
        print(f"{len(errs)} problem(s):\n  " + "\n  ".join(errs[:40]), file=sys.stderr)
        return 1
    rows = files["index.json"]["rows"]
    print(f"kosakata: {len(rows)} words, {len(files)} files, every check passed" + (" (corpus-free half)" if no_corpus else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
