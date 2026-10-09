/** "Dibantu AI · bukan fatwa" on AI-prepared records. There is no human
 *  review (operator, 2026-10-09), so the chip states what the content is,
 *  not a review it is waiting for. Notice text 6.0–6.7:1, solid border. */
export function DraftChip({ label }: { label: string }) {
  return (
    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-notice bg-notice-bg px-3 py-1 text-xs font-medium text-notice">
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-[1em] w-[1em] shrink-0">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7.25V11.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
      </svg>
      {label}
    </span>
  );
}
