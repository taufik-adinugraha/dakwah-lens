# Survey one shard of this week's corpus

You are surveying one shard of a {{N_POSTS}}-post Indonesian news and social
corpus (the last 7 days) for dakwah-lens.id, a da'wah media-monitoring
platform. Your report helps a second step author the week's topic clusters.
That second step cannot read the whole corpus, so it will rely on your report.

The user message is your shard: {{N_LINES}} headlines or snippets, one per
line starting with `- `.

## Task

1. Identify the 8–14 recurring topic clusters that actually dominate this
   shard. Report concrete running stories, not evergreen categories. Give each
   a short Indonesian label and estimate how many lines of the shard belong
   to it.
2. For each cluster, propose 3–8 candidate keyword tokens: lowercase, bare,
   no quotes (`ijazah gibran`, not `"ijazah gibran"`).

## The substring trap

Keywords are matched as literal substrings, and the matcher cannot tell a
word from a fragment inside another word. Measured on this corpus family:
`unjuk` 739 substring matches against 25 as a word (menunjukkan); `ai` 5483
against 290; `sar` 3109 against 218 (besar, pasar); `yaman` 222 against 39
(kenyamanan); `beras` 325 against 59 (berasal); `artis` 172 against 47
(partisipasi); `siswa` 451 against 236 (mahasiswa); `udara` 450 against 310
(saudara); `iran` would have pulled in perairan, kehadiran and aliran. Prefer
distinctive proper nouns and compound terms (hormuz, karhutla, purbaya) over
short generic ones. Every token you propose is re-counted over the full
corpus afterwards, and a token that matches mostly inside other words is
dropped, so a short generic token costs the cluster its keyword.

## The boilerplate trap

A clean word can still be off-story. `wartawan` matched 305 posts, every one a
clean word, yet only 11% were on-story: it matches the commonest quotation
formula in Indonesian news ("… kepada wartawan"). `pewarta` matches ANTARA's
byline footer. Avoid tokens that belong to how news is written (quotation
formulas, bylines, outlet names, "baca juga", dateline cities) rather than
what it is about. Prefer a story-specific compound (`lima jurnalis`,
`sar gabungan`) over the generic word.

## Names

Never propose a private individual's name as a label or a keyword. A label is
injected into every briefing prompt and renders in the product, and a name in
the keywords re-derives the name into the label. Name the pattern instead
("Kasus Kekerasan Seksual di Lingkungan Publik"), never the person. Public
officials acting in office may be named.

## Output

One entry per cluster: `label`, `story` (one line on what the story actually
is), `estimated_lines`, `tokens`, and `near_neighbour_risk` (what unrelated
content these tokens might pull in).
