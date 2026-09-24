"""Detect label MISALIGNMENT that verify_batch.py cannot see.

Usage: python check_alignment.py <run_dir> [NN ...]     (exit 1 on any SHIFT)
       imported by aggregate.py, which withholds apply.sql on a SHIFT

WHY THIS EXISTS
verify_batch.py checks coverage and counts: every null has a flag, nothing is
invented. It cannot check that each flag is attached to the RIGHT post.

About half the batch agents build their flags by zipping an ordered list of
decisions onto the batch file's ids by POSITION. That guarantees the ids are
verbatim, but if the decision list gains or loses one entry partway through,
every label after that point lands on the neighbouring post — and because the
counts still match, verify_batch prints OK. On 2026-09-24 one agent reported
exactly this near-miss (170 decisions for 171 posts, caught before writing).

Two complementary checks:

1. OFFSET. A post's label should agree with a keyword guess made from ITS OWN
   text more often than with the guess made from a neighbour's. Aligned
   batches peak at offset 0; a batch shifted by k peaks at k.
2. RARE-LABEL ANCHORS. A label used only a handful of times in a batch
   (Teknologi & AI, Toleransi & Lintas-Iman ...) that lands on exactly the post
   it describes proves that stretch is aligned — it cannot land right by
   chance. Decisive where OFFSET has no power: a batch that is mostly one
   cluster, where neighbours share a label anyway (so a shift there also does
   little damage).

VERDICTS
  aligned     offset 0 is the peak, or no other offset beats it by MARGIN
  low_signal  too few keyword hits to judge — anchors printed for a human read
  SHIFT       another offset beats 0 by >= MARGIN with enough hits: labels are
              almost certainly on the wrong posts. aggregate.py blocks on this.

Tuned on the 2026-09-24 run (33 batches, all aligned). Two false alarms shaped
the rules: batch 22 read "peak at -1" on a 25%/25% tie over n=4 (hence
tie-break toward 0 and MIN_N), and batch 13 read low absolute agreement because
its agent routed keyword-bearing shitposts to Lainnya on substance (hence the
verdict turns on WHERE the peak is, never on its height).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from collections import Counter

# High-precision cues only. A cue that is wrong on a post is fine — the check
# compares offsets against each other, so a constant error cancels out.
KW: list[tuple[str, str]] = [
    (r"\b(bmkg|gempa|banjir|karhutla|longsor|erupsi|tenggelam|kebakaran hutan)\b",
     "Lingkungan & Bencana"),
    (r"\b(kpk|tersangka|ditangkap|diringkus|dakwaan|terdakwa|narkoba|sabu|begal)\b",
     "Hukum & Keadilan"),
    (r"\b(judol|judi online|pinjol|slot gacor|gestun)\b", "Patologi Sosial Digital"),
    (r"\b(timnas|liga 1|persib|persija|gol|skor akhir)\b", "Lainnya"),
    (r"\b(ihsg|rupiah|inflasi|bank indonesia|harga beras|saham)\b", "Ekonomi & Bisnis"),
]
OFFSETS = (-2, -1, 0, 1, 2)
MIN_N = 8        # below this, offset agreement is noise, not evidence
MARGIN = 0.15    # a shift must BEAT offset 0 by this much, not merely tie it
RARE_MAX = 4     # a label used at most this many times in a batch is an anchor
ANCHOR_SHOW = 12


def _guess(text: str) -> str | None:
    for pat, group in KW:
        if re.search(pat, text, re.I):
            return group
    return None


def batch_stems(run_dir: str) -> list[str]:
    """Same four patterns aggregate.py uses: part_NN, part_NNN, and their
    lettered split halves. A chunk file (part_NN_chunk_N) is not a batch."""
    pats = ("[0-9][0-9]", "[0-9][0-9][0-9]", "[0-9][0-9][a-z]", "[0-9][0-9][0-9][a-z]")
    out = set()
    for p in pats:
        for f in glob.glob(f"{run_dir}/out/flags_{p}.json"):
            out.add(os.path.basename(f)[len("flags_"):-len(".json")])
    return sorted(out)


def check_batch(run_dir: str, nn: str) -> dict:
    """Verdict for one batch. Never raises on a half-written flags file — that
    is 'still being written', reported, not a crash."""
    try:
        rows = [json.loads(line) for line in open(f"{run_dir}/in/part_{nn}.jsonl",
                                                  encoding="utf-8") if line.strip()]
        flags = json.load(open(f"{run_dir}/out/flags_{nn}.json", encoding="utf-8"))["flags"]
    except (OSError, json.JSONDecodeError, KeyError) as e:
        return {"batch": nn, "verdict": "unreadable", "error": str(e)}

    lab = {f["id"]: f["to"] for f in flags}
    # A post that already carried a correct group has no flag; its label is its
    # current value. Include it, or a long run of such posts reads as a hole.
    for r in rows:
        if r["id"] not in lab and r.get("tg") not in (None, "", "(null)"):
            lab[r["id"]] = r["tg"]

    ids = [r["id"] for r in rows]
    guesses = [_guess(r.get("text", "")) for r in rows]
    res: dict[int, tuple[float, int]] = {}
    for off in OFFSETS:
        hit = tot = 0
        for i, pid in enumerate(ids):
            j = i + off
            if pid not in lab or not 0 <= j < len(ids) or guesses[j] is None:
                continue
            tot += 1
            hit += lab[pid] == guesses[j]
        res[off] = (hit / tot if tot else 0.0, tot)

    best = max(OFFSETS, key=lambda o: (res[o][0], o == 0))
    n0 = res[0][1]
    if n0 < MIN_N:
        verdict = "low_signal"
    elif best != 0 and res[best][0] - res[0][0] >= MARGIN:
        verdict = "SHIFT"
    else:
        verdict = "aligned"

    counts = Counter(lab.get(pid) for pid in ids if pid in lab)
    anchors = [
        (i, lab[pid], rows[i].get("text", "")[:80])
        for i, pid in enumerate(ids)
        if pid in lab and counts[lab[pid]] <= RARE_MAX
    ]
    return {"batch": nn, "verdict": verdict, "best": best, "n": n0,
            "rates": {o: res[o][0] for o in OFFSETS}, "anchors": anchors}


def check_run(run_dir: str, stems: list[str] | None = None) -> list[dict]:
    return [check_batch(run_dir, nn) for nn in (stems or batch_stems(run_dir))]


def report(results: list[dict], *, show_anchors_for=("low_signal", "SHIFT")) -> None:
    c = Counter(r["verdict"] for r in results)
    print(f"alignment: {c.get('aligned', 0)} aligned, {c.get('low_signal', 0)} "
          f"low-signal, {c.get('SHIFT', 0)} SHIFT, {c.get('unreadable', 0)} unreadable")
    for r in results:
        v = r["verdict"]
        if v == "unreadable":
            print(f"  batch {r['batch']}: unreadable ({r['error'][:60]}) — still being written?")
            continue
        if v not in show_anchors_for:
            continue
        rates = "  ".join(f"{o:+d}:{r['rates'][o]:.0%}" for o in OFFSETS)
        if v == "SHIFT":
            print(f"  ✗ batch {r['batch']}: labels peak at offset {r['best']:+d} "
                  f"(n={r['n']})  [{rates}]")
            print(f"    labels are likely on the WRONG posts. Rebuild flags_{r['batch']}"
                  f".json by id, not by position, then re-run.")
        else:
            print(f"  ? batch {r['batch']}: low signal (n={r['n']}) — read these; each "
                  f"label should fit ITS OWN post:")
        for i, label, text in r["anchors"][:ANCHOR_SHOW]:
            print(f"      #{i:3d} [{label[:24]:24s}] {text!r}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("batches", nargs="*", help="batch stems, e.g. 04 13; default all")
    a = ap.parse_args()
    results = check_run(a.run_dir.rstrip("/"), a.batches or None)
    report(results)
    return 1 if any(r["verdict"] == "SHIFT" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
