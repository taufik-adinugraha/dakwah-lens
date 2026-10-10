/**
 * Checks the autoplay lesson engine over every ayah of every surah:
 * sequences, narration manifests (when content/narration/*.json exist),
 * full simulated runs in every pace (caption-only and with audio) and
 * seeded property runs of the state machine. Pure TypeScript — runs without
 * node_modules:
 *
 *   cd belajar && npx --yes tsx@4.19.2 scripts/autoplay-check.ts [--streams N] [--length N] [--seed N]
 *
 * Exit code 1 on any error. The same checks run in CI through
 * src/lib/autoplay/autoplay.test.ts and src/components/autoplay/stage.test.ts
 * (npm test). Makes no network call and renders nothing (narration is
 * rendered only after the operator's go).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { loadCheckInput, runAutoplayChecks } from "../src/lib/autoplay/checks";

/** belajar/ — found from the script's own path, else from the cwd. */
function belajarRoot(): string {
  const starts = [process.argv[1] ? dirname(resolve(process.argv[1])) : null, process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; dir && i < 6; i++) {
      if (existsSync(join(dir, "content", "library.json")) && existsSync(join(dir, "src", "lib", "autoplay"))) return dir;
      if (existsSync(join(dir, "belajar", "content", "library.json"))) return join(dir, "belajar");
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error("belajar/ not found: run from the repository or belajar/");
}

function arg(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : undefined;
}

const content = join(belajarRoot(), "content");
const { input, errors: loadErrors } = loadCheckInput((rel) => {
  const path = join(content, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
});
input.property = { streams: arg("streams"), length: arg("length"), seed: arg("seed") };

const started = Date.now();
const report = runAutoplayChecks(input);
const errors = [...loadErrors, ...report.errors];
const { stats } = report;

console.log(
  `autoplay-check: ${stats.surahs} surahs, ${stats.ayat} ayat, ${stats.steps} steps ` +
    `(${stats.exerciseSteps} exercise steps), ${stats.lines} narration line ids, ` +
    `${stats.simulatedEvents} simulated events in ${((Date.now() - started) / 1000).toFixed(1)} s`,
);
for (const [slug, m] of Object.entries(stats.minutes)) {
  console.log(`  ${slug}: ≈ ${m.biasa} min Biasa · ${m.pelan} min Pelan (caption-only estimate, exercises answered at once)`);
}
for (const n of report.notes) console.log(`note: ${n}`);
if (errors.length) {
  for (const e of errors.slice(0, 200)) console.error(`ERROR ${e}`);
  if (errors.length > 200) console.error(`… and ${errors.length - 200} more`);
  console.error(`autoplay-check: ${errors.length} error(s)`);
  process.exit(1);
}
console.log("autoplay-check: OK");
