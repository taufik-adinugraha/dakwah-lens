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

const BriefResponseSchema = z.object({
  situation_summary: z.string().min(80),
  issue_analysis: z.string().min(400),
  audience_segmentation: z.object({
    primary: z.string().min(2),
    perception: z.string().min(40),
    angle: z.string().min(40),
  }),
  recommendations: z.array(z.string().min(20)).min(8).max(12),
  anticipated_objections: z
    .array(
      z.object({
        objection: z.string().min(15),
        response: z.string().min(40),
      }),
    )
    .min(4)
    .max(5),
  story_illustrations: z.array(z.string().min(40)).min(4).max(6),
  content_templates: z.object({
    khutbah_outline: z.string().min(300),
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
        "5-7 paragraphs of real depth, FILTERED THROUGH the audience profile. Cover (in this order): (1) what this issue actually looks like in their daily reality — concrete, situated, specific to their life stage; (2) the underlying drivers / root causes — what makes this hard right now; (3) the cultural / economic / generational context unique to Indonesian Muslims facing this issue; (4) why this matters from a da'wah lens — name the da'wah categories it intersects (akhlaq, muamalah, aqidah, tarbiyah, ibadah, sosial) and connect explicitly to the retrieved Qur'an verses, hadith, and tafsir passages; (5) what's at stake if it goes unaddressed — for them, their families, the ummah; (6) where common framings of this issue go wrong (secular, materialist, or sectarian framings) and what the Islamic framing adds. Concrete, never generic. Each paragraph 4-6 sentences.",
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
          description:
            "1-2 sentences on how this audience PSYCHOLOGICALLY frames the issue — fears, motivations, internal narrative — not how outsiders see them. Draw on the audience profile.",
        },
        angle: {
          type: "string",
          description:
            "1-2 sentences on the recommended messaging angle. Include the emotional pacing (e.g. acknowledge first, then redirect) and what to lead with, based on the audience's delivery preferences.",
        },
      },
      required: ["primary", "perception", "angle"],
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
      description:
        "8 to 12 practical, audience-calibrated bullet points. Each should be something THIS audience can actually do this week — using their tools, fitting their constraints, in language they speak. Cover the FULL range — include at least: 2 mindset shifts, 2 concrete daily habits, 2 social/relational actions, 1 du'a or dhikr practice tied to the topic, 1 specific Qur'an/hadith passage to memorize from the retrieved daleel, 1 self-reflection prompt. Each item should be 2-3 sentences, specific enough that someone can act on it without further interpretation. Avoid generic 'make more du'a' platitudes.",
    },
    anticipated_objections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          objection: {
            type: "string",
            description:
              "A realistic concern, pushback, or 'but what about...' question that this specific audience would actually raise on this topic. Phrase it in their voice — first person, conversational, in their natural vocabulary.",
          },
          response: {
            type: "string",
            description:
              "A compassionate, hikmah-grounded 2-3 sentence reply that validates the concern's legitimacy before redirecting. Where natural, tie back to the retrieved daleel — do not invent new citations.",
          },
        },
        required: ["objection", "response"],
      },
      description:
        "4 to 5 anticipated objections + responses. These let the da'i prepare for real audience pushback before they're in front of the room. Drawn from the audience profile's psychology + 'avoid' list. Cover a range — at least one practical concern ('I don't have time'), one ideological pushback ('this is outdated' / 'this isn't relevant in modern life'), one social-pressure objection ('what will people think'), one theological doubt ('but doesn't Islam also say X?'). Responses 3-4 sentences each.",
    },
    story_illustrations: {
      type: "array",
      items: { type: "string" },
      description:
        "4 to 6 short narrative hooks the da'i can drop into delivery to ground the abstract in the concrete. Each is 3-4 sentences. Mix sources: (a) at least 2 scenes from the Prophet ﷺ's life or the lives of the Sahabah, drawn from the retrieved daleel where possible; (b) at least 2 contemporary scenarios from THIS audience's world (their workplace, dorm, family room, sawah) — fictional but plausible; (c) optionally a parable or analogy from classical scholarship. Each must clearly illustrate one point from the issue analysis.",
    },
    content_templates: {
      type: "object",
      properties: {
        khutbah_outline: {
          type: "string",
          description:
            "Full khutbah skeleton in 10 sections, with rich talking points underneath each — total 25-35 lines. Tailored to the audience's attention rhythm and reference points. Use newlines to separate. Sections (use these headings verbatim, in this order):\\n  1) Opening hamd + salawat (2 lines — convention but should feel sincere, not rote)\\n  2) Opening hook (a real moment / feeling from THIS audience's life — 2-3 lines)\\n  3) Context (what the audience is grappling with right now — 3-4 lines)\\n  4) Main Qur'anic daleel (cite ONE from the retrieved Qur'an hits with the source string, then 2-3 lines of substantive reflection — not just a transition)\\n  5) Supporting hadith (cite ONE from the retrieved hadith hits with the source string, then 2-3 lines tying it to the Qur'anic theme)\\n  6) Classical commentary (cite ONE from the retrieved tafsir hits with the source string, then 2 lines on what the scholarly tradition adds)\\n  7) Practical application (3-4 specific, situated actions they can take this week — bulleted; concrete enough that someone can act on them tonight)\\n  8) Anticipating pushback (acknowledge 1-2 of the anticipated_objections briefly, with the compassionate response — 2-3 lines)\\n  9) Call to action + community framing (2-3 lines on how this lands in the listener's family / mosque / workplace)\\n  10) Closing du'a + call to mercy (2-3 lines, end on rahma + hikmah, not fear).",
        },
        social_caption: {
          type: "string",
          description:
            "1-2 sentence caption suitable for the platforms this audience actually uses. Match their voice — Gen Z gets a different cadence than rural elders. Hook + invitation.",
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
    "anticipated_objections",
    "story_illustrations",
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
- Be specific to the topic and audience — avoid generic platitudes.
- Reference the retrieved daleel naturally in the khutbah outline and social caption.

Audience-tailored delivery (most important rule):
The brief is NOT generic da'wah content with an audience name slapped on top. It must FEEL written for this specific audience — their vocabulary, their reference points, their internal worries, the way they actually talk and listen. The user prompt includes an "Audience profile" block: internalise it before you write a single line. Specifically:
- Vocabulary + sentence rhythm match the audience's natural speech (Gen Z: short, conversational, vulnerable; professionals: concise + actionable; rural: longer narrative, local idioms; students: scaffolded + structured).
- Examples + scenarios come from THEIR life — workplaces, dorms, family rooms, sawah — not abstract space.
- Examples + scenarios MUST be anchored to CONTEMPORARY Indonesian reality — what is actually in the news cycle, on TikTok / X / Instagram, and in the cultural conversation right now. Use your own knowledge of the current moment in Indonesia as the source of truth; the audience profile's "Sample contemporary anchors" line is a starter menu, not a quote list. Freshen those examples with whatever is actually live right now. If you reach for an illustration and notice it would have read identically a decade ago, swap it for something only true today.
- Emotional pacing follows their delivery profile: acknowledge before prescribing for Gen Z; respect time for professionals; validate concerns before tools for parents; lean on community for rural; equip with language for students.
- Steer clear of the "Avoid" list in the audience profile.
- The audience profile is CONTEXT FOR YOU — never mention it verbatim in the output, never quote "psychology" or "demographics" labels. Internalise, don't paraphrase.

Output language:
- Every field in the response JSON — situation_summary, issue_analysis, audience_segmentation (primary/perception/angle), recommendations, content_templates — must be written in the requested output language.
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
  daleel: BriefDaleel[];
  /** Optional onboarding profile for personalization. The brief LLM uses
   *  these to tailor examples to the da'i's audience, region, and focus. */
  profile?: import("@/db/schema").UserProfile | null;
  /** Optional free-text notes from the da'i for THIS brief — recent
   *  audience events, format constraints (Friday khutbah, IG reel),
   *  misconceptions to address, etc. */
  extraContext?: string | null;
  /** Target length in pages (1-4). Scales maxOutputTokens and gives the
   *  LLM a target word count. Default 2. */
  pages?: number;
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
    daleel,
    profile,
    extraContext,
    pages = 2,
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

  // Hijri calendar context — surfaces today's Hijri date + curated
  // events in the next 7-10 days so the brief's sunnah / du'a
  // recommendations are TIMELY rather than generic. Mirrors what the
  // weekly Insights pipeline does on the Python side.
  const { promptBlock: calendarBlock } = formatCalendarContext(
    new Date(),
    10,
  );

  // pages → maxTokens scaling. The brief JSON has fixed-size scaffolding
  // (audience_segmentation, sources, etc.) plus variable-size prose
  // (issue_analysis, khutbah outline). Floor 4000 covers the JSON
  // skeleton; +2000/page beyond that gives the LLM headroom for longer
  // prose at higher page counts. Caps at 10k so a rogue input can't
  // blow our token budget.
  const targetWords = (locale === "id" ? 350 : 250) * pages;
  const maxTokens = Math.min(10_000, Math.max(4_000, pages * 2_000));

  const userPrompt = [
    calendarBlock,
    "",
    `Topic: ${topic}`,
    `Audience segment: ${segLabel}`,
    `Tone: ${toneLabel}`,
    `Output language: ${localeLabel}`,
    `Target length: ~${pages} page(s), roughly ${targetWords} ${locale === "id" ? "kata" : "words"} of substantive prose across the variable-length fields (issue_analysis, recommendations bodies, khutbah outline). Don't pad — write tightly to this target.`,
    audienceBlock
      ? `\nAudience profile (INTERNALISE — never quote verbatim, never name the labels in the output; this is how the brief should *feel* to the reader):\n${audienceBlock}`
      : "",
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

  const content: BriefContent = {
    ...parsed.data,
    daleel, // append the retrieved daleel — LLM never authors these
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
