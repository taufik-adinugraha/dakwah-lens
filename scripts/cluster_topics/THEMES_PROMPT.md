# Authoring the themes JSON (Stage 1 → Stage 2)

Read `<RUN>/sample.md` — it is the exact discovery prompt, with a sample of the
corpus. Write `<RUN>/themes.json`:

```json
{"themes": [
  {"label": "…", "keywords": ["…"], "exclude_keywords": ["…"], "min_similarity": 0.30}
]}
```

- **6–10 themes**, Indonesian labels, covering what the corpus is actually about
  this week — not evergreen categories.
- `keywords` drive assignment by embedding cosine. The purity metric is a
  literal keyword substring match, so tune with **short single tokens**, not
  phrases (`project_manual_topic_clustering`).
- **Short is only half the rule — the token must also be DISTINCTIVE.** A short
  token is easily a substring of common Indonesian morphology, and the matcher
  cannot tell the difference. Measured on the 2026-09-14 corpus: `iran` matched
  1,374 posts as a substring but only 85 as a word (the rest were `perairan`,
  `kehadiran`, `aliran`, `kekhawatiran`); `sar` 3,423 vs 287 (`besar`, `pasar`,
  `dasar`); `onsu` 408 vs 63 (`konsumsi`); `menteri` 832 vs 508
  (`kementerian`); `demo` 212 vs 38 (`demokrasi`). A survey agent proposed
  `iran` for the Middle-East theme — unchecked it would have made that topic
  ~20% of the corpus, nearly all of it maritime and attendance copy.
  Prefer `hormuz`, `teheran`, `timur tengah` over `iran`; `krakatau` over `sar`.
- **Verify before injecting** — do not eyeball it:

      python3 {TOOLKIT}/check_keywords.py <RUN>

  It prints substring-vs-word counts per keyword and exits non-zero if any
  keyword draws most of its matches from inside other words.
- `exclude_keywords` carve out a near neighbour that would otherwise absorb
  posts (e.g. excluding `sepakbola` from a geopolitics theme).
- `min_similarity` is per-theme. Note the historical trap: the rescue passes
  used to UNDO per-theme floors, so every pre-2026-09-03 tuning measured nothing
  (`project_recluster_rescue_floor_bug`). It is fixed — floors now hold.

Never call Gemini. The themes are your own reading of the sample; `inject` does
assignment arithmetically with no model call.

After `inject.sh`, read the per-theme post counts it prints. A theme with a
handful of posts is usually too narrow; one absorbing most of the corpus is too
broad. Re-author and re-inject — it is idempotent.
