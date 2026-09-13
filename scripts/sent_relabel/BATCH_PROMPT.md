# Task: sentiment-label one batch of Indonesian posts

Substitute {RUN} (run dir), {ID} (batch id) and {TOOLKIT} below.

1. `cat {TOOLKIT}/RUBRIC.md` — the classification rubric. Follow it exactly.
2. `cat {RUN}/batches/{ID}` — the batch. Each line is `<uuid><TAB><post text>`.
   Use `cat`, never the Read tool: Read truncates long lines and some posts run
   to 400 characters.
3. Write `{RUN}/labels/{ID}.tsv` — one line per input line, in the same order:
   `<uuid><TAB><label>`, where label is exactly `positive`, `neutral`, or
   `negative`.

## Hard requirements

- **N lines in, N lines out.** Never skip, merge, reorder, or invent a line. A
  dropped line silently misaligns every label after it against the wrong post.
  The last batch of a run is usually SHORTER than the others — use the actual
  line count, never an assumed one.
- Copy each uuid **verbatim** from the batch. Never retype one from memory.
- The output file contains **only** the TSV — no preamble, no markdown fences,
  no commentary, no header row.
- Build the file in several chunks: `Write` the first chunk, then `Edit`-append
  the rest. Do not try to emit all 500 lines in one response, and never print
  the labels in your reply.
- Posts truncated mid-sentence with `…` are still classifiable — label them.
  Foreign-language posts and pure @-handle spam get `neutral`.

## Before you finish

Run this and do not reply until it prints OK:

    python3 {TOOLKIT}/verify_batch.py {RUN} {ID}

A subagent's self-report is not evidence — agents in this pipeline have reported
success having written no file at all. The artifact on disk is the only signal.

Never call any external API. This is your own judgment against the rubric.

Reply with exactly one line: `DONE {ID} <lines> <positive>/<neutral>/<negative>`
