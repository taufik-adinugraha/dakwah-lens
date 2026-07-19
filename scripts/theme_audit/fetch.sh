#!/usr/bin/env bash
# Fetch posts in a recent window from prod for a theme-classification audit.
#
# Usage: fetch.sh <run_dir> [window_days=7] [ssh_host=dakwah]
#
# Writes <run_dir>/posts.jsonl  (one {"id","tg","text"} object per line)
# Use whatever window the operator asks for (default 7 days). The window is NOT
# an efficiency lever — the ledger de-dup keeps a 7d target small when audits are
# regular; cost is controlled by the terse subagent contract + batching, not by
# shrinking the window.
set -euo pipefail

RUN="${1:?run_dir required}"
DAYS="${2:-7}"
HOST="${3:-dakwah}"
mkdir -p "$RUN"

SQL="SELECT json_build_object('id', id::text, 'tg', coalesce(theme_group,'(null)'), 'text', left(regexp_replace(text,'\\s+',' ','g'),600)) FROM social_posts WHERE posted_at >= now() - interval '${DAYS} days' AND text IS NOT NULL AND length(text) >= 15;"

ssh "$HOST" "docker exec dakwah-lens-postgres-1 psql -U dakwah -d dakwah_lens -t -A -c \"${SQL}\"" \
  | grep -E '^\{' > "$RUN/posts.jsonl"

echo "fetched $(wc -l < "$RUN/posts.jsonl" | tr -d ' ') posts (window=${DAYS}d) -> $RUN/posts.jsonl"
