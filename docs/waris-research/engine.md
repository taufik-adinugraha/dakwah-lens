# Waris track: fara'id engine specification

Researcher: ENGINE · written 2026-10-09 · status: **research input, not reviewed by an ustadz.**
Companion files: [`test-vectors.json`](./test-vectors.json) (the oracle cases), [`standard.md`](./standard.md)
(what "MUI standard" means), [`architecture.md`](./architecture.md) (where the engine lives, §5).

> Everything the engine prints is *AI-assisted, not an authoritative fatwa*. The engine is a
> calculator of published rules. It never decides a disputed point on its own: every point where
> scholars or Indonesian courts differ is a **named switch** (§12), and the report names the
> switch that changed the outcome. Cases the engine should not compute end in **"silakan
> berkonsultasi"** (§13).

This document is written to be implemented directly in TypeScript (`belajar/src/lib/waris/`,
architecture §5.2). Every rule carries its source. Sources are of three kinds:

- **Corpus** (`api/data/*.json`, the same files the dalil pipeline reads): Qur'an, Bukhari,
  Muslim, Bulugh al-Maram, Fath al-Qarib, Fath al-Mu'in, al-Umm, Fiqh as-Sunnah, Tafsir Ibn Kathir.
  Cited as `file § section_id (anchor)` or `Bukhari 6732`. Arabic was matched with harakat removed.
- **Indonesian law and court practice**, each opened on 2026-10-09 (URLs in §0.2).
- **Fara'id teaching material and calculators**, each opened on 2026-10-09 (URLs in §0.2).

Where I could not find a source, the text says **"tidak bersumber / unsourced"** and the point is
listed as an open question (§17).

---

## 0. Sources used

### 0.1 Corpus anchors (verified in `api/data/` on 2026-10-09)

| Rule | Locator | What it says (short) |
|---|---|---|
| Fixed shares of children, parents | QS an-Nisa' 4:11 (`quran.json`) | daughters ½ / ⅔, son 2:1, parents ⅙ each with a child, mother ⅓ / ⅙ with siblings, "after wasiat or debt" |
| Spouses, uterine siblings | QS 4:12 | husband ½ / ¼, wife ¼ / ⅛, uterine sibling ⅙, two or more ⅓ |
| Full / consanguine siblings (kalalah) | QS 4:176 | one sister ½, two ⅔, brother takes all, mixed 2:1 |
| Blood relatives nearer one another | QS al-Anfal 8:75 | basis cited for radd and dzawil arham |
| Residue to the nearest male | Bukhari 6732 = Bulugh 1095 | أَلْحِقُوا الْفَرَائِضَ بِأَهْلِهَا، فَمَا بَقِيَ فَهْوَ لأَوْلَى رَجُلٍ ذَكَرٍ |
| Daughter + son's daughter + sister | Bukhari 6742 = Bulugh 1097 | ½, ⅙ (takmilah), remainder to the sister |
| No inheritance across religions | Bukhari 6764 = Bulugh 1096; Bulugh 1098 | لاَ يَرِثُ الْمُسْلِمُ الْكَافِرَ… ; لَا يَتَوَارَثُ أَهْلُ مِلَّتَيْنِ |
| Grandmother ⅙ when no mother | Bulugh 1103 | جَعَلَ لِلْجَدَّةِ اَلسُّدُسَ إِذَا لَمْ يَكُنْ دُونَهَا أُمٌّ |
| Maternal uncle inherits when no heir | Bulugh 1104, 1105 | اَلْخَالُ وَارِثُ مَنْ لَا وَارِثَ لَهُ (basis cited for dzawil arham) |
| Newborn inherits if it cried at birth | Bulugh 1106 | إِذَا اِسْتَهَلَّ اَلْمَوْلُودُ وُرِّثَ (haml: out of scope, §13) |
| Killer does not inherit | Bulugh 1107 | لَيْسَ لِلْقَاتِلِ مِنَ الْمِيرَاثِ شَيْءٌ |
| Why the jadd method is Zaid's | `al-umm.json` § 556 (C805) | "وهذا قول زيد بن ثابت وعنه قبلنا أكثر الفرائض". *(Review 2026-10-09: Bulugh 1110 "أَفْرَضُكُمْ زَيْدُ بْنُ ثَابِتٍ" was the rationale here; the corpus tahqiq grades it ضعيف, so it is no longer used, and D10 already keeps it off every page.)* |
| Wasiat ≤ ⅓ | Bukhari 2742; Bulugh 1112 | "الثلث، والثلث كثير" |
| No wasiat to an heir | Bulugh 1114 (1115 adds "unless the heirs wish", graded *munkar* in the corpus note) | فَلَا وَصِيَّةَ لِوَارِثٍ |
| 10 male + 7 female heirs; who is never excluded; mawani'; 'asabah order | `fath-al-qarib.json` § 116 (C138) | the matn of Abu Syuja' with al-Ghazzi's sharh |
| Six furudh, who takes each, the core hajb list | `fath-al-qarib.json` § 117 (C139) | incl. "بنتين وجد وثلاثة إخوة" (grandfather takes ⅙) |
| Who makes his sister 'asabah; who inherits without his sister; wasiat ≤ ⅓, none to an heir without consent | `fath-al-qarib.json` § 118 (C140) | |
| Full hajb chains (nephews, uncles, cousins), takmilah, Umariyyatain with numbers, radd and dzawil arham in the later Syafi'i school | `fath-al-muin.json` § 34 (C39) | "ثم إن لم ينتظم المال رد ما فضل عنهم عليهم غير الزوجين بنسبة الفروض ثم ذوي الأرحام وهم أحد عشر" |
| Grandfather with siblings (Zaid: muqasamah or ⅓) | `al-umm.json` § 556 (C805) | "قاسمهم ما كانت المقاسمة خيرا له من الثلث" |
| Musytarakah (full brothers share the uterine ⅓) | `al-umm.json` § 559 (C809) | "زوج وأم وأخوان لأب وأم وأخوان لأم… ويشركهم بنو الأب" |
| Siblings reduce the mother even when the father excludes them | `tafsir-ibn-kathir.json` 4:11 | "فإنهم لا يرثون مع الأب شيئا ولكنهم مع ذلك يحجبون الأم عن الثلث إلى السدس" |
| 'Aul history and method; radd method; wasiat wajibah (Egyptian law) | `fiqh-as-sunnah.json` §§ 852–855, 865–866 | |
| Sa'd b. al-Rabi' case: 2 daughters ⅔, wife ⅛, uncle the rest | `fiqh-as-sunnah.json` § 840 (C1082), citing "al-Khamsa except an-Nasa'i" | the occasion of revelation of 4:11 |

### 0.2 Documents opened on 2026-10-09

| Short name | What | URL / locator |
|---|---|---|
| **KHI** | Kompilasi Hukum Islam, Buku II (Pasal 171–214), reproduction with the SEMA 2/1994 note under Pasal 177 | https://kuliahsyariah.wordpress.com/2010/07/13/buku-ii-kompilasi-hukum-islam/ (standard.md §2 cross-checked it against an archive.org copy; the operator should pull the JDIH Kemenag/Badilag copy before quoting wording in the product) |
| **KHI Buku I** Pasal 94, 96, 97 | harta bersama; quoted in Khairuddin pp. 121–122 | see Khairuddin below |
| **Buku II 2013** | MA RI, *Pedoman Pelaksanaan Tugas dan Administrasi Peradilan Agama, Buku II, Edisi Revisi 2013*, transcription hosted by PA Rumbia; kewarisan section on transcription pp. 171–177, polygamy harta bersama pp. 145–146 | http://pa-rumbia.go.id/images/Pedoman_Organisasi/1-Buku-II-edisi-Rev_2013_Pedoman-Tugas-dan-Adm.pdf |
| **Buku II 2026** | MA RI, *Pedoman Teknis Administrasi dan Teknis Peradilan Agama* (Lampiran II KMA No. 159/KMA/SK.HK2/VIII/2026, 19 Agustus 2026); kewarisan pp. 844–848, polygamy harta bersama pp. 836–838. **Supersedes Buku II 2013.** | https://pa-wangiwangi.go.id/web/images/KEPANITERAAN/pedoman%20kepaniteraan/Buku%20II%20Peradilan%20Agama.pdf |
| **SEMA kompilasi** | *Kompilasi SEMA Hasil Rapat Pleno Kamar Agama 2012–2022* (A. Cholil), Kewarisan pp. 17–20 | https://pta-bandung.go.id/images/Kepaniteraan/Pengelolaan_Kepaniteraan/2023_Kompilasi_SEMA_Kamar_Agama.pdf |
| **Yurisprudensi 2018** | MA RI, *Himpunan Yurisprudensi MA s.d. 2018, Edisi Pertama*: 1/Yur/Ag/2018 (wasiat wajibah, pp. 50–54), 2/Yur/Ag/2018 (ahli waris pengganti, pp. 55–57) | https://jdih.mahkamahagung.go.id/storage/uploads/produk_hukum/Yurisprudensi%20Tahun%202018/1652410687_Yurisprudensi_2018.pdf |
| **MA 16 K/AG/2010** | JDIH MA case note with the full amar (pokok masalah 60) | https://jdih.mahkamahagung.go.id/storage/uploads/produk_hukum/file/16%20K-AG-2010y.pdf |
| **KY 122 K/AG/1995** | Komisi Yudisial, *Karakterisasi Yurisprudensi* 122 K/AG/1995, with annotations quoting 86 K/AG/1994 and 184 K/AG/1995 | https://karakterisasi.komisiyudisial.go.id/?view=t5nsyMraxMLmx9%2Fn2uDj18bg0g%3D%3D&id=pmao |
| **PA Bojonegoro** | "Pembaharuan Hukum Waris di Indonesia" (court website), list of MA kaidah 2016–2017 | https://www.pa-bojonegoro.go.id/publikasi-arsip-publikasi/arsip-artikel/358-pembaharuan-hukum-waris-di-indonesia |
| **PA Kotabumi** | "Ahli Waris Pengganti dalam Kewarisan Islam Perspektif Madzhab Nasional" (court website): the 185(2) readings, with a worked example | https://pa-kotabumi.go.id/amar-putusan/178-ahli-waris-pengganti-dalam-kewarisan-islam-perspektif-madzhab-nasional.html |
| **Fatwa MUI 5/2005** | Kewarisan Beda Agama (Himpunan Fatwa p. 478–480) | https://mui-jateng.or.id/wp-content/uploads/2018/03/39.-Kewarisan-Beda-Agama.pdf |
| **Tarjih** | Majelis Tarjih Muhammadiyah, "Ketentuan Ahli Waris Pengganti" (worked KHI example with rupiah) | https://fatwatarjih.or.id/ketentuan-ahli-waris-pengganti/ |
| **Khairuddin** | Khairuddin, *Fikih Faraidh: Teknik Penyelesaian Kasus Waris* (Sahifah / UIN Ar-Raniry, 2020, ISBN 978-623-90608-7-9). Page numbers below are the **printed** page; PDF page = printed + 10. | https://repository.ar-raniry.ac.id/21355/2/3.%20Buku_Fikih%20Faraidh_2020.pdf |
| **NU Online 'aul** | Yazid Muttaqin, "Mengenal 'Aul pada Asal Masalah Warisan" (22 Mar 2018), quoting Zuhaili, *al-Mu'tamad fi al-Fiqh al-Syafi'i* IV:438–441 | https://islam.nu.or.id/warisan/mengenal-aul-pada-asal-masalah-warisan-T8xYv |
| **MAIS e-Faraid** | Majlis Agama Islam Selangor, e-Faraid information pages (a Syafi'i state calculator): `aul`, `umariyyatain`, `musytarikah`, `datuk-bersama-…`, `baitulmal`, `dhawi-al-arham`, `pendindingan-semua`, `halangan-pusaka` | https://efaraid.mais.gov.my/ (page slugs as listed) |
| **Tuwaijri** | M. b. Ibrahim al-Tuwaijri, *Mawsu'at al-Fiqh al-Islami* IV:443 (Shamela 37532/2660), three tanzil examples | https://shamela.ws/book/37532/2660 |
| **Dakwah.id** | M. Nurhadi, "Cara Membagi Warisan Kepada Dzawil Arham" (9 Apr 2022): which schools use tanzil vs qarabah | https://www.dakwah.id/cara-membagi-warisan-kepada-dzawil-arham/ |
| **Achmad Yani** | "Masalah Al-Akdariyah" (20 Des 2010), table with tashih 27 | http://achmadyanimkom.blogspot.com/2010/12/masalah-al-akdariyah.html |
| **al-Hawi** *(added in review)* | al-Mawardi, *al-Hawi al-Kabir*, Kitab al-Fara'id, Bab mirath al-jadd, vol. 8 p. 121 (islamweb library edition), quoting al-Shafi'i: "إلا في فريضتين زوج وأبوين أو امرأة وأبوين ، فإنه إذا كان فيهما مكان الأب جد صار للأم الثلث كاملا". Also: "وأمهات الأب لا يرثن مع الأب ويرثن مع الجد". Not in `api/data`; pin (URL + sha256) before any learner-facing use. | https://www.islamweb.net/ar/library/content/94/4182/%D8%A8%D8%A7%D8%A8-%D9%85%D9%8A%D8%B1%D8%A7%D8%AB-%D8%A7%D9%84%D8%AC%D8%AF (fetched 2026-10-09) |

---

## 1. Pipeline at a glance

```
FamilyInput + EstateInput + Ruleset
  │
  ├─ 0. scope check ............ out-of-scope facts → { kind: "rujuk" } (§13)
  ├─ 1. estate ................. harta bersama split → own estate → costs → debts → wasiat (§3)
  │                              + wasiat-wajibah ceiling, which needs an as-if solve of stages 2–9 (§11.4)
  ├─ 2. eligibility (mawani') .. killer, religion, li'an/zina line, adoption (§4)
  ├─ 3. KHI substitution ....... (ruleset) predeceased heirs replaced by their children (§11.1)
  ├─ 4. hajb hirman ............ total exclusion matrix (§6)
  ├─ 5. special-case detection . jadd+siblings, musytarakah, akdariyyah, umariyyatain (§8)
  ├─ 6. furudh ................. fixed shares with hajb nuqshan (§5, §6.2)
  ├─ 7. 'asabah ................ bin-nafs / bil-ghair / ma'al-ghair (§7)
  ├─ 8. asal masalah + 'aul .... (§9)
  ├─ 9. radd / dzawil arham / Baitul Mal (§9.4, §10)
  ├─ 10. tashih ................ integer units per head (§9.3)
  └─ 11. distribute ............ fraction → % → Rp, largest remainder (§14)
Result { shares, blocked, adjustments, trace[], switchesUsed[] }   (architecture §5.3)
```

Every stage appends `TraceStep`s whose `rule` ids are listed in §15; the report and the dalil links
are rendered from those ids.

**Arithmetic.** All shares are exact rationals `{ n: bigint, d: bigint }`, normalised (gcd = 1,
d > 0). The classical integer table (asal masalah, 'aul, tashih) is computed as well, because the
lessons and the report show it; the engine asserts that `units[i] / finalBase == share[i]` for
every heir. Floats appear only in `distribute.ts` formatting, never in a share.

---

## 2. Input model

The architecture sketch (`FamilyInput = { heirs: Record<HeirId, count> }`) is enough for classical
fara'id, where every grandson through a son is the same heir. It is **not** enough for KHI Pasal 185,
where each predeceased child is replaced *by that child's own children* (per stirpes), nor for
harta bersama with several wives. The engine therefore takes a **structured family**, and derives the
flat counts from it.

```ts
type Sex = "L" | "P";
type Religion = "islam" | "non_islam";           // KHI 171(c): an heir must be Muslim; MUI 5/2005
type Bar =                                         // reasons a living relative may not inherit (§4)
  | "membunuh" | "mencoba_membunuh" | "aniaya_berat" | "fitnah_pidana5th"   // KHI 173 (needs final judgment)
  | "membunuh_tanpa_putusan"                        // classical: any killing bars (Fath al-Qarib § 116)
  | "murtad";                                       // treated as non-Muslim (Fath al-Qarib § 116; MAIS halangan-pusaka)

interface Person {
  id: string;                     // stable key from the questionnaire, never a name
  sex: Sex;
  alive: boolean;                 // alive at the moment of the pewaris's death
  religion: Religion;
  bars?: Bar[];
  children?: Person[];            // only filled where it matters (predeceased children, siblings, uncles)
}

interface FamilyInput {
  deceased: { sex: Sex; religion: "islam" };      // a non-Muslim pewaris is outside PA jurisdiction → rujuk (SEMA kompilasi p. 17)
  spouses: Person[];                               // husband: 0–1 (deceased female); wives: 0–4 (deceased male); alive + married at death
  children: Person[];                              // sons and daughters, alive or predeceased, each with children[] if predeceased
  father?: Person;  mother?: Person;
  paternalGrandfather?: Person;                    // father's father (only asked if father is not alive)
  paternalGrandmother?: Person;                    // father's mother
  maternalGrandmother?: Person;                    // mother's mother
  maternalGrandfather?: Person;                    // dzawil arham classically; KHI pengganti in Buku II 2013 only
  siblings: (Person & { line: "kandung" | "seayah" | "seibu" })[];  // with children[] (nephews/nieces)
  paternalUncles: (Person & { line: "kandung" | "seayah" })[];        // father's brothers, with children[] (cousins)
  otherRelatives?: { relation: DzawilArhamRelation; via: string; person: Person }[]; // §10, asked only if needed
  adoptedChildren?: Person[];                      // KHI 171(h): adoption by court order only
  adoptiveParents?: Person[];                      // when the pewaris was an adopted child
  stepChildren?: Person[];                         // SEMA 7/2012 Kamar Agama 19: not heirs, may get wasiat wajibah
}

interface EstateInput {                            // all optional; with no amounts the report shows fractions only
  hartaBawaan?: bigint;                            // the deceased's own property (incl. inheritance/gifts received)
  hartaBersama?: { spouseId: string; period: 1 | 2 | 3 | 4; amount: bigint }[]; // gono-gini pools (§3.2)
  biayaSakit?: bigint;                             // last-illness costs (KHI 171e)
  biayaJenazah?: bigint;                           // tajhiz
  utang?: bigint;                                  // debts (to people, plus zakat/nazar/haji owed)
  wasiat?: { toId?: string; toHeir: boolean; amount?: bigint; fraction?: Frac }[]; // voluntary bequests
  heirsConsentToExcessWasiat?: boolean;            // all heirs agree (KHI 195(2),(3); Fath al-Qarib § 118)
  hibahToChildren?: { childId: string; amount: bigint }[];  // KHI 211: "dapat diperhitungkan"; reported only (§3.5)
}
```

**Derived flat view.** From `FamilyInput` the engine derives the classical heir counts (§3.1):
`anak_lk = count(children: L, alive, eligible)`; `cucu_lk = count(grandchildren: L, alive, eligible,
whose parent is a predeceased son)`; and so on. A grandchild through a daughter is **not** a classical
heir (dzawil arham, Fath al-Mu'in § 34). Under KHI 185 the same person is a substitute (§11.1).

**Depth limits for a self-service tool.** The input stops at: grandchildren (one generation below
children), grandparents (one generation above parents), nephews (children of siblings), and cousins
(sons of the father's brothers). Anything deeper, such as great-grandchildren, a great-grandfather,
the father's uncles or the children of nephews, makes the engine return `rujuk("kerabat_jauh")`
(§13). These relatives inherit only in rare families, and they need a human check.

---

## 3. Estate: from what was left to what is divided

Sources: QS 4:11–12 ("مِنْ بَعْدِ وَصِيَّةٍ يُوصِي بِهَا أَوْ دَيْنٍ"); KHI 171(e) (harta waris = harta bawaan
plus the deceased's part of harta bersama, after last-illness costs, tajhiz, debts and "pemberian untuk
kerabat"); KHI 175(1) order (jenazah, debts, wasiat, divide) and 175(2) (heirs liable only up to the
estate); Khairuddin p. 33 (order: harta bersama, tajhiz, debts, wasiat, then fara'id); DSN-MUI's
reported four stages for an insurance death benefit (standard.md §1.5).

### 3.1 Order of deductions

```
gross_own   = hartaBawaan + Σ deceased's portion of each harta-bersama pool (§3.2)
after_costs = gross_own − biayaSakit − biayaJenazah
after_debts = after_costs − utang                    // if ≤ 0 → nothing to divide; report says so (KHI 175(2))
wasiat_cap  = after_debts / 3
wasiat_paid = Σ wasiat to non-heirs, capped at wasiat_cap unless heirsConsentToExcessWasiat
            + Σ wasiat to heirs only if heirsConsentToExcessWasiat   // KHI 195(3); Fath al-Qarib § 118; Bulugh 1114
net_estate  = after_debts − wasiat_paid − wasiat_wajibah (§11.4, ruleset)
```

- **Wasiat over ⅓ without consent** is cut to ⅓ (KHI 201; Fath al-Qarib § 118: "فإن زاد على الثلث وقف
  الزائد على إجازة الورثة"). With several bequests over the cap, they are reduced **pro rata**. Pro
  rata reduction is the usual practice; **I did not find it written in an opened source** (open
  question EQ7). KHI 202 lets the heirs choose the order only for charitable bequests.
- **Wasiat to an heir** counts only if all heirs consent (KHI 195(3); Fath al-Qarib § 118). Without
  consent it is ignored, and the report says why.
- **Classical Syafi'i also puts rights attached to specific property first** (zakat due on that
  property, a pledged item) before tajhiz. The opened Syafi'i texts (Fath al-Qarib §§ 116–118, Fath
  al-Mu'in § 34) do not list this order, and the corpus copy of Fiqh as-Sunnah is missing that page
  (anchor C1084). The engine treats such claims as `utang`, which gives the same numbers unless the
  estate is insolvent. An insolvent estate returns `rujuk("utang_melebihi_harta")`.

### 3.2 Harta bersama (gono-gini): ruleset switch `hartaBersama`

- **Classical fiqh.** The fara'id chapters read have no presumed 50% rule. What the surviving spouse
  can show is theirs stays theirs (Khairuddin pp. 119–120 treats harta bersama as a matter of
  joint ownership).
  - standard.md §5.2 proposes the KHI split in the "Hasil fikih" output too, pending its ustadz
    question Q5. Hence `hartaBersama = true` in both rulesets.
  - With `hartaBersama = false` the questionnaire must instead ask "berapa bagian almarhum dari harta
    bersama itu", and the engine adds only that portion to the estate.
- **KHI** (`standar-indonesia`): "Apabila terjadi cerai mati, maka separuh harta bersama menjadi hak
  pasangan yang hidup lebih lama" (KHI 96(1), quoted Khairuddin p. 122). The surviving spouse takes ½
  of each pool **as owner, not as heir**. The other ½ joins the estate, and the spouse **also** inherits
  their fardh from it. Example: MA 16 K/AG/2010 (vector `khi-ww-istri-nonmuslim-16K2010`) gave the
  widow ½ of the harta bersama, then a share of the other ½.
- **Several wives** (KHI 94, 190; formula in Buku II 2026 pp. 837–838, unchanged from Buku II 2013
  pp. 145–146). A pool is tagged with the **period** in which it was acquired:
  period 1 = only wife 1 was married to him; period 2 = wives 1 and 2; period 3 = wives 1–3;
  period 4 = wives 1–4. Each living wife in a period takes `1/(k+1)` of that period's pool, where `k`
  is the number of wives in that period. The husband's `1/(k+1)` joins the estate. In Buku II's words
  for wife 1: "1/2 dari harta bersama … selama perkawinan pertama, ditambah 1/3 … bersama dengan istri
  pertama dan istri kedua, ditambah 1/4 …, ditambah 1/5 …".
  - If a wife has died or divorced before the husband, her claim on that pool is a separate matter
    (her own estate, or a divorce settlement): the engine returns `rujuk("harta_bersama_rumit")`.
  - The same applies to a pool that is disputed, mortgaged or not yet valued.
- **Deceased wife.** If the pewaris is a woman, the husband takes ½ of the harta bersama (KHI 96(1)
  is gender-neutral).
- **Non-Muslim spouse.** The harta-bersama right survives a religious difference: MA 16 K/AG/2010
  (widow) and 721 K/Ag/2015 (husband), both quoted in Yurisprudensi 2018 pp. 52–53. The split is
  ownership, not inheritance, so MUI 5/2005 does not block it.

### 3.3 Insurance, pensions, severance

These come from MUI and the courts (standard.md §1.4–1.5; MA 2831 K/AG/1996 as listed by PA
Bojonegoro). The engine does not classify them. The questionnaire asks, and only amounts the user
marks as estate go into `hartaBawaan` or `hartaBersama`. *(Review 2026-10-09.)* The Ijtima' V
decision names one scheme: point C.3 calls *mukafa'ah al-iddikhar* "semacam uang Taspen [Tabungan
Asuransi Pensiun]" and says such money paid because of the death "tunduk pada hukum warits". That a
monthly **survivor's pension** is not estate is an **inference** from point C.1 (non-contributory
benefits "tunduk pada aturan pensiun" for "pihak yang ditunjuk"); the decision does not say it. The KHI
reviewer confirms (plan R20).

### 3.4 What reaches the fara'id stage

`net_estate` (an amount) or, with no amounts, the abstract whole `1`. The fara'id stages (§4–§10)
work on fractions of the whole. Rupiah are applied once, at the end (§14).

### 3.5 Hibah already given

KHI 211 says a parent's hibah to a child "dapat diperhitungkan sebagai warisan": *may*, not *must*.
The engine never subtracts a hibah automatically. The report lists hibah the user entered and says
that the heirs (or a court) may count them. This is an open question for the reviewer (EQ8).

---

## 4. Eligibility (mawani') and who counts

A relative counts only if **alive at the moment of death**, **Muslim** and **not barred**. The engine
runs this before hajb. An ineligible person is reported as `tidak_berhak` with the reason. Such a
person **does not block anyone and does not reduce anyone's share**: an ineligible son does not turn
the wife's ¼ into ⅛. That is the classical rule for a *mamnu'* (excluded by a mani'), as opposed to a
*mahjub* (excluded by a nearer heir). Khairuddin p. 25 calls the first *hijab washfi* and the second
*hijab syakhsy*.

| Mani' | Classical (`klasik-syafii`) | KHI / MA (`standar-indonesia`) | Engine |
|---|---|---|---|
| **Different religion** | Excluded both ways: Bukhari 6764 = Bulugh 1096; Bulugh 1098; Fath al-Qarib § 116 ("فلا يرث مسلم من كافر، ولا عكسه"); an apostate inherits from no one (ibid.) | Excluded: KHI 171(c); Fatwa MUI 5/2005 point 1 | `tidak_berhak("beda_agama")` in both. In `standar-indonesia` a non-Muslim **spouse, child or parent** may receive a **wasiat wajibah** (§11.4, switch `wasiatWajibahNonMuslim`). |
| **Killing** | Any killing bars, intentional or not, even a lawful one: Fath al-Qarib § 116 ("سواء كان قتله مضمونا أم لا"); Fiqh as-Sunnah § 844 ("قال الشافعي: كل قتل يمنع من الميراث… ولو كان بحق"); Bulugh 1107 | Barred only by a **final court judgment** for killing, *attempting* to kill, or seriously assaulting the pewaris, or for a false accusation of a crime carrying ≥ 5 years (KHI 173) | Switch `killerBarred`. If the user reports a killing **without** a final judgment in `standar-indonesia`, the engine returns `rujuk("dugaan_pembunuhan")`. A self-service tool must not decide this. |
| **Slavery** | A mani' in the texts (Fath al-Qarib § 116) | — | Not applicable today; not asked. |
| **Child born outside marriage / li'an** | Inherits only from and through the mother (Fiqh as-Sunnah § 863, citing Bukhari) | KHI 186; Fatwa MUI 11/2012 (standard.md §1.2) | In the father's estate such a child is not an heir. In the mother's estate they are an ordinary child. The questionnaire never asks this directly; its help text says "anak yang sah nasabnya". A *ta'zir* wasiat wajibah from the biological father is court-only → note in the report, no computation. |
| **Adopted child / adoptive parent** | Not an heir | Not an heir; wasiat wajibah ≤ ⅓ (KHI 209) | §11.4, switch `wasiatWajibahAdopsi`. |
| **Stepchild** | Not an heir | Not an heir; *may* receive wasiat wajibah at the court's discretion (SEMA 7/2012 Kamar Agama 19; Buku II 2026 p. 846–847 (j)) | Not computed (discretionary); report note `catatan("anak_tiri_wasiat_wajibah")`. |
| **Child of an unregistered (siri) marriage** | A full child if the nikah was valid | Buku II 2026 p. 846 (i), citing SEMA 3/2023: such a child "dapat ditetapkan sebagai penerima wasiat wajibah" | The engine follows fiqh (a child is a child). The report adds a note that a court may first require *itsbat nikah*. **Open question EQ9.** |

Out-of-scope statuses (khuntsa, mafqud, haml, death in the same accident) are §13.

---

## 5. The heirs and the furudh table

### 5.1 The 25 heirs (Syafi'i)

Fath al-Qarib § 116 lists 10 men and 7 women "بالاختصار", or 15 and 10 "بالبسط". The engine ids
(architecture registry `HEIRS`) are the expanded list. Depth is capped as in §2.

| # | id | Heir | Arabic |
|---|---|---|---|
| 1 | `anak_lk` | son | ابن |
| 2 | `cucu_lk` | son's son | ابن الابن |
| 3 | `ayah` | father | أب |
| 4 | `kakek` | father's father | جد (أبو الأب) |
| 5 | `sdr_lk_kandung` | full brother | أخ شقيق |
| 6 | `sdr_lk_seayah` | consanguine brother | أخ لأب |
| 7 | `sdr_lk_seibu` | uterine brother | أخ لأم |
| 8 | `keponakan_lk_kandung` | son of a full brother | ابن الأخ الشقيق |
| 9 | `keponakan_lk_seayah` | son of a consanguine brother | ابن الأخ لأب |
| 10 | `paman_kandung` | father's full brother | عم شقيق |
| 11 | `paman_seayah` | father's consanguine brother | عم لأب |
| 12 | `sepupu_lk_kandung` | son of a full paternal uncle | ابن العم الشقيق |
| 13 | `sepupu_lk_seayah` | son of a consanguine paternal uncle | ابن العم لأب |
| 14 | `suami` | husband | زوج |
| 15 | `mutiq` | male emancipator | مولى معتق (out of scope) |
| 16 | `anak_pr` | daughter | بنت |
| 17 | `cucu_pr` | son's daughter | بنت الابن |
| 18 | `ibu` | mother | أم |
| 19 | `nenek_ibu` | mother's mother | أم الأم |
| 20 | `nenek_ayah` | father's mother | أم الأب |
| 21 | `sdr_pr_kandung` | full sister | أخت شقيقة |
| 22 | `sdr_pr_seayah` | consanguine sister | أخت لأب |
| 23 | `sdr_pr_seibu` | uterine sister | أخت لأم |
| 24 | `istri` | wife (1–4, share one fardh) | زوجة |
| 25 | `mutiqah` | female emancipator | مولاة معتقة (out of scope) |

**Never excluded by hajb hirman:** husband, wife, father, mother, son, daughter (Fath al-Qarib § 116:
"ومن لا يسقط بحال خمسة: الزوجان، والأبوان، وولد الصلب"; MAIS *pendindingan-semua*).

**Dzawil arham** (Fath al-Mu'in § 34 lists eleven: "ولد بنت وأخت وبنت أخ وعم وعم لأم وخال وخالة وعمة
وأبو أم وأم أبي أم وولد أخ لام") are not heirs in their own right. Engine ids for those it supports
(§10) follow the pattern `<relation>_<via>`:
- children of a daughter: `cucu_lk_dari_anak_pr`, `cucu_pr_dari_anak_pr`;
- `anak_dari_cucu_pr` (a son's daughter's child);
- children of sisters: `anak_lk_sdr_pr_kandung`, `anak_pr_sdr_pr_kandung`, `anak_lk_sdr_pr_seayah`,
  `anak_pr_sdr_pr_seayah`;
- daughters of brothers: `anak_pr_sdr_lk_kandung`, `anak_pr_sdr_lk_seayah`;
- `anak_sdr_seibu` (child of a uterine sibling);
- `kakek_dari_ibu` (maternal grandfather);
- uncles and aunts: `paman_seibu_ayah` (the father's uterine brother), `bibi_ayah` ('ammah),
  `paman_ibu` (khal), `bibi_ibu` (khalah);
- daughters of paternal uncles: `anak_pr_paman_kandung`, `anak_pr_paman_seayah`.

These are the ids used in `test-vectors.json`.

### 5.2 Furudh: conditions, written as predicates

Notation: `F` = far' warith = any eligible, unblocked `anak_lk | anak_pr | cucu_lk | cucu_pr`;
`Fm` = male far' warith (`anak_lk | cucu_lk`); `S` = number of siblings of any line (kandung, seayah,
seibu) who are **alive and eligible, even if they are themselves blocked** (Tafsir Ibn Kathir 4:11:
"فإنهم لا يرثون مع الأب شيئا ولكنهم مع ذلك يحجبون الأم"; Fath al-Qarib § 117: "ولا فرق بين الأشقاء
وغيرهم"). `n(x)` = count of heir x.

| Heir | Share | Condition | Source |
|---|---|---|---|
| `suami` | ½ | ¬F | QS 4:12; Fath al-Qarib § 117 |
| | ¼ | F | ibid. |
| `istri` (all wives share equally) | ¼ | ¬F | QS 4:12; Fath al-Qarib § 117 ("يشتركن كلهن في الثمن"); Fiqh as-Sunnah § 847 ("اقتسمن الربع أو الثمن بينهن بالسوية") |
| | ⅛ | F | ibid. |
| `anak_pr` | ½ | n = 1, no `anak_lk` | QS 4:11 |
| | ⅔ shared | n ≥ 2, no `anak_lk` | QS 4:11 |
| | 'asabah bil ghair, 2:1 | with `anak_lk` | QS 4:11; Fath al-Qarib § 118 |
| `cucu_pr` | ½ | n = 1; no `anak_lk`, `anak_pr`, `cucu_lk` | Fath al-Qarib § 117 |
| | ⅔ shared | n ≥ 2; no `anak_lk`, `anak_pr`, `cucu_lk` | ibid. |
| | ⅙ shared (takmilah) | exactly one `anak_pr`; no `cucu_lk` | Bukhari 6742; Bulugh 1097; Fath al-Qarib § 117 |
| | 'asabah bil ghair with `cucu_lk` | `cucu_lk` present, no `anak_lk` (even if `anak_pr` ≥ 2) | Fath al-Mu'in § 34 ("فإن عصبت به أخذت معه الباقي بعد ثلثي البنتين") |
| `ayah` | ⅙ | Fm | QS 4:11; Fath al-Qarib § 117 |
| | ⅙ + 'asabah | F but ¬Fm (only female descendants) | Fath al-Qarib § 117 ("بنتا وأبا فللبنت النصف، وللأب السدس فرضا، والباقي تعصيبا") |
| | 'asabah | ¬F | Bukhari 6732 |
| `kakek` (no `ayah`) | as `ayah` | no siblings of the kandung/seayah lines eligible | Fath al-Qarib § 117 ("وفرض الجد عند عدم الأب") |
| | special (§8.4) | with kandung/seayah siblings | al-Umm § 556 |
| `ibu` | ⅙ | F, or S ≥ 2 | QS 4:11; Fath al-Qarib § 117 |
| | ⅓ of the remainder after the spouse | exactly spouse + `ayah` + `ibu` inherit, ¬F, S < 2 (*'Umariyyatain*, §8.1) | Fath al-Mu'in § 34; KHI 178(2) |
| | ⅓ | otherwise | QS 4:11 |
| `nenek_ibu`, `nenek_ayah` | ⅙ shared equally by those not blocked | no `ibu` | Bulugh 1103; Fath al-Qarib § 117 ("وللجدتين والثلاث") |
| `sdr_pr_kandung` | ½ / ⅔ | n = 1 / ≥ 2; no `sdr_lk_kandung`; ¬F; no `ayah`; no `kakek` | QS 4:176 |
| | 'asabah bil ghair | with `sdr_lk_kandung` | QS 4:176; Fath al-Qarib § 118 |
| | 'asabah ma'al ghair | with `anak_pr` or `cucu_pr`, ¬Fm, no `ayah`, no `sdr_lk_kandung`, no `kakek` (with the grandfather → §8.4) | Bukhari 6742; Fath al-Mu'in § 34 ("وعصب الأخريين الأوليان") |
| `sdr_pr_seayah` | ½ / ⅔ | n = 1 / ≥ 2; no kandung sisters, no `sdr_lk_seayah`; ¬F; no `ayah`; no `kakek` | QS 4:176 |
| | ⅙ shared (takmilah) | exactly one `sdr_pr_kandung` taking ½ as fardh, no `sdr_lk_seayah` | Fath al-Qarib § 117 |
| | 'asabah bil ghair | with `sdr_lk_seayah` | Fath al-Qarib § 118 |
| | 'asabah ma'al ghair | with `anak_pr`/`cucu_pr`, no kandung sister or brother | Fath al-Mu'in § 34 |
| `sdr_lk_seibu` + `sdr_pr_seibu` (pooled) | ⅙ | pooled n = 1 | QS 4:12 |
| | ⅓ shared **per head, male = female** | pooled n ≥ 2 | QS 4:12; Fath al-Qarib § 117 ("ذكورا كانوا أو إناثا") |

Grandmothers never take ⅓ or ⅓ of the remainder (Fath al-Mu'in § 34: "والجدة كالأم إلا أنها لا ترث
الثلث ولا ثلث الباقي بل فرضها دائما السدس").

---

## 6. Hajb

### 6.1 Hajb hirman: the complete matrix (classical Syafi'i)

Read each row as "**X** is excluded entirely if any of these is present, eligible and not itself
excluded". The engine evaluates rows top-down in this order, because a blocker must itself be
unblocked to block. A blocked heir still counts in `S` (§5.2), but blocks no one else.

Sources for the whole table: Fath al-Qarib § 117 (core list), Fath al-Mu'in § 34 (the full chains,
including the ma'al-ghair sister and the nephew, uncle and cousin chains), Khairuddin pp. 26–29,
MAIS *pendindingan-semua*. Rows that only one source states are marked.

| Heir (X) | Excluded by (any one of) | Notes |
|---|---|---|
| `anak_lk`, `anak_pr`, `ayah`, `ibu`, `suami`, `istri` | never | Fath al-Qarib § 116 |
| `cucu_lk` | `anak_lk` | |
| `cucu_pr` | `anak_lk`; **or** `anak_pr` ≥ 2 **unless** `cucu_lk` is present (he makes her 'asabah) | Fath al-Mu'in § 34; Khairuddin p. 26 notes this is "habis bagian", not strictly hijab |
| `kakek` | `ayah` | Fath al-Qarib § 117 ("وتسقط الأجداد بالأب") |
| `nenek_ibu` | `ibu` | Fath al-Qarib § 117 ("وتسقط الجدات… بالأم") |
| `nenek_ayah` | `ibu`; `ayah` | Fath al-Mu'in § 34 ("ولأب بأب وأم"); Khairuddin p. 26 |
| `sdr_lk_kandung`, `sdr_pr_kandung` | `anak_lk`; `cucu_lk`; `ayah` | Fath al-Qarib § 117. **Not** the grandfather in Syafi'i (al-Umm § 556); see §8.4. |
| `sdr_lk_seayah`, `sdr_pr_seayah` | the above; `sdr_lk_kandung`; `sdr_pr_kandung` when she is 'asabah ma'al ghair | Fath al-Qarib § 117; Fath al-Mu'in § 34 ("وبأخت لأبوين معها بنت أو بنت ابن") |
| `sdr_pr_seayah` only | additionally: `sdr_pr_kandung` ≥ 2 **unless** `sdr_lk_seayah` is present | Fath al-Mu'in § 34 ("إلا أن يكون معهن ذكر فيعصبهن") |
| `sdr_lk_seibu`, `sdr_pr_seibu` | any of `anak_lk`, `anak_pr`, `cucu_lk`, `cucu_pr`; `ayah`; `kakek` | Fath al-Qarib § 117 ("ويسقط ولد الأم مع أربعة: الولد… وولد الابن… والأب والجد") |
| `keponakan_lk_kandung` | `anak_lk`; `cucu_lk`; `ayah`; `kakek`; `sdr_lk_kandung`; `sdr_lk_seayah`; a sister (kandung or seayah) who is 'asabah ma'al ghair | Fath al-Mu'in § 34 (lists six); the ma'al-ghair sister follows because she "takes the place of a brother" (Fath al-Mu'in § 34, same passage on consanguine brothers). Khairuddin p. 27 |
| `keponakan_lk_seayah` | the above; `keponakan_lk_kandung` | Fath al-Mu'in § 34 ("بهؤلاء الستة وبابن أخ لأبوين") |
| `paman_kandung` | the above; `keponakan_lk_seayah` | Fath al-Mu'in § 34 ("بهولاء السبعة وبابن أخ لأب") |
| `paman_seayah` | the above; `paman_kandung` | ibid. |
| `sepupu_lk_kandung` | the above; `paman_seayah` | ibid. |
| `sepupu_lk_seayah` | the above; `sepupu_lk_kandung` | ibid. |
| any 'asabah | gets nothing if the furudh exhaust the estate (*istighraq*) | Fath al-Mu'in § 34 ("وتسقط عند الاستغراق"); the one exception is musytarakah (§8.2) |
| dzawil arham (§10) | any heir by fardh or 'asabah, **except** a spouse | Fath al-Mu'in § 34 gives the order: radd to the non-spouse furudh heirs first, then dzawil arham. A spouse takes no radd, so a spouse alone does not exclude them. Tarjih states the general rule ("kalau tidak ada ahli waris zawul furud atau 'asabah") without the spouse exception. |

Implementation: one `blockers(x, present): HeirId[]` function returns the matrix row for x. The same
function serves the questionnaire (architecture §6.2), with unanswered relatives treated as "maybe
present".

**Revised in review 2026-10-09: the questionnaire asks about a relative if they could change any
number, not only if they could inherit.** The draft used `couldInherit(x, known, ruleset)`. That drops
relatives who change the result without inheriting. The questionnaire must use
`couldAffectOutcome(x, known)`, the OR over **both** rulesets of:

1. `couldInherit(x, known, r)`: x is not excluded under ruleset r;
2. **counts toward S** (§5.2): x is a sibling of any line, the mother is alive or unknown, there is no
   descendant, and fewer than 2 siblings are known so far. Blocked siblings still lower the mother to
   ⅙;
3. **counts against the grandfather** (mu'addah, §8.4): x is a consanguine sibling, the grandfather is
   eligible, and a full sibling is present. Consanguine siblings are counted in the muqasamah units
   even though the full brother then takes their share (vector `jadd-muaddah`: without them the
   grandfather would take ½ instead of ⅓);
4. **changes a named pattern**: any sibling while the Akdariyyah or 'Umariyyatain pattern could still
   match (both require S < 2).

Families that the draft skip rules got wrong, now vectors: `hajb-nuqshan-ibu-oleh-sdr-seayah-terhijab`
(mother + full brother + paternal brother: mother ⅙, not ⅓), `jadd-ibu-kakek-sdrlk-sdrseibu`,
`jadd-ibu-kakek-2seibu`, `jadd-akdariyyah-batal-seibu`. The completeness property test (architecture
§6.6) must sample every relative type independently and run per ruleset, so that this class of error
fails CI.

### 6.2 Hajb nuqshan (share reduced, not removed)

These cases are all already in the furudh predicates (§5.2). The trace records them separately,
because the lessons teach them as one idea. Fiqh as-Sunnah § 851 lists five; the engine also traces
the 'asabah-to-fardh change of the father.

| Who | From → to | Because of | Rule id |
|---|---|---|---|
| `suami` | ½ → ¼ | any F | `nuqshan.suami` |
| `istri` | ¼ → ⅛ | any F | `nuqshan.istri` |
| `ibu` | ⅓ → ⅙ | F, or S ≥ 2 (blocked siblings count) | `nuqshan.ibu` |
| `ibu` | ⅓ → ⅓ of the remainder | spouse + father ('Umariyyatain) | `umariyyatain` |
| `ayah` / `kakek` | 'asabah → ⅙ (+'asabah) | Fm (or only female F) | `nuqshan.ayah` |
| `cucu_pr` | ½ → ⅙ | one `anak_pr` | `takmilah.cucu_pr` |
| `sdr_pr_seayah` | ½ → ⅙ | one `sdr_pr_kandung` | `takmilah.sdr_pr_seayah` |
| everyone with fardh | proportional | 'aul (§9.2) | `aul` |

### 6.3 KHI / MA deltas to the matrix (`standar-indonesia` ruleset)

Each delta is a switch (§12). "Anak" below means a child of either sex **or** a KHI substitute
standing in a child's place (§11.1).

| Delta | Rule | Source | Switch |
|---|---|---|---|
| A child of **either** sex excludes all siblings (every line) and their descendants, and paternal uncles and cousins | "Selama masih ada anak laki-laki maupun anak perempuan, maka hak waris dari orang-orang yang mempunyai hubungan darah dengan pewaris kecuali orang tua, suami dan isteri menjadi tertutup (terhijab)" | 86 K/AG/1994, quoted in KY 122 K/AG/1995; 122 K/AG/1995 (single daughter, siblings excluded; she takes all through radd); 184 K/AG/1995; 19 PK/AG/2014 ("2 anak perempuan menghijab saudara laki-laki dan saudara perempuan", PA Bojonegoro); 47 K/AG/2017 ("2 anak perempuan menghabiskan sisa harta dari bagian isteri", ibid.). Buku II 2013 p. 175 §5(a) | `daughtersExcludeSiblings` |
| Uterine siblings are excluded only by a **child or the father** (not the grandfather) | KHI 181: "Bila seorang meninggal tanpa meninggalkan anak dan ayah…" | KHI 181; Buku II 2013 p. 175 §5(a)–(b) | `uterineExcludedBy: "khi181"`, **comparison only since review 2026-10-09**. KHI 182 uses the same words ("tanpa meninggalkan anak dan ayah") for full and consanguine sisters, yet this engine keeps Zaid's grandfather sharing for them. Reading 181 literally and 182 not is inconsistent, and no decision applies either. Default `"classical"` in both rulesets until a court decision is found. |
| Grandparents are **not** excluded by a child | Buku II 2013 p. 175 §5 lists who a child excludes, and grandparents are not on the list. The literal 86 K/AG/1994 wording ("kecuali orang tua, suami dan isteri") would exclude them. | **Conflict, open question EQ2.** The engine keeps grandparents (classical) in both rulesets until the reviewer decides. | none yet |

**Not adopted** (for the reviewer's information): Buku II 2013 p. 175 §6 reports a yurisprudensi
line that "menyamakan kedudukan saudara seibu dengan saudara sekandung atau saudara seayah", making
them joint 'asabah 2:1. Buku II 2026 does not repeat it, and I found no decision number. The engine
does not implement it. If the reviewer wants it, it becomes a switch `uterineAsFull`.

Buku II 2013 has two more "bilateral" rules that Buku II 2026 also dropped. The engine does not
implement either.

- **Grandparents.** Each grandparent couple would stand in for the parent of their side ("Kakek dan
  nenek dari pihak ayah mewarisi bagian dari ayah, masing-masing berbagi sama", p. 174 §4(c)(3)–(4)).
  The mother would exclude only "kakek dan nenek yang melahirkannya" (p. 175 §5(c)), so she would not
  exclude the father's mother. Classical fiqh has the mother exclude every grandmother (Fath al-Qarib
  § 117).
- **Ahli waris pengganti** would reach nieces, aunts and the aunts' descendants (p. 171 §2(a)(2)).
  SEMA 3/2015 later limited it to grandchildren.

Both are listed only so that the reviewer knows they exist.

**Buku II 2013 is superseded, and the engine uses it selectively (review 2026-10-09).** Buku II 2026
(Lampiran II KMA 159/KMA/SK.HK2/VIII/2026, pp. 844–848) contains no calculation rules. Two court-column
defaults still rest on Buku II 2013: no radd to a spouse (p. 176 §8(h)) and the "sederajat" part of the
wasiat-wajibah ceiling (p. 173 §2(i)). The same pages hold calculation guidance that this engine
**rejects**. The reviewer should see all of it together:

| Buku II 2013 (printed folio, PA Rumbia transcription) | Text | Why the engine does not follow it |
|---|---|---|
| p. 174 §4(a)(6) | "Seorang saudara laki-laki atau perempuan (baik sekandung, seayah atau seibu) mendapat 1/6 bagian, apabila terdapat dua orang saudara atau lebih (sekandung, seayah atau seibu) mendapat 1/3 bagian jika saudara (sekandung, seayah atau seibu) mewarisi bersama ibu pewaris (yurisprudensi)" | Gives full and consanguine siblings the uterine shares of QS 4:12. QS 4:176 and Bukhari 6732 make them residuaries. No decision number is given; Buku II 2026 drops it. |
| p. 177 §9(e)–(f) | spouse + mother + one sibling of any line: "Janda memperoleh 1/4 atau jika duda ... 1/2, ibu 1/3 dan seorang saudara ... memperoleh 1/6 bagian", then 'aul or radd | The same rule as §4(a)(6), applied in worked examples. |
| p. 176 §9(a)–(b) | spouse + father + mother + daughters: "ayah 1/6 ... anak ... memperoleh sisa, jika anak hanya terdiri dari anak perempuan ... dilakukan radd atau 'aul" | The `fatherWithDaughters="fardh_then_radd"` reading (§11.3). Kept as a switch value, not the default (EQ1). |
| p. 175 §6; p. 174 §4(c)(3)–(4); p. 175 §5(c); p. 171 §2(a)(2) | uterine = full siblings; grandparents stand in for their side; wide substitution | Listed above. |

So the radd-to-spouse and ceiling defaults rest on Buku II 2013 plus Khairuddin, **not** on current MA
guidance. The KHI reviewer confirms current Pengadilan Agama practice before the court column ships.

---

## 7. 'Asabah (residuaries)

### 7.1 'Asabah bin-nafsih: who takes the residue

The residue after the furudh goes to the nearest male agnate (Bukhari 6732: "فَمَا بَقِيَ فَهْوَ لأَوْلَى
رَجُلٍ ذَكَرٍ"). "Nearest" is decided by a three-part key, compared lexicographically (Fiqh as-Sunnah
§§ 849–850: "التقديم في العصبات بالنفس يكون بالجهة فإن اتحدت فبالدرجة فإن تساوت فبالقوة"; order of
heirs in Fath al-Qarib § 116 and Fath al-Mu'in § 34):

| jihah (1 = strongest) | darajah within the jihah | quwwah within the darajah |
|---|---|---|
| 1 bunuwwah | `anak_lk` (1) → `cucu_lk` (2) | — |
| 2 ubuwwah | `ayah` (1) → `kakek` (2) | — |
| 3 ukhuwwah | brothers (1) → nephews (2) | kandung (1) → seayah (2) |
| 4 'umumah | paman (1) → sepupu (2) | kandung (1) → seayah (2) |
| 5 wala' | out of scope → `rujuk("wala")` | |

```ts
key(h) = [jihah(h), darajah(h), quwwah(h)]
asabahGroup = all eligible, unblocked bin-nafs heirs whose key equals the minimum key present
```

All members of `asabahGroup` hold the same id, so the residue is split per head (with sisters for
bil-ghair, §7.2). Two exceptions to the plain key:

1. The **father** (jihah 2) is also a fardh heir: with a male descendant he takes only ⅙, and with only
   female descendants he takes ⅙ and then the residue (§5.2).
2. The **grandfather with brothers** (jihah 2 against jihah 3) is not decided by the key in Syafi'i
   fiqh. They share by Zaid's method (§8.4). The grandfather still excludes nephews and uncles
   (Fath al-Mu'in § 34).

### 7.2 'Asabah bil-ghair (2 : 1)

| Male | makes 'asabah | Source |
|---|---|---|
| `anak_lk` | `anak_pr` | QS 4:11; Fath al-Qarib § 118 |
| `cucu_lk` | `cucu_pr` (even when two daughters took ⅔) | Fath al-Mu'in § 34 |
| `sdr_lk_kandung` | `sdr_pr_kandung` | QS 4:176; Fath al-Qarib § 118 |
| `sdr_lk_seayah` | `sdr_pr_seayah` | Fath al-Qarib § 118 |
| `kakek` (with siblings, §8.4) | `sdr_pr_kandung` / `sdr_pr_seayah` inside the muqasamah | MAIS *datuk-bersama-…* ("datuk mengasobahkan mereka mengikut kaedah asobah bi al-ghairi") |

Units: male 2, female 1. When the bil-ghair group is the 'asabah, its females **lose their fardh**.
The uterine brother does **not** make his sister 'asabah. They share ⅓ per head (Fath al-Qarib § 118:
"أما الأخ من الأم فلا يعصب أخته، بل لهما الثلث"). Nephews, uncles and cousins inherit **without** their
sisters, who are dzawil arham (Fath al-Qarib § 118: "وأربعة يرثون دون أخواتهم").

Teaching cases that fall out of the rules with no special code:

- *al-akh al-mubarak* ("blessed brother"): with two daughters, a son's son brings in his sister, who
  would otherwise be excluded.
- *al-akh al-mash'um* ("unlucky brother"): a consanguine brother turns his sister's ⅙ takmilah into a
  share of a residue that is empty.

### 7.3 'Asabah ma'al-ghair

A full sister, or failing her a consanguine sister, who inherits with a daughter or a son's daughter
and has no brother of her own line becomes 'asabah and takes the residue (Bukhari 6742; Fath al-Mu'in
§ 34). While she holds that position she **ranks as a brother of her line** for exclusion: a full
sister ma'al-ghair excludes consanguine siblings, nephews, uncles and cousins (Fath al-Mu'in § 34;
Khairuddin pp. 40–42, case 3).

### 7.4 No 'asabah left

If no 'asabah remains and the furudh sum is below 1 → §9.4 (radd, then dzawil arham, then Baitul Mal,
depending on the ruleset).

---

## 8. Special cases

The engine checks the four named cases (8.1–8.4) **before** the general furudh and 'asabah stages,
using exact pattern predicates on the eligible, unblocked set. Each emits its own rule id, so the
report can say "Ini kasus *'Umariyyatain*".

### 8.1 'Umariyyatain (Gharrawain)

- **Pattern:** the only inheriting heirs are {spouse, `ayah`, `ibu`}, with ¬F and S < 2. Excluded
  relatives may also exist.
- **Rule:** `ibu = (1 − spouse) / 3`; `ayah` takes the residue.
- **Result:**
  - husband ½, mother ⅙, father ⅓ (asal 6: 3, 1, 2);
  - wife ¼, mother ¼, father ½ (asal 4: 1, 1, 2).
- **Sources:**
  - Fath al-Mu'in § 34 gives both tables with numbers ("فالمسألة من ستة للزوج ثلاثة وللأب اثنان وللام
    واحد… من أربعة للزوجة واحد وللام واحد وللأب اثنان");
  - MAIS *umariyyatain*;
  - Khairuddin pp. 67–71;
  - KHI 178(2);
  - Buku II 2013 p. 177 (examples (c), (d), on asal 12).
- **Dissent (recorded, not a switch):**
  - Ibn 'Abbas: mother ⅓ of the whole in both cases;
  - Ibn Sirin and Abu Tsaur: mother ⅓ of the whole only in the wife case (asal 12: 3, 4, 5) (Khairuddin pp. 68–70).
  - Every opened Syafi'i and Indonesian source follows 'Umar.
- **Grandfather instead of father:** the opened sources state the rule only "with the father" (KHI
  178(2): "bila bersama-sama dengan ayah"; Fath al-Mu'in: "مع أحد زوجين وأب"). The engine applies
  8.1 only when the father is present. With the grandfather, the mother takes ⅓ of the whole (§5.2).
  That is the usual Syafi'i teaching, **but I did not open a source that says so** (EQ10).
  - *Review 2026-10-09.* The reviewer pointed out that the only corpus sentence, Fath al-Mu'in § 34
    "والجد كالأب إلا أنه لا يحجب الإخوة لأبوين أو لأب", names a single exception and, read literally,
    would make the grandfather reduce the mother too. That sentence is a summary, not an exhaustive
    list: read literally it would also let the grandfather exclude the father's mother, which §6.1
    (and al-Shafi'i) reject. An external Syafi'i text now states the rule: al-Mawardi, *al-Hawi
    al-Kabir* 8:121, quoting al-Shafi'i, "إلا في فريضتين زوج وأبوين أو امرأة وأبوين ، فإنه إذا كان
    فيهما مكان الأب جد صار للأم الثلث كاملا". Al-Mawardi adds that it is agreed with a wife and the
    majority view with a husband, and reports 'Umar giving the mother ⅓ of the remainder (§0.2). Vectors
    `umariyyatain-kakek-suami` (½, ⅓, ⅙) and `umariyyatain-kakek-istri` (¼, ⅓, 5/12), status `rule`.
    The default stands, but it may not ship until the page is pinned and the reviewer confirms (R17).

### 8.2 Musytarakah (Himariyyah): switch `musytarakah`

- **Pattern:**
  - `suami`;
  - a ⅙ mother-side heir (`ibu`, or `nenek_*` when there is no mother);
  - pooled uterine siblings ≥ 2;
  - ≥ 1 `sdr_lk_kandung`, with or without `sdr_pr_kandung`;
  - ¬F, no `ayah`, no `kakek`.
  - By construction the furudh then sum to exactly 1, so the full brothers would get nothing.
- **Rule (Syafi'i, and Malik):** the full siblings join the uterine siblings in the ⅓. It is divided
  **per head, male = female**, among all of them.
  - Sources: al-Umm § 559 ("ويشركهم بنو الأب؛ لأن الأب لما سقط حكمه صاروا…"); MAIS *musytarikah*
    (asal 18: husband 9, mother 3, two uterine sisters 2 + 2, full brother 2); Khairuddin pp. 76–79.
  - The remainder is all ⅓ of the whole, so in each source's own example every sibling gets
    ⅓ ÷ (number of siblings).
- **Not musytarakah:**
  - a **consanguine** brother instead of a full one: he simply gets nothing;
  - full **sisters** only: they take ½ or ⅔ as fardh and the case goes to 'aul;
  - a wife instead of a husband: a residue is left.
- **Dissent:** Abu Bakr, 'Ali, Ibn 'Abbas; Hanafi and Hanbali give the full brother nothing
  (Khairuddin p. 75). Switch value `false` reproduces that.

### 8.3 Akdariyyah

- **Pattern:** the only inheriting heirs are exactly `suami`, `ibu`, `kakek` and **one** sister
  (kandung or seayah), **and `S == 1`**: no other sibling of any line is alive and eligible, even a
  blocked one. The rule gives the mother ⅓, and that requires S < 2 (Khairuddin pp. 89–91 sets the mother
  at 2 of 6). *(Condition added in review 2026-10-09.)* Counter-example vector
  `jadd-akdariyyah-batal-seibu`: husband, mother, grandfather, one full sister and one uterine
  brother, who is excluded by the grandfather but still counts. S = 2, so the mother takes ⅙ and this is
  ordinary §8.4: R = ⅓, grandfather max(2/9, 1/9, ⅙) = 2/9, sister 1/9, base 18 (9 + 3 + 4 + 2), no
  'aul. Without the condition the engine would print base 27 and give the mother 2/9.
- **Rule (Zaid; Syafi'i, Maliki, Hanbali):**
  1. Give husband ½, mother ⅓, grandfather ⅙ and the sister ½. The problem rises from 6 to 9.
  2. Pool the grandfather's 1 and the sister's 3, making 4/9, and split it 2 : 1.
  3. Tashih ×3 gives **27: husband 9, mother 6, grandfather 8, sister 4**.
- **Sources:** Khairuddin pp. 89–92 (method; its first list misprints the mother as ⅙ and then
  computes ⅓); Achmad Yani (table with tashih 27).
- **Dissent:**
  - Abu Bakr and Abu Hanifah: the sister is excluded (6: 3, 2, 1);
  - 'Umar and Ibn Mas'ud: the mother gets ⅙ (8: 3, 1, 3, 1).
  - Neither is a switch. The engine implements Zaid only, and any other choice → `rujuk`.
- **Near misses** (ordinary §8.4):
  - with two sisters, the mother drops to ⅙, the grandfather takes ⅙ and the sisters take ⅙;
  - with a brother instead of a sister, the grandfather takes ⅙ and the brother gets nothing.

### 8.4 Grandfather with full/consanguine siblings (Zaid's method)

Applies when `kakek` is eligible (no `ayah`) and at least one `sdr_*_kandung` or `sdr_*_seayah` is
eligible and not excluded by a male descendant. Uterine siblings are excluded by the grandfather in
classical fiqh (§6.1).

- **Sources:**
  - al-Umm § 556 (muqasamah or ⅓, whichever is better);
  - Fath al-Qarib § 117 (with another fardh heir, ⅙ when it beats muqasamah and ⅓ of the remainder:
    "بنتين وجد وثلاثة إخوة");
  - MAIS *datuk-bersama-…* (the two regimes, and the rule for full sister + consanguine siblings);
  - Khairuddin pp. 87–102 (named cases).

```
FX  = other fardh heirs present: spouse, ibu / nenek, anak_pr, cucu_pr
      (sisters take no fardh here, except in Akdariyyah)
R   = 1 − Σ furudh(FX)
if R ≤ 1/6:                      # Khairuddin p. 101 (3); MAIS (≥ 1/6 floor)
    kakek = 1/6 as fardh          # 'aul if R < 1/6; siblings get nothing (unless Akdariyyah, §8.3)
else:
    units  = 2·[kakek] + Σ over kandung AND seayah siblings (brother 2, sister 1)
             # seayah are counted against the grandfather even when kandung are present (mu'addah)
    muq    = R × 2 / units
    kakek  = max(muq, R/3, 1/6)  if FX non-empty     # MAIS: "1/6, 1/3 baki atau muqasamah"
             max(muq, 1/3)       if FX empty         # MAIS / al-Umm: "1/3 atau muqasamah"
P = R − kakek                     # the siblings' pool
if any sdr_lk_kandung:            # full brother present: full siblings (2:1) take all of P; seayah get 0
    split P among kandung siblings 2:1
elif any sdr_pr_kandung and any seayah sibling:
    fs   = min(P, 1/2 if n(sdr_pr_kandung)=1 else 2/3)   # full sister(s) take up to their fardh (a fraction of the whole estate)
    rest = P − fs → seayah siblings 2:1 (may be 0)       # MAIS last bullet; Zaidiyyat (Khairuddin pp. 92–99)
else:
    split P among the siblings present 2:1               # one line only
```

Checks against the sources (all in `test-vectors.json`):

| Case | Heirs | Result | Source |
|---|---|---|---|
| Fath al-Qarib | 2 daughters, grandfather, 3 brothers | ⅔; G ⅙ (beats 1/9 and 1/12); brothers 1/18 each | Fath al-Qarib § 117 |
| Mu'addah | G, full brother, consanguine brother | G ⅓; full brother ⅔; consanguine 0 | Khairuddin pp. 98–99, 101–102 |
| 'Asyriyah Zaid | G, full sister, consanguine brother | 4/10, 5/10, 1/10 | Khairuddin pp. 92–93 |
| 'Isyriniyah | G, full sister, 2 consanguine sisters | 8/20, 10/20, 1/20 each | Khairuddin pp. 95–97 |
| Mukhtasharah | mother, G, full sister, consanguine brother, consanguine sister | 9, 15, 27, 2, 1 of 54 | Khairuddin pp. 97–98 |
| Tis'iniyah | mother, G, full sister, 2 consanguine brothers, consanguine sister | 15, 25, 45, 2, 2, 1 of 90 | method Khairuddin p. 99; numbers computed here |
| Kharqa' (Zaid) | mother, G, sister | ⅓, 4/9, 2/9 | Khairuddin pp. 93–94 |

**Source error found:** Khairuddin p. 102 solves "kakek, satu saudari sekandung, satu saudara seayah"
as G ⅓, sister ½, brother the rest. That contradicts the same book's 'Asyriyah (pp. 92–93: G 2/5,
because muqasamah 2/5 > ⅓). The engine follows 'Asyriyah, which also matches MAIS's rule. Khairuddin
p. 100's example "ibu, suami, kakek dan satu saudara laki-laki → ibu 1/6" gives the mother ⅙ with only
one sibling. That conflicts with QS 4:11 (one sibling does not reduce her), so it is not used as a
vector.

### 8.5 Other named cases (no special code)

| Name | Heirs | What happens | Source |
|---|---|---|---|
| Minbariyyah | wife, 2 daughters, father, mother | 'aul 24 → 27; the wife's ⅛ becomes 3/27 | NU Online 'aul; Zuhaili *al-Mu'tamad* IV:441 via NU Online |
| Mubahalah | husband, mother, full sister | 'aul 6 → 8 (3, 2, 3). Ibn 'Abbas rejected 'aul here. | Khairuddin pp. 45–47 |
| Ummul-furukh / 6 → 10 | husband, mother, 2 full sisters, 2 uterine sisters | 'aul 6 → 10 | NU Online 'aul |
| first 'aul under 'Umar | husband, 2 full sisters | 6 → 7 | Fiqh as-Sunnah §§ 852–853; Khairuddin p. 44 |

---

## 9. Asal masalah, 'aul, tashih, radd

The engine computes exact fractions first and then derives the classical integer table from them. The
two must agree; the engine asserts it. The table is what the lessons animate: tiles of the asal
masalah that grow under 'aul and are re-cut under radd.

### 9.1 Asal masalah

```
groupShare[g]  : exact Frac for every fardh group g (wives together, daughters together, pooled uterine siblings …)
base           = lcm(den(groupShare[g]) for every fardh group)      # = 1 when there are only 'asabah
siham[g]       = groupShare[g] × base                               # integer by construction
sumFurudh      = Σ siham[g]
```

With the furudh alone, `base` is always one of the seven usul {2, 3, 4, 6, 8, 12, 24} (NU Online 'aul,
quoting al-Rahabi). Zaid's grandfather method adds bases such as 18 and 36, because the grandfather
may take ⅓ of a remainder. Khairuddin pp. 31–32 teaches lcm by "largest denominator × 1, 2, 3". That
is a special case of lcm and gives the same numbers.

If there are only 'asabah, the base is the number of **units** (male 2, female 1 when both sexes are
present; one per head otherwise, as in §9.3). Example: 1 son + 10 daughters gives 12 units, so the
daughters take 10/12 (Fath al-Qarib § 117: "فلهن عشرة من اثني
عشر"); three sons give 3, not 6 (Fath al-Mu'in § 35, `F-FMUIN-35-usul`). *(Clarified in review,
2026-10-09: the engine had used 2 per male even with no female.)*

### 9.2 'Aul (KHI 192; every opened source)

```
if sumFurudh > base:         # over-subscribed
    finalBase = sumFurudh     # every fardh shrinks in proportion; 'asabah get 0
    trace("aul", { dari: base, menjadi: sumFurudh })
```

Only bases 6, 12 and 24 can rise: 6 → 7, 8, 9, 10; 12 → 13, 15, 17; 24 → 27 (NU Online 'aul, quoting
Zuhaili *al-Mu'tamad* IV:438–441; MAIS *aul*; Fiqh as-Sunnah § 853: "والمسائل التي لا يدخلها العول
أصلا هي المسائل التي تكون أصولها 2 - 3 - 4 - 8"). The engine **asserts** this: a result outside the
list means a bug, and the solve fails loudly in tests. (Zaid's grandfather bases are already included
in this check, since the ⅙ floor 'aul only ever happens on 6, 12 or 24.) Ibn 'Abbas rejected 'aul
(Khairuddin pp. 45–47); no ruleset follows him.

### 9.3 Tashih (making every head's portion whole) and ikhtisar

```
for each group g with heads h_g and unit weights (2:1 inside bil-ghair groups, 1 per head otherwise):
    u_g = Σ units of g
    need_g = u_g / gcd(siham[g], u_g)
m          = lcm(need_g over all g)
finalBase *= m ;  siham[g] *= m
g          = gcd(finalBase, all per-head units) ; divide everything by g      # ikhtisar
```

This lcm form is what the classical four relations (tamatsul, tadakhul, tawafuq, tabayun; Khairuddin
p. 31) compute. The final reduction by the common factor is Zaid's *ikhtisar* (Khairuddin pp. 97–98:
108 → 54 in al-Mukhtasharah). Musytarakah and pooled uterine siblings use weight 1 per head for
both sexes.

*Trace (review 2026-10-09).* With per-person exact fractions the same steps are: T0 = the table before
tashih (the asal masalah; the 'aul total; under radd the radd masalah: the heads when the radd heirs are
one class, else the sum of their siham, fitted into the spouse's table when a spouse takes no radd,
Fiqh as-Sunnah § 855); T2 = finalBase, the lcm of the per-person denominators; T1 = lcm(T0, T2).
`tashih {dari: T0, menjadi: T1}` is emitted when T1 > T0 and `ikhtisar {dari: T1, menjadi: T2}` when
T2 < T1. Example: Akdariyyah 6 → 9 ('aul) → 27 (tashih); a daughter and the father 6 → 2 (ikhtisar).
Zaid's grandfather cases differ in the intermediate table (al-Mukhtasharah shows tashih 18 → 54, not
108 → 54); the final table is the same.

### 9.4 When the furudh fall short and there is no 'asabah: switch `residue`

| Value | Meaning | Source | Ruleset |
|---|---|---|---|
| `"baitul_mal"` | The residue goes to the Baitul Mal. No radd, no dzawil arham. This is the original Syafi'i position, which applies where a well-ordered Baitul Mal exists. | Fath al-Qarib § 117 ("فإن لم يوجد… فماله لبيت المال"); Fath al-Mu'in § 34 ("فأصل المذهب أنه لا يورث ذوو الأرحام ولا يرد على أهل الفرض… بل المال لبيت المال"); MAIS *baitulmal* (quoting al-Nawawi, *Rawdat al-Talibin* V:6–7), with examples: one daughter → ½ to the Baitul Mal; husband + mother → ⅙ to the Baitul Mal | optional (`klasik-syafii-asal`) |
| `"radd_non_spouse"` | Radd to the **non-spouse** fardh heirs in proportion to their furudh. If none exist, then dzawil arham (§10); if none, the residue is left unassigned (`sisa_dirujuk`, soft stop; review 2026-10-09). | Fath al-Mu'in § 34 ("ثم إن لم ينتظم المال رد ما فضل عنهم عليهم غير الزوجين بنسبة الفروض ثم ذوي الأرحام"); Khairuddin pp. 54–55 (jumhur, 'Ali; spouses excluded, QS 8:75); Buku II 2013 p. 176 §8(h): "Radd tidak berlaku untuk janda dan duda" | **`klasik-syafii` and `standar-indonesia`** |
| `"radd_all"` | Radd to all fardh heirs, spouse included. This is the literal reading of KHI 193 ("dibagi berimbang di antara mereka"), as Khairuddin p. 131 reads it, and the view of 'Utsman (Khairuddin p. 54). | KHI 193; Khairuddin pp. 54, 131 | comparison only |

```
radd_non_spouse:
    spouse keeps exactly their fardh
    for every other fardh group g:  final[g] = groupShare[g] × (1 − spouseShare) / Σ_{non-spouse} groupShare
radd_all:
    final[g] = groupShare[g] / Σ groupShare
```

These are exactly the two-stage tables of Khairuddin pp. 56–65. Example: wife ⅛; daughter and mother
on base 6 "radd to 4", sharing the remaining ⅞; result daughter 21/32, mother 7/32.

**Spouse is the only heir.** *(Revised in review 2026-10-09.)* Under `radd_non_spouse` the residue
goes to dzawil arham (§10) if there are any. If there are none, the engine assigns the residue to **no
one**: it returns the spouse's share plus a `sisa_dirujuk` line ("sisa: konsultasikan") in **both**
columns. The reason: Fath al-Mu'in § 34 adopts radd and dzawil arham only "ثم إن لم ينتظم المال" (because
the Baitul Mal is not orderly) and says nothing after dzawil arham, so this ruleset cannot also assume an
orderly Baitul Mal. Khairuddin p. 55 records the view, from 'Utsman, that the spouse then takes the
residue as radd. The Baitul Mal line stays only in the `klasik-syafii-asal` comparison profile.
Vectors `asal-baitulmal-istri-saja` and `khi-ww-anak-nonmuslim-besar` were corrected. *(Draft text
follows.)* Previously: else to the Baitul Mal. KHI 191 sends an estate to the Baitul Mal only when there is "tidak
meninggalkan ahli waris sama sekali", and a spouse *is* an heir. Today this is administered through
BAZNAS or a Baitul Mal under SEMA 1/2022 (Buku II 2026 p. 845 (e)). No opened source says what an
Indonesian court does with the widow's remaining ¾. Egyptian law (Fiqh as-Sunnah § 855) gives it to
the spouse after the dzawil arham. **Open question EQ3.** The draft engine reported
`adjustments: ["baitul_mal"]` together with a `rujuk("sisa_pasangan_saja")` note; since the review it reports `sisa_dirujuk` plus the `sisa_pasangan_saja` note, as above.

The Baitul Mal line (only in `klasik-syafii-asal`) and the `sisa_dirujuk` line are always shown explicitly. Shares then sum to `1 − baitulMal − sisaDirujuk`, and the invariant
test checks `Σ shares + baitulMal + sisaDirujuk = 1`.

---

## 10. Dzawil arham: switch `dzawilArham`

**When:** no 'asabah, and no fardh heir other than a spouse, and `residue = "radd_non_spouse"` (Fath
al-Mu'in § 34 order). Dzawil arham do not inherit under `baitul_mal` (MAIS *dhawi-al-arham*).

**Method by school** (Dakwah.id; MAIS *dhawi-al-arham*; Fiqh as-Sunnah § 856):
- *ahl al-tanzil*: each relative stands in the place of the heir through whom they connect. This is
  Ahmad's view, followed by the later Syafi'i and Maliki scholars.
- *ahl al-qarabah*: nearest class first, like the 'asabah. This is the Hanafi view.
- *ahl al-rahm*: all equal. Rejected as weak.

The engine implements **tanzil only**: `dzawilArham: "none" | "tanzil"`.

**Tanzil algorithm** (worked in Tuwaijri IV:443 with three examples, all in the vectors):

1. **Map** each relative to their *wasith*, the first heir on the line to the pewaris:
   - daughter's child → daughter;
   - full/consanguine sister's child → that sister;
   - full/consanguine brother's daughter → that brother;
   - uterine sibling's child → a uterine sibling;
   - maternal grandfather, maternal uncle (khal), maternal aunt (khala) → mother;
   - paternal aunt ('amma), father's uterine brother → father;
   - full/consanguine paternal uncle's daughter → that uncle.
2. **Solve** a virtual problem in which the wasith-heirs are the heirs. All hajb applies among them:
   in Tuwaijri ex. 1 the brother excludes the uncle, so the brother's daughter excludes the uncle's
   daughter. A spouse, if present, takes their full fardh first. The dzawil arham then share the rest
   as if it were the whole estate. (This follows the Fath al-Mu'in order, where the spouse takes no
   radd. The mechanics of "rest as the whole" are **not** in an opened Syafi'i text; see EQ11.)
3. **Pass down:** each wasith's share goes to the relative(s) connected through it.

**Supported subset.**
- Supported: one generation below each wasith, at most one relative per wasith, or several of the
  same sex.
- Several relatives of mixed sex under one wasith → `rujuk("dzawil_arham_campuran")`. The schools
  differ on whether they then split 2:1 or equally, and no opened Syafi'i source settles it.
- Any deeper chain → `rujuk("kerabat_jauh")`.

**`standar-indonesia`:**
- Grandchildren through a daughter are KHI **substitutes** (§11.1), not dzawil arham.
- Nieces (a full brother's daughters) get *wasiat wajibah* at the court's discretion (SEMA 3/2015;
  Buku II 2026 p. 847 (k); 137 K/AG/2016 per PA Bojonegoro: "Anak saudara tidak menjadi ahli waris,
  tetapi dapat diberikan wasiat wajibah"). The engine does not compute the amount and adds a note.
- Any other dzawil arham in this ruleset → `rujuk("dzawil_arham")`.
- Buku II 2013 (pp. 171, 174) had called KHI "bilateral… tidak mengenal kerabat dzawil arham", with
  aunts, nieces and so on as substitutes. That was narrowed by SEMA 3/2015 and dropped from Buku II
  2026.

---

## 11. The KHI / Pengadilan Agama layer

Principle for `standar-indonesia`: **classical Syafi'i fara'id, changed only where a KHI article, a
SEMA rumusan kamar, Buku II 2026 or a reported MA yurisprudensi changes the outcome.** Where the KHI
is silent (grandfather with siblings, musytarakah, akdariyyah, dzawil arham beyond grandchildren) the
engine keeps the classical rule or refers the user to a court. This matches standard.md's short
answer. Buku II 2026 p. 844 n. 1053 names the courts' material law as KHI Pasal 171–193.

### 11.1 Ahli waris pengganti (KHI 185): switches `substitution` and `substitutionCap`

KHI 185: "(1) Ahli waris yang meninggal lebih dahulu dari pada si pewaris maka kedudukannya dapat
digantikan oleh anaknya, kecuali mereka yang tersebut dalam Pasal 173. (2) Bagian ahli waris pengganti
tidak boleh melebihi dari bagian ahli waris yang sederajat dengan yang diganti."

| `substitution` | Who may stand in | Source | Status |
|---|---|---|---|
| `"none"` | nobody (classical) | Fath al-Mu'in § 34; Tarjih ("menurut ulama faraid… bukan ahli waris pengganti, tapi ahli waris langsung") | `klasik-syafii` |
| `"cucu"` | Children (♂ and ♀) of a **predeceased son or daughter**. Only the grandchild generation. | 2/Yur/Ag/2018 (86 K/Ag/2001, 59 K/Ag/2005, 152 K/Ag/2006, 242 K/Ag/2006): "Cucu laki-laki maupun perempuan dari anak laki-laki maupun anak perempuan dari pewaris menjadi ahli waris pengganti"; SEMA 3/2015 (Rakernas Balikpapan 2010): "waris pengganti hanya sampai dengan derajat cucu"; Buku II 2026 p. 847 (k); 57 K/AG/2016 per PA Bojonegoro | **`standar-indonesia`** |
| `"luas"` | Also descendants of predeceased siblings, uncles and aunts | Buku II 2013 pp. 171, 174; Tarjih's worked example | comparison only, superseded |

**Algorithm (`"cucu"`):**

1. For each child `c` of the pewaris with `alive = false`, `c` not barred under KHI 173, and at least
   one eligible, living child of their own: create a **slot** `anak_lk` or `anak_pr` (c's sex).
   - Barred-but-alive children have no slot: KHI 185(1) "kecuali mereka yang tersebut dalam Pasal 173".
   - A predeceased child without children → no slot.
2. Solve the whole problem with each slot counted as one child of its sex. The slots also count as
   "anak" for every rule that depends on a child: hajb nuqshan of spouse and mother, and
   `daughtersExcludeSiblings`.
3. Apply `substitutionCap` (below) to each slot.
4. Divide each slot's share among that slot's own children 2 : 1 (Buku II 2013 p. 176 §8(d):
   "Apabila ahli waris pengganti terdiri dari laki-laki dan perempuan, laki-laki mendapat bagian dua kali
   bagian perempuan").

**Grandchildren of a predeceased son** are classical heirs as well (`cucu_lk`, `cucu_pr`).

- Under `"cucu"` they are treated as substitutes, not as classical cucu. This matters when a son is
  alive: classically the living son excludes them, but as substitutes they take their father's slot.
- **Children of predeceased siblings** are not substitutes under `"cucu"`. A full brother's son still
  inherits as the classical 'asabah `keponakan_lk_kandung` (SEMA 3/2015: "anak laki-laki dari saudara
  kandung tersebut sebagai ahli waris"). His sisters may get wasiat wajibah, which a court sets
  (§11.4 c).

**`substitutionCap`** (KHI 185(2)). The readings are collected by PA Kotabumi:

| Value | Meaning | Source |
|---|---|---|
| `"none"` | A slot takes exactly what the replaced child would have taken | PA Kotabumi recommends it only **as a reform**: "seyogyanya penggantian ahli waris itu bersifat mutlak". *(Review 2026-10-09: the draft listed Tarjih here too; that was wrong, see `per_kepala`.)* |
| `"sederajat"` | A **slot** may not take more than a **living child of the pewaris** of the replaced child's degree. In practice this binds only when a **son's** slot competes with living **daughters** and no living son: the slot is re-weighted from 2 units to 1. | MA 109 K/AG/2016 as listed by PA Bojonegoro: "Bagian untuk Ahli Waris Pengganti tidak boleh melebihi atau minimal sama dengan bagian anak perempuan dari Pewaris"; PA Kotabumi, whose author concludes that this reading (Syaifuddin and the West Kalimantan judges: the grandson "tidak boleh melebihi bagian bibinya") "lebih sesuai dengan maksud bunyi pasal 185 ayat (2) KHI"; worked example 1 grandson + 8 daughters → 1/9 each |
| `"per_kepala"` *(added in review)* | Each **substitute person** may not take more than the living heir of the replaced child's degree; the slot is not re-weighted. Where the cap binds, how the excess is redistributed is not stated by any opened source → `rujuk("pengganti_batas_tak_jelas")`. | Tarjih: "bagian ahli waris yang sederajat dengan yang diganti yaitu D yang bagiannya Rp 150.000", then each substitute's rupiah is checked against D's (it does not bind in Tarjih's example) |
| `"sepertiga"` | A slot gets at most ⅓ of what the parent would have got | PA Kotabumi reports this reading; no court source | **not implemented** |

**The readings give different numbers** (vector `khi-pengganti-anakpr-cucu3-perkepala`): one daughter,
plus a son who died earlier leaving two sons and a daughter.
- `sederajat` (slot re-weighted): daughter ½; grandsons 1/5 each; granddaughter 1/10. This equals the
  classical result.
- `per_kepala` and `none`: the slot is ⅔; grandsons 4/15 each, granddaughter 2/15, all below the
  daughter's ⅓. So the daughter gets ⅓.

The KHI reviewer chooses among the three readings (R6).

The worked example, `khi-pengganti-cucu-8anakpr-kotabumi` in the vectors, gives:
- classical: the grandson is 'asabah and takes ⅓, the 8 daughters share ⅔;
- `cap: none`: the grandson takes 2/10, each daughter 1/10;
- `cap: sederajat`: the grandson and each daughter take 1/9.

**Default `substitutionCap`: `"sederajat"`**, the only reading with an MA decision behind it (as listed
by a court website). I could not open 109 K/AG/2016 itself (open question EQ4).

### 11.2 Daughters exclude siblings: switch `daughtersExcludeSiblings`

See §6.3 for the sources. Effect: with any child or slot present, siblings, nephews, uncles and
cousins are excluded. **No other relative becomes 'asabah** in their place. The children's furudh then
go through radd (§9.4), so a daughter alone takes everything (122 K/AG/1995). With a wife and two
daughters, the wife takes ⅛ and the daughters take the rest (47 K/AG/2017, as listed by PA
Bojonegoro).

### 11.3 The father with only female descendants: switch `fatherWithDaughters`

- **`"fardh_plus_asabah"`** (classical): ⅙ + residue (Fath al-Qarib § 117). Buku II 2013 p. 173 reads
  KHI 177 with SEMA 2/1994 as "Ayah mendapat 1/6 bagian bila pewaris meninggalkan anak/keturunan,
  mendapat ashabah bila pewaris tidak meninggalkan anak / keturunan". That is silent on the
  daughters-only case.
- **`"fardh_then_radd"`** (KHI 177 literal: "bila ada anak, ayah mendapat seperenam bagian", with
  "anak" including daughters): the father takes ⅙ only, and the residue is radd to the father, the
  mother and the daughters (not to the spouse). Buku II 2013 p. 176 §9(a)–(b) supports this reading:
  "anak dan/atau keturunannya memperoleh sisa, jika anak hanya terdiri dari anak perempuan… dan
  diperlukan radd atau 'aul, maka dilakukan radd atau 'aul".
- I found **no MA decision** applying either reading. Example: father + one daughter →
  `"fardh_plus_asabah"`: ½ / ½ ; `"fardh_then_radd"`: ¼ / ¾.
- **Default: `"fardh_plus_asabah"` in both rulesets until the reviewer decides (EQ1).** SEMA 2/1994
  exists to bring Pasal 177 back to the classical father's share.

KHI 177 with SEMA 2/1994 gives the father ⅓ only "bila pewaris tidak meninggalkan anak, tetapi
meninggalkan suami dan ibu". That is exactly the 'Umariyyatain result (§8.1). In every other childless
case the father is 'asabah (Buku II 2013 p. 173). So no extra switch is needed. The **unamended**
Pasal 177 reading ("father ⅓ whenever there is no child") is not offered: SEMA 2/1994 is binding
guidance on it.

### 11.4 Wasiat wajibah

Computed **before** the fara'id stage, out of `after_debts`. Voluntary wasiat and wasiat wajibah
together may not exceed ⅓ (KHI 195(2) and 209 each cap at ⅓). Wasiat wajibah takes priority over
voluntary wasiat. That priority rule comes from Egyptian law (Fiqh as-Sunnah § 865: "الوصية الواجبة
مقدمة على غيرها من الوصايا"); **no opened Indonesian source states it (EQ5).**

**a) Adopted child / adoptive parent: switch `wasiatWajibahAdopsi`** (KHI 209)

- Values: `"off"` | `"plafon"` (§12.2).
- Under `"plafon"`: `cap = min(share the person would get as a child (or parent) of the same sex,
  ⅓)`.
  - The cap is taken off `after_debts` like a wasiat, and the rest is divided by fara'id.
  - The report shows both lines, "tanpa wasiat wajibah" and "jika hakim menetapkan paling banyak …".
  - Vector: `khi-ww-anak-angkat-plafon`.
- Sources: KHI 209(1)–(2) ("sebanyak-banyaknya 1/3"); Buku II 2013 p. 173 §2(h) (ex officio, at most
  ⅓); Khairuddin pp. 135–136 ("maksimal sama dengan bagian ahli waris yang sederajat dengannya, tetapi
  tidak boleh lebih dari 1/3").
- The court sets the actual amount, so the report labels it **"paling banyak"** and shows the heirs'
  shares on that basis. MUI's 1984 adoption fatwa permits only a voluntary wasiat (standard.md §1.3).
  The choice of default belongs to standard.md §5.
- Adoption counts only by court order (KHI 171(h)). The questionnaire asks this; an informal adoption →
  `catatan("anak_angkat_tanpa_penetapan")` and no wasiat wajibah.

**b) Non-Muslim spouse, child or parent: switch `wasiatWajibahNonMuslim`**

> **Revised in review 2026-10-09.** The court-column default is now `"ma_16K2010"`, the **as-if**
> method: the non-Muslim relative receives the share they would have had as an heir, and every heir
> keeps their as-if share. Every MA decision cited computes it this way:
> - 16 K/AG/2010, amar 5: mother 10/60 = ⅙, widow 15/60, sisters 7/60, brother 14/60;
> - 51 K/Ag/1999: "bagian yang sama dengan bagian anak yang beragama Islam";
> - 331 K/Ag/2018: a widow ¼;
> - standard.md §4.1 H2: wife 150, son 700, daughter 350.
>
> The old default, `"plafon"` (take the ceiling off first, then re-divide the rest), gave the mother ⅛
> in the 16 K/AG/2010 family. That contradicts the decision it was built from. It also pushes the wife
> below her Qur'anic ⅛ in ux.md case 11 (wife 33 instead of 40 on Rp 320 jt). `"plafon"` stays for
> comparison only, and for KHI 209 adoption (a), where the wasiat wajibah is a bequest taken before
> division. The report shows the as-if result as an **illustration** ("besarnya ditetapkan hakim"),
> next to the line without wasiat wajibah. MUI 5/2005 does not use wasiat wajibah at all, so neither
> method carries MUI authority.
>
> **Refusal is per column.** When the as-if share is over ⅓ or excludes an actual heir, only the court
> column refuses. The fikih column is still shown in full (§13).

- Values: `"off"` | `"ma_16K2010"` (as-if; **default for "Perkiraan PA"** since the review) | `"plafon"` (comparison).
- Sources:
  - 1/Yur/Ag/2018 (368 K/Ag/1995, 51 K/Ag/1999, 16 K/Ag/2010, 721 K/Ag/2015, 218 K/Ag/2016,
    331 K/Ag/2018): "Wasiat Wajibah dapat diberikan… juga… kepada ahli waris yang tidak beragama islam";
  - 51 K/Ag/1999: the non-Muslim child gets "bagian yang sama dengan bagian anak yang beragama Islam";
  - 16 K/AG/2010 kaidah: "sebanyak porsi waris istri";
  - 331 K/Ag/2018: a widow ¼.
- Buku II 2013 p. 173 §2(i): "maksimal 1/3 bagian, dan tidak boleh melebihi bagian ahli waris yang
  sederajat dengannya".

```
w = share of the non-Muslim relative in a virtual solve where they are treated as a Muslim heir
if the virtual solve excludes (hajb hirman) any actual heir, or w > 1/3:
    rujuk("wasiat_wajibah_besar") for the COURT COLUMN ONLY   # 51 K/Ag/1999 vs the ⅓ cap (EQ6); fikih column still shown
elif mode == "ma_16K2010":              # default since review 2026-10-09: the as-if method of the MA decisions
    ww = w; every actual heir takes exactly their share from the virtual solve
    report both lines ("tanpa wasiat wajibah" / "contoh jika hakim menetapkan seperti putusan MA; besarnya ditetapkan hakim")
elif mode == "plafon":                  # comparison only (former default)
    cap = w; take cap off after_debts like a wasiat; divide the rest by fara'id among the actual heirs
```

16 K/AG/2010 (vector `khi-ww-istri-nonmuslim-16K2010`, key `standar-indonesia` since the review; the plafon numbers moved to `standar-indonesia|wasiatWajibahNonMuslim=plafon`)
fits `"ma_16K2010"` exactly, on pokok masalah 60:

| Who | Share |
|---|---|
| mother | 10/60 |
| non-Muslim widow (wasiat wajibah) | 15/60 |
| each of three full sisters | 7/60 |
| full brother | 14/60 |

These are the numbers of a solve with the widow as an heir: mother ⅙ (siblings ≥ 2), wife ¼, siblings
the residue 2:1. The court did this **after** giving the widow ½ of the harta bersama.

- **MUI note:** Fatwa MUI 5/2005 allows property to pass to a non-Muslim only "dalam bentuk hibah,
  wasiat dan hadiah". It does not mention wasiat wajibah (standard.md §1.1). With `"off"` the report
  still shows a note: "Kerabat non-Muslim tidak menjadi ahli waris. Mereka dapat menerima wasiat atau
  hibah, dan Pengadilan Agama dapat menetapkan wasiat wajibah."

**c) Court-discretion recipients: note only, never computed**

The engine only adds a note (`catatan`) for these, and the heirs' shares are marked "sebelum
kemungkinan wasiat wajibah":
- a full brother's daughters (SEMA 3/2015);
- other nephews and nieces (137 K/AG/2016, per PA Bojonegoro);
- stepchildren (SEMA 7/2012);
- a child of an unregistered marriage (SEMA 3/2023 via Buku II 2026);
- a child born of zina, as a *ta'zir* imposed on the biological father (MUI 11/2012).

### 11.5 Harta bersama and multiple wives

§3.2. In `standar-indonesia`, `hartaBersama = true`.

### 11.6 Perdamaian (KHI 183) / takharuj

- Heirs "dapat bersepakat melakukan perdamaian dalam pembagian harta warisan, setelah masing-masing
  menyadari bagiannya" (KHI 183). Buku II 2013 p. 172 §2(e) says the same about equal shares by
  agreement.
- Takharuj (one heir withdraws for a settlement) is permitted by mutual consent (Fiqh as-Sunnah § 864).
- The engine never computes an agreed split. The report ends with the KHI 183 sentence, so the family
  knows that a consensual arrangement is allowed **after** they know the fara'id shares.

---

## 12. Ruleset switches

### 12.1 Two outputs (aligned with standard.md §5.2)

standard.md §5.2 recommends **one engine, two outputs** computed from the same answers. The operator
decides which one is primary (standard.md Q1).

- **"Hasil fikih"** = ruleset `klasik-syafii`: classical Syafi'i fara'id, with the MUI fatwas as hard
  constraints, plus the procedural or ownership-related KHI rules (order of payments, the ⅓ wasiat cap,
  harta bersama first — subject to standard.md Q5).
- **"Perkiraan Pengadilan Agama (KHI)"** = ruleset `standar-indonesia`: the above plus KHI 185 (to cucu),
  86 K/AG/1994, KHI/MA wasiat wajibah ceilings, and KHI 193 radd.

The second column appears only when `switchesUsed` is non-empty. That list is computed by re-solving
with each switch set to its `klasik-syafii` value and listing those that change a share. The report
then says, for example: "Hasil ini berbeda dari fikih klasik karena yurisprudensi MA 86 K/AG/1994
(anak perempuan menghijab saudara)".

### 12.2 Switch table

The STANDARD column is the row letter of standard.md §4.0. Values marked † are where this document's
evidence points away from standard.md's draft, or where neither document has settled the default
(§12.3).

| Switch | Values | `klasik-syafii` ("Hasil fikih") | `standar-indonesia` ("Perkiraan PA") | Source of the non-classical value | STANDARD |
|---|---|---|---|---|---|
| `hartaBersama` | `false` \| `true` | `true` (standard.md §5.2, pending its Q5) | `true` | KHI 96(1), 190; 32 K/AG/2002; Buku II 2026 pp. 836–838 | L, M |
| `killerBarred` | `"any_killing"` \| `"final_judgment"` | `"any_killing"` | `"final_judgment"` (+ `rujuk` if there is a killing without a judgment) | KHI 173 | J |
| `substitution` | `"none"` \| `"cucu"` \| `"luas"` | `"none"` | `"cucu"` | KHI 185; SEMA 3/2015; 2/Yur/Ag/2018; 676 K/AG/2012 (courts may not ignore 185, per standard.md §3.3); Buku II 2026 (k) | A, C |
| `substitutionCap` | `"none"` \| `"sederajat"` \| `"per_kepala"` (review) | n/a | `"sederajat"` † (reviewer R6 chooses among three) | 109 K/AG/2016 (via PA Bojonegoro); PA Kotabumi; PTA Pontianak 2025 survey (via standard.md §3.3) says it is unsettled | A |
| `daughtersExcludeSiblings` | `false` \| `true` | `false` | `true` | 86 K/AG/1994; 122 K/AG/1995; 184 K/AG/1995; 19 PK/AG/2014; 47 K/AG/2017 | B |
| `uterineExcludedBy` | `"classical"` \| `"khi181"` | `"classical"` (child, son's child, father, grandfather) | `"classical"` (review 2026-10-09; was `"khi181"`, now a comparison variant: KHI 182 has the same wording and is not read literally) | KHI 181 literal; no decision found either way | D |
| `fatherWithDaughters` | `"fardh_plus_asabah"` \| `"fardh_then_radd"` | `"fardh_plus_asabah"` | `"fardh_plus_asabah"` (= standard.md row K, "classical father rules") | KHI 177 literal; Buku II 2013 §9(a) | K |
| `residue` | `"baitul_mal"` \| `"radd_non_spouse"` \| `"radd_all"` | `"radd_non_spouse"` (Fath al-Mu'in; standard.md Q6 asks the ustadz) | **† disputed:** standard.md §5.2 proposes `"radd_all"` (KHI 193 literal; 2 of 3 PA Banjarmasin judges, standard.md §3.6). This document found MA Badilag's Buku II 2013 p. 176 §8(h) "Radd tidak berlaku untuk janda dan duda", which supports `"radd_non_spouse"`. Buku II 2026 is silent, and Buku II 2013 is superseded (§6.3 note), so this default rests on a superseded guide plus Khairuddin. | KHI 193; Buku II 2013 §8(h) | E |
| `dzawilArham` | `"none"` \| `"tanzil"` | `"tanzil"` | `"none"` (grandchildren through daughters come in via `substitution`; others → `rujuk`) | Fath al-Mu'in § 34; Dakwah.id; SEMA 3/2015 | F |
| `musytarakah` | `true` \| `false` | `true` (al-Umm § 559) | `true` (KHI silent; standard.md row I) | `false` = Hanafi/Hanbali (Khairuddin p. 75) | I |
| `jadd` | `"zaid"` | `"zaid"` | `"zaid"` (KHI silent; standard.md row D) | the Abu Bakr/Hanafi view (the grandfather excludes siblings) is not offered | D |
| `wasiatWajibahAdopsi` | `"off"` \| `"plafon"` | `"off"` (MUI 1984: voluntary wasiat only) | `"plafon"` | KHI 209 | H |
| `wasiatWajibahNonMuslim` | `"off"` \| `"ma_16K2010"` \| `"plafon"` | `"off"` (MUI 5/2005) | `"ma_16K2010"` (as-if; review 2026-10-09, was `"plafon"`), shown as an illustration "besarnya ditetapkan hakim" | 1/Yur/Ag/2018; 16 K/AG/2010; 51 K/Ag/1999 | H |

**`"plafon"`** (ceiling) is used for **KHI 209 adoption only** since the review; for non-Muslim relatives it is a comparison value. It means:
- the engine computes `cap = min(as-if share, ⅓)`;
- it shows the heirs' shares **twice**: without any wasiat wajibah, and with the cap taken out;
- it says the court sets the actual amount ("paling banyak …; besarnya ditetapkan hakim").

**`"ma_16K2010"`** reproduces the 16 K/AG/2010 pattern exactly (§11.4 b). Since the review it is the
court-column default for non-Muslim relatives, shown as an illustration (standard.md Q3 asked whether
to show an as-if illustration at all; the plan's D8 now proposes yes). The `substitution = "luas"` variant and `klasik-syafii-asal` (below) are
likewise for comparison and tests only. The questionnaire never offers any of them.

A third profile, **`klasik-syafii-asal`**, is the original Syafi'i position as applied by MAIS:
`residue = "baitul_mal"`, `dzawilArham = "none"`, all else classical. It explains why a Malaysian
calculator gives a different number.

### 12.3 Points where engine.md and standard.md disagree or are both open

1. **Radd to a spouse in the PA column.**
   - standard.md: `radd_all`.
   - This document: Buku II 2013 §8(h) says no radd to the janda or duda.
   - Both documents agree the point is unsettled. The vectors carry both values (`expected` for
     `radd_non_spouse`, `alternatives` for `radd_all`), so the tests stay green whichever default the
     operator picks.
2. **Grandchild-substitution decision number.**
   - The official Himpunan Yurisprudensi 2018 (2/Yur/Ag/2018, p. 55) prints **86 K/Ag/2001**.
   - standard.md §3.3 cites **68 K/AG/2001** (from the Peradi list).
   - Use the MA's own compilation.
3. **Date of 86 K/AG/1994.** Every source agrees on the kaidah, but the date differs by source:
   - KY's annotation: 27 Juli 1994;
   - PA Bojonegoro: 20 Juli 1995;
   - standard.md: 27 Juli 1996.
   - Quote the kaidah, not the date, until the putusan itself is read.
4. **`uterineExcludedBy` in the PA column.**
   - Neither document found a decision on it.
   - KHI 181's literal text ("tanpa meninggalkan anak dan ayah") is the only basis for `"khi181"`.
   - **Resolved in review 2026-10-09:** `"classical"` in both columns until a decision is found, because
     KHI 182 uses the same words for full and consanguine sisters and the engine does not read it
     literally (it keeps Zaid's grandfather sharing). `"khi181"` remains a comparison variant.

## 13. Out of scope: "silakan berkonsultasi"

The engine returns `{ kind: "rujuk", reasons }` and computes nothing when any of these is true.
The report then says, in plain words, that the case needs a Pengadilan Agama, a KUA or an ustadz who
knows fara'id, and why.

**Per-column outcome (review 2026-10-09).** A refusal applies to the **ruleset whose rule is
uncertain**, not to the whole report. The vectors already key `rujuk` per ruleset. Concretely:
- **Both columns refuse**, and the questionnaire routes before any numbers: `khuntsa`, `mafqud`,
  `haml`, `gharqa`, a reported killing (plan D4), `beda_agama_pewaris`, `utang_melebihi_harta`,
  `kerabat_jauh`, `wala`. For `mafqud`, `haml` and `gharqa`, only when the person concerned could
  change a number (`couldAffectOutcome`, §6.1); otherwise a note.
- **Court column only:** `wasiat_wajibah_besar`, `pengganti_batas_tak_jelas`. The fikih column is shown
  in full, and the court column says "Pengadilan Agama dapat menetapkan wasiat wajibah; besarnya perlu
  dikonsultasikan".
- **Fikih column only:** `dzawil_arham` / `dzawil_arham_campuran` while the UI refuses dzawil arham in
  v1, when the court column can compute the same family under KHI 185 (e.g. a widow and the children of a
  daughter who died earlier).
- **Partial result plus soft stop** (numbers shown): `sisa_pasangan_saja` (§9.4), the grandfather with
  siblings, `harta_bersama_rumit` when only the rupiah panel is affected (the fractions do not depend on
  the pools).

| Reason id | When | Why not self-service |
|---|---|---|
| `khuntsa` | an heir's sex is undetermined | the schools give the least of two outcomes plus suspension (Fiqh as-Sunnah § 862) |
| `mafqud` | an heir is missing and their death is not established by a court | KHI 96(2) and Fiqh as-Sunnah §§ 860–861: suspend or let a court decide |
| `haml` | a possible heir is unborn (pregnant widow or relative) | a share is reserved and fixed after birth (Bulugh 1106; Fiqh as-Sunnah §§ 857–859) |
| ~~`munasakhat`~~ → note `catatan.munasakhat` (review 2026-10-09) | an heir died **after** the pewaris but before division | **Not a refusal.** The heir is entered as alive and the first stage is exact; each later estate is a fresh solve ('Hitung untuk beliau'), as Khairuddin pp. 81–85 and Buku II 2013 p. 178 §10 require (stage by stage). Vector `munasakhat-tahap-pertama` (formerly `rujuk-munasakhat`). |
| `gharqa` | pewaris and heir died together (accident, disaster) with the order unknown | no inheritance between them (Fiqh as-Sunnah § 843); needs facts a form cannot verify |
| `wala` | the pewaris was an emancipated slave | not applicable today |
| `kerabat_jauh` | a relative beyond the depth limits (§2) is present who could inherit or block: a great-grandchild through sons, a brother's grandson, the father's paternal uncle or his son, etc. | rare, and needs a human check. *(Review 2026-10-09: the questionnaire must detect them; see plan §5.7 C4b and F5. Silently dropping them sends their residue to radd.)* |
| `dzawil_arham`, `dzawil_arham_campuran` | §10 limits | schools differ |
| `dugaan_pembunuhan` | the user reports that an heir caused the death, with no final judgment | a court question (KHI 173) |
| `beda_agama_pewaris` | the pewaris was not Muslim | outside Pengadilan Agama jurisdiction (SEMA 7/2012 Kamar Agama 10) |
| `utang_melebihi_harta` | debts ≥ estate | insolvency |
| `harta_bersama_rumit` | a wife died or divorced earlier, or a pool is disputed or unvalued | §3.2 |
| `wasiat_wajibah_besar` | §11.4 (b) conditions fail | sources conflict |
| `sisa_pasangan_saja` (note, not blocking) | a spouse is the only heir, so a residue remains | EQ3 |
| `pewaris_dibawah_umur_wasiat` (note) | a wasiat was made by someone under 21 | KHI 194(1) invalidates it; the classical age is puberty |

Notes (`catatan`) do not stop the computation. Each one is one line in the report.

---

## 14. Rupiah allocation: exact, and summing to the rupiah

All money is `bigint` rupiah. The engine never shows a total that fails to add up.

1. **Fixed integer lines** come off first, exactly as entered: `biayaSakit`, `biayaJenazah`, `utang`.
2. **Rational lines.** Every other recipient gets an exact rational fraction of the remaining integer
   pot `T`:
   - each spouse's harta-bersama portion;
   - each voluntary wasiat;
   - each wasiat wajibah;
   - **each individual heir** (per head, not per group);
   - the Baitul Mal line.
   Their fractions sum to exactly 1, and the engine asserts it.
3. **Largest-remainder rounding** over all rational lines together:
   ```
   for each line i:  q_i = floor(T × n_i / d_i);   r_i = (T × n_i) mod d_i   # exact remainder, as the fraction r_i / d_i
   leftover = T − Σ q_i                            # 0 ≤ leftover < number of lines
   order lines by r_i/d_i descending (compare r_i·d_j vs r_j·d_i, no floats),
         ties by registry order of the heir id, then input order
   add Rp 1 to the first `leftover` lines
   ```
   This is the Hamilton (largest-remainder) method applied to exact fractions. Σ = `T` exactly, and no
   line moves by more than Rp 1 from its exact value.
4. **Display:** for every heir, group fraction `a/b`, per-head fraction, percent, Rp.
   - Percent = `100 × n/d` rounded half-up to 2 decimals, for display only.
   - The report prints "Pembulatan: selisih Rp k dibagikan Rp 1 kepada …" whenever `leftover > 0`.
   - It also states that **the fraction is the legal share**: the rupiah is a convenience.
   - Percentages are not re-normalised. If they sum to 99.99 or 100.01, the report shows the total line
     as "100%" from the fractions.

Worked example (vector `rupiah-largest-remainder`): `T` = Rp 100.000.000; mother ⅙, three daughters ⅔
(2/9 each), full brother ⅙ (residue).

| Line | exact | floor | +1 | Rp |
|---|---|---|---|---|
| ibu | 16.666.666,67 | 16.666.666 | +1 | 16.666.667 |
| anak_pr #1–#3 | 22.222.222,22 each | 22.222.222 | — | 22.222.222 each |
| sdr_lk_kandung | 16.666.666,67 | 16.666.666 | +1 | 16.666.667 |
| **Σ** | | 99.999.998 | 2 | **100.000.000** |

(The tie between `ibu` and `sdr_lk_kandung`, both at .67, does not matter here because both get the
extra rupiah.)

Rupiah for harta bersama (§3.2) uses the same method within each pool. An odd pool of Rp 1.000.001
splits Rp 500.001 to the spouse and Rp 500.000 to the estate, the spouse first by registry order.
That tie-break is arbitrary but deterministic, and the report states it.

---

## 15. Rule ids (the trace vocabulary)

Every `TraceStep.rule` is one of these. Architecture §3.2 needs one reviewed `RuleNote` per id, with a
plain sentence, dalil and sources. Ids are stable strings, and new ones are only ever added.

| Group | Ids |
|---|---|
| Estate (§3) | `estate.harta_bersama`, `estate.harta_bersama_poligami`, `estate.biaya`, `estate.utang`, `estate.wasiat`, `estate.wasiat_dibatasi_sepertiga`, `estate.wasiat_ahli_waris_tanpa_persetujuan`, `estate.wasiat_wajibah` |
| Mawani' (§4) | `mani.beda_agama`, `mani.pembunuh`, `mani.anak_luar_nikah`, `mani.anak_angkat`, `mani.anak_tiri` |
| Furudh (§5.2) | `fardh.suami_1_2`, `fardh.suami_1_4`, `fardh.istri_1_4`, `fardh.istri_1_8`, `fardh.anak_pr_1_2`, `fardh.anak_pr_2_3`, `fardh.cucu_pr_1_2`, `fardh.cucu_pr_2_3`, `fardh.cucu_pr_1_6_takmilah`, `fardh.ayah_1_6`, `fardh.kakek_1_6`, `fardh.ibu_1_3`, `fardh.ibu_1_6`, `fardh.nenek_1_6`, `fardh.sdr_pr_1_2`, `fardh.sdr_pr_2_3`, `fardh.sdr_pr_seayah_1_6_takmilah`, `fardh.seibu_1_6`, `fardh.seibu_1_3` |
| Hajb (§6) | `hajb.hirman` (facts: `heir`, `by`), `hajb.istighraq`, `nuqshan.suami`, `nuqshan.istri`, `nuqshan.ibu`, `nuqshan.ayah` |
| 'Asabah (§7) | `asabah.bin_nafs`, `asabah.bil_ghair`, `asabah.maal_ghair`, `asabah.ayah_fardh_dan_sisa` |
| Special (§8) | `umariyyatain`, `musytarakah`, `akdariyyah`, `jadd.muqasamah`, `jadd.sepertiga`, `jadd.sepertiga_sisa`, `jadd.seperenam`, `jadd.muaddah`, `jadd.sdr_pr_kandung_sampai_fardh` |
| Adjust (§9–10) | `aul`, `radd.tanpa_pasangan`, `radd.semua`, `baitul_mal`, `dzawil_arham.tanzil`, `tashih`, `ikhtisar` |
| KHI (§11) | `khi.pengganti`, `khi.pengganti_batas`, `khi.anak_menghijab_saudara`, `khi.seibu_pasal_181`, `khi.ww_anak_angkat`, `khi.ww_non_muslim`, `khi.perdamaian` |
| Money (§14) | `rupiah.pembulatan` |
| Refusals and notes (§13) | `rujuk.<reason>`, `catatan.<reason>` |

---

## 16. Test vectors (`test-vectors.json`)

### 16.1 Shape

The file is one JSON object: `schema`, `status`, `conventions`, `summary`, `knownSourceErrors` and
`vectors[]`. Each vector has:

- `id`, `title`, `topics[]`;
- `input`: `deceasedSex`, `heirs` (counts of living, Muslim, unbarred heirs by id),
  `predeceasedChildren[]` (KHI slots), `nonMuslim`, `barred`, `dzawilArham`, `estate`, `outOfScope`,
  and free-text `assumptions` where a source left a detail open;
- `expected`: keyed by ruleset (`klasik-syafii`, `standar-indonesia`, `klasik-syafii-asal`) or by a
  one-switch variant `"<ruleset>|<switch>=<value>"`. Each block holds:
  - `shares` (group fractions as `"a/b"`, summing to 1 with `baitul_mal` and wasiat lines), and where
    relevant `perHead`, `blocked`, `adjustments`, `base`/`finalBase` (only where the source prints the
    table) and `rupiah`;
  - `status` (`sourced` | `rule` | `computed`) and `sourceRefs`;
  - or instead `{ rujuk: [...] }`;
- `sources[]`: each with `ref`, `url` or corpus locator, `page`, and a short verbatim `quote`;
- `alternatives[]`: other scholarly or legal readings with their numbers, not tested unless the engine
  implements that switch value;
- *(review 2026-10-09)* `addedInReview` on vectors added by the review, `formerId` on a renamed vector,
  and a top-level `reviewLog` listing every correction with its reason and source. The new special share
  key `sisa_dirujuk` is a residue the tool does not assign.

Architecture §5.6 expects `solve(input, RULESETS[vector.ruleset])` to deep-equal `expected`. With this
shape the vitest loop iterates `Object.entries(vector.expected)`, parses an optional `|switch=value`,
applies any `input_override`, skips variants the engine does not implement (`substitution=luas`), and
compares `shares`, `blocked`, `adjustments` and, when present, `rupiah`. `perHead` and `base` are
compared when present.

### 16.2 Counts (2026-10-09)

- **87 vectors** and 183 expectations *(after the 2026-10-09 review; the draft had 80 and 164 with
  95 / 50 / 19)*:
  - **74 `sourced`**: the source prints the numbers **for that ruleset**;
  - **84 `rule`**: the source states the rule, and the numbers follow without a judgment call;
  - **25 `computed`**: derived by applying this spec. The reviewer must confirm these; most are the KHI
    column of a classical case.
- The review moved 21 court-column expectations from `sourced` to `rule` or `computed`. 16 were the
  grandfather, Akdariyyah and musytarakah vectors, where the KHI is silent; 4 were radd-with-spouse
  vectors, which rest on D7's default; and 1 was `fq-anakpr-ayah`, which is open under EQ1. Their only
  sources print the classical numbers, not a court's. It also added 7 vectors and corrected 6
  (`reviewLog`).
- **54 vectors** have at least one `sourced` expectation. That is above the 45 the task asked for.

**Pre-check.** Every expectation that a pure fara'id solver can compute was checked against an
independent Python `fractions` implementation of §§5–11, written for this research and not shipped.
That covers all of them except the estate-level wasiat, harta-bersama and rupiah cases, which were
hand-checked. **0 mismatches.** The pre-check found and fixed two errors in my own first draft
(counting consanguine siblings in mu'addah; one float leak). It also confirmed five errors in
Khairuddin that are recorded in `knownSourceErrors`, so that nobody "fixes" the engine to match a
misprint.

### 16.3 Coverage of what the task asked for

| Topic | Vector ids (prefix) |
|---|---|
| fardh only | `umariyyatain-*`, `aul-*`, `radd-*` |
| 'asabah 2:1 | `kh-kasus2-*`, `fq-1anaklk-10anakpr`, `hajb-2anakpr-cucu-mubarak`, `hajb-2sdrpr-seayah-dengan-saudaranya` |
| every hajb rule of §6.1 | `hajb-*` (12), plus `kh-kasus1-*`, `kh-kasus3-*`, `bukhari-6742-*` |
| 'aul 6→7, 8, 9, 10; 12→13, 15, 17; 24→27 | `aul-6-7-*`, `aul-6-8-*` (3), `aul-6-9-*`, `aul-6-10-*`, `aul-12-13-*`, `aul-12-15-*` (2), `aul-12-17-*`, `aul-24-27-minbariyyah` |
| radd with and without a spouse; Baitul Mal | `radd-*` (7), `khi-122K1995-*`, `asal-baitulmal-*` (3) |
| 'Umariyyatain, both forms | `umariyyatain-suami`, `umariyyatain-istri` |
| Musytarakah | `musytarakah-*` (4: al-Umm, MAIS, Khairuddin ×2) |
| Akdariyyah | `jadd-akdariyyah` |
| Grandfather + siblings | `jadd-*` (14, incl. mu'addah, 'Asyriyah, 'Isyriniyah, Mukhtasharah, Tis'iniyah, Kharqa', the ⅙ floor) |
| Dzawil arham | `da-tanzil-*` (4) |
| KHI ahli waris pengganti | `khi-pengganti-cucu-8anakpr-kotabumi`, `khi-pengganti-luas-tarjih`, and the KHI column of `kh-kasus1-*`, `bukhari-6742-*`, `hajb-anaklk-cucu`, `hajb-2anakpr-cucupr-paman` |
| KHI daughters exclude siblings | `khi-122K1995-*`, KHI column of `kh-kasus3-*`, `saad-bin-rabi-*`, `hajb-sdrpr-maalghair-*`, `hajb-anakpr-hijab-sdrseibu`, `rupiah-largest-remainder` |
| Harta bersama | `khi-harta-bersama-istri-anak`, `khi-harta-bersama-poligami`, `khi-ww-istri-nonmuslim-16K2010` |
| Wasiat wajibah | `khi-ww-istri-nonmuslim-16K2010`, `khi-ww-anak-angkat-plafon`, `khi-ww-anak-nonmuslim-besar` |
| Multiple wives | `rule-3istri-anaklk`, `khi-harta-bersama-poligami` |
| Wasiat ⅓ and estate order | `wasiat-melebihi-sepertiga`, `urutan-tajhiz-utang-wasiat` |
| Rupiah rounding | `rupiah-largest-remainder`, `khi-pengganti-luas-tarjih`, `urutan-tajhiz-utang-wasiat`, `khi-harta-bersama-istri-anak` |
| Out of scope | `rujuk-haml`, `rujuk-mafqud`, `khi-ww-anak-nonmuslim-besar` (court column only), `da-tanzil-tuwaijri-2` (KHI column) |
| Munasakhat, first stage (review) | `munasakhat-tahap-pertama` |
| Skip-rule regressions (review) | `hajb-nuqshan-ibu-oleh-sdr-seayah-terhijab`, `jadd-ibu-kakek-sdrlk-sdrseibu`, `jadd-ibu-kakek-2seibu`, `jadd-akdariyyah-batal-seibu`, `jadd-muaddah` |
| 'Umariyyatain with the grandfather (review) | `umariyyatain-kakek-suami`, `umariyyatain-kakek-istri` |

### 16.4 Where sources disagree (recorded, not hidden)

- **'Umariyyatain:** 'Umar vs Ibn 'Abbas vs Ibn Sirin / Abu Tsaur.
- **Akdariyyah and Kharqa':** Zaid vs Abu Bakr vs 'Umar / Ibn Mas'ud vs 'Utsman.
- **Musytarakah:** Syafi'i/Maliki vs Hanafi/Hanbali.
- **Mubahalah:** jumhur vs Ibn 'Abbas.
- **Radd:** to non-spouses vs to all.
- **KHI 185(2) cap:** `none` vs `sederajat` vs `per_kepala` (`khi-pengganti-anakpr-cucu3-perkepala`).
- **Father with daughters:** `fardh_plus_asabah` vs `fardh_then_radd`.

All of these are in `alternatives[]` or in a variant key.

---

## 17. Open questions

The EQ ids are this document's. standard.md has its own Q1–Q9 for the operator and the ustadz;
where they overlap, both are named.

| Id | Question | Who decides | What the engine does meanwhile |
|---|---|---|---|
| EQ1 | Under KHI, does the father with **only daughters** take ⅙ + residue (classical), or ⅙ then radd (KHI 177 literal; Buku II 2013 §9(a))? No MA decision found. | ustadz + operator (standard.md Q8) | classical in both outputs |
| EQ2 | Does a child exclude **grandparents** under 86 K/AG/1994's literal wording ("kecuali orang tua, suami dan isteri")? Buku II 2013 §5 does not list them. | reviewer | grandparents kept |
| EQ3 | A spouse is the only heir: what does an Indonesian court do with the residue (Baitul Mal/BAZNAS, or radd to the spouse as in Egyptian law)? | reviewer; standard.md Q6 | `sisa_dirujuk` + note in both columns (review 2026-10-09); Baitul Mal only in `klasik-syafii-asal` |
| EQ4 | Read MA 109 K/AG/2016 itself. Is the 185(2) cap applied by re-weighting the son's slot to a daughter's weight (`sederajat`), per substitute person (`per_kepala`, as Tarjih checks), or not at all (`none`)? The PTA Pontianak 2025 survey (standard.md §3.3) says practice varies. | researcher (needs JDIH access) + KHI reviewer | `sederajat` by re-weighting |
| EQ5 | Wasiat wajibah priority over voluntary wasiat, and the combined ⅓ cap. Only the Egyptian-law analogy (Fiqh as-Sunnah § 865) was found. | reviewer | combined cap, WW first |
| EQ6 | A non-Muslim child's wasiat wajibah when the as-if share exceeds ⅓: 51 K/Ag/1999 ("sama dengan anak") vs the ⅓ ceiling (Buku II 2013 §2(i); Wahyudi 2021 via standard.md §3.4). | reviewer | `rujuk` |
| EQ7 | Several bequests over ⅓ without consent: reduced pro rata? Usual, but not found in an opened source. | reviewer | pro rata |
| EQ8 | KHI 211 hibah set-off ("dapat diperhitungkan"): show only, or offer to compute? | operator (standard.md row O) | show only |
| EQ9 | A child of a valid but unregistered nikah: fiqh says heir; SEMA 3/2023 says the court may give wasiat wajibah. | reviewer + operator (standard.md row P) | heir + note |
| EQ10 | 'Umariyyatain with the **grandfather** instead of the father: the mother takes ⅓ of the whole. **Source found in review:** al-Hawi al-Kabir 8:121, quoting al-Shafi'i. Pin it, then the reviewer confirms. | researcher → reviewer R17 | ⅓ of the whole (vectors `umariyyatain-kakek-*`) |
| EQ11 | Dzawil arham with a spouse, and several mixed-sex relatives under one wasith: the exact Syafi'i muta'akhkhirin procedure (only Hanbali examples were opened). | ustadz | supported subset + `rujuk` |
| EQ12 | PA column: radd to a spouse (`radd_all`, standard.md) or not (`radd_non_spouse`, Buku II 2013 §8(h))? | operator + reviewer | `radd_non_spouse` proposed; both in vectors |
| EQ13 | PA column: may the grandfather exclude uterine siblings (KHI 181 literal says only a child or the father)? | reviewer | `classical` in both columns since the review (KHI 182 parity); `khi181` kept as a variant |
| EQ14 *(review)* | Siblings blocked by someone **other than the father** (by the grandfather, or by a full brother) still lower the mother to ⅙? The engine's S says yes: Fath al-Qarib § 117 "ولا فرق بين الأشقاء وغيرهم"; Ibn Kathir 4:11 covers siblings of every line blocked by the father. | fara'id reviewer (plan R21) | yes |

**Verification still owed before launch** (in addition to standard.md §5.4):

- **KHI.** Read KHI Buku II from JDIH Kemenag/Badilag; I used a blog reproduction, cross-checked by
  standard.md.
- **SEMA 2/1994.** Read the original text.
- **Decisions to read in full:** 86 K/AG/1994 (date conflict), 109 K/AG/2016 and 47 K/AG/2017. I only
  have their kaidah as listed on a court website.
- **Buku II 2013.** Confirm whether it still binds anywhere. Buku II 2026 superseded it, and I used a
  transcription hosted by PA Rumbia.
- **Fath al-Mu'in and Fath al-Qarib.** The corpus gives section ids, not printed page numbers. Add
  edition and page numbers before the citations appear in the product.
- **Akdariyyah.** One source is a blog (Achmad Yani). Khairuddin's method gives the same 27, but a kitab
  page (e.g. Rahbiyyah or *al-Mu'tamad*) would be stronger.
