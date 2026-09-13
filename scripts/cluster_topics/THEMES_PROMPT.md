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
