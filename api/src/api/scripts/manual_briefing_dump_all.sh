#!/usr/bin/env bash
#
# Convenience: dump all 5 weekly briefing prompts in one shot.
#
# Run from the repo root or `api/` dir:
#   bash api/src/api/scripts/manual_briefing_dump_all.sh
#
# Writes each prompt to /tmp/dakwah-briefing-<segment>-prompt.md. Paste
# each into Claude, save the reply, then run the matching `save`:
#
#   uv run python -m api.scripts.manual_briefing save <segment> <reply.md>
#

set -e

# Find the api/ dir whether we're called from repo root or from api/.
if [ -f "src/api/scripts/manual_briefing.py" ]; then
  API_DIR="."
elif [ -f "api/src/api/scripts/manual_briefing.py" ]; then
  API_DIR="api"
else
  echo "Can't find api/scripts/manual_briefing.py. Run from repo root or api/." >&2
  exit 1
fi

cd "$API_DIR"

OUT_DIR="${1:-/tmp}"
mkdir -p "$OUT_DIR"

for seg in all spiritual family youth justice; do
  echo "→ dumping $seg" >&2
  uv run python -m api.scripts.manual_briefing dump "$seg" \
    --output "$OUT_DIR/dakwah-briefing-$seg-prompt.md"
done

echo "" >&2
echo "✓ All 5 prompts dumped to $OUT_DIR/dakwah-briefing-*-prompt.md" >&2
echo "  Next: paste each into Claude, save replies as *-reply.md, then:" >&2
echo "    for seg in all spiritual family youth justice; do" >&2
echo "      uv run python -m api.scripts.manual_briefing save \$seg $OUT_DIR/dakwah-briefing-\$seg-reply.md" >&2
echo "    done" >&2
