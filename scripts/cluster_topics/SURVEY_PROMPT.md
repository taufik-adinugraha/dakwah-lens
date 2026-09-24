Survey one shard of a {N_POSTS}-post Indonesian news/social corpus (run {NAME}) to help
author topic clusters for a da'wah media-monitoring platform.

SHARD: {RUN}/shards/shard_{NN}
FULL BODY (for counting only): {RUN}/body.txt

TASK
1. Read your shard ({N_LINES} headlines/snippets, one per line starting "- "). Read it in
   chunks with sed -n; do not try to read it all at once.
2. Identify the 8-14 RECURRING topic clusters that actually dominate THIS week.
   Concrete running stories, not evergreen categories. Give each a short Indonesian
   label and your estimate of how many posts in your shard belong to it.
3. For each cluster propose 3-8 candidate keyword tokens.

⛔ THE SUBSTRING TRAP — this is why you must self-check.
Keywords match as literal SUBSTRINGS; the matcher cannot tell a word from a fragment
inside another word. Measured on this corpus family: `unjuk` 739 substring vs 25 as a
word (menunjukkan); `ai` 5483 vs 290; `sar` 3109 vs 218; `yaman` 222 vs 39
(kenyamanan); `beras` 325 vs 59 (berasal); `artis` 172 vs 47 (partisipasi); `sepak`
272 vs 88 (sepakat); `siswa` 451 vs 236 (inside mahasiswa); `udara` 450 vs 310
(saudara). A survey agent once proposed `iran`, which would have made that topic ~20%
of the corpus, nearly all maritime and attendance copy.

MANDATORY SELF-CHECK for EVERY token you propose — do not report any that fails:
  cd {RUN}
  sub=$(grep -oic "TOKEN" body.txt); word=$(grep -oicw "TOKEN" body.txt); echo "TOKEN sub=$sub word=$word"
Drop or replace any token where word < 0.85 * sub. Prefer distinctive proper nouns and
compound terms (hormuz, karhutla, purbaya) over short generic ones.

⛔ THE BOILERPLATE TRAP — a clean word can still be off-story.
A token can pass the substring check perfectly and still match mostly boilerplate.
`wartawan` was 305/305 clean yet only 11% on-story: it matches the commonest quotation
formula in Indonesian news ("… kepada wartawan"). `pewarta` matches ANTARA's byline
footer. Avoid tokens that belong to how news is WRITTEN (quotation formulas, bylines,
outlet names, "baca juga", dateline cities) rather than what it is ABOUT. Prefer a
story-specific compound (`lima jurnalis`, `sar gabungan`) over the generic word.

⛔ NEVER propose a private individual's name as a label or a keyword. A label is
injected into every briefing prompt and renders in the product; a name in `keywords`
also re-derives the name into the label. Name the PATTERN instead ("Kasus Kekerasan
Seksual di Lingkungan Publik"), never the person.

OUTPUT — do NOT write any file. Your final reply IS the report; the orchestrator
saves it verbatim to {RUN}/shards/report_{NN}.md. Subagents may not write report
files, and routing around that (a Bash heredoc, a renamed path) is a guard bypass —
09-24: three survey agents did exactly that and it was flagged. Reply with the
report and nothing else, in this format per cluster:
  ## <Indonesian label>  (~N posts in shard)
  one line on what the story actually is
  tokens: token1 (sub=X word=Y), token2 (sub=X word=Y), ...
  near-neighbour risk: what unrelated content these tokens might pull in

Your reply is not evidence: verify_reports.py re-counts every token you list against
body.txt and flags any whose reported numbers do not match.
