/**
 * Local feedback for the waris engine (plan §10 M1.1–M1.2), runnable without npm install:
 *
 *   cd belajar && npx --yes tsx@4.19.2 scripts/waris-check.ts [--vectors <path>] [--count N] [--seed S] [--verbose]
 *
 * Runs the SAME checks as the vitest wrappers (src/lib/waris/*.test.ts): every test vector for
 * every implemented ruleset, then the seeded random-family invariants (20,000 per ruleset by
 * default here; CI uses a smaller documented count). Exits 1 on any unexpected failure.
 * Vectors default to content/waris/test-vectors.json, falling back to the docs copy.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runVectorChecks, summarize } from "../src/lib/waris/checks/vectors";
import { classifyFailures } from "../src/lib/waris/checks/disputed";
import { INVARIANT_RULESETS, runInvariants, DEFAULT_SEED } from "../src/lib/waris/checks/invariants";
import { runRelevanceChecks } from "../src/lib/waris/checks/relevance";
import { runPlanCases } from "../src/lib/waris/checks/cases";
import { runUnitChecks } from "../src/lib/waris/checks/units";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const verbose = args.includes("--verbose");
const candidates = [
  opt("--vectors"),
  process.env.WARIS_VECTORS,
  resolve(here, "../content/waris/test-vectors.json"),
  resolve(here, "../../docs/waris-research/test-vectors.json"),
].filter((x): x is string => !!x);
const vectorsPath = candidates.find((p) => existsSync(p));
if (!vectorsPath) {
  console.error("waris-check: no test-vectors.json found; tried", candidates);
  process.exit(1);
}

let exitCode = 0;
const t0 = performance.now();
const file = JSON.parse(readFileSync(vectorsPath, "utf8"));
const results = runVectorChecks(file);
const s = summarize(results);
const cls = classifyFailures(s.failures, results);
console.log(`\n== Vectors: ${vectorsPath}`);
console.log(`   ${s.vectors} vectors, ${s.expectations} expectations (${(performance.now() - t0).toFixed(0)} ms)`);
for (const [k, v] of Object.entries(s.byRuleset).sort()) {
  console.log(`   ${k.padEnd(52)} pass ${String(v.pass).padStart(3)}  fail ${String(v.fail).padStart(2)}  skipped ${v.skipped}`);
}
for (const x of s.skipped) console.log(`   SKIPPED ${x.vector} [${x.key}]: ${x.skipReason}`);
for (const f of cls.disputed) {
  console.log(`   DISPUTED VECTOR ${f.result.vector} [${f.result.key}]`);
  for (const p of f.result.problems) console.log(`      ${p}`);
  console.log(`      evidence: ${f.entry.evidence}`);
}
for (const f of cls.unexpected) {
  console.log(`   FAIL ${f.vector} [${f.key}] (${f.sourceStatus ?? "?"})`);
  for (const p of f.problems) console.log(`      ${p}`);
}
for (const st of cls.stale) console.log(`   STALE disputed entry (now passes or field changed): ${st.vector} [${st.key}] ${st.field}`);
if (cls.unexpected.length > 0 || cls.stale.length > 0) exitCode = 1;
console.log(`   => ${s.expectations - s.failures.length - s.skipped.length} pass, ${cls.disputed.length} disputed-vector failures (listed above), ${cls.unexpected.length} unexpected failures, ${s.skipped.length} skipped by name`);

{
  const uf = runUnitChecks();
  console.log(`\n== Unit checks: ${uf.length} failures`);
  for (const f of uf) console.log(`   FAIL ${f}`);
  if (uf.length > 0) exitCode = 1;
}
{
  const pc = runPlanCases();
  console.log(`\n== Plan §4 case studies: ${pc.checked} (case, column) checks; ${pc.failures.length} failures`);
  for (const f of pc.failures) console.log(`   FAIL ${f.id} [${f.column}]: ${f.message}`);
  if (pc.failures.length > 0) exitCode = 1;
}

if (!args.includes("--no-invariants")) {
  const count = Number(opt("--count") ?? "20000");
  const seed = Number(opt("--seed") ?? String(DEFAULT_SEED));
  console.log(`\n== Invariants: ${count} seeded random families per ruleset, seed ${seed}`);
  for (const rs of INVARIANT_RULESETS) {
    const t1 = performance.now();
    const inv = runInvariants({ count, seed, ruleset: rs });
    const ms = performance.now() - t1;
    console.log(
      `   ${rs.padEnd(52)} ${inv.families} families: ${inv.hasil} computed, ${inv.rujuk} refused; ${inv.failures.length} failures (${(ms / 1000).toFixed(1)} s)`,
    );
    for (const f of inv.failures.slice(0, verbose ? 50 : 5)) console.log(`      #${f.index} ${f.invariant}: ${f.message}`);
    if (verbose || rs === INVARIANT_RULESETS[0] || rs === INVARIANT_RULESETS[1])
      console.log(`      coverage: ${Object.entries(inv.coverage).sort().map(([k, v]) => `${k} ${v}`).join(", ")}`);
    if (inv.failures.length > 0) exitCode = 1;
  }
}
if (!args.includes("--no-relevance")) {
  const count = Number(opt("--relevance-count") ?? opt("--count") ?? "20000");
  const seed = Number(opt("--seed") ?? String(DEFAULT_SEED));
  const t2 = performance.now();
  const rel = runRelevanceChecks({ count, seed });
  console.log(`\n== couldAffectOutcome ↔ solve parity: ${count} families, seed ${seed}`);
  console.log(
    `   ${rel.compared} (family, relative, column) cases where couldAffectOutcome = false were compared, ${rel.refused} skipped (a column refused); ${rel.failures.length} failures (${((performance.now() - t2) / 1000).toFixed(1)} s)`,
  );
  for (const f of rel.failures.slice(0, verbose ? 50 : 5)) console.log(`      #${f.index} ${f.role} [${f.column}]: ${f.message}`);
  if (rel.failures.length > 0) exitCode = 1;
}
console.log(`\nwaris-check: ${exitCode === 0 ? "OK" : "FAILED"} (${((performance.now() - t0) / 1000).toFixed(1)} s total)`);
process.exit(exitCode);
