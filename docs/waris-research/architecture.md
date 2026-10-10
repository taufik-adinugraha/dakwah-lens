# Waris track (`/belajar/{locale}/waris`): architecture fit

Researcher: ARCHITECTURE FIT · written 2026-10-09 · status: research input. Nothing here is built, and nothing has been reviewed by an ustadz.

**Read for this report:**
- `docs/belajar-plan.md` (L1–L10, §4.7, §5.2, §7, §8);
- `docs/belajar-research/senior-ux.md` and `architecture.md`;
- `belajar/src/**` (routes, `content/schema.ts`, `lib/content.ts`, `lib/library.ts`, `lib/sources.ts`, `lib/lessonSteps.ts`, `lib/shuffle.ts`, `hooks/useProgress.ts`, `hooks/usePace.ts`, `components/lesson/*`, `i18n/*`, `proxy.ts`, `app/globals.css`, `layout.tsx`);
- `belajar/pipeline/README.md`, `common.py`, `fetch.py`, `sources.json`;
- `belajar/Dockerfile`, `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `package.json` + `package-lock.json`;
- `.github/workflows/deploy-belajar.yml`, `belajar/scripts/ci/screenshots.mjs`, `deploy/Caddyfile`;
- the local corpus in `api/data/`, inspected with python;
- `docs/waris-research/standard.md`, the sibling STANDARD report, still being written when I read it.

File paths are relative to the repo root. "Verified" means I checked it in the repo or the data in this session. Web claims carry a URL.

---

## 0. Summary

| Topic | Recommendation |
|---|---|
| **Placement** | A second track in the same container. Hub card on `/belajar/{locale}` (L9). All routes live under `src/app/[locale]/waris/**`, a folder no in-flight agent touches. |
| **Routes** | `/waris` (track home) · `/waris/pelajaran/{slug}` (lessons) · `/waris/kasus/{slug}` (case studies) · `/waris/hitung` (questionnaire "Hitung waris keluarga saya") · `/waris/laporan` (report, printable). Everything is SSG with `dynamicParams = false`. There is **no server route** for the questionnaire. |
| **Content** | `belajar/content/waris/*.json`, validated at build time by a **new** `src/content/waris-schema.ts`. It imports `SourceRef` and `ReviewStatus` from `schema.ts` and leaves that file untouched. Every record is `status: "draft"` until a fara'id reviewer signs it off. `BELAJAR_PUBLIC` builds refuse drafts, as for the Qur'an track. |
| **Dalil** | `belajar/pipeline/build_waris.py`, Python stdlib only:<br>• Qur'an bytes come from the pinned Tanzil file the pipeline already caches (verified: 4:7, 4:11, 4:12, 4:176 are present);<br>• hadith and kitab bytes come from `api/data/*.json`, recorded with a sha256 of the record;<br>• the translation comes from QuranEnc sura 4, which needs a `fetch.py` extension;<br>• fatwa and KHI text is quoted from the official PDF, with URL and page. |
| **Engine** | A pure TS module, `src/lib/waris/`. It uses exact BigInt fractions (never floats). Each fiqh point where Indonesian practice differs is a named **ruleset switch**, defaulting per STANDARD §5. `solve()` returns shares **plus a trace of rule ids**; the report, the animations and the dalil links all hang off that trace. Vitest runs the shared test vectors in CI. |
| **Questionnaire** | A pure, serialisable state machine (`useReducer` with a pure reducer). **The next question is derived from the engine:** a relative is asked about only if, given the answers so far, they could still inherit. Siblings are never asked about once a son is known. Off-ramps cover cases the tool must not compute. |
| **Privacy** | Answers never leave the browser. The working state stays in memory and `sessionStorage`. `localStorage` is used only if the learner taps "Simpan di perangkat ini". A share link puts the answers in the URL **fragment**, which browsers do not send to the server (MDN). Lint rules forbid network calls in `lib/waris` and `components/waris`. The answers include UU PDP Pasal 4(2) *specific* data: children's data, personal financial data, and possibly a criminal record (the killer impediment). |
| **Report** | Rendered in the client from (answers, ruleset) by the same engine. Sections: summary bar, the step-by-step calculation, who is blocked and why, dalil per line, limits and a referral. A `@media print` sheet plus a "Cetak / Simpan PDF" button using `window.print()`. No server PDF, because there is no Chromium on the VM (L3). |
| **Animation** | CSS and inline SVG, plus the Web Animations API where a sequence needs it. **Zero new dependencies.** Animations advance one step per learner tap ("Lanjut"), following the module's existing pace setting. The existing global reduced-motion block already covers them. Motion (34 KB full, 4.6 + 15 KB lazy) is not justified. |
| **i18n** | Content in Indonesian; English chrome only (B12). Waris strings go in separate `messages/waris/{id,en}.json` files, merged in `i18n/request.ts`, so they don't collide with the in-flight edits to `messages/{id,en}.json`. |
| **CI** | Add the waris routes to the image smoke test, plus a 404 check and grep checks for the draft label and the disclaimer. Add screenshots of the track home, a lesson, a case, the first question, and a fixture report (screen and print). Add a Playwright run that answers the questionnaire for 3 vectors and checks the report numbers. |
| **Milestones** | M1 content + engine + tests (L). M2 questionnaire + report (L). M3 lessons + animations (L). M4 case studies (M). The M1 engine can start **now**, because it only adds new files. UI work waits for the route move and the senior-UX redesign to merge. |

---

## 1. What the module already gives a second track (verified)

| Existing piece | Where | Waris reuses it as |
|---|---|---|
| Locale routing `id`/`en`, `localePrefix: "always"`, basePath `/belajar` | `src/i18n/routing.ts`, `next.config.ts` | The same. URLs become `/belajar/id/waris/...`. |
| SSG lessons, `dynamicParams = false`, `generateStaticParams` per segment | `src/app/[locale]/[surah]/[ayah]/page.tsx:24-35` | The same pattern. Note the comment at `:27-29`: a child route must generate **all** its dynamic segments itself (a parent's params never reach it). |
| Build-time zod validation; `IS_PUBLIC` refuses drafts | `src/lib/content.ts`, `src/lib/library.ts`, `src/lib/flags.ts` | New `src/lib/waris/content.ts` uses the same load → throw → `IS_PUBLIC` gate. |
| Cross-reference assertion at build | `library.ts assertReferences()` | `assertWarisReferences()`: every rule id the engine can emit has ≥1 dalil, and every case/lesson ref resolves (§3.4). |
| `SourceRef { kitab, ref?, url? }`, `ReviewStatus` | `src/content/schema.ts:22-30` | Reused unchanged inside `DalilRef`. |
| Citation display (short kitab name + readable ref) | `src/lib/sources.ts displaySource()`, `components/library/SourceList.tsx` (in flight) | Used for the dalil lists in lessons and the report. |
| `DraftChip` "menunggu tinjauan ustadz" | `components/lesson/DraftChip.tsx` | On every waris lesson, case and report line until signed off. |
| Senior-UX tokens and utilities (`btn-primary` 56px, `btn-secondary` 48px, `chip-link` 44px, `disclosure-row`, focus ring, reduced-motion block, text-size switch) | `src/app/globals.css` (in flight) | All waris UI uses these; nothing is hand-rolled. |
| localStorage via `useSyncExternalStore` (no setState in an effect) | `hooks/useProgress.ts`, `hooks/usePace.ts` (`createPref`) | The questionnaire's persistence hook follows the same pattern (§6.4). |
| Pace setting Biasa / Pelan / Tunggu saya | `lib/lessonSteps.ts`, `hooks/usePace.ts` | Drives animation stepping (§8). |
| Deterministic shuffle (hydration-safe) | `lib/shuffle.ts` | Option order in waris quizzes. |
| CSP `connect-src 'self'`, `form-action 'self'`, `Referrer-Policy strict-origin-when-cross-origin` | `next.config.ts:21-47`, `deploy/Caddyfile` | Already blocks cross-origin exfiltration from the page. The questionnaire also makes **no** same-origin requests (§6.5). |
| Footer `Footer.disclaimer` ("Dibantu AI, bukan fatwa otoritatif. …", `messages/id.json`) on every page | `app/[locale]/layout.tsx` footer | Present on waris pages automatically. The report repeats it in its own body, so the printout carries it (§7). |
| Image built in CI; build context is `belajar/` | `belajar/Dockerfile` ("Build context: the belajar/ directory") | Anything the build or tests read must live **under `belajar/`**, test vectors included (§5.6). |

**Not reusable as-is:**
- `SurahContent` / `Ayah` / `Word` are Qur'an-word shaped.
- The `recite_*` steps of `lessonSteps.ts` are recitation-specific.
- The waris track needs its own record types (§3) and its own step builder (§8.3).

---

## 2. Routes and information architecture

### 2.1 Where it sits (L9)

The route move currently in flight makes `/belajar/{locale}` a **hub of tracks** and puts the Qur'an track at `/belajar/{locale}/quran/...`. Waris becomes a sibling track:

```
/belajar/{locale}                         hub: track cards (Qur'an, Konsep tata bahasa, + Ilmu Waris)
/belajar/{locale}/quran/...               Qur'an Arabic + tafsir track (route move, in flight)
/belajar/{locale}/waris                   Ilmu Waris track home
/belajar/{locale}/waris/pelajaran/{slug}  lesson (short, visual, dalil-anchored)
/belajar/{locale}/waris/kasus             case-study list
/belajar/{locale}/waris/kasus/{slug}      one case study
/belajar/{locale}/waris/hitung            questionnaire "Hitung waris keluarga saya"
/belajar/{locale}/waris/laporan           report (reads the learner's answers in the browser; printable)
/belajar/{locale}/konsep, /kosakata/...   shared library (stays at hub level, L9; waris does not use it)
```

- **Slugs are Indonesian**, like the existing `konsep`, `kosakata` and `kredit`.
- **`laporan` is its own route, not a step inside `hitung`:**
  - the print stylesheet stays simple;
  - "Kembali ubah jawaban" is a plain link back to `hitung`;
  - a report link can be bookmarked on the learner's own device.
- **The report page is SSG with an empty shell.** All of its content renders in the client from the answers (§7). Its static HTML holds only the chrome, the disclaimer and a `<noscript>` note.

**Route precedence.** Until the move lands, `[locale]/[surah]` is a top-level dynamic segment. A static `waris/` folder would take precedence over it in the App Router. But adding the folder before the move means a second agent edits the hub and layout at the same time, so wait (§12).

### 2.2 Page inventory and rendering mode

| Route | Mode | `generateStaticParams` | Notes |
|---|---|---|---|
| `waris/page.tsx` | SSG, server component | locales (from layout) | Three doors: **Pelajari** (lessons), **Contoh kasus**, **Hitung waris keluarga saya**. The disclaimer and the draft status sit above the fold. |
| `waris/pelajaran/[slug]/page.tsx` | SSG | `{ locale × lesson.slug }`, emitted here | Server-rendered text. Client islands only for the animation "stage" and the 3–5 item check. |
| `waris/kasus/page.tsx`, `kasus/[slug]/page.tsx` | SSG | `{ locale × case.slug }` | The case result is **computed by the engine at build time** in the server component. Numbers are never typed into content (§3.3). |
| `waris/hitung/page.tsx` | SSG shell + one client component | locales | `"use client"` questionnaire. No server action, no route handler, no `<form action>`. |
| `waris/laporan/page.tsx` | SSG shell + client report | locales | Reads state from the fragment or storage (§6.4). Shows "Belum ada jawaban — mulai di sini" when there is none. |
| Unknown slug | 404 | — | `dynamicParams = false`, as the Qur'an pages do. Covered by the smoke test (§11). |

### 2.3 Links

- **One helper for in-module links.** The route move introduces one helper so lesson links are not hand-built. Waris adds `warisHref.lesson(slug)`, `.kase(slug)` (`case` is a reserved word), `.hitung()` and `.laporan(fragment?)` to the same helper file **after** the move lands.
- **Cross-links between the three doors:**
  - each lesson ends with "Coba pada kasus: …" and "Hitung keluarga Anda";
  - each report line links to the lesson that explains its rule (by rule id → lesson id, §3.4);
  - each case links to the lessons for the rules its trace uses.
- **Main site.** No header or footer link. L10's gate ("Belajar" in the header only after the first ustadz sign-off) is about the Qur'an track. The waris track gets **its own** sign-off gate before it is promoted anywhere: a hub card only, noindex, as the whole module is today (`BELAJAR_PUBLIC=false`).

---

## 3. Content: where it lives and how it is validated

### 3.1 Files (same authored → build → content flow as Al-Fatihah)

| Path | Written by | Role |
|---|---|---|
| `belajar/pipeline/authored/waris.dalil.json` | People (with Claude in chat) | **Locators only:** which dalil, where in which source, which span to show. It contains no Arabic; the bytes come from the build. |
| `belajar/pipeline/authored/waris.rules.json` | People; reviewer signs | One `RuleNote` per engine rule id: a plain sentence, dalil ids, lesson link. |
| `belajar/pipeline/authored/waris.lessons.json` | People; reviewer signs | Lessons: scenes, visual specs, checks. |
| `belajar/pipeline/authored/waris.cases.json` | People; reviewer signs | Case studies: story, engine input, the reviewer's expected shares. |
| `belajar/pipeline/authored/waris.glossary.json` | People; reviewer signs | Each heir: name, who it is ("anak laki-laki dari anak laki-laki"), and a one-line definition. |
| `belajar/pipeline/build_waris.py` | — | Extracts the dalil bytes and joins everything into `belajar/content/waris.json`. |
| `belajar/pipeline/validate_waris.py` | — | Independent re-check (§4.4). Exits 1 on failure. |
| `belajar/content/waris.json` | Generated, committed | One `WarisTrack` record, imported at build time by `src/lib/waris/content.ts`. |
| `belajar/content/waris/test-vectors.json` | Copy of `docs/waris-research/test-vectors.json` | Read by vitest. Kept under `belajar/` because the image build context is `belajar/`. Parity-checked (§5.6). |

Do not name a directory `data/`: `.gitignore` swallows it (plan §7.2).

### 3.2 Schema additions: a new file, `src/content/waris-schema.ts`

`schema.ts` is being edited by the in-flight agents, so the waris types go in a **separate file** that imports the shared pieces:

```ts
import { z } from "zod";
import { ReviewStatus, SourceRef } from "./schema";
import { HEIRS, RULE_IDS, RULESETS } from "@/lib/waris/registry"; // engine is the single source of ids

const Slug = z.string().regex(/^[a-z0-9-]+$/);
export const HeirId = z.enum(HEIRS);            // "suami", "istri", "anak_lk", "anak_pr", "ibu", "ayah", ...
export const RuleId = z.enum(RULE_IDS);         // "fard.istri.1_8_ada_anak", "hajb.saudara.oleh_anak_lk", "aul", "radd", ...
const Frac = z.string().regex(/^\d+\/[1-9]\d*$/); // "1/8": never a decimal

/** One dalil, bytes extracted by build_waris.py — never typed. */
export const DalilRef = z.object({
  id: Slug,
  kind: z.enum(["quran", "hadith", "kitab", "fatwa", "peraturan"]),
  /** Human citation: "QS. An-Nisa' [4]: 11", "Sahih al-Bukhari 6732",
   *  "Fath al-Qarib, Kitab al-Fara'id", "Fatwa MUI No. 5/MUNAS VII/MUI/9/2005", "KHI Pasal 185". */
  citation: z.string().min(3),
  /** Arabic exactly as in the source (Qur'an: Tanzil bytes). null for Indonesian-language sources. */
  ar: z.string().min(1).nullable(),
  /** Optional shown span, as a [start,end) slice of `ar`: the card shows a slice, never a retyped excerpt. */
  span: z.tuple([z.number().int().nonnegative(), z.number().int().positive()]).optional(),
  /** Indonesian text: provider-verbatim (QuranEnc, Muslim `id`), source-verbatim (fatwa/KHI) or in-house reviewed. */
  text_id: z.object({
    text: z.string().min(5),
    kind: z.enum(["provider_verbatim", "source_verbatim", "inhouse_reviewed"]),
    source_label: z.string().min(3),
    version: z.string().optional(),
  }),
  /** Hadith only: grading, as stated by a named source. */
  grade: z.string().min(3).optional(),
  provenance: z.object({
    source_id: z.string(),  // key in pipeline/sources.json, e.g. "tanzil_uthmani", "api_data_bukhari"
    locator: z.string(),    // "4|11", "citation_en=Sahih al-Bukhari 6732", "section_id=117 (C139)", "PDF hlm. 479"
    sha256: z.string().regex(/^[0-9a-f]{64}$/), // of the source record/line the bytes were sliced from
  }),
  sources: z.array(SourceRef).min(1),
  status: ReviewStatus,
}).refine((d) => d.kind !== "hadith" || !!d.grade, "hadith needs a grade")
  .refine((d) => d.kind !== "quran" || d.ar !== null, "Qur'an needs Tanzil bytes");

/** Why the engine did something: one entry per rule id the engine can emit. */
export const RuleNote = z.object({
  rule: RuleId,
  /** One plain sentence, Anda register, with {ahli_waris} placeholders: "Istri mendapat 1/8 karena almarhum meninggalkan anak." */
  says: z.string().min(10),
  dalil: z.array(Slug).min(1),
  lesson: Slug.optional(),
  sources: z.array(SourceRef).min(1),
  status: ReviewStatus,
});

/** Engine input. Shared by case studies, lesson visuals and the questionnaire's output. */
export const FamilyInput = z.object({
  heirs: z.record(HeirId, z.number().int().min(0).max(20)), // counts; 0 = none/not alive
  barred: z.array(z.object({ heir: HeirId, reason: z.enum(["beda_agama", "pembunuhan"]) })).default([]),
  ruleset: z.enum(RULESETS).default("default"),
});

export const Visual = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("urutan") }),                                          // tajhiz → utang → wasiat ≤1/3 → waris
  z.object({ kind: z.literal("pohon"), family: FamilyInput, focus: z.array(HeirId).default([]) }), // family tree, blocked marked
  z.object({ kind: z.literal("batang"), family: FamilyInput }),                     // 100% bar of shares
  z.object({ kind: z.literal("petak"), family: FamilyInput }),                      // asal-masalah tiles; shows 'aul / radd
  z.object({ kind: z.literal("dalil"), dalil: Slug }),                              // Arabic + translation card
]);

export const WarisLesson = z.object({
  slug: Slug, order: z.number().int().positive(),
  title: z.string().min(3), summary: z.string().min(15),
  /** Short scenes; ≤ 280 chars each (senior-ux §3.5 splits captions over 180). */
  scenes: z.array(z.object({ id: Slug, text: z.string().min(10).max(280), visual: Visual.optional() })).min(1).max(8),
  dalil: z.array(Slug).min(1),           // the anchor dalil: every lesson stands on one
  rules: z.array(RuleId).default([]),    // rules it explains (report lines link back here)
  check: z.array(z.object({ q: z.string(), options: z.array(z.string()).min(2).max(4), answer: z.number().int(), why: z.string() })).max(5),
  sources: z.array(SourceRef).min(1),
  status: ReviewStatus,
});

export const CaseStudy = z.object({
  slug: Slug, title: z.string().min(5),
  story: z.array(z.string().min(20)).min(1).max(4), // fictional family, no real persons
  input: FamilyInput,
  /** Reviewer's answer from the kitab/KHI example: an ORACLE, never displayed. The page shows the engine's numbers. */
  expected: z.object({ shares: z.record(HeirId, Frac), aul: z.boolean(), radd: z.boolean() }),
  takeaway: z.string().min(15),
  lessons: z.array(Slug).min(1),
  sources: z.array(SourceRef).min(1),
  status: ReviewStatus,
});

export const WarisTrack = z.object({
  dalil: z.array(DalilRef), rules: z.array(RuleNote),
  lessons: z.array(WarisLesson), cases: z.array(CaseStudy),
  glossary: z.array(z.object({ heir: HeirId, label: z.string(), who: z.string(), sources: z.array(SourceRef).min(1), status: ReviewStatus })),
  data_versions: z.record(z.string(), z.string()),
});
```

**Design notes:**
- **Ids come from the engine.** `HEIRS`, `RULE_IDS` and `RULESETS` are exported by the engine's registry, so content cannot name a rule or an heir the engine doesn't know. The engine never imports content: the dependency points one way.
- **No number in content is shown to a learner.**
  - Visuals and case pages call `solve(input)` at build time.
  - `expected` is only an oracle, kept because the reviewer's kitab-derived answer and the engine must agree or the build fails.
  - This applies the module's existing "counts are computed, never typed" rule (pipeline README "Facts") to fara'id.
- **Example families are fictional:** no real names and no case files from a court. This follows the "hate the deed, not the person" rule and UU PDP.
- **Grades.** A hadith grade is stated by a named source. For Bukhari and Muslim the grade is the collection itself, and the reviewer confirms the wording.

### 3.3 Where the numbers on a page come from

```
waris.cases.json (input) ──► solve(input, ruleset) at build (server component) ──► page HTML
                     └─────► expected ── assert equal ──► build/test fails on mismatch
```

The questionnaire report uses the same `solve()` in the browser, so a lesson, a case and a learner's own report can never disagree.

### 3.4 Build-time validation (`src/lib/waris/content.ts`)

1. **`WarisTrack.safeParse(raw)`**; throw with the first 10 issues (as `content.ts` does).
2. **`assertWarisReferences()`:**
   - every `RULE_IDS` member has exactly one `RuleNote`, so the report can never print a line with no reason and no dalil;
   - every dalil, lesson and case slug referenced exists;
   - every lesson visual's `family` parses.
3. **Case oracle:** for each case, `solve(input)` equals `expected`, both `'aul` and radd included.
4. **`IS_PUBLIC` gate:** refuse a public build if any waris record is `draft`. The Qur'an track keeps its own gate; the two tracks are signed off independently.
5. **Python `validate_waris.py`** (§4.4) checks the bytes. It is run by hand after `build_waris.py`, like `validate.py`, and is optional in CI (it needs the pipeline cache).

### 3.5 Review status and the reviewer

- Every record starts `draft` and renders with `DraftChip`. On the report, every line whose rule note is still draft carries the chip.
- **Plan §8 names no fara'id reviewer.** B6 lists nahwu-sharaf, tajwid/qira'at and hadith; the waris track needs **a fiqh mawaris reviewer** (open question Q1).
- Sign-off records follow plan §7.5 stage 5: `belajar/content/reviews/waris-<record>.json` with reviewer, date and `content_sha256`.

---

## 4. Dalil pipeline (extraction with byte-identical Arabic and provenance)

The track rests on a small, fixed set of dalil, perhaps 15–25 records. That suits the existing offline pipeline: Python stdlib only, no LLM, no paid API, every byte traceable.

### 4.1 Where each kind of dalil comes from

| Kind | Bytes from | Translation from | Provenance recorded |
|---|---|---|---|
| **Qur'an** | **Tanzil Uthmani**, the pinned `belajar/pipeline/cache/tanzil/quran-uthmani.txt` already fetched and sha256-pinned by `fetch.py` (module rule: never `api/data/quran.json`, plan §5.2). Verified present: 4:7, 4:11, 4:12, 4:33, 4:176, 2:180, 4:141. | QuranEnc `indonesian_affairs`, **sura 4**, verbatim with footnotes, labelled exactly as QuranEnc names it (same rule as Al-Fatihah). `fetch.py fetch_quranenc` is hard-wired to sura 1 (`fetch.py:138-151`, asserts "sura 1 … ayat 1..7"), so it needs a `--sura` list. | `tanzil_uthmani`, locator `4\|11`, sha256 of the file (already pinned) + sha256 of the line |
| **Hadith** | `api/data/bukhari.json`, `muslim.json`, `bulugh-al-maram.json`, by `citation_en` (plan §5.2: resolve by `citation_en`, never by position) | `muslim.json` has an `id` field (7,360 of 7,563 records, verified). It is the platform's own translation, with isnad, so the shown span must be chosen and **reviewed**. Bukhari and Bulugh have **no Indonesian** in the corpus (verified: no `id` key), so an in-house reviewed translation is needed. | `api_data_<collection>` + `citation_en` + sha256 of the record's `ar` bytes; plus a canonical-number snapshot (4.3) |
| **Kitab** (Syafi'i fiqh frame) | `api/data/fath-al-qarib.json`: `section_id` 116 (C138, "كتاب أحكام الفرائض والوصايا", 2,356 chars) and 117 (C139, "الفروض المقدرة", 2,869 chars). Also `fath-al-muin.json` 34 (C39, "باب الفرائض"); `fiqh-as-sunnah.json` 839–863 (C1081–C1108: الفرائض, أسباب الإرث, شروط الميراث, العصبة, الحجب والحرمان, الحمل, ميراث المرتد…); `al-umm.json` 549–559 (C798–C809). All verified by title. | Local JSON is Arabic only. Per project memory, Fath al-Qarib is embedded bilingually in prod Qdrant; that is **not verified here**. Otherwise an in-house reviewed rendering. | `api_data_<kitab>` + `section_id`/`anchor` + sha256 of the section's `ar` |
| **Fatwa** | MUI official PDF (STANDARD §1). Indonesian; `ar: null`. | Source-verbatim (Indonesian) | URL + sha256 of the downloaded PDF + printed page ("hlm. 479") |
| **Peraturan** (KHI) | KHI Buku II, Pasal 171–214, from an official copy, e.g. JDIH BPK https://peraturan.bpk.go.id/Details/293351/inpres-no-1-tahun-1991-penyebarluasan-kompilasi-hukum-islam or BPHN https://bphn.go.id/data/documents/91ip001.pdf (both found in search; not yet read). | Source-verbatim | URL + sha256 + pasal/ayat |

**Fatwa and KHI files.** They are added to `pipeline/sources.json` the same way as Tanzil: URL, retrieval date, sha256 pinned by `fetch.py`, with `--refresh` drift checks. The PDFs are cached and git-ignored; only the quoted strings and their hashes are committed.

### 4.2 Candidate dalil located in the local corpus (verified locators; selection is for the content researcher and the reviewer)

| Anchors | Locator found (2026-10-09) | Notes |
|---|---|---|
| Shares of children and parents | QS 4:11 (Tanzil) | Also the first dalil the MUI 2005 fatwa cites (STANDARD §1.1) |
| Spouses; half-siblings through the mother | QS 4:12 | |
| Full and paternal siblings (kalalah) | QS 4:176 | Bukhari 6744 also mentions kalalah (search hit; content not checked) |
| Men and women both have a share | QS 4:7 | |
| "Give the fara'id to their people, the rest to the nearest male" (asabah) | Sahih al-Bukhari 6732 (also 6735, 6737, 6746); muslim.json `citation_en` "Sahih Muslim 4141"; Bulugh al-Maram 1095 | **The local Muslim number is not canonical:** Bulugh 1095's own footnote in the corpus text reads «رواه البخاري ( 6732 )، ومسلم ( 1615 )». |
| Difference of religion is an impediment | Sahih al-Bukhari 6764; muslim.json "Sahih Muslim 4140"; Bulugh al-Maram 1096 | Matches the hadith of Usamah cited by Fatwa MUI 5/2005 |
| Daughter + son's daughter + sister (Ibn Mas'ud's ruling) | Sahih al-Bukhari 6736; Bulugh al-Maram 1097 | A classic worked example and a good case study |
| Wasiat at most one third | Sahih al-Bukhari 2742 (also 2743, 2744, 3936, 4409, 5354, 5659, 5668); muslim.json 4209/4214/4215/4218; Bulugh 1112 | Sa'd b. Abi Waqqas |
| Killer does not inherit | Bulugh al-Maram 1107 | **Grading is contested in the corpus text itself:** Ibn Hajar writes «وأعله النسائي، والصواب: وقفه على عمر», and the editor's footnote cites an authentication in al-Irwa' 1671. The reviewer must decide how to present it (and whether to rest the rule on KHI Pasal 173 and the scholars' consensus instead, per STANDARD). |
| Debts and estate before division | "من ترك مالا فلورثته": Bukhari 2298, 2398, 5371, 6731, 6763 | Search hits; content not checked |

**Rules for using this table.**
- It is a **finding aid**, not a selection. Which hadith anchors which rule, and the exact span shown, is reviewed content.
- The `grades` field is empty (`[]`) in every record above (verified), so no grade can be read from the data. The grade comes from a named source, e.g. Ibn Hajar's own statement in Bulugh, or the reviewer.

### 4.3 `build_waris.py`: steps

1. Load `authored/waris.dalil.json` (locators + span selectors + translation choice).
2. **Qur'an.**
   - Slice the verse from `common.load_tanzil()`; `ar` = the verse bytes verbatim.
   - A shown excerpt is a `span` into those bytes, found by `common.normalise()` search keys (the same normalisation `facts.py` uses), **never retyped**.
3. **Hadith and kitab.**
   - Read the record by `citation_en` / `section_id`; take `ar` verbatim.
   - Store `span` for the matn or the passage to show:
     - Bulugh records end with an editor footnote ("1‏ .‏‏1 ‏- صحيح . رواه …", verified on 1095 and 1107), which is **not** Ibn Hajar's text and must fall outside the span;
     - Bukhari and Muslim records start with the isnad.
4. **Canonical hadith numbers.**
   - `muslim.json` numbers are the in-file sequence (plan §5.2). Per project memory, prod Qdrant was migrated to sunnah.com numbering on 2026-06-23.
   - Resolve each Muslim citation once through `retrieve_by_citation` (`api/src/api/services/kitab_retrieval.py:1009`) **inside the prod api image, read-only** (plan §7.5 stage 1).
   - Write `belajar/pipeline/snapshots/waris-hadith.json` with collection, point id, canonical citation and sha256. This mirrors the existing `Hadith.provenance` shape in `schema.ts`.
   - It touches prod (read-only), so it needs the operator's go.
   - **Fallback:** cite Bukhari by its local number and show Muslim as "juga diriwayatkan Muslim" without a number until resolved. The local Bukhari number agrees with the number Bulugh 1095's footnote cites (6732); one data point, not a proof.
   - **Bulugh numbering** is also unconfirmed: project memory records the Bulugh migration to canonical numbering as deferred. The reviewer checks each Bulugh number against a print edition.
5. **Translations.**
   - QuranEnc sura 4 verbatim (with `[n]` footnotes split, as `build_fatihah.py` does).
   - Muslim `id` span verbatim, marked `inhouse_reviewed`.
   - Authored Indonesian for Bukhari, Bulugh and kitab passages, marked `inhouse_reviewed`.
6. **Join** with rules, lessons, cases and glossary; write `belajar/content/waris.json`; print warnings (e.g. a span that starts mid-word).

### 4.4 `validate_waris.py` (independent re-check; exits 1 on failure)

- Every Qur'an `ar` equals the Tanzil line byte for byte. Every `span` lies inside `ar` on a word boundary.
- Every hadith/kitab `ar` equals the source record's field, and its sha256 matches `provenance.sha256`.
- The QuranEnc text and footnotes equal the cached sura-4 response.
- **No Arabic script anywhere in Indonesian prose** (`says`, `scenes[].text`, `story`, `takeaway`), except «…» slices that are Tanzil bytes. This reuses `validate.check_prose`. Arabic is shown only through `DalilRef`.
- Transliteration in prose follows SKB 158/1987, reusing `validate.check_translit_prose`. Fara'id terms in Indonesian prose (asabah, 'aul, radd, hajb, ashabul furudh) use the usual pesantren spelling, as grammar terms do today; the reviewer fixes the list.
- Every `RuleNote` cites ≥1 dalil, and every lesson has ≥1 anchor dalil, so no lesson stands without a dalil.
- Every fatwa/KHI quote is a substring of the text extracted from the pinned PDF (`pdftotext` is not stdlib, so the extracted text is cached once and pinned by sha256).

---

## 5. The engine: a pure TypeScript module, `src/lib/waris/`

### 5.1 Principles

- **Pure and deterministic.**
  - No I/O, no `Date`, no `Math.random`, no React, no imports from `content/`.
  - It runs identically at build time (case pages, lesson visuals), in the browser (questionnaire report) and in vitest.
  - It is safe under the React Compiler `purity` lint rule (§8.4).
- **Exact arithmetic.**
  - Shares are rationals over `bigint`; there are no floats anywhere in the calculation.
  - Percentages and rupiah are derived for display only, with the rounding rule printed (§5.4).
- **Rulesets, not forks.** Every point where the "MUI standard" (in practice classical fara'id + KHI + MA practice, per STANDARD's short answer) differs from classical Syafi'i fiqh is a **named switch** with a reference to its STANDARD §4 letter. The default profile is STANDARD §5's engine default. A second profile, `klasik-syafii`, exists for comparison ("Bagaimana menurut fikih klasik?").
- **Explain, don't just answer.** `solve()` returns a **trace of rule ids**. The report, the lesson visuals and the dalil links are all rendered from the trace, through the reviewed `RuleNote` per rule id (§3.2).
- **Refuse rather than guess.** Combinations the engine does not implement, or that a self-service tool should not compute, return `{ kind: "rujuk" }` with reasons, never a best guess.
  - Examples: khuntsa (an heir of undetermined sex), mafqud (a missing heir), haml (an unborn heir), simultaneous deaths, wala', and a biological father's wasiat wajibah for a child born of zina (STANDARD §1.2).

### 5.2 Layout

```
src/lib/waris/
  registry.ts        HEIRS (as const), RULE_IDS (as const), RULESETS, DEFAULT_RULESET: ids only, no logic
  frac.ts            bigint rationals: make, add, sub, mul, div, cmp, lcm, gcd, toString "a/b"
  types.ts           FamilyInput, EstateInput, Ruleset, Result, Share, Blocked, TraceStep
  estate.ts          harta waris: harta bersama ½ to the surviving spouse(s) (KHI 96, 190) → own share
                     + harta bawaan − last-illness costs − tajhiz − debts → wasiat ≤ ⅓ unless all heirs consent (KHI 195, 201)
  eligibility.ts     mawani': beda agama (Fatwa MUI 5/2005; KHI 171c), pembunuhan (KHI 173 vs classical, a switch)
  substitution.ts    KHI 185 pre-pass (switch 4.A): who stands in, with the 185(2) cap
  hajb.ts            hajb hirman (total exclusion) table, switch-aware (4.B, 4.D)
  furudh.ts          fixed shares incl. 'umariyyatain (KHI 178(2)), switch-aware father (4.K)
  asabah.ts          bi nafsihi / bil ghair (2:1) / ma'al ghair
  special.ts         jadd ma'a al-ikhwah, musytarakah, akdariyyah: only as STANDARD decides; otherwise rujuk
  adjust.ts          'aul (KHI 192), radd (KHI 193; spouse switch 4.E), no heirs → Baitul Mal (KHI 191) / rujuk
  distribute.ts      tashih (integer units per head), optional rupiah split (§5.4)
  solve.ts           orchestrates the stages; returns Result with trace
  questionnaire/     graph.ts, machine.ts, codec.ts (§6)
  content.ts         server-only: loads + validates content/waris.json (§3.4); NOT imported by client code
  *.test.ts          vitest (§5.6)
```

`content.ts` imports `server-only`, which is already a dependency, so the full content JSON can never be pulled into a client bundle by accident. The client report receives only the `RuleNote` and `DalilRef` subset it needs, as props from the server page shell.

### 5.3 Types (sketch)

```ts
export type Ruleset = {
  id: (typeof RULESETS)[number];                    // "standar-indonesia" (default) | "klasik-syafii"
  substitution: "none" | "khi185";                  // STANDARD 4.A
  daughtersExcludeSiblings: boolean;                // 4.B (yurisprudensi MA 86 K/AG/1994)
  uterineExcludedBy: "khi181" | "classical";        // 4.D
  raddToSpouse: boolean;                            // 4.E
  fatherNoChild: "classical" | "khi177_sema";       // 4.K
  hartaBersama: boolean;                            // 4.L (estate stage)
  killerBarred: "final_conviction" | "any_killing"; // KHI 173 vs Fath al-Qarib
  // …one field per STANDARD §4 letter; each field's JSDoc cites the letter and the article/fatwa
};

export type TraceStep = { rule: RuleId; heirs: HeirId[]; facts?: Record<string, string> }; // facts: "dari":"1/4","menjadi":"1/8","karena":"anak_lk"

export type Result =
  | {
      kind: "hasil";
      ruleset: Ruleset["id"];
      estate?: EstateBreakdown;               // only when amounts were given
      base: bigint;                           // asal masalah
      finalBase: bigint;                      // after 'aul / radd / tashih
      shares: { heir: HeirId; count: number; group: Frac; perHead: Frac; units: bigint; rule: RuleId; rupiah?: bigint; rupiahPerHead?: bigint }[];
      blocked: { heir: HeirId; by: HeirId[] | "mani'"; rule: RuleId }[];
      adjustments: ("aul" | "radd" | "baitul_mal")[];
      switchesUsed: (keyof Ruleset)[];        // the report names every switch that changed the outcome
      trace: TraceStep[];
    }
  | { kind: "rujuk"; reasons: RujukReason[] }; // refer to a court / an ustadz
```

`switchesUsed` is computed by **re-solving with each switch flipped** (cheap: a few dozen solves) and listing those whose flip changes `shares`. The report can then say honestly, for example, "Hasil ini berbeda dengan fikih klasik karena KHI Pasal 185", instead of listing every switch.

### 5.4 Money

- **Optional.** The report works with fractions alone, which is the default. Rupiah is shown only if the learner enters amounts.
- **Integer rupiah** (`bigint`). `perHead = floor(total × num / den)`. Leftover rupiah go one each to the largest remainders, in a fixed heir order.
- The report states the rule ("selisih pembulatan Rp n diberikan kepada …") and that the fraction is what counts.
- No currency floats, no `Intl` in the engine. Formatting happens in the component.

### 5.5 Size budget

The engine has no dependencies. Estimated tens of KB unminified, few KB gzip (not measured; measure in CI, §11.4). Only `/waris/hitung`, `/waris/laporan` and the lesson/case visual islands import it.

### 5.6 Tests and the shared vectors (vitest, in CI)

`vitest.config.ts` already includes `src/**/*.test.ts`, and the verify job already runs `npm test`, so no workflow change is needed for the tests themselves.

| File | What it checks |
|---|---|
| `frac.test.ts` | Arithmetic and normalisation; `1/2 + 1/3 = 5/6`; no float path (a lint `no-restricted-syntax` on `Number(` / `parseFloat` inside `lib/waris/*` except `distribute.ts` formatting) |
| `vectors.test.ts` | Loads `belajar/content/waris/test-vectors.json`. For each vector: `solve(input, RULESETS[vector.ruleset])` deep-equals `expected` (shares as "a/b" strings, blocked set, adjustments). Each vector carries its own source (kitab page / KHI pasal / court example URL), so a failing test names the authority it disagrees with. |
| `invariants.test.ts` | Seeded random families (reusing `lib/shuffle.ts`'s mulberry32 for reproducibility), e.g. 20,000 per ruleset. Checks: shares sum to exactly 1 after 'aul/radd (or the Baitul Mal remainder is explicit); no zero or negative share; every present heir is in exactly one of `shares` / `blocked` / ineligible; every `blocked.by` heir is present; a son present ⇒ every sibling blocked; male:female = 2:1 inside every bil-ghair group; KHI 185(2) cap holds; the result does not depend on input key order; `solve` is idempotent. |
| `cases.test.ts` | Every content case: engine output = `expected` (the same check as the build, but with a readable diff) |
| `questionnaire/*.test.ts` | §6.6 |

**Where the vectors live.**
- The task names `docs/waris-research/test-vectors.json`. The image build context is `belajar/` (`belajar/Dockerfile`), and the workflow's `paths:` filter is `belajar/**`, so a docs-only change would not run CI.
- **Recommendation:** the canonical file is `belajar/content/waris/test-vectors.json`. Until the research phase ends, `scripts/check-waris-vectors.mjs` (verify job, like `check-token-parity.mjs`) fails if the docs copy and the belajar copy differ. Add `docs/waris-research/test-vectors.json` to the workflow's `paths:` for that period.
- After M1 the docs file becomes a one-line pointer, and the parity script is removed.

**Second oracle (optional, recommended).** The content cases' `expected` values are written by the reviewer from kitab or KHI examples. That gives two independent derivations, the engine and the reviewer, which must agree or the build fails (§3.4).

---

## 6. Questionnaire "Hitung waris keluarga saya" (`/waris/hitung`)

### 6.1 What the learner experiences

The page shows one question per screen, in the "Anda" register:
- the question in plain Indonesian;
- big answer buttons (`btn-secondary` 48px; `btn-primary` 56px for "Lanjut");
- "Kembali", plus "Mengapa ditanyakan?" (a disclosure with the rule note);
- "Apa artinya?" (a disclosure with the glossary entry, e.g. "saudara seibu = saudara satu ibu, lain ayah").

The progress line reads "Bagian 2 dari 5 · Keluarga dekat". It shows sections, not a question count, because the count changes with the answers.

**Phases.** Each phase appears only when the answers so far make it relevant.

| Phase | Asks | Branching (examples) |
|---|---|---|
| A. Pembuka | Nothing. Shows the purpose, "jawaban Anda tidak dikirim ke mana pun", the disclaimer and the draft status. | — |
| B. Gerbang | Has the person died? Was the pewaris Muslim? Their sex. | Not yet died → explain that dividing during one's life is **hibah**, not waris (KHI 211, per STANDARD §1.6), link to the lesson, and stop. Not Muslim → explain KHI 171(b), Fatwa MUI 5/2005, and refer to a court; stop. |
| C. Pasangan | Husband alive at death / number of wives alive (1–4); each spouse Muslim? | The deceased's sex selects suami vs istri. If wives > 1 → harta bersama per household (KHI 190) in phase I. |
| D. Keturunan | Sons, daughters (counts). Son's children only if they could still inherit. Under the substitution switch: "Ada anak yang meninggal lebih dulu dan meninggalkan anak?" | A son present ⇒ phases F–G are skipped entirely. |
| E. Orang tua | Father, mother; father's father only if the father is not alive; grandmothers only if they could inherit. | — |
| F. Saudara | Full / paternal / uterine brothers and sisters, counts | Asked **only** if no son, son's son or father, and, under 4.B, no daughter. |
| G. Kerabat jauh | Nephews, uncles, cousins (male, through males) | Asked only while no asabah is known **and** a remainder exists after the fixed shares. |
| H. Penghalang | "Apakah ada di antara ahli waris di atas yang bukan Muslim?" and "…yang telah divonis membunuh almarhum?" | Asked once per group present, with a gentle explanation. The killer wording follows the `killerBarred` switch. |
| I. Harta (optional) | "Ingin dihitung dalam rupiah?" If yes: harta bersama vs harta bawaan, debts, last-illness and funeral costs, wasiat amount and recipient, pension/insurance type (STANDARD §1.4–1.5). | Skipping it gives fractions only. |
| J. Keadaan khusus | Unborn child, missing heir, heir of undetermined sex, died together in one incident | Any yes → `rujuk` (refer); the report explains why. |
| K. Periksa | A summary of every answer, each with an "Ubah" link | → `/waris/laporan` |

### 6.2 How "the next question depends on the previous answer" is implemented

Questions are **data**: a list of nodes in a fixed priority order. The adaptivity comes from the **engine**, not from a hand-drawn tree:

```ts
type Node = {
  id: QId;                               // "anak_lk", "ayah", "sdr_pr_kandung", "harta_bersama", …
  phase: Phase;
  input: { kind: "yesno" } | { kind: "count"; max: number } | { kind: "choice"; options: string[] } | { kind: "amount" };
  /** Ask only if this can still change the result, given what is known. */
  relevant: (known: PartialFamily, r: Ruleset) => boolean;
  apply: (known: PartialFamily, a: Answer) => PartialFamily;
  why?: RuleId;                          // "Mengapa ditanyakan?" → RuleNote
  help?: HeirId;                         // "Apa artinya?" → glossary
};
```

For every heir node, `relevant` is **one call into the engine**. *(Revised in review 2026-10-09.)* The call is `couldAffectOutcome(heir, known)`, not `couldInherit(heir, known, ruleset)`. It is true if the relative could change **any number in either ruleset**: they could inherit in either column; or they count toward the mother's "two or more siblings" even if blocked; or they count against the grandfather (mu'addah); or they decide a named pattern (engine.md §6.1). The questionnaire collects the union because the report always computes both columns. It applies the same hajb table `solve()` uses, with unanswered relatives treated as "maybe present".
- So the questionnaire **cannot drift** from the calculation. The platform has been hurt before when two paths each carried their own copy of a rule (project memory: "Manual/auto parity", two incidents).
- The report can say exactly why a group was never asked ("Saudara tidak ditanyakan karena anak laki-laki menghalangi mereka", with that rule's dalil).

`next(state)` is the first node, in priority order, that is relevant and unanswered. "Kembali" walks the derived path backwards. **Changing an earlier answer** keeps the later answers in state but ignores any that become irrelevant, so flipping back restores them. The share codec (§6.4) drops irrelevant answers, which keeps the data minimal.

### 6.3 State machine (pure, serialisable)

```ts
type QState = {
  v: 1;                                   // schema version (codec migrates old links)
  ruleset: RulesetId;                     // default per STANDARD §5
  answers: Partial<Record<QId, Answer>>;  // the ONLY source of truth
  at: QId | "periksa";                    // UI cursor; recomputed if it became irrelevant
};
type Action =
  | { type: "jawab"; q: QId; a: Answer }
  | { type: "kembali" } | { type: "ubah"; q: QId }
  | { type: "ruleset"; id: RulesetId } | { type: "ulang" };

export function reduce(s: QState, a: Action): QState;        // pure
export function pathOf(s: QState): QId[];                    // derived, never stored
export function toInput(s: QState): FamilyInput & EstateInput; // derived → solve()
```

The component is `useReducer(reduce, initial)`. The reducer is pure, which satisfies the React Compiler lint rules (§8.4). There is no setState in effects and no refs read during render.

### 6.4 Persistence: the answers never reach the server

| Layer | When | Key / form | Why |
|---|---|---|---|
| React state | Always | — | Working copy |
| `sessionStorage` | Autosave on every answer | `belajar:v1:waris:draft` (JSON `QState`) | Survives a reload; gone when the tab closes. Suits a shared family phone. **Never holds the A3 "a family member caused the death" answer (k6)** (review 2026-10-09): k6 routes straight to E-BUNUH and is not part of `QState`, the codec, print or the text summary. |
| `localStorage` | **Only** after the learner taps "Simpan di perangkat ini" | `belajar:v1:waris:saved` | An explicit choice, with a visible "Hapus jawaban dari perangkat ini" |
| URL **fragment** | Only when the learner taps "Buat tautan laporan" | `/belajar/id/waris/laporan#j=v1.<base64url>` | Lets them reopen or show the report. Amounts are excluded unless ticked. |

**Why the fragment, not a query string:**
- MDN: "The fragment is not sent to the server when the URI is requested" (https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment).
- The Referer header "may not contain URL fragments" (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer).
- A query string **would** reach our server. Every module page runs `AccountChip`, which fetches `/belajar/api/me` (`components/AccountChip.tsx:23`). Under the configured `Referrer-Policy: strict-origin-when-cross-origin`, same-origin requests carry "the origin, path, and query string" (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy).
- Caddy has no `log` directive today (verified in `deploy/Caddyfile`). That is not a guarantee to rely on.

**Reading storage and the fragment** goes through `useSyncExternalStore`: subscribe to `storage` and `hashchange`, with a server snapshot of `null`. This is the same pattern as `useProgress` and `usePace` ("no hydration mismatch, no setState in an effect").

**Sharing warning.** The link carries family data. When it is created, the page says in plain words: anyone who receives it, and the chat app it passes through, can read the answers. The link holds no names or free text, only counts, yes/no answers and optional amounts.

### 6.5 Why this matters under UU PDP, and how it is enforced

**Specific data.** The questionnaire touches data that UU 27/2022 Pasal 4(2) classes as *Data Pribadi yang bersifat spesifik*:
- "d. catatan kejahatan" (the killer impediment);
- "e. data anak" (minor heirs);
- "f. data keuangan pribadi" (the estate).

Text verified at https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-4. Religion of relatives is asked too.

**Not collecting it** is simpler and safer than protecting it. The design guarantees:
1. **No server code path.**
   - No route handler, server action or `<form action>` under `waris/`.
   - The progress hooks (`useProgress.markDone`) record only "lesson X done", never answers.
   - The future account sync (plan §7.3) must exclude `belajar:v1:waris:*` keys.
2. **Lint guard.** `eslint.config.mjs` gets a `no-restricted-globals` / `no-restricted-syntax` block for `src/lib/waris/**` and `src/components/waris/**` banning `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, `WebSocket`, `EventSource` and `import(` of server modules.
3. **CSP** already has `connect-src 'self'` and `form-action 'self'` (`next.config.ts`), so nothing can leave for another origin even by mistake.
4. **No analytics** exist in the module (verified: no analytics/umami/gtag in `belajar/src`). Keep it so on waris pages.
5. **The privacy page** (plan §7.7) gets one line: the waris calculator runs only in your browser, and answers stay on your device unless you save them or create a link.

### 6.6 Questionnaire tests (vitest)

- **Completeness** (the key property). For seeded random full families: answer the adaptive questionnaire from the full family (an oracle answers each asked node), then `solve(toInput(state))` must deep-equal `solve(fullFamily)`. So skipping questions never changes an answer. *(Review 2026-10-09.)*
  - It runs **for both rulesets**, including the comparison variants.
  - Every relative type is sampled **independently**, including blocked siblings of every line. Correlated samplers hid the E2/E3 skip bug.
  - The oracle family may contain **beyond-depth relatives**, and then a `kerabat_jauh` refusal must be asserted.
  - It is a CI gate before M2 starts.
- **Refusal routing.** Each A3 option and each engine refusal reason leads to its exit page, and per-column refusals show the other column's numbers.
- **"Tidak tahu".** For every node that allows it, both answers are solved. When an existence answer flips any share, the report must show both outcomes or route to konsultasikan, never a single "likely" number.
- **Privacy.** After answering k6: `sessionStorage`, `localStorage` and `location.hash` contain no k6 value, and the printed E-BUNUH page contains no answer summary. The text summary contains rupiah only when "Sertakan nilai rupiah" is ticked.
- **Minimality (soft).** A son present ⇒ no sibling, nephew, uncle or cousin node asked. The father present ⇒ no grandfather node.
- **Termination.** Every path reaches `periksa` or `rujuk` in ≤ N steps, and no node is asked twice.
- **Codec.** Round-trip; a v1 link decodes after a v2 schema change (migration); malformed or oversized fragments are rejected without throwing.
- **Back/edit.** Answers that become irrelevant are ignored by `toInput` and dropped by the codec.

---

## 7. Report (`/waris/laporan`): rendering and print

### 7.1 Data flow

```
answers (fragment / storage) ─► toInput() ─► solve(input, ruleset)  ─┐
                                            solve(input, klasik)  ─┤ (only when switchesUsed ≠ ∅)
server page shell ─► props: RuleNote[] + DalilRef[] (reviewed content) ─┴─► <WarisReport/> (client)
```

- **The server page** imports `content/waris.json` through the server-only `content.ts` and passes the rule notes and dalil as props. The client component imports only the engine.
- **Every sentence in the report comes from a reviewed `RuleNote.says`**, with heir names and fractions filled in. The report never builds an Islamic claim from string pieces, and no LLM is involved at any stage.

### 7.2 Sections

1. **Header.** "Perkiraan Pembagian Waris" + `DraftChip` + the disclaimer box (the mandatory label, worded as the module's `Footer.disclaimer`: "Dibantu AI, bukan fatwa otoritatif", plus "bukan penetapan pengadilan") + ruleset name ("Mengikuti: Standar Indonesia — fikih waris + KHI", per STANDARD §5's naming).
2. **Ringkasan.**
   - **A table** is the primary carrier: heir, number of people, share of the estate as a fraction and in words ("seperdelapan"), per person, optional rupiah.
   - A 100% bar (SVG) sits beside it, segments labelled with text: name + fraction, never colour alone.
   - Fractions get `aria-label` words for screen readers.
3. **Sebelum dibagi** (only with amounts). The KHI 175 order — tajhiz → debts → wasiat ≤ ⅓ → waris — and the harta bersama step (KHI 96), each as a row with its amount.
4. **Cara menghitung.** Asal masalah; each fixed share with its "karena …" sentence; the asabah remainder; 'aul or radd shown with the same **petak** (tiles) visual the lessons use (§8).
5. **Yang tidak mendapat bagian.** Blocked heirs with the blocker and the rule. Never-asked groups with "tidak ditanyakan karena …" (§6.2).
6. **Dasar hukum.** Every `DalilRef` used by the trace, deduplicated, in trace order:
   - Arabic verbatim (Qur'an in `.quran`; hadith and kitab in `.arabic-inline`, at the senior-UX sizes);
   - the translation with its exact source label;
   - the citation linking to the source passage (AGENTS.md: "Link back to the source passage in the UI").
7. **Perbedaan pendapat** (only if `switchesUsed` is non-empty). "Menurut fikih klasik Syafi'i, bagian X adalah …", from the second solve, side by side, each difference with its STANDARD-sourced reason. This is honest about the "MUI standard" ambiguity without hiding the classical answer.
8. **Langkah berikutnya.**
   - A binding division needs a court determination (penetapan ahli waris, Pengadilan Agama) or the heirs' agreement (perdamaian, KHI 183). STANDARD supplies the wording.
   - Consult an ustadz.
   - "Ubah jawaban" (back to `hitung`), "Cetak / Simpan PDF", "Hapus jawaban dari perangkat ini".
9. **Rujuk result.** When `solve` returns `rujuk`, the report shows **no numbers**: only the reasons, each with its rule note, and where to ask.

### 7.3 Print stylesheet

Waris print rules go in a waris-scoped stylesheet (`src/app/[locale]/waris/waris.css`, imported by `waris/layout.tsx`) plus Tailwind v4's built-in `print:` variant. `globals.css` is in flight and stays untouched.

```css
@media print {
  @page { size: A4; margin: 15mm 14mm; }
  html { font-size: 12pt; }                         /* seniors print to read: ≥12pt body */
  .quran, .arabic-inline { font-size: 16pt; }        /* harakat survive 300–600 dpi; never below body */
  .report-section, .report-row, .dalil-card { break-inside: avoid; }
  .report-actions, [data-print="hide"] { display: none; }
  a[href^="http"].src::after { content: " (" attr(href) ")"; font-size: 9pt; word-break: break-all; }
  * { background: transparent !important; color: #000 !important; } /* browsers drop backgrounds anyway */
  .share-bar rect { fill: none; stroke: #000; }      /* bar segments become outlined + labelled */
}
```

- **Header controls** (text-size switch, account chip, nav) get `print:hidden` in `layout.tsx` once the redesign has merged: a one-line change made after them, not concurrently. The footer disclaimer stays in print, and the report also carries its own disclaimer, so a printed page is never unlabelled.
- **The print date** is passed into the reducer from the click handler (`dispatch({ type: "cetak", at: Date.now() })`), not read during render, which keeps the `purity` lint rule happy.
- **"Cetak / Simpan PDF"** calls `window.print()`. There is no server-side PDF: no Chromium on the VM (plan §7.2, L3). The browser's "Save as PDF" covers it.
- **CI renders the report in print media** for a screenshot (§11.2), so a print regression is visible in every PR.

---

## 8. Visualisation and animation

### 8.1 The visual vocabulary (five components, shared by lessons, cases and the report)

| Component | Shows | Built from |
|---|---|---|
| `Urutan` | The four steps before division: tajhiz → utang → wasiat ≤ ⅓ → waris. A bar shrinks at each step. | Static order (KHI 175; the classical order per STANDARD §1.5) + optional amounts |
| `Pohon` | Family tree centred on the pewaris. Heirs appear generation by generation. Blocked heirs get a **dashed outline + lock icon + the word "terhalang"** and a line to the heir who blocks them. | `FamilyInput` + `Result.blocked` |
| `Petak` | The asal masalah as N tiles. Each heir's tiles are labelled with their name. **'Aul:** the tiles overflow the box, then the box grows (24 → 27) and every tile shrinks. **Radd:** leftover tiles return to the heirs in proportion. | `Result.base`, `finalBase`, `units` |
| `Batang` | 100% bar of final shares, every segment labelled with text | `Result.shares` |
| `DalilKartu` | Arabic + translation + citation. It fades in only: no per-letter effects or motion on ayah text (plan §4.7). | `DalilRef` |

**Every number in a visual comes from `solve()`**, so a lesson animation can never show a share the engine disagrees with.

**State is never shown by colour alone.** Each heir group carries a **name label and a shape/pattern**, in line with senior-ux §3.2's rule for case chips. Colours come from new waris tokens added beside the case colours after the redesign merges, checked for 3:1 non-text contrast, as senior-ux did for the case colours.

### 8.2 Approach: step-driven, CSS/SVG first, zero new dependencies

| Option | Bundle | Fit | Verdict |
|---|---|---|---|
| **CSS transitions/keyframes on inline SVG/HTML** (transform, opacity, `stroke-dashoffset`, width) | 0 KB | Renders on the server (the first frame is real HTML/SVG), prints, and is already neutralised by the global `prefers-reduced-motion` block in `globals.css` (verified) | **Primary** |
| **Web Animations API** (`el.animate()`) | 0 KB | For sequences (tiles moving one after another), using the `finished` promise. Called in event handlers or effects with refs, never in render. | **For the few sequenced moments** |
| Motion (motion.dev) | Full `motion` component "34kb"; `m` + `LazyMotion` "just under 4.6kb" + `domAnimation` "+15kb"; `useAnimate` mini "2.3kb" (https://motion.dev/docs/react-reduce-bundle-size) | Pleasant layout animation, but adds a dependency and a second motion system to keep reduced-motion-correct | **Not needed.** Revisit only `useAnimate` mini if WAAPI sequencing gets unwieldy. |
| Lottie | A runtime library + designer-made JSON | Text and numbers baked into an opaque file can't be reviewed or validated against the engine, and can't follow the text-size switch | **Reject** |
| SVG SMIL (`<animate>`) | 0 KB | **Not** covered by the CSS reduced-motion override | **Reject** |
| Canvas / WebGL | — | Inaccessible to screen readers; doesn't follow the text-size switch | **Reject** |
| View Transitions API | 0 KB | Optional progressive enhancement for the questionnaire's screen change only, behind feature detection | Optional, later |

**Step-driven, not time-driven.**
- A visual is a pure function of `(result, step)`; CSS transitions animate between consecutive steps.
- The learner moves the step with "Lanjut" / "Sebelumnya" (56px / 48px).
- Auto-advance, if any, reuses the module's existing pace setting:
  - `usePace()`: Biasa / Pelan / Tunggu saya;
  - `captionMs()` in `lib/lessonSteps.ts`, no upper cap (senior-ux §3.5);
  - "Tunggu saya" never advances on its own (WCAG 2.2.1).
- Nothing moves for more than 5 s without a pause control (WCAG 2.2.2, https://www.w3.org/TR/WCAG22/#pause-stop-hide). There are no countdown bars, sound effects or music.

**Two reduced-motion gotchas:**
1. The global CSS override (`animation-duration: 0.01ms !important`) does **not** reach WAAPI animations started from JS. Every `el.animate()` call goes through one helper that reads `matchMedia("(prefers-reduced-motion: reduce)")` and passes `duration: 0`.
2. For the same reason, SMIL is rejected (table above).

### 8.3 Lesson stage

The Qur'an track's `LessonStage` is built around recitation steps (`recite_ayah`, `recite_word`). Waris gets its own small `WarisStage`:
- a caption from `scene.text`;
- the scene's visual at `step`;
- Sebelumnya / Lanjut;
- the same pace setting.

Steps come from a pure `buildWarisSteps(lesson, results)`, mirroring `buildLessonSteps`, and captions over 180 characters are split at sentence boundaries (senior-ux §3.5). Narration audio is out of scope: captions only, the same as the Qur'an track today. Any later narration follows L5 and needs the budget go-ahead (B7).

### 8.4 React Compiler lint constraints (verified)

**What runs.**
- `eslint-config-next` 16.2.6 spreads `eslint-plugin-react-hooks`' **recommended** rules (`web/node_modules/eslint-config-next/dist/index.js:168`).
- In react-hooks 7.1.1, `belajar/package-lock.json` pins the same version. Its recommended preset includes the compiler-derived rules `set-state-in-effect`, `set-state-in-render`, `refs`, `purity`, `immutability`, `static-components`, `globals`, `use-memo`, `preserve-manual-memoization`, `error-boundaries`, `incompatible-library` and `unsupported-syntax` (read from the plugin's rule table).
- The compiler itself is **not** enabled (`next.config.ts` has no `reactCompiler`). Only these lint rules bind.

| Rule | Waris consequence |
|---|---|
| `purity` | No `Date.now()` / `Math.random()` in render: the engine is pure, the shuffle is seeded (`lib/shuffle.ts`), and the print date comes from an event (§7.3) |
| `refs` | Never read `ref.current` in render. WAAPI runs in handlers/effects only. |
| `set-state-in-effect` | Storage and fragment are read through `useSyncExternalStore`, not "read in effect then setState" (the existing hooks already do this). Visual step is state set by handlers. |
| `static-components` | Visual components are module-level, never defined inside another component |
| `immutability` | The engine returns new objects; `QState` is updated only by the reducer |
| `incompatible-library` | One more reason not to add animation libraries without checking them against this rule |

### 8.5 Bundle impact

- **Server-rendered pages** (lessons, cases): only the stage island and the visuals ship as client JS. Content text is server HTML.
- **`/waris/hitung` and `/waris/laporan`:** the engine, the questionnaire and the visuals. No new npm dependencies.
- Add a CI size check (§11.4) so a later dependency can't slip in unnoticed.

---

## 9. Internationalisation

- **Strings.** Waris UI strings live in **separate files**, `belajar/messages/waris/{id,en}.json`, with namespaces `Waris`, `WarisPelajaran`, `WarisKasus`, `WarisHitung`, `WarisLaporan`, `WarisAhli`.
  - `src/i18n/request.ts` (not in the in-flight change set) merges them:
    ```ts
    messages: {
      ...(await import(`../../messages/${locale}.json`)).default,
      ...(await import(`../../messages/waris/${locale}.json`)).default,
    },
    ```
  - This keeps waris out of `messages/{id,en}.json`, which the redesign is editing now.
- **Content stays Indonesian** (plan B12). Lessons, rule notes, case stories, glossary and dalil translations are Indonesian only. The `/en/waris/...` pages show English chrome and a one-line notice, as the Qur'an track does today.
- **Questionnaire and report are proposed Indonesian-only in v1** (Q5).
  - Their prompts carry legal meaning, for example "divonis membunuh" (KHI 173: final conviction) and "saudara seibu". An English version would need its own review.
  - Until then `/en/waris/hitung` renders the Indonesian questionnaire under English chrome with a notice. Generating a separate English tree is not worth it yet.
- **Key parity.** A vitest test checks that `waris/id.json` and `waris/en.json` have the same keys, so a missing English key fails CI instead of throwing at render.
- **Register.** "Anda", plain Indonesian; fiqh terms are explained in place (senior-ux §3.9), e.g. "asabah (penerima sisa)", "'aul (bagian dikurangi bersama karena jumlahnya melebihi harta)". The reviewer confirms each gloss.

## 10. Hub listing (L9) and main-site links (L10)

- **Track registry.** The route move turns `/belajar/{locale}` into a hub that shows "only real" tracks. If the move introduces a registry, waris adds one entry; if not, the waris PR adds `src/lib/tracks.ts`:
  ```ts
  { id: "waris", href: "/waris", titleKey: "Hub.waris_title", bodyKey: "Hub.waris_body",
    status: warisHasDrafts() ? "draft" : "reviewed", visibleFrom: "M2" }
  ```
- **Card content.**
  - Title "Ilmu Waris (Faraidh)";
  - one line: "Pembagian warisan menurut Islam: bergambar, singkat, dengan dalil";
  - the three doors as 48px links: Pelajari · Contoh kasus · Hitung waris keluarga saya;
  - the draft chip "menunggu tinjauan ustadz".
- **When the card appears.** Only once M2 is built, i.e. at least the questionnaire and report exist. An empty "segera hadir" card contradicts "only real tracks". Before that, the routes are unlinked and noindex.
- **Main site.**
  - No change from this track. L10 gates the "Belajar" header link on the **Qur'an** track's first sign-off.
  - Promoting waris anywhere on dakwah-lens.id (header, briefings, kitab pages) is a separate operator decision after the waris reviewer signs off (Q9).
- **Sitemap.** None while `BELAJAR_PUBLIC=false`.

---

## 11. CI: smoke paths, screenshots, end-to-end, budget

### 11.1 Image smoke test (`.github/workflows/deploy-belajar.yml`, "Smoke-test the image")

```bash
L1="$(python3 -c 'import json;print(json.load(open("belajar/content/waris.json"))["lessons"][0]["slug"])')"
C1="$(python3 -c 'import json;print(json.load(open("belajar/content/waris.json"))["cases"][0]["slug"])')"
for path in /belajar/id/waris /belajar/en/waris /belajar/id/waris/hitung /belajar/id/waris/laporan \
            "/belajar/id/waris/pelajaran/$L1" /belajar/id/waris/kasus "/belajar/id/waris/kasus/$C1"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3300${path}")"; echo "${path} -> ${code}"; [[ "$code" == 200 ]]
done
for path in /belajar/id/waris/pelajaran/tidak-ada /belajar/id/waris/kasus/tidak-ada; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3300${path}")"; [[ "$code" == 404 ]]
done
page="$(curl -fsS http://127.0.0.1:3300/belajar/id/waris/hitung)"
grep -q "menunggu tinjauan ustadz" <<<"$page"          # draft label
grep -qi "bukan fatwa" <<<"$page"                       # mandatory label
! grep -qiE '<form[^>]*action=' <<<"$page"              # no server form on the questionnaire
grep -q "noindex" <<<"$page"                            # still a closed beta
```

Slugs are read from the content file so the test doesn't rot when lessons are renamed. `python3` is preinstalled on `ubuntu-latest`. Paths follow the post-move layout; the move's PR updates the existing Qur'an paths at the same time.

### 11.2 Screenshots (`belajar/scripts/ci/screenshots.mjs`, phone + desktop)

Add:
- `waris-home`, `waris-pelajaran-1`, `waris-kasus-1`;
- `waris-hitung` (first question);
- `waris-laporan` (screen) and `waris-laporan-print` (`page.emulateMedia({ media: "print" })`, A4 width), both loaded with a **fixture fragment**;
- `waris-petak-aul` (a lesson scene advanced to its 'aul step by clicking "Lanjut").

The fixture fragment comes from `belajar/scripts/ci/waris-fixture.txt`, which holds an 'aul family. A vitest test asserts the fixture still decodes with the current codec, so it cannot rot silently.

### 11.3 End-to-end check (`belajar/scripts/ci/waris-e2e.mjs`, Playwright, already installed in the image job)

For 3 vectors (a simple family, an 'aul family, a radd family):
1. Open `/belajar/id/waris/hitung`.
2. Answer each asked node (`data-q="<QId>"` on the question, `data-a` on the options) from the vector.
3. Reach `laporan` and compare each row's `data-share="a/b"` with `expected`.

It also records every request (`page.on("request")`) and **fails on any POST, or on any request other than static assets and `/belajar/api/me`**. That is the runtime proof of §6.5.

### 11.4 Size budget (nice to have)

After `npm run build` in the verify job, sum the gzip size of `.next/static/chunks/**` and compare it with a committed baseline plus a tolerance. This is crude but dependency-free, and it catches an animation library or a JSON import slipping into a client bundle.

### 11.5 Workflow triggers

- `paths:` already covers `belajar/**`.
- Add `docs/waris-research/test-vectors.json` for as long as the parity script exists (§5.6).
- `npm test` already runs the engine, questionnaire and vector tests. `npx eslint .` enforces the no-network guard (§6.5).

---

## 12. Milestones

Sizes are estimates, not measurements: S ≈ ≤1 day, M ≈ 2–3 days, L ≈ 4–8 days of agent work including review loops. Reviewer hours are separate, and they are the critical path, as for Al-Fatihah (plan §8).

| Milestone | Contents | Size | Reviewer | Blocked by |
|---|---|---|---|---|
| **M1. Content + engine + tests** | `src/lib/waris/` (registry, frac, estate, eligibility, substitution, hajb, furudh, asabah, special, adjust, distribute, solve); ruleset profiles per STANDARD §5; `vectors.test.ts`, `invariants.test.ts`, `frac.test.ts`; `src/content/waris-schema.ts`; server-only `content.ts` with the §3.4 checks; `build_waris.py`, `validate_waris.py`, `fetch.py --sura 4`, fatwa/KHI PDFs pinned in `sources.json`; the dalil set extracted (draft); a `RuleNote` drafted for **every** rule id; `belajar/content/waris/test-vectors.json` + parity script | **L** | Rules, rule notes and vectors: ~6–10 h | STANDARD §5 (ruleset defaults) and `test-vectors.json` from the sibling researchers. Canonical Muslim numbers need a read-only prod lookup: **operator go**, or use the fallback in §4.3. |
| **M2. Questionnaire + report** | `questionnaire/` (graph, machine, codec) + tests (§6.6); persistence hooks; `/waris/hitung`, `/waris/laporan`; report sections (§7.2); print stylesheet; `Batang` and `Petak` visuals (needed by the report); eslint no-network guard; `messages/waris/*`; hub card; smoke paths, screenshots, e2e (§11) | **L** | Question wording and report sentences: ~4–6 h | M1; the route move and senior-UX redesign **merged** (shared utilities, hub, layout) |
| **M3. Lessons + animations** | `Urutan`, `Pohon`, `DalilKartu` (+ the M2 visuals); `WarisStage`; `buildWarisSteps` + tests; 6–8 lessons (outline from the content/pedagogy researcher), each with ≥1 anchor dalil and a 3–5 item check; lesson ↔ rule back-links | **L** | Lessons: ~8–12 h | M1 (visuals use the engine), M2 (shared visuals) |
| **M4. Case studies** | 6–10 cases (list + page). Each is an engine input, a reviewer oracle and a vector at once. Ibn Mas'ud's daughter / son's daughter / sister case (Bukhari 6736) is a natural first one. | **M** | ~3–5 h | Content: after M1. Pages: after M2. |
| *Gate* | Fara'id reviewer sign-off per content hash. Only then can the hub card's draft chip go; promotion beyond the hub is a separate decision (Q9). | — | — | Q1 (a named reviewer) |

**Order.** M1 → M2 → (M3 ‖ M4). M4's content can be written during M2, because cases are just engine inputs.

---

## 13. Conflicts with in-flight work, and how to sequence

| In-flight work | Files it is touching (git status, 2026-10-09) | Overlap with waris | Handling |
|---|---|---|---|
| **Route move** to `/quran` + hub | `app/[locale]/page.tsx` (hub), `layout.tsx` (brand, breadcrumbs), the `[surah]` tree, a new link helper, `deploy-belajar.yml` smoke paths, `screenshots.mjs` | Hub card, link helper, layout `print:hidden`, smoke and screenshot lists | **Wait for it to merge.** Waris then appends to the helper, the hub registry, the smoke loop and the screenshot list in its own PR. |
| **Senior-UX redesign** (4 implementers + review/fix) | `globals.css`, `layout.tsx`, nearly every component, `messages/{id,en}.json`, `lessonSteps.ts`, hooks, the new `LessonStage.tsx`, `TextSizeSwitch.tsx`, `SourceList.tsx` | Waris UI must use the redesigned utilities and tokens (`btn-primary`, `chip-link`, `disclosure-row`, `ink-soft`, `border-ui`, `DraftChip`, `SourceList`) | **Wait for it to merge** before any waris UI. Waris adds its own `waris.css`, its own message files and its own colour tokens. It never edits `globals.css` or `messages/*.json` concurrently. |
| **Nahwu-sharaf library writers** | `pipeline/authored/library.*.json`, `build_library.py`, `content/library.json`, `pipeline/README.md` | `pipeline/README.md`, possibly `sources.json` / `fetch.py` | Document waris in a **new** `belajar/pipeline/WARIS.md`, with a one-line pointer added to the README after the library work lands. Make the `fetch.py` / `sources.json` changes in their own small commit after the library writers finish. |
| `schema.ts` / `content.ts` | Modified in the working tree | — | Waris uses **new** files (`waris-schema.ts`, `lib/waris/content.ts`) and imports only `SourceRef` and `ReviewStatus`. Neither existing file changes. |

**What can start now with zero overlap:** M1's engine and tests (`src/lib/waris/**`), `src/content/waris-schema.ts`, `belajar/content/waris/test-vectors.json`, `pipeline/build_waris.py`, `pipeline/validate_waris.py` and `pipeline/authored/waris.*.json`. All of these are new paths.

**Things to keep in view:**
- **A merge to `main` is a deploy.** `deploy-belajar.yml` deploys on any `belajar/**` change on `main`. M1 adds no routes, so a deploy would be harmless, but it is still a prod deploy and needs the operator's go (AGENTS.md: ALWAYS ASK PERMISSION, ASK BEFORE COMMIT).
- **Branching.** The current branch `feat/belajar-library` carries a large uncommitted change set. Waris should be its own branch off `main` once those changes merge, so its PRs stay reviewable.
- **No laptop builds** (L3). The engine is verified by vitest in CI, and the UI by the CI image smoke test, e2e and screenshots.

---

## 14. Open questions for the operator / reviewer

| # | Question | Why it matters | Suggested default |
|---|---|---|---|
| Q1 | **Who reviews fara'id?** Plan B6 names nahwu-sharaf, tajwid and hadith reviewers, but no fiqh mawaris reviewer. | Every waris record stays draft without one. This is the critical path. | Name one before M1 content is written; agree the honorarium (plan B7). |
| Q2 | Default ruleset, and which switches the learner sees. | "MUI standard" is classical fara'id + KHI + MA practice (STANDARD). Several outcomes differ: 185, 177/SEMA, radd to spouse, daughters vs siblings, harta bersama. | STANDARD §5's default. Always show the classical comparison when they differ (§7.2 item 7). Don't let learners toggle switches in v1. |
| Q3 | Heir scope: the classical 25, KHI 174 + substitution, dzawil arham, Baitul Mal (KHI 191). | Engine size and the `rujuk` surface | Implement what STANDARD §5 specifies; send everything else to `rujuk`. |
| Q4 | Ask about harta bersama whenever the pewaris was married? | STANDARD §2.7 calls it the "biggest single number change" | Yes, as the first estate question, explained simply. |
| Q5 | English questionnaire and report in v1? | Legal-meaning prompts need their own review | No: Indonesian content under English chrome, with a notice. |
| Q6 | Offer the share-link feature at all? | Convenience vs family data in a chat app | Yes, opt-in, amounts excluded by default, with a plain warning. |
| Q7 | Read-only prod lookup to get canonical Muslim numbers. | The local file numbers differ from canonical (e.g. Bulugh 1095's footnote cites Muslim 1615; the local record is 4141). | Ask for a go. Meanwhile cite Bukhari and mark Muslim without a number (§4.3). |
| Q8 | How to present the killer impediment, given Bulugh 1107's own grading note (mawquf per Ibn Hajar; authenticated in al-Irwa' per the editor) | Plan §4.5: "Every hadith shown is graded"; no overclaiming | Rest the rule on KHI 173 + Fath al-Qarib's text, and show the hadith with its stated grading or not at all (the reviewer decides). |
| Q9 | Is the waris track linked from the main site after sign-off? | L10 covers only the Qur'an track | Separate decision after the waris sign-off |
| Q10 | **PMA 44/2016** for the Qur'anic excerpts (4:11, 4:12, 4:176) shown in waris lessons and reports | Plan §8: a digital mushaf "includes parts of a surah". The LPMQ letter (B2) should name this track too. | Stay inside the existing closed, noindex beta until LPMQ answers. Add waris to the letter. |
| Q11 | Rupiah rounding rule and its wording (§5.4) | Heirs may compare rupiah figures | Largest remainder in a fixed order, stated on the report; the fraction is authoritative. |
| Q12 | Track name: "Ilmu Waris" / "Faraidh" / "Waris Islam" | Hub card and SEO later | "Ilmu Waris (Faraidh)" |

---

## 15. Sources

**In the repo** (read 2026-10-09):
- `docs/belajar-plan.md` §2 (L1–L10), §3 (B2, B6, B7, B12), §4.5, §4.7, §5.2, §7.2–§7.7, §8;
- `docs/belajar-research/senior-ux.md` §3.1–§3.9;
- `docs/belajar-research/architecture.md`;
- `docs/waris-research/standard.md` §1–§2 (sibling report, in progress);
- `belajar/src/content/schema.ts`; `src/lib/{content,library,flags,sources,lessonSteps,shuffle}.ts`;
- `src/hooks/{useProgress,usePace}.ts`; `src/components/AccountChip.tsx:23`; `src/components/lesson/{DraftChip,LessonStage}.tsx`;
- `src/app/[locale]/{layout,page}.tsx`; `src/app/[locale]/[surah]/[ayah]/page.tsx:24-35`; `src/app/globals.css`;
- `src/i18n/{routing,request,navigation}.ts`; `src/proxy.ts`;
- `belajar/{next.config.ts,vitest.config.ts,eslint.config.mjs,package.json,package-lock.json,Dockerfile}`;
- `belajar/pipeline/{README.md,common.py,fetch.py:138-151,sources.json}`; `belajar/scripts/ci/screenshots.mjs`;
- `.github/workflows/deploy-belajar.yml`; `deploy/Caddyfile`;
- `api/src/api/services/kitab_retrieval.py:289-302, 1009`;
- `web/node_modules/eslint-config-next/dist/index.js:168` and `web/node_modules/eslint-plugin-react-hooks` 7.1.1 (rule presets).

**Local corpus** (python inspection, 2026-10-09):
- `api/data/bukhari.json` (6732, 6735, 6736, 6737, 6742, 6744, 6746, 6764, 2742–2744; no `id` field);
- `muslim.json` (4140, 4141, 4209…; `id` on 7,360/7,563 records);
- `bulugh-al-maram.json` (1095 with footnote «رواه البخاري ( 6732 )، ومسلم ( 1615 )», 1096, 1097, 1107 with «وأعله النسائي، والصواب: وقفه على عمر», 1112);
- `fath-al-qarib.json` sections 116–117 (C138–C139; section 116 contains «(والقاتل) لا يرث ممن قتله»);
- `fath-al-muin.json` 34; `fiqh-as-sunnah.json` 839–863; `al-umm.json` 549–559;
- Tanzil cache `quran-uthmani.txt` (4:7, 4:11, 4:12, 4:33, 4:141, 4:176, 2:180 present);
- `grades` is `[]` on every hadith record checked.

**Web:**
- MDN, URI fragment: "The fragment is not sent to the server when the URI is requested" — https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment
- MDN, Referer: "may not contain URL fragments" — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer
- MDN, Referrer-Policy `strict-origin-when-cross-origin`: "Send the origin, path, and query string when performing a same-origin request" — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy
- UU 27/2022 Pasal 4(2) (specific personal data: catatan kejahatan, data anak, data keuangan pribadi) — https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-4
- Motion bundle sizes ("34kb", "just under 4.6kb", "+15kb", "+25kb", useAnimate mini "2.3kb", hybrid "17kb") — https://motion.dev/docs/react-reduce-bundle-size
- WCAG 2.2, 2.2.1 Timing Adjustable and 2.2.2 Pause, Stop, Hide — https://www.w3.org/TR/WCAG22/
- Fatwa MUI No. 5/MUNAS VII/MUI/9/2005, Kewarisan Beda Agama. Operative points 1–2 and "Memperhatikan … Instruksi Presiden no 1 tahun 1990 tentang Kompilasi Hukum Islam" read in the PDF at https://mui-jateng.or.id/wp-content/uploads/2018/03/39.-Kewarisan-Beda-Agama.pdf (Himpunan Fatwa MUI hlm. 478–480). STANDARD cites the fatwamui.com copy.
- KHI (Inpres 1/1991) official listings: https://peraturan.bpk.go.id/Details/293351/inpres-no-1-tahun-1991-penyebarluasan-kompilasi-hukum-islam and https://bphn.go.id/data/documents/91ip001.pdf. Found, not read by me; STANDARD §2 reports the BPHN PDF returned 403 and used an archive.org copy. KHI article content here is taken from STANDARD §2.

**Could not verify:**
- sunnah.com returned HTTP 403, so canonical Muslim numbers are **not** asserted here. The one data point (Muslim 1615 for "ألحقوا الفرائض") is the Bulugh corpus footnote, quoted as such.
- Fath al-Qarib's Indonesian rendering in prod Qdrant is from project memory and was not checked.
- The engine and bundle sizes in §5.5 and §12 are estimates.
