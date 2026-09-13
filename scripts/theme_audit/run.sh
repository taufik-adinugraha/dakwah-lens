#!/usr/bin/env bash
# The single entry point for a theme-classification audit.
#
# Usage: run.sh [window_days=7] [run_dir]
#
# Does steps 1-3 of the RUNBOOK (rulebook -> fetch -> prepare) with one
# canonical set of choices, then prints the exact agent prompts to dispatch.
# Everything downstream (aggregate -> apply -> mark) is unchanged.
#
# WHY THIS EXISTS
# Each past run was assembled by hand, and the hand-made parts are where the
# misses came from: an ad-hoc window that could not reach old nulls, a run dir
# under /tmp that got reaped, a per-batch prompt retyped each time, and a
# null-coverage check that depended on the operator remembering to run it.
# Those are now defaults, not discipline:
#   * outstanding NULLs are always in scope regardless of age (fetch.sh)
#   * rows marked audited but still null are re-opened (prepare.py)
#   * the run dir is durable by default, not /tmp
#   * the batch prompt is a checked-in file (BATCH_PROMPT.md)
#   * the batch check is a script the agent must pass (verify_batch.py)
#
# The window argument now governs only the MISCLASSIFICATION half of the audit
# (re-reading already-labelled posts for drift). It cannot cause a null to be
# missed, so picking it is no longer load-bearing.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DAYS="${1:-7}"
RUN="${2:-$HOME/.dakwah/theme_audit/runs/$(date +%Y%m%d_%H%M)}"
mkdir -p "$RUN"

echo "=== theme audit  window=${DAYS}d  run=$RUN"
PYTHONPATH="$HERE/../../api/src" python3 "$HERE/gen_rulebook.py" "$RUN"
bash "$HERE/fetch.sh" "$RUN" "$DAYS"
python3 "$HERE/prepare.py" "$RUN" --window-days "$DAYS"

N=$(ls "$RUN/in" 2>/dev/null | wc -l | tr -d ' ')
echo
echo "=== $N batches ready. Dispatch each as a subagent with this prompt:"
echo "    (substitute NN; run at most 5 concurrently)"
echo
sed -e "s|{TOOLKIT}|$HERE|g" -e "s|{RUN}|$RUN|g" "$HERE/BATCH_PROMPT.md" | head -5
echo "    ... full text: $HERE/BATCH_PROMPT.md"
echo
echo "=== then:"
echo "  python3 $HERE/aggregate.py $RUN        # review matrix + NULL COVERAGE line"
echo "  bash $HERE/apply.sh $RUN"
echo "  bash $HERE/mark_audited.sh $RUN"
