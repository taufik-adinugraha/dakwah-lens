"use client";

import { CircleAlert } from "lucide-react";

import type { RefusalView } from "@/lib/waris/report";

import { RuleNote } from "./bits";
import { useReportText } from "./text";

/**
 * Why a column, or the whole report, is not computed (plan §5.4, M2.8): each reason's RuleNote
 * (rujuk.<reason>) or the report's own sentence. Reasons only: never a number.
 */
export function Reasons({ reasons, refs = true }: { reasons: readonly RefusalView[]; refs?: boolean }) {
  const { R } = useReportText();
  return (
    <ul className="space-y-4">
      {reasons.map((x, i) => (
        <li key={`${x.reason}-${i}`} className="flex gap-3">
          <CircleAlert className="mt-1 h-5 w-5 shrink-0 text-notice" aria-hidden />
          <div className="min-w-0 flex-1">
            {x.rule ? <RuleNote rule={x.rule} refs={refs} /> : x.text ? <p className="text-pretty text-ink">{R(x.text)}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
