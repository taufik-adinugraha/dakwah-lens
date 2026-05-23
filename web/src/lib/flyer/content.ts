import type { DaleelRef } from "@/db/schema";
import type { DeliverableSlug } from "./design";

/**
 * Content extraction from the briefing markdown for use on flyers.
 *
 * The brief is a 6800-9400 word markdown document; the flyer needs to
 * compress it down to ONE headline + ONE daleel + a per-deliverable
 * pull-quote. These helpers do the shrinking deterministically (no LLM
 * call at flyer-generation time — keeps the flyer endpoint fast and
 * idempotent given the same brief).
 */

/** Strip markdown markers + collapse whitespace. Doesn't try to be a
 *  full markdown→text converter — enough to render plain text on the
 *  flyer. */
function stripMd(s: string): string {
  return s
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lift the first compelling sentence out of Section 1 (Ringkasan
 *  Eksekutif / Executive Summary). Used as the main brief flyer's
 *  headline. Falls back to the first 200 chars of the body if Section 1
 *  isn't found. */
export function extractHeadline(markdown: string, maxChars = 220): string {
  const lines = markdown.split("\n");
  // Find first H2 and its body up to the next H2.
  let s1Start = -1;
  let s1End = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      if (s1Start === -1) {
        s1Start = i + 1;
      } else {
        s1End = i;
        break;
      }
    }
  }
  const body = lines.slice(s1Start >= 0 ? s1Start : 0, s1End).join(" ");
  const clean = stripMd(body);
  // Pull the first 1-2 sentences.
  const sentenceMatch = clean.match(/^(.{40,}?[.!?])\s/);
  const out = sentenceMatch ? sentenceMatch[1] : clean.slice(0, maxChars);
  return out.length > maxChars ? out.slice(0, maxChars - 1).trimEnd() + "…" : out;
}

/** Extract the body of a specific Section 4 sub-section (h3) from the
 *  markdown — used for the per-deliverable flyer's pull-quote. */
export function extractDeliverableBody(
  markdown: string,
  slug: DeliverableSlug,
): string | null {
  // Match h3 headings against known deliverable kinds.
  const patterns: Record<DeliverableSlug, RegExp[]> = {
    khutbah: [/^###\s+.*khutbah/i, /^###\s+.*friday/i],
    kajian: [/^###\s+.*kajian/i, /^###\s+.*majelis/i],
    home: [/^###\s+.*rumah/i, /^###\s+.*home/i, /^###\s+.*teaching at/i],
    content: [
      /^###\s+.*konten/i,
      /^###\s+.*content/i,
      /^###\s+.*kreator/i,
    ],
    genz: [/^###\s+.*gen[\s-]?z/i, /^###\s+.*reaching gen/i],
    action: [
      /^###\s+.*aksi/i,
      /^###\s+.*khidmah/i,
      /^###\s+.*social action/i,
      /^###\s+.*service to/i,
    ],
  };
  const matchers = patterns[slug];
  const lines = markdown.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (matchers.some((re) => re.test(lines[i]))) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (lines[i].startsWith("### ") || lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

/** Pull a deliverable-specific message — the most compelling 1-2
 *  sentence excerpt from the deliverable body. Skips formulaic openings
 *  (mukadimah, basmalah, salam) which dominate the first 100 words of a
 *  khutbah but aren't the message worth posting on Instagram. */
export function extractDeliverableQuote(
  body: string,
  maxChars = 280,
): string {
  // Drop lines that look like formal openings/closings.
  const skipPatterns = [
    /assalamu['ʼ]?alaikum/i,
    /alhamdulillah/i,
    /allahumma/i,
    /asyhadu/i,
    /bismillah/i,
    /baarakallahu/i,
    /shallallahu/i,
    /^\s*\*[^*]+\*\s*$/, // pure italic line (often Arabic opening)
  ];
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => stripMd(p))
    .filter((p) => p.length > 60)
    .filter((p) => !skipPatterns.some((re) => re.test(p)));

  if (!paragraphs.length) return stripMd(body).slice(0, maxChars);

  // Prefer a paragraph that mentions a real-world event hook (an outlet
  // name, a specific noun) — gives the flyer more weight than a generic
  // moral statement.
  const outletHook = /(Detik|Liputan6|Kompas|Republika|CNN|Tempo|Antara|Tribun|Sindonews|Banjarmasin|RRI|Okezone|Wartakota)/i;
  const withHook = paragraphs.find((p) => outletHook.test(p));
  const candidate = withHook ?? paragraphs[0];

  // Pull 1-2 sentences from the candidate.
  const sentenceMatch = candidate.match(/^(.{60,}?[.!?])\s/);
  const out = sentenceMatch ? sentenceMatch[1] : candidate.slice(0, maxChars);
  return out.length > maxChars
    ? out.slice(0, maxChars - 1).trimEnd() + "…"
    : out;
}

/** Pick the daleel to feature on the flyer. The rerank pass in
 *  insights_summary already orders by thematic relevance, so the first
 *  usable entry is usually the best. Prefer entries with both arabic +
 *  a non-empty translation in the user's locale (Quran has both ID + EN
 *  in our corpus; hadith may lack translation_id until the just-in-time
 *  translation pass runs).
 *
 *  `rank` selects which usable entry to return: 0 = first usable (the
 *  default), 1 = second usable, etc. Used by the Gen-Z flyer to pick a
 *  different daleel from the general flyer so the two share-cards don't
 *  visually duplicate. Falls back gracefully — if `rank` is past the
 *  end, returns the last usable entry (or null if none). */
export function pickFlyerDaleel(
  refs: DaleelRef[] | null,
  locale: "id" | "en",
  rank = 0,
): DaleelRef | null {
  if (!refs || refs.length === 0) return null;
  const usable = refs.filter((r) => {
    const tr = locale === "en" ? r.translation_en : r.translation_id;
    return r.arabic && tr;
  });
  if (usable.length) {
    return usable[Math.min(rank, usable.length - 1)];
  }
  // Fall back to anything with arabic; same rank semantics.
  const withArabic = refs.filter((r) => r.arabic);
  if (withArabic.length) {
    return withArabic[Math.min(rank, withArabic.length - 1)];
  }
  return refs[Math.min(rank, refs.length - 1)];
}

/** Extract a punchy hook line from the Gen Z sub-section for the Gen-Z
 *  flyer's hero headline. The Gen Z section in the long-form brief leads
 *  with a Hook + pop-culture-bridge paragraph; we lift the first
 *  substantive sentence as the flyer headline. Falls back to the section
 *  intro if no dedicated Hook sub-heading is found. */
export function extractGenZHook(markdown: string, maxChars = 110): string {
  const genzBody = extractDeliverableBody(markdown, "genz");
  if (!genzBody) {
    // No Gen Z section — fall back to the brief's main headline.
    return extractHeadline(markdown, maxChars);
  }

  // Try to find a `**Hook**` / `**Pop-culture bridge**` sub-section first.
  const hookMatch = genzBody.match(
    /\*\*(?:hook|pop[\s-]?culture(?:\s+bridge)?|jembatan(?:\s+pop[\s-]?culture)?)\*\*\s*[:\-—–]?\s*([\s\S]+?)(?=\n\s*[-*]\s*\*\*|\n\s*\*\*[A-Z]|\n##|\n###|$)/i,
  );
  const candidateBlock = hookMatch ? hookMatch[1] : genzBody;
  const clean = stripMd(candidateBlock);

  // First sentence (40-130 chars window — keeps it punchy).
  const sentenceMatch = clean.match(/^(.{40,140}?[.!?])\s/);
  const out = sentenceMatch ? sentenceMatch[1] : clean.slice(0, maxChars);
  return out.length > maxChars
    ? out.slice(0, maxChars - 1).trimEnd() + "…"
    : out;
}

/** Indonesian / English short date for the flyer footer. */
export function formatFlyerDate(d: Date, locale: "id" | "en"): string {
  return d.toLocaleDateString(locale === "en" ? "en-US" : "id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}
