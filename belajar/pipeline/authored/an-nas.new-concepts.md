# An-Nas (QS 114): Konsep work for the integrator

Input for whoever edits `authored/library.concepts.json`. It covers two jobs:

1. Author three new Konsep records (`athaf-bayan`, `rubai-mujarrad`, `hal`) and add An-Nas examples to the two new records shared with the Al-Ikhlas and Al-Falaq authors (`maqul-al-qaul`, `sighat-mubalaghah`). All five are already used in `an-nas.concepts-map.json`; `maqul-al-qaul` and `hal` are also group `concept` values in `an-nas.structure.json`.
2. Add the An-Nas example locs to existing Konsep records (section 3).

`validate.py` checks the concepts map against each concept's `examples` in both directions, so the build fails until both jobs are done.

Every page below was opened on 2026-10-09 (Shamela page titles show the printed volume and page; all editions cited say "ترقيم الكتاب موافق للمطبوع"). Records stay `status: "draft"` as pipeline state. There is no human review step (plan L11), so no record may promise one.

Word numbering follows QAC 0.4 = the Tanzil text after the surah-heading basmalah: 4 + 2 + 2 + 4 + 5 + 3 = 20 words.

Suggested titles, summaries and notes below are drafts in plain Indonesian; they name words in SKB transliteration only (no Arabic script), so they should pass `validate.check_prose` and `check_translit_prose`.

## 1. Coordination with the Al-Ikhlas and Al-Falaq authors

- **`maqul-al-qaul`**: the same id as `al-ikhlas.concepts-map.json` and `al-falaq.concepts-map.json` (I first drafted `maqul-qaul` and switched). One record, examples from all three surahs.
- **`sighat-mubalaghah`**: the same id as the Al-Falaq map (an-naffāṡāti). An-Nas adds al-khannāsi. One point differs, see the note under the record: the Al-Falaq file calls al-khannās "fa‘‘ālun", but no kitab I opened states that wazan for al-khannās, so `an-nas.words.json` leaves its `wazn` null.
- New here, not proposed by the other two files: `athaf-bayan`, `rubai-mujarrad`, `hal`.

## 2. New concepts (mapped)

### `maqul-al-qaul` (kind: nahwu), shared: An-Nas examples and sources only

- **An-Nas facts, each with its source:**
  - Qul is a fi'il amr with an implied doer, anta ("engkau"); the sentence a‘ūżu … is maqul al-qaul; a‘ūżu is a fi'il mudhari' marfu' whose doer is the implied anā ("aku"): Darwisy jil. 10 hlm. 625.
  - The qul sentence is ibtida'iyyah with no i'rab position; the a‘ūżu sentence stands in nashab as maqul al-qaul: al-Jadwal jil. 15 hlm. 429; ad-Da'as jil. 3 hlm. 477.
  - The sentence continues to the end of the surah: min syarri (114:4) also attaches to a‘ūżu (Darwisy hlm. 625; al-Jadwal hlm. 429; al-Mujtaba jil. 4 hlm. 1493).
- **Examples:**
  - `114:1:1`: "qul: perintah “katakanlah”; kalimat yang diawali a‘ūżu adalah isi perkataannya."
  - `114:1:2`: "a‘ūżu: awal isi perkataan, sebuah kalimat yang berkedudukan nashab."
- **Sources (SourceRef):**
  - Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H). Ref: jil. 10, hlm. 625 (al-I'rab QS 114:1: qul fi'il amr, pelakunya anta; jumlah a‘ūżu maqul al-qaul). URL: https://shamela.ws/book/2163/5783
  - Mahmud Shafi, al-Jadwal fi I'rab al-Qur'an wa Sharfihi wa Bayanihi (Damaskus: Dar ar-Rasyid; Beirut: Mu'assasat al-Iman, cet. 3, 1416 H/1995 M). Ref: jil. 15, hlm. 429 (QS 114: jumlah qul ibtida'iyyah; jumlah a‘ūżu berkedudukan nashab, maqul al-qaul). URL: https://shamela.ws/book/22916/5921
  - Ahmad 'Ubaid ad-Da'as, Ahmad Muhammad Humaidan, Isma'il Mahmud al-Qasim, I'rab al-Qur'an al-Karim (Damaskus: Dar al-Munir dan Dar al-Farabi, cet. 1, 1425 H). Ref: jil. 3, hlm. 477 (QS 114:1: jumlah a‘ūżu maqul al-qaul). URL: https://shamela.ws/book/23584/1399
  - The rule (Mughni al-Labib hlm. 538, bab al-hikayah bil-qaul) is already in the Al-Falaq file.

### `sighat-mubalaghah` (kind: sharaf), shared: An-Nas example and sources only

- **An-Nas facts, each with its source:**
  - Al-khannās is a mubalaghah of the isim fa'il from the three-letter verb khanasa, "tawārā wa ikhtafā" (bersembunyi, menghilang): al-Jadwal jil. 15 hlm. 430 (ash-Sharf).
  - As-Samin calls it a "mitsāl mubalaghah" from al-khunūs and glosses it as ar-rajjā‘ ("yang sering kembali/mundur"), because it retreats when Allah is mentioned: as-Samin jil. 11 hlm. 162.
  - Meaning, protective frame: Ibnu 'Abbas (via Sa'id bin Jubair) said the syaitan crouches on the heart of the son of Adam; when the person is heedless it whispers, and when he remembers Allah it retreats (khanasa): Ibnu Katsir jil. 8 hlm. 540. An-Nahhas jil. 5 hlm. 199 gives two narrations from Ibnu 'Abbas (it retreats when Allah is mentioned; it retreats once it is obeyed) and says they agree. Use this hopeful reading: remembering Allah makes the whisperer withdraw. Do not use the Abu Ya'la hadith on Ibnu Katsir hlm. 539: the editor quotes Ibnu Hajar that its chain is weak.
- **Not sourced, so not stated:** the wazan of al-khannās. Al-Jadwal names it a mubalaghah of the isim fa'il but gives no wazan; on hlm. 428 (113:4) it gives fa‘‘āl for an-naffāṡāt, and Ibnu 'Aqil jil. 3 hlm. 111 lists fa‘‘āl among the mubalaghah forms. Reading fa‘‘āl into al-khannās from those two is an inference. If the record wants to say it, it should say "al-khannās juga berbentuk mubalaghah (al-Jadwal)" without a wazan, or the integrator decides that the inference is acceptable and fills `wazn` for 114:4:4 too.
- **Example:**
  - `114:4:4`: "al-khannāsi: bentuk mubalaghah dari khanasa (“bersembunyi, mundur”): yang sering mundur bersembunyi (al-Jadwal; as-Samin)."
- **Sources (SourceRef):**
  - Mahmud Shafi, al-Jadwal … (cet. 3, 1416 H/1995 M). Ref: jil. 15, hlm. 430 (ash-Sharf: al-khannās mubalaghah isim fa'il dari khanasa). URL: https://shamela.ws/book/22916/5922
  - as-Samin al-Halabi, ad-Durr al-Mashun fi 'Ulum al-Kitab al-Maknun (tahqiq Ahmad Muhammad al-Kharrath; Damaskus: Dar al-Qalam). Ref: jil. 11, hlm. 162 (al-khannās: ar-rajjā‘, mitsāl mubalaghah dari al-khunūs). URL: https://shamela.ws/book/9057/10767
  - Ibnu Katsir, Tafsir al-Qur'an al-'Azhim (tahqiq Sami bin Muhammad as-Salamah; Riyadh: Dar Thaibah, cet. 2, 1420 H/1999 M). Ref: jil. 8, hlm. 540 (riwayat Ibnu 'Abbas tentang al-waswās al-khannās). URL: https://shamela.ws/book/8473/4586
  - Ibnu 'Aqil, Syarh Ibn 'Aqil 'ala Alfiyyah Ibn Malik (tahqiq Muhammad Muhyiddin 'Abd al-Hamid, Kairo: Dar at-Turats, cet. 20, 1400 H/1980 M). Ref: jil. 3, hlm. 111 (bab I'mal Ism al-Fa'il: fa‘‘āl, mif‘āl, fa‘ūl, fa‘īl dan fa‘il dibentuk untuk makna banyak). URL: https://shamela.ws/book/9904/789

### `athaf-bayan` (kind: nahwu), new

- **Suggested title:** 'Athf bayan (penjelas yang mengikuti)
- **Suggested summary:** 'Athf bayan adalah kata jamid (bukan kata turunan) yang mengikuti kata sebelumnya untuk menjelaskannya, mirip sifat, dan ikut dalam seluruh i'rab-nya.
- **Points the explanation can make, each with its source:**
  - Definition: 'athf bayan is a jamid follower that resembles a sifat in making the word it follows clear, and is not independent; example "aqsama billāhi Abū Ḥafṣin ‘Umar": ‘Umar is 'athf bayan because it clarifies Abū Ḥafṣ. This excludes the sifat (derived), tawkid and 'athf nasaq (they do not clarify) and the independent jamid badal: Ibnu 'Aqil jil. 3 hlm. 218–219.
  - It agrees with the word it follows in i'rab, in being definite or indefinite, in gender and in number, as the na't does: Ibnu 'Aqil jil. 3 hlm. 220.
  - Almost anything that can be 'athf bayan can also be badal (Ibnu Malik names two exceptions): Ibnu 'Aqil jil. 3 hlm. 221. This is why the kitab list badal and 'athf bayan side by side for maliki and ilāhi.
  - In An-Nas: maliki an-nāsi and ilāhi an-nāsi may be badal, sifat, or 'athf bayan: Darwisy jil. 10 hlm. 625; al-Jadwal jil. 15 hlm. 429 (for maliki); as-Samin jil. 11 hlm. 161.
  - Az-Zamakhsyari (quoted by as-Samin hlm. 161–162) reads both as 'athf bayan, like "sīratu Abī Ḥafṣin ‘Umara al-Fārūqi": rabb an-nās is made clear by malik an-nās and then by ilāh an-nās, because "rabb an-nās" and "malik an-nās" can be said of others (he cites QS 9:31), while "ilāh an-nās" belongs to Allah alone, with no partner, so it is the end point of the explanation.
  - Darwisy hlm. 625 quotes the same source on why an-nās is repeated instead of a pronoun: 'athf bayan exists to make clear, so the noun is shown again.
  - As-Samin hlm. 161 records the objection that 'athf bayan is made with jamid words and answers that these words behave like jamid words.
- **Examples:**
  - `114:2:1`: "maliki: boleh dibaca 'athf bayan bagi rabbi, yaitu penjelas “Tuhan manusia”: Dialah Raja manusia (Darwisy; al-Jadwal; as-Samin)."
  - `114:3:1`: "ilāhi: penjelas berikutnya; menurut az-Zamakhsyari (dinukil as-Samin) inilah puncak penjelasan, karena sebutan ini khusus bagi Allah."
- **Related:** `badal`, `naat`, `idhafah`
- **Sources (SourceRef):**
  - Ibnu 'Aqil, Syarh Ibn 'Aqil 'ala Alfiyyah Ibn Malik (tahqiq Muhammad Muhyiddin 'Abd al-Hamid, Kairo: Dar at-Turats, cet. 20, 1400 H/1980 M). Ref: jil. 3, hlm. 218–219 (bab al-'Athf: definisi 'athf bayan; contoh Abu Hafs 'Umar). URL: https://shamela.ws/book/9904/893
  - Same. Ref: jil. 3, hlm. 220 (mengikuti kata yang dijelaskan dalam i'rab, ma'rifah/nakirah, jenis dan jumlah). URL: https://shamela.ws/book/9904/895
  - Same. Ref: jil. 3, hlm. 221 (yang boleh menjadi 'athf bayan umumnya boleh menjadi badal). URL: https://shamela.ws/book/9904/896
  - Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H). Ref: jil. 10, hlm. 625 (maliki dan ilāhi: badal, sifat, atau 'athf bayan; nukilan al-Kasysyaf). URL: https://shamela.ws/book/2163/5783
  - Mahmud Shafi, al-Jadwal … (cet. 3, 1416 H/1995 M). Ref: jil. 15, hlm. 429 (maliki badal dari rabbi, atau na't, atau 'athf bayan). URL: https://shamela.ws/book/22916/5921
  - as-Samin al-Halabi, ad-Durr al-Mashun … (Dar al-Qalam). Ref: jil. 11, hlm. 161–162 (dua sifat, dua badal, atau 'athf bayan; az-Zamakhsyari; keberatan tentang kata jamid). URL: https://shamela.ws/book/9057/10765
- **Aqidah note:** the az-Zamakhsyari point is linguistic and is quoted through as-Samin (al-Kasysyaf itself is not cited, per the caution in `docs/belajar-research/kitabs.md`). It supports the tawhid reading that only Allah is the ilāh of mankind; keep it attributed.

### `rubai-mujarrad` (kind: sharaf), new

- **Suggested title:** Ruba'i mujarrad (kata kerja empat huruf asli: fa‘lala)
- **Suggested summary:** Sebagian kata kerja tersusun dari empat huruf akar tanpa huruf tambahan; polanya hanya satu, fa‘lala–yufa‘lilu, seperti waswasa–yuwaswisu (“membisikkan”).
- **Points the explanation can make, each with its source:**
  - Al-Amtsilah at-Tashrifiyyah gives "bab ar-ruba'i al-mujarrad" as one single bab, with the row fa‘lala, yufa‘lilu, fa‘lalatan wa fi‘lālan, wa mufa‘lalan, fahuwa mufa‘lilun, wa żāka mufa‘lalun, fa‘lil, lā tufa‘lil. Its example rows include daḥraja, ṭa’ṭa’a, tarjama and waswasa–yuwaswisu–waswasatan wa wiswāsan, the last one marked mudha'af (the same pair of letters repeated, w-s w-s): al-Amtsilah hlm. 8–9.
  - QAC 0.4 gives the root of yuwaswisu and al-waswās as four letters, w-s-w-s.
  - The nouns: Darwisy, quoting Mukhtar ash-Shihah, gives waswasat ilaihi nafsuhu, waswasatan wa wiswāsan (with kasrah), and says al-waswās with fathah is the noun (ism): Darwisy jil. 10 hlm. 624. Al-Jadwal: al-waswās is a name for the one who whispers, wazan fa‘lāl with fathah on the fa': al-Jadwal jil. 15 hlm. 430.
  - So in An-Nas, yuwaswisu (114:5:2) is the mudhari' yufa‘lilu of this bab, and al-waswāsi (114:4:3) is a noun from the same four-letter root.
- **Examples (suggested order: the verb first):**
  - `114:5:2`: "yuwaswisu: fi'il mudhari' dari waswasa, empat huruf akar w-s-w-s, wazan yufa‘lilu (al-Amtsilah)."
  - `114:4:3`: "al-waswāsi: kata benda dari akar yang sama, wazan fa‘lāl dengan fathah (al-Jadwal); mashdarnya wiswās dengan kasrah."
- **Related:** `wazan-dan-tashrif`, `fiil-mudhari`
- **Sources (SourceRef):**
  - KH Muhammad Ma'shum bin 'Ali, al-Amtsilah at-Tashrifiyyah (Surabaya: Maktabah Syaikh Salim bin Sa'd Nabhan). Ref: hlm. 8–9 (PDF hlm. 11–12), Bab ar-Ruba'i al-Mujarrad; baris contoh waswasa–yuwaswisu, mudha'af. URL: https://archive.org/details/amthilahtasrifiah (scan file amthilahtasrifiah.pdf, 1,363,359 bytes; printed page = PDF page - 3, checked on the page numbers of the scan).
  - Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H). Ref: jil. 10, hlm. 624 (al-Lughah: al-waswās; nukilan Mukhtar ash-Shihah: waswasatan wa wiswāsan). URL: https://shamela.ws/book/2163/5782
  - Mahmud Shafi, al-Jadwal … (cet. 3, 1416 H/1995 M). Ref: jil. 15, hlm. 430 (ash-Sharf: al-waswās nama bagi yang membisikkan, wazan fa‘lāl). URL: https://shamela.ws/book/22916/5922
  - Quranic Arabic Corpus 0.4. Ref: ROOT:wsws (114:4:3, 114:5:2). URL: https://corpus.quran.com/wordbyword.jsp?chapter=114&verse=5
- **Build note:** `build_surah.verb_form_src` will label yuwaswisu "VF I (QAC 0.4 menandai bentuk II–XII saja; tanpa tanda = bentuk I)". For a four-letter root that is the basic ruba'i form, not the tsulatsi form I; the record (or the build text) should say so, or a learner may read it as a three-letter verb.

### `hal` (kind: nahwu), new

- **Suggested title:** Hal (keterangan keadaan)
- **Suggested summary:** Hal menjelaskan keadaan pelaku atau objek ketika perbuatan terjadi; selain berupa satu kata yang manshub, ia bisa tersirat, dengan frasa jar-majrur yang bergantung padanya.
- **Points the explanation can make, each with its source:**
  - Definition: the hal is a manshub noun that explains a state that would otherwise be unclear ("jā’a zaidun rākiban", Zaid came riding); it is indefinite, comes after a complete statement, and the one it describes is definite: al-Ajurrumiyyah hlm. 19.
  - In 114:6 three i'rab books make mina al-jinnati attach to a hidden hal describing the doer of yuwaswisu: al-Jadwal jil. 15 hlm. 429; al-Mujtaba jil. 4 hlm. 1493; ad-Da'as jil. 3 hlm. 477 ("bi-maḥżūf ḥāl"). As-Samin's third view says the same: he whispers "in the state of being from these two kinds": as-Samin jil. 11 hlm. 163.
  - Darwisy shows what the hidden word can be: "kā’inan min al-jinnati wa an-nāsi" (being from among jinn and men), under his partitive (tab'idhiyyah) reading: Darwisy jil. 10 hlm. 625. This matches the existing `syibhul-jumlah` record: a jar-majrur hangs on a hidden kā’in or istaqarra.
  - Other readings of the phrase (bayan for the whisperer, min ibtida'iyyah, badal, explanation of an-nās) are in the ikhtilaf of 114:6:1; the record should not present hal as the only reading.
  - For a whole sentence as hal (mahall nashb), Mughni al-Labib hlm. 536 lists "al-jumlah al-waqi'ah halan" among the sentences with an i'rab position; useful if a later surah needs it.
- **Example:**
  - `114:6:1`: "mina al-jinnati: menurut al-Jadwal, al-Mujtaba dan ad-Da'as, frasa ini bergantung pada hal tersirat bagi pelaku yuwaswisu: ia membisik dalam keadaan berasal dari jin atau manusia."
- **Related:** `syibhul-jumlah`, `huruf-jar`, `dhamir`
- **Sources (SourceRef):**
  - Ibnu Ajurrum, al-Ajurrumiyyah (Dar ash-Shumai'i, 1419 H/1998). Ref: hlm. 19, Bab al-Hal (definisi; nakirah; sesudah kalam sempurna; shahib al-hal ma'rifah). URL: https://shamela.ws/book/11371/23
  - Mahmud Shafi, al-Jadwal … (cet. 3, 1416 H/1995 M). Ref: jil. 15, hlm. 429 (mina al-jinnati muta'alliq dengan hal dari pelaku yuwaswisu). URL: https://shamela.ws/book/22916/5921
  - Ahmad al-Kharrath, al-Mujtaba min Musykil I'rab al-Qur'an (Madinah: Mujamma' al-Malik Fahd, 1426 H). Ref: jil. 4, hlm. 1493 (QS 114:6). URL: https://shamela.ws/book/9617/6033
  - Ahmad 'Ubaid ad-Da'as, Ahmad Muhammad Humaidan, Isma'il Mahmud al-Qasim, I'rab al-Qur'an al-Karim (Damaskus: Dar al-Munir dan Dar al-Farabi, cet. 1, 1425 H). Ref: jil. 3, hlm. 477 (hal yang dibuang dari pelaku yuwaswisu). URL: https://shamela.ws/book/23584/1399
  - as-Samin al-Halabi, ad-Durr al-Mashun … (Dar al-Qalam). Ref: jil. 11, hlm. 163 (pendapat ketiga: hal dari kata ganti dalam yuwaswisu). URL: https://shamela.ws/book/9057/10770
  - Muhyiddin Darwisy, I'rab al-Qur'an wa Bayanuh (cet. 4, 1415 H). Ref: jil. 10, hlm. 625 (kā’inan min al-jinnati wa an-nāsi). URL: https://shamela.ws/book/2163/5783
  - Ibnu Hisyam, Mughni al-Labib 'an Kutub al-A'arib (tahqiq Mazin al-Mubarak dan Muhammad 'Ali Hamdullah; Dar al-Fikr, Damaskus, cet. 6, 1985). Ref: hlm. 536 (kalimat yang menjadi hal berkedudukan nashab). URL: https://shamela.ws/book/6972/524

## 3. New examples for existing concepts

Each line is one `{loc, note}` to add to that record's `examples` (the map lists the same pairs). Notes cite the kitab the word file already cites for that word, so no new source is needed unless the record wants one; where a record should gain a source, it is named.

- **`huruf-jar`**
  - `114:1:3`: "bi- + rabbi: majrur dengan kasrah; frasa birabbi bergantung pada a‘ūżu (Darwisy; al-Jadwal)."
  - `114:4:1`: "min (“dari”): huruf jar yang mabni; frasa min syarri bergantung pada a‘ūżu di ayat 1."
  - `114:4:2`: "syarri: majrur karena min."
  - `114:5:3`: "fī (“di dalam”): frasa fī ṣudūri bergantung pada yuwaswisu."
  - `114:5:4`: "ṣudūri: majrur karena fī."
  - `114:6:1`: "mina: huruf jar min; nunnya berfathah karena bertemu huruf mati pada al- sesudahnya."
  - `114:6:2`: "al-jinnati: majrur karena min."
- **`idhafah`**
  - `114:1:3`: "rabbi an-nāsi: “Tuhan manusia”; rabbi adalah mudhaf."
  - `114:1:4`: "an-nāsi: mudhaf ilaih bagi rabbi (ad-Da'as)."
  - `114:2:1`: "maliki an-nāsi: “Raja manusia”."
  - `114:2:2`: "an-nāsi: mudhaf ilaih lagi; menurut Darwisy idhafah kepada an-nāsi diulang untuk menambah kejelasan."
  - `114:3:1`: "ilāhi an-nāsi: “Sembahan manusia”."
  - `114:3:2`: "an-nāsi: mudhaf ilaih bagi ilāhi."
  - `114:4:2`: "syarri al-waswāsi: “kejahatan pembisik”; syarri sendiri majrur karena min."
  - `114:4:3`: "al-waswāsi: mudhaf ilaih bagi syarri (Darwisy)."
  - `114:5:4`: "ṣudūri an-nāsi: “dada manusia”."
  - `114:5:5`: "an-nāsi: mudhaf ilaih bagi ṣudūri (ad-Da'as)."
- **`naat`**
  - `114:2:1`: "maliki: menurut an-Nahhas sifat bagi rabbi; badal menurut al-Jadwal, al-Mujtaba dan ad-Da'as." (diperbaiki fixer 2026-10-09, temuan D15: "lebih banyak dipegang" adalah hitungan penulis, bukan pernyataan kitab)
  - `114:3:1`: "ilāhi: boleh dibaca sifat (an-Nahhas: sifat atau badal)."
  - `114:4:4`: "al-khannāsi: sifat bagi al-waswāsi, ikut majrur (Darwisy)."
  - `114:5:1`: "allażī: isim maushul yang menjadi sifat bagi al-waswāsi; ia mabni, kedudukannya jar."
- **`badal`**
  - `114:2:1`: "maliki: badal dari rabbi, ikut majrur (al-Jadwal; al-Mujtaba; ad-Da'as)."
  - `114:3:1`: "ilāhi: badal dari maliki (al-Jadwal; al-Mujtaba) atau dari rabbi (ad-Da'as)."
- **`wazan-dan-tashrif`**
  - `114:4:3`: "al-waswāsi: wazan fa‘lāl dengan fathah pada fa' (al-Jadwal)."
- **`murab-mabni`**
  - `114:1:1`: "qul: fi'il amr, mabni di atas sukun."
  - `114:4:1`: "min: huruf, mabni di atas sukun; semua huruf mabni (Ibnu 'Aqil)."
  - `114:5:1`: "allażī: isim maushul, mabni di atas sukun (ad-Da'as), kedudukannya jar."
  - `114:5:3`: "fī: huruf jar, mabni di atas sukun."
  - `114:6:1`: "mina: tetap min yang mabni; harakat fathah datang karena bertemu huruf mati, sebab kata mabni hanya bergerak karena sebab (Ibnu 'Aqil)."
  - Source to add if the record does not have it yet: Ibnu 'Aqil jil. 1 hlm. 40 already cited ("semua huruf mabni"); the same page also says the asal of bina' is sukun and a mabni word only moves for a cause such as two sakin letters meeting. URL: https://shamela.ws/book/9904/39. For allażī on sukun: ad-Da'as jil. 1 hlm. 15 (QS 2:21), https://shamela.ws/book/23584/11.
- **`dhamir`**
  - `114:1:1`: "qul: pelakunya kata ganti tersirat anta (“engkau”) (Darwisy)."
  - `114:1:2`: "a‘ūżu: pelakunya kata ganti tersirat anā (“aku”) (Darwisy)."
  - `114:5:2`: "yuwaswisu: pelakunya kata ganti tersirat “ia”, yang kembali kepada allażī."
- **`fiil-mudhari`**
  - `114:1:2`: "a‘ūżu: diawali hamzah, jadi pelakunya “aku”; marfu' dengan dhammah."
  - `114:5:2`: "yuwaswisu: diawali ya', pelakunya “ia”; marfu' dengan dhammah."
- **`jumlah-filiyyah`**
  - `114:1:1`: "qul: kalimat perintah pembuka surah; pelakunya tersirat (al-Jadwal: ibtida'iyyah)."
  - `114:1:2`: "a‘ūżu birabbi an-nāsi: kalimat kata kerja yang menjadi isi perkataan qul."
- **`fiil-amr`**
  - `114:1:1`: "qul: fi'il amr “katakanlah”, mabni di atas sukun; di sini perintah, bukan doa."
  - Note: the record's title is "Fi'il amr (bentuk perintah yang menjadi doa)". Qul in 112:1, 113:1 and 114:1 is a plain command, so the title or first paragraph should allow both uses. Qathr an-Nada hlm. 31 (https://shamela.ws/book/6970/19) is already a source of the record.
- **`isim-maushul`**
  - `114:5:1`: "allażī: isim maushul (“yang”); shilah-nya yuwaswisu fī ṣudūri an-nāsi (al-Jadwal)."
  - `114:5:2`: "yuwaswisu: kata kerja dalam shilah; pelakunya kata ganti yang kembali kepada allażī (Ibnu 'Aqil: shilah harus memuat kata ganti itu)."
- **`athaf`**
  - `114:6:3`: "wa an-nāsi: di-'athaf-kan kepada al-jinnati, ikut majrur (ad-Da'as); pendapat lain: kepada al-waswāsi ('Ali bin Salman menurut cetakan an-Nahhas jil. 5 hlm. 200; pengantar penerbit jil. 1 hlm. 3 menyebut guru an-Nahhas al-Akhfasy 'Ali bin Sulaiman)."

## 4. Optional concepts (not mapped)

- **`iltiqa-sakinain`** (sharaf): "bertemunya dua huruf mati" and how the language avoids it. Source: Ibnu 'Aqil jil. 1 hlm. 40 (a mabni word only moves for a cause such as escaping two sakin letters meeting). Example: `114:6:1` mina. It would also explain the dropped wawu in qul (the i'lal of qāla), but no kitab I opened states that i'lal for qul, so it is not mapped.
- **`min-bayaniyyah`** or a short section in `huruf-jar` on the meanings of min (bayaniyyah, ibtida'iyyah, tab'idhiyyah): Darwisy jil. 10 hlm. 625 names all three for 114:6. Not mapped; the 114:6:1 ikhtilaf carries it.
- **`jamak-taksir`**: ṣudūri (114:5:4) is QAC "MP" from the lemma ṣadr, but no kitab I opened says it is a jamak taksir or gives its wazan. Not mapped.
- **Qath' (na't maqthu')**: allażī in 114:5:1 may be cut off from al-waswāsi and read in raf' or nashb (an-Nahhas hlm. 199; as-Samin hlm. 162; az-Zamakhsyari via Darwisy hlm. 625). Kept in the word's ikhtilaf only.

## 5. Notes for the Kosakata/Akar author (`library.lexicon.json`)

The build needs lexicon entries for these QAC 0.4 LEMs, none of which exist yet (rabb and allażī do): `qaAla` (qul), `Eu*o` (a‘ūżu), `n~aAs` (an-nās), `malik` (maliki), `<ila`h` (ilāhi), `min`, `$ar~` (syarr), `wasowaAs` (al-waswās), `xan~aAs` (al-khannās), `wasowasa` (yuwaswisu), `fiY` (fī), `Sador` (ṣudūr), `jin~ap` (al-jinnah). Sourced material I found while reading (not used on the word cards):

- `Eu*o`: QAC 0.4 spells the lemma of a‘ūżu as the imperative-looking "Eu*o", not a madhi form. Al-Jadwal QS 12:23 (sharaf of ma‘āż) names the verb ‘āża–ya‘ūżu.
- `n~aAs`: origin unās, the hamzah dropped and al- standing in for it (Sibawaih, via an-Nahhas jil. 5 hlm. 199); al-Jadwal QS 2:8 (sharaf) gives that view and a second one (from nāsa–yanūsu "bergerak", the alif from a wawu). QAC 0.4 uses root n-w-s, the second view. As-Samin jil. 11 hlm. 163, quoting az-Zamakhsyari: an-nās are so called because they are seen (al-īnās), as jinn are called jinn because they are hidden.
- `malik`: an-Nahhas jil. 5 hlm. 199: malik is the holder of al-mulk (rule), mālik the holder of al-milk and al-mulk. Darwisy jil. 10 hlm. 626: all qurra' read malik here without alif, unlike Al-Fatihah (a fact card candidate).
- `<ila`h`: al-Jadwal QS 1:1 (sharaf): al-ilāh is a mashdar of aliha–ya'lahu "menyembah", used for the object, al-ma‘būd. Keep away from the origin of lafaz Allah (plan §8).
- `wasowaAs` / `wasowasa`: see `rubai-mujarrad` above (al-Amtsilah hlm. 8–9; Darwisy hlm. 624; al-Jadwal jil. 15 hlm. 430).
- `xan~aAs`: al-Jadwal jil. 15 hlm. 430 (khanasa = tawārā wa ikhtafā); Darwisy hlm. 624–625 quotes Mukhtar ash-Shihah (khanasa ‘anhu = ta'akhkhara, bab dakhala) and Asas al-Balaghah; as-Samin hlm. 162 (ar-rajjā‘). Darwisy also quotes a hadith from Asas al-Balaghah without takhrij; do not use it.
- `jin~ap`: an-Nahhas jil. 5 hlm. 200: jinnī, jinn, jinnah; the ha' marks the feminine of a group, like ḥijār and ḥijārah. QAC's jin~ap also covers jinnah meaning "madness" (e.g. QS 7:184), so a root or lemma count must say so.

## 6. Notes for the integrator (build and data)

- **Basmalah:** Tanzil 1.1 prepends the four basmalah tokens (byte-identical to 1:1) to 114:1, giving 8 tokens. QAC 0.4 numbers 114:1 as 4 words without them, and its joined segments equal Tanzil tokens 5–8 byte for byte. All other ayat match QAC token for token. `common.SURAHS` already has (4, 2, 2, 4, 5, 3).
- **QuranEnc sura 114** (`indonesian_affairs`) has no footnotes. The glosses were checked against its text with the build's heuristic; only 114:4:3 needs (and has) a `gloss_exception`.
- **as-Samin and al-Mujtaba have no entry for 114:1**; as-Samin discusses 114:3 under 114:2. The word file points their urls accordingly.
- **ad-Da'as** (`DS`) is cited because it is the only i'rab work read that states several roles outright (an-nāsi mudhaf ilaih in 114:1/2/3/5; wa an-nāsi ma'thuf on al-jinnah; allażī mabni on sukun at QS 2:21). It is a modern work (1425 H): short attributed paraphrase only.
