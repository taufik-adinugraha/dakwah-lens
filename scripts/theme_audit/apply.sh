#!/usr/bin/env bash
# Apply validated theme_group corrections to prod, in a single transaction.
#
# Usage: apply.sh <run_dir> [ssh_host=dakwah]
# Requires <run_dir>/apply.sql (produced by aggregate.py). apply.sql wraps its
# UPDATEs in BEGIN/COMMIT; ON_ERROR_STOP=1 makes any failure roll the whole thing back.
set -euo pipefail

RUN="${1:?run_dir required}"
HOST="${2:-dakwah}"
test -s "$RUN/apply.sql" || { echo "no apply.sql in $RUN — run aggregate.py first"; exit 1; }
rm -f "$RUN/applied.ok"

echo "applying $(grep -c '^UPDATE' "$RUN/apply.sql") UPDATE statements to prod ..."
scp -q "$RUN/apply.sql" "$HOST:/tmp/theme_audit_apply.sql"
ssh "$HOST" "docker exec -i dakwah-lens-postgres-1 psql -U dakwah -d dakwah_lens -v ON_ERROR_STOP=1 -f /dev/stdin < /tmp/theme_audit_apply.sql"
# mark_audited.sh refuses without this marker: a failed apply followed by a
# mark seals still-NULL posts into the ledger (2026-10-04: scp dropped, 442 sealed).
shasum "$RUN/apply.sql" | cut -d' ' -f1 > "$RUN/applied.ok"
echo "✓ applied"
