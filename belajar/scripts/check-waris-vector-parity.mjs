// Ilmu Waris, research phase: docs/waris-research/ holds the canonical copies of the
// engine test vectors and of the dalil set; belajar/content/waris/ holds the copies the
// module reads, because the image build context is belajar/ (architecture.md §5.6,
// plan §9.3). Fail if a pair differs by a single byte.
//
// A pair is checked only when its docs copy exists: the image job's context is
// belajar/ alone, while the verify job checks out the whole repo. Fix a failure by
// copying the docs file over the belajar file (for dalil.json, re-run
// belajar/pipeline/build_waris.py, which must reproduce the docs bytes). When the
// research phase ends the docs files become pointers and this script is removed.
import { access, readFile } from "node:fs/promises";

const PAIRS = [
  ["../../docs/waris-research/test-vectors.json", "../content/waris/test-vectors.json"],
  ["../../docs/waris-research/dalil.json", "../content/waris/dalil.json"],
];

const at = (p) => new URL(p, import.meta.url);
const exists = (p) =>
  access(at(p)).then(
    () => true,
    () => false,
  );

const firstDiff = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
};

const problems = [];
let checked = 0;
for (const [docs, mine] of PAIRS) {
  if (!(await exists(docs))) {
    console.log(`skip: ${docs.slice(6)} is not in this checkout`);
    continue;
  }
  if (!(await exists(mine))) {
    problems.push(`belajar/${mine.slice(3)} is missing (copy ${docs.slice(6)} byte for byte)`);
    continue;
  }
  const [a, b] = await Promise.all([readFile(at(docs)), readFile(at(mine))]);
  checked += 1;
  if (!a.equals(b)) {
    problems.push(
      `belajar/${mine.slice(3)} differs from ${docs.slice(6)} ` +
        `(${b.length} vs ${a.length} bytes; first difference at byte ${firstDiff(a, b)})`,
    );
  }
}

if (problems.length) {
  console.error("Ilmu Waris research-phase parity failed:\n" + problems.join("\n"));
  process.exit(1);
}
console.log(`waris parity ok (${checked} of ${PAIRS.length} pairs checked)`);
