/**
 * The cheat sheet (content/rumus.json, pipeline/build_rumus.py), validated at BUILD time like the
 * curriculum it hangs on: the zod shape, then its references — every step is a step of
 * content/curriculum.json, in its lesson and in teaching order, every example is a word of the
 * lesson the step is taught in. A mismatch fails `next build` instead of reaching a learner.
 *
 * The formulas are the pipeline's: each restates a sentence of a kitab it cites (pinned page, print
 * page, the kitab's own words), and the pipeline's guards (validate_rumus.py) hold the term rule of
 * the lessons and the quotes against the pinned pages. What the PAGE shows of them, and when, is
 * ./rumusSheet.ts.
 */
import raw from "../../content/rumus.json";

import type { CurriculumFile } from "@/content/curriculum-schema";
import { RumusFile, type RumusFile as File } from "@/content/rumus-schema";

import { WORD_INFO } from "./content";
import { CURRICULUM } from "./curriculum";

/** Every problem of a cheat sheet against the curriculum and the lessons' words (empty when fine). */
export function rumusProblems(
  file: File,
  curriculum: Pick<CurriculumFile, "steps" | "lessons">,
  words: Readonly<Record<string, unknown>>,
): string[] {
  const out: string[] = [];
  const steps = new Map(curriculum.steps.map((s) => [s.id, s]));
  const order = new Map(curriculum.steps.map((s, i) => [s.id, i]));
  let last = -1;
  const seen = new Set<string>();
  for (const e of file.steps) {
    const where = `rumus[${e.step}]`;
    const step = steps.get(e.step);
    if (!step) {
      out.push(`${where}: no such step in the curriculum`);
      continue;
    }
    if (seen.has(e.step)) out.push(`${where}: listed twice`);
    seen.add(e.step);
    if (step.lesson !== e.lesson) out.push(`${where}: lesson ${e.lesson} is not the step's lesson ${step.lesson}`);
    const at = order.get(e.step) ?? -1;
    if (at < last) out.push(`${where}: out of the curriculum's teaching order`);
    last = Math.max(last, at);
    if (e.example) {
      const [s, a] = e.example.loc.split(":");
      if (!(e.example.loc in words)) out.push(`${where}: example ${e.example.loc} is not a word of any lesson`);
      else if (`${s}:${a}` !== e.lesson) out.push(`${where}: example ${e.example.loc} is not in the step's lesson ${e.lesson}`);
    }
    if (/\{\{|\}\}/.test(e.rumus) || /\{\{|\}\}/.test(e.awas ?? "")) out.push(`${where}: an unresolved pointer`);
  }
  return out;
}

const parsed = RumusFile.safeParse(raw);
if (!parsed.success) {
  throw new Error(`content/rumus.json does not match the schema:\n${JSON.stringify(parsed.error.issues.slice(0, 10), null, 2)}`);
}
const problems = rumusProblems(parsed.data, CURRICULUM, WORD_INFO);
if (problems.length) throw new Error(`content/rumus.json:\n${problems.slice(0, 10).join("\n")}`);

export const RUMUS: File = parsed.data;
