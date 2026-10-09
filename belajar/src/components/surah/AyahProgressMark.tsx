"use client";

import { CheckCircle2 } from "lucide-react";

import { useProgress } from "@/hooks/useProgress";

/** Shows a check once every exercise of an ayah lesson is done (local). */
export function AyahProgressMark({ ayahKey, label }: { ayahKey: string; label: string }) {
  const { progress } = useProgress();
  const done = Object.keys(progress).some((k) => k.startsWith(`${ayahKey}/`));
  if (!done) return <span />;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-forest">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
