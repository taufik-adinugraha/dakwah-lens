import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, desc, eq } from "drizzle-orm";
import { BookmarkCheck, ExternalLink } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { CitationShare } from "@/components/CitationShare";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Saved" });
  return { title: t("page_title") };
}

export default async function SavedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/saved");

  const t = await getTranslations({ locale, namespace: "Saved" });
  const tInsights = await getTranslations({ locale, namespace: "Insights" });

  const kindFilter =
    typeof sp.kind === "string" && ["kitab", "brief", "post"].includes(sp.kind)
      ? sp.kind
      : null;

  const rows = await db
    .select()
    .from(schema.bookmarks)
    .where(
      kindFilter
        ? and(
            eq(schema.bookmarks.userId, session.user.id),
            eq(schema.bookmarks.kind, kindFilter),
          )
        : eq(schema.bookmarks.userId, session.user.id),
    )
    .orderBy(desc(schema.bookmarks.createdAt))
    .limit(200);

  const counts = await getKindCounts(session.user.id);

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm leading-relaxed text-slate-600">
          {t("subtitle")}
        </p>

        {/* Kind filter chips */}
        <div className="mt-6 flex flex-wrap gap-2">
          <KindChip
            href="/saved"
            label={t("kind_all")}
            count={counts.kitab + counts.brief + counts.post}
            active={!kindFilter}
          />
          <KindChip
            href="/saved?kind=kitab"
            label={t("kind_kitab")}
            count={counts.kitab}
            active={kindFilter === "kitab"}
          />
          <KindChip
            href="/saved?kind=brief"
            label={t("kind_brief")}
            count={counts.brief}
            active={kindFilter === "brief"}
          />
          <KindChip
            href="/saved?kind=post"
            label={t("kind_post")}
            count={counts.post}
            active={kindFilter === "post"}
          />
        </div>

        {rows.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center text-sm text-slate-500">
            {t("empty")}
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {rows.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                {r.kind === "kitab" && (
                  <KitabSaveCard
                    payload={r.payload as Record<string, string>}
                    createdAt={r.createdAt}
                    locale={locale}
                  />
                )}
                {r.kind === "brief" && (
                  <BriefSaveCard
                    refId={r.refId}
                    payload={r.payload as Record<string, string>}
                    createdAt={r.createdAt}
                    locale={locale}
                    label={tInsights("posts_open_source")}
                  />
                )}
                {r.kind === "post" && (
                  <PostSaveCard
                    payload={r.payload as Record<string, string | null>}
                    createdAt={r.createdAt}
                    locale={locale}
                    label={tInsights("posts_open_source")}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

async function getKindCounts(
  userId: string,
): Promise<{ kitab: number; brief: number; post: number }> {
  const all = await db
    .select({ kind: schema.bookmarks.kind })
    .from(schema.bookmarks)
    .where(eq(schema.bookmarks.userId, userId));
  const c = { kitab: 0, brief: 0, post: 0 };
  for (const r of all) {
    if (r.kind in c) (c as Record<string, number>)[r.kind] += 1;
  }
  return c;
}

function KindChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
        active
          ? "bg-amber-100 text-amber-900 ring-amber-200 shadow-sm"
          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
      <span className="tabular-nums text-slate-500">{count}</span>
    </Link>
  );
}

function KitabSaveCard({
  payload,
  createdAt,
  locale,
}: {
  payload: Record<string, string>;
  createdAt: Date;
  locale: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase tracking-wider text-slate-700">
          <BookmarkCheck className="h-3 w-3" /> {payload.corpus}
        </span>
        <span className="font-mono">{payload.citation}</span>
        <span className="text-slate-400">
          {new Date(createdAt).toLocaleDateString(locale, {
            timeZone: "Asia/Jakarta",
          })}
        </span>
      </div>
      {payload.arabic && (
        <p
          className="mt-3 text-right font-amiri text-lg leading-relaxed text-slate-900"
          dir="rtl"
        >
          {payload.arabic}
        </p>
      )}
      {payload.translation && (
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          {payload.translation}
        </p>
      )}
      <CitationShare
        arabic={payload.arabic ?? ""}
        translation={payload.translation ?? ""}
        citation={payload.citation ?? ""}
      />
    </>
  );
}

function BriefSaveCard({
  refId,
  payload,
  createdAt,
  locale,
  label,
}: {
  refId: string;
  payload: Record<string, string>;
  createdAt: Date;
  locale: string;
  label: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 font-semibold uppercase tracking-wider text-brand-700">
          <BookmarkCheck className="h-3 w-3" /> brief
        </span>
        <span className="text-slate-400">
          {new Date(createdAt).toLocaleDateString(locale, {
            timeZone: "Asia/Jakarta",
          })}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-900">
        {payload.topic_title}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">
        {payload.segment} · {payload.tone}
      </p>
      <Link
        href={`/briefs/${refId}`}
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline"
      >
        {label} <ExternalLink className="h-3 w-3" />
      </Link>
    </>
  );
}

function PostSaveCard({
  payload,
  createdAt,
  locale,
  label,
}: {
  payload: Record<string, string | null>;
  createdAt: Date;
  locale: string;
  label: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-50 px-2 py-0.5 font-semibold uppercase tracking-wider text-cyan-700">
          <BookmarkCheck className="h-3 w-3" /> {payload.platform}
        </span>
        {payload.author && (
          <span className="font-medium">@{payload.author}</span>
        )}
        <span className="text-slate-400">
          {new Date(createdAt).toLocaleDateString(locale, {
            timeZone: "Asia/Jakarta",
          })}
        </span>
      </div>
      {payload.text && (
        <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-800">
          {payload.text.slice(0, 360)}
          {payload.text.length > 360 ? "…" : ""}
        </p>
      )}
      {payload.url && (
        <a
          href={payload.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline"
        >
          {label} <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </>
  );
}
