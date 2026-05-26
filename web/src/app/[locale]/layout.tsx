import type { Metadata } from "next";
import { Geist, Geist_Mono, Amiri } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { ActiveNotice } from "@/components/ActiveNotice";
import { BackToTop } from "@/components/BackToTop";
import { DeployOverlay } from "@/components/DeployOverlay";
import { FlashToast } from "@/components/FlashToast";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { PageTracker } from "@/components/PageTracker";
import { PendingApprovalBanner } from "@/components/PendingApprovalBanner";
import { popFlash } from "@/lib/flash";
import { readDeployStatus } from "@/lib/deploy-status";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const amiri = Amiri({
  variable: "--font-amiri",
  weight: ["400", "700"],
  subsets: ["arabic"],
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// No `export const dynamic = "force-dynamic"` here — it's incompatible
// with `generateStaticParams()` above (Next.js 16 throws on the
// contradiction, surfacing as a generic "server error" on any page
// using this layout). The layout is dynamic anyway because
// `PendingApprovalBanner` → `auth()` → `cookies()`, which auto-opts the
// route into dynamic rendering. The pending-banner staleness we saw
// earlier was likely just a browser cache; a hard refresh resolves it.

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "App" });
  return {
    title: { default: t("name"), template: `%s · ${t("name")}` },
    description: t("description"),
  };
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  // SSR-fetch the deploy status so the overlay paints immediately on
  // first paint during an in-progress deploy — no flash of usable UI
  // before the client picks it up. Failure here is non-fatal (renders
  // as idle).
  const deployStatus = await readDeployStatus().catch(() => null);

  // Pop the flash cookie set by the most recent server action (if any).
  // This is the one-shot read; the cookie gets cleared in the same
  // response so the toast only ever fires once.
  const flash = await popFlash();

  const tApp = await getTranslations({ locale, namespace: "App" });

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${amiri.variable} h-full antialiased`}
    >
      <body className="relative min-h-full bg-white text-slate-900">
        <NextIntlClientProvider>
          <PendingApprovalBanner />
          <Header />
          <ActiveNotice locale={locale} />
          {/* Plain block (NOT flex). When main was `flex flex-col`, page
              roots that use `mx-auto` (auto cross-axis margins) opted out
              of flex stretch and sized to their *content's max-content*
              — which on the dashboard ballooned the root to ~675px on a
              375px viewport, wrapping every line of text off the right
              edge. As a block, an `mx-auto` child fills the width (capped
              by its own max-w-*) and content wraps correctly.
              `overflow-x-clip` stays as a safety net against any single
              wide descendant (e.g. a markdown table). */}
          <main className="overflow-x-clip">{children}</main>
          <Footer />
          <BackToTop label={tApp("back_to_top")} />
          <PageTracker locale={locale} />
          <FlashToast initial={flash} />
          {deployStatus && <DeployOverlay initialStatus={deployStatus} />}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
