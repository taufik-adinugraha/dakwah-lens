import { setRequestLocale } from "next-intl/server";

// Force dynamic rendering for every page under /admin/system/*.
//
// Without this, Next.js 16's static-generation step tries to
// pre-render these pages at build time and times out (60s × 3
// retries) on DB queries that have no DB available during build.
// All admin pages need live auth + live DB anyway, so static
// generation is the wrong default.
//
// Safe here: the admin/system layout does NOT export
// `generateStaticParams` (unlike the locale layout one level up),
// so there's no conflict with that opt-in.
export const dynamic = "force-dynamic";
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardList,
  Cpu,
  DollarSign,
  HandHeart,
  Hash,
  Inbox,
  LayoutDashboard,
  Newspaper,
  Settings,
  ShieldCheck,
  Wallet,
  Workflow,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { requireSystemAccess } from "@/lib/superadmin";
import {
  countPendingFollowups,
  ensureTermsFollowups,
} from "@/lib/terms-followups";

const NAV = [
  { href: "/admin/system", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/system/inbox", label: "Inbox", icon: Inbox },
  { href: "/admin/system/followups", label: "Follow-ups", icon: Bell },
  { href: "/admin/system/audit", label: "Audit log", icon: ClipboardList },
  { href: "/admin/system/infra", label: "Infrastructure", icon: Cpu },
  { href: "/admin/system/analytics", label: "Web analytics", icon: BarChart3 },
  { href: "/admin/system/api-costs", label: "API costs", icon: DollarSign },
  { href: "/admin/system/pipeline", label: "Pipeline health", icon: Workflow },
  { href: "/admin/system/rss", label: "RSS feeds", icon: Newspaper },
  { href: "/admin/system/queries", label: "Ingest queries", icon: Hash },
  { href: "/admin/system/scrapers", label: "Scrapers setup", icon: Settings },
  { href: "/admin/system/donations", label: "Donations", icon: HandHeart },
  { href: "/admin/system/costs", label: "Total cost", icon: Wallet },
] as const;

export default async function SystemAdminLayout({
  children,
  params,
}: LayoutProps<"/[locale]/admin/system">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireSystemAccess();
  const isSuperadmin = session.user?.role === "superadmin";
  // Detect terms-version drift first (idempotent insert), then count
  // pending follow-ups for the nav badge. Admins land here too, but
  // most pages are read-only for them — Inbox + Donations are the
  // exceptions where they have full write access.
  await ensureTermsFollowups();
  const pendingCount = await countPendingFollowups();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {isSuperadmin ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              Superadmin
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin · read-only
            </span>
          )}
          <h1 className="mt-2 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            System dashboard
          </h1>
          <p className="mt-1 max-w-2xl text-pretty text-sm text-slate-600">
            {isSuperadmin
              ? "Observability + configuration for the Dakwah-Lens stack. Every section here writes to or reads from the same database that powers the user-facing app."
              : "Read-only access to observability + configuration. You can act on Inbox messages and record Donations — other sections show data but hide controls."}
          </p>
        </div>
        <Link
          href="/admin/users"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Activity className="h-3.5 w-3.5" />
          User management
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const showBadge =
              item.href === "/admin/system/followups" && pendingCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                <Icon className="h-4 w-4 text-slate-500" />
                <span className="flex-1">{item.label}</span>
                {showBadge && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">
                    {pendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </div>
  );
}
