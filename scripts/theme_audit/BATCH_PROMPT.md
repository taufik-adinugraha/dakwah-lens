Audit one batch of `theme_group` classifications.

READ FULLY FIRST — it is the contract you are held to:
  {TOOLKIT}/AUDIT_INSTRUCTION.md

Your inputs:
  rulebook:      {RUN}/rulebook.txt
  valid groups:  {RUN}/valid_groups.json
  your batch:    {RUN}/in/part_{NN}.jsonl
Your output (write exactly this one file):
  {RUN}/out/flags_{NN}.json

Three things decide whether this batch succeeds:

1. **A `(null)` is never a correct answer.** `theme_group` NULL is a FAILURE
   state, not a classification — the column is written at ingest and stays NULL
   only when that call failed. A post that genuinely fits no category is written
   the literal `Lainnya`, which is a valid value. So every null post MUST get a
   flag: low-substance, bare URL, fragment, gossip, promo, spam, fiction — all of
   those are `Lainnya`, not "leave it". A null you decline to flag gets marked
   audited anyway and becomes invisible to every future run; that is how 3,719
   posts are currently sealed shut. Your flag count should essentially equal the
   number of nulls in your batch.

2. **OUTPUT BUDGET — narration kills the batch.** Exceeding the 64,000-token
   output cap means the agent dies and writes NOTHING; the batch is lost, not
   degraded. Reason silently. Do not narrate posts, echo post text, print the
   JSON before writing it, or produce a table or per-post justification. Your
   entire visible output is the Write call plus ONE summary line.

3. **For posts that already carry a group**, be conservative: precision over
   recall. Flag only clear misplacements; leave borderline or defensible ones.

Every `to` value must be one of the strings in valid_groups.json, exactly. Write
`Lainnya` literally, not "Lainnya — Tidak Terklasifikasi".

Apply the rulebook to what each post actually says. Do not assume a dominant
theme from the window's news cycle.

Write the file INCREMENTALLY — Write the first chunk, then Edit-append the rest.
Agents in this pipeline have died mid-run on API timeouts having written nothing;
an incremental file leaves recoverable work. If you need a helper script, name it
uniquely ({RUN}/helper_part_{NN}.py) — parallel siblings clobber shared names.

Before you reply, verify your own artifact rather than trusting your intent:

    python3 {TOOLKIT}/verify_batch.py {RUN} {NN}

Do not reply until it prints OK. Never call any external API — this is your own
judgment.

Reply with ONE line: batch {NN}, N posts reviewed, M flags written.
