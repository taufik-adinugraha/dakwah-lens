#!/usr/bin/env bash
# Fetch posts in a recent window from prod for a theme-classification audit.
#
# Usage: fetch.sh <run_dir> [window_days=7] [ssh_host=dakwah]
# Env:   WINDOW_ON=arrival|posted   (default: arrival)
#
# Writes <run_dir>/posts.jsonl  (one {"id","tg","text"} object per line)
# Use whatever window the operator asks for (default 7 days). The window is NOT
# an efficiency lever — the ledger de-dup keeps a 7d target small when audits are
# regular; cost is controlled by the terse subagent contract + batching, not by
# shrinking the window.
#
# ── WHY THE DEFAULT WINDOWS ON ARRIVAL, NOT posted_at ──────────────────────────
# Ingest backdates. A post published on 08-28 can land in the table on 09-02:
# RSS/social backfill sets `posted_at` to the ORIGINAL publication time while
# `created_at` records when we actually got it. Measured 2026-09-02, nulls by
# posted-day vs. ingest time:
#
#     posted 08-28  110 nulls   ingested 09-01 12:01 → 09-02 12:06
#     posted 08-29  134 nulls   ingested 09-01 12:01 → 09-02 12:06
#     posted 08-30  129 nulls   ingested 09-01 12:01 → 09-02 12:06
#     posted 08-31  104 nulls   ingested 09-01 12:01 → 09-02 12:06
#
# A `posted_at`-keyed "past 1d" window CANNOT see any of those 477 posts, even
# though every one of them arrived inside the last 24 hours and is genuinely new
# work. They are not skipped-and-retried later either: the next day's 1d window
# has moved on, so absent a deliberately wide sweep they are never audited at
# all. That is the same permanent-invisibility failure mode as the audit#133
# null-stranding bug, arriving through a different door.
#
# Windowing on arrival is strictly safer: it catches late arrivals regardless of
# publication date, and the ledger's UUID de-dup means the extra breadth costs
# nothing on posts already reviewed. `greatest(posted_at, created_at)` keeps rows
# whose created_at is unset/older than posted_at from silently dropping out.
#
# WINDOW_ON=posted restores the old behaviour for the rare case where you
# deliberately want a publication-date slice (e.g. auditing one news day).
set -euo pipefail

RUN="${1:?run_dir required}"
DAYS="${2:-7}"
HOST="${3:-dakwah}"
WINDOW_ON="${WINDOW_ON:-arrival}"
mkdir -p "$RUN"

case "$WINDOW_ON" in
  arrival) WHERE="greatest(posted_at, coalesce(created_at, posted_at)) >= now() - interval '${DAYS} days'" ;;
  posted)  WHERE="posted_at >= now() - interval '${DAYS} days'" ;;
  *) echo "WINDOW_ON must be 'arrival' or 'posted' (got: ${WINDOW_ON})" >&2; exit 2 ;;
esac

SQL="SELECT json_build_object('id', id::text, 'tg', coalesce(theme_group,'(null)'), 'text', left(regexp_replace(text,'\\s+',' ','g'),600)) FROM social_posts WHERE ${WHERE} AND text IS NOT NULL AND length(text) >= 15;"

ssh "$HOST" "docker exec dakwah-lens-postgres-1 psql -U dakwah -d dakwah_lens -t -A -c \"${SQL}\"" \
  | grep -E '^\{' > "$RUN/posts.jsonl"

echo "fetched $(wc -l < "$RUN/posts.jsonl" | tr -d ' ') posts (window=${DAYS}d on ${WINDOW_ON}) -> $RUN/posts.jsonl"
