#!/usr/bin/env python3
"""Filter fetched posts to the UNAUDITED target and split into small batches.

Usage: python prepare.py <run_dir> [--ledger PATH] [--batch-size N] [--window-days D]

Reads   <run_dir>/posts.jsonl
Writes  <run_dir>/target.jsonl, <run_dir>/target_uuids.txt, <run_dir>/in/part_XX.jsonl
Prints  a manifest + a drift/size guard.

Batch size defaults to 175 (halved after audit#139: ~349-post batches died on the
64k output cap 4 times in 7; ~175-post halves died 0 times in 3).
What actually keeps a subagent under the 64k output-token cap is the no-narration
OUTPUT BUDGET contract in AUDIT_INSTRUCTION.md, NOT a small batch — the previous run
failed because subagents narrated per post, not because batches were large.
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
    # 175, halved from 350 after audit#139. Measured there: full ~349-post
    # batches passed 3 of 7 (4 died on the 64k output cap and had to be split
    # and re-run); the ~175-post halves passed 3 of 3. The mechanism is the
    # per-post output budget — 64000/349 ≈ 183 tokens/post vs 64000/175 ≈ 365.
    # The no-narration contract is still the primary guard, but at 350 a single
    # lapse loses the whole batch, and a lost batch costs more than two smaller
    # ones. Raise only if a run shows 175 is wastefully small.
    ap.add_argument("--batch-size", type=int, default=175)
    ap.add_argument("--window-days", type=int, default=7)  # informational; use whatever the operator asks for
    ap.add_argument(
        "--rescue-nulls",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="re-open rows that are marked audited but are STILL NULL (default on)",
    )
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

    # ── WHY AN AUDITED ROW CAN STILL BE TARGETED ─────────────────────
    # The ledger answers "has a reader looked at this?", which is NOT the
    # same as "does this row have a label". Audits #128-132 marked null
    # posts audited without labelling them; those rows are now sealed —
    # the ledger filter drops them from every future run, so they can
    # never self-heal. Measured 2026-09-13: 3,719 rows are marked audited
    # AND still NULL, up from the 1,445 first found.
    #
    # A NULL is a failure state (see fetch.sh), so "reviewed" is not a
    # terminal answer for one. Rows that are still null are therefore
    # re-opened regardless of ledger membership. Non-null rows keep the
    # normal de-dup: once a labelled post has been read, re-reading it is
    # the expensive no-op the ledger exists to prevent.
    # Pass --no-rescue-nulls for the old strict-ledger behaviour.
    def _is_null(o: dict) -> bool:
        tg = o.get("tg")
        return not tg or tg == "(null)"

    if a.rescue_nulls:
        target = [o for o in posts if o["id"] not in audited or _is_null(o)]
        rescued = sum(1 for o in posts if o["id"] in audited and _is_null(o))
    else:
        target = [o for o in posts if o["id"] not in audited]
        rescued = 0
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
    if rescued:
        print(f"  ↳ incl. {rescued} STRANDED (marked audited but still null) — re-opened")
    print(f"  ledger: {a.ledger} ({len(audited)} uuids)")
    print(f"  batches: {nb} x ~{per} posts (cap {a.batch_size})")
    if posts and len(posts) > 500 and pct < 20:
        print(f"  ⚠️  DRIFT: only {pct:.0f}% of this {a.window_days}d window is audited. "
              f"If you audit regularly most should already be in the ledger — verify the ledger "
              f"is the canonical file and that the last run actually persisted (the window itself "
              f"is fine; this flags a possibly-stale ledger, not a too-wide window).")


if __name__ == "__main__":
    main()
