import { getTranslations } from "next-intl/server";

import { Eyebrow, Section, Title } from "./primitives";
import { Reveal } from "./Reveal";

type LandingT = Awaited<ReturnType<typeof getTranslations<"Landing">>>;

/**
 * For whom — a short passage that names the whole audience (per the
 * AUDIENCE SCOPE rule: wider than khateebs). One paragraph plus a
 * quiet single-line list of roles; deliberately the simplest section
 * on the page.
 */
export function ForWhom({ t }: { t: LandingT }) {
  const roles = [
    t("forwhom_role_dai"),
    t("forwhom_role_ustadzah"),
    t("forwhom_role_creator"),
    t("forwhom_role_parent"),
    t("forwhom_role_organizer"),
  ];

  return (
    <Section id="for-whom">
      <div className="mx-auto max-w-2xl text-center">
        <Reveal>
          <Eyebrow>{t("forwhom_eyebrow")}</Eyebrow>
          <Title>{t("forwhom_title")}</Title>
        </Reveal>
        <Reveal delay={90}>
          <p className="mx-auto mt-5 max-w-xl text-pretty leading-[1.7] text-ink-muted">
            {t("forwhom_body")}
          </p>
        </Reveal>
        <Reveal delay={160}>
          <ul className="mt-9 flex flex-wrap justify-center gap-x-3 gap-y-2">
            {roles.map((role) => (
              <li
                key={role}
                className="rounded-full border border-hairline px-4 py-1.5 text-sm text-ink-muted"
              >
                {role}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}
