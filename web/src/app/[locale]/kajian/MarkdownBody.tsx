import { Fragment, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

/**
 * Markdown renderer for kajian body text (khutbah_pertama, khutbah_kedua,
 * kultum body, kajian umum talking-point body).
 *
 * Solves three issues the previous `whitespace-pre-wrap` raw-string
 * approach had:
 *   - **bold**, ## headings, bullet lists now render properly
 *   - Arabic-script runs get a larger font + serif treatment so the
 *     mimbar reader can actually see the harakat
 *   - Prose typography (line-height, paragraph spacing) consistent
 *     with the draft detail page's analysis section
 *
 * The Arabic wrapping happens at the leaf text level — every `<p>`,
 * `<li>`, `<strong>`, etc. funnels its text children through
 * `enhanceArabic` which splits on Arabic Unicode runs and wraps them.
 */

// Arabic Unicode ranges: basic + supplement + presentation A/B.
// Plus diacritics, punctuation, and intra-Arabic whitespace so a
// multi-word Arabic phrase stays in one captured run.
const ARABIC_RUN =
  /([؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿][؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿\s،؛؟ـ]*)/g;

function enhanceArabic(input: ReactNode): ReactNode {
  if (typeof input !== "string") {
    if (Array.isArray(input)) {
      return input.map((child, i) => (
        <Fragment key={i}>{enhanceArabic(child)}</Fragment>
      ));
    }
    return input;
  }
  if (!/[؀-ۿ]/.test(input)) return input;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  ARABIC_RUN.lastIndex = 0;
  while ((match = ARABIC_RUN.exec(input)) !== null) {
    if (match.index > lastIndex) {
      parts.push(input.slice(lastIndex, match.index));
    }
    parts.push(
      <span
        key={key++}
        lang="ar"
        dir="rtl"
        className="inline-block align-middle text-2xl leading-loose mx-0.5"
        style={{ fontFamily: '"Scheherazade New", "Amiri", serif' }}
      >
        {match[0].trim()}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < input.length) parts.push(input.slice(lastIndex));
  return parts;
}

const COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="my-3 text-pretty leading-relaxed text-slate-800">
      {enhanceArabic(children as ReactNode)}
    </p>
  ),
  li: ({ children }) => (
    <li className="my-1 leading-relaxed text-slate-800">
      {enhanceArabic(children as ReactNode)}
    </li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-slate-900">
      {enhanceArabic(children as ReactNode)}
    </strong>
  ),
  em: ({ children }) => (
    <em className="italic text-slate-700">
      {enhanceArabic(children as ReactNode)}
    </em>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 mb-2 text-lg font-semibold text-slate-900">
      {enhanceArabic(children as ReactNode)}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 mb-2 text-base font-semibold text-slate-900">
      {enhanceArabic(children as ReactNode)}
    </h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-emerald-300 bg-emerald-50/30 py-2 pl-4 italic text-slate-700">
      {enhanceArabic(children as ReactNode)}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-slate-200" />,
};

export function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="prose prose-slate max-w-none text-sm sm:text-base prose-p:my-3 prose-li:my-1 prose-ul:my-3 prose-ol:my-3 prose-strong:text-slate-900">
      <ReactMarkdown components={COMPONENTS}>{text}</ReactMarkdown>
    </div>
  );
}
