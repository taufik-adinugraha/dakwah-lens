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
import type {
  Brief,
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
  summary: z.string().min(40).max(280),
  dua_opening: DuaSchema,
  dua_closing: DuaSchema,
  khutbah_pertama: z.string().min(800),
  khutbah_kedua: z.string().min(300),
  story_illustrations: z.array(StorySchema).min(2).max(5),
  anticipated_objections: z.array(ObjectionSchema).min(2).max(4),
});

const KultumSchema = z.object({
  title: z.string().min(8).max(120),
  summary: z.string().min(40).max(280),
  dua_opening: DuaSchema,
  dua_closing: DuaSchema,
  body: z.string().min(600),
  story_illustrations: z.array(StorySchema).min(2).max(4),
  anticipated_objections: z.array(ObjectionSchema).min(2).max(3),
});

const KajianUmumSchema = z.object({
  title: z.string().min(8).max(120),
  summary: z.string().min(40).max(280),
  dua_opening: DuaSchema,
  dua_closing: DuaSchema,
  talking_points: z
    .array(
      z.object({
        heading: z.string().min(5).max(120),
        body: z.string().min(150),
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
      description: "Ringkasan 1-2 kalimat (≤200 kata) untuk kartu pustaka.",
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
      description: "Ringkasan 1-2 kalimat untuk kartu pustaka.",
    },
    dua_opening: DuaJson,
    dua_closing: DuaJson,
    body: {
      type: "string",
      description:
        "Body kultum (~7 menit, ~900-1100 kata). Struktur single-thread: hook → 1 dalil utama dari pool (Arab berharakat + terjemah) → elaborasi audiens → 1-2 dalil pendukung dari pool → call to action 1 langkah praktis untuk minggu ini → penutup. Bahasa Indonesia ringan tapi tetap khidmat. Markdown OK (## untuk sub-bagian).",
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
      description: "Ringkasan 1-2 kalimat untuk kartu pustaka.",
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
            description: "Judul talking point, ringkas (≤12 kata).",
          },
          body: {
            type: "string",
            description:
              "2-4 paragraf elaborasi: hubungkan ke dalil dari pool (Arab berharakat + terjemah), lalu aplikasi konkret untuk audiens. Markdown OK.",
          },
        },
        required: ["heading", "body"],
      },
      description:
        "Persis 3 talking point inti. Tiap point harus tertaut ke setidaknya satu dalil dari pool yang diberikan.",
    },
    qna: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
      },
      description:
        "3-5 pertanyaan yang kemungkinan ditanyakan jamaah, lengkap dengan jawaban 2-3 kalimat per pertanyaan.",
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

PRINSIP:
1. Dalil yang Anda terima sudah diverifikasi dari pustaka kitab (Qur'an, Bukhari, Muslim, Riyad as-Salihin, Bulugh al-Maram, Tafsir Ibn Katsir). JANGAN mengarang dalil baru, JANGAN mengubah nomor ayat/hadits.
2. Output dalam Bahasa Indonesia kecuali untuk aksara Arab (yang harus berharakat lengkap).
3. Promosikan rahma dan hikmah. Hindari nada konfrontatif, divisif, atau sektarian.
4. Output Anda adalah deliverable AKHIR — siap dibacakan, bukan sketsa. Tulis dengan lengkap, bukan dengan placeholder.
5. JANGAN sebut nama outlet media (Detik, Republika, dll). Gunakan framing 'kabar yang sampai kepada kita pekan ini'.
6. Jangan tampilkan label internal sistem (segment id, tone enum) di output yang dibaca audiens.`;

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
  void brief; // brief is kept on input for future personalization use
  void locale; // ID-only deliverables in v1; locale stored for the catalog filter
  void pages; // pages scales maxTokens below if needed; placeholder for length scaling
  const daleelBlock = renderDaleelBlock(selectedDaleel);
  const trimmedExtra = extraContext?.trim() ?? "";

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
    trimmedExtra
      ? `Konteks tambahan dari da'i untuk deliverable INI — prioritaskan ini di atas default:\n${trimmedExtra}\n`
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
