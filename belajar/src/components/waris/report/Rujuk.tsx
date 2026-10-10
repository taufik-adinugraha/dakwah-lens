"use client";

import { CircleAlert, Landmark } from "lucide-react";
import { useTranslations } from "next-intl";

import { Q_TEXT, fill, isQTextKey, messageVars, type Answers, type ExitHit, type QTextKey } from "@/lib/waris/questionnaire";
import type { RuleRefView, RujukView } from "@/lib/waris/report";

import { RuleNote } from "./bits";
import { Reasons } from "./Reasons";
import { useReportText } from "./text";

/**
 * Refusals (plan §5.4, D4, M2.8): the situation, why the tool stops, the rule with its dalil, and
 * where to ask. No numbers at all. The E-BUNUH class has no print and no answer summary (§9.4).
 */
export function Rujuk({ v }: { v: RujukView }) {
  const { R } = useReportText();
  return (
    <section id="rujuk" aria-labelledby="rujuk-judul" className="wr-section mt-10">
      <h2 id="rujuk-judul" className="font-display text-2xl font-medium text-ink sm:text-3xl">
        {R(v.title)}
      </h2>
      <p className="mt-3 text-pretty text-lg text-ink">{R(v.lead)}</p>
      <div className="mt-4">
        <Reasons reasons={v.reasons} />
      </div>
      <p className="mt-6 flex items-start gap-3 rounded-xl border border-hairline bg-forest-tint p-4 text-base text-ink">
        <Landmark className="mt-1 h-5 w-5 shrink-0 text-forest" aria-hidden />
        <span className="text-pretty">{R(v.whereToAsk)}</span>
      </p>
      {v.noPrintLine ? <p className="mt-3 text-sm text-ink-muted">{R(v.noPrintLine)}</p> : null}
    </section>
  );
}

function q(key: string, vars: Readonly<Record<string, string>>): string | null {
  return isQTextKey(key) ? fill(key as QTextKey, vars) : null;
}

/**
 * A questionnaire exit reached from the answers (E-TIDAK-TAHU, E-KHUNTSA, E-HIDUP, …): its own
 * exit copy (questionnaire/text.ts "exit.*"), and for E-TIDAK-TAHU the questions whose «Tidak tahu»
 * changes the outcome. No numbers.
 */
export function ExitNotice({ exit, answers, rules }: { exit: ExitHit; answers: Answers; rules: readonly RuleRefView[] }) {
  const t = useTranslations("Report.ui");
  const vars = messageVars(answers);
  const id = exit.id;
  const judul = q(`exit.${id}.judul`, vars);
  const parts = (["situasi", "alasan", "langkah"] as const).map((p) => q(`exit.${id}.${p}`, vars)).filter((x): x is string => !!x);
  const nodes = (exit.nodes ?? [])
    .map((k) => q(`${k.split(".")[0]}.tanya`, vars))
    .filter((x): x is string => !!x);
  return (
    <section id="rujuk" aria-labelledby="rujuk-judul" className="wr-section mt-10">
      <h2 id="rujuk-judul" className="flex items-start gap-3 font-display text-2xl font-medium text-ink sm:text-3xl">
        <CircleAlert className="mt-1.5 h-6 w-6 shrink-0 text-notice" aria-hidden />
        <span>{judul ?? Q_TEXT["exit.E-RUJUK.judul"]}</span>
      </h2>
      <div className="mt-4 space-y-3 text-lg text-ink">
        {parts.map((p, i) => (
          <p key={i} className="text-pretty">
            {p}
          </p>
        ))}
      </div>
      {nodes.length > 0 ? (
        <div className="mt-4 rounded-xl border-[1.5px] border-notice bg-notice-bg p-4">
          <p className="font-semibold text-ink">{t("pertanyaan_tidak_tahu")}</p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-base text-ink">
            {nodes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {rules.length > 0 ? (
        <div className="mt-6 space-y-4">
          {rules.map((r) => (
            <RuleNote key={r.ruleId} rule={r} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
