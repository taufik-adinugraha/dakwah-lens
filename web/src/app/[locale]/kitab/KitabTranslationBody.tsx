import { Fragment, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

/**
 * Markdown renderer for kitab hit translations.
 *
 * The seven manually-translated classical kitabs (ts3, aqidah, nashaih,
 * adab, fqarib, bidayat, syamail) carry Markdown in their `id` payload
 * field — headings, bold matn citations, bullets. Rendering the field
 * as raw text leaked literal `###` and `**` into the UI; this component
 * fixes that by parsing the Markdown and projecting it through styles
 * tuned for a list-item context (smaller than the kajian/khutbah
 * `MarkdownBody` which targets full-document prose).
 *
 * Inline Arabic phrases (matn citations like `(و) الثالث (بيع عين غائبة)`)
 * get a slightly larger serif Arabic font so they stand out from the
 * Indonesian sharh — same Scheherazade/Amiri stack as MarkdownBody but
 * one step down in size to fit the list density.
 *
 * Note: H2/H3 markdown headings are projected to `<h3>` / `<h4>` HTML
 * because the page already owns the H2 slot; kitab hits should not
 * introduce competing top-level headings.
 */

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
        className="inline-block align-middle text-lg leading-loose mx-0.5"
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
    <p className="mt-2 text-sm leading-relaxed text-slate-700">
      {enhanceArabic(children as ReactNode)}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mt-2 ml-5 list-disc space-y-0.5 text-sm text-slate-700">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 ml-5 list-decimal space-y-0.5 text-sm text-slate-700">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed">{enhanceArabic(children as ReactNode)}</li>
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
  h1: ({ children }) => (
    <h3 className="mt-3 text-sm font-semibold text-slate-900">
      {enhanceArabic(children as ReactNode)}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-3 text-sm font-semibold text-slate-900">
      {enhanceArabic(children as ReactNode)}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-3 text-sm font-semibold text-slate-900">
      {enhanceArabic(children as ReactNode)}
    </h4>
  ),
  h4: ({ children }) => (
    <h5 className="mt-2 text-sm font-semibold text-slate-800">
      {enhanceArabic(children as ReactNode)}
    </h5>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-emerald-300 bg-emerald-50/30 py-1 pl-3 italic text-slate-600">
      {enhanceArabic(children as ReactNode)}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-slate-200" />,
  code: ({ children }) => (
    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-800">
      {children}
    </code>
  ),
};

export function KitabTranslationBody({ text }: { text: string }) {
  return <ReactMarkdown components={COMPONENTS}>{text}</ReactMarkdown>;
}
