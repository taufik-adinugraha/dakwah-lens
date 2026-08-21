# Theme-classification audit — subagent contract (READ FULLY)

You are Claude auditing `theme_group` classifications. **Never call any external API (no Gemini, no OpenAI) — this is your own judgment.**

## Inputs (paths are given in your launch prompt)
- `rulebook.txt` — the authoritative per-group inclusion/exclusion rules (generated from the live classifier prompt). Follow it literally.
- `valid_groups.json` — the 15 valid `theme_group` strings. Every `to` MUST be one of these exactly.
- `in/part_<NN>.jsonl` — your batch: one `{"id","tg","text"}` per line (`tg` = current group, may be `"(null)"`).

## Task
For each post, decide if `tg` is correct per the rulebook. Correct → emit nothing. Wrong → emit a correction. Be **conservative: precision over recall** — only flag clear misplacements; leave anything genuinely borderline/defensible.

### ⛔ EXCEPTION — `tg` of `"(null)"` is NEVER correct. Every null post MUST get a flag.
The conservative rule above applies to posts that already carry a group. A null
post has no label at all, so "leave it alone" is not a defensible outcome —
there is nothing to defend. Once a run completes, every post it reviewed is
written to the audited ledger, so a null you decline to flag is **permanently
null and never revisited by any future audit.**

If a null post is low-substance, off-topic, a bare URL, celebrity gossip, a
fragment, or otherwise unclassifiable, the correct answer is the literal
`Lainnya` — that is exactly what the group is for. Never emit nothing for a
null post.

Measured cost of getting this wrong: **1,445 posts** across runs #128-#132
(all near-100%-null backfills) were marked audited while still null, because
this exception was not stated and agents applied the conservative rule to
nulls. Flag count for an all-null batch should equal the batch size.

## ⛔ OUTPUT BUDGET — the hard rule that keeps this cheap
Do ALL reasoning silently/internally. **Do NOT narrate posts one-by-one, do NOT echo post text, do NOT write a running commentary.** A prior run blew the 64,000-token output cap doing that and produced nothing. Your visible output is only: the `Write` call, then a single summary line. Nothing else.

## Output — write EXACTLY one file: `out/flags_<NN>.json`
```json
{
  "flags": [ {"id":"<verbatim uuid>","from":"<current>","to":"<correct>","reason":"<=12 words Indonesian"}, ... ],
  "reviewed": <int: posts you read in this batch>,
  "_notes": "<a NEW recurring misclassification pattern not yet in the rulebook, or empty>"
}
```
Rules: `flags` contains only reclassifications (`from` != `to`). Copy every `id` verbatim. Every `to` ∈ valid_groups. Keep each `reason` ≤ 12 words. Validate the JSON parses before finishing.

Then reply with ONE line only:
`flags_<NN>: reviewed=<n>, corrections=<m>, top-pattern=<short phrase or none>`

## Judgment quick-reference (the rulebook is authoritative; this is the gist)
Most real errors are substantive-group → `Lainnya`: casual/low-substance tweets & shitposts; ceremonial TNI-Polri-BNN events & MPLS school-socialization; police non-crime service (SKCK/BBM-checks/traffic advisories); commercial ads & product launches; service notices (toll/PDAM/PLN/TransJakarta outages); music/nasyid without aqidah teaching; single-faith non-Islam devotional; casual "kerja"/loker & **MagangHub/Kemnaker magang** posts; crypto/trading promos; celebrity/fandom gossip; sports/football. Non-`Lainnya` moves seen often: routine traffic accidents → `Lingkungan & Bencana`; foreign armed-conflict news → `Konflik & Geopolitik`; pejabat-polemik (not a crime) → `Pemerintahan & Kebijakan`; online slot-gambling promos → `Patologi Sosial Digital`. Use the literal string `Lainnya` (not "Lainnya — Tidak Terklasifikasi").
