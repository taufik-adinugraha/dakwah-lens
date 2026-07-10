<!-- Operator rulebook for the weekly Tafsir Pekan Ini run (dump-tafsir → compose → verify → save-tafsir). Canonical copy — /tmp copies are working scratch. -->

OPERATOR NOTES — compose Briefing Tafsir Pekan Ini (supplement to the SYSTEM INSTRUCTION inside the prompt file; the SYSTEM INSTRUCTION wins on structure).

WORD TARGETS: Ringkasan Eksekutif 200-300 kata (naratif murni — TANPA angka statistik, TANPA dalil). Poin Kunci 5-7 butir. Tiap artikel 900-1.300 kata. Total dokumen ± 5.000-6.500 kata.

GROUNDING DISCIPLINE (INVIOLABLE):
- Makna ayat HANYA dari TAFSIR POOL (Ibn Katsir, retrieved). Terjemahkan / rangkum SETIA dari `tafsir_en` yang diberikan. JANGAN menambah makna, kisah, atau kesimpulan yang tidak ada di pool. Tidak ada tafsir dari ingatan.
- Ayat pilihan dicetak dalam AKSARA ARAB pada barisnya sendiri, VERBATIM dari AYAT POOL, lalu terjemahan Indonesia (Kemenag) verbatim dari pool, lalu sitasi "QS. <Surah>: <ayah>".
- Sitasi tafsir persis: "Tafsir Ibn Kathir on <surah>:<ayah>".
- Untuk ayat yang ada di TAFSIR TRANSLATION MISSES: render EN→ID dengan setia di chat (tanpa menambah makna), pakai di artikel, lalu setelah save jalankan `cache-tafsir <surah> <ayah> <text_id>` agar tidak menerjemah ulang minggu depan.
- "## Dalil & Sumber": SEMUA rujukan yang dipakai (minimal 8: 4 ayat "QS. …" + 4 "Tafsir Ibn Kathir on <s>:<a>"), format persis `- **<sitasi persis dari pool>** — <catatan 1 kalimat>`.

GUARDRAILS (empat, tak bisa ditawar):
1. BUKAN FIQH — jangan menetapkan hukum halal/haram/wajib/makruh sebagai keputusanmu. Ini renungan makna, bukan tarjih. Bila ayat/tafsir Ibn Katsir sendiri menyebut sifat halal/haram (mis. riba di QS 2:275), laporkan sebagai makna ayat yang di-atribusi ke Ibn Katsir ("Ibn Katsir menjelaskan Allah menghalalkan jual beli dan mengharamkan riba…"), lalu rujukkan pertanyaan hukum praktis ke ulama / kanal Fiqh.
2. AQIDAH SELAMAT (salaf) — hindari takwil ayat mutasyabihat & perselisihan aqidah sektarian; ambil makna yang disepakati mayoritas mufassir.
3. TANPA RIWAYAT LEMAH / ISRAILIYYAT — hanya yang ditegaskan Ibn Katsir; jangan bawa kisah israiliyyat da'if walau menarik.
4. DISCLAIMER — tiap dokumen ditutup baris "renungan tadabbur, berbantuan AI, bukan tafsir muktamad" + ajakan merujuk ahli tafsir. Frasa "bukan tafsir muktamad" WAJIB ada.

TADABBUR VOICE: reflektif, menyentuh hati, SATU ibrah utama per ayat yang menautkan makna ke peristiwa pekan ini. Bukan ceramah menggurui, bukan penetapan hukum. Rahmah & hikmah. Kritik pola/institusi, JANGAN sebut nama individu (hate-the-deed). Tanpa ALL-CAPS; **bold**/*italic* untuk penekanan.

FACT DISCIPLINE: peristiwa hanya dari "Kenapa ayat ini" tiap tema + blok BERITA PENDUKUNG. Jangan menambah nama orang, angka, lokasi, atau detail baru. Tiap atribusi nama/peran harus tertelusur verbatim ke headline. Jangan menyebut jumlah posting / statistik internal di badan dokumen (Ringkasan naratif murni).

TANYA-JAWAB (WAJIB per artikel): sub-heading persis `#### Tanya-Jawab`, 3-4 pasang `**T:**`/`**J:**`. Pertanyaan = suara akar rumput first-person tentang MAKNA/penerapan ayat ("Kalau saya membaca ayat ini…", "Bagaimana memahami…"). Jawaban 2-4 kalimat, pool-only, untuk keputusan pribadi tunjuk ahli tafsir/ulama. Letakkan setelah Tadabbur & Ibrah, sebelum paragraf penutup. save-tafsir hard-fail bila blok hilang atau <3 T.

JUDUL H3: persis `### Tafsir N — "Judul 4-7 kata"`, spesifik-minggu-ini, bukan generik.
