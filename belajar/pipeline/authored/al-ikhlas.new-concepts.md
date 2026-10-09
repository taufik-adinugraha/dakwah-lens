# Al-Ikhlas (QS 112): Konsep links for the integrator

Companion to `al-ikhlas.words.json`, `al-ikhlas.structure.json` and `al-ikhlas.concepts-map.json`.
It lists (A) six new Konsep ids the Al-Ikhlas files use, with the sourced facts each record
should explain, and (B) the example pairs that existing Konsep records need, because
`validate.py` checks `Word.concepts` against `Concept.examples` in both directions.

Every page below was opened on 2026-10-09; Shamela page titles give the printed volume/page and
each edition states that its pagination follows the print. Records stay `status: "draft"` as
pipeline state (plan L11: there is no human review step). Learner-facing strings are proposals in
the house register: plain Indonesian, "Anda", SKB transliteration, no Arabic script outside
«Tanzil quotes», grammar terms in pesantren spelling.

Source short names used below (full strings as in the `kitab` table of `al-ikhlas.words.json`):

| Short | Edition | Shamela |
|---|---|---|
| Darwisy | Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H) | 2163 |
| al-Jadwal | Mahmud Shafi, al-Jadwal ... (Dar ar-Rasyid / Mu'assasat al-Iman, cet. 3, 1416 H/1995 M) | 22916 |
| al-Mujtaba | Ahmad al-Kharrath, al-Mujtaba min Musykil I'rab al-Qur'an (Mujamma' al-Malik Fahd, 1426 H) | 9617 |
| an-Nahhas | Abu Ja'far an-Nahhas, I'rab al-Qur'an (Dar al-Kutub al-'Ilmiyyah, cet. 1, 1421 H) | 23587 |
| as-Samin | as-Samin al-Halabi, ad-Durr al-Mashun (tahqiq al-Kharrath, Dar al-Qalam) | 9057 |
| Mughni | Ibnu Hisyam, Mughni al-Labib (Dar al-Fikr, cet. 6, 1985) | 6972 |
| Qathr | Ibnu Hisyam, Syarh Qathr an-Nada (cet. 11, 1383 H/1963 M) | 6970 |
| Ajurrumiyyah | Ibnu Ajurrum, al-Ajurrumiyyah (Dar ash-Shumai'i, 1419 H/1998) | 11371 |
| ath-Thabari | Jami' al-Bayan (tahqiq at-Turki, Dar Hajr, cet. 1, 1422 H/2001 M) | 7798 |

## A. New Konsep ids

The build fails until these six ids exist in `library.concepts.json`. Al-Falaq and An-Nas
authors may propose overlapping ids (for example `maqul-al-qaul` for their `qul a‘ūżu`); merge
them into one record and add their locs to `examples`.

### 1. `maqul-al-qaul` (kind: nahwu)

- Title: "Maqul al-qaul (isi perkataan sesudah qul)"
- Summary: "Sesudah kata kerja 'berkata', seperti qul (“katakanlah”), kalimat yang diucapkan disebut maqul al-qaul, dan seluruh kalimat itu menempati kedudukan nashab."
- What to explain, with sources:
  - A whole sentence can stand in the place of a maf'ul; the first such case is reported speech
    after a form of qāla. Mughni hlm. 538, https://shamela.ws/book/6972/526
  - QS 112:1: the sentence huwa Allāhu aḥadun is in the place of nashb as maqul al-qaul, and the
    sentence that starts with qul has no i'rab place (ibtida'iyyah). al-Jadwal jil. 15, hlm. 425,
    https://shamela.ws/book/22916/5917
  - qul is a fi'il amr whose fa'il is hidden, "engkau, wahai Muhammad". Darwisy jil. 10,
    hlm. 616, https://shamela.ws/book/2163/5774 ; the same wording, plus "the sentence a‘ūżu is
    maqul al-qaul", for QS 113:1 (hlm. 623, https://shamela.ws/book/2163/5781) and QS 114:1
    (hlm. 625, https://shamela.ws/book/2163/5783).
- Examples: `112:1:1` — "qul: seluruh huwa Allāhu aḥadun sesudahnya adalah isi perkataan (maqul al-qaul), berkedudukan nashab."
- Related: `fiil-amr`, `jumlah-ismiyyah`, `maful-bih`.

### 2. `dhamir-syan` (kind: nahwu)

- Title: "Dhamir sya'n (kata ganti “perkara”)"
- Summary: "Dhamir sya'n adalah kata ganti di awal kalimat yang tidak menunjuk kata sebelumnya, tetapi isinya dijelaskan oleh kalimat sesudahnya, seperti huwa dalam huwa Allāhu aḥadun menurut banyak ulama."
- What to explain, with sources:
  - It is one of the places where a pronoun refers to what comes after it; Ibnu Hisyam's example
    is QS 112:1; Kufan grammarians call it "dhamir al-majhul". It differs from ordinary pronouns:
    it points forward, it is explained only by a sentence, nothing follows it as a tabi', only
    ibtida' or its replacing 'amil governs it, and it is always singular. He adds that it should
    not be assumed when another analysis is possible. Mughni hlm. 635–637,
    https://shamela.ws/book/6972/624 (hlm. 636) and https://shamela.ws/book/6972/625 (hlm. 637)
  - an-Nahhas calls it "kināyah 'an al-ḥadīts" and gives it as the view of most Basran grammarians
    and al-Kisa'i; al-Farra' does not allow it without a preceding word; al-Akhfasy takes huwa as
    a pronoun for a single thing. an-Nahhas jil. 5, hlm. 194–195,
    https://shamela.ws/book/23587/1411
  - az-Zamakhsyari (quoted by Darwisy): huwa is mubtada', the sentence after it is its khabar, and
    no returning pronoun is needed because the sentence is itself the "perkara" huwa points to.
    Darwisy jil. 10, hlm. 616, https://shamela.ws/book/2163/5774
  - The other view must be stated beside it: huwa refers to the Lord the Prophet was asked about
    (as-Samin's first view, jil. 11, hlm. 149, https://shamela.ws/book/9057/10749 ; also Darwisy
    hlm. 616 and al-Jadwal jil. 15, hlm. 425 footnote 1). al-Mujtaba gives only the sya'n view
    (jil. 4, hlm. 1491, https://shamela.ws/book/9617/6019).
- Examples: `112:1:2` — "huwa: menurut al-Mujtaba dan banyak ulama, dhamir sya'n yang dijelaskan oleh kalimat Allāhu aḥadun."
- Related: `dhamir`, `jumlah-ismiyyah`, `khabar-jumlah`.
- Aqidah wording: describe the construction only ("perkaranya ialah: Allah itu Esa"); do not
  gloss huwa with anything that speculates about Allah's essence.

### 3. `khabar-jumlah` (kind: nahwu)

- Title: "Khabar berupa kalimat (khabar jumlah)"
- Summary: "Khabar tidak selalu satu kata; ia bisa berupa kalimat lengkap, misalnya mubtada' bersama khabarnya sendiri."
- What to explain, with sources:
  - Khabar is either mufrad or not; the non-mufrad khabar is of four kinds: jar-majrur, zharaf,
    fi'il with its fa'il, and mubtada' with its khabar. Ajurrumiyyah hlm. 13,
    https://shamela.ws/book/11371/12 (the same page lists huwa among the pronouns that can be
    mubtada').
  - QS 112: the sentence Allāhu aḥadun is in the place of raf' as khabar of huwa; Allāhu
    aṣ-ṣamadu is a second khabar and lam yalid a third (or each a new sentence, footnotes 3–4).
    al-Jadwal jil. 15, hlm. 425, https://shamela.ws/book/22916/5917 ; al-Mujtaba jil. 4,
    hlm. 1491, https://shamela.ws/book/9617/6019 to /6021.
  - Why no returning pronoun is needed here: Darwisy hlm. 616 (az-Zamakhsyari), as in 2.
- Examples:
  - `112:1:2` — "huwa: mubtada' yang khabarnya sebuah kalimat, Allāhu aḥadun."
  - `112:1:3` — "Allāhu: awal kalimat Allāhu aḥadun, yang seluruhnya menjadi khabar bagi huwa."
  - `112:2:1` — "Allāhu aṣ-ṣamadu: menurut al-Jadwal dan al-Mujtaba, seluruh kalimat ini khabar kedua bagi huwa."
- Related: `jumlah-ismiyyah`, `syibhul-jumlah` (jar-majrur is another non-mufrad khabar), `dhamir-syan`.

### 4. `jazm-lam` (kind: nahwu)

- Title: "Lam: huruf yang menafikan dan menjazmkan fi'il mudhari'"
- Summary: "Lam meniadakan fi'il mudhari' sesudahnya dan membuatnya majzum; bila huruf akhirnya sahih, tanda jazm-nya sukun."
- What to explain, with sources:
  - lam is a huruf of jazm that negates the mudhari'; Ibnu Hisyam's example is lam yalid wa lam
    yūlad. Mughni hlm. 365, https://shamela.ws/book/6972/353
  - lam is among the jawazim; the mudhari' is marfu' until a nashib or jazim comes before it.
    Ajurrumiyyah hlm. 10, https://shamela.ws/book/11371/7
  - The two signs of jazm: sukun (mudhari' with a sound last letter) and hadzf (weak last letter,
    and the af'al khamsah). Ajurrumiyyah hlm. 8, https://shamela.ws/book/11371/5
  - A word joined by 'athaf to a majzum word is also majzum ("Zaid lam yaqum wa lam yaq'ud").
    Ajurrumiyyah hlm. 15, https://shamela.ws/book/11371/16
  - QS 112: lam is "huruf nafi, qalb dan jazm"; yalid and yakun are mudhari' majzum by lam;
    lam yūlad is joined to it. Darwisy jil. 10, hlm. 617, https://shamela.ws/book/2163/5775
- Care with qalb: Mughni and Darwisy say lam turns the mudhari' to a past meaning. If the record
  says so, add that in QS 112 the negation is absolute, not limited to the past: ath-Thabari
  explains lam yalid as "Dia tidak binasa" and lam yūlad as "Dia tidak diadakan sesudah tiada",
  because Allah has always been and remains (ath-Thabari jil. 24, hlm. 737,
  https://shamela.ws/book/7798/16681). The muhaqqiq's footnote on that page objects to
  ath-Thabari's term "qadim"; use "senantiasa ada" (lam yazal) instead. The word cards leave qalb
  out for this reason.
- Examples:
  - `112:3:1` — "lam: huruf nafi dan jazm; ia menjazmkan yalid."
  - `112:3:2` — "yalid: majzum karena lam, dengan tanda sukun."
  - `112:3:3` — "wa lam: lam lagi, sehingga yūlad juga majzum."
  - `112:3:4` — "yūlad: majzum oleh lam, dengan tanda sukun."
  - `112:4:1` — "wa lam: lam sekali lagi, kini menjazmkan yakun."
  - `112:4:2` — "yakun: majzum oleh lam; sukun ada pada nun di akhirnya."
- Related: `fiil-mudhari`, `tanda-irab`, `athaf`, `kana-wa-akhawatuha`.

### 5. `fiil-majhul` (kind: sharaf)

- Title: "Fi'il majhul (kata kerja pasif: “di-…”)"
- Summary: "Fi'il majhul adalah kata kerja yang pelakunya tidak disebut; pada fi'il mudhari', huruf pertamanya berharakat dhammah dan huruf sebelum akhirnya berharakat fathah."
- What to explain, with sources:
  - Pattern of the verb whose doer is not named: madhi — first letter dhammah, the letter before
    the last kasrah; mudhari' — first letter dhammah, the letter before the last fathah.
    Ajurrumiyyah hlm. 12, https://shamela.ws/book/11371/10
  - yūlad keeps its waw (it falls between ya' and fathah), while the active yalid drops it
    (between ya' and kasrah). an-Nahhas jil. 5, hlm. 196, https://shamela.ws/book/23587/1413
  - QAC 0.4 tags 112:3:4 PASS (the build labels it "fi'il mudhari' (majhul)").
- Not sourced, so leave out: the kitab cited for QS 112 do not name the na'ib fa'il of yūlad.
- Examples: `112:3:4` — "yūlad: “diperanakkan”; huruf pertamanya dhammah dan huruf sebelum akhirnya fathah."
- Related: `naib-fail`, `isim-maful`, `fiil-mudhari`.

### 6. `kana-wa-akhawatuha` (kind: nahwu)

- Title: "Kāna dan saudaranya (isim marfu', khabar manshub)"
- Summary: "Kāna dan saudara-saudaranya masuk pada mubtada' dan khabar: isimnya marfu' dan khabarnya manshub, dan khabar itu boleh diletakkan sebelum isimnya."
- What to explain, with sources:
  - kāna and its sisters raise the ism and put the khabar in nashb, including their mudhari'
    forms (yakūnu). Ajurrumiyyah hlm. 13, https://shamela.ws/book/11371/13
  - A sentence with kāna is a jumlah fi'liyyah (Ibnu Hisyam's example "kāna zaidun qā'iman"),
    and particles before it are not counted. Mughni hlm. 492, https://shamela.ws/book/6972/480
  - QS 112:4: kufuwan is the khabar of yakun placed first, aḥadun its ism placed last, lahū
    attached to kufuwan. Darwisy jil. 10, hlm. 617, https://shamela.ws/book/2163/5775 ;
    al-Mujtaba jil. 4, hlm. 1491, https://shamela.ws/book/9617/6022 ; an-Nahhas jil. 5,
    hlm. 196 ("pendapat kebanyakan ahli nahwu"), https://shamela.ws/book/23587/1413 ; as-Samin
    jil. 11, hlm. 152, https://shamela.ws/book/9057/10754
  - Why this order: lahū comes first because the ayah is about denying any equal to Allah
    (az-Zamakhsyari, quoted by Darwisy hlm. 617 and as-Samin hlm. 152–153); Abu Hayyan: lahū is
    fronted because it holds the pronoun for Allah, and the ism comes last because it is the
    rhyming end of the ayah (fashilah) (Darwisy hlm. 617, as-Samin hlm. 153,
    https://shamela.ws/book/9057/10755).
  - The other reading (Makki, Abu al-Baqa': lahū khabar, kufuwan hal) is in the ikhtilaf of
    112:4:3 and 112:4:4; the record can mention that grammarians differ.
- Examples:
  - `112:4:2` — "yakun: bentuk mudhari' dari kāna, majzum karena lam."
  - `112:4:4` — "kufuwan: khabar yakun, manshub, diletakkan sebelum isimnya."
  - `112:4:5` — "aḥadun: isim yakun, marfu', diletakkan di akhir."
- Related: `jumlah-ismiyyah`, `tanda-irab`, `jazm-lam`, `fiil-mudhari`.

Considered and not proposed:
- fashl and washl (why ayat 1–3 open without wa and the last three sentences are joined by wa;
  Darwisy hlm. 616–617) is balaghah; `Concept.kind` allows only nahwu and sharaf, so it is told in
  the structure summaries of ayat 2–4 instead.
- tanwin (aḥadun, kufuwan) needs no record of its own for this surah; the cards say
  "dhammah bertanwin" / "fathah bertanwin" and use the signs `dhammatain` / `fathatain`, which
  `WordCard.tsx` already knows. If Al-Falaq uses `kasratain`, keep the three consistent.

## B. Example pairs for existing Konsep records

Add each pair to that record's `examples` (`{ "loc", "note" }`). Notes are proposals in the house
style; each restates a claim already sourced in the word or structure files.

| Konsep | loc | note |
|---|---|---|
| `kalimah-isim-fiil-huruf` | 112:3:1 | lam: huruf; maknanya baru utuh bersama kata kerja sesudahnya. |
| `tanda-irab` | 112:1:3 | Allāhu: dhammah, tanda rafa', karena menjadi mubtada' kedua. |
| `tanda-irab` | 112:1:4 | aḥadun: dhammah bertanwin, tanda rafa', karena menjadi khabar. |
| `tanda-irab` | 112:3:2 | yalid: sukun, tanda jazm, karena didahului lam. |
| `tanda-irab` | 112:4:4 | kufuwan: fathah bertanwin, tanda nashab, karena menjadi khabar yakun. |
| `tanda-irab` | 112:4:5 | aḥadun: dhammah bertanwin, tanda rafa', karena menjadi isim yakun. |
| `huruf-jar` | 112:4:3 | li- + -hū: kata ganti mabni dalam kedudukan jar; frasanya bergantung pada kufuwan. |
| `naat` | 112:2:2 | aṣ-ṣamadu: menurut an-Nahhas, sifat bagi Allāhu (pendapat lain: khabar). |
| `jumlah-ismiyyah` | 112:1:2 | huwa: mubtada' yang khabarnya kalimat Allāhu aḥadun. |
| `jumlah-ismiyyah` | 112:1:3 | Allāhu: mubtada' kedua dalam kalimat Allāhu aḥadun. |
| `jumlah-ismiyyah` | 112:1:4 | aḥadun: khabar bagi Allāhu, “Allah itu Esa”. |
| `jumlah-ismiyyah` | 112:2:1 | Allāhu: mubtada' bagi aṣ-ṣamadu. |
| `jumlah-ismiyyah` | 112:2:2 | aṣ-ṣamadu: khabar bagi Allāhu. |
| `wazan-dan-tashrif` | 112:2:2 | aṣ-ṣamadu: wazan fa‘alun, bermakna maf‘ūlun, “yang dituju”. |
| `wazan-dan-tashrif` | 112:4:4 | kufuwan: wazan fu‘ulun dengan dua dhammah; wawu-nya keringanan dari hamzah. |
| `murab-mabni` | 112:1:1 | qul: fi'il amr, mabni di atas sukun. |
| `murab-mabni` | 112:1:2 | huwa: kata ganti mabni, kedudukannya rafa' sebagai mubtada'. |
| `dhamir` | 112:1:2 | huwa: dhamir munfashil “Dia”, sebagai mubtada'. |
| `dhamir` | 112:4:3 | -hū pada lahū: dhamir muttashil “Dia” sesudah huruf jar. |
| `fiil-mudhari` | 112:3:2 | yalid: fi'il mudhari' yang majzum karena lam. |
| `fiil-mudhari` | 112:3:4 | yūlad: fi'il mudhari' bentuk majhul, juga majzum. |
| `fiil-mudhari` | 112:4:2 | yakun: fi'il mudhari' dari kāna, majzum karena lam. |
| `jumlah-filiyyah` | 112:1:1 | qul: fi'il amr dengan fa'il tersirat “engkau”. |
| `athaf` | 112:3:3 | wa: menyambungkan kalimat lam yūlad dengan kalimat lam yalid; yūlad majzum oleh lam-nya sendiri. (Diperbaiki fixer 2026-10-09, temuan D4: ad-Da'as 3/476, al-Jadwal 15/425.) |
| `athaf` | 112:4:1 | wa: menyambungkan kalimat lam yakun dengan lam yalid. |
| `ilal` | 112:1:4 | aḥadun: hamzahnya pengganti wawu (dari al-waḥdah), menurut pendapat yang dikenal. |
| `ilal` | 112:3:2 | yalid: wawu, huruf pertama akarnya, dibuang karena terletak di antara ya' dan kasrah (an-Nahhas). |
| `fiil-amr` | 112:1:1 | qul: fi'il amr “katakanlah”, perintah kepada Nabi; mabni di atas sukun. |

Text updates the existing records will need once these examples are added:
- `fiil-amr` is titled "Fi'il amr (bentuk perintah yang menjadi doa)", which fits ihdinā (1:6:1)
  but not qul, a real command. Suggest "Fi'il amr (kata perintah)" and one sentence that a fi'il
  amr addressed to Allah is a doa (as now) while qul is a command to the Prophet (Darwisy
  hlm. 616). Source for "mabni di atas sukun": Qathr hlm. 31, https://shamela.ws/book/6970/19.
  Ajurrumiyyah hlm. 10 says instead that the amr is "majzum selamanya"; if the record mentions
  this difference, attribute both.
- `tanda-irab` and `fiil-mudhari` explain only raf'/nashb/jar and the marfu' mudhari'; add the
  jazm state and its sukun sign (Ajurrumiyyah hlm. 8 and 10) so the 112 examples read naturally.
- `ilal` ("perubahan huruf wawu dan ya'") now also covers wawu replaced by hamzah (ibdal, aḥad)
  and wawu dropped (hadzf, yalid); the README already treats ibdal and hadzf under i'lal.
- `naat`: the 112:2:2 example is an alternative view (an-Nahhas), like the badal example on 1:2:3.

## C. Other things the build will meet (not Konsep)

- Kosakata/Akar: new QAC LEMs `qaAla`, `>aHad` (used twice, two senses: "esa" 112:1:4, "seorang
  pun" in negation 112:4:5, an-Nahhas hlm. 195), `S~amad` (QAC spells it with an assimilation
  shaddah, like raḥmān), `lam`, `walada`, `kaAna`, `kufuw`; roots qwl, AHd, Smd, wld, kwn, kfA.
  huwa (112:1:2) and the -hū of lahū (112:4:3) are PRON stems without LEM in QAC 0.4, so
  `lemma_id` stays null (build_surah.py already warns).
- QuranEnc `indonesian_affairs` sura 112 must be in the pinned cache; the glosses were checked
  against its text (all 15 pass the gloss heuristic; 112:4:3 "bagi-Nya" carries a
  `gloss_exception`).
