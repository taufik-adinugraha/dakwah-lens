/**
 * The PRIMARY dalil of a "Dalil untuk setiap bagian" row, for the compact printout (plan §6
 * "Print and PDF", §10 M2.9: case 3 on at most 3 A4 pages). On screen every card is shown whole;
 * on paper each row prints only the clause of its first Qur'an / hadith source that gives this
 * share, and every other source is listed once as a citation.
 *
 * The span is never typed: SPANS holds record offsets only (UTF-16 code units, as String.slice
 * counts them), so the printed Arabic is `record[field].slice(start, end)` and the report checks
 * rebuild it byte for byte like every other ArabicView (checks/report.ts R4). A hadith span is the
 * matn only (no isnad). The matching translation is a slice of the corpus translation the screen
 * card shows (QuranEnc for the Qur'an, the internal one for Sahih Muslim); Bukhari and Bulugh have
 * none in the corpus, so their span prints in Arabic only.
 *
 * Each offset pair carries the FNV-1a checksum of the text it must cut. When dalil.json changes
 * and a checksum no longer matches, the span is dropped (the row prints its citations only) rather
 * than cutting the wrong words; report.test.ts fails on any such drift so it is fixed at once.
 *
 * Which clause belongs to which rule was chosen by reading each ayah / matn against the RuleNote
 * (plan §8 rule → corpus record); a span is used only when the RuleNote itself cites that record.
 * AI-assisted, not an authoritative fatwa.
 */
import { DESCENDANT_HEIRS, type RuleId } from "../registry";
import type { Ctx } from "./analysis";
import { recordString, translationOf } from "./dalil";
import type { ColumnId, HeirRow, PrimaryDalilView, RuleRefView } from "./types";

/** Offsets into one record field, with the checksum of the slice they must cut. */
interface Cut {
  start: number;
  end: number;
  check: string;
}

interface Span {
  recordId: string;
  /** The Arabic field the screen card shows ("ar"; Bulugh: "ar_matn_and_ibn_hajar_attribution"). */
  field: string;
  ar: Cut;
  /** Into the record's corpus translation (dalil.ts translationOf), when it has one. */
  tr?: Cut;
}

/**
 * The clauses. Q-4-11 / Q-4-12 / Q-4-176: Tanzil Uthmani `ar` + QuranEnc indonesian_affairs.
 * H-MUSLIM-1615a, H-MUSLIM-1628a: the quoted matn + the matching words of the corpus `id` text.
 * H-BUKHARI-6736: Ibn Mas'ud's "I judge by what the Prophet judged: …" up to the closing quote.
 * H-BULUGH-1103: the matn in Ibn Hajar's braces and his attribution after it, which names the
 *   primary sources (plan D10); the narrator chain before the brace is left out.
 */
export const SPANS = {
  dayn: { recordId: "Q-4-11", field: "ar", ar: { start: 404, end: 451, check: "8ffc451b" }, tr: { start: 750, end: 867, check: "e7339461" } },
  sepertiga: { recordId: "H-MUSLIM-1628a", field: "ar", ar: { start: 501, end: 530, check: "0f86706c" }, tr: { start: 575, end: 611, check: "192a72b4" } },
  suami_1_2: { recordId: "Q-4-12", field: "ar", ar: { start: 0, end: 72, check: "a3f8b7c8" }, tr: { start: 0, end: 125, check: "ff9b6604" } },
  suami_1_4: { recordId: "Q-4-12", field: "ar", ar: { start: 73, end: 134, check: "a71fb1a9" }, tr: { start: 126, end: 235, check: "29605fdb" } },
  istri_1_4: { recordId: "Q-4-12", field: "ar", ar: { start: 185, end: 253, check: "94aff0f3" }, tr: { start: 317, end: 408, check: "dacada25" } },
  istri_1_8: { recordId: "Q-4-12", field: "ar", ar: { start: 254, end: 316, check: "61cd5b92" }, tr: { start: 409, end: 506, check: "ba371744" } },
  seibu_1_6: { recordId: "Q-4-12", field: "ar", ar: { start: 368, end: 484, check: "c96fe028" }, tr: { start: 592, end: 868, check: "0b3fb42f" } },
  seibu_1_3: { recordId: "Q-4-12", field: "ar", ar: { start: 485, end: 553, check: "cce10f0c" }, tr: { start: 869, end: 983, check: "1e04cf68" } },
  anak_2_1: { recordId: "Q-4-11", field: "ar", ar: { start: 0, end: 76, check: "32a2a007" }, tr: { start: 0, end: 171, check: "319e3ec9" } },
  anak_pr_2_3: { recordId: "Q-4-11", field: "ar", ar: { start: 77, end: 145, check: "328b89dd" }, tr: { start: 177, end: 305, check: "267033f1" } },
  anak_pr_1_2: { recordId: "Q-4-11", field: "ar", ar: { start: 146, end: 187, check: "f9290406" }, tr: { start: 306, end: 405, check: "231f592f" } },
  abawain_1_6: { recordId: "Q-4-11", field: "ar", ar: { start: 188, end: 276, check: "753b13ce" }, tr: { start: 406, end: 535, check: "77d3d4dd" } },
  ibu_1_3: { recordId: "Q-4-11", field: "ar", ar: { start: 277, end: 353, check: "10af1181" }, tr: { start: 536, end: 663, check: "5de60ac4" } },
  ibu_1_6_ikhwah: { recordId: "Q-4-11", field: "ar", ar: { start: 354, end: 403, check: "bbb9235b" }, tr: { start: 664, end: 749, check: "17483d76" } },
  sdr_pr_1_2: { recordId: "Q-4-176", field: "ar", ar: { start: 58, end: 141, check: "0ebbee83" }, tr: { start: 121, end: 287, check: "f56ddde7" } },
  sdr_pr_2_3: { recordId: "Q-4-176", field: "ar", ar: { start: 190, end: 253, check: "3a32845e" }, tr: { start: 394, end: 499, check: "d1ad57cd" } },
  saudara_2_1: { recordId: "Q-4-176", field: "ar", ar: { start: 254, end: 340, check: "6024e836" }, tr: { start: 500, end: 666, check: "5d30581a" } },
  asabah: { recordId: "H-MUSLIM-1615a", field: "ar", ar: { start: 195, end: 273, check: "1251bc21" }, tr: { start: 198, end: 312, check: "e05c0dc8" } },
  takmilah: { recordId: "H-BUKHARI-6736", field: "ar", ar: { start: 384, end: 551, check: "4bbb5e6d" } },
  nenek: { recordId: "H-BULUGH-1103", field: "ar_matn_and_ibn_hajar_attribution", ar: { start: 41, end: 275, check: "c5d9025e" } },
} as const satisfies Record<string, Span>;

/** "anak": a descendant inherits in the row's column (the mother's sixth "if he has a child"); "tanpa_anak": none does (her sixth "if he has siblings"). */
type When = "anak" | "tanpa_anak";

export interface PrimarySpec {
  span: Span;
  /** The heir roles the clause speaks of; absent for the estate steps (no heir). */
  roles?: readonly string[];
  when?: When;
}

const ASABAH_ROLES = [
  "anak_lk",
  "cucu_lk",
  "ayah",
  "kakek",
  "sdr_lk_kandung",
  "sdr_lk_seayah",
  "keponakan_lk_kandung",
  "keponakan_lk_seayah",
  "paman_kandung",
  "paman_seayah",
  "sepupu_lk_kandung",
  "sepupu_lk_seayah",
] as const;
const SISTERS = ["sdr_pr_kandung", "sdr_pr_seayah"] as const;
const SEIBU = ["sdr_lk_seibu", "sdr_pr_seibu"] as const;

/**
 * Rule → candidate clauses, tried in order. Rules absent here (jadd.*, 'aul, radd, KHI switches,
 * umariyyatain, musytarakah, …) rest on ijtihad or on kitab texts: their rows print citations
 * only, unless a later rule of the same row has a clause.
 */
export const PRIMARY: Partial<Record<RuleId, readonly PrimarySpec[]>> = {
  "estate.utang": [{ span: SPANS.dayn }],
  "estate.wasiat": [{ span: SPANS.dayn }],
  "estate.wasiat_dibatasi_sepertiga": [{ span: SPANS.sepertiga }],
  "fardh.suami_1_2": [{ span: SPANS.suami_1_2, roles: ["suami"] }],
  "fardh.suami_1_4": [{ span: SPANS.suami_1_4, roles: ["suami"] }],
  "nuqshan.suami": [{ span: SPANS.suami_1_4, roles: ["suami"] }],
  "fardh.istri_1_4": [{ span: SPANS.istri_1_4, roles: ["istri"] }],
  "fardh.istri_1_8": [{ span: SPANS.istri_1_8, roles: ["istri"] }],
  "nuqshan.istri": [{ span: SPANS.istri_1_8, roles: ["istri"] }],
  "fardh.anak_pr_1_2": [{ span: SPANS.anak_pr_1_2, roles: ["anak_pr"] }],
  "fardh.anak_pr_2_3": [{ span: SPANS.anak_pr_2_3, roles: ["anak_pr"] }],
  "fardh.ayah_1_6": [{ span: SPANS.abawain_1_6, roles: ["ayah"] }],
  "nuqshan.ayah": [{ span: SPANS.abawain_1_6, roles: ["ayah"] }],
  "fardh.ibu_1_3": [{ span: SPANS.ibu_1_3, roles: ["ibu"] }],
  "fardh.ibu_1_6": [
    { span: SPANS.abawain_1_6, roles: ["ibu"], when: "anak" },
    { span: SPANS.ibu_1_6_ikhwah, roles: ["ibu"], when: "tanpa_anak" },
  ],
  "nuqshan.ibu": [
    { span: SPANS.abawain_1_6, roles: ["ibu"], when: "anak" },
    { span: SPANS.ibu_1_6_ikhwah, roles: ["ibu"], when: "tanpa_anak" },
  ],
  "fardh.nenek_1_6": [{ span: SPANS.nenek, roles: ["nenek_ibu", "nenek_ayah"] }],
  "fardh.cucu_pr_1_6_takmilah": [{ span: SPANS.takmilah, roles: ["cucu_pr"] }],
  "fardh.sdr_pr_1_2": [{ span: SPANS.sdr_pr_1_2, roles: SISTERS }],
  "fardh.sdr_pr_2_3": [{ span: SPANS.sdr_pr_2_3, roles: SISTERS }],
  "fardh.seibu_1_6": [{ span: SPANS.seibu_1_6, roles: SEIBU }],
  "fardh.seibu_1_3": [{ span: SPANS.seibu_1_3, roles: SEIBU }],
  "asabah.bin_nafs": [{ span: SPANS.asabah, roles: ASABAH_ROLES }],
  "asabah.bil_ghair": [
    { span: SPANS.anak_2_1, roles: ["anak_lk", "anak_pr", "cucu_lk", "cucu_pr"] },
    { span: SPANS.saudara_2_1, roles: ["sdr_lk_kandung", "sdr_pr_kandung", "sdr_lk_seayah", "sdr_pr_seayah"] },
  ],
  "asabah.maal_ghair": [{ span: SPANS.takmilah, roles: SISTERS }],
};

/** 32-bit FNV-1a over UTF-16 code units, as lowercase hex (bigint: the waris lint bans Math). */
export function fnv1a(s: string): string {
  const prime = BigInt(16777619);
  const mask = BigInt(4294967295);
  let h = BigInt(2166136261);
  for (let i = 0; i < s.length; i++) h = ((h ^ BigInt(s.charCodeAt(i))) * prime) & mask;
  return h.toString(16).padStart(8, "0");
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const SENTENCE_START = /^[A-Z("“]/;
const SENTENCE_END = /[.!?"”)]$/;

/** The slice of `text` the cut names, or null when the bounds or the checksum do not match. */
function sliceOf(text: string | null, c: Cut): string | null {
  if (text === null || c.start < 0 || c.end > text.length || c.start >= c.end) return null;
  const s = text.slice(c.start, c.end);
  return fnv1a(s) === c.check ? s : null;
}

/** The view of one span, or null when the record or a checksum does not match (then nothing prints). */
export function spanView(ctx: Ctx, span: Span): Omit<PrimaryDalilView, "first"> | null {
  const r = ctx.ix.dalil.get(span.recordId);
  if (!r) return null;
  const field = r[span.field];
  const whole = typeof field === "string" ? field : null;
  const text = sliceOf(whole, span.ar);
  if (text === null || whole === null) return null;
  let meaning: PrimaryDalilView["meaning"] = null;
  const tr = translationOf(r);
  if (span.tr && tr) {
    const full = recordString(r, tr.path);
    const t = sliceOf(full, span.tr);
    // never Arabic script outside a verified slice (the corpus translations write the salawat sign)
    if (t !== null && full !== null && !ARABIC.test(t)) {
      meaning = {
        text: t,
        label: tr.label,
        slice: { recordId: r.id, path: tr.path, start: span.tr.start, end: span.tr.end },
        cut: { start: span.tr.start > 0 && !SENTENCE_START.test(t), end: span.tr.end < full.length && !SENTENCE_END.test(t) },
      };
    }
  }
  return {
    id: r.id,
    arabic: { text, segments: [{ recordId: r.id, field: span.field, start: span.ar.start, end: span.ar.end }], script: r.kind === "quran" ? "quran" : "naskh" },
    meaning,
    cut: { start: span.ar.start > 0, end: span.ar.end < whole.length },
  };
}

const DESCENDANTS: ReadonlySet<string> = new Set<string>(DESCENDANT_HEIRS);

/** Does a descendant inherit in this column? (KHI 185 replacement heirs count in the court column.) */
export function descendantInherits(rows: readonly HeirRow[], col: ColumnId): boolean {
  return rows.some((r) => (DESCENDANTS.has(r.role) || r.role.startsWith("pengganti")) && !!r[col]?.total);
}

/**
 * The primary dalil of one row: the first rule (lead column first, then the court column's own
 * rules) with a clause for this role that the RuleNote itself cites. `key` dedupes shared spans.
 */
export function primaryOf(
  ctx: Ctx,
  groups: readonly { rules: readonly RuleRefView[]; descendant: boolean }[],
  role: string | null,
): { view: Omit<PrimaryDalilView, "first">; key: string } | null {
  for (const g of groups) {
    for (const r of g.rules) {
      for (const s of PRIMARY[r.ruleId] ?? []) {
        if (s.roles && (role === null || !s.roles.includes(role))) continue;
        if (s.when === "anak" && !g.descendant) continue;
        if (s.when === "tanpa_anak" && g.descendant) continue;
        if (!r.dalilIds.includes(s.span.recordId)) continue;
        const view = spanView(ctx, s.span);
        if (view) return { view, key: `${s.span.recordId}|${s.span.field}|${s.span.ar.start}|${s.span.ar.end}` };
      }
    }
  }
  return null;
}
