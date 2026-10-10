/**
 * Local feedback for the waris questionnaire model (plan §10 M2.1–M2.4), runnable without npm install:
 *
 *   cd belajar && npx --yes tsx@4.19.2 scripts/waris-q-check.ts [--count N] [--unknown-count N]
 *        [--termination-runs N] [--codec-count N] [--seed S] [--verbose]
 *
 * Runs the SAME checks as the vitest wrapper (src/lib/waris/questionnaire/questionnaire.test.ts):
 * text rules, key parsing, refusal routing, path lengths (printed as a table), termination with
 * random answers and random Kembali / Ubah, the codec, completeness on seeded oracle families
 * (12,000 by default here — ≥ 10,000 reports compared under every ruleset, the rest refusals that
 * must match; CI uses a smaller documented count) and one «Tidak tahu» per family (10,000).
 * Exits 1 on any failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Q_DEFAULT_SEED,
  keysRoundTrip,
  runCodecChecks,
  runCompleteness,
  runPathLengths,
  runRefusalRouting,
  runTermination,
  runTextChecks,
  runUnknowns,
} from "../src/lib/waris/checks/questionnaire";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string, dflt: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const verbose = args.includes("--verbose");
const seed = parseInt(opt("--seed", String(Q_DEFAULT_SEED)), 10);
// 12,000 families give ≥ 10,000 REPORTS compared under every ruleset (the rest end at exits,
// which are compared too): plan M2.1 "at least 10,000 seeded families per ruleset"
const count = parseInt(opt("--count", "12000"), 10);
const unknownCount = parseInt(opt("--unknown-count", "10000"), 10);
const terminationRuns = parseInt(opt("--termination-runs", "2000"), 10);
const codecCount = parseInt(opt("--codec-count", "2000"), 10);

let exitCode = 0;
const t0 = performance.now();
const secs = (t: number) => `${((performance.now() - t) / 1000).toFixed(1)} s`;
const show = <T>(xs: readonly T[], f: (x: T) => string) => {
  for (const x of xs.slice(0, verbose ? 50 : 8)) console.log(`      ${f(x)}`);
};

{
  const rulesPath = resolve(here, "../content/waris/rules.json");
  let ids: Set<string> | undefined;
  if (existsSync(rulesPath)) {
    const rules = JSON.parse(readFileSync(rulesPath, "utf8")) as { rules: { rule_id: string }[] };
    ids = new Set(rules.rules.map((r) => r.rule_id));
  }
  const r = runTextChecks(ids);
  const keys = keysRoundTrip();
  console.log(`\n== Text and keys: ${r.checked} checks (RuleNotes: ${ids ? ids.size : "not found"}); ${r.failures.length + keys.length} failures`);
  show([...r.failures, ...keys.map((k) => `key ${k}`)], (x) => x);
  if (r.failures.length + keys.length > 0) exitCode = 1;
}
{
  const r = runRefusalRouting();
  console.log(`\n== M2.4 refusal routing: ${r.checked} checks; ${r.failures.length} failures`);
  show(r.failures, (x) => x);
  if (r.failures.length > 0) exitCode = 1;
}
{
  const r = runPathLengths();
  console.log(`\n== M2.3 path length (answered screens; review screen and E-HIDUP page not counted)`);
  for (const row of r.rows) {
    const target = row.max === null ? "reported" : `≤ ${row.max}`;
    console.log(`   ${row.id.padEnd(24)} ${String(row.screens).padStart(2)} screens (${target}) → ${row.end}   ${row.title}`);
    if (verbose) console.log(`      ${row.asked}`);
  }
  console.log(`   ${r.failures.length} failures`);
  show(r.failures, (x) => x);
  if (r.failures.length > 0) exitCode = 1;
}
{
  const t = performance.now();
  const r = runTermination({ runs: terminationRuns, seed });
  console.log(`\n== M2.2 termination: ${r.runs} random runs (random answers, random Kembali / Ubah), seed ${seed}; longest ${r.maxSteps} actions; ${r.failures.length} failures (${secs(t)})`);
  console.log(`   endings: ${Object.entries(r.endings).sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
  show(r.failures, (f) => `run ${f.run}: ${f.message}`);
  if (r.failures.length > 0) exitCode = 1;
}
{
  const t = performance.now();
  const r = runCodecChecks({ count: codecCount, seed });
  console.log(`\n== Codec: ${r.checked} checks over ${codecCount} families; longest link token ${r.maxLength} characters; ${r.failures.length} failures (${secs(t)})`);
  show(r.failures, (x) => x);
  if (r.failures.length > 0) exitCode = 1;
}
{
  const t = performance.now();
  const r = runCompleteness({ count, seed });
  console.log(`\n== M2.1 completeness: ${r.families} seeded oracle families, seed ${seed} (${secs(t)})`);
  for (const [rs, n] of Object.entries(r.comparedByRuleset)) console.log(`   ${rs.padEnd(52)} ${n} reports compared`);
  const exitsMatched = Object.values(r.exits).reduce((s, n) => s + n, 0);
  console.log(`   + ${exitsMatched} families whose refusal (exit page) matched the full family's, in both columns`);
  console.log(`   exits matched: ${Object.entries(r.exits).sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`   documented over-refusals (k3–k5, conservative couldAffectOutcome): ${Object.entries(r.overRefusals).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  console.log(`   screens: longest ${r.screens.max}, mean ${(r.screens.total / Math.max(1, r.families)).toFixed(1)}`);
  console.log(`   ${r.failures.length} failures`);
  show(r.failures, (f) => `#${f.index} ${f.kind}: ${f.message}`);
  if (verbose && r.failures[0]?.family) console.log(JSON.stringify(r.failures[0].family, (_k, v) => (typeof v === "bigint" ? v.toString() : typeof v === "function" ? "[fn]" : v), 1));
  if (r.failures.length > 0) exitCode = 1;
}
{
  const t = performance.now();
  const r = runUnknowns({ count: unknownCount, seed: seed + 1 });
  console.log(
    `\n== M2.1 «Tidak tahu»: ${r.runs} runs (one «Tidak tahu» each), seed ${seed + 1}: ${r.exact} exact, ${r.noEffect} no effect, ${r.sideBySide} side by side, ${r.konsultasikan} → E-TIDAK-TAHU, ${r.unrepresentable} true answer outside the readings; ${r.failures.length} failures (${secs(t)})`,
  );
  show(r.failures, (f) => `#${f.index} ${f.key}: ${f.message}`);
  if (r.failures.length > 0) exitCode = 1;
}
console.log(`\nwaris-q-check: ${exitCode === 0 ? "OK" : "FAILED"} (${secs(t0)} total)`);
process.exit(exitCode);
