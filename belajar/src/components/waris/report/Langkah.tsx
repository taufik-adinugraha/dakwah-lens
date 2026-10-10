"use client";

import { useId } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { LangkahView, PenutupView } from "@/lib/waris/report";
import { warisHref } from "@/lib/routes";

import { RefLinks, RuleNote, Section } from "./bits";
import { useReportText } from "./text";

/**
 * Section 6, Langkah berikutnya (plan §6 row 6): a checklist (tick boxes on screen, empty boxes in
 * print), each step with its RuleNotes, legal sources and dalil. Ticks are not saved anywhere.
 * "Hitung untuk beliau" (an heir who died after the deceased) starts a fresh questionnaire.
 */
export function Langkah({ v }: { v: LangkahView }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const base = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const numbered: (number | null)[] = [];
  let count = 0;
  for (const it of v.items) {
    if (it.sub) numbered.push(null);
    else {
      count += 1;
      numbered.push(count);
    }
  }
  return (
    <Section id="langkah" title={R(v.title)}>
      <p className="text-sm text-ink-soft" data-print="hide">
        {t("centang_info")}
      </p>
      <ol className="mt-3 space-y-3">
        {v.items.map((it, i) => {
          const id = `${base}-${it.id}`;
          return (
            <li key={it.id} className={`wr-keep rounded-2xl border border-hairline bg-white p-4 ${it.sub ? "ml-6 sm:ml-10" : ""}`}>
              <div className="flex items-start gap-3">
                <input id={id} type="checkbox" className="wr-check mt-1 shrink-0" />
                <label htmlFor={id} className="min-h-12 flex-1 cursor-pointer text-pretty text-base text-ink">
                  {numbered[i] !== null ? <span className="font-semibold">{numbered[i]}. </span> : null}
                  {R(it.text)}
                </label>
              </div>
              {it.rules.length > 0 || it.legal.length > 0 || it.dalilIds.length > 0 ? (
                <div className="mt-2 pl-9">
                  {it.rules.map((r) => (
                    <div key={r.ruleId} className="mt-2">
                      <RuleNote rule={r} />
                    </div>
                  ))}
                  <RefLinks dalilIds={it.dalilIds} legal={it.legal} />
                </div>
              ) : null}
              {it.action ? (
                <div className="mt-3 pl-9" data-print="hide">
                  <Link prefetch={false} href={warisHref.hitung({ baru: true })} className="btn-secondary">
                    {R(it.action.label)}
                    <ArrowRight className="h-5 w-5" aria-hidden />
                  </Link>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/** Section 7, Penutup (plan §6 row 7): always printed. Nothing here says anything was or will be reviewed. */
export function Penutup({ v }: { v: PenutupView }) {
  const { R } = useReportText();
  return (
    <footer className="wr-section wr-keep mt-12 rounded-2xl border-[1.5px] border-notice bg-notice-bg p-5 text-base text-ink">
      <p className="font-semibold">{R(v.label)}</p>
      <ul className="mt-2 space-y-1">
        {v.lines.map((m, i) => (
          <li key={i} className="text-pretty">
            {R(m)}
          </li>
        ))}
      </ul>
    </footer>
  );
}
