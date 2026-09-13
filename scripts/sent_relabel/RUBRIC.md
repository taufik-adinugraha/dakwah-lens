# Sentiment classification — Indonesian social/news posts

Labels: exactly one of `positive`, `neutral`, `negative`.

## ⭐ THE RULE THAT DECIDES MOST HARD CASES
**Score the OUTCOME the post reports, NOT the backdrop it happens against.**

A post set against a disaster, a crime, or a scandal is **positive** when what it
actually reports is something GOOD HAPPENING. The bad backdrop does not make it
negative — the backdrop is why the good thing is newsworthy.

**These are all `positive`** (measured: a low-effort pass got every one of these
wrong by anchoring on the disaster word instead of the outcome):
- "Bahlil akan kirimkan 48 unit genset ke NTT untuk Puskesmas" → aid dispatched
- "200.000 liter Pertalite tiba di Manggarai, stok BBM NTT aman" → supply restored
- "Pemprov Bali bergilir kirim tim medis dan logistik" → relief mobilised
- "Penyintas gempa dapat bantuan relawan" → aid received
- "Kebakaran Sade, pemerintah susun langkah pemulihan kampung adat" → recovery plan
- "Presiden tinjau langsung kebakaran hutan" → response underway

## positive
A good OUTCOME is reported:
- **AID / RECOVERY**: relief arriving, supplies restored, rebuilding, evacuation
  succeeding, victims helped, a response mobilised. **Even amid a disaster.**
- **JUSTICE SERVED**: prosecutions advancing, arrests of suspects, convictions,
  asset seizures from corrupt officials, sentences handed down. **An arrest is a
  good outcome, not a bad one** — the crime already happened; the arrest is the news.
- **PROBLEM RESOLVED**: a shortage ended, a dispute settled, a service restored.
- Achievement, award, a milestone reached.

### ⚠️ The positive/neutral boundary — read this, it decides ~15% of posts
A good outcome must have **actually happened or be reported as achieved**.
Routine institutional activity, plans, launches and appeals are `neutral`,
even when the institution is doing something worthy.

`neutral`, NOT positive (measured: two labellers split 33% vs 17% positive
on exactly this boundary):
- "Polres Malang gelar apel kesiapsiagaan kamtibmas" → a routine drill
- "BNN siapkan gelang GPS untuk klien rehabilitasi" → a plan, not yet done
- "Indosat & Arsari rilis perusahaan jalan tol digital" → corporate launch
- "Polri imbau masyarakat tetap damai dan tertib" → an appeal
- "Danantara: PLTS 100 GW butuh investasi Rp1.130 triliun" → a figure

`positive` — something landed:
- "200.000 liter Pertalite tiba di Manggarai" → arrived
- "Pokdakan panen hampir setengah ton kerapu" → harvested
- "Polda Kalbar laksanakan patroli pembasahan lahan rawan kebakaran"
  → actively being carried out against a live threat
- "KPK geledah rektorat, Mulyono jadi tersangka" → a suspect named

The test: strip the institution's name. Is there still a **result**? If all
that remains is "an organisation did its job today", that is `neutral`.

## negative
- Ongoing harm with no resolution reported: casualties, damage spreading, people
  suffering, a crisis worsening.
- **Criticism of a current state of affairs** — a complaint, an accusation, a
  grievance, a policy attacked.
- **THE TRAP — positive opener, critical payload**: a post that OPENS with praise
  ("Fun fact", "Luar biasa", "Mantap", "Hormat", "Salut") and then pivots to
  criticism is **negative**. Read to the end before scoring.

## neutral
No clear good/bad outcome:
- Announcements, schedules, routine bulletins (weather, prices, timetables).
- Explainers, how-to, opinion without a clear valence.
- Banter, jokes, self-deprecating humour ("kalo bisa korupsi gua korupsi nih cuma
  apa yang mau di korupsi" → neutral, it's a throwaway joke).
- Entertainment chatter, fandom, trailers, lyrics.

## When genuinely uncertain
Default to `neutral` — never to `positive`.
But do **not** reach for neutral just because the topic is heavy. If the post
reports aid, a rescue, an arrest, or a resolution, that is `positive`.

---

## Output contract (read this last, it overrides nothing above)

You will be given a TSV batch file. Each line is:

    <uuid><TAB><post text>

Write an output TSV with **exactly one line per input line, in the same order**:

    <uuid><TAB><label>

`label` is exactly one of `positive`, `neutral`, `negative` — lowercase, no
punctuation, no explanation, no confidence score.

Hard rules:
- **N lines in, N lines out.** Never skip, merge, reorder, or invent a line.
- Copy each uuid **verbatim** from the input. Do not retype it from memory.
- The output file contains only TSV — no preamble, no markdown fences, no commentary.
- Some posts are truncated mid-sentence with `…`. Label what is there; a
  truncated post is still classifiable. Do not skip it.
- A post in a foreign language or one that is pure @-handles still gets a
  label — use `neutral`.
