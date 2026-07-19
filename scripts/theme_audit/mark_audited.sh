#!/usr/bin/env bash
# Append this run's reviewed UUIDs to the canonical ledger (durable, de-duplicated,
# backed up), then sync the ledger to the prod host. Run ONLY after apply.sh succeeds.
#
# Usage: mark_audited.sh <run_dir> [ssh_host=dakwah]
# Env:   LEDGER (default ~/.dakwah/theme_audit/audited_uuids.txt)
#
# "Audited" == reviewed, whether or not it was corrected — so the next run's window
# filter skips it. The ledger lives OUTSIDE /tmp so it survives reboots (the previous
# ledger sat in /tmp, which is why it looked stale / at drift risk).
set -euo pipefail

RUN="${1:?run_dir required}"
HOST="${2:-dakwah}"
LEDGER="${LEDGER:-$HOME/.dakwah/theme_audit/audited_uuids.txt}"
test -s "$RUN/target_uuids.txt" || { echo "no target_uuids.txt in $RUN"; exit 1; }
mkdir -p "$(dirname "$LEDGER")"
touch "$LEDGER"

before=$(wc -l < "$LEDGER" | tr -d ' ')
cp "$LEDGER" "$LEDGER.bak.$(date +%Y%m%d%H%M%S)"
sort -u "$LEDGER" "$RUN/target_uuids.txt" > "$LEDGER.tmp"
mv "$LEDGER.tmp" "$LEDGER"
after=$(wc -l < "$LEDGER" | tr -d ' ')
echo "ledger: $before -> $after uuids (+$((after - before)))"

# Durable prod copy (survives container recreation; /tmp is only a mirror).
scp -q "$LEDGER" "$HOST:/tmp/audited_uuids.push"
ssh "$HOST" 'mkdir -p ~/theme_audit && cp /tmp/audited_uuids.push ~/theme_audit/audited_uuids.txt && cp /tmp/audited_uuids.push /tmp/audited_uuids.txt && echo "prod ledger: $(wc -l < ~/theme_audit/audited_uuids.txt | tr -d " ") uuids (~/theme_audit + /tmp mirror)"'
echo "✓ ledger updated + synced"
