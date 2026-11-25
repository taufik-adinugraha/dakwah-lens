import { describe, expect, it } from "vitest";

import { briefingNumbers, cleanTopicLabel } from "./briefing-numbers";

// Trimmed from the live Ekonomi & Bisnis briefing of 2026-11-19.
const STATS = {
  totals: { posts_7d: 689, delta_pct: -22.5, posts_prev_7d: 889 },
  sentiment: {
    delta_pp_negative: -0.7,
    current_pct_neutral: 51.6,
    current_pct_negative: 16.6,
    current_pct_positive: 31.8,
    baseline_pct_negative: 17.3,
  },
  platform_stats: [
    { posts: 30, platform: "youtube", sentiment: { pct_neutral: 60, pct_negative: 30, pct_positive: 10 } },
    { posts: 659, platform: "mainstream", sentiment: { pct_neutral: 51.2, pct_negative: 16, pct_positive: 32.8 } },
  ],
  top_topics: [
    { label: "Domain Pemerintahan dan Kebijakan", post_count: 39, sample_headlines: [{ title: "Koperasi Kota Bandung" }] },
    { label: "Domain Ekonomi dan Bisnis", post_count: 203, sample_headlines: [{ title: "Z-Mart Wangi" }, { title: "Tapioka" }, { title: "UMKM" }] },
    { label: "Lainnya — Tidak Terklasifikasi", post_count: 21, sample_headlines: [] },
  ],
};

describe("briefingNumbers", () => {
  it("reads the totals, sentiment, platforms and topics", () => {
    const n = briefingNumbers(STATS)!;
    expect(n.posts).toBe(689);
    expect(n.prevPosts).toBe(889);
    expect(n.deltaPct).toBe(-22.5);
    expect(n.sentiment).toEqual({ negative: 16.6, neutral: 51.6, positive: 31.8 });
    expect(n.baselineNegative).toBe(17.3);
    expect(n.deltaPpNegative).toBe(-0.7);
    expect(n.platforms.map((p) => p.key)).toEqual(["mainstream", "youtube"]);
    expect(n.topics.map((t) => [t.label, t.posts])).toEqual([
      ["Ekonomi dan Bisnis", 203],
      ["Pemerintahan dan Kebijakan", 39],
      ["Lainnya", 21],
    ]);
    expect(n.topics[0].headlines).toEqual(["Z-Mart Wangi", "Tapioka"]);
  });

  it("returns null without the totals or a sentiment that adds up", () => {
    expect(briefingNumbers(null)).toBeNull();
    expect(briefingNumbers({ sentiment: STATS.sentiment })).toBeNull();
    expect(
      briefingNumbers({ ...STATS, sentiment: { ...STATS.sentiment, current_pct_neutral: 5 } }),
    ).toBeNull();
  });

  it("drops the platform split when there is only one platform", () => {
    const n = briefingNumbers({ ...STATS, platform_stats: [STATS.platform_stats[1]] })!;
    expect(n.platforms).toEqual([]);
  });
});

describe("cleanTopicLabel", () => {
  it("strips the Domain prefix and shortens Lainnya", () => {
    expect(cleanTopicLabel("Domain Teknologi dan AI")).toBe("Teknologi dan AI");
    expect(cleanTopicLabel("Magnet Pemerintahan dan Kebijakan")).toBe("Pemerintahan dan Kebijakan");
    expect(cleanTopicLabel("Lainnya — Tidak Terklasifikasi")).toBe("Lainnya");
    expect(cleanTopicLabel("Prabowo di KTT ASEAN ke-49 Manila")).toBe("Prabowo di KTT ASEAN ke-49 Manila");
  });
});
