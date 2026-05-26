import ReactMarkdown, { type Components } from "react-markdown";

import type { MahasiswaQAPair } from "@/lib/flyer/content";

type Palette = {
  bgLight: string;
  bgMid: string;
  bgDeep: string;
  accent: string;
  accentDeep: string;
  soft: string;
  quoteBg: string;
  quoteBorder: string;
};

/** Magazine-style article surface — large-readable prose for the
 *  scanned-in reader. Lead paragraph gets a left accent rail; H3 acts
 *  as a colored pill chip; blockquotes pop with the segment accent. */
export function Article({
  article,
  qa,
  palette,
  qaLabel,
}: {
  article: string;
  qa: MahasiswaQAPair[];
  palette: Palette;
  qaLabel: string;
}) {
  const components = makeArticleComponents(palette);

  return (
    <article className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <div
        className="rounded-3xl border bg-white px-6 py-10 shadow-sm sm:px-12 sm:py-14"
        style={{ borderColor: palette.soft + "80" }}
      >
        <ReactMarkdown components={components}>{article}</ReactMarkdown>
      </div>

      {qa.length > 0 && (
        <section className="mt-12">
          <div className="mb-7 flex items-center gap-3">
            <span
              className="inline-block h-7 w-1.5 rounded-full"
              style={{ background: palette.accent }}
            />
            <h2
              className="text-balance text-2xl font-extrabold tracking-tight sm:text-3xl"
              style={{ color: palette.accentDeep }}
            >
              {qaLabel}
            </h2>
          </div>

          <ol className="space-y-6">
            {qa.map((pair, i) => (
              <li
                key={i}
                className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8"
                style={{ borderColor: palette.soft + "70" }}
              >
                <div
                  className="mb-3 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em]"
                  style={{
                    background: palette.quoteBg,
                    color: palette.accentDeep,
                  }}
                >
                  Q · {String(i + 1).padStart(2, "0")}
                </div>
                <p
                  className="text-pretty text-lg font-semibold leading-snug text-slate-900"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {pair.question}
                </p>
                <div
                  className="mt-5 border-l-4 pl-5"
                  style={{ borderColor: palette.accent }}
                >
                  <div
                    className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.18em]"
                    style={{ color: palette.accent }}
                  >
                    A
                  </div>
                  <p className="text-pretty text-[15px] leading-[1.75] text-slate-700 sm:text-base">
                    {pair.answer}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}

function makeArticleComponents(palette: Palette): Components {
  let isFirstPara = true;
  return {
    h1: ({ children }) => (
      <h1 className="mt-8 mb-4 text-balance text-3xl font-extrabold tracking-tight text-slate-900 first:mt-0 sm:text-4xl">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        className="mt-10 mb-4 flex items-center gap-3 text-balance text-2xl font-extrabold tracking-tight first:mt-0 sm:text-3xl"
        style={{ color: palette.accentDeep }}
      >
        <span
          aria-hidden
          className="inline-block h-7 w-1.5 rounded-full"
          style={{ background: palette.accent }}
        />
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        className="mt-8 mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-[0.18em]"
        style={{ background: palette.quoteBg, color: palette.accentDeep }}
      >
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-6 mb-2 flex items-baseline gap-2.5 text-balance text-lg font-bold tracking-tight text-slate-900">
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: palette.accent }}
        />
        <span>{children}</span>
      </h4>
    ),
    p: ({ children }) => {
      const lead = isFirstPara;
      isFirstPara = false;
      if (lead) {
        return (
          <p
            className="relative mb-5 mt-2 pl-5 text-pretty text-[17px] leading-[1.85] text-slate-800 sm:text-[19px]"
            style={{ letterSpacing: "-0.005em" }}
          >
            <span
              aria-hidden
              className="absolute left-0 top-2 bottom-2 w-1.5 rounded-full"
              style={{ background: palette.accent, opacity: 0.7 }}
            />
            {children}
          </p>
        );
      }
      return (
        <p className="mt-4 text-pretty text-[15px] leading-[1.85] text-slate-700 sm:text-base">
          {children}
        </p>
      );
    },
    ul: ({ children }) => (
      <ul className="mt-4 ml-1 list-disc space-y-2.5 pl-5 text-[15px] leading-[1.78] text-slate-700">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mt-4 ml-1 list-decimal space-y-2.5 pl-5 text-[15px] leading-[1.78] text-slate-700 marker:font-extrabold marker:text-slate-500">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="pl-1">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote
        className="my-6 rounded-2xl border-l-4 px-6 py-4 shadow-sm"
        style={{
          background: palette.quoteBg,
          borderColor: palette.accent,
          color: palette.accentDeep,
        }}
      >
        <div className="text-[15px] leading-[1.7]">{children}</div>
      </blockquote>
    ),
    strong: ({ children }) => (
      <strong className="font-bold text-slate-900">{children}</strong>
    ),
    em: ({ children }) => <em className="italic text-slate-700">{children}</em>,
    hr: () => (
      <div className="my-10 flex items-center gap-3">
        <span className="h-px flex-1 bg-gradient-to-r from-transparent to-slate-300" />
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: palette.accent }}
        />
        <span className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-300" />
      </div>
    ),
  };
}
