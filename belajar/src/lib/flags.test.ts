import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { isPublic } from "./flags";

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");

const saved = process.env.BELAJAR_PUBLIC;
afterEach(() => {
  if (saved === undefined) delete process.env.BELAJAR_PUBLIC;
  else process.env.BELAJAR_PUBLIC = saved;
});

describe("BELAJAR_PUBLIC (operator 2026-11-26: publish Belajar; docs/belajar-plan.md L42)", () => {
  it("is public for the exact value true and private for everything else, read per call", () => {
    process.env.BELAJAR_PUBLIC = "true";
    expect(isPublic()).toBe(true);
    for (const value of [undefined, "", "false", "TRUE", "True", "1", "on", " true"]) {
      if (value === undefined) delete process.env.BELAJAR_PUBLIC;
      else process.env.BELAJAR_PUBLIC = value;
      expect(isPublic(), JSON.stringify(value)).toBe(false);
    }
    // A kill switch has to work on a running process: not a constant captured at load.
    process.env.BELAJAR_PUBLIC = "true";
    expect(isPublic()).toBe(true);
    process.env.BELAJAR_PUBLIC = "false";
    expect(isPublic()).toBe(false);
  });

  it("ships public from the Dockerfile's default, in BOTH stages, so what CI tests is what runs", () => {
    const dockerfile = read("Dockerfile");
    // The builder prerenders the lesson pages with it; the runner's proxy, sitemap and request-time
    // pages read it at run time (an ARG is scoped to its stage, so each stage declares it).
    expect(dockerfile.match(/^ARG BELAJAR_PUBLIC=true$/gm)).toHaveLength(2);
    expect(dockerfile.match(/^ENV BELAJAR_PUBLIC=\$BELAJAR_PUBLIC$/gm)).toHaveLength(2);
    const stages = dockerfile.split(/^FROM /m).slice(1);
    expect(stages).toHaveLength(3);
    expect(stages[1]).toContain("AS builder");
    expect(stages[2]).toContain("AS runner");
    for (const stage of [stages[1], stages[2]]) expect(stage).toMatch(/ARG BELAJAR_PUBLIC=true[\s\S]*ENV BELAJAR_PUBLIC=\$BELAJAR_PUBLIC/);
    // Nothing keeps the old default (private).
    expect(dockerfile).not.toMatch(/^(?:ARG|ENV) BELAJAR_PUBLIC=false/m);
  });

  it("is built once by CI, with no build argument of its own, and that one image is tested and shipped", () => {
    const wf = join(BELAJAR, "..", ".github", "workflows", "deploy-belajar.yml");
    if (!existsSync(wf)) return;
    const yaml = readFileSync(wf, "utf8");
    expect(yaml).not.toMatch(/--build-arg\s+BELAJAR_PUBLIC/);
    expect(yaml.match(/docker build\b/g)).toHaveLength(1);
    // The browser jobs and the release load the artifact the image job saved.
    expect(yaml).toContain("docker save dakwah-belajar-web:latest");
    expect(yaml.match(/name: belajar-image/g)!.length).toBeGreaterThanOrEqual(5);
    // None of the containers CI starts turns the flag off, nor says it on (the image's own default is under test).
    expect(yaml).not.toMatch(/-e BELAJAR_PUBLIC/);
  });

  it("no longer refuses a build for a record marked draft, in any of the three places it did", () => {
    for (const rel of ["src/lib/content.ts", "src/lib/library.ts", "src/lib/kosakata.ts"]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/IS_PUBLIC|BELAJAR_PUBLIC build refused|hasDrafts|libraryHasDrafts/);
    }
    expect(read("src/lib/content.ts")).toContain("assertPublishable(s, ");
    expect(read("src/lib/library.ts")).toContain('assertPublishable(parsed.data, "content/library.json")');
  });
});
