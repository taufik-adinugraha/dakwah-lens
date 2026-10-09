"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { Word } from "@/content/schema";
import { useProgress } from "@/hooks/useProgress";
import { seededShuffle } from "@/lib/shuffle";

import { CaseBadge } from "../lesson/CaseBadge";
import { ExerciseShell, Feedback } from "./ExerciseShell";

const GRADED = new Set(["marfu", "manshub", "majrur", "mabni"]);

/**
 * "Kenapa Harakat Ini?" — choose the reason a word ends the way it does.
 * Options are EXPLANATION sentences (the correct word's reason + reasons of
 * words in a different case); the Qur'anic word is always shown as it is in
 * the mushaf, never altered (plan §4.7).
 */
export function WhyHarakat({
  id,
  words,
  pool,
}: {
  id: string;
  words: Word[];
  pool: Word[];
}) {
  const t = useTranslations("Exercise");
  const { progress, markDone } = useProgress();
  const items = useMemo(
    () =>
      words
        .filter((w) => GRADED.has(w.case.state))
        .map((w) => {
          const distractors = seededShuffle(
            [...new Set(pool.filter((p) => p.case.state !== w.case.state).map((p) => p.why))],
            w.loc,
          ).slice(0, 2);
          return { word: w, options: seededShuffle([w.why, ...distractors], `${w.loc}/o`) };
        }),
    [words, pool],
  );
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [firstTry, setFirstTry] = useState(0);
  const [missed, setMissed] = useState(false);

  if (items.length === 0) return null;
  const finished = i >= items.length;
  const item = items[Math.min(i, items.length - 1)];
  const correct = picked === item.word.why;

  const choose = (opt: string) => {
    if (picked === item.word.why) return;
    setPicked(opt);
    if (opt === item.word.why) {
      if (!missed) setFirstTry((n) => n + 1);
    } else {
      setMissed(true);
    }
  };

  const next = () => {
    const n = i + 1;
    setI(n);
    setPicked(null);
    setMissed(false);
    if (n >= items.length) markDone(id, firstTry / items.length);
  };

  return (
    <ExerciseShell
      title={t("why_title")}
      instruction={t("why_instruction")}
      done={finished || Boolean(progress[id])}
      doneLabel={t("done")}
    >
      {finished ? (
        <Feedback ok>{t("score", { right: firstTry, total: items.length })}</Feedback>
      ) : (
        <div>
          <p className="text-xs text-ink-faint">
            {i + 1} / {items.length}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {t("why_question")}
            <span lang="ar" dir="rtl" className="quran text-2xl leading-none">
              {item.word.ar}
            </span>
            <span className="text-ink-muted">— {item.word.case.sign}?</span>
          </p>
          <ul className="mt-3 space-y-2">
            {item.options.map((opt) => {
              const chosen = picked === opt;
              const isRight = opt === item.word.why;
              return (
                <li key={opt}>
                  <button
                    type="button"
                    onClick={() => choose(opt)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm leading-relaxed transition ${
                      chosen && isRight
                        ? "border-forest bg-forest-tint"
                        : chosen
                          ? "border-case-nasb/50 bg-paper-deep"
                          : "border-hairline hover:bg-paper-deep"
                    }`}
                  >
                    {opt}
                  </button>
                </li>
              );
            })}
          </ul>
          {picked !== null && (
            <Feedback ok={correct}>
              {correct ? t("right") : t("not_yet")}{" "}
              <CaseBadge state={item.word.case.state} sign={item.word.case.sign} />{" "}
              {item.word.why}
            </Feedback>
          )}
          {correct && (
            <button
              type="button"
              onClick={next}
              className="mt-3 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-paper hover:bg-forest-hover"
            >
              {i + 1 < items.length ? t("next") : t("finish")}
            </button>
          )}
        </div>
      )}
    </ExerciseShell>
  );
}
