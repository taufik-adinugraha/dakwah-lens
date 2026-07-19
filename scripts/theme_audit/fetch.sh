#!/usr/bin/env bash
# Fetch posts in a recent window from prod for a theme-classification audit.
#
# Usage: fetch.sh <run_dir> [window_days=2] [ssh_host=dakwah]
#
# Writes <run_dir>/posts.jsonl  (one {"id","tg","text"} object per line)
# Default window is 2 days — matches the "run every 1-2 days" cadence and keeps
# the target small/cheap. Widen only when catching up after a gap.
set -euo pipefail

RUN="${1:?run_dir required}"
DAYS="${2:-2}"
HOST="${3:-dakwah}"
mkdir -p "$RUN"

SQL="SELECT json_build_object('id', id::text, 'tg', coalesce(theme_group,'(null)'), 'text', left(regexp_replace(text,'\\s+',' ','g'),600)) FROM social_posts WHERE posted_at >= now() - interval '${DAYS} days' AND text IS NOT NULL AND length(text) >= 15;"

ssh "$HOST" "docker exec dakwah-lens-postgres-1 psql -U dakwah -d dakwah_lens -t -A -c \"${SQL}\"" \
  | grep -E '^\{' > "$RUN/posts.jsonl"

echo "fetched $(wc -l < "$RUN/posts.jsonl" | tr -d ' ') posts (window=${DAYS}d) -> $RUN/posts.jsonl"
