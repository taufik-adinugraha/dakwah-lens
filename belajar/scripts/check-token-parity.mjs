// The module copies the main site's design tokens (paper/ink/forest…) so it
// reads as the same site. Fail CI if a shared token drifts from web/.
//
// Not shared on purpose: --color-ink-muted and --color-ink-faint. Many of the
// module's learners are 60+, so the senior-readability audit
// (docs/belajar-research/senior-ux.md §1, §3.2) darkens ink-muted here
// (#4a4840, AAA on every background) and drops ink-faint entirely: web/'s
// faint grey measured 3.17–3.56:1, failing WCAG AA on every background the
// module uses. Secondary text uses the module-only --color-ink-soft instead.
// Every other colour and font token below must stay identical to web/.
import { readFile } from "node:fs/promises";

const SHARED = [
  "--color-paper",
  "--color-paper-deep",
  "--color-ink",
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
