// CI-only: the line-break check's self-test fixture (linebreaks-fixture.html; line breaks, operator
// 2026-10-10). Its {{…}} slots are filled from the pronunciation dictionary and the lesson content
// — content bytes, never Arabic typed into a test. Shared by linebreaks.mjs, which lays the
// fixture out in a real page before the real run, and linebreaks-fixture.test.mjs, which checks
// that its good cases are exactly what MixedText renders and that it has a bad case for every
// kind the check reports. The workflow copies this file and the fixture next to linebreaks.mjs.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const FIXTURE = new URL("./linebreaks-fixture.html", import.meta.url);

/** The slot values: a two-word term (TERM), the longest two-word term (WIDE), a one-word term
 *  (ONE) and its Arabic cut in two at a grapheme boundary (HALF1, HALF2), and a quotation of four
 *  words (QUOTE: Al-Fatihah 2, word by word). */
export async function fixtureValues(belajarDir) {
  const read = async (rel) => JSON.parse(await readFile(path.join(belajarDir, rel), "utf8"));
  const dict = await read("pipeline/authored/pronunciation.json");
  const terms = dict.terms
    .map((t) => /^(.+) \(([^()]+)\)$/u.exec(t.display))
    .filter(Boolean)
    .map(([display, latin, ar]) => ({ display, latin: latin.split(" "), ar }));
  const two = terms.filter((t) => t.latin.length === 2 && t.ar.split(" ").length === 2);
  const term = two[0];
  const wide = two.reduce((a, b) => (b.display.length > a.display.length ? b : a), two[0]);
  const one = terms.find((t) => t.latin.length === 1 && !t.ar.includes(" ") && t.ar.length >= 4);
  if (!term || !one) throw new Error("self-test fixture: the pronunciation dictionary has no usable terms");
  const g = [...new Intl.Segmenter("ar", { granularity: "grapheme" }).segment(one.ar)].map((x) => x.segment);
  const fatihah = await read("content/al-fatihah.json");
  const quote = fatihah.ayat[1].words.map((w) => w.ar).join(" ");
  return {
    "TERM.display": term.display,
    "TERM.lead": term.latin[0],
    "TERM.last": term.latin[1],
    "TERM.ar": term.ar,
    "TERM.w1": term.ar.split(" ")[0],
    "TERM.w2": term.ar.split(" ")[1],
    "WIDE.display": wide.display,
    "WIDE.lead": wide.latin[0],
    "WIDE.last": wide.latin[1],
    "WIDE.ar": wide.ar,
    "ONE.latin": one.latin[0],
    "ONE.ar": one.ar,
    HALF1: g.slice(0, g.length >> 1).join(""),
    HALF2: g.slice(g.length >> 1).join(""),
    QUOTE: quote,
  };
}

/** `html` with every {{name}} replaced; a name with no value is an error, never left in. */
export function fillSlots(html, values) {
  return html.replace(/\{\{([\w.]+)\}\}/g, (_, name) => {
    if (!(name in values)) throw new Error(`self-test fixture: no value for {{${name}}}`);
    return values[name];
  });
}

/** The filled fixture: its markup between <body> and </body>. */
export async function loadFixture(belajarDir) {
  const html = fillSlots(await readFile(FIXTURE, "utf8"), await fixtureValues(belajarDir));
  const body = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!body) throw new Error("self-test fixture: no <body>");
  return body[1];
}

/** The cases of a filled fixture body, parsed without a DOM: name, the kinds it expects, how it
 *  is sized (data-fit), and each MixedText rendering it holds (`text` → `html`). */
export function fixtureCases(body) {
  const cases = [];
  for (const m of body.matchAll(/<section data-case="([^"]+)" data-expect="([^"]*)"([^>]*)>([\s\S]*?)<\/section>/g)) {
    const mixed = [...m[4].matchAll(/<span data-mixed="([^"]*)" style="display:contents">([\s\S]*?)<\/span><!--\/mixed-->/g)].map(
      ([, text, html]) => ({ text, html }),
    );
    cases.push({ name: m[1], expect: m[2].split(/\s+/).filter(Boolean), fit: /data-fit="(\w+)"/.exec(m[4])?.[1] ?? null, mixed });
  }
  return cases;
}
