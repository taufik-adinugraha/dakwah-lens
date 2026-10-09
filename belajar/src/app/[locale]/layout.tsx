import type { Metadata } from "next";
import { Amiri, Fraunces, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AccountChip } from "@/components/AccountChip";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { IS_PUBLIC } from "@/lib/flags";

import "../globals.css";

const amiri = Amiri({
  variable: "--font-amiri",
  weight: ["400", "700"],
  subsets: ["arabic"],
  display: "swap",
});
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "App" });
  return {
    metadataBase: new URL("https://dakwah-lens.id"),
    title: { default: t("name"), template: t("title_template") },
    description: t("description"),
    robots: IS_PUBLIC ? undefined : { index: false, follow: true },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("App");
  const tf = await getTranslations("Footer");

  return (
    <html
      lang={locale}
      className={`${amiri.variable} ${fraunces.variable} ${inter.variable}`}
    >
      <body className="min-h-dvh bg-paper font-body text-ink">
        <NextIntlClientProvider>
          <header className="sticky top-0 z-30 border-b border-hairline bg-paper/90 backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  href="/"
                  className="truncate font-display text-lg font-medium text-ink"
                >
                  {t("name")}
                </Link>
                <span className="rounded-full bg-forest-tint px-2 py-0.5 text-[11px] font-semibold text-forest">
                  {t("beta")}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm">
                <Link href="/konsep" className="text-ink-muted transition hover:text-ink">
                  {t("nav_concepts")}
                </Link>
                {/* Cross-app link: plain <a>, never next-intl Link (it would
                    prefix /belajar and soft-navigate across apps). */}
                <a
                  href={`/${locale}`}
                  className="hidden text-ink-muted transition hover:text-ink sm:inline"
                >
                  {t("back_to_main")}
                </a>
                <AccountChip locale={locale} />
              </div>
            </div>
          </header>

          <main>{children}</main>

          <footer className="mt-16 border-t border-hairline">
            <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="max-w-xl text-pretty">{tf("disclaimer")}</p>
              <div className="flex gap-4">
                <Link href="/kredit" className="hover:text-ink">
                  {tf("credits")}
                </Link>
                <a href={`/${locale}`} className="hover:text-ink">
                  Dakwah-Lens
                </a>
              </div>
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
