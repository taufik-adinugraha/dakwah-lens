import { getLocale, getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { marketingSectionLink } from "@/lib/marketing-href";
import { I18nText } from "./I18nText";
import { Logo } from "./Logo";

export async function Footer() {
  const [t, tNav, session, locale] = await Promise.all([
    getTranslations("Footer"),
    getTranslations("Nav"),
    auth(),
    getLocale(),
  ]);
  const sectionLink = marketingSectionLink(
    session?.user?.status === "approved",
    locale,
  );

  return (
    <footer className="relative mt-16 bg-slate-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 md:flex md:flex-row md:items-center md:justify-between md:gap-10 md:py-8">
        {/* Brand block — same on every breakpoint */}
        <div className="flex items-start gap-3">
          <Logo tone="light" showWordmark={false} />
          <div>
            <p className="text-sm font-semibold">Dakwah-Lens</p>
            <I18nText
              text={t("tagline")}
              className="mt-0.5 block max-w-xs text-pretty text-xs leading-relaxed text-slate-400"
            />
          </div>
        </div>

        {/* Mobile-only layout — 2-column grid with section headers, then
            a full-width Donasi CTA below. The desktop inline row is hidden
            here so the two layouts don't fight for space. */}
        <div className="mt-8 md:hidden">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {t("section_product")}
              </p>
              <div className="flex flex-col gap-1.5 text-sm">
                <a
                  href={sectionLink("#features")}
                  className="text-white/80 transition hover:text-white"
                >
                  {tNav("features")}
                </a>
                <a
                  href={sectionLink("#how-it-works")}
                  className="text-white/80 transition hover:text-white"
                >
                  {tNav("how_it_works")}
                </a>
                <FooterLink href="/kitab">{tNav("kitab")}</FooterLink>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {t("section_info")}
              </p>
              <div className="flex flex-col gap-1.5 text-sm">
                <FooterLink href="/about">{t("organization")}</FooterLink>
                <FooterLink href="/contact">{t("contact")}</FooterLink>
                <FooterLink href="/privacy">{t("privacy")}</FooterLink>
                <FooterLink href="/terms">{t("terms")}</FooterLink>
              </div>
            </div>
          </div>
          <a
            href={sectionLink("#donate")}
            className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
          >
            {tNav("donate")}
          </a>
        </div>

        {/* Desktop-only inline nav — preserves the original look on md+. */}
        <nav className="hidden flex-wrap items-center gap-x-4 gap-y-2 text-xs md:flex">
          <a
            href={sectionLink("#features")}
            className="text-white/80 transition hover:text-white"
          >
            {tNav("features")}
          </a>
          <a
            href={sectionLink("#how-it-works")}
            className="text-white/80 transition hover:text-white"
          >
            {tNav("how_it_works")}
          </a>
          <FooterLink href="/kitab">{tNav("kitab")}</FooterLink>
          <Divider />
          <FooterLink href="/about">{t("organization")}</FooterLink>
          <FooterLink href="/contact">{t("contact")}</FooterLink>
          <FooterLink href="/privacy">{t("privacy")}</FooterLink>
          <FooterLink href="/terms">{t("terms")}</FooterLink>
          <Divider />
          <a
            href={sectionLink("#donate")}
            className="font-semibold text-emerald-400 transition hover:text-emerald-300"
          >
            {tNav("donate")}
          </a>
        </nav>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-center px-4 py-3 text-xs text-slate-400 sm:px-6">
          <span>© {new Date().getFullYear()} Sukses & Berkah Group</span>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-white/80 transition hover:text-white"
    >
      {children}
    </Link>
  );
}

function Divider() {
  return <span aria-hidden className="text-slate-600">·</span>;
}
