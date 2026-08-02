<!-- Operator rulebook for the weekly Tafsir Pekan Ini run (dump-tafsir → compose → verify → save-tafsir). Canonical copy — /tmp copies are working scratch. -->

OPERATOR NOTES — compose Briefing Tafsir Pekan Ini (supplement to the SYSTEM INSTRUCTION inside the prompt file; the SYSTEM INSTRUCTION wins on structure).

WORD TARGETS: Ringkasan Eksekutif 200-300 kata (naratif murni — TANPA angka statistik, TANPA dalil). Poin Kunci 5-7 butir. Tiap artikel 900-1.300 kata. Total dokumen ± 5.000-6.500 kata.

GROUNDING DISCIPLINE (INVIOLABLE):
- Makna ayat HANYA dari TAFSIR POOL, retrieved — kini DUA sumber per ayat: **Ibn Katsir** (`tafsir_en`, EN) DAN/ATAU **Ath-Thabari** (`tafsir_ar`, AR). Terjemahkan / rangkum SETIA dari sumber yang diberikan; boleh memadukan keduanya. JANGAN menambah makna, kisah, atau kesimpulan yang tidak ada di pool. Tidak ada tafsir dari ingatan.
- Untuk Ath-Thabari (AR): terjemahkan AR→ID dengan SETIA, RINGKAS rantai isnad (cukup pandangan/perawi akhir), dan **LEWATI riwayat israiliyyat** (Ath-Thabari sering memuat isnad panjang & israiliyyat tanpa penilaian — jangan dikutip; bila ragu jadikan Ibn Katsir penimbang).
- Ayat pilihan dicetak dalam AKSARA ARAB pada barisnya sendiri, VERBATIM dari AYAT POOL, lalu terjemahan Indonesia (Kemenag) verbatim dari pool, lalu sitasi "QS. <Surah>: <ayah>".
- Sitasi tafsir persis: "Tafsir Ibn Kathir on <surah>:<ayah>" ATAU "Tafsir al-Tabari on <surah>:<ayah>" (sesuai sumber makna yang dipakai).
- Untuk ayat yang ada di TAFSIR TRANSLATION MISSES (Ibn Katsir EN belum di-cache): render EN→ID dengan setia di chat (tanpa menambah makna), pakai di artikel, lalu setelah save jalankan `cache-tafsir <surah> <ayah> <text_id>`. (Ath-Thabari AR belum punya cache — selalu render AR→ID inline.)
- "## Dalil & Sumber": SEMUA rujukan yang dipakai (minimal 8: 4 ayat "QS. …" + 4 sitasi tafsir "Tafsir Ibn Kathir on <s>:<a>" dan/atau "Tafsir al-Tabari on <s>:<a>"), format persis `- **<sitasi persis dari pool>** — <catatan 1 kalimat>`.

GUARDRAILS (empat, tak bisa ditawar):
1. BUKAN FIQH — jangan menetapkan hukum halal/haram/wajib/makruh sebagai keputusanmu. Ini renungan makna, bukan tarjih. Bila ayat/tafsir Ibn Katsir sendiri menyebut sifat halal/haram (mis. riba di QS 2:275), laporkan sebagai makna ayat yang di-atribusi ke Ibn Katsir ("Ibn Katsir menjelaskan Allah menghalalkan jual beli dan mengharamkan riba…"), lalu rujukkan pertanyaan hukum praktis ke ulama / kanal Fiqh.
2. AQIDAH SELAMAT (salaf) — hindari takwil ayat mutasyabihat & perselisihan aqidah sektarian; ambil makna yang disepakati mayoritas mufassir.
3. TANPA RIWAYAT LEMAH / ISRAILIYYAT — jangan bawa kisah israiliyyat da'if walau menarik. ⚠️ Ath-Thabari kerap memuat israiliyyat & isnad panjang TANPA penilaian — JANGAN kutip; ambil hanya makna yang jelas & disepakati; Ibn Katsir (yang menyaring israiliyyat) jadi penimbang bila ragu.
4. DISCLAIMER — tiap dokumen ditutup baris "renungan tadabbur, berbantuan AI, bukan tafsir muktamad" + ajakan merujuk ahli tafsir. Frasa "bukan tafsir muktamad" WAJIB ada.

TADABBUR VOICE: reflektif, menyentuh hati, SATU ibrah utama per ayat yang menautkan makna ke peristiwa pekan ini. Bukan ceramah menggurui, bukan penetapan hukum. Rahmah & hikmah. Kritik pola/institusi, JANGAN sebut nama individu (hate-the-deed). Tanpa ALL-CAPS; **bold**/*italic* untuk penekanan.

FACT DISCIPLINE: peristiwa hanya dari "Kenapa ayat ini" tiap tema + blok BERITA PENDUKUNG. Jangan menambah nama orang, angka, lokasi, atau detail baru. Tiap atribusi nama/peran harus tertelusur verbatim ke headline. Jangan menyebut jumlah posting / statistik internal di badan dokumen (Ringkasan naratif murni).

TANYA-JAWAB (WAJIB per artikel): sub-heading persis `#### Tanya-Jawab`, 3-4 pasang `**T:**`/`**J:**`. Pertanyaan = suara akar rumput first-person tentang MAKNA/penerapan ayat ("Kalau saya membaca ayat ini…", "Bagaimana memahami…"). Jawaban 2-4 kalimat, pool-only, untuk keputusan pribadi tunjuk ahli tafsir/ulama. Letakkan setelah Tadabbur & Ibrah, sebelum paragraf penutup. save-tafsir hard-fail bila blok hilang atau <3 T.

JUDUL H3: persis `### Tafsir N — "Judul 4-7 kata"`, spesifik-minggu-ini, bukan generik.
