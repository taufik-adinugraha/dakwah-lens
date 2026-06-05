"use client";

import { useEffect, useState } from "react";

/**
 * Sticky table-of-contents sidebar for the /briefings/[id] page.
 *
 * Reads ## H2 headings from the markdown body, generates clickable
 * anchor links, and highlights the section currently in view via
 * IntersectionObserver. On mobile the parent shows it inline at the
 * top (still sticky-ish via CSS, no observer noise).
 *
 * No third-party TOC lib — react-markdown adds anchor IDs only via
 * extra plugins. We parse the source markdown ourselves for the
 * H2 list, then assign IDs to the corresponding rendered headings
 * via a simple ID-from-slug match.
 */
export function BriefTOC({
  body,
  label,
}: {
  body: string;
  label: string;
}) {
  const headings = parseH2Headings(body);
  const [activeId, setActiveId] = useState<string | null>(
    headings[0]?.id ?? null,
  );

  // Inject IDs into the rendered H2s once they hit the DOM. React-markdown
  // doesn't emit anchor IDs by default; doing it here keeps the renderer
  // dumb and the TOC self-contained.
  useEffect(() => {
    const h2s = document.querySelectorAll(".brief-print h2");
    h2s.forEach((el, idx) => {
      if (idx < headings.length) {
        el.id = headings[idx].id;
      }
    });

    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting heading as active.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
    );
    h2s.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label={label} className="text-xs">
      <p className="mb-2 font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <ul className="space-y-1">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault();
                const target = document.getElementById(h.id);
                if (target) {
                  target.scrollIntoView({ behavior: "smooth", block: "start" });
                  history.replaceState(null, "", `#${h.id}`);
                }
              }}
              className={`block rounded px-2 py-1 leading-snug transition ${
                activeId === h.id
                  ? "bg-emerald-50 font-semibold text-emerald-800"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function parseH2Headings(body: string): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  // `## Pesan Flyer` / `## Flyer Messages` is renderer input (stripped
  // from the rendered body by BriefingNarrative). Skip it in the TOC
  // too — otherwise the link scrolls to a heading that doesn't exist.
  const HIDDEN = /^(?:pesan\s+flyer|flyer\s+messages)\b/i;
  for (const line of body.split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      const text = m[1].trim();
      if (HIDDEN.test(text)) continue;
      out.push({ id: slugify(text), text });
    }
  }
  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
