/**
 * The plan's case studies (docs/waris-plan.md §4, cases 1–16, amounts in Rp juta, both columns)
 * as an engine check: a third oracle beside the vectors and the invariants. Case pages will be
 * computed by the engine at build time (plan §4); this catches a drift between the engine and the
 * numbers the plan already prints. Plain TypeScript, no vitest import.
 */
import { floorDiv } from "../frac";
import { solve } from "../solve";
import type { FamilyInput, Person, Result, WarisInput } from "../types";

const J = BigInt(1000000);
const rp = (juta: number) => BigInt(juta) * J;
const P = (id: string, sex: "L" | "P", extra: Partial<Person> = {}): Person => ({ id, sex, alive: true, religion: "islam", ...extra });
const fam = (sex: "L" | "P", f: Partial<FamilyInput>): FamilyInput => ({
  deceased: { sex, religion: "islam" },
  spouses: [],
  children: [],
  siblings: [],
  paternalUncles: [],
  ...f,
});

export interface PlanCase {
  id: string;
  title: string;
  input: WarisInput;
  /** person id → Rp juta, per column; absent person = receives nothing (blocked / not an heir). */
  fikih: Record<string, number>;
  court: Record<string, number>;
  /** Extra non-heir rupiah lines (wasiat wajibah, wasiat, harta bersama) per column. */
  fikihLines?: Record<string, number>;
  courtLines?: Record<string, number>;
}

const net = (n: number) => ({ hartaBawaan: rp(n) });

export const PLAN_CASES: readonly PlanCase[] = [
  {
    id: "kasus-1",
    title: "Keluarga inti: wife, 2 sons, 1 daughter; 400",
    input: { family: fam("L", { spouses: [P("istri", "P")], children: [P("s1", "L"), P("s2", "L"), P("d1", "P")] }), estate: net(400) },
    fikih: { istri: 50, s1: 140, s2: 140, d1: 70 },
    court: { istri: 50, s1: 140, s2: 140, d1: 70 },
  },
  {
    id: "kasus-2",
    title: "Wife, mother, 1 son, 2 full brothers; 480",
    input: {
      family: fam("L", {
        spouses: [P("istri", "P")],
        mother: P("ibu", "P"),
        children: [P("s1", "L")],
        siblings: [{ ...P("b1", "L"), line: "kandung" }, { ...P("b2", "L"), line: "kandung" }],
      }),
      estate: net(480),
    },
    fikih: { istri: 60, ibu: 80, s1: 340 },
    court: { istri: 60, ibu: 80, s1: 340 },
  },
  {
    id: "kasus-3",
    title: "Harta bersama 1.000 + rice field 300; funeral 12, debt 48, wasiat 20; wife, mother, son, daughter",
    input: {
      family: fam("L", { spouses: [P("istri", "P")], mother: P("ibu", "P"), children: [P("s1", "L"), P("d1", "P")] }),
      estate: { hartaBawaan: rp(300), hartaBersama: [{ period: 1, amount: rp(1000) }], biayaJenazah: rp(12), utang: rp(48), wasiat: [{ toHeir: false, amount: rp(20) }] },
    },
    fikih: { istri: 90, ibu: 120, s1: 340, d1: 170 },
    court: { istri: 90, ibu: 120, s1: 340, d1: 170 },
    fikihLines: { "harta_bersama:istri": 500, wasiat: 20, biayaJenazah: 12, utang: 48 },
    courtLines: { "harta_bersama:istri": 500, wasiat: 20, biayaJenazah: 12, utang: 48 },
  },
  {
    id: "kasus-4",
    title: "Radd: daughter and mother; 240",
    input: { family: fam("L", { children: [P("d1", "P")], mother: P("ibu", "P") }), estate: net(240) },
    fikih: { d1: 180, ibu: 60 },
    court: { d1: 180, ibu: 60 },
  },
  {
    id: "kasus-5a",
    title: "'Umariyyatain: husband, father, mother; 300",
    input: { family: fam("P", { spouses: [P("suami", "L")], father: P("ayah", "L"), mother: P("ibu", "P") }), estate: net(300) },
    fikih: { suami: 150, ibu: 50, ayah: 100 },
    court: { suami: 150, ibu: 50, ayah: 100 },
  },
  {
    id: "kasus-5b",
    title: "'Umariyyatain, wife version: ¼, ¼, ½ of 300",
    input: { family: fam("L", { spouses: [P("istri", "P")], father: P("ayah", "L"), mother: P("ibu", "P") }), estate: net(300) },
    fikih: { istri: 75, ibu: 75, ayah: 150 },
    court: { istri: 75, ibu: 75, ayah: 150 },
  },
  {
    id: "kasus-6",
    title: "'Aul 7/6 → 7: husband, 2 full sisters; 210",
    input: { family: fam("P", { spouses: [P("suami", "L")], siblings: [{ ...P("z1", "P"), line: "kandung" }, { ...P("z2", "P"), line: "kandung" }] }), estate: net(210) },
    fikih: { suami: 90, z1: 60, z2: 60 },
    court: { suami: 90, z1: 60, z2: 60 },
  },
  {
    id: "kasus-7",
    title: "'Aul 24 → 27: wife, father, mother, 2 daughters; 270",
    input: {
      family: fam("L", { spouses: [P("istri", "P")], father: P("ayah", "L"), mother: P("ibu", "P"), children: [P("d1", "P"), P("d2", "P")] }),
      estate: net(270),
    },
    fikih: { istri: 30, ayah: 40, ibu: 40, d1: 80, d2: 80 },
    court: { istri: 30, ayah: 40, ibu: 40, d1: 80, d2: 80 },
  },
  {
    id: "kasus-8",
    title: "One daughter, one full sister; 300",
    input: { family: fam("L", { children: [P("d1", "P")], siblings: [{ ...P("z1", "P"), line: "kandung" }] }), estate: net(300) },
    fikih: { d1: 150, z1: 150 },
    court: { d1: 300 },
  },
  {
    id: "kasus-9",
    title: "Living son Budi; predeceased daughter Sari with 2 daughters; 300",
    input: {
      family: fam("L", { children: [P("budi", "L"), { id: "sari", sex: "P", alive: false, religion: "islam", children: [P("c1", "P"), P("c2", "P")] }] }),
      estate: net(300),
    },
    fikih: { budi: 300 },
    court: { budi: 200, c1: 50, c2: 50 },
  },
  {
    id: "kasus-10",
    title: "Wife, 1 full brother, court-adopted son Dimas; 360",
    input: {
      family: fam("L", {
        spouses: [P("istri", "P")],
        siblings: [{ ...P("b1", "L"), line: "kandung" }],
        adoptedChildren: [{ ...P("dimas", "L"), courtOrder: true }],
      }),
      estate: net(360),
    },
    fikih: { istri: 90, b1: 270 },
    court: { istri: 60, b1: 180 },
    courtLines: { "wasiat_wajibah:anak_angkat": 120 },
  },
  {
    id: "kasus-11",
    title: "Wife, 2 Muslim sons, 1 non-Muslim daughter; 320",
    input: {
      family: fam("L", { spouses: [P("istri", "P")], children: [P("s1", "L"), P("s2", "L"), P("d1", "P", { religion: "non_islam" })] }),
      estate: net(320),
    },
    fikih: { istri: 40, s1: 140, s2: 140 },
    court: { istri: 40, s1: 112, s2: 112 },
    courtLines: { "wasiat_wajibah:anak_pr": 56 },
  },
  {
    id: "kasus-12",
    title: "Radd with a spouse: wife, 1 daughter; 400",
    input: { family: fam("L", { spouses: [P("istri", "P")], children: [P("d1", "P")] }), estate: net(400) },
    fikih: { istri: 50, d1: 350 },
    court: { istri: 50, d1: 350 },
  },
  {
    id: "kasus-14a",
    title: "Long-undivided estate, stage 1: wife, son, daughter; 480",
    input: { family: fam("L", { spouses: [P("siti", "P")], children: [P("s1", "L"), P("d1", "P")] }), estate: net(480) },
    fikih: { siti: 60, s1: 280, d1: 140 },
    court: { siti: 60, s1: 280, d1: 140 },
  },
  {
    id: "kasus-14b",
    title: "Long-undivided estate, stage 2 ('Hitung untuk beliau'): Bu Siti's 60 to son and daughter",
    input: { family: fam("P", { children: [P("s1", "L"), P("d1", "P")] }), estate: net(60) },
    fikih: { s1: 40, d1: 20 },
    court: { s1: 40, d1: 20 },
  },
  {
    id: "kasus-15",
    title: "Second wife, a son of the first marriage, a daughter of the second; 360",
    input: { family: fam("L", { spouses: [P("istri2", "P")], children: [P("s1", "L"), P("d1", "P")] }), estate: net(360) },
    fikih: { istri2: 45, s1: 210, d1: 105 },
    court: { istri2: 45, s1: 210, d1: 105 },
  },
  {
    id: "kasus-16",
    title: "Young widow with small children and the mother: wife, 1 son, 2 daughters, mother; 480",
    input: {
      family: fam("L", { spouses: [P("istri", "P")], children: [P("s1", "L"), P("d1", "P"), P("d2", "P")], mother: P("ibu", "P") }),
      estate: net(480),
    },
    fikih: { istri: 60, ibu: 80, s1: 170, d1: 85, d2: 85 },
    court: { istri: 60, ibu: 80, s1: 170, d1: 85, d2: 85 },
  },
];

/** Case 13 (Ibnu Mas'ud) is the vector bukhari-6742-anakpr-cucupr-sdrpr; it has no amounts in the plan. */

function personRupiah(r: Result): Map<string, bigint> {
  const m = new Map<string, bigint>();
  if (r.kind !== "hasil") return m;
  for (const g of r.shares) for (const p of g.persons) if (p.rupiah !== undefined && p.rupiah > BigInt(0)) m.set(p.personId, p.rupiah);
  return m;
}

export interface CaseFailure {
  id: string;
  column: string;
  message: string;
}

export function runPlanCases(): { checked: number; failures: CaseFailure[] } {
  const failures: CaseFailure[] = [];
  let checked = 0;
  for (const c of PLAN_CASES) {
    for (const [column, want, lines] of [
      ["klasik-syafii", c.fikih, c.fikihLines],
      ["standar-indonesia", c.court, c.courtLines],
    ] as const) {
      checked++;
      const r = solve(c.input, column);
      if (r.kind !== "hasil") {
        failures.push({ id: c.id, column, message: `refused: ${r.reasons.join(",")}` });
        continue;
      }
      const got = personRupiah(r);
      const wantMap = new Map(Object.entries(want).map(([k, v]) => [k, rp(v)] as const));
      for (const [k, v] of wantMap) if (got.get(k) !== v) failures.push({ id: c.id, column, message: `${k}: plan ${floorDiv(v, J)} juta, engine ${got.has(k) ? `${got.get(k)}` : "none"}` });
      for (const [k, v] of got) if (!wantMap.has(k)) failures.push({ id: c.id, column, message: `${k}: engine gives ${v}, plan gives nothing` });
      for (const [k, v] of Object.entries(lines ?? {})) {
        const g = r.rupiah?.[k];
        if (g !== rp(v)) failures.push({ id: c.id, column, message: `line ${k}: plan ${v} juta, engine ${g ?? "none"}` });
      }
    }
  }
  return { checked, failures };
}
