import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { marketingSectionLink } from "@/lib/marketing-href";
import { I18nText } from "./I18nText";

/**
 * Site footer — redesigned 2026-07 alongside the landing ("serene
 * spiritual minimalism"): deep warm-ink ground (not blue-slate), the
 * REAL brand logo (same asset as the header, on a small paper chip so
 * it stays legible on dark), one quiet nav grid shared by all
 * breakpoints, and a soft-green donate accent. Replaces the old
 * CSS-drawn gradient-square Logo and the duplicated mobile/desktop
 * nav layouts.
 */
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
    <footer className="relative mt-16 bg-[#161511] font-body text-white">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr] md:gap-8">
          {/* Brand block */}
          <div>
            <span className="inline-flex items-center rounded-xl bg-paper px-3 py-2">
              <Image
                src="/dakwah-lens-logo-long-removebg.png"
                alt="Dakwah-Lens"
                width={132}
                height={36}
                className="h-8 w-auto"
              />
            </span>
            <I18nText
              text={t("tagline")}
              className="mt-4 block max-w-xs text-pretty text-sm leading-relaxed text-white/55"
            />
          </div>

          {/* Product */}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
              {t("section_product")}
            </p>
            <div className="mt-4 flex flex-col gap-2.5 text-sm">
              <a
                href={sectionLink("#insights")}
                className="w-fit text-white/75 transition hover:text-white"
              >
                {tNav("insights")}
              </a>
              <a
                href={sectionLink("#how-it-works")}
                className="w-fit text-white/75 transition hover:text-white"
              >
                {tNav("how_it_works")}
              </a>
              <FooterLink href="/kitab">{tNav("kitab")}</FooterLink>
              <a
                href={sectionLink("#donate")}
                className="w-fit font-semibold text-emerald-300 transition hover:text-emerald-200"
              >
                {tNav("donate")}
              </a>
            </div>
          </div>

          {/* Info */}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
              {t("section_info")}
            </p>
            <div className="mt-4 flex flex-col gap-2.5 text-sm">
              <FooterLink href="/about">{t("organization")}</FooterLink>
              <FooterLink href="/contact">{t("contact")}</FooterLink>
              <FooterLink href="/privacy">{t("privacy")}</FooterLink>
              <FooterLink href="/terms">{t("terms")}</FooterLink>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 text-xs text-white/40">
          <span>© {new Date().getFullYear()} Sukses & Berkah Group</span>
          <span className="font-display text-white/50">Dakwah-Lens</span>
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
    <Link href={href} className="w-fit text-white/75 transition hover:text-white">
      {children}
    </Link>
  );
}
