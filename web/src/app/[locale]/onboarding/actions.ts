"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import type { UserProfile } from "@/db/schema";

/* ───────────────────────────────────────────────────────────────
 * Allow-lists. We refuse to write anything outside these — keeps
 * arbitrary FormData free-text out of the structured fields, and
 * makes the brief-generator's prompt context predictable.
 * ─────────────────────────────────────────────────────────────── */

const HONORIFICS = [
  "ust",
  "ustadzah",
  "kh",
  "hj",
  "habib",
  "buya",
  "prof",
  "dr",
  "drs",
  "bapak",
  "ibu",
  "none",
];
const AGE_RANGES = ["18-24", "25-34", "35-49", "50plus"];
const LOCATIONS = [
  "jabodetabek",
  "jawa_barat",
  "jawa_tengah_diy",
  "jawa_timur",
  "sumatera",
  "kalimantan",
  "sulawesi",
  "indonesia_timur",
  "overseas",
];
const PROFESSIONS = [
  "ustadz_fulltime",
  "ustadz_parttime",
  "content_creator",
  "student_of_knowledge",
  "academic",
  "community_activist",
];
const AUDIENCES = [
  "urban_youth",
  "young_families",
  "professionals",
  "santri_students",
  "elders",
  "online_followers",
  "local_mosque",
];
const FOCUS_CATEGORIES = [
  "aqidah",
  "akhlaq",
  "muamalah",
  "social_justice",
  "family",
  "youth",
  "education",
  "economic_ethics",
  "health",
];
const OUTPUT_LANGS = ["id", "en", "both", "any"];

function pick(value: FormDataEntryValue | null, allowed: string[]): string | undefined {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return undefined;
  return allowed.includes(v) || v === "other" ? v : undefined;
}

function pickMany(values: FormDataEntryValue[], allowed: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (allowed.includes(t)) out.add(t);
  }
  return [...out];
}

function trimText(v: FormDataEntryValue | null, max = 200): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return undefined;
  return s.slice(0, max);
}

/**
 * Persist the wizard's collected answers and redirect to the destination.
 * Idempotent — re-running overwrites the previous profile, useful if the
 * user revisits /onboarding from settings later.
 */
export async function saveProfileAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/onboarding");
  }

  const honorific = pick(formData.get("honorific"), HONORIFICS);
  const honorificOther =
    formData.get("honorific") === "other"
      ? trimText(formData.get("honorific_other"), 30)
      : undefined;
  const ageRange = pick(formData.get("age_range"), AGE_RANGES);
  const ageRangeOther =
    formData.get("age_range") === "other"
      ? trimText(formData.get("age_range_other"), 60)
      : undefined;
  const location = pick(formData.get("location"), LOCATIONS);
  const locationOther =
    formData.get("location") === "other"
      ? trimText(formData.get("location_other"), 120)
      : undefined;
  const profession = pick(formData.get("profession"), PROFESSIONS);
  const professionOther =
    formData.get("profession") === "other"
      ? trimText(formData.get("profession_other"), 120)
      : undefined;
  const audience = pickMany(formData.getAll("audience"), AUDIENCES);
  const focus = pickMany(formData.getAll("focus"), FOCUS_CATEGORIES);
  const outputLang = pick(formData.get("output_lang"), OUTPUT_LANGS);

  // Onboarding is mandatory — every step must be answered. The wizard
  // already gates this client-side, but we re-check here so a crafted or
  // partial submission can't write an incomplete profile + flip the
  // onboarded flag. A "single" step counts as answered when it has a
  // value (and free text when the value is "other"); a "multi" step needs
  // at least one selection.
  const singleAnswered = (
    value: string | undefined,
    other: string | undefined,
  ) => (value === "other" ? !!other : !!value);
  const complete =
    singleAnswered(honorific, honorificOther) &&
    singleAnswered(ageRange, ageRangeOther) &&
    singleAnswered(location, locationOther) &&
    singleAnswered(profession, professionOther) &&
    audience.length > 0 &&
    focus.length > 0 &&
    !!outputLang;
  if (!complete) {
    redirect("/onboarding");
  }

  const profile: UserProfile = {
    honorific,
    honorific_other: honorificOther,
    age_range: ageRange,
    age_range_other: ageRangeOther,
    location,
    location_other: locationOther,
    profession,
    profession_other: professionOther,
    audience,
    audience_other: trimText(formData.get("audience_other"), 200),
    focus,
    output_lang: outputLang,
  };

  await db
    .update(schema.users)
    .set({
      profile,
      onboardedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, session.user.id));

  // Where to land them next: pending users go to /briefings to browse while
  // they wait for approval; approved users go to /dashboard.
  const dest = session.user.status === "approved" ? "/dashboard" : "/briefings";
  redirect(dest);
}
