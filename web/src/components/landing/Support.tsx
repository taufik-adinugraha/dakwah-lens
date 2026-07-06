import { ArrowRight, ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { Eyebrow, Lede, Section, Title } from "./primitives";
import { Reveal } from "./Reveal";

type LandingT = Awaited<ReturnType<typeof getTranslations<"Landing">>>;
type DonateT = Awaited<ReturnType<typeof getTranslations<"Donate">>>;

/**
 * Support + access — the page's quiet close. Donation methods as a
 * simple two-line list (both still "coming soon"), the transparency
 * link, then the beta-access note rendered as a calm paragraph rather
 * than the old amber alert box. Ends by pointing back to the public
 * Insights — the same door the hero opened.
 */
export function Support({
  t,
  tDonate,
  showAccessNote,
}: {
  t: LandingT;
  tDonate: DonateT;
  showAccessNote: boolean;
}) {
  const methods = [
    { label: tDonate("bank_label"), status: tDonate("bank_status") },
    { label: tDonate("qris_label"), status: tDonate("qris_status") },
  ];

  return (
    <Section id="donate">
      <div className="grid gap-14 lg:grid-cols-2 lg:gap-20">
        {/* Donations */}
        <Reveal>
          <Eyebrow>{tDonate("badge")}</Eyebrow>
          <Title>{tDonate("title")}</Title>
          <Lede>{tDonate("body")}</Lede>

          <ul className="mt-8 divide-y divide-hairline border-y border-hairline">
            {methods.map((m) => (
              <li
                key={m.label}
                className="flex items-baseline justify-between gap-6 py-4"
              >
                <span className="text-sm font-semibold text-ink">
                  {m.label}
                </span>
                <span className="text-right text-xs leading-relaxed text-ink-faint">
                  {m.status}
                </span>
              </li>
            ))}
          </ul>

          <Link
            href="/transparency"
            className="group mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-forest transition hover:text-forest-hover"
          >
            {tDonate("transparency_link")}
            <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </Reveal>

        {/* Access note — quiet, not an alert */}
        {showAccessNote && (
          <Reveal delay={100}>
            <Eyebrow>{t("access_eyebrow")}</Eyebrow>
            <Title>{t("access_title")}</Title>
            <Lede>{t("access_body")}</Lede>

            <div className="mt-8 flex flex-col items-start gap-4">
              <Link
                href="/briefings"
                className="group inline-flex h-11 items-center gap-2 rounded-full bg-forest px-6 text-sm font-semibold text-paper transition hover:bg-forest-hover"
              >
                {t("access_cta_insights")}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/contact"
                className="text-sm font-semibold text-ink-muted underline-offset-4 transition hover:text-ink hover:underline"
              >
                {t("hero_request_access")}
              </Link>
            </div>
          </Reveal>
        )}
      </div>
    </Section>
  );
}
