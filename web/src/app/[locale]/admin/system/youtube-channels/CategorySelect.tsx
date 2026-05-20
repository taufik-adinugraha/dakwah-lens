"use client";

import { updateYoutubeChannelCategory } from "../actions";

const CATEGORIES = [
  "religious",
  "family",
  "youth",
  "muamalah",
  "social_justice",
  "health",
  "education",
  "cultural",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  religious: "Religious / Dakwah",
  family: "Family / Vlog Keluarga",
  youth: "Youth / Lifestyle",
  muamalah: "Muamalah",
  social_justice: "Social Justice",
  health: "Health",
  education: "Education",
  cultural: "Cultural / Budaya",
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  religious: { bg: "bg-emerald-50", text: "text-emerald-700" },
  family: { bg: "bg-rose-50", text: "text-rose-700" },
  youth: { bg: "bg-sky-50", text: "text-sky-700" },
  muamalah: { bg: "bg-amber-50", text: "text-amber-700" },
  social_justice: { bg: "bg-violet-50", text: "text-violet-700" },
  health: { bg: "bg-teal-50", text: "text-teal-700" },
  education: { bg: "bg-indigo-50", text: "text-indigo-700" },
  cultural: { bg: "bg-fuchsia-50", text: "text-fuchsia-700" },
};

/**
 * Inline category re-assigner. We submit the parent form on change (no
 * separate Save button) so re-bucketing a channel is one click. The
 * server action revalidates the page to refresh counts + filtering.
 */
export function CategorySelect({
  id,
  category,
}: {
  id: string;
  category: string;
}) {
  const colors = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.cultural;
  return (
    <form action={updateYoutubeChannelCategory} className="max-w-fit">
      <input type="hidden" name="id" value={id} />
      <select
        name="category"
        defaultValue={category}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`h-7 cursor-pointer rounded-full border-0 px-2.5 pr-7 text-[10px] font-semibold uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-slate-300 ${colors.bg} ${colors.text}`}
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
    </form>
  );
}
