#!/usr/bin/env bash
# Ingest every COMPLETE label batch in a run, then verify and archive.
#
# Usage: ingest.sh <run_dir>
#
# Idempotent and safe to run at any moment: batches still being written are
# detected and skipped, so this can be called while agents are mid-flight.
#
# WHY THIS IS ONE SCRIPT AND NOT ONE PER RUN
# It used to be cloned per run (m14_ingest.sh, m14b_ingest.sh, m21_ingest.sh) by
# sed-ing the previous copy. The copies drifted: m21_ingest.sh shipped printing
# "M14B LEDGER" over m21's numbers, because that string was not in the sed. The
# run name is now a parameter, so there is one implementation to be correct.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="${1:?run_dir required}"
RUN="$(cd "$RUN" && pwd)"
NAME="$(basename "$RUN")"
TOTAL=$(cat "$RUN/batches"/* 2>/dev/null | grep -c '' || echo 0)
mkdir -p "$RUN/ingested" "$RUN/labels"

# ── select only batches that are COMPLETE ────────────────────────────────
PASS=$(python3 - "$RUN" "$HERE" <<'PY'
import glob, os, subprocess, sys
run, here = sys.argv[1], sys.argv[2]
ok, mid = [], []
for lf in sorted(glob.glob(f"{run}/labels/*.tsv")):
    bid = os.path.basename(lf)[:-4]
    r = subprocess.run([sys.executable, f"{here}/verify_batch.py", run, bid],
                       capture_output=True, text=True)
    (ok if r.returncode == 0 else mid).append(bid if r.returncode == 0
                                              else f"{bid}({r.stdout.strip()[:40]})")
print("PASS:", " ".join(ok) if ok else "none", "| incomplete:", " ".join(mid) if mid else "none",
      file=sys.stderr)
print("\n".join(ok))
PY
)
[ -n "$PASS" ] || { echo "nothing complete to ingest"; exit 0; }

# ── merge, guard against duplicate uuids, ship ───────────────────────────
STAMP=$(date +%Y%m%d_%H%M%S); M="${NAME}_merged_${STAMP}.tsv"
: > "$RUN/$M"
for b in $PASS; do awk -F'\t' 'NF>=2{print $1"\t"$2}' "$RUN/labels/$b.tsv" >> "$RUN/$M"; done
d=$(cut -f1 "$RUN/$M" | sort | uniq -d | wc -l | tr -d ' ')
[ "$d" = "0" ] || { echo "ABORT: $d duplicate uuid(s) in merge — refusing to write prod"; exit 1; }

scp -q "$RUN/$M" "dakwah:~/sent_relabel/labels/$M"
# Re-copy the prod script into the container first: deploys recreate it and wipe
# its /tmp, which would otherwise fail an ingest halfway through a wave.
ssh dakwah "docker cp ~/sent_relabel/sent_relabel.py dakwah-lens-api-1:/tmp/sr.py >/dev/null 2>&1; \
  cd ~/sent_relabel && \
  docker exec -e PYTHONPATH=/app/src -i dakwah-lens-api-1 /app/.venv/bin/python /tmp/sr.py ingest < labels/$M >> ${NAME}_done.txt && \
  docker exec -e PYTHONPATH=/app/src -i dakwah-lens-api-1 /app/.venv/bin/python /tmp/sr.py verify < labels/$M 2>&1 | tail -2 && \
  echo \"${NAME} LEDGER: \$(sort -u ${NAME}_done.txt | wc -l) of ${TOTAL}\"" 2>&1 \
  | grep -vE 'IDCloud|AUTHORIZED|Terminated|Activity is|https://|^\s*[_|\\/ ]+$'

for b in $PASS; do mv "$RUN/labels/$b.tsv" "$RUN/ingested/$b.tsv"; done
echo "archived: $(ls "$RUN/ingested" | wc -l | tr -d ' ') / $(ls "$RUN/batches" | wc -l | tr -d ' ')"
