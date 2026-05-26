import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Sparkles } from "lucide-react";

import { auth } from "@/auth";
import { Link } from "@/i18n/navigation";
import { BriefForm } from "./BriefForm";
import { PlaceholderBanner } from "@/components/PlaceholderBadge";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/briefs/new">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Briefs" });
  return { title: t("page_title_new") };
}

export default async function NewBriefPage({
  params,
  searchParams,
}: PageProps<"/[locale]/briefs/new">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  // Proxy.ts already gates /briefs/* on auth — but be defensive in case it's
  // bypassed; redirect anonymous users to login.
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/briefs/new");
  }

  const t = await getTranslations("Briefs");

  // Pre-fill the topic field if the caller sent us one (e.g. the dashboard's
  // "Generate brief" buttons send `?topic=…`). Trim + length-cap defensively.
  const rawTopic = sp.topic;
  const defaultTopic =
    typeof rawTopic === "string" ? rawTopic.trim().slice(0, 200) : "";

  return (
    <section className="relative isolate flex flex-1 items-start justify-center overflow-hidden py-12 sm:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute -top-12 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-200 via-cyan-200 to-emerald-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("back_home")}
        </Link>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-700">
            <Sparkles className="h-3 w-3" />
            Experimental · Admin only
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            <Sparkles className="h-3.5 w-3.5" />
            Brief Builder
          </span>
          <h1 className="mt-4 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("wizard_title")}
          </h1>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
            {t("wizard_subtitle")}
          </p>

          <div className="mt-5">
            <PlaceholderBanner
              label={t("placeholder_label")}
              note={t("placeholder_note")}
            />
          </div>

          <div className="mt-6">
            <BriefForm
              defaultLocale={locale as "en" | "id"}
              defaultTopic={defaultTopic}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
