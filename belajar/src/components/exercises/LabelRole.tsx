"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { Word } from "@/content/schema";
import { useProgress } from "@/hooks/useProgress";
import { seededShuffle } from "@/lib/shuffle";

import { ExerciseShell, Feedback } from "./ExerciseShell";

/**
 * "Label Peran" — choose each word's role in the ayah (tarkib). Options are
 * role labels from the same ayah and the rest of the surah; the explanation
 * after each answer is the word's own "why".
 */
export function LabelRole({ id, words, pool }: { id: string; words: Word[]; pool: Word[] }) {
  const t = useTranslations("Exercise");
  const { progress, markDone } = useProgress();
  const items = useMemo(
    () =>
      words
        .filter((w) => w.role)
        .map((w) => {
          const others = [...new Set(pool.map((p) => p.role).filter((r): r is string => !!r && r !== w.role))];
          const options = seededShuffle([w.role as string, ...seededShuffle(others, w.loc).slice(0, 3)], `${w.loc}/r`);
          return { word: w, options };
        }),
    [words, pool],
  );
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  const [firstTry, setFirstTry] = useState(0);

  if (items.length < 2) return null;
  const finished = i >= items.length;
  const item = items[Math.min(i, items.length - 1)];
  const correct = picked === item.word.role;

  const choose = (opt: string) => {
    if (correct) return;
    setPicked(opt);
    if (opt === item.word.role) {
      if (!missed) setFirstTry((n) => n + 1);
    } else setMissed(true);
  };
  const next = () => {
    const n = i + 1;
    setI(n);
    setPicked(null);
    setMissed(false);
    if (n >= items.length) markDone(id, firstTry / items.length);
  };

  return (
    <ExerciseShell title={t("role_title")} instruction={t("role_instruction")} done={finished || Boolean(progress[id])} doneLabel={t("done")}>
      {finished ? (
        <Feedback ok>{t("score", { right: firstTry, total: items.length })}</Feedback>
      ) : (
        <div>
          <p className="text-xs text-ink-faint">
            {i + 1} / {items.length}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {t("role_question")}
            <span lang="ar" dir="rtl" className="quran text-2xl leading-none">
              {item.word.ar}
            </span>
            ?
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {item.options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => choose(opt)}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                  picked === opt && opt === item.word.role
                    ? "border-forest bg-forest-tint"
                    : picked === opt
                      ? "border-case-nasb/50 bg-paper-deep"
                      : "border-hairline hover:bg-paper-deep"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          {picked !== null && (
            <Feedback ok={correct}>
              {correct ? t("right") : t("not_yet")} {item.word.why}
            </Feedback>
          )}
          {correct && (
            <button type="button" onClick={next} className="mt-3 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-paper hover:bg-forest-hover">
              {i + 1 < items.length ? t("next") : t("finish")}
            </button>
          )}
        </div>
      )}
    </ExerciseShell>
  );
}
