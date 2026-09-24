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

# Shard the sample for the parallel survey. The survey prompt is rendered per
# shard from the checked-in SURVEY_PROMPT.md, never retyped — a retyped prompt
# is where the other manual pipelines drifted.
SHARDS="${SHARDS:-5}"
mkdir -p "$RUN/shards"
grep '^- ' "$RUN/sample.md" > "$RUN/body.txt"
NB=$(grep -c '' "$RUN/body.txt")
NP=$(grep -c '' "$RUN/posts.jsonl")
PER=$(( (NB + SHARDS - 1) / SHARDS ))
split -l "$PER" -d -a 2 "$RUN/body.txt" "$RUN/shards/shard_"
for sh in "$RUN"/shards/shard_[0-9][0-9]; do
  NN="${sh##*_}"
  sed -e "s|{RUN}|$RUN|g" -e "s|{NAME}|$NAME|g" -e "s|{NN}|$NN|g" \
      -e "s|{N_POSTS}|$NP|g" -e "s|{N_LINES}|$(grep -c '' "$sh")|g" \
      "$HERE/SURVEY_PROMPT.md" > "$RUN/shards/prompt_$NN.md"
done
echo "shards:      $(ls "$RUN"/shards/shard_[0-9][0-9] | wc -l | tr -d ' ') x ~$PER lines  (prompts: shards/prompt_NN.md)"

echo
echo "=== next:"
echo "  1. one Claude subagent per shard, prompt = the text of $RUN/shards/prompt_NN.md verbatim"
echo "     (Sonnet is fine for the survey; never Gemini). The agent REPLIES with its report;"
echo "     the orchestrator saves each reply to $RUN/shards/report_NN.md (subagents may not write report files)"
echo "  2. python3 $HERE/verify_reports.py $RUN     # re-counts every proposed token"
echo "  3. read $HERE/THEMES_PROMPT.md, author $RUN/themes.json from the reports"
echo "  4. bash $HERE/inject.sh $RUN"
echo "  5. for any concrete theme well below ~0.60 purity:  bash $HERE/peek_topic.sh \"<label>\""
echo "     then re-author and re-inject (idempotent)"
