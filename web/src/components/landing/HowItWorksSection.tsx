import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { Eyebrow, Section, Title } from "./primitives";
import { Reveal } from "./Reveal";

type LandingT = Awaited<ReturnType<typeof getTranslations<"Landing">>>;

type Coverage = {
  outlets: number;
  socialPlatforms: number;
  postsAnalyzed30d: number;
};

/**
 * How it works — the three steps as a numbered editorial column (no
 * step-badge cards), live coverage as bare inline figures, then the
 * honest schedule line. Replaces the old Features + BriefingShowcase +
 * HowItWorks trio, which explained the same pipeline three times.
 */
export function HowItWorksSection({
  t,
  locale,
  coverage,
}: {
  t: LandingT;
  locale: string;
  coverage: Coverage;
}) {
  const nf = new Intl.NumberFormat(locale);
  const steps = [
    { title: t("how_step_1_title"), body: t("how_step_1_body") },
    { title: t("how_step_2_title"), body: t("how_step_2_body") },
    { title: t("how_step_3_title"), body: t("how_step_3_body") },
  ];
  const figures = [
    { value: nf.format(coverage.outlets), label: t("how_coverage_outlets_hint") },
    {
      value: nf.format(coverage.socialPlatforms),
      label: t("how_coverage_platforms_hint"),
    },
    ...(coverage.postsAnalyzed30d > 0
      ? [
          {
            value: nf.format(coverage.postsAnalyzed30d),
            label: t("how_coverage_posts_hint"),
          },
        ]
      : []),
  ];

  return (
    <Section id="how-it-works">
      <Reveal>
        <Eyebrow>{t("how_eyebrow")}</Eyebrow>
        <Title>{t("how_title")}</Title>
      </Reveal>

      <ol className="mt-12 space-y-0">
        {steps.map((step, i) => (
          <Reveal as="li" key={step.title} delay={i * 80}>
            <div className="grid gap-2 border-t border-hairline py-8 sm:grid-cols-[80px_1fr] sm:gap-8">
              <span className="font-display text-2xl font-medium tabular-nums text-forest">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="font-display text-xl font-medium text-ink">
                  {step.title}
                </h3>
                <p className="mt-2 max-w-xl text-pretty text-sm leading-[1.7] text-ink-muted">
                  {step.body}
                </p>
              </div>
            </div>
          </Reveal>
        ))}
      </ol>

      {/* Live coverage — inline figures, not stat cards */}
      <Reveal delay={140}>
        <div className="flex flex-wrap gap-x-14 gap-y-6 border-t border-hairline pt-10">
          {figures.map((f) => (
            <div key={f.label}>
              <p className="font-display text-3xl font-medium tabular-nums text-ink sm:text-4xl">
                {f.value}
              </p>
              <p className="mt-1 max-w-[16rem] text-xs leading-relaxed text-ink-faint">
                {f.label}
              </p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={200}>
        <div className="mt-12 flex flex-col gap-3 text-sm text-ink-muted">
          <p>
            <span className="font-semibold text-ink">
              {t("how_schedule_intro")}
            </span>{" "}
            {t("how_schedule_detail")}
          </p>
          <Link
            href="/how-it-works"
            className="group inline-flex w-fit items-center gap-1.5 font-semibold text-forest transition hover:text-forest-hover"
          >
            {t("how_technical_link")}
            <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </Reveal>
    </Section>
  );
}
