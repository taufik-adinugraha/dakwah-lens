/**
 * Brief generator — composes the prompt, calls the LLM via the fallback chain,
 * validates the response shape, and returns a `BriefContent`.
 *
 * The daleel list is fixed (retrieved from Qdrant beforehand) and threaded
 * through to the LLM as context — the LLM never invents daleel itself.
 */

import { z } from "zod";

import { generateJson, type LlmProvider } from "@/lib/llm";
import type { BriefContent, BriefDaleel } from "@/db/schema";

const SEGMENT_LABELS: Record<string, { en: string; id: string }> = {
  urban_gen_z: { en: "Urban Gen Z (ages 18-24)", id: "Gen Z Perkotaan (usia 18-24)" },
  working_professionals: {
    en: "Working Professionals (ages 25-40)",
    id: "Profesional Muda (usia 25-40)",
  },
  parents_families: { en: "Parents & Families", id: "Orang Tua & Keluarga" },
  rural_communities: { en: "Rural Communities", id: "Komunitas Pedesaan" },
  students: { en: "Students & Young Learners", id: "Pelajar & Mahasiswa" },
};

const TONE_LABELS: Record<string, { en: string; id: string }> = {
  scholarly: { en: "Scholarly — measured, citation-rich, formal", id: "Ilmiah — terukur, kaya rujukan, formal" },
  casual: { en: "Casual — conversational, relatable, warm", id: "Santai — mengalir, dekat, hangat" },
  motivational: { en: "Motivational — uplifting, action-oriented", id: "Motivasional — menyemangati, mengajak bertindak" },
  empathetic: { en: "Empathetic — gentle, validating, understanding", id: "Empatik — lembut, memahami, menenangkan" },
};

/* ─────────────────────────────────────────────────────────────
 * Zod schema for the LLM response (runtime validation)
 * ───────────────────────────────────────────────────────────── */

const BriefResponseSchema = z.object({
  situation_summary: z.string().min(20),
  issue_analysis: z.string().min(50),
  audience_segmentation: z.object({
    primary: z.string().min(2),
    perception: z.string().min(20),
    angle: z.string().min(20),
  }),
  recommendations: z.array(z.string().min(10)).min(3).max(6),
  content_templates: z.object({
    khutbah_outline: z.string().min(40),
    social_caption: z.string().min(20),
  }),
});

type BriefResponse = z.infer<typeof BriefResponseSchema>;

/* ─────────────────────────────────────────────────────────────
 * JSON Schema for the LLM provider (matches the Zod schema)
 * ───────────────────────────────────────────────────────────── */

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    situation_summary: {
      type: "string",
      description:
        "2-3 sentences describing the current public discourse on the topic among the target audience.",
    },
    issue_analysis: {
      type: "string",
      description:
        "1-2 paragraphs analyzing why this matters from a da'wah lens. Name the da'wah categories it intersects (akhlaq, muamalah, aqidah, tarbiyah, ibadah, sosial). Concrete, not generic.",
    },
    audience_segmentation: {
      type: "object",
      properties: {
        primary: {
          type: "string",
          description: "The target audience segment, written verbatim.",
        },
        perception: {
          type: "string",
          description: "1-2 sentences on how this audience views the issue.",
        },
        angle: {
          type: "string",
          description:
            "1-2 sentences on the recommended angle for messaging to this audience.",
        },
      },
      required: ["primary", "perception", "angle"],
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
      description:
        "3 to 5 practical, concrete, actionable bullet points for the da'i.",
    },
    content_templates: {
      type: "object",
      properties: {
        khutbah_outline: {
          type: "string",
          description:
            "5-line khutbah outline: 1) Opening 2) Context 3) Main daleel (cite from the retrieved daleel) 4) Application 5) Closing. Newlines between lines.",
        },
        social_caption: {
          type: "string",
          description:
            "1-2 sentence caption suitable for IG/TikTok/X. Hook + invitation.",
        },
      },
      required: ["khutbah_outline", "social_caption"],
    },
  },
  required: [
    "situation_summary",
    "issue_analysis",
    "audience_segmentation",
    "recommendations",
    "content_templates",
  ],
};

/* ─────────────────────────────────────────────────────────────
 * Prompt builders
 * ───────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a thoughtful Islamic da'wah advisor for Dakwah-Lens, helping a da'i (Islamic preacher) in Indonesia compose a brief for a specific topic and audience.

Hard rules:
- NEVER invent additional Qur'an verses, hadith, or scholarly citations. The user provides the retrieved daleel; do not fabricate references.
- NEVER claim authoritative fatwa. This is AI-assisted guidance for da'i to adapt with their own judgment.
- Promote rahma (mercy) and hikmah (wisdom). No confrontational, sectarian, or divisive framing.
- Match the requested tone exactly.
- Write everything in the requested output language.
- For Indonesian output: use formal-but-conversational language (avoid stiff jargon). Mix in common loanwords (brief, insights, dashboard) and Islamic terms (akhlaq, muamalah, tarbiyah, hikmah, etc.) naturally.
- Be specific to the topic and audience — avoid generic platitudes.
- Reference the retrieved daleel naturally in the khutbah outline and social caption.`;

export type GenerateBriefInput = {
  topic: string;
  segment: string;
  tone: string;
  locale: "en" | "id";
  daleel: BriefDaleel[];
  /** Optional onboarding profile for personalization. The brief LLM uses
   *  these to tailor examples to the da'i's audience, region, and focus. */
  profile?: import("@/db/schema").UserProfile | null;
  /** Optional free-text notes from the da'i for THIS brief — recent
   *  audience events, format constraints (Friday khutbah, IG reel),
   *  misconceptions to address, etc. */
  extraContext?: string | null;
};

export type GeneratedBrief = {
  content: BriefContent;
  provider: LlmProvider;
  model: string;
};

export async function generateBriefContent(
  input: GenerateBriefInput,
): Promise<GeneratedBrief> {
  const { topic, segment, tone, locale, daleel, profile, extraContext } = input;

  const segLabel = SEGMENT_LABELS[segment]?.[locale] ?? segment;
  const toneLabel = TONE_LABELS[tone]?.[locale] ?? tone;
  const localeLabel = locale === "id" ? "Bahasa Indonesia" : "English";

  const daleelBlock = daleel
    .map(
      (d, i) =>
        `[${i + 1}] ${d.source}\n    Arabic: ${d.arabic}\n    Translation (${locale}): "${d.translation}"`,
    )
    .join("\n\n");

  const profileBlock = renderProfileBlock(profile);
  const trimmedExtra = extraContext?.trim() ?? "";

  const userPrompt = [
    `Topic: ${topic}`,
    `Audience segment: ${segLabel}`,
    `Tone: ${toneLabel}`,
    `Output language: ${localeLabel}`,
    profileBlock
      ? `\nAbout the da'i (use to tailor examples + framing — do NOT mention them verbatim in the output):\n${profileBlock}`
      : "",
    trimmedExtra
      ? `\nAdditional context from the da'i for THIS brief — weight this heavily, it overrides defaults where they conflict:\n${trimmedExtra}`
      : "",
    "",
    "RETRIEVED DALEEL (chosen by semantic search; do not invent more):",
    daleelBlock,
    "",
    `Produce the structured brief JSON. Use the audience name "${segLabel}" verbatim in audience_segmentation.primary.`,
  ]
    .filter(Boolean)
    .join("\n");

  const { data, provider, model } = await generateJson<BriefResponse>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchema: RESPONSE_JSON_SCHEMA,
    maxTokens: 1800,
    temperature: 0.6,
  });

  // Validate the parsed JSON against our stricter Zod schema. If the LLM
  // returns something close but wrong (e.g. 2 recommendations instead of 3),
  // we surface a clear validation error rather than store a malformed brief.
  const parsed = BriefResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `LLM response failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const content: BriefContent = {
    ...parsed.data,
    daleel, // append the retrieved daleel — LLM never authors these
  };

  return { content, provider, model };
}

/* ─────────────────────────────────────────────────────────────
 * Profile → prompt block
 *
 * We collapse the JSONB profile into a short bulletted brief the LLM can
 * consume. Empty profiles return null so we omit the section entirely.
 *
 * The human-readable mappings live here (not in i18n) because the LLM
 * needs neutral English regardless of the user's UI locale.
 * ───────────────────────────────────────────────────────────── */

const PROFILE_LABELS: Record<string, Record<string, string>> = {
  honorific: {
    ust: "Ustadz (preferred panggilan)",
    ustadzah: "Ustadzah (preferred panggilan)",
    kh: "Kyai Haji (preferred panggilan)",
    hj: "Haji/Hajjah (preferred panggilan)",
    habib: "Habib (preferred panggilan)",
    buya: "Buya (preferred panggilan)",
    prof: "Professor (academic)",
    dr: "Doktor (academic)",
    drs: "Drs. (academic)",
    bapak: "Bapak (formal Mr.)",
    ibu: "Ibu (formal Mrs.)",
    none: "(no preferred panggilan)",
  },
  age_range: {
    "18-24": "18-24 (Gen Z)",
    "25-34": "25-34 (younger millennial)",
    "35-49": "35-49 (older millennial / Gen X)",
    "50plus": "50+",
  },
  location: {
    jabodetabek: "Jabodetabek (urban Jakarta metro)",
    jawa_barat: "West Java",
    jawa_tengah_diy: "Central Java / Yogyakarta",
    jawa_timur: "East Java",
    sumatera: "Sumatra",
    kalimantan: "Kalimantan (Borneo)",
    sulawesi: "Sulawesi",
    indonesia_timur: "Eastern Indonesia (Bali, NTB, NTT, Maluku, Papua)",
    overseas: "Indonesian diaspora abroad",
  },
  profession: {
    ustadz_fulltime: "Full-time ustadz / khatib",
    ustadz_parttime: "Part-time ustadz / khatib",
    content_creator: "Da'wah content creator (social media)",
    student_of_knowledge: "Student of Islamic knowledge",
    academic: "Academic / Islamic-studies lecturer",
    community_activist: "Community activist / mosque organizer",
  },
  audience: {
    urban_youth: "urban youth",
    young_families: "young families",
    professionals: "working professionals",
    santri_students: "santri / students",
    elders: "elders",
    online_followers: "online followers",
    local_mosque: "local mosque congregation",
  },
};

function renderProfileBlock(
  profile: import("@/db/schema").UserProfile | null | undefined,
): string {
  if (!profile) return "";
  const lines: string[] = [];

  const panggilan =
    profile.honorific_other ?? PROFILE_LABELS.honorific[profile.honorific ?? ""];
  if (panggilan && profile.honorific !== "none")
    lines.push(`- Preferred panggilan: ${panggilan}`);

  const age = profile.age_range_other ?? PROFILE_LABELS.age_range[profile.age_range ?? ""];
  if (age) lines.push(`- Age range: ${age}`);

  const loc = profile.location_other ?? PROFILE_LABELS.location[profile.location ?? ""];
  if (loc) lines.push(`- Region: ${loc}`);

  const prof = profile.profession_other ?? PROFILE_LABELS.profession[profile.profession ?? ""];
  if (prof) lines.push(`- Role: ${prof}`);

  const audLabels = (profile.audience ?? [])
    .map((a) => PROFILE_LABELS.audience[a])
    .filter(Boolean) as string[];
  if (profile.audience_other) audLabels.push(profile.audience_other);
  if (audLabels.length) {
    lines.push(`- Primary audience: ${audLabels.join(", ")}`);
  }

  if (profile.focus?.length) {
    lines.push(`- Da'wah focus areas: ${profile.focus.join(", ")}`);
  }

  return lines.join("\n");
}
