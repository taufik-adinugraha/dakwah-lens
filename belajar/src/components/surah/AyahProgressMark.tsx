"use client";

import { CheckCircle2 } from "lucide-react";

import { useProgress } from "@/hooks/useProgress";

/** Shows a check + text once every exercise of an ayah lesson is done (local). */
export function AyahProgressMark({ ayahKey, label }: { ayahKey: string; label: string }) {
  const { progress } = useProgress();
  const done = Object.keys(progress).some((k) => k.startsWith(`${ayahKey}/`));
  if (!done) return <span />;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-forest">
      <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0" />
      {label}
    </span>
  );
}
