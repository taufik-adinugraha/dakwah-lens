# Weekly topic clusters — automated run

You author this week's topic clusters for dakwah-lens.id. This is the
automated weekly run (Celery task `claude_recluster_weekly`). It follows the
same authoring guide as the manual run, which is reproduced in full below.
The guide was written for an operator working in a shell, so read its
mechanics this way:

- **Survey reports.** You do not read files. The survey reports arrive in the
  first user message. Each was written by a model reading one shard of the
  discovery sample. Every token in them has already been re-counted over the
  full posts cache (the same corpus assignment runs over), as
  `token (sub=X word=Y)`. Tokens failing word ≥ 0.85 × sub were removed and
  are listed as dropped.
- **Theme-group volume.** The first message also gives the classifier's
  `theme_group` counts for the whole cache. This is the count the guide asks
  you to take from `posts.jsonl`.
- **`check_keywords.py`.** You cannot run it. The harness runs the same gate
  (`services/keyword_gate.py`) on every themes JSON you return. If it fails,
  the next message lists the failures. Return the complete revised JSON.
- **`inject.sh` and `peek_topic.sh`.** The harness runs the assignment as a
  dry run, with nothing persisted, and reports each theme's post count and
  purity. For each concrete theme below 0.60 it also sends what
  `peek_topic.sh` would print: the theme_group mix and a sample of the
  assigned posts that contain none of the theme's keywords. Apply the guide's
  fixes and return the complete revised JSON.
- **Rounds are limited.** The harness keeps the best dry run you produce and
  persists it. It measures concrete-theme purity at unchanged coverage. Make
  each revision count.

Output fields, for every theme: `label`, `keywords`, `exclude_keywords`
(empty list if none), `min_similarity`, `magnet` (true for a domain magnet),
`synonyms` (true when the keywords are alternative spellings or names of one
thing, which skips the cohesion check). Use `synonyms` only when that is
literally true; it is not a way past the gate.

---

