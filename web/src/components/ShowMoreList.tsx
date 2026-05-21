"use client";

import { Children, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Reveals a list `pageSize` items at a time. Click "Show more" to
 * reveal another batch. Used on /insights/[platform] and segment pages
 * to keep the top of the list focused on the most-relevant items
 * without hiding everything else.
 *
 * Server fetches a larger set (e.g. 50); this component decides what's
 * actually painted to the DOM. Children must be the rendered list
 * items (any valid React node) — we count via React.Children.toArray
 * so consumers don't have to change their JSX layout.
 */
export function ShowMoreList({
  children,
  pageSize = 8,
  moreLabel = "Show more",
}: {
  children: ReactNode;
  pageSize?: number;
  moreLabel?: string;
}) {
  const items = Children.toArray(children);
  const [visible, setVisible] = useState(pageSize);

  const remaining = items.length - visible;

  return (
    <>
      {items.slice(0, visible)}
      {remaining > 0 && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => setVisible((v) => v + pageSize)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            {moreLabel} ({remaining})
          </button>
        </div>
      )}
    </>
  );
}
