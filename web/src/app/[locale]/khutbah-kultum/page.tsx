import type { Metadata } from "next";
import { ArrowRight, BookOpen, MessageSquareText } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ForestWash } from "@/components/ForestWash";
import { WeekPicker } from "@/components/WeekPicker";
import { Link } from "@/i18n/navigation";
import {
  BRIEFING_GROUPS,
  briefingSlug,
  extractDeliverableSection,
  getKhutbahKultumBriefings,
  getKhutbahKultumWeeks,
  type KhutbahKultumBriefing,
} from "@/lib/briefing-data";
import {
  daleelCitations,
  firstSermon,
  khutbahSteps,
  leadParagraph,
  sectionTitle,
  splitCitation,
} from "@/lib/khutbah-kultum";
import { localeAlternates } from "@/lib/seo";
import { paletteFor } from "@/lib/theme-group-palette";
import { parseWeekParam } from "@/lib/week-filter";

/**
 * Khutbah & Kultum library — the two deliverables visitors come for,
 * lifted out of the briefings into one browsable page: every theme's
 * Khutbah Jumat (or Kultum) for one WIB week, newest week by default,
 * each card linking to its existing /d/{slug}/{khutbah|kultum} page.
 *
 * Cards are extractive only (title, action steps / opening hook, daleel
 * citations) — see lib/khutbah-kultum. A card is rendered only when the
 * deliverable section exists in the same body the /d page renders, so
 * no card can link to a 404.
 */

// Reads the live DB per request (week + tab are URL-driven).
export const dynamic = "force-dynamic";

type Tab = "khutbah" | "kultum";

type Card = {
  key: string;
  href: string;
  label: string;
  themeGroup: string;
  /** The H3's quoted theme title; null on pre-2026-06-18 briefings. */
  title: string | null;
  steps: string[];
  lead: string | null;
  cites: string[];
  special: boolean;
  order: number;
  generatedAt: number;
};

// A khutbah without take-home steps (most rows before 2026-09) is
// summarised by its first paragraph about the week, not its opening
// formula ("Marilah kita buka khutbah siang ini dengan …").
const WEEK_HOOK = /\bpekan\b|\bminggu ini\b|\bthis week\b/i;

function toCard(b: KhutbahKultumBriefing, tab: Tab, locale: string): Card | null {
  const body = locale === "en" && b.summaryMdEn ? b.summaryMdEn : b.summaryMd;
  const section = extractDeliverableSection(body, tab);
  if (!section) return null;

  const order = BRIEFING_GROUPS.indexOf(b.themeGroup);
  const special = order === -1;
  const occasionName =
    typeof b.headlineStats?.occasion_name === "string"
      ? b.headlineStats.occasion_name
      : null;
  const label = (special && occasionName) || b.themeGroup;

  // The khutbah's daleel + summary come from the FIRST sermon; the second
  // is liturgy plus its own reflections (see firstSermon).
  const scope = tab === "khutbah" ? firstSermon(section.body) : section.body;
  const steps = tab === "khutbah" ? khutbahSteps(section.body) : [];

  return {
    key: `${b.themeGroup}:${b.occasionSlug ?? ""}`,
    href: `/d/${briefingSlug(b.generatedAt, b.themeGroup, b.occasionSlug)}/${tab}`,
    label,
    themeGroup: b.themeGroup,
    title: sectionTitle(section.heading),
    steps,
    lead:
      steps.length > 0
        ? null
        : leadParagraph(scope, tab === "khutbah" ? { prefer: WEEK_HOOK } : {}),
    cites: daleelCitations(scope),
    special,
    order,
    generatedAt: b.generatedAt.getTime(),
  };
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/khutbah-kultum">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "KhutbahKultum" });
  const title = t("meta_title");
  const description = t("meta_description");
  return {
    title,
    description,
    // Week/tab query params are views of one page — canonical ignores them.
    alternates: localeAlternates({ locale, canonicalPath: "/khutbah-kultum" }),
    openGraph: { title, description, type: "website" },
  };
}

export default async function KhutbahKultumPage({
  params,
  searchParams,
}: PageProps<"/[locale]/khutbah-kultum">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("KhutbahKultum");

  const sp = await searchParams;
  const tab: Tab = sp.tab === "kultum" ? "kultum" : "khutbah";
  const weeks = await getKhutbahKultumWeeks();
  const requested = parseWeekParam(sp.week);
  // An unknown or empty week falls back to the newest one with content.
  const pinnedWeek = requested && weeks.includes(requested) ? requested : null;
  const week = pinnedWeek ?? weeks[0] ?? null;

  const briefings = week ? await getKhutbahKultumBriefings(week) : [];
  const cards = briefings
    .map((b) => toCard(b, tab, locale))
    .filter((c): c is Card => c !== null);
  const weekly = cards.filter((c) => !c.special).sort((a, b) => a.order - b.order);
  const special = cards
    .filter((c) => c.special)
    .sort((a, b) => b.generatedAt - a.generatedAt);

  // Tabs keep a pinned week; on the default (newest) view they stay
  // param-free so the link keeps meaning "this week".
  const weekQs = pinnedWeek ? `week=${pinnedWeek}` : "";
  const tabHref = (target: Tab) => {
    const qs = [weekQs, target === "kultum" ? "tab=kultum" : ""]
      .filter(Boolean)
      .join("&");
    return qs ? `/khutbah-kultum?${qs}` : "/khutbah-kultum";
  };

  const cardLabels: CardLabels = {
    untitled: tab === "khutbah" ? t("tab_khutbah") : t("tab_kultum"),
    steps: t("steps_label"),
    daleel: t("daleel_label"),
    read: tab === "khutbah" ? t("read_khutbah") : t("read_kultum"),
  };

  const tabs: Array<{ key: Tab; label: string; Icon: typeof BookOpen }> = [
    { key: "khutbah", label: t("tab_khutbah"), Icon: BookOpen },
    { key: "kultum", label: t("tab_kultum"), Icon: MessageSquareText },
  ];

  return (
    <div className="relative isolate overflow-hidden bg-paper font-body">
      <ForestWash />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-forest">
            {t("eyebrow")}
          </p>
          <h1 className="mt-2 text-balance font-display text-3xl font-medium tracking-[-0.015em] text-ink sm:text-4xl">
            {t("heading")}
          </h1>
          <p className="mt-3 text-pretty text-sm leading-[1.7] text-ink-muted sm:text-base">
            {t("intro")}
          </p>
        </header>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label={t("tabs_label")}
            className="inline-flex rounded-full border border-hairline bg-white p-1 shadow-sm"
          >
            {tabs.map(({ key, label, Icon }) => {
              const active = key === tab;
              return (
                <Link
                  key={key}
                  href={tabHref(key)}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                    active
                      ? "bg-forest text-paper"
                      : "text-ink-muted hover:bg-paper-deep hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>

          {week && (
            <WeekPicker
              basePath="/khutbah-kultum"
              weeks={weeks}
              selectedWeek={week}
              viewKey={`${pinnedWeek ?? ""}|${tab}`}
              locale={locale}
              extraParams={{ tab: tab === "kultum" ? "kultum" : undefined }}
              labels={{
                week: t("week_label"),
                older: t("older_week"),
                newer: t("newer_week"),
              }}
            />
          )}
        </div>

        {!week ? (
          <p className="mt-10 rounded-2xl border border-dashed border-hairline bg-white/70 p-8 text-center text-sm text-ink-muted">
            {t("empty_all")}
          </p>
        ) : cards.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-dashed border-hairline bg-white/70 p-8 text-center text-sm text-ink-muted">
            {tab === "khutbah" ? t("empty_week_khutbah") : t("empty_week_kultum")}
          </p>
        ) : (
          <>
            {special.length > 0 && (
              <CardSection
                heading={t("special_editions")}
                count={t("count", { count: special.length })}
                cards={special}
                labels={cardLabels}
              />
            )}
            {weekly.length > 0 && (
              <CardSection
                heading={t("weekly_themes")}
                count={t("count", { count: weekly.length })}
                cards={weekly}
                labels={cardLabels}
              />
            )}
          </>
        )}

        <p className="mt-12 text-center text-xs leading-relaxed text-ink-muted">
          {t("disclaimer")}
        </p>
      </div>
    </div>
  );
}

type CardLabels = {
  untitled: string;
  steps: string;
  daleel: string;
  read: string;
};

function CardSection({
  heading,
  count,
  cards,
  labels,
}: {
  heading: string;
  count: string;
  cards: Card[];
  labels: CardLabels;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
        {heading}
        <span className="ml-2 font-medium normal-case tracking-normal">
          {count}
        </span>
      </h2>
      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const tone = paletteFor(c.themeGroup);
          return (
            // One link per card, on the title, stretched over the card by
            // its ::after — so a screen reader's link name is the title,
            // not the whole card's text.
            <li
              key={c.key}
              className="group relative flex flex-col rounded-2xl border border-hairline bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-forest"
            >
              <span
                className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone.chipBg} ${tone.chipText}`}
              >
                {c.label}
              </span>
              <h3 className="mt-3 text-balance font-display text-lg font-medium leading-snug text-ink">
                <Link
                  href={c.href}
                  className="outline-none after:absolute after:-inset-px after:rounded-2xl after:content-['']"
                >
                  {c.title ?? labels.untitled}
                </Link>
              </h3>

              {c.steps.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                    {labels.steps}
                  </p>
                  <ul className="mt-1.5 space-y-1 text-sm leading-snug text-ink-muted">
                    {c.steps.map((s) => (
                      <li key={s} className="flex gap-2">
                        <span
                          aria-hidden
                          className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-forest/60"
                        />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {c.lead && (
                <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-ink-muted">
                  {c.lead}
                </p>
              )}

              <div className="mt-auto pt-4">
                {c.cites.length > 0 && (
                  <div className="text-xs leading-relaxed text-ink-muted">
                    <p className="font-semibold">{labels.daleel}</p>
                    {/* Citations as retrieved (see splitCitation). An Arabic
                        locator gets its own right-to-left block, aligned
                        under its kitab name and wrapped to two lines, so
                        the sub-section at its end (" / الثاني" — what
                        tells sibling citations apart) stays visible; only
                        a locator longer than two lines clips, at its
                        logical end. */}
                    <ul className="mt-0.5 space-y-1.5">
                      {c.cites.map((cite) => {
                        const { name, locator } = splitCitation(cite);
                        return (
                          <li key={cite}>
                            <span className="line-clamp-2">{name}</span>
                            {locator && (
                              <span
                                dir="rtl"
                                lang="ar"
                                className="line-clamp-2 text-end font-arabic text-[13px] leading-snug"
                              >
                                {locator}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {/* pointer-events-none: the hovered arrow's translate makes
                    a stacking context that would paint above the title
                    link's overlay and swallow the click. */}
                <span
                  aria-hidden
                  className="pointer-events-none mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-forest transition group-hover:text-forest-hover"
                >
                  {labels.read}
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
