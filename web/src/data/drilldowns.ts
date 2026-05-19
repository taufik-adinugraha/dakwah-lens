/**
 * Drilldown configurations — one entry per platform.
 *
 * Each platform defines:
 *  - The i18n namespace it pulls labels/topic-titles from (mirrors next-intl namespaces)
 *  - The cluster set (4 for new platforms, 5 for the mainstream-media canonical example)
 *  - The 12–25 mock topics distributed across clusters
 *  - The "top outlets" / "top stories" lists used by the static sections
 *
 * When the relevance engine + ingestion pipeline land, the data shape here is what
 * the API will return for each platform. The component layer (TopicsByCluster,
 * Drilldown page) stays the same.
 */

export type PlatformKey =
  | "mainstream"
  | "youtube"
  | "tiktok"
  | "x"
  | "instagram"
  | "facebook";

export type ClusterTone =
  | "brand"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "cyan";

export type Topic = {
  /** Stable id; combined with namespace becomes `topic_${id}_title|tag`. */
  id: string;
  cluster: string;
  articles: number;
  sentiment: number; // 0-100, positive %
  delta: number; // weekly % change
  spark: number[]; // 7 datapoints
  outlets: { name: string; count: number }[];
};

export type Cluster = {
  key: string;
  tone: ClusterTone;
  articles: number;
  outlets: string[];
};

export type DrilldownConfig = {
  platform: PlatformKey;
  /** Slug used in URL (`/insights/<slug>`). */
  slug: string;
  /** i18n namespace for platform-specific copy. */
  namespace:
    | "Mainstream"
    | "Youtube"
    | "Tiktok"
    | "X"
    | "Instagram"
    | "Facebook";
  /** Number of stories rendered in the "Top stories" section. */
  storyCount: number;
  clusters: Cluster[];
  topics: Topic[];
  topOutlets: { name: string; articles: number }[];
};

export const CLUSTER_TONES: Record<
  ClusterTone,
  { dot: string; bar: string; ring: string; chipBg: string; chipText: string }
> = {
  brand: {
    dot: "bg-brand-500",
    bar: "bg-brand-500",
    ring: "ring-brand-100",
    chipBg: "bg-brand-50",
    chipText: "text-brand-700",
  },
  emerald: {
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    ring: "ring-emerald-100",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-700",
  },
  amber: {
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    ring: "ring-amber-100",
    chipBg: "bg-amber-50",
    chipText: "text-amber-700",
  },
  rose: {
    dot: "bg-rose-500",
    bar: "bg-rose-500",
    ring: "ring-rose-100",
    chipBg: "bg-rose-50",
    chipText: "text-rose-700",
  },
  violet: {
    dot: "bg-violet-500",
    bar: "bg-violet-500",
    ring: "ring-violet-100",
    chipBg: "bg-violet-50",
    chipText: "text-violet-700",
  },
  cyan: {
    dot: "bg-cyan-500",
    bar: "bg-cyan-500",
    ring: "ring-cyan-100",
    chipBg: "bg-cyan-50",
    chipText: "text-cyan-700",
  },
};

/* ──────────────────────────────────────────────────────────
 * MAINSTREAM MEDIA — the canonical, fullest example
 * ────────────────────────────────────────────────────────── */
const MAINSTREAM: DrilldownConfig = {
  platform: "mainstream",
  slug: "mainstream",
  namespace: "Mainstream",
  storyCount: 6,
  clusters: [
    { key: "general", tone: "brand", articles: 4200, outlets: ["Kompas", "Detik", "Tribunnews", "CNN Indonesia", "Liputan6", "Antara"] },
    { key: "islamic", tone: "emerald", articles: 1600, outlets: ["Republika", "Hidayatullah", "Voa Islam", "MuslimaNews"] },
    { key: "economic", tone: "amber", articles: 1200, outlets: ["Bisnis Indonesia", "CNBC Indonesia", "Kontan", "Investor Daily"] },
    { key: "politics", tone: "rose", articles: 800, outlets: ["Tempo", "Kumparan", "The Jakarta Post"] },
    { key: "regional", tone: "violet", articles: 400, outlets: ["Pikiran Rakyat", "Jawa Pos", "Solopos"] },
  ],
  topics: [
    { id: "general_1", cluster: "general", articles: 580, sentiment: 38, delta: 18, spark: [30, 35, 40, 55, 60, 70, 78], outlets: [{ name: "Kompas", count: 178 }, { name: "Detik", count: 142 }, { name: "CNN Indonesia", count: 96 }] },
    { id: "general_2", cluster: "general", articles: 420, sentiment: 42, delta: 9, spark: [40, 45, 42, 48, 55, 58, 60], outlets: [{ name: "Tempo", count: 142 }, { name: "Kompas", count: 110 }, { name: "Detik", count: 88 }] },
    { id: "general_3", cluster: "general", articles: 380, sentiment: 71, delta: 12, spark: [25, 30, 32, 40, 45, 52, 58], outlets: [{ name: "Tribunnews", count: 120 }, { name: "Kompas", count: 98 }, { name: "Liputan6", count: 82 }] },
    { id: "general_4", cluster: "general", articles: 320, sentiment: 55, delta: -4, spark: [50, 48, 45, 50, 52, 48, 46], outlets: [{ name: "Liputan6", count: 105 }, { name: "Kompas", count: 88 }, { name: "Detik", count: 70 }] },
    { id: "general_5", cluster: "general", articles: 280, sentiment: 48, delta: 6, spark: [20, 25, 28, 32, 38, 42, 44], outlets: [{ name: "Antara", count: 92 }, { name: "Kompas", count: 80 }, { name: "Tempo", count: 60 }] },
    { id: "islamic_1", cluster: "islamic", articles: 320, sentiment: 78, delta: 24, spark: [20, 25, 35, 45, 55, 65, 78], outlets: [{ name: "Republika", count: 120 }, { name: "Hidayatullah", count: 96 }, { name: "MuslimaNews", count: 64 }] },
    { id: "islamic_2", cluster: "islamic", articles: 240, sentiment: 52, delta: 14, spark: [18, 22, 28, 30, 35, 40, 48], outlets: [{ name: "Hidayatullah", count: 88 }, { name: "Republika", count: 76 }, { name: "Voa Islam", count: 50 }] },
    { id: "islamic_3", cluster: "islamic", articles: 220, sentiment: 84, delta: 18, spark: [15, 20, 28, 35, 42, 50, 58], outlets: [{ name: "Republika", count: 78 }, { name: "MuslimaNews", count: 64 }, { name: "Hidayatullah", count: 48 }] },
    { id: "islamic_4", cluster: "islamic", articles: 180, sentiment: 62, delta: 8, spark: [22, 24, 26, 30, 32, 34, 38], outlets: [{ name: "Republika", count: 72 }, { name: "Hidayatullah", count: 58 }, { name: "Voa Islam", count: 28 }] },
    { id: "islamic_5", cluster: "islamic", articles: 140, sentiment: 60, delta: 3, spark: [18, 19, 20, 22, 24, 26, 28], outlets: [{ name: "Republika", count: 60 }, { name: "Hidayatullah", count: 42 }, { name: "MuslimaNews", count: 22 }] },
    { id: "economic_1", cluster: "economic", articles: 280, sentiment: 75, delta: 21, spark: [18, 24, 30, 38, 45, 52, 60], outlets: [{ name: "CNBC Indonesia", count: 96 }, { name: "Bisnis Indonesia", count: 86 }, { name: "Kontan", count: 60 }] },
    { id: "economic_2", cluster: "economic", articles: 240, sentiment: 68, delta: 9, spark: [25, 28, 32, 36, 40, 44, 48], outlets: [{ name: "Bisnis Indonesia", count: 88 }, { name: "CNBC Indonesia", count: 70 }, { name: "Investor Daily", count: 48 }] },
    { id: "economic_3", cluster: "economic", articles: 220, sentiment: 38, delta: 12, spark: [22, 26, 28, 34, 36, 40, 44], outlets: [{ name: "Kontan", count: 74 }, { name: "CNBC Indonesia", count: 62 }, { name: "Bisnis Indonesia", count: 50 }] },
    { id: "economic_4", cluster: "economic", articles: 180, sentiment: 82, delta: 16, spark: [16, 20, 24, 30, 36, 42, 48], outlets: [{ name: "Republika", count: 56 }, { name: "Bisnis Indonesia", count: 48 }, { name: "Kontan", count: 32 }] },
    { id: "economic_5", cluster: "economic", articles: 140, sentiment: 60, delta: 5, spark: [18, 20, 22, 26, 28, 32, 34], outlets: [{ name: "Bisnis Indonesia", count: 50 }, { name: "Kontan", count: 40 }, { name: "CNBC Indonesia", count: 28 }] },
    { id: "politics_1", cluster: "politics", articles: 180, sentiment: 32, delta: 28, spark: [20, 28, 36, 42, 48, 55, 64], outlets: [{ name: "Tempo", count: 72 }, { name: "Kumparan", count: 58 }, { name: "Jakarta Post", count: 32 }] },
    { id: "politics_2", cluster: "politics", articles: 160, sentiment: 42, delta: 12, spark: [22, 26, 30, 34, 38, 42, 46], outlets: [{ name: "Tempo", count: 64 }, { name: "Kumparan", count: 50 }, { name: "Jakarta Post", count: 28 }] },
    { id: "politics_3", cluster: "politics", articles: 140, sentiment: 58, delta: 6, spark: [26, 28, 30, 32, 34, 36, 38], outlets: [{ name: "Kompas", count: 50 }, { name: "Tempo", count: 42 }, { name: "Kumparan", count: 28 }] },
    { id: "politics_4", cluster: "politics", articles: 120, sentiment: 48, delta: 3, spark: [24, 26, 26, 28, 28, 30, 32], outlets: [{ name: "Tempo", count: 48 }, { name: "Kumparan", count: 38 }, { name: "Jakarta Post", count: 22 }] },
    { id: "politics_5", cluster: "politics", articles: 100, sentiment: 40, delta: 8, spark: [18, 20, 22, 24, 26, 28, 30], outlets: [{ name: "Tempo", count: 40 }, { name: "Kompas", count: 30 }, { name: "Kumparan", count: 22 }] },
    { id: "regional_1", cluster: "regional", articles: 120, sentiment: 64, delta: 11, spark: [22, 24, 28, 30, 34, 38, 42], outlets: [{ name: "Pikiran Rakyat", count: 48 }, { name: "Jawa Pos", count: 40 }, { name: "Solopos", count: 22 }] },
    { id: "regional_2", cluster: "regional", articles: 100, sentiment: 78, delta: 7, spark: [16, 18, 22, 24, 26, 28, 30], outlets: [{ name: "Jawa Pos", count: 42 }, { name: "Pikiran Rakyat", count: 32 }, { name: "Solopos", count: 18 }] },
    { id: "regional_3", cluster: "regional", articles: 80, sentiment: 82, delta: 14, spark: [12, 14, 18, 22, 26, 30, 34], outlets: [{ name: "Solopos", count: 32 }, { name: "Jawa Pos", count: 28 }, { name: "Pikiran Rakyat", count: 16 }] },
    { id: "regional_4", cluster: "regional", articles: 60, sentiment: 72, delta: 6, spark: [10, 12, 14, 16, 18, 20, 22], outlets: [{ name: "Pikiran Rakyat", count: 26 }, { name: "Jawa Pos", count: 20 }, { name: "Solopos", count: 12 }] },
    { id: "regional_5", cluster: "regional", articles: 40, sentiment: 70, delta: 2, spark: [10, 10, 12, 12, 14, 14, 16], outlets: [{ name: "Pikiran Rakyat", count: 18 }, { name: "Solopos", count: 12 }, { name: "Jawa Pos", count: 10 }] },
  ],
  topOutlets: [
    { name: "Kompas", articles: 1240 },
    { name: "Detik", articles: 1085 },
    { name: "Tribunnews", articles: 920 },
    { name: "CNN Indonesia", articles: 640 },
    { name: "Republika", articles: 520 },
    { name: "Liputan6", articles: 480 },
    { name: "Antara", articles: 420 },
    { name: "Tempo", articles: 360 },
  ],
};

/** Smaller-scoped factory used by the 5 new platforms — 4 clusters × 3 topics = 12 topics. */
function makePlatform(args: {
  platform: PlatformKey;
  namespace: DrilldownConfig["namespace"];
  storyCount: number;
  clusters: Array<{ key: string; tone: ClusterTone; articles: number; outlets: string[] }>;
  topics: Array<Omit<Topic, "spark"> & { spark?: number[] }>;
  topOutlets: Array<{ name: string; articles: number }>;
}): DrilldownConfig {
  return {
    ...args,
    slug: args.platform,
    topics: args.topics.map((t) => ({
      ...t,
      spark: t.spark ?? defaultSpark(t.delta),
    })),
  };
}

function defaultSpark(delta: number): number[] {
  // Simple synthetic sparkline biased by the weekly delta.
  const sign = delta >= 0 ? 1 : -1;
  const mag = Math.min(50, Math.abs(delta) * 2);
  return [20, 22 + sign * 2, 24 + sign * 4, 26 + sign * 6, 28 + sign * 9, 30 + sign * Math.max(8, mag / 2), 32 + sign * mag].map((n) => Math.max(8, n));
}

/* ──────────────────────────────────────────────────────────
 * YOUTUBE — 4 clusters: creators, news, educational, lifestyle
 * ────────────────────────────────────────────────────────── */
const YOUTUBE = makePlatform({
  platform: "youtube",
  namespace: "Youtube",
  storyCount: 5,
  clusters: [
    { key: "creators", tone: "emerald", articles: 8400, outlets: ["Ustadz Adi Hidayat", "Ustadz Hanan Attaki", "Yufid TV", "NU Channel"] },
    { key: "news", tone: "brand", articles: 6200, outlets: ["Kompas TV", "CNN Indonesia", "tvOneNews", "MetroTV"] },
    { key: "educational", tone: "cyan", articles: 5400, outlets: ["Khan Academy ID", "Rumah Edukasi", "Pondok Pesantren TV", "Kemenag"] },
    { key: "lifestyle", tone: "amber", articles: 4500, outlets: ["Halal Channel", "Family Vlog ID", "Travel Halal", "Cooking Mama"] },
  ],
  topics: [
    { id: "creators_1", cluster: "creators", articles: 1620, sentiment: 82, delta: 28, outlets: [{ name: "Ustadz Adi Hidayat", count: 580 }, { name: "Ustadz Hanan Attaki", count: 420 }, { name: "Yufid TV", count: 280 }] },
    { id: "creators_2", cluster: "creators", articles: 1180, sentiment: 76, delta: 14, outlets: [{ name: "Yufid TV", count: 380 }, { name: "Ustadz Adi Hidayat", count: 320 }, { name: "NU Channel", count: 240 }] },
    { id: "creators_3", cluster: "creators", articles: 940, sentiment: 70, delta: 9, outlets: [{ name: "Ustadz Hanan Attaki", count: 320 }, { name: "Yufid TV", count: 260 }, { name: "NU Channel", count: 180 }] },
    { id: "news_1", cluster: "news", articles: 1480, sentiment: 38, delta: 12, outlets: [{ name: "CNN Indonesia", count: 520 }, { name: "tvOneNews", count: 420 }, { name: "Kompas TV", count: 340 }] },
    { id: "news_2", cluster: "news", articles: 1120, sentiment: 44, delta: 8, outlets: [{ name: "Kompas TV", count: 380 }, { name: "MetroTV", count: 280 }, { name: "CNN Indonesia", count: 240 }] },
    { id: "news_3", cluster: "news", articles: 860, sentiment: 52, delta: 4, outlets: [{ name: "tvOneNews", count: 300 }, { name: "CNN Indonesia", count: 240 }, { name: "MetroTV", count: 180 }] },
    { id: "educational_1", cluster: "educational", articles: 1240, sentiment: 84, delta: 18, outlets: [{ name: "Pondok Pesantren TV", count: 420 }, { name: "Kemenag", count: 320 }, { name: "Khan Academy ID", count: 240 }] },
    { id: "educational_2", cluster: "educational", articles: 980, sentiment: 78, delta: 11, outlets: [{ name: "Rumah Edukasi", count: 340 }, { name: "Pondok Pesantren TV", count: 280 }, { name: "Khan Academy ID", count: 180 }] },
    { id: "educational_3", cluster: "educational", articles: 720, sentiment: 72, delta: 5, outlets: [{ name: "Kemenag", count: 260 }, { name: "Khan Academy ID", count: 200 }, { name: "Pondok Pesantren TV", count: 140 }] },
    { id: "lifestyle_1", cluster: "lifestyle", articles: 1080, sentiment: 68, delta: 16, outlets: [{ name: "Halal Channel", count: 380 }, { name: "Travel Halal", count: 280 }, { name: "Family Vlog ID", count: 220 }] },
    { id: "lifestyle_2", cluster: "lifestyle", articles: 820, sentiment: 74, delta: 12, outlets: [{ name: "Family Vlog ID", count: 280 }, { name: "Cooking Mama", count: 220 }, { name: "Halal Channel", count: 180 }] },
    { id: "lifestyle_3", cluster: "lifestyle", articles: 640, sentiment: 70, delta: 6, outlets: [{ name: "Travel Halal", count: 220 }, { name: "Cooking Mama", count: 180 }, { name: "Family Vlog ID", count: 140 }] },
  ],
  topOutlets: [
    { name: "Ustadz Adi Hidayat", articles: 920 },
    { name: "Yufid TV", articles: 740 },
    { name: "Ustadz Hanan Attaki", articles: 680 },
    { name: "CNN Indonesia", articles: 560 },
    { name: "Pondok Pesantren TV", articles: 480 },
    { name: "Kompas TV", articles: 420 },
    { name: "Halal Channel", articles: 360 },
    { name: "NU Channel", articles: 320 },
  ],
});

/* ──────────────────────────────────────────────────────────
 * TIKTOK — 4 clusters: dawah, explainers, family, lifestyle
 * ────────────────────────────────────────────────────────── */
const TIKTOK = makePlatform({
  platform: "tiktok",
  namespace: "Tiktok",
  storyCount: 5,
  clusters: [
    { key: "dawah", tone: "emerald", articles: 68000, outlets: ["@ngajijomblo", "@indahputeri.id", "@dakwah1menit", "@ustadzcahyo"] },
    { key: "explainers", tone: "cyan", articles: 42000, outlets: ["@kajianumat", "@quranproject", "@hadithoftheday", "@fiqh101"] },
    { key: "family", tone: "rose", articles: 38000, outlets: ["@parentingmuslim", "@ibumudaislam", "@keluargaberkah", "@anakberkahid"] },
    { key: "lifestyle", tone: "amber", articles: 39000, outlets: ["@hijabstyle", "@halalfood.id", "@muslimtraveller", "@modestfashion"] },
  ],
  topics: [
    { id: "dawah_1", cluster: "dawah", articles: 24000, sentiment: 78, delta: 42, outlets: [{ name: "@dakwah1menit", count: 8400 }, { name: "@ustadzcahyo", count: 6200 }, { name: "@ngajijomblo", count: 5100 }] },
    { id: "dawah_2", cluster: "dawah", articles: 18000, sentiment: 74, delta: 32, outlets: [{ name: "@indahputeri.id", count: 6800 }, { name: "@dakwah1menit", count: 5200 }, { name: "@ustadzcahyo", count: 3800 }] },
    { id: "dawah_3", cluster: "dawah", articles: 12000, sentiment: 80, delta: 18, outlets: [{ name: "@ngajijomblo", count: 4400 }, { name: "@indahputeri.id", count: 3600 }, { name: "@ustadzcahyo", count: 2800 }] },
    { id: "explainers_1", cluster: "explainers", articles: 16000, sentiment: 82, delta: 28, outlets: [{ name: "@quranproject", count: 6200 }, { name: "@hadithoftheday", count: 4400 }, { name: "@kajianumat", count: 3200 }] },
    { id: "explainers_2", cluster: "explainers", articles: 11000, sentiment: 76, delta: 14, outlets: [{ name: "@fiqh101", count: 4200 }, { name: "@kajianumat", count: 3400 }, { name: "@quranproject", count: 2400 }] },
    { id: "explainers_3", cluster: "explainers", articles: 9000, sentiment: 72, delta: 8, outlets: [{ name: "@hadithoftheday", count: 3400 }, { name: "@fiqh101", count: 2800 }, { name: "@kajianumat", count: 2000 }] },
    { id: "family_1", cluster: "family", articles: 15000, sentiment: 68, delta: 22, outlets: [{ name: "@parentingmuslim", count: 5400 }, { name: "@keluargaberkah", count: 4400 }, { name: "@ibumudaislam", count: 3000 }] },
    { id: "family_2", cluster: "family", articles: 11000, sentiment: 70, delta: 16, outlets: [{ name: "@ibumudaislam", count: 4200 }, { name: "@anakberkahid", count: 3400 }, { name: "@keluargaberkah", count: 2400 }] },
    { id: "family_3", cluster: "family", articles: 9000, sentiment: 74, delta: 10, outlets: [{ name: "@keluargaberkah", count: 3400 }, { name: "@parentingmuslim", count: 2800 }, { name: "@anakberkahid", count: 2000 }] },
    { id: "lifestyle_1", cluster: "lifestyle", articles: 14000, sentiment: 70, delta: 24, outlets: [{ name: "@halalfood.id", count: 5200 }, { name: "@hijabstyle", count: 4200 }, { name: "@modestfashion", count: 2800 }] },
    { id: "lifestyle_2", cluster: "lifestyle", articles: 11000, sentiment: 76, delta: 18, outlets: [{ name: "@muslimtraveller", count: 4000 }, { name: "@halalfood.id", count: 3400 }, { name: "@hijabstyle", count: 2400 }] },
    { id: "lifestyle_3", cluster: "lifestyle", articles: 9000, sentiment: 72, delta: 12, outlets: [{ name: "@hijabstyle", count: 3400 }, { name: "@modestfashion", count: 2800 }, { name: "@muslimtraveller", count: 2000 }] },
  ],
  topOutlets: [
    { name: "@dakwah1menit", articles: 14200 },
    { name: "@ngajijomblo", articles: 11600 },
    { name: "@indahputeri.id", articles: 9400 },
    { name: "@quranproject", articles: 8800 },
    { name: "@parentingmuslim", articles: 8200 },
    { name: "@halalfood.id", articles: 7400 },
    { name: "@ustadzcahyo", articles: 6800 },
    { name: "@kajianumat", articles: 6400 },
  ],
});

/* ──────────────────────────────────────────────────────────
 * X (Twitter) — 4 clusters: muslimtwitter, news, ulama, opinion
 * ────────────────────────────────────────────────────────── */
const XPLATFORM = makePlatform({
  platform: "x",
  namespace: "X",
  storyCount: 5,
  clusters: [
    { key: "muslimtwitter", tone: "emerald", articles: 48000, outlets: ["@MuslimYouthID", "@HijraGen", "@kajianTwitter", "@MuslimahProject"] },
    { key: "news", tone: "brand", articles: 42000, outlets: ["@detikcom", "@kompascom", "@CNNIndonesia", "@tempodotco"] },
    { key: "ulama", tone: "cyan", articles: 28000, outlets: ["@UAdiHidayat", "@HananAttaki", "@nuonline", "@muhammadiyah"] },
    { key: "opinion", tone: "amber", articles: 24000, outlets: ["@najwashihab", "@RockyGerung", "@RhomaIrama_R", "@FaheemYounus"] },
  ],
  topics: [
    { id: "muslimtwitter_1", cluster: "muslimtwitter", articles: 18000, sentiment: 64, delta: 34, outlets: [{ name: "@MuslimYouthID", count: 6800 }, { name: "@HijraGen", count: 5400 }, { name: "@MuslimahProject", count: 3800 }] },
    { id: "muslimtwitter_2", cluster: "muslimtwitter", articles: 14000, sentiment: 70, delta: 22, outlets: [{ name: "@kajianTwitter", count: 5200 }, { name: "@HijraGen", count: 4200 }, { name: "@MuslimYouthID", count: 3000 }] },
    { id: "muslimtwitter_3", cluster: "muslimtwitter", articles: 9000, sentiment: 66, delta: 14, outlets: [{ name: "@MuslimahProject", count: 3400 }, { name: "@kajianTwitter", count: 2800 }, { name: "@HijraGen", count: 2000 }] },
    { id: "news_1", cluster: "news", articles: 16000, sentiment: 38, delta: 18, outlets: [{ name: "@detikcom", count: 5800 }, { name: "@CNNIndonesia", count: 4400 }, { name: "@kompascom", count: 3200 }] },
    { id: "news_2", cluster: "news", articles: 12000, sentiment: 42, delta: 10, outlets: [{ name: "@kompascom", count: 4400 }, { name: "@tempodotco", count: 3200 }, { name: "@detikcom", count: 2600 }] },
    { id: "news_3", cluster: "news", articles: 9000, sentiment: 48, delta: 6, outlets: [{ name: "@CNNIndonesia", count: 3400 }, { name: "@detikcom", count: 2600 }, { name: "@tempodotco", count: 1800 }] },
    { id: "ulama_1", cluster: "ulama", articles: 11000, sentiment: 80, delta: 26, outlets: [{ name: "@UAdiHidayat", count: 4200 }, { name: "@HananAttaki", count: 3400 }, { name: "@nuonline", count: 2200 }] },
    { id: "ulama_2", cluster: "ulama", articles: 8000, sentiment: 78, delta: 14, outlets: [{ name: "@nuonline", count: 3000 }, { name: "@muhammadiyah", count: 2400 }, { name: "@UAdiHidayat", count: 1800 }] },
    { id: "ulama_3", cluster: "ulama", articles: 5500, sentiment: 74, delta: 8, outlets: [{ name: "@HananAttaki", count: 2200 }, { name: "@nuonline", count: 1700 }, { name: "@muhammadiyah", count: 1200 }] },
    { id: "opinion_1", cluster: "opinion", articles: 9500, sentiment: 36, delta: 20, outlets: [{ name: "@najwashihab", count: 3600 }, { name: "@RockyGerung", count: 2800 }, { name: "@FaheemYounus", count: 1900 }] },
    { id: "opinion_2", cluster: "opinion", articles: 7500, sentiment: 50, delta: 12, outlets: [{ name: "@najwashihab", count: 2900 }, { name: "@FaheemYounus", count: 2300 }, { name: "@RockyGerung", count: 1700 }] },
    { id: "opinion_3", cluster: "opinion", articles: 5500, sentiment: 58, delta: 6, outlets: [{ name: "@RhomaIrama_R", count: 2200 }, { name: "@FaheemYounus", count: 1700 }, { name: "@najwashihab", count: 1100 }] },
  ],
  topOutlets: [
    { name: "@detikcom", articles: 12000 },
    { name: "@MuslimYouthID", articles: 10500 },
    { name: "@UAdiHidayat", articles: 8400 },
    { name: "@CNNIndonesia", articles: 8200 },
    { name: "@HijraGen", articles: 7800 },
    { name: "@kompascom", articles: 7200 },
    { name: "@najwashihab", articles: 6600 },
    { name: "@HananAttaki", articles: 5600 },
  ],
});

/* ──────────────────────────────────────────────────────────
 * INSTAGRAM — 4 clusters: carousels, reels, masjid, lifestyle
 * ────────────────────────────────────────────────────────── */
const INSTAGRAM = makePlatform({
  platform: "instagram",
  namespace: "Instagram",
  storyCount: 5,
  clusters: [
    { key: "carousels", tone: "rose", articles: 32000, outlets: ["@quotemuslim", "@dakwah.id", "@hijra_indonesia", "@kajian.online"] },
    { key: "reels", tone: "emerald", articles: 28000, outlets: ["@dakwahreels", "@ustadzreels", "@onemnreminders", "@taqwagram"] },
    { key: "masjid", tone: "brand", articles: 18000, outlets: ["@masjid.istiqlal", "@masjid.al.akbar", "@masjid.jogokariyan", "@masjid.salman"] },
    { key: "lifestyle", tone: "amber", articles: 17000, outlets: ["@halalstyle.id", "@modesta", "@hijabchic", "@muslimah.daily"] },
  ],
  topics: [
    { id: "carousels_1", cluster: "carousels", articles: 12000, sentiment: 78, delta: 22, outlets: [{ name: "@quotemuslim", count: 4400 }, { name: "@dakwah.id", count: 3600 }, { name: "@hijra_indonesia", count: 2400 }] },
    { id: "carousels_2", cluster: "carousels", articles: 9000, sentiment: 76, delta: 16, outlets: [{ name: "@dakwah.id", count: 3400 }, { name: "@kajian.online", count: 2800 }, { name: "@quotemuslim", count: 1800 }] },
    { id: "carousels_3", cluster: "carousels", articles: 7000, sentiment: 72, delta: 10, outlets: [{ name: "@hijra_indonesia", count: 2800 }, { name: "@kajian.online", count: 2000 }, { name: "@quotemuslim", count: 1400 }] },
    { id: "reels_1", cluster: "reels", articles: 11000, sentiment: 82, delta: 32, outlets: [{ name: "@dakwahreels", count: 4400 }, { name: "@onemnreminders", count: 3200 }, { name: "@ustadzreels", count: 2200 }] },
    { id: "reels_2", cluster: "reels", articles: 8000, sentiment: 78, delta: 24, outlets: [{ name: "@taqwagram", count: 3000 }, { name: "@ustadzreels", count: 2400 }, { name: "@dakwahreels", count: 1600 }] },
    { id: "reels_3", cluster: "reels", articles: 6000, sentiment: 74, delta: 14, outlets: [{ name: "@onemnreminders", count: 2400 }, { name: "@taqwagram", count: 1800 }, { name: "@ustadzreels", count: 1200 }] },
    { id: "masjid_1", cluster: "masjid", articles: 7000, sentiment: 84, delta: 14, outlets: [{ name: "@masjid.istiqlal", count: 2800 }, { name: "@masjid.jogokariyan", count: 1800 }, { name: "@masjid.salman", count: 1400 }] },
    { id: "masjid_2", cluster: "masjid", articles: 5500, sentiment: 80, delta: 9, outlets: [{ name: "@masjid.al.akbar", count: 2200 }, { name: "@masjid.istiqlal", count: 1600 }, { name: "@masjid.jogokariyan", count: 1100 }] },
    { id: "masjid_3", cluster: "masjid", articles: 4000, sentiment: 76, delta: 5, outlets: [{ name: "@masjid.salman", count: 1600 }, { name: "@masjid.jogokariyan", count: 1200 }, { name: "@masjid.al.akbar", count: 800 }] },
    { id: "lifestyle_1", cluster: "lifestyle", articles: 7000, sentiment: 70, delta: 18, outlets: [{ name: "@hijabchic", count: 2600 }, { name: "@halalstyle.id", count: 2200 }, { name: "@modesta", count: 1400 }] },
    { id: "lifestyle_2", cluster: "lifestyle", articles: 5500, sentiment: 72, delta: 12, outlets: [{ name: "@modesta", count: 2000 }, { name: "@muslimah.daily", count: 1600 }, { name: "@hijabchic", count: 1100 }] },
    { id: "lifestyle_3", cluster: "lifestyle", articles: 4000, sentiment: 68, delta: 6, outlets: [{ name: "@halalstyle.id", count: 1600 }, { name: "@muslimah.daily", count: 1200 }, { name: "@hijabchic", count: 800 }] },
  ],
  topOutlets: [
    { name: "@quotemuslim", articles: 7600 },
    { name: "@dakwah.id", articles: 6800 },
    { name: "@dakwahreels", articles: 6000 },
    { name: "@hijra_indonesia", articles: 5400 },
    { name: "@masjid.istiqlal", articles: 4600 },
    { name: "@hijabchic", articles: 4400 },
    { name: "@onemnreminders", articles: 4200 },
    { name: "@halalstyle.id", articles: 3800 },
  ],
});

/* ──────────────────────────────────────────────────────────
 * FACEBOOK — 4 clusters: community, masjid, news, family
 * ────────────────────────────────────────────────────────── */
const FACEBOOK = makePlatform({
  platform: "facebook",
  namespace: "Facebook",
  storyCount: 5,
  clusters: [
    { key: "community", tone: "brand", articles: 28000, outlets: ["RT/RW Jakarta Selatan", "Komunitas Muslim Bandung", "Surabaya Muslimin", "Yogya Hijrah Group"] },
    { key: "masjid", tone: "emerald", articles: 22000, outlets: ["Masjid Istiqlal Page", "Masjid Salman ITB", "Masjid Jogokariyan", "Masjid Al-Akbar"] },
    { key: "news", tone: "amber", articles: 16000, outlets: ["Kompas.com", "Detik.com", "Republika Online", "Tribunnews"] },
    { key: "family", tone: "rose", articles: 10000, outlets: ["Parenting Islami ID", "Ibu Cerdas", "Ayah Hebat", "Keluarga Sakinah"] },
  ],
  topics: [
    { id: "community_1", cluster: "community", articles: 11000, sentiment: 74, delta: 18, outlets: [{ name: "RT/RW Jakarta Selatan", count: 4200 }, { name: "Komunitas Muslim Bandung", count: 3400 }, { name: "Surabaya Muslimin", count: 2200 }] },
    { id: "community_2", cluster: "community", articles: 9000, sentiment: 78, delta: 12, outlets: [{ name: "Yogya Hijrah Group", count: 3400 }, { name: "Komunitas Muslim Bandung", count: 2800 }, { name: "Surabaya Muslimin", count: 1800 }] },
    { id: "community_3", cluster: "community", articles: 6000, sentiment: 72, delta: 6, outlets: [{ name: "RT/RW Jakarta Selatan", count: 2400 }, { name: "Yogya Hijrah Group", count: 1800 }, { name: "Komunitas Muslim Bandung", count: 1200 }] },
    { id: "masjid_1", cluster: "masjid", articles: 9000, sentiment: 82, delta: 14, outlets: [{ name: "Masjid Istiqlal Page", count: 3400 }, { name: "Masjid Salman ITB", count: 2800 }, { name: "Masjid Jogokariyan", count: 1600 }] },
    { id: "masjid_2", cluster: "masjid", articles: 7000, sentiment: 80, delta: 10, outlets: [{ name: "Masjid Jogokariyan", count: 2800 }, { name: "Masjid Al-Akbar", count: 2200 }, { name: "Masjid Istiqlal Page", count: 1400 }] },
    { id: "masjid_3", cluster: "masjid", articles: 4500, sentiment: 76, delta: 6, outlets: [{ name: "Masjid Salman ITB", count: 1800 }, { name: "Masjid Al-Akbar", count: 1400 }, { name: "Masjid Jogokariyan", count: 800 }] },
    { id: "news_1", cluster: "news", articles: 7000, sentiment: 42, delta: 8, outlets: [{ name: "Kompas.com", count: 2600 }, { name: "Detik.com", count: 2200 }, { name: "Tribunnews", count: 1400 }] },
    { id: "news_2", cluster: "news", articles: 5000, sentiment: 50, delta: 4, outlets: [{ name: "Republika Online", count: 2000 }, { name: "Kompas.com", count: 1600 }, { name: "Tribunnews", count: 900 }] },
    { id: "news_3", cluster: "news", articles: 3500, sentiment: 48, delta: 2, outlets: [{ name: "Detik.com", count: 1400 }, { name: "Tribunnews", count: 1100 }, { name: "Republika Online", count: 700 }] },
    { id: "family_1", cluster: "family", articles: 4500, sentiment: 70, delta: 12, outlets: [{ name: "Parenting Islami ID", count: 1800 }, { name: "Ibu Cerdas", count: 1400 }, { name: "Keluarga Sakinah", count: 900 }] },
    { id: "family_2", cluster: "family", articles: 3500, sentiment: 76, delta: 8, outlets: [{ name: "Keluarga Sakinah", count: 1400 }, { name: "Ayah Hebat", count: 1100 }, { name: "Ibu Cerdas", count: 700 }] },
    { id: "family_3", cluster: "family", articles: 2000, sentiment: 72, delta: 4, outlets: [{ name: "Ayah Hebat", count: 800 }, { name: "Parenting Islami ID", count: 600 }, { name: "Ibu Cerdas", count: 400 }] },
  ],
  topOutlets: [
    { name: "RT/RW Jakarta Selatan", articles: 6600 },
    { name: "Komunitas Muslim Bandung", articles: 6000 },
    { name: "Masjid Istiqlal Page", articles: 4800 },
    { name: "Masjid Jogokariyan", articles: 4200 },
    { name: "Yogya Hijrah Group", articles: 3800 },
    { name: "Kompas.com", articles: 3400 },
    { name: "Parenting Islami ID", articles: 2400 },
    { name: "Masjid Salman ITB", articles: 2200 },
  ],
});

export const DRILLDOWN_CONFIGS: Record<PlatformKey, DrilldownConfig> = {
  mainstream: MAINSTREAM,
  youtube: YOUTUBE,
  tiktok: TIKTOK,
  x: XPLATFORM,
  instagram: INSTAGRAM,
  facebook: FACEBOOK,
};

export const PLATFORM_SLUGS: readonly PlatformKey[] = [
  "mainstream",
  "youtube",
  "tiktok",
  "x",
  "instagram",
  "facebook",
];
