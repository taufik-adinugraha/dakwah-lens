import { getTranslations } from "next-intl/server";

import { I18nText } from "@/components/I18nText";
import { Eyebrow, Section, Title } from "./primitives";
import { Reveal } from "./Reveal";

type LandingT = Awaited<ReturnType<typeof getTranslations<"Landing">>>;

/**
 * "Why not just ChatGPT?" — same positioning argument as before, but
 * rendered as one quiet comparison table: hairlines and type, no
 * gradient cards or glow. The four rows reuse the existing (reviewed)
 * why_llm_* content keys; only the frame changed.
 */
export function WhyNotLlm({ t }: { t: LandingT }) {
  const rows = [
    { llm: t("why_llm_row1_llm"), us: t("why_llm_row1_us") },
    { llm: t("why_llm_row2_llm"), us: t("why_llm_row2_us") },
    { llm: t("why_llm_row3_llm"), us: t("why_llm_row3_us") },
    { llm: t("why_llm_row4_llm"), us: t("why_llm_row4_us") },
  ];

  return (
    <Section id="why-not-llm">
      <Reveal>
        <Eyebrow>{t("why_llm_eyebrow")}</Eyebrow>
        <Title>{t("why_llm_title")}</Title>
        <I18nText
          text={t("why_llm_subtitle")}
          className="mt-4 block max-w-xl text-pretty leading-[1.7] text-ink-muted"
        />
      </Reveal>

      <Reveal delay={100}>
        <div className="mt-12 overflow-hidden">
          <div className="grid grid-cols-2 gap-x-8 border-b border-hairline pb-3">
            <I18nText
              text={t("why_llm_col_llm_eyebrow")}
              className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint"
            />
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-forest">
              {t("why_llm_col_us_eyebrow")}
            </p>
          </div>
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-2 gap-x-8 border-b border-hairline py-5 text-sm leading-[1.65]"
            >
              <p className="text-ink-faint">{r.llm}</p>
              <p className="text-ink">{r.us}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={160}>
        <p className="mt-8 max-w-2xl text-pretty text-sm leading-relaxed text-ink-faint">
          {t("why_llm_footnote")}
        </p>
      </Reveal>
    </Section>
  );
}
