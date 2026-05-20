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

// Force dynamic rendering on every request — the layout reads auth state
// (PendingApprovalBanner) which must reflect the live JWT, not a cached
// snapshot. Without this, a user who got their `status` flipped from
// `pending` → `approved` in the DB would keep seeing the pending banner
// because Next.js was serving a cached fragment.
export const dynamic = "force-dynamic";

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
