"use client";

import { useActionState } from "react";

import { Link } from "@/i18n/navigation";
import { KNOWN_PROVIDERS, providerLabel } from "@/lib/cost-providers";
import {
  addManualCost,
  updateManualCost,
  type ManualCostFormState,
} from "../actions";

/** Serializable subset of a manual_costs row the form needs to
 *  pre-fill in edit mode. Dates arrive already formatted as the
 *  `YYYY-MM-DD` shape `<input type="date">` expects (the server
 *  page runs toDateInput before passing them across the RSC
 *  boundary). */
export type ManualCostEditRow = {
  id: string;
  kind: string;
  vendor: string;
  amountIdr: number;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  coversProvider: string | null;
  attachmentPath: string | null;
  attachmentFilename: string | null;
};

/**
 * The add/edit form for a manual cost entry. A client component so it
 * can use `useActionState`: when the server action detects a probable
 * duplicate it returns `{ error, duplicate: true }` instead of writing,
 * and this component surfaces the warning + a "Save anyway" checkbox
 * WITHOUT remounting — so the operator's typed values (and any picked
 * invoice file) survive the round-trip. On success the action
 * redirects, which remounts this fresh and clears the form.
 */
export function ManualCostForm({ editRow }: { editRow: ManualCostEditRow | null }) {
  const action = editRow ? updateManualCost : addManualCost;
  const [state, formAction, pending] = useActionState<
    ManualCostFormState,
    FormData
  >(action, null);

  return (
    <form
      id="manual-cost-form"
      action={formAction}
      className="space-y-4"
      encType="multipart/form-data"
    >
      {editRow && <input type="hidden" name="id" value={editRow.id} />}

      {/* Row 1 — what */}
      <div className="grid gap-3 sm:grid-cols-[200px_1fr_1fr]">
        <FormField label="Kind">
          <select
            name="kind"
            required
            defaultValue={editRow?.kind ?? "infra"}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="infra">Infra (monthly VPS)</option>
            <option value="infra_topup">Infra (Top Up)</option>
            <option value="domain">Domain (yearly)</option>
            <option value="api_topup">API (Top Up)</option>
            <option value="api_usage">API Usage</option>
            <option value="other">Other</option>
          </select>
        </FormField>
        <FormField label="Vendor">
          <input
            name="vendor"
            placeholder="IDCloudHost, Niagahoster…"
            required
            maxLength={64}
            defaultValue={editRow?.vendor ?? ""}
            className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
          />
        </FormField>
        <FormField label="Amount (IDR)">
          <input
            name="amount_idr"
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 150000"
            required
            defaultValue={editRow ? Math.round(editRow.amountIdr) : ""}
            className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
          />
        </FormField>
      </div>

      {/* Row 2 — when */}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Period start">
          <input
            name="period_start"
            type="date"
            required
            defaultValue={editRow?.periodStart ?? ""}
            className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
          />
        </FormField>
        <FormField label="Period end">
          <input
            name="period_end"
            type="date"
            required
            defaultValue={editRow?.periodEnd ?? ""}
            className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
          />
        </FormField>
      </div>

      {/* Note — full width */}
      <FormField label="Note" hint="Optional · invoice number, plan tier, etc.">
        <input
          name="note"
          placeholder="Invoice #INV-2026-0042"
          maxLength={2000}
          defaultValue={editRow?.note ?? ""}
          className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm placeholder:text-slate-400"
        />
      </FormField>

      {/* Subscription mapping — when this entry covers an API provider
          on a flat-rate plan, pick it here so the cost totals don't
          double-count the per-call usage. */}
      <FormField
        label="Covers API provider"
        hint="Optional · only when this is a flat-rate subscription (e.g. Apify Starter $15/mo). Per-call usage for the selected provider will be excluded from the monthly API-cost sum to avoid double-counting."
      >
        <select
          name="covers_provider"
          defaultValue={editRow?.coversProvider ?? ""}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
        >
          <option value="">— (none, pure infra / domain)</option>
          {KNOWN_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {providerLabel(p)}
            </option>
          ))}
        </select>
      </FormField>

      {/* Optional invoice attachment. On ADD it's a fresh upload; on
          EDIT, uploading a file REPLACES the current one (the server
          deletes the old file), and leaving it empty keeps the
          existing attachment untouched. */}
      <FormField
        label="Invoice file"
        hint={
          editRow
            ? "Optional · upload to replace · leave empty to keep current · PDF / JPG / PNG / WebP · max 5 MB"
            : "Optional · PDF / JPG / PNG / WebP · max 5 MB"
        }
      >
        {editRow && (
          <p className="mb-1.5 text-xs text-slate-500">
            Current:{" "}
            {editRow.attachmentPath ? (
              <a
                href={`/api/admin/attachments/manual-cost/${editRow.id}`}
                className="font-medium text-brand-700 underline-offset-2 hover:underline"
              >
                {editRow.attachmentFilename ?? "download"}
              </a>
            ) : (
              <span className="text-slate-400">none attached</span>
            )}
          </p>
        )}
        <input
          name="attachment"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
        />
      </FormField>

      {/* Soft duplicate guard. The server action returns
          `duplicate: true` when it finds a probable double-entry
          (same vendor + amount + period, or an overlapping
          subscription for the same provider). We surface the message
          and reveal a confirm checkbox; ticking it and resubmitting
          passes `confirm_duplicate` so the action skips the check. A
          plain non-duplicate validation error renders without the
          checkbox. */}
      {state?.error && (
        <div
          className={`rounded-lg border px-3 py-2.5 text-xs ${
            state.duplicate
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
          role="alert"
        >
          <p>{state.error}</p>
          {state.duplicate && (
            <label className="mt-2 flex items-center gap-2 font-semibold text-amber-900">
              <input
                type="checkbox"
                name="confirm_duplicate"
                value="1"
                className="h-3.5 w-3.5 rounded border-amber-300"
              />
              Save anyway — this is not a duplicate
            </label>
          )}
        </div>
      )}

      {/* Submit — right-aligned. In edit mode we also surface a Cancel
          link so the operator can back out without saving. */}
      <div className="flex items-center justify-end gap-3 pt-1">
        {editRow && (
          <Link
            href="/admin/system/costs"
            className="text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            Cancel
          </Link>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending
            ? "Saving…"
            : editRow
              ? "Save changes"
              : "Save entry"}
        </button>
      </div>
    </form>
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
