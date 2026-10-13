# Belajar Al-Qur'an: rumus singkat (the cheat sheet), draft for approval

Date: 2026-10-13. Status: **draft, not built, not recorded.** Nothing here is shown or spoken until the operator approves the table.

The operator's words (2026-10-13): "we can make some 'cheat sheet' to explain the rules, for example: harf jar + ism = kasrah (give examples), isim followed by another ism is mudhof ilaih etc. this cheat sheet is explained also along with formal explanation." And on sourcing: "of course we need to refer to valid kitab, my example is just example."

## What a row is

- One formula per step of the basic curriculum (`belajar/pipeline/authored/curriculum.json`, 36 steps), in teaching order.
- **Rumus**: the short form a learner can hold in mind. The narrator says it first, then the formal explanation.
- **Awas**: where the short form stops being true inside the five units. A formula without its limit is not shown.
- **Sumber**: the matn's own words. Every formula below restates a sentence of the Ajurrumiyyah (Ibnu Ajurrum, Dar ash-Shumai'i 1419 H/1998 M; Shamela book 11371), quoted with its Shamela page. Where no kitab sentence was found, the row says **belum bersumber** and stays out until one is.
- Pages 1–8, 12, 13, 15, 16, 19–21, 23, 27 and 30 are pinned in the pipeline cache. Pages 9, 10, 11, 14, 17, 18, 22 and 31 were read from shamela.ws on 2026-10-13 and are **not pinned yet**; they must be pinned (`fetch.py`, with their sha256) before a row that cites them ships.
- Print-page numbers ("hlm.") are the ones the Konsep records already cite for the same Shamela page. Where no record cites a page, the print page is left out.

## Lesson zero

| # | Step | Rumus | Awas | Sumber |
|---|---|---|---|---|
| 1 | Harakat | Fathah = a, kasrah = i, dhammah = u. Tanda mati (sukun) = tanpa vokal. Tasydid = huruf dibaca dobel. | None at this level. | Pedoman Transliterasi Arab-Latin, SKB 158/1987 (the primer's source); the signs' names as the matn uses them, 11371/3–5. |
| 2 | Tiga jenis kata | Bisa diberi alif lam, tanwin, atau didahului huruf jar → **isim**. Kata kerja → **fi'il**. Bukan keduanya → **huruf**. | The matn's signs of a fi'il (qad, sīn, saufa, ta' ta'nits yang mati) barely occur in the five units; the lessons recognise a fi'il by its meaning and its form. | 11371/1, hlm. 5: «فالاسم يُعرَفُ: بالخَفضِ، والتنوينِ، ودخولِ الألف واللام، وحروفِ الخَفضِ … والفعلُ يُعرَفُ بقد، والسِّين، وسَوف، وتاء التأنيث الساكنة. والحرفُ ما لا يَصلُحُ معه دليلُ الاسم ولا دليل الفعل» |

## Al-Fatihah

| # | Step (lesson) | Rumus | Awas | Sumber |
|---|---|---|---|---|
| 3 | Majrur (1:1) | Isim majrur → akhirnya **kasrah**. Tiga sebab majrur: (1) didahului huruf jar, (2) menjadi mudhaf ilaih, (3) mengikuti kata yang majrur. | Jamak mudzakkar salim majrur dengan **ya'**, bukan kasrah (1:2:4, 1:7:9). Kata yang akhirnya tetap (mabni) tidak berubah walau kedudukannya majrur (1:7:2). | 11371/6, hlm. 9: «وكلها تُرفَعُ بالضمة، وتُنصَبُ بالفتحة، وتُخفَضُ بالكسرة، وتُجزَمُ بالسكون». 11371/30, hlm. 22: «المخفوضات ثلاثة أنواع: مخفوضٌ بالحَرفِ، ومخفوضٌ بالإضافة، وتابِعٌ للمَخفوض» |
| 4 | Huruf jar (1:1) | **Huruf jar + isim → isim itu majrur.** Huruf jar di lima unit: bi, li, ‘alā, min, fī. | A huruf jar joined to a dhamir does not change the dhamir's ending (1:7:4). | 11371/31, hlm. 23: «فأما المخفوض بالحرف فهو: ما يُخفَضُ بمِن، وإلى، وعن، وعلى، وفي، ورُبَّ، والباءِ، والكافِ، واللامِ …» |
| 5 | Jumlah ismiyyah (1:2) | **Mubtada' + khabar = satu kalimat**, tanpa kata "adalah". Khabar boleh berupa huruf jar + isim. | A khabar that is a jar-majrur does not show dhammah (1:2:2). | 11371/11, hlm. 12: «المبتدأ: هو الاسم المرفوعُ العاري عن العوامل اللفظية. والخبر: هو الاسم المرفوع المُسنَدُ إليه». 11371/12, hlm. 13: «وغير المفرد أربعة أشياء: الجارُّ والمجرور، والظَّرف، …» |
| 6 | Marfu' (1:2) | Isim marfu' → akhirnya **dhammah**. Mubtada' selalu marfu'. | Jamak mudzakkar salim marfu' dengan **wawu** (not in Al-Fatihah as marfu'). | 11371/6, hlm. 9 (as row 3). 11371/11, hlm. 12 (as row 5). |
| 7 | Jamak mudzakkar salim (1:2) | Jamak laki-laki beraturan: **-ūna** ketika marfu', **-īna** pada keadaan lainnya. | 1:2:4 is a word treated like this jamak (the detail "mulhaq" is next-level). | 11371/6, hlm. 9: «وأما جمع المذكر السالم: فيُرفَعُ بالواو، ويُنصَبُ ويُخفَضُ بالياء» |
| 8 | Alif lam (1:3) | **Alif lam + isim → isim itu ma'rifah** (tertentu). Nama diri sudah ma'rifah tanpa alif lam. | The matn lists five kinds of ma'rifah; the lessons meet three more later (dhamir 1:5, isim isyarah 2:255, and a word in idhafah to a ma'rifah). | 11371/15, hlm. 14: «والمَعرِفة خمسة أشياء: الاسم المُضمَرُ … والاسم العَلَمُ … والاسم المُبْهَمُ … والاسم الذي فيه الألف واللام، نحو: الرجُلُ والغلامُ، وما أُضِيفَ إلى واحد من هذه الأربعة» |
| 9 | Na't (1:3) | **Na't mengikuti kata yang disifatinya**: sama akhirannya, dan sama ma'rifah atau nakirah-nya. | Some of the course's na't are read as badal by other scholars (1:2:3, 1:3); the lesson says so in plain words. | 11371/15, hlm. 14: «النَّعتُ: تابِعٌ للمنعوت في رَفعِهِ، ونصبِهِ، وخفضِهِ، وتعريفِهِ، وتنكيرِهِ» |
| 10 | Idhafah (1:4) | **Isim + isim yang disandarinya → kata kedua (mudhaf ilaih) selalu majrur.** | The sign on the FIRST word (no tanwin, and as a rule no alif lam) is true of all 27 idhafah pairs in the units but is **belum bersumber**: the matn does not state it. It is not shown until a kitab sentence is found. | 11371/31, hlm. 23: «وأما ما يُخفَضُ بالإضافة، فنحو قولك: "غلامُ زيدٍ"» |
| 11 | Dhamir (1:5) | Dhamir = kata ganti. **Munfashil** berdiri sendiri; **muttashil** menempel pada kata lain. | A dhamir's ending never changes (it is mabni): its kasrah or dhammah is not a sign of i'rab (1:7:4). | 11371/12, hlm. 13: «والمُضمَر اثنا عشر، وهي: أنا، ونحن، وأنتَ …». 11371/20, hlm. 17: «والمضمر قسمان: مُتَّصِل، ومُنفَصِل» |
| 12 | Fi'il mudhari' (1:5) | Diawali salah satu dari empat huruf **hamzah, nun, ya', ta'** → fi'il mudhari'; akhirnya dhammah selama tidak didahului kata yang mengubahnya. | The words that change it (the matn's nashib and jazim) come later: lam at 112:3. | 11371/7, hlm. 10: «والمضارع: ما كان في أوله إحدى الزوائدِ الأربعِ التي يجمَعُهَا قولُك: "أنَيتُ" وهو مرفوعٌ أبدا، حتى يدخُلَ عليه ناصِبٌ أو جازِم» |
| 13 | Mu'rab dan mabni (1:5) | **Mu'rab**: akhirnya berubah mengikuti perannya. **Mabni**: akhirnya tetap. Dhamir, isim maushul, fi'il madhi, fi'il amr dan semua huruf itu mabni. | **Belum bersumber dari matn.** The Konsep record cites Ibnu Hisyam and Ibnu 'Aqil; the exact sentences have to be quoted from those pages before this row ships. | (record `murab-mabni`) |
| 14 | Jumlah fi'liyyah (1:6) | **Fi'il + fa'il = satu kalimat.** Fa'il itu marfu' dan disebut sesudah fi'il-nya; ia bisa tersirat. | In Al-Fatihah every fa'il is implied or a dhamir; a fa'il that is an isim first appears in 2:255. | 11371/9, hlm. 11: «الفاعل هو: الاسم المرفوعُ المذكورُ قبلَهُ فِعلَهُ. وهو على قسمين: ظاهِر، ومُضمَر» |
| 15 | Maf'ul bih (1:6) | **Yang dikenai perbuatan → maf'ul bih, dan ia manshub.** | A dhamir as maf'ul bih keeps its own ending (1:5:1, 1:6:1). | 11371/20, hlm. 17: «وهو الاسمُ المنصوب الذي يقَعُ بِهِ الفِعل، نحو: ضربتُ زيداً، ورَكِبتُ الفَرَسَ» |
| 16 | Manshub (1:6) | Isim manshub → akhirnya **fathah**. Jadi isim punya tiga keadaan: marfu' (dhammah), manshub (fathah), majrur (kasrah). | Jamak mu'annats salim manshub dengan **kasrah** (2:255, row 35). | 11371/6, hlm. 9 (as row 3). 11371/2, hlm. 6: «فللأسماء من ذلك الرفع، والنصب، والخفض، ولا جزم فيها» |
| 17 | Isim maushul (1:7) | **Isim maushul ("yang") + kalimat penjelasnya (shilah).** Maknanya baru lengkap dengan shilah itu. | **Belum bersumber dari matn** (the matn has no chapter on it). The Konsep record's sources have to be quoted. | (record `isim-maushul`) |
| 18 | Fi'il madhi (1:7) | Kata kerja lampau; **akhirnya selalu fathah**. | The last letter becomes sukun when a dhamir of the doer is attached (1:7:3): this limit is in the Konsep record, not in the matn; its sentence has to be quoted. | 11371/7, hlm. 10: «فالماضي: مفتوحُ الآخر أبدا» |
| 19 | 'Athaf (1:7) | **Huruf 'athaf (wa, "dan") + kata → kata itu mengikuti akhiran kata sebelumnya.** | None in the units. | 11371/16, hlm. 15: «فإن عَطَفْتَ بها على مرفوعٍ رَفَعْتَ، أو على منصوب نَصَبْتَ، أو على مخفوض خَفَضْتَ، أو على مجزوم جَزَمْتَ» |

## The other four units (rows for when their lessons are written)

| # | Step (lesson) | Rumus | Sumber |
|---|---|---|---|
| 20 | Fi'il amr (114:1) | Kata kerja perintah; akhirnya selalu tetap, seperti keadaan majzum. | 11371/7, hlm. 10: «والأمر: مجزومٌ أبدا» |
| 21 | Badal (114:2) | Badal (pengganti) mengikuti kata yang digantikannya dalam seluruh akhirannya. | 11371/18, hlm. 16: «إذا أُبدِلَ اسمٌ مِن اسم أو فعلٌ مِن فعلٍ تَبِعَهُ في جميع إعرابِهِ» |
| 22 | Jamak taksir (114:5) | Jamak yang bentuk tunggalnya berubah; akhirannya seperti isim tunggal. | 11371/3 and /4: jam‘ at-taksīr takes dhammah and fathah like al-ism al-mufrad. A definition is **belum bersumber**. |
| 23 | Mudzakkar dan mu'annats (114:6) | **Belum bersumber**: no chapter in the cached matn, no course record. | — |
| 24 | Tanwin pada isim (113:3) | Tanwin hanya ada pada isim; isim yang belum tertentu (nakirah) bisa diberi alif lam. | 11371/1, hlm. 5 (tanwin among the signs of an isim). 11371/15, hlm. 14: «والنَّكِرَة: كل اسم شائعٍ في جِنسِه … وتقريبُهُ كلُّ ما صَلَحَ دخولُ الألف واللام عليه» |
| 25 | Jamak mu'annats salim (113:4) | Marfu' dengan dhammah, majrur dengan kasrah, dan manshub juga dengan kasrah. | 11371/3, /4, /6 (see row 35). |
| 26 | Lam nafi (112:3) | **Lam + fi'il mudhari' → fi'il itu majzum.** | 11371/7, hlm. 10: «والجوازِمُ ثمانيةَ عَشَر، وهي: لَمْ، …» |
| 27 | Majzum (112:3) | Fi'il majzum → akhirnya **sukun**; bila huruf akhirnya huruf 'illah, huruf itu dibuang. | 11371/5, hlm. 8: «وللجَزمِ علامتان: السُّكُون، والحَذف» |
| 28 | Kāna (112:4) | **Kāna + mubtada' + khabar → yang pertama tetap marfu', khabar menjadi manshub.** | 11371/13, hlm. 13: «فأما كان وأخواتها، فإنها ترفَعُ الاسمَ، وتَنصِبُ الخَبَرَ» |
| 29 | Istitsna' (2:255) | **Belum bersumber**: the matn's chapter (bab al-istitsnā') is not fetched yet. | — |
| 30 | Lā nafi (2:255) | **Belum bersumber.** | — |
| 31 | Fa'il berupa isim (2:255) | Fa'il yang tertulis sebagai isim: disebut sesudah fi'il-nya, dan marfu'. | 11371/9, hlm. 11 (as row 14: «ظاهِر، ومُضمَر»). |
| 32 | Istifham (2:255) | **Belum bersumber.** | — |
| 33 | Isim isyarah (2:255) | Kata tunjuk termasuk ma'rifah. | 11371/15, hlm. 14: «والاسم المُبْهَمُ، نحو: هذا وهذه وهؤلاء». A definition is **belum bersumber**. |
| 34 | Zharaf (2:255) | Kata keterangan waktu atau tempat: manshub, dengan makna "di" atau "pada". | 11371/22: «ظرفُ الزمان هو: اسم الزمان المنصوب بتقدير "في" … وظرف المكان هو: اسم المكان المنصوب بتقدير "في"» |
| 35 | Kasrah tanda manshub (2:255) | Jamak mu'annats salim manshub dengan **kasrah**, bukan fathah. | 11371/4, hlm. 7: «وأما الكسرة: فتكون علامة للنصب في جمع المؤنث السالم». 11371/6, hlm. 9: «جمع المؤنث السالم يُنصَبُ بالكسرة» |
| 36 | Mutsanna (2:255) | Kata untuk dua: marfu' dengan **alif**, manshub dan majrur dengan **ya'**. | 11371/6, hlm. 9: «فأما التثنيةُ: فتُرفَعُ بالألف، وتُنصَبُ وتُخفَضُ بالياء» |

## What needs the operator's decision

1. **The wording of the formulas.** Each "Rumus" above is one proposal; the Arabic beside it is what it has to stay true to.
2. **Rows marked belum bersumber** (13 mu'rab dan mabni, 17 isim maushul, the first-word sign in 10, the sukun limit in 18, and 22, 23, 29, 30, 32, 33): leave them out of the cheat sheet until a kitab sentence is quoted, or name the kitab to look in.
3. **Where the cheat sheet appears.** Proposed: (a) the formula is the first sentence of a step's "Konsep baru" line; (b) the opening card's "Sudah kita pelajari" group shows it under each topic that comes up again (decision 8a of the curriculum); (c) one page, "Rumus singkat", linked from the Qur'an track page, printable.
4. **Recording.** Putting the formula first changes the 19 "Konsep baru" lines of Al-Fatihah and lesson zero. They are re-recorded once, together with the rest of the rework.

## Counts

- 36 rows. The formula as written is stated by the matn in 25 (rows 2–9, 11, 12, 14–16, 19–21, 24–28, 31, 34–36). In 4 the matn covers part and a note says what is missing (10, 18, 22, 33). 6 have no kitab sentence yet (13, 17, 23, 29, 30, 32). Row 1 is a reading convention with its own source.
- Not checked by an ustadz.
