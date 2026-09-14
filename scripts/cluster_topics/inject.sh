#!/usr/bin/env bash
# Stage 2: inject Claude-authored themes over the SAME corpus the sample came
# from, then report the assignment spread.
#
# Usage: inject.sh <run_dir>
set -euo pipefail
RUN="${1:?run_dir required}"; RUN="$(cd "$RUN" && pwd)"
NAME="$(basename "$RUN")"
[ -f "$RUN/themes.json" ] || { echo "missing $RUN/themes.json — author it first"; exit 1; }
# Gate on keyword distinctiveness before touching prod. A keyword that matches
# mostly inside other words produces a topic full of unrelated posts, and the
# damage is only visible afterwards in the per-theme counts.
HERE_CK="$(cd "$(dirname "$0")" && pwd)"
python3 "$HERE_CK/check_keywords.py" "$RUN" || {
  echo "ABORT: fix the flagged keywords, or re-run with the threshold relaxed deliberately"; exit 1; }
python3 -c "
import json,sys
d=json.load(open('$RUN/themes.json'))
t=d.get('themes') if isinstance(d,dict) else d
assert t, 'no themes'
for x in t:
    assert x.get('label'), 'a theme has no label'
    assert x.get('keywords'), f\"theme {x.get('label')!r} has no keywords\"
print(f'{len(t)} themes validated')
"
scp -q "$RUN/themes.json" "dakwah:/tmp/${NAME}.themes.json"
scp -q "$RUN/posts.jsonl" "dakwah:/tmp/${NAME}.posts.jsonl"
ssh dakwah "docker cp /tmp/${NAME}.posts.jsonl dakwah-lens-api-1:/tmp/ >/dev/null && \
  docker cp /tmp/${NAME}.themes.json dakwah-lens-api-1:/tmp/ >/dev/null && \
  docker exec -e PYTHONPATH=/app/src -i dakwah-lens-api-1 /app/.venv/bin/python \
    -m api.scripts.cluster_topics inject /tmp/${NAME}.posts.jsonl /tmp/${NAME}.themes.json" 2>&1 \
  | grep -vE 'IDCloud|AUTHORIZED|Terminated|Activity is|https://|^\s*[_|\\/ ]+$'
