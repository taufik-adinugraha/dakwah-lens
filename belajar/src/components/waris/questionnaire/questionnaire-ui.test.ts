/**
 * The questionnaire UI's pure layer (checks.ts): message files, the server-built rule pack, and
 * seeded walks through the reducer as the UI drives it (privacy of k6, answer texts, the family
 * tree, "Langkah"). CI walks 200 seeded families; the acceptance run used the same functions with
 * 2,000 families on seeds 20261012 and 777 (0 failures each).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import dalilFile from "../../../../content/waris/dalil.json";
import gapsFile from "../../../../content/waris/dalil-gaps.json";
import rulesFile from "../../../../content/waris/rules.json";
import en from "../../../../messages/waris/en.json";
import id from "../../../../messages/waris/id.json";
import { flatten, runMessageChecks, runRulePackChecks, runWalkChecks } from "./checks";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PAGE = join(HERE, "../../../app/[locale]/waris/hitung/page.tsx");

function uiSources(): string[] {
  const files = readdirSync(HERE)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts") && f !== "checks.ts")
    .map((f) => join(HERE, f));
  return [...files, PAGE].map((f) => readFileSync(f, "utf8"));
}

type Json = { [k: string]: unknown };
const records = [...(dalilFile as unknown as Json[]), ...(gapsFile as unknown as Json[])] as unknown as Parameters<typeof runRulePackChecks>[1];
const rules = rulesFile as unknown as Parameters<typeof runRulePackChecks>[0];

describe("waris questionnaire UI", () => {
  it("messages: Q_TEXT 1:1 in both locales, id/en key parity, every used key exists, copy rules", () => {
    expect(runMessageChecks(id as Json, en as Json, uiSources()).failures).toEqual([]);
  });

  it("rule pack: every RuleNote present, Arabic rebuilt byte for byte, nothing never-shown or review-promising", () => {
    expect(runRulePackChecks(rules, records).failures).toEqual([]);
  });

  it("walks: answers read back, the tree counts everyone once, k6 never stored or linked", () => {
    const qKeys = new Set(Object.keys(flatten((id as Json).Q)));
    const r = runWalkChecks({ count: 200, seed: 20261012, qKeys });
    expect(r.failures).toEqual([]);
    expect(r.reviews).toBeGreaterThan(0);
  }, 120000);

  it("no network or form submission in the questionnaire UI (plan §9.4)", () => {
    for (const src of uiSources()) {
      // code only: the comments describe what is banned
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|<form\b|"use server"|action=/);
    }
  });
});
