import type { Lexeme } from "@/content/schema";

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
 * MORPHOLOGICAL forms, not Qur'anic text — rendered in a plain Arabic face,
 * never mushaf-styled, and labelled as such (plan §4.7).
 */
export function SharafPanel({ lexeme, labels }: { lexeme: Lexeme; labels: SharafLabels }) {
  if (!lexeme.tashrif && lexeme.ilal.length === 0) return null;
  return (
    <details className="mt-3 rounded-xl border border-hairline text-sm">
      <summary className="cursor-pointer px-3 py-2 font-medium text-ink-muted hover:text-ink">
        {labels.heading}
      </summary>
      <div className="space-y-3 px-3 pb-3">
        {lexeme.tashrif && (
          <div>
            <p className="text-xs text-ink-muted">{lexeme.tashrif.bab}</p>
            <table className="mt-1.5 w-full text-left">
              <tbody>
                {lexeme.tashrif.forms.map((f) => (
                  <tr key={f.label} className="border-t border-hairline first:border-t-0">
                    <td className="py-1 pr-2 text-xs text-ink-muted">{f.label}</td>
                    <td lang="ar" dir="rtl" className="py-1 text-right font-arabic text-lg">
                      {f.ar}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-ink-faint">{labels.forms_note}</p>
          </div>
        )}
        {lexeme.ilal.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              {labels.ilal}
            </p>
            <ul className="mt-1 space-y-1.5">
              {lexeme.ilal.map((x) => (
                <li key={`${x.from}-${x.to}`}>
                  <span className="text-xs text-ink-muted">{labels.ilal_from} </span>
                  <bdi lang="ar" className="font-arabic text-base">{x.from}</bdi>
                  <span className="text-ink-muted"> → {labels.ilal_to} </span>
                  <bdi lang="ar" className="font-arabic text-base">{x.to}</bdi>
                  <span className="block text-xs leading-relaxed text-ink-muted">{x.rule}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
