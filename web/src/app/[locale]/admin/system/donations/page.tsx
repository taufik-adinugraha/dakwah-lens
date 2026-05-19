import { Trash2 } from "lucide-react";
import { desc, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { Link } from "@/i18n/navigation";
import { addDonation, deleteDonation } from "../actions";
import {
  Card,
  EmptyState,
  HelpCallout,
  PageHeader,
  StatTile,
  formatRupiah,
} from "../_ui";
import { ConfirmForm } from "../_ConfirmForm";

export default async function DonationsPage() {
  const [
    donations,
    [{ total = 0 } = { total: 0 }],
    [{ count30 = 0, amount30 = 0 } = { count30: 0, amount30: 0 }],
    [{ count90 = 0, amount90 = 0 } = { count90: 0, amount90: 0 }],
    monthly,
  ] = await Promise.all([
    db
      .select()
      .from(schema.donations)
      .orderBy(desc(schema.donations.receivedAt))
      .limit(200),
    db
      .select({ total: sql<number>`COALESCE(SUM(amount_idr), 0)::float` })
      .from(schema.donations),
    db
      .select({
        count30: sql<number>`COUNT(*)::int`,
        amount30: sql<number>`COALESCE(SUM(amount_idr), 0)::float`,
      })
      .from(schema.donations)
      .where(sql`received_at >= now() - interval '30 days'`),
    db
      .select({
        count90: sql<number>`COUNT(*)::int`,
        amount90: sql<number>`COALESCE(SUM(amount_idr), 0)::float`,
      })
      .from(schema.donations)
      .where(sql`received_at >= now() - interval '90 days'`),
    db.execute(sql`
      SELECT
        DATE_TRUNC('month', received_at)::date AS month,
        COUNT(*)::int AS n,
        COALESCE(SUM(amount_idr), 0)::float AS idr
      FROM donations
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `) as unknown as Promise<
      Array<{ month: string; n: number; idr: number }>
    >,
  ]);

  return (
    <>
      <PageHeader
        title="Donations"
        subtitle="Record and review incoming donations. Same entries surface publicly on /transparency."
      />

      <HelpCallout>
        <p>
          Counterpart of <code>/admin/system/costs</code> — that page tracks
          money going out, this one tracks money coming in. The two
          together drive the public transparency page and the Net balance
          tile on the Overview.
        </p>
        <p>
          <strong>Donor privacy:</strong> when you tick &quot;Mark as anonymous&quot;,
          the donor name is dropped before the row is inserted — not just
          hidden on the public page. There is no way to surface a donor
          name that was never persisted.
        </p>
      </HelpCallout>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="All-time donations"
          value={formatRupiah(total)}
          hint={`${donations.length} entries`}
          accent="emerald"
        />
        <StatTile
          label="Last 30 days"
          value={formatRupiah(amount30)}
          hint={`${count30} entries`}
          accent="brand"
        />
        <StatTile
          label="Last 90 days"
          value={formatRupiah(amount90)}
          hint={`${count90} entries`}
        />
        <StatTile
          label="Avg per entry"
          value={
            donations.length > 0
              ? formatRupiah(total / donations.length)
              : "—"
          }
          hint="all-time mean"
        />
      </div>

      <Card title="Record a donation">
        <form
          action={addDonation}
          className="space-y-4"
          encType="multipart/form-data"
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
            <FormField label="Received on">
              <input
                name="received_at"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
              />
            </FormField>
            <FormField label="Amount (IDR)">
              <input
                name="amount_idr"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 100000"
                required
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
              />
            </FormField>
            <FormField label="Channel">
              <select
                name="channel"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="qris">QRIS</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <FormField
              label="Donor name"
              hint="Shown publicly unless marked anonymous"
            >
              <input
                name="donor"
                placeholder="Full name"
                maxLength={120}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
              />
            </FormField>
            <label className="inline-flex cursor-pointer items-center gap-2 self-end pb-1 text-sm text-slate-700">
              <input
                type="checkbox"
                name="is_anonymous"
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              <span>Mark as anonymous</span>
            </label>
          </div>
          <FormField label="Note" hint="Optional · invoice / receipt reference">
            <input
              name="note"
              placeholder="JKT-2026-001"
              maxLength={200}
              className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
            />
          </FormField>
          <FormField
            label="Receipt file"
            hint="Optional · transfer proof or receipt · PDF / JPG / PNG / WebP · max 5 MB · admin-only download (never exposed on /transparency)"
          >
            <input
              name="attachment"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
            />
          </FormField>
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
            >
              Record donation
            </button>
          </div>
        </form>
      </Card>

      <Card
        title={`Donation log (${donations.length})`}
        hint={`total ${formatRupiah(total)}`}
      >
        {donations.length === 0 ? (
          <EmptyState
            title="No donations yet"
            hint="Record the first one above. It'll appear here and on /transparency."
          />
        ) : (
          <table className="w-full text-sm max-md:block max-md:overflow-x-auto">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2">Received</th>
                <th className="py-2">Donor</th>
                <th className="py-2">Channel</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2">Note</th>
                <th className="py-2">Receipt</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {donations.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-slate-50 last:border-0"
                >
                  <td className="py-2 text-xs text-slate-500">
                    {new Date(d.receivedAt).toLocaleDateString()}
                  </td>
                  <td className="py-2 text-xs">
                    {d.isAnonymous ? (
                      <span className="italic text-slate-500">
                        Anonymous (hidden)
                      </span>
                    ) : (
                      <span className="text-slate-700">{d.donor ?? "—"}</span>
                    )}
                  </td>
                  <td className="py-2 text-xs capitalize text-slate-500">
                    {(d.channel ?? "—").replace(/_/g, " ")}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatRupiah(d.amountIdr)}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {d.note ?? "—"}
                  </td>
                  <td className="py-2 text-xs">
                    {d.attachmentPath ? (
                      <a
                        href={`/api/admin/attachments/donation/${d.id}`}
                        className="font-medium text-brand-700 underline-offset-2 hover:underline"
                      >
                        {d.attachmentFilename ?? "download"}
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <ConfirmForm
                      action={deleteDonation}
                      confirmMessage={`Delete this ${formatRupiah(d.amountIdr)} donation${d.isAnonymous ? "" : d.donor ? ` from ${d.donor}` : ""}? Also unlinks any attached receipt and updates the public /transparency page.`}
                    >
                      <input type="hidden" name="id" value={d.id} />
                      <button
                        type="submit"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </ConfirmForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="By month"
        hint={`last ${monthly.length} months`}
      >
        {Array.isArray(monthly) && monthly.length > 0 ? (
          <ul className="space-y-1.5 text-sm">
            {monthly.map((m) => (
              <li key={m.month} className="flex items-center justify-between">
                <span className="text-slate-700">
                  {new Date(m.month).toLocaleDateString("en-US", {
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <span className="flex items-baseline gap-3 tabular-nums">
                  <span className="text-[11px] text-slate-400">
                    {m.n} entr{m.n === 1 ? "y" : "ies"}
                  </span>
                  <span className="text-slate-900">
                    {formatRupiah(m.idr)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">
            No monthly history yet — record at least one donation.
          </p>
        )}
      </Card>

      <p className="text-center text-xs text-slate-500">
        Pair this with the{" "}
        <Link
          href="/admin/system/costs"
          className="font-semibold text-brand-700 underline-offset-2 hover:underline"
        >
          Total cost page
        </Link>{" "}
        for the full income-vs-spend balance, or check the public{" "}
        <Link
          href="/transparency"
          className="font-semibold text-brand-700 underline-offset-2 hover:underline"
        >
          /transparency
        </Link>{" "}
        view that visitors see.
      </p>
    </>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        {label}
        {hint && (
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-slate-400">
            {hint}
          </span>
        )}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
