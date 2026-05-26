import { sql } from "drizzle-orm";

import { db } from "@/db";
import { Card, HelpCallout, PageHeader, StatTile } from "../_ui";

/**
 * Aggregate user analytics — sourced from the onboarding profile
 * (users.profile jsonb) plus activity tables (briefs, user_flyers,
 * bookmarks). Deliberately AGGREGATE ONLY: every query GROUP BYs or
 * COUNTs, never selects a row keyed to one person. No email, no name,
 * no per-user breakdown — this page answers "what does our user base
 * look like and how do they behave," not "what did user X do."
 *
 * Gated to system access by the parent layout (requireSystemAccess).
 */

export const dynamic = "force-dynamic";

// Human labels for the profile codes (mirror onboarding/actions.ts +
// brief-generator's PROFILE_LABELS, trimmed for a dense admin table).
const HONORIFIC: Record<string, string> = {
  ust: "Ustadz",
  ustadzah: "Ustadzah",
  kh: "Kyai Haji",
  hj: "Haji/Hajjah",
  habib: "Habib",
  buya: "Buya",
  prof: "Professor",
  dr: "Doktor",
  drs: "Drs.",
  bapak: "Bapak",
  ibu: "Ibu",
  none: "(none)",
  other: "Other",
};
const AGE: Record<string, string> = {
  "18-24": "18–24",
  "25-34": "25–34",
  "35-49": "35–49",
  "50plus": "50+",
  other: "Other",
};
const LOCATION: Record<string, string> = {
  jabodetabek: "Jabodetabek",
  jawa_barat: "West Java",
  jawa_tengah_diy: "Central Java / DIY",
  jawa_timur: "East Java",
  sumatera: "Sumatra",
  kalimantan: "Kalimantan",
  sulawesi: "Sulawesi",
  indonesia_timur: "Eastern Indonesia",
  overseas: "Diaspora abroad",
  other: "Other",
};
const PROFESSION: Record<string, string> = {
  ustadz_fulltime: "Ustadz (full-time)",
  ustadz_parttime: "Ustadz (part-time)",
  content_creator: "Content creator",
  student_of_knowledge: "Student of knowledge",
  academic: "Academic",
  community_activist: "Community activist",
  other: "Other",
};
const AUDIENCE: Record<string, string> = {
  urban_youth: "Urban youth",
  young_families: "Young families",
  professionals: "Professionals",
  santri_students: "Santri / students",
  elders: "Elders",
  online_followers: "Online followers",
  local_mosque: "Local mosque",
};
const FOCUS: Record<string, string> = {
  aqidah: "Aqidah",
  akhlaq: "Akhlaq",
  muamalah: "Muamalah",
  social_justice: "Social justice",
  family: "Family",
  youth: "Youth",
  education: "Education",
  economic_ethics: "Economic ethics",
  health: "Health",
};
const OUTPUT_LANG: Record<string, string> = {
  id: "Bahasa Indonesia",
  en: "English",
  both: "Both",
  any: "Any",
};
const SEGMENT: Record<string, string> = {
  urban_gen_z: "Urban Gen Z",
  working_professionals: "Working professionals",
  parents_families: "Parents & families",
  ibu_pengajian: "Ibu-ibu pengajian",
  rural_communities: "Rural communities",
  students: "Students",
};

type Row = { k: string | null; n: number };

/** Scalar profile field → [{code,count}] desc. NULLs collapse to a
 *  "(not set)" bucket so the denominator is honest. */
async function scalarDist(field: string): Promise<Row[]> {
  const rows = (await db.execute(sql`
    SELECT coalesce(profile->>${field}, '(not set)') AS k, count(*)::int AS n
    FROM users
    GROUP BY k
    ORDER BY n DESC
  `)) as unknown as Row[];
  return rows.map((r) => ({ k: r.k, n: Number(r.n) }));
}

/** Array profile field (audience, focus) → per-tag counts. A user who
 *  picked 3 audiences contributes to 3 buckets — these don't sum to
 *  the user count, by design (multi-select). */
async function arrayDist(field: string): Promise<Row[]> {
  const rows = (await db.execute(sql`
    SELECT tag AS k, count(*)::int AS n
    FROM users, jsonb_array_elements_text(coalesce(profile->${field}, '[]'::jsonb)) AS tag
    GROUP BY tag
    ORDER BY n DESC
  `)) as unknown as Row[];
  return rows.map((r) => ({ k: r.k, n: Number(r.n) }));
}

function Bars({
  rows,
  labels,
  total,
}: {
  rows: Row[];
  labels: Record<string, string>;
  /** Denominator for the % bar. For scalar dists this is the user
   *  count; for multi-select arrays pass the same so % reads as
   *  "share of users who picked this tag". */
  total: number;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-slate-400">No data yet.</p>;
  }
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const code = r.k ?? "(not set)";
        const label = labels[code] ?? code;
        const pct = total > 0 ? Math.round((r.n / total) * 100) : 0;
        return (
          <li key={code} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-slate-700">{label}</span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {r.n}
                <span className="ml-1 text-slate-400">· {pct}%</span>
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${Math.max((r.n / max) * 100, 2)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default async function UserAnalyticsPage() {
  // ── User base ─────────────────────────────────────────────────
  const [base] = (await db.execute(sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE onboarded_at IS NOT NULL)::int AS onboarded,
      count(*) FILTER (WHERE profile IS NOT NULL)::int AS with_profile,
      count(*) FILTER (WHERE status = 'approved')::int AS approved,
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS new_30d
    FROM users
  `)) as unknown as Array<{
    total: number;
    onboarded: number;
    with_profile: number;
    approved: number;
    pending: number;
    new_30d: number;
  }>;

  const totalUsers = Number(base?.total ?? 0);
  const withProfile = Number(base?.with_profile ?? 0);

  // ── Profile distributions ─────────────────────────────────────
  const [
    honorific,
    age,
    location,
    profession,
    outputLang,
    audience,
    focus,
  ] = await Promise.all([
    scalarDist("honorific"),
    scalarDist("age_range"),
    scalarDist("location"),
    scalarDist("profession"),
    scalarDist("output_lang"),
    arrayDist("audience"),
    arrayDist("focus"),
  ]);

  // ── Activity / behaviour ──────────────────────────────────────
  const [activity] = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM briefs) AS briefs,
      (SELECT count(DISTINCT user_id)::int FROM briefs) AS brief_users,
      (SELECT count(*)::int FROM user_flyers) AS flyers,
      (SELECT count(*)::int FROM user_flyers WHERE visibility = 'public') AS flyers_public,
      (SELECT count(DISTINCT user_id)::int FROM user_flyers) AS flyer_users,
      (SELECT count(*)::int FROM bookmarks) AS bookmarks,
      (SELECT count(DISTINCT user_id)::int FROM bookmarks) AS bookmark_users
  `)) as unknown as Array<Record<string, number>>;

  const briefsBySegment = (await db.execute(sql`
    SELECT segment AS k, count(*)::int AS n FROM briefs GROUP BY segment ORDER BY n DESC
  `)) as unknown as Row[];
  const flyersByLayout = (await db.execute(sql`
    SELECT layout AS k, count(*)::int AS n FROM user_flyers GROUP BY layout ORDER BY n DESC
  `)) as unknown as Row[];
  const bookmarksByKind = (await db.execute(sql`
    SELECT kind AS k, count(*)::int AS n FROM bookmarks GROUP BY kind ORDER BY n DESC
  `)) as unknown as Row[];

  // Distinct active users (≥1 brief / flyer / bookmark).
  const [{ active }] = (await db.execute(sql`
    SELECT count(*)::int AS active FROM (
      SELECT user_id FROM briefs
      UNION SELECT user_id FROM user_flyers
      UNION SELECT user_id FROM bookmarks
    ) u
  `)) as unknown as Array<{ active: number }>;

  const onboardPct =
    totalUsers > 0 ? Math.round((withProfile / totalUsers) * 100) : 0;

  return (
    <div>
      <PageHeader
        badge="Aggregate · no individual data"
        title="User analytics"
        subtitle="Who our users are (from the onboarding profile) and how they use the app — aggregated across everyone, never per individual."
      />

      <HelpCallout title="What this shows + privacy note">
        <p>
          Every figure here is a <strong>GROUP BY / COUNT aggregate</strong>.
          No email, name, or per-person row is queried. Profile fields come
          from the registration onboarding wizard; activity comes from the
          briefs, flyers, and bookmarks tables.
        </p>
        <p className="mt-1">
          Multi-select dimensions (audience, da&apos;wah focus) don&apos;t sum
          to the user count — one user can pick several, so percentages are
          &quot;share of all users who picked this tag.&quot;
        </p>
      </HelpCallout>

      {/* User base */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total users" value={totalUsers.toLocaleString()} />
        <StatTile
          label="Profile complete"
          value={`${onboardPct}%`}
          hint={`${withProfile} of ${totalUsers}`}
          accent="emerald"
        />
        <StatTile
          label="Approved"
          value={Number(base?.approved ?? 0).toLocaleString()}
          accent="brand"
        />
        <StatTile
          label="Pending"
          value={Number(base?.pending ?? 0).toLocaleString()}
          accent="amber"
        />
        <StatTile
          label="New (30d)"
          value={Number(base?.new_30d ?? 0).toLocaleString()}
        />
        <StatTile
          label="Active users"
          value={Number(active ?? 0).toLocaleString()}
          hint="≥1 brief / flyer / bookmark"
          accent="emerald"
        />
      </div>

      {/* Profile distributions */}
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Profile — who they are
      </h3>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Preferred panggilan">
          <Bars rows={honorific} labels={HONORIFIC} total={totalUsers} />
        </Card>
        <Card title="Age range">
          <Bars rows={age} labels={AGE} total={totalUsers} />
        </Card>
        <Card title="Region">
          <Bars rows={location} labels={LOCATION} total={totalUsers} />
        </Card>
        <Card title="Profession / role">
          <Bars rows={profession} labels={PROFESSION} total={totalUsers} />
        </Card>
        <Card title="Output language">
          <Bars rows={outputLang} labels={OUTPUT_LANG} total={totalUsers} />
        </Card>
        <Card title="Primary audience" hint="multi-select">
          <Bars rows={audience} labels={AUDIENCE} total={totalUsers} />
        </Card>
        <Card title="Da'wah focus areas" hint="multi-select">
          <Bars rows={focus} labels={FOCUS} total={totalUsers} />
        </Card>
      </div>

      {/* Activity */}
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Behaviour — how they use the app
      </h3>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Briefs generated"
          value={Number(activity?.briefs ?? 0).toLocaleString()}
          hint={`${Number(activity?.brief_users ?? 0)} users`}
        />
        <StatTile
          label="Flyers built"
          value={Number(activity?.flyers ?? 0).toLocaleString()}
          hint={`${Number(activity?.flyer_users ?? 0)} users`}
        />
        <StatTile
          label="Public flyers"
          value={Number(activity?.flyers_public ?? 0).toLocaleString()}
        />
        <StatTile
          label="Bookmarks"
          value={Number(activity?.bookmarks ?? 0).toLocaleString()}
          hint={`${Number(activity?.bookmark_users ?? 0)} users`}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Briefs by segment">
          <Bars
            rows={briefsBySegment}
            labels={SEGMENT}
            total={Number(activity?.briefs ?? 0)}
          />
        </Card>
        <Card title="Flyers by layout">
          <Bars
            rows={flyersByLayout}
            labels={{}}
            total={Number(activity?.flyers ?? 0)}
          />
        </Card>
        <Card title="Bookmarks by kind">
          <Bars
            rows={bookmarksByKind}
            labels={{ kitab: "Kitab", brief: "Briefing", post: "Post" }}
            total={Number(activity?.bookmarks ?? 0)}
          />
        </Card>
      </div>
    </div>
  );
}
