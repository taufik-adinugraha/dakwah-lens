import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { Link } from "@/i18n/navigation";
import { getQuotaSnapshot } from "@/lib/user-flyer/quota";

import { FlyerGrid } from "../FlyerGrid";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/flyers/mine">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "UserFlyers" });
  return { title: t("page_title_mine") };
}

export default async function MyFlyersPage({
  params,
}: PageProps<"/[locale]/flyers/mine">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/flyers/mine");
  }

  const t = await getTranslations("UserFlyers");

  const [rows, quota] = await Promise.all([
    db
      .select({
        id: schema.userFlyers.id,
        headline: schema.userFlyers.headline,
        visibility: schema.userFlyers.visibility,
        createdAt: schema.userFlyers.createdAt,
      })
      .from(schema.userFlyers)
      .where(eq(schema.userFlyers.userId, session.user.id))
      .orderBy(desc(schema.userFlyers.createdAt))
      .limit(100),
    getQuotaSnapshot(session.user.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-balance text-2xl font-bold text-slate-900 sm:text-3xl">
            {t("page_title_mine")}
          </h1>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
            {t("subtitle_mine")}
          </p>
        </div>
        <Link
          href="/flyers/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          <Sparkles className="h-4 w-4" />
          {t("cta_new_flyer")}
        </Link>
      </header>

      <p className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        <Sparkles className="h-3 w-3" />
        {t("quota_chip", {
          remaining: quota.remaining,
          limit: quota.limit,
        })}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {t("empty_mine_title")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {t("empty_mine_body")}
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
          showDelete
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
