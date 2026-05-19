import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, asc, desc, inArray, isNotNull } from "drizzle-orm";
import { CheckCircle2, ShieldCheck, UserCircle2, XCircle } from "lucide-react";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import {
  approveUserAction,
  blockUserAction,
  demoteToUserAction,
  promoteToAdminAction,
  promoteToSuperadminAction,
  reinstateUserAction,
  rejectUserAction,
  removeUserAction,
} from "@/app/[locale]/admin/actions";
import { ConfirmFormButton } from "./ConfirmFormButton";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/users">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin" });
  return { title: t("page_title") };
}

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  status: string;
  role: string;
  createdAt: Date;
};

export default async function AdminUsersPage({
  params,
}: PageProps<"/[locale]/admin/users">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin/users");
  }
  const t = await getTranslations("Admin");

  // Gate at the page level too (proxy.ts gates auth but not role).
  const role = session.user.role;
  if (role !== "admin" && role !== "superadmin") {
    return <AccessDenied message={t("access_denied")} />;
  }

  // Only show users who've verified their email. Unverified accounts are
  // floating placeholders — they haven't proven they own the inbox, so we
  // hide them from this list. They appear here once they click the
  // verification link (which sets `email_verified`).
  const VERIFIED = isNotNull(schema.users.emailVerified);

  const pending = (await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      status: schema.users.status,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(and(VERIFIED, inArray(schema.users.status, ["pending"])))
    .orderBy(asc(schema.users.createdAt))) as UserRow[];

  const approved = (await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      status: schema.users.status,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(and(VERIFIED, inArray(schema.users.status, ["approved"])))
    .orderBy(desc(schema.users.createdAt))) as UserRow[];

  const inactive = (await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      status: schema.users.status,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(
      and(VERIFIED, inArray(schema.users.status, ["rejected", "blocked"])),
    )
    .orderBy(desc(schema.users.createdAt))) as UserRow[];

  const totalCount = pending.length + approved.length + inactive.length;
  const selfId = session.user.id;

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("badge")}
          </span>
          <h1 className="mt-3 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {t("title")}
          </h1>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
            {t("subtitle")}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label={t("stat_total")} value={String(totalCount)} />
          <Stat label={t("stat_pending")} value={String(pending.length)} accent="amber" />
          <Stat label={t("stat_approved")} value={String(approved.length)} accent="emerald" />
        </div>
      </div>

      <SectionBlock
        title={t("section_pending")}
        emptyMessage={t("empty_pending")}
        users={pending}
        actions="pending"
        t={t}
        locale={locale}
        selfId={selfId}
        callerRole={role}
      />

      <SectionBlock
        title={t("section_approved")}
        emptyMessage={t("empty_approved")}
        users={approved}
        actions="approved"
        t={t}
        locale={locale}
        selfId={selfId}
        callerRole={role}
      />

      <SectionBlock
        title={t("section_rejected")}
        emptyMessage={t("empty_rejected")}
        users={inactive}
        actions="rejected"
        t={t}
        locale={locale}
        selfId={selfId}
        callerRole={role}
      />
    </section>
  );
}

function AccessDenied({ message }: { message: string }) {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-24 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-100">
        <XCircle className="h-6 w-6" />
      </span>
      <p className="mt-4 text-balance text-base font-semibold text-slate-900">
        {message}
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "amber";
}) {
  const tone =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center shadow-sm">
      <p className={`text-2xl font-bold tabular-nums sm:text-3xl ${tone}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
    </div>
  );
}

function SectionBlock({
  title,
  emptyMessage,
  users,
  actions,
  t,
  locale,
  selfId,
  callerRole,
}: {
  title: string;
  emptyMessage: string;
  users: UserRow[];
  actions: "pending" | "approved" | "rejected";
  t: Awaited<ReturnType<typeof getTranslations<"Admin">>>;
  locale: string;
  selfId: string;
  callerRole: string;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold text-slate-900 sm:text-lg">
        {title}
        <span className="ml-2 text-xs font-medium tabular-nums text-slate-500">
          {users.length}
        </span>
      </h2>

      {users.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {users.map((u) => (
            <UserRowCard
              key={u.id}
              user={u}
              actions={actions}
              t={t}
              locale={locale}
              isSelf={u.id === selfId}
              callerRole={callerRole}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function UserRowCard({
  user,
  actions,
  t,
  locale,
  isSelf,
  callerRole,
}: {
  user: UserRow;
  actions: "pending" | "approved" | "rejected";
  t: Awaited<ReturnType<typeof getTranslations<"Admin">>>;
  locale: string;
  isSelf: boolean;
  callerRole: string;
}) {
  // Localized confirm text with the target email substituted in, so
  // the admin sees exactly whose row is about to be deleted.
  const removeConfirm = t("confirm_remove", { email: user.email });
  const initials = (user.name ?? user.email)
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-emerald-500 text-xs font-bold text-white shadow-sm">
        {initials || <UserCircle2 className="h-5 w-5" />}
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">
            {user.name ?? t("no_name")}
          </p>
          {isSelf && (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              {t("self_label")}
            </span>
          )}
          <StatusPill status={user.status} t={t} />
          {user.role !== "user" && <RolePill role={user.role} t={t} />}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">
          {user.email}
          <span className="text-slate-300"> · </span>
          {t("joined_label")}{" "}
          <span className="tabular-nums">
            {new Date(user.createdAt).toLocaleDateString(
              locale === "id" ? "id-ID" : "en-US",
              { year: "numeric", month: "short", day: "numeric" },
            )}
          </span>
        </p>
      </div>

      <ActionButtons
        userId={user.id}
        userRole={user.role}
        actions={actions}
        t={t}
        disabled={isSelf}
        callerRole={callerRole}
        removeConfirm={removeConfirm}
      />
    </li>
  );
}

function ActionButtons({
  userId,
  userRole,
  actions,
  t,
  disabled,
  callerRole,
  removeConfirm,
}: {
  userId: string;
  userRole: string;
  actions: "pending" | "approved" | "rejected";
  t: Awaited<ReturnType<typeof getTranslations<"Admin">>>;
  disabled: boolean;
  callerRole: string;
  removeConfirm: string;
}) {
  if (disabled) {
    return <span className="text-[10px] uppercase tracking-wider text-slate-400">—</span>;
  }

  if (actions === "pending") {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <AdminFormButton
          action={approveUserAction}
          userId={userId}
          label={t("approve_button")}
          tone="emerald"
          icon={CheckCircle2}
        />
        <AdminFormButton
          action={rejectUserAction}
          userId={userId}
          label={t("reject_button")}
          tone="rose"
        />
      </div>
    );
  }

  if (actions === "approved") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <RoleControls
          userId={userId}
          userRole={userRole}
          callerRole={callerRole}
          t={t}
        />
        <AdminFormButton
          action={blockUserAction}
          userId={userId}
          label={t("block_button")}
          tone="rose"
        />
        <ConfirmFormButton
          action={removeUserAction}
          userId={userId}
          label={t("remove_button")}
          confirmMessage={removeConfirm}
          tone="rose"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <AdminFormButton
        action={reinstateUserAction}
        userId={userId}
        label={t("reinstate_button")}
        tone="emerald"
        icon={CheckCircle2}
      />
      <ConfirmFormButton
        action={removeUserAction}
        userId={userId}
        label={t("remove_button")}
        confirmMessage={removeConfirm}
        tone="rose"
      />
    </div>
  );
}

function AdminFormButton({
  action,
  userId,
  label,
  tone,
  icon: Icon,
}: {
  action: (formData: FormData) => Promise<void>;
  userId: string;
  label: string;
  tone: "emerald" | "rose" | "brand" | "slate";
  icon?: typeof CheckCircle2;
}) {
  const cls =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
      : tone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
        : tone === "brand"
          ? "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"
          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100";
  return (
    <form action={action}>
      <input type="hidden" name="user_id" value={userId} />
      <button
        type="submit"
        className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-semibold transition ${cls}`}
      >
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </button>
    </form>
  );
}

/**
 * Role-change buttons rendered next to the Block action on approved rows.
 *
 * Rules (mirrored server-side in actions.ts):
 *  - Admins can promote `user` → `admin`, demote `admin` → `user`.
 *  - Only superadmins can grant or revoke `superadmin`.
 *  - You cannot change your own role (handled at the parent via `disabled={isSelf}`).
 */
function RoleControls({
  userId,
  userRole,
  callerRole,
  t,
}: {
  userId: string;
  userRole: string;
  callerRole: string;
  t: Awaited<ReturnType<typeof getTranslations<"Admin">>>;
}) {
  const canGrantSuper = callerRole === "superadmin";

  if (userRole === "user") {
    return (
      <>
        <AdminFormButton
          action={promoteToAdminAction}
          userId={userId}
          label={t("make_admin_button")}
          tone="brand"
        />
        {canGrantSuper && (
          <AdminFormButton
            action={promoteToSuperadminAction}
            userId={userId}
            label={t("make_superadmin_button")}
            tone="brand"
          />
        )}
      </>
    );
  }
  if (userRole === "admin") {
    return (
      <>
        {canGrantSuper && (
          <AdminFormButton
            action={promoteToSuperadminAction}
            userId={userId}
            label={t("make_superadmin_button")}
            tone="brand"
          />
        )}
        <AdminFormButton
          action={demoteToUserAction}
          userId={userId}
          label={t("demote_to_user_button")}
          tone="slate"
        />
      </>
    );
  }
  // userRole === "superadmin": only another superadmin can revoke
  if (userRole === "superadmin" && canGrantSuper) {
    return (
      <AdminFormButton
        action={demoteToUserAction}
        userId={userId}
        label={t("demote_to_user_button")}
        tone="slate"
      />
    );
  }
  return null;
}

function StatusPill({
  status,
  t,
}: {
  status: string;
  t: Awaited<ReturnType<typeof getTranslations<"Admin">>>;
}) {
  const tone =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : status === "pending"
        ? "bg-amber-50 text-amber-700 ring-amber-100"
        : "bg-rose-50 text-rose-700 ring-rose-100";
  const key = `status_${status}` as Parameters<typeof t>[0];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${tone}`}
    >
      {t(key)}
    </span>
  );
}

function RolePill({
  role,
  t,
}: {
  role: string;
  t: Awaited<ReturnType<typeof getTranslations<"Admin">>>;
}) {
  const key = `role_${role}` as Parameters<typeof t>[0];
  return (
    <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700 ring-1 ring-brand-100">
      {t(key)}
    </span>
  );
}
