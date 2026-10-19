import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReminderCard } from "@/components/lesson/ReminderCard";
import { mergeReminders, parseNarrationManifest, reminderAyat, reminderProblems, reminderTexts, type ReminderAyah } from "@/lib/autoplay";
import { SURAHS } from "@/lib/content";

import en from "../../../messages/en.json";
import id from "../../../messages/id.json";

import { stageSequence } from "./build";
import { narrationFor } from "./manifests";

// THE REMINDER CARD (operator 2026-10-18: "in some ayat it's explain like this: it becomes na'at
// from lafaz Allah in ayat-2, better to remind user what that previous ayat looks like and give
// more clear explanation. check any similar cases"). The pipeline writes, on every line that says
// a continuation or cites a word of an earlier ayah, which earlier ayah the stage shows and which
// of its words it highlights (manifest `reminder`, pipeline/validate_narration.py reminder_of, held
// to the `continues` data there). Here: that data → the card (src/lib/autoplay/reminder.ts) for
// every such line of the four surahs, the sequence's cues, the card's markup, the stage wiring.
// That a browser DRAWS it within the phone's room is scripts/ci/screenshots.mjs reminderChecks'.

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const MSG = { id, en } as const;
const render = (locale: keyof typeof MSG, cards: ReminderAyah[]) => {
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: MSG[locale], timeZone: "Asia/Jakarta", children: createElement(ReminderCard, { cards }) };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl));
};

describe("the reminder card: from the manifest's data to what the stage shows", () => {
  it("every line that carries a card shows an EARLIER ayah of its surah, its words in the content's bytes, the cited words highlighted, its own translation", () => {
    let lines = 0;
    for (const s of SURAHS) {
      const man = narrationFor(s.slug);
      for (const [lid, line] of Object.entries(man?.lines ?? {})) {
        if (!line.reminder) continue;
        lines++;
        const ayah = Number(lid.split(":")[1]);
        expect(reminderProblems(line.reminder, s, ayah), lid).toEqual([]);
        // Never on an exercise's line: the stage shows the exercise there.
        expect(lid, lid).not.toMatch(/:ex:/);
        const cards = reminderAyat(line.reminder, reminderTexts({ steps: [{ cues: [{ reminder: line.reminder }] }] }, s));
        expect(cards.map((c) => c.ayah), lid).toEqual(line.reminder.map((r) => r.ayah));
        for (const c of cards) {
          const a = s.ayat.find((x) => x.ayah === c.ayah)!;
          expect(c.words.map((w) => w.ar), lid).toEqual(a.words.map((w) => w.ar));
          expect(c.words.filter((w) => w.hit).map((w) => w.n), lid).toEqual(line.reminder.find((r) => r.ayah === c.ayah)!.words);
          expect(c.translation, lid).toBe(a.translation.text);
        }
      }
    }
    // Al-Fatihah 10, Al-Ikhlas 5, Al-Falaq 10, An-Nas 10 (the rendered list in the README).
    expect(lines).toBe(35);
  });

  it("every ayah that continues an earlier one has its card: the structure part's opening shows the ayah it continues", () => {
    let ayat = 0;
    for (const s of SURAHS) {
      const lines = narrationFor(s.slug)?.lines ?? {};
      for (const a of s.ayat) {
        const opening = Object.entries(lines).find(([lid, l]) => lid.startsWith(`${s.slug}:${a.ayah}:structure`) && /\b[Aa]yat ini (?:masih )?melanjutkan ayat\b/.test(l.display ?? ""));
        // The lesson's own words for a continuation (its structure type, the README's 15 ayat).
        const continues = /^\s*lanjutan\b/.test(a.structure?.type ?? "") || !!opening;
        if (!continues) {
          for (const [lid, l] of Object.entries(lines)) if (lid.startsWith(`${s.slug}:${a.ayah}:`)) expect(l.reminder, lid).toBeUndefined();
          continue;
        }
        ayat++;
        expect(opening, `${s.slug} ${a.ayah}`).toBeDefined();
        const said = /melanjutkan ayat (pertama|kedua|ketiga|keempat|kelima|keenam)/.exec(opening![1].display!)![1];
        const n = ["pertama", "kedua", "ketiga", "keempat", "kelima", "keenam"].indexOf(said) + 1;
        expect(opening![1].reminder?.map((r) => r.ayah), `${s.slug} ${a.ayah}`).toContain(n);
      }
    }
    expect(ayat).toBe(15);
  });

  it("the sequence's cues carry the card (split parts merged), never on an exercise; the page hands over exactly those ayat", () => {
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const seq = stageSequence(s, a, "id");
        const lines = narrationFor(s.slug)?.lines ?? {};
        for (const st of seq.steps) {
          for (const c of st.cues) {
            const parts = Object.entries(lines).filter(([lid]) => lid === c.line || (lid.startsWith(`${c.line}:`) && lid.length === c.line.length + 2));
            expect(c.reminder, c.line).toEqual(mergeReminders(parts.map(([, l]) => l.reminder)));
            if (st.kind === "exercise") expect(c.reminder, c.line).toBeNull();
          }
        }
        const texts = reminderTexts(seq, s);
        const want = new Set(seq.steps.flatMap((st) => st.cues.flatMap((c) => (c.reminder ?? []).map((r) => r.ayah))));
        expect(Object.keys(texts).map(Number).sort(), `${s.slug} ${a.ayah}`).toEqual([...want].sort());
      }
    }
    // An English page has no narration (its captions are the engine's own, which cite no word):
    // no card there.
    const fatihah = SURAHS.find((s) => s.slug === "al-fatihah")!;
    const en3 = stageSequence(fatihah, fatihah.ayat[2], "en");
    expect(en3.steps.flatMap((st) => st.cues).filter((c) => c.reminder).length).toBe(0);
  });

  it("Al-Fatihah 3: “Ayat ini melanjutkan ayat kedua.” shows ayah 2 with لِلَّهِ highlighted and its translation", () => {
    const s = SURAHS.find((x) => x.slug === "al-fatihah")!;
    const line = narrationFor("al-fatihah")!.lines["al-fatihah:3:structure:1"];
    expect(line.reminder).toEqual([{ ayah: 2, words: [2] }]);
    const [card] = reminderAyat(line.reminder, reminderTexts({ steps: [{ cues: [{ reminder: line.reminder! }] }] }, s));
    const a2 = s.ayat[1];
    expect(card.words.map((w) => [w.ar, w.hit])).toEqual(a2.words.map((w, i) => [w.ar, i === 1]));
    expect(card.translation).toBe(a2.translation.text);
    // The word lines that cite it carry the same card; the one that says why it ends in kasrah too.
    for (const lid of ["al-fatihah:3:w1:compose:4", "al-fatihah:3:w1:compose:5", "al-fatihah:3:w2:compose:4", "al-fatihah:4:w1:compose:2", "al-fatihah:4:structure:1"]) {
      expect(narrationFor("al-fatihah")!.lines[lid].reminder, lid).toEqual([{ ayah: 2, words: [2] }]);
    }
    for (const lid of ["al-fatihah:7:w1:compose:3", "al-fatihah:7:structure:1"]) expect(narrationFor("al-fatihah")!.lines[lid].reminder, lid).toEqual([{ ayah: 6, words: [2] }]);
    // Two earlier ayat on one line (Al-Falaq 3: 'athaf on min syarri of ayah 2, which hangs on a‘ūżu of ayah 1).
    expect(narrationFor("al-falaq")!.lines["al-falaq:3:w1"].reminder).toEqual([
      { ayah: 1, words: [2] },
      { ayah: 2, words: [1, 2] },
    ]);
  });

  it("planted faults: a card of a later ayah, a word the ayah does not have, two cards out of order; a manifest with a malformed card", () => {
    const s = SURAHS.find((x) => x.slug === "al-fatihah")!;
    expect(reminderProblems([{ ayah: 2, words: [2] }], s, 3)).toEqual([]);
    expect(reminderProblems([{ ayah: 3, words: [1] }], s, 3).join()).toContain("no earlier ayah");
    expect(reminderProblems([{ ayah: 2, words: [9] }], s, 3).join()).toContain("that ayah has 4 words");
    expect(reminderProblems([{ ayah: 2, words: [] }], s, 3).join()).toContain("highlights word(s)");
    expect(reminderProblems([{ ayah: 6, words: [2] }, { ayah: 2, words: [2] }], s, 7).join()).toContain("not one per ayah in order");
    const raw = { version: 2, voice: null, lines: { "al-fatihah:3:structure:1": { text: "x", display: "x", highlight: [1], focus: null, reminder: [{ ayah: 2 }] } } };
    expect(parseNarrationManifest(raw).problems.join()).toContain("reminder must be a non-empty list of { ayah, words }");
  });
});

describe("the reminder card's markup", () => {
  const s = SURAHS.find((x) => x.slug === "al-fatihah")!;
  const cards = reminderAyat([{ ayah: 2, words: [2] }], reminderTexts({ steps: [{ cues: [{ reminder: [{ ayah: 2, words: [2] }] }] }] }, s));

  it("“Ayat 2”, its words right to left in the mushaf face, each a box with room for its marks, the cited word highlighted (not by colour alone), the marker on the last word, the translation", () => {
    const html = render("id", cards);
    expect(html).toContain('data-autoplay="reminder"');
    expect(html).toContain('data-reminder-ayat="2"');
    expect(html).toContain('data-reminder-ayah="2"');
    expect(html).toContain(id.Guided.reminder_ayah.replace("{n}", "2"));
    expect(html).toContain(`aria-label="${id.Guided.reminder_label}"`);
    expect(html).toMatch(/<p dir="rtl" class="quran [^"]*"/);
    const words = [...html.matchAll(/<span lang="ar" data-reminder-word="(\d+)"( data-reminder-hit="true")? class="([^"]*)">([^<]*)<\/span>/g)];
    expect(words.map((m) => m[4])).toEqual(s.ayat[1].words.map((w) => w.ar));
    expect(words.filter((m) => m[2]).map((m) => m[1])).toEqual(["2"]);
    for (const m of words) {
      expect(m[3].split(" "), m[4]).toEqual(expect.arrayContaining(["ar-clear", "inline-block", "whitespace-nowrap"]));
      // The highlight is a border, a tint and a ring: a shape, never colour alone.
      if (m[2]) expect(m[3].split(" ")).toEqual(expect.arrayContaining(["border-forest", "ring-2"]));
    }
    // The ayah marker is glued to the last word (it never starts a row of its own).
    expect(html).toMatch(/<span class="inline-flex items-center gap-x-1\.5 whitespace-nowrap"><span lang="ar" data-reminder-word="4"[^>]*>[^<]*<\/span><span aria-hidden="true" lang="ar" class="ar-clear[^"]*">﴿٢﴾<\/span><\/span>/);
    expect(html).toContain("data-reminder-translation");
    expect(html.replace(/<[^>]+>/g, "")).toContain(s.ayat[1].translation.text);
    // English labels on an English page; the content stays the content.
    expect(render("en", cards)).toContain(en.Guided.reminder_ayah.replace("{n}", "2"));
  });

  it("the stage shows it in the word card's slot while such a line is on, never during an exercise; the page passes the ayat it needs", () => {
    const stage = readFileSync(join(BELAJAR, "src/components/lesson/LessonStage.tsx"), "utf8");
    expect(stage).toContain("reminderAyat(cueOnScreen?.reminder, reminders)");
    expect(stage).toMatch(/live && !spec && step\.kind !== "exercise" \? reminderAyat/);
    expect(stage).toContain("<ReminderCard cards={reminderCards} />");
    // It comes before the composition, the item card and the word card in the slot's choice.
    expect(stage.indexOf("reminderCards.length ? (")).toBeLessThan(stage.indexOf(") : anim && ap.frame && compose ? ("));
    const page = readFileSync(join(BELAJAR, "src/app/[locale]/quran/[surah]/[ayah]/page.tsx"), "utf8");
    expect(page).toContain("reminderTexts(seq, s)");
    expect(page).toContain("reminders={reminders}");
  });
});
