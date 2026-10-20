import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

// connection() needs a live Next request; here the "request" is a hook the tests set.
const request = vi.hoisted(() => ({ arrive: (): void => undefined }));
vi.mock("next/server", () => ({ connection: async () => request.arrive() }));

import { publishedSurahs, reachableSurahs, unlistedSurahs, visibleSurahs, warisSwitchOn, warisVisible } from "./features";

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");

const saved = process.env.BELAJAR_WARIS;
function setSwitch(value: string | undefined) {
  if (value === undefined) delete process.env.BELAJAR_WARIS;
  else process.env.BELAJAR_WARIS = value;
}
afterEach(() => {
  setSwitch(saved);
  request.arrive = () => undefined;
});

describe("BELAJAR_WARIS (operator, 2026-10-10: Ilmu Waris hidden until shown again)", () => {
  it("shows the track for BELAJAR_WARIS=on only; unset (production) hides it", () => {
    setSwitch("on");
    expect(warisSwitchOn()).toBe(true);
    for (const v of [undefined, "", "off", "true", "1", "ON", " on"]) {
      setSwitch(v);
      expect(warisSwitchOn(), JSON.stringify(v)).toBe(false);
    }
  });

  it("pages read it only after connection(), so a prerender never bakes the build's value", async () => {
    setSwitch(undefined);
    request.arrive = () => setSwitch("on");
    expect(await warisVisible()).toBe(true);
  });

  it("the proxy gates the routes and the hub card waits for the switch", () => {
    const proxy = read("src/proxy.ts");
    expect(proxy).toContain("warisSwitchOn()");
    expect(proxy).toContain("NextResponse.rewrite(");
    const hub = read("src/app/[locale]/page.tsx");
    const gate = hub.indexOf("await warisVisible()");
    expect(gate).toBeGreaterThan(-1);
    expect(hub.indexOf("warisHref.track()")).toBeGreaterThan(gate);
  });

  it("nothing outside the track links into it but the hub's gated card", () => {
    const inTrack = /^(src\/app\/\[locale\]\/waris\/|src\/components\/waris\/|src\/lib\/waris\/)/;
    const allowed = new Set(["src/lib/routes.ts", "src/app/[locale]/page.tsx"]);
    const files = readdirSync(join(BELAJAR, "src"), { recursive: true, encoding: "utf8" })
      .map((f) => `src/${f.split("\\").join("/")}`)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && !inTrack.test(f) && !allowed.has(f));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(read(f), f).not.toContain("warisHref");
  });
});

describe("BELAJAR_SURAHS (operator, 2026-10-10: Al-Fatihah first, the Mu'awwidzat \"segera hadir\")", () => {
  const savedSurahs = process.env.BELAJAR_SURAHS;
  afterEach(() => {
    if (savedSurahs === undefined) delete process.env.BELAJAR_SURAHS;
    else process.env.BELAJAR_SURAHS = savedSurahs;
  });

  it("pages read it only after connection(), so a prerender never bakes the build's value", async () => {
    delete process.env.BELAJAR_SURAHS;
    expect(publishedSurahs()).toEqual(["al-fatihah"]);
    request.arrive = () => {
      process.env.BELAJAR_SURAHS = "al-fatihah,an-nas";
    };
    expect(await visibleSurahs()).toEqual(["al-fatihah", "an-nas"]);
  });
});

describe("BELAJAR_UNLISTED (operator, 2026-10-20: Al-Ikhlas answers at its address, linked from nowhere)", () => {
  const savedSurahs = process.env.BELAJAR_SURAHS;
  const savedUnlisted = process.env.BELAJAR_UNLISTED;
  afterEach(() => {
    if (savedSurahs === undefined) delete process.env.BELAJAR_SURAHS;
    else process.env.BELAJAR_SURAHS = savedSurahs;
    if (savedUnlisted === undefined) delete process.env.BELAJAR_UNLISTED;
    else process.env.BELAJAR_UNLISTED = savedUnlisted;
  });

  it("is Al-Ikhlas by default: reachable, never published", () => {
    delete process.env.BELAJAR_SURAHS;
    delete process.env.BELAJAR_UNLISTED;
    expect(unlistedSurahs()).toEqual(["al-ikhlas"]);
    expect(publishedSurahs()).toEqual(["al-fatihah"]);
    expect(reachableSurahs()).toEqual(["al-fatihah", "al-ikhlas"]);
  });

  it("is only a listing of what the switch does not publish: publishing it takes it off the list", () => {
    process.env.BELAJAR_SURAHS = "al-fatihah,al-ikhlas";
    delete process.env.BELAJAR_UNLISTED;
    expect(unlistedSurahs()).toEqual([]);
    expect(publishedSurahs()).toEqual(["al-fatihah", "al-ikhlas"]);
    expect(reachableSurahs()).toEqual(["al-fatihah", "al-ikhlas"]);
  });

  it("is the list when set (trimmed, lower-cased, unknown slugs ignored); empty means none", () => {
    delete process.env.BELAJAR_SURAHS;
    process.env.BELAJAR_UNLISTED = " AN-NAS, al-falaq ,semua";
    expect(unlistedSurahs()).toEqual(["al-falaq", "an-nas"]);
    process.env.BELAJAR_UNLISTED = "";
    expect(unlistedSurahs()).toEqual([]);
    expect(reachableSurahs()).toEqual(["al-fatihah"]);
  });

  it("never reaches a page that lists or links: visibleSurahs() stays the published set", async () => {
    delete process.env.BELAJAR_SURAHS;
    delete process.env.BELAJAR_UNLISTED;
    expect(await visibleSurahs()).toEqual(["al-fatihah"]);
  });
});
