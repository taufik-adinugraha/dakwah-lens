# Halaman Doa — evergreen SEO pages from the du'a library

- **Status:** Plan / proposal v0.1 — design only, no code yet
- **Date:** 2026-08-28
- **Owner:** Sukses & Berkah Group · Author: Taufik Adi
- **Why now:** GSC 2026-08-28 — 2,500 pages indexed, **1 click / 15 impressions per 7 days**, avg position 15.4. Indexing is solved; query-matching is not.

---

## 1. The problem this addresses

The site has **54,567 corpus chunks behind exactly one indexable URL** (`/kitab`,
a search UI). Meanwhile ~96% of the sitemap is dated briefing deliverables that
nobody searches for — "briefing dakwah 27 Agustus" is not a query.

Every query that *has* surfaced for us is a **lookup**: `kisah asyura`,
`apa itu tinggi hati`, `ma'bad artinya`, `hadits tentang upah pekerja`.
Stable, recurring, evergreen. That is the demand we already have evidence for
and currently cannot serve.

**Du'a is chosen as the first family** because it is the highest-volume,
lowest-competition Indonesian Islamic search category, the data is already
clean and structured, and 323 entries is a shippable batch. It is also the
cheapest possible test of the thesis: if these pages earn no impressions in
6–10 weeks, the evergreen strategy is wrong and we found out cheaply.

## 2. What we have

`api/src/api/data/dua_library.json` — **323 du'a**, all with `arabic` +
`translation_id`, from four sahih-grade sources
(Muslim 140, Riyad as-Salihin 117, Bukhari 49, Bulugh al-Maram 17),
tagged across 19 themes.

## 3. ⚠️ Two content gaps that decide the scope

These are the reason this is not "generate 323 pages from a JSON file".

### Gap 1 — no transliteration (0 of 323)
Indonesian du'a searches are dominated by users who cannot read Arabic script;
competing pages universally show **latin**. Without it these pages do not
compete, full stop. **323 transliterations must be authored.**

### Gap 2 — a bare du'a page is thin
Median `translation_id` is **18 words**. Arabic + translation ≈ 33 words —
far below what Google will rank, and squarely in "thin content" territory.
Enrichment is mandatory, not decorative.

### Consequence: topic pages first, individual pages later
A **topic page** aggregating 10–109 du'a is substantial by construction and
needs only Gap 1 filled. An **individual du'a page** needs a title, a context
note and a "when to recite" line authored per entry — 323 × 3 fields.

**So: ship topic pages first.** Add individual pages only for du'a that earn
impressions, once we know which ones do.

## 4. Scope — Phase 1 (the MVP)

**16 topic pages.** Three of the 19 tags are not natural queries
(`keteguhan-iman`, `akhlak`, `dunia-akhirat`) and get folded into others
rather than published.

| tag | n | target query |
|---|---|---|
| ampunan | 109 | doa minta ampunan |
| perlindungan | 80 | doa perlindungan |
| tobat | 67 | doa taubat |
| wafat-kubur | 57 | doa untuk orang meninggal |
| waktu-sulit | 44 | doa saat susah |
| syukur | 40 | doa syukur |
| rezeki | 36 | doa minta rezeki |
| hidayah | 31 | doa minta hidayah |
| pagi-petang | 25 | dzikir pagi petang |
| fitnah | 25 | doa terhindar fitnah |
| sabar | 21 | doa minta kesabaran |
| sakit-syifa | 20 | doa untuk orang sakit |
| safar | 16 | doa safar / naik kendaraan |
| keluarga-anak | 15 | doa untuk anak |
| ilmu | 10 | doa menuntut ilmu |
| hutang | 4 | doa lunas hutang |

Plus **1 index page** at `/doa`. **17 new URLs.**

## 5. URL + routing

```
/{locale}/doa                 index — all 16 topics, short intro
/{locale}/doa/[topic]         topic page (the ranking target)
```

- Slugs are the existing tag strings (`/id/doa/rezeki`) — already clean.
- Indonesian is the real audience; `/en` renders but **must canonical onto
  `/id`** (`hasEn: false`), so we do not repeat the `/en` duplicate-mirror
  problem currently sitting in GSC as 59 + 12 pages.
- `generateStaticParams` enumerates all 16 topics.
  ⚠️ **Corrected at build time:** this plan originally claimed "fully
  prerendered". It is not — **every `[locale]` route in this app renders
  dynamic (`ƒ`), including `/about` and `/how-it-works`**, a pre-existing
  consequence of the proxy + next-intl setup rather than anything about these
  pages. The du'a pages behave exactly like the rest of the app.
  What does hold: the data is a **build-time JSON import**, so there is no
  runtime API or DB dependency and no failure mode when the API is down.

**Data access:** the JSON lives in `api/`. The web app should import a copy at
`web/src/lib/data/dua-library.json` (build-time import) rather than calling the
API at request time — keeps the pages static and removes a failure mode.
A small check should assert the two files match so they cannot silently drift
(same class as the manual/auto parity bug in `project_manual_auto_parity`).

## 6. Page template

Each topic page:

1. **H1** — the target query verbatim ("Doa Minta Rezeki")
2. **Intro, 80–120 words** — what this collection is, sourcing note
3. **Per du'a**: Arabic → **latin transliteration** → Indonesian translation →
   exact citation (`Sahih Muslim 2714a`) linking to `/kitab`
4. **Related topics** — internal links to the other 15
5. `Article`/`CollectionPage` JSON-LD, self-canonical, `id` + `x-default` hreflang

Reuse: `localeAlternates()` from `@/lib/seo`, the `buildSeo` pattern from
`/m/[id]`, and the existing `<title>` template (avoid the doubled brand suffix
bug PR #43 fixed).

**The differentiator:** every entry carries an exact citation traced to a real
kitab, because the retrieval pipeline already enforces that. Most Indonesian
du'a content is uncited copy-paste. That is a genuine quality signal.

## 7. Sitemap impact

Current 1,528 URLs (all `/id`). Adding 17 `/id` URLs = **1,545**, +1.1%.
Negligible crawl-budget cost — this is not a mass-generation play.

## 8. Work required

| Item | Size |
|---|---|
| 323 transliterations (Claude-authored, batched) | the bulk of the work |
| 16 topic intros, 80–120 words each | ~1,600 words |
| Route + template + JSON-LD + sitemap entries | 1 route, 2 page files |
| Parity check between `api/` and `web/` copies of the JSON | small |

Transliteration must be **authored, not transliterated mechanically** —
Indonesian convention (`Allahumma`, `shalallahu`) differs from academic
romanisation and is what readers expect.

## 9. Success criteria — decide by these, not by vibes

Measured in GSC, `/doa/*` filtered, **10 weeks** after indexing:

- **Pass:** ≥200 impressions/week on `/doa/*`, ≥3 topics with avg position <20
- **Partial:** impressions rising but position >30 → the pages match but lack
  authority; keep, do not expand yet
- **Fail:** <50 impressions/week → evergreen lookup pages do not work for this
  domain's authority level; **abandon the strategy, do not build the hadith /
  term / ayat families**

## 9b. Finding from the build — the corpus, not the architecture, is the ceiling

Folding `keteguhan-iman`, `akhlak` and `dunia-akhirat` leaves **13 du'a on no
published topic**. Inspecting them showed the fold was not the real problem —
several are among the *most-searched* Islamic texts in Indonesian, and the
library simply does not hold enough of them to build a competitive page:

| would-be topic | du'a in library |
|---|---|
| bacaan shalawat nabi | 4 |
| bacaan tahiyat / tasyahud | 2 |
| doa setelah adzan | 1 |

A 4-item page aimed at "bacaan shalawat" loses to rumaysho/muslim.or.id on
sight, and is the same thin-content trap that pushed individual du'a pages to
Phase 2. So these stay unpublished for now.

**Follow-up (not Phase 1 scope):** if Phase 1 passes its §9 criteria, the
highest-value next move may not be the hadith family at all — it may be
*deepening the du'a corpus* around shalawat, tasyahud, adzan, and the other
high-volume daily recitations, where we currently hold 1–4 entries each.
Cheaper than a new page family and aimed at demand we can already see.

In order: **hadith topic pages** (18,577 chunks), **term/definition pages**
(`apa itu ghibah`), **ayat + tafsir pages** (6,236 verses + 23,683 tafsir
chunks). Each is a bigger build; none should start before Phase 1 reports.

## 11. Honest constraints

- **Lag.** 2–3 months before meaningful impressions on a domain this new. The
  first weeks will look like nothing is happening. That is expected, not failure.
- **Competition.** rumaysho.com, muslim.or.id, konsultasisyariah.com and NU
  Online have years of authority. We win on long-tail specificity and citation
  quality, never on head terms.
- **This does not help the briefings.** Briefing pages remain a product
  deliverable for the existing audience, not a search asset. Shipping more
  briefings will not add search traffic — that is the finding, and it does not
  change.
- **Sharia review.** Every page publishes du'a text for people to recite.
  Transliterations and topic intros should get an ustadz review pass before
  going live — a wrong transliteration is a wrong recitation.
