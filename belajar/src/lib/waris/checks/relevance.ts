/**
 * Parity between couldAffectOutcome() and solve() (plan §5.1; risk #14 "questionnaire drops a
 * relative who changes the numbers"). For seeded random families and every askable relative type
 * x present: when couldAffectOutcome(x, everything else known) is false, removing every person of
 * type x must leave every other person's share unchanged in BOTH columns. This is the engine-side
 * half of the M2 completeness gate; the questionnaire graph itself is M2.
 *
 * Each x is tested twice: with everything else known, and with x's UN-BLOCKERS (hajb.ts UNBLOCKERS,
 * e.g. the consanguine brother for a consanguine sister) not yet asked either. Less knowledge must
 * never make x look irrelevant when it is not (review 2026-10-09).
 *
 * Grandchildren (cucu_*) are out of scope here: plan §5.3 asks C3/C4 always, for KHI 185.
 * Families whose solve refuses in either column are counted, not compared (the refusal pages and
 * beyond-depth detection — C4b, F5 — are questionnaire nodes, not couldAffectOutcome).
 */
import { UNBLOCKERS, couldAffectOutcome, type KnownCounts } from "../hajb";
import { PROFILES, type HeirId } from "../registry";
import { solve } from "../solve";
import { toStr } from "../frac";
import { deriveFamily } from "../family";
import type { FamilyInput, Person, Result, WarisInput } from "../types";
import { randomFamily } from "./invariants";
import { Rng } from "./prng";

export const ASKABLE: readonly HeirId[] = [
  "kakek",
  "nenek_ayah",
  "nenek_ibu",
  "sdr_lk_kandung",
  "sdr_pr_kandung",
  "sdr_lk_seayah",
  "sdr_pr_seayah",
  "sdr_lk_seibu",
  "sdr_pr_seibu",
  "keponakan_lk_kandung",
  "keponakan_lk_seayah",
  "paman_kandung",
  "paman_seayah",
  "sepupu_lk_kandung",
  "sepupu_lk_seayah",
];

/** What a questionnaire would know: eligible counts per role (both columns' eligibility agree here). */
export function knownFrom(fam: FamilyInput): KnownCounts {
  const d = deriveFamily(fam, PROFILES["klasik-syafii"]);
  const known: KnownCounts = {};
  for (const [role, members] of Object.entries(d.roles)) known[role as HeirId] = members?.length ?? 0;
  const dk = deriveFamily(fam, PROFILES["standar-indonesia"]);
  known.predeceasedSons = dk.slots.filter((s) => s.sex === "L").length;
  known.predeceasedDaughters = dk.slots.filter((s) => s.sex === "P").length;
  return known;
}

/** Mark every living person of role x as not alive (their own children, if any, stay). */
export function withoutRole(fam: FamilyInput, x: HeirId): FamilyInput {
  const f: FamilyInput = structuredClone(fam);
  const kill = (p: Person | undefined) => {
    if (p) p.alive = false;
  };
  if (x === "kakek") kill(f.paternalGrandfather);
  if (x === "nenek_ayah") kill(f.paternalGrandmother);
  if (x === "nenek_ibu") kill(f.maternalGrandmother);
  for (const s of f.siblings) {
    const role = s.line === "seibu" ? `sdr_${s.sex === "L" ? "lk" : "pr"}_seibu` : `sdr_${s.sex === "L" ? "lk" : "pr"}_${s.line}`;
    if (role === x) kill(s);
    if (x === `keponakan_lk_${s.line}` && s.sex === "L") for (const k of s.children ?? []) if (k.sex === "L") kill(k);
  }
  for (const u of f.paternalUncles) {
    if (x === `paman_${u.line}`) kill(u);
    if (x === `sepupu_lk_${u.line}`) for (const k of u.children ?? []) if (k.sex === "L") kill(k);
  }
  return f;
}

function sharesOf(r: Result, removed: ReadonlySet<string>): string {
  if (r.kind === "rujuk") return `rujuk:${r.reasons.join(",")}`;
  const parts: string[] = [];
  for (const g of r.shares) for (const p of g.persons) if (!removed.has(p.personId)) parts.push(`${p.personId}=${toStr(p.share)}/${toStr(p.line)}`);
  for (const l of r.lines) if (l.kind !== "heir") parts.push(`${l.kind === "wasiat_wajibah" ? `ww:${l.personIds.join(",")}` : l.key}=${toStr(l.frac)}`);
  return parts.sort().join(";");
}

function livingIds(fam: FamilyInput): Set<string> {
  const out = new Set<string>();
  const walk = (p: Person) => {
    if (p.alive) out.add(p.id);
    for (const c of p.children ?? []) walk(c);
  };
  for (const p of [...fam.siblings, ...fam.paternalUncles, fam.paternalGrandfather, fam.paternalGrandmother, fam.maternalGrandmother]) if (p) walk(p);
  return out;
}

export interface RelevanceReport {
  seed: number;
  families: number;
  /** (family, role) pairs where couldAffectOutcome said "no" and the shares were compared. */
  compared: number;
  /** Pairs skipped because a column refused (counted, not compared). */
  refused: number;
  failures: { index: number; role: HeirId; column: string; message: string; input: WarisInput }[];
}

export function runRelevanceChecks(opts: { count: number; seed: number; maxFailures?: number }): RelevanceReport {
  const gen = new Rng(opts.seed);
  const failures: RelevanceReport["failures"] = [];
  let compared = 0;
  let refused = 0;
  for (let i = 0; i < opts.count && failures.length < (opts.maxFailures ?? 50); i++) {
    const input = randomFamily(gen, i);
    const fam = input.family;
    if (fam.deceased.religion !== "islam" || (fam.outOfScope ?? []).length > 0) continue;
    // A3 routes any reported killing to E-BUNUH before a count is asked (plan D4), so families with
    // KHI-173 / killing bars never reach couldAffectOutcome; "murtad" (= non-Muslim) stays in.
    if (hasKillerBar(fam)) continue;
    const known = knownFrom(fam);
    for (const x of ASKABLE) {
      const present = (known[x] ?? 0) > 0;
      if (!present) continue;
      const k: KnownCounts = { ...known };
      delete k[x];
      const kUnasked: KnownCounts = { ...k };
      for (const u of UNBLOCKERS[x] ?? []) delete kUnasked[u];
      // compare whenever EITHER state of knowledge calls x irrelevant
      if (couldAffectOutcome(x, k) && couldAffectOutcome(x, kUnasked)) continue;
      const without: WarisInput = { ...input, family: withoutRole(fam, x) };
      const before = livingIds(fam);
      const after = livingIds(without.family);
      const removed = new Set([...before].filter((id) => !after.has(id)));
      for (const column of ["klasik-syafii", "standar-indonesia"] as const) {
        const a = solve(input, column);
        const b = solve(without, column);
        if (a.kind === "rujuk" || b.kind === "rujuk") {
          refused++;
          continue;
        }
        compared++;
        const sa = sharesOf(a, removed);
        const sb = sharesOf(b, removed);
        if (sa !== sb) {
          failures.push({ index: i, role: x, column, message: `couldAffectOutcome(${x}) = false, but removing it changes:\n${sa}\n--- without ---\n${sb}`, input });
        }
      }
    }
  }
  return { seed: opts.seed, families: opts.count, compared, refused, failures };
}

function hasKillerBar(fam: FamilyInput): boolean {
  let found = false;
  const walk = (p: Person | undefined) => {
    if (!p) return;
    if ((p.bars ?? []).some((b) => b !== "murtad")) found = true;
    for (const c of p.children ?? []) walk(c);
  };
  for (const p of [...fam.spouses, ...fam.children, fam.father, fam.mother, fam.paternalGrandfather, fam.paternalGrandmother, fam.maternalGrandmother, ...fam.siblings, ...fam.paternalUncles]) walk(p);
  return found;
}
