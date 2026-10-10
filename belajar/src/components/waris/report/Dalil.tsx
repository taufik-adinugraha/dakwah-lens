"use client";

import { BookOpen, ChevronDown, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { msg, type ArabicView, type DalilCard, type DalilRow, type DalilSectionView, type LegalRefView } from "@/lib/waris/report";

import { FracFigure, RuleNote, Section } from "./bits";
import { cardAnchor, revealTarget, useCards } from "./context";
import { useReportText } from "./text";

/**
 * Section 4, "Dalil untuk setiap bagian" (plan §6 row 4, D10). One 48px disclosure row per heir,
 * collapsed on screen and opened for print. Inside: the RuleNotes, then each dalil card once
 * (a card shown earlier is linked, not repeated). Arabic is the model's ArabicView text, which the
 * report checks rebuild byte for byte from dalil.json; it is never typed here. Qur'an in .quran,
 * other Arabic in .arabic-inline, never below text-ar-sm (24px) on screen and 16pt in print. A
 * translation shows only when the corpus has one, with its exact source label; otherwise the card
 * says it is shown in Arabic only. Each citation links to its source passage.
 */

function Arabic({ v, heading }: { v: ArabicView; heading?: boolean }) {
  const quran = v.script === "quran";
  return (
    <p
      lang="ar"
      dir="rtl"
      className={`${quran ? "quran wr-ar-quran" : "arabic-inline wr-ar"} ${heading ? "font-bold" : ""} text-pretty text-right text-ink`}
    >
      {v.text}
    </p>
  );
}

export function DalilCardView({ card }: { card: DalilCard }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const anchor = cardAnchor(card.id);
  const c = card.citation;
  return (
    <article id={anchor} tabIndex={-1} className="wr-dalil-card scroll-mt-24 rounded-2xl border border-hairline bg-white p-4 sm:p-5">
      <p className="flex flex-wrap items-center gap-2">
        <BookOpen className="h-5 w-5 shrink-0 text-forest" aria-hidden />
        {c.url ? (
          <a href={c.url} target="_blank" rel="noopener noreferrer" className="link-text inline-flex min-h-12 items-center gap-1 font-semibold">
            {c.text}
            {c.section ? ` · §${c.section}` : ""}
            <ExternalLink className="h-4 w-4" aria-hidden />
            <span className="sr-only"> {t("new_tab")}</span>
          </a>
        ) : (
          <span className="font-semibold text-ink">
            {c.text}
            {c.section ? ` · §${c.section}` : ""}
          </span>
        )}
      </p>
      {card.heading ? (
        <div className="mt-2">
          <Arabic v={card.heading} heading />
        </div>
      ) : null}
      {card.arabic ? (
        <div className="mt-2">
          <Arabic v={card.arabic} />
        </div>
      ) : null}
      {card.meaning ? (
        <div className="mt-3">
          <p className="text-pretty text-base text-ink">{card.meaning.text}</p>
          <p className="mt-1 text-sm text-ink-soft">{R(card.meaning.label)}</p>
          {card.meaning.footnotes ? (
            <div className="mt-2 rounded-lg bg-paper-deep p-3">
              <p className="text-sm font-semibold text-ink-muted">{R(msg("laporan.dalil.catatan_penerjemah"))}</p>
              <p className="mt-1 whitespace-pre-line text-pretty text-sm text-ink">{card.meaning.footnotes.text}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {card.meaningMissing ? <p className="mt-3 text-pretty text-sm text-ink-muted">{R(card.meaningMissing)}</p> : null}
      {card.tags.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {card.tags.map((m, i) => (
            <li key={i} className="text-sm text-ink-soft">
              {R(m)}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function SeeAbove({ id, seeAbove }: { id: string; seeAbove: string }) {
  const cards = useCards();
  const card = cards.get(id);
  const anchor = cardAnchor(id);
  return (
    <p className="text-base text-ink">
      <a href={`#${anchor}`} onClick={(e) => revealTarget(e, anchor)} className="link-text inline-flex min-h-12 items-center">
        {card?.citation.text ?? id}
      </a>
      <span className="text-ink-muted"> · {seeAbove}</span>
    </p>
  );
}

function Row({ row, seeAbove, figure }: { row: DalilRow; seeAbove: string; figure: boolean }) {
  const { R } = useReportText();
  const cards = useCards();
  return (
    <details id={row.anchor} className="scroll-mt-24 rounded-2xl border border-hairline bg-white px-4">
      <summary className="disclosure-row text-ink">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span>{R({ ...row.title, cap: true })}</span>
          {figure && row.fikih ? (
            <span className="font-normal">
              (<FracFigure f={row.fikih} />)
            </span>
          ) : null}
          <span className="text-sm font-normal text-ink-soft">{R(row.countLine)}</span>
        </span>
        <ChevronDown className="chev h-5 w-5 shrink-0" aria-hidden />
      </summary>
      <div className="space-y-4 pb-4">
        {row.rules.map((r) => (
          <RuleNote key={r.ruleId} rule={r} refs={false} />
        ))}
        {row.courtLine && row.courtRules.length > 0 ? (
          <div className="border-l-4 border-border-ui pl-3">
            <p className="text-sm font-semibold text-ink-muted">{R(row.courtLine)}</p>
            <div className="mt-2 space-y-3">
              {row.courtRules.map((r) => (
                <RuleNote key={r.ruleId} rule={r} refs={false} />
              ))}
            </div>
          </div>
        ) : null}
        <div className="space-y-3">
          {row.dalil.map((ref) => {
            const card = cards.get(ref.id);
            if (!card) return null;
            return ref.first ? <DalilCardView key={ref.id} card={card} /> : <SeeAbove key={ref.id} id={ref.id} seeAbove={seeAbove} />;
          })}
        </div>
        {[...row.rules, ...row.courtRules].some((r) => r.legal.length > 0) ? (
          <LegalOfRow row={row} />
        ) : null}
      </div>
    </details>
  );
}

function LegalOfRow({ row }: { row: DalilRow }) {
  const t = useTranslations("Report.ui");
  const byKey = new Map<string, LegalRefView>();
  for (const l of [...row.rules, ...row.courtRules].flatMap((r) => r.legal)) {
    const k = `${l.source}|${l.locator}`;
    if (!byKey.has(k)) byKey.set(k, l);
  }
  const items = [...byKey.values()];
  return (
    <div>
      <p className="text-sm font-semibold text-ink-muted">{t("legal_links")}</p>
      <ul className="mt-1 space-y-1">
        {items.map((l) => (
          <li key={`${l.source}|${l.locator}`} className="text-sm text-ink">
            {l.url ? (
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="link-text inline-flex min-h-12 items-center">
                {l.title}, {l.locator}
                <span className="sr-only"> {t("new_tab")}</span>
              </a>
            ) : (
              <span>
                {l.title}, {l.locator}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Section 4, plus every other card the report cites (langkah, the QS 4:8 line, musyawarah). */
export function DalilSection({ v, allCards }: { v: DalilSectionView; allCards: readonly DalilCard[] }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const seeAbove = R(v.seeAbove);
  const rows: { row: DalilRow; figure: boolean }[] = [
    ...(v.sebelum ? [{ row: v.sebelum, figure: false }] : []),
    ...v.rows.map((row) => ({ row, figure: true })),
    ...(v.tidakMendapat ? [{ row: v.tidakMendapat, figure: false }] : []),
  ];
  const placed = new Set<string>();
  for (const { row } of rows) for (const d of row.dalil) if (d.first) placed.add(d.id);
  const rest = allCards.filter((c) => !placed.has(c.id));
  return (
    <Section id="dalil" title={R(v.title)}>
      <div className="space-y-3">
        {rows.map(({ row, figure }) => (
          <Row key={row.anchor} row={row} seeAbove={seeAbove} figure={figure} />
        ))}
      </div>
      {rest.length > 0 ? (
        <details className="mt-3 rounded-2xl border border-hairline bg-white px-4">
          <summary className="disclosure-row text-ink">
            {t("dalil_lain", { jumlah: rest.length })}
            <ChevronDown className="chev h-5 w-5 shrink-0" aria-hidden />
          </summary>
          <div className="space-y-3 pb-4">
            {rest.map((c) => (
              <DalilCardView key={c.id} card={c} />
            ))}
          </div>
        </details>
      ) : null}
    </Section>
  );
}

/** The cards of a refusal (no section rows): every card its reasons cite, shown once. */
export function DalilCardsOnly({ cards }: { cards: readonly DalilCard[] }) {
  const t = useTranslations("Report.ui");
  if (cards.length === 0) return null;
  return (
    <Section id="dalil" title={t("dalil_rujukan")}>
      <div className="space-y-3">
        {cards.map((c) => (
          <DalilCardView key={c.id} card={c} />
        ))}
      </div>
    </Section>
  );
}
