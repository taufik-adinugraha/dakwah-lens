# Ilmu Waris track: plan for approval

Status: **plan, for the operator to approve.** Written 2026-10-09 from the five research reports in
`docs/waris-research/`. Nothing here is built. Nothing has been reviewed by an ustadz.
**Revised the same day after a two-critic review (fiqh, completeness).** Every change is listed in the
Review log at the end. The biggest changes: the questionnaire's skip rule (§5.1), the court column's
wasiat-wajibah method (D8), the L6 ladder (§3), and new operator decisions D13–D18.
*AI-assisted, not an authoritative fatwa.*

Research files cited below by name and section:

| File | Researcher | What it holds |
|---|---|---|
| [`standard.md`](./waris-research/standard.md) | STANDARD | What MUI, the KHI and the Mahkamah Agung say; the 16-row divergence table (§4); the "MUI standard" recommendation (§5) |
| [`dalil.md`](./waris-research/dalil.md) + [`dalil.json`](./waris-research/dalil.json) | DALIL | 228 byte-verified records (13 ayat, 46 hadith, 26 fiqh, 19 tafsir excerpts, 82 section pointers, 41 rules); the rule → strongest-dalil table (§6); gaps (§7) |
| [`engine.md`](./waris-research/engine.md) + [`test-vectors.json`](./waris-research/test-vectors.json) | ENGINE | The calculation spec, ruleset switches (§12), refusals (§13), rupiah rounding (§14); 80 test vectors |
| [`ux.md`](./waris-research/ux.md) | UX | 9 lessons (§2), 12 case studies (§3), the adaptive questionnaire (§4), the report (§5), tool survey (§6), animation rules (§7) |
| [`architecture.md`](./waris-research/architecture.md) | ARCHITECTURE | Routes, content schema, dalil pipeline, engine layout, privacy, CI, milestones |

---

## 1. Summary

1. **What it is.** A new Belajar track, **"Ilmu Waris (Faraidh)"**, at `/belajar/{locale}/waris`. It has 9 short picture-led lessons (with a 4-lesson "Jalur singkat"), 15 worked family cases plus one optional hadith case, and **"Hitung waris keluarga saya"**: a questionnaire whose next question depends on the previous answers, and which ends in a printable report titled **"Perkiraan Pembagian Waris"**.
2. **The method.** MUI has **no** fara'id calculation method, only six decisions on single edge cases (`standard.md` §1). So the tool computes classical Syafi'i fara'id within the limits those MUI fatwas set. Where a Pengadilan Agama would decide differently (KHI plus MA practice), it shows that as a second column, and only for the families where the results differ. "Selaras fatwa MUI" describes the fikih column only; the court column is labelled as KHI and court practice (D1, D16).
3. **The dalil.** Every Islamic rule a learner sees links to a byte-verified corpus record in `dalil.json`. Every Indonesian legal rule (KHI, SEMA, MA decisions, MUI fatwas) links to a pinned official text. Rules the corpus cannot ground are listed as gaps (§8) and are never filled from memory.
4. **Privacy and cost.** Everything is computed in the browser, and the answers never reach our server. No LLM runs when someone uses the tool, so the running cost per report is zero.
5. **What happens next.** The engine and its tests can start now, in new files only. The critical path is naming a fara'id reviewer, because no lesson, case or report line can leave "draft" without one. **Until that reviewer signs, the calculator and report should not be reachable in production (D13).**

---

## 2. Decisions needed from the operator

> **Decisions taken (operator, 2026-10-09).**
> - **D2 → A:** the fikih column ("Menurut fikih mazhab Syafi'i") leads; the court column ("Menurut KHI dan praktik Pengadilan Agama") sits directly beside it wherever the amounts differ.
> - **D13 → No:** `/waris/hitung` and `/waris/laporan` stay unbuilt or flagged off in production until the fara'id reviewer has signed every RuleNote. Lessons and cases may ship as drafts.
> - **D12 → M1 starts now** on branch `feat/belajar-waris-m1` (engine, 87+ vectors in CI, dalil pipeline, RuleNote drafts). No deploy; any merge to `main` waits for the operator.
> - **D1, D4–D11, D15–D18:** the recommendations below are adopted as written (the operator raised no objection).
> - **Update (operator, 2026-10-09, later the same day): there is no human review.** "No review by human, we just output recommendation." Therefore:
>   - **D3, D14 dropped** — no reviewers, no honorarium. Reviewer-hour estimates in §10 no longer apply.
>   - **D13 superseded** — the calculator and report ship in M2 as a *recommendation* (noindex beta like the rest of the module). There is no sign-off gate.
>   - **D16 amended** — report title **"Rekomendasi Pembagian Waris"**; subtitle states it is AI-assisted, not a fatwa and not a court decision, names *Penetapan Ahli Waris* at the Pengadilan Agama as the legal route, and notes that heirs may agree another division by musyawarah (KHI Pasal 183).
>   - **What replaces sign-off:** deterministic engine with exact fractions; sourced vectors + invariants in CI on every push; dalil only byte-copied from the corpus; independent AI fiqh recomputation (Claude, never Gemini) for computed vectors and rule notes. Honest flags stay on the report: the court column where amounts differ, "Perlu konfirmasi" on disputed cases (e.g. grandfather with siblings), and "silakan berkonsultasi" refusals.
>   - Content `status: "draft"` fields remain as pipeline state; the UI must not promise a future ustadz review that will not happen.


Each decision lists the options, a recommendation, and what it changes in numbers. Money examples use
the research files' own worked figures. "Blocks" says which milestone (§10) waits on it.

### 2.0 At a glance

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | What "aligned to MUI standard" means, and the wording | "Faraidh — selaras fatwa MUI, dengan catatan KHI". Never "standar MUI". "Selaras fatwa MUI" describes the fikih column only. Six MUI items, including the 1984 land recommendation. | M2 copy |
| D2 | Which result leads the report (default engine mode) | **Fikih** first. The court column appears only where the numbers differ. Weigh MUI's own Q&A answer, which used substitution (2.2), before choosing. | M2 |
| D3 | Who reviews the fiqh content | Two named reviewers: one for fara'id fiqh, one who knows the KHI and the Pengadilan Agama | Gate; drafting can start |
| D4 | Which cases the tool refuses ("silakan berkonsultasi") | The narrow v1 list in 2.4. Refusals are **per column**. Missing or unborn relatives are refused only if they could change a number. New exits for no heirs at all and for relatives beyond the depth limit. | M1 (engine flags), M2 |
| D5 | Whether amounts in Rupiah are shown | Yes, in an optional panel inside the report; rounding by largest remainder | M2 |
| D6 | Harta bersama (gono-gini) split by default | Yes, as a visible step in both results, with a "semua milik almarhum" toggle, subject to the reviewer | M1 default, M2 |
| D7 | Radd to a spouse; a spouse as the only heir | No radd to a spouse in either column, with a note. Spouse-only estates get a partial result plus "konsultasikan" **in both columns**. This default rests on the superseded Buku II 2013 plus Khairuddin, so the KHI reviewer confirms it. | M1, M2 |
| D8 | Wasiat wajibah (adopted / non-Muslim relatives) | Adopted child: a ceiling ("paling banyak ⅓"). Non-Muslim relative: the MA decisions' **as-if** illustration ("besarnya ditetapkan hakim"). Neither is a promised amount. | M2 |
| D9 | Share link and saving on the device | Opt-in link in the URL fragment, amounts left out by default; no analytics | M2 |
| D10 | Dalil display rules (Bulugh and Muslim numbers, killer hadith, translation) | The rules in 2.10. Unreviewed Indonesian renderings of Bukhari, Bulugh and kitab spans stay hidden (Arabic + citation only) until signed. | M1 |
| D11 | Language of the questionnaire and report | Indonesian only in v1 | M2 |
| D12 | Branch, commit and deploy sequencing | Start M1 on its own branch; every merge to `main` waits for your go | M1 |
| D13 | May the calculator and report be live (noindex beta) before the fara'id reviewer signs? | **No.** `/waris/hitung` and `/waris/laporan` stay unbuilt or flagged off in prod until every RuleNote is signed. Lessons and cases may ship as drafts. | M2 deploy |
| D14 | Reviewer honorarium cap (IDR) | You set it. 21–33 hours across two reviewers is new spend outside the LLM cap. No figure was researched. | Gate |
| D15 | What "Tidak tahu" does | Allowed only where the table in §5.7 says so. When it could add or remove an heir, show both outcomes or "konsultasikan", never one "likely" number. | M2 |
| D16 | Report title and column labels | "Perkiraan Pembagian Waris"; columns "Menurut fikih mazhab Syafi'i" and "Menurut KHI dan praktik Pengadilan Agama" | M2 copy |
| D17 | "Banyak visualisasi dan animasi, sedikit teori" | Confirm that one animated stage per lesson, advanced a tap at a time, is what you meant. Add a 4-lesson "Jalur singkat" and acceptance floors for animation and simplicity (§3, M3). Narration is a later, priced option. | M3 |
| D18 | Blended and polygamous families, siri spouses | v1: children of an earlier marriage are counted (help text); an earlier wife who died or divorced → `harta_bersama_rumit` (fractions still shown, rupiah panel refused); a siri spouse is an heir in the fikih column, with an itsbat note for the court column (R9b) | M2 |

### 2.1 D1. What "aligned to MUI standard" means

**The finding (the STANDARD, ENGINE, UX and ARCHITECTURE reports agree).** MUI pusat has never published a fara'id method: no share table, no 'aul or radd procedure, no position on the grandfather with siblings (`standard.md` §1.6). It has six decisions that each settle one edge case. The draft listed five; the review added the 1984 land recommendation:

| MUI decision | What it settles | Source |
|---|---|---|
| Fatwa No. 5/MUNAS VII/MUI/9/2005, *Kewarisan Beda Agama* | Muslims and non-Muslims do not inherit from each other; property may pass between them only as hibah, wasiat or hadiah. The text never says "wasiat wajibah". | `standard.md` §1.1; https://fatwamui.com/storage/305/39.-Kewarisan-Beda-Agama.pdf (Himpunan Fatwa MUI pp. 478–480) |
| Fatwa No. 11 Tahun 2012, *Anak Hasil Zina* | Such a child inherits only from the mother's side. A wasiat wajibah from the biological father is a *ta'zir* that only the state can impose. | `standard.md` §1.2 (reproduction only; official PDF not reached) |
| Fatwa Rakernas 1984, *Adopsi* | Adoption must not cut the child's nasab. It is silent on inheritance; its supporting quotation says the adoptive father "boleh mewasiatkan". | `standard.md` §1.3; https://mui-jateng.or.id/wp-content/uploads/2018/03/09.-Adopsi-pengangkatan-anak.pdf |
| Ijtima' Ulama V 2015, Komisi B-2 | Which pension and severance money is estate (tirkah) and which is not | `standard.md` §1.4 |
| DSN-MUI, late 2025 | The deceased's own sharia life-insurance payout is estate | `standard.md` §1.5 (reported in MUI news; **fatwa number not found**) |
| Rakernas MUI, 7 Maret 1984 / 4 Jumadil Akhir 1404 H, *Pendayagunaan Tanah Warisan* (Komisi Fatwa, Prof. KH. Ibrahim Hosen) | A recommendation, not a division rule: keep small inherited land whole and use it jointly; failing that, an heir who can afford it buys the others out ("dibayar oleh salah seorang ahli waris yang mampu"); failing that, sell first to the neighbouring landowners, then to Muslims of the same village | `standard.md` §1.6 (added in review); Himpunan Fatwa MUI no. 10, pp. 309–310; https://mui.or.id/baca/fatwa/pendayagunaan-tanah-warisan ; PDF https://mirror.mui.or.id/wp-content/uploads/files/fatwa/10.-Pendayagunaan-Tanah-Warisan.pdf (sha256 `0d1fa98c…3559`) |

The 2005 fatwa lists the KHI only under "Memperhatikan" (and misprints the year as 1990). No document was found in which MUI adopts the KHI as its method (`standard.md` §1.6). A page saying "dihitung sesuai standar MUI" would therefore claim an endorsement that does not exist, which breaks the no-overclaiming rule.

| Option | What users read | Consequence |
|---|---|---|
| **A (recommended)** | Label: **"Faraidh — selaras fatwa MUI, dengan catatan KHI"**. Long form (`standard.md` §5.1, extended in review): "Perhitungan mengikuti faraidh berdasarkan Al-Qur'an dan Sunnah menurut mazhab Syafi'i yang dipelajari di Indonesia, menaati fatwa MUI yang terkait (No. 5/MUNAS VII/MUI/9/2005, No. 11 Tahun 2012, fatwa Adopsi 1984, rekomendasi Pendayagunaan Tanah Warisan 1984, Ijtima' Ulama V 2015), dan menunjukkan bagaimana Kompilasi Hukum Islam dan Pengadilan Agama menghitungnya bila hasilnya berbeda." **Scope (review):** the label and long form describe the **fikih column**. The court column is labelled "Menurut KHI dan praktik Pengadilan Agama" and never "selaras fatwa MUI", because it applies wasiat wajibah to non-Muslim relatives, while MUI 5/2005 allows only voluntary hibah, wasiat and hadiah. | Every claim is true. It names the five MUI items the tool obeys or cites. |
| B | "Sesuai standar MUI" | Claims an MUI method that does not exist. Not recommended. |
| C | "Standar Indonesia (KHI + Mahkamah Agung)" | True, but it drops MUI. Two KHI/MA results also contradict sahih hadith in our corpus (D2). |

**Recommendation: A.** The DSN-MUI insurance fatwa is left out of the wording until its number is found (`standard.md` Q4).

### 2.2 D2. Default engine mode: which result leads the report

The engine always computes two results from the same answers (`engine.md` §12.1):

- **"Menurut fikih mazhab Syafi'i"** (ruleset `klasik-syafii`; called "Hasil fikih" in the research files): classical Syafi'i fara'id, with the MUI fatwas as hard limits, plus the KHI rules that only concern procedure or ownership. Those are the payment order (Pasal 175), the ⅓ cap on a wasiat and the consent rule for a wasiat to an heir (195), and harta bersama first (96; see D6).
- **"Menurut KHI dan praktik Pengadilan Agama"** (ruleset `standar-indonesia`; "Perkiraan PA" in the research files): the same, plus KHI 185 substitution (grandchildren only, SEMA 3/2015), the rule that any child blocks the siblings (yurisprudensi 86 K/AG/1994), the KHI 209 ceiling for an adopted child, and the MA's as-if illustration for non-Muslim relatives (D8). Column labels are decision D16.

**How often the two differ.**
- **Common families:** in 1 of the 5 common families counted in `ux.md` §4.8 (this count was made for this plan). That family is a wife who dies leaving her husband, one daughter, her mother and one full brother.
  - Fikih: suami ¼, anak perempuan ½, ibu ⅙, saudara laki-laki 1/12.
  - Pengadilan Agama: suami ¼, anak perempuan 9/16, ibu 3/16, saudara 0.
- **Test vectors:** in 19 of the 84 vectors that carry both results, the amounts differ (after the review; the draft counted 20 of 77). The vectors are deliberately weighted towards edge cases.

**The biggest swings, on a Rp 1.200 juta net estate** (`standard.md` §4.1):

| Family | Menurut fikih | Menurut KHI / Pengadilan Agama |
|---|---|---|
| Wife, one daughter, one full brother (row B) | wife 150, daughter 600, brother 450 | wife 150, daughter 1.050, brother 0 |
| Wife, son, daughter, plus a son and a daughter of a son who died first (row A) | grandchildren 0 | grandchildren 280 + 140 |
| One daughter, a son's daughter (son died first), a full sister (row C) | 600 / 200 / 400 | 600 / 600 / 0 with the engine's default cap (vector `bukhari-6742-anakpr-cucupr-sdrpr`); 400 / 800 / 0 without the cap (`standard.md` §4.1) |

| Option | Consequence |
|---|---|
| **A (recommended): fikih first; the court column only where it differs** | Matches what the MUI fatwas actually say and what the lesson dalil show. It avoids presenting as "the Islamic share" two results that sahih hadith in our corpus contradict. Row B contradicts **Bukhari 6732** ("فما بقي فهو لأولى رجل ذكر": the residue goes to the nearest male, here the brother). Row C contradicts **Bukhari 6736** (Ibn Mas'ud reporting the Prophet ﷺ's ruling). *(Corrected in review: the draft cited 6734 and 6736 for row B. Both concern a sister, and 6734 is Mu'adh's own ruling, an atsar. It supports case 8, not row B.)* The court column still appears wherever real money would differ, so the court result is never hidden. |
| B: Court estimate first; fikih where it differs | Closest to what a *Penetapan Ahli Waris* will say. It is also how MUI's own Q&A answered a family of this shape (below). But the headline number would contradict Bukhari 6732 / 6736 for every daughters-and-siblings family. `architecture.md` §5.3 and §7.2 sketched this default ("standar-indonesia (default)", header "Mengikuti: Standar Indonesia"); those sketches change if you pick A. |
| C: The user picks a method at the start | A wall of jargon for seniors (`ux.md` §0 item 2). Not recommended. |
| D: One result only | Hides a difference that decides real money. Not recommended. |

**Weigh this before choosing (added in review).** MUI's public Q&A page has an answer by Kyai Nurul Irfan, dated Selasa 31 Oktober 2023 (https://mui.or.id/baca/pertanyaan/a68d369c-7338-4656-a556-53b69c0a5553).
- **The family:** 2 living sons, 2 living daughters, and a daughter who died earlier leaving 2 daughters. This is the shape of case 9.
- **The answer:** the estate is divided into 7 parts, and the predeceased daughter is "digantikna oleh dua anak perempuan almh". Equal shares are also allowed by agreement under "pasal 183 KOMPILASI HUKUM ISLAM".
- **What that means:** this is the court column's method. Under option A, the fikih column gives these granddaughters 0.
- **Its weight:** it is one scholar's answer on MUI's site, not a fatwa, and other MUI Q&A answers on waris have not been surveyed (`standard.md` §1.6). It does not make substitution an MUI method. It does show that MUI's own public guidance does not always lead with classical fara'id.

If you choose A, the report for such a family must put the court column directly beside the fikih column, not lower down.

**Recommendation: A, with that caveat.** The report's first line names the result that leads. When the two agree it says so in one sentence: "Untuk keluarga ini, fikih dan KHI menghasilkan pembagian yang sama" (`ux.md` §5.1). Learners cannot toggle individual switches in v1 (`architecture.md` Q2).

### 2.3 D3. Who reviews the fiqh content

Plan decision B6 (`docs/belajar-plan.md`) names reviewers for nahwu-sharaf, for tajwid/qira'at, and a hadith check. **It names no fiqh mawaris reviewer** (`architecture.md` §3.5, Q1). Every waris record starts as `draft`, and a public build refuses drafts.

| Option | Consequence |
|---|---|
| **A (recommended): two named reviewers.** (1) An ustadz competent in Syafi'i fara'id, who signs the rules, lessons, dalil spans and case answers. (2) Someone fluent in the KHI and Pengadilan Agama practice, such as a PA judge or a family-law academic, who signs the court column ("Menurut KHI dan praktik Pengadilan Agama"), the KHI quotes and the report's next steps. | Covers both halves of the report. The closest competitor, Mawaris, separates its two scholar reviewers from the developer (`ux.md` §6). |
| B: one fara'id ustadz only | Faster, but nobody qualified signs the court column. That column would have to stay draft or be removed. |
| C: no reviewer; ship as a draft beta | Every page carries "menunggu tinjauan ustadz" indefinitely, and the hub card and any promotion stay blocked (`architecture.md` §10). |

**Reviewer workload** (estimates in `architecture.md` §12): M1 6–10 h, M2 4–6 h, M3 8–12 h, M4 3–5 h, so **21–33 hours** in total. On top of that come about 20 discrete rulings, listed in Appendix B. No honorarium figure was researched; you set the cap, as plan B7 does for the Qur'an track. **This is new spend, outside the LLM budget cap, and it needs a figure before reviewers are engaged (D14).**

**Recommendation: A.** Name both reviewers before the M1 rule notes are written. The engine code itself does not wait for them.

### 2.4 D4. Scope: what the tool refuses

A self-service tool should stop and say "silakan berkonsultasi" when it cannot compute a case safely (`engine.md` §13, `ux.md` §4.5). A refusal page shows no numbers. It explains the situation in one sentence, gives the rule and its dalil where we have one, and offers "Ubah jawaban", "Cetak ringkasan jawaban Anda" and "Kembali ke pelajaran". E-BUNUH has no printout (§9.4).

**Refusals are per column (added in review).** When only one column is uncertain, the other is still shown in full (`engine.md` §13).
- **Example:** a Muslim husband dies, leaving a Muslim wife, a non-Muslim only son and a Muslim full brother.
  - **Fikih column:** wife ¼, brother ¾. The son is ineligible and blocks no one.
  - **Court column:** treated as an heir, the son would exclude the brother. The column therefore says "Pengadilan Agama dapat menetapkan wasiat wajibah; besarnya perlu dikonsultasikan".
- **In the draft,** the whole report refused, so mualaf and interfaith families, who are common, got no answer at all.
- **Whole-report refusals** remain for khuntsa, mafqud, haml, gharqa, a reported killing, a non-Muslim deceased, debts ≥ estate, and relatives beyond the depth limit.

**Recommended v1 scope (option A).**

| The tool computes | The tool refuses (no numbers) |
|---|---|
| Spouse (up to 4 wives), children, grandchildren through a son, parents, the father's father, both grandmothers, siblings of all three lines, a brother's sons, paternal uncles and their sons | **Heir of undetermined sex** (khuntsa) |
| Fixed shares, 'ashabah, hajb, 'aul, radd to non-spouse heirs | **Missing heir** not declared dead by a court (mafqud), **when that person could change a number** (review; checked after the family is entered) |
| 'Umariyyatain (with the father, or with the grandfather: mother ⅓ of the whole), musytarakah, akdariyyah | **Unborn heir** (haml), when that child could change a number |
| Grandfather with siblings (Zaid's method; 16 vectors), stamped **"Perlu konfirmasi ahli faraid"** | **Deaths in one incident** with the order unknown (gharqa), when the other person could change a number |
| Court column: grandchildren through any child who died first (KHI 185, grandchildren only) | **Any report that an heir caused the death**, whether or not there is a verdict (see below) |
| Wasiat ≤ ⅓, a wasiat to an heir with consent, harta bersama of one marriage. *(Review: for several wives the engine needs a pool per marriage period, which seniors cannot easily state. In v1 the fractions are shown and the rupiah panel refers to the court; D18.)* | **Relatives who are neither share-holders nor 'ashabah** (dzawil arham): the fikih column refuses in v1. The court column computes a predeceased daughter's children as KHI 185 substitutes and refuses the rest. |
| Adopted child (court order): a ceiling (D8). Non-Muslim relatives: the as-if illustration, court column only (D8) | Relatives beyond the depth limit: great-grandchildren, a brother's grandson, the father's uncles and their sons. **These are now detected** by C4b and F5 (§5.7). In the draft no question asked about them, so they were silently dropped and their residue went to radd. |
| Stepchild, a brother's daughters, a child of an unregistered nikah: a note only | **Deceased not Muslim** (not a Pengadilan Agama matter) |
| An heir who died *after* the deceased: counted as alive, and the report offers a fresh questionnaire for that heir's own estate | Debts ≥ estate. **No heirs at all** (new exit E-TANPA-AHLI-WARIS, §5.7). |
| A missing, unborn or same-incident relative who **cannot change any number** (e.g. a brother out of contact when there is a son): a note, not a refusal | **Court column only:** a wasiat wajibah for a **non-Muslim** relative whose as-if share exceeds ⅓ or would exclude a real heir. *(Review: the draft row also caught adopted children. Read literally, it refused this plan's own case 10, where Dimas's as-if share is 7/8. KHI 209 adoption only ever gets the ⅓ ceiling.)* |
| A tangled harta bersama (an earlier wife who died or divorced; a disputed pool): fractions shown, the rupiah panel refused (D18) | **Fikih column only:** dzawil arham (while v1 refuses them) when the court column can compute the same family under KHI 185, e.g. a widow and the children of a daughter who died earlier |

**Two changes from the engine draft.**
1. **A reported killing always leads to a refusal.** `engine.md` §4 computes the fikih column (any killer barred) and refuses the court column only when there is no verdict. `ux.md` §4.5 refuses in both. Refusing in both is recommended:
   - the answer is *catatan kejahatan*, a specific personal-data category under UU 27/2022 Pasal 4(2)(d) (https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-4);
   - KHI 173 needs a final verdict, while classical fiqh bars any killer;
   - the hadith's attribution to the Prophet ﷺ is disputed (Bulugh local 1107: Ibn Hajar says the correct view is that it is *mawquf* on 'Umar).

   The `mani-pembunuh` vector stays as an engine test; the questionnaire never reaches it.
2. **Dzawil arham lead to a refusal in v1** (in the fikih column; the court column still computes a predeceased daughter's children under KHI 185, per-column rule above). The engine's *tanzil* method (4 vectors) stays in the code and tests so v2 can switch it on. The Syafi'i procedure with a spouse present, or with several relatives of mixed sex under one link, is unsettled (`engine.md` EQ11).

**Resolved conflict: an heir who died after the deceased** (munasakhat). `engine.md` §13 lists it as a refusal, but `ux.md` §4.1 item 2 makes it a correct first-stage calculation: "Jika ada yang wafat setelah almarhum, tetap hitung dia". The engine never sees a later death, so the first stage is exact, and the report's next-steps list offers "Hitung untuk beliau ›" (`ux.md` §5.2 item 6.8). Chaining the two estates automatically is out of v1.

| Option | Consequence |
|---|---|
| **A (recommended): the table above** | None of the 5 common families in `ux.md` §4.8 reaches a refusal. There are about 14 refusal pages to write and review (the review added E-TANPA-AHLI-WARIS and E-KERABAT-JAUH). |
| B: the engine draft as is | Adds computed dzawil arham results in the fikih column, and computed killer cases. These are more rulings for the reviewer, and the killer question means holding criminal-record data. |
| C: narrower | Also refuse grandfather with siblings, musytarakah and KHI substitution. This takes 20 already-sourced vectors (grandfather 14, musytarakah 4, KHI substitution 2) out of the user-facing path, and refuses a common Indonesian family: a grandchild whose parent died first. Not recommended. |

### 2.5 D5. Whether amounts in Rupiah are shown

| Option | Consequence |
|---|---|
| A: fractions only | Simplest, but families think in rupiah, and surveyed tools that say so compute amounts (WarisanQ; MAIS e-Faraid asks for 11 asset categories; `ux.md` §6). |
| **B (recommended): fractions in the questionnaire; an optional "Hitung dalam rupiah" panel inside the report** (`ux.md` §4.3 R1–R6; `architecture.md` §5.4) | The common paths stay at 8–12 screens (`ux.md` §4.8). The panel asks for harta bersama (per wife where there are several), the deceased's own property, funeral costs, debts and the wasiat value. It recalculates live. |
| C: amounts as questionnaire steps | Adds up to 6 screens to every path, and makes money a gate before any answer. |

**Rounding (a sub-decision: the research files disagree).**
- **`ux.md` §5.2:** round each heir down and show the leftover ("Sisa pembulatan Rp 2 — sepakati dalam musyawarah").
- **`engine.md` §14 and `architecture.md` §5.4:** largest remainder on exact fractions. Each heir is within Rp 1 of the exact value, the total equals the estate exactly, and the report names who received the extra rupiah.
- **Recommendation: largest remainder.** Example (`engine.md` §14, vector `rupiah-largest-remainder`): Rp 100.000.000 to a mother (⅙), three daughters (⅔) and a full brother (the rest). The floors sum to Rp 99.999.998, and the 2 leftover rupiah go to the mother and the brother. Either way, the report says the fraction is the legal share and the rupiah is a convenience.

**Pensions and insurance in the panel.**
- The panel asks what kind of payout it is, following Ijtima' Ulama V 2015 (https://fatwamui.com/storage/487/KEPUTUSAN-KOMISI-B-2-STATUS-HUKUM-IURAN-DAN-MANFAAT-PENSIUN-HUBUNGANNYA-DENGAN-TIRKAH.pdf, point C):
  - **Not estate:**
    - a non-contributory pension (C.1);
    - an annuitised pension (C.2).
    - **A monthly survivor's pension** paid to a named widow or child is labelled as an **inference** from C.1 ("tunduk pada aturan pensiun" for "pihak yang ditunjuk"). The decision does not say it; the KHI reviewer confirms (R20).
  - **Estate:**
    - contributory, combination or self-funded pension money that is not annuitised (C.2);
    - severance paid because of the death (C.3).
    - C.3 also names one scheme, exactly: "mukafa'ah al-iddikhar (semacam uang Taspen [Tabungan Asuransi Pensiun])".
- Only amounts the user marks as estate are counted.
- **Scheme names.** The help text names Taspen savings with the decision's own wording. *(Corrected in review: the draft said the decision names no scheme.)* Mapping ASABRI, BPJS JHT/JP and DPLK is still unsourced (`standard.md` Q4), so the help text names no other scheme.

**Recommendation: B, with largest-remainder rounding.** Amounts never go into a share link unless the user ticks the box (D9).

### 2.6 D6. Harta bersama (gono-gini) split by default

KHI 96(1) gives the surviving spouse half of the harta bersama **as owner, before inheritance** (`standard.md` §2.7). The spouse then also inherits their share from the other half. Classical fiqh asks only who owned what; the fara'id chapters in our corpus contain no 50% presumption (`engine.md` §3.2).

Consequence (`standard.md` §4.1 row L): a husband dies with Rp 1.000 juta of harta bersama and Rp 200 juta of his own property, leaving a wife, 2 sons and 1 daughter.

| | Split first (KHI 96) | Everything treated as his |
|---|---|---|
| Wife in total | **587,5** (500 own + 87,5 inheritance) | **150** |
| Each son | 245 | 420 |
| Daughter | 122,5 | 210 |

This is the single largest swing in the whole divergence table.

| Option | Consequence |
|---|---|
| **A (recommended): split by default in both results, shown as a visible step** ("½ harta bersama milik Ibu/Bapak sendiri"), with a toggle "semua harta ini milik almarhum" | Matches what a court does (KHI 96, yurisprudensi 32 K/AG/2002) and what families expect. The step is explained, not hidden. Classical ownership is still reachable through the toggle. |
| B: split only in the court column; the fikih column asks "berapa bagian almarhum?" | Adds a hard question that most families cannot answer, and puts a large gap between the two columns in every married family with joint property (row L: the widow's 587,5 vs 150). |
| C: never split | Understates the surviving spouse's own property. Not recommended. |

**Recommendation: A, conditional on the fara'id reviewer** (`standard.md` Q5). If the reviewer rejects the presumption for the fikih column, the fallback is B.

### 2.7 D7. Radd to a spouse, and a spouse as the only heir

**Radd to a spouse in the court column.** The research files disagree:
- `standard.md` §5.2 proposes radd to everyone (`radd_all`): KHI 193 read literally, and 2 of 3 PA Banjarmasin judges in a 2016 field study (https://idr.uin-antasari.ac.id/5439/).
- `engine.md` §9.4 found the MA's own *Buku II* (2013 edition, p. 176 §8(h)): "Radd tidak berlaku untuk janda dan duda". The 2026 edition that replaced it is silent.

| Family (`ux.md` case 12; `standard.md` row B) | No radd to the spouse | Radd to the spouse too |
|---|---|---|
| Wife + one daughter, Rp 400 jt | wife 50, daughter 350 | wife 80, daughter 320 |
| Wife + one daughter + a full brother, court column, Rp 1.200 jt | wife 150, daughter 1.050 | wife 240, daughter 960 |

**Recommendation: no radd to a spouse in either column.** That is the later Syafi'i position (Fath al-Mu'in §34). For the court column it rests on Buku II 2013 §8(h) plus Khairuddin.

**What that court-column default rests on (corrected in review).** The draft called Buku II 2013 "the only MA guidance on this point". That overclaimed:
- Buku II 2013 was **superseded in August 2026**, and Buku II 2026 (pp. 844–848) contains no calculation rules at all.
- Buku II 2013's own calculation pages carry rules the engine rejects:
  - p. 174 §4(a)(6) and p. 177 §9(e)–(f) give full and paternal siblings the uterine ⅙ / ⅓ when they inherit with the mother;
  - p. 176 §9(a)–(b) gives the father ⅙ with daughters and then radd (`engine.md` §6.3 lists all of them).
- Citing one line from those pages while dropping its neighbours is selective.

So the court column's no-radd-to-spouse default is **our default, not current MA guidance**. The KHI reviewer confirms current Pengadilan Agama practice before the court column ships.

The "Catatan metode" section adds one line: "Sebagian hakim memberikan sisa juga kepada suami/istri; jika demikian, bagian istri menjadi …". Both values are already in the vectors (`engine.md` §12.3).

**A spouse as the only heir** (`engine.md` EQ3).
- **Fikih column:**
  - the spouse takes their share (a widow ¼, a widower ½);
  - the rest goes to dzawil arham (refused in v1).
  - If there are none, the rest is **left unassigned** ("sisa: konsultasikan"). *(Changed in review.)* The draft printed "Baitul Mal ¾", but Fath al-Mu'in §34 adopts radd and dzawil arham only because the Baitul Mal is not orderly ("ثم إن لم ينتظم المال") and says nothing after that. Khairuddin p. 55 records the 'Utsman view that the spouse then takes the rest. The Baitul Mal line stays only in the `klasik-syafii-asal` comparison profile.
- **Court column:** no researcher found what a court does with the remainder. KHI 191 sends an estate to the Baitul Mal only when there is no heir at all.

| Option | Example: widow alone, Rp 400 jt |
|---|---|
| **A (recommended): partial result plus a soft stop, in both columns** | "Bagian istri: ¼ = Rp 100 jt. Sisa Rp 300 jt belum dapat ditentukan oleh alat ini — konsultasikan ke Pengadilan Agama." |
| B: print the Baitul Mal line | "Rp 300 jt untuk Baitul Mal". Classically correct, but alarming. In Indonesia, BAZNAS or a statutory Baitul Mal may apply to the court to administer such property (SEMA 1/2022). |
| C: radd to the spouse | Rp 400 jt to the widow. Unsourced for Indonesian courts. |

### 2.8 D8. Wasiat wajibah for an adopted or non-Muslim relative

- **MUI:** offers only *voluntary* hibah, wasiat and hadiah, in the 2005 and 1984 fatwas.
- **Courts:** give a *wasiat wajibah*:
  - to a court-adopted child under KHI 209;
  - to non-Muslim children and spouses under MA yurisprudensi 368 K/AG/1995, 51 K/AG/1999 and 16 K/AG/2010.
- **The amount is set by the judge.** Three PA decisions on the same kind of family gave three different sizes (`standard.md` §3.4). A tool cannot predict the number, so the report shows an illustration, never a result.

**How the courts compute it (corrected in review).** The draft's option B, "plafon", took the ceiling off first and re-divided the rest among the Muslim heirs. **No cited MA decision computes it that way.** Every one uses the **as-if** method: the non-Muslim relative receives the share they would have had as an heir, and every heir keeps their as-if share.
- **16 K/AG/2010** (JDIH sheet, amar 5): "pokok masalah 60 … ibu 10/60 … istri wasiat wajibah 15/60 … saudara perempuan 7/60 … saudara laki-laki 14/60". Under plafon the mother would get ⅛, not the ⅙ the court gave her.
- **51 K/Ag/1999** (1/Yur/Ag/2018): "bagian yang sama dengan bagian anak yang beragama Islam".
- **331 K/Ag/2018:** a widow ¼.
- `standard.md` §4.1 H2 already computed it this way (wife 150, son 700, daughter 350).

The ⅓ ceiling stays for **KHI 209 adoption**, where the wasiat wajibah is a bequest taken before division. *Buku II* 2013 §2(i) ("maksimal 1/3 bagian, dan tidak boleh melebihi bagian ahli waris yang sederajat dengannya") is a ceiling, not a procedure, and that guide is superseded (D7).

| Option | Consequence |
|---|---|
| A: flat text "paling banyak ⅓" with no recalculation | Overstates the ceiling for a non-Muslim child: ⅓ instead of their as-if share. |
| **B (recommended, revised): two methods by relationship.** **Adopted child (KHI 209):** a ceiling of ⅓, taken off before division, shown as "paling banyak …; besarnya ditetapkan hakim" (`engine.md` §11.4 a). **Non-Muslim spouse, child or parent:** the MA as-if illustration, court column only, shown as "contoh cara putusan MA; besarnya ditetapkan hakim" (`engine.md` §11.4 b, switch value `ma_16K2010`). **Court column refuses** when the as-if share exceeds ⅓ or would exclude a real heir; the fikih column is still shown. | It never promises an amount, and it matches the decisions it cites. |
| B-old: "plafon" for both | Contradicts 16 K/AG/2010's own amar, and pushes the wife below her Qur'anic ⅛ in case 11. Kept as a comparison value only. |
| C: show nothing for non-Muslim relatives in the court column | Hides a difference that decides real money. |

**MUI note.** MUI 5/2005 does not use wasiat wajibah at all, so neither method carries MUI authority. That is why "selaras fatwa MUI" describes only the fikih column (D1).

Worked numbers under B (`ux.md` cases 10 and 11):

| Case | Court column | Heirs without → with |
|---|---|---|
| Case 10: wife, full brother, a court-adopted son; Rp 360 jt | Ceiling ⅓ = Rp 120 jt, taken first (his as-if share would be 7/8, so the ceiling binds) | wife 90 → 60; brother 270 → 180 |
| Case 11: wife, 2 Muslim sons, 1 non-Muslim daughter; Rp 320 jt | As-if illustration: daughter Rp 56 jt (her as-if share 7/40) | wife 40 → **40**; each son 140 → **112** *(the draft's 33 / 115,5 came from plafon)* |

**Tone.** Lead with "Islam tetap membuka jalan kebaikan untuk mereka" (hibah, wasiat, QS 4:8) before "bukan ahli waris" (`ux.md` §2 L8).

### 2.9 D9. Share link, saving on the device, analytics

| Option | Consequence |
|---|---|
| A: no link; answers only in `sessionStorage` (gone when the tab closes) | The safest. But the family cannot reopen the report on another phone. |
| **B (recommended): opt-in link** `/belajar/id/waris/laporan#j=v1.<base64url>` | The fragment after `#` is never sent to the server (MDN: https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment). The link holds counts and yes/no answers only, no names; amounts only if ticked. A plain warning says anyone who receives the link, and the chat app it passes through, can read it. "Simpan di perangkat ini" (`localStorage`) is opt-in, with a "Hapus" button. |
| C: save reports on our server | Holds UU PDP *specific* data (children's data, financial data). Not recommended in v1. |

A query string is **not** acceptable. Every page calls `/belajar/api/me`, and the current referrer policy sends the full query string on same-origin requests (`architecture.md` §6.4). **Analytics: none in v1**; the module has none today (`architecture.md` §6.5). `ux.md` O11 suggested coarse counts; adding them later is a separate decision.

### 2.10 D10. Dalil display rules

| Item | Recommendation | Why |
|---|---|---|
| Qur'an Arabic | Tanzil Uthmani v1.1 bytes from the pinned file. Never `api/data/quran.json`. | None of the 13 ayat in `quran.json` is byte-identical to the module's pinned text; it adds optional marks (`dalil.md` §2.1). |
| Qur'an Indonesian | QuranEnc `indonesian_affairs` v1.0.1, labelled exactly as QuranEnc names it, footnotes shown whole and marked as the translator's note | `quran.json`'s Indonesian is an old non-commercial edition with typos ("bagahian", "seduah"). This resolves `ux.md` §0 item 5 in favour of `dalil.md` §2.1. |
| Sahih Muslim numbers | Use the canonical numbers already in `dalil.json`, e.g. local 4141 = **1615a**. They were remapped with fawazahmed0's `arabicnumber`, and the Arabic is byte-identical. | This makes the read-only prod lookup (`architecture.md` Q7) an optional cross-check, not a blocker. |
| Mu'adh's ruling (Bukhari 6734) | Label it "putusan Mu'adh bin Jabal (atsar)", never "sabda Nabi ﷺ" or "di masa Nabi ﷺ". *(Added in review.)* | In Bukhari 6741 one chain adds "على عهد رسول الله", but the narrator says Sulaiman's narration omits it. |
| Bulugh al-Maram numbers | Show the primary source the Bulugh entry names, e.g. "HR Abu Dawud 3565, at-Tirmidzi 2120 (dikutip dalam Bulugh al-Maram)", not a Bulugh number. Alternatively, request a sunnah.com API key. | The corpus uses AhmedBaset's own numbering; sunnah.com returned 403 (`dalil.md` §3.1, E5). |
| Killer barrier | Lead with al-Shafi'i's report of no disagreement about a deliberate killer (`F-ALUMM-550-killer`) and KHI 173. Show Bulugh local 1107 only with its grading note, if the reviewer allows it. | Ibn Hajar's own text says the correct view is that it is 'Umar's ruling (`dalil.md` §3.3). |
| Never shown | "Ta'allamu al-fara'id … nisf al-'ilm" (ungraded or da'if); the Sa'd ibn ar-Rabi' story until a named grading is found; Bulugh local 1101, 1109, 1110, 1115; the English Ibn Kathir text (a copyrighted abridged edition); the English lines of Bukhari 6752, 6733 and Bulugh 1106 (mistranslated) | `dalil.md` §3.3, §5, §7 |
| Hadith and kitab Indonesian | **Decided explicitly (review):** an Indonesian rendering that is not in the corpus (Bukhari, Bulugh, kitab and tafsir spans) is **hidden until the reviewer signs it**. Until then the card shows the Arabic, the citation chip and "terjemahan menunggu tinjauan ustadz", even in the noindex beta. A Claude-written rendering is generated text, which the hard rule forbids. Muslim's corpus `id` is retrieved but in-house; it may show with "terjemahan internal, belum ditinjau". The draft said both "reviewed before display" and "draft marker until sign-off". | `dalil.md` §3.3; AGENTS.md |
| Islamic references in UI strings *(added in review)* | No bare "QS …" or "HR …" text in `messages/waris/*.json`. Every "Kenapa kami tanyakan ini?" line, help line and exit page that cites a dalil carries a `RuleNote` or `dalil.json` id. `validate_waris.py` and `assertWarisReferences()` fail on an unkeyed citation. | The draft's questionnaire copy had citations (B1 "QS 4:12", B3 "HR Bukhari 6764", G1 "HR Bukhari 2742"; E-HIDUP's Bukhari 2586/2587 gap) outside the validation path, the same drift as the platform's citation/chunk-mismatch incidents. |
| Legal texts (KHI, SEMA, fatwas) | Quoted from pinned, checksummed PDFs: URL, sha256, page. This is the B9 retrieval rule. | The KHI wording used so far comes from archive.org and MUI Sumut copies; the official BPHN copy returned 403 (`standard.md` §2). |
| PMA 44/2016 | Add the waris ayat (4:7, 4:11, 4:12, 4:176 and the rest) to the LPMQ letter. Stay in the closed noindex beta until LPMQ answers. | `architecture.md` Q10 |

### 2.11 D11. Language

**Recommendation: the questionnaire, report, lessons and cases are Indonesian only in v1.**
- English pages show English chrome around the Indonesian content, with a notice, as the Qur'an track does (plan B12; `architecture.md` Q5).
- The prompts carry legal meaning ("saudara seibu", "divonis"), so an English version would need its own review.

### 2.12 D12. Branch, commit and deploy sequencing

- **What starts now.** M1 (engine, tests, dalil pipeline) touches only new paths (`architecture.md` §13), so it can start now on its own branch off `main`.
- **What waits.** UI work waits until the route move and the senior-UX redesign have merged.
- **Merging is deploying.** Any merge to `main` that touches `belajar/**` deploys to production (`deploy-belajar.yml`). Each merge therefore waits for your explicit go, and every commit is confirmed with you first (AGENTS.md: ASK BEFORE COMMIT, ALWAYS ASK PERMISSION).
- **What it costs.** No step of this plan calls a paid API or an LLM.

---

## 3. Learning path

Nine short lessons, each about 6–8 minutes, from `ux.md` §2. `architecture.md` §12 budgeted 6–8; nine is kept because L8 and L9 are short card lessons.

**"Banyak visualisasi, sedikit teori" (added in review; decision D17).** You asked for lots of visualisation and animation and little theory. The nine lessons cover the whole of fara'id, so two things are added:
- **"Jalur singkat":** L1 → L2 → L3 → L9 → "Hitung waris keluarga saya", about 25 minutes. It is offered first on the track home. The other lessons are "Pelajari lebih dalam".
- **Animation floors and theory budgets** in M3's acceptance:
  - each lesson has at least 4 animated steps;
  - at most ~250 words of prose outside the stage and the dalil card;
  - at least 4 of 5 testers aged 60+ pass the lesson check.

"Animation" here means stages that advance one tap at a time, at the learner's pace. Please confirm that is what you meant. Narration (audio) would be a later, priced option.

**Every lesson has the same shape** (`ux.md` §2.0), so a senior learns one pattern:
1. A title and a one-line goal.
2. A **stage**: one visual, advanced a step at a time with a caption. It follows the existing pace setting (Biasa / Pelan / Tunggu saya) and never auto-advances in "Tunggu saya".
3. One dalil card: Arabic at ≥ 24px, the Indonesian meaning, a citation chip linking to the source, and a draft marker until the reviewer signs off.
4. A tiny family example.
5. A check of 2–3 questions with icon + text + border feedback, never colour alone.
6. One sentence to remember ("Ingat").

Terms are glossed in place, e.g. *'ashabah* (penerima sisa), *hajb* (terhalang), *'aul* (dikurangi bersama), *radd* (sisa dikembalikan). **Every number in a visual comes from the engine at build time**; none is typed into content (`architecture.md` §3.3).

**Shared visuals** (`ux.md` §2.0, `architecture.md` §8.1). These are reused in lessons, cases and the report:
- **Bilah harta:** the estate bar of tiles. Above 48 tiles it switches to proportional segments.
- **Pohon keluarga:** the family tree.
- **Petak:** asal-masalah tiles that overflow under 'aul and flow back under radd.
- **Urutan:** the shrinking bar for the payments made before division.
- **Dalil card.**

Every state carries a pattern and a word: ✓ mendapat bagian, ⊘ terhalang, ↺ dikembalikan, ⤓ dikurangi.

Dalil ids below are record ids in `dalil.json`. **Gap** means the source is in `api/data/` (located by the UX researcher) but not yet byte-extracted into `dalil.json`, so it must go through the extraction before a lesson shows it.

| # | Lesson | The visual (one stage) | Anchor dalil (`dalil.json`) | Gaps and cautions |
|---|---|---|---|---|
| L1 | **Warisan adalah ketetapan Allah** — women and children have a share, and it must be paid | "Sebelum dan sesudah": tiles stacked on one man lift off and fall into three labelled trays. A fictional family, not a historical one. | `Q-4-7`, `Q-4-13`, `Q-4-14`, `Q-4-11` (its ending). Story hook: `H-BUKHARI-4577` (Jabir asks how to divide; 4:11 is revealed). | The Sa'd ibn ar-Rabi' story stays out until graded (`dalil.md` E1). Do not merge Bukhari 4577 (4:11) with Muslim 1616a (4:176). The *jahiliyyah* practice must come from the **Arabic** Ibn Kathir 4:11 (`S-IK-4-11`, excerpt still to be cut) with a reviewed translation, not from the English edition `ux.md` quotes. |
| L2 | **Sebelum dibagi: pisahkan, bayar, tunaikan** | The shrinking bar: half of the gono-gini slides to the spouse; then funeral costs, debts, and a wasiat that springs back to a dashed ⅓ line | `Q-4-11`, `Q-4-12` ("after a bequest or a debt"); `T-IK-4-11-dayn` and `F-ALUMM-572` (debt before bequest, by consensus); `H-BUKHARI-2742` / `H-MUSLIM-1628a` (⅓); `H-BULUGH-1114` (no bequest to an heir; cite the primary sources); `F-FQARIB-118-wasiyya` (heirs' consent); `F-FMUIN-11-tajhiz`; `H-BUKHARI-6731` | **Gap:** no corpus text puts funeral costs *before* debts (`dalil.md` E4), so cite KHI 175 for the order. `fiqh-as-sunnah.json` is missing chunk C1084. Bulugh 649 ("the believer's soul is tied to his debt") is a gap. Harta bersama is a legal source (KHI 96), not a dalil. |
| L3 | **Siapa saja ahli waris?** | "Lingkaran kedekatan": the five who always inherit, then the wider rings, then a separate box "Disayangi, tetapi bukan ahli waris" (menantu, mertua, anak tiri, anak angkat), then two ⊘ barrier badges | `F-FQARIB-116-heirs`, `Q-8-75`, `Q-33-6`, `Q-4-12`; religion: `H-BUKHARI-6764`, `H-MUSLIM-1614` (+ Fatwa MUI 5/2005); killer: `F-ALUMM-550-killer` (+ `H-BULUGH-1107` with its grading note only) | **Gap:** QS 33:4–5 (adoption, cited by the 1984 fatwa) |
| L4 | **Enam bagian pasti: ½, ¼, ⅛, ⅔, ⅓, ⅙** | Six fraction cards. A toggle "Almarhum punya anak? Ya / Tidak" halves the spouse cards and drops the mother from ⅓ to ⅙. A daughters stepper goes 1 → 2 → 3. | `Q-4-11`, `Q-4-12`, `Q-4-176`, `F-FQARIB-117-furudh`; grandmother: `H-BULUGH-1103` (hasan; cite Abu Dawud 2895) | Two daughters' ⅔ rests on `T-IK-4-176-two-daughters`; the Sa'd report is second-hand only (`dalil.md` R-daughters) |
| L5 | **Penerima sisa ('ashabah) dan 2 : 1** | "Gelas dan sisa": fixed cups fill to their mark, the rest pours into a basin, and drops fall two to the son, one to the daughter. Then a counter-example card "Tidak selalu 2 : 1". | `H-BUKHARI-6732`, `H-MUSLIM-1615a`, `Q-4-11`, `Q-4-176`, `F-FQARIB-118-asabah-bil-ghayr`; counter-example: `Q-4-12` (uterine siblings share equally) | The nafkah explanation is a *hikmah*, never "the reason" (no overclaiming). **Gap:** QS 4:34. The English Ibn Kathir quote in `ux.md` D9 is not usable. |
| L6 | **Siapa menghalangi siapa (hajb)** | "Tangga penerima sisa" (**corrected in review**). Rungs below a present relative read "tidak menjadi penerima sisa", not "terhalang". Ayah and Kakek keep a persistent "⅙" chip when there is a son. The Kakek rung says "berbagi dengan saudara (cara Zaid)" and does not hatch the sibling rungs. Every state is generated from the engine's `blockers()`. "Pohon yang meredup": adding a son fades the siblings, with a line from the son. Special card: blocked siblings, including siblings blocked by the grandfather or by a full brother, still lower the mother to ⅙. | `F-FQARIB-117-hajb`, `F-FMUIN-34-hajb`, `T-IK-4-176-father-blocks`, `T-TB-4-11-father-blocks` (taught as "para ulama sepakat"), `H-BUKHARI-6736`, `T-TB-4-11-ikhwa-two` | **Gap:** the Ibn Kathir 4:11 sentence that blocked siblings still reduce the mother. It is quoted in `engine.md` §0.1 but not yet an excerpt record. This settles `ux.md` O4 as yes. |
| L7 | **Kalau berlebih ('aul) atau tersisa (radd)** | 'Aul: the container overflows at 7/6, then widens to 7 and every tile narrows. Radd: two leftover tiles flow back 3 : 1, and the spouse's cup has a lid. | `F-FMUIN-35-awl`, `F-FSUNNAH-852-awl-umar`, `F-FSUNNAH-854-radd-no-nass`, `F-FMUIN-34-radd-dzawil-arham`; KHI 192, 193 | 'Umar's first 'aul is only "ruwiya" in the corpus (`dalil.md` E3). Teach 'aul as the Companions' ijtihad, and do not narrate the story as fact. |
| L8 | **Situasi yang sering terjadi di Indonesia** | Six flip cards: gono-gini; anak angkat; kerabat beda agama; cucu whose parent died first; dividing during life (hibah); a long-undivided estate. Each card's back has three rows: "Menurut fikih", "Menurut KHI/Pengadilan Agama", "Yang bisa Anda lakukan". | `Q-4-8` + `H-BUKHARI-4576`; `H-BUKHARI-6764`; Fatwa MUI 5/2005, 1984 and 11/2012; KHI 96, 185, 209, 211, 213 | **Gaps:** Bukhari 2586/2587 and Muslim 1623e (be fair among children); QS 33:4–5. Tone rule: lead with "Islam tetap membuka jalan kebaikan" before "bukan ahli waris". |
| L9 | **Membagi dengan damai** | "Meja musyawarah": know your share → talk → agree (a tile passes from one heir to another, leaving a ghost outline of the original share) → record → if stuck, mediation or the Pengadilan Agama. **Fixed card (added in review):** "Ahli waris yang belum dewasa diwakili wali yang ditetapkan hakim; bagiannya tidak ikut 'disepakati' untuk dilepaskan." The child's tile never passes to another heir. | `Q-4-8`, `H-BUKHARI-4576`, `H-BUKHARI-2759`; *takharuj*: `S-FIQH-AS-SUNNAH-864` (pointer; excerpt to cut); KHI 183, 184, 188, 189; the 1984 MUI land recommendation (D1); UU 1/1974 Pasal 48 and 52 (a parent or wali may not transfer a minor's immovable property "kecuali apabila kepentingan anak itu menghendakinya", https://pasal.id/peraturan/uu/uu-no-1-tahun-1974/pasal-48, to pin) | **Gaps:** QS 4:128, 49:10, 42:38, 2:188, **4:10** (the orphan card); Bukhari 5986/5987 (silaturahim). KHI 184 itself only appoints a wali; "cannot be waived" rests on KHI 183 (agreement needs heirs who know their share), UU 1/1974 Ps. 48 and 52, and QS 4:10. The KHI reviewer confirms the wording. |

**Presenting QS 4:8.** Present it as a recommended kindness, never as a share. Scholars differ on whether it was abrogated: Ibn 'Abbas says it is in force (`H-BUKHARI-4576`), while Ibn Kathir attributes abrogation to the jumhur (`T-IK-4-8-naskh`). This is reviewer question R11 in Appendix B.

---

## 4. Case studies

Twelve fictional families, from easy to hard, from `ux.md` §3, plus one optional hadith case, plus three common Indonesian situations added in review (cases 14–16). Every case says it assumes the deceased was Muslim, the listed heirs were alive at the death, and no special situation applies.

**Each case card has four parts:**
1. "Keluarganya" (the tree);
2. "Coba tebak dulu" (an optional guess);
3. "Jawabannya" (the bar, plus a table of fraction, percent and rupiah);
4. "Kenapa begitu" (2–4 captioned steps with dalil chips).

**Numbers on a case page are computed by the engine at build time.** The reviewer's expected answer is stored as an oracle, and the build fails if the two disagree (`architecture.md` §3.3). The UX researcher checked every case's arithmetic with exact fractions, and this plan re-checked cases 3, 10 and 11. The review re-checked cases 2–12 and corrected the court column of case 11.

Amounts are the *harta waris bersih* (after the L2 deductions), in Rp juta.

| # | Family | Fikih column | Court column | Lesson | Vector |
|---|---|---|---|---|---|
| 1 | **Keluarga inti.** Wife, 2 sons, 1 daughter; 400 | wife ⅛ = 50; each son 140; daughter 70 | same | L4, L5 | new |
| 2 | **Saudara yang terhalang.** Wife, mother, 1 son, 2 full brothers; 480 | wife 60, mother 80, son 340, brothers 0 (blocked by the son) | same | L6 | new |
| 3 | **Gono-gini, utang, wasiat dulu.** Harta bersama 1.000 + his inherited rice field 300; funeral 12, debt 48, wasiat to a mosque 20; wife, mother, son, daughter | Wife keeps 500 of her own. Estate 800 − 60 = 740; wasiat 20 is ≤ ⅓ → 720 to divide. Wife 90, mother 120, son 340, daughter 170. | same (with D6 = A) | L2 | new |
| 4 | **Radd.** Daughter and mother only; 240 | daughter ½ → ¾ = 180; mother ⅙ → ¼ = 60 | same | L7 | new |
| 5 | **Ibu sepertiga dari sisa** ('Umariyyatain). Husband, father, mother; 300. A toggle shows the wife's version. | husband 150, mother 50, father 100. Wife version: ¼, ¼, ½. | same | L6, L7 | `umariyyatain-suami`, `umariyyatain-istri` |
| 6 | **'Aul: the case brought to 'Umar.** Husband, 2 full sisters; 210 | 7/6 → base 7: husband 90, each sister 60 | same | L7 | `aul-6-7-suami-2sdrpr` |
| 7 | **'Aul in a young family.** Wife, father, mother, 2 daughters; 270 | base 24 → 27: wife 30, father 40, mother 40, each daughter 80 | same | L7 | `aul-24-27-minbariyyah` |
| 8 | **Anak perempuan dan saudari.** One daughter, one full sister; 300 | 150 / 150 (sister as 'ashabah with the daughter: `H-BUKHARI-6736`, the Prophet's ruling via Ibn Mas'ud; `H-BUKHARI-6734`, labelled "putusan Mu'adh (atsar)", not "in the Prophet's lifetime") | daughter 300, sister 0 (86 K/AG/1994) | L6, L8 | new (near `khi-122K1995-anakpr-tunggal-saudara`) |
| 9 | **Cucu yang orang tuanya wafat lebih dulu.** Living son Budi; daughter Sari died earlier, leaving 2 daughters; 300 | Budi 300; granddaughters 0, with a QS 4:8 invitation to give them something | Budi 200, each granddaughter 50 (KHI 185) | L8 | new |
| 10 | **Anak angkat.** Wife, 1 full brother, court-adopted son Dimas, no wasiat; 360 | wife 90, brother 270; Dimas is not an heir (hibah or wasiat possible) | Ceiling: Dimas at most 120; then wife 60, brother 180 | L3, L8 | new (near `khi-ww-anak-angkat-plafon`) |
| 11 | **Anak yang berbeda agama.** Wife, 2 Muslim sons, 1 non-Muslim daughter; 320 | wife 40, each son 140; the daughter is not an heir (hibah or wasiat possible, Fatwa MUI 5/2005) | **Illustration of the MA method** (as-if, D8): daughter 56, wife 40, each son 112, "besarnya ditetapkan hakim". *(Corrected in review: the draft's "wife 33, each son 115,5" was an engine artefact of the plafon method, not a court calculation.)* | L3, L8 | new |
| 12 | **Radd ketika ada pasangan.** Wife, 1 daughter; 400 | wife 50, daughter 350 | Same under D7 = A. The note adds "sebagian hakim: istri 80, anak 320". | L7 | new |
| 13 *(optional, recommended)* | **Putusan Ibnu Mas'ud.** Daughter; a son's daughter whose father died first; a full sister | ½, ⅙, ⅓ (`H-BUKHARI-6736`: "the Prophet's ruling") | daughter ½, granddaughter ½, sister 0 (computed; reviewer to confirm) | L6 | `bukhari-6742-anakpr-cucupr-sdrpr` |

| 14 *(added in review)* | **Harta yang lama tidak dibagi.** Pak Ahmad dies, leaving his wife Bu Siti, 1 son and 1 daughter; net estate 480. Nothing is divided. Five years later Bu Siti dies, leaving the same two children; her parents died before her. | Stage 1: Bu Siti ⅛ = 60, son 280, daughter 140. Stage 2 ("Hitung untuk beliau", a fresh questionnaire): her 60, plus her own property (here 0), goes to son 40, daughter 20. Totals: son 320, daughter 160. | same | L8 | `munasakhat-tahap-pertama` covers stage 1; stage 2 is new |
| 15 *(added in review)* | **Keluarga dengan anak dari pernikahan sebelumnya.** Pak Darto dies, leaving his second wife, a son from his first marriage (the first wife was divorced years ago, her 'iddah long over) and a daughter from the second marriage; net estate 360 (harta bersama of the second marriage already separated). | wife ⅛ = 45; son 210; daughter 105. The son of the first marriage counts exactly like the other children; the divorced first wife is not an heir. | same | L3 | new. Note on the card: an undivided harta bersama from the first marriage is a separate matter, "konsultasikan" (D18). |
| 16 *(added in review)* | **Janda muda dengan anak-anak kecil.** Pak Rudi dies, leaving his wife, 1 son and 2 daughters (all under 18) and his mother; net estate 480. | wife ⅛ = 60; mother ⅙ = 80; son 170; each daughter 85. | same | L9 | new. Fixed note: the children's shares are held by a wali appointed by the court (KHI 184) and are not "agreed away" in musyawarah (L9 card; UU 1/1974 Ps. 48, 52). |

**Which cases get the "Fikih vs KHI" split view.** Cases 8–11 and 13. Case 12 becomes a note-only case if D7 = A. Cases 14–16 have no split.

**How the split view is worded.**
- Both positions are presented as recognised, with no "yang benar adalah …".
- The next step reads: "Jika keluarga sepakat, gunakan musyawarah (KHI 183); jika dibawa ke Pengadilan Agama, umumnya mengikuti kolom kanan" (`ux.md` case 8).
- For case 8, the minority reading that a daughter blocks the sister is shown from al-Tabari's **Arabic** (`T-TB-4-176-daughter-sister`: everyone agrees except Ibn 'Abbas and Ibn az-Zubayr), not from the English Ibn Kathir.

**Vectors.** Twelve of the sixteen cases need a new test vector, added in M1 so the case pages and the engine can never drift apart. **No case page may use a `computed` expectation (case 13's court column, for example) until the reviewer confirms it (M4).**

---

## 5. Adaptive questionnaire: "Hitung waris keluarga saya"

The full tree, node table and copy are in **`ux.md` §4.2–§4.5**. The state machine is in **`architecture.md` §6**. This section is the summary to approve.

### 5.1 How "the next question depends on the previous answer" works

- **Questions are data.** Each node in `ux.md` §4.3 is a data node, held in a fixed priority order.
- **One test decides whether a relative is asked about.** A node about a relative is shown only if `couldAffectOutcome(relative, answers so far)` is true. That is one call into the engine's own exclusion table (`architecture.md` §6.2, `engine.md` §6.1), so the questions and the calculation cannot drift apart. The platform has been hurt twice by two code paths each carrying its own copy of a rule (project memory, "Manual/auto parity").
  - **Corrected in review (the blocker).** The draft used `couldInherit` against one ruleset. That is wrong in two ways.
    - **It ignores relatives who change a number without inheriting.** Siblings blocked by the father, the grandfather or a full brother still lower the mother from ⅓ to ⅙ (Fath al-Qarib §117 "ولا فرق بين الأشقاء وغيرهم"; Ibn Kathir 4:11). Consanguine siblings count against the grandfather even when a full brother takes their share (mu'addah).
    - **It checks only one ruleset,** although the report shows both.
  - **Families the draft got wrong:**

    | Family | Draft (wrong) | Correct |
    |---|---|---|
    | Mother + 1 full brother + 1 paternal brother, Rp 600 jt | E2 skipped: mother 200 | mother ⅙ = 100, brother 500 |
    | Mother + grandfather + 1 full brother + 1 uterine sibling | E3 skipped: mother ⅓ and ⅓ each | mother ⅙; grandfather 5/12; brother 5/12 |
    | Grandfather + 1 full brother + 1 paternal brother | E2 skipped: grandfather ½ | grandfather ⅓ (mu'addah) |

  - **The fix:** `couldAffectOutcome` is the OR, over both rulesets, of "could inherit", "counts toward the mother's two-or-more siblings", "counts against the grandfather" and "decides a named pattern".
  - **Vectors added:** `hajb-nuqshan-ibu-oleh-sdr-seayah-terhijab`, `jadd-ibu-kakek-sdrlk-sdrseibu`, `jadd-ibu-kakek-2seibu`, `jadd-akdariyyah-batal-seibu`.
- **Skips are visible.** A muted line under the live family tree says, for example, "Saudara tidak ditanyakan karena ada anak laki-laki." That teaches hajb in passing (`ux.md` §4.7).
- **One thing per screen.** Each screen shows "Kenapa kami tanyakan ini?" in the open, not behind a tap. Progress is shown as **named sections without a total** ("Pasangan ✓ · Anak ✓ · **Orang tua** · Saudara · Wasiat"), because conditional sections would change "dari 6" mid-way *(changed in review)*. A choice plus a stepper on one screen is split into two screens (C4, F1–F3; §5.7).
- **"Tidak tahu" (changed in review; D15).** The draft said it was "always allowed" and that the report "computes the likely case", but never defined that case. For an existence question (are the parents alive, how many children, is there a grandfather), a silent default adds or removes an heir in a printed money report. That is an undeclared mafqud case.
  - **Allowed** only on the nodes the §5.7 table lists.
  - **Both outcomes:** when an unknown answer could add or remove an heir, the engine solves both and the report shows **both outcomes side by side**, or routes to "konsultasikan" if more than one such answer is unknown. It never prints one "likely" number.
  - **Tested:** M2 includes unknown answers.
- **Senior UX** (`docs/belajar-research/senior-ux.md`): full-width answers of ≥ 56px, 56px stepper buttons, "‹ Kembali" always visible, no timers.

**Resolved conflict: barriers before blockers.** `architecture.md` §6.1 asks about religion and killing *after* the relatives (its phase H). That is too late. A non-Muslim son does not block the deceased's brothers, so religion must be known before deciding to skip the siblings. This plan follows `ux.md` §4.1 item 5:
1. One screen near the start (A3) asks about special situations.
2. **(Extended in review.)** If A3 flags a difference of religion, the next screen, **A3a**, asks once: "Di kelompok mana ada yang berbeda agama **saat almarhum wafat**?" It is a multi-select over relationship groups: pasangan, anak, cucu, orang tua, kakek/nenek, saudara, keponakan/paman/sepupu. The question "Berapa di antara mereka yang beragama Islam saat almarhum wafat?" then appears right after the count of each **selected** group only.
   - The draft had religion nodes only for spouse, children and parents.
   - Its E4 did not filter by religion, so non-Muslim siblings would have lowered the mother to ⅙. The engine's S counts only eligible siblings.
   - BEDA paths are counted in §5.5.

### 5.2 The tree, in summary

Revised in review; the node-level changes are in §5.7.

```
A1 Untuk siapa Anda menghitung?
   ├─ "Saya sendiri, masih hidup" ──► E-HIDUP (this is hibah, not waris; fairness among children;
   │                                    wasiat ≤ ⅓, written) ─► optional "simulasi: jika saya wafat hari ini"
   ├─ "Orang tua/keluarga saya yang masih hidup (simulasi)" ──► same questionnaire, third person,
   │                                    report stamped "Simulasi"            (added in review)
   ├─ "Keluarga yang wafat bukan Muslim" ──► E-NONMUSLIM (not a Pengadilan Agama matter)
   └─ "Keluarga Muslim yang sudah wafat"
A2 Laki-laki atau perempuan?                       (sets suami/istri, almarhum/almarhumah)
A3 Keadaan khusus? (multi-select; first option "Tidak ada satu pun")
   ├─ beda agama ─► A3a which relationship groups (then "berapa yang Muslim?" after those counts only)
   ├─ anak angkat ─► A3b how many, sex, by court order?, any voluntary wasiat to them
   ├─ hilang · dalam kandungan · wafat bersamaan ─► "siapa?" (role); decided AFTER the family is entered:
   │     refuse only if couldAffectOutcome(role), otherwise a note        (changed in review)
   └─ menyebabkan wafatnya almarhum ─► E-BUNUH at once (never stored)  · jenis kelamin tidak pasti ─► E-KHUNTSA
B1 Pasangan saat wafat: ya, satu · ya, lebih dari satu (B2) · dalam masa iddah talak raj'i ─► soft stop
   · tidak, pernah menikah · tidak, belum pernah menikah
   └─ B1b (if pernah menikah) Pernah ada istri/suami lain yang wafat lebih dulu atau bercerai? ─► note
C1 Anak yang hidup saat wafat: laki-laki / perempuan   (help: termasuk anak dari pernikahan sebelumnya)
   (male deceased "belum pernah menikah": C1 and C3 skipped; a female deceased is still asked C1, KHI 186)
C3 Ada anak yang wafat lebih dulu dan meninggalkan anak?  (always asked otherwise: the court column needs it)
   └─ C4 per anak itu: L/P ─► cucu L/P ─► C4b "ada cucu ini yang juga wafat lebih dulu dan meninggalkan anak?"
                                              └─ ya ─► E-KERABAT-JAUH                   (added in review)
D1 Orang tua yang hidup ─► D3 kakek / nenek (only those not excluded)
E  Siblings, each group asked iff couldAffectOutcome (inherit in either column, lower the mother,
   count against the grandfather, decide a named pattern):
   E1 saudara kandung ─► E2 seayah ─► E3 seibu
   E4 "Dua saudara atau lebih yang beragama Islam?" only when some sibling group was skipped while the
      mother is alive with no descendant and fewer than 2 siblings are known
F  only while no residuary is known and something is left over:
   F1 keponakan laki-laki (ada? ─► berapa) ─► F2 paman (ada? ─► berapa) ─► F3 sepupu (ada? ─► berapa)
   ─► F5 "kerabat laki-laki lain dari garis ayah (cucu saudara laki-laki, paman ayah, …)?" ─► ya: E-KERABAT-JAUH
   ─► F4 kerabat lain (examples exclude anyone already entered) ─► ya: E-DZAWIL (KHI 185 grandchildren
      entered at C4 are never routed here; the court column computes them)
   ─► no heirs at all ─► E-TANPA-AHLI-WARIS                             (added in review)
G1 Ada wasiat? (multi-select: untuk orang lain/lembaga · untuk ahli waris · tidak ada · tidak tahu)
   ─► G2 untuk ahli waris yang mana (role) ─► G3 berapa (⅓ · ¼ · lebih dari ⅓ · barang/nilai tertentu · tidak tahu)
   ─► G4 semua ahli waris setuju? (if > ⅓ or to an heir; singular wording when there is one heir;
      skipped only when there is no heir, which routes to E-TANPA-AHLI-WARIS)
H  Ringkasan keluarga: every answer with "Ubah"  ─► Laporan (+ the optional Rupiah panel)
```

### 5.3 Skip rules (from the exclusion table)

Sources: Fath al-Qarib §116–117 (C138–C139) and Fath al-Mu'in §34 (C39), as tabulated in `ux.md` §4.4 and `engine.md` §6.1. **Revised in review:** a row may skip a relative only if that relative can neither inherit in either column, nor lower the mother, nor count against the grandfather. The skip table is documentation; the code derives every skip from `couldAffectOutcome`.

| If this person is present | Never asked | Still asked |
|---|---|---|
| A son | all siblings, nephews, uncles, cousins; a son's children in the fikih column | spouse, daughters, parents, the grandparents not excluded; **C3/C4 still**, for KHI 185 |
| A son's son (his father died first), no son | siblings, nephews, uncles, cousins | as above |
| Only daughters or son's daughters | uterine siblings; E4 | full and paternal siblings (they can take the rest in the fikih column; the court column shows them blocked) |
| The father | the father's father, the father's mother, all siblings, nephews, uncles, cousins | mother, the mother's mother (if no mother), spouse, children; **E4** if the mother is alive and there is no descendant |
| The mother | both grandmothers | — |
| The father's father (no father) | nephews, uncles, cousins; uterine siblings **only if** the mother is dead, or a descendant exists, or 2 siblings are already known | full and paternal siblings → the grandfather-with-siblings rule ("Perlu konfirmasi ahli faraid"); **uterine siblings when the mother is alive with no descendant** (they lower her to ⅙ even though the grandfather blocks them). *(The draft skipped them always.)* |
| A full brother | nephews, uncles, cousins; paternal siblings **only if** they can neither lower the mother nor count against a grandfather | uterine siblings, if they could inherit or lower the mother; **paternal siblings when the mother is alive with no descendant and fewer than 2 siblings are known, or when the grandfather is alive** (mu'addah). *(The draft skipped them always.)* |
| A full sister alongside a daughter | paternal siblings, nephews, uncles, cousins | — |
| Fixed shares already ≥ 1 (e.g. husband + 2 sisters) | nephews, uncles, cousins | — |

**Never skipped:** spouse, daughters, parents, the relevant grandmother, and the wasiat. A residuary heir never removes their fixed shares.

**E4 is settled.** Siblings blocked by the father still lower the mother to ⅙. `ux.md` O4 asked for confirmation:
- Tafsir Ibn Kathir 4:11 states it ("لا يرثون مع الأب شيئا ولكنهم مع ذلك يحجبون الأم", `engine.md` §0.1);
- the vector `hajb-nuqshan-ibu-oleh-saudara-terhijab` encodes it.

**Extended in review.** The same holds for siblings blocked by the **grandfather** or by a **full brother**: Fath al-Qarib §117 says "ولا فرق بين الأشقاء وغيرهم", and the engine's S already counts them. The fara'id reviewer confirms this as R21.
- E4 is therefore asked whenever a sibling group was skipped while the mother is alive with no descendant and fewer than 2 siblings are known, not only when the father is alive.
- E4 counts only siblings who were Muslim at the death.

### 5.4 Refusal pages ("Konsultasikan")

**What every refusal page shows** (`ux.md` §4.5):
1. One sentence on what the situation is.
2. Why the tool stops.
3. The rule, with its dalil where we have one.
4. Next steps: an ustadz or ahli faraid, or the Pengadilan Agama.
5. Buttons: "Ubah jawaban", "Cetak ringkasan jawaban Anda" and "Kembali ke pelajaran". **E-BUNUH has no "Cetak ringkasan" button** (review; §9.4).

| Exit | Trigger | Rule shown |
|---|---|---|
| E-HIDUP | the person asking is still alive | hibah, not waris; be fair among children (gap: Bukhari 2586/2587); wasiat ≤ ⅓ (`H-BUKHARI-2742`), none to an heir (`H-BULUGH-1114`), and written down (`H-BUKHARI-2738`); KHI 194–195, 210–213 |
| E-NONMUSLIM | the deceased was not Muslim | KHI 171(b); civil court |
| E-MAFQUD | a missing person who **could change a number** (checked after the family is entered; otherwise a note) | `S-FIQH-AS-SUNNAH-860`/`861`; KHI 171(b), 96(2) |
| E-HAML | an unborn child who could change a number (a child of the deceased always does) | `H-BULUGH-1106` (sahih through its routes; do not show its English line); `F-FSUNNAH-859-pregnancy` |
| E-BERSAMAAN | deaths in one incident, order unknown, involving someone who could change a number | `S-FIQH-AS-SUNNAH-843` (each estate then goes to its own living heirs) |
| E-BUNUH | someone in the family caused the death | `F-ALUMM-550-killer`; KHI 173 (final verdict). Nothing about the answer is kept: not in `sessionStorage`, a link, print or the text summary. No answer printout on this page. |
| E-KHUNTSA | an heir's sex cannot be determined | `S-FIQH-AS-SUNNAH-862` |
| E-DZAWIL | F4 = yes | `F-FMUIN-34-radd-dzawil-arham`; KHI 191 |
| E-KERABAT-JAUH *(added in review)* | C4b = yes (a great-grandchild through a grandchild who also died earlier) or F5 = yes (a male relative of the father's line beyond cousins, e.g. a brother's grandson or the father's uncle) | `engine.md` §2 depth limit (the engine does not model these relatives; some of them are 'asabah who would take the residue or block siblings); a human check |
| E-TANPA-AHLI-WARIS *(added in review)* | nobody at all: no spouse, no relative entered, F4 = no | No numbers. KHI 191 (by a Pengadilan Agama decision the estate goes to the Baitul Mal "untuk kepentingan Agama Islam dan kesejahteraan umum"); SEMA 1/2022 2.b (BAZNAS or a statutory Baitul Mal may apply to administer it); next step: an application to the Pengadilan Agama. A wasiat above ⅓ has no heir to consent to it; the rule for the excess is **not sourced yet** (reviewer R2b), so the page says "konsultasikan" rather than stating it. |
| Engine refusals | debts ≥ estate; a large wasiat wajibah (court column only) | `engine.md` §13 |
| Soft stops (numbers shown, plus a stamp) | grandfather with siblings; a spouse as the only heir (D7, both columns); several wives' harta-bersama pools or an earlier wife (rupiah panel only, D18); B1 "dalam masa iddah" | "Perlu konfirmasi ahli faraid" / "konsultasikan" |

**Divorce help line under B1.**
- **The proposed rule:** a wife in the *'iddah* of a revocable divorce still inherits. `ux.md` O8 had it unsourced.
- **A source exists in the corpus:** `fiqh-as-sunnah.json` section 847 (C1090, titled "الزوجة المطلقة") states that a wife divorced by a revocable talak inherits if the husband dies before her *'iddah* ends. I read that passage for this plan.
- **Before it is shown:** it must be byte-extracted into `dalil.json` and confirmed by the reviewer for the Syafi'i position.
- **Until then:** "dalam masa iddah talak raj'i" is an **explicit B1 option** that leads to a soft stop: "Bercerai dan almarhum wafat dalam masa iddah? Konsultasikan." *(Review: `ux.md` said "Pilih Ya" while this plan said "Konsultasikan", so B1 had no defined answer.)*

### 5.5 Path length

Counted as answered screens (`ux.md` §4.8). The review screen and the Rupiah panel are not counted.

| Common family | Screens |
|---|---|
| Husband dies; wife, sons and daughters; parents dead; no wasiat | 9 |
| Widowed mother dies; children; wasiat ⅓ to a mosque | 10 |
| Young husband dies; wife, 2 daughters, both parents alive | 8 |
| Wife dies; husband, 1 daughter, only her mother alive, 1 full brother | 10 |
| Unmarried person, no children; only the mother; 2 full sisters + 1 paternal brother | 12 (13 with a wasiat) |

**Target ≤ 12.** If seniors find the worst path too long, merge E1–E3 into one "Saudara" screen to bring it to 10–11. Test that with 5 users aged 60+ on a mid-range Android before choosing (`ux.md` O10).

**Rarer families (added in review).** These are counted by hand from the revised tree (§5.2, §5.7); M2 replaces them with a test count. The common path #5 above drops from 12 to 10, because a never-married male deceased is no longer asked C1 and C3.

| Family | Screens (revised tree) | Draft |
|---|---|---|
| Never-married man, parents and grandparents dead, only 2 uterine siblings | 14: A1–A3, B1, D1, D3, E1–E3, F1–F3, F5, G1 | 15 |
| No heirs at all | 14, ending at E-TANPA-AHLI-WARIS (F4 replaces G1) | 16–18, with no defined end |
| Any family with a difference of religion | +1 (A3a) and +1 per selected group, so +2 to +8 | uncounted |
| Each predeceased child | 3 screens (sex → grandchildren → C4b) instead of 1 | — |
| Never-married **woman** | +2 (C1 and C3 stay: her children born outside marriage inherit from her, KHI 186) | — |

If these run long in the moderated test, the first merge is F1–F3 into one "Kerabat laki-laki dari pihak ayah" screen with three rows.

### 5.6 Answer model

- The answer object (`ux.md` §4.9) holds counts, booleans and flags: no names, ages, addresses or free text. Amounts sit in a separate object.
- The engine is a pure function `(answers, ruleset) → result`.
- **Required property** (`architecture.md` §6.6), tested on seeded random families: answering only the questions the tool asked gives exactly the same result as entering the full family. Skipping questions can never change an answer.
  - **Review:** the draft's own skip table broke this property (§5.1). The test therefore runs **per ruleset**, including the comparison variants.
  - It samples every relative type **independently**, including blocked siblings of every line and beyond-depth relatives (which must refuse).
  - It is a **CI gate before M2 work starts**.
- **The killer answer (A3 k6) is not part of the answer object** (review). It routes straight to E-BUNUH and is never serialised.


### 5.7 Questionnaire changes from the review (these supersede `ux.md` §4.3 where they differ)

**Node changes.**

| Node | Change | Why (review issue) |
|---|---|---|
| A1 | New option "Orang tua/keluarga saya yang masih hidup (simulasi)". It runs the questionnaire in the third person ("jika Bapak/Ibu wafat"), and the report is stamped "Simulasi". | A common user, an adult child planning for living parents, had no option. |
| A3 k3–k5 | "Hilang", "dalam kandungan" and "wafat bersamaan" now ask **who** (a role picker). The refusal is decided **after** the family is entered: refuse only if `couldAffectOutcome(role)`, otherwise show a note. k4's copy no longer asks the user to judge heirship ("yang bisa menjadi ahli waris"). k6 (killing) and k7 (khuntsa) stay as immediate refusals. | A brother out of contact, when there is a son, refused the whole family. |
| A3 k8, k9 | New light options: "ada anak tiri yang diasuh almarhum"; "ada istri/suami atau anak dari pernikahan yang tidak dicatat (nikah siri)". They feed notes only: SEMA 7/2012 Kamar Agama 19 (stepchild); SEMA 3/2023 via Buku II 2026 (i) and the itsbat note (R9, R9b). | The D4 notes for these relatives had no node, so they could never fire. |
| A3a | New, shown if k1 (religion) is ticked. A multi-select of relationship groups that had someone of another religion **at the time of death**. The "berapa yang Muslim?" follow-up appears only after the counts of the selected groups. | Religion nodes existed only for the spouse, children and parents. |
| A3b | New, shown if k2 (adopted child) is ticked: how many; the sex of each; adopted by court order (KHI 171(h)); any voluntary wasiat to them (combined ⅓ cap, R8). | The engine's ceiling needs the sex and count, and §5.2 promised these questions but the node table had none. |
| B1 | Options: "Ya, satu" · "Ya, lebih dari satu" · "Bercerai, almarhum wafat dalam masa iddah talak raj'i" (soft stop) · "Tidak, pernah menikah" · "Tidak, belum pernah menikah". Copy for a female deceased: "Ya, suami masih hidup". Help: "Termasuk pernikahan yang tidak dicatat (nikah siri)". | Copy for a female deceased was missing; the 'iddah answer was undefined; never-married was asked about children. |
| B1b | New, if married now or before: "Pernah ada istri/suami lain yang wafat lebih dulu atau bercerai?" Yes → the fractions are computed, and the rupiah panel refers harta bersama to the court (`harta_bersama_rumit`, D18). | The D4 refusal for an earlier spouse had no trigger. |
| C1 | Help: "Termasuk anak dari pernikahan sebelumnya dan dari pernikahan yang tidak dicatat. Anak tiri dan anak angkat tidak dihitung di sini." Skipped (with C3) only for a **male** deceased who was never married. | Children of an earlier marriage are the commonest omission. A woman's children born outside marriage inherit from her (KHI 186), so her C1 stays. *The critic proposed skipping C1/C3 for every never-married deceased; that part is rejected.* |
| C4 → three screens (sex, grandchildren, C4b) | Three screens: the predeceased child's sex → their living children L/P → C4b "Ada di antara cucu ini yang juga wafat lebih dulu dan meninggalkan anak?" Yes → E-KERABAT-JAUH. Then "Ada anak lain yang wafat lebih dulu?" | C4 combined a choice, two steppers and a repeat, against the one-thing-per-screen rule; great-grandchildren were undetectable. |
| E2, E3, E4 | Shown by `couldAffectOutcome` (§5.1). E4 counts Muslim siblings only. | The blocker. |
| F1–F3 | Each split into "Ada?" → "Berapa?" (the second only if yes). | A choice plus a stepper on one screen. |
| F5 | New, before F4 and only while no residuary is known: "Ada kerabat laki-laki lain dari garis ayah, misalnya cucu dari saudara laki-laki, atau paman/sepupu ayah?" Yes → E-KERABAT-JAUH. | Beyond-depth male agnates were silently dropped. |
| F4 | Its examples exclude relatives already entered (a predeceased daughter's children are entered at C4 and never reach F4). Shown only when no fard-holder other than a spouse is known. "Tidak" with no heirs at all → E-TANPA-AHLI-WARIS. | F4 sent KHI-computable families to E-DZAWIL; no-heirs had no end. |
| G1 | Multi-select: "Ada, untuk orang lain atau lembaga" · "Ada, untuk ahli waris" · "Tidak ada" · "Tidak tahu". | A bequest to a mosque **and** to an heir could not both be entered; the engine takes an array (R15). |
| G2 | New, if "untuk ahli waris": which heir (a role picker from the heirs entered). | A consented bequest could not be attributed. |
| G3 | Options add "Lebih dari sepertiga (misalnya setengah atau seluruh harta)". | The "> ⅓" trigger for G4 was otherwise reachable only through the rupiah panel. |
| G4 | Singular wording when there is one heir. Skipped only when there is no heir (→ E-TANPA-AHLI-WARIS). *(The critic proposed skipping G4 when there are fewer than 2 heirs; with one heir, that heir's consent still decides a bequest above ⅓, so that part is rejected.)* | — |
| Rupiah panel | Amount fields use `inputmode="numeric"`, dot thousands separators as you type, a "juta" helper (× 1.000.000), and an echo in words ("Rp 120 juta"). When a wasiat value entered here exceeds ⅓ of the estate after debts, the panel re-asks G4 consent. With several wives' pools or an earlier spouse, harta bersama is not computed (D18). | Unspecified for seniors; the panel had no consent step. |
| Progress | Named sections without a total. | "Bagian n dari 6" changed its denominator. |
| Text summary | "Salin ringkasan teks" carries rupiah only when "Sertakan nilai rupiah" is ticked, the same opt-in as the link. | The WhatsApp text leaked amounts by default. |

**"Tidak tahu" per node (D15).**

| Node | "Tidak tahu" allowed? | Effect |
|---|---|---|
| A1, A2, A3, A3b court order | No | These decide the route or the sex. The page explains how to find out. |
| B1, C1, C3, D1, D3, E1–E3, F1–F3, F5 (existence or count of an heir) | Yes | The engine solves "ada" and "tidak ada" (for counts, 0 / 1 / 2+). If the shares differ, the report shows **both outcomes side by side** under "Perlu dipastikan: …". With more than one such unknown, it routes to "konsultasikan" rather than printing a grid. |
| A3a, the religion counts | Yes | Same as above. Both outcomes are shown. |
| G1, G3 | Yes | The report shows the shares without the wasiat and notes that a wasiat of up to ⅓ would come off first. |
| G4 | "Belum dibicarakan" | Both outcomes are shown (as in `ux.md`). |
| C4b, F4 | Yes | Treated as a possible heir. F4 "tidak tahu" with no fard-holder other than a spouse → "konsultasikan". |

The draft's example "Jawaban 'Tidak tahu' pada C3 dianggap 'Tidak'" is withdrawn. It would have hidden KHI 185 grandchildren in the court column.
---

## 6. The report: "Perkiraan Pembagian Waris"

**Rules** (`ux.md` §5.1, `architecture.md` §7.1):
- **Built from templates only.** Every sentence comes from a reviewed `RuleNote` keyed by the engine's rule ids, and every dalil comes from a fixed `dalil.json` record. Questionnaire and exit-page strings follow the same rule (D10): no bare "QS"/"HR" text.
- **No absolutes in copy (review).** The draft's "Suami atau istri selalu mendapat bagian" (B1) and "Ayah dan ibu selalu mendapat bagian" (D1) are false for a non-Muslim or barred relative. They become "… tidak terhalang oleh kerabat lain, kecuali bila berbeda agama atau ada penghalang". E3's copy no longer depends on the ruleset. No LLM runs, so "every Islamic reference is retrieved, never generated" holds in production, and each report costs Rp 0.
- **Computed in the browser.** Once the page has loaded, it makes no further network request.
- **The fraction is the legal share.** Percent and rupiah are conveniences.
- **The second column appears only for heirs whose share differs** (D2). It carries the switch that caused the difference, e.g. "Hasil ini berbeda dari fikih klasik karena yurisprudensi MA 86 K/AG/1994 (anak perempuan menghijab saudara)". This list is computed by re-solving with each switch flipped (`engine.md` §12.1).

**Sections** (same order on screen and in print):

| # | Section | Content |
|---|---|---|
| 0 | Kepala | **Title (changed in review, D16):** "Perkiraan Pembagian Waris", subtitled "berdasarkan jawaban Anda"; "Simulasi Pembagian Waris" for the planning paths. The draft's "Laporan Pembagian Waris", with an answer code and a version stamp, read like an official document. **Also:** the date, "Kolom utama: Menurut fikih mazhab Syafi'i" (per D2), a short answer code (e.g. `W1-7K3Q`) so two printouts can be matched, the draft chip, and the label "Dibantu AI, bukan fatwa otoritatif, bukan penetapan pengadilan". |
| 1 | Ringkasan | One sentence ("Harta waris dibagi kepada 4 ahli waris; 2 kerabat terhalang"). Then a table: heir, count, fraction in figures and words, percent, rupiah (once the panel is filled), and a "Dasar ›" link. 'Aul and radd show the change ("⅛ → 1/9, dikurangi bersama karena 'aul"). On phones it becomes one card per heir; the core numbers never need horizontal scrolling. |
| 2 | Diagram | (a) the shrinking bar with real amounts (only with rupiah); (b) the estate bar, with a pattern + label + fraction per heir; (c) the family tree with share chips and hatched blocked nodes. Each diagram is a `<figure>` with a caption in words and a "Lihat sebagai tabel" toggle. |
| 3 | Yang tidak mendapat bagian, dan mengapa | Blocked heirs (who blocks them, and the rule); non-heirs (anak angkat, beda agama) with the way open to them (hibah, wasiat; the D8 ceiling); groups never asked about ("tidak ditanyakan karena …"). Every group ends with the QS 4:8 line: "Mereka tetap keluarga …". |
| 4 | Dalil untuk setiap bagian | One 48px disclosure row per heir: Arabic (≥ 24px on screen, 16pt in print), the Indonesian meaning with its exact source label, and a citation chip linking to the passage. Collapsed on screen, expanded in print. Shared dalil appear once. |
| 5 | Catatan metode | The assumptions made from the answers. The fikih-vs-KHI table, for the differing heirs only. The D7 radd note. "Perlu dipastikan" items. The engine version and the date the rules were last reviewed. |
| 6 | Langkah berikutnya | A checklist: (1) settle debts and the wasiat; (2) a family musyawarah, where everyone knows their share first and any gift between heirs is free and written down (KHI 183). **Fixed line (review):** "Ahli waris yang belum dewasa diwakili wali yang ditetapkan hakim (KHI 184); bagiannya tidak dilepaskan dalam kesepakatan" (with UU 1/1974 Ps. 48, 52, and a QS 4:10 card once it is extracted); (3) something for the relatives, orphans and poor who are present (QS 4:8); (4) proof of heirship: a *surat keterangan ahli waris*, or a *Penetapan Ahli Waris* at the Pengadilan Agama with **every** heir joined (SEMA 1/2017 C.2; Permen ATR/BPN 16/2021 Ps. 111); (5) farmland under 2 ha kept whole where possible (KHI 189); MUI's 1984 recommendation on small inherited land, which says keep it whole and use it together, or let an heir who can afford it buy the others out, or sell first to the neighbours (D1); (6) if there is no agreement, mediation, then the Pengadilan Agama (KHI 188); (7) ask an ustadz about items marked "Perlu dipastikan"; (8) if an heir died later, "Hitung untuk beliau ›". |
| 7 | Penutup | Always printed: "Laporan ini disusun dengan bantuan AI dan dihitung otomatis … Bukan fatwa dan bukan penetapan pengadilan. Dalil diambil dari kitab sumber; sebagian belum ditinjau ustadz." and "Jawaban Anda diproses di perangkat ini dan tidak disimpan di server kami." |

**When the engine refuses**, the report shows no numbers: only the reasons, each with its rule note, and where to ask.

**Print and PDF.**
- "Cetak / Simpan sebagai PDF" (56px) calls `window.print()`. The VM has no server PDF engine (L3).
- A4 portrait; body ≥ 12pt; Arabic 16pt.
- The patterns survive black-and-white printing, and dalil blocks are never split across pages.
- Target: case 3 fits on 3 A4 pages, checked on a CI print-media screenshot, not on the laptop.
- **Share** (D9): "Salin tautan laporan" (link in the fragment) and "Salin ringkasan teks" (plain text for WhatsApp, including the disclaimer line). **Both carry rupiah only when "Sertakan nilai rupiah" is ticked** (review).

---

## 7. Engine: spec summary, modes, test coverage

The full spec is **`engine.md`**. It is written to be implemented directly in TypeScript under `belajar/src/lib/waris/` (`architecture.md` §5.2).

### 7.1 What it does

```
answers ─► scope check ─► estate ─► eligibility ─► KHI substitution ─► exclusion (hajb)
        ─► named special cases ─► fixed shares ─► residuaries ─► base + 'aul
        ─► radd / Baitul Mal ─► whole units per person ─► fractions → % → Rp
        ─► Result { shares, blocked, adjustments, trace[rule ids], switchesUsed }  or  { rujuk: reasons }
```

| Stage | What happens | Source |
|---|---|---|
| Arithmetic | Exact rationals over `bigint`, never floats. The classical integer table is derived from the fractions and asserted equal. With fixed shares alone the base is one of {2, 3, 4, 6, 8, 12, 24}; the grandfather cases add bases such as 18 and 36. 'Aul may only raise 6 → 7–10, 12 → 13/15/17 and 24 → 27. Anything else fails loudly. | `engine.md` §1, §9 |
| Input | A **structured family**, not flat counts. Each child who died first carries their own children (needed for KHI 185 per stirpes); spouses carry harta-bersama pools by period, for several wives. Depth stops at grandchildren, grandparents, a brother's sons and paternal cousins. | `engine.md` §2 |
| Estate | Harta bersama ½ to the surviving spouse (per household and period when there are several wives) → the deceased's own property → last-illness and funeral costs → debts → wasiat ≤ ⅓ (more, or to an heir, only with every heir's consent) → the court column's wasiat-wajibah ceiling | `engine.md` §3, §11.4 |
| Eligibility | Checked before exclusion. An ineligible relative (different religion, killer, adopted child, stepchild) **neither blocks nor reduces anyone**. | `engine.md` §4 |
| Exclusion and residuaries | One `blockers()` table, shared with the questionnaire's `couldAffectOutcome()` (review: not `couldInherit()`). Residuaries are ranked by direction → degree → strength. | `engine.md` §6, §7 |
| Named cases | 'Umariyyatain, musytarakah, akdariyyah (now requiring S = 1), and the grandfather with siblings (Zaid's method), each with its own rule id so the report can name it | `engine.md` §8 |
| Money | Integer rupiah, largest remainder; the total always equals the estate | `engine.md` §14 |
| Trace | Every step emits rule ids (`engine.md` §15). The report, the visuals and the dalil links are all rendered from them. | `architecture.md` §5.1 |

### 7.2 Modes (rulesets), with this plan's proposed values

| Switch | Fikih column (`klasik-syafii`) | Court column (`standar-indonesia`) | Status |
|---|---|---|---|
| `hartaBersama` | on | on | D6; reviewer R1 |
| `killerBarred` | any killing | final verdict only | Engine keeps both; the **UI refuses** any reported killing (D4) |
| `substitution` | none | grandchildren only (KHI 185, SEMA 3/2015) | — |
| `substitutionCap` | n/a | "sederajat": a son's slot is re-weighted to a daughter's share when only daughters are alive. The only reading with an MA decision behind it, 109 K/AG/2016, seen only as listed on PA Bojonegoro's court website. Two other readings are now values too: `per_kepala` (Tarjih checks each substitute person against the sederajat heir) and `none` (PA Kotabumi recommends it only as a reform). They give different numbers (`khi-pengganti-anakpr-cucu3-perkepala`). | Reviewer R6 chooses among three |
| `daughtersExcludeSiblings` | off | on (86 K/AG/1994; 122 and 184 K/AG/1995; 19 PK/AG/2014; 47 K/AG/2017) | — |
| `uterineExcludedBy` | classical (also excluded by the grandfather and by a son's children) | **classical** (review; was KHI 181 literal). KHI 182 has the same wording for full sisters and the engine does not read it literally, so reading only 181 literally was inconsistent. `khi181` stays a comparison variant. | Reviewer R7 |
| `fatherWithDaughters` | ⅙ + residue | ⅙ + residue | Reviewer R5 (KHI 177 read literally gives ⅙ then radd) |
| `residue` | radd to non-spouses; a spouse alone → "sisa: konsultasikan" | radd to non-spouses (rests on the superseded Buku II 2013 §8(h)); a spouse alone → "sisa: konsultasikan" | D7 |
| `dzawilArham` | tanzil in the code; the **UI refuses** in v1 | none | D4 |
| `musytarakah` | on (al-Umm §559) | on (the KHI is silent) | Reviewer R4 |
| `jadd` | Zaid; 'Umariyyatain with the grandfather gives the mother ⅓ of the whole (al-Hawi 8:121, external, to pin) | Zaid (KHI silent) | Reviewer R4, R17; the result is stamped "Perlu konfirmasi" |
| `wasiatWajibahAdopsi` | off (MUI 1984: voluntary only) | ceiling ("plafon", ⅓ taken first) | D8 |
| `wasiatWajibahNonMuslim` | off (MUI 5/2005) | **as-if illustration (`ma_16K2010`)**, the method of 16 K/AG/2010 and 51 K/Ag/1999 (review; was "plafon") | D8 |

A third profile, `klasik-syafii-asal` (the original Syafi'i position: residue to the Baitul Mal, no dzawil arham), and the variants `substitution=luas`, `uterineExcludedBy=khi181` and `wasiatWajibahNonMuslim=plafon` exist **for tests and comparison only**. The questionnaire never offers them (`engine.md` §12.2).

**Where `engine.md` and `standard.md` disagree, and what this plan proposes:**
- **Radd to a spouse:** none in either column (D7).
- **Number of the grandchild-substitution decision:** use **86 K/Ag/2001**, as printed in the MA's own *Himpunan Yurisprudensi 2018*. `standard.md` §3.3 has "68".
- **Date of 86 K/AG/1994:** three sources give three dates. Quote the kaidah, not the date, until the decision itself is read (`engine.md` §12.3).

### 7.3 Test-vector coverage

`test-vectors.json` holds:
- **87 vectors and 183 expectations** (after the review; the draft had 80 and 164):
  - **74 `sourced`** (the source prints the numbers **for that ruleset**);
  - **84 `rule`** (the source states the rule, and the numbers follow mechanically);
  - **25 `computed`** (derived from the spec; the reviewer must confirm them).
- **54 vectors** with at least one sourced expectation.
- **Correction (no overclaiming).** The draft's "95 sourced" counted 21 court-column answers whose only sources are classical textbooks:
  - 16 for the grandfather with siblings, Akdariyyah and musytarakah, where the KHI is silent;
  - 4 radd-with-spouse answers, which rest on D7's default;
  - 1 father-with-daughter answer, which is open (R5).

  Those are now `rule` (20) or `computed` (1). The review also added 7 vectors and corrected 6. All of it is listed in `test-vectors.json` `reviewLog`.

Every expectation a pure solver can compute was checked against a separate exact-fraction Python solver, with **0 mismatches**. The estate, harta-bersama and rupiah cases were checked by hand (`engine.md` §16.2). Of the 84 vectors carrying both rulesets, **19** give different amounts.

Counts of vectors and expectations by topic. A vector can carry several topics, so the rows overlap. The counts were computed for this plan from the file.

| Rule family (vector topics) | Vectors | Sourced / rule / computed | Main sources |
|---|---|---|---|
| Grandfather with siblings (`jadd-maal-ikhwah`, incl. 'Asyriyah, Mukhtasharah, Kharqa', the ⅙ floor) | 16 | 13 / 16 / 4 | Khairuddin 2020 pp. 87–102; Fath al-Qarib §117; al-Umm §556; one blog (Akdariyyah table) |
| Exclusion (`hajb-hirman`) | 16 | 1 / 25 / 8 | Fath al-Mu'in §34; Fath al-Qarib §117; Khairuddin pp. 26–29; Ibn Kathir 4:11 |
| 'Aul: 6→7, 8, 9, 10; 12→13, 15, 17; 24→27 | 11 | 22 / 0 / 0 | NU Online (quoting Zuhaili, *al-Mu'tamad* IV:438–441); Khairuddin; Fiqh as-Sunnah §852–853; MAIS |
| Radd (`radd`, `radd-spouse`) | 10 + 6 | 13 / 9 / 1 and 6 / 8 / 0 | Khairuddin pp. 54–65; MAIS; Fath al-Mu'in §34; MA *Buku II* 2013 (superseded) |
| Baitul Mal (original Syafi'i) | 3 | 3 / 6 / 0 | MAIS (quoting al-Nawawi); Fath al-Mu'in §34 |
| Named cases ('Umariyyatain 4, musytarakah 4, `special-case` 9) | 4 / 4 / 9 | 4/4/0 · 4/4/0 · 8/10/0 | Fath al-Mu'in §34; al-Umm §559; al-Hawi 8:121 (external); MAIS; Khairuddin |
| Residuaries (bin-nafs, bil-ghair, ma'al-ghair, father ⅙ + residue) | 2 / 2 / 2 / 1 | 2/1/1 · 4/0/0 · 2/1/1 · 1/0/1 | Fath al-Qarib §117–118; Khairuddin; Bukhari 6742 |
| Reduction (`nuqshan`, `takmilah`) | 6 / 1 | 2/10/2 · 1/0/1 | Fath al-Qarib; Fiqh as-Sunnah; Ibn Kathir 4:11; Bukhari 6736 |
| Dzawil arham (tanzil) | 5 | 4 / 1 / 5 | Tuwaijri IV:443; Dakwah.id; MA *Buku II* |
| KHI: daughters exclude siblings | 4 | 3 / 4 / 1 | 122 K/AG/1995 (KY); MA *Buku II*; Bukhari |
| KHI 185 substitution + cap | 3 + 2 | 4/1/5 · 3/1/3 | Tarjih; PA Kotabumi; 2/Yur/Ag/2018 |
| Wasiat wajibah (adopted 1, non-Muslim 2) | 3 | 1 / 4 / 2 | 16 K/AG/2010 (official MA sheet); KHI 209; Khairuddin pp. 135–136 |
| Harta bersama, several wives | 3 + 2 | 1/2/2 · 0/3/0 | 16 K/AG/2010; MA *Buku II* 2026 pp. 836–838 |
| Estate order, wasiat ⅓ | 2 + 1 | 0/4/0 · 0/2/0 | KHI 175, 195; Fath al-Qarib §118; Bukhari 2742 |
| Barriers (religion, killer) | 2 + 1 + 1 | 1/2/2 · 0/2/0 · 0/2/0 | Bukhari 6764; Fath al-Qarib §116; KHI 173 |
| Rupiah rounding | 4 | 1 / 5 / 2 | `engine.md` §14; Tarjih (its own example truncates rupiah) |
| Refusals (haml, mafqud, a large wasiat wajibah) | 3 | 0 / 6 / 0 | Bulugh 1106; Khairuddin; MA |
| Munasakhat, first stage (was a refusal) | 1 | 0 / 2 / 0 | Buku II 2013 §10; Khairuddin pp. 81–85 |

**Source mix** (citations across vectors):
- Khairuddin 2020: 38. Its six misprints are logged in `knownSourceErrors`, so nobody "fixes" the engine to match them.
- Fath al-Mu'in: 14
- MA *Buku II*: 12
- MA yurisprudensi: 10
- Fath al-Qarib: 10
- MAIS e-Faraid: 8
- NU Online: 8
- KHI: 6
- Bukhari: 5
- Others (Dakwah.id, Fiqh as-Sunnah, Tuwaijri, SEMA, PA Kotabumi, Bulugh, and five single citations): 21

**Gaps the M1 work must close:**
1. Nine case-study vectors (§4).
2. The **legal-layer topics rest on `rule` status, not on printed examples.** Harta bersama has 1 sourced example; several wives, estate order, wasiat and barriers have 0. The KHI/PA reviewer confirms these.
3. A pro-rata cut of several bequests over ⅓ (EQ7) has no opened source. 'Umariyyatain with the grandfather (EQ10) now has one, al-Hawi al-Kabir 8:121 quoting al-Shafi'i, but it is external and must be pinned (Appendix C).
4. Heavy reliance on one textbook: add a kitab page (al-Rahabiyyah or *al-Mu'tamad*) for the Akdariyyah and grandfather vectors before launch (`engine.md` §17).

---

## 8. Dalil table: rule → corpus record

**How to read the table.**
- **Each row** is one rule the engine can trace (`engine.md` §15).
- **Rule:** the `dalil.json` rule record.
- **Strongest:** the first record shown on the report line.
- **Status:**
  - `found`: the strongest dalil is in the corpus;
  - `partial`: part of the rule is missing or disputed;
  - **Gap**: corpus text located but not yet extracted into `dalil.json`;
  - **External**: not in the corpus at all;
  - **Legal**: grounded in the KHI, a SEMA, yurisprudensi or an MUI fatwa, quoted from a pinned PDF under rule B9, not a dalil.

**Display rules.**
- **Muslim numbers** are canonical (local 4141 = 1615a).
- **Bulugh entries** are cited by the primary source they name (D10).
- **Qur'an Arabic** comes from the pinned Tanzil file.

| Engine rule ids | Rule (`dalil.json`) | Strongest | Supporting | Status / gap |
|---|---|---|---|---|
| `estate.utang` | `R-debt-wasiyya-first` | `Q-4-11`, `Q-4-12`, `F-ALUMM-572`, `T-IK-4-11-dayn` | `H-BUKHARI-6731`, `H-MUSLIM-1619e` (both: the estate is for the heirs; **neither states the order**, now noted on both records) | found; the order rests on the ayat plus reported ijma'. Do not lead with 'Ali's marfu' report (criticised via al-Harith). |
| `estate.biaya` | `R-tajhiz` | `F-FMUIN-11-tajhiz` | — | partial. **External:** no corpus text puts the funeral *before* debts (`dalil.md` E4); cite **Legal** KHI 175(1). |
| `estate.wasiat`, `estate.wasiat_dibatasi_sepertiga` | `R-wasiyya-third` | `H-BUKHARI-2742`, `H-MUSLIM-1628a` | `H-BUKHARI-2743`, `H-MUSLIM-1629`, `H-BULUGH-1112`, `F-FQARIB-118-wasiyya` | found |
| `estate.wasiat_ahli_waris_tanpa_persetujuan` | `R-no-wasiyya-heir` | `H-BULUGH-1114` (cite Abu Dawud 3565, Tirmidhi 2120, Ibn Majah 2713 as Bulugh names them) | `F-FQARIB-118-wasiyya`, `F-FMUIN-33-heir-consent` (the consent exception); `T-IK-2-180-naskh` | partial. The addition "unless the heirs wish" (`H-BULUGH-1115`) is *munkar*: never shown. The consent rule rests on fiqh + KHI 195(3). |
| `estate.harta_bersama`, `…_poligami` | — | — | — | **Legal:** KHI 96(1), 190; 32 K/AG/2002; MA *Buku II* 2026 pp. 836–838 |
| `estate.wasiat_wajibah`, `khi.ww_*` | `R-ext-mui-khi` | — | — | **Legal:** KHI 209; 1/Yur/Ag/2018; 16 K/AG/2010; SEMA 7/2012, 3/2015, 3/2023. Fiqh as-Sunnah 865–866 is *Egyptian* law and is not used. |
| `mani.beda_agama` | `R-barrier-religion` | `H-BUKHARI-6764`, `H-MUSLIM-1614` | `H-BULUGH-1096`, `H-BULUGH-1098`, `Q-4-141` (show as "dalil yang dikutip MUI": the ayah itself is not about inheritance), `F-FQARIB-116-barriers` | found; + **Legal** Fatwa MUI 5/2005, KHI 171(c) |
| `mani.pembunuh` (refusal page only) | `R-barrier-killer` | `F-ALUMM-550-killer` | `H-BULUGH-1107` (grading note required), `F-ALUMM-903-umar`, `F-FQARIB-116-barriers`, `F-FSUNNAH-844-mawani` | partial; + **Legal** KHI 173 |
| `mani.anak_angkat` | — | — | — | **Gap:** QS 33:4–5 (cited by the 1984 fatwa). **Legal:** Fatwa MUI Adopsi 1984; KHI 171(h), 209 |
| `mani.anak_luar_nikah` (note only) | — | — | `S-FIQH-AS-SUNNAH-863` (pointer) | **Gap:** excerpt to cut. **Legal:** Fatwa MUI 11/2012, KHI 186 |
| `mani.anak_tiri` (note only) | `R-heirs-list` | `F-FQARIB-116-heirs` (the heir list does not include a stepchild) | — | found; + **Legal** SEMA 7/2012 |
| `fardh.suami_*`, `fardh.istri_*`, `nuqshan.suami`, `nuqshan.istri` | `R-spouses` | `Q-4-12` | `H-BUKHARI-6739`, `F-FQARIB-117-furudh` | found |
| `fardh.anak_pr_*` | `R-daughters` | `Q-4-11`, `T-IK-4-176-two-daughters` | `F-FSUNNAH-840-sad-rabi`, `F-FQARIB-117-furudh` | partial. Two daughters' ⅔ via the Sa'd report is **External** (E1); use the 4:176 analogy. |
| `fardh.cucu_pr_*`, `fardh.cucu_pr_1_6_takmilah` | `R-sons-daughter-sixth` | `H-BUKHARI-6736` | `H-BULUGH-1097`, `F-FQARIB-117-furudh` | found |
| `fardh.ayah_1_6`, `asabah.ayah_fardh_dan_sisa`, `nuqshan.ayah` | `R-parents` | `Q-4-11` | `H-BUKHARI-6739`, `F-FQARIB-117-furudh` ("بنتا وأبا") | found |
| `fardh.ibu_*`, `nuqshan.ibu`, `umariyyatain` | `R-mother-third-sixth` | `Q-4-11`, `T-TB-4-11-ikhwa-two` | `F-FMUIN-34-umariyyatain`, `F-FQARIB-117-furudh` | found. **Gap:** the Ibn Kathir 4:11 sentence that *blocked* siblings still reduce the mother (needed for E4). |
| `fardh.kakek_1_6`, `jadd.*` | `R-grandfather` | `F-FQARIB-117-furudh`, `F-FMUIN-34-jadd-like-ab` | `H-BUKHARI-6738` (Abu Bakr's view, shown as the other opinion), `S-AL-UMM-556` | partial. **Gap:** an al-Umm §556 (C805) excerpt for Zaid's muqasamah. Never use `H-BULUGH-1101` (da'if), nor `H-BULUGH-1110` (da'if) as the reason for following Zaid. **External (review):** 'Umariyyatain with the grandfather (mother ⅓ of the whole) rests on al-Hawi al-Kabir 8:121; `F-FMUIN-34-jadd-like-ab` is a summary sentence and is not read as an exhaustive list. |
| `fardh.nenek_1_6` | `R-grandmother` | `H-BULUGH-1103` (hasan; cite Abu Dawud 2895) | `F-FQARIB-117-furudh` | partial. Abu Bakr / al-Mughira report **External** (E2). |
| `fardh.sdr_pr_*`, `fardh.sdr_pr_seayah_1_6_takmilah` | `R-siblings-kalala` | `Q-4-176` | `H-MUSLIM-1618a`, `H-BUKHARI-6744`, `H-MUSLIM-1617a` | found |
| `fardh.seibu_*` | `R-maternal-siblings` | `Q-4-12`, `T-IK-4-12-kalala` | `F-FQARIB-117-furudh`, `T-TB-4-12-kalala` | found (that 4:12 means uterine siblings is from tafsir) |
| `hajb.hirman` (siblings) | `R-hajb-siblings` (statement amended: a son's daughter also excludes uterine siblings) | `T-IK-4-176-father-blocks`, `T-TB-4-11-father-blocks`, `Q-4-176` | `F-FQARIB-117-hajb`, `F-FMUIN-34-hajb` | found as reported consensus ("para ulama sepakat"); there is no marfu' hadith |
| `hajb.hirman` (grandparents, grandchildren, nephews, uncles, cousins) | `R-hajb-grandparents` (statement amended: the father also excludes the father's mother), `R-asabah-order` | `F-FQARIB-117-hajb`, `F-FMUIN-34-hajb`, `F-FQARIB-116-asabah`, `F-FMUIN-34-asabah-order` | — *(review: `H-BULUGH-1108` removed; its tahqiq story is about wala', so it is re-grounded under `R-wala`)* | found |
| `asabah.bin_nafs`, `hajb.istighraq` | `R-furudh-then-asabah` | `H-BUKHARI-6732`, `H-MUSLIM-1615a` | `H-MUSLIM-1615c`, `H-BULUGH-1095`, `H-BUKHARI-6745` | found |
| `asabah.bil_ghair` | `R-2to1` | `Q-4-11`, `Q-4-176` | `F-FQARIB-118-asabah-bil-ghayr`, `H-BUKHARI-6739` | found (uterine siblings share equally, `Q-4-12`) |
| `asabah.maal_ghair` | `R-sister-asabah-maal-ghayr` | `H-BUKHARI-6736` (the Prophet's ruling via Ibn Mas'ud), `H-BUKHARI-6734` (labelled "putusan Mu'adh, atsar") | `T-TB-4-176-daughter-sister`, `H-BULUGH-1097`, `F-FMUIN-34-hajb` | found; the majority view (Ibn 'Abbas and Ibn az-Zubayr dissent) |
| `musytarakah` | `R-special-cases` | `T-IK-4-12-musytaraka` | `S-AL-UMM-559` | found as a khilaf case. **Gap:** an al-Umm §559 (C809) excerpt for the Syafi'i *tasyrik*. |
| `akdariyyah` | — | — | — | **External:** no corpus record (Khairuddin pp. 89–92 + a blog). Needs a kitab page. |
| `aul` | `R-awl` | `F-FMUIN-35-awl`, `F-FSUNNAH-852-awl-umar` | `S-FIQH-AS-SUNNAH-853` | partial: Companions' ijtihad; 'Umar's first case is only "ruwiya" (E3); + **Legal** KHI 192 |
| `radd.tanpa_pasangan`, `radd.semua` | `R-radd` | `F-FSUNNAH-854-radd-no-nass`, `F-FMUIN-34-radd-dzawil-arham` | `S-AL-UMM-552`, `S-AL-UMM-553`, `S-AL-UMM-555` | partial (no nass; khilaf on the spouse); + **Legal** KHI 193 |
| `baitul_mal` | `R-radd` (original position) | `F-FMUIN-34-radd-dzawil-arham` ("أصل المذهب") | `S-FATH-AL-QARIB-117` | found; + **Legal** KHI 191, SEMA 1/2022 |
| `dzawil_arham.tanzil` (v2) | `R-dzawil-arham` | `Q-8-75`, `Q-33-6`, `H-BULUGH-1104` | `H-BULUGH-1105`, `F-FSUNNAH-856-dzawil-arham`, `F-FMUIN-34-radd-dzawil-arham` | partial (khilaf) |
| `tashih`, `ikhtisar` | `R-calc-method` | `F-FMUIN-35-usul` | — | found (a method, not a dalil) |
| `khi.pengganti`, `khi.pengganti_batas`, `khi.anak_menghijab_saudara`, `khi.seibu_pasal_181` | `R-ext-mui-khi` | — | — | **Legal:** KHI 185, 181; SEMA 3/2015; 2/Yur/Ag/2018; 86 K/AG/1994; 109 K/AG/2016 (not yet read in full) |
| `khi.perdamaian` | — | — | `S-FIQH-AS-SUNNAH-864` (takharuj) | **Gap:** excerpt to cut; + **Legal** KHI 183 |
| Lesson and report text only | `R-women-inherit`; `R-obligation`; `R-gift-at-division`; `R-write-wasiyya`; `R-no-harm-wasiyya`; `R-asbab-nuzul`; `R-kinship-priority` | `Q-4-7`; `Q-4-13`, `Q-4-14`; `Q-4-8`, `H-BUKHARI-4576`; `H-BUKHARI-2738`, `H-MUSLIM-1627a`; `Q-4-12`, `T-IK-4-12-no-harm`; `H-BUKHARI-6723`, `H-MUSLIM-1616a`; `Q-8-75`, `Q-33-6` | — | found |
| Refusal pages | `R-newborn`; mafqud; khuntsa; gharqa | `H-BULUGH-1106`; `S-FIQH-AS-SUNNAH-860`/`861`; `-862`; `-843` | `F-FSUNNAH-859-pregnancy` | found / pointers (excerpts to cut) |
| Divorce in 'iddah | — | — | `fiqh-as-sunnah.json` §847 (C1090) | **Gap:** excerpt to cut + reviewer R14 |
| Not used | `R-learn-faraid` (E7); `R-wala` (historical) | — | — | **External** / out of scope |

**Gaps to extract in M1** (sources already located in `api/data/`):
- Ayat: QS 33:4–5, 4:34, 4:128, 49:10, 42:38, 2:188, 4:10, 60:8 (the last only if the reviewer wants it for case 11's tone line).
- Hadith: Bukhari 2586, 2587, 5986, 5987; Muslim 1623e; Bulugh local 649.
- Tafsir and fiqh: Ibn Kathir 4:11 (the mother-and-siblings sentence, and the *jahiliyyah* practice); al-Umm §556 and §559; Fiqh as-Sunnah §843, 847, 860–864.

**Still external** (`dalil.md` §7):
- E1 the Sa'd ibn ar-Rabi' report;
- E2 Abu Bakr and the grandmother;
- E3 'Umar's first 'aul;
- E4 the funeral-first order;
- E5 canonical Bulugh numbers;
- E6 the primary collections behind Bulugh;
- E7 "learn the fara'id";
- E8 Indonesian translations of Bukhari and Bulugh;
- E10 Zayd: husband + sister;
- E11 the newborn's wording;
- Akdariyyah.

---

## 9. Architecture, routes, privacy

The details are in **`architecture.md`**. What follows is the shape to approve.

### 9.1 Placement and routes

A second track in the same `belajar` container (L9), using the post-move layout:

| Route | Rendering | Content |
|---|---|---|
| `/belajar/{locale}/waris` | static | Track home with three doors (Pelajari · Contoh kasus · Hitung waris keluarga saya), the disclaimer and the draft status above the fold |
| `/waris/pelajaran/{slug}` | static, `dynamicParams = false` | Lesson. Server-rendered text; only the stage and the check run in the browser. |
| `/waris/kasus`, `/waris/kasus/{slug}` | static | Case list and case page. The numbers are computed by the engine at build time. |
| `/waris/hitung` | static shell + one client component | The questionnaire. No server action, no route handler, no `<form action>`. |
| `/waris/laporan` | static shell + client report | Reads the answers from memory, `sessionStorage` or the URL fragment |
| Unknown slug | 404 | Covered by the smoke test |

- **Slugs are Indonesian.**
- **Links:**
  - All in-module links go through the route move's link helper (`warisHref.*`), added after the move lands.
  - Lessons link to cases and to "Hitung keluarga Anda".
  - Every report line links to the lesson that explains its rule.
- **Hub card** "Ilmu Waris (Faraidh)" appears only after M2, with the draft chip. The module stays noindex and unlinked from the main site. Promoting waris on dakwah-lens.id is a separate decision after sign-off (`architecture.md` Q9).
- **D13 (review):** in production, `/waris/hitung` and `/waris/laporan` are unbuilt or behind a flag that is off until the fara'id reviewer has signed every `RuleNote`. A draft lesson is reading material. A report that prints rupiah shares is something families act on. The draft plan's M2.10 and its Gate pointed in opposite directions.

### 9.2 Content and dalil pipeline

**All files are new**, so nothing the in-flight agents are editing is touched:
- `belajar/pipeline/authored/waris.{dalil,rules,lessons,cases,glossary}.json` (written by people with Claude in chat);
- `belajar/pipeline/build_waris.py` and `validate_waris.py` (Python stdlib only);
- the generated `belajar/content/waris.json`;
- `belajar/src/content/waris-schema.ts`, which imports only `SourceRef` and `ReviewStatus` from `schema.ts`.

**The content rules** (`architecture.md` §3.2):
- Heir and rule ids come from the engine registry.
- No number shown to a learner is typed by hand.
- Every case stores the reviewer's answer as an oracle.
- Every engine rule id has exactly one reviewed `RuleNote`.

**Dalil bytes:**
- Qur'an from the pinned Tanzil file.
- Hadith and kitab text from `api/data/*.json`, by `citation_en` or `section_id`, with a sha256 per record.
- Shown spans are slices of those bytes, never retyped. A Bulugh span must exclude the editor's footnote.
- Fatwa and KHI quotes come from pinned PDFs (URL, sha256, page).

**Two pipeline tasks come first:**
1. **Move `build_dalil.py` and `ar.py` into the repo** as a pipeline stage. They live only in the session scratchpad today, which is temporary, so `dalil.json` cannot be rebuilt if the scratchpad goes (`dalil.md` §8 Q2).
2. **Extend `fetch.py`** beyond sura 1, and pin the QuranEnc files for surahs 2, 4, 8 and 33 in `sources.json` (`architecture.md` §4.1; `dalil.md` §8 Q3). The §8 gap ayat also need surahs 42, 49 and 60, which no researcher has fetched yet. Both are small commits made after the nahwu-sharaf library writers finish with those files.

### 9.3 Engine and questionnaire code

**Engine layout** (`architecture.md` §5.2):
- `belajar/src/lib/waris/` holds `registry`, `frac`, `types`, `estate`, `eligibility`, `substitution`, `hajb`, `furudh`, `asabah`, `special`, `adjust`, `distribute` and `solve`.
- `questionnaire/` holds `graph`, `machine` and `codec`.
- A server-only `content.ts` sits beside them.
- The engine has no dependencies and imports nothing from `content/`.

**The questionnaire** is a pure reducer (`useReducer`). The answers are its only state, and the question path is derived from them, never stored.

**Lint constraints.** The React Compiler lint rules are active (`purity`, `refs`, `set-state-in-effect` and others; `architecture.md` §8.4), and both the engine and the reducer satisfy them:
- the print date comes from a click event, not from render;
- storage and the fragment are read through `useSyncExternalStore`.

**Visuals.** CSS and inline SVG, plus the browser's Web Animations API for a few sequences.
- **Zero new npm dependencies.** Motion and Lottie are rejected (`architecture.md` §8.2).
- **Animations advance one step per tap**, following the existing pace setting.
- **Reduced motion.** The global CSS override does not reach animations started from JavaScript, so every `el.animate()` goes through one helper that checks the reduced-motion setting and the in-app toggle.

**Strings.** In `belajar/messages/waris/{id,en}.json`, merged in `i18n/request.ts`, with a key-parity test.

**Print rules.** In a waris-scoped `waris.css`. `globals.css` is not touched.

**Test vectors.** They move to `belajar/content/waris/test-vectors.json`, because the image build context is `belajar/`. A parity script fails CI if the docs copy and the belajar copy differ during the research phase.

### 9.4 Privacy

**Which answers are sensitive.** UU 27/2022 Pasal 4(2) classes these as *specific* personal data: children's data, personal financial data, and criminal records (https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-4). Religion and marital status are general personal data under Pasal 4(3) (`ux.md` §5.1).

**The design keeps all of it off our server:**

| Layer | What it does |
|---|---|
| Storage | Working answers stay in memory and `sessionStorage` (gone when the tab closes). `localStorage` is used only after "Simpan di perangkat ini", with a visible "Hapus". |
| Share link | Only in the URL **fragment**, never a query string (D9). Rupiah only if ticked, in the link **and** in the WhatsApp text summary (review). |
| No server path | No server code path under `waris/`. Lesson progress records only "lesson X done". A future account sync must exclude `belajar:v1:waris:*`. |
| Lint guard | Bans `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` and `EventSource` in `lib/waris/**` and `components/waris/**` |
| CSP | `connect-src 'self'` and `form-action 'self'`, already set |
| E2E check | A CI end-to-end run **fails on any POST, and on any request** other than static assets and `/belajar/api/me` |
| The killer answer | Used only to route to the refusal page. **It is not part of `QState`** (review: the draft's autosave stored every answer in `sessionStorage`), so it is never written to storage, a link, print or the text summary. The E-BUNUH page has no answer printout. |
| Analytics | None |
| Privacy page | Gets one line: "Kalkulator waris berjalan di peramban Anda; jawaban tidak dikirim ke server kami." |

---

## 10. Milestones and acceptance criteria

Sizes are the architecture estimates (S ≤ 1 day, M 2–3 days, L 4–8 days of agent work). **Reviewer hours are the critical path.**

**Order:** M0 ‖ M1 → M2 → (M3 ‖ M4) → Gate.

### M0. Decisions and sources (no code; can run now)

- You answer D1–D12 and name both reviewers (D3).
- The following are fetched and pinned (URL, sha256, page), or marked "not obtainable" with the product consequence written down:
  - the official KHI text (JDIH Kemenag / Badilag, or BPK https://peraturan.bpk.go.id/Details/293351/inpres-no-1-tahun-1991-penyebarluasan-kompilasi-hukum-islam);
  - the original SEMA 2/1994;
  - the official PDF of Fatwa MUI 11/2012;
  - the number of the DSN-MUI insurance fatwa;
  - the full texts of 86 K/AG/1994, 109 K/AG/2016 and 47 K/AG/2017;
  - MA *Buku II* 2026 on two points: the wasiat-wajibah ceiling and radd to a spouse. *(Review: the critic read pp. 844–848 and found no calculation rules, so both defaults rest on the superseded 2013 guide. Record that as the answer unless the KHI reviewer finds current guidance.)*
  - *(added in review)* al-Hawi al-Kabir 8:121 (EQ10); the MUI 1984 land recommendation (already downloaded, sha256 `0d1fa98c…3559`); UU 1/1974 Pasal 48 and 52; the Ijtima' V 2015 PDF (sha256 `7cf0d248…bbc`).
- **Accepted when** every item is either pinned or recorded as missing, and this plan is updated with the answers.

### M1. Engine, dalil pipeline, tests (L; reviewer 6–10 h)

Accepted when:
1. All 87 vectors pass for every implemented switch value. Skipped variants (`substitution=luas`) are listed by name, not silently ignored.
2. Invariant tests pass on 20,000 seeded random families per ruleset:
   - shares sum to exactly 1, or the Baitul Mal line is explicit;
   - every present relative is in exactly one of shares / blocked / ineligible;
   - a son ⇒ every sibling is blocked;
   - 2 : 1 holds inside every male–female residuary group;
   - the KHI 185(2) cap holds;
   - the result does not depend on input order.
3. A lint rule allows no float arithmetic in `lib/waris/**` outside display formatting, and no network call.
4. `build_dalil.py` is in the repo, and `build_waris.py` reproduces the `dalil.json` bytes. `validate_waris.py` exits 0:
   - Qur'an equals the Tanzil bytes;
   - every hadith and kitab sha256 matches;
   - every span sits on word boundaries;
   - there is no Arabic in Indonesian prose.
5. The §8 gap list is extracted into `dalil.json` and checked by the same script.
6. `assertWarisReferences()` passes: every engine rule id has a `RuleNote` draft citing at least one `dalil.json` record or a pinned legal source.
7. Twelve new case-study vectors are added (§4), and the docs/belajar vector parity check is green.
8. *(added in review)* The 7 review vectors pass: skip-rule regressions, Akdariyyah with S = 2, 'Umariyyatain with the grandfather, and the three KHI 185(2) readings. `munasakhat-tahap-pertama` computes the first stage.

### M2. Questionnaire and report (L; reviewer 4–6 h; waits for the route move and the senior-UX redesign to merge)

Accepted when *(rewritten in review so that every item is testable and the risky paths are covered)*:
1. **Completeness test (CI gate, before M2 work starts):** on at least 10,000 seeded families **per ruleset** (both columns and the comparison variants), answering only the asked questions gives the same result as the full family.
   - Every relative type, including blocked siblings of every line, is sampled independently.
   - The oracle families include beyond-depth relatives, which must refuse, and "Tidak tahu" answers, which must give both outcomes.
2. **Termination test:** no question is asked twice; every path ends at H or an exit.
3. **Path length:** the five common families of §5.5 finish in ≤ 12 screens (13 with a wasiat), counted by a test. The rarer families of §5.5 are counted and reported (no target).
4. **Refusal routing test:** each A3 option, each engine reason and each per-column refusal reaches the right page. A court-only refusal still shows the fikih column.
5. **Privacy test:**
   - after answering k6, `sessionStorage`, `localStorage` and `location.hash` contain no k6 value;
   - the printed E-BUNUH page has no answer summary;
   - the text summary and the link contain no rupiah unless the box is ticked.
6. **Playwright end-to-end run** for 3 vectors (a simple family, an 'aul family, a radd family): every `data-share` equals the expected fraction; there is **zero** POST and no request other than static assets and `/belajar/api/me`.
7. **Smoke tests** find the draft chip and "bukan fatwa" on every waris page.
8. **Refusals:** every refusal page shows no numbers for the refused column.
9. **Print:** the print-media screenshot of case 3 fits on 3 A4 pages, and the longest report in the vector set is measured and recorded.
10. **Senior-UX checks** (`docs/belajar-research/senior-ux.md`):
    - targets ≥ 48px, with the primary action at 56px;
    - Arabic ≥ 24px;
    - text contrast ≥ 4.5:1;
    - no state shown by colour alone (CVD script);
    - **in reduce mode, every animated component renders its final frame with no animation (CI screenshot)**. This replaces the draft's untestable "the reduced-motion path works".
11. **Moderated test** with 5 adults aged 60+ on a mid-range Android. Proposed target: at least 4 of 5 finish a common family without help. The result decides whether E1–E3 and F1–F3 are merged (§5.5).
12. **Citation strings:** `validate_waris.py` finds no unkeyed "QS"/"HR" text in `messages/waris/*.json` (D10).
13. **Hub card** appears with the draft chip; still noindex. Per **D13**, the calculator and report routes are not live in production until the fara'id reviewer has signed every `RuleNote`.

### M3. Lessons and animations (L; reviewer 8–12 h)

Accepted when:
1. All 9 lessons are built, each with at least one anchor dalil from `dalil.json` and a 2–3 question check. The "Jalur singkat" (L1, L2, L3, L9 → Hitung) is offered on the track home.
2. Every number in a visual comes from `solve()`.
3. Captions over 180 characters are split.
4. The reduced-motion storyboard renders every intermediate frame, shown on a CI screenshot in reduce mode.
5. At most about 48 animated tiles.
6. No new npm dependency is added, and the size-budget check passes.
7. *(added in review, D17)* Each lesson has **at least 4 animated steps** and **at most ~250 words** of prose outside the stage and the dalil card. In a moderated test, **at least 4 of 5** adults aged 60+ pass the lesson check of L4, L6 and L7.
8. *(added in review)* L6's ladder states are generated from `blockers()`. A test asserts that no rung reads "terhalang" for the father, the grandfather or (with the grandfather) the siblings.

### M4. Case studies (M; reviewer 3–5 h)

Accepted when:
1. 15 (+1) case pages are built.
2. The build fails if the engine disagrees with the reviewer's oracle.
3. The split view appears exactly for cases 8–11 (+13).
4. *(added in review)* No case page uses an expectation whose status is `computed` until the reviewer has confirmed it. Today that applies to case 13's court column and case 11's court illustration.

### Gate. Sign-off

- Both reviewers sign each record by its content sha256 (plan §7.5 stage 5).
- A public build refuses any `draft` record.
- Removing the draft chip and promoting the track beyond the hub are separate go decisions from you.
- Switching on `/waris/hitung` and `/waris/laporan` in production (D13) is also a separate go decision, after the fara'id reviewer has signed every `RuleNote`.

---

## 11. Risks and mitigations

| # | Risk | What could go wrong | Mitigation |
|---|---|---|---|
| 1 | **Legal reliance on a calculator** | A family treats the report as binding: they show it to a bank or the BPN, or use it to win an argument. Or they act on the fikih column when a court would rule otherwise. | **Labels:** "Perkiraan Pembagian Waris" as the title (D16; the draft had "Laporan …"); "bukan fatwa, bukan penetapan pengadilan" in the header, in the footer and on every print. **Court results:** the court column appears wherever it differs, so a family can see what a court is likely to do; the next steps point to a *Penetapan Ahli Waris* with every heir joined. **Limits:** risky cases are refused (D4); wasiat wajibah shows only a ceiling (D8); the fraction is stated as the share that counts. **Traceability:** each report carries an answer code, the engine version and the last-review date, and an old link recomputes with "Perhitungan diperbarui sejak laporan ini dibuat". This follows the MAIS e-Faraid disclaimer pattern ("not valid for estate claims and court proceedings", `ux.md` §6). |
| 2 | **Ikhtilaf** | One view presented as "the" Islamic answer. The courts disparaged. Families pushed to litigate. | Both columns are shown as recognised positions, with no "yang benar adalah". Every difference names its basis (a switch, an article or a decision). The reviewer writes the wording for rows B and C (R3). The tone is rahma and hikmah: lead with "jalan kebaikan" (hibah, wasiat, QS 4:8), never "tidak berhak apa-apa" alone. Learners cannot toggle madhhab switches. |
| 3 | **Privacy (UU PDP)** | Children's data, financial data or criminal-record data leaks to our server, to logs or to a shared chat | Computed only in the browser. No server path. The share link lives in the fragment, is opt-in and leaves amounts out. Saving on the device is opt-in. No analytics. A lint ban and a CI request check enforce this. The killer answer is never stored. A plain warning appears before any link is shared. (§9.4) |
| 4 | **Overclaiming** | "Standar MUI"; KHI wording quoted from an unofficial copy; ungraded hadith; a hikmah stated as the legal cause | D1 wording. Official texts are pinned before quoting (M0). Grades come only from a named source. The exclusion list is in D10. Hikmah is labelled as hikmah. Draft chips stay until sign-off. Every page carries "AI-assisted, not authoritative fatwa". |
| 5 | **Fabricated or retyped Arabic** | A composer retypes a matn or stitches a quote (project memory: Arabic provenance and the citation/chunk mismatch) | Byte copies only. Spans are slices. `validate_waris.py` compares every string with its source by sha256. The Qur'an must equal the Tanzil bytes. |
| 6 | **Stale law** | *Buku II* 2026 replaced the 2013 edition in August 2026; each year's SEMA can change a rule | Every legal claim carries its instrument and date. The report shows "Versi metode" and the last-review date. Re-check after each year's SEMA rumusan kamar (the AGENTS.md rule that point-in-time facts must be re-verified). |
| 7 | **Single-textbook dependence** | Khairuddin 2020 supplies 38 vector citations and has 6 logged misprints | The `knownSourceErrors` list. A second kitab page for the grandfather and Akdariyyah cases (M0/M1); al-Hawi 8:121 now covers 'Umariyyatain with the grandfather. The reviewer confirms the 25 `computed` expectations. |
| 8 | **Reviewer bottleneck** | Nothing can leave draft | Name the reviewers in M0. Batch the ~20 rulings (Appendix B). Engine and test work does not wait. |
| 9 | **Senior usability** | Paths of up to 13 screens on common families and about 14 on rarer ones (more with a difference of religion); abstract ideas such as 'aul and hajb | One thing per screen. Skips are visible. "Tidak tahu" is allowed. Rupiah sits outside the path. Step-by-step visuals at the learner's pace. A moderated test with 5 seniors (M2). |
| 10 | **Licences** | QuranEnc terms; Tanzil verbatim-only; PMA 44/2016; the Shakir editor's notes in al-Tabari; the copyrighted English Ibn Kathir | Closed noindex beta until LPMQ answers (the waris ayat are added to the letter). Tanzil is credited. Shakir's `[[…]]` notes are stripped. The English Ibn Kathir is not used. |
| 11 | **Deploy and commit** | A merge to `main` deploys to production | Every commit and every merge waits for your explicit go (AGENTS.md). |
| 12 | **Lost tooling** | `build_dalil.py` lives in a temporary scratchpad | It moves into the repo as the first M1 task (§9.2). |
| 13 | **Cost** | — | No LLM and no paid API at build time or run time, so each report costs Rp 0. The only new spend is the reviewers' honorarium (21–33 h), which needs a figure from you before anyone is engaged (D14). Nothing here touches the LLM budget cap. |
| 14 *(review)* | **Questionnaire drops a relative who changes the numbers** | A skip rule hides a blocked sibling, a beyond-depth agnate or an unknown heir, and the report prints a wrong money split. The draft had three such rules. | `couldAffectOutcome` over both rulesets; the completeness test per ruleset with independent sampling as a CI gate; C4b and F5 detection; the "Tidak tahu" table (D15). |
| 15 *(review)* | **A live calculator before review** | Families act on unsigned numbers in the noindex beta. | D13: the calculator routes are off in production until the fara'id reviewer has signed every RuleNote. |

---

## Appendix A. Where the research files disagree, and what this plan proposes

| # | Topic | The disagreement | This plan |
|---|---|---|---|
| 1 | Default ruleset | `architecture.md` §5.3 / §7.2 sketch "standar-indonesia (default)"; `standard.md` §5.2 and `ux.md` O1 recommend fikih first | Fikih first (D2) |
| 2 | Radd to a spouse, court column | `standard.md` §5.2: radd to everyone; `engine.md` §9.4: *Buku II* 2013 §8(h) excludes spouses | No radd to a spouse, plus a note (D7) |
| 3 | Rupiah rounding | `ux.md` §5.2: floor, leftover to musyawarah; `engine.md` §14: largest remainder | Largest remainder (D5) |
| 4 | A reported killing | `engine.md` §4 computes the fikih column; `ux.md` §4.5 refuses | Refuse in both; never stored (D4) |
| 5 | Dzawil arham | `engine.md` §10 computes by tanzil in the fikih column; `ux.md` §4.5 refuses | Refuse in v1; keep the code for v2 (D4) |
| 6 | An heir who died after the deceased | `engine.md` §13 refuses (munasakhat); `ux.md` §4.1 computes the first stage | First stage, plus "Hitung untuk beliau" (D4) |
| 7 | Question order | `architecture.md` §6.1 asks about barriers late (phase H); `ux.md` §4.1 asks first | Barriers first (§5.1) |
| 8 | Qur'an Indonesian | `ux.md` §0 uses `quran.json` with typos fixed; `dalil.md` §2.1 says QuranEnc | QuranEnc (D10) |
| 9 | Muslim numbers | `architecture.md` Q7 wants a prod lookup; `dalil.json` is already remapped and byte-checked | `dalil.json`; the lookup is optional (D10) |
| 10 | Lessons / cases | `architecture.md`: 6–8 lessons, 6–10 cases; `ux.md`: 9 and 12 | 9 lessons; 12 cases + 1 optional (§3, §4) |
| 11 | Ibn Kathir English | `ux.md` quotes it (L1, L5, case 8); `dalil.md` §5: a copyrighted abridged edition | Arabic + a reviewed translation; al-Tabari for case 8 |
| 12 | The grandchild-substitution decision | `standard.md` §3.3 "68 K/AG/2001"; MA's *Himpunan Yurisprudensi 2018* "86 K/Ag/2001" | 86 K/Ag/2001 (§7.2) |
| 13 | Date of 86 K/AG/1994 | 1994 / 1995 / 1996 depending on the source | Quote the kaidah only |
| 14 | Wasiat-wajibah ceiling | `standard.md` Q3: "⅓ ceiling"; `engine.md` §11.4: the smaller of the as-if share and ⅓, taken off first ("plafon"); **and** `standard.md` §4.1 H2 already used the as-if method (wife 150, son 700, daughter 350). The draft recorded only the first two. | *Revised in review:* adoption = ⅓ ceiling taken first (KHI 209); non-Muslim relative = the MA as-if illustration (16 K/AG/2010, 51 K/Ag/1999), as H2 had it (D8) |
| 15 | Report title | "Laporan Pembagian Waris" (`ux.md`) vs "Perkiraan Pembagian Waris" (`architecture.md`) | *Revised in review:* "Perkiraan Pembagian Waris" (D16). The draft picked "Laporan", which reads as official. |
| 16 | Do blocked siblings reduce the mother? | `ux.md` O4 open | Yes: Ibn Kathir 4:11 + vector (§5.3) |
| 17 | Divorce in 'iddah | `ux.md` O8 unsourced | Located in Fiqh as-Sunnah §847 (C1090); gap + R14 |
| 18 | Analytics | `ux.md` O11: coarse events; `architecture.md` §6.5: none | None in v1 (D9) |
| 19 *(review)* | Questionnaire relevance | `ux.md` §4.4 skip rows and `architecture.md` §6.2 `couldInherit(…, ruleset)` vs `engine.md` §5.2 (S counts blocked siblings) and §8.4 (mu'addah) | `couldAffectOutcome` over both rulesets (§5.1) |
| 20 *(review)* | Uterine siblings with the grandfather, court column | `engine.md` §12.2 `khi181` vs KHI 182's identical wording, which the engine does not read literally | `classical` in both columns; `khi181` a comparison variant (§7.2) |
| 21 *(review)* | An heir who died after the deceased | plan D4 computes the first stage; vector `rujuk-munasakhat` expected a refusal | Vector rewritten as `munasakhat-tahap-pertama` |
| 22 *(review)* | Divorce in 'iddah under B1 | `ux.md`: "Pilih Ya dan konsultasikan"; plan §5.4: "Konsultasikan" | An explicit B1 option leading to a soft stop (§5.7) |

## Appendix B. Questions for the reviewers

**F** = fara'id reviewer, **K** = KHI/Pengadilan Agama reviewer. Source ids are in brackets.

| # | Question | Who | Default meanwhile |
|---|---|---|---|
| R1 | Apply the KHI 50/50 harta-bersama presumption in the **fikih** result? (`standard.md` Q5) | F | Yes, as a visible ownership step with a toggle (D6) |
| R2 | Radd: none to a spouse in fikih; what of the remainder when a spouse is the only heir? (Q6, EQ3, EQ12) Is "sisa: konsultasikan" right in **both** columns, given that Fath al-Mu'in §34 assumes the Baitul Mal is not orderly? | F + K | No radd to a spouse; spouse-only → partial result + "sisa: konsultasikan" in both columns (D7) |
| R2b *(review)* | No heirs at all: what happens to a wasiat above ⅓ when there is nobody to consent? | F + K | E-TANPA-AHLI-WARIS says "konsultasikan" and states no rule |
| R3 | Wording for rows B and C, where court practice departs from Bukhari 6734 / 6736 (Q7) | F + K | Draft copy, rahma tone |
| R4 | Confirm the Syafi'i defaults: grandfather with siblings (Zaid), musytarakah (*tasyrik*), Akdariyyah (Q8; dalil Q11–12) | F | Computed + "Perlu konfirmasi" |
| R5 | Father with only daughters: ⅙ + residue, or ⅙ then radd under KHI 177? (EQ1) | F + K | ⅙ + residue in both |
| R6 | How is the KHI 185(2) cap computed: slot re-weighting (`sederajat`), per substitute person (`per_kepala`, as Tarjih checks), or none? They differ: vector `khi-pengganti-anakpr-cucu3-perkepala`. (EQ4, `ux.md` O3) | K | "Sederajat" by re-weighting |
| R7 | Court column: does the grandfather exclude uterine siblings (KHI 181)? If 181 is read literally, is 182 too? Does a child exclude the grandparents (86 K/AG/1994 literal)? (EQ13, EQ2) | K | Classical (review: was KHI 181 literal); grandparents kept |
| R8 | Wasiat wajibah: priority over a voluntary wasiat and a combined ⅓ (EQ5); an as-if share over ⅓ (EQ6); is the MA as-if method (16 K/AG/2010, 51 K/Ag/1999) what PAs apply today for non-Muslim relatives? *Buku II* 2026 has no ceiling rule. | K | Adoption: ⅓ ceiling first; non-Muslim: as-if illustration; the court column refuses if over ⅓ or excluding an heir |
| R9 | A child of a valid but unregistered nikah: heir in fikih, plus an itsbat note? (EQ9) | F + K | Heir + note |
| R9b *(review)* | A **siri spouse**: heir in the fikih column, with a note that the court will first need *itsbat nikah* (`standard.md` row P; SEMA 7/2012 Kamar Agama 12 and 13 (itsbat of a second marriage needs a polygamy permit; a siri nikah can be itsbat'd if it breaks no law); SEMA 3/2018 Kamar Agama III.A-8 (itsbat of a **polygamous** siri marriage is "tidak dapat diterima"; the children's interest goes through an *asal-usul anak* petition), all checked in Cholil's compilation, https://pta-bandung.go.id/images/Kepaniteraan/Pengelolaan_Kepaniteraan/2023_Kompilasi_SEMA_Kamar_Agama.pdf, section "Perkawinan · A. Tentang Isbat Nikah"; 38 K/AG/1998)? | F + K | Heir + note (D18) |
| R10 | Killer barrier: show Bulugh 1107 with its grading note, or lead with al-Umm 550? (`dalil.md` Q4; `architecture.md` Q8) | F | al-Umm 550 + KHI 173 |
| R11 | QS 4:8: teach it as a recommended kindness and mention the naskh discussion? (`dalil.md` Q6) | F | Kindness; no naskh detail |
| R12 | "Para ulama sepakat" as the register for consensus-only rules? (`dalil.md` Q5) | F | Yes |
| R13 | Mention the Hanafi view of the grandfather at all? (Q9) | F | One line in the case note only |
| R14 | Divorce in the 'iddah of a revocable talak: confirm the Syafi'i position (Fiqh as-Sunnah §847) | F | Help line says "konsultasikan" |
| R15 | Several bequests over ⅓ without consent: cut pro rata? (EQ7) | F | Pro rata |
| R16 | KHI 211 hibah set-off: show only? (EQ8) | K | Show only |
| R17 | 'Umariyyatain with the grandfather instead of the father: mother ⅓ of the whole? (EQ10) **Source found in review:** al-Hawi al-Kabir 8:121, quoting al-Shafi'i. Confirm, and say whether to mention 'Umar's report (⅓ of the remainder). | F | ⅓ of the whole |
| R18 | Glossary and transliteration list for fara'id terms; the Indonesian renderings of Bukhari, Bulugh and kitab spans; review of Muslim's in-house `id` | F | Draft |
| R19 | Dzawil arham procedure for v2 (spouse present; mixed sex under one link) (EQ11) | F | Refuse in v1 |
| R20 | Mapping ASABRI / BPJS JHT-JP / DPLK to the Ijtima' V 2015 categories (Q4). Confirm the **inference** that a monthly survivor's pension is not estate (from C.1). Taspen savings are named by C.3 itself. | K | Categories; Taspen savings named as C.3 names it; no other scheme |
| R21 *(review)* | Siblings blocked by someone **other than the father** (the grandfather, a full brother) still lower the mother to ⅙? (EQ14) | F | Yes (the engine's S; Fath al-Qarib §117) |
| R22 *(review)* | Wording of the minor-heir line: "bagiannya tidak dilepaskan dalam kesepakatan" rests on KHI 183–184, UU 1/1974 Ps. 48 and 52, and QS 4:10. Is that right for a share in a musyawarah? | K (+ F for QS 4:10) | The fixed line in §6 step 2 |
| R23 *(review)* | The court column's no-radd-to-spouse and ceiling defaults rest on the **superseded** Buku II 2013. What do PAs do now? Also review the Buku II 2013 rules the engine rejects (`engine.md` §6.3 note). | K | As now |

## Appendix C. Verification still owed before launch

From `standard.md` §5.4, `engine.md` §17, `dalil.md` §7–8, `ux.md` §8 and `architecture.md` §15:

- **Legal texts:**
  - KHI Buku II wording from an official copy;
  - the original SEMA 2/1994;
  - the official PDF of Fatwa MUI 11/2012;
  - the DSN-MUI insurance fatwa number;
  - the full texts of 86 K/AG/1994 (its date conflicts across sources), 109 K/AG/2016 and 47 K/AG/2017;
  - whether *Buku II* 2013 still binds anywhere now that the 2026 edition exists (review: the 2026 edition has no calculation rules, so the court-column radd and ceiling defaults rest on 2013);
  - *(review)* pin al-Hawi al-Kabir 8:121 (EQ10), the MUI 1984 land recommendation, UU 1/1974 Ps. 48 and 52, and the Ijtima' V 2015 PDF; survey other MUI Q&A answers on waris (`standard.md` §1.6).
- **Kitab page numbers:** printed edition and page numbers for Fath al-Mu'in and Fath al-Qarib (the corpus gives section ids only).
- **Akdariyyah:** a kitab page; one current source is a blog.
- **Hadith numbering:** canonical sunnah.com numbers for the Bulugh fara'id and wasaya entries (sunnah.com returned 403 to the researchers who tried it).
- **Bulugh grades:** the editor of the Bulugh edition in our corpus is unnamed, so verify before attributing a grade to a named scholar.
- **Gradings for:**
  - the Sa'd ibn ar-Rabi' report;
  - "learn the fara'id";
  - Zayd's husband-and-sister report;
  - the primary sources behind the Bulugh entries.
- **Corpus repair:** `fiqh-as-sunnah.json` chunk C1084 is missing (the passage on the order of claims on the estate).
- **Tool survey:** the surveyed tools were read from their public pages only; none of their calculations was run (`ux.md` §6).

## Review log (2026-10-09)

Two critics reviewed the plan: fiqh and completeness. The fixer re-opened each source cited, recomputed every family with exact fractions, and only then applied or rejected each issue.
- **Files changed:** this plan, `engine.md`, `architecture.md`, `ux.md`, `standard.md`, `dalil.json`/`dalil.md` (notes and links only; no Arabic byte changed) and `test-vectors.json`.
- **Vector changes** are listed in `test-vectors.json` → `reviewLog`.

| # | Issue (critic) | Outcome | Where |
|---|---|---|---|
| 1 | Skip rules use `couldInherit`; blocked siblings still lower the mother; one ruleset only (fiqh, major) | **Applied.** `couldAffectOutcome` over both rulesets. The fixer found a third failure: E2 skipped beside the grandfather breaks mu'addah. Vectors added. | §5.1, §5.3, `engine.md` §6.1, `architecture.md` §6.2 |
| 2 | Akdariyyah pattern lacks S = 1 (fiqh, major) | **Applied.** Recomputed: ½, ⅙, 2/9, 1/9 on 18; vector `jadd-akdariyyah-batal-seibu` | `engine.md` §8.3 |
| 3 | L6 ladder teaches that the son excludes the father, and the Hanafi grandfather rule (fiqh, major) | **Applied.** "tidak menjadi penerima sisa"; persistent ⅙ chips; Zaid note; states taken from `blockers()` | §3, `ux.md` L6, M3 |
| 4 | "Plafon" contradicts the MA decisions it cites (fiqh, major) | **Applied.** As-if illustration for non-Muslim relatives; the ⅓ ceiling only for KHI 209; case 11 corrected (40 / 112 / 56); vector default swapped | D8, §4, `engine.md` §11.4, App. A 14 |
| 5 | Buku II 2013 superseded; selective citation (fiqh, major) | **Applied.** Verified in the PDF. Folio correction: §4(a)(6) is on p. 174 and §9(e)–(f) on p. 177. | D7, `engine.md` §6.3, R23 |
| 6 | `khi181` applied to 181 but not 182 (fiqh, minor) | **Applied.** `classical` in both columns; `khi181` a variant | §7.2, `engine.md` §12 |
| 7 | Mukhtasharah `aul` flag; contradictory blocked list (fiqh, minor) | **Applied.** 9+15+27+2+1 = 54, no 'aul | vectors |
| 8 | Dalil records cite passages that do not say the rule (fiqh, minor) | **Applied.** All six checked in the corpus. Bulugh 1108 → `R-wala`; row B → Bukhari 6732; 6734 labelled atsar; 1619e scope note; T-IK "on 4:8"; Q-33-6 removed from the ⅓ rule. | D2, D10, §8, `dalil.*`, `ux.md` case 8 |
| 9 | KHI 185(2) readings misattributed; add `per_kepala` (fiqh, minor) | **Applied.** Tarjih and PA Kotabumi re-read; three-reading vector | `engine.md` §11.1, R6 |
| 10 | Spouse-only "Baitul Mal ¾" in the fikih column (fiqh, minor) | **Applied.** "sisa: konsultasikan" in both columns; Baitul Mal only in `klasik-syafii-asal` | D7, `engine.md` §9.4 |
| 11 | 'Umariyyatain with the grandfather unsourced; the corpus points the other way (fiqh, minor) | **Partly rejected.** The default stands: al-Hawi al-Kabir 8:121 quotes al-Shafi'i, "مكان الأب جد صار للأم الثلث كاملا". The Fath al-Mu'in sentence is a non-exhaustive summary (read literally it would also bar the father's mother). The source still has to be pinned, and vectors are added. | `engine.md` §8.1, EQ10, R17 |
| 12 | Ijtima' V names Taspen (fiqh, minor) | **Applied.** Verified C.1–C.3; the survivor's pension is marked as an inference | D5, `standard.md` §1.4, `engine.md` §3.3 |
| 13 | R-hajb statements incomplete (fiqh, minor) | **Applied** | `dalil.*` |
| 14 | "95 sourced" inflated (fiqh, minor) | **Applied, and extended.** 16 + 4 radd-spouse + 1 father-with-daughter court blocks; the plan now has 74 / 84 / 25 | §7.3, `engine.md` §16.2 |
| 15 | (a) munasakhat vector refuses; (b) SEMA numbering; (c) Bulugh 1110 is da'if (fiqh, minor) | **Applied** (all verified in sources) | vectors, `standard.md`, `engine.md` §0.1 |
| 16 | Uterine siblings never asked beside the grandfather (completeness, blocker) | **Applied**, with 1 | §5.3 |
| 17 | Beyond-depth relatives silently dropped (major) | **Applied.** C4b, F5, E-KERABAT-JAUH; the test generator emits them | D4, §5.4, §5.7 |
| 18 | "Tidak tahu" undefined (major) | **Applied.** Per-node table; both outcomes shown | D15, §5.7 |
| 19 | Killer answer autosaved and printed; rupiah in the text summary (major) | **Applied** | §5.6, §9.4, M2.5, `architecture.md` §6.4 |
| 20 | D4 row refuses case 10; A3b missing (major) | **Applied** | D4, §5.7 |
| 21 | Refusals all-or-nothing (major) | **Applied.** Per-column refusals | D4, `engine.md` §13 |
| 22 | No-heirs exit; widow + daughter's children (major) | **Applied.** "Skip G4 below 2 heirs" is **rejected**: a sole heir's consent still decides a bequest above ⅓, so G4 is worded in the singular | §5.2, §5.4, §5.7 |
| 23 | Wasiat branch too narrow (major) | **Applied** | §5.7 |
| 24 | Religion branch under-specified (major) | **Applied, adapted.** A3a asks about relationship groups *before* the counts, so barriers still come before blockers | §5.1, §5.7 |
| 25 | Blended, polygamous and siri families (major) | **Applied.** Several pools: rupiah panel refers in v1 | D18, §5.7, R9b |
| 26 | A3 refusals fire before the family is known (major) | **Applied** | §5.2, §5.4 |
| 27 | Labels read as binding; absolutes in copy (major) | **Applied** | D16, §6 |
| 28 | Sixth MUI item; MUI Q&A used substitution (major) | **Applied.** Both pages opened; the PDF is hashed | D1, D2, `standard.md` §1.6 |
| 29 | Calculator live before review; honorarium (major) | **Applied** | D13, D14, Gate |
| 30 | Citations in UI strings unvalidated; translation display (major) | **Applied.** Unreviewed renderings hidden | D10, M2.12 |
| 31 | Minor heir's share (major) | **Applied, reworded.** KHI 184 only appoints a wali. The "not waived" line rests on KHI 183, UU 1/1974 Ps. 48 and 52, and QS 4:10. | §3 L9, §6, R22 |
| 32 | Animation and simplicity have no acceptance floor (major) | **Applied** | D17, §3, M3 |
| 33 | Untestable acceptance criteria (major) | **Applied** | M2, M4 |
| 34 | Irrelevant questions asked (minor) | **Applied, partly rejected.** C1/C3 are skipped only for a never-married **man**, because a woman's children inherit from her (KHI 186). G4 as in 22. | §5.5, §5.7 |
| 35 | Senior-UX gaps (minor) | **Applied** | §5.1, §5.7 |
| 36 | No planning path for living parents; notes never triggered (minor) | **Applied.** A1 option; A3 k8 and k9 | §5.2, §5.7 |
| 37 | Cases omit common Indonesian situations (minor) | **Applied.** Cases 14–16 | §4 |

*AI-assisted plan, not an authoritative fatwa. Every rule statement above summarises the research files and must be checked by the named reviewers before anything is published.*
