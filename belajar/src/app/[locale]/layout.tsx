import type { Metadata } from "next";
import { Amiri, Fraunces, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";

import { AccountChip } from "@/components/AccountChip";
import { FooterDisclaimer } from "@/components/FooterDisclaimer";
import { TextSizeSwitch } from "@/components/TextSizeSwitch";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { IS_PUBLIC } from "@/lib/flags";
import { conceptIndexHref, creditsHref, hubHref } from "@/lib/routes";

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

/**
 * Applies the learner's text size ("Ukuran huruf") and hides the one-time
 * Home hint before first paint, so statically rendered pages never flash at
 * the wrong size. Keys and values must match src/hooks/useTextSize.ts.
 */
const PRE_PAINT = `(function(){try{var d=document.documentElement,s=localStorage.getItem("belajar:v1:text-size");if(s==="besar"||s==="sangat-besar")d.dataset.textSize=s;if(s||localStorage.getItem("belajar:v1:text-size-hint"))d.dataset.textHint="off"}catch(e){}})();`;

/**
 * Ilmu Waris namespaces (messages/waris/*.json, merged in i18n/request.ts). Kept out of the
 * module-wide client provider: about 60 KB that no other page reads. The calculator and the
 * report pages wrap their client trees in their own provider with exactly what those trees read;
 * "Track" is read on the server only.
 */
const WARIS_NAMESPACES: ReadonlySet<string> = new Set(["Q", "Exit", "Report", "Track"]);

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
  const tw = await getTranslations("Track");
  const all = await getMessages();
  const clientMessages = Object.fromEntries(Object.entries(all).filter(([ns]) => !WARIS_NAMESPACES.has(ns)));

  // suppressHydrationWarning: the pre-paint script sets data-text-size /
  // data-text-hint on <html> before React hydrates.
  return (
    <html
      lang={locale}
      className={`${amiri.variable} ${fraunces.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} />
      </head>
      <body className="min-h-dvh bg-paper font-body text-ink">
        <NextIntlClientProvider messages={clientMessages}>
          <a
            href="#isi"
            className="sr-only rounded-full bg-forest px-5 py-3 text-base font-semibold text-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
          >
            {t("skip_to_content")}
          </a>
          {/* Sticky only on wide screens: on phones and tablets the header
              wraps to several rows at large text sizes, and a sticky header
              would then cover a large part of the reading area. Positioned at
              every width because the text-size panel hangs under it. */}
          <header className="relative z-30 border-b border-hairline bg-paper/95 backdrop-blur-md lg:sticky lg:top-0">
            <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  href={hubHref()}
                  className="inline-flex min-h-11 items-center font-display text-lg font-medium text-ink"
                >
                  {t("name")}
                </Link>
                <span className="rounded-full bg-forest-tint px-3 py-0.5 text-sm font-semibold text-forest">
                  {t("beta")}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link
                  href={conceptIndexHref()}
                  className="inline-flex min-h-11 items-center rounded-full px-3 font-medium text-ink-muted transition-colors hover:bg-paper-deep hover:text-ink"
                >
                  {t("nav_concepts")}
                </Link>
                {/* Cross-app link: plain <a>, never next-intl Link (it would
                    prefix /belajar and soft-navigate across apps). Visible
                    at every width; the long label only where it fits. */}
                <a
                  href={`/${locale}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-medium text-ink-muted transition-colors hover:bg-paper-deep hover:text-ink"
                >
                  <ArrowLeft className="h-5 w-5" aria-hidden />
                  <span className="hidden xl:inline">{t("back_to_main")}</span>
                  <span className="xl:hidden">Dakwah-Lens</span>
                </a>
                <TextSizeSwitch />
                <AccountChip locale={locale} />
              </div>
            </div>
          </header>

          <main id="isi">{children}</main>

          <footer className="mt-16 border-t border-hairline">
            <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              {/* Mandatory label (AGENTS.md): always visible, never collapsed. The waris track
                  has no human review, so it gets its own label (FooterDisclaimer). */}
              <p className="max-w-prose text-pretty text-base text-ink-muted">
                <FooterDisclaimer module={tf(IS_PUBLIC ? "disclaimer" : "disclaimer_beta")} waris={tw("footer_disclaimer")} />
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-base">
                <Link href={creditsHref()} className="link-text inline-flex min-h-11 items-center">
                  {tf("credits")}
                </Link>
                <a href={`/${locale}`} className="link-text inline-flex min-h-11 items-center">
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
