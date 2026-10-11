import type { Metadata } from "next";
import { Amiri, Fraunces, Inter } from "next/font/google";
import Image from "next/image";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";

import { FooterDisclaimer } from "@/components/FooterDisclaimer";
import { HeaderControls } from "@/components/HeaderControls";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { IS_PUBLIC } from "@/lib/flags";
import { mainSiteHref } from "@/lib/mainSite";
import { creditsHref, hubHref } from "@/lib/routes";

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
  // Icons: src/app/favicon.ico and src/app/apple-icon.png (Next file convention, so the basePath
  // is in their links: /belajar/favicon.ico), byte copies of the main site's set
  // (web/public/favicon_io; web/src/app carries the same two files) — operator, 2026-10-10: the
  // module wears the Dakwah-Lens brand. Before them a tab showed the main favicon only through the
  // browser's /favicon.ico guess, and a phone's home screen got no icon. The main site's PWA
  // manifest is not linked: it describes the main app, not this module.
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
          {/* One quiet row (operator, 2026-10-10: "too many links and
              buttons on screen"): the brand, back to the hub; the "Aa" text
              size; ONE "Menu" holding the rest (HeaderControls). Sticky only
              on wide screens: on phones and tablets the row can wrap at
              large text sizes, and a sticky header would then cover a large
              part of the reading area. Positioned at every width because
              both panels hang under it.
              The brand is ONE mark, the Dakwah-Lens logo with the words
              "Dakwah-Lens" over "Belajar" (operator, 2026-10-10: "at least we
              should put logo there"), so the brand reads as words, not only
              as an icon. The logo's alt carries the name and the visible
              "Dakwah-Lens" is hidden from screen readers, so the link is read
              once: "Dakwah-Lens Belajar". On a phone (below about 440px) the
              mark and the two buttons do not fit one row at any text size:
              the buttons take a second row, at the right (HeaderControls),
              measured in CI (scripts/ci/screenshots.mjs headerShots). */}
          <header className="relative z-30 border-b border-hairline bg-paper/95 backdrop-blur-md lg:sticky lg:top-0">
            <div className="mx-auto flex min-h-16 max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
              <Link href={hubHref()} data-brand="" className="inline-flex min-h-12 shrink-0 items-center gap-2.5 text-ink">
                {/* 40px at the normal size, growing with the text size (rem);
                    next/image serves a 48px and a 96px rendition (crisp at
                    2x). The basePath is part of src (next.config.ts). */}
                <Image
                  src="/belajar/dakwah-lens-logo-short-removebg.png"
                  alt="Dakwah-Lens"
                  width={40}
                  height={40}
                  loading="eager"
                  className="h-10 w-10 shrink-0 object-contain"
                />
                <span className="flex flex-col">
                  <span aria-hidden className="whitespace-nowrap text-sm/tight font-semibold text-forest">
                    Dakwah-Lens
                  </span>
                  <span className="whitespace-nowrap font-display text-xl/tight font-medium">{t("name")}</span>
                </span>
              </Link>
              <HeaderControls locale={locale} />
            </div>
          </header>

          <main id="isi">{children}</main>

          <footer className="mt-16 border-t border-hairline">
            <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
              {/* Mandatory label (AGENTS.md): always visible, never collapsed. The waris track
                  has no human review, so it gets its own label (FooterDisclaimer). */}
              <p className="max-w-prose text-pretty text-base text-ink-muted">
                <FooterDisclaimer module={tf("disclaimer")} waris={tw("footer_disclaimer")} />
              </p>
              {/* Two links (operator, 2026-10-10: "too many links" — and then:
                  the module should bring people to dakwah-lens.id): "Bagian dari
                  Dakwah-Lens", to the main site's home in this locale (a plain
                  <a>: cross-app; UTM-tagged, lib/mainSite.ts), and Sumber &
                  lisensi, where licence credits are looked for, reachable
                  without opening a menu. The header's Menu keeps "Kembali ke
                  Dakwah-Lens" as well. Under the label until wide screens, so
                  the label never squeezes into a narrow column at large text
                  sizes. 48px targets. */}
              <div className="flex flex-wrap items-center gap-x-6 lg:shrink-0">
                <a
                  href={mainSiteHref(locale, "home", "footer")}
                  data-main-site="footer"
                  className="link-text inline-flex min-h-12 items-center whitespace-nowrap text-base"
                >
                  {tf("part_of")}
                </a>
                <Link href={creditsHref()} className="link-text inline-flex min-h-12 items-center text-base">
                  {tf("credits")}
                </Link>
              </div>
            </div>
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
