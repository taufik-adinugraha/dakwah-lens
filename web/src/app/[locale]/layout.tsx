import type { Metadata } from "next";
import { Geist, Geist_Mono, Amiri } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { ActiveNotice } from "@/components/ActiveNotice";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { PageTracker } from "@/components/PageTracker";
import { PendingApprovalBanner } from "@/components/PendingApprovalBanner";
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
          <main className="flex flex-col">{children}</main>
          <Footer />
          <PageTracker locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
