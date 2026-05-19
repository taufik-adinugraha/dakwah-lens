import { desc } from "drizzle-orm";
import {
  Bell,
  Check,
  CircleSlash,
  Mail,
  Megaphone,
  Send,
  X,
} from "lucide-react";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { TERMS_CHANGELOG, TERMS_VERSION } from "@/lib/terms-version";

import { ConfirmForm } from "../_ConfirmForm";
import {
  dismissFollowupAction,
  postTermsBannerAction,
  sendTermsEmailBlastAction,
} from "./actions";

export const metadata = { title: "Follow-ups" };

export default async function FollowupsPage() {
  // Admin view is read-only — show the queue but hide action forms.
  const session = await auth();
  const isSuperadmin = session?.user?.role === "superadmin";

  const rows = await db
    .select()
    .from(schema.adminFollowups)
    .orderBy(desc(schema.adminFollowups.createdAt))
    .limit(50);

  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-center gap-2 text-rose-700">
          <Bell className="h-5 w-5" />
          <h2 className="text-xl font-semibold tracking-tight">
            Pending follow-ups
          </h2>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Tasks the system has queued for the admin to action manually.
          Right now the only producer is the terms-update workflow: when
          you bump <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">TERMS_VERSION</code>{" "}
          in code, two rows land here — the user email blast and the
          14-day banner post.
        </p>
      </header>

      {pending.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
          Nothing pending. Bumping{" "}
          <code className="rounded bg-white px-1 py-0.5">TERMS_VERSION</code>{" "}
          in <code className="rounded bg-white px-1 py-0.5">src/lib/terms-version.ts</code>{" "}
          will queue the next email + banner here automatically.
        </div>
      ) : (
        <ol className="space-y-4">
          {pending.map((f) => (
            <FollowupCard key={f.id} f={f} canAct={isSuperadmin} />
          ))}
        </ol>
      )}

      {done.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Recently handled
          </h3>
          <ul className="mt-3 space-y-2">
            {done.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs"
              >
                <CompletedIcon status={f.status} />
                <span className="font-mono text-slate-500">
                  {f.kind}
                </span>
                <span className="ml-auto text-slate-400">
                  {f.completedAt
                    ? new Date(f.completedAt).toLocaleString()
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FollowupCard({
  f,
  canAct,
}: {
  f: typeof schema.adminFollowups.$inferSelect;
  canAct: boolean;
}) {
  const payload = (f.payload ?? {}) as {
    version?: string;
    changelog?: string | null;
  };
  const version = payload.version ?? TERMS_VERSION;
  const changelog = payload.changelog ?? TERMS_CHANGELOG ?? "";

  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
        <div className="flex items-center gap-2">
          {f.kind === "terms_email_blast" ? (
            <Mail className="h-4 w-4 text-emerald-700" />
          ) : (
            <Megaphone className="h-4 w-4 text-emerald-700" />
          )}
          <h3 className="text-sm font-semibold text-slate-900">
            {f.kind === "terms_email_blast"
              ? "Email approved users about the terms update"
              : "Post the 14-day terms-update banner"}
          </h3>
          <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 font-mono text-[10px] text-slate-700">
            v{version}
          </span>
        </div>
        <p className="mt-1 text-[12px] text-slate-500">
          Queued {new Date(f.createdAt).toLocaleString()}
        </p>
      </div>

      {canAct ? (
        <>
          <div className="px-5 py-4">
            {f.kind === "terms_email_blast" ? (
              <EmailBlastForm
                followupId={f.id}
                version={version}
                changelog={changelog}
              />
            ) : (
              <BannerPostForm
                followupId={f.id}
                version={version}
                changelog={changelog}
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-2.5">
            <ConfirmForm
              action={dismissFollowupAction}
              confirmMessage={`Dismiss this ${f.kind === "terms_email_blast" ? "email blast" : "banner post"} follow-up without acting on it? Users won't be notified about v${version}.`}
            >
              <input type="hidden" name="followup_id" value={f.id} />
              <button
                type="submit"
                className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
              >
                <X className="h-3 w-3" />
                Dismiss
              </button>
            </ConfirmForm>
          </div>
        </>
      ) : (
        <div className="px-5 py-4 text-[12px] text-slate-500">
          A superadmin needs to send the email blast / post the banner.
          You&apos;ll see it move to <em>Recently handled</em> once that
          happens.
        </div>
      )}
    </li>
  );
}

function EmailBlastForm({
  followupId,
  version,
  changelog,
}: {
  followupId: string;
  version: string;
  changelog: string;
}) {
  const defaultSubject = `Dakwah-Lens — terms of use updated (${version})`;
  const defaultBody = changelog
    ? `Assalamu'alaikum,\n\nWe've updated our terms of use. Summary of what changed:\n\n${changelog}\n\nThe full text is at the link below. As ever, you can reach us if anything is unclear.`
    : `Assalamu'alaikum,\n\nWe've updated our terms of use. The full text is at the link below — material changes are highlighted at the top. As ever, you can reach us if anything is unclear.`;

  return (
    <ConfirmForm
      action={sendTermsEmailBlastAction}
      confirmMessage={`Send this email to every approved user? This cannot be undone — emails go out immediately, sequentially.`}
      className="space-y-3"
    >
      <input type="hidden" name="followup_id" value={followupId} />
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Subject
        </label>
        <input
          type="text"
          name="subject"
          defaultValue={defaultSubject}
          required
          maxLength={160}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Body (plain text — paragraphs preserved)
        </label>
        <textarea
          name="body_text"
          defaultValue={defaultBody}
          required
          rows={6}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>
      <p className="text-[11px] text-slate-500">
        Sends to all approved users with an email on file. Sequential —
        sub-thousand-user blast should finish in under a minute.
      </p>
      <button
        type="submit"
        className="inline-flex h-9 items-center gap-2 rounded-full bg-emerald-700 px-4 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800"
      >
        <Send className="h-3.5 w-3.5" />
        Send to approved users
      </button>
    </ConfirmForm>
  );
}

function BannerPostForm({
  followupId,
  version,
  changelog,
}: {
  followupId: string;
  version: string;
  changelog: string;
}) {
  const defaultEn = changelog
    ? `We updated our terms (v${version}): ${changelog}`
    : `We updated our terms of use (v${version}).`;
  const defaultId = changelog
    ? `Kami memperbarui ketentuan (v${version}): ${changelog}`
    : `Kami memperbarui ketentuan penggunaan (v${version}).`;

  return (
    <ConfirmForm
      action={postTermsBannerAction}
      confirmMessage={`Post this banner site-wide for the next 14 days?`}
      className="space-y-3"
    >
      <input type="hidden" name="followup_id" value={followupId} />
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Banner — English
        </label>
        <textarea
          name="message_en"
          defaultValue={defaultEn}
          required
          rows={2}
          maxLength={300}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Banner — Bahasa Indonesia
        </label>
        <textarea
          name="message_id"
          defaultValue={defaultId}
          required
          rows={2}
          maxLength={300}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>
      <p className="text-[11px] text-slate-500">
        Displays site-wide for 14 days. Both locales required so neither
        falls back to the other.
      </p>
      <button
        type="submit"
        className="inline-flex h-9 items-center gap-2 rounded-full bg-emerald-700 px-4 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800"
      >
        <Megaphone className="h-3.5 w-3.5" />
        Post banner for 14 days
      </button>
    </ConfirmForm>
  );
}

function CompletedIcon({ status }: { status: string }) {
  if (status === "completed")
    return <Check className="h-3.5 w-3.5 text-emerald-600" />;
  return <CircleSlash className="h-3.5 w-3.5 text-slate-400" />;
}
