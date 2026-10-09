import { ChevronDown } from "lucide-react";

import type { Lexeme } from "@/content/schema";

import { MixedText } from "./MixedText";

export type SharafLabels = {
  heading: string;
  forms_note: string;
  ilal: string;
  ilal_from: string;
  ilal_to: string;
};

/**
 * Sharaf for a word's lemma: the tashrif row (Amtsilah at-Tashrifiyyah
 * order) and how the written form came about (i'lal). These are
 * MORPHOLOGICAL forms, not Qur'anic text — rendered in a plain Arabic face
 * (`.arabic-inline`), never mushaf-styled, and labelled as such (plan §4.7).
 * A nested disclosure: collapsed inside a word card, open by default on the
 * Kosakata page where it is the main content.
 */
export function SharafPanel({
  lexeme,
  labels,
  defaultOpen = false,
}: {
  lexeme: Lexeme;
  labels: SharafLabels;
  defaultOpen?: boolean;
}) {
  if (!lexeme.tashrif && lexeme.ilal.length === 0) return null;
  return (
    <details open={defaultOpen} className="mt-3 rounded-xl border border-hairline bg-white">
      <summary className="disclosure-row px-4 text-ink">
        <span>{labels.heading}</span>
        <ChevronDown aria-hidden="true" className="chev h-5 w-5 shrink-0 text-ink-muted" />
      </summary>
      <div className="space-y-5 px-4 pb-4">
        {lexeme.tashrif && (
          <div>
            <p className="text-sm text-ink-muted">
              <MixedText text={lexeme.tashrif.bab} />
            </p>
            <table className="mt-2 w-full text-left">
              <tbody>
                {lexeme.tashrif.forms.map((f) => (
                  <tr key={f.label} className="border-t border-hairline first:border-t-0">
                    <th scope="row" className="py-2 pr-3 text-left text-sm font-normal text-ink-muted">
                      {f.label}
                    </th>
                    <td lang="ar" dir="rtl" className="arabic-inline py-1 text-right text-ar-sm text-ink">
                      {f.ar}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm text-ink-muted">{labels.forms_note}</p>
          </div>
        )}
        {lexeme.ilal.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-ink">{labels.ilal}</p>
            <ul className="mt-2 space-y-4">
              {lexeme.ilal.map((x) => (
                <li key={`${x.from}-${x.to}`}>
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-muted">
                    <span>{labels.ilal_from}</span>
                    <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm text-ink">
                      {x.from}
                    </bdi>
                    <span aria-hidden="true">→</span>
                    <span>{labels.ilal_to}</span>
                    <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm text-ink">
                      {x.to}
                    </bdi>
                  </p>
                  <p className="mt-1 text-pretty text-base text-ink-muted">
                    <MixedText text={x.rule} />
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
