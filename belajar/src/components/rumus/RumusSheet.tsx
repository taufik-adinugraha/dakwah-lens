import { ArrowRight, BookMarked, Clock, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { MixedText } from "@/components/library/MixedText";
import { TermText } from "@/components/library/TermText";
import type { RumusSource } from "@/content/rumus-schema";
import { Link } from "@/i18n/navigation";
import { WORD_INFO } from "@/lib/content";
import { glossSlot } from "@/lib/emphasis";
import { TERMS } from "@/lib/library";
import type { Sheet, SheetStep, SheetUnit } from "@/lib/rumusSheet";
import { shortKitab, splitKitab } from "@/lib/sources";
import { annotate, Scope } from "@/lib/terms";

/**
 * THE CHEAT SHEET, "Rumus singkat" (operator 2026-10-13: "we can make some 'cheat sheet' to
 * explain the rules, for example: harf jar + ism = kasrah (give examples) … this cheat sheet is
 * explained also along with formal explanation"; "of course we need to refer to valid kitab";
 * docs/belajar-plan.md L32), unit by unit in teaching order. What it draws is src/lib/rumusSheet.ts,
 * i.e. content/rumus.json and content/curriculum.json: nothing here names a surah, a step or a
 * formula.
 *
 * One white card per unit; inside it, one block per step:
 *   - the step's name as the lesson's card draws it (the term with its Arabic) and where it is
 *     taught ("Dipelajari di: Ayat 2");
 *   - the formula, through TermText like the Konsep records' prose (a term's Arabic at its first
 *     use in the block), then — only when a quoted sentence of the kitab says so — "Awas";
 *   - ONE example: the first word of that lesson the step occurs on, its Arabic, transliteration
 *     and meaning from the lesson file, linking the ayah's page;
 *   - "Dasar": each source — the kitab, its page ("hlm."), its section, the kitab's own words as
 *     quoted from the pinned page (an isolated right-to-left block at the 24px floor), and the link
 *     to the page on Shamela. Always visible (a printed sheet has no disclosure to open).
 * A step whose lesson is available but has no formula says "Rumus belum tersedia"; a step whose
 * lesson is not available says "Belum tersedia" and shows nothing else (no formula and no source is
 * in the page: rumusSheet leaves them out).
 *
 * Senior-friendly like the rest of the module: lists, never a table, 18px text with the Arabic at
 * the 24px floor, 48px link rows. No client JS: the sheet is server-rendered.
 */
export function RumusSheetView({ sheet }: { sheet: Sheet }) {
  return (
    <ol data-rumus="units" className="mt-6 space-y-6">
      {sheet.units.map((u, i) => (
        <li key={`${i}:${u.id}`}>
          <Unit unit={u} headingId={`rumus-unit-${i + 1}`} />
        </li>
      ))}
    </ol>
  );
}

function Unit({ unit, headingId }: { unit: SheetUnit; headingId: string }) {
  const t = useTranslations("Rumus");
  const tc = useTranslations("Curriculum");
  // The surah units keep the file's name in both locales; the unit of the lesson with no ayah is a
  // common noun, so it has a message (the curriculum page's own).
  const name = unit.surah ? unit.name : tc("intro_unit");
  return (
    <section data-rumus-unit={unit.id} aria-labelledby={headingId} className="rounded-2xl border border-hairline bg-white p-5 sm:p-7">
      <h3 id={headingId} className="font-display text-2xl font-medium text-ink">
        <MixedText text={name} />
      </h3>
      <p className="mt-1 text-base text-ink-muted">{t("unit_meta", { shown: unit.shown, steps: unit.steps.length })}</p>
      <ol className="mt-3 divide-y divide-hairline">
        {unit.steps.map((s) => (
          <Step key={s.id} step={s} unit={name} />
        ))}
      </ol>
    </section>
  );
}

function Step({ step, unit }: { step: SheetStep; unit: string }) {
  const t = useTranslations("Rumus");
  const tc = useTranslations("Curriculum");
  const tl = useTranslations("Lesson");
  const n = step.n ?? 0;
  const place = step.kind === "intro" ? tc("lesson_intro") : step.kind === "segment" ? tc("lesson_segment", { n }) : tl("ayah", { n });
  // One first-use scope per block: a term shows its Arabic once in the formula and its limit.
  const scope = new Scope(false);
  const rumus = step.rumus ? annotate(step.rumus, scope, TERMS) : null;
  const awas = step.awas ? annotate(step.awas, scope, TERMS) : null;
  const word = step.example ? WORD_INFO[step.example.loc] : undefined;
  return (
    <li data-rumus-step={step.id} data-rumus-state={step.state} data-lesson={step.lesson} className="py-5 last:pb-1 print:break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="font-display text-xl font-medium text-ink">
          <MixedText text={step.name} />
        </h4>
        <p className="text-base text-ink-muted">
          <MixedText text={t("taught_in", { place: step.kind === "intro" ? place : `${unit}, ${place.toLowerCase()}` })} />
        </p>
      </div>

      {step.state === "locked" ? (
        <p className="mt-3">
          <span data-rumus-status="" className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-border-ui bg-paper-deep px-3 py-1 text-sm font-semibold text-ink">
            <Clock aria-hidden className="h-4 w-4 shrink-0 text-ink-muted" />
            <span className="whitespace-nowrap">{tc("unavailable")}</span>
          </span>
        </p>
      ) : null}

      {step.state === "none" ? (
        <p data-rumus-none="" className="mt-3 text-base text-ink">
          <span className="font-semibold">{t("none")}</span> <MixedText text={t("none_hint")} />
        </p>
      ) : null}

      {step.state === "shown" && rumus ? (
        <>
          <p data-rumus-formula="" className="mt-3 max-w-prose text-pretty text-lg text-ink">
            <TermText tokens={rumus} emphasis />
          </p>
          {awas ? (
            <p data-rumus-awas="" className="mt-3 flex max-w-prose items-start gap-2 text-pretty text-base text-ink">
              <TriangleAlert aria-hidden className="mt-1 h-5 w-5 shrink-0 text-forest" />
              <span>
                <span className="font-semibold">{t("awas")}</span> <TermText tokens={awas} emphasis />
              </span>
            </p>
          ) : null}
          {step.example && word ? (
            <div data-rumus-example={step.example.loc} className="mt-4 rounded-xl bg-paper-deep px-4 py-3">
              <p className="text-sm font-semibold text-ink-muted">{t("example")}</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <bdi lang="ar" dir="rtl" className="quran text-ar-md text-ink">
                  {word.ar}
                </bdi>
                <span className="text-base text-ink">
                  <MixedText {...glossSlot((g) => `${word.translit} · ${g}`, word.gloss)} />
                </span>
              </p>
              <Link href={step.example.href} data-rumus-example-link="" className="mt-1 inline-flex min-h-12 items-center gap-1.5 text-base font-semibold text-forest">
                <span className="link-text">
                  <MixedText
                    text={t("example_open", { unit: step.example.unit, ayah: step.example.ayah, n: Number(step.example.loc.split(":")[2]) })}
                  />
                </span>
                <ArrowRight aria-hidden className="h-5 w-5 shrink-0" />
              </Link>
            </div>
          ) : null}
          {step.sumber ? <Basis sources={step.sumber} /> : null}
        </>
      ) : null}
    </li>
  );
}

/** "Dasar": each source with the kitab's own words. */
function Basis({ sources }: { sources: RumusSource[] }) {
  const t = useTranslations("Rumus");
  return (
    <div data-rumus-basis="" className="mt-4">
      <p className="flex items-center gap-2 text-base font-semibold text-ink-muted">
        <BookMarked aria-hidden className="h-5 w-5 shrink-0" />
        <span>{t("basis")}</span>
      </p>
      <ul className="mt-2 space-y-4">
        {sources.map((s) => {
          const k = splitKitab(s.kitab);
          return (
            <li key={s.page} data-rumus-source={s.page}>
              <p className="text-base font-semibold text-ink">
                <MixedText text={k.name} />
              </p>
              <p className="text-sm text-ink-muted">
                <MixedText text={[k.edition, t("page", { page: s.hlm })].filter(Boolean).join(" · ")} />{" "}
                <span>{t("section")}</span>{" "}
                {/* A section title can be longer than a phone's line ("باب معرفة علامات الإعراب" at Sangat
                    besar: CI line breaks, 2026-10-14): a block of its own that wraps at its spaces,
                    right to left (the base rule keeps a bare bdi on one line). */}
                <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm text-ink mt-1 block whitespace-normal">
                  {s.bab}
                </bdi>
              </p>
              <div className="mt-2 space-y-2">
                {s.quotes.map((q, i) => (
                  <blockquote
                    key={i}
                    lang="ar"
                    dir="rtl"
                    data-rumus-quote=""
                    className="arabic-inline text-ar-sm border-s-[3px] border-forest ps-3 text-ink text-pretty"
                  >
                    {q}
                  </blockquote>
                ))}
              </div>
              <a
                href={s.url}
                rel="noopener"
                data-rumus-shamela=""
                className="link-text mt-1 inline-flex min-h-12 items-center text-base font-medium"
                aria-label={t("shamela_label", { kitab: shortKitab(s.kitab), page: s.hlm })}
              >
                {t("shamela")}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
