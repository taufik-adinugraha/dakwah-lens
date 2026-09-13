#!/usr/bin/env python3
"""Verify one batch's flags file against its own input.

Usage: verify_batch.py <run_dir> <NN>

Exists because a subagent's self-report is not evidence: agents in this
pipeline have reported success having written no file at all (m14b n017,
and three more in the 4d run of 2026-09-13 — two API timeouts and one
hang). The only trustworthy signal is the artifact on disk.

Checks, in the order they can fail:
  1. the file exists and parses
  2. every id traces back to the batch (no invented uuids)
  3. every `to` is a valid group string
  4. no null post was left unflagged   <- the stranding guard
"""
import json
import sys


def main() -> int:
    run, nn = sys.argv[1], sys.argv[2]
    src = f"{run}/in/part_{nn}.jsonl"
    dst = f"{run}/out/flags_{nn}.json"

    try:
        posts = [json.loads(ln) for ln in open(src) if ln.strip()]
    except OSError as e:
        print(f"FAIL: cannot read batch {src}: {e}")
        return 1
    try:
        flags = json.load(open(dst))
    except (OSError, json.JSONDecodeError) as e:
        print(f"FAIL: flags file missing or unparseable ({dst}): {e}")
        return 1
    flags = flags["flags"] if isinstance(flags, dict) else flags

    valid = set(json.load(open(f"{run}/valid_groups.json")))
    ids = {p["id"] for p in posts}
    nulls = {p["id"] for p in posts if not p.get("tg") or p["tg"] == "(null)"}
    got = {f["id"] for f in flags}

    orphan = got - ids
    if orphan:
        print(f"FAIL: {len(orphan)} flag id(s) are not in this batch, e.g. {sorted(orphan)[:3]}")
        return 1
    bad = sorted({f["to"] for f in flags if f.get("to") not in valid})
    if bad:
        print(f"FAIL: invalid group value(s): {bad[:5]}")
        return 1
    missed = nulls - got
    if missed:
        print(f"FAIL: {len(missed)} null post(s) left unflagged — they would be "
              f"stranded permanently. e.g. {sorted(missed)[:3]}")
        return 1

    print(f"OK batch {nn}: posts={len(posts)} nulls={len(nulls)} "
          f"flags={len(flags)} unflagged_nulls=0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
