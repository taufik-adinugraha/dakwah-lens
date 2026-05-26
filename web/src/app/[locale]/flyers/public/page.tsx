import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Sparkles } from "lucide-react";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { Link } from "@/i18n/navigation";

import { FlyerGrid } from "../FlyerGrid";

// 60s revalidation — gallery is anon-readable, gets traffic, and the
// underlying data only changes when users publish new flyers. 1-min
// cache keeps the page snappy without serving very stale state.
export const revalidate = 60;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/flyers/public">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "UserFlyers" });
  return { title: t("page_title_public") };
}

export default async function PublicFlyersPage({
  params,
}: PageProps<"/[locale]/flyers/public">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("UserFlyers");
  const session = await auth();

  const rows = await db
    .select({
      id: schema.userFlyers.id,
      headline: schema.userFlyers.headline,
      visibility: schema.userFlyers.visibility,
      createdAt: schema.userFlyers.createdAt,
    })
    .from(schema.userFlyers)
    .where(eq(schema.userFlyers.visibility, "public"))
    .orderBy(desc(schema.userFlyers.createdAt))
    .limit(60);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-balance text-2xl font-bold text-slate-900 sm:text-3xl">
            {t("page_title_public")}
          </h1>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
            {t("subtitle_public")}
          </p>
        </div>
        {session?.user?.id && (
          <Link
            href="/flyers/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
          >
            <Sparkles className="h-4 w-4" />
            {t("cta_new_flyer")}
          </Link>
        )}
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {t("empty_public_title")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t("empty_public_body")}
          </p>
        </div>
      ) : (
        <FlyerGrid
          flyers={rows.map((r) => ({
            id: r.id,
            headline: r.headline,
            visibility: r.visibility as "private" | "public",
            createdAt: r.createdAt.toISOString(),
          }))}
          labels={{
            visibilityBadgePublic: t("visibility_badge_public"),
            visibilityBadgePrivate: t("visibility_badge_private"),
            deleteButton: t("delete_button"),
            deleteConfirm: t("delete_confirm"),
            openLarge: t("result_open_large"),
            download: t("result_download"),
          }}
        />
      )}
    </div>
  );
}
