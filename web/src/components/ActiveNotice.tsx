import { and, desc, gte, lte } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";

/**
 * Site-wide banner. Reads the most recent active notice from
 * `app_notices` and renders it between Header and main in the root
 * layout. Renders nothing when no notice is active — the layout's
 * existing margins stay correct.
 *
 * Server component: cached as part of the layout render, revalidated
 * when an action calls `revalidatePath("/", "layout")`.
 */
export async function ActiveNotice({ locale }: { locale: string }) {
  const now = new Date();
  const [notice] = await db
    .select()
    .from(schema.appNotices)
    .where(
      and(
        lte(schema.appNotices.startsAt, now),
        gte(schema.appNotices.endsAt, now),
      ),
    )
    .orderBy(desc(schema.appNotices.createdAt))
    .limit(1);

  if (!notice) return null;

  const message = locale === "id" ? notice.messageId : notice.messageEn;
  const Icon =
    notice.severity === "warning"
      ? AlertTriangle
      : notice.severity === "success"
        ? CheckCircle2
        : Info;
  const tone =
    notice.severity === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : notice.severity === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-brand-200 bg-brand-50 text-brand-900";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`relative z-20 border-b ${tone} print:hidden`}
    >
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3 sm:px-6">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="flex-1 text-pretty text-sm leading-relaxed">
          {message}
          {notice.kind === "terms_update" && (
            <>
              {" "}
              <Link
                href="/terms"
                className="font-semibold underline decoration-current/40 underline-offset-2 hover:decoration-current"
              >
                /terms
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
