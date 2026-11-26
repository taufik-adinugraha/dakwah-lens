import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SURAHS } from "./content";
import { LIBRARY } from "./library";
import { assertPublishable, PIPELINE_STATE, publishProblems, REVIEW_PROMISE, statusValues } from "./publishable";

// WHAT A PUBLIC MODULE MUST NOT SAY (docs/belajar-plan.md L11, L42). The module used to refuse a public
// build while any record was marked "draft"; but "draft" is pipeline state, there is no human review (L11),
// and that gate could never open. What it stood for is held here instead: nothing claims a review, nothing is
// left unfinished, and every page carries the AI-assisted label and the "bukan fatwa" line.

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const json = (rel: string): unknown => JSON.parse(read(rel));

describe("publishProblems: a claim of review, and unfinished text, are what refuses", () => {
  it("passes the pipeline state and plain content", () => {
    expect(publishProblems({ status: "draft", words: [{ status: "draft", gloss: "menunggu, awaiting" }] }, "x")).toEqual([]);
    expect(PIPELINE_STATE).toBe("draft");
  });

  it("refuses every way of saying that a person reviewed, or will review, the material", () => {
    for (const text of [
      "Menunggu tinjauan ustadz.",
      "Sudah ditinjau ustadz Fulan.",
      "terjemahan menunggu tinjauan ustadz",
      "Telah ditinjau oleh ustadz",
      "Sudah ditinjau oleh seorang ustadz.",
      "Semua penjelasan sudah diperiksa ustadz.",
      "Awaiting ustadz review",
      "Reviewed by an ustadz",
      "Review by ustadz",
      "Penjelasan ini ditinjau oleh ustadz.",
      "Sudah diperiksa oleh ustadz.",
      "Telah diperiksa oleh ulama",
      "Materi ini sudah diverifikasi.",
      "Materi ini telah ditashih.",
      "Isi ini ditashih ulama",
      "Reviewed by a scholar",
      "Checked by an ustadz",
      "verified by scholars",
      "Awaiting scholar review",
    ]) {
      expect(REVIEW_PROMISE.test(text), text).toBe(true);
      expect(publishProblems({ a: { b: [text] } }, "content/x.json"), text).toEqual([expect.stringContaining("content/x.json.a.b[0]: promises a human review")]);
    }
  });

  it("does not take a word's meaning for a promise", () => {
    for (const text of ["observers; awaiting", "orang yang memandang; menunggu", "tinjauan umum tentang kata ini", "the review of the lesson is done by you", "diperiksa kembali oleh pembaca", "ditinjau dari sisi bahasa", "verified by the data", "checked by hand"]) {
      expect(publishProblems(text, "x"), text).toEqual([]);
    }
  });

  it("refuses a status that says a person checked it, wherever it is", () => {
    expect(publishProblems({ ayat: [{ words: [{ status: "reviewed" }] }] }, "s")).toEqual([
      expect.stringContaining('s.ayat[0].words[0].status is "reviewed"'),
    ]);
    expect(() => assertPublishable({ status: "reviewed" }, "content/a.json")).toThrow(/content\/a\.json cannot be shipped/);
  });

  it("refuses text left unfinished", () => {
    for (const text of ["TODO: write this", "tbd", "Lorem ipsum dolor", "FIXME later"]) {
      expect(publishProblems([text], "x"), text).toEqual([expect.stringContaining("unfinished text")]);
    }
    expect(publishProblems(["to do list", "tobacco"], "x")).toEqual([]);
  });

  it("names every problem, up to ten, in the error", () => {
    const bad = Array.from({ length: 12 }, () => "menunggu tinjauan ustadz");
    try {
      assertPublishable(bad, "content/x.json");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message.split("\n").filter((l) => l.includes("promises a human review"))).toHaveLength(10);
    }
  });
});

describe("the shipped content holds what a public module must", () => {
  it("is every lesson and the whole library: only the pipeline state, no promise, nothing unfinished", () => {
    for (const s of SURAHS) {
      expect(publishProblems(s, `content/${s.slug}.json`)).toEqual([]);
      expect([...statusValues(s)]).toEqual([PIPELINE_STATE]);
    }
    expect(publishProblems(LIBRARY, "content/library.json")).toEqual([]);
    expect([...statusValues(LIBRARY)]).toEqual([PIPELINE_STATE]);
  });

  it("is the Kosakata files, every one (they are read per request, too large to scan at run time)", () => {
    const dir = "content/kosakata";
    const files = readdirSync(join(BELAJAR, dir)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(100);
    for (const f of files) expect(publishProblems(json(`${dir}/${f}`), `${dir}/${f}`), f).toEqual([]);
    // The list's own status is the pipeline's too.
    expect((json(`${dir}/index.json`) as { status: string }).status).toBe(PIPELINE_STATE);
  });

  it("is the curriculum, the cheat sheet, the narration, the quizzes and the messages", () => {
    for (const rel of ["content/curriculum.json", "content/rumus.json", "messages/id.json", "messages/en.json", "messages/waris/id.json", "messages/waris/en.json"]) {
      expect(publishProblems(json(rel), rel), rel).toEqual([]);
    }
    for (const dir of ["content/narration", "content/quiz", "content/map", "content/compose"]) {
      for (const f of readdirSync(join(BELAJAR, dir)).filter((n) => n.endsWith(".json"))) {
        expect(publishProblems(json(`${dir}/${f}`), `${dir}/${f}`), `${dir}/${f}`).toEqual([]);
      }
    }
  });
});

describe("every page carries the AI-assisted label and the 'bukan fatwa' line", () => {
  const messages = { id: json("messages/id.json"), en: json("messages/en.json") } as Record<"id" | "en", Record<string, Record<string, string>>>;

  it("is the layout's footer, on every page, in both languages", () => {
    expect(messages.id.Footer.disclaimer).toMatch(/^Dibantu AI, bukan fatwa otoritatif\./);
    expect(messages.en.Footer.disclaimer).toMatch(/^AI-assisted, not an authoritative fatwa\./);
    const layout = read("src/app/[locale]/layout.tsx");
    expect(layout).toContain("<FooterDisclaimer");
    expect(layout).toContain('tf("disclaimer")');
    // Not inside a condition: the footer is drawn for every child of the layout.
    expect(layout).toMatch(/<footer className="mt-16[^>]*>/);
    expect(layout.indexOf("<FooterDisclaimer")).toBeGreaterThan(layout.indexOf("<footer"));
  });

  it("says in the track's own words that it is AI-assisted learning material, not a fatwa", () => {
    expect(messages.id.Quran.p3_body).toMatch(/bantuan AI/);
    expect(messages.id.Quran.p3_body).toMatch(/bukan fatwa/);
    expect(messages.en.Quran.p3_body).toMatch(/AI help/);
    expect(messages.en.Quran.p3_body).toMatch(/not a fatwa/);
  });

  it("promises no review anywhere in a message, in either language", () => {
    for (const locale of ["id", "en"] as const) {
      for (const [ns, values] of Object.entries(messages[locale])) {
        for (const [key, value] of Object.entries(values)) {
          if (typeof value === "string") expect(REVIEW_PROMISE.test(value), `${locale} ${ns}.${key}`).toBe(false);
        }
      }
    }
  });
});
