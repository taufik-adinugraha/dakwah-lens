/**
 * Report copy (plan §6) as MESSAGE KEYS with their default Indonesian text. The report view-model
 * carries only keys and values (Msg); the UI agent writes messages/waris/{id,en}.json from this
 * table under the top-level namespace "laporan" (each dotted key is one nested JSON path).
 *
 * Rules this table keeps (checked by checks/report.ts):
 *  - templates use plain "{name}" placeholders only (no ICU plural/select), so
 *    renderMsg(msg, (k) => t.raw(k)) renders next-intl copy exactly as the defaults below;
 *  - no Arabic script, no bare "QS"/"HR" citation (plan D10: citations are structured references
 *    the UI renders from dalil.json), no ALL-CAPS emphasis, "Anda" register, sentence case;
 *  - no promise of a review: the operator decided there is NO human review (plan §2 "Decisions
 *    taken"); nothing here says a text was or will be reviewed by an ustadz;
 *  - heir labels are lower-case (they sit mid-sentence); Msg.cap asks the renderer to capitalise.
 *
 * Every Islamic rule a learner reads comes from a RuleNote (rules.json), never from this table;
 * these strings are frame, labels and procedure. AI-assisted, not an authoritative fatwa.
 */
import type { HeirId } from "../registry";

export const REPORT_MESSAGES = {
  // ── 0. Kepala ────────────────────────────────────────────────────────────────────────────────
  "laporan.kepala.judul": "Rekomendasi Pembagian Waris",
  "laporan.kepala.judul_simulasi": "Simulasi Pembagian Waris",
  "laporan.kepala.subjudul": "berdasarkan jawaban Anda",
  "laporan.kepala.label": "Dibantu AI, bukan fatwa otoritatif, bukan penetapan pengadilan",
  "laporan.kepala.chip": "Dibantu AI · bukan fatwa",
  "laporan.kepala.kode": "Kode jawaban: {kode}",
  "laporan.kepala.tanggal": "Dibuat {tanggal}",
  "laporan.kepala.kolom_utama": "Kolom utama: {kolom}",
  "laporan.kepala.kolom_utama_pengganti": "Kolom fikih tidak dapat dihitung untuk keluarga ini. Yang ditampilkan: {kolom}",
  "laporan.kepala.metode_fikih": "Faraidh — selaras fatwa MUI, dengan catatan KHI",
  "laporan.kepala.jalur_hukum": "Pembagian yang mengikat secara hukum ditetapkan melalui Penetapan Ahli Waris di Pengadilan Agama.",
  "laporan.kepala.musyawarah":
    "Setelah masing-masing mengetahui bagiannya, para ahli waris boleh bersepakat membagi dengan cara lain melalui musyawarah.",
  "laporan.kepala.simulasi": "Ini simulasi untuk keluarga yang masih hidup. Hasilnya dapat berubah bila keadaan keluarga berubah.",

  // ── Pewaris (who the report is about: the questionnaire's A1 and A2) ─────────────────────────
  "laporan.pewaris.almarhum": "almarhum",
  "laporan.pewaris.almarhumah": "almarhumah",
  "laporan.pewaris.anda": "Anda",
  "laporan.pewaris.beliau": "beliau",
  "laporan.pewaris.saat_wafat": "saat {pewaris} wafat",
  "laporan.pewaris.saat_simulasi": "jika {pewaris} wafat hari ini",

  // ── Kolom ────────────────────────────────────────────────────────────────────────────────────
  "laporan.kolom.fikih": "Menurut fikih mazhab Syafi'i",
  "laporan.kolom.court": "Menurut KHI dan praktik Pengadilan Agama",

  // ── 1. Ringkasan ─────────────────────────────────────────────────────────────────────────────
  "laporan.ringkasan.judul": "Ringkasan",
  "laporan.ringkasan.kalimat_ahli": "Harta waris dibagi kepada {jumlah} ahli waris.",
  "laporan.ringkasan.kalimat_terhalang": "{jumlah} kerabat terhalang.",
  "laporan.ringkasan.kalimat_bukan": "{jumlah} kerabat bukan ahli waris.",
  "laporan.ringkasan.sama": "Untuk keluarga ini, fikih dan KHI menghasilkan pembagian yang sama.",
  "laporan.ringkasan.berbeda":
    "Untuk sebagian ahli waris, KHI dan praktik Pengadilan Agama menghasilkan bagian yang berbeda. Kedua kolom ditampilkan berdampingan.",
  "laporan.ringkasan.kolom_ahli": "Ahli waris",
  "laporan.ringkasan.kolom_jumlah": "Jumlah",
  "laporan.ringkasan.kolom_bagian": "Bagian",
  "laporan.ringkasan.kolom_persen": "Persen",
  "laporan.ringkasan.kolom_rupiah": "Rupiah",
  "laporan.ringkasan.kolom_dasar": "Dasar",
  "laporan.ringkasan.orang": "{jumlah} orang",
  "laporan.ringkasan.masing": "masing-masing {bagian}",
  "laporan.ringkasan.hitung_rupiah": "Hitung dalam rupiah",
  "laporan.ringkasan.aul": "{dari} menjadi {menjadi}, dikurangi bersama karena 'aul",
  "laporan.ringkasan.radd": "{dari} menjadi {menjadi}, ditambah sisa harta (radd)",
  "laporan.ringkasan.tidak_mendapat": "Tidak mendapat bagian",
  "laporan.ringkasan.terhalang_oleh": "Terhalang oleh {oleh}",
  "laporan.ringkasan.bukan_ahli_waris": "Bukan ahli waris",
  "laporan.ringkasan.diambil_dulu": "Diambil lebih dulu dari harta setelah utang",
  "laporan.ringkasan.basis": "Bagian dihitung dari harta waris, yaitu harta setelah biaya, utang, dan wasiat.",
  "laporan.ringkasan.basis_setelah_utang":
    "Yang diambil lebih dulu berbeda antara kedua kolom, jadi bagian ahli waris ditampilkan sebagai bagian dari harta setelah biaya dan utang, agar kedua kolom dapat dibandingkan.",
  "laporan.ringkasan.basis_baris": "Bagian dari harta setelah utang: {bagian}",
  "laporan.ringkasan.sisa_dirujuk": "Sisa harta ini belum dapat ditentukan oleh alat ini. Silakan berkonsultasi ke Pengadilan Agama.",
  "laporan.ringkasan.asal_masalah": "Asal masalah {asal}",
  "laporan.ringkasan.asal_masalah_aul": "Asal masalah {asal}, naik menjadi {menjadi} karena 'aul",
  "laporan.ringkasan.asal_masalah_radd": "Asal masalah {asal}; setelah radd dihitung dari {menjadi}",
  "laporan.ringkasan.bergantung":
    "Pembagian ini bergantung pada jawaban «Tidak tahu» tentang {hal}. Kemungkinan-kemungkinannya ditampilkan berdampingan.",
  "laporan.ringkasan.bergantung_iddah":
    "Pembagian ini bergantung pada hak waris pasangan yang bercerai dengan talak raj'i dan masih dalam masa iddah. Kedua kemungkinan ditampilkan berdampingan.",
  "laporan.ringkasan.bergantung_belum":
    "Pembagian ini bergantung pada persetujuan para ahli waris atas wasiat, yang belum dibicarakan. Kedua kemungkinan ditampilkan berdampingan.",
  "laporan.ringkasan.tabel_kemungkinan": "Rincian di tabel ini untuk kemungkinan «{kemungkinan}».",
  "laporan.ringkasan.baris_ringkas": "{kerabat}: {bagian}",
  "laporan.ringkasan.kelompok_terbuka": "{kerabat} ({jumlah} orang atau lebih)",
  "laporan.ringkasan.dibagi_rata": "dibagi rata di antara mereka",
  "laporan.ringkasan.catatan_pecahan": "Pecahan adalah bagian yang sah; persen dan rupiah hanya alat bantu.",
  "laporan.ringkasan.rupiah_rumit":
    "Rupiah tidak dihitung, karena harta bersama keluarga ini perlu ditetapkan lebih dulu oleh Pengadilan Agama.",
  "laporan.ringkasan.lihat_dasar": "Dasar",

  // ── Baris yang diambil lebih dulu ────────────────────────────────────────────────────────────
  "laporan.baris.wasiat": "Wasiat",
  "laporan.baris.wasiat_ke": "Wasiat ke-{ke}",
  "laporan.baris.wasiat_wajibah": "Wasiat wajibah untuk {kerabat}",
  "laporan.baris.ww_plafon": "Paling banyak sebesar ini; besarnya ditetapkan hakim.",
  "laporan.baris.ww_ilustrasi": "Contoh cara putusan Mahkamah Agung; besarnya ditetapkan hakim.",
  "laporan.baris.sisa": "sisa harta yang belum ditentukan",

  // ── Ahli waris dan kerabat (mid-sentence, lower case) ────────────────────────────────────────
  "laporan.ahli.anak_lk": "anak laki-laki",
  "laporan.ahli.cucu_lk": "cucu laki-laki dari anak laki-laki",
  "laporan.ahli.ayah": "ayah",
  "laporan.ahli.kakek": "kakek (ayah dari ayah)",
  "laporan.ahli.sdr_lk_kandung": "saudara laki-laki kandung",
  "laporan.ahli.sdr_lk_seayah": "saudara laki-laki seayah",
  "laporan.ahli.sdr_lk_seibu": "saudara laki-laki seibu",
  "laporan.ahli.keponakan_lk_kandung": "anak laki-laki dari saudara laki-laki kandung",
  "laporan.ahli.keponakan_lk_seayah": "anak laki-laki dari saudara laki-laki seayah",
  "laporan.ahli.paman_kandung": "paman kandung (saudara kandung ayah)",
  "laporan.ahli.paman_seayah": "paman seayah (saudara seayah ayah)",
  "laporan.ahli.sepupu_lk_kandung": "anak laki-laki dari paman kandung",
  "laporan.ahli.sepupu_lk_seayah": "anak laki-laki dari paman seayah",
  "laporan.ahli.suami": "suami",
  "laporan.ahli.mutiq": "mu'tiq (pembebas budak)",
  "laporan.ahli.anak_pr": "anak perempuan",
  "laporan.ahli.cucu_pr": "cucu perempuan dari anak laki-laki",
  "laporan.ahli.ibu": "ibu",
  "laporan.ahli.nenek_ibu": "nenek (ibu dari ibu)",
  "laporan.ahli.nenek_ayah": "nenek (ibu dari ayah)",
  "laporan.ahli.sdr_pr_kandung": "saudara perempuan kandung",
  "laporan.ahli.sdr_pr_seayah": "saudara perempuan seayah",
  "laporan.ahli.sdr_pr_seibu": "saudara perempuan seibu",
  "laporan.ahli.istri": "istri",
  "laporan.ahli.mutiqah": "mu'tiqah (pembebas budak)",
  "laporan.ahli.cucu_lk_dari_anak_pr": "cucu laki-laki dari anak perempuan",
  "laporan.ahli.cucu_pr_dari_anak_pr": "cucu perempuan dari anak perempuan",
  "laporan.ahli.anak_lk_dari_cucu_pr": "anak laki-laki dari cucu perempuan",
  "laporan.ahli.anak_pr_dari_cucu_pr": "anak perempuan dari cucu perempuan",
  "laporan.ahli.anak_lk_sdr_pr_kandung": "anak laki-laki dari saudara perempuan kandung",
  "laporan.ahli.anak_pr_sdr_pr_kandung": "anak perempuan dari saudara perempuan kandung",
  "laporan.ahli.anak_lk_sdr_pr_seayah": "anak laki-laki dari saudara perempuan seayah",
  "laporan.ahli.anak_pr_sdr_pr_seayah": "anak perempuan dari saudara perempuan seayah",
  "laporan.ahli.anak_pr_sdr_lk_kandung": "anak perempuan dari saudara laki-laki kandung",
  "laporan.ahli.anak_pr_sdr_lk_seayah": "anak perempuan dari saudara laki-laki seayah",
  "laporan.ahli.anak_sdr_seibu": "anak dari saudara seibu",
  "laporan.ahli.kakek_dari_ibu": "kakek (ayah dari ibu)",
  "laporan.ahli.paman_ibu": "saudara laki-laki ibu",
  "laporan.ahli.bibi_ibu": "saudara perempuan ibu",
  "laporan.ahli.paman_seibu_ayah": "saudara laki-laki seibu ayah",
  "laporan.ahli.bibi_ayah": "saudara perempuan ayah",
  "laporan.ahli.anak_pr_paman_kandung": "anak perempuan dari paman kandung",
  "laporan.ahli.anak_pr_paman_seayah": "anak perempuan dari paman seayah",
  "laporan.ahli.anak_angkat": "anak angkat",
  "laporan.ahli.orang_tua_angkat": "orang tua angkat",
  "laporan.ahli.anak_tiri": "anak tiri",
  "laporan.ahli.kerabat_jauh": "kerabat di luar jangkauan alat ini",
  "laporan.ahli.pengganti": "cucu pengganti dari anak yang wafat lebih dulu",
  "laporan.ahli.pengganti_lk": "cucu pengganti dari anak laki-laki yang wafat lebih dulu",
  "laporan.ahli.pengganti_pr": "cucu pengganti dari anak perempuan yang wafat lebih dulu",
  "laporan.ahli.furudh": "para pemilik bagian pasti",
  "laporan.ahli.baitul_mal": "Baitul Mal",
  "laporan.ahli.wasith": "kerabat yang lebih dekat pada jalurnya",
  "laporan.ahli.beda_agama": "{kerabat} yang berbeda agama",

  // ── Kelompok yang tidak ditanyakan ───────────────────────────────────────────────────────────
  "laporan.kelompok.saudara": "saudara",
  "laporan.kelompok.saudara_kandung": "saudara kandung",
  "laporan.kelompok.saudara_seayah": "saudara seayah",
  "laporan.kelompok.saudara_seibu": "saudara seibu",
  "laporan.kelompok.keponakan": "anak laki-laki dari saudara laki-laki",
  "laporan.kelompok.paman": "paman",
  "laporan.kelompok.sepupu": "sepupu",
  "laporan.kelompok.kakek": "kakek",
  "laporan.kelompok.nenek": "nenek",
  "laporan.kelompok.cucu": "cucu",
  "laporan.kelompok.kerabat_lain": "kerabat lain",

  // ── 2. Diagram ───────────────────────────────────────────────────────────────────────────────
  "laporan.diagram.judul": "Diagram",
  "laporan.diagram.urutan": "Dari harta peninggalan ke harta waris",
  "laporan.diagram.bilah": "Bilah pembagian",
  "laporan.diagram.pohon": "Pohon keluarga",
  "laporan.diagram.lihat_tabel": "Lihat sebagai tabel",
  "laporan.diagram.keterangan_bagian": "{kerabat} mendapat {bagian}.",
  "laporan.diagram.keterangan_sisa": "Sisa {bagian} belum dapat ditentukan oleh alat ini.",
  "laporan.urutan.harta_awal": "Harta peninggalan seluruhnya",
  "laporan.urutan.harta_bersama": "Separuh harta bersama, milik {kerabat}",
  "laporan.urutan.biaya_sakit": "Biaya perawatan menjelang wafat",
  "laporan.urutan.biaya_jenazah": "Biaya pengurusan jenazah",
  "laporan.urutan.utang": "Utang {pewaris}",
  "laporan.urutan.harta_waris": "Harta waris yang dibagi",
  "laporan.pohon.pewaris_l": "Almarhum",
  "laporan.pohon.pewaris_p": "Almarhumah",
  "laporan.pohon.wafat_dulu": "wafat lebih dulu",
  "laporan.pohon.terhalang": "terhalang",
  "laporan.pohon.bukan": "bukan ahli waris",
  "laporan.pohon.mendapat": "mendapat bagian",
  "laporan.pohon.kotak_luar": "Bukan ahli waris",
  "laporan.pohon.ringkas": "{pewaris}, {daftar}",
  "laporan.pohon.jumlah": "{jumlah} {kerabat}",

  // ── 3. Yang tidak mendapat bagian ────────────────────────────────────────────────────────────
  "laporan.tidak.judul": "Yang tidak mendapat bagian, dan mengapa",
  "laporan.tidak.terhalang": "Terhalang",
  "laporan.tidak.bukan": "Bukan ahli waris",
  "laporan.tidak.tidak_ditanya": "Tidak ditanyakan",
  "laporan.tidak.oleh": "{kerabat} terhalang oleh {oleh}.",
  "laporan.tidak.habis": "{kerabat} tidak mendapat sisa, karena harta sudah habis dibagi kepada para pemilik bagian pasti.",
  "laporan.tidak.bukan_ahli": "{kerabat} bukan ahli waris.",
  "laporan.tidak.ditanya": "{kelompok} tidak ditanyakan karena ada {oleh}.",
  "laporan.tidak.ditanya_tanpa_sebab": "{kelompok} tidak ditanyakan karena tidak mengubah pembagian.",
  "laporan.tidak.kolom_lain": "{kolom}: {alasan}",
  "laporan.tidak.jalan_judul": "Jalan kebaikan tetap terbuka",
  "laporan.tidak.jalan_wasiat": "Wasiat {pewaris} untuknya dijalankan lebih dulu, paling banyak sepertiga harta setelah utang.",
  "laporan.tidak.jalan_hadiah": "Para ahli waris dapat memberinya hadiah atau hibah dari bagian masing-masing, dengan rela.",
  "laporan.tidak.jalan_ww_plafon": "Di kolom Pengadilan Agama: wasiat wajibah paling banyak sebesar ini; besarnya ditetapkan hakim.",
  "laporan.tidak.jalan_ww_ilustrasi":
    "Di kolom Pengadilan Agama: contoh cara putusan Mahkamah Agung memberinya wasiat wajibah sebesar ini; besarnya ditetapkan hakim.",
  "laporan.tidak.akhir":
    "Mereka tetap keluarga. Al-Qur'an menganjurkan memberi sekadarnya kepada kerabat, anak yatim, dan orang miskin yang hadir saat pembagian, dan berkata yang baik kepada mereka.",

  // ── 4. Dalil ─────────────────────────────────────────────────────────────────────────────────
  "laporan.dalil.judul": "Dalil untuk setiap bagian",
  "laporan.dalil.dasar_bagian": "Dasar bagian {kerabat}",
  "laporan.dalil.rujukan": "Rujukan ({jumlah})",
  "laporan.dalil.sebelum": "Dasar langkah sebelum pembagian",
  "laporan.dalil.tidak_mendapat": "Dasar untuk kerabat yang tidak mendapat bagian",
  "laporan.dalil.lihat_atas": "Dalil ini sudah ditampilkan di atas.",
  "laporan.dalil.kolom_court": "Untuk kolom KHI dan praktik Pengadilan Agama",
  "laporan.dalil.label_quranenc":
    "Terjemahan Berbahasa Indonesia - Kementerian Agama, sebagaimana dinamai QuranEnc (indonesian_affairs v1.0.1)",
  "laporan.dalil.label_muslim": "Terjemahan internal, bukan terjemahan terbitan",
  "laporan.dalil.catatan_penerjemah": "Catatan penerjemah",
  "laporan.dalil.tanpa_terjemah":
    "Teks ini ditampilkan dalam bahasa Arab aslinya. Kami tidak menerjemahkannya sendiri agar maknanya tidak berubah; penjelasan aturannya ada pada catatan di atasnya.",
  "laporan.dalil.atsar_muadh": "Putusan Mu'adh bin Jabal (atsar)",
  "laporan.dalil.bulugh": "Dikutip dalam Bulugh al-Maram; nama para perawi tercantum di akhir teks Arab.",
  "laporan.dalil.diringkas": "Bagian teks yang dilewati ditandai dengan tanda elipsis.",
  "laporan.dalil.terpotong": "Teks sumber terhenti di tengah kalimat; tanda elipsis di akhir menandainya.",
  "laporan.dalil.belum_ada": "Sumber kitab untuk aturan ini belum tersedia di rujukan kami.",
  "laporan.dalil.pendapat_lain": "Pendapat lain",

  // ── 5. Catatan metode ────────────────────────────────────────────────────────────────────────
  "laporan.catatan.judul": "Catatan metode",
  "laporan.catatan.asumsi_judul": "Asumsi dari jawaban Anda",
  "laporan.catatan.asumsi_hidup": "Semua kerabat yang dihitung masih hidup {saat}.",
  "laporan.catatan.asumsi_harta_bersama": "Separuh harta bersama dipisahkan lebih dulu sebagai milik pasangan yang masih hidup, bukan warisan.",
  "laporan.catatan.asumsi_tanpa_radd_pasangan": "Sisa harta tidak dikembalikan kepada suami atau istri.",
  "laporan.catatan.asumsi_pecahan": "Pecahan adalah bagian yang sah; persen dan rupiah hanya alat bantu.",
  "laporan.catatan.asumsi_wasiat_tidak_tahu":
    "Wasiat belum diketahui. Bila ada, wasiat paling banyak sepertiga harta diambil lebih dulu, sehingga semua bagian di atas ikut mengecil.",
  "laporan.catatan.asumsi_tanpa_rupiah": "Nilai harta tidak dimasukkan, jadi laporan ini hanya menampilkan pecahan dan persen.",
  "laporan.catatan.beda_judul": "Fikih dan KHI: ahli waris yang bagiannya berbeda",
  "laporan.catatan.beda_sebab": "Berbeda karena: {aturan}",
  "laporan.catatan.beda_kombinasi": "Berbeda karena gabungan beberapa aturan KHI dan praktik Pengadilan Agama.",
  "laporan.catatan.mengapa_dua":
    "KHI adalah pedoman Pengadilan Agama; fikih mazhab Syafi'i adalah pendapat para ulama mazhab. Keduanya bersandar pada Al-Qur'an dan Sunnah; perbedaannya ada pada penafsiran beberapa keadaan.",
  "laporan.catatan.radd_pasangan": "Sebagian hakim memberikan sisa harta juga kepada suami atau istri. Jika demikian, bagian {kerabat} menjadi {bagian}.",
  "laporan.catatan.perlu_judul": "Perlu dipastikan",
  "laporan.catatan.tidak_tahu": "Jawaban «Tidak tahu» tentang {hal}.",
  "laporan.catatan.tidak_tahu_sama": "Jawaban ini tidak mengubah pembagian.",
  "laporan.catatan.tidak_tahu_beda": "Jawaban ini mengubah pembagian. Kemungkinan-kemungkinannya:",
  "laporan.catatan.iddah_bergantung": "Hak waris pasangan yang bercerai dengan talak raj'i dan masih dalam masa iddah.",
  "laporan.catatan.belum_dibicarakan": "Persetujuan para ahli waris atas wasiat belum dibicarakan.",
  "laporan.catatan.iddah":
    "{pewaris} wafat ketika istrinya masih dalam masa iddah talak raj'i. Silakan berkonsultasi ke Pengadilan Agama atau ahli faraid tentang hak waris istri itu.",
  "laporan.catatan.iddah_p":
    "{pewaris} wafat dalam masa iddah talak raj'i dari suaminya. Silakan berkonsultasi ke Pengadilan Agama atau ahli faraid tentang hak waris suami itu.",
  "laporan.catatan.siri":
    "Ada pernikahan yang tidak dicatat (nikah siri). Untuk kolom Pengadilan Agama, status pernikahan itu perlu disahkan lebih dulu melalui itsbat nikah.",
  "laporan.catatan.catatan_lain": "Catatan lain",
  "laporan.catatan.tabel_tashih": "Agar bagian setiap orang menjadi bilangan bulat, angka pembagi {dari} dinaikkan menjadi {menjadi} (tashih).",
  "laporan.catatan.tabel_ikhtisar":
    "Tabel dapat disederhanakan dari {dari} menjadi {menjadi} tanpa mengubah bagian siapa pun (ikhtisar). Laporan ini tetap menampilkan asal masalah {asal} agar mudah dicocokkan dengan kitab.",
  "laporan.catatan.pembulatan_kepada": "Tambahan satu rupiah dari pembulatan diberikan kepada: {daftar}.",
  "laporan.catatan.versi": "Versi metode: mesin {mesin}; catatan aturan {aturan}, {tanggal}.",

  // ── Kemungkinan jawaban «Tidak tahu» ─────────────────────────────────────────────────────────
  "laporan.kemungkinan.ada": "Jika ada",
  "laporan.kemungkinan.tidak_ada": "Jika tidak ada",
  "laporan.kemungkinan.satu": "Jika satu orang",
  "laporan.kemungkinan.dua_atau_lebih": "Jika dua orang atau lebih",
  "laporan.kemungkinan.muslim": "Jika beragama Islam",
  "laporan.kemungkinan.bukan_muslim": "Jika tidak beragama Islam",
  "laporan.kemungkinan.setuju": "Jika semua ahli waris setuju",
  "laporan.kemungkinan.belum_setuju": "Jika belum semua ahli waris setuju",
  "laporan.kemungkinan.mewarisi": "Jika pasangan itu mewarisi",
  "laporan.kemungkinan.tidak_mewarisi": "Jika pasangan itu tidak mewarisi",
  "laporan.hal.pasangan": "pasangan {pewaris}",
  "laporan.hal.anak": "anak {pewaris}",
  "laporan.hal.cucu": "cucu {pewaris}",
  "laporan.hal.orang_tua": "orang tua {pewaris}",
  "laporan.hal.kakek_nenek": "kakek atau nenek {pewaris}",
  "laporan.hal.saudara": "saudara {pewaris}",
  "laporan.hal.kerabat_lain": "kerabat lain",
  "laporan.hal.agama": "agama kerabat {saat}",
  "laporan.hal.wasiat": "wasiat {pewaris}",
  "laporan.hal.persetujuan_wasiat": "persetujuan para ahli waris atas wasiat",

  // ── 6. Langkah berikutnya ────────────────────────────────────────────────────────────────────
  "laporan.langkah.judul": "Langkah berikutnya",
  "laporan.langkah.utang_wasiat": "Selesaikan biaya pengurusan jenazah dan utang {pewaris}, lalu tunaikan wasiatnya, paling banyak sepertiga harta.",
  "laporan.langkah.utang_wasiat_simulasi":
    "Pada waktunya, ahli waris lebih dulu menyelesaikan biaya pengurusan jenazah dan utang {pewaris}, lalu menunaikan wasiat {pewaris}, paling banyak sepertiga harta.",
  "laporan.langkah.musyawarah":
    "Musyawarah keluarga. Bawa laporan ini. Setiap ahli waris mengetahui bagiannya lebih dulu. Bila ada yang ingin memberikan sebagian bagiannya kepada yang lain, lakukan dengan rela dan catat.",
  "laporan.langkah.anak_kecil": "Ahli waris yang belum dewasa diwakili wali yang ditetapkan hakim; bagiannya tidak dilepaskan dalam kesepakatan.",
  "laporan.langkah.pemberian": "Siapkan pemberian sekadarnya untuk kerabat, anak yatim, dan orang miskin yang hadir saat pembagian.",
  "laporan.langkah.bukti":
    "Untuk bank atau kantor pertanahan, siapkan bukti ahli waris: surat keterangan ahli waris, atau Penetapan Ahli Waris dari Pengadilan Agama yang menyertakan semua ahli waris.",
  "laporan.langkah.sawah": "Sawah atau kebun di bawah 2 hektare sebaiknya tidak dipecah; ahli waris yang ingin memilikinya dapat membayar bagian yang lain.",
  "laporan.langkah.tanah_mui":
    "Rekomendasi MUI tahun 1984: tanah warisan yang sempit sebaiknya tetap utuh dan dimanfaatkan bersama; bila tidak, salah seorang ahli waris yang mampu membayar bagian yang lain; bila tidak, dijual lebih dulu kepada pemilik tanah yang berbatasan.",
  "laporan.langkah.sengketa": "Bila tidak tercapai kesepakatan: mediasi, lalu gugatan pembagian waris di Pengadilan Agama.",
  "laporan.langkah.tanya": "Tanyakan hal-hal yang ditandai «Perlu dipastikan» kepada ustadz atau ahli faraid.",
  "laporan.langkah.munasakhat": "Ada ahli waris yang wafat setelah {pewaris}? Bagiannya menjadi harta peninggalannya sendiri.",
  "laporan.langkah.hitung_beliau": "Hitung untuk beliau",

  // ── 7. Penutup ───────────────────────────────────────────────────────────────────────────────
  "laporan.penutup.ai": "Laporan ini disusun dengan bantuan AI dan dihitung otomatis. Bukan fatwa dan bukan penetapan pengadilan.",
  "laporan.penutup.dalil": "Dalil dikutip apa adanya dari kitab sumber, tanpa diketik ulang.",
  "laporan.penutup.privasi": "Jawaban Anda diproses di perangkat ini dan tidak disimpan di server kami.",

  // ── Rujuk (tidak dihitung) ───────────────────────────────────────────────────────────────────
  "laporan.rujuk.judul": "Silakan berkonsultasi",
  "laporan.rujuk.kalimat": "Alat ini tidak menghitung pembagian untuk keluarga ini, karena:",
  "laporan.rujuk.kolom": "{kolom}: tidak dihitung, karena:",
  "laporan.rujuk.ke_mana": "Silakan berkonsultasi ke Pengadilan Agama, KUA, atau ustadz yang memahami faraid.",
  "laporan.rujuk.tidak_tahu_ganda":
    "Lebih dari satu jawaban «Tidak tahu» dapat mengubah pembagian. Pastikan dulu jawaban-jawaban itu, atau silakan berkonsultasi.",
  "laporan.rujuk.tanpa_cetak": "Halaman ini tidak menyediakan cetakan ringkasan jawaban.",

  // ── Ringkasan teks (WhatsApp) ────────────────────────────────────────────────────────────────
  "laporan.teks.judul": "{judul} ({subjudul})",
  "laporan.teks.kode": "Kode jawaban {kode}",
  "laporan.teks.kolom": "{kolom}:",
  "laporan.teks.baris": "- {kerabat}: {bagian}",
  "laporan.teks.baris_orang": "- {kerabat} ({jumlah} orang): {bagian}, masing-masing {per}",
  "laporan.teks.berbeda": "Berbeda menurut KHI dan praktik Pengadilan Agama:",
  "laporan.teks.tidak_mendapat": "Tidak mendapat bagian: {daftar}.",
  "laporan.teks.tautan": "Laporan lengkap: {tautan}",
  "laporan.teks.rupiah": "{bagian}, {rupiah}",
  "laporan.teks.terhalang": "{kerabat} (terhalang)",
  "laporan.teks.bukan": "{kerabat} (bukan ahli waris)",
  "laporan.teks.dari_harta_setelah_utang": "Bagian di kolom ini dihitung dari harta setelah utang.",
} as const;

export type ReportMsgKey = keyof typeof REPORT_MESSAGES;

/** Heir and relative labels: every role id the engine may put in a share, block or ineligible group. */
export type LabelId =
  | HeirId
  | "cucu_lk_dari_anak_pr"
  | "cucu_pr_dari_anak_pr"
  | "anak_lk_dari_cucu_pr"
  | "anak_pr_dari_cucu_pr"
  | "anak_lk_sdr_pr_kandung"
  | "anak_pr_sdr_pr_kandung"
  | "anak_lk_sdr_pr_seayah"
  | "anak_pr_sdr_pr_seayah"
  | "anak_pr_sdr_lk_kandung"
  | "anak_pr_sdr_lk_seayah"
  | "anak_sdr_seibu"
  | "kakek_dari_ibu"
  | "paman_ibu"
  | "bibi_ibu"
  | "paman_seibu_ayah"
  | "bibi_ayah"
  | "anak_pr_paman_kandung"
  | "anak_pr_paman_seayah"
  | "anak_angkat"
  | "orang_tua_angkat"
  | "anak_tiri"
  | "kerabat_jauh"
  | "pengganti_lk"
  | "pengganti_pr"
  | "furudh"
  | "baitul_mal"
  | "wasith";

/** A placeholder value: text, a count, a nested message, or a list joined "a, b dan c". */
export type MsgValue = string | number | Msg | MsgList;
export interface MsgList {
  list: Msg[];
}
/** A message reference: the UI renders it with next-intl (or renderMsg with t.raw). */
export interface Msg {
  key: ReportMsgKey;
  values?: Record<string, MsgValue>;
  /** Capitalise the first letter when rendering (a lower-case label at the start of a line). */
  cap?: boolean;
}

export const msg = (key: ReportMsgKey, values?: Record<string, MsgValue>, cap?: boolean): Msg =>
  values ? (cap ? { key, values, cap } : { key, values }) : cap ? { key, cap } : { key };

/** A Msg object: { key: "laporan.…", values?, cap? } and nothing else (rows also carry a `key`). */
export function isMsg(v: unknown): v is Msg {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const k = (v as { key?: unknown }).key;
  return typeof k === "string" && k.startsWith("laporan.") && Object.keys(v).every((x) => x === "key" || x === "values" || x === "cap");
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Render a message: `{name}` placeholders only. `lookup` returns a raw template (default: this
 * table; in the UI pass `(k) => t.raw(k)` from next-intl). Lists join as "a, b dan c".
 */
export function renderMsg(m: Msg, lookup: (key: ReportMsgKey) => string = (k) => REPORT_MESSAGES[k]): string {
  const template: string | undefined = lookup(m.key);
  // a missing key renders as the key itself, as next-intl does (the report checks fail on it)
  if (typeof template !== "string") return m.key;
  const out = template.replace(/\{([a-z_]+)\}/g, (whole, name: string) => {
    const v = m.values?.[name];
    if (v === undefined) return whole;
    return renderValue(v, lookup);
  });
  return m.cap ? capitalise(out) : out;
}

export function renderValue(v: MsgValue, lookup: (key: ReportMsgKey) => string = (k) => REPORT_MESSAGES[k]): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toString();
  if ("list" in v) {
    const parts = v.list.map((x) => renderMsg(x, lookup));
    if (parts.length <= 1) return parts.join("");
    return `${parts.slice(0, -1).join(", ")} dan ${parts[parts.length - 1]}`;
  }
  return renderMsg(v, lookup);
}
