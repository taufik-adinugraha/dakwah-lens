import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { ForestWash } from "@/components/ForestWash";
import { Reveal } from "./Reveal";

type LandingT = Awaited<ReturnType<typeof getTranslations<"Landing">>>;

type HeroCoverage = {
  outlets: number;
  socialPlatforms: number;
  postsAnalyzed30d: number;
};

/**
 * Landing hero — serene spiritual minimalism (2026-07 redesign).
 *
 * One idea per screen: an eyebrow, a single serif-display headline with a
 * lone forest-green accent clause, one line of body, one primary action
 * (into public Insights, no signup — the "show value instantly" goal),
 * and an understated live-proof line. No gradients, no icon tiles, no
 * ornament — whitespace, type and a single accent carry it.
 */
export function Hero({
  t,
  locale,
  viewer,
  coverage,
}: {
  t: LandingT;
  locale: string;
  viewer: { signedIn: boolean; name: string };
  coverage: HeroCoverage;
}) {
  const nf = new Intl.NumberFormat(locale);
  const showProof = coverage.outlets > 0;

  return (
    <section className="relative isolate overflow-hidden bg-paper font-body">
      <ForestWash />

      <div className="mx-auto max-w-3xl px-6 pt-24 pb-28 text-center sm:pt-32 sm:pb-36">
        <Reveal>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
            {viewer.signedIn && viewer.name
              ? t("signed_in_greeting", { name: viewer.name })
              : t("hero_eyebrow_audience")}
          </p>
        </Reveal>

        <Reveal delay={70}>
          <h1 className="mt-6 text-balance font-display text-[clamp(2.5rem,6vw,4.5rem)] font-medium leading-[1.05] tracking-[-0.02em] text-ink">
            {t("hero_headline_lead")}{" "}
            <span className="text-forest">{t("hero_headline_accent")}</span>
          </h1>
        </Reveal>

        <Reveal delay={150}>
          <p className="mx-auto mt-7 max-w-xl text-pretty text-lg leading-[1.7] text-ink-muted">
            {t("hero_lede")}
          </p>
        </Reveal>

        <Reveal delay={230}>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/briefings"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-forest px-7 text-sm font-semibold text-paper shadow-sm transition hover:bg-forest-hover"
            >
              {t("hero_cta_primary")}
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex h-12 items-center gap-1.5 text-sm font-semibold text-ink-muted transition hover:text-ink"
            >
              {t("hero_cta_secondary")}
            </Link>
          </div>
        </Reveal>

        {showProof && (
          <Reveal delay={310}>
            <p className="mt-12 text-xs tracking-wide text-ink-faint tabular-nums">
              {t("hero_proof", {
                outlets: nf.format(coverage.outlets),
                platforms: nf.format(coverage.socialPlatforms),
                posts: nf.format(coverage.postsAnalyzed30d),
              })}
            </p>
          </Reveal>
        )}
      </div>
    </section>
  );
}
