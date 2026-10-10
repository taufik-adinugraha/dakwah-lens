# Waris track: what "aligned to MUI standard" means, in numbers

Researcher: STANDARD · written 2026-10-09 · status: research input, **not reviewed by an ustadz**.
Every external claim below carries a URL; every kitab/hadith claim carries a local corpus anchor
(`api/data/<file>.json` + hadith number or section anchor). Where I could not source something, I say so
instead of asserting it. Scratch copies of the PDFs I read are in this session's scratchpad (`std/`,
plus `fatwa39_305.pdf`, `pensiun.pdf`, `adopsi.pdf`, `archive_khi.pdf`, `kompilasi_ma2024.pdf`,
`kompilasi_sema.pdf`, `yur16.pdf`) — not committed.

> **Short answer.** MUI has never issued a full fara'id method. It has issued a handful of
> fatwas that each settle one edge (non-Muslim heirs, children born of zina, adoption, pensions,
> insurance payouts), and in its 2005 inheritance fatwa it cites the **Kompilasi Hukum Islam
> (KHI)** as a reference. The numbers Indonesian Muslims actually receive are set by the KHI
> (Inpres 1/1991, Buku II, Pasal 171–214) **as applied by the Pengadilan Agama and the Mahkamah
> Agung**, whose SEMAs and yurisprudensi change several outcomes (father's share, daughters
> excluding siblings, substitute heirs, wasiat wajibah). So "MUI standard" can only defensibly
> mean: *classical Sunni fara'id (which every MUI fatwa assumes), with the KHI + MA practice
> wherever Indonesian law has decided a point, and with MUI's own fatwas honoured where they
> speak.* Section 5 turns that into an engine default and a list of user-facing choices.

---

## 1. MUI fatwas that touch inheritance

### 1.1 Fatwa MUI No. 5/MUNAS VII/MUI/9/2005 — *Kewarisan Beda Agama*

- **Forum and date:** Musyawarah Nasional VII MUI, 19–22 Jumadil Akhir 1426 H / 26–29 Juli 2005;
  *ditetapkan* Jakarta, 21 Jumadil Akhir 1426 H / 28 Juli 2005.
- **Source (official PDF, Himpunan Fatwa MUI pp. 478–480, Bidang Sosial dan Budaya, fatwa #39):**
  https://fatwamui.com/storage/305/39.-Kewarisan-Beda-Agama.pdf
  (index page https://mui.or.id/baca/fatwa/kewarisan-beda-agama, mirror
  https://mirror.mui.or.id/wp-content/uploads/files/fatwa/39.-Kewarisan-Beda-Agama.pdf — the mirror
  returned HTTP 522 on 2026-10-09; the fatwamui.com copy was read in full).
- **Operative ruling (verbatim):**
  1. "Hukum waris Islam tidak memberikan hak saling mewarisi antar orang-orang yang berbeda agama
     (antara muslim dengan non-muslim);"
  2. "Pemberian harta antar orang yang berbeda agama hanya dapat dilakukan dalam bentuk hibah,
     wasiat dan hadiah."
- **Dalil cited in the fatwa:** QS an-Nisa' [4]:11; QS an-Nisa' [4]:141; hadith of Usamah b. Zayd
  "lā yariṯu al-muslimu al-kāfira wa lā al-kāfiru al-muslima" (muttafaq 'alaih); hadith of 'Abdullah
  b. 'Umar "lā yatawāraṯu ahlu millatayn" (Ahmad, the four, Tirmidhi).
- **"Memperhatikan" list:** UU 1/1974, PP 9/1975, and "Instruksi Presiden no 1 tahun 1990 tentang
  Kompilasi Hukum Islam" (the fatwa text says 1990; the Inpres is actually No. 1 of **1991** — a
  typo in the fatwa, not a different instrument). This is the only place an MUI inheritance fatwa
  names the KHI, and it does so as background, not as an adopted method.
- **What it does *not* say:** it does not use the term *wasiat wajibah*. It allows voluntary
  *hibah, wasiat, hadiah*. Some secondary summaries describe MUI as offering *wasiat wajibah* for
  non-Muslim relatives; the fatwa text does not. The MA's wasiat-wajibah practice for non-Muslim relatives (section 3) is a court
  doctrine, not an MUI one. **Engine consequence:** a non-Muslim relative is never an heir; whether
  they get a wasiat wajibah is a separate MA-practice question (see 4.H).

### 1.2 Fatwa MUI No. 11 Tahun 2012 — *Kedudukan Anak Hasil Zina dan Perlakuan Terhadapnya*

- **Date:** 18 Rabi'ul Akhir 1433 H / 10 Maret 2012.
- **Source:** text reproduced at https://alsofwa.com/fatwa-mui-tentang-kedudukan-anak-hasil-zina-dan-perlakuan-terhadapnya/
  (I could not reach an official mui.or.id PDF for No. 11/2012 in this session; the six points
  below match the academic summaries at https://repository.radenintan.ac.id/16432/1/SKRIPSI%201-2.pdf
  and https://eprints.unisnu.ac.id/id/eprint/2248/4/121410000265_BAB%20III.pdf).
- **Operative ruling (points 1–3 verbatim):**
  1. "Anak hasil zina tidak mempunyai hubungan nasab, wali nikah, waris, dan nafaqah dengan lelaki
     yang menyebabkan kelahirannya."
  2. "Anak hasil zina hanya mempunyai hubungan nasab, waris, dan nafaqah dengan ibunya dan keluarga
     ibunya."
  3. "Anak hasil zina tidak menanggung dosa perzinaan yang dilakukan oleh orang yang mengakibatkan
     kelahirannya."
  4. The *pezina* is subject to hadd by the competent authority.
  5. The government may impose *ta'zir* on the man: (a) meet the child's living needs, (b) give the
     child property after his death **through wasiat wajibah**.
  6. That penalty is to protect the child, **not** to establish nasab between the child and the man.
- **Context:** issued in response to MK Putusan 46/PUU-VIII/2010 (which read UU Perkawinan Pasal
  43(1) to give a child born outside marriage a civil relationship with a biological father proven
  by science). See https://digilib.uinkhas.ac.id/26383/.
- **Engine consequence:** a child born of zina inherits from the **mother and her family only**
  (= KHI Pasal 186, below). Any wasiat wajibah from the biological father is a *ta'zir* that only
  the state can impose; it is not something a self-service calculator should compute. The tool
  should say so and refer to the Pengadilan Agama.

### 1.3 Fatwa MUI (Rakernas, Maret 1984) — *Adopsi (Pengangkatan Anak)*

- **Date:** *ditetapkan* Jakarta, 7 Maret 1984 / 4 Jumadil Akhir 1404 H, Komisi Fatwa
  (Prof. KH. Ibrahim Hosen, ketua).
- **Source (Himpunan Fatwa MUI pp. 305–308, Bidang Sosial dan Budaya, fatwa #9):**
  https://mui-jateng.or.id/wp-content/uploads/2018/03/09.-Adopsi-pengangkatan-anak.pdf
- **Operative ruling (four points):** (1) Islam recognises only nasab from marriage; (2) adoption that
  cuts the child's nasab from the biological parents contradicts the Shari'ah; (3) raising a child
  "dengan tidak mengubah status nasab dan Agamanya ... adalah perbuatan yang terpuji"; (4) adoption of
  Indonesian children by foreign nationals contradicts UUD 1945 Pasal 34.
- **On inheritance:** the four operative points are silent. The fatwa's supporting quotation (a
  scholar's explanation of the two forms of *tabanni*, p. 307–308) ends: "Bagi ayah angkat, boleh
  mewasiatkan sebagian dari peninggalannya untuk anak angkatnya, sebagai persiapan masa depannya".
  That is a **permission for a voluntary wasiat**, not a *wasiat wajibah*. The KHI goes further
  (Pasal 209: wasiat wajibah up to 1/3, see 2.4).
- **Engine consequence:** an adopted child (and an adoptive parent) is never an heir. Whether to
  award a KHI wasiat wajibah when there is no written wasiat is a KHI-vs-MUI divergence (4.H).

### 1.4 Ijtima' Ulama Komisi Fatwa se-Indonesia V (2015), Komisi B-2 — *Status Hukum Iuran dan Manfaat Pensiun Hubungannya dengan Tirkah*

- **Date:** Pesantren at-Tauhidiyah, 21 Sya'ban 1436 H / 9 Juni 2015.
- **Source (official PDF):** https://fatwamui.com/storage/487/KEPUTUSAN-KOMISI-B-2-STATUS-HUKUM-IURAN-DAN-MANFAAT-PENSIUN-HUBUNGANNYA-DENGAN-TIRKAH.pdf
  (whole Ijtima' V book: https://mirror.mui.or.id/wp-content/uploads/files/fatwa/Hasil-Ijtima-Ulama-V-Tahun-2015.pdf)
- **Operative ruling (paraphrased closely):**
  1. *Non-contributory* pension (employer's hibah, with vesting + locking-in) follows the **pension
     rules**, not inheritance — it goes to the persons named under pension law.
  2. *Contributory, combination and self-funded* pension contributions and benefits **are tirkah**
     ("tunduk pada hukum waris/tirkah") **unless** already placed in an annuity programme by the
     pension fund, in which case pension rules apply (annuity = *tabarru'-tanahud*).
  3. *Mukafa'ah nihayat al-khidmah* (≈ pesangon/uang kerahiman), *mukafa'ah al-iddikhar* (≈ Taspen
     savings) and *mukafa'ah al-taqa'ud* paid **because the worker died** are **tirkah**.
- **Engine consequence:** the asset inventory step must ask *what kind* of pension/severance money
  exists. *(Corrected in review 2026-10-09; the draft said the decision names no scheme.)* The
  decision names **one** scheme, as an example: point C.3 reads "mukafa'ah al-iddikhar (semacam uang
  Taspen [Tabungan Asuransi Pensiun]) ... yang diserahkan pihak lain karena meninggalnya pekerja
  (pensiun), tunduk pada hukum warits" (official PDF above, read 2026-10-09). It names no other scheme
  (ASABRI, BPJS Ketenagakerjaan JHT/JP, DPLK). That a **monthly survivor's pension** paid by law to a
  named widow is not estate is an **inference** from C.1 (non-contributory benefits "tunduk pada aturan
  pensiun" for "pihak yang ditunjuk"); the decision does not say it. Mapping the other schemes is a
  review item for the KHI reviewer, not something I could source.

### 1.5 DSN-MUI fatwa on death benefits of sharia life insurance (late 2025)

- **Source:** MUI news, 7 Juli 2026,
  https://mui.or.id/public/baca/berita/cegah-sengketa-ahli-waris-dsn-mui-terbitkan-fatwa-urutan-distribusi-dana-asuransi-kematian
  — **the fatwa number is not given in the article and I could not find it**; operator should get the
  number from https://dsnmui.or.id/kategori/fatwa/ before citing it in the product.
- **As reported:** where the policyholder and the insured are the same person, the death-claim money
  "berstatus sebagai harta mayit" and is distributed in four stages: (1) *tajhiz al-janazah*,
  (2) debts, (3) wasiat, (4) fara'id. Where a policyholder designated a beneficiary for a policy on
  someone else, the benefit passes to that beneficiary by *hibah*.
- **Engine consequence:** life-insurance payout on the deceased's own policy = estate. This is the
  same four-step order the KHI uses (Pasal 175).

### 1.6 Topics where I found **no** MUI (pusat) fatwa

Searched mui.or.id, fatwamui.com and secondary literature on 2026-10-09; nothing found for:
- **Ahli waris pengganti** (grandchild through a predeceased child). Other bodies, for context only:
  Muhammadiyah's Majelis Tarjih *accepts* Pasal 185 and says it "tidak berarti ... bertentangan dengan
  ketentuan al-Qur'an" (Ensiklopedia Tarjih, 18 Nov 2019,
  https://tarjih.muhammadiyah.or.id/ketentuan-ahli-waris-pengganti ); an NU Online opinion column
  (Yazid Muttaqin, 12 Jun 2021, https://nu.or.id/opini/menyoal-pasal-185-kompilasi-hukum-islam-tentang-ahli-waris-pengganti-SL4Rz )
  argues the KHI alone is not enough and the classical conditions (Imam Nawawi) must be applied. Neither
  is an MUI position.
- **Harta bersama / gono-gini** split before inheritance. MUI has an opinion piece, not a fatwa
  (https://mui.or.id/baca/opini/wasiat-hibah-dan-wakaf-dalam-perspektif-fiqih-dan-kompilasi-hukum-islam
  is about wasiat/hibah/wakaf and is likewise an *opini*).
- **Membagi harta sebelum meninggal.** No MUI fatwa found. Mainstream answers (NU Online
  https://islam.nu.or.id/syariah/membagi-warisan-sebelum-pewaris-meninggal-bolehkan-WZ5Xy ,
  Rumaysho https://rumaysho.com/14855-ortu-membagi-harta-waris-sebelum-meninggal.html ) treat it as
  *hibah*, not waris; the KHI rule on hibah to children counting against inheritance is Pasal 211.
- **A full fara'id calculation method.** None. MUI has not published an inheritance table, an
  'aul/radd procedure, or a position on the jadd-ma'a-al-ikhwah problem.

**Added in review 2026-10-09 — two MUI items the draft missed:**
- **Rakernas MUI, Jakarta, 7 Maret 1984 / 4 Jumadil Akhir 1404 H, *Pendayagunaan Tanah Warisan***
  (Komisi Fatwa, Ketua Prof. KH. Ibrahim Hosen; Himpunan Fatwa MUI no. 10, pp. 309–310;
  https://mui.or.id/baca/fatwa/pendayagunaan-tanah-warisan ; PDF
  https://mirror.mui.or.id/wp-content/uploads/files/fatwa/10.-Pendayagunaan-Tanah-Warisan.pdf ,
  sha256 0d1fa98cf49dfe67b952f88e004cde6f92032a2b98aa4814abd2c89d91b43559, read 2026-10-09). It is a
  recommendation ("merekomendasikan"), not a division rule: "Hendaknya tanah warisan yang relatif sempit
  jangan dibagi-bagikan secara individual, akan tetapi supaya tetap dipertahankan kesatuannya ...
  dimanfaatkan atas dasar kepentingan bersama para ahli waris"; failing that, "hendaknya tanah
  bersangkutan dibayar oleh salah seorang ahli waris yang mampu"; failing that, "penjualan
  diprioritaskan kepada pemilik tanah tetangganya", then to Muslims of the same village. It sits beside
  KHI 189 (farmland under 2 ha kept whole) in the report's next steps.
- **MUI's public Q&A (not a fatwa).** Kyai Nurul Irfan, answered Selasa 31 Oktober 2023,
  https://mui.or.id/baca/pertanyaan/a68d369c-7338-4656-a556-53b69c0a5553 : a family of 2 living sons,
  2 living daughters and a daughter who died earlier leaving 2 daughters. The answer divides into 7
  parts, with the predeceased daughter "digantikna oleh dua anak perempuan almh", and also allows equal
  division by agreement under "pasal 183 KOMPILASI HUKUM ISLAM". That is **substitution**, the court
  column's method, not classical fara'id, where a daughter's children are dzawil arham and get nothing
  beside sons. It is one scholar's answer on MUI's site, not a fatwa. It is not evidence of an MUI
  method, but the operator should see it before choosing which column leads (plan D2). Other MUI Q&A
  answers on waris have **not** been surveyed yet.

**What MUI defers to.** In practice: (a) the classical fara'id it quotes (QS an-Nisa' 11, 12, 176 and
the hadiths) and (b) the KHI, which it lists in its 2005 fatwa. MUI regional bodies teach the KHI as
the Indonesian rule set (e.g. MUI Sumatera Utara, "Hukum Kewarisan dalam Kompilasi Hukum Islam",
https://muisumut.or.id/hukum-kewarisan-dalam-kompilasi-hukum-isla/ ). I found **no document in which
MUI pusat formally adopts the KHI as its fara'id standard**; the operator should not claim one.

---
## 2. Kompilasi Hukum Islam (Inpres No. 1 Tahun 1991)

**Status.** An *Instruksi Presiden* (10 Juni 1991) to the Minister of Religious Affairs to
disseminate the KHI "untuk digunakan oleh Instansi Pemerintah dan oleh masyarakat yang
memerlukannya" as a *pedoman*. It is not a statute, but the Pengadilan Agama applies it as its
substantive rule book, and MA practice (section 3) is written as glosses on its articles.

**Text used.** The BPHN official PDF (https://bphn.go.id/data/documents/91ip001.pdf) returned HTTP
403 on 2026-10-09. I read the full text from (a) the archive.org "Seri Perundangan" PDF
https://dn790005.ca.archive.org/0/items/khibab-123/KHIbab123.pdf (59 pp.; Buku II on pp. 40–47) and
cross-checked Buku II against (b) MUI Sumatera Utara's reproduction
https://muisumut.or.id/hukum-kewarisan-dalam-kompilasi-hukum-isla/ (23 Feb 2023), which also prints
the SEMA 2/1994 note under Pasal 177. Both copies carry the same two well-known misprints of the
1991 text, flagged below where they matter. Before quoting KHI wording in the product, the
operator should pull the JDIH Kemenag / Badilag copy.

### 2.1 Buku II, Bab I — Ketentuan Umum (Pasal 171)

- **171(a)** hukum kewarisan = transfer of *tirkah*, who are heirs, and their shares.
- **171(b)** *pewaris* = a person who at death (or declared dead by a court) is Muslim and leaves heirs
  and property.
- **171(c)** *ahli waris* = at the time of death has a **blood or marriage** relationship, **is Muslim**,
  and is not legally barred.
- **171(d)** *harta peninggalan* = everything left: property **and rights**.
- **171(e)** *harta waris* = "harta bawaan ditambah bagian dari harta bersama setelah digunakan untuk
  keperluan pewaris selama sakit sampai meninggalnya, biaya pengurusan jenazah (tajhiz), pembayaran
  hutang dan pemberian untuk kerabat." → **the engine's input is not "everything in the house": it is
  own property + the deceased's half of harta bersama, minus last-illness costs, funeral, debts.**
- **171(f)** wasiat; **171(g)** hibah (to a living person); **171(h)** *anak angkat* = a child whose
  care passed to adoptive parents **"berdasarkan putusan Pengadilan"** (court-ordered adoption only);
  **171(i)** Baitul Mal = *Balai Harta Keagamaan*.

### 2.2 Bab II — Ahli waris (Pasal 172–175)

- **172** Religion of an heir is known from ID card, confession, practice or testimony; a newborn or
  minor follows the father's religion **or the environment**.
- **173** Barred (by a final court judgment) if convicted of (a) killing, attempting to kill, or
  seriously assaulting the pewaris; (b) falsely accusing the pewaris of a crime punishable by ≥5 years.
  *Note:* the KHI bars only on a **final conviction**; classical fiqh bars any killer (Fath al-Qarib:
  "والقاتل لا يرث ممن قتله، سواء كان قتله مضمونا أم لا" — `api/data/fath-al-qarib.json` section 116,
  anchor C138). Religion difference is not in 173; it is in 171(b)–(c).
- **174(1)** Heir groups: by blood — male: *ayah, anak laki-laki, saudara laki-laki, paman, kakek*;
  female: *ibu, anak perempuan, saudara perempuan **dari** nenek* (printed so in both copies; the
  intended reading is "saudara perempuan **dan** nenek"); by marriage: *duda atau janda*.
  **174(2)** if all are present, only *anak, ayah, ibu, janda/duda* inherit.
  *Note:* the KHI list is much shorter than the classical 25 heirs (Fath al-Qarib: 15 men + 10 women
  "بالبسط"); it does not name cucu, keponakan, sepupu, or grandparents beyond kakek/nenek. Those
  enter through Pasal 185 (substitution), which is why KHI outcomes diverge.
- **175(1)** Heirs' duties, in order: (a) funeral through burial; (b) debts — medical, care, the
  pewaris' obligations, creditors; (c) the wasiat; (d) divide the estate. **175(2)** heirs are liable
  for debts **only up to the value of the estate**.

### 2.3 Bab III — Besarnya bahagian (Pasal 176–191)

| Pasal | Rule (KHI wording condensed) | Classical match? |
|---|---|---|
| 176 | One daughter ½; two+ daughters ⅔; with sons, son : daughter = 2 : 1 | Yes (QS 4:11) |
| 177 | Father ⅓ if no child; ⅙ if there is a child. *SEMA 2/1994 note:* "ayah mendapat sepertiga bagian bila pewaris tidak meninggalkan anak, **tetapi meninggalkan suami dan ibu**; bila ada anak, ayah mendapat seperenam bagian" | Partly — see 3.1, 4.K |
| 178(1) | Mother ⅙ with a child or ≥2 siblings, otherwise ⅓ | Yes (QS 4:11) |
| 178(2) | Mother ⅓ **of the remainder** after the spouse's share when with the father (*gharrawain/'umariyyatain*) | Yes |
| 179 | Duda ½ without child, ¼ with child | Yes (QS 4:12) |
| 180 | Janda ¼ without child, ⅛ with child | Yes (QS 4:12) |
| 181 | If no **child and father**: one uterine sibling ⅙; two+ share ⅓ | Classical also excludes them by **grandfather** and by **son's children**; KHI is silent → see 4.D |
| 182 | If no **child and father**: one full/paternal sister ½; two+ ⅔; with brothers 2 : 1 | "Child" here is the hinge of yurisprudensi 86 K/AG/1994 → 4.B |
| 183 | Heirs may agree on a *perdamaian* in the division "setelah masing-masing menyadari bagiannya" | Classical *takharuj/tasaluh* → 4.N |
| 184 | A guardian is appointed by the court for a minor/incapable heir | — |
| 185(1) | An heir who died **before** the pewaris "dapat digantikan oleh anaknya", except those barred by 173 | **Departs from Syafi'i rules**: classically a son's child inherits in his/her own right only when no son survives, and a daughter's child not at all → 4.A |
| 185(2) | The substitute's share **may not exceed** the share of an heir of the same degree as the one replaced | — |
| 186 | A child born outside marriage inherits only from/through the **mother** and her family | = MUI 11/2012 |
| 187 | Executor(s) may be named to inventory and compute 175(1)(a)–(c); the remainder is the estate | — |
| 188 | Any heir may ask for division; if refused, sue in the Pengadilan Agama | — |
| 189 | Farmland < 2 ha should be kept whole and used jointly; if someone needs cash, one heir may buy the others out at their shares | Administrative |
| 190 | A polygamous pewaris: **each wife** takes her gono-gini from her own household; the pewaris' whole share goes to the heirs | → 4.M |
| 191 | No heirs, or unknown: by court order the estate goes to **Baitul Mal** "untuk kepentingan Agama Islam dan kesejahteraan umum" | Classical Syafi'i *asl al-madhhab* (see 4.E) |

### 2.4 Bab IV — 'Aul dan Rad (Pasal 192–193)

- **192 ('aul):** if the numerators exceed the denominator, raise the denominator to the sum of the
  numerators and divide "secara aul menurut angka pembilang" — the classical 'aul, adopted.
- **193 (radd):** if the numerators fall short "sedangkan tidak ada ahli waris asabah", divide "secara
  rad, yaitu sesuai dengan hak masing-masing ahli waris sedang sisanya dibagi berimbang di antara
  mereka." **The article does not exclude spouses from radd**; classical jumhur does (4.E).

### 2.5 Bab V — Wasiat (Pasal 194–209)

- **194** testator ≥21, sane, free; property must be theirs; takes effect only after death.
- **195(1)** oral before 2 witnesses, written before 2 witnesses, or before a notary.
  **195(2)** max ⅓ of the estate **unless all heirs agree**. **195(3)** a wasiat **to an heir** is valid only
  if **all heirs agree**. **195(4)** the consent is given orally before 2 witnesses or in writing
  before 2 witnesses / a notary.
- **196** the beneficiary must be named clearly. **197** void if the beneficiary was convicted of
  killing/attempting/seriously assaulting/falsely accusing the testator, or obstructing or forging the
  wasiat; or if the beneficiary did not know, refused, or died before the testator; or if the object
  perished. **198** wasiat of usufruct must be time-limited. **199** revocation formalities.
  **200** wasiat property that depreciated before death: beneficiary takes what remains.
- **201** wasiat > ⅓ with a non-consenting heir: executed only up to ⅓.
- **202** multiple charitable wasiat that exceed the estate: heirs choose the order.
- **203–206** sealed wasiat, notary/KUA opening, soldiers in war, travellers at sea.
- **207** no wasiat to the person who nursed or spiritually guided the testator in the final illness,
  unless expressly as recompense. **208** no wasiat to the notary or witnesses of the deed.
- **209(1)** The estate of an adopted child is divided under 176–193; the **adoptive parent** who
  received no wasiat gets a **wasiat wajibah of at most ⅓** "dari harta wasiat anak angkatnya" (printed
  so; read "harta warisan"). **209(2)** an **adopted child** who received no wasiat gets a **wasiat
  wajibah of at most ⅓** of the adoptive parent's estate.
  *This is the only article that uses "wasiat wajibah".* The KHI gives none to grandchildren (it uses
  substitution instead) and none to non-Muslim relatives (MA practice added that later, section 3).

### 2.6 Bab VI — Hibah (Pasal 210–214)

- **210** donor ≥21, sane, free; **max ⅓ of their property**, to another person or institution, before
  2 witnesses. (Fath al-Qarib's hibah chapter sets no ⅓ cap — "وكل ما جاز بيعه جازت هبته", binding
  on *qabd* — `fath-al-qarib.json` section 112, anchor C134; the ⅓ cap is a KHI choice. The same
  passage allows a parent "وإن علا" to take a hibah back, matching Pasal 212.)
- **211** "Hibah dari orang tua kepada anaknya **dapat diperhitungkan sebagai warisan**." → an
  "advance on inheritance" that a court may set off against that child's share.
- **212** hibah is irrevocable **except** a parent's hibah to a child.
- **213** hibah made in an illness close to death needs the **heirs' consent** (= classical *marad
  al-mawt* treated like wasiat).
- **214** Indonesians abroad may make a hibah deed before an RI consulate/embassy.

### 2.7 Buku I — harta bersama (Pasal 1 huruf f, 85–97)

- **1 huruf f** *harta bersama/syirkah* = property acquired **by either or both spouses during the
  marriage**, "tanpa mempersoalkan terdaftar atas nama siapapun".
- **85** harta bersama does not preclude each spouse's own property. **86** no automatic mixing of the
  spouses' property. **87** *harta bawaan*, gifts and inheritances stay each spouse's own unless a
  marriage agreement says otherwise. **88** disputes go to the Pengadilan Agama.
- **96(1)** "Apabila terjadi cerai mati, maka **separuh harta bersama menjadi hak pasangan yang hidup
  lebih lama**." **96(2)** if a spouse is missing, division waits for proof of death or a court
  declaration of death. (The archive.org copy misprints "hilang" as "hutang"; the reading "hilang" is
  confirmed by e.g. https://journal.unram.ac.id/index.php/privatelaw/en/article/download/270/116/647 .)
- **97** on divorce each spouse takes half of harta bersama unless a marriage agreement says otherwise.
- **Engine consequence (biggest single number change vs. classical fiqh):** when a married person dies,
  first take **50% of the harta bersama to the surviving spouse as their own property** (not
  inheritance), then the deceased's 50% + their own *harta bawaan* forms the estate, from which the
  surviving spouse **also** takes their fara'id share (¼/⅛ or ½/¼). See 4.L for the numeric example.

---
## 3. Mahkamah Agung practice that changes the numbers

**How MA practice binds.** Two instruments: (1) **SEMA** — circulars that make the annual *Rapat Pleno
Kamar* results binding guidance for all courts ("Pemberlakuan Hasil Rumusan Rapat Pleno Kamar ...
Sebagai Pedoman Pelaksanaan Tugas Bagi Pengadilan"); (2) **yurisprudensi** — MA cassation decisions
the MA itself publishes as having a *kaidah hukum*. Lower courts usually follow both, but not always
(see 3.2).

**Main sources read.**
- MA Kepaniteraan, *Kompilasi Rumusan Hasil Rapat Pleno Kamar Mahkamah Agung RI*, cetakan ke-10, 2024
  (covers SEMA 7/2012 → SEMA 3/2023): https://kepaniteraan.mahkamahagung.go.id/images/artikel/Buku_Kompilasi_Rapat_Pleno_Ed_10_tanpa_ttd.pdf
  (I read the identical copy at https://ppotoda.org/wp-content/uploads/2024/03/Buku-Kompilasi-Rumusan-Kamar-MA-2024.pdf ; Kamar Agama on pp. ~148–186).
- Achmad Cholil, *Kompilasi SEMA Kamar Agama 2012–2022* (Jan 2023), topical index used by PTA Bandung:
  https://pta-bandung.go.id/images/Kepaniteraan/Pengelolaan_Kepaniteraan/2023_Kompilasi_SEMA_Kamar_Agama.pdf
- Kaidah hukum list of MA yurisprudensi *perdata agama*: https://peradi-tasikmalaya.or.id/kaidah-hukum-yurisprudensi-perdata-bagian-2-perdata-agama/
  and Komisi Yudisial *karakterisasi* pages (e.g. 122 K/AG/1995:
  https://karakterisasi.komisiyudisial.go.id/?view=t5nsyMraxMLmx9%2Fn2uDj18bg0g%3D%3D&id=pmao ).
- The MA's own published yurisprudensi sheet for 16 K/AG/2010:
  https://jdih.mahkamahagung.go.id/storage/uploads/produk_hukum/file/16%20K-AG-2010y.pdf
- M. Isna Wahyudi (hakim PA), "Melacak Illat Hukum Larangan Waris Beda Agama", *Jurnal Hukum dan
  Peradilan* (MA) 10(1) 2021: 155–172, doi:10.25216/jhp.10.1.2021.155-172,
  https://www.jurnalhukumdanperadilan.org/jurnalhukumperadilan/article/download/261/267
- The JDIH MA site (jdih.mahkamahagung.go.id) and the putusan3 directory sit behind a Cloudflare check
  and returned HTTP 403 to me, so I could not open SEMA 2/1994 or the MA *rumusan_kamar* index pages
  directly.

### 3.1 SEMA No. 2 Tahun 1994 — the father's share (Pasal 177)

- Text, as printed in the KHI edition under Pasal 177 (MUI Sumut reproduction,
  https://muisumut.or.id/hukum-kewarisan-dalam-kompilasi-hukum-isla/ ): "Berdasarkan Surat Edaran
  Mahkamah Agung Nomor : 2 Tahun 1994, maksud pasal tersebut ialah : ayah mendapat sepertiga bagian bila
  pewaris tidak meninggalkan anak, **tetapi meninggalkan suami dan ibu**, bila ada anak, ayah mendapat
  seperenam bagian." JDIH listing: https://jdih.mahkamahagung.go.id/index.php/legal-product/sema-no-02-tahun-1994/detail
  (403 for me). Academic treatment: https://journals.unisba.ac.id/index.php/JRHKI/article/view/431 .
- **Effect:** read literally, Pasal 177 gives the father a flat ⅓ whenever there is no child, which
  breaks the classical result (father = *'asabah*, takes the remainder). SEMA 2/1994 confines the ⅓ to
  the one case where ⅓ *is* the classical remainder (husband ½ + mother ⅓-of-remainder = ⅙ + father ⅓).
  In every other childless case the father reverts to residuary. **Engine: classical father rules.**

### 3.2 Daughters exclude the deceased's siblings — yurisprudensi 86 K/AG/1994 and followers

| Putusan | Date | Kaidah hukum (verbatim) |
|---|---|---|
| 86 K/AG/1994 | 27 Juli 1996 | "Selama masih ada anak laki-laki maupun anak perempuan, maka hak waris dari orang-orang yang mempunyai hubungan darah dengan pewaris kecuali orang tua, suami dan isteri menjadi tertutup (terhijab)" |
| 122 K/AG/1995 | 11 April 1996 (per KY) | "Seorang Pewaris yang meninggalkan seorang anak perempuan (anak tunggal), maka saudara-saudara dari Pewaris haknya menjadi terhijab atau tertutup." |
| 184 K/AG/1995 | 30 September 1996 | "Dengan adanya anak perempuan dari pewaris, maka saudara-saudara kandung pewaris tertutup" |

Sources: peradi-tasikmalaya list above; KY karakterisasi page for 122 K/AG/1995 (which also quotes 86
and 184). The reasoning reads *walad* in QS an-Nisa' [4]:176 as "child, male or female" (the view
attributed to Ibn 'Abbas).

**Practice today is split.** Arif Rahman Hakim, *SAKINA: Journal of Family Studies* 4(3) 2020
(https://urj.uin-malang.ac.id/index.php/jfs/article/download/600/463/1067 ) compares
Mahkamah Syar'iyah Sigli 46/Pdt.P/2013/MS.Sgi (daughter **blocks** siblings, following 86 K/AG/1994)
with PA Banjarbaru 90/Pdt.P/2017/PA.Bjb (daughter does **not** block siblings, following the jumhur).
No SEMA rumusan kamar on this point was found in the 2012–2023 compilation, so it rests on
yurisprudensi only. **This is the most consequential KHI-vs-classical divergence for ordinary families**
(see 4.B), and it runs directly against two hadiths in our own corpus: Bukhari 6736 / 6742
(Ibn Mas'ud: "للابنة النصف، ولابنة ابن السدس تكملة الثلثين، وما بقي فللأخت", which he says is the
Prophet's ﷺ ruling; also Bulugh al-Maram 1097 in `bulugh-al-maram.json`) and Bukhari 6734 (Mu'adh
in Yemen gave a daughter ½ and a sister ½).

### 3.3 Ahli waris pengganti (Pasal 185) — how far it reaches

| Instrument | Date | Rule |
|---|---|---|
| Yurisprudensi 221 K/AG/1993 | 2 Juni 1994 | Pasal 185 cannot be applied to a death in 1985 (pre-KHI) |
| Rakernas MA 2010 (Balikpapan), adopted as **SEMA 3/2015, Rumusan Kamar Agama angka 9** (SEMA dated 29 Des 2015; pleno 9–11 Des 2015) | 2015 | "waris pengganti **hanya sampai dengan derajat cucu**, jika pewaris tidak mempunyai anak tetapi punya saudara kandung yang meninggal lebih dahulu, maka **anak laki-laki dari saudara kandung sebagai ahli waris**, sedangkan **anak perempuan dari saudara kandung diberikan bagian dengan wasiat wajibah**." (MA compilation 2024, Kamar Agama 2015 no. 9) |
| Yurisprudensi 68 K/AG/2001 (+ 59 K/AG/2005, 152 K/AG/2006, 242 K/AG/2006) | — | "Cucu laki-laki maupun perempuan dari anak laki-laki maupun anak perempuan dari pewaris menjadi ahli waris pengganti" |
| Yurisprudensi 334 K/AG/2005 | 22 Feb 2006 | the dates of death of the substitute and the substituted must be stated |
| Yurisprudensi 676 K/AG/2012 | 15 Mei 2013 | substitution under the KHI "tidak bertentangan dengan hukum Islam dan hukum positif"; a court "tidak boleh mengabaikan Kompilasi Hukum Islam ... dengan tidak setuju adanya ahli waris pengganti" |

**Consequences for the engine:** (a) a grandchild through a predeceased **son or daughter** steps into
that child's place (KHI) — classically only a son's children inherit, and only when no son survives;
(b) substitution stops at grandchildren; (c) a predeceased full sibling's **sons** inherit (classical
too, as *'asabah*), his/her **daughters** get a court-set wasiat wajibah (classically: nothing, they are
*dzawil arham*). How the 185(2) cap is computed is **not settled**: a PTA Pontianak judge's 2025 survey
(https://pta-pontianak.go.id/index.php/2025/04/28/silang-pendapat-tentang-ahli-waris-pengganti-dalam-kompilasi-hukum-islam-dan-pemecahannya-oleh-drs-h-firdaus-muhammad-arwan-sh-mh-hakim-pta-pontianak/ )
documents competing readings (substitute takes exactly the parent's share vs. capped by "heirs of the
same degree"), and whether "dapat" makes 185 optional — 676 K/AG/2012 says courts may not ignore it.

### 3.4 Wasiat wajibah beyond adopted children

| Instrument | Date | Beneficiary and amount |
|---|---|---|
| Yurisprudensi 368 K/AG/1995 | 16 Juli 1998 | a **non-Muslim daughter** of Muslim parents: wasiat wajibah "dengan bagian yang sama dengan ahli waris muslim" (Wahyudi 2021, p. 157) |
| Yurisprudensi 51 K/AG/1999 | 29 (or 28) Sept 1999 | non-Muslim heirs via wasiat wajibah, followed widely |
| Peradi kaidah list for "368 K/AG/1999" [sic] | — | "Wasiat Wajibah dapat diberikan tidak hanya kepada anak angkat sebagaimana diatur dalam Pasal 209 KHI namun juga dapat diberikan kepada ahli waris yang tidak beragama islam"; related 721 K/AG/2015 (19 Nov 2015), 218 K/AG/2016 (26 Mei 2016) |
| Yurisprudensi **16 K/AG/2010** (official MA sheet) | 30 April 2010 | non-Muslim **wife**: "tidak termasuk ahli waris, akan tetapi ia berhak untuk mendapat wasiat wajibah dari harta warisan suaminya **sebanyak porsi waris istri**" |
| SEMA 7/2012, Rumusan Kamar Agama no. 19 *(corrected in review 2026-10-09 from "no. 20": Cholil, Kompilasi SEMA Kamar Agama, p. 19, https://pta-bandung.go.id/images/Kepaniteraan/Pengelolaan_Kepaniteraan/2023_Kompilasi_SEMA_Kamar_Agama.pdf)* | 12 Sept 2012 | "Anak tiri yang dipelihara sejak kecil bukan sebagai ahli waris, tetapi dapat diberi bagian dari harta warisan berdasarkan wasiat wajibah" (the question put was for a case where no other heir remained) |
| SEMA 3/2015 no. 9 | 29 Des 2015 | daughters of a predeceased full sibling: wasiat wajibah (3.3) |
| **SEMA 3/2023**, Rumusan Kamar Agama no. 3 (pleno 19–21 Nov 2023, SEMA dated 29 Des 2023) | 2023 | "Dalam rangka melindungi kepentingan terbaik bagi anak, maka **anak kandung dari hasil perkawinan yang dilakukan menurut agama Islam tetapi tidak dicatatkan** dapat ditetapkan sebagai penerima wasiat wajibah dari pewaris." |
| SEMA 2/2024 (17 Des 2024) and SEMA 1/2025 (30 Des 2025) | — | **no** inheritance rumusan (MA Kepaniteraan news: https://kepaniteraan.mahkamahagung.go.id/registry-news/2470-inilah-rumusan-hukum-hasil-pleno-kamar-2024-6-diantaranya-menyempurnakan-hasil-pleno-kamar-sebelumnya and https://kepaniteraan.mahkamahagung.go.id/registry-news/2856-sah-ma-berlakukan-24-rumusan-kamar-hasil-pleno-kamar-2025-sebagai-pedoman-pelaksanaan-tugas-pengadilan ) |

**Amount is not fixed.** Wahyudi (2021, pp. 171–172), citing Puslitbang MA, *Dinamika Hukum Kewarisan
Islam Terkait Pembagian Harta Warisan Bagi Ahli Waris Beda Agama* (2016), shows three PA decisions
giving three different sizes (PTA Manado 0009/Pdt.G/2015: three non-Muslim heirs together = one
daughter's share; PA Sekayu 701/Pdt.G/2013: a Christian mother got ⅛; PA Jakarta Selatan
2554/Pdt.G/2011: a Christian daughter got 1/9 = half a Muslim daughter's 2/9) and concludes: "Ketentuan
yang berlaku secara pasti hanya bagian wasiat wajibah **tidak boleh melebihi 1/3** dari harta warisan."
Note 16 K/AG/2010 gave the non-Muslim wife the full wife's share (¼). **A self-service tool cannot
predict this number; it can only show the ceiling and refer to the PA.**

### 3.5 Harta bersama, hibah, and procedure

| Instrument | Date | Rule |
|---|---|---|
| Yurisprudensi 32 K/AG/2002 | 20 April 2005 | "Untuk membagi harta peninggalan yang di dalamnya terdapat harta bersama, maka **harta bersama harus dibagi terlebih dahulu**, dan hak pewaris atas harta bersama tersebut menjadi harta warisan" |
| Yurisprudensi 332 K/AG/2000 | 3 Agustus 2005 | first separate *harta bawaan* from *harta bersama*; "Apabila dilakukan hibah kepada pihak lain terhadap harta warisan yang belum dibagikan kepada ahli waris, maka hibah tersebut batal demi hukum" |
| Yurisprudensi 16 K/AG/2010 | 30 April 2010 | worked example: wife takes ½ of harta bersama (incl. a Rp 50 juta AIA life-insurance payout listed as harta bersama), the other ½ is the estate (see 4.H) |
| Yurisprudensi 266 K/AG/2010 | 12 Juli 2010 | on divorce, wife got **¾** of harta bersama because the husband gave no nafkah for 11 years → the 50/50 of Pasal 96–97 is a default a court can depart from |
| SEMA 5/2014 (Kamar Agama no. 2) | 1 Des 2014 | waris and harta bersama claims may be heard together where the estate still contains harta bersama |
| SEMA 1/2022 (Kamar Agama 1.a) | 15 Des 2022 | where harta bersama is the child's only home, division waits until the child is 21 or married |
| Yurisprudensi 76 K/AG/1992 | 23 Okt 1993 | a hibah exceeding ⅓ "bertentangan dengan ketentuan hukum" (enforces Pasal 210) |
| Yurisprudensi 75 K/AG/2003 | 14 Mei 2004 | to test the ⅓ hibah cap the whole estate must first be stated |
| SEMA 7/2012 no. 20 *(corrected in review from "no. 21"; same compilation p. 20)* | 2012 | a parent's hibah of harta bersama revoked by one parent alone: only ½ can be revoked |
| SEMA 7/2012 no. 17–19 | 2012 | an heir may not sell undivided estate alone; *asas ijbari*: ownership passes at the moment of death, and growth of an undivided productive estate counts as the heirs' collective effort |
| SEMA 1/2022 (Kamar Agama 2.b) | 2022 | an estate with no heir: BAZNAS or a statutory Baitul Mal may ask to administer it for social purposes |
| SEMA 7/2012 no. 10 | 2012 | the **pewaris' religion** decides the court: Muslim pewaris → Pengadilan Agama |
| Yurisprudensi 38 K/AG/1998 | 5 Okt 1998 | a second wife whose marriage was never annulled, and her daughter, are heirs |

**SEMAs the task named that do not change any number.** SEMA 4/2014 (2013 pleno): no inheritance item.
SEMA 4/2016 C.9: ownership disputes from an heir's *first* transaction with a third party stay in the PA,
later transactions go to the general courts. SEMA 1/2017 C.2: a waris suit must join **all** heirs or it
is inadmissible. SEMA 3/2018 III.A-5/6, III.A-7, III.B-2: land must be described; hibah-cancellation
suits need not join all heirs; no revoking a hibah that is collateral at a sharia bank. SEMA 2/2019 1.d
and SEMA 5/2021 2.a–b: a voluntary *Penetapan Ahli Waris* cannot be combined with itsbat nikah of the
pewaris (except pre-1974 marriages) and must be filed by all heirs or by proxy. SEMA 10/2020 C.2: amar for
immovable objects must order vacation. (All from the two compilations cited at the top of section 3.)
**Product consequence:** these are why the report should end with "how to get a *Penetapan Ahli Waris*",
listing that every heir must be included.

### 3.6 Radd to a spouse — no MA ruling found

I found no SEMA rumusan or yurisprudensi on whether a widow/widower shares in radd under Pasal 193.
A field study of PA Banjarmasin judges (Muzibur Rahman, UIN Antasari, 2016,
https://idr.uin-antasari.ac.id/5439/ ) found 2 of 3 judges would give radd to the spouse (following
'Uthman and the unqualified wording of Pasal 193), 1 would not. **Unsettled in practice.**

---
## 4. Divergence table

Column key. **Classical** = jumhur, and specifically the Syafi'i school as taught in Indonesian
pesantren (Fath al-Qarib, Fath al-Mu'in, al-Umm — all in `api/data/`). **KHI + MA** = the text of the
KHI as glossed by SEMA and yurisprudensi (section 3). **MUI** = an MUI fatwa that speaks to the point
(most rows: none). **PA today** = what a Pengadilan Agama is likely to do, *only as far as a source shows
it*. All money examples use a net estate of **Rp 1.200 juta** (after funeral, debts, wasiat, and — under
the KHI — after the surviving spouse's half of harta bersama has been taken out), unless the row says
otherwise. Fractions were computed exactly (Python `fractions`).

### 4.0 Summary

| # | Rule | Classical (Syafi'i) | KHI + MA | MUI | PA today |
|---|---|---|---|---|---|
| A | Grandchild of a **predeceased child** | Son's children inherit only if no son; daughter's children never (dzawil arham) | Both lines substitute for the parent (185; 68 K/AG/2001), capped (185(2)), only to cucu level (SEMA 3/2015) | none | KHI (676 K/AG/2012: courts may not ignore 185); cap computation varies |
| B | **Daughter(s) + siblings** | Siblings take the residue (sister as *'asabah ma'a al-ghayr*) — Bukhari 6734, 6736 | Any child blocks all siblings (86 K/AG/1994; 122, 184 K/AG/1995) | none | **Split** (MS Sigli 2013 follows MA; PA Banjarbaru 2017 follows jumhur) |
| C | **Son's daughter with one daughter** (son predeceased) | ⅙ *takmilat al-thuluthayn* (Bukhari 6736) | She stands in her father's place (185) → far more | none | KHI; cap reading unsettled |
| D | **Grandfather + siblings** | Muqasamah or ⅓ (or ⅙ / ⅓ of remainder with fard heirs) — al-Umm "باب ميراث الجد", Fath al-Qarib C139 | KHI silent on kakek's share; 181–182 condition siblings only on "anak dan ayah" | none | No ruling found |
| E | **Radd** (surplus, no *'asabah*) | Asl al-madhhab: to Baitul Mal; later Syafi'i: to fard heirs **except spouses**, then dzawil arham (Fath al-Mu'in C39) | 193: "dibagi berimbang di antara mereka" — spouses not excluded | none | **Split** (PA Banjarmasin 2016: 2 of 3 judges include spouse) |
| F | **Dzawil arham** (e.g. daughter's children, maternal uncle) | Excluded (asl); inherit only if no fard/*'asabah* and Baitul Mal is not orderly (Fath al-Mu'in) | Not in 174's list; reached through substitution (185) | none | Through 185 |
| G | **'Aul** | Yes | 192 = same | none | Same — **no divergence** |
| H | **Wasiat wajibah** | Not a Syafi'i institution (wasiat is voluntary, ≤⅓, none to an heir) | Adopted child / adoptive parent ≤⅓ (209); non-Muslim child/spouse (368 K/AG/1995; 16 K/AG/2010); stepchild raised from childhood (SEMA 7/2012); siblings' daughters (SEMA 3/2015); child of unregistered Islamic marriage (SEMA 3/2023) | Only as a state *ta'zir* for a zina child (11/2012); non-Muslims via **voluntary** hibah/wasiat (5/2005); adoptive father "boleh mewasiatkan" (1984) | KHI/MA; amount set by judge, ≤⅓ |
| I | **Musytarakah** (husband, mother, ≥2 uterine siblings, full brother) | Full brothers **share** the uterine ⅓ (al-Umm "ميراث المشركة") | Silent | none | No ruling found |
| J | **Barriers**: killer; non-Muslim; zina child | Any killer barred; no inheritance across religions; zina child ↔ mother only | Killer barred **only on a final conviction** (173); religion via 171(c); 186 = mother only | 5/2005 and 11/2012 = classical | KHI |
| K | **Father's share** | ⅙ with a son; ⅙ + residue with only daughters; residue when childless | 177 literal: ⅓ if no child; SEMA 2/1994 limits that to husband+mother case | none | SEMA 2/1994 |
| L | **Harta bersama** first | No presumed joint pool in the fara'id chapters read; property follows ownership | Surviving spouse takes ½ of harta bersama **before** fara'id (96(1); 32 K/AG/2002) | none | KHI, routinely |
| M | **Several wives** | Wives share one ¼/⅛ equally | Same share; plus each wife's gono-gini from **her own household** (190) | none | KHI (38 K/AG/1998 on a second wife) |
| N | **Perdamaian** | *Takharuj* "جائز متى كان عن تراض" (Fiqh as-Sunnah C1109, with the report of 'Abd al-Rahman b. 'Awf's widow settling her share) | 183: allowed "setelah masing-masing menyadari bagiannya"; minors act through a court-appointed wali (184) | none | KHI |
| O | **Gifts during life** | Hibah final on *qabd*, no ⅓ cap; a parent may revoke (Fath al-Qarib C134); be even-handed among children (Bukhari 2586–2587) | Hibah ≤⅓ (210; 76 K/AG/1992); a parent's hibah to a child "dapat diperhitungkan sebagai warisan" (211) | none (no fatwa found) | KHI |
| P | **Unregistered (siri) marriage** | A valid nikah makes spouse and children full heirs | Marriage proven only by Akta Nikah or *itsbat* (KHI 7); otherwise child may get wasiat wajibah (SEMA 3/2023) | none | KHI/MA |

### 4.1 Worked examples (net estate Rp 1.200 juta unless stated)

**A. Grandchildren of a predeceased son.** Pewaris (laki-laki) leaves a wife, one son, one daughter, and
the son and daughter of a second son who died before him.

| Heir | Classical | KHI 185 |
|---|---|---|
| Istri | ⅛ = 150 | ⅛ = 150 |
| Anak laki-laki | 700 | 420 |
| Anak perempuan | 350 | 210 |
| Cucu laki-laki (dari anak lk. yang wafat) | 0 (*mahjub* by the son: "ويحجب ولد ابن بابن", Fath al-Mu'in C39) | 280 |
| Cucu perempuan | 0 | 140 |

KHI: compute as if the predeceased son were alive (2 sons + 1 daughter share 1.050 in 2:2:1), pass his 420
to his children 2:1. 185(2) check: 420 does not exceed a son's 420. Classical route to the same intent: the
grandfather may make a **voluntary wasiat** (≤ ⅓, they are not heirs so no consent needed) — Bukhari 2742.

**B. Daughter + full brother (or full sister).** Pewaris leaves a wife, one daughter, one full brother.

| Heir | Classical | KHI + 86 K/AG/1994, radd **excluding** spouse | KHI + 86 K/AG/1994, radd **including** spouse (193 literal) |
|---|---|---|---|
| Istri | 150 (⅛) | 150 | 240 (⅕) |
| Anak perempuan | 600 (½) | 1.050 (⅞) | 960 (⅘) |
| Saudara laki-laki kandung | 450 (residue) | 0 | 0 |

Replace the brother with a full **sister**: classically she still takes the 450 (*'asabah ma'a al-ghayr*;
Bukhari 6736 / 6742, 6734); under 86 K/AG/1994 she gets 0. Three different answers from one family —
the report must show the user both the fikih and the PA result here (5.3).

**C. One daughter + son's daughter (son predeceased) + full sister.**

| Heir | Classical (Bukhari 6736) | KHI 185, full substitution |
|---|---|---|
| Anak perempuan | 600 (½) | 400 (⅓) |
| Cucu perempuan (dari anak lk.) | 200 (⅙, *takmilah*) | 800 (⅔, her father's share) |
| Saudari kandung | 400 (residue) | 0 (blocked by the "son") |

Whether 185(2) caps the granddaughter at the daughter's level is one of the unsettled readings in 3.3; I
did not compute a capped variant because I found no decision fixing the method.

**D. Grandfather (father's father) + 3 full brothers, nobody else.**

| Heir | Syafi'i / Zayd b. Thabit (al-Umm C805) | Abu Bakr / Ibn 'Abbas (Hanafi) | KHI |
|---|---|---|---|
| Kakek | 400 (⅓ beats muqasamah ¼) | 1.200 | no article |
| Each brother | 266,67 | 0 | — |

Also: classically the grandfather blocks **uterine** siblings (Fath al-Qarib C139: "ويسقط ولد الأم ... مع
الأب والجد"); KHI 181 blocks them only by "anak dan ayah". Engine: Syafi'i, with a note.

**E. Radd — wife + mother only** (no child, no siblings, no father).

| Heir | Syafi'i *asl al-madhhab* | Later Syafi'i (Fath al-Mu'in C39) | KHI 193 literal |
|---|---|---|---|
| Istri | 300 (¼) | 300 | 514,29 (3/7) |
| Ibu | 400 (⅓) | 900 (⅓ + all radd) | 685,71 (4/7) |
| Baitul Mal | 500 | 0 | 0 |

**Wife alone, no relative at all:** classical — ¼ = 300, the 900 to dzawil arham if any, otherwise Baitul
Mal; KHI 193 literal — wife takes 1.200; Egyptian law (quoted in Fiqh as-Sunnah C1098) gives the spouse
radd only after dzawil arham. If nobody at all: KHI 191 → Baitul Mal by court order; SEMA 1/2022 2.b lets
BAZNAS / a statutory Baitul Mal apply to manage it.

**F. Dzawil arham — a daughter's son (daughter predeceased) + full brother.**

| Heir | Classical | KHI 185, brother not blocked | KHI 185 + 86 K/AG/1994 (substitute counts as "anak") |
|---|---|---|---|
| Cucu laki-laki dari anak perempuan | 0 | 600 (his mother's ½) | 1.200 |
| Saudara laki-laki kandung | 1.200 | 600 | 0 |

The third column is my extrapolation (no decision found that combines the two); flag for review.

**G. 'Aul — husband + 2 full sisters + mother.** ½ + ⅔ + ⅙ = 8/6 → raised to 8 under both systems
(KHI 192): husband 450, each sister 300, mother 150. **No divergence.**

**H. Wasiat wajibah.**

*H1 — court-adopted son, no written wasiat.* Pewaris leaves a wife, one son, one daughter, an adopted son.

| Heir | Classical / MUI 1984 | KHI 209(2) at the ⅓ ceiling |
|---|---|---|
| Anak angkat | 0 (unless a voluntary wasiat was made) | ≤ 400 (taken first) |
| Istri | 150 | 100 |
| Anak laki-laki | 700 | 466,67 |
| Anak perempuan | 350 | 233,33 |

*H2 — Christian daughter of a Muslim father.* Wife, one Muslim son, one Christian daughter.

| Heir | Classical / MUI 5/2005 | MA line (368 K/AG/1995; method of 16 K/AG/2010: share computed as if she were an heir, ≤ ⅓) |
|---|---|---|
| Istri | 150 | 150 |
| Anak laki-laki | 1.050 | 700 |
| Anak perempuan (non-Muslim) | 0 by inheritance; hibah/wasiat possible | 350 as wasiat wajibah (other PAs gave half this — 3.4) |

*H3 — the MA's own worked example (16 K/AG/2010).* Husband (Muslim) dies; heirs: mother + 1 full brother
+ 3 full sisters; Christian wife of 18 years. Harta bersama (two houses, a motorbike, Rp 50 juta AIA life
insurance) → wife takes **½ as her own**; the other ½ is divided on a base of 60: mother 10/60 (⅙), wife
**15/60 as wasiat wajibah** (= a wife's ¼), brother 14/60, each sister 7/60. Classical (and MUI 5/2005):
the wife takes 0 of the estate (she keeps whatever was hers); mother ⅙, siblings the rest 2:1.

**I. Musytarakah — husband, mother, 2 uterine brothers, 1 full brother.**

| Heir | Syafi'i *tasyrik* (al-Umm C809) | Hanafi / Hanbali | KHI (silent) |
|---|---|---|---|
| Suami | 600 (½) | 600 | 600 (179) |
| Ibu | 200 (⅙) | 200 | 200 (178) |
| Each uterine brother | 133,33 | 200 | 200 (181) |
| Full brother | 133,33 | 0 | 0 on a literal reading |

**J. Barriers.** No numeric divergence except: an heir who killed the pewaris but was **not convicted**
is not barred by KHI 173 but is barred classically. The tool should ask and, if yes, send the user to a
court rather than compute.

**K. Father's share.**

| Case | Classical | KHI 177 read literally | KHI + SEMA 2/1994 |
|---|---|---|---|
| Father + mother only | father 800, mother 400 | father ⅓, mother ⅓, radd → 600 / 600 | 800 / 400 |
| Daughter + father | daughter 600, father ⅙ + residue = 600 | daughter ½, father ⅙, radd 3:1 → 900 / 300 | not addressed by the SEMA; I found no decision |
| Husband + mother + father | husband 600, mother 200, father 400 | same | same (this is the SEMA's case) |

**L. Harta bersama first.** Husband dies. Harta bersama Rp 1.000 juta, his own *harta bawaan* (inherited
from his parents) Rp 200 juta. Heirs: wife, 2 sons, 1 daughter.

| Step | KHI 96(1) + 171(e) + 32 K/AG/2002 | Everything treated as his property |
|---|---|---|
| Wife's half of harta bersama (her own, not inheritance) | 500 | 0 |
| Estate | 500 + 200 = 700 | 1.200 |
| Wife's fara'id share (⅛) | 87,5 | 150 |
| Each son | 245 | 420 |
| Daughter | 122,5 | 210 |
| **Wife in total** | **587,5** | **150** |

The single largest swing in the whole table. In classical fiqh the question is *who owned what*; the
KHI answers it with a statutory presumption (½ of what either spouse earned during the marriage, "tanpa
mempersoalkan terdaftar atas nama siapapun", KHI 1 huruf f). Whether that presumption is sound fiqh is
an ustadz question, not a calculation question (see 5.4).

**M. Two wives in two households.** Harta bersama with wife A Rp 800 juta, with wife B Rp 400 juta; one
son (by A), one daughter (by B). KHI 190: wife A keeps 400, wife B keeps 200; estate = 600; the two wives
share ⅛ = 37,5 each (Fath al-Qarib C139: "يشتركن كلهن في الثمن"); son 350, daughter 175. A wife married
without court permission for polygamy may face an itsbat obstacle (SEMA 7/2012 no. 12 — "tidak dapat
diisbatkan kecuali sudah ada izin poligami", stated for itsbat combined with divorce), but a second wife
whose marriage was never annulled inherits (38 K/AG/1998).

**N. Perdamaian.** 2 sons + 1 daughter: fara'id 480 / 480 / 240. All three, adult and informed, may agree
to 400 / 400 / 400 (KHI 183; *takharuj* "عن تراض"). The tool must show the fara'id numbers **first** and
the agreement as an optional, all-heirs-consent step; a minor's share cannot be waived (184).

**O. Gifts during life.** A father gave his eldest son a house worth Rp 300 juta in 2020 and dies leaving
Rp 900 juta, 2 sons, 1 daughter. Classical: the gift is final; estate 900 → 360 / 360 / 180 (the uneven gift
is a moral issue — Bukhari 2587 "فاتقوا الله واعدلوا بين أولادكم" — not a recalculation). KHI 211: a judge
**may** count it as an advance: notional 1.200 → 480 / 480 / 240, minus the 300 already received → eldest
180, second son 480, daughter 240. Also: a hibah > ⅓ of the donor's property is contestable (210;
76 K/AG/1992), and a hibah in the final illness needs heirs' consent (213).

**P. Unregistered (siri) marriage.** Classical: if the nikah was valid, the widow and children inherit
fully. KHI 7(1): marriage "hanya dapat dibuktikan dengan Akta Nikah"; otherwise itsbat nikah (7(2)–(3)),
which cannot be bundled into a voluntary *Penetapan Ahli Waris* (SEMA 2/2019 1.d). SEMA 3/2023 lets the
court give such a child a wasiat wajibah instead. The tool should treat a siri spouse/child as an heir in
the fiqh result **and** warn that the court will first need itsbat nikah.

---
## 5. Recommendation

### 5.1 What "aligned to MUI standard" can honestly mean

1. **MUI has no fara'id standard to align to.** It has six fatwas/decisions on edges (1.1–1.5, plus the 1984 land recommendation in 1.6) and no method for
   shares, hajb, 'aul, radd, the grandfather, or substitution (1.6). A page that says "dihitung sesuai
   standar MUI" would claim an endorsement that does not exist — the *no overclaiming* rule applies.
2. **Every MUI fatwa that touches inheritance is classical in substance**: no inheritance across
   religions (5/2005, citing Bukhari/Muslim), a zina child inherits only through the mother (11/2012),
   an adopted child keeps his biological nasab (1984) and so does not become the adopter's heir. Where MUI offers a remedy it is a
   **voluntary** hibah/wasiat (5/2005, 1984), or a *ta'zir* only the state can impose (11/2012).
3. **The KHI is the only Indonesian rule set that covers the whole field**, MUI's 2005 fatwa lists it
   under "Memperhatikan", and it is what a Pengadilan Agama will apply. Where it matches classical fiqh
   (most of Pasal 176–182, 192, 194–208) there is nothing to choose.
4. Where the KHI/MA **depart** from classical fiqh (rows A, B, C, E, F, H, K-literal, O, P), MUI has
   neither endorsed nor rejected the departure. Two of them (B, C) contradict hadiths in our own corpus
   (Bukhari 6734, 6736, 6742).

**Proposed meaning (for the operator to approve):** *"Perhitungan mengikuti faraidh berdasarkan Al-Qur'an
dan Sunnah menurut mazhab Syafi'i yang dipelajari di Indonesia, menaati fatwa MUI yang terkait
(No. 5/MUNAS VII/MUI/9/2005, No. 11 Tahun 2012, fatwa Adopsi 1984, Ijtima' Ulama V 2015), dan
menunjukkan bagaimana Kompilasi Hukum Islam dan Pengadilan Agama menghitungnya bila hasilnya berbeda."*
Suggested short label: **"Faraidh — selaras fatwa MUI, dengan catatan KHI"**, not "standar MUI".

### 5.2 Default engine mode

**One engine, two outputs.** The engine always computes two results from the same answers:

- **Hasil fikih** (primary): classical Syafi'i fara'id + MUI fatwas as hard constraints + KHI rules
  that are *procedural or ownership-related* and not in tension with the fatwas: the order of payments
  (175), the ⅓ wasiat cap and the heirs'-consent rule for a wasiat to an heir (195), harta bersama split
  first (96, 190 — see 5.4 Q5), and the SEMA 2/1994 father rule (which *is* the classical result).
- **Perkiraan Pengadilan Agama (KHI)**: the same plus 185 substitution (to cucu, SEMA 3/2015), the
  86 K/AG/1994 hajb rule, 193 radd including spouses, 209 and MA wasiat wajibah ceilings, 211 hibah
  set-off, KHI 7 itsbat warning.

The report shows **one** result when the two agree (e.g. a spouse, parents, and children including
at least one son, with no child having died before the pewaris) and a clearly labelled second column
only when a trigger fires. This keeps the questionnaire
simple for seniors and does not ask anyone to "pick a madhhab".

*Why fikih as primary rather than KHI:* it is what the MUI fatwas actually say, it is what the dalil on
the lesson pages will show, and it avoids presenting as "the Islamic share" two results (B, C) that a
sahih hadith in our corpus contradicts. *Why always show the KHI column when it differs:* it is what a
court will most likely do, it decides real money for real families, and hiding it would also be
overclaiming. **This is an operator decision (Q1 below), not something research can settle.**

### 5.3 Which divergences to surface, and how

| Trigger in the questionnaire | Surface as | Rows |
|---|---|---|
| Spouse survives **and** the couple earned assets during the marriage | A computation **step** shown to everyone ("½ harta bersama milik Ibu/Bapak sendiri"), with a toggle "semua harta ini milik almarhum" | L, M |
| A child of the pewaris died **before** the pewaris and left children | **Two numbers** (fikih / PA) + suggestion: a wasiat or hibah is how the fikih route provides for them | A, C, F |
| Only daughters (no son) **and** a sibling of the pewaris is alive | **Two numbers** — the most common family this affects | B |
| No *'asabah* and a surplus remains, spouse present | **Two numbers** (radd without / with spouse) | E |
| Spouse is the **only** relative | Two numbers + note on Baitul Mal / BAZNAS (SEMA 1/2022) | E |
| A court-adopted child, adoptive parent, stepchild raised since childhood, non-Muslim child/parent/spouse, child of an unregistered nikah, daughter of a predeceased sibling | Fikih: 0 as heir + "Anda dapat berwasiat/menghibahkan"; PA: **ceiling only** ("paling banyak ⅓; besarnya ditetapkan hakim") — never a precise court number | H, P |
| Grandfather with siblings; musytarakah; father with only daughters | **Note**, single (Syafi'i) number; say other mazhab/KHI-literal readings exist | D, I, K |
| Lifetime gifts to some children | Note on 211 (may be counted) + Bukhari 2587 on fairness; no recalculation unless the user asks | O |
| Heirs want to divide differently | Optional last step after the fara'id numbers; all adult heirs must agree; a minor's share cannot be waived | N |
| A killer among heirs; a child born outside marriage claiming from the father; a missing heir; an unborn child; deaths in one accident; a *khuntsa*; successive deaths before division | **Stop and refer** to the KUA / Pengadilan Agama — no number | J + out of scope |

Pension and insurance questions belong in the asset step: per Ijtima' Ulama V (1.4), non-contributory
or annuitised pension follows pension rules (**not** estate); contributory/self-funded pension not yet
annuitised, and severance/savings-type payouts made because of the death, **are** estate; per the
reported DSN-MUI fatwa (1.5) the deceased's own sharia life-insurance payout **is** estate. Mapping
named schemes (Taspen, ASABRI, BPJS JHT/JP) to these categories needs review (Q4 below).

### 5.4 Decisions for the operator and questions for the ustadz reviewer

**Operator (product):**
- **Q1.** Primary result = *Hasil fikih* (recommended) or *Perkiraan PA (KHI)*? Either way the other
  column appears on divergence.
- **Q2.** Approve the wording in 5.1; drop "standar MUI" from all UI copy.
- **Q3.** For non-Muslim relatives and adopted children, show only the ⅓ ceiling (recommended), or also
  an "as-if-heir" illustration like 16 K/AG/2010? The latter risks being read as a promise.
- **Q4.** The DSN-MUI insurance fatwa (1.5) must be cited by number before it is used; I could not find
  the number. Same review for mapping Taspen / ASABRI / BPJS JHT-JP / DPLK to the Ijtima' V categories.

**Ustadz reviewer (fiqh):**
- **Q5.** Is it right to apply the KHI 50/50 harta-bersama presumption *by default* in the **fikih**
  result, or should the fikih result ask "who earned/owns it" instead? This is the largest number in
  the whole tool (row L: a widow's 587,5 vs 150).
- **Q6.** Radd in the fikih result: follow the later Syafi'i position (no radd to a spouse, then
  dzawil arham) or allow radd to a spouse when no blood relative exists?
- **Q7.** Wording for rows B and C, where the court practice contradicts Bukhari 6736 / 6734: the copy
  must stay rahma/hikmah, explain without disparaging the courts, and must not instruct anyone to
  litigate.
- **Q8.** Confirm the Syafi'i defaults for the grandfather with siblings (al-Umm, Zayd b. Thabit),
  musytarakah (*tasyrik*), and the father taking ⅙ + residue with daughters.
- **Q9.** Should the lesson mention the Hanafi position on the grandfather (blocks siblings) at all, or
  keep to Syafi'i?

**Verification still owed (before launch):**
- KHI wording from a JDIH Kemenag / Badilag copy (I used archive.org + MUI Sumut; BPHN returned 403).
- The original SEMA 2/1994 text (JDIH MA behind Cloudflare).
- Fatwa MUI 11/2012 from an official MUI PDF (I used a reproduction).
- Hadith numbering for Bulugh al-Maram follows our corpus file, not yet the sunnah.com canonical scheme
  (see memory note on canonical numbering).

### 5.5 Engine order of operations (for the builder)

1. **Assets:** separate *harta bawaan* (own, gifts, inheritances — KHI 87) from *harta bersama*; take the
   surviving spouse's ½ of harta bersama out (96(1)); with several wives, per household (190). Classify
   pension/insurance (1.4, 1.5).
2. **Charges on the deceased's portion, in order:** last-illness costs and funeral → debts → wasiat
   (to non-heirs ≤ ⅓ without consent; above ⅓ or to an heir only with all heirs' consent — KHI 195, 201;
   Bukhari 2742; Bulugh 1114) → [PA column only] wasiat wajibah ≤ ⅓ (209; MA).
3. **Heirs:** Muslim at the time of death (171(c); MUI 5/2005); not barred (173 / classical); nasab through
   marriage (186; MUI 11/2012); adopted child is not an heir (MUI 1984; KHI 209 gives only wasiat
   wajibah).
4. **Shares:** hajb → furud (QS 4:11, 4:12, 4:176) → *'asabah* (Bukhari 6732) → 'aul (KHI 192) →
   radd (KHI 193, with the mode in Q6) → [PA column] 185 substitution and the 86 K/AG/1994 hajb rule.
5. **Report:** per heir, fraction + rupiah; the dalil anchor for each share; divergence cards from 5.3;
   "AI-assisted, bukan fatwa dan bukan putusan pengadilan"; next step: *Penetapan Ahli Waris* at the PA
   with **all** heirs joined (SEMA 1/2017 C.2; SEMA 5/2021 2.b).

---

## Appendix — dalil anchors already in our corpus (for the share cards)

| Rule | Anchor (corpus file → id) |
|---|---|
| Children, parents, 2:1 | QS an-Nisa' 4:11 (`quran.json`) |
| Spouses; uterine siblings | QS 4:12 |
| Full/paternal siblings (*kalalah*) | QS 4:176 |
| Residue to the nearest male | Bukhari 6732 (also 6735, 6737) |
| Daughter + son's daughter + sister | Bukhari 6736, 6742; Bulugh 1097 |
| Daughter + sister (Mu'adh) | Bukhari 6734 |
| No inheritance across religions | Bukhari 6764; Bulugh 1096, 1098; QS 4:141 (cited by MUI 5/2005) |
| Grandmother ⅙ | Bulugh 1103 |
| Grandfather ⅙ | Bulugh 1101 (isnad weakness noted in 1102) |
| Maternal uncle when no heir (dzawil arham) | Bulugh 1104, 1105; QS 8:75, 33:6 |
| Newborn who cried inherits | Bulugh 1106 |
| Killer does not inherit | Bulugh 1107 (noted there as *mawquf* on 'Umar); Fath al-Qarib C138 |
| Wasiat ≤ ⅓ | Bukhari 2742, 6733; Bulugh 1112 |
| No wasiat to an heir | Bulugh 1114 (the "إلا أن يشاء الورثة" addition, 1115, is graded *munkar* in the corpus footnote; the consent rule itself is in Fath al-Qarib C140) |
| Write your wasiat | Bulugh 1111 |
| Basis cited for wasiat wajibah | QS 2:180 (per Wahyudi 2021, following Ibn Hazm) |
| Adoption does not create nasab | QS 33:4–5 (cited by MUI 1984) |
| Distribute to relatives/orphans present | QS 4:8 (my reading: a likely source of KHI 171(e) "pemberian untuk kerabat"; not stated in the KHI) |
| Fairness in gifts to children | Bukhari 2586, 2587 |
| Fixed shares, hajb lists (Syafi'i) | Fath al-Qarib C138–C140; Fath al-Mu'in C39 |
| Grandfather with siblings | al-Umm C805 |
| Musytarakah | al-Umm C809 |
| Radd (Syafi'i against) | al-Umm C804; Fath al-Mu'in C39 (later position) |
| Dzawil arham (positions) | Fiqh as-Sunnah C1099 |
| Takharuj | Fiqh as-Sunnah C1109 |
