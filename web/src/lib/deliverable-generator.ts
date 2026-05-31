/**
 * Deliverable generator — turns a draft brief + selected daleel into a
 * publish-ready kajian in one of three liturgical formats.
 *
 * The brief is research scaffolding; the deliverable is the format-
 * specific artifact the da'i actually delivers: Khutbah Jumat (formal
 * 2-part with dua AR), Kultum (~7-min single thread), or Kajian Umum
 * (3 talking points + Q&A).
 *
 * Daleel is never invented — only the subset the user ticked is threaded
 * through. The LLM composes prose, dua text (in Arabic with harakat),
 * and format-specific structure around those daleel.
 */

import { z } from "zod";

import { generateJson, type LlmProvider } from "@/lib/llm";
import {
  renderPlatformSamplesBlock,
  renderPlatformStatsBlock,
  type PlatformSampleGroup,
  type PlatformStat,
} from "@/lib/draft-grounding";
import type {
  Brief,
  BriefContent,
  BriefDaleel,
  DeliverableContent,
  KajianFormat,
  KhutbahJumatContent,
  KultumContent,
  KajianUmumContent,
} from "@/db/schema";

export type GenerateDeliverableInput = {
  brief: Brief;
  format: KajianFormat;
  /** Audience segment chosen for THIS deliverable (overrides whatever
   *  was on the draft brief). Drafts are audience-neutral. */
  segment: string;
  /** Voice/tone chosen for THIS deliverable. */
  tone: string;
  /** Output locale chosen for THIS deliverable. */
  locale: "id" | "en";
  /** Target length in pages (1-4). */
  pages: number;
  /** Whether to personalize via the da'i's onboarding profile. */
  includeProfile: boolean;
  /** Subset of `brief.content.daleel` the user ticked in the form. */
  selectedDaleel: BriefDaleel[];
  /** Optional free-text context for this deliverable. */
  extraContext?: string | null;
};

export type GeneratedDeliverable = {
  title: string;
  content: DeliverableContent;
  provider: LlmProvider;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
};

/* ─── Shared sub-schemas ───────────────────────────────────────────── */

const DuaSchema = z.object({
  arabic: z.string().min(15),
  translation: z.string().min(15),
  source: z.string().optional(),
});

const StorySchema = z.string().min(40);
const ObjectionSchema = z.object({
  objection: z.string().min(15),
  response: z.string().min(40),
});

const DuaJson = {
  type: "object",
  properties: {
    arabic: {
      type: "string",
      description:
        "Aksara Arab DENGAN HARAKAT lengkap (fathah, kasrah, dhammah, sukūn, syaddah, mad). JANGAN gunakan transliterasi Latin.",
    },
    translation: {
      type: "string",
      description: "Terjemahan Bahasa Indonesia, satu kalimat.",
    },
    source: {
      type: "string",
      description:
        "Opsional — sebutkan sumber jika ini doa ma'tsur (mis. 'HR. Muslim 482').",
    },
  },
  required: ["arabic", "translation"],
};

const StoryJson = { type: "string" };
const ObjectionJson = {
  type: "object",
  properties: {
    objection: {
      type: "string",
      description:
        "Pertanyaan / sanggahan yang realistis dari audiens, ditulis dengan suara mereka (orang pertama, percakapan).",
    },
    response: {
      type: "string",
      description:
        "Jawaban penuh hikmah 2-3 kalimat: validasi dulu, lalu arahkan. Tautkan ke dalil dari pool jika relevan — JANGAN mengarang kutipan baru.",
    },
  },
  required: ["objection", "response"],
};

/* ─── Format-specific Zod schemas ──────────────────────────────────── */

const KhutbahJumatSchema = z.object({
  title: z.string().min(8).max(120),
  summary: z.string().min(40).max(800),
  dua_opening: DuaSchema,
  dua_closing: DuaSchema,
  khutbah_pertama: z.string().min(800),
  khutbah_kedua: z.string().min(300),
  story_illustrations: z.array(StorySchema).min(2).max(5),
  anticipated_objections: z.array(ObjectionSchema).min(2).max(4),
});

const KultumSchema = z.object({
  title: z.string().min(8).max(120),
  summary: z.string().min(40).max(800),
  dua_opening: DuaSchema,
  dua_closing: DuaSchema,
  body: z.string().min(3500),
  story_illustrations: z.array(StorySchema).min(2).max(4),
  anticipated_objections: z.array(ObjectionSchema).min(2).max(3),
});

const KajianUmumSchema = z.object({
  title: z.string().min(8).max(120),
  summary: z.string().min(40).max(800),
  dua_opening: DuaSchema,
  dua_closing: DuaSchema,
  talking_points: z
    .array(
      z.object({
        heading: z.string().min(5).max(120),
        body: z.string().min(1500),
      }),
    )
    .min(3)
    .max(3),
  qna: z
    .array(
      z.object({
        question: z.string().min(10),
        answer: z.string().min(40),
      }),
    )
    .min(3)
    .max(5),
  story_illustrations: z.array(StorySchema).min(2).max(4),
  anticipated_objections: z.array(ObjectionSchema).min(2).max(3),
});

/* ─── Format-specific JSON Schemas for the LLM ─────────────────────── */

const KhutbahJumatJson = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Judul khutbah, ringkas (5-12 kata), tanpa kata 'Khutbah' di depan.",
    },
    summary: {
      type: "string",
      description: "Ringkasan 1-2 kalimat (target ~60 kata / 400 karakter; hard cap 800 karakter) untuk kartu pustaka.",
    },
    dua_opening: DuaJson,
    dua_closing: DuaJson,
    khutbah_pertama: {
      type: "string",
      description:
        "Khutbah Pertama LENGKAP — siap dibacakan di mimbar. Struktur: (1) mukadimah (hamdalah + sholawat + syahadat + wasiat takwa, semua dalam Arab berharakat); (2) ayat pembuka (Arab berharakat + terjemahan); (3) inti khutbah 3-4 dalil dari pool dengan elaborasi audiens; (4) penutup khutbah pertama dengan formula \"بَارَكَ اللهُ لِيْ وَلَكُمْ…\" (Arab berharakat). Setiap ayat/hadits dari pool: kutip dalam Arab berharakat (kalau tersedia) + terjemahan ID + citation bold inline. JANGAN sebut nama outlet media; gunakan framing 'kabar yang sampai kepada kita…'. Bahasa Indonesia formal-mengalir, BUKAN akademis kaku. Markdown diperbolehkan (## untuk sub-bab).",
    },
    khutbah_kedua: {
      type: "string",
      description:
        "Khutbah Kedua: (1) mukadimah pendek (hamdalah + sholawat dalam Arab berharakat); (2) amplifikasi argumen utama dari khutbah pertama, 1-2 paragraf; (3) doa penutup panjang dalam Arab berharakat — wajib mencakup: doa untuk mukminin/mukminat, doa pertolongan, doa untuk mustadh'afin (sebut Palestina), doa untuk pemimpin Muslim, doa untuk diri+keluarga, penutup standar (إِنَّ اللهَ يَأْمُرُ بِالْعَدْلِ…). Semua dalam aksara Arab berharakat.",
    },
    story_illustrations: {
      type: "array",
      items: StoryJson,
      description:
        "2-5 anekdot konkret yang bisa diselipkan dalam khutbah — bukan sekadar 'misalnya kita yang sering…'; berikan situasi spesifik dengan detail yang bisa dibayangkan.",
    },
    anticipated_objections: {
      type: "array",
      items: ObjectionJson,
      description:
        "2-4 sanggahan yang mungkin muncul dari jamaah setelah khutbah — siapkan jawabannya sebelum naik mimbar.",
    },
  },
  required: [
    "title",
    "summary",
    "dua_opening",
    "dua_closing",
    "khutbah_pertama",
    "khutbah_kedua",
    "story_illustrations",
    "anticipated_objections",
  ],
};

const KultumJson = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Judul kultum, ringkas (5-12 kata).",
    },
    summary: {
      type: "string",
      description: "Ringkasan 1-2 kalimat (target ~60 kata / 400 karakter; hard cap 800 karakter) untuk kartu pustaka.",
    },
    dua_opening: DuaJson,
    dua_closing: DuaJson,
    body: {
      type: "string",
      description:
        "Body kultum (~7 menit, ~900-1100 kata). STRUKTUR WAJIB (urut, jangan dilompati):\\n" +
        "(1) **Hook konkret** — buka dengan SATU fenomena spesifik dari CONTOH POST atau RINGKASAN SITUASI draf, bukan generic 'akhir-akhir ini kita prihatin'. Kalau draf menyebut pola tertentu (mis. 'KDRT oleh suami', 'majikan terhadap PRT'), pakai pola itu sebagai pintu masuk — anonim, tidak menyebut nama.\\n" +
        "(2) **Anchor numerik** (SATU kalimat) — kalau STATISTIK PERCAKAPAN ada angka, sebut sekali untuk grounding urgensi: 'lebih dari [total] percakapan publik tentang isu ini pekan lalu, mayoritas [sentimen dominan]'. Cukup satu kalimat — bukan tabel.\\n" +
        "(3) **Dalil utama dari pool** (Arab berharakat + terjemah) — pilih yang paling LANGSUNG menyentuh fenomena modern di hook, bukan analogi historis yang harus diregangkan.\\n" +
        "(4) **Elaborasi audiens** — bridging dari dalil ke realitas hidup audiens yang dipilih (lihat label audiens di prompt). Voice + contoh harus sesuai segmen.\\n" +
        "(5) **1-2 dalil pendukung dari pool** (Arab berharakat + terjemah) — gunakan untuk memperdalam, bukan repetisi.\\n" +
        "(6) **Akui pelindung sosial** (1-2 kalimat) — kalau RINGKASAN/ANALISIS draf menyebut regulasi, lembaga, atau jalur hukum (UU TPKS, Komnas Perempuan, Permendikbud, dll.), SEBUTKAN sebagai resource pelindung agar jamaah tahu ada jalur formal — BUKAN sebagai advokasi kebijakan. Format: 'Selain itu, kita patut bersyukur ada [nama lembaga / UU] yang bisa kita rujuk kalau...'. SKIP kalau draf tidak menyebut.\\n" +
        "(7) **Call to action SATU langkah** — konkret, bisa dimulai pekan ini, sesuai segmen audiens.\\n" +
        "(8) **Penutup pendek + ajakan doa** — wassalam ada di dua_closing, jangan dobel.\\n" +
        "Bahasa: Indonesia ringan tapi khidmat. Markdown ## untuk sub-bagian opsional. JANGAN mengarang kasus / nama / lokasi.",
    },
    story_illustrations: {
      type: "array",
      items: StoryJson,
      description: "2-4 ilustrasi konkret yang bisa diselipkan.",
    },
    anticipated_objections: {
      type: "array",
      items: ObjectionJson,
      description: "2-3 sanggahan + jawaban.",
    },
  },
  required: [
    "title",
    "summary",
    "dua_opening",
    "dua_closing",
    "body",
    "story_illustrations",
    "anticipated_objections",
  ],
};

const KajianUmumJson = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Judul kajian, ringkas (5-12 kata).",
    },
    summary: {
      type: "string",
      description: "Ringkasan 1-2 kalimat (target ~60 kata / 400 karakter; hard cap 800 karakter) untuk kartu pustaka.",
    },
    dua_opening: DuaJson,
    dua_closing: DuaJson,
    talking_points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: {
            type: "string",
            description: "Judul talking point, ringkas (≤12 kata). Setiap heading harus menggambarkan satu sudut pandang berbeda — jangan paralel/tumpang-tindih.",
          },
          body: {
            type: "string",
            description:
              "3-5 paragraf elaborasi (~400-600 kata per talking point). STRUKTUR per talking point:\\n" +
              "(a) **Bukaan grounded** — kalau ada CONTOH POST / RINGKASAN SITUASI dari draf yang relevan dengan sudut pandang ini, kutip secara umum (anonim, jangan sebut nama orang/lokasi spesifik). Kalau tidak ada yang langsung relevan, mulai dari prinsip yang akan dibahas.\\n" +
              "(b) **Dalil utama dari pool** (Arab berharakat + terjemah, citation bold inline). Pilih yang LANGSUNG menyentuh sudut pandang ini — bukan analogi historis yang harus diregangkan.\\n" +
              "(c) **Tafsir / elaborasi audiens** — bridge dari dalil ke realitas hidup audiens (sesuai segment label di prompt). Voice harus pas (Gen Z: santai+vulnerable, ibu pengajian: hangat+pengalaman, professionals: ringkas+aplikatif, dst).\\n" +
              "(d) **Aplikasi konkret** — 2-3 langkah spesifik yang bisa dipraktikkan jamaah pekan ini berkaitan dengan sudut pandang ini. Bullet list OK.\\n" +
              "Markdown ## untuk sub-bagian opsional dalam body.",
          },
        },
        required: ["heading", "body"],
      },
      description:
        "PERSIS 3 talking point inti — bukan 2, bukan 4. Tiap point WAJIB tertaut ke setidaknya satu dalil dari pool yang diberikan, dan WAJIB membahas sudut pandang berbeda (jangan paralel). Suggested structure across 3 points:\\n" +
        "  TP1 — **Diagnosis & realitas saat ini**: pakai RINGKASAN SITUASI + ANALISIS ISU + STATISTIK PERCAKAPAN dari draf. Kalau STATISTIK ada angka, sebut SATU kalimat numerik di sini ('lebih dari [total] percakapan publik pekan lalu...').\\n" +
        "  TP2 — **Pandangan syariah**: dalil utama + tafsir + bagaimana Islam memandang inti masalah.\\n" +
        "  TP3 — **Aplikasi nyata untuk audiens**: ajakan praktis yang sesuai segment. Kalau ANALISIS ISU draf menyebut regulasi/lembaga (UU TPKS, Komnas Perempuan, Permendikbud, dll.) yang relevan untuk segment audiens, sebut sebagai resource pelindung — BUKAN advokasi kebijakan. Format: 'Selain ikhtiar pribadi, ada [nama lembaga/UU] yang bisa dirujuk kalau...'. Skip kalau draf tidak menyebut.\\n" +
        "Da'i boleh menukar urutan TP2/TP3 kalau lebih cocok dengan topik, tapi TP1 selalu pintu masuk (grounding ke realitas).",
    },
    qna: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Pertanyaan ditulis dengan suara JAMAAH (orang pertama, percakapan, vocab natural sesuai segment). Bukan pertanyaan akademis hasil parafrase.",
          },
          answer: {
            type: "string",
            description: "Jawaban 3-5 kalimat: (1) validasi kekhawatiran/keraguan dulu, (2) arahkan dengan hikmah, (3) kalau relevan tautkan ke dalil dari pool atau resource sosial yang sudah disebut di talking points. JANGAN mengarang dalil baru.",
          },
        },
        required: ["question", "answer"],
      },
      description:
        "3-5 pertanyaan + jawaban. Pertanyaan harus mencerminkan keraguan/kekhawatiran NYATA audiens, drawn from ANTICIPATED_OBJECTIONS atau dari nuansa CONTOH POST di prompt (mis. kalau banyak post negatif soal aparat, jamaah mungkin tanya 'kenapa pelaku sering lolos hukum?'). Variasikan tipe: 1 pertanyaan praktis-aplikatif, 1 pertanyaan keraguan teologis, 1 pertanyaan sosial-pressure, 1-2 pertanyaan lain sesuai topik.",
    },
    story_illustrations: {
      type: "array",
      items: StoryJson,
      description: "2-4 ilustrasi konkret untuk diselipkan dalam kajian.",
    },
    anticipated_objections: {
      type: "array",
      items: ObjectionJson,
      description: "2-3 sanggahan + jawaban (selain QnA — ini yang lebih ideologis).",
    },
  },
  required: [
    "title",
    "summary",
    "dua_opening",
    "dua_closing",
    "talking_points",
    "qna",
    "story_illustrations",
    "anticipated_objections",
  ],
};

/* ─── System prompt + helpers ──────────────────────────────────────── */

const SYSTEM_PROMPT = `Anda adalah asisten dakwah yang membantu seorang da'i menyusun deliverable yang siap dibawakan di mimbar.

KONTEKS PIPELINE (penting):
Anda akan menerima OUTPUT DRAF KAJIAN dari da'i (ringkasan situasi, analisis isu, statistik percakapan per platform, contoh post nyata dari ingestion sosial-media + berita). Draf itu sudah berisi research yang sudah diverifikasi datanya. TUGAS Anda adalah MENGUBAH research itu menjadi format yang siap dibawakan — bukan re-analisis ulang, bukan tambah klaim baru. Setiap klaim faktual / framing / contoh kasus / angka di output Anda harus turunan dari konteks draf. Kalau Anda merasa perlu menambah klaim yang tidak ada di draf, jangan — kembali ke yang ada.

PRINSIP:
1. Dalil yang Anda terima sudah diverifikasi dari pustaka kitab (Qur'an, Bukhari, Muslim, Riyad as-Salihin, Bulugh al-Maram, Tafsir Ibn Katsir). JANGAN mengarang dalil baru, JANGAN mengubah nomor ayat/hadits.
2. Output dalam Bahasa Indonesia kecuali untuk aksara Arab (yang harus berharakat lengkap).
3. Promosikan rahma dan hikmah. Hindari nada konfrontatif, divisif, atau sektarian.
4. Output Anda adalah deliverable AKHIR — siap dibacakan, bukan sketsa. Tulis dengan lengkap, bukan dengan placeholder.
5. JANGAN sebut nama outlet media (Detik, Republika, dll). Gunakan framing 'kabar yang sampai kepada kita pekan ini'.
6. JANGAN mengarang nama korban / pelaku / lokasi spesifik. Kalau draf menyebut kasus tertentu, boleh kutip secara umum ("kasus santriwati di Pekalongan" → "kasus santriwati di salah satu pesantren yang baru-baru ini diberitakan"). Kalau draf tidak menyebut kasus spesifik, JANGAN diisi rekaan.
7. Jangan tampilkan label internal sistem (segment id, tone enum) di output yang dibaca audiens.`;

const SEGMENT_LABELS_ID: Record<string, string> = {
  urban_gen_z: "Gen Z Perkotaan (18-24)",
  working_professionals: "Profesional Muda (25-40)",
  parents_families: "Orang Tua & Keluarga",
  ibu_pengajian: "Ibu-Ibu Pengajian",
  rural_communities: "Komunitas Pedesaan",
  students: "Pelajar & Mahasiswa",
};

const TONE_LABELS_ID: Record<string, string> = {
  scholarly: "Ilmiah — terukur, kaya rujukan, formal",
  casual: "Santai — mengalir, dekat, hangat",
  motivational: "Motivasional — menyemangati",
  empathetic: "Empatik — lembut, memahami",
  fiery: "Membara — tegas tapi tidak menyakiti",
  gentle: "Lembut — sabar, bertumpu pada rahma",
};

function renderDaleelBlock(daleel: BriefDaleel[]): string {
  return daleel
    .map((d, i) => {
      const linked = d.linked_ayah
        ? `\n    Ayat induk (tafsir): ${d.linked_ayah.arabic}\n    Terjemah: "${d.linked_ayah.translation}" — ${d.linked_ayah.source}`
        : "";
      const also =
        d.also_found_in && d.also_found_in.length > 0
          ? `\n    Juga terdapat di: ${d.also_found_in.map((a) => a.source).join(", ")}`
          : "";
      return `[${i + 1}] ${d.source}${also}${linked}\n    Arab: ${d.arabic}\n    Terjemah: "${d.translation}"`;
    })
    .join("\n\n");
}

/* ─── Public entrypoint ────────────────────────────────────────────── */

export async function generateDeliverable(
  input: GenerateDeliverableInput,
): Promise<GeneratedDeliverable> {
  const { brief, format, segment, tone, locale, pages, selectedDaleel, extraContext } = input;

  if (selectedDaleel.length === 0) {
    throw new Error("generateDeliverable: at least one daleel must be selected");
  }

  const segLabel = SEGMENT_LABELS_ID[segment] ?? segment;
  const toneLabel = TONE_LABELS_ID[tone] ?? tone;
  void locale; // ID-only deliverables in v1; locale stored for the catalog filter
  void pages; // pages scales maxTokens below if needed; placeholder for length scaling
  const daleelBlock = renderDaleelBlock(selectedDaleel);
  const trimmedExtra = extraContext?.trim() ?? "";

  // Lift the draft's research into the kajian prompt so the LLM
  // builds ON the analysis the brief already did, instead of
  // re-analysing from scratch with just topic + audience. Without
  // this the kajian forfeits the platform breakdown, the
  // problem-statement work, and the verified sample posts the draft
  // collected — and ends up with weaker grounding than the draft
  // itself.
  const briefContent = brief.content as BriefContent | null;
  const draftSummary = briefContent?.situation_summary?.trim() ?? "";
  const draftAnalysis = briefContent?.issue_analysis?.trim() ?? "";
  const draftStats: PlatformStat[] = Array.isArray(
    briefContent?.platform_stats,
  )
    ? (briefContent!.platform_stats as PlatformStat[])
    : [];
  const draftSamples: PlatformSampleGroup[] = Array.isArray(
    briefContent?.platform_samples,
  )
    ? (briefContent!.platform_samples as unknown as PlatformSampleGroup[])
    : [];
  const draftStatsBlock = renderPlatformStatsBlock(draftStats);
  const draftSamplesBlock = renderPlatformSamplesBlock(draftSamples);

  const formatDirective =
    format === "khutbah_jumat"
      ? "FORMAT: Khutbah Jumat (2-bagian, 12-15 menit total). Khutbah Pertama lebih panjang (isi argumen + dalil), Khutbah Kedua lebih pendek (amplifikasi + doa panjang). Wajib aksara Arab berharakat untuk: mukadimah, ayat/hadits yang dikutip, formula penutup khutbah pertama, dan doa penutup khutbah kedua."
      : format === "kultum"
        ? "FORMAT: Kultum (~7 menit, ~1000 kata). Single-thread, hook → satu dalil utama → elaborasi → 1-2 dalil pendukung → call to action 1 langkah → penutup. Aksara Arab berharakat untuk: ayat/hadits yang dikutip + dua pembuka/penutup."
        : "FORMAT: Kajian Umum (30-45 menit, format kelas). 3 talking point inti + Q&A. Aksara Arab berharakat untuk: ayat/hadits + dua pembuka/penutup.";

  const userPrompt = [
    `Topik: ${brief.topicTitle}`,
    `Audiens: ${segLabel}`,
    `Nada: ${toneLabel}`,
    "",
    formatDirective,
    "",
    // Draft-side research — the brief already did the analytical work
    // (situation summary + 4-paragraph analysis with platform breakdown
    // + sentiment stats + real sample posts). Pass it all here so the
    // kajian builds ON it instead of starting over.
    draftSummary
      ? `RINGKASAN SITUASI (dari draf — pakai sebagai latar awal kajian, bukan paraphrase ulang panjang lebar):\n${draftSummary}\n`
      : "",
    draftAnalysis
      ? `ANALISIS ISU (dari draf — pakai sebagai sumber argumen untuk inti kajian. Setiap klaim faktual / framing di kajian Anda HARUS turunan dari sini, BUKAN karangan baru. Boleh dipendekkan, tidak boleh ditambah-tambahi):\n${draftAnalysis}\n`
      : "",
    draftStatsBlock
      ? `STATISTIK PERCAKAPAN (snapshot draf — pakai untuk anchor numerik kalau menyebut tren/sentimen publik):\n${draftStatsBlock}\n`
      : "",
    draftSamplesBlock
      ? `CONTOH POST DARI DRAF (post nyata dari ingestion — pakai untuk MENGUTIP situasi spesifik. JANGAN sebut nama outlet; framing 'kabar yang sampai pekan ini' / 'banyak diperbincangkan di media sosial pekan ini'. JANGAN mengarang nama korban / pelaku / lokasi yang tidak ada di sini):\n${draftSamplesBlock}\n`
      : "",
    trimmedExtra
      ? `KONTEKS TAMBAHAN dari da'i untuk deliverable INI — prioritaskan ini di atas default:\n${trimmedExtra}\n`
      : "",
    "DALIL YANG DIPILIH DA'I (gunakan SEMUA dalil ini dalam deliverable — jangan abaikan satu pun; JANGAN tambahkan dalil baru di luar daftar ini):",
    daleelBlock,
    "",
    "Susun deliverable lengkap sesuai struktur JSON yang diminta. Output WAJIB siap pakai, bukan kerangka.",
  ]
    .filter(Boolean)
    .join("\n");

  const responseSchema =
    format === "khutbah_jumat"
      ? KhutbahJumatJson
      : format === "kultum"
        ? KultumJson
        : KajianUmumJson;

  // Khutbah Jumat needs the most output budget (full 2-khutbah document
  // + long Arabic dua). Kultum and Kajian umum are tighter.
  const maxTokens = format === "khutbah_jumat" ? 40_000 : 24_000;

  const { data, provider, model, tokensIn, tokensOut } =
    await generateJson<unknown>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      responseSchema,
      maxTokens,
      temperature: 0.6,
    });

  // Validate against the format-specific Zod schema.
  const parsed =
    format === "khutbah_jumat"
      ? KhutbahJumatSchema.safeParse(data)
      : format === "kultum"
        ? KultumSchema.safeParse(data)
        : KajianUmumSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Deliverable LLM response failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const validated = parsed.data;
  const baseContent = {
    summary: validated.summary,
    daleel: selectedDaleel,
    story_illustrations: validated.story_illustrations,
    anticipated_objections: validated.anticipated_objections,
    dua_opening: validated.dua_opening,
    dua_closing: validated.dua_closing,
  };

  let content: DeliverableContent;
  if (format === "khutbah_jumat") {
    const v = validated as z.infer<typeof KhutbahJumatSchema>;
    content = {
      ...baseContent,
      format: "khutbah_jumat",
      khutbah_pertama: v.khutbah_pertama,
      khutbah_kedua: v.khutbah_kedua,
    } satisfies KhutbahJumatContent;
  } else if (format === "kultum") {
    const v = validated as z.infer<typeof KultumSchema>;
    content = {
      ...baseContent,
      format: "kultum",
      body: v.body,
    } satisfies KultumContent;
  } else {
    const v = validated as z.infer<typeof KajianUmumSchema>;
    content = {
      ...baseContent,
      format: "kajian_umum",
      talking_points: v.talking_points,
      qna: v.qna,
    } satisfies KajianUmumContent;
  }

  return {
    title: validated.title,
    content,
    provider,
    model,
    tokensIn,
    tokensOut,
  };
}
