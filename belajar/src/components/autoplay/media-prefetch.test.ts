import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import manifest from "../../../content/wordvoice.json";
import { SURAHS } from "@/lib/content";
import { ZERO_HOST } from "@/lib/curriculum";
import {
  createMediaStore,
  isPrefetchable,
  lessonMediaPlan,
  mediaPlanProblems,
  MEDIA_PREFETCH_MAX_BYTES,
  nextAyahDue,
  pageMediaPlan,
  PAGE_PREFETCH_MAX_FILES,
  planFor,
  PREFETCH_CONCURRENCY,
} from "@/lib/media-prefetch";

import { lessonMediaFor, stageSequence, zeroMediaFor, zeroSequence } from "./build";

// The recordings fetched before they are asked for (operator 2026-10-15: "just make sure no latency
// (preload before page is opened)"; src/lib/media-prefetch.ts). The plan of every lesson must list
// exactly what its sequence can play: a file it leaves out is a wait at the press.

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(join(BELAJAR, p), "utf8");
const lessons = SURAHS.flatMap((s) => s.ayat.map((a) => ({ s, a, seq: stageSequence(s, a, "id") })));
const QC = /^\/belajar\/media\/narration\/quran-com\/wbw\/\d{3}_\d{3}_\d{3}\.mp3$/;
const ALAFASY = /^\/belajar\/media\/narration\/alafasy\/\d{6}\.mp3$/;
const NARRATOR_WORD = /^\/belajar\/media\/narration\/kang-nandar\/words\/[0-9a-f]{16}-[0-9a-f]{10}\.mp3$/;

describe("the plan of every lesson (lessonMediaPlan)", () => {
  it("lists every recording the sequence can play — the recitation, every word, every example — each once, nothing else", () => {
    expect(lessons.length).toBeGreaterThan(20);
    for (const { a, seq } of lessons) {
      const rec = a.recitation[0].url;
      const plan = lessonMediaPlan(seq, rec);
      expect(mediaPlanProblems(seq, rec, plan), a.loc).toEqual([]);
      expect(plan[0], a.loc).toBe(rec);
      for (const u of plan) expect(ALAFASY.test(u) || QC.test(u) || NARRATOR_WORD.test(u), `${a.loc} ${u}`).toBe(true);
      // every word of the ayah: its step, Dengar dan klik, the word card and the mushaf line play any word
      for (const v of seq.wordVoices) expect(plan, a.loc).toContain(v!.url);
    }
  });

  it("has every lesson word as Quran.com's recording (a word at its place in the Qur'an)", () => {
    for (const { a, seq } of lessons) for (const [i, v] of seq.wordVoices.entries()) expect(v?.source, `${a.loc} word ${i + 1}`).toBe("quran.com");
  });

  it("lesson zero's plan lists its example files, and the first ayah's plan comes next", () => {
    const host = ZERO_HOST!;
    const seq = zeroSequence(host, "id");
    const m = zeroMediaFor(host, "id", seq);
    expect(mediaPlanProblems(seq, null, m.ayah)).toEqual([]);
    expect(m.ayah.length).toBeGreaterThan(0);
    expect(m.next).toEqual(lessonMediaPlan(stageSequence(host, host.ayat[0], "id"), host.ayat[0].recitation[0].url));
  });

  it("the page hands the next ayah's plan along (lessonMediaFor), and none after the surah's last ayah", () => {
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const seq = stageSequence(s, a, "id");
        const m = lessonMediaFor(s, a, "id", seq);
        const next = s.ayat.find((x) => x.ayah === a.ayah + 1);
        expect(m.ayah).toEqual(lessonMediaPlan(seq, a.recitation[0].url));
        expect(m.next.length > 0, a.loc).toBe(!!next);
      }
    }
  });

  it("a planted fault — a word the lesson plays that the plan leaves out — is named", () => {
    const { a, seq } = lessons.find((l) => l.a.loc === "1:7")!;
    const rec = a.recitation[0].url;
    const plan = lessonMediaPlan(seq, rec);
    const word = seq.wordVoices[4]!.url;
    const holed = plan.filter((u) => u !== word);
    const p = mediaPlanProblems(seq, rec, holed);
    expect(p.some((x) => x.includes(word) && x.includes("word 5")), p.join(" | ")).toBe(true);
    // … and an example clip left out, the recitation left out, a file listed twice, another host
    const ex = seq.steps.flatMap((st) => (st.examples ?? []).flatMap((b) => (b.clip ? [b.clip.url] : [])))[0];
    if (ex && !seq.wordVoices.some((v) => v?.url === ex)) expect(mediaPlanProblems(seq, rec, plan.filter((u) => u !== ex)).length).toBeGreaterThan(0);
    expect(mediaPlanProblems(seq, rec, plan.slice(1)).some((x) => x.includes("recitation"))).toBe(true);
    expect(mediaPlanProblems(seq, rec, [...plan, plan[1]]).some((x) => x.includes("twice"))).toBe(true);
    expect(mediaPlanProblems(seq, rec, [...plan, "https://audio.qurancdn.com/wbw/001_007_001.mp3"]).some((x) => x.includes("same-origin"))).toBe(true);
  });

  it("is small: at most ~2.5 MB for the largest ayah, by the hosted files' real sizes where known", () => {
    // Quran.com's files are pinned with their length only; at 320 kbps stereo (40 KB a second).
    const words = (manifest as { words: Record<string, { source?: string; audio?: { url: string; ms: number } }> }).words;
    const ms = new Map(Object.values(words).flatMap((e) => (e.audio ? [[e.audio.url, e.audio.ms] as const] : [])));
    const hosted = JSON.parse(read("pipeline/hosted.json")) as { alafasy: Record<string, { bytes: number }> };
    for (const { a, seq } of lessons) {
      const bytes = lessonMediaPlan(seq, a.recitation[0].url).reduce((n, u) => {
        if (ALAFASY.test(u)) return n + hosted.alafasy[u.slice(u.lastIndexOf("/") + 1)].bytes;
        return n + (ms.get(u) ?? 0) * (QC.test(u) ? 40 : 8);
      }, 0);
      expect(bytes, a.loc).toBeLessThan(2_500_000);
      expect(bytes, a.loc).toBeLessThan(MEDIA_PREFETCH_MAX_BYTES / 2);
    }
  });
});

describe("what may be fetched, and when", () => {
  it("nothing with Save-Data or a 2G-class connection; everything otherwise", () => {
    const plan = ["/belajar/media/narration/alafasy/001001.mp3"];
    expect(planFor(plan, { saveData: true })).toEqual([]);
    expect(planFor(plan, { effectiveType: "2g" })).toEqual([]);
    expect(planFor(plan, { effectiveType: "slow-2g" })).toEqual([]);
    expect(planFor(plan, { effectiveType: "4g" })).toEqual(plan);
    expect(planFor(plan, null)).toEqual(plan);
  });

  it("a page's plan keeps its order, drops duplicates and other hosts, and stops at its cap", () => {
    const u = (n: number) => `/belajar/media/narration/quran-com/wbw/001_001_${String(n).padStart(3, "0")}.mp3`;
    expect(pageMediaPlan([u(2), u(1), u(2), null, "https://everyayah.com/x.mp3", u(3)])).toEqual([u(2), u(1), u(3)]);
    const many = Array.from({ length: 40 }, (_, i) => u(i + 1));
    expect(pageMediaPlan(many)).toHaveLength(PAGE_PREFETCH_MAX_FILES);
    expect(pageMediaPlan(many, 2)).toEqual([u(1), u(2)]);
    expect(isPrefetchable("/belajar/media/narration/../x.mp3")).toBe(false);
  });

  it("the next ayah is due from two thirds of the steps, or at the end, never before the start", () => {
    expect(nextAyahDue({ started: false, phase: "idle", idx: 9 }, 10)).toBe(false);
    expect(nextAyahDue({ started: true, phase: "narrating", idx: 0 }, 9)).toBe(false);
    expect(nextAyahDue({ started: true, phase: "narrating", idx: 5 }, 9)).toBe(true);
    expect(nextAyahDue({ started: true, phase: "narrating", idx: 4 }, 9)).toBe(false);
    expect(nextAyahDue({ started: true, phase: "finished", idx: 0 }, 9)).toBe(true);
  });
});

describe("the store (createMediaStore)", () => {
  const url = (n: number) => `/belajar/media/narration/quran-com/wbw/001_001_${String(n).padStart(3, "0")}.mp3`;
  function rig() {
    const waiting: { url: string; resolve: (r: Response) => void; reject: (e: unknown) => void }[] = [];
    const fetch = vi.fn((u: string) => new Promise<Response>((resolve, reject) => waiting.push({ url: u, resolve, reject })));
    let n = 0;
    const revoked: string[] = [];
    const store = createMediaStore({ fetch, createObjectURL: () => `blob:${++n}`, revokeObjectURL: (u) => revoked.push(u) });
    const answer = async (i = 0, body = "abc") => {
      const w = waiting.splice(i, 1)[0];
      w.resolve(new Response(body, { status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(body.length) } }));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    };
    return { store, fetch, waiting, answer, revoked };
  }

  it("fetches nothing while the gate is shut, then at most three at a time, in plan order", async () => {
    const { store, fetch, waiting, answer } = rig();
    store.want("ayah", [url(1), url(2), url(3), url(4), url(5)]);
    expect(fetch).not.toHaveBeenCalled();
    store.setOpen(true);
    expect(fetch).toHaveBeenCalledTimes(PREFETCH_CONCURRENCY);
    expect(waiting.map((w) => w.url)).toEqual([url(1), url(2), url(3)]);
    await answer(0);
    expect(store.held(url(1))).toBe("blob:1");
    expect(store.inFlight()).toBe(3);
    expect(waiting.map((w) => w.url)).toEqual([url(2), url(3), url(4)]);
  });

  it("dedupes by URL across plans, and does not fetch a held file again", async () => {
    const { store, fetch, answer } = rig();
    store.setOpen(true);
    store.want("ayah", [url(1)]);
    store.want("next", [url(1), url(1)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await answer(0);
    store.want("page", [url(1)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.pending(url(1))).toBe(true);
  });

  it("keeps a copy while a plan holds it (the hand-off: next becomes ayah), and revokes it when none does", async () => {
    const { store, answer, revoked } = rig();
    store.setOpen(true);
    store.want("next", [url(7)]);
    await answer(0);
    // the next page: its "ayah" plan is the old "next", set before "next" is emptied
    store.want("ayah", [url(7)]);
    store.want("next", []);
    expect(store.held(url(7))).toBe("blob:1");
    expect(revoked).toEqual([]);
    store.want("ayah", []);
    expect(store.held(url(7))).toBeNull();
    expect(revoked).toEqual(["blob:1"]);
  });

  it("does not try a failed file again, and never fetches another host", async () => {
    const { store, fetch, waiting } = rig();
    store.setOpen(true);
    store.want("ayah", [url(1), "https://audio.qurancdn.com/wbw/001_001_001.mp3"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    waiting[0].resolve(new Response("", { status: 404 }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    store.want("ayah", [url(1)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.held(url(1))).toBeNull();
  });

  it("stops new fetches once the copies held reach the byte cap", async () => {
    const waiting: ((r: Response) => void)[] = [];
    const fetch = vi.fn(() => new Promise<Response>((r) => waiting.push(r)));
    const store = createMediaStore({ fetch, createObjectURL: () => "blob:x", revokeObjectURL: () => {}, maxBytes: 3, concurrency: 1 });
    store.setOpen(true);
    store.want("ayah", [url(1), url(2)]);
    waiting[0](new Response("abcd", { status: 200 }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(store.heldBytes()).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("the players play the page's copy (src/hooks)", () => {
  it("every player that plays a lesson or example file resolves it through mediaSrc", () => {
    for (const f of ["src/hooks/useClipPlayer.ts", "src/hooks/useExamplePlayer.ts", "src/hooks/useSegmentPlayer.ts"]) {
      expect(read(f), f).toMatch(/mediaSrc\(/);
    }
    expect(read("src/components/autoplay/useAutoplay.ts")).toContain("useMediaPrefetch({ ayah: media.ayah, next: nextDue ? media.next : [] }, mediaGate)");
    expect(read("src/components/library/ClipButton.tsx")).toContain("useMediaPrefetch({ page: pageMediaPlan(prefetch) })");
  });
});
