/**
 * Pure extractors behind the /khutbah-kultum library cards.
 *
 * Every card is EXTRACTIVE: the title, the daleel citations and the
 * summary are lifted verbatim (markdown stripped) from the published
 * section — nothing is paraphrased or generated here, and a citation is
 * never shortened (the full kitab locator is the Sharia-rule citation).
 * Input is the section body returned by
 * `extractDeliverableSection(body, "khutbah" | "kultum")`.
 *
 * Shapes measured across 266 prod briefings (2026-06-06 → 2026-10-08):
 *   - Khutbah: a first sermon that closes with take-home steps, then the
 *     closing formula «بَارَكَ اللهُ لِيْ وَلَكُمْ …» and a second sermon.
 *     The second sermon is announced by `#### Khutbah Kedua`, a bold-only
 *     `**Khutbah Kedua**`, or — in ~30% of rows — nothing at all.
 *     Steps are a numbered list with a bold lead (`1. **Jenguk …** …`),
 *     ordinal paragraphs (`Pertama, pakai ujian … . …`), or bold ordinal
 *     paragraphs (`**Yang pertama, jadikan bertanya …**`); pre-September
 *     rows often have no steps at all.
 *   - Kultum: an Arabic opener, then a hook paragraph that starts with a
 *     vocative ("Jamaah yang saya hormati, pekan ini …").
 *   - Daleel: an Arabic block whose citation is a bold-only line right
 *     after it (`**QS. Luqman: 20**`), a bold-only line right before it,
 *     or a bold span in the introducing sentence
 *     ("Allah berfirman dalam **QS. An-Nisaa: 136**:").
 */

const ARABIC_CHAR =
  /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;

/** The quoted theme title of an H3 heading:
 *  `Khutbah Jumat — "Langit Ditundukkan, Amanah Ditanam di Hati"` →
 *  `Langit Ditundukkan, Amanah Ditanam di Hati`. Null when the heading
 *  carries no quoted title (pre-2026-06-18 briefings). */
export function sectionTitle(heading: string): string | null {
  const m = heading.match(/\s[—–]\s+["“]([^"”\n]{3,100})["”]\s*$/);
  return m ? m[1].trim() : null;
}

/** Share of letters that are Arabic script (0..1). */
function arabicShare(s: string): number {
  const letters = s.replace(/[\s\d\p{P}\p{S}]/gu, "");
  if (!letters) return 0;
  return (letters.match(ARABIC_CHAR) ?? []).length / letters.length;
}

// One or more blank lines. `\n(?:[ \t]*\n)+` rather than `\n\s*\n`: the
// latter re-scans a long whitespace run from every newline (quadratic).
function paragraphs(body: string): string[] {
  return body
    .split(/\n(?:[ \t]*\n)+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Clip at a word boundary and close with an ellipsis. */
export function clipWords(s: string, max: number): string {
  if (s.length <= max) return s;
  return (
    s
      .slice(0, max - 1)
      .replace(/\s+\S*$/, "")
      .replace(/[\s,;:—–-]+$/, "") + "…"
  );
}

// Opening forms of address, possibly chained ("Ma'asyiral muslimin
// rahimakumullah, jamaah Jumat yang dimuliakan Allah."). Each link must
// close with a comma/period/exclamation within 60 characters, so a
// sentence that merely begins with "Jamaah …" as its subject survives.
const VOCATIVE =
  /^(?:(?:para\s+)?(?:ma['’]?a?syiral\s+muslimin|kaum\s+muslimin|jama['’]?ah|hadirin|ibu-ibu|bapak-bapak|saudara-saudara(?:ku)?|saudaraku|sahabat|dear\s+\w+|brothers\s+and\s+sisters)\b[^,.!\n]{0,60}[,.!]\s*)+/i;

// Openers that carry no message: salam, hamdalah, shalawat, and the
// khatib's opening formulas — "Marilah kita buka khutbah pekan ini dengan
// …", "Izinkan khatib membuka mimbar …", "Marilah pada kesempatan yang
// mulia ini …", "Di hari Jumat yang mulia ini, marilah kita memperbarui
// takwa …" (measured: 21 of 118 step-less khutbah cards led with one).
const FORMULAIC =
  /^(?:assalamu|alhamdulillah|segala\s+puji|puji\s+syukur|shalawat|sholawat|salawat|all\s+praise|praise\s+be|peace\s+be|(?:marilah|mari|izinkan)\b[^.]{0,80}\b(?:membuka|buka|awali|mengawali|mulai|memulai)\b[^.]{0,40}\b(?:khutbah|mimbar|kultum|majelis|pertemuan)\b|marilah\s+pada\s+(?:kesempatan|jum)|(?:di|pada)\s+hari\s+jum['’]?at\s+yang|marilah\s+kita\s+(?:bertakwa|tingkatkan|perbarui|memperbarui|senantiasa|panjatkan|bersyukur)|(?:(?:malam|siang|pagi|sore)\s+ini\s+)?kita\s+(?:ber)?kumpul)/i;

// A sentence that only introduces a quotation ("… Allah berfirman:",
// "… Allah Ta'ala berfirman,").
const QUOTE_INTRO =
  /(?::|\b(?:berfirman|bersabda|berkata|bersyair|berdoa)\s*,?)\s*$/i;

/** A citation of one of the retrieved corpora (the Qur'an and the kitab
 *  whitelist), as the composers print it. Anything else in bold — a
 *  "Khutbah Kedua" label, a step lead — is not a citation. */
const CITATION =
  /^(?:QS\.|Sahih\s|Riyad\s|Bulugh\s|Tafsir\s|Adab\s+al-|Bidayatul\s|Fath\s+al-|Ash-Shama|Nashaihul\s|['’]Aqidat\s|Thalathat\s|Al-Bidayah\s)/;

/** First paragraph that reads as the section's own message: not a
 *  heading, list, table, quote, translation, citation or Arabic block,
 *  not a formulaic opener, not a sentence that only introduces a quote
 *  ("… berfirman:"); vocatives stripped, clipped to `max`. With `prefer`,
 *  the first such paragraph matching it (among the first eight) wins. */
export function leadParagraph(
  body: string,
  opts: { max?: number; prefer?: RegExp } = {},
): string | null {
  const max = opts.max ?? 220;
  const eligible: string[] = [];
  for (const raw of paragraphs(body)) {
    if (/^(?:#|\||>|[-*+]\s|\d+[.)]\s)/.test(raw)) continue;
    if (/^["“'(]/.test(raw)) continue;
    if (/^\*\*[^*\n]+\*\*$/.test(raw)) continue;
    if (/^\*\([^)]*\)\*$/.test(raw)) continue;
    if (arabicShare(raw) > 0.2) continue;
    const text = stripInlineMarkdown(raw).replace(VOCATIVE, "").trim();
    if (text.length < 60) continue;
    if (FORMULAIC.test(text) || CITATION.test(text) || /^artinya\b/i.test(text)) {
      continue;
    }
    if (QUOTE_INTRO.test(text)) continue;
    eligible.push(text);
    if (!opts.prefer || eligible.length >= 8) break;
  }
  const pick =
    (opts.prefer && eligible.find((p) => opts.prefer!.test(p))) || eligible[0];
  return pick ? clipWords(capitalize(pick), max) : null;
}

// Harakat, Qur'anic marks and tatweel, then the alef/ya variants — so a
// formula matches however it was voweled ("لِيْ" / "لي", "اللّٰهُ" / "الله").
function foldArabic(s: string): string {
  return s
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي");
}

const CLOSING_FORMULA = /بارك\s*الله\s*لي\s*ولكم|اقول\s*قولي\s*هذا/;

/** The first sermon only — everything before the second sermon, which is
 *  announced by "Khutbah Kedua" (an H4 heading or a bold-only line) or,
 *  when unannounced, starts after the first sermon's closing formula
 *  «بَارَكَ اللهُ لِيْ وَلَكُمْ …» / «أَقُوْلُ قَوْلِيْ هٰذَا …». The second
 *  sermon is liturgy plus its own reflections; neither belongs on a card
 *  that summarises the first sermon's message. */
export function firstSermon(body: string): string {
  let cut = body.length;
  const heading = body.match(/^(?:#{2,6}[ \t]+|\*\*)[ \t]*khutbah[ \t]+kedua/im);
  if (heading?.index !== undefined) cut = heading.index;
  let offset = 0;
  for (const line of body.split("\n")) {
    if (offset >= cut) break;
    if (arabicShare(line) > 0.5 && CLOSING_FORMULA.test(foldArabic(line))) {
      cut = offset;
      break;
    }
    offset += line.length + 1;
  }
  return body.slice(0, cut);
}

const ORDINAL_WORDS = [
  ["pertama", "first"],
  ["kedua", "second"],
  ["ketiga", "third"],
  ["keempat", "fourth"],
  ["kelima", "fifth"],
  ["keenam", "sixth"],
  ["ketujuh", "seventh"],
  ["kedelapan", "eighth"],
];

function ordinalIndex(word: string): number {
  const w = word.toLowerCase();
  return ORDINAL_WORDS.findIndex((pair) => pair.includes(w)) + 1;
}

const ORDINAL_ALT = ORDINAL_WORDS.flat().join("|");

const ORDINAL_PARA = new RegExp(
  `^(?:yang\\s+|langkah\\s+)?(${ORDINAL_ALT})[ \\t]*[,:—–][ \\t]*([\\s\\S]+)$`,
  "i",
);

// An ordinal that opens a sentence inside a paragraph ("… beberapa langkah
// nyata. Pertama, jadikan …", "… ceritakan lagi." Kedua, …", "… pekan
// ini. **Pertama**, mari …"): split there so every step is its own unit.
// Case-sensitive on purpose — only a capitalised, sentence-initial ordinal.
const ORDINAL_CAPS = ORDINAL_WORDS.flat().map(capitalize).join("|");
const ORDINAL_SENTENCE = new RegExp(
  `([.!?:]["”’')\\]]*)[ \\t]+((?:\\*{1,2}|_)?(?:(?:Yang|Langkah)[ \\t]+(?:${ORDINAL_ALT}|${ORDINAL_CAPS})|${ORDINAL_CAPS})(?:\\*{1,2}|_)?[ \\t]*[,:—–])`,
  "g",
);

// What a khatib says right before the take-home steps.
const STEPS_CUE =
  /langkah|bawa\s+pulang|membawa\s+pulang|yang\s+(?:bisa|dapat)\s+kita|apa\s+yang\s+(?:bisa|dapat|harus)|mari\s+kita\s+(?:mulai|amalkan|lakukan)|pekan\s+ini\s+juga|amalan\s+nyata|take\s+home|steps?\b/i;

/** First sentence of an ordinal step paragraph. */
function firstSentence(s: string): string {
  const m = s.match(/^([\s\S]+?[.!?])(?=\s|$)/);
  return (m ? m[1] : s).replace(/[.!?]$/, "").trim();
}

function stepText(raw: string): string {
  const text = stripInlineMarkdown(raw)
    .replace(/\*+/g, "")
    .replace(VOCATIVE, "")
    .trim();
  return capitalize(clipWords(firstSentence(text), 90));
}

/** The khutbah's closing action steps, in order (at most `max`).
 *  Numbered bold leads win. Otherwise ordinal steps ("Pertama, … /
 *  Kedua, …", "Yang pertama, …", also mid-paragraph): runs that count up
 *  from one without a gap; non-ordinal paragraphs between steps are
 *  continuation text. The last run introduced by a take-home cue
 *  ("… beberapa langkah …") wins, else simply the last run — an
 *  exposition can enumerate points ("Pertama, ayat ini …") well before
 *  the steps that close the first sermon. An uncued run of two, or of
 *  mostly bare terms ("Pertama: al-adl"), is an exposition, not steps. */
export function khutbahSteps(body: string, max = 3): string[] {
  const sermon = firstSermon(body);

  const numbered: string[] = [];
  for (const m of sermon.matchAll(/^[ \t]*\d+[.)][ \t]+\*\*([^*\n]{3,200}?)\*\*/gm)) {
    numbered.push(m[1].trim().replace(/[.:;]+$/, ""));
  }
  if (numbered.length >= 2) {
    return numbered.slice(0, max).map((s) =>
      capitalize(stripInlineMarkdown(s).replace(VOCATIVE, "")),
    );
  }

  type Run = { steps: string[]; cued: boolean };
  const runs: Run[] = [];
  let run: Run | null = null;
  let recent: string[] = [];
  const units = paragraphs(sermon.replace(ORDINAL_SENTENCE, "$1\n\n$2"));
  for (const unit of units) {
    const text = stripInlineMarkdown(unit).replace(/^\*+/, "");
    const m = text.match(ORDINAL_PARA);
    const n = m ? ordinalIndex(m[1]) : 0;
    if (n === 1) {
      run = { steps: [m![2]], cued: recent.some((r) => STEPS_CUE.test(r)) };
      runs.push(run);
    } else if (n > 1 && run && n === run.steps.length + 1) {
      run.steps.push(m![2]);
    } else if (n > 1) {
      run = null; // out of sequence: not a list we can trust
    }
    recent = [...recent.slice(-1), text];
  }

  // A cued run is trusted as steps even when they are terse ("Pertama,
  // audit upah."). An uncued run must look like a list of actions: at
  // least three, mostly full sentences — two uncued points are usually an
  // exposition ("hadits ini berisi dua larangan …").
  const words = (s: string) => firstSentence(s).split(/\s+/).length;
  const valid = runs.filter((r) =>
    r.cued
      ? r.steps.length >= 2
      : r.steps.length >= 3 &&
        r.steps.filter((s) => words(s) >= 3).length > r.steps.length / 2,
  );
  const pick = [...valid].reverse().find((r) => r.cued) ?? valid[valid.length - 1];
  return pick ? pick.steps.slice(0, max).map(stepText) : [];
}

type Block = { kind: "arabic" | "bold" | "prose"; text: string };

/** Lines grouped into blocks of one kind: Arabic lines, a bold-only line
 *  (always its own block), or prose. A blank line also ends a block. */
function blocks(body: string): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) {
      cur = null;
      continue;
    }
    // Bold first: a kitab citation carrying its Arabic bab
    // ("**Adab al-'Alim … — الباب الثالث …**") is mostly Arabic letters.
    // Likewise a citation line that is not all bold ("**Dalil:**
    // Ash-Shama'il … — باب …") is a citation, not an Arabic passage.
    const kind: Block["kind"] = /^\*\*[^*\n]+\*\*$/.test(line)
      ? "bold"
      : citationLine(line) !== null
        ? "prose"
        : arabicShare(line) > 0.5
          ? "arabic"
          : "prose";
    if (cur && cur.kind === kind && kind !== "bold") {
      cur.text += `\n${line}`;
      continue;
    }
    cur = { kind, text: line };
    out.push(cur);
  }
  return out;
}

/** A line that is itself a citation ("— **Sahih Muslim 1130c**",
 *  "**Dalil:** Ash-Shama'il … — باب …"): the citation, else null. */
function citationLine(line: string): string | null {
  const text = stripInlineMarkdown(line)
    .replace(/^[—–-]\s*/, "")
    .replace(/^dalil\s*:\s*/i, "")
    .trim();
  if (!CITATION.test(text) || /["“”]/.test(text)) return null;
  return text.replace(/[.\s]+$/, "");
}

const whitelisted = (c: string | null | undefined): string | null =>
  c && CITATION.test(c.trim()) ? c.trim() : null;

/** The citation printed on the line right after a passage — the
 *  translation line or a citation line — in any of the composers'
 *  forms: `**cite** — "…"`, `— **cite**`, `"…" — **cite**.`,
 *  `"…" (cite)`, `"…" (**cite**)`, `"…" **(cite)**`, or a bold citation
 *  anywhere on the line ("Allah berfirman dalam **QS. …**: "…""). */
function citationAfter(line: string): string | null {
  const own = citationLine(line);
  if (own) return own;
  // A line ending in ":" / "berfirman," introduces the NEXT passage; its
  // citation belongs to that one, not to the passage above it.
  if (QUOTE_INTRO.test(stripInlineMarkdown(line))) return null;
  const lead = line.match(/^(?:[—–-]\s*)?\*\*([^*\n]+)\*\*/);
  if (lead && whitelisted(lead[1])) return whitelisted(lead[1]);
  for (const m of line.matchAll(/\((?:\*\*)?([^()*\n]+?)(?:\*\*)?\)|\*\*\(([^()*\n]+?)\)\*\*/g)) {
    const c = whitelisted(m[1] ?? m[2]);
    if (c) return c;
  }
  for (const m of line.matchAll(BOLD_SPAN)) {
    const c = whitelisted(m[1]);
    if (c) return c;
  }
  return null;
}

const BOLD_SPAN = /\*\*([^*\n]+)\*\*/g;

// Du'a. The citation of a du'a is not the message's daleel, so an Arabic
// block is skipped when the sentence introducing it is a petition by the
// speaker ("Kami memohon dengan doa …", "Marilah kita tutup dengan doa",
// "Rasulullah ﷺ berdoa:"), but kept when that sentence reports a passage
// that merely mentions a du'a ("Allah berfirman tentang doa Nabi Ibrahim",
// "… sebelum menyampaikan sebuah doa berkata:").
const DUA_WORD = /\b(?:doa|berdoa|memohon|du['’]a|munajat)\b/i;
const PETITION =
  /\b(?:kami|kita|aku|saya)\s+(?:memohon|berdoa|memanjatkan|panjatkan)\b|\bmari(?:lah)?\s+kita\s+(?:tutup|akhiri|panjatkan|berdoa|memohon)\b|\bya\s+allah\b|\bberdoalah\b|\btutup\s+dengan\s+doa\b/i;
const REPORTS =
  /\b(?:berfirman|firman|bersabda|sabda|berkata|mengabadikan|diabadikan|mengisahkan|menceritakan)\b/i;

function introducesDua(sentence: string): boolean {
  return PETITION.test(sentence) || (DUA_WORD.test(sentence) && !REPORTS.test(sentence));
}

// Arabic that opens as a du'a: اللهم / ربنا / إلهي (after folding), or the
// vocative رَبِّ — tested voweled, since folded "رب" is also رُبَّ ("many
// a …") and رَبُّ ("Lord of …").
const DUA_ARABIC_FOLDED = /^(?:اللهم|ربنا|الهي)/;
const RABBI = /^رَ?ب(?:ِّ|ِّ)/;

function opensAsDua(arabic: string): boolean {
  const raw = arabic.replace(/ـ/g, "").replace(/^[^ء-ي]+/, "");
  return DUA_ARABIC_FOLDED.test(foldArabic(raw)) || RABBI.test(raw);
}

/** The last sentence of a block, without splitting at the "QS." / "HR."
 *  / "No." abbreviations ("… dalam QS. Ash-Shu'araa: 169:"). */
function lastSentence(text: string): string {
  const parts = stripInlineMarkdown(text)
    .replace(/\b(QS|HR|No|no|Hlm|hlm)\.(?=\s)/g, "$1․")
    .split(/[.!?]["”’)]*\s+/);
  return (parts[parts.length - 1] ?? "").replace(/․/g, ".");
}

/** Citations of the retrieved daleel, in order of appearance, verbatim,
 *  deduped. For each Arabic block the citation is taken from, in order:
 *   1. the bold-only line right after it (`**QS. Luqman: 20**`);
 *   2. the line right after it — see `citationAfter`;
 *   3. the bold-only line right before it;
 *   4. the last citation in bold on the line introducing it
 *      ("Allah berfirman dalam **QS. An-Nisaa: 136**:") — that line only,
 *      so the previous passage's translation in the same block is not
 *      mistaken for this one's citation.
 *  Only whitelisted corpus citations count. A du'a is skipped: Arabic
 *  introduced by a petition (`introducesDua`), or Arabic opening as a
 *  du'a (`opensAsDua`) unless it is cited as Qur'an or introduced as a
 *  reported saying ("Rasulullah ﷺ bersabda: «اللهم إني أحرج …»"). */
export function daleelCitations(body: string, max = 3): string[] {
  const bs = blocks(body);
  const out: string[] = [];
  const boldOnly = (b: Block | undefined) =>
    b?.kind === "bold" ? b.text.slice(2, -2).trim() : null;

  for (let i = 0; i < bs.length && out.length < max; i++) {
    if (bs[i].kind !== "arabic") continue;
    const before = bs[i - 1];
    const after = bs[i + 1];
    // The prose introducing this Arabic: right above it, or above a
    // bold-only citation line that sits between the two.
    const intro =
      before?.kind === "prose"
        ? before
        : before?.kind === "bold" && bs[i - 2]?.kind === "prose"
          ? bs[i - 2]
          : undefined;
    const introLine = intro ? intro.text.split("\n").pop() ?? "" : "";
    const introSentence = intro ? lastSentence(introLine) : "";
    if (intro && introducesDua(introSentence)) continue;

    let cite = whitelisted(boldOnly(after));
    if (!cite && after?.kind === "prose") cite = citationAfter(after.text.split("\n")[0]);
    if (!cite) cite = whitelisted(boldOnly(before));
    if (!cite && intro) {
      const spans = [...introLine.matchAll(BOLD_SPAN)]
        .map((m) => whitelisted(m[1]))
        .filter((c): c is string => c !== null);
      cite = spans.length > 0 ? spans[spans.length - 1] : null;
    }
    if (!cite) continue;

    const reported = intro !== undefined && REPORTS.test(introSentence);
    if (!cite.startsWith("QS.") && !reported && opensAsDua(bs[i].text)) continue;
    if (!out.includes(cite)) out.push(cite);
  }
  return out;
}

/** Display split of a verbatim citation (nothing is reworded):
 *   - `name`: the kitab and number. A Latin commentary tail after a
 *     numbered head ("Riyad as-Salihin 1615, dari Abdullah bin Mas'ud …",
 *     "Riyad as-Salihin 1587 — dalam hadits qudsi ini …") is left off.
 *   - `locator`: an Arabic bab/bayt after " — ", split at its first " / "
 *     into `head` and `tail` so the part that tells sibling sections
 *     apart ("/ الثاني" vs "/ الثالث") is never the part clipped. */
export function splitCitation(cite: string): {
  name: string;
  locator: { head: string; tail: string | null } | null;
} {
  const dash = cite.indexOf(" — ");
  if (dash >= 0) {
    const rest = cite.slice(dash + 3).trim();
    if (arabicShare(rest) > 0.3) {
      const slash = rest.indexOf(" / ");
      return {
        name: cite.slice(0, dash).trim(),
        locator:
          slash >= 0
            ? { head: rest.slice(0, slash).trim(), tail: rest.slice(slash + 3).trim() }
            : { head: rest, tail: null },
      };
    }
  }
  const commentary = cite.match(/^(.*?\d[\da-z]*)(?:,\s+| — )\D/);
  if (commentary) return { name: commentary[1].trim(), locator: null };
  return { name: cite, locator: null };
}
