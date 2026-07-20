# Theme-classification audit — runbook

Pure-Claude audit of recent `theme_group` classifications: sweep the last N days of
posts, reclassify the mis-labelled ones, feed systematic misses back into the live
classifier prompt. **Never uses Gemini/any external API** (per `feedback_no_gemini_for_audit`).

This runbook + `scripts/theme_audit/` replace the old ad-hoc, per-run scratchpad process.
It is designed to be **cheap, resumable, and drift-proof**. Run it every 1–2 days.

## Why the previous run was slow/expensive (what this hardens)
1. **64k output-token blowups — the actual root cause.** Subagents narrated per-post → a single response exceeded the output cap → the agent died producing *nothing* → wasted ~250k tokens/batch + manual re-runs. → Fixed by the **OUTPUT BUDGET** rule in `AUDIT_INSTRUCTION.md` (write the JSON file, reply one line, NO narration). Model-independent — narration blows the cap on any model.
2. **Oversized batches (484)** amplified the narration. → `prepare.py` batches ~**350** (prior working runs' size). The contract in (1), not the batch size, is the real guard.
3. **Large target came from a STALE LEDGER, not a too-wide window** — the 7,729 was a ~3-day gap since the ledger's last write. → The durable ledger + regular runs keep any window's target small. **Model and window are NOT efficiency levers — use Opus and whatever window you ask for.**
4. **Ephemeral ledger in `/tmp`** (drift/loss risk). → Durable ledger at `~/.dakwah/theme_audit/` + prod `~/theme_audit/`, with backup on every write.
5. **Rulebook drift** — a hand-copied rulebook could diverge from the live prompt. → `gen_rulebook.py` derives it from `theme_groups.llm_group_options_prompt()`.
6. **Manual whack-a-mole on failures.** → `aggregate.py` reports missing batches and withholds `apply.sql` until every batch is covered.

## Procedure

```bash
cd scripts/theme_audit
RUN=/tmp/theme_audit_$(date +%Y%m%d)          # a scratch run dir (ephemeral is fine)

# 1. Derive rulebook + valid groups from the LIVE classifier prompt
PYTHONPATH=../../api/src python3 gen_rulebook.py "$RUN"

# 2. Fetch the window from prod (default 7 days; pass whatever window you want, e.g. 7)
bash fetch.sh "$RUN" 7

# 3. Filter to unaudited + split into ~350-post batches; read the manifest + guards
python3 prepare.py "$RUN" --window-days 7
#   -> note the batch count (part_00 .. part_NN) and heed any ⚠️ DRIFT / LARGE-TARGET warning.
```

**4. Launch one Claude subagent per `in/part_NN.jsonl`** (this is done by me, the orchestrator — the Agent tool, NOT a shell loop):
- Each subagent prompt points at `AUDIT_INSTRUCTION.md`, `rulebook.txt`, `valid_groups.json`, its `in/part_NN.jsonl`, and its `out/flags_NN.json` target. Nothing more.
- **Model: Opus** (default — what prior runs used, and it was fine). The model was never the cost problem; the terse OUTPUT-BUDGET contract + batching are what matter. Sonnet is an acceptable floor if ever needed; do NOT drop to Haiku for audit judgment. Always Claude, never Gemini (`feedback_no_gemini_for_audit`).
- Run them in parallel BUT in **waves of ~4-6, not all at once**. Aggregate concurrent Opus load is the real limiter: a full 7d/~10k-post run is ~3–4M tokens and **will exceed one account session-limit window** — launching all ~20 at once burns the window and most fail together (audit#96 lesson). After each wave, apply+mark it (`aggregate.py --force` → `apply.sh` → mark; idempotent re-apply of earlier waves is harmless), so progress banks incrementally. When you hit a session limit, wait for the reset (a background timer works) then continue the next wave — a big run legitimately spans 1–3 resets.
- The **OUTPUT BUDGET** rule (no narration) keeps each response small — a ~350–500-post batch's JSON flags stay far under the 64k cap regardless of model.
- If a batch **fails on the 64k output cap** (some batches make a subagent over-produce despite the contract — seen repeatedly on specific batches), split just that batch into halves (`part_NN` → `part_NNa`/`part_NNb`, delete the original) and re-run the two with a hard no-narration reminder. If a batch fails on the **session limit**, just re-run that one after reset. Either way, never re-run the whole set.

```bash
# 5. Aggregate -> validated corrections.json + apply.sql (refuses apply.sql if any batch missing)
python3 aggregate.py "$RUN"
#   -> review the transition matrix + the _notes (candidate new rules) before applying.

# 6. Apply to prod (single transaction, rolls back on any error)
bash apply.sh "$RUN"

# 7. Mark the whole reviewed target audited (durable ledger, backed up, synced to prod)
bash mark_audited.sh "$RUN"
```

**8. Feed systematic misses back into the pipeline (the "adjust prompt" step).**
If `aggregate.py`'s `_notes`/transition matrix show a *recurring* new pattern (e.g. this run: MagangHub/Kemnaker magang posts → `Lainnya`), add it to the matching group in
`api/src/api/services/theme_groups.py` → `GROUP_INTENT_HINTS`, tagged `(audit#NN)`.
That is the single source of truth — `gen_rulebook.py` re-derives the rulebook from it next run, so audit and pipeline never diverge. Committing/deploying that change is a normal code change (ask first, per repo rules).

## Notes / conventions
- `theme_group` values: 14 groups + `Lainnya`. Write the literal `Lainnya` (not "Lainnya — Tidak Terklasifikasi").
- The `social_posts` table has no slug/audited column — "audited" state is the external ledger. **Recommended next hardening:** a small `theme_audit_ledger(post_id uuid pk, audited_at timestamptz)` table so the unaudited filter becomes a SQL `NOT EXISTS` and the file ledger (and its drift risk) goes away entirely. Not done yet — needs a prod migration + sign-off.
- Prod DB: `docker exec dakwah-lens-postgres-1 psql -U dakwah -d dakwah_lens`.
- Idempotent: re-applying the same corrections is harmless; re-marking audited uuids de-dupes.
