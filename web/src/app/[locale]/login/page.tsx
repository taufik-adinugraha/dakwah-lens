import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { LoginForm } from "@/components/LoginForm";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/login">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("page_title_signin") };
}

export default async function LoginPage({
  params,
  searchParams,
}: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations("Auth");
  const initialMode = sp.mode === "signup" ? "signup" : "signin";

  return (
    <section className="relative isolate flex flex-1 items-center justify-center overflow-hidden py-12 sm:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-50" />
        <div className="absolute top-1/3 left-1/2 h-[460px] w-[460px] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-200 via-cyan-200 to-emerald-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-md px-4 sm:px-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("back_home")}
          </Link>
          <Logo showWordmark={false} />
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <Suspense fallback={<div className="h-72 animate-pulse rounded-lg bg-slate-100" />}>
            <LoginForm
              initialMode={initialMode}
              googleEnabled={
                !!process.env.GOOGLE_CLIENT_ID &&
                !!process.env.GOOGLE_CLIENT_SECRET
              }
            />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
