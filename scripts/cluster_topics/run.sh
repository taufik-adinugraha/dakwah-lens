#!/usr/bin/env bash
# The single entry point for a manual (pure-Claude) topic clustering run.
#
# Usage: run.sh [run_name]
#
# Stage 1 here; Stage 2 is inject.sh once you have written the themes JSON.
# `cluster_topics` itself already has one implementation with subcommands —
# what was ad hoc was the ORCHESTRATION around it: where the sample lands,
# where the posts cache lands, and what the Claude step is actually asked to
# produce. Those are fixed here so a run is never reassembled from memory.
#
# NO GEMINI. Themes are authored by Claude reading the sample; `inject` runs
# assignment by embedding cosine only (feedback_no_gemini_for_audit /
# project_manual_topic_clustering).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="${1:-c$(date +%Y%m%d_%H%M)}"
RUN="$HOME/.dakwah/cluster_topics/runs/$NAME"
mkdir -p "$RUN"

echo "=== manual topic clustering  run=$RUN"
ssh dakwah "cd ~ && docker exec -e PYTHONPATH=/app/src -i dakwah-lens-api-1 \
  /app/.venv/bin/python -m api.scripts.cluster_topics dump-sample -o /tmp/${NAME}.md" 2>&1 \
  | grep -vE 'IDCloud|AUTHORIZED|Terminated|Activity is|https://|^\s*[_|\\/ ]+$'

# Both artefacts must come back: the sample (what Claude reads) and the posts
# cache (what inject replays). Losing the cache means re-dumping and getting a
# DIFFERENT corpus, so the themes would be assigned over posts they were not
# authored from.
#
# dump-sample runs INSIDE the api container, so its /tmp is the container's,
# not the host's. Both files must be docker-cp'd to the host before scp can
# see them — without this the scp fails with "No such file or directory" while
# the dump itself reported success.
ssh dakwah "docker cp dakwah-lens-api-1:/tmp/${NAME}.md /tmp/${NAME}.md >/dev/null && \
  docker cp dakwah-lens-api-1:/tmp/${NAME}.posts.jsonl /tmp/${NAME}.posts.jsonl >/dev/null"
scp -q "dakwah:/tmp/${NAME}.md"          "$RUN/sample.md"
scp -q "dakwah:/tmp/${NAME}.posts.jsonl" "$RUN/posts.jsonl"
echo "sample:      $RUN/sample.md      ($(wc -c < "$RUN/sample.md" | tr -d ' ') bytes)"
echo "posts cache: $RUN/posts.jsonl    ($(grep -c '' "$RUN/posts.jsonl") posts)"

echo
echo "=== next: read $HERE/THEMES_PROMPT.md, author $RUN/themes.json, then:"
echo "    bash $HERE/inject.sh $RUN"
