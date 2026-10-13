import { describe, expect, it } from "vitest";

import { MAX_STEPS_PER_LESSON, type CurriculumFile } from "./autoplay/curriculum";
import { SURAHS } from "./content";
import { CURRICULUM } from "./curriculum";
import { curriculumOutline } from "./curriculumOutline";
import { DEFAULT_SURAHS } from "./features";
import { LIBRARY } from "./library";
import { ayahHref, SURAH_SLUGS } from "./routes";

// THE CURRICULUM AS ITS PAGE READS IT (operator 2026-10-13: "we should also explain this curriculum
// in the page"; docs/belajar-plan.md L27). curriculumOutline turns content/curriculum.json into
// what /quran/kurikulum draws. Everything here is held to THE FILE, not to numbers typed in a test
// (the lessons are being reworked to the curriculum; the file is the one place that says which
// lesson teaches what): every lesson once, in order; a lesson's new steps and running total; the
// derived "comes up again" list only where the file has one; and which lessons may be links.

const PAGES: ReadonlySet<string> = new Set([...LIBRARY.basics.map((b) => b.id), ...LIBRARY.concepts.map((c) => c.id)]);
const outline = (published: readonly string[], file: Parameters<typeof curriculumOutline>[0] = CURRICULUM) =>
  curriculumOutline(file, { published: new Set(published), pages: PAGES });
const lessonsOf = (o: ReturnType<typeof outline>) => o.units.flatMap((u) => u.lessons);
const step = (id: string) => CURRICULUM.steps.find((s) => s.id === id)!;
const unitOf = (lessonId: string) => CURRICULUM.units.find((u) => u.id === CURRICULUM.lessons.find((l) => l.id === lessonId)!.unit)!;

describe("curriculumOutline: content/curriculum.json as the curriculum page lists it", () => {
  const o = outline(DEFAULT_SURAHS);

  it("lists every lesson of the file once, in teaching order, under its unit", () => {
    expect(lessonsOf(o).map((l) => l.id)).toEqual(CURRICULUM.lessons.map((l) => l.id));
    expect(new Set(lessonsOf(o).map((l) => l.id)).size).toBe(CURRICULUM.lessons.length);
    // Today every unit is one run of lessons, so the units are the file's, in its order …
    expect(o.units.map((u) => u.id)).toEqual(CURRICULUM.units.map((u) => u.id));
    expect(o.units.map((u) => u.name)).toEqual(CURRICULUM.units.map((u) => u.name));
    for (const u of o.units) for (const l of u.lessons) expect(unitOf(l.id).id, l.id).toBe(u.id);
    // … and the lesson with no ayah opens the course (decision 1), in the one unit that is no surah.
    expect(lessonsOf(o)[0]).toMatchObject({ id: "0", kind: "intro", n: null });
    expect(o.units.filter((u) => !u.surah).map((u) => u.lessons.map((l) => l.id))).toEqual([["0"]]);
    expect(o.units.filter((u) => u.surah).map((u) => u.id)).toEqual(CURRICULUM.units.filter((u) => u.surah !== undefined).map((u) => u.id));
  });

  it("follows the LESSON order, never the unit list: a unit taught in two runs is listed twice", () => {
    const [first, second, ...rest] = CURRICULUM.lessons.filter((l) => l.unit === CURRICULUM.units[1].id);
    const other = CURRICULUM.lessons.filter((l) => l.unit === CURRICULUM.units[2].id);
    const file = { ...CURRICULUM, lessons: [first, ...other, second, ...rest] };
    const got = outline(DEFAULT_SURAHS, file);
    expect(got.units.map((u) => u.id)).toEqual([CURRICULUM.units[1].id, CURRICULUM.units[2].id, CURRICULUM.units[1].id]);
    expect(lessonsOf(got).map((l) => l.id)).toEqual(file.lessons.map((l) => l.id));
  });

  it("names a lesson by what it is: the introduction, an ayah, a segment of a long ayah", () => {
    for (const l of lessonsOf(o)) {
      const file = CURRICULUM.lessons.find((x) => x.id === l.id)!;
      if (file.surah === undefined) expect([l.kind, l.n], l.id).toEqual(["intro", null]);
      else if (file.segment !== undefined) expect([l.kind, l.n], l.id).toEqual(["segment", file.segment]);
      else expect([l.kind, l.n], l.id).toEqual(["ayah", file.ayah]);
    }
    expect(new Set(lessonsOf(o).map((l) => l.kind))).toEqual(new Set(["intro", "ayah", "segment"]));
  });

  it("a lesson's NEW steps are the file's, in its order, by the names the lesson card shows", () => {
    for (const l of lessonsOf(o)) {
      const file = CURRICULUM.lessons.find((x) => x.id === l.id)!;
      expect(l.new.map((s) => s.id), l.id).toEqual(file.steps);
      expect(l.new.map((s) => s.name), l.id).toEqual(file.steps.map((id) => step(id).name));
      expect(l.new.length, l.id).toBeLessThanOrEqual(MAX_STEPS_PER_LESSON);
    }
    // Every step of the file is new in exactly one lesson.
    expect(lessonsOf(o).flatMap((l) => l.new.map((s) => s.id))).toEqual(CURRICULUM.steps.map((s) => s.id));
    expect(o.maxNew).toBe(Math.max(...CURRICULUM.lessons.map((l) => l.steps.length)));
    expect(o.maxNew).toBeLessThanOrEqual(MAX_STEPS_PER_LESSON);
  });

  it("the running total after each lesson is the file's, and it adds up", () => {
    let learnt = 0;
    for (const l of lessonsOf(o)) {
      const file = CURRICULUM.lessons.find((x) => x.id === l.id)!;
      expect(l.after, l.id).toBe(file.after);
      learnt += l.new.length;
      expect(l.after, l.id).toBe(learnt);
    }
    expect(o.steps).toBe(CURRICULUM.steps.length);
    expect(o.steps).toBe(learnt);
    expect(o.lessons).toBe(CURRICULUM.lessons.length);
    for (const u of o.units) expect(u.steps, u.id).toBe(u.lessons.reduce((n, l) => n + l.new.length, 0));
  });

  it("a step links to the Konsep page of its record (whole or a part of it) or of its basics record; a step with neither links nowhere", () => {
    for (const s of lessonsOf(o).flatMap((l) => l.new)) {
      const file = step(s.id);
      expect(s.page, s.id).toBe(file.concept ?? file.basics ?? null);
      if (s.page !== null) expect(PAGES.has(s.page), s.id).toBe(true);
    }
    const page = (id: string) => lessonsOf(o).flatMap((l) => l.new).find((s) => s.id === id)?.page;
    // A part of the i'rab record links to that record's page; the harakat step to the Harakat page.
    for (const s of CURRICULUM.steps.filter((x) => x.part !== undefined)) expect(page(s.id), s.id).toBe(s.concept);
    for (const s of CURRICULUM.steps.filter((x) => x.basics !== undefined)) expect(page(s.id), s.id).toBe(s.basics);
    for (const s of CURRICULUM.steps.filter((x) => x.concept === undefined && x.basics === undefined)) expect(page(s.id), s.id).toBeNull();
    // A record without a page is never linked (no dead link, whatever the file names).
    const none = curriculumOutline(CURRICULUM, { published: new Set(DEFAULT_SURAHS), pages: new Set() });
    expect(none.units.flatMap((u) => u.lessons).flatMap((l) => l.new).every((s) => s.page === null)).toBe(true);
    expect(none.lanjut).toEqual([]);
  });

  it("“comes up again” is the built file's derived list, for a written lesson only: never a guess", () => {
    let written = 0;
    for (const l of lessonsOf(o)) {
      const file = CURRICULUM.lessons.find((x) => x.id === l.id)!;
      if (!file.map) {
        expect(l.again, l.id).toBeNull();
        continue;
      }
      written++;
      expect(l.again!.map((s) => s.id), l.id).toEqual(file.map.learnt.filter((x) => x.here).map((x) => x.id));
      // Learnt earlier, so never one of this lesson's new steps (decision 9: always apart).
      for (const s of l.again!) expect(file.steps, `${l.id} ${s.id}`).not.toContain(s.id);
    }
    // The file carries the lists for every ayah on disk, and for no other lesson.
    expect(written).toBe(SURAHS.reduce((n, s) => n + s.ayat.length, 0));
    expect(lessonsOf(o).filter((l) => l.again === null).length).toBeGreaterThan(0);
  });

  it("the next level is the file's `lanjut` list, every record with its Konsep page", () => {
    expect(o.lanjut).toEqual(CURRICULUM.lanjut);
    for (const id of o.lanjut) expect(LIBRARY.concepts.some((c) => c.id === id), id).toBe(true);
    // What the page's closing sentence says of it: all of sharaf, and some nahwu.
    const kind = (id: string) => LIBRARY.concepts.find((c) => c.id === id)!.kind;
    expect(LIBRARY.concepts.filter((c) => c.kind === "sharaf").map((c) => c.id).sort()).toEqual(o.lanjut.filter((id) => kind(id) === "sharaf").sort());
    expect(o.lanjut.some((id) => kind(id) === "nahwu")).toBe(true);
    // And no step of the basic level is taught from a next-level record.
    for (const s of CURRICULUM.steps) if (s.concept) expect(o.lanjut, s.id).not.toContain(s.concept);
  });
});

describe("curriculumOutline: which lessons are links (BELAJAR_SURAHS, the track page's switch)", () => {
  const linked = (o: ReturnType<typeof outline>) => Object.fromEntries(lessonsOf(o).flatMap((l) => (l.href ? [[l.id, l.href]] : [])));
  const pageOf = (id: string) => {
    const l = CURRICULUM.lessons.find((x) => x.id === id)!;
    return ayahHref(unitOf(id).slug!, l.ayah!);
  };
  /** The written ayah lessons of these surahs: what may be linked. */
  const expected = (slugs: readonly string[]) =>
    Object.fromEntries(
      CURRICULUM.lessons.filter((l) => l.map && l.ayah !== undefined && l.segment === undefined && slugs.includes(unitOf(l.id).slug ?? "")).map((l) => [l.id, pageOf(l.id)]),
    );

  it("as production runs (Al-Fatihah only): its ayat are links, nothing else is", () => {
    const got = linked(outline(DEFAULT_SURAHS));
    expect(got).toEqual(expected(DEFAULT_SURAHS));
    expect(Object.keys(got)).toEqual(SURAHS.find((s) => s.slug === "al-fatihah")!.ayat.map((a) => `1:${a.ayah}`));
    expect(got["1:2"]).toBe("/quran/al-fatihah/2");
    // No path of a hidden surah is even built.
    for (const slug of SURAH_SLUGS.filter((s) => !DEFAULT_SURAHS.includes(s))) expect(JSON.stringify(outline(DEFAULT_SURAHS))).not.toContain(`/${slug}`);
  });

  it("with every surah listed: every written ayah lesson is a link, in the file's (teaching) order", () => {
    const got = linked(outline(SURAH_SLUGS));
    expect(got).toEqual(expected(SURAH_SLUGS));
    expect(Object.keys(got)).toHaveLength(SURAHS.reduce((n, s) => n + s.ayat.length, 0));
    for (const s of SURAHS) for (const a of s.ayat) expect(got[`${s.surah}:${a.ayah}`], a.loc).toBe(ayahHref(s.slug, a.ayah));
  });

  it("one surah more is one switch more, nothing else", () => {
    expect(linked(outline(["al-fatihah", "an-nas"]))).toEqual(expected(["al-fatihah", "an-nas"]));
    expect(linked(outline(["an-nas"]))).toEqual(expected(["an-nas"]));
    expect(linked(outline([]))).toEqual({});
  });

  it("the introduction lesson has no link (it has no route yet), and neither has a segment or a lesson that is not written", () => {
    for (const slugs of [DEFAULT_SURAHS, SURAH_SLUGS, []]) {
      const all = lessonsOf(outline(slugs));
      expect(all.find((l) => l.id === "0")!.href).toBeNull();
      for (const l of all.filter((x) => x.kind !== "ayah")) expect(l.href, l.id).toBeNull();
      for (const l of all) if (!CURRICULUM.lessons.find((x) => x.id === l.id)!.map) expect(l.href, l.id).toBeNull();
    }
    // A unit with no lesson pages (no slug: Ayat Kursi while it is not written) cannot be
    // published by the switch.
    const noPages = CURRICULUM.units.filter((u) => u.surah !== undefined && u.slug === undefined);
    for (const u of outline(SURAH_SLUGS).units.filter((x) => noPages.some((n) => n.id === x.id))) expect(u.lessons.every((l) => l.href === null), u.id).toBe(true);
  });

  it("a published surah's lesson that is not on disk is not linked (the link would be a 404)", () => {
    const file: Pick<CurriculumFile, "units" | "lessons" | "steps" | "lanjut"> = {
      ...CURRICULUM,
      lessons: CURRICULUM.lessons.map((l) => (l.id === "1:3" ? { ...l, map: undefined, lines: undefined } : l)),
    };
    const got = linked(outline(DEFAULT_SURAHS, file));
    expect(got["1:3"]).toBeUndefined();
    expect(got["1:2"]).toBe("/quran/al-fatihah/2");
    expect(lessonsOf(outline(DEFAULT_SURAHS, file)).find((l) => l.id === "1:3")!.again).toBeNull();
  });
});
