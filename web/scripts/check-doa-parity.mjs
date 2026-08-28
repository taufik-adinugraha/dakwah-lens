#!/usr/bin/env node
/**
 * Assert the web copy of the du'a library matches the API's.
 *
 * NOTE the path: `web/src/data/`, not `web/src/lib/data/`. The root .gitignore
 * has a blanket `data/` rule; `web/src/data/` is explicitly negated, the other
 * is not — so the first attempt was skipped by `git add -A` with no warning
 * and only surfaced as a bundler "Module not found" in CI.
 *
 * `web/src/lib/data/dua-library.json` is a build-time copy of
 * `api/src/api/data/dua_library.json` so the du'a pages prerender static with
 * no runtime API dependency. Two copies of one dataset drifting is a bug this
 * repo has shipped twice (flyer_daleel_pool 2026-06-18; the 30-post volume
 * floor 2026-08-27) — both times because each side carried its own copy of a
 * rule and only one of them got updated.
 *
 * The web copy additionally carries `transliteration`, which the API copy does
 * not need, so parity is checked on the SHARED fields only.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const api = JSON.parse(
  readFileSync(join(here, "../../api/src/api/data/dua_library.json"), "utf8"),
);
const web = JSON.parse(
  readFileSync(join(here, "../src/data/dua-library.json"), "utf8"),
);

const problems = [];
if (api.length !== web.length)
  problems.push(`count: api=${api.length} web=${web.length}`);

// Compare BY POSITION, not by citation. 31 citations are shared by 2-5
// distinct du'a (different fragments of one hadith, e.g. "Sahih Muslim 125"
// x5), so a citation-keyed Map silently drops 41 of 323 entries — which is
// exactly how the first transliteration pass lost work.
for (let i = 0; i < api.length; i++) {
  const a = api[i];
  const w = web[i];
  if (!w) {
    problems.push(`missing in web at index ${i}: ${a.citation}`);
    continue;
  }
  if (a.citation !== w.citation)
    problems.push(`index ${i}: order differs (api=${a.citation} web=${w.citation})`);
  for (const f of ["arabic", "translation_id", "corpus"]) {
    if ((a[f] ?? "") !== (w[f] ?? ""))
      problems.push(`index ${i} (${a.citation}): ${f} differs`);
  }
  if ((a.tags ?? []).join(",") !== (w.tags ?? []).join(","))
    problems.push(`index ${i} (${a.citation}): tags differ`);
}

const noTl = web.filter((d) => !d.transliteration?.trim()).length;
if (noTl) problems.push(`${noTl} web entries missing transliteration`);

if (problems.length) {
  console.error(`doa parity: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 20)) console.error("  ✗", p);
  process.exit(1);
}
console.log(
  `doa parity OK — ${web.length} du'a, all shared fields match, all transliterated`,
);
