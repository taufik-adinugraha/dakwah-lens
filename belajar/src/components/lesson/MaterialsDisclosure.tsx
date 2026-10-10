"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * "Materi lengkap ayat ini" (operator, 2026-10-10: focus on the lesson, less
 * distraction): everything below the stage — the word cards, the standalone
 * Latihan, Pelajari lebih dalam — in ONE collapsed 48px row, its content
 * unchanged inside and still in the static HTML.
 *
 * Concept and vocabulary pages link straight to a word card
 * ("…/quran/al-fatihah/1#w-1-1-3", routes.ts ayahHref). A closed <details>
 * hides its content from fragment navigation in most browsers, so when the
 * address names an element inside this row, the row opens and the element
 * is brought into view (on arrival and on a later hash change). Never
 * otherwise: the page does not move by itself.
 */
export function MaterialsDisclosure({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const reveal = () => {
      const box = ref.current;
      let id = "";
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      const target = id ? document.getElementById(id) : null;
      if (!box || !target || !box.contains(target)) return;
      box.open = true;
      target.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  return (
    <details
      ref={ref}
      data-materials=""
      className="rounded-2xl border-[1.5px] border-teal-line bg-white shadow-[0_18px_44px_-26px_rgb(14_90_60/0.4),0_1px_0_rgb(13_148_136/0.08)]"
    >
      <summary className="disclosure-row px-5 py-3 text-ink">
        <span className="flex min-w-0 flex-col">
          <span className="text-lg font-semibold">{title}</span>
          <span className="text-sm font-normal text-ink-muted">{hint}</span>
        </span>
        <ChevronDown aria-hidden className="chev h-6 w-6 shrink-0 text-forest" />
      </summary>
      <div className="border-t border-hairline px-4 pt-6 pb-8 sm:px-6">{children}</div>
    </details>
  );
}
