/**
 * Every data/content source the module uses or plans to use, with the credit
 * line its licence requires. Rendered on /kredit. Single source of truth: the
 * content pipeline (belajar/pipeline/sources.yaml) pins the same entries by
 * version + sha256; keep both in sync when a source is added.
 *
 * Research basis: docs/belajar-research/quran-data.md, kitabs.md, audio.md.
 */
// ───────────── Citation display (Rujukan lists, senior-ux §3.6) ─────────────
// A SourceRef is written for provenance: full edition details, and for
// dataset rows the raw query (QAC tags such as "POS:N|LEM:{som|ROOT:smw").
// Learners see the kitab's short name, its edition on a line of its own, and
// the human-readable part of the ref. Only machine strings (QAC tags, content
// hashes) are left out of the visible text; the full, unaltered citation
// stays on the link title and the link still goes to the source passage
// (AGENTS.md).

/** Edition details inside a trailing "( … )": a digit, comma or colon, or an
 *  editor/edition word. "(morfologi)" stays; "(cet. 4, 1415 H)" goes. */
const EDITION_PAREN = /\s*\(([^()]*)\)\s*$/;
const EDITION_WORDS = /\b(?:cet|tahqiq|ed|t\.t)\b|[\d,:]/i;
/** "(ed. Dryer & Haspelmath)" / "(tahqiq …)" anywhere in the name. */
const EDITOR_PAREN = /\s*\((?:ed\.|tahqiq)[^()]*\)/gi;
/** ", tahqiq 'Abdussalam Harun" and anything after it. */
const EDITOR_TAIL = /,\s*(?:tahqiq|ed\.)\s.*$/i;

/**
 * A kitab/dataset name split into author + title and the edition details
 * taken out of it (editor, publisher, printing, year), in their original
 * order. "Ibnu Faris, Mu'jam Maqayis al-Lughah, tahqiq 'Abdussalam Harun
 * (Mustafa al-Babi al-Halabi, cet. 2, 1389-1392 H)" → name "Ibnu Faris,
 * Mu'jam Maqayis al-Lughah", edition "tahqiq 'Abdussalam Harun, Mustafa
 * al-Babi al-Halabi, cet. 2, 1389-1392 H".
 */
export function splitKitab(kitab: string): { name: string; edition?: string } {
  const full = kitab.trim();
  const editors: string[] = [];
  let s = full.replace(EDITOR_PAREN, (m) => {
    editors.push(m.trim().slice(1, -1).trim());
    return "";
  });
  const trailing: string[] = [];
  let m = s.match(EDITION_PAREN);
  while (m && EDITION_WORDS.test(m[1])) {
    trailing.unshift(m[1].trim());
    s = s.slice(0, m.index ?? 0).trimEnd();
    m = s.match(EDITION_PAREN);
  }
  const tail = s.match(EDITOR_TAIL);
  if (tail) {
    editors.push(tail[0].replace(/^,\s*/, "").trim());
    s = s.slice(0, tail.index ?? 0);
  }
  s = s.trim();
  if (s.length < 2) return { name: full };
  const edition = [...editors, ...trailing].join(", ");
  return edition ? { name: s, edition } : { name: s };
}

/** Short kitab/dataset name: author + title, without edition details. */
export function shortKitab(kitab: string): string {
  return splitKitab(kitab).name;
}

/** A QAC feature string: "P|PREFIX|bi+", "POS:N", "ROOT:smw". */
function isMachine(s: string): boolean {
  return /\|/.test(s) || /\b[A-Z]{2,}:/.test(s);
}

/** A machine tag, or a run of bare upper-case tag codes ("V IMPF (X)",
 *  "P + N"). */
function isTag(s: string): boolean {
  return isMachine(s) || (/^[A-Z+()*.\s]+$/.test(s) && /[A-Z]/.test(s));
}

/** Leading dataset location such as "(1:1:1:*)" or "(1:5:4:1)". */
const LOC_PREFIX = /^\(\d+(?::\d+)*(?::\*)?\)\s*(?:[—–-]\s*)?/;
/** A content hash and the separator after it. */
const SHA = /sha256:[0-9a-f]+\s*;?\s*/gi;
/** One QAC token inside running text: "LEM:r~aHima", "ROOT:smw", "POS:N". */
const TAG_TOKEN = /\s*\b(?:LEM|ROOT|POS):[^\s,;()]+/g;
const STARTS_WITH_TAG = /^(?:LEM|ROOT|POS):/;
/** "ROOT:smw — 381 segmen …": the tag names the subject of the text after
 *  the dash, which reads fine on its own. */
const LEAD_TAGS = /^(?:(?:LEM|ROOT|POS):[^\s,;()]+\s*)+[—–-]\s*/;
const EDGE_PUNCT = /^[\s,;:—–]+|[\s,;:—–]+$/g;
/** Something a person can read: a letter or digit (Latin, Arabic). */
const READABLE = /[0-9A-Za-zÀ-ɏḀ-ỿ؀-ۿ]/;

/** Splits at `sep` outside ( ) and [ ], so a "; " inside a bracketed note
 *  stays with its clause (the same depth rule as clauses() in
 *  lessonSteps.ts). */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** Index of the first "label: value" colon outside brackets, or -1. Only a
 *  colon followed by a space counts, so "LEM:x" and "1:7" never do. */
function labelColon(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (c === ":" && depth === 0 && /\s/.test(s[i + 1] ?? "")) return i;
  }
  return -1;
}

/** Removes every "( … )" group that holds a QAC feature string, e.g.
 *  "(dari kata 1:1:1: P|PREFIX|bi+ …)", with the space before it. Whole
 *  groups only, so the brackets left behind stay balanced. */
function dropMachineParens(s: string): string {
  const drop: boolean[] = new Array<boolean>(s.length).fill(false);
  const open: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") {
      open.push(i);
    } else if (s[i] === ")") {
      const start = open.pop();
      if (start === undefined || !isMachine(s.slice(start + 1, i))) continue;
      let from = start;
      while (from > 0 && /\s/.test(s[from - 1])) from--;
      drop.fill(true, from, i + 1);
    }
  }
  let out = "";
  for (let i = 0; i < s.length; i++) if (!drop[i]) out += s[i];
  return out;
}

/**
 * The human-readable part of a ref, or undefined when nothing readable is
 * left. "(1:1:1:*) — akar, lemma, kelas kata: P|PREFIX|bi+ …" → "akar,
 * lemma, kelas kata"; "sha256:…; LEM:r~aHoma`n" → undefined; "jil. 1, hlm. 9"
 * is kept as is.
 *
 * Clauses split at a top-level "; " only, so a bracketed note keeps its own
 * semicolons and every bracket stays balanced. A label whose value was only
 * tags ("lemma yang disebut di keterangan: LEM:…") is dropped when other
 * readable text exists, because on its own it reads as a fragment.
 */
export function readableRef(ref?: string): string | undefined {
  if (!ref) return undefined;
  const parts: { text: string; labelOnly: boolean }[] = [];
  for (const raw of splitTopLevel(ref.replace(SHA, ""), ";")) {
    let p = raw.trim().replace(LOC_PREFIX, "").trim();
    // "LEM:… di 4:69": the clause is about the tag itself; nothing to show.
    if (STARTS_WITH_TAG.test(p) && !LEAD_TAGS.test(p)) continue;
    p = dropMachineParens(p.replace(LEAD_TAGS, "")).trim();
    let labelOnly = false;
    const colon = labelColon(p);
    if (colon >= 0 && isTag(p.slice(colon + 1))) {
      p = p.slice(0, colon);
      labelOnly = true;
    }
    p = p.replace(TAG_TOKEN, "").replace(/\s{2,}/g, " ").replace(EDGE_PUNCT, "");
    if (p.length > 0 && !isTag(p) && READABLE.test(p) && !parts.some((q) => q.text === p)) {
      parts.push({ text: p, labelOnly });
    }
  }
  const kept = parts.some((q) => !q.labelOnly) ? parts.filter((q) => !q.labelOnly) : parts;
  return kept.length > 0 ? kept.map((q) => q.text).join("; ") : undefined;
}

export type SourceDisplay = {
  /** Short kitab or dataset name. */
  name: string;
  /** Edition details taken out of the name (editor, publisher, printing,
   *  year), shown on their own line so they stay visible on touch screens. */
  edition?: string;
  /** Where in it, in words (page, ayah, what was looked up). */
  detail?: string;
  /** The complete, unaltered citation. */
  full: string;
};

export function displaySource(s: { kitab: string; ref?: string }): SourceDisplay {
  const { name, edition } = splitKitab(s.kitab);
  return {
    name,
    edition,
    detail: readableRef(s.ref),
    full: s.ref ? `${s.kitab} ${s.ref}` : s.kitab,
  };
}

export type Source = {
  name: string;
  role: string;
  licence: string;
  credit: string;
  url: string;
  status: "in_use" | "planned";
};

export const SOURCES: Source[] = [
  {
    name: "Tanzil Quran Text (Uthmani, v1.1)",
    role: "Teks Al-Qur'an (rasm Utsmani, riwayat Hafs)",
    licence: "CC BY 3.0 — salinan verbatim, tanpa perubahan",
    credit: "Tanzil Quran Text — tanzil.net",
    url: "https://tanzil.net/docs/text_license",
    status: "planned",
  },
  {
    name: "Quranic Arabic Corpus 0.4",
    role: "Akar kata, lemma, jenis kata (bahan penyusunan; ditinjau manusia)",
    licence: "GNU GPL; salinan verbatim; wajib menyebut dan menautkan sumber",
    credit: "Quranic Arabic Corpus — corpus.quran.com",
    url: "https://corpus.quran.com",
    status: "planned",
  },
  {
    name: "quran-align (Collin Fair)",
    role: "Penanda waktu per kata pada bacaan qari",
    licence: "CC BY 4.0",
    credit: "Word timings: Collin Fair, quran-align (CC BY 4.0)",
    url: "https://github.com/cpfair/quran-align",
    status: "planned",
  },
  {
    name: "Bacaan Syaikh Mishary Rasyid Alafasy",
    role: "Bacaan imam utama (diputar langsung dari EveryAyah.com, tidak disimpan di server kami)",
    licence: "Diputar dari server penyedia; hak rekaman tetap pada pemiliknya",
    credit: "Recitation: Mishary Rashid Alafasy via EveryAyah.com",
    url: "https://everyayah.com",
    status: "planned",
  },
  {
    name: "Bacaan Syaikh Mahmud Khalil al-Husary (Mu'allim)",
    role: "Bacaan imam untuk mendengar dan menirukan (diputar langsung, tidak disimpan)",
    licence: "Diputar dari server penyedia; hak rekaman tetap pada pemiliknya",
    credit: "Recitation: Mahmoud Khalil Al-Husary (Mu'allim)",
    url: "https://quran.com",
    status: "planned",
  },
  {
    name: "QuranEnc — Terjemahan Indonesia (Kementerian Agama)",
    role: "Terjemahan ayat, dicantumkan persis dengan nama dan versinya",
    licence: "Ketentuan QuranEnc (tanpa perubahan, sebut sumber)",
    credit: "QuranEnc.com",
    url: "https://quranenc.com",
    status: "planned",
  },
  {
    name: "Kitab rujukan i'rab dan tafsir",
    role: "Darwish (I'rab al-Qur'an wa Bayanuh), Safi (al-Jadwal), al-Kharrat (al-Mujtaba), an-Nahhas, as-Samin (ad-Durr al-Mashun), Ibn Katsir, ath-Thabari, Ibnul Jazari (an-Nasyr)",
    licence: "Dikutip seperlunya dan diparafrasekan, dengan rujukan jilid/halaman",
    credit: "Rujukan dicantumkan pada setiap kata dan ayat",
    url: "https://dakwah-lens.id/belajar/id/kredit",
    status: "planned",
  },
];
