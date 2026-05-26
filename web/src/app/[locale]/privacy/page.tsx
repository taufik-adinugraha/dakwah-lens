import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  Baby,
  Cookie,
  Database,
  Eye,
  EyeOff,
  Globe2,
  Lock,
  RefreshCw,
  Server,
  UserCheck,
} from "lucide-react";

import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/privacy">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Privacy" });
  return { title: t("page_title") };
}

export default async function PrivacyPage({
  params,
}: PageProps<"/[locale]/privacy">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Privacy");

  return (
    <>
      <Hero t={t} />
      <Preamble t={t} />
      <SectionList t={t} />
      <Closing t={t} />
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Privacy">>>;

function Hero({ t }: { t: T }) {
  return (
    <section className="relative isolate overflow-hidden pt-12 pb-8 sm:pt-16 sm:pb-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-brand-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm backdrop-blur">
          <Lock className="h-3.5 w-3.5" />
          {t("badge")}
        </span>
        <h1 className="mt-4 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
          {t("hero_title")}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
          {t("hero_subtitle")}
        </p>
        <p className="mt-4 text-xs uppercase tracking-wider text-slate-400">
          {t("hero_last_updated")}
        </p>
      </div>
    </section>
  );
}

function Preamble({ t }: { t: T }) {
  return (
    <section className="py-10 sm:py-14">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="rounded-2xl border border-brand-100 bg-brand-50/40 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
            <div className="space-y-3 text-pretty text-[15px] leading-relaxed text-slate-700">
              <p className="font-semibold text-slate-900">
                {t("preamble_lede")}
              </p>
              <p>{t("preamble_p1")}</p>
              <p>{t("preamble_p2")}</p>
              <p>
                {t.rich("preamble_p3", {
                  terms: (chunks) => (
                    <Link
                      href="/terms"
                      className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionList({ t }: { t: T }) {
  const sections = [
    {
      icon: Database,
      tone: "emerald" as const,
      title: t("s1_title"),
      body: (
        <div className="space-y-3">
          <p>{t("s1_p1")}</p>
          <ul className="ml-4 list-disc space-y-1.5 marker:text-emerald-500">
            <li>{t("s1_item_1")}</li>
            <li>{t("s1_item_2")}</li>
            <li>{t("s1_item_3")}</li>
            <li>{t("s1_item_4")}</li>
            <li>{t("s1_item_5")}</li>
            <li>{t("s1_item_6")}</li>
          </ul>
        </div>
      ),
    },
    {
      icon: EyeOff,
      tone: "rose" as const,
      title: t("s2_title"),
      body: (
        <div className="space-y-3">
          <p>{t("s2_p1")}</p>
          <ul className="ml-4 list-disc space-y-1.5 marker:text-rose-500">
            <li>{t("s2_item_1")}</li>
            <li>{t("s2_item_2")}</li>
            <li>{t("s2_item_3")}</li>
            <li>{t("s2_item_4")}</li>
          </ul>
        </div>
      ),
    },
    {
      icon: Cookie,
      tone: "amber" as const,
      title: t("s3_title"),
      body: (
        <div className="space-y-3">
          <p>{t("s3_p1")}</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="font-semibold text-slate-900">
              {t("s3_cookie_1_name")}
            </p>
            <p className="mt-1 text-slate-600">{t("s3_cookie_1_purpose")}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="font-semibold text-slate-900">
              {t("s3_cookie_2_name")}
            </p>
            <p className="mt-1 text-slate-600">{t("s3_cookie_2_purpose")}</p>
          </div>
          <p className="text-xs text-slate-500">{t("s3_footer")}</p>
        </div>
      ),
    },
    {
      icon: Server,
      tone: "brand" as const,
      title: t("s4_title"),
      body: (
        <div className="space-y-3">
          <p>{t("s4_p1")}</p>
          <ul className="ml-4 list-disc space-y-1.5 marker:text-brand-500">
            <li>
              <strong>{t("s4_p_openai_label")}</strong>{" "}
              — {t("s4_p_openai_body")}
            </li>
            <li>
              <strong>{t("s4_p_gemini_label")}</strong>{" "}
              — {t("s4_p_gemini_body")}
            </li>
            <li>
              <strong>{t("s4_p_anthropic_label")}</strong>{" "}
              — {t("s4_p_anthropic_body")}
            </li>
            <li>
              <strong>{t("s4_p_resend_label")}</strong>{" "}
              — {t("s4_p_resend_body")}
            </li>
            <li>
              <strong>{t("s4_p_google_label")}</strong>{" "}
              — {t("s4_p_google_body")}
            </li>
            <li>
              <strong>{t("s4_p_apify_label")}</strong>{" "}
              — {t("s4_p_apify_body")}
            </li>
            <li>
              <strong>{t("s4_p_youtube_label")}</strong>{" "}
              — {t("s4_p_youtube_body")}
            </li>
          </ul>
          <p className="text-xs text-slate-500">{t("s4_footer")}</p>
        </div>
      ),
    },
    {
      icon: Globe2,
      tone: "emerald" as const,
      title: t("s5_title"),
      body: (
        <div className="space-y-3">
          <p>{t("s5_p1")}</p>
          <p>{t("s5_p2")}</p>
        </div>
      ),
    },
    {
      icon: UserCheck,
      tone: "brand" as const,
      title: t("s6_title"),
      body: (
        <div className="space-y-3">
          <p>{t("s6_p1")}</p>
          <ul className="ml-4 list-disc space-y-1.5 marker:text-brand-500">
            <li>{t("s6_item_1")}</li>
            <li>{t("s6_item_2")}</li>
            <li>{t("s6_item_3")}</li>
            <li>{t("s6_item_4")}</li>
            <li>{t("s6_item_5")}</li>
          </ul>
          <p>
            {t.rich("s6_p2", {
              about: (chunks) => (
                <Link
                  href="/about"
                  className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      ),
    },
    {
      icon: RefreshCw,
      tone: "slate" as const,
      title: t("s7_title"),
      body: (
        <div className="space-y-3">
          <p>{t("s7_p1")}</p>
          <ul className="ml-4 list-disc space-y-1.5 marker:text-slate-500">
            <li>{t("s7_item_1")}</li>
            <li>{t("s7_item_2")}</li>
            <li>{t("s7_item_3")}</li>
            <li>{t("s7_item_4")}</li>
          </ul>
        </div>
      ),
    },
    {
      icon: Baby,
      tone: "amber" as const,
      title: t("s8_title"),
      body: <p>{t("s8_body")}</p>,
    },
    {
      icon: Eye,
      tone: "brand" as const,
      title: t("s9_title"),
      body: (
        <p>
          {t.rich("s9_body", {
            terms: (chunks) => (
              <Link
                href="/terms"
                className="font-semibold text-brand-700 underline-offset-2 hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      ),
    },
  ];

  return (
    <section className="py-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-6">
        {sections.map((s, i) => (
          <SectionCard key={i} index={i + 1} {...s} />
        ))}
      </div>
    </section>
  );
}

function SectionCard({
  index,
  icon: Icon,
  tone,
  title,
  body,
}: {
  index: number;
  icon: typeof Database;
  tone: "emerald" | "rose" | "brand" | "amber" | "slate";
  title: string;
  body: React.ReactNode;
}) {
  const palette = TONE_STYLES[tone];
  return (
    <article className="grid gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-[auto_1fr] sm:gap-7 sm:p-8">
      <div className="flex sm:flex-col sm:items-center sm:gap-2">
        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${palette.bg}`}
        >
          <Icon className={`h-5 w-5 ${palette.icon}`} />
        </span>
        <span className="ml-3 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:ml-0">
          §{index}
        </span>
      </div>
      <div className="min-w-0">
        <h2 className="text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
          {title}
        </h2>
        <div className="mt-3 space-y-3 text-pretty text-[15px] leading-relaxed text-slate-700">
          {body}
        </div>
      </div>
    </article>
  );
}

const TONE_STYLES = {
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-700" },
  rose: { bg: "bg-rose-50", icon: "text-rose-700" },
  brand: { bg: "bg-brand-50", icon: "text-brand-700" },
  amber: { bg: "bg-amber-50", icon: "text-amber-700" },
  slate: { bg: "bg-slate-100", icon: "text-slate-700" },
} as const;

function Closing({ t }: { t: T }) {
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-brand-50/30 p-8 text-center shadow-sm">
          <p className="font-amiri text-2xl text-slate-900">
            {t("closing_arabic")}
          </p>
          <p className="mt-2 text-sm italic text-slate-600">
            {t("closing_translation")}
          </p>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-sm leading-relaxed text-slate-600">
            {t("closing_body")}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/terms"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-900 px-5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              {t("closing_cta_terms")}
            </Link>
            <Link
              href="/"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("closing_cta_home")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
