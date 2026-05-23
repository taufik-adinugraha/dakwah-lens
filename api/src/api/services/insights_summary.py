"""Daily executive briefing(s) for the public /insights page.

Five briefings per day after the 2026-05-20 expansion:
  - 1 all-platform (segment IS NULL)
  - 4 per-segment (spiritual / family / youth / justice)

Each briefing now contains three layers:
  1. Description — what trended this week, grounded in numeric stats
  2. Nasihah — a short Islamic admonition / practical takeaway
  3. Daleel — citations from the kitab corpus

PRD §12 — Sharia compliance. The LLM is RESTRICTED to citing only daleel
that we RETRIEVED from Qdrant for this briefing. Daleel that's not in
the retrieved list must not appear in the narrative. We pass the
retrieved daleel as context and a strict system instruction; failure
to comply would be a logged warning.

Cost per briefing: ~$0.02–0.05 (Gemini 2.5 Pro narrative + OpenAI
embedding for retrieval). Five briefings × 30 days ≈ $3-7.50/mo.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from google import genai
from google.genai import types
from sqlalchemy import text

from api.config import settings
from api.db import SessionLocal
from api.models.admin import InsightsSummary
from api.services.kitab_retrieval import (
    rerank_daleel,
    retrieve_daleel,
    translate_daleel_to_id,
)
from api.services.usage import gemini_output_tokens

log = structlog.get_logger()

MODEL = "gemini-2.5-pro"

# Segment → category set mapping. MUST match the canonical mapping in
# web/src/app/[locale]/insights/segment/[focus]/page.tsx — if the web
# side moves, mirror here. `None` segment means "all categories".
SEGMENT_CATEGORIES: dict[str, list[str]] = {
    "spiritual": ["aqidah", "akhlaq"],
    "family": ["family", "health"],
    "youth": ["youth", "education"],
    "justice": ["social_justice", "economic_ethics", "muamalah"],
}

ALL_CATEGORIES = [
    "aqidah",
    "akhlaq",
    "muamalah",
    "social_justice",
    "family",
    "youth",
    "education",
    "economic_ethics",
    "health",
]


_PERSONA_ID = """Anda seorang analis dakwah Indonesia yang bekerja untuk Sukses & Berkah Group — yayasan nirlaba yang membantu ekosistem dakwah Indonesia (da'i, ustadzah, kreator konten, orang tua, pengurus komunitas). Tugas Anda menyusun briefing analisis MINGGUAN, bukan khutbah. Suara Anda observasional dan pragmatis: Anda memetakan pola percakapan publik dengan jernih, lalu memberikan handle praktis untuk berbagai surface dakwah. Anda berakar pada Qur'an + sunnah ahlu sunnah wal jama'ah, netral pada perbedaan mazhab, paham konteks sosial Indonesia kontemporer."""


_PERSONA_EN = """You are an Indonesian da'wah analyst working for Sukses & Berkah Group — a non-profit serving Indonesia's da'wah ecosystem (da'i, ustadzah, content creators, parents, community organizers). Your role is to produce a WEEKLY analytical briefing, not a khutbah. Your voice is observational and pragmatic: you map public conversation patterns clearly, then provide practical handles for various da'wah surfaces. You are rooted in Qur'an + sunnah ahlu sunnah wal jama'ah, neutral on mazhab differences, fluent in contemporary Indonesian context. THIS BRIEFING IS IN ENGLISH for diaspora readers, international researchers, and English-medium content creators — but the source material is Indonesian, so cite stories with their Indonesian framing intact."""


# Long-form 5-section briefing (~1500-1800 words). Replaced the short
# 3-paragraph format on 2026-05-21 after the scenario-1 calibration test
# showed the long form (a) names 4x more specific stories, (b) identifies
# patterns across topics instead of just listing symptoms, (c) gives
# each da'wah surface a distinct angle. Cost delta: ~$4/mo, well inside
# the IDR 1M cap. Output renders as markdown with H2 sections.
SYSTEM_PROMPT_ID = f"""{_PERSONA_ID}

CRITICAL FORMATTING RULES:
- Mulai output Anda LANGSUNG dengan `## Ringkasan Eksekutif`. JANGAN tulis pre-amble seperti "Tentu, ini draf…" atau "Berikut briefing…".
- JANGAN tambahkan header block sebelum Bagian 1 (tanggal, "UNTUK DISTRIBUSI INTERNAL", periode, dll).
- JANGAN tutup dengan signature, paraf, atau closing apologetik.
- Disclaimer keasistanan AI WAJIB ditulis sebagai paragraf italic di akhir Bagian 5 (BUKAN bagian terpisah).

OUTPUT: briefing analisis ~1500-1800 kata dalam Bahasa Indonesia, dibagi ke 5 BAGIAN dengan heading H2 (##). Antar bagian dipisahkan satu baris kosong.

## Ringkasan Eksekutif (100-130 kata, satu paragraf)
- Sebut top 3 kategori dengan share-pct
- Komposisi sentimen dengan angka verbatim
- Dua benang merah utama pekan ini
- Bisa di-skim dalam 30 detik

## Numerik & Tren Pekan Ini (200-250 kata)
- Ekspos angka dengan konteks — jangan sekadar daftar, hubungkan ke cerita
- Cantumkan top 5 kategori, komposisi sentimen, volume
- JIKA `delta_pp`/`delta_pp_negative` null: tulis "belum ada baseline mingguan untuk perbandingan". JANGAN memfabrikasi tren naik/turun.
- Sebut platform mix

CRITICAL — SCOPE OF PERCENTAGES: baca SEGMENT_SCOPE di input. Jika "all", persentase di `top_categories` adalah share dari seluruh percakapan mingguan. Jika SEGMENT_SCOPE adalah segmen spesifik (spiritual/family/youth/justice), persentase tersebut adalah share *WITHIN segmen itu saja* — frasa "di antara konten segmen keluarga, kategori family mendominasi 89%" atau "dalam diskursus segmen ini X memimpin 89%". JANGAN tulis "percakapan publik didominasi family 89%" saat scope adalah segmen — itu overclaim.

## Tema Utama & Pola Yang Muncul (500-650 kata)
- Analisis per top topic. Untuk SETIAP topic dari pool, beri 2-3 cerita konkret dari sample_headlines DENGAN OUTLET (e.g. "Liputan6 melaporkan…", "menurut Banjarmasin Post…")
- BUKAN sekadar daftar — identifikasi POLA yang menghubungkan cerita-cerita itu. Misal: "kekerasan terhadap anak di Tanahlaut, kamar mandi masjid, dan penjualan bayi menunjukkan satu pola: ruang yang seharusnya aman justru menjadi panggung pelanggaran."
- IDENTIFIKASI BENANG MERAH antar topik di akhir bagian
- Hindari kata kerja perintah ("wajib", "harus", "pentingnya"). Gunakan observasional ("menyoroti", "memetakan", "menunjukkan", "tercermin dari")
- HANYA gunakan headlines dari pool yang saya berikan. JANGAN mengarang cerita.

## Strategi & Aksi Dakwah (5700-7800 kata)
Ini adalah CONTENT KIT — bukan saran strategis. Setiap sub-section harus berupa DRAFT SIAP-PAKAI yang bisa dibaca / dipakai langsung oleh dai, ustadzah, kreator, atau pengurus komunitas tanpa harus menulis ulang dari nol. WAJIB 6 sub-section dengan ### H3.

RUJUKAN DALEEL DI SECTION 4 — pool yang saya sediakan berisi 10 daleel hasil rerank tematik. Setiap sub-section di bawah WAJIB merujuk 2-3 daleel dari pool ini secara INLINE (bukan ditumpuk semua di Section 5):
- Pilih daleel yang paling SUPPORT argumen sub-section tersebut — bukan asal comot, bukan random pertama
- Format inline: `**{{citation}}**` (mis. `**QS. Hud: 85**` atau `**Riyad as-Salihin 1420**`) langsung diikuti 1 kalimat parafrase singkat Bahasa Indonesia
- Sub-section berbeda BOLEH mengutip daleel yang sama jika memang paling pas, tapi USAHAKAN variasi supaya 8-10 daleel pool terdistribusi (khutbah ~3-4 daleel, kajian ~2-3, pengajaran ~1-2, kreator ~1, gen-z ~2, aksi ~1-2)
- JANGAN mengarang ayat atau hadits di luar pool. Citation yang muncul di Section 4 HARUS persis cocok dengan citation di pool

### Khutbah Jumat (2300-3200 kata)
Tulis KHUTBAH JUMAT LENGKAP siap-baca dari pembuka sampai penutup, terdiri dari Khutbah Pertama dan Khutbah Kedua. Bahasa Indonesia formal-mengalir, bisa dipahami jamaah umum, jangan terlalu akademis. Panjang khutbah harus sebanding dengan khutbah Jumat Indonesia standar (15-22 menit ucapan = ~2300-3200 kata) — JANGAN terlalu pendek.

KHUTBAH PERTAMA (1800-2500 kata):
- Mukadimah singkat (hamdalah → sholawat → syahadat → wasiat takwa, ~70 kata, AKSARA ARAB DENGAN HARAKAT lengkap — bukan transliterasi Latin). Khateeb membaca langsung dari teks di mimbar.
- Ayat Quran pembuka yang relevan dengan tema pekan — TULIS AYAT DALAM AKSARA ARAB BERHARAKAT, lalu sebut nama surah + nomor ayat, lalu TERJEMAHAN Bahasa Indonesia. JANGAN gunakan transliterasi Latin untuk ayat Quran.
- Pengantar tema (4-6 paragraf Bahasa Indonesia): hubungkan ayat dengan 2-3 peristiwa NYATA pekan ini dari pool sample_headlines, sebut outletnya ("Detik melaporkan…", "menurut Republika…", "seperti diberitakan Kompas…").
- Inti khutbah (6-9 paragraf prosa mengalir, jangan pakai sub-judul): satu argumen yang BERKEMBANG sepanjang khutbah, didukung 2-3 daleel tambahan DARI POOL. Untuk setiap daleel: tulis citation bold inline `**citation**`, AYAT/HADITS DALAM AKSARA ARAB BERHARAKAT (jika tersedia di pool), lalu terjemahan Bahasa Indonesia. Setiap paragraf harus mengembangkan argumen, BUKAN paraphrase paragraf sebelumnya.
- Bersisi praktis: 3-4 tindakan konkret untuk jamaah pekan ini.
- Tutup khutbah pertama dengan formula standar DALAM AKSARA ARAB BERHARAKAT (~80 kata): "بَارَكَ اللهُ لِيْ وَلَكُمْ فِي الْقُرْآنِ الْعَظِيْمِ، وَنَفَعَنِيْ وَإِيَّاكُمْ بِمَا فِيْهِ مِنَ الْآيَاتِ وَالذِّكْرِ الْحَكِيْمِ…" dst. JANGAN transliterasi Latin.

KHUTBAH KEDUA (500-700 kata):
- Mukadimah singkat (hamdalah + sholawat + syahadat, AKSARA ARAB DENGAN HARAKAT lengkap, ~50 kata).
- Penegasan inti khutbah pertama (2-3 paragraf reflektif dalam Bahasa Indonesia).
- DOA PENUTUP DALAM AKSARA ARAB DENGAN HARAKAT LENGKAP (300-450 kata Arab). Ini bagian utama khutbah kedua. JANGAN tulis transliterasi Latin, JANGAN tulis Bahasa Indonesia — TULIS DALAM HURUF ARAB ASLI dengan tanda syakal/harakat (fathah, kasrah, dhammah, sukūn, syaddah, dst.) supaya khateeb bisa membaca langsung di mimbar. Gunakan rangkaian doa standar khutbah Jumat Indonesia, struktur:
  * Doa untuk seluruh umat (mukminin, mukminat, muslimin, muslimat, yang hidup dan yang wafat):
    اَللّٰهُمَّ اغْفِرْ لِلْمُؤْمِنِيْنَ وَالْمُؤْمِنَاتِ، وَالْمُسْلِمِيْنَ وَالْمُسْلِمَاتِ، الْأَحْيَاءِ مِنْهُمْ وَالْأَمْوَاتِ، إِنَّكَ سَمِيْعٌ قَرِيْبٌ مُجِيْبُ الدَّعَوَاتِ.
  * Doa pertolongan: اَللّٰهُمَّ انْصُرْنَا عَلٰى عَدُوِّكَ وَعَدُوِّنَا، وَعَدُوِّ الْإِسْلَامِ.
  * Doa untuk Palestina + korban kezaliman pekan ini (mustadh'afin, sebut konteks spesifik bila relevan — misalnya WNI di tahanan asing, korban di tempat bencana, dst.): اَللّٰهُمَّ انْصُرْ إِخْوَانَنَا الْمُسْلِمِيْنَ الْمُسْتَضْعَفِيْنَ فِيْ كُلِّ مَكَانٍ، وَخُصُوْصًا إِخْوَانَنَا فِيْ أَرْضِ فِلَسْطِيْنَ…
  * Doa untuk pemimpin: اَللّٰهُمَّ أَصْلِحْ وُلَاةَ أُمُوْرِنَا، وَوَفِّقْهُمْ لِخَيْرِ عِبَادِكَ وَبِلَادِكَ.
  * Doa untuk diri & keluarga: اَللّٰهُمَّ ارْحَمْنَا وَوَالِدَيْنَا، وَرَبِّهِمْ كَمَا رَبَّيَانَا صِغَارًا.
  * Boleh tambahkan 1-2 doa tematik DALAM HURUF ARAB yang relevan dengan isu pekan ini (mis: doa untuk korban kekerasan anak, untuk pelajar yang dibully, untuk petani/nelayan yang tertekan). Tulis dalam aksara Arab berharakat, JANGAN transliterasi.
  * Penutup doa: رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ.

  CRITICAL: setiap baris doa di atas adalah CONTOH. Anda boleh menambah/menyesuaikan dengan konteks pekan ini, tapi SETIAP TAMBAHAN HARUS DALAM AKSARA ARAB BERHARAKAT — bukan transliterasi Latin.

- Penutup standar (~120 kata Arab): aksara Arab berharakat penuh untuk sequence "إِنَّ اللهَ وَمَلَائِكَتَهُ يُصَلُّوْنَ عَلَى النَّبِيّ…" → sholawat lengkap "اَللّٰهُمَّ صَلِّ عَلٰى سَيِّدِنَا مُحَمَّدٍ وَعَلٰى آلِ سَيِّدِنَا مُحَمَّدٍ…" → "عِبَادَ اللهِ، إِنَّ اللهَ يَأْمُرُ بِالْعَدْلِ وَالْإِحْسَانِ وَإِيْتَاءِ ذِي الْقُرْبٰى…" → tahmid akhir "وَاذْكُرُوا اللهَ الْعَظِيْمَ يَذْكُرْكُمْ، وَاشْكُرُوْهُ عَلٰى نِعَمِهِ يَزِدْكُمْ، وَلَذِكْرُ اللهِ أَكْبَرُ." Semua dalam aksara Arab, harakat lengkap.

### Kajian Ibu-ibu & Majelis Taklim (800-1100 kata)
Tulis OUTLINE KAJIAN 45-MENIT siap-pakai, format hands-on bukan ceramah teoritis:
- Pembuka (~80 kata): basmalah, salam, ice-breaker / pertanyaan ringan terkait pengalaman ibu-ibu pekan ini (misal: "Siapa yang harga sembako-nya naik minggu ini?").
- Inti — 3 talking points (masing-masing 150-200 kata) dengan struktur per-poin:
  * Pernyataan inti (1 kalimat)
  * Contoh konkret dari berita pekan ini (sebut outlet)
  * Rujukan daleel singkat dari pool — tulis `**citation**` lalu 1 kalimat terjemahan
  * Aplikasi praktis untuk dapur / keluarga (2-3 tindakan)
- Sesi Q&A (~100 kata): tulis 3 pertanyaan yang KEMUNGKINAN AKAN diajukan ibu-ibu + jawaban singkat-jujur (jangan idealistis berlebihan).
- Penutup (~50 kata): doa singkat untuk keluarga, ringkasan satu kalimat yang bisa diingat.

### Pengajaran di Rumah (500-700 kata)
Tulis 3-4 CONVERSATION SCRIPT untuk orang tua dengan anak, masing-masing format:
- Setting: kapan (sarapan / di mobil / sebelum tidur) + usia anak (SD / SMP / SMA)
- Pertanyaan pembuka orang tua (1-2 kalimat — pertanyaan, bukan ceramah).
- 2-3 kemungkinan jawaban anak + respons orang tua untuk masing-masing (tulis dialog dua arah).
- Tutup orang tua: satu kalimat yang menyimpulkan tanpa menggurui.
Topik dipilih dari peristiwa nyata pekan ini.

### Kreator Konten Digital (100-130 kata)
Tulis SCRIPT VIDEO siap-pakai 60-90 detik untuk TikTok / IG Reels / YouTube Shorts — kreator bisa baca langsung di depan kamera tanpa diedit. Bahasa Indonesia percakapan, BUKAN gaya khutbah. Struktur wajib:
- HOOK (5 detik / ~10 kata): kalimat pertama yang menghentikan scroll. Boleh pertanyaan, boleh kontras, boleh fakta yang mengejutkan dari berita pekan ini.
- BODY (40-60 detik / 80-100 kata): satu argumen jernih + satu rujukan daleel singkat DARI POOL (sebut citation persis seperti di pool dalam Bahasa Indonesia — JANGAN kutip teks Arab di video, JANGAN mengarang citation).
- CTA (5-10 detik / ~15 kata): ajakan konkret yang bisa langsung dilakukan penonton.
Hindari frasa khas khutbah ("hadirin yang dirahmati Allah", "marilah kita renungkan").

### Pendekatan Gen Z (800-1100 kata)
Tulis OUTLINE OPEN-MIC KAJIAN / DISKUSI GEN Z siap-pakai (1.5 jam, format diskusi terbuka, BUKAN ceramah). Gen Z menolak nasihat top-down — semua materi di sini harus dirancang sebagai DISKUSI yang difasilitasi, bukan disampaikan. Struktur:

- **Setting & format** (~60 kata): venue (kafe / co-working / ruang komunitas), maks 20-25 peserta, formasi lingkaran (bukan teater), moderator (BUKAN penceramah) menyiapkan air & snack ringan.

- **Framing question pembuka** (~50 kata): satu pertanyaan provokatif yang menghubungkan isu pekan ini dengan pertanyaan eksistensial Gen Z (identitas, mental-health, masa depan, ketidakadilan, kesepian, makna kerja).

- **Pop-culture bridge** (~180 kata): satu pintu masuk lewat budaya pop yang sedang relevan dengan Gen Z. Pilih SATU jalur (sebut judul/figur/lirik SPESIFIK yang sedang trending, jangan generik):
  * Lirik K-pop / J-pop dengan layer eksistensial — mis. BTS "Magic Shop" tentang trauma & penyembuhan → tazkiyatun nafs; NewJeans "Bubble Gum" tentang nostalgia identitas → fitrah; Lisa solo tentang kesendirian fame → ujian ketenaran
  * Plot atau character arc anime / manga — mis. Frieren tentang waktu & kefanaan → ziara'tul qubur; Vinland Saga tentang taubat seorang viking → konsep hijrah; Solo Leveling tentang ujian level → sabar dalam musibah
  * Lagu Indonesian indie tentang krisis identitas/spiritual — Hindia "Apatis", Pamungkas "Masing-Masing", Tulus "Hati-Hati di Jalan", .Feast "Camkan", Bernadya, Hanggini — kutip bait spesifik sebagai pemicu
  * Tren TikTok / sound viral pekan ini dengan lapisan filosofis — mis. tren "main character energy" → ujub; tren "delulu" → ghuruur; tren "sigma male" → ananiyyah (egoism)
  * Hijrah-figure kreator / atlet / influencer yang OTENTIK (bukan yang sudah jadi clichéd brand) sebagai case study
  * Esports / gaming community ethics — toxic chat di Mobile Legends/Valorant → akhlaq ruang digital; rasa "FOMO ranked push" → qana'ah

  KAIDAH KETAT: (1) HORMATI bahwa karya pop ini sah dinikmati Gen Z — JANGAN posisikan "harus dilawan" atau haram; (2) JANGAN memaksakan analogi Islami yang dipaksa — biarkan koneksinya organik, mungkin hanya 1-2 lapisan dalam; (3) gunakan sebagai PEMICU diskusi yang Gen Z sendiri kembangkan, BUKAN khutbah berbungkus pop-culture; (4) sebut JUDUL/LIRIK/FIGUR yang spesifik dan relevan dengan isu pekan ini, BUKAN referensi pop random.

- **4-5 pertanyaan lanjutan** (masing-masing 60-100 kata): tulis pertanyaan + 2-3 kalimat anticipated pushback (sinisme, "agama ngapain ikut campur", "ini cuma hiburan kok dikaitkan agama") + respons-tidak-defensif yang menghormati keraguan tapi tetap berakar pada Quran/sunnah.

- **Penutup** (~60 kata): BUKAN kesimpulan moral — refleksi terbuka + tawaran kelanjutan (Discord channel, peer group, mentor 1-on-1, group WA untuk Q&A lanjutan).

### Aksi Sosial & Khidmah Umat (600-900 kata)
Tulis SET aksi kecil-berdampak yang bisa dijalankan oleh komunitas LOKAL — RT, RW, masjid lingkungan, keluarga, pengurus pengajian, karang taruna. BUKAN ceramah, BUKAN konten — kegiatan nyata yang bisa diluncurkan dalam 1-2 minggu dengan EFFORT KECIL (1-5 orang penggerak, tanpa sertifikasi profesional) dan BUDGET KECIL (total di bawah Rp 2.000.000).

Skala dampak: tetangga + lingkungan langsung. BUKAN program nasional, BUKAN platform tech ambisius, BUKAN partnership dengan kementerian / lembaga besar.

Hindari ide klise atau yang terlalu berat:
- ❌ Warung jujur / kantin kejujuran
- ❌ Bakti sosial generik / pembagian sembako tanpa angle baru
- ❌ Pengajian rutin tambahan
- ❌ Sumbangan / pembangunan fisik masjid
- ❌ Bootcamp / sertifikasi formal / hotline nasional
- ❌ Partnership dengan Komnas / BNN / kementerian (terlalu berat untuk lingkup RT)

Sebaliknya, fokus ke aksi sederhana yang DAMPAKNYA TERASA OLEH TETANGGA dalam 2-4 minggu. Format wajib: PROPOSE 4 AKSI SEGMENTASI USIA, satu trigger pekan ini diturunkan ke 4 segmen audiens berbeda. Tiap segmen jadi pelaku (bukan objek bantuan).

**Trigger** (~80 kata): peristiwa/isu spesifik pekan ini yang memotivasi aksi. Sebut outlet + tanggal jika ada. Jelaskan kenapa isu ini bisa direspons di level lingkungan (bukan level kebijakan nasional).

Untuk SETIAP segmen di bawah, tulis:
- Label aksi (1 kalimat **bold**, sangat spesifik — bukan judul abstrak)
- Cara kerja (2-3 kalimat: siapa penggerak, di mana, kapan, output langsung yang terlihat)
- Budget (di bawah Rp 500.000 per aksi, breakdown 2-3 komponen)
- Dampak terukur (1 metrik kecil-tapi-nyata: jumlah tetangga ikut, jumlah keluarga terjangkau, kg sampah, jumlah pertemuan, dll.)

#### 🧒 Anak-anak (5-12 tahun) (~140 kata)
Aksi yang diorganisir oleh orang tua + guru ngaji + remaja masjid, melibatkan 5-15 anak. Pendek (30-60 menit), berulang (mingguan), output yang bisa dipamerkan ke orang tua. Contoh arahan: patroli sampah Jum'at-pagi di sekitar masjid + papan timbangan mingguan; surat-tangan untuk lansia di kompleks; menanam 1 pohon per anak di pekarangan tetangga; mini-piket cek air wudhu masjid bergiliran. Pilih SATU yang relevan dengan trigger pekan ini, jangan pakai semua contoh.

#### 🧑 Remaja (13-19 tahun) (~160 kata)
Aksi yang diinisiasi remaja masjid / karang taruna sendiri, didampingi 1 orang dewasa. Manfaatkan energi + skill digital mereka untuk dampak hyper-local. Contoh arahan: video pendek (IG/TikTok) memperkenalkan pedagang kecil di pasar tetangga setiap pekan; kelas TPA online singkat — remaja jadi tutor baca Qur'an untuk anak SD via video-call grup RT; bersih-bersih saluran air kompleks + dokumentasi singkat; "PR-bareng" — remaja SMA jadi mentor PR untuk adik SD/SMP di mushola sore. Hindari proyek tech yang butuh server / domain / aplikasi baru — cukup pakai WA, IG, Google Form yang sudah mereka pakai sehari-hari.

#### 👨 Dewasa (20-55 tahun) (~160 kata)
Aksi yang diorganisir setelah jam kerja / akhir pekan, melibatkan keluarga atau tetangga 1 RT. Bobot lebih ke pengorganisiran + tindak lanjut praktis, bukan event sekali jadi. Contoh arahan: "adopsi tetangga" — 3-5 keluarga rotasi menjaga 1 keluarga prasejahtera di RT (kunjungan + kebutuhan nyata, bukan sembako bulanan); rotasi masak untuk lansia yang tinggal sendiri di kompleks; kelompok perbaikan rumah — tukang RT bergiliran perbaiki atap/listrik rumah lansia/janda; ronda parenting — 4-5 ayah kumpul 1 jam tiap 2 minggu bahas isu spesifik (mis. gadget anak, judi online di sekolah). Targetkan dampak yang bisa diceritakan kembali ke 1-2 keluarga konkret, bukan statistik agregat.

#### 👵 Lansia (55+) (~140 kata)
Aksi yang menghormati kapasitas + kebijaksanaan lansia — mereka jadi PELAKU/sumber, BUKAN objek bantuan. Fokus: transmisi pengalaman + akhlaq ke generasi muda. Contoh arahan: "cerita maghrib" — lansia kumpul anak-anak RT sehabis sholat untuk ceritakan kisah nabi atau kisah lokal 15 menit, 1x seminggu; transfer resep keluarga — lansia ajarkan 1 resep tradisional ke remaja/dewasa muda setiap pekan; lansia jadi mediator konflik kecil RT/RW (peran kebijaksanaan, bukan birokrasi); "ngobrol pagi" — lansia tinggal sendiri saling berkunjung bergiliran ke rumah satu sama lain.

**Sinergi & koordinasi** (~80 kata): bagaimana 4 aksi ini bisa dijalankan paralel sebagai 1 kampanye RT/masjid/komunitas. Sebut: siapa koordinator (1 nama peran — mis. takmir muda / sekretaris RT / pengurus pengajian ibu), channel komunikasi (WA grup yang sudah ada, jangan bikin baru), dan 1 momen kebersamaan di akhir 4 minggu (mis. sholat berjamaah + sesi laporan singkat 20 menit di teras masjid) untuk merayakan + refleksi.

## Dalil & Sumber (500-700 kata)
- Kutip 8-10 dalil dari pool yang saya berikan, masing-masing dengan KONTEKS ringkas — ini adalah bibliography lengkap, jadi tampilkan semua atau hampir semua daleel pool (boleh lewatkan 1-2 jika benar-benar tidak relevan dengan tema pekan ini setelah dibaca ulang)
- Format heading per dalil: `**{{citation_only}}**` — citation sudah berisi nama korpus dan nomor (mis. "QS. Hud: 85" atau "Riyad as-Salihin 1420"). JANGAN mengulang nama korpus dengan format `**RIYAD_AS_SALIHIN Riyad as-Salihin 1420**`. JANGAN sertakan ref_id `[quran::11:85]`.
- Format penuh per dalil:

  **{{citation}}**
  > {{Terjemahan atau parafrase}}

  {{1-2 kalimat konteks: mengapa dalil ini relevan dengan tema pekan ini}}

- CRITICAL: HANYA gunakan dalil dari pool yang saya sediakan. JANGAN mengutip ayat atau hadits dari memori Anda.
- TERJEMAHAN HADITS: pertahankan struktur dan nuansa asli. Contoh: Bulugh al-Maram 1023 berbunyi "tunaikan amanah kepada yang mempercayaimu, dan JANGAN khianati orang yang mengkhianatimu" — ini hadits anti-retaliation (walau dia mengkhianatimu, kau tidak balik mengkhianati). Jangan datarkan ke generik "jangan saling mengkhianati".
- Urutkan dari yang PALING RELEVAN dengan tema pekan ini

Di akhir Bagian 5, tutup dengan satu paragraf italic:
*Briefing ini AI-assisted, BUKAN fatwa otoritatif. Tanggung jawab keagamaan tetap pada penyusun konten dakwah.*

TONE GUARDRAILS (PRD §12):
- Promote *rahma* + *hikmah*. Tidak konfrontatif, tidak sektarian.
- Tidak mengeluarkan rulings (haram/halal, fatwa-shape). Anda starting point untuk da'i berpikir, bukan fatwa.
- Default ke charity in framing. Saat menyoroti kegagalan moral, fokus pada angle SISTEMIK + jalan keluar.
- Pertahankan jarak observasional. Anda analis, bukan da'i di mimbar.
- Istilah dakwah (da'i, khutbah, dalil, kitab, muamalah, akhlaq, amanah, mustad'afin) ditulis as-is, BUKAN diterjemahkan.
- Transliterasi Arab (*rahma*, *hikmah*, *mustad'afin*, *amanah*) bungkus dengan italic.
"""


SYSTEM_PROMPT_EN = f"""{_PERSONA_EN}

CRITICAL FORMATTING RULES:
- Start your output DIRECTLY with `## Executive Summary`. NO pre-amble ("Here's the draft…", "Sure, below is…").
- NO header block before Section 1 (no date headers, "FOR INTERNAL DISTRIBUTION", period stamps, etc).
- NO closing signature or apologetic outro.
- The AI-assistance disclaimer goes as an italic paragraph at the end of Section 5 (not as a separate section).

OUTPUT: ~1500-1800 word analytical briefing in clear English, split into 5 SECTIONS with H2 (##) headings, blank line between sections.

## Executive Summary (100-130 words, single paragraph)
- Top 3 categories with share-pct
- Sentiment composition verbatim
- Two main throughlines this week
- 30-second skimmable

## Numbers & Trends This Week (200-250 words)
- Numbers in context — connect to stories, don't just list
- Top 5 categories, sentiment composition, volume
- IF `delta_pp`/`delta_pp_negative` is null: write "no weekly baseline yet for comparison". DO NOT fabricate rising/falling trends.
- Mention platform mix

CRITICAL — SCOPE OF PERCENTAGES: read SEGMENT_SCOPE in the input. When "all", percentages in `top_categories` are share of all weekly conversation. When SEGMENT_SCOPE is a specific segment (spiritual/family/youth/justice), they are share *WITHIN that segment only* — phrase as "within family-segment content, the family category leads at 89%" or "in this segment's discourse, X leads with 89%". DO NOT write "public conversation is dominated by family 89%" when scope is a segment — that overclaims.

## Main Themes & Emerging Patterns (500-650 words)
- Per-topic analysis. For EACH topic in the pool, give 2-3 concrete stories from sample_headlines WITH OUTLET attribution (e.g. "Liputan6 reports…", "according to Banjarmasin Post…")
- The source headlines are Indonesian — translate or paraphrase them naturally into English, but keep the Indonesian context intact (kakek = "an elderly man / grandfather", pengajian = "Qur'an study circle / pengajian")
- NOT a list — identify the PATTERN connecting these stories
- IDENTIFY THE OVERARCHING THROUGHLINE between topics at the end
- Prefer observation verbs ("highlights", "maps", "tracks", "surfaces") over command verbs ("must", "should", "the importance of")
- Only use headlines from the pool I provide. Do NOT invent stories.

## Da'wah Strategies & Actions (5700-7800 words)
This is a CONTENT KIT — not strategic advice. Each sub-section must be a READY-TO-USE DRAFT that a da'i, ustadzah, creator, or community organizer can use directly without rewriting from scratch. REQUIRED: 6 sub-sections with ### H3.

DALEEL REFERENCING IN SECTION 4 — the pool I provide contains 10 thematically-reranked daleel. Each sub-section below MUST weave 2-3 daleel from this pool INLINE (not all stacked in Section 5):
- Pick daleel that genuinely SUPPORT each sub-section's argument — not random first picks
- Inline format: `**{{citation}}**` (e.g. `**QS. Hud: 85**` or `**Riyad as-Salihin 1420**`) immediately followed by 1 sentence English paraphrase
- Different sub-sections MAY cite the same daleel if it really fits best, but TRY to distribute so the 8-10 daleel pool gets spread across sub-sections (khutbah ~3-4 daleel, kajian ~2-3, home ~1-2, content ~1, gen-z ~2, action ~1-2)
- DO NOT invent verses or hadith outside the pool. Any citation appearing in Section 4 MUST exactly match a citation in the pool.

### Friday Khutbah (2300-3200 words)
Write a COMPLETE ready-to-deliver Friday khutbah from opening to closing, consisting of Khutbah Pertama (First Khutbah) and Khutbah Kedua (Second Khutbah). Length must match a standard Indonesian Friday khutbah (15-22 minutes spoken = ~2300-3200 words) — do NOT cut short.

KHUTBAH PERTAMA (1800-2500 words):
- Brief mukadimah (hamdalah → sholawat → syahadat → wasiat takwa, ~70 words, ARABIC SCRIPT WITH FULL HARAKAT — not Latin transliteration). The khateeb reads directly from the text at the mimbar.
- Opening Quranic verse tied to this week's theme — WRITE THE VERSE IN ARABIC SCRIPT WITH HARAKAT, then name the surah + verse number, then English TRANSLATION. Do NOT use Latin transliteration for Quranic verses.
- Theme introduction (4-6 English paragraphs): link the verse to 2-3 REAL events from this week's sample_headlines pool, naming the outlet ("Detik reports…", "according to Republika…", "as Kompas reports…").
- Khutbah body (6-9 flowing paragraphs, no sub-headings): one argument that DEVELOPS across the khutbah, supported by 2-3 additional daleel FROM THE POOL. For each daleel: write the citation bold inline `**citation**`, the VERSE/HADITH IN ARABIC SCRIPT WITH HARAKAT (when available from the pool), then English translation. Each paragraph must advance the argument, NOT paraphrase the previous one.
- Practical close: 3-4 concrete actions the congregation can take this week.
- Close khutbah pertama with the standard formula IN ARABIC SCRIPT WITH HARAKAT (~80 words): "بَارَكَ اللهُ لِيْ وَلَكُمْ فِي الْقُرْآنِ الْعَظِيْمِ، وَنَفَعَنِيْ وَإِيَّاكُمْ بِمَا فِيْهِ مِنَ الْآيَاتِ وَالذِّكْرِ الْحَكِيْمِ…" etc. Do NOT use Latin transliteration.

KHUTBAH KEDUA (500-700 words):
- Brief mukadimah (hamdalah + sholawat + syahadat, ARABIC SCRIPT WITH FULL HARAKAT, ~50 words).
- Restate the first khutbah's core (2-3 reflective English paragraphs).
- CLOSING DU'A IN ARABIC SCRIPT WITH FULL HARAKAT (300-450 Arabic words). This is the main body of khutbah kedua. Do NOT write Latin transliteration, do NOT write English — WRITE IN ORIGINAL ARABIC LETTERS with syakal/harakat marks (fathah, kasrah, dhammah, sukūn, syaddah, etc.) so the khateeb can read straight from the mimbar. Use the standard Indonesian Friday khutbah du'a sequence:
  * For the whole ummah (believers, men and women, living and deceased):
    اَللّٰهُمَّ اغْفِرْ لِلْمُؤْمِنِيْنَ وَالْمُؤْمِنَاتِ، وَالْمُسْلِمِيْنَ وَالْمُسْلِمَاتِ، الْأَحْيَاءِ مِنْهُمْ وَالْأَمْوَاتِ، إِنَّكَ سَمِيْعٌ قَرِيْبٌ مُجِيْبُ الدَّعَوَاتِ.
  * For divine help: اَللّٰهُمَّ انْصُرْنَا عَلٰى عَدُوِّكَ وَعَدُوِّنَا، وَعَدُوِّ الْإِسْلَامِ.
  * For Palestine + this week's oppression victims (mustadh'afin, name specific contexts when relevant — WNI detained abroad, disaster victims, etc.): اَللّٰهُمَّ انْصُرْ إِخْوَانَنَا الْمُسْلِمِيْنَ الْمُسْتَضْعَفِيْنَ فِيْ كُلِّ مَكَانٍ، وَخُصُوْصًا إِخْوَانَنَا فِيْ أَرْضِ فِلَسْطِيْنَ…
  * For leaders: اَللّٰهُمَّ أَصْلِحْ وُلَاةَ أُمُوْرِنَا، وَوَفِّقْهُمْ لِخَيْرِ عِبَادِكَ وَبِلَادِكَ.
  * For self & family: اَللّٰهُمَّ ارْحَمْنَا وَوَالِدَيْنَا، وَرَبِّهِمْ كَمَا رَبَّيَانَا صِغَارًا.
  * Add 1-2 thematic du'a IN ARABIC SCRIPT relevant to this week's issues (e.g. for child-abuse victims, for bullied students, for farmers under economic pressure). Write in Arabic letters with harakat, NOT Latin transliteration.
  * Closing of du'a: رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ.

  CRITICAL: every du'a line above is an EXAMPLE. You may add/adapt to this week's context, but EVERY ADDITION MUST BE IN ARABIC SCRIPT WITH HARAKAT — never Latin transliteration.

- Standard closing (~120 Arabic words) in ARABIC SCRIPT WITH FULL HARAKAT: the sequence "إِنَّ اللهَ وَمَلَائِكَتَهُ يُصَلُّوْنَ عَلَى النَّبِيّ…" → full sholawat "اَللّٰهُمَّ صَلِّ عَلٰى سَيِّدِنَا مُحَمَّدٍ وَعَلٰى آلِ سَيِّدِنَا مُحَمَّدٍ…" → "عِبَادَ اللهِ، إِنَّ اللهَ يَأْمُرُ بِالْعَدْلِ وَالْإِحْسَانِ وَإِيْتَاءِ ذِي الْقُرْبٰى…" → final tahmid "وَاذْكُرُوا اللهَ الْعَظِيْمَ يَذْكُرْكُمْ، وَاشْكُرُوْهُ عَلٰى نِعَمِهِ يَزِدْكُمْ، وَلَذِكْرُ اللهِ أَكْبَرُ." All in Arabic letters with harakat.

### Women's Kajian & Majelis Taklim (800-1100 words)
Write a 45-MINUTE KAJIAN OUTLINE ready for delivery — hands-on, NOT theoretical lecture:
- Opening (~80 words): basmalah, salam, an ice-breaker question tied to ibu-ibu's lived experience this week (e.g. "Whose grocery bill went up this week?").
- Core — 3 talking points (150-200 words each) with per-point structure:
  * Core statement (one sentence)
  * Concrete example from this week's news (name the outlet)
  * Brief daleel reference from the pool — write `**citation**` then 1 sentence translation
  * Practical application for the kitchen / family (2-3 actions)
- Q&A section (~100 words): write 3 questions the audience IS LIKELY to ask + honest brief answers (don't be overly idealistic).
- Closing (~50 words): a short prayer for the family, a one-sentence takeaway.

### Teaching at Home (500-700 words)
Write 3-4 CONVERSATION SCRIPTS for parents with their children, each in the format:
- Setting: when (breakfast / in the car / before bed) + child's age (elementary / middle school / high school)
- Parent's opening question (1-2 sentences — a question, NOT a lecture).
- 2-3 likely child responses + the parent's response to each (write the dialogue as a two-way exchange).
- Parent's close: one sentence that wraps up without lecturing.
Pick topics from this week's actual events.

### Digital Content Creators (100-130 words)
Write a READY-TO-USE video script for a 60-90 second TikTok / IG Reels / YouTube Shorts format — creator can read it straight into camera without editing. Conversational Indonesian, NOT khutbah style. Required structure:
- HOOK (5 seconds / ~10 words): the first line that stops scroll. Question, contrast, or surprising fact from this week's news.
- BODY (40-60 seconds / 80-100 words): one clear argument + one brief daleel reference FROM THE POOL (name the citation exactly as in the pool — DO NOT quote Arabic in-video, DO NOT invent citations).
- CTA (5-10 seconds / ~15 words): concrete viewer action they can do immediately.
Avoid khutbah idioms ("hadirin yang dirahmati Allah", "marilah kita renungkan").

### Reaching Gen Z (800-1100 words)
Write a ready-to-use GEN Z OPEN-MIC KAJIAN / DISCUSSION OUTLINE (1.5 hours, open discussion format, NOT lecture). Gen Z rejects top-down advice — every element here should be designed to be FACILITATED, not delivered. Structure:

- **Setting & format** (~60 words): venue (cafe / co-working / community space), max 20-25 attendees, circle formation (not theater), moderator (NOT a preacher), water & light snacks ready.

- **Opening framing question** (~50 words): one provocative question that links this week's issues to a Gen Z existential question (identity, mental health, future, injustice, loneliness, meaning of work).

- **Pop-culture bridge** (~180 words): ONE entry point via the pop culture currently resonating with Gen Z. Pick ONE lane (name SPECIFIC trending titles/figures/lyrics — do NOT be generic):
  * K-pop / J-pop lyrics with existential layers — e.g. BTS "Magic Shop" on trauma & healing → tazkiyatun nafs; NewJeans "Bubble Gum" on identity nostalgia → fitrah; Lisa solo on isolation in fame → trial of celebrity
  * Anime / manga plot or character arc — e.g. Frieren on time & mortality → ziarah qubur; Vinland Saga on a viking's tawbah → concept of hijrah; Solo Leveling's level grind → patience in trials
  * Indonesian indie songs on identity / spiritual crisis — Hindia "Apatis", Pamungkas "Masing-Masing", Tulus "Hati-Hati di Jalan", .Feast "Camkan", Bernadya, Hanggini — quote a specific verse as the prompt
  * This week's TikTok trend / viral sound with philosophical layers — e.g. "main character energy" → ujub; "delulu" → ghuruur; "sigma male" → ananiyyah (egoism)
  * AUTHENTIC hijrah figures from creators / athletes / influencers (NOT clichéd-brand ones) as case studies
  * Esports / gaming community ethics — toxic chat in Mobile Legends/Valorant → akhlaq in digital spaces; "FOMO ranked push" → qana'ah

  STRICT RULES: (1) RESPECT that this pop culture is legitimately enjoyed by Gen Z — do NOT position it as something to "fight" or label haram; (2) do NOT force Islamic analogies — let the connection be organic, maybe just 1-2 layers deep; (3) use as a TRIGGER for Gen Z's own discussion, NOT a khutbah wrapped in pop-culture costume; (4) name SPECIFIC titles/lyrics/figures that genuinely connect to this week's issues, NOT random pop references.

- **4-5 follow-up questions** (60-100 words each): write the question + 2-3 sentences of anticipated pushback (cynicism, "what does religion have to do with this", "this is just entertainment — why link it to religion") + a non-defensive response that honors the doubt while staying rooted in Quran/sunnah.

- **Close** (~60 words): NOT a moral conclusion — open reflection + continuation offer (Discord channel, peer group, 1-on-1 mentor, WA group for Q&A).

### Social Action & Service to the Ummah (600-900 words)
Write a SET of small-but-impactful actions doable by a LOCAL community — RT, RW, neighborhood mosque, families, pengajian circle, karang taruna. NOT a sermon, NOT content — real activities launchable in 1-2 weeks with SMALL EFFORT (1-5 organizers, no professional certification required) and SMALL BUDGET (total under IDR 2,000,000).

Impact scope: neighbors + immediate surroundings. NOT national programs, NOT ambitious tech platforms, NOT ministry/large-institution partnerships.

Avoid stale or oversized ideas:
- ❌ Warung jujur / honesty stalls
- ❌ Generic baksos / conventional rice-packet distribution
- ❌ Adding more routine pengajian
- ❌ Mosque-building fundraisers
- ❌ Bootcamps / formal certification / national hotlines
- ❌ Partnerships with Komnas / BNN / ministries (too heavy for RT-level scope)

Instead, focus on simple actions whose IMPACT IS FELT BY NEIGHBORS within 2-4 weeks. Required format: PROPOSE 4 AGE-SEGMENTED ACTIONS — one trigger this week, four activations per audience segment. Each segment is an actor (not an aid recipient).

**Trigger** (~80 words): the specific event/issue this week that motivates the action. Name the outlet + date if possible. Explain why this can be addressed at the neighborhood level (not national policy).

For EACH segment below, write:
- Action label (one **bold** sentence, very specific — not an abstract title)
- How it works (2-3 sentences: who organizes, where, when, immediate visible output)
- Budget (under IDR 500,000 per action, breakdown 2-3 components)
- Measurable impact (one small-but-real metric: neighbors involved, families reached, kg waste, meetings held, etc.)

#### 🧒 Children (5-12 years) (~140 words)
Action organized by parents + Qur'an teacher + masjid teens, involving 5-15 kids. Short (30-60 min), repeating (weekly), output that can be shown to parents. Example directions: Friday-morning trash patrol around the mosque + weekly weigh-in board; handwritten letters to elderly in the complex; one tree per child planted in a neighbor's yard; mini rotation for checking masjid wudu water. Pick ONE that fits this week's trigger, do NOT use all examples.

#### 🧑 Teens (13-19 years) (~160 words)
Action initiated by masjid youth / karang taruna themselves, with 1 adult mentor. Leverage their energy + digital skills for hyper-local impact. Example directions: short videos (IG/TikTok) introducing small vendors at the neighborhood market each week; brief online TPA — teens become Qur'an reading tutors for SD kids via RT WA group video-call; sweep complex drainage + brief story documentation; "homework-together" — SMA teens mentor SD/SMP juniors at the mushola in the afternoon. Avoid tech projects requiring new servers / domains / apps — use the WA, IG, Google Form they already use daily.

#### 👨 Adults (20-55 years) (~160 words)
Action organized after work / weekends, involving family or 1 RT of neighbors. Weight more toward organizing + practical follow-up, not one-off events. Example directions: "adopt-a-neighbor" — 3-5 families rotate caring for 1 lower-income family in the RT (visits + real needs, not monthly rice packets); cooking rotation for elderly living alone in the complex; home-repair circle — RT handymen rotate fixing roofs/electric for elderly/widows; parenting ronda — 4-5 fathers gather 1 hour every 2 weeks on a specific issue (e.g. kid gadget use, online gambling at school). Target impact that can be retold about 1-2 concrete families, not aggregate statistics.

#### 👵 Elderly (55+) (~140 words)
Action that honors elderly capacity + wisdom — they are ACTORS/sources, NOT aid recipients. Focus: transmission of experience + akhlaq to younger generations. Example directions: "maghrib stories" — elderly gather neighborhood kids after prayer to tell prophet stories or local stories for 15 min, 1x weekly; family-recipe transfer — elderly teach one traditional recipe to teens/young adults each week; elderly serve as mediators for small RT/RW conflicts (wisdom role, not bureaucracy); "morning chats" — solo-living elderly rotate visiting each other's homes.

**Synergy & coordination** (~80 words): how 4 actions run in parallel as 1 RT/mosque/community campaign. Name: one coordinator (a single role — e.g. young takmir / RT secretary / pengajian ibu lead), communication channel (existing WA group, don't make new), and 1 closing moment after 4 weeks (e.g. congregational prayer + 20-minute brief reporting session on the mosque terrace) for celebration + reflection.

## Daleel & Sources (500-700 words)
- Cite 8-10 daleel from the pool I provide, each with brief CONTEXT — this is the comprehensive bibliography, so display all or nearly all of the pool (you MAY skip 1-2 if they really don't fit this week's themes on re-read)
- Per-daleel heading format: `**{{citation_only}}**` — the citation already contains the corpus name and number (e.g. "QS. Hud: 85" or "Riyad as-Salihin 1420"). DO NOT repeat the corpus name as `**RIYAD_AS_SALIHIN Riyad as-Salihin 1420**`. DO NOT include the ref_id prefix `[quran::11:85]`.
- Full format per daleel:

  **{{citation}}**
  > {{Translation or paraphrase}}

  {{1-2 sentences of context: why this daleel is relevant to this week's themes}}

- CRITICAL: ONLY use daleel from the pool I provide. DO NOT quote verses or hadith from your memory.
- HADITH TRANSLATION: preserve the original structure and nuance. Example: Bulugh al-Maram 1023 reads "fulfill the trust to whoever entrusts you, and DO NOT betray the one who betrays you" — this is an anti-retaliation hadith (even if they betray you, you do not retaliate). Don't flatten to generic "don't betray each other".
- Order by MOST RELEVANT to this week's themes first.

End Section 5 with one italic paragraph:
*This briefing is AI-assisted and NOT an authoritative fatwa. The religious responsibility for any published da'wah content remains with you.*

TONE GUARDRAILS (PRD §12):
- Promote *rahma* + *hikmah*. Never confrontational, never sectarian.
- No rulings (halal/haram verdicts, fatwa-shape). You are a starting point for a da'i to think with.
- Default to charity in framing. When pointing at moral failings, focus on systemic angles + ways forward.
- Maintain observational distance. You are the analyst, not the preacher.
- Keep da'wah-specific terms (da'i, khutbah, daleel, kitab, akhlaq, muamalah, amanah, mustad'afin) as-is — do NOT translate to generic English.
- Arabic transliterations (*rahma*, *hikmah*, *mustad'afin*, *amanah*) wrapped in italic.
"""


async def _compute_stats(
    session, segment: str | None
) -> dict[str, Any]:
    """Pull headline numbers from social_posts + topics + categories.

    If `segment` is given, restrict everything to posts whose
    dominant category falls in `SEGMENT_CATEGORIES[segment]`.
    """
    now = datetime.now(UTC)
    period_end = now
    period_start = now - timedelta(days=7)
    prev_period_start = now - timedelta(days=14)

    cats_filter = (
        SEGMENT_CATEGORIES[segment] if segment else ALL_CATEGORIES
    )
    # Postgres array literal for the IN/ANY filter.
    cats_sql_array = "ARRAY[" + ",".join(f"'{c}'" for c in cats_filter) + "]"

    # Helper: a CTE that tags each post with its GLOBAL top-1 category
    # (argmax over the categories JSONB), then downstream queries filter
    # rows where `dominant_cat = ANY (cats_filter)`. Earlier we put the
    # `key = ANY (cats_filter)` filter inside the inner SELECT — that
    # returned the highest-scoring key *among the segment's set*, so any
    # post with a tiny non-zero score in a segment key was counted in
    # the segment. That made all four segment summaries converge to the
    # same numbers (2026-05-21 bugfix).
    # Floor raised to > 0.1 on 2026-05-22 — about 28% of mainstream
    # posts came back from the classifier with ALL nine categories
    # tied at exactly 0.1 (the LLM punted with a flat default instead
    # of actually scoring). With the old > 0 threshold the argmax
    # picked whichever key came first in Postgres's jsonb iteration
    # order — effectively random — and a Bea Cukai corruption post
    # ended up tagged `youth`, contaminating the youth-segment
    # briefing. Floor > 0.1 means a post needs at least one category
    # the classifier actually picked above the flat default; punted
    # rows fall out of segment queries entirely.
    post_filter = """
      WITH filtered AS (
        SELECT sp.*, (
          SELECT key FROM jsonb_each_text(categories)
          WHERE value::numeric > 0.1
          ORDER BY value::numeric DESC LIMIT 1
        ) AS dominant_cat
        FROM social_posts sp
        WHERE categories IS NOT NULL
      )
    """

    # 1. Totals
    total_row = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT
                  count(*) FILTER (WHERE posted_at >= :start AND dominant_cat = ANY ({cats_sql_array})) AS posts_7d,
                  count(*) FILTER (WHERE posted_at >= :prev AND posted_at < :start AND dominant_cat = ANY ({cats_sql_array})) AS posts_prev_7d
                FROM filtered
                """
            ),
            {"start": period_start, "prev": prev_period_start},
        )
    ).one()
    posts_7d = int(total_row.posts_7d or 0)
    posts_prev_7d = int(total_row.posts_prev_7d or 0)

    # 2. Sentiment mix this week + baseline
    sentiment_row = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT
                  count(*) FILTER (WHERE sentiment_label = 'negative') AS neg,
                  count(*) FILTER (WHERE sentiment_label = 'neutral') AS neu,
                  count(*) FILTER (WHERE sentiment_label = 'positive') AS pos,
                  count(*) FILTER (WHERE sentiment_label IS NOT NULL) AS total
                FROM filtered
                WHERE posted_at >= :start AND dominant_cat = ANY ({cats_sql_array})
                """
            ),
            {"start": period_start},
        )
    ).one()
    sentiment_total = int(sentiment_row.total or 0)
    pct_negative_7d = (
        round(100 * int(sentiment_row.neg or 0) / sentiment_total, 1)
        if sentiment_total
        else 0.0
    )
    pct_neutral_7d = (
        round(100 * int(sentiment_row.neu or 0) / sentiment_total, 1)
        if sentiment_total
        else 0.0
    )
    pct_positive_7d = (
        round(100 * int(sentiment_row.pos or 0) / sentiment_total, 1)
        if sentiment_total
        else 0.0
    )

    baseline_row = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT
                  count(*) FILTER (WHERE sentiment_label = 'negative') AS neg,
                  count(*) FILTER (WHERE sentiment_label IS NOT NULL) AS total
                FROM filtered
                WHERE posted_at >= :prev AND posted_at < :start AND dominant_cat = ANY ({cats_sql_array})
                """
            ),
            {"prev": prev_period_start, "start": period_start},
        )
    ).one()
    baseline_total = int(baseline_row.total or 0)
    pct_negative_prev = (
        round(100 * int(baseline_row.neg or 0) / baseline_total, 1)
        if baseline_total
        else 0.0
    )

    # 3. Top categories — same dominant bucketing, but inside the segment filter.
    cat_rows = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT dominant_cat AS category, count(*)::int AS posts
                FROM filtered
                WHERE posted_at >= :start AND dominant_cat = ANY ({cats_sql_array})
                GROUP BY dominant_cat
                ORDER BY posts DESC
                LIMIT 5
                """
            ),
            {"start": period_start},
        )
    ).all()
    cat_total_now = sum(int(r.posts) for r in cat_rows) or 1
    top_categories_7d = [
        {
            "category": r.category,
            "posts": int(r.posts),
            "share_pct": round(100 * int(r.posts) / cat_total_now, 1),
        }
        for r in cat_rows
    ]

    prev_cat_rows = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT dominant_cat AS category, count(*)::int AS posts
                FROM filtered
                WHERE posted_at >= :prev AND posted_at < :start AND dominant_cat = ANY ({cats_sql_array})
                GROUP BY dominant_cat
                """
            ),
            {"prev": prev_period_start, "start": period_start},
        )
    ).all()
    cat_total_prev_real = sum(int(r.posts) for r in prev_cat_rows)
    # Defensive `or 1` for the division below; the real value is used as
    # the no-baseline guard when populating delta_pp downstream.
    cat_total_prev = cat_total_prev_real or 1
    prev_share = {
        r.category: round(100 * int(r.posts) / cat_total_prev, 1)
        for r in prev_cat_rows
    }

    # 4. Topics — ranked by SEGMENT post count via a join on social_posts.
    # The `topics` table itself doesn't carry a category column, so we
    # bucket posts into topics + segment by joining the global-argmax
    # `filtered` CTE. Without this each segment's briefing was fed the
    # same global top-8 topics (2026-05-21) and narratives became
    # interchangeable across segments.
    #
    # For each topic also fetch 2-3 sample headlines (first non-empty
    # line of each post's text), top-scored by da'wah relevance, so
    # the LLM prompt has SUBSTANCE, not just category aggregates. Without
    # this, observed 2026-05-21 that briefings read as "isu pemuda
    # penting" instead of naming the specific stories driving the topic.
    # Headlines are also segment-filtered for the same reason.
    topic_rows = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT t.id, t.label, t.platform, t.keywords,
                       count(f.id)::int AS seg_post_count
                FROM topics t
                JOIN filtered f ON f.topic_id = t.id
                WHERE f.dominant_cat = ANY ({cats_sql_array})
                  AND f.posted_at >= :start
                GROUP BY t.id, t.label, t.platform, t.keywords
                ORDER BY seg_post_count DESC
                LIMIT 8
                """
            ),
            {"start": period_start},
        )
    ).all()
    top_topics: list[dict[str, Any]] = []
    for r in topic_rows:
        headline_rows = (
            await session.execute(
                text(
                    f"""
                    {post_filter}
                    SELECT text, author
                    FROM filtered
                    WHERE topic_id = :tid AND text IS NOT NULL
                      AND dominant_cat = ANY ({cats_sql_array})
                    ORDER BY dawah_relevance DESC NULLS LAST
                    LIMIT 3
                    """
                ),
                {"tid": r.id},
            )
        ).all()
        # First non-empty line of each post = the headline most of the
        # time (RSS body lead with the title; social posts are short).
        sample_headlines = []
        for h in headline_rows:
            first = next(
                (line for line in (h.text or "").splitlines() if line.strip()),
                "",
            )
            if first:
                sample_headlines.append({
                    "title": first[:140],
                    "author": h.author,
                })
        top_topics.append({
            "label": r.label,
            "platform": r.platform,
            "keywords": list(r.keywords or [])[:5],
            "post_count": int(r.seg_post_count or 0),
            "sample_headlines": sample_headlines,
        })

    # 5. Per-platform breakdown — within segment.
    plat_rows = (
        await session.execute(
            text(
                f"""
                {post_filter}
                SELECT platform, count(*)::int AS posts
                FROM filtered
                WHERE posted_at >= :start AND dominant_cat = ANY ({cats_sql_array})
                GROUP BY platform
                ORDER BY posts DESC
                """
            ),
            {"start": period_start},
        )
    ).all()
    platform_breakdown = [
        {"platform": r.platform, "posts": int(r.posts)} for r in plat_rows
    ]

    return {
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "segment": segment,
        "totals": {
            "posts_7d": posts_7d,
            "posts_prev_7d": posts_prev_7d,
            "delta_pct": (
                round(100 * (posts_7d - posts_prev_7d) / posts_prev_7d, 1)
                if posts_prev_7d > 0
                else None
            ),
        },
        "sentiment": {
            "current_pct_negative": pct_negative_7d,
            "current_pct_neutral": pct_neutral_7d,
            "current_pct_positive": pct_positive_7d,
            "baseline_pct_negative": pct_negative_prev,
            # Only emit a delta when we have a real baseline week. When
            # baseline_total = 0 (first full week of ingest, or empty
            # segment), the delta would equal the current value and
            # surface as a misleading "+27.5pp" pill (2026-05-21).
            "delta_pp_negative": (
                round(pct_negative_7d - pct_negative_prev, 1)
                if baseline_total > 0
                else None
            ),
        },
        "top_categories": [
            {
                **c,
                # Same baseline-empty guard: if there was no prior-week
                # data we can't compute a real delta, so emit None and
                # let the UI show "—" rather than a spurious "+58.2pp".
                "delta_pp": (
                    round(c["share_pct"] - prev_share.get(c["category"], 0), 1)
                    if cat_total_prev_real > 0
                    else None
                ),
            }
            for c in top_categories_7d
        ],
        "top_topics": top_topics,
        "platforms": platform_breakdown,
    }


def _build_retrieval_query_fallback(stats: dict[str, Any], segment: str | None) -> str:
    """Token-concatenation fallback when LLM query generation fails.

    Used to be the primary retrieval-query builder. Token-matches verses
    that contain category names literally (e.g. "youth" → Quran verses
    about youthful paradise servants), so quality is poor. Kept only as
    a non-fatal fallback if Flash-Lite is unavailable.
    """
    bits: list[str] = []
    if stats["top_categories"]:
        top = stats["top_categories"][0]
        bits.append(f"isu {top['category']}")
    rising = next(
        (
            c
            for c in stats["top_categories"]
            if isinstance(c.get("delta_pp"), (int, float)) and c["delta_pp"] > 0
        ),
        None,
    )
    if rising and rising.get("category") and rising["category"] not in bits[0:1]:
        bits.append(f"yang sedang meningkat: {rising['category']}")
    if stats["top_topics"]:
        bits.append(stats["top_topics"][0]["label"])
    if segment:
        bits.append(f"dalam konteks {segment}")
    return ". ".join(bits) or "tema dakwah umum minggu ini"


_SEGMENT_INTENT = {
    None: "isu dakwah umum yang relevan ke audiens Muslim Indonesia minggu ini",
    "spiritual": "pembinaan aqidah dan akhlaq Muslim",
    "family": "ketahanan keluarga, peran orang tua, dan kesehatan rumah tangga",
    "youth": "pembinaan pemuda Muslim, pendidikan, dan tantangan generasi muda",
    "justice": "keadilan sosial, etika ekonomi, dan muamalah",
}


def _build_retrieval_query(stats: dict[str, Any], segment: str | None) -> str:
    """LLM-generated thematic search query for Qdrant retrieval.

    Why an LLM call: token-concatenation of category names
    ("isu youth. yang sedang meningkat: youth.") matches surface keywords
    in verse translations — e.g. "youth" surfaces Quran verses about
    youthful paradise servants, not thematic guidance for pemuda. Flash-Lite
    reads the segment intent + top headlines and synthesizes a query in
    scholarly Bahasa Indonesia that a da'i would actually search for
    (e.g. "amanah pemuda dalam menghadapi tekanan ekonomi dan
    kritisme politik yang konstruktif"), giving the embedding step a
    fair shot at thematic-fit verses instead of surface-keyword matches.

    Cost: ~$0.0005 per call · 5 calls/day → ~$0.075/mo. Negligible.

    Falls back to the legacy token-concat builder on any error so the
    pipeline never breaks because of this enhancement.
    """
    if not settings.gemini_api_key:
        return _build_retrieval_query_fallback(stats, segment)

    headline_lines: list[str] = []
    for t in stats.get("top_topics", [])[:5]:
        for h in t.get("sample_headlines", [])[:2]:
            title = (h.get("title") or "").strip()
            if title:
                headline_lines.append(f"- {title}")
    headlines_block = "\n".join(headline_lines) or "(tidak ada headline)"

    top_cat = (
        stats["top_categories"][0]["category"]
        if stats.get("top_categories")
        else "umum"
    )
    intent = _SEGMENT_INTENT.get(segment, _SEGMENT_INTENT[None])

    prompt = f"""Saya ingin mencari ayat Qur'an dan hadith dari basis data vektor untuk dijadikan daleel dalam briefing da'i.

KONTEKS BRIEFING:
- Segmen: {segment or 'umum (semua)'}
- Niat tematik segmen ini: {intent}
- Kategori dominan pekan ini: {top_cat}

HEADLINE NYATA YANG MENDORONG TREN PEKAN INI:
{headlines_block}

TUGAS: Tulis SATU kalimat (maksimal 25 kata) dalam Bahasa Indonesia yang menggambarkan TEMA INTI yang menghubungkan headline-headline di atas dengan niat segmen, MENGGUNAKAN KOSAKATA SYAR'I yang biasa muncul dalam terjemahan ayat/hadith (contoh: amanah, qana'ah, ketahanan keluarga, akhlaq, adil, mengurangi timbangan, hikmah, sabar, tolong-menolong dalam kebaikan).

Jangan tulis nama kasus atau orang. Jangan tulis kata bahasa Inggris seperti "youth" atau "family". Tulis hanya kalimat tematik tersebut, tanpa pengantar."""

    try:
        client = _get_client()
        resp = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=120,
                # thinking disabled — this is a simple template-fill task,
                # no reasoning needed. Saves ~512 tokens of thinking budget
                # per call. Flash-Lite minimum if thinking IS enabled is 512.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        query = (resp.text or "").strip().strip('"').strip("'")
        if not query:
            return _build_retrieval_query_fallback(stats, segment)

        usage_md = getattr(resp, "usage_metadata", None)
        from api.services.usage import record_usage as _record_usage

        _record_usage(
            provider="gemini",
            operation="retrieval_query_gen",
            model="gemini-2.5-flash-lite",
            tokens_in=getattr(usage_md, "prompt_token_count", None),
            tokens_out=gemini_output_tokens(usage_md),
            meta={"segment": segment},
        )
        log.info(
            "insights_summary.retrieval_query_generated",
            segment=segment,
            query=query[:120],
        )
        return query
    except Exception as exc:
        log.warning(
            "insights_summary.retrieval_query_failed",
            segment=segment,
            error=str(exc),
        )
        return _build_retrieval_query_fallback(stats, segment)


def _build_user_prompt(
    stats: dict[str, Any],
    daleel: list[dict[str, Any]],
    *,
    language: str = "id",
) -> str:
    """Assemble the structured context for Gemini.

    `language` switches the daleel block (Bahasa translation for `id`,
    English translation for `en`) and the empty-daleel sentinel string.
    The stats JSON itself is language-agnostic — the model translates
    numeric + categorical context naturally.
    """
    if language == "en":
        empty_marker = "(no daleel found for this theme)"
        translation_label = "Translation (EN)"
        scope_note_all = (
            "SEGMENT_SCOPE: all\n"
            "Top_categories percentages are share of all categorized "
            "conversation this week. Phrase as 'public conversation' is fine."
        )
    else:
        empty_marker = "(tidak ada daleel yang ditemukan untuk tema ini)"
        translation_label = "Terjemahan ID"
        scope_note_all = (
            "SEGMENT_SCOPE: all\n"
            "Top_categories percentages are share of all categorized "
            "conversation this week. Phrase as 'percakapan publik' is fine."
        )

    def _translation_for(d: dict[str, Any]) -> str:
        if language == "en":
            # Hadith corpora have no Bahasa translation; English is the
            # only option there anyway. Quran has both.
            return d.get("translation_en") or d.get("translation_id") or ""
        return d.get("translation_id") or d.get("translation_en") or ""

    # The `Citation` field is what the model echoes back as its heading.
    # Earlier we passed `[{ref_id}] {CORPUS} {citation}` which made the
    # model render `**RIYAD_AS_SALIHIN Riyad as-Salihin 1420**` headings
    # — corpus name doubled because it was already in the citation
    # string. Cleaned up 2026-05-21.
    daleel_block = (
        "\n\n".join(
            f"Citation: {d['citation']}\n"
            f"Arabic: {d['arabic'][:300]}\n"
            f"{translation_label}: {_translation_for(d)[:500]}"
            for d in daleel
        )
        if daleel
        else empty_marker
    )

    # Pretty-print top topics with their sample headlines so the model
    # can write about specific stories, not just category percentages.
    top_topics_block_lines: list[str] = []
    for t in stats.get("top_topics", [])[:5]:
        top_topics_block_lines.append(
            f"- {t['label']} ({t['post_count']} posts · platform={t['platform']})"
        )
        for h in t.get("sample_headlines", [])[:3]:
            author = h.get("author") or "?"
            top_topics_block_lines.append(
                f"    · [{author}] {h['title']}"
            )
    top_topics_block = (
        "\n".join(top_topics_block_lines)
        if top_topics_block_lines
        else "(tidak ada topik dengan sample headline)"
    )

    # Strip sample_headlines out of the JSON dump to avoid duplicating
    # them — they're already laid out in TOP TOPICS WITH SAMPLE HEADLINES.
    stats_for_json = {
        **stats,
        "top_topics": [
            {k: v for k, v in t.items() if k != "sample_headlines"}
            for t in stats.get("top_topics", [])
        ],
    }

    segment = stats.get("segment")
    scope_label = segment if segment else "all"
    if segment:
        seg_cats = SEGMENT_CATEGORIES.get(segment, [])
        scope_note = (
            f"SEGMENT_SCOPE: {scope_label}\n"
            f"Top_categories percentages are share WITHIN this segment's "
            f"categories ({', '.join(seg_cats)}) — not share of all weekly "
            f"conversation. Phrase accordingly (see system instructions)."
        )
    else:
        scope_note = scope_note_all

    write_now = (
        "Tulis briefing sekarang dalam format markdown 5 bagian (Ringkasan Eksekutif / Numerik & Tren Pekan Ini / Tema Utama & Pola Yang Muncul / Strategi & Aksi Dakwah / Daleel & Sumber), ~7300-9800 kata total — Strategi & Aksi Dakwah adalah CONTENT KIT yang isinya draft siap-pakai (khutbah lengkap, outline kajian, script video, dll) dengan daleel pool yang ditenun inline ke setiap sub-section, bukan ringkasan strategi."
        if language == "id"
        else "Write the briefing now in markdown, 5-section format (Executive Summary / Numbers & Trends This Week / Main Themes & Emerging Patterns / Da'wah Strategies & Actions / Daleel & Sources), ~7300-9800 words total — Da'wah Strategies & Actions is a CONTENT KIT containing ready-to-use drafts (full khutbah, kajian outline, video script, etc) with daleel from the pool woven inline into each sub-section, NOT a strategic summary."
    )

    return f"""{scope_note}

HEADLINE NUMBERS (use ONLY these for Sections 1 & 2):

{json.dumps(stats_for_json, indent=2, ensure_ascii=False)}

TOP TOPICS WITH SAMPLE HEADLINES (Section 3 MUST name specific stories from these headlines, not just abstract category counts):

{top_topics_block}

DALEEL POOL (use for Section 5, cite 4-5 from here; the `Citation` field is what goes in your heading):

{daleel_block}

{write_now}"""


_client: genai.Client | None = None


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set.")
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


_RELAXED_SAFETY = [
    types.SafetySetting(category=cat, threshold="BLOCK_ONLY_HIGH")
    for cat in (
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
    )
]
# Observed 2026-05-21: Gemini 2.5 Pro returned empty responses on 4 of 5
# segment briefings under default safety. The prompts referenced
# corruption cases, child-abuse incidents, WNI captives — news data we
# want the model to ANALYZE for a da'wah audience, not generate. Default
# thresholds over-fire for analytical use cases of dark-news content.


def _generate_for_language(
    client: genai.Client,
    stats: dict[str, Any],
    daleel: list[dict[str, Any]],
    language: str,
    segment: str | None,
) -> tuple[str, int | None, int | None, float] | None:
    """Run one Gemini Pro call in the requested language.

    Returns `(summary_md, tokens_in, tokens_out, cost_usd)` on success
    or `None` on empty response (safety block / token cap / unknown
    finish reason). Caller decides whether the missing output is fatal
    (Indonesian) or recoverable with fallback (English).
    """
    system_prompt = SYSTEM_PROMPT_EN if language == "en" else SYSTEM_PROMPT_ID
    user_prompt = _build_user_prompt(stats, daleel, language=language)

    resp = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.5,
            safety_settings=_RELAXED_SAFETY,
            # 32768-token output cap supports the long-form 5-section
            # briefing where Section 4 is a full content kit (full
            # khutbah 2300-3200 kata + kajian outline + script + Gen Z
            # discussion + action plan ≈ 4300-6200 words for that
            # section alone, ~10000-13000 tokens visible). Top-level
            # brief ≈ 5800-8200 words → ~12000-16000 tokens. Bumped
            # from 8192 when Section 4 expanded (2026-05-22).
            max_output_tokens=32768,
            # 12288-token thinking budget — Section 4 has a multi-part
            # structure (6 sub-sections, full khutbah with mukadimah →
            # inti → doa Arab → tahmid) that the model needs space to
            # plan coherently. Pro charges thinking at the output rate,
            # so this adds ~$0.12/call; offset by the weekly (Sunday)
            # cadence drop and still inside the IDR cap.
            thinking_config=types.ThinkingConfig(thinking_budget=12288),
        ),
    )
    summary_md = (resp.text or "").strip()
    if not summary_md:
        finish_reason = None
        block_reason = None
        try:
            if resp.candidates:
                finish_reason = getattr(
                    resp.candidates[0], "finish_reason", None
                )
            pf = getattr(resp, "prompt_feedback", None)
            if pf is not None:
                block_reason = getattr(pf, "block_reason", None)
        except Exception:
            pass
        log.warning(
            "insights_summary.empty_response",
            segment=segment,
            language=language,
            finish_reason=str(finish_reason) if finish_reason else None,
            block_reason=str(block_reason) if block_reason else None,
        )
        return None

    usage_md = getattr(resp, "usage_metadata", None)
    tokens_in = getattr(usage_md, "prompt_token_count", None)
    # Pro thinking tokens are billed at output rate, so fold them in.
    tokens_out = gemini_output_tokens(usage_md)
    cost = (
        (tokens_in or 0) / 1_000_000 * 1.25
        + (tokens_out or 0) / 1_000_000 * 10.00
    )
    return summary_md, tokens_in, tokens_out, cost


async def generate_summary(
    segment: str | None = None,
) -> dict[str, Any] | None:
    """Compute stats, retrieve daleel, ask Gemini Pro to narrate.

    Args:
      segment: `None` for the all-platform briefing, otherwise one of
        the keys in `SEGMENT_CATEGORIES`.

    Persists one `insights_summaries` row and returns its payload.
    Returns None when there's no data for the requested segment.
    """
    async with SessionLocal() as session:
        stats = await _compute_stats(session, segment)

        if stats["totals"]["posts_7d"] == 0:
            log.info(
                "insights_summary.skip_empty",
                segment=segment,
            )
            return None

        # Daleel retrieval — two-pass: (1) embedding similarity over
        # the whole corpus to surface a wide candidate set (limit=15,
        # per_corpus=4), then (2) Gemini Flash-Lite re-ranks them by
        # THEMATIC fit, returning the top 3 actually-relevant matches.
        # Without the re-rank, embedding matches like Quran verses
        # about youthful paradise servants slip through for any query
        # mentioning "muda" / "pemuda" — surface keyword overlap, not
        # semantic relevance.
        retrieval_query = _build_retrieval_query(stats, segment)
        candidates = retrieve_daleel(
            retrieval_query, limit=15, per_corpus=4
        )
        # top_n=10 (was 5, 2026-05-23) — the brief now weaves daleel
        # citations into BOTH Section 4 sub-sections (khutbah, kajian,
        # Gen Z, etc.) AND Section 5 (bibliography). A pool of 10 gives
        # the LLM room to pick the most thematically-fit verse per
        # sub-section without repeating the same 2-3 daleel everywhere.
        # The two flyers also pick different daleel (rank 0 vs rank 1)
        # so they don't visually duplicate.
        daleel = rerank_daleel(retrieval_query, candidates, top_n=10)
        # Fill `translation_id` for hadith entries (Qdrant only has EN
        # for the hadith corpora). Without this the DaleelChips below
        # the ID-locale brief render English. Idempotent on Quran-only
        # lists. ~$0.0001 per brief.
        daleel = translate_daleel_to_id(daleel)
        log.info(
            "insights_summary.retrieved_daleel",
            segment=segment,
            query=retrieval_query,
            candidates=len(candidates),
            final=len(daleel),
        )

        client = _get_client()

        # Indonesian-only generation. The English brief was disabled
        # 2026-05-23 — at current usage all users prefer Indonesian and
        # the second Pro call effectively doubled per-brief cost for a
        # locale nobody was reading. UI falls back to `summary_md` when
        # `summary_md_en` is NULL, with a banner on the EN-locale view
        # explaining the situation + the "contact us for English" path.
        #
        # Re-enable by restoring the `_generate_for_language("en", ...)`
        # call below — the persistence path already handles a non-NULL
        # `summary_md_en`.
        id_result = _generate_for_language(client, stats, daleel, "id", segment)
        if id_result is None:
            return None
        summary_md, tokens_in_id, tokens_out_id, cost_id = id_result

        summary_md_en = None
        tokens_in_en = tokens_out_en = 0
        cost_en = 0.0

        tokens_in = (tokens_in_id or 0) + (tokens_in_en or 0)
        tokens_out = (tokens_out_id or 0) + (tokens_out_en or 0)
        cost = cost_id + cost_en

        row = InsightsSummary(
            generated_at=datetime.now(UTC),
            period_start=datetime.fromisoformat(stats["period_start"]),
            period_end=datetime.fromisoformat(stats["period_end"]),
            summary_md=summary_md,
            summary_md_en=summary_md_en,
            headline_stats=stats,
            model=MODEL,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
            segment=segment,
            daleel_refs=daleel,
        )
        session.add(row)
        await session.commit()

        from api.services.usage import record_usage

        record_usage(
            provider="gemini",
            operation="insights_summary",
            model=MODEL,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost,
            meta={"segment": segment, "languages": "id+en" if summary_md_en else "id"},
        )

        log.info(
            "insights_summary.generated",
            segment=segment,
            posts_7d=stats["totals"]["posts_7d"],
            daleel_count=len(daleel),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=round(cost, 4),
            has_en=summary_md_en is not None,
        )

        return {
            "summary_md": summary_md,
            "summary_md_en": summary_md_en,
            "stats": stats,
            "daleel_refs": daleel,
            "segment": segment,
            "cost_usd": round(cost, 4),
        }


async def generate_all_summaries() -> dict[str, Any]:
    """Generate all 5 daily summaries: 1 all-platform + 4 per-segment.

    Returns a per-segment status dict, useful for the Celery task to
    log a single observable line and for ops to spot which ones
    failed.
    """
    results: dict[str, Any] = {}
    # all-platform first — its stats compute over the broadest set
    results["__all__"] = await generate_summary(None) is not None
    for segment in SEGMENT_CATEGORIES:
        try:
            ok = await generate_summary(segment) is not None
        except Exception as exc:
            log.exception(
                "insights_summary.segment_failed",
                segment=segment,
                error=str(exc),
            )
            ok = False
        results[segment] = ok
    return results
