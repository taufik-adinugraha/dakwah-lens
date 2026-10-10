/**
 * Pure helpers between the questionnaire model and its screens: how an answer reads, which
 * "Langkah" a screen is, and the live family tree's rows (ux.md §4.7). No React, no I/O: every
 * function here returns message KEYS in the "Q" namespace (messages/waris/*.json, copied 1:1 from
 * lib/waris/questionnaire/text.ts plus this UI's own "ui.*" keys), never prose, so the copy stays
 * in the message files (plan D10). AI-assisted, not an authoritative fatwa.
 */
import {
  NODE,
  TIDAK_TAHU,
  familyPreview,
  type AnswerValue,
  type Answers,
  type LP,
  type NodeView,
  type QKey,
  type Walk,
} from "@/lib/waris/questionnaire";

/** A message in the "Q" namespace with its values (the page adds messageVars()). */
export interface TextRef {
  key: string;
  values?: Record<string, string | number>;
}

const isLP = (v: AnswerValue): v is LP => typeof v === "object" && v !== null && !Array.isArray(v);

function optionText(nv: NodeView, id: string): string {
  return nv.options.find((o) => o.id === id)?.text ?? `${nv.id}.opsi.${id}`;
}

/** How an answer reads on the review screen and on the printed answer summary. */
export function answerParts(nv: NodeView, value: AnswerValue): TextRef[] {
  if (value === TIDAK_TAHU) return [{ key: "umum.tidak_tahu" }];
  switch (nv.kind) {
    case "pilih":
    case "peran":
      return typeof value === "string" ? [{ key: optionText(nv, value) }] : [];
    case "pilih_banyak": {
      const xs = Array.isArray(value) ? (value as readonly string[]) : [];
      if (xs.length === 0) return [{ key: nv.id === "A3" ? "A3.opsi.k0" : "umum.tidak_ada" }];
      return xs.map((x) => ({ key: optionText(nv, x) }));
    }
    case "jumlah":
      if (typeof value !== "number") return [];
      // a 0–1 count is asked as yes/no (QuestionCard YesNoCount: B3 with one spouse)
      if (nv.min === 0 && nv.max === 1) return [{ key: value === 1 ? "umum.ya" : "umum.tidak" }];
      return [{ key: "ui.jawaban_orang", values: { n: value } }];
    case "jumlah_lp": {
      if (!isLP(value)) return [];
      if (value.L === 0 && value.P === 0) return [{ key: "umum.tidak_ada" }];
      const out: TextRef[] = [];
      if (value.L > 0) out.push({ key: "ui.jawaban_l", values: { n: value.L } });
      if (value.P > 0) out.push({ key: "ui.jawaban_p", values: { n: value.P } });
      return out;
    }
  }
}

/** "Langkah N": answered screens before this one, plus one (plan §5.5 counts the same screens). */
export function stepNumber(w: Walk, key: QKey | null): number {
  let n = 0;
  for (const s of w.steps) {
    if (s.key === key) return n + 1;
    if (NODE[s.id].screen) n++;
  }
  return n + 1;
}

// ---------------------------------------------------------------------------------------------
// The live family tree (ux.md §4.7)
// ---------------------------------------------------------------------------------------------

export type TreeRowId = "kakek_nenek" | "orang_tua" | "pewaris" | "anak" | "cucu";
export type TreeFlag = "beda_agama" | "wafat_dulu" | "bukan_ahli";

export interface TreeNode {
  /** Stable id for React and for the growth animation. */
  id: string;
  /** familyPreview() role ("anak_lk", "istri", …) or "pewaris". */
  role: string;
  /** People this node stands for (> 3 collapse into one node, "×7"). */
  count: number;
  flags: TreeFlag[];
  /** Added by the most recent answer (3px outline + the word "baru", not colour alone). */
  baru: boolean;
  /** The question that entered this relative ("Ubah: …"), when it is on the path. */
  edit: QKey | null;
}

export interface TreeRow {
  id: TreeRowId;
  nodes: TreeNode[];
}

const ROWS: readonly (readonly [TreeRowId, readonly string[]])[] = [
  ["kakek_nenek", ["kakek", "nenek_ayah", "nenek_ibu"]],
  ["orang_tua", ["paman_kandung", "paman_seayah", "ayah", "ibu"]],
  [
    "pewaris",
    [
      "sepupu_lk_kandung",
      "sepupu_lk_seayah",
      "sdr_lk_kandung",
      "sdr_pr_kandung",
      "sdr_lk_seayah",
      "sdr_pr_seayah",
      "sdr_lk_seibu",
      "sdr_pr_seibu",
      "pewaris",
      "istri",
      "suami",
    ],
  ],
  ["anak", ["keponakan_lk_kandung", "keponakan_lk_seayah", "anak_lk", "anak_pr", "anak_lk_wafat", "anak_pr_wafat", "anak_angkat", "anak_tiri"]],
  ["cucu", ["cucu_lk", "cucu_pr", "cucu_dari_anak_pr"]],
];

/** Which question entered a role (the first of these keys that is on the path). */
const EDIT_KEYS: Readonly<Record<string, readonly QKey[]>> = {
  istri: ["B2", "B1"],
  suami: ["B1"],
  anak_lk: ["C1"],
  anak_pr: ["C1"],
  anak_lk_wafat: ["C3"],
  anak_pr_wafat: ["C3"],
  cucu_lk: ["C3"],
  cucu_pr: ["C3"],
  cucu_dari_anak_pr: ["C3"],
  ayah: ["D1"],
  ibu: ["D1"],
  kakek: ["D3"],
  nenek_ibu: ["D3"],
  nenek_ayah: ["D3"],
  sdr_lk_kandung: ["E1"],
  sdr_pr_kandung: ["E1"],
  sdr_lk_seayah: ["E2"],
  sdr_pr_seayah: ["E2"],
  sdr_lk_seibu: ["E3"],
  sdr_pr_seibu: ["E3"],
  keponakan_lk_kandung: ["F1"],
  keponakan_lk_seayah: ["F1"],
  paman_kandung: ["F2"],
  paman_seayah: ["F2"],
  sepupu_lk_kandung: ["F3"],
  sepupu_lk_seayah: ["F3"],
  anak_angkat: ["A3b"],
  anak_tiri: ["A3"],
};

/** Counts above this collapse into one node (ux.md §4.7). */
export const COLLAPSE_ABOVE = 3;

export type Preview = ReturnType<typeof familyPreview>;

function baseFlags(role: string): TreeFlag[] {
  if (role.endsWith("_wafat")) return ["wafat_dulu"];
  if (role === "anak_angkat" || role === "anak_tiri") return ["bukan_ahli"];
  return [];
}

/**
 * The tree's rows for the answers so far. `before` is the preview before the most recent answer
 * (for "baru"); `onPath` says which questions can be reopened with "Ubah".
 */
export function treeRows(now: Preview, before: Preview | null, hasPewaris: boolean, onPath: (key: QKey) => boolean): TreeRow[] {
  const prev = new Map<string, number>();
  for (const p of before ?? []) prev.set(p.role, p.count);
  const byRole = new Map(now.map((p) => [p.role, p]));
  const rows: TreeRow[] = [];
  for (const [rowId, roles] of ROWS) {
    const nodes: TreeNode[] = [];
    for (const role of roles) {
      if (role === "pewaris") {
        if (hasPewaris) nodes.push({ id: "pewaris", role, count: 1, flags: [], baru: false, edit: null });
        continue;
      }
      const p = byRole.get(role);
      if (!p || p.count <= 0) continue;
      const baru = before !== null && p.count > (prev.get(role) ?? 0);
      const edit = (EDIT_KEYS[role] ?? []).find(onPath) ?? null;
      const parts: { n: number; flags: TreeFlag[]; tag: string }[] = [
        { n: p.count - p.bukanMuslim, flags: baseFlags(role), tag: "m" },
        { n: p.bukanMuslim, flags: [...baseFlags(role), "beda_agama"], tag: "b" },
      ];
      for (const part of parts) {
        if (part.n <= 0) continue;
        if (part.n > COLLAPSE_ABOVE) nodes.push({ id: `${role}-${part.tag}`, role, count: part.n, flags: part.flags, baru, edit });
        else for (let i = 0; i < part.n; i++) nodes.push({ id: `${role}-${part.tag}-${i}`, role, count: 1, flags: part.flags, baru, edit });
      }
    }
    if (nodes.length > 0) rows.push({ id: rowId, nodes });
  }
  return rows;
}

/** People entered so far (the phone bar: "Keluarga yang sudah dimasukkan: 6 orang"). */
export function peopleCount(now: Preview): number {
  return now.reduce((n, p) => n + p.count, 0);
}

/** The answers as they were before `key` changed (for "baru"): the key's previous value, or none. */
export function answersBefore(answers: Answers, key: QKey | null, previous: AnswerValue | undefined): Answers | null {
  if (key === null) return null;
  const out: Record<string, AnswerValue> = { ...answers };
  if (previous === undefined) delete out[key];
  else out[key] = previous;
  return out;
}

/** Join labels as "a, b dan c" (Indonesian list), for the skip lines and the tree summary. */
export function joinList(parts: readonly string[], dan: string): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${dan} ${parts[parts.length - 1]}`;
}

/** "Anak laki-laki" → "anak laki-laki" when a label sits mid-sentence. */
export function lowerFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1);
}
