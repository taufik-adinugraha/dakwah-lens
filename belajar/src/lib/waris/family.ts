/**
 * From the structured FamilyInput to the classical view the solver works on (engine.md §2
 * "Derived flat view"): eligible heirs by role, KHI-185 slots (substitution.ts), dzawil arham with
 * their wasith, relatives beyond the depth limit, and wasiat-wajibah candidates.
 */
import { INELIGIBLE_RULE, eligibility } from "./eligibility";
import { DZAWIL, KERABAT_JAUH_ROLE, type DzawilId, type HeirId, type NoteId, type RujukReason, type Sex, type Switches } from "./registry";
import { slotFor } from "./substitution";
import type { FamilyInput, IneligibleGroup, IneligibleReason, Member, Person, Slot } from "./types";

export interface DzPerson {
  personId: string;
  relation: DzawilId;
  wasithRole: HeirId;
  /** Relatives with the same key stand in the same wasith (person id, or a position key). */
  wasithKey: string;
  sex: Sex;
}

export type BeyondKind = "keturunan" | "saudara" | "paman";
export interface Beyond {
  personId: string;
  kind: BeyondKind;
  /** A living, eligible parent who is an heir or KHI substitute excludes their own line. */
  by?: string;
}

export interface WwCandidate {
  personId: string;
  key: string;
  /** The heir position the person would hold as a Muslim / natural relative. */
  role: HeirId;
  sex: Sex;
  kind: "non_muslim" | "anak_angkat" | "orang_tua_angkat";
}

export interface Derived {
  roles: Partial<Record<HeirId, Member[]>>;
  slots: Slot[];
  dzawil: DzPerson[];
  ineligible: IneligibleGroup[];
  /** Every living relative in the input (each must end in shares, blocked or ineligible). */
  present: string[];
  /** personId → output key (role, or role#i in input order; slot members "pengganti_k.L#i"). */
  keys: Map<string, string>;
  beyond: Beyond[];
  ww: WwCandidate[];
  notes: NoteId[];
  rujuk: RujukReason[];
  /** Living spouses in marriage order (harta-bersama periods), eligible or not. */
  spouses: { personId: string; key: string }[];
  /** Eligible living son / son's son anywhere in the tree (beyond-depth exclusion, both columns). */
  livingSon: boolean;
  livingSonsSon: boolean;
}

export function deriveFamily(fam: FamilyInput, sw: Switches): Derived {
  const roles: Partial<Record<HeirId, Member[]>> = {};
  const slots: Slot[] = [];
  const dzawil: DzPerson[] = [];
  const inel = new Map<string, IneligibleGroup>();
  const present: string[] = [];
  const roleOrder = new Map<string, string[]>(); // role → person ids (for keys)
  const beyond: Beyond[] = [];
  const ww: WwCandidate[] = [];
  const notes = new Set<NoteId>();
  const rujuk = new Set<RujukReason>();
  const seen = new Set<string>();
  let livingSon = false;
  let livingSonsSon = false;

  const track = (p: Person, role: string) => {
    if (seen.has(p.id)) throw new Error(`waris/family: duplicate person id ${p.id}`);
    seen.add(p.id);
    present.push(p.id);
    const list = roleOrder.get(role) ?? [];
    list.push(p.id);
    roleOrder.set(role, list);
  };
  const markIneligible = (p: Person, role: string, reason: IneligibleReason) => {
    const g: IneligibleGroup = inel.get(role + "|" + reason) ?? { heir: role, personIds: [], reason, rule: INELIGIBLE_RULE[reason] };
    g.personIds.push(p.id);
    inel.set(role + "|" + reason, g);
  };
  /** Records a living person under a role; returns true when eligible. */
  const consider = (p: Person, role: string): boolean => {
    track(p, role);
    const e = eligibility(p, sw);
    if (e.ok) return true;
    if ("rujuk" in e) {
      rujuk.add(e.rujuk);
      return false;
    }
    markIneligible(p, role, e.reason);
    return false;
  };
  const addHeir = (role: HeirId, p: Person | undefined): boolean => {
    if (!p || !p.alive) return false;
    if (!consider(p, role)) return false;
    (roles[role] ??= []).push({ personId: p.id, sex: p.sex });
    return true;
  };
  const addDz = (relation: DzawilId, p: Person, wasithKey: string) => {
    if (!p.alive) return;
    if (!consider(p, relation)) return;
    dzawil.push({ personId: p.id, relation, wasithRole: DZAWIL[relation].wasith, wasithKey, sex: p.sex });
  };
  const addBeyond = (p: Person, kind: BeyondKind, by?: string) => {
    if (p.alive && consider(p, KERABAT_JAUH_ROLE)) beyond.push(by ? { personId: p.id, kind, by } : { personId: p.id, kind });
    for (const c of p.children ?? []) addBeyond(c, kind, by);
  };
  const isEligible = (p: Person) => eligibility(p, sw).ok;

  // Spouses (married at death), in marriage order.
  const spouseRole: HeirId = fam.deceased.sex === "L" ? "istri" : "suami";
  const spouses: { personId: string; key: string }[] = [];
  for (const s of fam.spouses) {
    if (!s.alive) continue;
    if (s.sex === fam.deceased.sex) throw new Error(`waris/family: spouse ${s.id} has the deceased's sex`);
    const ok = addHeir(spouseRole, s);
    if (!ok && (s.religion !== "islam" || (s.bars ?? []).includes("murtad"))) {
      ww.push({ personId: s.id, key: "", role: spouseRole, sex: s.sex, kind: "non_muslim" });
    }
    spouses.push({ personId: s.id, key: "" });
  }

  // Children and their lines.
  let predIndex = 0;
  for (const c of fam.children) {
    if (c.alive) {
      const role: HeirId = c.sex === "L" ? "anak_lk" : "anak_pr";
      const ok = addHeir(role, c);
      if (ok && c.sex === "L") livingSon = true;
      if (!ok && (c.religion !== "islam" || (c.bars ?? []).includes("murtad"))) {
        ww.push({ personId: c.id, key: "", role, sex: c.sex, kind: "non_muslim" });
      }
      grandchildrenClassical(c);
    } else {
      const k = predIndex++;
      const slot = slotFor(c, k, sw, isEligible);
      if (slot) {
        slots.push(slot.slot);
        for (const g of c.children ?? []) {
          if (!g.alive) {
            greatGrandchildren(c, g);
            continue;
          }
          track(g, slot.slot.key);
          const e = eligibility(g, sw);
          if (!e.ok) {
            if ("rujuk" in e) rujuk.add(e.rujuk);
            else markIneligible(g, slot.slot.key, e.reason);
          } else if (c.sex === "L" && g.sex === "L") livingSonsSon = true;
          for (const gg of g.children ?? []) addBeyond(gg, "keturunan", e.ok ? slot.slot.key : undefined);
        }
      } else {
        grandchildrenClassical(c);
      }
    }
  }

  function grandchildrenClassical(c: Person) {
    for (const g of c.children ?? []) {
      if (c.sex === "L") {
        if (g.alive) {
          const ok = addHeir(g.sex === "L" ? "cucu_lk" : "cucu_pr", g);
          if (ok && g.sex === "L") livingSonsSon = true;
        }
      } else if (g.alive) {
        addDz(g.sex === "L" ? "cucu_lk_dari_anak_pr" : "cucu_pr_dari_anak_pr", g, c.id);
      }
      greatGrandchildren(c, g);
    }
  }

  function greatGrandchildren(c: Person, g: Person) {
    // A living, eligible grandchild who is an heir (a son's son or son's daughter) excludes their
    // own descendants; other deeper relatives are checked by beyondExcludedBy().
    const parentHeir = c.sex === "L" && g.alive && isEligible(g) ? (g.sex === "L" ? "cucu_lk" : "cucu_pr") : undefined;
    for (const gg of g.children ?? []) {
      if (c.sex === "L" && g.sex === "P") {
        // a son's daughter's child: dzawil arham with the son's daughter as wasith (engine.md §10)
        if (gg.alive) addDz(gg.sex === "L" ? "anak_lk_dari_cucu_pr" : "anak_pr_dari_cucu_pr", gg, g.id);
        for (const x of gg.children ?? []) addBeyond(x, "keturunan", parentHeir);
      } else {
        addBeyond(gg, "keturunan", parentHeir);
      }
    }
  }

  // Parents and grandparents.
  for (const [role, p] of [
    ["ayah", fam.father],
    ["ibu", fam.mother],
    ["kakek", fam.paternalGrandfather],
    ["nenek_ayah", fam.paternalGrandmother],
    ["nenek_ibu", fam.maternalGrandmother],
  ] as const) {
    if (!p) continue;
    const ok = addHeir(role, p);
    if (!ok && p.alive && (role === "ayah" || role === "ibu") && (p.religion !== "islam" || (p.bars ?? []).includes("murtad"))) {
      ww.push({ personId: p.id, key: "", role, sex: p.sex, kind: "non_muslim" });
    }
  }
  if (fam.maternalGrandfather?.alive) addDz("kakek_dari_ibu", fam.maternalGrandfather, "pos:ibu");

  // Siblings, nephews and nieces.
  for (const s of fam.siblings) {
    const role: HeirId =
      s.line === "seibu" ? (s.sex === "L" ? "sdr_lk_seibu" : "sdr_pr_seibu") : (`sdr_${s.sex === "L" ? "lk" : "pr"}_${s.line}` as HeirId);
    addHeir(role, s);
    for (const k of s.children ?? []) {
      if (s.line === "seibu") {
        if (k.alive) addDz("anak_sdr_seibu", k, s.id);
      } else if (s.sex === "L") {
        if (k.sex === "L") addHeir(s.line === "kandung" ? "keponakan_lk_kandung" : "keponakan_lk_seayah", k);
        else if (k.alive) addDz(s.line === "kandung" ? "anak_pr_sdr_lk_kandung" : "anak_pr_sdr_lk_seayah", k, s.id);
      } else if (k.alive) {
        const rel = `anak_${k.sex === "L" ? "lk" : "pr"}_sdr_pr_${s.line}` as DzawilId;
        addDz(rel, k, s.id);
      }
      const nephewHeir = s.line !== "seibu" && s.sex === "L" && k.sex === "L" && k.alive && isEligible(k);
      for (const x of k.children ?? []) addBeyond(x, "saudara", nephewHeir ? `keponakan_lk_${s.line}` : undefined);
    }
  }

  // Paternal uncles and cousins.
  for (const u of fam.paternalUncles) {
    addHeir(u.line === "kandung" ? "paman_kandung" : "paman_seayah", u);
    for (const k of u.children ?? []) {
      if (k.sex === "L") addHeir(u.line === "kandung" ? "sepupu_lk_kandung" : "sepupu_lk_seayah", k);
      else if (k.alive) addDz(u.line === "kandung" ? "anak_pr_paman_kandung" : "anak_pr_paman_seayah", k, u.id);
      const cousinHeir = k.sex === "L" && k.alive && isEligible(k);
      for (const x of k.children ?? []) addBeyond(x, "paman", cousinHeir ? `sepupu_lk_${u.line}` : undefined);
    }
  }

  // Explicit dzawil arham.
  for (const o of fam.otherRelatives ?? []) {
    if (!o.person.alive) continue;
    const meta = DZAWIL[o.relation];
    const key = o.via ?? (meta.wasith === "ibu" || meta.wasith === "ayah" ? `pos:${meta.wasith}` : `role:${meta.wasith}`);
    addDz(o.relation, o.person, key);
  }

  // Not heirs: adopted children, adoptive parents, stepchildren (engine.md §4).
  for (const a of fam.adoptedChildren ?? []) {
    if (!a.alive) continue;
    track(a, "anak_angkat");
    markIneligible(a, "anak_angkat", "anak_angkat");
    if (!a.courtOrder) notes.add("anak_angkat_tanpa_penetapan");
    else if (a.receivedWasiat) notes.add("ww_anak_angkat_sudah_menerima_wasiat");
    else if (a.religion === "islam") ww.push({ personId: a.id, key: "", role: a.sex === "L" ? "anak_lk" : "anak_pr", sex: a.sex, kind: "anak_angkat" });
  }
  for (const a of fam.adoptiveParents ?? []) {
    if (!a.alive) continue;
    track(a, "orang_tua_angkat");
    markIneligible(a, "orang_tua_angkat", "anak_angkat");
    if (!a.courtOrder) notes.add("anak_angkat_tanpa_penetapan");
    else if (a.receivedWasiat) notes.add("ww_anak_angkat_sudah_menerima_wasiat");
    else if (a.religion === "islam")
      ww.push({ personId: a.id, key: "", role: a.sex === "L" ? "ayah" : "ibu", sex: a.sex, kind: "orang_tua_angkat" });
  }
  for (const s of fam.stepChildren ?? []) {
    if (!s.alive) continue;
    track(s, "anak_tiri");
    markIneligible(s, "anak_tiri", "anak_tiri");
  }

  // Output keys: role, or role#i (1-based, input order) when the role has several people.
  const keys = new Map<string, string>();
  for (const [role, ids] of roleOrder) {
    if (role.startsWith("pengganti_")) continue;
    ids.forEach((id, i) => keys.set(id, ids.length === 1 ? role : `${role}#${i + 1}`));
  }
  for (const slot of slots) {
    const ids = roleOrder.get(slot.key) ?? [];
    const sexOf = new Map<string, Sex>();
    for (const c of fam.children) for (const g of c.children ?? []) sexOf.set(g.id, g.sex);
    for (const sex of ["L", "P"] as const) {
      const same = ids.filter((id) => sexOf.get(id) === sex);
      same.forEach((id, i) => keys.set(id, same.length === 1 ? `${slot.key}.${sex}` : `${slot.key}.${sex}#${i + 1}`));
    }
  }
  for (const s of spouses) s.key = keys.get(s.personId) ?? spouseRole;
  for (const w of ww) w.key = keys.get(w.personId) ?? w.role;

  return {
    roles,
    slots,
    dzawil,
    ineligible: [...inel.values()],
    present,
    keys,
    beyond,
    ww,
    notes: [...notes],
    rujuk: [...rujuk],
    spouses,
    livingSon,
    livingSonsSon,
  };
}

/**
 * Relatives beyond the depth limit (engine.md §2, §13) matter unless a nearer agnate who
 * certainly excludes them is present. Same test in both columns ("both columns refuse").
 * Returns the excluding role, or null when the relative could change a number (→ rujuk).
 */
export function beyondExcludedBy(b: Beyond, d: Derived): string | null {
  const has = (h: HeirId) => (d.roles[h]?.length ?? 0) > 0;
  if (b.by) return b.by;
  if (d.livingSon) return "anak_lk";
  if (d.livingSonsSon) return "cucu_lk";
  if (b.kind === "keturunan") return null;
  const chain: HeirId[] = ["ayah", "kakek", "sdr_lk_kandung", "sdr_lk_seayah", "keponakan_lk_kandung", "keponakan_lk_seayah"];
  if (b.kind === "paman") chain.push("paman_kandung", "paman_seayah", "sepupu_lk_kandung", "sepupu_lk_seayah");
  for (const h of chain) if (has(h)) return h;
  return null;
}
