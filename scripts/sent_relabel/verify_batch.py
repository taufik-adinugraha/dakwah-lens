#!/usr/bin/env python3
"""Verify one sentiment batch's label file against its own input.

Usage: verify_batch.py <run_dir> <batch_id>

Exists because a subagent's self-report is not evidence. Measured failures in
this pipeline: batch n017 reported "DONE n017 500 120/197/183" having written
no file at all; three agents in the 4d theme run died mid-flight (two API
timeouts, one hang) with zero bytes written and no error surfaced.

Checks, in the order they can fail:
  1. the file exists
  2. line count matches the batch EXACTLY (the tail batch is short)
  3. uuids match the batch verbatim AND in order (a dropped line misaligns
     every label after it onto the wrong post — silent and unrecoverable)
  4. every label is in the vocabulary
"""
import sys


def main() -> int:
    run, bid = sys.argv[1], sys.argv[2]
    src, dst = f"{run}/batches/{bid}", f"{run}/labels/{bid}.tsv"

    try:
        raw = open(src, encoding="utf-8").read().splitlines()
        want = [ln.split("\t", 1)[0] for ln in raw if ln.strip()]
    except OSError as e:
        print(f"FAIL: cannot read batch {src}: {e}")
        return 1
    try:
        lines = [ln for ln in open(dst, encoding="utf-8").read().splitlines() if ln.strip()]
    except OSError as e:
        print(f"FAIL: label file missing ({dst}): {e}")
        return 1

    if len(lines) != len(want):
        print(f"FAIL: {len(lines)} lines written, batch has {len(want)}")
        return 1
    got = [ln.split("\t")[0].strip() for ln in lines]
    if got != want:
        bad = next(
            (i for i, (a, b) in enumerate(zip(got, want, strict=True)) if a != b), 0
        )
        print(f"FAIL: uuid mismatch at line {bad + 1} — every label after it is on the wrong post")
        return 1
    labs = [ln.split("\t")[1].strip().lower() if "\t" in ln else "" for ln in lines]
    invalid = sorted({x for x in labs if x not in ("positive", "neutral", "negative")})
    if invalid:
        print(f"FAIL: invalid label(s): {invalid[:5]}")
        return 1

    p, n, g = labs.count("positive"), labs.count("neutral"), labs.count("negative")
    print(f"OK {bid}: {len(lines)} lines, {p}/{n}/{g} positive/neutral/negative")
    return 0


if __name__ == "__main__":
    sys.exit(main())
