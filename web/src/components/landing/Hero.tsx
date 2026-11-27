import { ArrowRight, ArrowUpRight, BookOpen, Play } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { ForestWash } from "@/components/ForestWash";
import { Reveal } from "./Reveal";

type LandingT = Awaited<ReturnType<typeof getTranslations<"Landing">>>;

/** The hero's three actions (the video, Insights, Belajar) share one width (owner 2026-11-28:
 *  "make the 3 buttons in equal size/width, especially in mobile"): the full column on a phone,
 *  up to 20rem, which holds the longest label ("Belajar bahasa Arab Al-Qur'an"). Two of them sit
 *  side by side from md (2 x 20rem + gap needs ~41rem); below that all three stack. */
const ACTION_WIDTH = "w-full max-w-80 md:w-80";

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
 * one outlined secondary action into Belajar (operator 2026-11-06: the
 * learning module reaches people beyond da'i; outlined, never a second
 * filled button, so Insights stays the one primary), and an understated
 * live-proof line. No gradients, no icon tiles, no
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

      <div className="mx-auto max-w-3xl px-6 pt-10 pb-24 text-center sm:pt-16 sm:pb-32">
        {/* The audience eyebrow ("Untuk da'i, ustadzah, kreator, …") was removed (owner
            2026-11-28); a signed-in visitor still gets the greeting here. */}
        {viewer.signedIn && viewer.name ? (
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
              {t("signed_in_greeting", { name: viewer.name })}
            </p>
          </Reveal>
        ) : null}

        <Reveal delay={70}>
          <h1 className="mt-5 text-balance font-display text-[clamp(2.25rem,5.5vw,4rem)] font-medium leading-[1.05] tracking-[-0.02em] text-ink">
            {t("hero_headline_lead")}{" "}
            <span className="text-forest">{t("hero_headline_accent")}</span>
          </h1>
        </Reveal>

        <Reveal delay={150}>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base sm:text-lg leading-[1.7] text-ink-muted">
            {t("hero_lede")}
          </p>
        </Reveal>

        {/* The overview video "Apa Itu Dakwah-Lens?" (2:55; owner 2026-11-27), between the lede
            and the actions: a pill with a filled play disc, not a filled button, so "Baca
            Insights" stays the one primary. It opens the Short on YouTube in a new tab (owner:
            "better as new tab in youtube instead of popup"), so the page loads nothing from
            YouTube. The hero is kept short enough that both actions show without scrolling on a
            laptop screen (owner 2026-11-27; measured at 1437x697). */}
        <Reveal delay={190}>
          <div className="mt-7 flex justify-center">
            <a
              href="https://www.youtube.com/shorts/jGSlhTQlZBc"
              target="_blank"
              rel="noopener noreferrer"
              data-hero-video=""
              className={`${ACTION_WIDTH} group inline-flex h-12 items-center justify-center gap-3 rounded-full border-[1.5px] border-forest/30 bg-white/80 px-5 text-sm font-semibold text-ink shadow-sm transition hover:border-forest hover:bg-forest-tint`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest text-paper transition group-hover:scale-105">
                <Play aria-hidden className="h-4 w-4 translate-x-px fill-current" />
              </span>
              {t("hero_video_cta")}
              <span className="sr-only">{t("hero_video_where")}</span>
              <ArrowUpRight aria-hidden className="h-4 w-4 text-ink-faint transition group-hover:text-forest" />
            </a>
          </div>
        </Reveal>

        <Reveal delay={230}>
          <div className="mt-3 flex flex-col items-center gap-3 md:mt-4 md:flex-row md:justify-center md:gap-4">
            <Link
              href="/briefings"
              className={`${ACTION_WIDTH} group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-forest px-7 text-sm font-semibold text-paper shadow-sm transition hover:bg-forest-hover`}
            >
              {t("hero_cta_primary")}
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            {/* Belajar is its own app under /belajar/<locale> (Caddy routes
                it): a plain <a> with a full page load, never the
                locale-aware <Link>, same as the header's Belajar link. The
                utm pair lets Belajar's anonymous counts tell a click on this
                button from any other arrival (belajar visit-count.ts HERO_UTM;
                a test there keeps the two the same). */}
            <a
              href={`/belajar/${locale}?utm_source=dakwah-lens&utm_medium=hero`}
              data-hero-belajar=""
              className={`${ACTION_WIDTH} inline-flex h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-forest bg-paper px-7 text-sm font-semibold text-forest transition hover:bg-forest-tint`}
            >
              <BookOpen aria-hidden className="h-4 w-4" />
              {t("hero_cta_belajar")}
            </a>
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
