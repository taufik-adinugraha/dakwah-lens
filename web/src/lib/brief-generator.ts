/**
 * Brief generator — composes the prompt, calls the LLM via the fallback chain,
 * validates the response shape, and returns a `BriefContent`.
 *
 * The daleel list is fixed (retrieved from Qdrant beforehand) and threaded
 * through to the LLM as context — the LLM never invents daleel itself.
 */

import { z } from "zod";

import { generateJson, type LlmProvider } from "@/lib/llm";
import { formatCalendarContext } from "@/lib/islamic-calendar";
import {
  renderPlatformSamplesBlock,
  renderPlatformStatsBlock,
  type PlatformSampleGroup,
  type PlatformStat,
} from "@/lib/draft-grounding";
import type { BriefContent, BriefDaleel } from "@/db/schema";

const SEGMENT_LABELS: Record<string, { en: string; id: string }> = {
  urban_gen_z: { en: "Urban Gen Z (ages 18-24)", id: "Gen Z Perkotaan (usia 18-24)" },
  working_professionals: {
    en: "Working Professionals (ages 25-40)",
    id: "Profesional Muda (usia 25-40)",
  },
  parents_families: { en: "Parents & Families", id: "Orang Tua & Keluarga" },
  ibu_pengajian: {
    en: "Mothers' Study Circle (Ibu-Ibu Pengajian)",
    id: "Ibu-Ibu Pengajian",
  },
  rural_communities: { en: "Rural Communities", id: "Komunitas Pedesaan" },
  students: { en: "Students & Young Learners", id: "Pelajar & Mahasiswa" },
};

/* ─────────────────────────────────────────────────────────────
 * Audience profiles for prompt context (English-only — fed to LLM
 * as guidance, not user-facing). The brief should *feel written
 * for* this audience: vocabulary, sentence rhythm, emotional
 * pacing, examples, and structure all calibrated to the profile
 * below — not just labelled with the segment name.
 *
 * Keep these tight (4–6 bullets each). Too much detail makes the
 * LLM mechanically check boxes instead of internalising the voice.
 * ───────────────────────────────────────────────────────────── */

type SegmentProfile = {
  psychology: string;
  demographics: string;
  delivery: string;
  hooks: string;
  avoid: string;
  /** Sample contemporary anchors — kinds of concerns this audience is
   *  living through. Used to nudge illustrations + recommendations away
   *  from generic "modern life" without naming a specific year. The
   *  model is also told to freshen these with whatever IS in the news
   *  cycle / on social media at the time of generation — so items here
   *  will age, but the prompt won't force the model to use them
   *  verbatim. */
  current_context: string;
};

const SEGMENT_PROFILES: Record<string, SegmentProfile> = {
  urban_gen_z: {
    psychology:
      "Identity formation, existential 'what's the point' questions, mental-health awareness, comparison-driven anxiety from social media, paralysis from too many life options. Question authority but crave authenticity and vulnerability.",
    demographics:
      "Digital natives in Jakarta / Bandung / Surabaya, English-fluent, exposed to global content (K-pop, anime, US/UK media), studying or early career, often single, financial anxiety + peer pressure to project success.",
    delivery:
      "Short paragraphs, conversational rhythm. Acknowledge the struggle BEFORE prescribing. Story over lecture. Frame Islam as the answer that meets modern questions — not as a counter-narrative to modernity. Reference real platforms (IG, TikTok) and real feelings (burnout, FOMO).",
    hooks:
      "Mental health, purpose, hustle-culture critique, 'is this enough?', relationship anxiety, identity wobble, screen exhaustion.",
    avoid:
      "Moralistic finger-wagging, generic 'pray more' advice, dismissing their concerns as worldly distractions.",
    current_context:
      "ChatGPT / AI tools replacing study + early-career skill-building (skill anxiety, 'apa yang masih dibutuhin manusia'), 'self-reward' impulse culture + e-commerce flash sale guilt, healing / therapy / self-care vocabulary leaking into Islamic spirituality, dating-app fatigue + ghosting, K-pop / J-pop fan parasocial wounds, climate + future-pesimisme, layoffs in tech & startups making fresh grads anxious, BDS / pro-Palestina movement felt at the consumer-choice level.",
  },
  working_professionals: {
    psychology:
      "Career-family tension, time scarcity, ambition-vs-ibadah trade-offs, success-as-meaning trap, comparison with peers' lifestyles. Often financial provider for extended family — pressure cascades down.",
    demographics:
      "25-40, urban corporate workers (Jakarta / Surabaya / Medan), middle income, may have young children, attended secular university, LinkedIn-fluent, time-pressed, English-comfortable.",
    delivery:
      "Respect their time — be concise. Practical frameworks (3-step, actionable). Reference workplace situations directly. Frame wealth as stewardship not vice. Balance ambition with intentionality — don't ask them to abandon either.",
    hooks:
      "Rest as ibadah, intentional success, exhaustion, financial ethics, balancing work + family + faith, ambition with barakah.",
    avoid:
      "Anti-wealth framing, vague 'find balance' platitudes, ignoring the real pressures of providing for family.",
    current_context:
      "AI displacing white-collar / knowledge work (job-loss anxiety, retraining pressure), pinjol + paylater guilt and crypto / saham FOMO, KPR + property prices in Jabodetabek out of reach, the WFH↔RTO push-pull and commute stress, sandwich-generation guilt funding parents AND kids, 'quiet quitting' vs hustle-culture exhaustion, daycare / TPA tuition rising, side-hustle pressure (jualan online, jadi influencer), boycott discipline at corporate / consumer level.",
  },
  parents_families: {
    psychology:
      "Protecting children in a chaotic world, anxiety about kids' future, the generational gap from their own parents' Islam, decision fatigue. Want practical guidance for tonight, not abstract theology.",
    demographics:
      "30s-50s, suburban or semi-rural, mixed education levels, children in school, conservative-leaning, navigating school + TPA + pesantren choices, dealing with non-religious extended family, household-finance pressure.",
    delivery:
      "Give them tools they can use TONIGHT — specific phrases, du'a to recite, conversation openers with kids. Use Prophet ﷺ as father / family-member stories. Validate their concerns without alarmist framing.",
    hooks:
      "Screen time, school choices, raising kids who pray, sibling rivalry, marital communication, dealing with non-practicing relatives, inheritance.",
    avoid:
      "Theoretical fiqh without family-life application, comparing their kids to idealized santri, making them feel guilty for parenting struggles.",
    current_context:
      "TikTok / YouTube Shorts captured kids' attention spans, post-COVID online-learning fatigue + reading deficit, perundungan (bullying) news cycle making parents over-monitor, SIT (Sekolah Islam Terpadu) vs negeri vs pesantren choice agony, anak indigo / sensory parenting trends, mom-shaming on socmed, rising tuition + uang gedung, RUU KIA + maternal-leave discourse, ChatGPT for school assignments crisis ('anak nggak mau mikir lagi'), boycott decisions affecting kids' favourite snacks/toys.",
  },
  ibu_pengajian: {
    psychology:
      "Spiritual anchors of the household, looking for guidance that feeds both their own iman AND their role as mothers / wives / community members. Bond strongly through shared learning — pengajian is as much sisterhood as it is study. Want material they can immediately bring home to family and into community WhatsApp groups.",
    demographics:
      "Predominantly 35-60, ibu rumah tangga or working mothers in suburban / peri-urban Java (Bandung, Bekasi, Tangerang, Yogyakarta) plus other major regions. Regular weekly majelis taklim or RT-level pengajian. Mixed religious literacy — many have years of Qur'an reading + classical fiqh exposure, some are newer learners. Value teachers who balance kelembutan with depth.",
    delivery:
      "Warm, conversational, story-rich — they have time and prefer narrative to bullet-point efficiency. Use Prophetic-household examples (Khadijah, Aisha, Fatimah RA) and stories of sahabiyah liberally. Connect every theme back to family + neighbourhood + bersilaturahmi. Speak as 'kita' not 'anda', sister-to-sister. Sprinkle Indonesian Islamic idioms (insya Allah, masyaAllah, alhamdulillah, barakallah) naturally — it's how they actually talk. Doa hafalan + dzikir suggestions land especially well.",
    hooks:
      "Sabar in ujian rumah tangga, mendidik anak yang sholih/sholihah, suami sebagai kepala keluarga vs. partner, menjaga lisan + ghibah di grup WA, sedekah harian yang ringan, dzikir pagi-petang sebagai jangkar, silaturahmi yang sehat, menua dengan iman, harapan yang tidak putus.",
    avoid:
      "Lecturing tone, infantilising vocabulary ('begini ya bu...'), generic 'jadilah ibu yang baik' platitudes without specifics, harsh rebuke of household choices, pretending modern stresses (pinjol, KDRT, anak nakal) aren't real concerns. Don't speak ABOUT them as a third-person audience — speak WITH them.",
    current_context:
      "Anak susah lepas dari layar / TikTok / game online, pinjol / arisan online bermasalah merebak di komunitas ibu (banyak yang malu cerita ke keluarga), KDRT cases in the news triggering grup-WA discussions about how to support tetangga yang terindikasi, sandwich generation guilt (merawat orang tua + anak sekolah), suami kena PHK, biaya sekolah TK/SD/SMP terus naik, ghibah-shaming + cek-cek info hoaks di grup, viral ustazah / muballighah on IG affecting which manhaj reach the pengajian, persiapan menjelang Idul Adha (kurban patungan, masak bersama, distribusi daging), nisfu Sya'ban / Ramadhan-prep rituals.",
  },
  rural_communities: {
    psychology:
      "Strong community ties, traditional values, may feel distant from urban Islamic 'modernization', connection to land / agriculture / local mosque, less exposure to mainstream Islamic media — but rich in lived practice.",
    demographics:
      "Villages and small towns across Java, Sumatra, Sulawesi etc.; pesantren-tradition Islamic education; older average age, multi-generational households; agricultural or service economy; regional language influence (Javanese, Sundanese, Bugis).",
    delivery:
      "Lean on local idioms and Indonesian cultural touchstones (gotong royong, slametan, silaturahmi). Longer narrative structure — people have time. Frame Islam as communal practice. Use agricultural / village metaphors. Respect older traditions while gently redirecting where needed.",
    hooks:
      "Gotong royong, sabar in livelihood, intergenerational respect, sincerity vs. show (riya'), rural-urban family tensions, helping neighbors, dealing with hardship.",
    avoid:
      "Urban/Western references that won't land (LinkedIn, K-pop, hustle culture), dismissing local adat as backward, lecturing.",
    current_context:
      "Pinjol + judi online (slot online) crisis hitting villages and ibu rumah tangga (KDRT spike, suicides reported in news), climate shocks affecting harvest (El Niño, banjir, gagal panen), young people migrating to cities leaving desa lansia-heavy, BLT / PKH / Kartu Sembako benefits + recent program changes, post-pilkada / election friction in small communities, ojol / online-warung side income reaching rural areas, TikTok preachers (some dubious manhaj) reaching jamaah faster than the local kyai.",
  },
  students: {
    psychology:
      "Still forming worldview, exam anxiety, peer pressure, identity exploration, navigating mixed-gender interactions, mosque vs. secular-school identity tension, doubts they're afraid to voice.",
    demographics:
      "Middle school through early university (13-22), mixed religious literacy, time-constrained, tech-native, parental academic pressure, social-media-immersed, often hostel/boarding life.",
    delivery:
      "Clear and structured — they're learners. Age-appropriate examples. Scaffold from concrete to abstract. Make Islam practical for school life. Encourage their questions instead of shutting them down. Equip them with language to defend their faith without arrogance.",
    hooks:
      "Doubt and big questions, peer pressure, romantic feelings, exam stress, social-media comparison, 'boring Islamic education' vs. real curiosity, identity in mixed friend groups.",
    avoid:
      "Adult-aimed legalism, dismissing youthful doubt as weak iman, romance-shaming, complex fiqh without grounding in lived experience.",
    current_context:
      "ChatGPT / Gemini doing homework + the 'apa gunanya belajar' question, UTBK / SNBT stress + perceived gap-year stigma, 'study with me' livestream + study-influencer pressure, screenshot / fitnah culture on private Twitter / fess-account, body-image from beauty filters + 'glow-up' content, mixed-gender friendship + 'temenan aja' boundaries, sub-clique drama (K-pop fandom wars, gaming guilds), perundungan online + cyberbullying, anak SMA / mahasiswa exposed to pinjol via 'butuh uang cepat' ads.",
  },
};

const TONE_LABELS: Record<string, { en: string; id: string }> = {
  scholarly: { en: "Scholarly — measured, citation-rich, formal", id: "Ilmiah — terukur, kaya rujukan, formal" },
  casual: { en: "Casual — conversational, relatable, warm", id: "Santai — mengalir, dekat, hangat" },
  motivational: { en: "Motivational — uplifting, action-oriented", id: "Motivasional — menyemangati, mengajak bertindak" },
  empathetic: { en: "Empathetic — gentle, validating, understanding", id: "Empatik — lembut, memahami, menenangkan" },
  fiery: {
    en: "Fiery — passionate, urgent, prophetic-warning register; sharp imperatives without becoming hostile",
    id: "Membara — bergelora, mendesak, register peringatan kenabian; tajam dan tegas tanpa menyakiti",
  },
  gentle: {
    en: "Gentle — soft, patient, almost whispered counsel; never raises its voice, leans on tenderness and mercy",
    id: "Lembut — perlahan, sabar, hampir berbisik; tidak meninggikan nada, bertumpu pada kasih sayang dan rahma",
  },
};

/* ─────────────────────────────────────────────────────────────
 * Zod schema for the LLM response (runtime validation)
 * ───────────────────────────────────────────────────────────── */

// Draft schema (audience-neutral research scaffold). The audience-tailored
// fields — recommendations, anticipated_objections, story_illustrations,
// content_templates, audience_segmentation — moved to the deliverable
// generator (kajian/), where the da'i picks audience + tone + format and
// the LLM tailors the prose to that target. A draft only needs to set up
// the topic + analysis + the daleel pool the da'i will draw from.
const BriefResponseSchema = z.object({
  situation_summary: z.string().min(80),
  issue_analysis: z.string().min(400),
  // 2-3 sentence relevance note per retrieved daleel — keyed by the
  // 1-based daleel index the user prompt passes in. Stored alongside
  // each BriefDaleel server-side and rendered under the citation card.
  daleel_explanations: z
    .array(
      z.object({
        index: z.number().int().min(1),
        explanation: z.string().min(40),
      }),
    )
    .optional(),
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
        "2-4 sentences describing what's happening with this topic in Indonesian society right now — the cultural conversation, the lived reality, the typical framings. Audience-neutral; don't lean toward a specific demographic. This is the orientation paragraph a da'i reads first to understand the lay of the land.",
    },
    issue_analysis: {
      type: "string",
      description:
        "FOUR paragraphs, separated by blank lines (use \\n\\n between paragraphs). Each 4-6 sentences. STRUCTURE WAJIB — jangan campur urutan, jangan gabungkan ke satu paragraf besar:\\n\\n" +
        "PARAGRAF 1 — Bagaimana isu ini muncul di tiap platform, berdasarkan STATISTIK PERCAKAPAN + CONTOH POST PER PLATFORM yang diberikan di prompt (bukan tebakan umum). Tiap baris platform WAJIB: (a) sebut angka kuantitatif dari STATISTIK (mis. 'N=47, 32 negatif'), (b) rangkum karakter post nyata dari CONTOH POST, (c) sebut sentimen dominan berdasarkan distribusi di STATISTIK (positif/netral/negatif), (d) sebutkan audiens utama yang kemungkinan terdampak. Format yang diharapkan (markdown OK):\\n" +
        "- **TikTok (n=N, X negatif / Y netral / Z positif):** [karakter post dari sample] — audiens utama: [...].\\n" +
        "- **X (Twitter) (n=N, ...):** [...] — audiens utama: [...].\\n" +
        "- **Instagram (n=N, ...):** [...] — audiens utama: [...].\\n" +
        "- **YouTube (n=N, ...):** [...] — audiens utama: [...].\\n" +
        "- **Berita arus utama (RSS) (n=N, ...):** [...] — pembaca: [...].\\n" +
        "Kalau bucket platform kosong di STATISTIK (n=0), tulis 'tidak terlihat di ingestion pekan ini' untuk baris itu — JANGAN diisi dengan pola umum. Kalau seluruh STATISTIK kosong (catatan ada di prompt), ganti paragraf ini menjadi narasi 'pola umum percakapan publik' tanpa pecahan per platform.\\n\\n" +
        "PARAGRAF 2 — Problem statement: apa SEBENARNYA inti masalahnya. Lepas dari platform; bahas fenomena itu sendiri. Sebut akar penyebab, konteks sosial-ekonomi Indonesia, dan apa yang dipertaruhkan kalau dibiarkan. Tidak perlu mengutip dalil di paragraf ini — ini bagian diagnosis.\\n\\n" +
        "PARAGRAF 3 — Tinjauan syariah + dalil. Bagaimana Islam memandang isu ini. KUTIP minimal 2 dari dalil yang diberikan di RETRIEVED DALEEL — pakai citation string inline (mis. 'QS. Al-Baqarah: 195', 'Sahih al-Bukhari 6018'). Jelaskan kenapa dalil tersebut relevan dengan inti masalah di Paragraf 2. JANGAN mengarang dalil baru. Sebutkan juga kategori da'wah yang bersinggungan (akhlaq, muamalah, aqidah, tarbiyah, ibadah, sosial).\\n\\n" +
        "PARAGRAF 4 — Implementasi nyata. Langkah konkret yang bisa diambil — di tingkat individu, keluarga, komunitas masjid, dan organisasi/lembaga. Aksi spesifik, bisa dilakukan minggu ini, bukan saran abstrak. Boleh berupa bullet list.\\n\\n" +
        "Penting: ini AUDIENCE-NEUTRAL — paragraf 1 menyebut audiens per platform, tapi keseluruhan analisis tidak boleh memilih SATU audiens target. Da'i akan memilih target audience saat membuat kajian dari draf ini.",
    },
    daleel_explanations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description:
              "1-based index of the daleel in the RETRIEVED DALEEL block provided in the user prompt. Must match a daleel that was actually given to you — do NOT invent indices beyond what was provided.",
          },
          explanation: {
            type: "string",
            description:
              "2-3 sentence relevance note in the requested output language explaining WHY this specific daleel matters for THIS topic. Tie the meaning to a concrete Indonesian situation, not a generic restatement of the translation. Mention what the daleel adds to the argument the brief is building — what would be missing without it. Audience-neutral; don't tailor to a single demographic. Do NOT re-quote the Arabic or repeat the translation verbatim; the UI renders those separately. Do NOT invent additional citations.",
          },
        },
        required: ["index", "explanation"],
      },
      description:
        "ONE explanation entry per retrieved daleel. Index matches the 1-based number from the RETRIEVED DALEEL block. Aim to explain EVERY daleel that was provided; skip an index only if it truly doesn't fit the topic. Order doesn't matter — index is the key.",
    },
  },
  required: ["situation_summary", "issue_analysis"],
};

/* ─────────────────────────────────────────────────────────────
 * Prompt builders
 * ───────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a thoughtful Islamic da'wah research assistant for Dakwah-Lens, helping a da'i (Islamic preacher) in Indonesia produce a DRAFT KAJIAN — a research scaffold the da'i will later turn into a finished kajian (khutbah Jumat, kultum, or kajian umum) for a specific audience.

What a draft kajian is:
- An AUDIENCE-NEUTRAL analytical brief. It does NOT pick a target demographic, format, or tone. Those decisions happen later, when the da'i opens the draft and generates a specific deliverable from it.
- It contains three things: a situation summary (what's happening), an issue analysis (the depth pass), and per-daleel relevance notes (why each retrieved verse / hadith / tafsir matters for this topic).
- Treat this like a journalist's reporting notebook before they decide which outlet to write for — the facts, the framing options, the source quotes — not a finished article.

Hard rules:
- NEVER invent additional Qur'an verses, hadith, or scholarly citations. The user provides the retrieved daleel; do not fabricate references.
- NEVER claim authoritative fatwa. This is AI-assisted research the da'i adapts with their own judgment.
- Promote rahma (mercy) and hikmah (wisdom). No confrontational, sectarian, or divisive framing.
- Stay AUDIENCE-NEUTRAL. The draft is for the da'i to read and decide downstream — don't write as if speaking TO a specific demographic. No "kamu" / "Anda" addressing the audience; no Gen Z slang; no professional jargon targeting white-collar workers. Write like a scholar briefing another scholar: analytical, third-person, even-handed across demographics.
- When the analysis spans different Indonesian Muslim audiences, name them by demographic noun ("urban Gen Z", "professional muda", "ibu-ibu pengajian", "santri", "komunitas pedesaan") — don't pick one and lean in.
- Be specific to the topic — generic platitudes are useless to a da'i preparing real material.
- Quote retrieved daleel inline in the issue_analysis with their citation string — make the connection explicit.

Output language:
- Every field in the response JSON — situation_summary, issue_analysis, daleel_explanations — must be written in the requested output language.
- The retrieved daleel block may include translations in a different language than the requested output (some kitab sources only have English translations available). When quoting a daleel inside the brief, render the quoted passage in the requested output language — translate accurately from the provided text while preserving the meaning. Keep the Arabic verbatim and keep the citation string (kitab name + verse/hadith number) unchanged.
- The user-facing topic input may also arrive in a different language than the requested output. Use it as semantic context; produce all output in the requested language.

Style for Indonesian output (IMPORTANT — default to casual, conversational Bahasa Indonesia):
- Write the way Indonesians actually talk — like a thoughtful older sibling explaining something at a warung, not a textbook or government circular. The brief should feel like advice from a trusted person, not a press release.
- Favor short, direct sentences. Indonesian academic writing piles up clauses with "yang", "di mana", "yang mana", "sehingga", "dengan demikian" — strip those out. One idea per sentence wherever possible.
- Use everyday verbs over formal-academic ones (e.g. "menghadapi" over "mengalami situasi yang berhubungan dengan", "merasa" over "mengalami perasaan", "ngerti" or "paham" over "memahami secara komprehensif"). Mild Jakartan softeners like "kok", "sih", "ya" are fine in moderation when they make a sentence feel more human.
- Slang / "bahasa Gen Z" register: only use when the audience explicitly invites it — urban_gen_z and students segments in Indonesian. Light Gen Z markers like "relate", "vibes", "kepo", "FOMO", "self-reward", "healing", mild English code-switching, "yaudahlah", "santuy" are appropriate there because that IS how that audience talks. For other audiences (working_professionals, parents_families, rural_communities), keep the casual register but stay neutral — no Gen Z slang.
- Use "kita" (inclusive we) when building rapport with the reader, "kami" only when speaking on behalf of Dakwah-Lens as an org.
- Avoid passive bureaucratic constructions ("dilakukan", "dilaksanakan", "diharapkan"). Prefer active voice in the second person ("kamu", "Anda" — match audience formality: students/Gen Z get "kamu", professionals/elders get "Anda").
- Keep paragraphs short — 3–5 sentences max. Long paragraphs in Indonesian feel preachy.
- This casual register holds REGARDLESS of the selected tone. "Scholarly" in Indonesian doesn't mean stiff — it means measured and well-cited, but still readable like a real person wrote it. "Casual" means warm and close. "Motivational" means urgent and present-tense. "Empathetic" means gentle and validating. None of them mean formal-academic Bahasa.
- Mix common loanwords (brief, insights, dashboard) and Islamic terms (akhlaq, muamalah, tarbiyah, hikmah, etc.) naturally — don't over-translate technical terms into Bahasa just to look pure.
- Keep proper Arabic transliterations of names and concepts (ﷺ, in shaa Allah, etc.) verbatim.`;

export type GenerateBriefInput = {
  topic: string;
  segment: string;
  tone: string;
  locale: "en" | "id";
  /** Output format. `kajian_umum` = the historical default (general
   *  da'wah brief). `khutbah_jumat` = produce a formal Friday-khutbah
   *  document mirroring the weekly briefing's Khutbah Jumat sub-section
   *  rules (Khutbah Pertama + Kedua, Arabic with harakat, traditional
   *  opening/closing). */
  format?: "kajian_umum" | "khutbah_jumat";
  daleel: BriefDaleel[];
  /** Optional onboarding profile for personalization. The brief LLM uses
   *  these to tailor examples to the da'i's audience, region, and focus.
   *  Pass `null` to skip personalization for this brief. */
  profile?: import("@/db/schema").UserProfile | null;
  /** Optional free-text notes from the da'i for THIS brief — recent
   *  audience events, format constraints (Friday khutbah, IG reel),
   *  misconceptions to address, etc. */
  extraContext?: string | null;
  /** Target length in pages (1-4). Scales maxOutputTokens and gives the
   *  LLM a target word count. Default 2. */
  pages?: number;
  /** Optional. When the user picked a currently-trending topic from the
   *  brief form dropdown, this carries that topic's actual keywords +
   *  5 sample headlines. The prompt threads them as "this week's
   *  anchor coverage" so the brief grounds its examples in real
   *  conversation rather than fabricated illustrations. */
  currentTopic?: {
    id: string;
    label: string;
    keywords: string[];
    sampleHeadlines: string[];
  } | null;
  /** Real per-platform sample posts matching the topic, fetched from
   *  `social_posts` by the action layer. Threaded into the prompt so
   *  paragraph 1 (platform breakdown) cites actual conversations
   *  rather than the LLM's training-data stereotypes. Empty array =
   *  the prompt falls back to a "pola umum" (general patterns)
   *  framing without inventing per-platform specifics. */
  platformSamples?: PlatformSampleGroup[];
  /** Per-platform sentiment counts for the topic (same window as
   *  platformSamples). Lets the LLM cite specific numbers like
   *  "32 of 47 posts on TikTok carry negative sentiment" instead
   *  of inferring tone from just the 3 sample posts. Empty array
   *  or all-zero entries = stats block omitted from the prompt. */
  platformStats?: PlatformStat[];
};

export type GeneratedBrief = {
  content: BriefContent;
  provider: LlmProvider;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
};

export async function generateBriefContent(
  input: GenerateBriefInput,
): Promise<GeneratedBrief> {
  const {
    topic,
    segment,
    tone,
    locale,
    format = "kajian_umum",
    daleel,
    profile,
    extraContext,
    pages = 2,
    currentTopic,
    platformSamples = [],
    platformStats = [],
  } = input;

  const segLabel = SEGMENT_LABELS[segment]?.[locale] ?? segment;
  const toneLabel = TONE_LABELS[tone]?.[locale] ?? tone;
  const localeLabel = locale === "id" ? "Bahasa Indonesia" : "English";
  const audienceBlock = renderAudienceProfile(segment);

  const daleelBlock = daleel
    .map((d, i) => {
      // Tafsir hits carry an anchor ayah (the Qur'an verse Ibn Kathir is
      // commenting on). Render it first so the LLM treats commentary and
      // source verse as one unit, not two disconnected citations.
      const linked = d.linked_ayah
        ? `\n    Anchor ayah: ${d.linked_ayah.arabic}\n    Anchor translation (${locale}): "${d.linked_ayah.translation}" — ${d.linked_ayah.source}`
        : "";
      // Cross-corpus duplicates collapsed into one entry. The "also" line
      // is a credibility signal (muttafaq alayh = "agreed upon" — the
      // strongest hadith authentication tier) — the LLM should mention
      // it where natural rather than just ignore it.
      const also =
        d.also_found_in && d.also_found_in.length > 0
          ? `\n    Also found in: ${d.also_found_in.map((a) => a.source).join(", ")}`
          : "";
      return `[${i + 1}] ${d.source}${also}${linked}\n    Arabic: ${d.arabic}\n    Translation (${locale}): "${d.translation}"`;
    })
    .join("\n\n");

  const profileBlock = renderProfileBlock(profile);
  const trimmedExtra = extraContext?.trim() ?? "";

  // When the user anchored this brief to a currently-trending topic
  // (dropdown on the brief form), render it as a "this week's anchor
  // coverage" block. Tells the LLM: ground your contemporary examples
  // in THESE concrete headlines + keywords, not in generic invented
  // events. Without it, the LLM hallucinates plausible-sounding stories
  // that won't match what readers actually saw this week.
  const currentTopicBlock =
    currentTopic && currentTopic.sampleHeadlines.length > 0
      ? [
          "",
          `This week's anchor coverage (USER PICKED — ground your contemporary examples in this conversation, not in invented stories):`,
          `- Topic label: "${currentTopic.label}"`,
          currentTopic.keywords.length > 0
            ? `- Keywords trending in this topic: ${currentTopic.keywords.join(", ")}`
            : "",
          `- Sample headlines from this week's actual posts under this topic (use 2-3 as concrete illustrations; do NOT name outlets — use framings like "from this week's news we hear…"):`,
          ...currentTopic.sampleHeadlines.map((h, i) => `  ${i + 1}. ${h}`),
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  // Real per-platform posts pulled from social_posts for this topic.
  // Threaded as a CONTOH-POSTS block so paragraph 1 of issue_analysis
  // (the platform breakdown) anchors to actual conversations the
  // ingestion pipeline captured, not the LLM's training-data
  // stereotypes of each platform. Includes the ingestion classifier's
  // sentiment label per sample so the LLM can describe the EMOTIONAL
  // texture per platform (positive / negative / concerned) accurately.
  const platformSamplesBlock = renderPlatformSamplesBlock(platformSamples);
  const hasPlatformSamples = platformSamplesBlock.length > 0;
  const platformSamplesPromptBlock = hasPlatformSamples
    ? [
        "",
        "CONTOH POST PER PLATFORM — fetched from social_posts for THIS topic (last 14 days). Use these as the ONLY source for paragraf 1 (breakdown per platform). Anchor each platform-line to the actual texts + sentiment below; do NOT invent platform-specific patterns the samples don't support. When a platform's bucket is empty, say honestly 'tidak terlihat dalam ingestion pekan ini' — jangan diisi tebakan.",
        platformSamplesBlock,
      ].join("\n")
    : "";

  // Per-platform sentiment totals — lets paragraf 1 cite specific
  // numbers ("47 post di TikTok, 32 negatif") instead of inferring
  // tone from just the 3 sample texts.
  const platformStatsBlock = renderPlatformStatsBlock(platformStats);
  const hasPlatformStats = platformStatsBlock.length > 0;
  const platformStatsPromptBlock = hasPlatformStats
    ? [
        "",
        "STATISTIK PERCAKAPAN — agregat total post + breakdown sentimen per platform untuk topik ini (14 hari terakhir). Pakai angka-angka di tabel ini untuk MEMBERI BOBOT KUANTITATIF pada paragraf 1: tulis 'X dari Y post' atau 'mayoritas negatif (N/M)' atau 'dominan netral' — anchor ke ANGKA NYATA, bukan kira-kira. Kalau total < 5 untuk satu platform, sebut 'sedikit (n=N)' tapi jangan lebay.",
        platformStatsBlock,
      ].join("\n")
    : "";

  // Hijri calendar context — surfaces today's Hijri date + curated
  // events in the next 7-10 days so the brief's sunnah / du'a
  // recommendations are TIMELY rather than generic. Mirrors what the
  // weekly Insights pipeline does on the Python side.
  const { promptBlock: calendarBlock } = formatCalendarContext(
    new Date(),
    10,
  );

  // Draft JSON is small + audience-neutral — no khutbah outline, no
  // recommendations bullets, no objections list. Issue analysis is the
  // only long-form field. Sizing keeps reasoning-token headroom for
  // gemini-2.5-pro (internal "thinking" tokens count against
  // maxOutputTokens — 2-5k typical for a structured JSON of this
  // size). 24k cap is comfortable; we historically observed truncation
  // at <12k. Pages param is retained for API compat but has no effect
  // on a draft — audience-tailored length scaling happens in the
  // deliverable generator instead.
  void segLabel;
  void toneLabel;
  void audienceBlock;
  void pages;
  const maxTokens = 24_000;

  const userPrompt = [
    calendarBlock,
    "",
    `Topic: ${topic}`,
    `Output language: ${localeLabel}`,
    "",
    "Produce an AUDIENCE-NEUTRAL draft kajian — a research scaffold the da'i will later turn into a finished kajian (Khutbah Jumat / Kultum / Kajian Umum). Don't pick a target demographic. Don't write recommendations, objections, or a khutbah outline — those happen at deliverable time.",
    profileBlock
      ? `\nAbout the da'i (background context only — do NOT mention verbatim, do NOT tailor the draft to this single person; the draft is for them to use across many audiences):\n${profileBlock}`
      : "",
    trimmedExtra
      ? `\nAdditional context from the da'i for THIS draft — weight this heavily:\n${trimmedExtra}`
      : "",
    currentTopicBlock,
    platformStatsPromptBlock,
    platformSamplesPromptBlock,
    hasPlatformSamples
      ? ""
      : "\nCATATAN: tidak ada CONTOH POST per platform yang berhasil ditarik dari ingestion untuk topik ini (kemungkinan ingestion belum mencatat post yang cocok dengan kata kunci). Untuk paragraf 1, JANGAN mengarang detail per platform. Tulis paragraf 1 sebagai 'pola umum percakapan di ruang publik Indonesia' tanpa menyebut platform-platform spesifik.",
    "",
    "RETRIEVED DALEEL (chosen by semantic search; do not invent more):",
    daleelBlock,
    "",
    `IMPORTANT: For EACH daleel above (1..${daleel.length}), produce one entry in \`daleel_explanations\` with the matching 1-based index and a 2-3 sentence relevance note in ${localeLabel}. The note must explain WHY this specific daleel matters for THIS topic — tied to a concrete Indonesian situation, audience-neutral. The UI renders the Arabic + translation + source separately; your job is the explanation that connects them to the argument the draft is building.`,
    "",
    "Produce the structured draft JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  const { data, provider, model, tokensIn, tokensOut } = await generateJson<BriefResponse>({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchema: RESPONSE_JSON_SCHEMA,
    maxTokens,
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

  // Merge the LLM's per-daleel explanations onto the retrieved daleel
  // objects. The LLM keys by 1-based index matching how the daleel are
  // numbered in the user prompt's "RETRIEVED DALEEL" block; we
  // translate that to the array offset here. Missing or extra indices
  // are tolerated — a daleel without an explanation just renders the
  // raw text (same as pre-2026-05-29 behaviour).
  const explanationByIdx = new Map<number, string>();
  for (const e of parsed.data.daleel_explanations ?? []) {
    if (e.index >= 1 && e.index <= daleel.length) {
      explanationByIdx.set(e.index - 1, e.explanation);
    }
  }
  const enrichedDaleel = daleel.map((d, i) => {
    const explanation = explanationByIdx.get(i);
    return explanation ? { ...d, explanation } : d;
  });

  // Strip the auxiliary explanations field — it's already been folded
  // into the daleel objects, no need to persist it separately.
  const { daleel_explanations: _ignore, ...rest } = parsed.data;
  void _ignore;
  const content: BriefContent = {
    ...rest,
    daleel: enrichedDaleel,
  };

  return { content, provider, model, tokensIn, tokensOut };
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

function renderAudienceProfile(segment: string): string {
  const p = SEGMENT_PROFILES[segment];
  if (!p) return "";
  return [
    `- Psychology: ${p.psychology}`,
    `- Demographics: ${p.demographics}`,
    `- Delivery style: ${p.delivery}`,
    `- Hooks that land: ${p.hooks}`,
    `- Avoid: ${p.avoid}`,
    `- Sample contemporary anchors (use as a starter — substitute with whatever is actually in the news / on socmed right now): ${p.current_context}`,
  ].join("\n");
}

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
