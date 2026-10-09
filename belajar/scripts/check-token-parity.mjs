// The module copies the main site's design tokens (paper/ink/forest…) so it
// reads as the same site. Fail CI if a shared token drifts from web/.
import { readFile } from "node:fs/promises";

const SHARED = [
  "--color-paper",
  "--color-paper-deep",
  "--color-ink",
  "--color-ink-muted",
  "--color-ink-faint",
  "--color-hairline",
  "--color-forest",
  "--color-forest-hover",
  "--color-forest-tint",
  "--font-arabic",
  "--font-display",
  "--font-body",
];

const read = async (p) => readFile(new URL(p, import.meta.url), "utf8");
const web = await read("../../web/src/app/globals.css");
const mine = await read("../src/app/globals.css");

const value = (css, token) =>
  css.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim() ?? null;

const drift = SHARED.filter((tok) => value(web, tok) !== value(mine, tok)).map(
  (tok) => `${tok}: web=${value(web, tok)} belajar=${value(mine, tok)}`,
);
if (drift.length) {
  console.error("Design-token drift between web/ and belajar/:\n" + drift.join("\n"));
  process.exit(1);
}
console.log(`token parity ok (${SHARED.length} tokens)`);
