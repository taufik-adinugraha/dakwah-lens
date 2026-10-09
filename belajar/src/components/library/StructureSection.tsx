import type { Ayah } from "@/content/schema";
import { Link } from "@/i18n/navigation";

import { DraftChip } from "../lesson/DraftChip";

/**
 * "Struktur ayat": how the words fit together (nahwu, the tarkib). Words are
 * shown as they are in the mushaf, each with its role beneath; named groups
 * (an idhafah chain, a na't pair, a badal) are listed with their concept.
 */
export function StructureSection({
  ayah,
  labels,
  conceptTitle,
}: {
  ayah: Ayah;
  labels: { heading: string; groups: string; sources: string; draft: string };
  conceptTitle: Record<string, string>;
}) {
  const st = ayah.structure;
  if (!st) return null;
  return (
    <section className="mt-10 rounded-2xl border border-hairline bg-white p-5 sm:p-6" aria-labelledby="structure">
      <h2 id="structure" className="font-display text-2xl font-medium">
        {labels.heading}
      </h2>
      <p className="mt-1 text-sm font-semibold text-forest">{st.type}</p>
      <p className="mt-2 text-pretty leading-relaxed">{st.summary}</p>

      <ol dir="rtl" className="mt-5 flex flex-wrap justify-center gap-x-3 gap-y-4">
        {ayah.words.map((w) => (
          <li key={w.loc} className="flex flex-col items-center">
            <span lang="ar" className="quran text-2xl leading-[1.9]">
              {w.ar}
            </span>
            {w.role ? (
              <span dir="ltr" className="mt-0.5 max-w-28 text-center text-[11px] leading-tight text-ink-muted">
                {w.role}
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {st.groups.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {labels.groups}
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {st.groups.map((g) => (
              <li key={`${g.label}-${g.words.join("-")}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span lang="ar" dir="rtl" className="font-arabic text-lg">
                  {g.words.map((i) => ayah.words[i - 1]?.ar).filter(Boolean).join(" · ")}
                </span>
                <span>— {g.label}</span>
                {g.concept && conceptTitle[g.concept] ? (
                  <Link href={`/konsep/${g.concept}`} className="text-forest underline decoration-forest/30 underline-offset-2">
                    {conceptTitle[g.concept]}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[11px] text-ink-faint">
        {labels.sources}: {st.sources.map((s) => (s.ref ? `${s.kitab} ${s.ref}` : s.kitab)).join(" · ")}
      </p>
      {st.status === "draft" ? <DraftChip label={labels.draft} /> : null}
    </section>
  );
}
