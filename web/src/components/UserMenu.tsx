"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  ScrollText,
  ShieldCheck,
  Sparkles,
  UserCircle2,
} from "lucide-react";
import clsx from "clsx";

import { Link } from "@/i18n/navigation";
import { signOutAction } from "@/app/auth-actions";

type Props = {
  email: string;
  name?: string | null;
  status: string;
  role: string;
};

export function UserMenu({ email, name, status, role }: Props) {
  const t = useTranslations("Nav");
  const tAuth = useTranslations("Auth");
  const tBriefs = useTranslations("Briefs");
  const tAdmin = useTranslations("Admin");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = (name ?? email)
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  const approved = status === "approved";
  const isAdmin = role === "admin" || role === "superadmin";
  const isSuperadmin = role === "superadmin";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 pl-1 pr-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 sm:pl-1.5 sm:pr-3"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-emerald-500 text-[10px] font-bold">
          {initials || <UserCircle2 className="h-4 w-4" />}
        </span>
        <span className="hidden max-w-[100px] truncate sm:inline">
          {name ?? email.split("@")[0]}
        </span>
        <ChevronDown
          className={clsx(
            "h-3 w-3 transition",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-900">
              {name ?? email.split("@")[0]}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <StatusPill status={status} />
              {role !== "user" && <RolePill role={role} />}
            </div>
          </div>

          <div className="p-1.5">
            {approved && (
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <LayoutDashboard className="h-4 w-4 text-brand-600" />
                Dashboard
              </Link>
            )}
            {/* Brief creation is admin-only while the feature is
                experimental — non-admin approved users can still
                reach /dashboard and /insights but won't see entry
                points to brief generation here. */}
            {isAdmin && (
              <>
                <Link
                  href="/briefs/new"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
                >
                  <Sparkles className="h-4 w-4 text-brand-600" />
                  {tBriefs("list_create")}
                </Link>
                <Link
                  href="/briefs"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
                >
                  <ScrollText className="h-4 w-4 text-brand-600" />
                  {tBriefs("nav_my_briefs")}
                </Link>
              </>
            )}
            {isAdmin && (
              <Link
                href="/admin/users"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <ShieldCheck className="h-4 w-4 text-brand-600" />
                {tAdmin("nav_admin")}
              </Link>
            )}
            {isAdmin && (
              <Link
                href="/admin/rooms"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <MessagesSquare className="h-4 w-4 text-brand-600" />
                Rooms
              </Link>
            )}
            {isSuperadmin && (
              <Link
                href="/admin/system"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <ShieldCheck className="h-4 w-4 text-rose-600" />
                System
              </Link>
            )}
            {!approved && (
              <Link
                href="/insights"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <Sparkles className="h-4 w-4 text-brand-600" />
                {tAuth("pending_button")}
              </Link>
            )}
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-600 transition hover:bg-rose-50"
              >
                <LogOut className="h-4 w-4" />
                {t("sign_out")}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : status === "pending"
        ? "bg-amber-50 text-amber-700 ring-amber-100"
        : "bg-rose-50 text-rose-700 ring-rose-100";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${tone}`}>
      {status}
    </span>
  );
}

function RolePill({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700 ring-1 ring-brand-100">
      {role}
    </span>
  );
}
