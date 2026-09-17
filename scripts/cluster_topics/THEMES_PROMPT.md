# Authoring the themes JSON (Stage 1 → Stage 2)

Read `<RUN>/sample.md` — it is the exact discovery prompt, with a sample of the
corpus. Write `<RUN>/themes.json`:

```json
{"themes": [
  {"label": "…", "keywords": ["…"], "exclude_keywords": ["…"], "min_similarity": 0.30},
  {"label": "…", "keywords": ["…"], "min_similarity": 0.36, "magnet": true}
]}
```

- **6–10 CONCRETE event-themes**, Indonesian labels, covering what the corpus is
  actually about this week — not evergreen categories.
- **Plus 3–5 DOMAIN MAGNETS, marked `"magnet": true`.** This is not optional and
  it is the one rule this file used to be missing. `topic_discovery.py` runs two
  rescue passes that force every leftover orphan onto its nearest centroid, and
  the in-group pass *deliberately ignores your per-theme `min_similarity`* (the
  theme_group match is its correctness check instead). So a domain with lots of
  low-signal chatter and no broad home dumps all of it onto whichever concrete
  theme is semantically closest.

  Measured on the 2026-09-17 run: with ten concrete themes and no magnets,
  "Reshuffle Menkeu: Purbaya Diganti Suahasil" became the de-facto reservoir for
  every Pemerintahan & Kebijakan orphan — 512 posts at 0.41 purity, the biggest
  and least pure theme of the run, against a keyword union of only 235. Raising
  its floor 0.36 → 0.42 moved 30 posts and changed purity not at all, because
  the floor is not what was admitting them. Adding four magnets
  (Pemerintahan / Ekonomi / Pendidikan / Kesehatan) cut it to 296 posts at
  **0.66** purity, lifted MBG 0.61 → 0.78, and moved ~500 posts out of the
  orphan bucket into a correct home. Give magnets `min_similarity` 0.34–0.38 —
  deliberately low, so they out-compete the concrete themes for weak matches.
  Their own purity of ~0.45–0.85 is correct and expected; their job is to keep
  the DENOMINATOR clean on the concrete themes.

  This rule already existed in the auto path (`topic_discovery.py`,
  DOMAIN-MAGNET COVERAGE, 2026-07-06) and was absent here — the recurring
  manual/auto parity failure (`project_manual_auto_parity`). If you change one,
  change the other.
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

  It also measures **cohesion** — the share of a keyword's matches that contain
  at least one OTHER keyword from the same theme — and fails below 30%. This
  catches the failure inflation cannot see: a token that is a perfectly clean
  word but generic in context. Measured on the 2026-09-14 themes, `wartawan`
  (305 matches, 100% clean words) was only 11% on-story — it was matching the
  commonest quotation formula in Indonesian news, "… kepada wartawan" — and
  `pewarta` (138 matches) only 22%, matching ANTARA's byline footer. Both were
  the highest-volume keywords in that run's largest theme, so that theme was
  built mostly on boilerplate, and the inflation check passed them perfectly.
  Prefer `lima jurnalis` (96, on-story) and `sar gabungan` (122) over `wartawan`,
  `pewarta` and bare `sar`.

  Cohesion is skipped for `"magnet": true` themes, whose breadth is the point —
  the skip is printed, so it cannot be used quietly on a concrete theme.
- `exclude_keywords` carve out a near neighbour that would otherwise absorb
  posts (e.g. excluding `sepakbola` from a geopolitics theme).
- `min_similarity` is per-theme, and it governs the FIRST assignment pass only.
  The historical bug where the rescue passes silently UNDID per-theme floors is
  fixed (`project_recluster_rescue_floor_bug`), but do not read that as "the
  floor now controls the whole theme": the in-group rescue still declines to
  enforce it *by design*, because the theme_group match is its correctness check
  and enforcing the floor there collapsed rescues 890 → 30 (see the NOTE in
  `topic_discovery._rescue_in_group_orphans`). The practical consequence,
  measured 2026-09-17: if a theme is over-absorbing, raising its floor may do
  almost nothing. Reach for a domain magnet first — that is the lever that
  actually moves rescue-admitted posts.

Never call Gemini. The themes are your own reading of the sample; `inject` does
assignment arithmetically with no model call.

After `inject.sh`, read the per-theme post counts it prints. A theme with a
handful of posts is usually too narrow; one absorbing most of the corpus is too
broad. Re-author and re-inject — it is idempotent.
