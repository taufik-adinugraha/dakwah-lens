#!/usr/bin/env python3
"""Derive the audit rulebook + valid-groups list from the LIVE classifier prompt.

Single source of truth = api/src/api/services/theme_groups.py (GROUP_INTENT_HINTS,
surfaced via llm_group_options_prompt()). Generating the rulebook from it guarantees
the audit never drifts from what the production pipeline actually classifies with.
When an audit finds a new systematic misclassification, add the rule to
GROUP_INTENT_HINTS (tagged `audit#NN`) and re-run this — do NOT hand-edit a rulebook copy.

Usage: python gen_rulebook.py <run_dir>
Writes <run_dir>/rulebook.txt and <run_dir>/valid_groups.json
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO, "api", "src"))

from api.services.theme_groups import (  # noqa: E402
    LAINNYA_GROUP,
    THEME_GROUPS,
    llm_group_options_prompt,
)


def main() -> None:
    run = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(run, exist_ok=True)
    rulebook = llm_group_options_prompt()
    with open(os.path.join(run, "rulebook.txt"), "w") as f:
        f.write(rulebook)
    groups = sorted({tg.group for tg in THEME_GROUPS} | {LAINNYA_GROUP})
    with open(os.path.join(run, "valid_groups.json"), "w") as f:
        json.dump(groups, f, ensure_ascii=False)
    print(f"rulebook.txt: {len(rulebook)} chars | valid_groups: {len(groups)}")


if __name__ == "__main__":
    main()
