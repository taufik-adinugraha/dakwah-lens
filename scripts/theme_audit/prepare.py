#!/usr/bin/env python3
"""Filter fetched posts to the UNAUDITED target and split into small batches.

Usage: python prepare.py <run_dir> [--ledger PATH] [--batch-size N] [--window-days D]

Reads   <run_dir>/posts.jsonl
Writes  <run_dir>/target.jsonl, <run_dir>/target_uuids.txt, <run_dir>/in/part_XX.jsonl
Prints  a manifest + a drift/size guard.

Batch size defaults to 175: small enough that even a 100%-correction batch's JSON
output stays far under the 64k subagent output-token cap (the failure that wrecked
the previous run), and the per-batch text read stays modest.
"""
import argparse
import json
import math
import os

DEF_LEDGER = os.path.expanduser("~/.dakwah/theme_audit/audited_uuids.txt")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--ledger", default=DEF_LEDGER)
    ap.add_argument("--batch-size", type=int, default=175)
    ap.add_argument("--window-days", type=int, default=2)  # informational, for the guard
    a = ap.parse_args()

    audited = set()
    if os.path.exists(a.ledger):
        audited = {x.strip() for x in open(a.ledger) if x.strip()}

    posts, seen = [], set()
    with open(os.path.join(a.run_dir, "posts.jsonl")) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            i = o.get("id")
            if not i or i in seen:
                continue
            seen.add(i)
            posts.append(o)

    target = [o for o in posts if o["id"] not in audited]
    already = len(posts) - len(target)

    os.makedirs(os.path.join(a.run_dir, "in"), exist_ok=True)
    os.makedirs(os.path.join(a.run_dir, "out"), exist_ok=True)
    with open(os.path.join(a.run_dir, "target.jsonl"), "w") as f:
        for o in target:
            f.write(json.dumps(o, ensure_ascii=False) + "\n")
    with open(os.path.join(a.run_dir, "target_uuids.txt"), "w") as f:
        for o in target:
            f.write(o["id"] + "\n")

    nb = max(1, math.ceil(len(target) / a.batch_size)) if target else 0
    per = math.ceil(len(target) / nb) if nb else 0
    for b in range(nb):
        chunk = target[b * per:(b + 1) * per]
        if not chunk:
            break
        with open(os.path.join(a.run_dir, "in", f"part_{b:02d}.jsonl"), "w") as f:
            for o in chunk:
                f.write(json.dumps(o, ensure_ascii=False) + "\n")

    pct = (already / len(posts) * 100) if posts else 0.0
    print(f"window posts (unique): {len(posts)}")
    print(f"  already audited (in ledger): {already} ({pct:.0f}%)")
    print(f"  UNAUDITED target: {len(target)}")
    print(f"  ledger: {a.ledger} ({len(audited)} uuids)")
    print(f"  batches: {nb} x ~{per} posts (cap {a.batch_size})")
    if posts and len(posts) > 500 and pct < 20:
        print(f"  ⚠️  DRIFT: only {pct:.0f}% of this {a.window_days}d window is audited. "
              f"If you run every 1-2 days most should already be audited — verify the ledger "
              f"is the canonical file and that the last run actually persisted.")
    if target and len(target) > a.batch_size * 20:
        print(f"  ⚠️  LARGE TARGET ({len(target)}): this is a big/costly run — "
              f"consider a shorter --window-days.")


if __name__ == "__main__":
    main()
