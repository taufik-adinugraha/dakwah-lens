/**
 * Unit checks for the waris engine (frac, rounding, formatting, registry, rulesets, hajb /
 * couldAffectOutcome, refusals, switchesUsed). Plain TypeScript returning a list of failures, so
 * the vitest wrapper and scripts/waris-check.ts run the same assertions.
 */
import { AUL_BASES, assertAul } from "../adjust";
import { largestRemainder } from "../distribute";
import { percent, rupiah } from "../format";
import { B0, add, cmp, floorDiv, floorMod, frac, lcmAll, parse, toStr } from "../frac";
import { blockers, couldAffectOutcome, type HajbCtx, type KnownCounts } from "../hajb";
import {
  COMPARISON_VARIANTS,
  NotImplementedVariantError,
  PROFILES,
  RULE_IDS,
  RULES,
  resolveRuleset,
  type Switches,
} from "../registry";
import { solve } from "../solve";
import type { FamilyInput, Person } from "../types";

/** engine.md §15, verbatim: every id must exist in the registry. */
export const ENGINE_MD_15_IDS = [
  "estate.harta_bersama", "estate.harta_bersama_poligami", "estate.biaya", "estate.utang", "estate.wasiat",
  "estate.wasiat_dibatasi_sepertiga", "estate.wasiat_ahli_waris_tanpa_persetujuan", "estate.wasiat_wajibah",
  "mani.beda_agama", "mani.pembunuh", "mani.anak_luar_nikah", "mani.anak_angkat", "mani.anak_tiri",
  "fardh.suami_1_2", "fardh.suami_1_4", "fardh.istri_1_4", "fardh.istri_1_8", "fardh.anak_pr_1_2", "fardh.anak_pr_2_3",
  "fardh.cucu_pr_1_2", "fardh.cucu_pr_2_3", "fardh.cucu_pr_1_6_takmilah", "fardh.ayah_1_6", "fardh.kakek_1_6",
  "fardh.ibu_1_3", "fardh.ibu_1_6", "fardh.nenek_1_6", "fardh.sdr_pr_1_2", "fardh.sdr_pr_2_3",
  "fardh.sdr_pr_seayah_1_6_takmilah", "fardh.seibu_1_6", "fardh.seibu_1_3",
  "hajb.hirman", "hajb.istighraq", "nuqshan.suami", "nuqshan.istri", "nuqshan.ibu", "nuqshan.ayah",
  "asabah.bin_nafs", "asabah.bil_ghair", "asabah.maal_ghair", "asabah.ayah_fardh_dan_sisa",
  "umariyyatain", "musytarakah", "akdariyyah", "jadd.muqasamah", "jadd.sepertiga", "jadd.sepertiga_sisa",
  "jadd.seperenam", "jadd.muaddah", "jadd.sdr_pr_kandung_sampai_fardh",
  "aul", "radd.tanpa_pasangan", "radd.semua", "baitul_mal", "dzawil_arham.tanzil", "tashih", "ikhtisar",
  "khi.pengganti", "khi.pengganti_batas", "khi.anak_menghijab_saudara", "khi.seibu_pasal_181", "khi.ww_anak_angkat",
  "khi.ww_non_muslim", "khi.perdamaian", "rupiah.pembulatan",
] as const;

/** Plan §7.2, the switch table (authoritative for ruleset values). */
export const PLAN_7_2: Record<"klasik-syafii" | "standar-indonesia", Partial<Switches>> = {
  "klasik-syafii": {
    hartaBersama: true,
    killerBarred: "any_killing",
    substitution: "none",
    daughtersExcludeSiblings: false,
    uterineExcludedBy: "classical",
    fatherWithDaughters: "fardh_plus_asabah",
    residue: "radd_non_spouse",
    dzawilArham: "tanzil",
    musytarakah: true,
    jadd: "zaid",
    wasiatWajibahAdopsi: "off",
    wasiatWajibahNonMuslim: "off",
  },
  "standar-indonesia": {
    hartaBersama: true,
    killerBarred: "final_judgment",
    substitution: "cucu",
    substitutionCap: "sederajat",
    daughtersExcludeSiblings: true,
    uterineExcludedBy: "classical",
    fatherWithDaughters: "fardh_plus_asabah",
    residue: "radd_non_spouse",
    dzawilArham: "none",
    musytarakah: true,
    jadd: "zaid",
    wasiatWajibahAdopsi: "plafon",
    wasiatWajibahNonMuslim: "ma_16K2010",
  },
};

const P = (id: string, sex: "L" | "P", extra: Partial<Person> = {}): Person => ({ id, sex, alive: true, religion: "islam", ...extra });
const fam = (sex: "L" | "P", f: Partial<FamilyInput>): FamilyInput => ({
  deceased: { sex, religion: "islam" },
  spouses: [],
  children: [],
  siblings: [],
  paternalUncles: [],
  ...f,
});
const NO_DESC: KnownCounts = { anak_lk: 0, anak_pr: 0, cucu_lk: 0, cucu_pr: 0, predeceasedSons: 0, predeceasedDaughters: 0 };

export function runUnitChecks(): string[] {
  const fails: string[] = [];
  const check = (cond: boolean, what: string) => {
    if (!cond) fails.push(what);
  };
  const eqStr = (got: string, want: string, what: string) => check(got === want, `${what}: expected ${want}, got ${got}`);

  // frac
  eqStr(toStr(add(frac(1, 2), frac(1, 3))), "5/6", "1/2 + 1/3");
  eqStr(toStr(frac(2, 4)), "1/2", "normalise 2/4");
  eqStr(toStr(frac(1, -2)), "-1/2", "sign moves to the numerator");
  eqStr(toStr(parse("3/6")), "1/2", "parse 3/6");
  eqStr(toStr(frac(4, 2)), "2", "whole numbers print without /1");
  check(floorDiv(BigInt(-7), BigInt(2)) === BigInt(-4) && floorMod(BigInt(-7), BigInt(2)) === BigInt(1), "floorDiv/floorMod round towards -inf");
  check(lcmAll([BigInt(2), BigInt(3), BigInt(4)]) === BigInt(12), "lcm(2,3,4) = 12");
  check(cmp(frac(1, 3), frac(2, 6)) === 0 && cmp(frac(1, 3), frac(1, 2)) < 0, "cmp");
  let threw = false;
  try {
    parse("0.5");
  } catch {
    threw = true;
  }
  check(threw, "parse rejects decimals");

  // §14 largest remainder (vector rupiah-largest-remainder, klasik-syafii)
  const lr = largestRemainder(BigInt(100000000), [
    { key: "ibu", frac: frac(1, 6), rank: 1 },
    { key: "d1", frac: frac(2, 9), rank: 2 },
    { key: "d2", frac: frac(2, 9), rank: 2 },
    { key: "d3", frac: frac(2, 9), rank: 2 },
    { key: "b", frac: frac(1, 6), rank: 3 },
  ]);
  eqStr([...lr.values()].join(","), "16666667,22222222,22222222,22222222,16666667", "largest remainder §14 example");
  let total = B0;
  for (const v of lr.values()) total += v;
  check(total === BigInt(100000000), "largest remainder sums to T");

  // display formatting (format.ts)
  eqStr(percent(frac(1, 6)), "16,67", "percent 1/6");
  eqStr(percent(frac(1, 8)), "12,50", "percent 1/8");
  eqStr(percent(frac(2, 3)), "66,67", "percent 2/3");
  eqStr(rupiah(BigInt(16666667)), "Rp 16.666.667", "rupiah format");

  // 'aul fails loudly outside the classical bases
  let aulThrew = false;
  try {
    assertAul(BigInt(6), BigInt(11));
  } catch {
    aulThrew = true;
  }
  check(aulThrew, "'aul 6 → 11 must throw");
  check(AUL_BASES.get("24")?.join(",") === "27", "'aul 24 → 27 only");

  // registry: single source of rule ids
  check(new Set(RULE_IDS).size === RULE_IDS.length, "rule ids are unique");
  for (const id of ENGINE_MD_15_IDS) check(id in RULES, `engine.md §15 id ${id} is registered`);

  // rulesets follow plan §7.2
  for (const [profile, want] of Object.entries(PLAN_7_2)) {
    const got = PROFILES[profile as keyof typeof PLAN_7_2] as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(want)) check(got[k] === v, `${profile}.${k}: plan §7.2 says ${String(v)}, registry ${String(got[k])}`);
  }
  check(PROFILES["klasik-syafii-asal"].residue === "baitul_mal" && PROFILES["klasik-syafii-asal"].dzawilArham === "none", "klasik-syafii-asal");
  for (const v of COMPARISON_VARIANTS) check(resolveRuleset(v).id === v, `variant ${v} resolves`);
  check(resolveRuleset("standar-indonesia|uterineExcludedBy=khi181").switches.uterineExcludedBy === "khi181", "variant switch applied");
  let luas = false;
  try {
    resolveRuleset("standar-indonesia|substitution=luas");
  } catch (e) {
    luas = e instanceof NotImplementedVariantError;
  }
  check(luas, "substitution=luas is refused by name (NotImplementedVariantError)");

  // hajb: the one blockers() table
  const ctx = (counts: Partial<Record<string, number>>, sw: Switches = PROFILES["klasik-syafii"]): HajbCtx => ({
    count: (h) => counts[h] ?? 0,
    maybe: (h) => (counts[h] ?? 0) > 0,
    sonSlots: [],
    daughterSlots: [],
    sw,
    jaddRegime: false,
    maalGhair: { kandung: false, seayah: false },
  });
  eqStr(blockers("ayah", ctx({ anak_lk: 1 })).join(","), "", "the father is never excluded (L6: 'tidak menjadi penerima sisa', not 'terhalang')");
  eqStr(blockers("sdr_lk_kandung", ctx({ anak_lk: 1 })).join(","), "anak_lk", "a son excludes a full brother");
  eqStr(blockers("sdr_lk_seibu", ctx({ kakek: 1 })).join(","), "kakek", "the grandfather excludes uterine siblings (classical)");
  eqStr(blockers("sdr_lk_kandung", ctx({ kakek: 1 })).join(","), "", "the grandfather does not exclude full brothers (Zaid)");
  eqStr(blockers("sdr_lk_kandung", ctx({ anak_pr: 1 }, PROFILES["standar-indonesia"])).join(","), "anak_pr", "86 K/AG/1994: a daughter excludes siblings (court column)");
  eqStr(blockers("nenek_ayah", ctx({ ayah: 1 })).join(","), "ayah", "the father excludes the father's mother");

  // couldAffectOutcome: the three families plan §5.1 says the draft skipped wrongly
  check(couldAffectOutcome("sdr_lk_seayah", { ...NO_DESC, ibu: 1, ayah: 0, kakek: 0, sdr_lk_kandung: 1 }), "§5.1 mother + full brother: ask the paternal brother (mother ⅙)");
  check(couldAffectOutcome("sdr_lk_seibu", { ...NO_DESC, ibu: 1, ayah: 0, kakek: 1, sdr_lk_kandung: 1 }), "§5.1 mother + grandfather + full brother: ask uterine siblings");
  check(couldAffectOutcome("sdr_lk_seayah", { ...NO_DESC, ibu: 0, ayah: 0, kakek: 1, sdr_lk_kandung: 1 }), "§5.1 grandfather + full brother: ask the paternal brother (mu'addah)");
  check(!couldAffectOutcome("sdr_lk_kandung", { ...NO_DESC, anak_lk: 1 }), "a son: siblings are not asked");
  check(!couldAffectOutcome("paman_kandung", { ...NO_DESC, anak_lk: 1 }), "a son: uncles are not asked");
  check(!couldAffectOutcome("kakek", { ayah: 1 }), "the father: the grandfather is not asked");
  check(couldAffectOutcome("sdr_lk_kandung", { ...NO_DESC, anak_pr: 1, ayah: 0, kakek: 0 }), "only a daughter: full brother asked (fikih column residue)");
  // an un-asked un-blocker is "maybe present" (review 2026-10-09): a consanguine brother would make
  // his sister 'asabah despite two full sisters, so she matters until he is known to be absent
  const twoFullSisters = { ...NO_DESC, ayah: 0, kakek: 0, ibu: 0, sdr_lk_kandung: 0, sdr_pr_kandung: 2 };
  check(couldAffectOutcome("sdr_pr_seayah", twoFullSisters), "two full sisters, consanguine brother not yet asked: ask the consanguine sister");
  check(!couldAffectOutcome("sdr_pr_seayah", { ...twoFullSisters, sdr_lk_seayah: 0 }), "two full sisters, no consanguine brother: the consanguine sister is not asked");
  check(couldAffectOutcome("sdr_pr_seayah", { ...twoFullSisters, sdr_lk_seayah: 1 }), "two full sisters and a consanguine brother: the consanguine sister is asked");

  // refusals and switchesUsed
  const nonMuslimDeceased = solve({ family: { ...fam("L", { children: [P("s", "L")] }), deceased: { sex: "L", religion: "non_islam" } } });
  check(nonMuslimDeceased.kind === "rujuk" && nonMuslimDeceased.reasons.join() === "beda_agama_pewaris", "non-Muslim deceased → rujuk");
  const killer = fam("L", { spouses: [P("w", "P")], children: [P("s", "L", { bars: ["membunuh_tanpa_putusan"] }), P("d", "P")] });
  const kK = solve({ family: killer }, "klasik-syafii");
  const kC = solve({ family: killer }, "standar-indonesia");
  check(kK.kind === "hasil" && kK.ineligible.some((g) => g.heir === "anak_lk" && g.reason === "pembunuh"), "classical: any killing bars");
  check(kC.kind === "rujuk" && kC.reasons.join() === "dugaan_pembunuhan", "court column: a killing without a final judgment refuses");
  const k3 = fam("L", { spouses: [P("w", "P")], mother: P("m", "P"), children: [P("d", "P")], siblings: [{ ...P("z1", "P"), line: "kandung" }] });
  const k3c = solve({ family: k3 }, "standar-indonesia");
  check(k3c.kind === "hasil" && k3c.switchesUsed.includes("daughtersExcludeSiblings"), "switchesUsed names 86 K/AG/1994 for wife + mother + daughter + sister");
  const k3f = solve({ family: k3 }, "klasik-syafii");
  check(k3f.kind === "hasil" && k3f.switchesUsed.length === 0, "the fikih column lists no switch");

  // the trace carries every rule the report must cite (review 2026-10-09; I8 checks it at scale)
  const steps = (r: ReturnType<typeof solve>, rule: string) =>
    r.trace.filter((t) => t.rule === rule).map((t) => (t.facts ? `${t.facts.dari ?? ""}>${t.facts.menjadi ?? ""}` : "+"));
  const killerSon = solve({ family: fam("L", { spouses: [P("w", "P")], children: [P("s", "L", { bars: ["membunuh"] })], siblings: [{ ...P("b", "L"), line: "kandung" }] }) }, "klasik-syafii");
  check(killerSon.trace.some((t) => t.rule === "mani.pembunuh" && t.heirs.includes("anak_lk")), "a barred killer is a mani.pembunuh trace step");
  const akd = solve({ family: fam("P", { spouses: [P("h", "L")], mother: P("m", "P"), paternalGrandfather: P("g", "L"), siblings: [{ ...P("z", "P"), line: "kandung" }] }) }, "klasik-syafii");
  check(steps(akd, "fardh.suami_1_2").length === 1 && steps(akd, "fardh.ibu_1_3").length === 1, "akdariyyah traces the husband's ½ and the mother's ⅓");
  eqStr([...steps(akd, "aul"), ...steps(akd, "tashih")].join(" "), "6>9 9>27", "akdariyyah: 'aul 6 → 9, tashih 9 → 27");
  const musy = solve({ family: fam("P", { spouses: [P("h", "L")], mother: P("m", "P"), siblings: [{ ...P("u1", "L"), line: "seibu" }, { ...P("u2", "P"), line: "seibu" }, { ...P("b", "L"), line: "kandung" }] }) }, "klasik-syafii");
  eqStr(steps(musy, "tashih").join(" "), "6>18", "musytarakah: tashih 6 → 18");
  const asy = solve({ family: fam("L", { paternalGrandfather: P("g", "L"), siblings: [{ ...P("z", "P"), line: "kandung" }, { ...P("b", "L"), line: "seayah" }] }) }, "klasik-syafii");
  check(asy.trace.some((t) => t.rule === "asabah.bin_nafs" && t.heirs.includes("sdr_lk_seayah")), "'Asyriyah traces the consanguine brother's residue");
  eqStr(steps(asy, "tashih").join(" "), "5>10", "'Asyriyah: tashih 5 → 10");
  const dtrFather = solve({ family: fam("L", { children: [P("d", "P")], father: P("f", "L") }) }, "klasik-syafii");
  eqStr(steps(dtrFather, "ikhtisar").join(" "), "6>2", "a daughter and the father: ikhtisar 6 → 2");
  const sons3 = solve({ family: fam("L", { children: [P("s1", "L"), P("s2", "L"), P("s3", "L")] }) }, "klasik-syafii");
  check(sons3.kind === "hasil" && sons3.base === BigInt(3) && sons3.trace.every((t) => t.rule !== "ikhtisar"), "three sons alone: asal masalah 3 (heads), no ikhtisar");
  const capped = solve(
    { family: fam("L", { spouses: [P("w", "P")], children: [P("s", "L")], adoptedChildren: [{ ...P("a", "L"), courtOrder: true }] }), estate: { hartaBawaan: BigInt(1200), wasiat: [{ toHeir: false, fraction: frac(1, 4) }] } },
    "standar-indonesia",
  );
  check(
    capped.kind === "hasil" && !capped.lines.some((l) => l.kind === "wasiat") && !capped.trace.some((t) => t.rule === "estate.wasiat") && steps(capped, "estate.wasiat_dibatasi_sepertiga").length === 1,
    "a voluntary wasiat capped to zero by the adoption wasiat wajibah is reported as capped, not as carried out",
  );
  check(capped.trace.find((t) => t.rule === "estate.wasiat_dibatasi_sepertiga")?.facts?.sisa_batas === "0", "the capped wasiat step records sisa_batas 0");
  return fails;
}
