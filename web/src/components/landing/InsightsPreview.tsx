import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { LandingInsights } from "@/lib/landing-data";
import { Eyebrow, Lede, Section, Title } from "./primitives";
import { Reveal } from "./Reveal";

type LandingT = Awaited<ReturnType<typeof getTranslations<"Landing">>>;

/**
 * Live Insights preview — the "show value instantly" section. Real rows
 * from the database (latest briefing per theme + busiest live themes),
 * set as a quiet editorial list rather than product-y cards. When the
 * corpus is empty (fresh install, dev DB) the section renders nothing:
 * an empty shell would undermine the exact proof it exists to give.
 */
export function InsightsPreview({
  t,
  locale,
  insights,
}: {
  t: LandingT;
  locale: string;
  insights: LandingInsights;
}) {
  const { briefings, themes } = insights;
  if (briefings.length === 0 && themes.length === 0) return null;

  const df = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
  });
  const nf = new Intl.NumberFormat(locale);

  return (
    <Section id="insights">
      <Reveal>
        <Eyebrow>{t("insights_eyebrow")}</Eyebrow>
        <Title>{t("insights_title")}</Title>
        <Lede>{t("insights_body")}</Lede>
      </Reveal>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
        {/* Latest briefings — editorial index list */}
        {briefings.length > 0 && (
          <Reveal delay={80}>
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
              {t("insights_briefings_label")}
            </p>
            <ol className="mt-4 divide-y divide-hairline border-y border-hairline">
              {briefings.map((b, i) => (
                <li key={b.id}>
                  <Link
                    href={`/briefings/${b.id}`}
                    className="group flex items-baseline gap-5 py-4 transition"
                  >
                    <span className="font-display text-sm tabular-nums text-ink-faint">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-lg font-medium leading-snug text-ink transition group-hover:text-forest">
                        {b.themeGroup}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {df.format(b.generatedAt)}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 self-center text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-forest" />
                  </Link>
                </li>
              ))}
            </ol>
          </Reveal>
        )}

        {/* Busiest live themes — quiet tally list */}
        {themes.length > 0 && (
          <Reveal delay={160}>
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
              {t("insights_themes_label")}
            </p>
            <ul className="mt-4 space-y-3">
              {themes.map((theme) => (
                <li
                  key={theme.label}
                  className="flex items-baseline justify-between gap-4 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {theme.label}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                    {t("insights_theme_posts", {
                      count: nf.format(theme.postCount),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
        )}
      </div>

      <Reveal delay={220}>
        <div className="mt-12">
          <Link
            href="/briefings"
            className="group inline-flex items-center gap-2 text-sm font-semibold text-forest transition hover:text-forest-hover"
          >
            {t("insights_cta")}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </Reveal>
    </Section>
  );
}
