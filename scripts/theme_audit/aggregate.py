#!/usr/bin/env python3
"""Aggregate subagent flags -> validated corrections.json + apply.sql.

Usage: python aggregate.py <run_dir> [--force]

Reads  <run_dir>/out/flags_*.json, valid_groups.json, target.jsonl, target_uuids.txt
Writes <run_dir>/corrections.json and <run_dir>/apply.sql

Resumability guard: every in/part_<stem>.jsonl must have a matching out/flags_<stem>.json.
If any are missing, corrections.json is still written for inspection but apply.sql is
withheld (unless --force) — so a half-finished fan-out never gets partially applied.
"""
import argparse
import glob
import json
import os
import re
from collections import Counter

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def stem(path: str, prefix: str) -> str:
    base = os.path.basename(path)
    return base[len(prefix):].rsplit(".", 1)[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    sp = a.run_dir

    valid = set(json.load(open(f"{sp}/valid_groups.json")))
    target_ids = {x.strip() for x in open(f"{sp}/target_uuids.txt") if x.strip()}
    cur = {}
    for line in open(f"{sp}/target.jsonl"):
        line = line.strip()
        if line:
            o = json.loads(line)
            cur[o["id"]] = o["tg"]

    parts = {stem(p, "part_") for p in glob.glob(f"{sp}/in/part_*.jsonl")}
    done = {stem(p, "flags_") for p in glob.glob(f"{sp}/out/flags_*.json")}
    missing = sorted(parts - done)
    print(f"batches: {len(parts)} | completed: {len(done)} | MISSING: {missing or 'none'}")

    corrections: dict[str, dict] = {}
    reviewed = 0
    notes: list[str] = []
    skipped: Counter = Counter()
    for ff in sorted(glob.glob(f"{sp}/out/flags_*.json")):
        try:
            data = json.load(open(ff))
        except Exception as e:
            print(f"  !! {os.path.basename(ff)} unparseable: {e}")
            skipped["bad_file"] += 1
            continue
        reviewed += int(data.get("reviewed", 0) or 0)
        nt = (data.get("_notes") or "").strip()
        if nt:
            notes.append(f"{os.path.basename(ff)}: {nt}")
        for fl in data.get("flags", []):
            i = (fl.get("id") or "").strip()
            to = (fl.get("to") or "").strip()
            reason = (fl.get("reason") or "").strip().replace("\n", " ")
            if not UUID.match(i):
                skipped["bad_uuid"] += 1
                continue
            if i not in target_ids:
                skipped["not_in_target"] += 1
                continue
            if to not in valid:
                skipped["bad_to"] += 1
                continue
            if to == cur.get(i):
                skipped["noop"] += 1
                continue
            if i in corrections:
                skipped["dupe"] += 1
                continue
            corrections[i] = {"id": i, "from": cur.get(i, fl.get("from", "")), "to": to, "reason": reason}

    corr = list(corrections.values())

    # ── null-coverage guard ──────────────────────────────────────────────
    # A null post that no subagent flagged stays null forever: mark_audited.sh
    # writes every reviewed post to the ledger, so future runs filter it out
    # as "already audited" and never look at it again. Batch-level coverage
    # above cannot see this — the batch is present and parseable, it just
    # declined to label some rows.
    #
    # Measured 2026-08-21: 1,445 posts across runs #128-#132 were marked
    # audited while still null, because AUDIT_INSTRUCTION.md's "be
    # conservative, leave borderline alone" rule was applied to nulls too.
    # For a null there is nothing to be conservative about; `Lainnya` is the
    # answer. Report the gap loudly and hold apply.sql unless forced.
    covered = set(corrections)
    null_uncovered = sorted(
        i for i, g in cur.items()
        if (g is None or str(g).strip() in ("", "(null)", "None")) and i not in covered
    )
    if null_uncovered:
        print(f"\n⚠️  NULL COVERAGE GAP: {len(null_uncovered)} null post(s) were "
              f"reviewed but left unlabelled.")
        print(f"    Marking these audited would strand them permanently null.")
        print(f"    ids -> {sp}/null_uncovered.txt   (label them, or exclude "
              f"them from mark_audited)")
        with open(f"{sp}/null_uncovered.txt", "w") as f:
            f.write("\n".join(null_uncovered) + "\n")
    else:
        # Clear any stale gap file from an earlier partial aggregate of this
        # same run. mark_audited.sh reads this file to decide what to hold
        # back, so leaving it behind after the gap closes would wrongly
        # withhold now-covered posts from the ledger — they'd be re-audited
        # from scratch next run. (Hit exactly this on audit#133: a mid-run
        # aggregate wrote 641 ids, all of which were covered by the end.)
        stale = f"{sp}/null_uncovered.txt"
        if os.path.exists(stale):
            os.remove(stale)
            print(f"  (cleared stale null_uncovered.txt — gap has since closed)")
        nulls_total = sum(
            1 for g in cur.values()
            if g is None or str(g).strip() in ("", "(null)", "None")
        )
        if nulls_total:
            print(f"\n✓ null coverage complete: all {nulls_total} null post(s) labelled")
    print(f"reviewed={reviewed} corrections={len(corr)} skipped={dict(skipped)}")
    print("--- transitions (from -> to : n) ---")
    for (frm, to), n in Counter((c["from"], c["to"]) for c in corr).most_common():
        print(f"  {n:4}  {frm} -> {to}")
    json.dump(corr, open(f"{sp}/corrections.json", "w"), ensure_ascii=False, indent=1)

    if missing and not a.force:
        print(f"\n✗ apply.sql withheld — {len(missing)} batch(es) missing: {missing}. "
              f"Re-run those batches, or pass --force to apply the partial set.")
        _print_notes(notes)
        return

    by_to: dict[str, list[str]] = {}
    for c in corr:
        by_to.setdefault(c["to"], []).append(c["id"])
    with open(f"{sp}/apply.sql", "w") as f:
        f.write("BEGIN;\n")
        for to, ids in sorted(by_to.items()):
            to_esc = to.replace("'", "''")
            idlist = ",".join(f"'{i}'" for i in ids)
            f.write(f"UPDATE social_posts SET theme_group = '{to_esc}' WHERE id IN ({idlist});\n")
        f.write("COMMIT;\n")
    print(f"\n✓ apply.sql written ({len(by_to)} UPDATE stmts, {len(corr)} rows)")
    _print_notes(notes)


def _print_notes(notes: list[str]) -> None:
    if notes:
        print("\n=== subagent _notes (candidate new GROUP_INTENT_HINTS rules) ===")
        for n in notes:
            print(" -", n)


if __name__ == "__main__":
    main()
