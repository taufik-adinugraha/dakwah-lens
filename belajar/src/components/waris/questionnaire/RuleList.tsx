"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import type { DalilView, RulePack, RuleView } from "./rulePack";

/**
 * RuleNotes (content/waris/rules.json) as the questionnaire shows them: title and summary, the
 * Indonesian legal citations, and, on exit pages, the dalil cards. Every word comes from the
 * pack the server built from rules.json and dalil.json; every Arabic string is a byte slice of a
 * dalil record (report dalilCard()), rendered as is (plan D10).
 */
export function RuleList({ ids, pack, withDalil }: { ids: readonly string[]; pack: RulePack; withDalil: boolean }) {
  const rules = ids.map((id) => pack.rules[id as keyof RulePack["rules"]]).filter((r): r is RuleView => r !== undefined);
  if (rules.length === 0) return null;
  return (
    <ul className="space-y-4">
      {rules.map((r) => (
        <li key={r.id} className="rounded-2xl border border-hairline bg-white p-4 sm:p-5">
          <RuleItem rule={r} pack={pack} withDalil={withDalil} />
        </li>
      ))}
    </ul>
  );
}

function RuleItem({ rule, pack, withDalil }: { rule: RuleView; pack: RulePack; withDalil: boolean }) {
  const te = useTranslations("Exit");
  const cards = withDalil ? rule.dalil.map((id) => pack.dalil[id]).filter((d): d is DalilView => d !== undefined) : [];
  return (
    <>
      <p className="text-lg font-semibold text-ink">{rule.title}</p>
      <p className="mt-1 max-w-prose text-base text-ink">{rule.summary}</p>
      {rule.legal.length > 0 ? (
        <div className="mt-3">
          <p className="text-base font-semibold text-ink-muted">{te("hukum_judul")}</p>
          <ul className="mt-1 space-y-1">
            {rule.legal.map((l) => (
              <li key={`${l.title}|${l.locator}`} className="text-base text-ink">
                {l.url ? (
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="link-text inline-flex min-h-12 items-center gap-1.5">
                    {te("hukum_item", { judul: l.title, pasal: l.locator })}
                    <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                  </a>
                ) : (
                  <span className="inline-flex min-h-12 items-center">{te("hukum_item", { judul: l.title, pasal: l.locator })}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {cards.length > 0 ? (
        <details className="mt-3 border-t border-hairline pt-1">
          <summary className="disclosure-row text-forest">
            {te("dalil_buka", { n: cards.length })}
            <ChevronDown className="chev h-5 w-5 shrink-0" aria-hidden />
          </summary>
          <ul className="mt-2 space-y-4 pb-2">
            {cards.map((d) => (
              <li key={d.id}>
                <DalilBlock d={d} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function DalilBlock({ d }: { d: DalilView }) {
  const te = useTranslations("Exit");
  const citation = d.section ? te("bagian_kitab", { kitab: d.citation, bagian: d.section }) : d.citation;
  return (
    <figure className="rounded-xl bg-paper-deep p-4 break-inside-avoid">
      {d.heading ? (
        <p lang="ar" dir="rtl" className="arabic-inline text-ar-sm font-semibold text-ink">
          {d.heading}
        </p>
      ) : null}
      {d.arabic ? (
        <blockquote
          lang="ar"
          dir="rtl"
          className={d.arabic.script === "quran" ? "quran text-ar-sm text-ink sm:text-ar-md" : "arabic-inline text-ar-sm text-ink"}
        >
          {d.arabic.text}
        </blockquote>
      ) : null}
      {d.meaning ? (
        <div className="mt-3">
          <p className="max-w-prose text-base text-ink">{d.meaning.text}</p>
          <p className="mt-1 text-sm text-ink-soft">{d.meaning.label}</p>
          {d.meaning.footnotes ? (
            <details className="mt-1">
              <summary className="disclosure-row text-base">
                {te("catatan_penerjemah")}
                <ChevronDown className="chev h-5 w-5 shrink-0" aria-hidden />
              </summary>
              <p className="max-w-prose whitespace-pre-line text-sm text-ink-muted">{d.meaning.footnotes}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      {d.missing ? <p className="mt-3 max-w-prose text-sm text-ink-soft">{d.missing}</p> : null}
      {d.tags.map((tag) => (
        <p key={tag} className="mt-1 max-w-prose text-sm text-ink-soft">
          {tag}
        </p>
      ))}
      <figcaption className="mt-2 text-base">
        {d.url ? (
          <a
            href={d.url}
            target="_blank"
            rel="noopener noreferrer"
            className="chip-link min-h-12!"
            aria-label={te("sumber_label", { kutipan: citation })}
          >
            {citation}
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          </a>
        ) : (
          <span className="font-semibold text-ink">{citation}</span>
        )}
      </figcaption>
    </figure>
  );
}
