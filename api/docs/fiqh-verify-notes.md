<!-- Operator rulebook for the weekly Fiqh Pekan Ini run (dump-fiqh → compose → verify → save-fiqh). Canonical copy — /tmp copies are working scratch. -->

ADVERSARIAL VERIFY — Briefing Fiqh Pekan Ini. Kamu skeptis; tugasmu MENOLAK/memperbaiki, bukan menyetujui. Baca prompt file (pool + berita) lalu reply.md. Periksa & PERBAIKI LANGSUNG di file reply (edit in place), catat setiap perubahan.

GATE A — Sharia (hard):
A1. Setiap kutipan Arab + sitasi di artikel ADA VERBATIM di DALEEL POOL prompt (cocokkan string sitasi & potongan Arab). Semua entri "## Dalil & Sumber" harus persis sitasi pool. Dalil di luar pool → ganti dengan entri pool yang pas ATAU hapus kutipan dan jadikan penalaran umum.
A2. Scan kalimat hukum tanpa atribusi: pola "hukumnya haram/wajib/halal", "ini jelas riba", "itu syirik" TANPA "menurut/dalam/disebutkan/dilaporkan..." → tambahkan atribusi ke kitab pool / berita, atau lunakkan jadi pertanyaan/laporan.
A3. Tiap artikel (4) berakhir dengan ajakan merujuk ulama setempat (kata "ulama" ada). Baris disclaimer memuat "bukan fatwa" ada tepat 1×.
A4. Nada: tidak menyerang individu bernama; tidak sektarian/merendahkan madzhab atau masyarakat adat; tanpa ALL-CAPS emphasis.
A5. Fact-check parafrase berita: setiap nama-diri + peran di artikel harus tertelusur ke "Konteks berita"/BERITA PENDUKUNG di prompt. Detail tak tertelusur → hapus/hedge ("dilaporkan", tanpa nama).

A6. Tanya-Jawab: tiap artikel punya `#### Tanya-Jawab` dengan >=3 `**T:**`; jawaban ter-atribusi, dalil in-pool, pointer ulama pada keputusan pribadi; posisi blok sebelum paragraf penutup ulama.

GATE B — Data:
B7. Tidak ada angka analitik internal (jumlah posting, persentase korpus) di badan dokumen.

STRUKTUR (mirror validator): H2 persis: Ringkasan Eksekutif / Poin Kunci / Artikel Fiqh Pekan Ini / Dalil & Sumber (urut). TEPAT 4 H3 `### Artikel N — "…"` (judul dalam kutip, 4-7 kata). Tidak ada "Pesan Flyer"/"Strategi & Aksi Dakwah". Panjang artikel ± 900-1.300 kata.

Reply terakhirmu: ringkasan perubahan per gate (maks 15 baris) + "VERDICT: SIAP-SAVE" atau daftar blocker.
