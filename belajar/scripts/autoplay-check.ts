/**
 * Checks the autoplay lesson engine over every ayah of every surah:
 * sequences, narration manifests (when content/narration/*.json exist),
 * full simulated runs in every pace (caption-only and with audio) and
 * seeded property runs of the state machine, and the EXAMPLE BEATS (operator
 * 2026-10-12, plan L20: every rule explained is followed by an example —
 * this ayah's word on the stage's own player, else the narrator's recording
 * of the word or form, content/wordvoice.json — or is listed with the reason).
 * Pure TypeScript — runs without node_modules:
 *
 *   cd belajar && npx --yes tsx@4.19.2 scripts/autoplay-check.ts [--streams N] [--length N] [--seed N] [--examples]
 *
 * --examples also lists every beat (the rule's step → what is played)
 * and every rule without one, with the seconds the beats add per ayah.
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
// The example beats: per surah, how many, what they add to the lesson, the rules without one.
const listed = process.argv.includes("--examples");
for (const slug of Object.keys(stats.minutes)) {
  const rows = Object.entries(stats.examples).filter(([k]) => k.startsWith(`${slug}/`));
  const beats = rows.reduce((n, [, r]) => n + r.beats.length, 0);
  const recordings = rows.reduce((n, [, r]) => n + r.beats.filter((b) => !b.own).length, 0);
  const gaps = rows.reduce((n, [, r]) => n + r.gaps.length, 0);
  const sec = (pace: "biasa" | "pelan") => Math.round(rows.reduce((n, [, r]) => n + r.addedMs[pace], 0) / 1000);
  console.log(
    `  ${slug}: ${beats} example beats (${beats - recordings} this ayah's own word, ${recordings} the narrator's recording of a word or form), ` +
      `+${sec("biasa")} s Biasa · +${sec("pelan")} s Pelan; ${gaps} rule(s) without a beat of their own, each with its reason`,
  );
  if (!listed) continue;
  for (const [key, r] of rows) {
    console.log(`    ${key}: ${r.beats.length} beats, +${(r.addedMs.biasa / 1000).toFixed(1)} s Biasa · +${(r.addedMs.pelan / 1000).toFixed(1)} s Pelan`);
    for (const b of r.beats) console.log(`      ${b.step} → ${b.key}${b.own ? " (this ayah's word, the stage's player)" : " (the narrator's recording)"}`);
    for (const g of r.gaps) console.log(`      ${g.step}: no beat for ${g.rule} — ${g.why}`);
  }
}
for (const n of report.notes) console.log(`note: ${n}`);
if (errors.length) {
  for (const e of errors.slice(0, 200)) console.error(`ERROR ${e}`);
  if (errors.length > 200) console.error(`… and ${errors.length - 200} more`);
  console.error(`autoplay-check: ${errors.length} error(s)`);
  process.exit(1);
}
console.log("autoplay-check: OK");
