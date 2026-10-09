/** Visible on every unreviewed record (plan §8: nothing presented as final
 *  until an ustadz signs it off). Readable, not decorative: notice text
 *  6.0–6.7:1 and a solid notice border (≥3:1), at the 15px meta floor. */
export function DraftChip({ label }: { label: string }) {
  return (
    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-notice bg-notice-bg px-3 py-1 text-xs font-medium text-notice">
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-[1em] w-[1em] shrink-0">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 4.5V8.5l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}
