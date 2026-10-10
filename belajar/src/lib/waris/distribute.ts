/**
 * Distribution (engine.md §9.3, §14): whole units per person (tashih with ikhtisar = the lcm of
 * the per-person denominators), and integer rupiah by the largest-remainder (Hamilton) method on
 * exact fractions. Σ rupiah = T exactly; no line moves by more than Rp 1 from its exact value.
 */
import { B0, B1, eq, floorTimes, lcmAll, ONE, sum, type Frac } from "./frac";
import { EngineInvariantError } from "./adjust";

export interface LRLine {
  key: string;
  frac: Frac;
  /** Tie-break rank (registry order of the heir id); input order breaks the remaining ties. */
  rank: number;
}

export function largestRemainder(T: bigint, lines: readonly LRLine[]): Map<string, bigint> {
  if (!eq(sum(lines.map((l) => l.frac)), ONE)) throw new EngineInvariantError("rupiah lines do not sum to 1");
  const rows = lines.map((l, i) => ({ ...l, i, ...floorTimes(T, l.frac) }));
  let leftover = T;
  for (const r of rows) leftover -= r.q;
  const order = [...rows].sort((a, b) => {
    // r_a/d_a vs r_b/d_b without floats
    const x = a.r * b.frac.d;
    const y = b.r * a.frac.d;
    if (x !== y) return x > y ? -1 : 1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.i - b.i;
  });
  const out = new Map<string, bigint>();
  for (const r of rows) out.set(r.key, r.q);
  for (const r of order) {
    if (leftover <= B0) break;
    out.set(r.key, (out.get(r.key) ?? B0) + B1);
    leftover -= B1;
  }
  if (leftover !== B0) throw new EngineInvariantError("largest remainder left rupiah undistributed");
  return out;
}

/** Smallest integer table in which every share is whole (tashih + ikhtisar). */
export function finalBaseOf(shares: readonly Frac[]): bigint {
  return lcmAll(shares.filter((s) => s.n !== B0).map((s) => s.d));
}
