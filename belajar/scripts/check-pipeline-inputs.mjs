// The gate of .github/workflows/deploy-belajar.yml lets the pipeline half of CI (the lesson
// content's Python checks, about twenty minutes) skip a change that touches none of PIPELINE_INPUTS.
// That is only sound while PIPELINE_INPUTS covers everything those checks READ. This script holds
// the two together: it reads the list from the workflow (the one place it is written) and scans
// belajar/pipeline/*.py for the paths they build outside belajar/pipeline and belajar/content, and
// fails on one the list does not cover — so a new read cannot let an app-only change skip the
// check that depends on it. Runs in the `verify` job on every run; no dependencies.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BELAJAR = new URL("../", import.meta.url);
const WORKFLOW = new URL("../../.github/workflows/deploy-belajar.yml", import.meta.url);

const workflow = await readFile(WORKFLOW, "utf8");
const m = /PIPELINE_INPUTS: '([^']+)'/.exec(workflow);
if (!m) {
  console.error("✗ PIPELINE_INPUTS is not in .github/workflows/deploy-belajar.yml (the gate job's env)");
  process.exit(1);
}
const covered = new RegExp(m[1]);

/** A path counts as covered when a file under it would match: a directory gets a file name. */
const isCovered = (path) => covered.test(/\.[a-z0-9]+$/i.test(path) ? path : `${path}/x`);

const dir = fileURLToPath(new URL("pipeline/", BELAJAR));
const found = new Map(); // path -> [files that build it]
const add = (path, file) => found.set(path, [...(found.get(path) ?? []), file]);
for (const f of (await readdir(dir)).filter((n) => n.endsWith(".py"))) {
  const text = await readFile(new URL(`pipeline/${f}`, BELAJAR), "utf8");
  // BELAJAR / "src" / "lib" / "content.ts" and the same through PIPELINE.parent, REPO / "belajar", …
  for (const x of text.matchAll(/["'](src|messages|scripts|public)["']\s*\/\s*["']([^"']+)["'](?:\s*\/\s*["']([^"']+)["'])?(?:\s*\/\s*["']([^"']+)["'])?/g)) {
    add(`belajar/${[x[1], x[2], x[3], x[4]].filter(Boolean).join("/")}`, f);
  }
  // REPO / "docs" / "waris-research" / "dalil.json", REPO / ".github" / …
  for (const x of text.matchAll(/["'](docs|\.github|web|api)["']\s*\/\s*["']([^"']+)["'](?:\s*\/\s*["']([^"']+)["'])?/g)) {
    // the platform corpus (git-ignored: api/data) is not in the repo, CI does not read it
    if (x[1] === "api" || x[1] === "web") continue;
    add(`${[x[1], x[2], x[3]].filter(Boolean).join("/")}`, f);
  }
}

const bad = [...found].filter(([p]) => !isCovered(p));
if (bad.length) {
  console.error("✗ the pipeline reads paths PIPELINE_INPUTS (the gate of deploy-belajar.yml) does not cover:");
  for (const [p, files] of bad) console.error(`  ${p}  (${[...new Set(files)].join(", ")})`);
  console.error("  An app-only change to one of them would skip the checks that read it. Add it to PIPELINE_INPUTS.");
  process.exit(1);
}
console.log(`pipeline inputs ok: ${found.size} path(s) the pipeline reads outside pipeline/ and content/, all covered by the gate`);
