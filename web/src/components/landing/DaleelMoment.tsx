import { getTranslations } from "next-intl/server";

import { Reveal } from "./Reveal";

type LandingT = Awaited<ReturnType<typeof getTranslations<"Landing">>>;
type DaleelT = Awaited<ReturnType<typeof getTranslations<"Daleel">>>;

/**
 * The daleel moment — the page's spiritual peak and the proof of the
 * core promise ("retrieved from verified kitab, never generated").
 * ONE verse, set full-width with real typographic care on a faint
 * green-tinted field. No cards, no icons — the ayah is the design.
 */
export function DaleelMoment({
  t,
  tDaleel,
}: {
  t: LandingT;
  tDaleel: DaleelT;
}) {
  return (
    <section
      id="daleel"
      className="border-t border-hairline bg-forest-tint py-24 sm:py-32"
    >
      <div className="mx-auto max-w-3xl px-6 text-center">
        <Reveal>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
            {t("daleel_moment_eyebrow")}
          </p>
        </Reveal>

        <Reveal delay={90}>
          <p
            dir="rtl"
            lang="ar"
            className="mt-10 font-arabic text-[clamp(1.6rem,4vw,2.4rem)] leading-[2.1] text-ink"
          >
            {tDaleel("verse_1_arabic")}
          </p>
        </Reveal>

        <Reveal delay={170}>
          <p className="mx-auto mt-8 max-w-xl text-pretty leading-[1.7] text-ink-muted">
            <span aria-hidden>“</span>
            {tDaleel("verse_1_translation")}
            <span aria-hidden>”</span>
          </p>
          <p className="mt-4 text-sm font-medium tracking-wide text-forest">
            — {tDaleel("verse_1_source")}
          </p>
        </Reveal>

        <Reveal delay={240}>
          <p className="mx-auto mt-12 max-w-md text-pretty text-sm leading-relaxed text-ink-faint">
            {t("daleel_moment_note")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
