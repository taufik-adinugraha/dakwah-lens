#!/usr/bin/env bash
# The single entry point for a sentiment relabel run.
#
# Usage: run.sh [window_days=14] [run_name]
#
# Scopes the outstanding work, pulls the text, and splits it into batches.
# Then dispatch one subagent per batch with BATCH_PROMPT.md, and call
# ingest.sh whenever batches land (it skips ones still being written).
#
# WHY NULLS ARE NOT DATE-SCOPED
# `sentiment_label` NULL means the Gemini call that sets it never completed —
# the same call that sets `theme_group`, which is why the two backlogs track
# each other. It is a failure state, not a value, so it does not age out of
# relevance. The window governs how far back to LOOK for new failures; any
# outstanding null older than that is still real work and is reported by
# `plan` so it cannot be forgotten.
#
# Claude-generated labels are marked by `sentiment_label IS NOT NULL AND
# sentiment_score IS NULL` — this pipeline never writes a score, so that
# predicate distinguishes hand-labelled rows from Gemini's.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DAYS="${1:-14}"
NAME="${2:-s$(date +%Y%m%d_%H%M)}"
RUN="$HOME/.dakwah/sent_relabel/runs/$NAME"
mkdir -p "$RUN/batches" "$RUN/labels" "$RUN/ingested"

echo "=== sentiment relabel  window=${DAYS}d  run=$RUN"

# 1. scope — ids needing a label, inside the window
ssh dakwah "docker exec -i dakwah-lens-postgres-1 psql -U dakwah -d dakwah_lens -At" <<SQL 2>/dev/null | grep -E '^[0-9a-f]' > "$RUN/ids.txt"
SELECT id::text FROM social_posts
WHERE sentiment_label IS NULL AND text IS NOT NULL AND length(text) >= 15
  AND greatest(posted_at, coalesce(created_at, posted_at)) >= now() - interval '${DAYS} days';
SQL
echo "in-window unlabelled: $(grep -c '' "$RUN/ids.txt")"

# 2. report what falls OUTSIDE the window so it is never silently dropped
ssh dakwah "docker exec -i dakwah-lens-postgres-1 psql -U dakwah -d dakwah_lens -At" <<SQL 2>/dev/null | grep -E '^[0-9]' | sed 's/^/older outstanding (outside window): /'
SELECT count(*) FROM social_posts
WHERE sentiment_label IS NULL AND text IS NOT NULL AND length(text) >= 15
  AND greatest(posted_at, coalesce(created_at, posted_at)) < now() - interval '${DAYS} days';
SQL

# 3. pull text for exactly those ids.
# The docker cp is NOT optional: prod deploys recreate the api container and
# wipe its /tmp, so /tmp/sr.py is routinely absent and `dump` would fail with a
# bare "No such file" halfway through a run.
scp -q "$RUN/ids.txt" "dakwah:~/sent_relabel/${NAME}_ids.txt"
ssh dakwah "docker cp ~/sent_relabel/sent_relabel.py dakwah-lens-api-1:/tmp/sr.py >/dev/null 2>&1; \
  cd ~/sent_relabel && docker exec -e PYTHONPATH=/app/src -i dakwah-lens-api-1 \
  /app/.venv/bin/python /tmp/sr.py dump < ${NAME}_ids.txt > ${NAME}_text.tsv 2>${NAME}.err; \
  wc -l < ${NAME}_text.tsv" 2>/dev/null | grep -E '^[0-9]+$' | sed 's/^/text rows: /'
scp -q "dakwah:~/sent_relabel/${NAME}_text.tsv" "$RUN/text.tsv"

# 4. split into batches of 500
python3 - "$RUN" <<'PY'
import os, sys
run = sys.argv[1]
rows = [l for l in open(f"{run}/text.tsv", encoding="utf-8").read().splitlines() if l.strip()]
SZ = 500
for i in range(0, len(rows), SZ):
    with open(f"{run}/batches/p{i//SZ:03d}", "w", encoding="utf-8") as f:
        f.write("\n".join(rows[i:i+SZ]) + "\n")
n = (len(rows) + SZ - 1) // SZ
print(f"batches: {n} x {SZ} (tail {len(rows) - (n-1)*SZ})" if n else "nothing to do")
PY

echo
echo "=== dispatch one subagent per batch (max 5 concurrent) with:"
echo "    $HERE/BATCH_PROMPT.md   {RUN}=$RUN  {TOOLKIT}=$HERE"
echo "=== then, whenever batches land:"
echo "    bash $HERE/ingest.sh $RUN"
