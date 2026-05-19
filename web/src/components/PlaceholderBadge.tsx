import { AlertTriangle } from "lucide-react";

/** Placeholder-mode markers are dev-only — production users should never see
 *  "MODE PLACEHOLDER" or the matching banner. We gate at the component level
 *  so every call site (briefs/new, briefs detail, briefs list, dashboard)
 *  silently no-ops in prod without each one needing its own conditional. */
const HIDE_PLACEHOLDERS = process.env.NODE_ENV === "production";

/** Visual chip that flags the brief was produced in placeholder mode. */
export function PlaceholderChip({ label }: { label: string }) {
  if (HIDE_PLACEHOLDERS) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 shadow-sm">
      <AlertTriangle className="h-3 w-3" />
      {label}
    </span>
  );
}

/** Larger inline banner explaining the placeholder mode. */
export function PlaceholderBanner({
  label,
  note,
}: {
  label: string;
  note: string;
}) {
  if (HIDE_PLACEHOLDERS) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 shadow-sm">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
          {label}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-amber-900">{note}</p>
      </div>
    </div>
  );
}
