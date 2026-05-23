import type { DaleelRef } from "@/db/schema";
import type { DeliverableSlug } from "./design";

/**
 * Content extraction from the briefing markdown for the 4 shareable
 * flyers (2 general + 2 Gen-Z themed).
 *
 * Each flyer carries 3 text elements:
 *   1) HEADLINE — 4-5 impactful words (a tagline, not a sentence).
 *   2) MESSAGE  — 3-4 sentence concise actionable paragraph (problem →
 *      what we can do → small first step). NOT stats narration.
 *   3) DALEEL   — one entry from the retrieved pool (cycled by rank).
 *
 * These helpers extract those elements deterministically from the
 * existing briefing markdown, no extra LLM call required. Each variant
 * pulls from a different slice of the briefing so the 4 flyers do not
 * visually duplicate.
 */

/** Strip markdown markers + collapse whitespace. */
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

/** Find the lines of a named H3 sub-section. Returns the raw lines
 *  between the matching `### ...` and the next H3 / H2. */
function sliceSubSection(markdown: string, matcher: RegExp): string[] {
  const lines = markdown.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (matcher.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (lines[i].startsWith("### ") || lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

/** Tidy a headline candidate: trim quotes, em-dashes, trailing
 *  punctuation. Cap at maxWords words so we keep the "punchy tagline"
 *  feel (the user spec is 4-5 words). */
function tidyHeadline(raw: string, maxWords = 6): string {
  let h = raw.trim();
  // Drop surrounding quotes / asterisks / quotes-with-spaces.
  h = h.replace(/^["“”'']\s*/, "").replace(/\s*["“”'']$/, "");
  // Drop trailing period / colon / em-dash content.
  h = h.replace(/\s*[—–-]\s*.*$/, "");
  // Drop trailing punctuation.
  h = h.replace(/[.,:;!?]+$/, "");
  // Collapse whitespace.
  h = h.replace(/\s+/g, " ").trim();
  // Cap word count.
  const words = h.split(" ");
  if (words.length > maxWords) {
    h = words.slice(0, maxWords).join(" ");
  }
  return h;
}

/** Drop sentences that only make sense in their original deliverable
 *  context (a Friday khutbah, a Sunday discussion, a Kreator script).
 *  The flyer is read standalone — references to "this khutbah", "this
 *  discussion", "thanks guys", "the X topics above", etc. read as
 *  nonsense in that context. */
const FORMAT_REFERENCE_RE = /\b(?:mari kita tutup|kita tutup|khutbah ini|kajian ini|diskusi (?:ini|malam ini)|thanks guys|guys,|sidang jum'?at|ma['ʼ]?asyiral|jamaah|jama['ʼ]?ah|hadirin|rahimakumullah|mukmin sekalian|bapak[- ]?ibu|ibu[- ]?ibu yang|kakak[- ]?kakak yang|adik[- ]?adik yang|sekian|wallahu a['ʼ]?lam|video ini|reel ini|caption ini|outline ini|materi ini|sesi ini|pertemuan ini|pekan depan kita|sesi (?:tadi|hari ini)|saat khutbah|saat kajian|topik(?:-topik)? di atas|topik(?:-topik)? tersebut|(?:dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh) topik|kategori di atas|ringkasan di atas|bagian di atas|tabel di atas|section\s+(?:above|di atas)|paragraf di atas|the (?:eight|seven|six|five|four|three|two|nine|ten) topics|topics? above|sections? above|the table above|as (?:noted|shown) above)\b/i;

/** Drop visual-direction / stage cues that creep in from the Kreator
 *  script when its prose is lifted into the flyer message. */
const STAGE_CUE_RE = /\(visual:|\(scene:|\(transisi|\(b-roll|\(teks (?:di|akhir|layar)/i;

/** Trim a body block to ~3-4 short sentences, capped at maxChars.
 *  Drops Arabic-heavy passages, drops sentences with deliverable
 *  format references, drops stage cues. Result is suitable for a
 *  standalone flyer message. */
function trimToSentences(raw: string, targetSentences = 3, maxChars = 320): string {
  const clean = stripMd(raw);
  if (isArabicHeavy(clean)) return "";
  // Indonesian uses `.` as thousand separator AND `,` as decimal sep
  // ("Rp 1.000", "Rp 50.000", "12,5%"). The naive `[.!?]+` sentence
  // regex was splitting "Rp 1.000" into "Rp 1." + "000" and the flyer
  // ended up showing "menabung Rp 1." — meaningless. Protect numeric
  // periods with a private-use placeholder, split, then restore.
  const SEP = "\uE000";
  const protectedText = clean.replace(/(\d)\.(?=\d)/g, `$1${SEP}`);
  const sentences = (protectedText.match(/[^.!?]+[.!?]+/g) ?? [protectedText]).map(
    (s) => s.replace(new RegExp(SEP, "g"), "."),
  );
  let out = "";
  let acceptedCount = 0;
  for (let i = 0; i < sentences.length && acceptedCount < targetSentences + 2; i++) {
    const s = sentences[i];
    if (isArabicHeavy(s)) continue;
    if (FORMAT_REFERENCE_RE.test(s)) continue;
    if (STAGE_CUE_RE.test(s)) continue;
    const next = (out + " " + s).trim();
    if (next.length > maxChars && out.length > 0) break;
    out = next;
    acceptedCount += 1;
    if (acceptedCount >= targetSentences && out.length > maxChars * 0.7) break;
  }
  if (out.length > maxChars) {
    out = out.slice(0, maxChars - 1).trimEnd() + "…";
  }
  return out.replace(/^["“]\s*|\s*["”]$/g, "").trim();
}

/** True if more than 40% of the letter chars are in the Arabic Unicode
 *  block. Used to skip Quranic ayat / closing du'a passages so the
 *  flyer message never lands on Arabic the reader can't act on. */
function isArabicHeavy(s: string): boolean {
  const arabic = (s.match(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g) ?? []).length;
  const letters = (s.match(/[\p{L}]/gu) ?? []).length;
  if (letters < 30) return false;
  return arabic / letters > 0.4;
}

// ──────────────────────────────────────────────────────────────────
// Headline extractors (4-5 word taglines)
// ──────────────────────────────────────────────────────────────────

/** Pull the Khutbah Jumat tagline. Handles three real styles:
 *    `**Tema: "Sembelih Nafsumu Sebelum Kurbanmu — Menegakkan Adil…"**` (Claude, quoted + em-dash)
 *    `**Tema: Generasi Pemegang Amanah — Anak Muda di Persimpangan**` (Claude, unquoted + em-dash)
 *    `**Tema: Amanah yang Tercabik: Dari Istana hingga Ruang Keluarga**` (Gemini, colon-split)
 *  Returns 4-6 word phrase. Falls back to the first non-citation bold. */
export function extractKhutbahTagline(markdown: string): string {
  const body = sliceSubSection(markdown, /^###\s+.*khutbah/i).join("\n");
  if (!body) return "";

  // Pull the full **Tema: ...** line, then trim it down. Captures
  // until the line's closing `**` — allows italic markers (`*Amanah*`)
  // inside the captured tagline.
  const themaLine = body.match(/\*\*\s*tema\s*[:：]\s*([^\n]+?)\s*\*\*\s*$/im);
  if (themaLine && themaLine[1]) {
    let phrase = themaLine[1].trim();
    // Drop inline italic markers (`*amanah*` → `amanah`).
    phrase = phrase.replace(/\*([^*\n]+?)\*/g, "$1");
    // Strip surrounding quotes if present.
    phrase = phrase.replace(/^["“”'']\s*/, "").replace(/\s*["“”'']$/, "");
    // Split on em-dash or colon-after-cap (Gemini-style "X: Y subtitle")
    // — take the part before. Em-dash beats colon when both exist.
    if (/[—–]/.test(phrase)) {
      phrase = phrase.split(/\s*[—–]\s*/)[0];
    } else if (/:\s+[A-Z]/.test(phrase)) {
      phrase = phrase.split(/:\s+(?=[A-Z])/)[0];
    }
    const tidied = tidyHeadline(phrase, 6);
    if (tidied) return tidied;
  }

  // Fallback: first bold phrase that isn't a kitab citation or a
  // structural khutbah section label. Without the structural-label
  // filter, the regex was picking up `**KHUTBAH PERTAMA**` (the
  // opening section marker in Claude-written briefings) as the
  // flyer title — meaningless on a standalone flyer.
  const allBold = [...body.matchAll(/\*\*([^*\n]{8,70})\*\*/g)];
  const citationRe = /^(QS\.|Sahih |Riyad |Bulugh |HR\.|HQ\.|Surat\s|Hadits)/i;
  const structuralRe = /^(?:khutbah\s+(?:pertama|kedua|jumat|pembuka|penutup)|mukadimah|pembuka(?:an)?|penutup|inti(?:\s+khutbah)?|isi(?:\s+khutbah)?|doa(?:\s+penutup)?|do['ʼ']?a|hook|body|cta|teks(?:\s+layar)?|talking\s+point\s*\d*|setting|format|trigger|pertanyaan\s+lanjutan\s*\d*|framing\s+question|pop-?culture\s+bridge|sinergi(?:\s+&?\s*koordinasi)?|label\s+aksi|cara\s+kerja|budget|dampak\s+terukur|first\s+sermon|second\s+sermon|opening|closing)$/i;
  for (const b of allBold) {
    const phrase = b[1].trim();
    if (citationRe.test(phrase)) continue;
    if (structuralRe.test(phrase)) continue;
    return tidyHeadline(phrase, 6);
  }
  return "";
}

/** Pull the Aksi Sosial campaign tagline. Handles three styles:
 *    `**"Bulan Tegakkan Timbangan"**` (Claude — campaign month)
 *    `**Label aksi: "Sahabat Pulang Pengajian"**` (Claude — first action label)
 *    `**ACTION PLAN: INSIATIF "MIHRAB AMAN"**` (Gemini — initiative name)
 *  Prefers the quoted name when present (cleaner phrase). */
export function extractCampaignTagline(markdown: string): string {
  const body = sliceSubSection(markdown, /^###\s+.*aksi|^###\s+.*khidmah/i).join("\n");
  if (!body) return "";

  // Claude "Bulan X" — month-campaign name.
  const bulanMatch = body.match(/\*\*\s*["“]?\s*(Bulan\s+[A-Z][^"”*\n]{3,40})\s*["”]?\s*\*\*/);
  if (bulanMatch && bulanMatch[1]) return tidyHeadline(bulanMatch[1], 5);

  // Gemini "ACTION PLAN: INSIATIF/INISIATIF "X"" — prefer the quoted
  // initiative name (the chunk inside the smart quotes).
  const actionQuoted = body.match(/action\s+plan[^"\n]*["“]([A-Z][^"”\n]{4,50})["”]/i);
  if (actionQuoted && actionQuoted[1]) return tidyHeadline(actionQuoted[1], 5);

  // Claude "Label aksi: "X"" — first action's bolded label.
  const labelMatch = body.match(/label\s+aksi\s*[:：]\s*\*?\*?["“]?\s*([^"”*\n]{6,60})/i);
  if (labelMatch && labelMatch[1]) return tidyHeadline(labelMatch[1], 5);

  // Gemini fallback: ACTION PLAN: TEXT (no quote).
  const actionPlan = body.match(/\*\*action\s+plan\s*[:：]?\s*([^"”*\n]{6,60})/i);
  return actionPlan ? tidyHeadline(actionPlan[1], 5) : "";
}

/** Pull the on-screen text from the Kreator HOOK — usually a punchy
 *  ALL-CAPS slogan. Handles three styles:
 *    `teks layar: "PEKAN INI YANG DICURI BUKAN UANG"` (Claude — quoted slogan)
 *    `**Teks:** DOSA TERBESAR MINGGU INI...` (Gemini — bold marker, unquoted)
 *    Falls back to the first spoken **Kreator:** sentence. */
export function extractKreatorHook(markdown: string): string {
  const body = sliceSubSection(markdown, /^###\s+.*kreator|^###\s+.*content/i).join("\n");
  if (!body) return "";

  // 1) Quoted ALL-CAPS phrase anywhere in the section. Allow %, =, ×, :
  //    so slogans like "PINJOL × 1 KLIK = 365% RIBA PER TAHUN" match.
  const allQuoted = [...body.matchAll(/["“]([A-Z][A-Z0-9 %×=:\-?!,.]{5,90})["”]/g)];
  for (const m of allQuoted) {
    const phrase = m[1].trim();
    if (/^[A-Z]+$/.test(phrase) || phrase.split(" ").length < 2) continue;
    if (phrase.length >= 6) return tidyHeadline(phrase, 10);
  }

  // 2) `**(Teks: SLOGAN)**` or `**Teks: SLOGAN**` — Gemini's patterns
  //    (slogan inside the bold marker itself). Skip hashtag-only strings
  //    (those are end-card tag lines, not the hero slogan).
  for (const re of [
    /\*\*\(\s*teks[^:]*:\s*([^)*\n]+?)\)\s*\*\*/i,
    /\*\*\s*teks(?:\s+layar)?\s*[:：]\s*([A-Z][^*\n]{5,90})\s*\*\*/i,
  ]) {
    const m = body.match(re);
    if (m && m[1] && !/^#/.test(m[1].trim())) {
      return tidyHeadline(m[1], 10);
    }
  }

  // 3) `**Teks:** SLOGAN` — bold marker, then slogan on next line / same line.
  const teksBold = body.match(/\*\*\s*teks(?:\s+layar)?\s*[:：]\s*\*\*\s*([A-Z][A-Z0-9 %×=:\-?!,.…]{5,90})/);
  if (teksBold && teksBold[1]) return tidyHeadline(teksBold[1], 10);

  // 4) Plain "Teks: SLOGAN" without bold markers.
  const teksPlain = body.match(/teks(?:\s+layar)?\s*[:：]\s*([A-Z][A-Z0-9 %×=:\-?!,.…]{8,90})/);
  if (teksPlain && teksPlain[1]) return tidyHeadline(teksPlain[1], 10);

  // 5) First **Kreator:** dialog → first sentence if punchy enough.
  const krMatch = body.match(/\*\*\s*kreator\s*[:：]\s*\*\*\s*["“]?([^\n*"”]{20,200})/i);
  if (krMatch && krMatch[1]) {
    const firstSent = krMatch[1].match(/^([^.!?]+[.!?])/);
    return tidyHeadline(firstSent ? firstSent[1] : krMatch[1], 8);
  }
  return "";
}

/** Pull a punchy phrase out of the Gen Z section. Prefers the outline
 *  title (the bolded **"X"** at the top of the sub-section), falls
 *  back to a short clause from the framing question. */
export function extractGenZTagline(markdown: string): string {
  const body = sliceSubSection(markdown, /^###\s+.*pendekatan\s+gen|^###\s+.*gen[\s-]?z|^###\s+.*reaching gen/i).join("\n");
  if (!body) return "";

  // 1) Look for a bolded outline title in quotes. Real examples:
  //    `**OUTLINE DISKUSI TERBUKA (1.5 JAM): "TRUST BREACH — DARI ..."**`
  //    `**OUTLINE DISKUSI TERBUKA: "MARRIED CONTENT vs MARRIED REALITY ..."**`
  //    Take the part before the em-dash (cleaner phrase). Length cap
  //    is generous so long titles with embedded apostrophes still
  //    match end-to-end.
  const titleMatch = body.match(/outline[^"\n]*["“]([A-Z][^"”\n]{6,200})["”]/i);
  if (titleMatch && titleMatch[1]) {
    const beforeDash = titleMatch[1].split(/\s*[—–]\s*/)[0];
    const beforeColon = beforeDash.split(/\s*[:]\s*/)[0];
    return tidyHeadline(beforeColon, 7);
  }

  // 2) Framing question — find a punchy subordinate clause inside.
  const fqBlock = body.match(/\*\*framing\s+question[^*]*\*\*\s*\n+([\s\S]+?)(?=\n\s*\*\*|\n##|\n###)/i);
  if (fqBlock && fqBlock[1]) {
    const first = stripMd(fqBlock[1])
      .replace(/^["“]?\s*(?:guys|hey|so|nah)\s*[,:]?\s*/i, "")
      .split(/\?[\s"”]/)[0];
    const punch = first.match(/(?:gimana|bagaimana|kenapa|apakah|sampai\s+di\s+mana)\s+[^.,;]{8,40}/i);
    if (punch) return tidyHeadline(punch[0], 7);
    return tidyHeadline(first.slice(0, 60), 7);
  }
  return "";
}

// ──────────────────────────────────────────────────────────────────
// Dedicated flyer-message section (briefings post-2026-05-23)
// ──────────────────────────────────────────────────────────────────

/** Index into the 6 flyer-message slots, in the order the prompt asks
 *  for them: khutbah → action → kreator → Gen Z reflection → sunnah
 *  invitation → this week's du'a. */
export type FlyerMessageSlot = 0 | 1 | 2 | 3 | 4 | 5;

/** Parsed contents of one `### Pesan Flyer N` block. Briefings written
 *  after the 2026-05-23 prompt refresh carry explicit `**Headline:**`
 *  and `**Daleel:**` markers so the flyer renderer can use a
 *  message-matched title + citation instead of guessing from the
 *  deliverable sections. `body` is what's left after those markers
 *  are stripped — the 75-word standalone message itself. */
export type FlyerMessageBlock = {
  headline?: string;
  daleelCitation?: string;
  body: string;
};

/** Pull one of the 4 standalone messages from the `## Pesan Flyer`
 *  / `## Flyer Messages` section that the briefing prompt asks for
 *  (added 2026-05-23). Returns `null` if the section is missing —
 *  that's the signal for the caller to fall back to the per-variant
 *  extractors (Benang Merah + format-filtered deliverable text).
 *
 *  Section structure (2026-05-23+):
 *    ## Pesan Flyer
 *    ### Pesan Flyer 1 — Suara Khutbah
 *    **Headline:** "Mulai Adil dari Meja Sendiri"
 *    **Daleel:** QS. Ar-Rahmaan: 9
 *
 *    <paragraph>
 *    ### Pesan Flyer 2 — Suara Aksi Sosial
 *    ...
 *
 *  Older briefings (pre-marker) just have `<paragraph>` directly under
 *  the H3 — both headline and citation will be undefined and the
 *  caller falls back to the legacy extractors.
 */
export function extractDedicatedFlyerBlock(
  markdown: string,
  slot: FlyerMessageSlot,
): FlyerMessageBlock | null {
  const lines = markdown.split("\n");

  // Find the section heading. Match both ID + EN labels — the writer
  // may use either depending on the briefing's locale.
  const sectionHeading = /^##\s+(?:pesan\s+flyer|flyer\s+messages)\b/i;
  let secStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (sectionHeading.test(lines[i])) {
      secStart = i + 1;
      break;
    }
  }
  if (secStart === -1) return null;

  // Section runs until the next H2 (or EOF — Pesan Flyer is the last
  // section the prompt asks for).
  let secEnd = lines.length;
  for (let i = secStart; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      secEnd = i;
      break;
    }
  }

  // Collect each `### Pesan Flyer N` / `### Flyer Message N` block.
  // Captures the body up to the next H3 or section end.
  const subHeading = /^###\s+(?:pesan\s+flyer|flyer\s+message)\s*(\d)/i;
  const blocks: string[] = [];
  let currentStart = -1;
  let currentIdx = -1;
  const flushBlock = (endLine: number) => {
    if (currentStart >= 0 && currentIdx >= 0) {
      blocks[currentIdx] = lines.slice(currentStart, endLine).join("\n").trim();
    }
  };
  for (let i = secStart; i < secEnd; i++) {
    const m = lines[i].match(subHeading);
    if (m) {
      flushBlock(i);
      currentIdx = parseInt(m[1], 10) - 1;
      currentStart = i + 1;
    }
  }
  flushBlock(secEnd);

  const rawBlock = blocks[slot];
  if (!rawBlock) return null;

  // Parse out the two optional marker lines. They sit at the TOP of
  // the block, each on its own line, before the prose paragraph.
  //   **Headline:** "Mulai Adil dari Meja Sendiri"
  //   **Daleel:** QS. Ar-Rahmaan: 9
  const headlineMatch = rawBlock.match(
    /^\s*\*\*\s*(?:headline|judul|tema)\s*[:：]\s*\*\*\s*(.+?)\s*$/im,
  );
  const daleelMatch = rawBlock.match(
    /^\s*\*\*\s*(?:daleel|dalil|citation)\s*[:：]\s*\*\*\s*(.+?)\s*$/im,
  );

  // Strip the marker lines from the block before sentence-trimming so
  // the rendered flyer body doesn't include "Headline: ..." text.
  let bodyMd = rawBlock;
  if (headlineMatch) bodyMd = bodyMd.replace(headlineMatch[0], "");
  if (daleelMatch) bodyMd = bodyMd.replace(daleelMatch[0], "");
  const body = trimToSentences(stripMd(bodyMd), 4, 360);

  const headline = headlineMatch?.[1]
    ? tidyHeadline(
        headlineMatch[1].replace(/^["“”'']\s*/, "").replace(/\s*["”'']$/, ""),
        8,
      )
    : undefined;
  const daleelCitation = daleelMatch?.[1]?.trim();

  return { headline, daleelCitation, body };
}

/** Convenience wrapper for callers that only need the message body —
 *  the previous (pre-2026-05-23) shape of this helper. */
export function extractDedicatedFlyerMessage(
  markdown: string,
  slot: FlyerMessageSlot,
): string {
  return extractDedicatedFlyerBlock(markdown, slot)?.body ?? "";
}

/** Parse the inline du'a out of a Pesan Flyer 5 / 6 block. The Sunnah
 *  invitation and Du'a-hero flyers both carry the Arabic + ID
 *  translation + citation INSIDE the message paragraph (the prompt
 *  steers the LLM to write them there). Lifting them into a synthetic
 *  DaleelRef lets the flyer compose step pass them to the layout as
 *  daleel content — so the flyer's daleel card matches the message,
 *  instead of falling back to a random pool entry scoped to the
 *  week's news theme. */
export function parseInlineDua(block: FlyerMessageBlock): DaleelRef | null {
  const md = block.body;

  // Longest Arabic run in the block — captures the du'a sentence(s)
  // even if commas / spaces break it into shorter chunks.
  const arabicRuns = md.match(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻰ\sؐ-ًؚ-ٟ]+/g);
  if (!arabicRuns) return null;
  const arabic = arabicRuns
    .map((r) => r.trim())
    .filter((r) => /[؀-ۿ]/.test(r))
    .reduce((longest, r) => (r.length > longest.length ? r : longest), "");
  if (arabic.length < 10) return null;

  // ID translation — italic-quoted sentence near the Arabic. The
  // prompt format is roughly: Arabic line → blank → *"translation"*
  // (citation). Match the first 20-220 char quoted phrase.
  const transMatch = md.match(
    /\*\s*["“]([^"”*\n]{20,260})["”]\s*\*/,
  );
  const translation = transMatch?.[1]?.trim() ?? "";

  // Citation — prefer the explicit `**Daleel:**` marker on the block,
  // fall back to a `(HR. ...)` / `(QS. ...)` / `(Hisnul Muslim ...)`
  // parenthesized phrase in the body.
  let citation = block.daleelCitation?.trim() ?? "";
  if (!citation) {
    const m = md.match(
      /\((?:HR\.|QS\.|Hisnul Muslim|Sahih|Bukhari|Muslim|Tirmidzi|Abu Dawud|Bulugh|Riyad)[^)]{2,80}\)/i,
    );
    citation = m ? m[0].replace(/[()]/g, "").trim() : "";
  }
  if (!translation || !citation) return null;

  return {
    corpus: "inline",
    citation,
    score: null,
    arabic,
    translation_id: translation,
    translation_en: translation,
    ref_id: "synthetic:flyer-dua",
  };
}

/** Strip the parsed-out Arabic du'a + its translation + citation from
 *  the message body so the flyer doesn't duplicate the same content
 *  twice (once as the daleel hero card, once as the message paragraph).
 *  Returns the original body unchanged if any step doesn't match — the
 *  caller can decide to fall back to the full paragraph. */
export function stripInlineDua(block: FlyerMessageBlock): string {
  let body = block.body;
  // Drop Arabic-heavy lines / runs entirely.
  body = body.replace(
    /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻰ\sؐ-ًؚ-ٟ]{12,}/g,
    " ",
  );
  // Drop the italic-quoted translation immediately following.
  body = body.replace(/\*\s*["“][^"”*\n]{20,260}["”]\s*\*/g, " ");
  // Drop the inline citation parenthetical (now redundant — we surface
  // it as the daleel card citation).
  body = body.replace(
    /\((?:HR\.|QS\.|Hisnul Muslim|Sahih|Bukhari|Muslim|Tirmidzi|Abu Dawud|Bulugh|Riyad)[^)]{2,80}\)/gi,
    "",
  );
  // Collapse the whitespace we left behind.
  body = body.replace(/\s+/g, " ").trim();
  return body;
}

/** Find the daleel in the retrieved pool whose `citation` (case- and
 *  whitespace-insensitive) matches the given string. Used so the
 *  per-flyer `**Daleel:**` marker in the briefing can pin which pool
 *  entry shows up on the flyer card — instead of picking by position
 *  rank. Returns null if no match. */
export function findDaleelByCitation(
  refs: DaleelRef[] | null,
  citation: string | undefined,
): DaleelRef | null {
  if (!refs || !citation) return null;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[.,;:]+/g, "")
      .trim();
  const wanted = norm(citation);
  for (const r of refs) {
    if (norm(r.citation) === wanted) return r;
  }
  // Loose match: prefix (the LLM may write "QS. Al-Ma'aarij 32" while
  // the pool has "QS. Al-Ma'aarij: 32" — normalizing punctuation
  // catches most of these, but allow startsWith for safety).
  for (const r of refs) {
    if (
      norm(r.citation).startsWith(wanted) ||
      wanted.startsWith(norm(r.citation))
    ) {
      return r;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
// Wholistic-message extractor
// ──────────────────────────────────────────────────────────────────

/** Pull the "Benang merah" closing paragraph from Section 3 (Tema
 *  Utama & Pola Yang Muncul). This is the most wholistic message in
 *  the briefing — a 2-3 sentence summary of the week's underlying
 *  thread that doesn't reference any specific deliverable format.
 *  Ideal default for the flyer body. */
export function extractBenangMerah(markdown: string): string {
  const lines = markdown.split("\n");
  let s2Start = -1;
  let h2Count = 0;
  // Locate Section 3 — the third H2 heading.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      h2Count += 1;
      if (h2Count === 3) {
        s2Start = i + 1;
        break;
      }
    }
  }
  if (s2Start === -1) return "";
  let s2End = lines.length;
  for (let i = s2Start; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      s2End = i;
      break;
    }
  }
  const body = lines.slice(s2Start, s2End).join("\n");
  // Look for the bolded `**Benang merah:**` (Indonesian) or
  // `**Common thread:**` (English) marker.
  const m = body.match(
    /\*\*\s*(?:benang\s+merah|common\s+thread)\s*[:：]?\s*\*\*\s*([\s\S]+?)(?=\n\s*\*\*|\n##|$)/i,
  );
  if (m && m[1]) return trimToSentences(stripMd(m[1]), 3, 320);
  // Fallback: take the LAST substantive paragraph of Section 3 (it
  // usually carries the synthesis even without an explicit marker).
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => stripMd(p))
    .filter((p) => p.length > 100 && !isArabicHeavy(p));
  return trimToSentences(paragraphs[paragraphs.length - 1] ?? "", 3, 320);
}

// ──────────────────────────────────────────────────────────────────
// Message extractors (3-4 sentence actionable paragraphs)
// ──────────────────────────────────────────────────────────────────

/** Pull the action-steps block from the khutbah ("ada empat langkah",
 *  "Empat langkah praktis", "berikut langkah", "mari kita mulai", etc.)
 *  Returns 3-4 sentence summary of the concrete steps. */
export function extractKhutbahMessage(markdown: string): string {
  const body = sliceSubSection(markdown, /^###\s+.*khutbah/i).join("\n");
  if (!body) return "";

  // Locate any phrasing of "(four|three|two|several) concrete/practical
  // (steps|things|actions)". Handles both Claude wording ("empat langkah
  // konkret") and Gemini wording ("beberapa langkah praktis", "tiga hal
  // praktis", "ada beberapa langkah").
  const pivot = body.match(
    /(?:(?:ada\s+|melakukan\s+|melakukan\s+\w+\s+)?(?:empat|tiga|dua|lima|beberapa)\s+(?:langkah|hal|aksi|tindakan)(?:\s+(?:konkret|praktis))?|berikut\s+langkah|mari\s+kita\s+mulai|langkah[- ]langkah\s+(?:konkret|praktis))[\s\S]{0,1500}/i,
  );
  if (pivot && pivot[0]) {
    // Drop the leading "Empat langkah konkret..." sentence + colon.
    const after = pivot[0]
      .replace(/^[^.:]*[:.]\s*/, "")
      .replace(/\*\*pertama,?\*\*\s*/i, "")
      .trim();
    const tried = trimToSentences(after, 3, 320);
    if (tried.length > 60) return tried;
  }

  // Fallback: walk Indonesian paragraphs from the back, skip closing
  // formulas + Arabic, take the LAST substantive paragraph that reads
  // as a call to action (contains "mari", "marilah", "mulai", "audit").
  const beforeClose = body.split(/baraakallah|barakallahu|أَقُوْلُ/i)[0];
  const paragraphs = beforeClose
    .split(/\n\s*\n/)
    .map((p) => stripMd(p))
    .filter((p) => p.length > 80 && !isArabicHeavy(p));
  const callToAction = [...paragraphs]
    .reverse()
    .find((p) => /(mari|marilah|audit|mulai|jangan biarkan|jangan tunggu)/i.test(p));
  if (callToAction) return trimToSentences(callToAction, 3, 320);
  return trimToSentences(paragraphs[paragraphs.length - 1] ?? "", 3, 320);
}

/** Pull a 3-4 sentence call-to-action message from the Aksi Sosial
 *  framing. The "Trigger" paragraph often contains both stats AND the
 *  action framing, separated by a pivot phrase like "Tiga peristiwa,
 *  satu pola" or "Empat aksi berikut" — we slice out the stats prefix
 *  so the message reads as a call to action, not a news recap. */
export function extractAksiMessage(markdown: string): string {
  const body = sliceSubSection(markdown, /^###\s+.*aksi|^###\s+.*khidmah/i).join("\n");
  if (!body) return "";
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => stripMd(p))
    .filter((p) => p.length > 80 && !isArabicHeavy(p));

  // Pivot phrases that mark the transition from stats → action framing.
  const pivotRe =
    /(?:tiga|empat|lima|dua|beberapa)\s+(?:peristiwa|lapis\s+cerita|cerita|isu)[\s,.:—–-]+/i;
  const actionMarker =
    /(lingkungan\s+kita\s+harus|kita\s+bisa\s+memulai|empat\s+aksi\s+berikut|setiap\s+RT|setiap\s+masjid|isu\s+yang\s+harus\s+direspons|bukan\s+isu\s+yang\s+menunggu)/i;

  // Find the paragraph that contains the action-framing marker (may
  // include stats prefix).
  const target =
    paragraphs.find((p) => actionMarker.test(p)) ??
    paragraphs.filter((p) => !/^trigger\s*[:：]/i.test(p))[1] ??
    paragraphs[1] ??
    paragraphs[0] ??
    "";
  if (!target) return "";

  // Strip the stats prefix: drop everything up to (and including) the
  // pivot phrase if present, so the message starts at "satu pola..."
  // or "Setiap RT...".
  let cleaned = target.replace(/^trigger\s*[:：]\s*/i, "");
  const pivotIdx = cleaned.search(pivotRe);
  if (pivotIdx > 0) {
    // Keep from the pivot onward (it usually starts the action framing).
    cleaned = cleaned.slice(pivotIdx);
  }
  return trimToSentences(cleaned, 3, 320);
}

/** Pull a 3-4 sentence message from the Kreator section. Handles two
 *  dialog styles:
 *    `**Kreator:** Dialog text...` (Claude — explicit speaker marker)
 *    `"Dialog text..."` (Gemini — bare quoted dialog after **HOOK:**)
 *  Always strips visual stage directions ((Visual: ...), Scene markers). */
export function extractKreatorMessage(markdown: string): string {
  const body = sliceSubSection(markdown, /^###\s+.*kreator|^###\s+.*content/i).join("\n");
  if (!body) return "";

  // Style 1: explicit `**Kreator:**` speaker marker.
  const krMatches = [...body.matchAll(/\*\*\s*kreator\s*[:：]\s*\*\*\s*([^*]+?)(?=\n\s*\*Visual|\n\s*\*\*|\n###|\n##|$)/gi)];
  if (krMatches.length > 0) {
    const joined = krMatches
      .slice(0, 2)
      .map((m) => stripMd(m[1]).replace(/^["“]\s*|\s*["”]$/g, "").trim())
      .join(" ");
    const text = trimToSentences(joined, 3, 320);
    if (text.length > 60) return text;
  }

  // Style 2: bare quoted dialog after HOOK marker (Gemini). Walk lines,
  // skip stage-direction lines (start with `**(` or `**Visual` or `**Scene`),
  // collect quoted-content lines.
  const lines = body.split("\n");
  const dialogChunks = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // Skip stage directions / section headers.
    if (/^\*\*\s*\(/.test(t) || /^\*\*\s*(visual|scene|hook|body|cta|teks)/i.test(t)) continue;
    if (/^\*\*[^*]+\*\*\s*$/.test(t)) continue; // bare bold header
    // Grab the quoted content if any.
    const q = t.match(/^["“]([^"”\n]{20,300})["”]/);
    if (q) dialogChunks.push(q[1]);
  }
  if (dialogChunks.length > 0) {
    const joined = dialogChunks.slice(0, 3).join(" ");
    const text = trimToSentences(joined, 3, 320);
    if (text.length > 60) return text;
  }

  // Style 3: fallback to first plain Indonesian paragraph.
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => stripMd(p))
    .filter(
      (p) =>
        p.length > 80 &&
        !isArabicHeavy(p) &&
        !/^visual|^teks|^hook|^body|^cta|^scene|^transisi/i.test(p),
    );
  return trimToSentences(paragraphs[0] ?? "", 3, 320);
}

/** Pull a reflective message from the Gen Z section — prefers the
 *  "Penutup" closing, then pop-culture-bridge reflective close, then
 *  the framing-question reflection. Handles Gemini's looser markers
 *  ("**Penutup (10 menit):**", "**Pop-culture Bridge (20 menit):**"). */
export function extractGenZMessage(markdown: string): string {
  const body = sliceSubSection(markdown, /^###\s+.*pendekatan\s+gen|^###\s+.*gen[\s-]?z|^###\s+.*reaching gen/i).join("\n");
  if (!body) return "";

  // 1) Penutup block — handle both `**Penutup**` and `**Penutup (X menit):**`.
  const penutup = body.match(/\*\*\s*penutup[^*]*\*\*\s*\n+([\s\S]+?)(?=\n\s*\*\*|\n##|\n###|$)/i);
  if (penutup && penutup[1]) {
    const text = trimToSentences(stripMd(penutup[1]), 3, 320);
    if (text.length > 60) return text;
  }

  // 2) Pop-culture bridge — take the LAST paragraph (the reflective
  //    take-away rather than the setup).
  const popBridge = body.match(/\*\*\s*pop[\s-]?culture\s+bridge[^*]*\*\*[\s\S]{40,2000}/i);
  if (popBridge && popBridge[0]) {
    const paras = popBridge[0]
      .split(/\n\s*\n/)
      .map((p) => stripMd(p))
      .filter((p) => p.length > 100 && !isArabicHeavy(p));
    const text = trimToSentences(paras[paras.length - 1] ?? paras[0] ?? "", 3, 320);
    if (text.length > 60) return text;
  }

  // 3) Fallback: last substantive paragraph in the whole section.
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => stripMd(p))
    .filter((p) => p.length > 100 && !isArabicHeavy(p));
  return trimToSentences(paragraphs[paragraphs.length - 1] ?? paragraphs[0] ?? "", 3, 320);
}

// ──────────────────────────────────────────────────────────────────
// Daleel + date helpers (unchanged from earlier version)
// ──────────────────────────────────────────────────────────────────

/** Pick a daleel from the pool for a given variant rank (0-3 → cycles
 *  through the 4 most-relevant entries so the 4 flyers do not share
 *  the same daleel). */
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
  const withArabic = refs.filter((r) => r.arabic);
  if (withArabic.length) {
    return withArabic[Math.min(rank, withArabic.length - 1)];
  }
  return refs[Math.min(rank, refs.length - 1)];
}

// ──────────────────────────────────────────────────────────────────
// Mahasiswa Poster — the 1080×1080 PNG for the university bulletin
// board. The H3 "### Mahasiswa: Poster, Artikel & Diskusi" sub-section
// of Section 4 carries a `**Poster Question:**` marker line that holds
// the one-sentence provocative question. This helper pulls it.
// ──────────────────────────────────────────────────────────────────

/** Extract the bulletin-board poster question from the Mahasiswa
 *  sub-section. Returns "" if the section or marker is missing — the
 *  caller (poster renderer) treats that as "skip the poster". */
export function extractPosterQuestion(markdown: string): string {
  const body = sliceSubSection(
    markdown,
    /^###\s+.*(?:mahasiswa|university\s+student|gen[\s-]?z|pendekatan\s+gen|reaching gen)/i,
  ).join("\n");
  if (!body) return "";
  const m = body.match(
    /^\s*\*\*\s*(?:poster\s+question|pertanyaan\s+poster|pertanyaan\s+pemicu)\s*[:：]\s*\*\*\s*["“]?(.+?)["”]?\s*$/im,
  );
  if (m && m[1]) {
    return m[1]
      .trim()
      .replace(/^["“]\s*|\s*["”]$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

// ──────────────────────────────────────────────────────────────────
// Per-deliverable extractors (used by /flyer/{deliverable})
// ──────────────────────────────────────────────────────────────────

const DELIVERABLE_MATCHERS: Record<DeliverableSlug, RegExp> = {
  khutbah: /^###\s+.*khutbah/i,
  kajian: /^###\s+.*kajian|^###\s+.*majelis/i,
  home: /^###\s+.*rumah|^###\s+.*teaching at\s+home/i,
  content: /^###\s+.*konten|^###\s+.*kreator|^###\s+.*digital content/i,
  // `genz` is the internal slug — kept stable so existing URLs / DB
  // routes don't break — but the heading matcher also catches the new
  // "Mahasiswa: Poster, Artikel & Diskusi" format that replaced the
  // Pendekatan Gen Z deliverable on 2026-05-23. The card title in the
  // UI is whatever the briefing's H3 says; this matcher just decides
  // which deliverable slot it belongs to.
  genz: /^###\s+.*mahasiswa|^###\s+.*gen[\s-]?z|^###\s+.*pendekatan\s+gen|^###\s+.*reaching gen|^###\s+.*university\s+student/i,
  action: /^###\s+.*aksi|^###\s+.*khidmah|^###\s+.*social action|^###\s+.*service to/i,
};

/** Headline for a per-deliverable flyer — reuses the variant-specific
 *  tagline extractors when appropriate, falls back to a generic label. */
export function extractDeliverableHeadline(
  markdown: string,
  slug: DeliverableSlug,
): string {
  if (slug === "khutbah") return extractKhutbahTagline(markdown);
  if (slug === "content") return extractKreatorHook(markdown);
  if (slug === "genz") return extractGenZTagline(markdown);
  if (slug === "action") return extractCampaignTagline(markdown);
  // Kajian / Home: pull the bolded outline title from the sub-section.
  const body = sliceSubSection(markdown, DELIVERABLE_MATCHERS[slug]).join("\n");
  const titleMatch = body.match(
    /\*\*\s*(?:outline\s+kajian|script\s+\d|pengajaran)[^"*]*["“]([^"”*\n]{6,80})/i,
  );
  if (titleMatch && titleMatch[1]) return tidyHeadline(titleMatch[1], 7);
  // Fallback: first bold-quoted phrase.
  const anyQuoted = body.match(/\*\*["“]([^"”*\n]{6,80})["”]\*\*/);
  return anyQuoted ? tidyHeadline(anyQuoted[1], 7) : "";
}

/** Message for a per-deliverable flyer — first substantive paragraph
 *  in the sub-section, skipping formal openings (salam, basmalah, etc.). */
export function extractDeliverableMessage(
  markdown: string,
  slug: DeliverableSlug,
): string {
  if (slug === "khutbah") return extractKhutbahMessage(markdown);
  if (slug === "content") return extractKreatorMessage(markdown);
  if (slug === "genz") return extractGenZMessage(markdown);
  if (slug === "action") return extractAksiMessage(markdown);
  const body = sliceSubSection(markdown, DELIVERABLE_MATCHERS[slug]).join("\n");
  const skipPatterns = [
    /assalamu['ʼ]?alaikum/i,
    /alhamdulillah/i,
    /allahumma/i,
    /asyhadu/i,
    /bismillah/i,
    /baarakallahu/i,
    /shallallahu/i,
  ];
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => stripMd(p))
    .filter((p) => p.length > 80 && !skipPatterns.some((re) => re.test(p)));
  return trimToSentences(paragraphs[0] ?? "", 3, 320);
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
