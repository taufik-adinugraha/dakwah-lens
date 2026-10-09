/**
 * Dalil cards (plan §6 row 4, D10). Every Arabic string is a slice of a dalil.json /
 * dalil-gaps.json record field, carried with its offsets so the checks can rebuild it byte for
 * byte; nothing is retyped and nothing is translated here.
 *
 * Display rules applied (plan D10, operator decision "no human review"):
 *  - Qur'an: the record's Tanzil Uthmani `ar`; Indonesian = QuranEnc indonesian_affairs, with the
 *    translator's footnotes whole.
 *  - Sahih Muslim: the corpus `id` translation, labelled as an internal translation.
 *  - Bukhari, Bulugh, fiqh and tafsir: no Indonesian exists in the corpus, so the card shows the
 *    Arabic and its citation only (a generated rendering is forbidden), with a line saying so.
 *  - Bulugh: the matn span (`ar_matn_and_ibn_hajar_attribution`), with the editor's in-text
 *    footnote marker (digits + U+200F, e.g. H-BULUGH-1116 "1\u200f") cut out at display time by
 *    splitting the slice; dalil.json is not altered. Its local number is not shown.
 *  - H-BUKHARI-6734 is labelled "Putusan Mu'adh bin Jabal (atsar)".
 */
import { msg, type Msg } from "./messages";
import type { ReportDalilRecord } from "./content";
import type { ArabicView, CitationView, DalilCard, MeaningView, Segment } from "./types";

/** The editor's in-text footnote marker inside a Bulugh matn span (pipeline/validate_waris.py). */
const INTEXT_MARKER = /\s[0-9]+\u200f/g;
const ATSAR_MUADH = new Set(["H-BUKHARI-6734"]);

function str(r: ReportDalilRecord, field: string): string | null {
  const v = r[field];
  return typeof v === "string" ? v : null;
}

function getPath(r: ReportDalilRecord, path: string): unknown {
  let cur: unknown = r;
  for (const k of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Read the string at a record path ("translations.id.text"); null when absent. */
export function recordString(r: ReportDalilRecord, path: string): string | null {
  const v = getPath(r, path);
  return typeof v === "string" ? v : null;
}

function wholeSlice(r: ReportDalilRecord, field: string, script: ArabicView["script"]): ArabicView | null {
  const s = str(r, field);
  if (!s) return null;
  return { text: s, segments: [{ recordId: r.id, field, start: 0, end: s.length }], script };
}

/** A slice with every in-text footnote marker cut out (one segment per kept stretch). */
function sliceWithoutMarkers(r: ReportDalilRecord, field: string): ArabicView | null {
  const s = str(r, field);
  if (!s) return null;
  const segments: Segment[] = [];
  let pos = 0;
  const re = new RegExp(INTEXT_MARKER.source, "g"); // exec loop, not matchAll (older Android browsers)
  for (let m = re.exec(s); m !== null; m = re.exec(s)) {
    const at = m.index;
    if (at > pos) segments.push({ recordId: r.id, field, start: pos, end: at });
    pos = at + m[0].length;
    // the marker sat between two spaces: keep only one of them
    const last = segments[segments.length - 1];
    if (last && /\s/.test(s.charAt(last.end - 1)) && /\s/.test(s.charAt(pos))) pos += 1;
  }
  if (pos < s.length) segments.push({ recordId: r.id, field, start: pos, end: s.length });
  return { text: segments.map((g) => s.slice(g.start, g.end)).join(""), segments, script: "naskh" };
}

function citationOf(r: ReportDalilRecord): CitationView {
  const ref = r.ref as { surah?: unknown; ayah?: unknown } | undefined;
  const surah = typeof ref?.surah === "number" ? ref.surah : null;
  const ayah = typeof ref?.ayah === "number" ? ref.ayah : null;
  const url = str(r, "url");
  switch (r.kind) {
    case "quran":
      return { kind: "quran", text: str(r, "citation") ?? r.id, surah, ayah, number: null, section: null, url };
    case "hadith": {
      const collection = str(r, "collection") ?? "";
      if (collection.startsWith("Bulugh al-Maram")) {
        // plan D10: not the local (AhmedBaset) number; the primaries are named in the Arabic itself
        const head = collection.split(",")[0];
        return { kind: "hadith", text: head, surah: null, ayah: null, number: null, section: null, url: null };
      }
      const citation = str(r, "citation") ?? r.id;
      const m = /([0-9]+[a-z]?)$/.exec(citation);
      return { kind: "hadith", text: citation, surah: null, ayah: null, number: m ? m[1] : null, section: null, url };
    }
    case "fiqh": {
      const book = str(r, "book") ?? r.id;
      const section = str(r, "section_id");
      return { kind: "fiqh", text: book, surah: null, ayah: null, number: null, section, url };
    }
    case "tafsir": {
      const book = (str(r, "book") ?? r.id).replace(/ \(AR\)$/, "");
      const label = str(r, "display_label") ?? (surah !== null && ayah !== null ? `${book}, ${surah}:${ayah}` : book);
      return { kind: "tafsir", text: label, surah, ayah, number: null, section: null, url };
    }
    default:
      return { kind: "gap", text: str(r, "item") ?? r.id, surah: null, ayah: null, number: null, section: null, url: null };
  }
}

/**
 * Where a record's displayable Indonesian lives, with its exact source label (plan D10): QuranEnc
 * for the Qur'an, the internal translation for Sahih Muslim, nothing else. Shared by the card and
 * the printed primary span (primary.ts), so both quote the same text under the same label.
 */
export function translationOf(r: ReportDalilRecord): { path: string; label: Msg } | null {
  if (r.kind === "quran") return { path: "translations.id_quranenc_indonesian_affairs.text", label: msg("laporan.dalil.label_quranenc") };
  if (r.kind === "hadith" && (str(r, "collection") ?? "").startsWith("Sahih Muslim")) return { path: "translations.id.text", label: msg("laporan.dalil.label_muslim") };
  return null;
}

function meaningOf(r: ReportDalilRecord): MeaningView | null {
  const tr = translationOf(r);
  if (!tr) return null;
  const text = recordString(r, tr.path);
  if (!text) return null;
  if (r.kind === "quran") {
    const fpath = "translations.id_quranenc_indonesian_affairs.footnotes";
    const foot = recordString(r, fpath);
    return {
      text,
      source: { recordId: r.id, path: tr.path },
      label: tr.label,
      footnotes: foot ? { text: foot, source: { recordId: r.id, path: fpath } } : null,
    };
  }
  return { text, source: { recordId: r.id, path: tr.path }, label: tr.label, footnotes: null };
}

/** The card for one record; null when the record is not a displayable kind. */
export function dalilCard(r: ReportDalilRecord): DalilCard | null {
  if (!["quran", "hadith", "fiqh", "tafsir", "gap"].includes(r.kind)) return null;
  const citation = citationOf(r);
  const tags: Msg[] = [];
  let arabic: ArabicView | null = null;
  let heading: ArabicView | null = null;
  if (r.kind === "quran") arabic = wholeSlice(r, "ar", "quran");
  else if (r.kind === "hadith") {
    if ((str(r, "collection") ?? "").startsWith("Bulugh al-Maram")) {
      arabic = sliceWithoutMarkers(r, "ar_matn_and_ibn_hajar_attribution");
      tags.push(msg("laporan.dalil.bulugh"));
    } else arabic = wholeSlice(r, "ar", "naskh");
    if (ATSAR_MUADH.has(r.id)) tags.push(msg("laporan.dalil.atsar_muadh"));
  } else if (r.kind === "fiqh" || r.kind === "tafsir") {
    arabic = wholeSlice(r, "ar", "naskh");
    const title = r.kind === "fiqh" ? str(r, "title") : null;
    if (title) {
      const start = title.startsWith("• ") ? 2 : 0;
      if (title.length > start) heading = { text: title.slice(start), segments: [{ recordId: r.id, field: "title", start, end: title.length }], script: "naskh" };
    }
    if (Array.isArray(r.omit) && r.omit.length > 0) tags.push(msg("laporan.dalil.diringkas"));
    if (r.source_truncated === true) tags.push(msg("laporan.dalil.terpotong"));
  }
  const meaning = meaningOf(r);
  const meaningMissing = r.kind === "gap" ? msg("laporan.dalil.belum_ada") : meaning ? null : msg("laporan.dalil.tanpa_terjemah");
  return { id: r.id, kind: citation.kind, citation, arabic, heading, meaning, meaningMissing, tags };
}

/** Rebuild an ArabicView from its segments (the checks' byte test). */
export function rebuildArabic(view: ArabicView, records: Map<string, ReportDalilRecord>): string | null {
  let out = "";
  for (const g of view.segments) {
    const r = records.get(g.recordId);
    if (!r) return null;
    const s = r[g.field];
    if (typeof s !== "string" || g.start < 0 || g.end > s.length || g.start > g.end) return null;
    out += s.slice(g.start, g.end);
  }
  return out;
}
