import { batchId } from "@/lib/kosakata-path-core";

/** Which sentence the map says under its band about the words the learner has passed. */
export type CoverageLine =
  | { kind: "none" }
  | { kind: "first" }
  | { kind: "level"; n: number }
  | { kind: "levels"; from: number; to: number }
  | { kind: "batches" };

/**
 * What can truly be said of the passed batches. By level when they are whole levels in a row (operator
 * 2026-11-03: "Level ini mencakup ..."), with the level named, because "Lanjutkan: Level 2" stands right
 * below the line and "level ini" would read as that one. By batch otherwise: partway through a level,
 * or with a level tested out of further on, the figure is not any level's.
 *
 * Level 0's parts cover no word of the list (src/lib/kosakata-path-data.ts gives them no tokens), so
 * having passed only those is not "no test passed" and has no figure of its own.
 */
export function coverageLine(passed: Readonly<Record<string, unknown>>, levels: readonly { n: number; batches: number }[]): CoverageLine {
  if (Object.keys(passed).length === 0) return { kind: "none" };
  const count = (l: { n: number; batches: number }) => Array.from({ length: l.batches }, (_, i) => batchId(l.n, i + 1)).filter((id) => id in passed).length;
  const touched = levels.filter((l) => l.n > 0 && count(l) > 0);
  if (touched.length === 0) return { kind: "first" };
  const from = touched[0].n;
  const to = touched[touched.length - 1].n;
  if (!touched.every((l) => count(l) === l.batches) || to - from + 1 !== touched.length) return { kind: "batches" };
  return from === to ? { kind: "level", n: from } : { kind: "levels", from, to };
}
