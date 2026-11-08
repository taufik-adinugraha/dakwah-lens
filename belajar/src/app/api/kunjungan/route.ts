import { NextResponse } from "next/server";
import { z } from "zod";

import { ARRIVALS, VISIT_SECTIONS, WHOLE_MODULE } from "@/components/visits/visit-count";
import { db } from "@/db";

export const dynamic = "force-dynamic";

const Body = z.object({
  section: z.enum(VISIT_SECTIONS),
  firstToday: z.boolean(),
  firstEver: z.boolean(),
  firstTodayAll: z.boolean(),
  firstEverAll: z.boolean(),
  // A page opened before the arrival existed (cached script) sends none: that is "other".
  arrival: z.enum(ARRIVALS).default("other"),
});

const one = (yes: boolean) => (yes ? 1 : 0);

/**
 * Counts one page view of Belajar (migrations/0003_visit_counts.sql): which section, and whether it was the
 * browser's first view of it today or ever, in the section's row and the module's. Where it came from
 * (migrations/0004_visit_arrivals.sql) is one word, turned into two numbers: from_main for a visit that came from
 * the main site, and from_hero of those through the homepage's button. Nothing about who sent it is read or
 * kept. A visitor never waits on this and never sees it fail.
 */
export async function POST(req: Request) {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > 200) return new NextResponse(null, { status: 413 });
  let parsed;
  try {
    parsed = Body.safeParse(await req.json());
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  const sql = db();
  if (sql) {
    const v = parsed.data;
    const main = one(v.arrival !== "other");
    const hero = one(v.arrival === "hero");
    try {
      await sql`insert into belajar_visit_counts (section, views, visitors, new_visitors, from_main, from_hero)
                values (${v.section}, 1, ${one(v.firstToday)}, ${one(v.firstEver)}, ${main}, ${hero}),
                       (${WHOLE_MODULE}, 1, ${one(v.firstTodayAll)}, ${one(v.firstEverAll)}, ${main}, ${hero})
                on conflict (day, section) do update
                set views = belajar_visit_counts.views + excluded.views,
                    visitors = belajar_visit_counts.visitors + excluded.visitors,
                    new_visitors = belajar_visit_counts.new_visitors + excluded.new_visitors,
                    from_main = belajar_visit_counts.from_main + excluded.from_main,
                    from_hero = belajar_visit_counts.from_hero + excluded.from_hero`;
    } catch {
      // A count is not worth an error.
    }
  }
  return new NextResponse(null, { status: 204 });
}
