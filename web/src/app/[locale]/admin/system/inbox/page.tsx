import { Archive, Mail, MailOpen, Trash2 } from "lucide-react";
import { desc, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { deleteContactMessage, setContactStatus } from "../actions";
import {
  Card,
  EmptyState,
  HelpCallout,
  PageHeader,
  StatTile,
  formatRelative,
} from "../_ui";
import { ConfirmForm } from "../_ConfirmForm";

type StatusFilter = "new" | "read" | "archived" | "all";
const STATUS_FILTERS: readonly StatusFilter[] = [
  "new",
  "read",
  "archived",
  "all",
] as const;

export default async function InboxPage({
  searchParams,
}: PageProps<"/[locale]/admin/system/inbox">) {
  const sp = await searchParams;
  const rawShow = typeof sp.show === "string" ? sp.show : undefined;
  const activeFilter: StatusFilter =
    (STATUS_FILTERS as readonly string[]).includes(rawShow ?? "")
      ? (rawShow as StatusFilter)
      : "new";

  const [
    [{ countNew = 0 } = { countNew: 0 }],
    [{ countRead = 0 } = { countRead: 0 }],
    [{ countArchived = 0 } = { countArchived: 0 }],
    [{ countTotal = 0 } = { countTotal: 0 }],
    messages,
  ] = await Promise.all([
    db
      .select({ countNew: sql<number>`COUNT(*)::int` })
      .from(schema.contactMessages)
      .where(sql`status = 'new'`),
    db
      .select({ countRead: sql<number>`COUNT(*)::int` })
      .from(schema.contactMessages)
      .where(sql`status = 'read'`),
    db
      .select({ countArchived: sql<number>`COUNT(*)::int` })
      .from(schema.contactMessages)
      .where(sql`status = 'archived'`),
    db
      .select({ countTotal: sql<number>`COUNT(*)::int` })
      .from(schema.contactMessages),
    activeFilter === "all"
      ? db
          .select()
          .from(schema.contactMessages)
          .orderBy(desc(schema.contactMessages.receivedAt))
          .limit(100)
      : db
          .select()
          .from(schema.contactMessages)
          .where(sql`status = ${activeFilter}`)
          .orderBy(desc(schema.contactMessages.receivedAt))
          .limit(100),
  ]);

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle="Messages submitted via /contact. The same content was also emailed to ADMIN_EMAIL — this is the durable copy."
      />

      <HelpCallout>
        <p>
          Every submission to the public <code>/contact</code> form lands
          here AND is forwarded to the admin email (configured via{" "}
          <code>ADMIN_EMAIL</code> in <code>.env</code>, falling back to{" "}
          <code>SUPERADMIN_EMAIL</code>). If email delivery fails, the row
          is still here.
        </p>
        <p>
          Reply by emailing the sender directly from your own mail client —
          the From / Reply-To address is shown next to each message.
          Mark-as-read and Archive are purely visual; we don&apos;t auto-delete.
        </p>
      </HelpCallout>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="New"
          value={String(countNew)}
          accent={Number(countNew) > 0 ? "rose" : "emerald"}
        />
        <StatTile label="Read" value={String(countRead)} />
        <StatTile label="Archived" value={String(countArchived)} />
        <StatTile label="All-time" value={String(countTotal)} accent="brand" />
      </div>

      <Card title={`Messages (${messages.length})`}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Show
          </span>
          <FilterPill
            href="/admin/system/inbox"
            active={activeFilter === "new"}
            label="New"
            count={Number(countNew)}
          />
          <FilterPill
            href="/admin/system/inbox?show=read"
            active={activeFilter === "read"}
            label="Read"
            count={Number(countRead)}
          />
          <FilterPill
            href="/admin/system/inbox?show=archived"
            active={activeFilter === "archived"}
            label="Archived"
            count={Number(countArchived)}
          />
          <FilterPill
            href="/admin/system/inbox?show=all"
            active={activeFilter === "all"}
            label="All"
            count={Number(countTotal)}
          />
        </div>

        {messages.length === 0 ? (
          <EmptyState
            title="Nothing here"
            hint={
              activeFilter === "new"
                ? "No new messages. Submit one via /contact to test the pipeline."
                : "No messages match this filter."
            }
          />
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <MessageCard key={m.id} message={m} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function FilterPill({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <a
      href={href}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      {label}
      <span
        className={`tabular-nums ${active ? "text-white/80" : "text-slate-400"}`}
      >
        {count}
      </span>
    </a>
  );
}

function MessageCard({
  message,
}: {
  message: {
    id: string;
    receivedAt: Date;
    name: string;
    email: string;
    subject: string | null;
    message: string;
    status: string;
  };
}) {
  const isNew = message.status === "new";
  const isArchived = message.status === "archived";

  return (
    <li
      className={`rounded-2xl border p-5 shadow-sm transition ${
        isNew
          ? "border-rose-200 bg-rose-50/40"
          : isArchived
            ? "border-slate-200 bg-slate-50/60 opacity-70"
            : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-sm font-bold text-slate-900">{message.name}</p>
            <a
              href={`mailto:${message.email}?subject=${encodeURIComponent(
                `Re: ${message.subject ?? "Your message"}`,
              )}`}
              className="font-mono text-xs text-brand-700 hover:text-brand-900"
            >
              {message.email}
            </a>
            <StatusPill status={message.status} />
            <span className="ml-auto text-[11px] text-slate-500">
              {formatRelative(message.receivedAt)}
            </span>
          </div>
          {message.subject && (
            <p className="mt-1.5 text-sm font-semibold text-slate-800">
              {message.subject}
            </p>
          )}
          <p className="mt-2 whitespace-pre-wrap text-pretty text-sm leading-relaxed text-slate-700">
            {message.message}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
        {isNew && (
          <StatusButton id={message.id} next="read" label="Mark read" icon={MailOpen} tone="emerald" />
        )}
        {!isNew && !isArchived && (
          <StatusButton id={message.id} next="new" label="Mark unread" icon={Mail} tone="slate" />
        )}
        {!isArchived && (
          <StatusButton id={message.id} next="archived" label="Archive" icon={Archive} tone="slate" />
        )}
        {isArchived && (
          <StatusButton id={message.id} next="new" label="Unarchive" icon={Mail} tone="emerald" />
        )}
        <ConfirmForm
          action={deleteContactMessage}
          confirmMessage={`Delete the message from ${message.email}? This removes it permanently — archive instead if you might revisit it.`}
          className="ml-auto"
        >
          <input type="hidden" name="id" value={message.id} />
          <button
            type="submit"
            className="inline-flex h-7 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
            aria-label="Delete"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </ConfirmForm>
      </div>
    </li>
  );
}

function StatusButton({
  id,
  next,
  label,
  icon: Icon,
  tone,
}: {
  id: string;
  next: string;
  label: string;
  icon: typeof Mail;
  tone: "emerald" | "slate";
}) {
  const cls =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
  return (
    <form action={setContactStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={next} />
      <button
        type="submit"
        className={`inline-flex h-7 items-center gap-1 rounded-full border px-3 text-[11px] font-semibold transition ${cls}`}
      >
        <Icon className="h-3 w-3" />
        {label}
      </button>
    </form>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles =
    status === "new"
      ? "bg-rose-100 text-rose-800 ring-rose-200"
      : status === "archived"
        ? "bg-slate-200 text-slate-700 ring-slate-300"
        : "bg-emerald-100 text-emerald-800 ring-emerald-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${styles}`}
    >
      {status}
    </span>
  );
}
