/**
 * The quizzes (content/quiz/<slug>.json, pipeline/build_quiz.py), validated at BUILD time like
 * the lesson content: the zod shape, then every reference against the content — each question's
 * word is a word of its ayah, a tap word is timed in the page's first recitation, a sort word's
 * state is one of the bins, a wazan question's lexeme has the forms it names. A mismatch fails
 * `next build` instead of reaching a learner. The pipeline's own guard (validate_quiz.py) proves
 * that every question was taught before it is asked (operator 2026-10-10, narration rule 16).
 */
import alFatihah from "../../content/quiz/al-fatihah.json";
import alIkhlas from "../../content/quiz/al-ikhlas.json";
import alFalaq from "../../content/quiz/al-falaq.json";
import anNas from "../../content/quiz/an-nas.json";

import { QuizFile, type QuizAyah, type QuizFile as File } from "@/content/quiz-schema";
import type { SurahContent } from "@/content/schema";

import { timedWords } from "./autoplay/exercises";
import { SURAHS } from "./content";
import { getLexeme } from "./library";

/** Every problem of a quiz file against its surah's content (empty when fine). */
export function quizFileProblems(q: File, surah: Pick<SurahContent, "slug" | "ayat">, lexeme: typeof getLexeme): string[] {
  const out: string[] = [];
  const ayat = new Map(surah.ayat.map((a) => [a.ayah, a]));
  for (const a of q.ayat) {
    const ayah = ayat.get(a.ayah);
    if (!ayah) {
      out.push(`ayah ${a.ayah} is not in ${surah.slug}`);
      continue;
    }
    const timed = new Set(timedWords(ayah));
    for (const ex of a.exercises) {
      const where = `${surah.slug} ${a.ayah} ${ex.key}`;
      ex.questions.forEach((qq, i) => {
        if (qq.n !== i + 1) out.push(`${where}: question ${i + 1} is numbered ${qq.n}`);
      });
      if (ex.key === "wazn-factory") {
        for (const qq of ex.questions) {
          const forms = new Set((lexeme(qq.lexeme)?.tashrif?.forms ?? []).map((f) => f.label));
          if (qq.options[0] !== qq.label) out.push(`${where} q${qq.n}: the first option is not the asked form`);
          for (const o of qq.options) if (!forms.has(o)) out.push(`${where} q${qq.n}: ${qq.lexeme} has no form "${o}"`);
          if (!q.labels[qq.label]) out.push(`${where} q${qq.n}: no label for "${qq.label}"`);
        }
        continue;
      }
      const wordOf = (qq: { n: number; word: number }) => {
        const w = ayah.words[qq.word - 1];
        if (!w) out.push(`${where} q${qq.n}: word ${qq.word} is not a word of the ayah`);
        return w;
      };
      if (ex.key === "tap-word") {
        for (const qq of ex.questions) if (wordOf(qq) && !timed.has(qq.word)) out.push(`${where} q${qq.n}: word ${qq.word} has no timing`);
      } else if (ex.key === "why-harakat" || ex.key === "label-role") {
        for (const qq of ex.questions) {
          const w = wordOf(qq);
          if (w && qq.options[0].from !== w.loc) out.push(`${where} q${qq.n}: the first option is not the answer's (${w.loc})`);
          if (w && ex.key === "why-harakat" && !q.states[w.case.state]) out.push(`${where} q${qq.n}: no label for the state ${w.case.state}`);
        }
      } else {
        for (const qq of ex.questions) {
          const w = wordOf(qq);
          if (w && !ex.bins.includes(w.case.state)) out.push(`${where} q${qq.n}: ${w.case.state} is not a bin`);
        }
        for (const b of ex.bins) if (!q.states[b]) out.push(`${where}: no label for the bin ${b}`);
      }
    }
  }
  return out;
}

function load(raw: unknown, name: string): File {
  const result = QuizFile.safeParse(raw);
  if (!result.success) {
    throw new Error(`content/quiz/${name}.json does not match the schema:\n${JSON.stringify(result.error.issues.slice(0, 10), null, 2)}`);
  }
  if (result.data.slug !== name) throw new Error(`content/quiz/${name}.json carries slug "${result.data.slug}"`);
  const surah = SURAHS.find((s) => s.slug === name);
  if (!surah) throw new Error(`content/quiz/${name}.json: no lesson ${name}`);
  const problems = quizFileProblems(result.data, surah, getLexeme);
  if (problems.length) throw new Error(`content/quiz/${name}.json:\n${problems.slice(0, 10).join("\n")}`);
  return result.data;
}

const BY_SLUG: Readonly<Record<string, File>> = {
  "al-fatihah": load(alFatihah, "al-fatihah"),
  "al-ikhlas": load(alIkhlas, "al-ikhlas"),
  "al-falaq": load(alFalaq, "al-falaq"),
  "an-nas": load(anNas, "an-nas"),
};

/** Slugs with a quiz file (every lesson surah; content.test.ts checks). */
export const QUIZ_SLUGS: readonly string[] = Object.keys(BY_SLUG);

/** content/quiz/${slug}.json, or null. */
export function quizFor(slug: string): File | null {
  return Object.prototype.hasOwnProperty.call(BY_SLUG, slug) ? BY_SLUG[slug] : null;
}

/** One ayah's exercises with the labels they show (none: an empty list). */
export function quizAyah(slug: string, ayah: number): QuizAyah {
  const q = quizFor(slug);
  return {
    exercises: q?.ayat.find((a) => a.ayah === ayah)?.exercises ?? [],
    states: q?.states ?? {},
    labels: q?.labels ?? {},
  };
}
