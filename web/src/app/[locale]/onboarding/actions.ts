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

  const profile: UserProfile = {
    honorific: pick(formData.get("honorific"), HONORIFICS),
    honorific_other:
      formData.get("honorific") === "other"
        ? trimText(formData.get("honorific_other"), 30)
        : undefined,
    age_range: pick(formData.get("age_range"), AGE_RANGES),
    age_range_other:
      formData.get("age_range") === "other"
        ? trimText(formData.get("age_range_other"), 60)
        : undefined,
    location: pick(formData.get("location"), LOCATIONS),
    location_other:
      formData.get("location") === "other"
        ? trimText(formData.get("location_other"), 120)
        : undefined,
    profession: pick(formData.get("profession"), PROFESSIONS),
    profession_other:
      formData.get("profession") === "other"
        ? trimText(formData.get("profession_other"), 120)
        : undefined,
    audience: pickMany(formData.getAll("audience"), AUDIENCES),
    audience_other: trimText(formData.get("audience_other"), 200),
    focus: pickMany(formData.getAll("focus"), FOCUS_CATEGORIES),
    output_lang: pick(formData.get("output_lang"), OUTPUT_LANGS) ?? "id",
  };

  await db
    .update(schema.users)
    .set({
      profile,
      onboardedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, session.user.id));

  // Where to land them next: pending users go to /insights to browse while
  // they wait for approval; approved users go to /dashboard.
  const dest = session.user.status === "approved" ? "/dashboard" : "/insights";
  redirect(dest);
}

/** Skip onboarding without saving anything — sets onboarded_at so we don't
 *  keep redirecting them. Profile stays NULL → brief prompts use defaults. */
export async function skipOnboardingAction(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/onboarding");
  }

  await db
    .update(schema.users)
    .set({ onboardedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.users.id, session.user.id));

  const dest = session.user.status === "approved" ? "/dashboard" : "/insights";
  redirect(dest);
}
