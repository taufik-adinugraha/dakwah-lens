import { Children, Fragment, isValidElement, type ReactNode } from "react";

/**
 * Wrap inline Arabic-script runs in <bdi dir="rtl" font-amiri> so a
 * paragraph that mixes Indonesian prose with an inline Arabic phrase
 * renders the Arabic in its proper script direction + sacred-text font,
 * without flipping the surrounding paragraph to dir="rtl" (which would
 * bidi-reorder the Latin text into the jumbled output the user reported
 * 2026-06-06).
 *
 * Why <bdi> and not just <span dir="rtl">: <bdi> means "Bi-Directional
 * Isolate" — the browser treats its content's directionality as opaque
 * to the surrounding paragraph, so an Arabic phrase mid-sentence
 * doesn't drag adjacent Indonesian words into its own direction.
 *
 * Standalone Arabic paragraphs (≥40% Arabic, <15% Latin) are already
 * handled at the paragraph level — caller checks the threshold and
 * renders the green Amiri card with dir="rtl" before deferring here.
 * This function is for the IN-PROSE inline case: prose with a 1-2-line
 * Arabic phrase that should keep flowing inline.
 *
 * Recursive: walks element children so an Arabic phrase nested inside
 * <em>, <strong>, etc. also gets the wrapper.
 *
 * Threshold: 3+ consecutive Arabic chars per run. Below that is a
 * single-token Arabic word (ﷺ honorific, Allah Ta'ala diacritic, etc.)
 * that the browser handles fine on its own; wrapping every <bdi> on
 * one-char tokens just adds DOM noise.
 */

const ARABIC_RUN_RE = /([؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]{3,}(?:[\s؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]*[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿])*)/g;

export function wrapInlineArabic(children: ReactNode): ReactNode {
  return mapChildren(children, (node, key) => {
    if (typeof node === "string") {
      return splitArabicRuns(node, key);
    }
    if (typeof node === "number" || node === null || node === undefined) {
      return node;
    }
    if (isValidElement(node)) {
      const el = node as React.ReactElement<{ children?: ReactNode }>;
      if (el.props && "children" in el.props) {
        const wrapped = wrapInlineArabic(el.props.children);
        // Only clone if children changed — avoids needless re-renders
        // when the subtree has no Arabic at all.
        if (wrapped !== el.props.children) {
          return {
            ...el,
            props: { ...el.props, children: wrapped },
            key: el.key ?? key,
          } as ReactNode;
        }
      }
      return el;
    }
    return node;
  });
}

function splitArabicRuns(text: string, baseKey: string | number): ReactNode {
  if (!text || !ARABIC_RUN_RE.test(text)) return text;
  // Reset lastIndex — `test()` advanced it on the global regex above.
  ARABIC_RUN_RE.lastIndex = 0;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let i = 0;
  for (const match of text.matchAll(ARABIC_RUN_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push(text.slice(cursor, start));
    }
    parts.push(
      <bdi
        key={`${baseKey}-ar-${i++}`}
        dir="rtl"
        className="font-amiri text-[1.1em]"
      >
        {match[0]}
      </bdi>,
    );
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return <Fragment key={`${baseKey}-frag`}>{parts}</Fragment>;
}

function mapChildren(
  children: ReactNode,
  fn: (node: ReactNode, key: number) => ReactNode,
): ReactNode {
  const arr = Children.toArray(children);
  const out: ReactNode[] = [];
  let mutated = false;
  arr.forEach((node, i) => {
    const mapped = fn(node, i);
    if (mapped !== node) mutated = true;
    out.push(mapped);
  });
  return mutated ? out : children;
}
