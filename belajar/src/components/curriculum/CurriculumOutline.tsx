import { ArrowRight, BookOpen, Check, Clock, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { MixedText, type Overlay } from "@/components/library/MixedText";
import { Headword, TermText } from "@/components/library/TermText";
import type { Concept } from "@/content/schema";
import { Link } from "@/i18n/navigation";
import { mapLatinName } from "@/lib/autoplay/lessonMap";
import type { Outline, OutlineLesson, OutlineStep, OutlineUnit } from "@/lib/curriculumOutline";
import { TERMS } from "@/lib/library";
import { conceptHref } from "@/lib/routes";
import { Scope, titleParts } from "@/lib/terms";

/**
 * The basic curriculum, unit by unit in teaching order (operator 2026-10-13: "we should also
 * explain this curriculum in the page"; docs/belajar-plan.md L27). What it draws is
 * src/lib/curriculumOutline.ts, i.e. content/curriculum.json: nothing here names a surah, a
 * lesson or a topic.
 *
 * One white card per unit; inside it, one block per lesson:
 *   - the lesson's name ("Ayat 2"; "Pelajaran pengantar"; "Penggalan 3" of a long ayah) and,
 *     when it cannot be opened, the words "Belum tersedia" (a label with an icon, never colour
 *     alone; plain text, nothing to click or focus);
 *   - "Baru di pelajaran ini": the steps it teaches for the first time, by the names the
 *     lesson's own card shows (LessonMapCard: the term with its Arabic, through MixedText). A
 *     step with a Konsep page links to it: its Latin words underlined (the link cue), its Arabic
 *     in the term colour and never underlined — a line under vocalised Arabic runs through its
 *     harakat;
 *   - a lesson with nothing new says so ("Tidak ada hal baru": it reviews), and lists the steps
 *     that come up again in its ayah where the built file has them (a written lesson), never a
 *     guess;
 *   - "Sudah dipelajari sampai di sini: N hal": the running total after the lesson, apart from
 *     what is new (decision 9: "this is what new, this is what we've learnt so far");
 *   - the link to the lesson, when it is available, saying where it goes ("Buka pelajaran
 *     Al-Fatihah ayat 2").
 *
 * Senior-friendly like the rest of the module: lists, never a table (nothing scrolls sideways on
 * a 390px phone at the largest text size), 18px text with the Arabic at the 24px floor, 48px
 * link rows. Every text that can hold a hyphenated name ("Al-Fatihah") or Arabic goes through
 * MixedText, so no word is cut at its hyphen and no term leaves its Arabic. Inside a flex
 * container the text sits in ONE child: MixedText's pieces would otherwise be flex items.
 */
export function CurriculumOutline({ outline }: { outline: Outline }) {
  return (
    <ol data-curriculum="units" className="mt-6 space-y-6">
      {outline.units.map((u, i) => (
        <li key={`${i}:${u.id}`}>
          <Unit unit={u} headingId={`unit-${i + 1}`} />
        </li>
      ))}
    </ol>
  );
}

function Unit({ unit, headingId }: { unit: OutlineUnit; headingId: string }) {
  const t = useTranslations("Curriculum");
  // The surah units keep the file's name in both locales (as the track page names a surah); the
  // unit of the lesson with no ayah is a common noun, so it has a message ("Pengantar", the
  // file's own word, in Indonesian; curriculum-page.test.ts holds the two equal).
  const name = unit.surah ? unit.name : t("intro_unit");
  return (
    <section data-unit={unit.id} aria-labelledby={headingId} className="rounded-2xl border border-hairline bg-white p-5 sm:p-7">
      <h3 id={headingId} className="font-display text-2xl font-medium text-ink">
        <MixedText text={name} />
      </h3>
      <p className="mt-1 text-base text-ink-muted">{t("unit_meta", { lessons: unit.lessons.length, steps: unit.steps })}</p>
      <ol className="mt-3 divide-y divide-hairline">
        {unit.lessons.map((l) => (
          <Lesson key={l.id} lesson={l} unit={name} />
        ))}
      </ol>
    </section>
  );
}

function Lesson({ lesson, unit }: { lesson: OutlineLesson; unit: string }) {
  const t = useTranslations("Curriculum");
  const tl = useTranslations("Lesson");
  const n = lesson.n ?? 0;
  const label = lesson.kind === "intro" ? t("lesson_intro") : lesson.kind === "segment" ? t("lesson_segment", { n }) : tl("ayah", { n });
  const open = lesson.kind === "intro" ? t("open_intro") : lesson.kind === "segment" ? t("open_segment", { unit, n }) : t("open_ayah", { unit, n });
  const again = lesson.again ?? [];
  return (
    <li data-lesson={lesson.id} data-available={String(lesson.href !== null)} className="py-5 last:pb-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h4 className="font-display text-xl font-medium text-ink">
          <MixedText text={label} />
        </h4>
        {lesson.href === null ? (
          <span data-lesson-status="" className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-border-ui bg-paper-deep px-3 py-1 text-sm font-semibold text-ink">
            <Clock aria-hidden className="h-4 w-4 shrink-0 text-ink-muted" />
            <span className="whitespace-nowrap">{t("unavailable")}</span>
          </span>
        ) : null}
      </div>

      {lesson.new.length > 0 ? (
        <div data-group="new" className="mt-3">
          <GroupLabel icon={<BookOpen aria-hidden className="h-5 w-5 shrink-0" />} tone="text-forest">
            {t("new_heading")}
          </GroupLabel>
          <ul className="mt-1">
            {lesson.new.map((s) => (
              <NewStep key={s.id} step={s} />
            ))}
          </ul>
        </div>
      ) : (
        <div data-group="review" className="mt-3">
          <GroupLabel icon={<RotateCcw aria-hidden className="h-5 w-5 shrink-0 text-forest" strokeWidth={2.5} />} tone="text-ink">
            {t("review_heading")}
          </GroupLabel>
          <p className="mt-1 text-base text-ink">{t("review_body")}</p>
          {again.length > 0 ? (
            <>
              <p className="mt-2 text-base text-ink">{t("again", { n: again.length })}</p>
              {/* One flowing line, as the lesson's card lists more than three: each name carries
                  its own comma, so no line starts with a separator; Latin names (their Arabic
                  stands where each is new). */}
              <ul data-again="" className="mt-0.5 flex flex-wrap gap-x-1.5 text-base text-ink">
                {again.map((s, i) => (
                  <li key={s.id} data-step={s.id}>
                    <MixedText text={`${mapLatinName(s.name)}${i < again.length - 1 ? "," : ""}`} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}

      <div data-group="learnt" className="mt-3">
        <GroupLabel icon={<Check aria-hidden className="h-5 w-5 shrink-0" strokeWidth={3} />} tone="text-ink-muted">
          {t("learnt", { n: lesson.after })}
        </GroupLabel>
      </div>

      {lesson.href !== null ? (
        <Link href={lesson.href} data-lesson-link="" className="mt-2 inline-flex min-h-12 items-center gap-1.5 text-base font-semibold text-forest">
          {/* The underline on the text's own parent: MixedText's kept words take it from there. */}
          <span className="link-text">
            <MixedText text={open} />
          </span>
          <ArrowRight aria-hidden className="h-5 w-5 shrink-0" />
        </Link>
      ) : null}
    </li>
  );
}

/** A group's label: an icon and the words (the words say what the group is; the icon and the
 *  colour only help the eye). The icon stays on the first line however the words wrap. */
function GroupLabel({ icon, tone, children }: { icon: ReactNode; tone: string; children: string }) {
  return (
    <p className={`flex items-start gap-2 text-base font-semibold ${tone}`}>
      <span className="flex h-[1.7em] shrink-0 items-center">{icon}</span>
      <span>
        <MixedText text={children} />
      </span>
    </p>
  );
}

/** The link cue of a step's name, as overlays on MixedText's own pieces (they only style: the
 *  pieces and their line breaks stay those of the name): its Latin words underlined and forest,
 *  its Arabic forest and never underlined. */
const linkCue = (name: string): Overlay[] => [{ from: 0, to: name.length, wrap: (words) => <span className="link-text">{words}</span>, arabic: "text-forest" }];

/** One new step: a dot and its name as the lesson's card shows it; a link when it has a Konsep page. */
function NewStep({ step }: { step: OutlineStep }) {
  return (
    <li data-step={step.id} className="flex min-w-0 items-baseline gap-2.5 text-lg text-ink">
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 -translate-y-[0.3em] rounded-full bg-forest" />
      {step.page ? (
        <Link href={conceptHref(step.page)} className="min-w-0 flex-1 py-2 text-forest">
          <MixedText text={step.name} overlays={linkCue(step.name)} />
        </Link>
      ) : (
        <span className="min-w-0 flex-1 py-2">
          <MixedText text={step.name} />
        </span>
      )}
    </li>
  );
}

/**
 * What the basic level leaves for the next one ("tingkat lanjut": the curriculum's `lanjut`
 * records, grouped by the library's own kind), each a row that links to its Konsep page: the
 * title and its Arabic headword as the Konsep index draws them, and the arrow every whole-row
 * link in the module carries. Nothing inside a row is a link of its own.
 */
export function NextLevelList({ groups }: { groups: { kind: Concept["kind"]; label: string; items: Concept[] }[] }) {
  return (
    <>
      {groups.map(({ kind, label, items }) =>
        items.length > 0 ? (
          <section key={kind} data-next-level={kind} className="mt-6" aria-labelledby={`lanjut-${kind}`}>
            <h3 id={`lanjut-${kind}`} className="text-lg font-semibold text-ink">
              <MixedText text={label} />
            </h3>
            <ul className="mt-3 divide-y divide-hairline rounded-2xl border border-hairline bg-white px-5">
              {items.map((c) => {
                const { tokens, head } = c.marked ? titleParts(c.marked.title, new Scope(), TERMS) : { tokens: [{ kind: "text" as const, text: c.title }], head: [] };
                return (
                  <li key={c.id} data-next-level-item={c.id}>
                    <Link href={conceptHref(c.id)} className="flex min-h-12 items-center gap-3 py-3 text-ink">
                      <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="text-lg font-medium">
                          <TermText tokens={tokens} links={false} emphasis="meaning" />
                        </span>
                        <Headword head={head} className="text-ar-sm" />
                      </span>
                      <ArrowRight aria-hidden className="h-5 w-5 shrink-0 text-forest" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
    </>
  );
}
