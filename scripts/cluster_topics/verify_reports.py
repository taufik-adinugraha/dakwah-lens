#!/usr/bin/env python3
"""Verify the shard survey reports before any theme is authored from them.

Usage: python3 verify_reports.py <run_dir>          (exit 1 on any failure)

A survey agent's summary is not evidence (feedback_manual_pipelines_one_entry_point):
agents have reported success having written no file. This checks, per shard:
  - report_NN.md exists, is non-empty, and has at least one "## " cluster;
  - every token listed on a "tokens:" line is RE-COUNTED against body.txt, the same
    way the prompt's self-check counts it (occurrences as a substring vs as a whole
    word, case-insensitive), and flagged if it is inflated
    (word < 0.85 * sub) or if the agent's reported numbers are off by more than 10%.

Flags FIND; the author ADJUDICATES. An inflated token is dropped, a miscount is a
reason to distrust that report's other numbers — it is not proof the cluster is wrong.
"""
from __future__ import annotations

import glob
import os
import re
import sys

TOK = re.compile(r"([^,()]+?)\s*\(sub=(\d+)\s+word=(\d+)\)")
INFLATION = 0.85
TOLERANCE = 0.10


def main() -> int:
    run = sys.argv[1].rstrip("/")
    lines = [ln.lower() for ln in open(f"{run}/body.txt", encoding="utf-8")]
    shards = sorted(glob.glob(f"{run}/shards/shard_[0-9][0-9]"))
    bad = 0
    cache: dict[str, tuple[int, int]] = {}

    def count(tok: str) -> tuple[int, int]:
        if tok not in cache:
            w = re.compile(rf"(?<!\w){re.escape(tok)}(?!\w)")
            # OCCURRENCES, not lines: the prompt's `grep -oic` counts occurrences on
            # BSD grep (macOS). Counting lines here reported every agent as ~1.7x
            # over-counting when they were exact.
            cache[tok] = (sum(ln.count(tok) for ln in lines),
                          sum(len(w.findall(ln)) for ln in lines))
        return cache[tok]

    for sh in shards:
        nn = sh[-2:]
        rep = f"{run}/shards/report_{nn}.md"
        if not os.path.exists(rep) or os.path.getsize(rep) == 0:
            print(f"✗ report_{nn}.md missing or empty — re-run that shard")
            bad += 1
            continue
        text = open(rep, encoding="utf-8").read()
        clusters = len(re.findall(r"^## ", text, re.M))
        problems = []
        ntok = 0
        for tl in re.findall(r"^tokens:\s*(.+)$", text, re.M | re.I):
            for tok, rs, rw in TOK.findall(tl):
                tok = tok.strip().strip("`").lower()
                if not tok:
                    continue
                ntok += 1
                sub, word = count(tok)
                if sub and word < INFLATION * sub:
                    problems.append(f"INFLATED {tok!r} sub={sub} word={word}")
                rs, rw = int(rs), int(rw)
                off_sub = abs(rs - sub) > max(3, TOLERANCE * sub)
                off_word = abs(rw - word) > max(3, TOLERANCE * word)
                if off_sub or off_word:
                    problems.append(f"MISCOUNT {tok!r} reported {rs}/{rw}, actual {sub}/{word}")
        if not clusters or not ntok:
            print(f"✗ report_{nn}.md has {clusters} clusters / {ntok} tokens — malformed")
            bad += 1
            continue
        mark = "✓" if not problems else "!"
        print(f"{mark} report_{nn}.md  {clusters} clusters, {ntok} tokens")
        for p in problems:
            print(f"    {p}")
    missing = 0 if shards else 1
    if missing:
        print("✗ no shards found — run.sh did not shard this run")
    return 1 if bad or missing else 0


if __name__ == "__main__":
    sys.exit(main())
