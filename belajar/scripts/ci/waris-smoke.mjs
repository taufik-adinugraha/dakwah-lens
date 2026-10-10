// CI-only: smoke checks of the Ilmu Waris routes on the REAL image (the workflow's smoke step
// starts it on :3300), docs/waris-plan.md §10 M2.7 and M2.13, §9.1 routes, §9.4 privacy.
//
// For /belajar/{id,en}/waris, …/waris/hitung and …/waris/laporan:
//   - 200, and noindex (the module is a noindex beta; a report is personal);
//   - the AI chip ("Dibantu AI · bukan fatwa" on /id; each page's own chip from
//     messages/waris/en.json on /en, which keeps the Indonesian words), "bukan fatwa" on every
//     waris page in both locales (M2.7), and on /id the D16 label
//     "Dibantu AI, bukan fatwa otoritatif, bukan penetapan pengadilan";
//   - none of the review phrases (lib/waris/checks/report.ts FORBIDDEN_REVIEW: there is no human
//     review, plan §2 "Decisions taken") anywhere in the page's VISIBLE text. <script>, <style>
//     and <template> bodies are removed first: next-intl serialises the whole message catalogue
//     (other tracks' "menunggu tinjauan ustadz" included) into every page's scripts, and that is
//     not text anyone reads. A hit outside <main> is the shared layout (header or footer: the
//     footer shows the track's own label on /waris pages, components/FooterDisclaimer.tsx);
//   - no <form> (no server path for answers, plan §9.4).
// Plus: unknown waris paths answer the module's 404; the hub card links to the track and carries
// the chip; the track links to the calculator.
//
// Every problem is listed, then the script exits 1. Node 20+ (global fetch), no dependencies.
import { readFile } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
const BELAJAR = new URL("../../", import.meta.url);
const readJson = async (rel) => JSON.parse(await readFile(new URL(rel, BELAJAR), "utf8"));

const problems = [];
const fail = (where, msg) => {
  problems.push(`${where}: ${msg}`);
  console.log(`✗ ${where}: ${msg}`);
};

// The forbidden list has one home (the report checks); read it rather than retype it.
async function forbiddenPhrases() {
  const src = await readFile(new URL("src/lib/waris/checks/report.ts", BELAJAR), "utf8");
  const m = /export const FORBIDDEN_REVIEW = \[([^\]]*)\]/.exec(src);
  const list = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1].toLowerCase()) : [];
  if (list.length === 0) {
    fail("setup", "could not read FORBIDDEN_REVIEW from src/lib/waris/checks/report.ts");
    return ["tinjauan ustadz", "ditinjau ustadz", "awaiting ustadz", "reviewed by an ustadz"];
  }
  return list;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, " ");
}
const mainOf = (html) => /<main\b[^>]*>([\s\S]*)<\/main>/i.exec(html)?.[1] ?? "";

async function get(path) {
  const res = await fetch(BASE + path, { redirect: "manual" });
  return { status: res.status, html: await res.text() };
}

const msgs = { id: await readJson("messages/waris/id.json"), en: await readJson("messages/waris/en.json") };
const FORBIDDEN = await forbiddenPhrases();
const LABEL_ID = "Dibantu AI, bukan fatwa otoritatif, bukan penetapan pengadilan";

const chipOf = (locale, page) => {
  const m = msgs[locale];
  if (page === "track") return m.Track?.chip;
  if (page === "hitung") return m.Q?.halaman?.chip;
  return m.Report?.laporan?.kepala?.chip ?? "Dibantu AI · bukan fatwa";
};

const PAGES = [
  ["track", "/waris"],
  ["hitung", "/waris/hitung"],
  ["laporan", "/waris/laporan"],
];

for (const locale of ["id", "en"]) {
  for (const [page, sub] of PAGES) {
    const path = `/belajar/${locale}${sub}`;
    const { status, html } = await get(path);
    console.log(`${path} -> ${status}`);
    if (status !== 200) {
      fail(path, `status ${status}, expected 200`);
      continue;
    }
    if (!/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(html)) fail(path, "no noindex robots meta");
    if (/<form\b/i.test(html)) fail(path, "contains a <form> (no server path for answers, plan §9.4)");
    const text = visibleText(html);
    const chip = chipOf(locale, page);
    if (!chip) fail(path, `no chip text in messages/waris/${locale}.json`);
    else if (!text.includes(chip)) fail(path, `AI chip "${chip}" not in the visible text`);
    if (!text.includes("bukan fatwa")) fail(path, '"bukan fatwa" not in the visible text');
    if (locale === "id" && !text.includes(LABEL_ID)) fail(path, `label "${LABEL_ID}" not in the visible text`);
    const lower = text.toLowerCase();
    const inMain = visibleText(mainOf(html)).toLowerCase();
    for (const f of FORBIDDEN) {
      if (!lower.includes(f)) continue;
      const i = lower.indexOf(f);
      const where = inMain.includes(f) ? "in <main>" : "outside <main>, in the shared layout (header/footer, messages/{id,en}.json Footer)";
      fail(path, `visible text contains the forbidden "${f}" ${where}: "…${text.slice(Math.max(0, i - 70), i + f.length + 20).trim()}…"`);
    }
  }
}

// Unknown paths under the track: the module's own 404, never a 500 (plan §9.1).
for (const path of ["/belajar/id/waris/tidak-ada", "/belajar/en/waris/hitung/x", "/belajar/id/waris/laporan/x"]) {
  const { status } = await get(path);
  console.log(`${path} -> ${status}`);
  if (status !== 404) fail(path, `status ${status}, expected 404`);
}

// The hub card (M2.13) and the track's door to the calculator.
{
  const hub = await get("/belajar/id");
  if (!hub.html.includes('href="/belajar/id/waris"')) fail("/belajar/id", "the hub does not link to /belajar/id/waris");
  if (!visibleText(hub.html).includes(chipOf("id", "track"))) fail("/belajar/id", `the hub card lacks the chip "${chipOf("id", "track")}"`);
  const track = await get("/belajar/id/waris");
  if (!track.html.includes('href="/belajar/id/waris/hitung"')) fail("/belajar/id/waris", "the track does not link to /belajar/id/waris/hitung");
}

if (problems.length > 0) {
  console.log(`\n✗ waris smoke: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("✓ waris smoke: routes, labels, noindex, 404s and links OK");
