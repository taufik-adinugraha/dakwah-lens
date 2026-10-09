/** Visible on every unreviewed record (plan §8: nothing presented as final
 *  until an ustadz signs it off). */
export function DraftChip({ label }: { label: string }) {
  return (
    <span className="mt-2 inline-flex rounded-full border border-dashed border-case-nasb/50 px-2 py-0.5 text-[11px] font-medium text-case-nasb">
      {label}
    </span>
  );
}
