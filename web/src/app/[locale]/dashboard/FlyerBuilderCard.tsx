import { ArrowRight, Globe, Images, Sparkles } from "lucide-react";

import { Link } from "@/i18n/navigation";
import type { QuotaSnapshot } from "@/lib/user-flyer/quota";

/**
 * Dashboard section that surfaces the /flyers/new builder.
 *
 * Sits inside the Dakwah Kit tab next to the briefing deliverables —
 * "build your own flyer" is the same kind of content-creation tool as
 * the briefing-driven flyers/posters, just user-driven instead of
 * pipeline-driven. Quota chip is computed server-side so the card
 * always reflects the user's current week balance.
 */
export function FlyerBuilderCard({
  quota,
  labels,
}: {
  quota: QuotaSnapshot;
  labels: {
    title: string;
    subtitle: string;
    cta: string;
    mine: string;
    public: string;
    quotaTpl: string;
  };
}) {
  const quotaText = labels.quotaTpl
    .replace("{remaining}", String(quota.remaining))
    .replace("{limit}", String(quota.limit));

  return (
    <section className="rounded-2xl border border-fuchsia-200/70 bg-gradient-to-br from-fuchsia-50 via-white to-violet-50 p-5 shadow-sm ring-1 ring-fuchsia-200/40 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-200 bg-white/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fuchsia-700 backdrop-blur">
            <Sparkles className="h-3 w-3" />
            {labels.title}
          </span>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-700 sm:text-base">
            {labels.subtitle}
          </p>
          <p className="mt-2 text-xs font-medium text-fuchsia-700">
            {quotaText}
          </p>
        </div>
        <Link
          href="/flyers/new"
          className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-full bg-fuchsia-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-fuchsia-800 sm:w-auto sm:py-2"
        >
          <Sparkles className="h-4 w-4" />
          {labels.cta}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/flyers/mine"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          <Images className="h-3 w-3" />
          {labels.mine}
        </Link>
        <Link
          href="/flyers/public"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          <Globe className="h-3 w-3" />
          {labels.public}
        </Link>
      </div>
    </section>
  );
}
