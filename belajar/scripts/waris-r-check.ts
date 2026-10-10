/**
 * Local feedback for the waris REPORT view-model (plan §6, §10 M2.7–M2.9, M2.12), runnable
 * without npm install:
 *
 *   cd belajar && npx --yes tsx@4.19.2 scripts/waris-r-check.ts [--random N] [--seed S] [--verbose] [--show <vector-id>]
 *
 * Runs the same checks as the vitest wrapper (src/lib/waris/report/report.test.ts): every test
 * vector (every distinct input its expectations name), each with synthetic flags, not-asked groups
 * and «Tidak tahu» readings, plus seeded random families (2,000 here; CI uses fewer). Exits 1 on
 * any failure. Warnings (RuleNote wording that promises a reviewer) are listed for the content
 * owner and do not fail the run. `--show <id>` prints that vector's text summary.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPlantedFaults, runReportChecks } from "../src/lib/waris/checks/report";
import { PLAN_CASES } from "../src/lib/waris/checks/cases";
import { mapVectorInput, type VectorFile } from "../src/lib/waris/checks/vectors";
import { buildReport } from "../src/lib/waris/report/build";
import { buildTextSummary } from "../src/lib/waris/report/summary";
import type { ReportDalilRecord, ReportRules } from "../src/lib/waris/report/content";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const verbose = args.includes("--verbose");
const content = (f: string) => JSON.parse(readFileSync(resolve(here, "../content/waris", f), "utf8"));

const t0 = performance.now();
const vectors = content("test-vectors.json") as VectorFile;
const rules = content("rules.json") as ReportRules;
const dalil = [...(content("dalil.json") as ReportDalilRecord[]), ...(content("dalil-gaps.json") as ReportDalilRecord[])];
const randomCount = Number(opt("--random") ?? "2000");
const seed = Number(opt("--seed") ?? "20261009");

const show = opt("--show");
if (show) {
  const v = vectors.vectors.find((x) => x.id === show);
  if (!v) {
    console.error(`waris-r-check: no vector ${show}`);
    process.exit(1);
  }
  const m = buildReport(mapVectorInput(v.id, v.input), rules, dalil, { date: "2026-10-09" });
  console.log(buildTextSummary(m, { includeRupiah: true }) ?? "(no text summary: this report may not be shared)");
  if (verbose) console.log(JSON.stringify(m, null, 2));
  process.exit(0);
}

const s = runReportChecks({ vectors, rules, dalil, randomCount, seed });
const ms = performance.now() - t0;
console.log(`\n== Report view-model: ${vectors.vectors.length} vectors (+ flags, not-asked, «Tidak tahu») and ${randomCount} random families, seed ${seed}`);
console.log(
  `   ${s.reports} reports built: ${s.byKind.laporan} computed, ${s.byKind.rujuk} refused, ${s.byKind.bunuh} E-BUNUH class; ` +
    `${s.byKind.columnRefused} with one column refused; ${s.byKind.differs} with a differing court column (${(ms / 1000).toFixed(1)} s)`,
);
console.log(
  `   «Tidak tahu»: ${s.unknownCases.changing} changing (side by side), ${s.unknownCases.unchanged} unchanged, ${s.unknownCases.doubleRefused} double-unknown refusals`,
);
console.log(`   longest text summary: ${s.longestSummary.chars} characters (${s.longestSummary.where})`);
const hidden = Object.entries(s.hidden);
console.log(`   plan D10 records cited by RuleNotes but kept off the page: ${hidden.length === 0 ? "none" : hidden.map(([id, why]) => `${id} (${why})`).join("; ")}`);
const byCheck = new Map<string, number>();
for (const f of s.failures) byCheck.set(f.check, (byCheck.get(f.check) ?? 0) + 1);
console.log(`   failures: ${s.failures.length}${byCheck.size ? ` (${[...byCheck].map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}`);
for (const f of s.failures.slice(0, verbose ? 200 : 25)) console.log(`   FAIL ${f.where} [${f.check}] ${f.message}`);
const planted = runPlantedFaults(rules, dalil, PLAN_CASES);
const missed = planted.filter((p) => !p.caught);
console.log(`   planted faults: ${planted.length - missed.length}/${planted.length} caught by the named check`);
for (const p of planted) if (verbose || !p.caught) console.log(`   ${p.caught ? "ok  " : "MISS"} ${p.name} → expected ${p.expect}; got [${p.checks.join(", ")}]`);
console.log(`   warnings: ${s.warnings.length}`);
for (const w of s.warnings) console.log(`   WARN ${w}`);
const ok = s.failures.length === 0 && missed.length === 0;
console.log(`\nwaris-r-check: ${ok ? "OK" : "FAILED"} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(ok ? 0 : 1);
