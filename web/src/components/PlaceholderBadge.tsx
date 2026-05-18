import { AlertTriangle } from "lucide-react";

/** Visual chip that flags the brief was produced in placeholder mode. */
export function PlaceholderChip({ label }: { label: string }) {
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
