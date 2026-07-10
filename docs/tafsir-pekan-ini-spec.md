# Tafsir Pekan Ini — Per-Module Spec Sheets (v0.1, design-only)

- **Status:** Build spec, no code written. Mirrors the Fiqh Pekan Ini track.
- **Date:** 2026-07-10 · Owner: Sukses & Berkah / Taufik Adi
- **Baseline (locked):** Path A (Qur'an + Ibn Kathir, EN→ID at compose, expand corpus for v2) · Claude picks 4 themes + 1 anchor ayat each · news-anchored · tadabbur-reflective · single anchor verse/article · 4 guardrails · NO flyers · overlap-with-Fiqh OK.

## Design invariants (read first)
1. **Distinct deliverable slugs `tafsir-1..4`** with H3 heading `### Tafsir N — "<judul>"` and matcher `/^tafsir\s*N\b/`. Do NOT reuse Fiqh's `artikel-N` — it would collide in `DELIVERABLE_HEADING_PATTERNS` / `classifyHeading` / the KIND_* maps.
2. **Single-source (Ibn Kathir), disclosed.** The tafsir *meaning* is always retrieved from Ibn Kathir; Claude only translates EN→ID and reflects. Never free-generate exegesis. Anchor ayat AR + ID come from the `quran` collection (retrieved, not generated).
3. **17th reserved track** — `theme_group="Tafsir Pekan Ini"`, NOT in BRIEFING_GROUPS, own slug. Manual-weekly, zero-Gemini, no-cron.
4. **Own palette** (e.g. indigo/`sky`) to distinguish from Fiqh emerald.

---

## M1 · Tafsir retrieval  `api/src/api/services/kitab_retrieval.py`

**Problem:** `retrieve_by_citation("Tafsir Ibn Kathir on 2:275")` returns only a top-1 chunk; a verse's tafsir spans multiple `chunk_index` chunks. Need to gather them all.

**New function:**
```python
def retrieve_tafsir_for_ayah(surah: int, ayah: int) -> dict | None:
    """Gather the full Ibn Kathir tafsir for one ayah from Qdrant.
    Scrolls `tafsir_ibn_kathir` filtered by surah==surah AND ayah==ayah,
    orders hits by `chunk_index`, concatenates `chunk_text_en` into one
    `tafsir_en`. Returns None if the ayah has no tafsir chunk."""
```
Return shape:
```python
{
  "surah": int, "ayah": int,
  "citation": "Tafsir Ibn Kathir on {surah}:{ayah}",   # canonical, used in Dalil & Sumber
  "ayah_ar": str,        # from tafsir payload ayah_text_ar OR quran collection
  "tafsir_en": str,      # concatenated chunk_text_en, chunk_index order
  "n_chunks": int,
  "source": "Tafsir Ibn Kathir",
}
```
**Companion (verse text):** reuse existing `retrieve_by_citation("QS. <Surah>: <ayah>")` → gives `arabic` + `translation_id` (Kemenag) for the anchor ayat. The composer prints THOSE, never a reconstructed ayat.

**Acceptance tests (M1)**
- `retrieve_tafsir_for_ayah(2, 275)` returns non-None with `n_chunks == total_chunks` for that ayah and `tafsir_en` non-empty, chunks in ascending `chunk_index`.
- An ayah with no Ibn Kathir coverage → returns `None` (caller must surface as a miss, never fabricate).
- `retrieve_by_citation("QS. Al-Baqarah: 275")` returns `arabic` len>0 and `translation_id` len>0.
- Concatenation preserves order and inserts a separator; no chunk dropped or duplicated (assert set of chunk_index == 0..total_chunks-1).

---

## M2 · Tafsir EN→ID translate-cache  `api/src/api/services/tafsir_translation.py` (new) + `models/admin.py`

Mirror `hadith_translations_id`. New table `tafsir_translations_id`:

| Column | Type | Key |
|---|---|---|
| surah | Integer | PK |
| ayah | Integer | PK |
| text_en | Text | — (concatenated Ibn Kathir EN, provenance) |
| text_id | Text | — (Claude's faithful ID rendering) |
| model | String(64) | default `"claude-manual"` |
| created_at | DateTime | — |

```python
async def lookup_cached_tafsir(session, hits: list[dict]) -> tuple[list[dict], list[dict]]:
    """For each tafsir hit, fill hit['tafsir_id'] from cache when a row
    exists AND row.text_en == hit['tafsir_en'] (guards against stale
    translation if the EN source changed). Else append to misses."""

async def cache_tafsir(session, surah, ayah, text_en, text_id, *, model="claude-manual") -> None:
    """Upsert (surah,ayah) → text_id via on_conflict_do_update, exactly
    like hadith_translation.cache_translation."""
```
CLI: `manual_briefing cache-tafsir <surah> <ayah> <text_id>` (reads text_en from cache pool) — parallels the hadith `cache-translation` subcommand.

**Acceptance tests (M2)**
- Alembic autogen produces the `tafsir_translations_id` table; migration applies cleanly on prod.
- `lookup_cached_tafsir` fills `tafsir_id` on exact-`text_en` match; returns as a miss when absent OR when cached `text_en` differs from the current retrieval (staleness guard).
- `cache_tafsir` twice on the same (surah,ayah) updates, does not duplicate.

---

## M3 · dump-tafsir  `api/src/api/scripts/manual_briefing.py`

Constants (mirror Fiqh): `TAFSIR_GROUP = "Tafsir Pekan Ini"`, `TAFSIR_CACHE_SLUG = "tafsir-pekan-ini"`.

```python
async def cmd_dump_tafsir(themes_path: str, output_path: str | None) -> None
```
**Input `themes.json`** (Claude picks; two-stage like Fiqh):
```json
{"themes": [
  {"title": "<theme from 7d news>", "surah": 2, "ayah": 275,
   "citation": "QS. Al-Baqarah: 275", "why": "<why this ayat illuminates the theme>"} × 4
]}
```
**Flow:**
1. `_load_tafsir_themes(path)` — validate exactly 4, keys {title, surah, ayah, citation, why}.
2. Per theme: `verse = retrieve_by_citation(citation)` (anchor ayat AR+ID) + `taf = retrieve_tafsir_for_ayah(surah, ayah)` (Ibn Kathir EN). If either None → record as a **hard miss** (surface loudly; that theme's ayat must be re-picked, never fabricated).
3. `lookup_cached_tafsir(session, tafsir_hits)` → fill `tafsir_id` where cached; collect misses.
4. `fetch_trending_headlines(session, limit=12, period_days=7)` — supporting berita.
5. Write cache `_cache_path(TAFSIR_CACHE_SLUG)` = `/data/attachments/manual-briefing-cache/tafsir-pekan-ini.json` with `{mode:"tafsir", themes, stats:_tafsir_stats(themes), verses, tafsir, headlines}`.
6. Emit prompt: `TAFSIR_SYSTEM_PROMPT` + `# TEMA & AYAT PEKAN INI (4)` + `# BERITA PENDUKUNG (7 hari)` + `# AYAT POOL` (per theme: AR + ID + citation) + `# TAFSIR POOL (Ibn Kathir)` (per theme: `tafsir_en`, and `tafsir_id` if cached) + `# TAFSIR TRANSLATION MISSES` (verses whose Ibn Kathir EN needs Claude ID rendering in chat).

`_tafsir_stats(themes)` → `{mode:"tafsir", tafsir_topics:[t.title …], themes_meta:[…], period_start, period_end}`. (`tafsir_topics` powers the hub-card subtitle — see M7.)

Argparse: register `dump-tafsir` (positional `themes_json`, `--output`) mirroring `dump-fiqh`.

**Acceptance tests (M3)**
- `dump-tafsir themes.json` with 4 valid themes writes the cache + a prompt containing exactly 4 AYAT POOL blocks (each with Arabic + ID) and 4 TAFSIR POOL blocks.
- A theme whose ayah has no Ibn Kathir coverage → dump exits non-zero (or lists it under a blocking "TAFSIR MISSES — re-pick ayat") — never silently proceeds.
- Cache JSON has `mode:"tafsir"` and `stats.tafsir_topics` length 4.

---

## M4 · Compose  `TAFSIR_SYSTEM_PROMPT` + subagent contract

**`TAFSIR_SYSTEM_PROMPT` (skeleton — Indonesian, mirrors FIQH_SYSTEM_PROMPT anatomy):**
```
Persona: penyusun "Tafsir Pekan Ini" — 4 renungan tadabbur atas ayat pilihan
yang menyinari peristiwa 7 hari terakhir. Reflektif, menyentuh hati, satu ibrah
per ayat. BUKAN ceramah menggurui.

STRUKTUR WAJIB (H2, urut):
  ## Ringkasan Eksekutif   (200–300 kata, naratif murni, tanpa angka/statistik)
  ## Poin Kunci            (5–7 butir)
  ## Artikel Tafsir Pekan Ini
  ## Dalil & Sumber

SUB-ARTIKEL: TEPAT 4, format `### Tafsir N — "<judul 4-7 kata>"` (judul dalam kutip).
Anatomi tiap artikel (~900–1.300 kata):
  1. Peristiwa   — konteks berita 7 hari (fakta dari BERITA PENDUKUNG saja; parafrase
                   disiplin; anchor pada pola/institusi, JANGAN sebut nama individu).
  2. Ayat        — cetak AYAT PILIHAN dalam aksara Arab (baris sendiri) + terjemah ID
                   verbatim dari AYAT POOL. Sertakan sitasi "QS. <Surah>: <ayah>".
  3. Tafsir      — sampaikan makna dari TAFSIR POOL (Ibn Katsir). Terjemahkan/rangkum
                   dari tafsir_en yang diberikan; JANGAN menambah makna di luar pool.
                   Sitasi: "Tafsir Ibn Kathir on <surah>:<ayah>".
  4. Tadabbur & Ibrah — renungan yang menautkan makna ayat ke peristiwa; SATU ibrah utama.
  5. Tanya-Jawab — `#### Tanya-Jawab`, 3–4 pasang **T:**/**J:** akar-rumput tentang
                   MAKNA/penerapan ayat; jawaban pool-only + tunjuk ahli tafsir untuk
                   keputusan pribadi.
  6. Penutup     — "renungan tadabbur, AI-assisted, bukan tafsir muktamad" + ajakan
                   rujuk ahli tafsir. (harus memuat frasa "bukan tafsir muktamad".)

ATURAN KERAS (guardrails — inviolable):
  - GROUNDING: setiap makna ayat DARI TAFSIR POOL (Ibn Katsir) — tak boleh tafsir bebas.
  - NO FIQH RULING: jangan menetapkan halal/haram/wajib dari ayat — tadabbur/ibrah saja;
    rujukkan hukum ke ulama / kanal Fiqh.
  - SALAF-SAFE AQIDAH: hindari takwil mutasyabihat & perselisihan aqidah sektarian;
    ambil makna yang disepakati mufassir.
  - NO WEAK/ISRAILIYYAT: hanya yang ditegaskan Ibn Katsir; jangan kisah israiliyyat da'if.
  - Ringkasan + Poin Kunci: naratif, TANPA statistik internal (jumlah post / persentase).
  - TANPA ALL-CAPS (pakai **bold**/*italic*). Fokus pola, bukan individu; tanpa framing
    sektarian.
  - Dalil & Sumber: satu baris per entri `- **<sitasi persis>** — <catatan singkat>`
    (≥ 8 entri: 4 ayat + 4 tafsir).
  - JANGAN tulis Pesan Flyer / Strategi & Aksi / khutbah / kultum / deliverable mingguan lain.
```
**Compose subagent contract:** reads `/tmp/prompt_tafsir.md`, composes the full briefing to `/tmp/briefing_tafsir.md`; for any TAFSIR MISS, renders Ibn Kathir EN→ID faithfully inline (to be cached post-save via M2). Reply: word count + confirm 4 articles each carry Arabic ayat + in-pool tafsir citation + Tanya-Jawab + disclaimer.

Operator rulebook: `api/docs/tafsir-compose-notes.md` (analogue of fiqh-compose-notes) — word targets, grounding discipline, the 4 guardrails, tadabbur voice, Tanya-Jawab spec, H3 format, disclaimer.

**Acceptance tests (M4)**
- Output has the 4 required H2s in order, exactly 4 `### Tafsir N — "…"` H3s, each with Arabic ayat on its own line + a `Tafsir Ibn Kathir on S:A` citation + `#### Tanya-Jawab` (≥3 **T:**) + a "bukan tafsir muktamad" close.
- No ruling verbs (halal/haram/wajib/boleh) asserted from a verse; no ALL-CAPS; Ringkasan/Poin-Kunci carry no numbers.

---

## M5 · Verify  subagent contract + `api/docs/tafsir-verify-notes.md`

Adversarial Claude pass (in-place surgical edits), gates:
- **Gate A (Tafsir integrity):** every exegetical claim traces to the retrieved `tafsir_en`; the ID rendering adds no meaning not in the source (no drift); anchor ayat Arabic is verbatim from the AYAT POOL; every `Tafsir Ibn Kathir on S:A` + `QS. …` citation is in-pool.
- **Gate B (Guardrails):** no fiqh ruling; salaf-safe on mutashabihat; no da'if/israiliyyat; per-article disclaimer present.
- **Gate C (Fact-check hook):** every event paraphrase maps to a verbatim real headline; no individuals named (hate-the-deed).
- **Gate D (Structure):** H2 order, exactly 4 `Tafsir N` H3s, no Pesan Flyer / Strategi, article length ~900–1,300 words.
- Verdict: "SIAP-SAVE" or blocker list.

**Acceptance tests (M5):** on a seeded briefing with (a) an added-meaning tafsir sentence, (b) a ruling verb, (c) an out-of-pool citation, (d) a named individual — the verifier flags/fixes all four and does not emit SIAP-SAVE until resolved.

---

## M6 · save-tafsir + validators  `manual_briefing.py`

```python
async def cmd_save_tafsir(markdown_path: str) -> None   # mirrors cmd_save_fiqh
def _validate_tafsir_briefing(md: str, tafsir_pool: list[dict], ayat_pool: list[dict]) -> None
```
`_validate_tafsir_briefing` **hard-fail list** (SystemExit on any):
1. Body ≥ 8,000 chars (4 × ~900–1,300 words).
2. Required H2s present **in order**: `## Ringkasan Eksekutif` → `## Poin Kunci` → `## Artikel Tafsir Pekan Ini` → `## Dalil & Sumber`.
3. Forbidden H2s absent: `## Pesan Flyer`, `## Strategi & Aksi Dakwah`.
4. Exactly 4 article H3s via `^###\s+Tafsir\s+([1-4])\s+—\s+"([^"]{8,90})"\s*$` → nums == [1,2,3,4].
5. **Each article prints Arabic** — an Arabic-script run (regex `[؀-ۿ]{8,}`) on its own line within each article body (the anchor ayat). Missing → fail.
6. **Each article cites a `Tafsir Ibn Kathir on <s>:<a>`** whose (s,a) is in `tafsir_pool`.
7. **Each article cites its `QS. …`** anchor verse present in `ayat_pool`.
8. Per-article `#### Tanya-Jawab` with ≥3 `**T:**`.
9. **No fiqh-ruling verbs** — scan each article for `\b(hukum(nya)?|halal|haram|wajib|makruh|mubah|sunnah muakkad)\b` used as a *ruling assertion*; soft-warn→hard-fail per operator tuning (start as **hard-fail on "haram/halal/wajib" in an assertive sentence**, given the no-ruling guardrail).
10. Disclaimer line containing **"bukan tafsir muktamad"** present.
11. `## Dalil & Sumber` entries (`-\s+\*\*(.+?)\*\*`) all resolve to pool citations (ayat_pool ∪ tafsir_pool), ≥ 8 entries.
Then generic `validate_briefing(md, daleel_pool=…, llm_judgments=False)`. Same-Jakarta-day upsert on `theme_group=TAFSIR_GROUP`; insert `model="claude-manual"`, cost 0.

Argparse: register `save-tafsir` (positional `markdown`).

**Acceptance tests (M6)**
- A correct briefing saves and upserts (re-save replaces same-day row, no dup).
- Each hard-fail (missing H2, 3 or 5 articles, missing Arabic in an article, out-of-pool tafsir citation, <3 Tanya-Jawab, missing disclaimer, an out-of-pool Dalil entry, a "haram"-ruling sentence) is individually caught with a precise message; no row written on fail.
- Layer-3 LLM fact-check auto-skips on prod (no anthropic key) — expected, non-blocking.

---

## M7 · Web wiring  `web/src`

Add (exact, from recon):
1. `lib/briefing-data.ts`
   - `DELIVERABLE_HEADING_PATTERNS`: add `tafsir-1..4` → `{ matcher:(h)=>/^tafsir\s*N\b/i.test(h), title:"Tafsir N" }`, keeping the literal-key `satisfies` shape.
   - `TAFSIR_GROUP = "Tafsir Pekan Ini"`, `TAFSIR_SLUG = "tafsir-pekan-ini"`, `getLatestTafsirBriefing()`.
   - `resolveGroup`: add `raw === TAFSIR_SLUG ? TAFSIR_GROUP : …` (the 404-gotcha fix).
2. `components/BriefDeliverableCards.tsx`
   - Extend `CardKind` union + `KIND_ORDER` with `tafsir-1..4`.
   - Add `tafsir-1..4` to every KIND_* map (`KIND_ICON` → e.g. `BookOpenText`/`Sparkles`; `KIND_TONE`/`KIND_ICON_TONE`/`KIND_HEADER_BG`/`KIND_BODY_BG`/`KIND_QUOTE` → a **new palette, e.g. sky/indigo**, distinct from Fiqh emerald).
   - `classifyHeading`: add `const m = lower.match(/^tafsir\s*([1-4])\b/); if (m) return \`tafsir-${m[1]}\``; extend `cardLabelFor` to pull the quote-title for tafsir kinds.
3. `app/[locale]/d/[brief]/[deliverable]/page.tsx`: add `tafsir-1..4` to the local `KIND_ICON` map (⚠️ **hydration-crash guard** — a missing key crashes React #130; the literal-keyed registry makes tsc catch it).
4. `components/BriefingsGrid.tsx`: render a **3rd Edisi Khusus card** (Tafsir) — new palette + icon + badge "Tafsir" + title "Tafsir Pekan Ini", subtitle from `headlineStats.tafsir_topics.join(" · ")`.
5. `app/[locale]/briefings/page.tsx`: add `getLatestTafsirBriefing()` to the `Promise.all` and pass `tafsir={tafsir}` to `BriefingsGrid`.
6. i18n: none required (labels are data-driven / hardcoded JSX).
7. No DB schema change for briefings (theme_group is varchar). (M2's `tafsir_translations_id` is the only new table.)

**Acceptance tests (M7)**
- `tsc` passes (the `satisfies` registry forces every KIND_* map + /d/ KIND_ICON to include tafsir-1..4 or fail compile — the deliberate guard).
- `/id/briefings/<date>-tafsir-pekan-ini`, `/id/d/<slug>/tafsir-1..4`, PDF route, and the hub 3rd card all **render in headless Chrome with zero console errors + no error-boundary** (the "200 ≠ renders" rule). Cards show the distinct palette; modal copy/download/print/visit work.

---

## Build order
M1 → M2 (retrieval + cache foundation) → M3 (dump) → M4/M5 (compose+verify prompts + rulebooks) → M6 (save+validators) → M7 (web, parallel). First edition = run the full manual pipeline for one week once M1–M7 land; headless-verify before publish.

## v2 follow-up (separate project)
Ingest + ID-translate + embed the deferred sources (As-Sa'di, asbabun-nuzul, Hamka/Qutb) into Qdrant — same playbook as the 7-classics bilingual corpus — then widen M1 retrieval to a multi-mufassir pool and relax the single-source disclosure. No track-structure change needed.
