/**
 * Source-of-truth for the public Terms of Service version.
 *
 * Why a code constant instead of a row in `app_settings`:
 *  - The terms page promise ("we will email signed-in users and post a
 *    banner for at least two weeks for any material change") is a
 *    process commitment. Tying it to a code constant means the same
 *    commit that changes the terms text also bumps this — there is no
 *    "I edited the i18n string but forgot to bump the version" mode.
 *  - When this constant changes on deploy, the admin dashboard detects
 *    drift on next load (`ensureTermsFollowups`) and queues two
 *    follow-ups: email blast + in-app banner. The admin then triggers
 *    each from `/admin/system/followups`.
 *
 * Bump rules:
 *  - Trivial copy / typo fixes — DO NOT bump. (They will happen quietly,
 *    per the promise on the terms page.)
 *  - Material change (scope, data practices, what counts as acceptable
 *    use) — bump `TERMS_VERSION` to today's date and write one sentence
 *    in `TERMS_CHANGELOG` so the admin's follow-up email has substance.
 *  - Two material changes on the same day — append `b`, `c`, ….
 */

export const TERMS_VERSION = "2026-05-19";

/** Display date in ISO; the page renders it via Intl.DateTimeFormat for
 *  the locale's natural format. Keep in sync with TERMS_VERSION's base
 *  date — they only diverge when you append a same-day suffix. */
export const TERMS_UPDATED_AT = new Date("2026-05-19T00:00:00Z");

/** One-sentence summary of what changed. Used as the default email
 *  subject / banner copy so the admin doesn't have to write from scratch.
 *  Empty string allowed for the initial/baseline version. */
export const TERMS_CHANGELOG = "";
