/**
 * Where the report's answers come from (source.ts): a share link seen on the page is latched (a
 * jump that rewrites the hash keeps the report), but a hand-off from the questionnaire is always
 * newer and wins. Regression: link → "Ubah jawaban" → edit → "Lihat rekomendasi" (no fragment)
 * showed the link's old family. No DOM: a minimal window stub (node environment).
 */
import { afterEach, describe, expect, it } from "vitest";

import { fragmentFor, shareToken, type Answers, type QState } from "@/lib/waris/questionnaire";

import { __sourceInternals, clearAnswers, handOffToReport } from "./source";

const { subscribe, snapshot, parse } = __sourceInternals;

const A: Answers = { A1: "wafat_muslim", A2: "L", A3: [], B1: "ya_satu", B1b: "tidak", C1: { L: 1, P: 0 } };
const B: Answers = { A1: "wafat_muslim", A2: "L", A3: [], B1: "pernah", B1b: "tidak", C1: { L: 1, P: 0 } };
const state = (answers: Answers): QState => ({ v: 1, answers, at: null });

type Stub = { location: { hash: string; pathname: string; search: string } };

function stubWindow(hash: string): Stub {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const w = {
    location: { hash, pathname: "/belajar/id/waris/laporan", search: "" },
    addEventListener: () => {},
    removeEventListener: () => {},
    sessionStorage: storage,
    localStorage: storage,
    history: { replaceState: () => {} },
  };
  (globalThis as unknown as { window: unknown }).window = w;
  return w;
}

afterEach(() => {
  clearAnswers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("report answer source", () => {
  it("a latched link survives a hash jump, and a later hand-off from the questionnaire replaces it", () => {
    const w = stubWindow(`#${fragmentFor(shareToken(state(A)))}`);
    const unsubscribe = subscribe(() => {});
    w.location.hash = "#isi"; // the layout's skip link rewrites the hash
    const first = parse(snapshot());
    expect(first.status === "ada" && first.from).toBe("tautan");
    expect(first.status === "ada" && first.answers.B1).toBe("ya_satu");

    // "Ubah jawaban" → the questionnaire loads the link, the user edits B1, "Lihat rekomendasi"
    w.location.hash = "";
    handOffToReport(B);
    const second = parse(snapshot());
    expect(second.status === "ada" && second.from).toBe("memori");
    expect(second.status === "ada" && second.answers.B1).toBe("pernah");
    unsubscribe();
  });
});
