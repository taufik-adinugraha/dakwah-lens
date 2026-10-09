"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { Lexeme } from "@/content/schema";
import { useProgress } from "@/hooks/useProgress";
import { seededShuffle } from "@/lib/shuffle";

import { ExerciseShell, Feedback } from "./ExerciseShell";

/**
 * "Pabrik Wazan" — from a lemma's root and bab, pick the right form for each
 * tashrif label (fi'il madhi, mudhari', mashdar, …). The forms are Arabic
 * word forms from the Kosakata library, NOT ayat: shown in a plain Arabic
 * face and labelled as such (plan §4.7).
 */
export function WaznFactory({ id, lexemes }: { id: string; lexemes: Lexeme[] }) {
  const t = useTranslations("Exercise");
  const { progress, markDone } = useProgress();
  const items = useMemo(
    () =>
      lexemes.flatMap((lx) => {
        const forms = lx.tashrif?.forms ?? [];
        if (forms.length < 3) return [];
        return forms.map((f) => ({
          lex: lx,
          label: f.label,
          answer: f.ar,
          options: seededShuffle(
            [f.ar, ...seededShuffle(forms.filter((o) => o.ar !== f.ar).map((o) => o.ar), `${lx.id}/${f.label}`).slice(0, 2)],
            `${lx.id}/${f.label}/o`,
          ),
        }));
      }),
    [lexemes],
  );
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  const [firstTry, setFirstTry] = useState(0);

  if (items.length < 2) return null;
  const finished = i >= items.length;
  const item = items[Math.min(i, items.length - 1)];
  const correct = picked === item.answer;

  const choose = (opt: string) => {
    if (correct) return;
    setPicked(opt);
    if (opt === item.answer) {
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
    <ExerciseShell title={t("wazn_title")} instruction={t("wazn_instruction")} done={finished || Boolean(progress[id])} doneLabel={t("done")}>
      {finished ? (
        <Feedback ok>{t("score", { right: firstTry, total: items.length })}</Feedback>
      ) : (
        <div>
          <p className="text-xs text-ink-faint">
            {i + 1} / {items.length} · {item.lex.tashrif?.bab}
          </p>
          <p className="mt-1 text-sm">
            {t("wazn_question")} <span className="font-semibold">{item.label}</span> ·{" "}
            <span lang="ar" dir="rtl" className="font-arabic text-lg">
              {(item.lex.root ?? []).join(" ")}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2" dir="rtl">
            {item.options.map((opt) => (
              <button
                key={opt}
                type="button"
                lang="ar"
                onClick={() => choose(opt)}
                className={`rounded-xl border px-4 py-1.5 font-arabic text-xl transition ${
                  picked === opt && opt === item.answer
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
              {correct ? t("right") : t("not_yet")} {item.label}:{" "}
              <span lang="ar" dir="rtl" className="font-arabic text-lg">{item.answer}</span>
            </Feedback>
          )}
          {correct && (
            <button type="button" onClick={next} className="mt-3 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-paper hover:bg-forest-hover">
              {i + 1 < items.length ? t("next") : t("finish")}
            </button>
          )}
          <p className="mt-3 text-[11px] text-ink-faint">{t("wazn_note")}</p>
        </div>
      )}
    </ExerciseShell>
  );
}
