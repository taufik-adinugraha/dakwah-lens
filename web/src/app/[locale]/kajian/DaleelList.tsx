import type { BriefDaleel } from "@/db/schema";

export function DaleelList({
  daleel,
  locale,
  heading,
}: {
  daleel: BriefDaleel[];
  locale: "id" | "en";
  heading: string;
}) {
  if (daleel.length === 0) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-base font-semibold text-slate-900">{heading}</h2>
      <ol className="mt-4 space-y-5">
        {daleel.map((d, i) => (
          <li key={i} className="border-l-2 border-brand-300 pl-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
              {d.source}
              {d.also_found_in && d.also_found_in.length > 0 && (
                <span className="ml-1 text-slate-400">
                  · {locale === "id" ? "juga di" : "also in"}{" "}
                  {d.also_found_in.map((a) => a.source).join(", ")}
                </span>
              )}
            </p>
            {d.arabic && (
              <p
                dir="rtl"
                lang="ar"
                className="mt-2 text-xl leading-loose text-slate-900"
                style={{ fontFamily: '"Scheherazade New", "Amiri", serif' }}
              >
                {d.arabic}
              </p>
            )}
            {d.translation && (
              <p className="mt-1 text-sm italic leading-relaxed text-slate-700">
                &ldquo;{d.translation}&rdquo;
              </p>
            )}
            {d.explanation && (
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {d.explanation}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
