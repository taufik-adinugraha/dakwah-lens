import { SITE_URL } from "@/lib/seo";

/**
 * JSON-LD schema.org builders for the public content.
 *
 * Sharia/brand discipline (per AGENTS.md): everything is descriptive
 * `Article` / `FAQPage` metadata — NEVER a schema type that implies an
 * authoritative religious ruling. `author`/`publisher` are the ORGANISATION
 * (Sukses & Berkah Group / Dakwah-Lens), never a named individual scholar,
 * consistent with the "AI-assisted, not authoritative fatwa" framing.
 */

type Json = Record<string, unknown>;

const PUBLISHER: Json = {
  "@type": "Organization",
  name: "Dakwah-Lens",
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: `${SITE_URL}/dakwah-lens-logo-long-removebg.png`,
  },
};

const AUTHOR: Json = { "@type": "Organization", name: "Sukses & Berkah Group" };

/** Strip markdown to readable plain text (keeps Arabic; collapses space). */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Arabic-script Unicode ranges (core + supplement + extended-A + presentation
// forms A/B). The core ؀-ۿ block already covers Arabic punctuation
// and harakat, so a run may span internal whitespace between words.
const ARABIC_RUN =
  /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+(?:\s+[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+)*/g;

/**
 * Meta-description text for a briefing deliverable section. On top of
 * stripMarkdown it (a) removes the internal script cue-labels the
 * content/kreator deliverables carry ("HOOK (5 detik):", "BODY (40-60
 * detik):", "CTA (5-10 detik):") and (b) drops Arabic-script runs so a
 * khutbah/kajian page — whose body opens with the retrieved daleel — does
 * not emit an all-Arabic snippet; Google then shows the Latin prose that
 * actually describes the page. Trimmed to ~155 chars at a word boundary;
 * returns undefined when nothing meaningful survives.
 */
export function deliverableMetaDescription(
  bodyMarkdown: string,
): string | undefined {
  let s = stripMarkdown(bodyMarkdown);
  // Duration cue-labels: an all-caps tag + "(… detik …)" + optional colon.
  s = s.replace(/\b[A-Z][A-Za-z]*\s*\([^)]*\bdetik\b[^)]*\)\s*:?\s*/g, " ");
  // The retrieved daleel prints Arabic first — drop the Arabic-script runs.
  s = s.replace(ARABIC_RUN, " ");
  // Clean the punctuation debris left between removed Arabic clauses
  // (". . ." between two ex-Arabic sentences) and any leading orphans.
  s = s
    .replace(/(?:[.,;:!?]\s*){2,}/g, " ")
    .replace(/^[\s.,;:!?]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return undefined;
  return s.length > 155 ? s.slice(0, 152).replace(/\s+\S*$/, "") + "…" : s;
}

export function articleSchema(opts: {
  url: string;
  headline: string;
  bodyMarkdown: string;
  datePublished: Date;
  locale: string;
  section?: string | null;
}): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline.slice(0, 110),
    description: stripMarkdown(opts.bodyMarkdown).slice(0, 300),
    inLanguage: opts.locale,
    datePublished: opts.datePublished.toISOString(),
    dateModified: opts.datePublished.toISOString(),
    author: AUTHOR,
    publisher: PUBLISHER,
    isAccessibleForFree: true,
    ...(opts.section ? { articleSection: opts.section } : {}),
    mainEntityOfPage: { "@type": "WebPage", "@id": opts.url },
    url: opts.url,
  };
}

export function breadcrumbSchema(
  items: Array<{ name: string; url: string }>,
): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/**
 * Build a FAQPage from a deliverable section's `#### Tanya-Jawab` block
 * (`**T:**` / `**J:**` pairs). Returns null when the block is absent or has
 * fewer than 2 pairs. The Q&A is real, visible on-page content.
 */
export function faqSchemaFromSection(bodyMarkdown: string): Json | null {
  const idx = bodyMarkdown.search(/^#{3,4}\s+Tanya-Jawab\b/im);
  if (idx === -1) return null;
  // The Tanya-Jawab block runs until the next heading.
  const after = bodyMarkdown.slice(idx).replace(/^#{3,4}\s+Tanya-Jawab\b.*$/im, "");
  const block = after.split(/^#{2,4}\s+/m)[0];

  const qa: Array<{ q: string; a: string }> = [];
  let q = "";
  let a: string[] = [];
  const flush = () => {
    if (q && a.length) qa.push({ q, a: a.join(" ").trim() });
  };
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    const tm = line.match(/^\*\*T:\*\*\s*(.+)$/);
    const jm = line.match(/^\*\*J:\*\*\s*(.+)$/);
    if (tm) {
      flush();
      q = stripMarkdown(tm[1]);
      a = [];
    } else if (jm) {
      a = [stripMarkdown(jm[1])];
    } else if (a.length && line) {
      a.push(stripMarkdown(line));
    }
  }
  flush();
  if (qa.length < 2) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map(({ q: name, a: text }) => ({
      "@type": "Question",
      name: name.slice(0, 200),
      acceptedAnswer: { "@type": "Answer", text: text.slice(0, 900) },
    })),
  };
}

export function organizationSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Dakwah-Lens",
    alternateName: "Sukses & Berkah Group",
    url: SITE_URL,
    logo: `${SITE_URL}/dakwah-lens-logo-long-removebg.png`,
    // Verified brand profiles — connects the entity for brand SERP / panel.
    sameAs: ["https://www.facebook.com/p/Dakwah-Lens-61590429377695/"],
  };
}

export function websiteSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Dakwah-Lens",
    url: SITE_URL,
    inLanguage: "id",
  };
}
