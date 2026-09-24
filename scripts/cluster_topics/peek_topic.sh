#!/usr/bin/env bash
# Diagnose an over-absorbing topic after inject.sh.
#
# Usage: peek_topic.sh "<topic label>" [n]
#
# Prints the topic's theme_group mix, how many of its posts contain NONE of its
# own keywords, and a random sample of those posts. The purity metric only says
# a theme is diluted; this shows WHAT it is absorbing, which is what tells you
# the fix:
#   - same-domain routine news (every "minister does X" in a reshuffle theme)
#       -> the domain's magnet is missing, or its keywords can't win those posts
#   - on-story posts phrased differently ("Sidang MK" with no "phpu")
#       -> add the missing on-story tokens to the concrete theme
#   - the whole beat under a two-case label (every corruption case in "Suap HGB")
#       -> broaden the label honestly to the beat
# Measured 2026-09-24: all three, in that order, on three themes at 0.41-0.42.
#
# Keywords come from the persisted topics row, so this checks what inject
# actually stored, not what themes.json says. Read-only.
set -euo pipefail
LABEL="${1:?topic label required}"
N="${2:-30}"
L_SQL="${LABEL//\'/\'\'}"
SQL=$(cat <<EOF
\pset pager off
\pset format unaligned
\pset tuples_only on
WITH t AS (SELECT id, keywords FROM topics WHERE label = '$L_SQL'),
     p AS (SELECT p.*, EXISTS (SELECT 1 FROM t, unnest(t.keywords) k
                               WHERE lower(p.text) LIKE '%' || lower(k) || '%') AS kw
           FROM social_posts p WHERE p.topic_id = (SELECT id FROM t))
SELECT '== theme_group mix'
UNION ALL SELECT '  ' || lpad(count(*)::text, 4) || '  ' || coalesce(theme_group, '(null)')
  FROM (SELECT theme_group FROM p) x GROUP BY theme_group
UNION ALL SELECT '== ' || count(*) FILTER (WHERE NOT kw) || ' of ' || count(*) || ' posts contain none of its keywords' FROM p;
WITH t AS (SELECT id, keywords FROM topics WHERE label = '$L_SQL')
SELECT '  ' || coalesce(p.theme_group, '-') || ' | ' || left(regexp_replace(p.text, '\s+', ' ', 'g'), 120)
FROM social_posts p
WHERE p.topic_id = (SELECT id FROM t)
  AND NOT EXISTS (SELECT 1 FROM t, unnest(t.keywords) k WHERE lower(p.text) LIKE '%' || lower(k) || '%')
ORDER BY random() LIMIT $N;
EOF
)
printf '%s\n' "$SQL" | ssh dakwah "docker exec -i dakwah-lens-postgres-1 psql -q -U dakwah -d dakwah_lens" 2>/dev/null \
  | grep -vE 'IDCloud|AUTHORIZED|Terminated|Activity is|https://|^\s*[_|\\/ ]+$|^\s*$'
