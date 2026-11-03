import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { knownTest } from "@/lib/kosakata-path-data";
import { pathSource } from "@/lib/kosakata-path";

export const dynamic = "force-dynamic";

const Body = z.object({ test: z.string().max(12), passed: z.boolean() });

/**
 * Counts one finished test of the learning path (migrations/0002_kosakata_counts.sql): which test, and
 * whether it passed. Nothing about who took it is read or kept. The learner never waits on this and
 * never sees it fail: a test's result lives in their browser whatever happens here.
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
  if (!parsed.success || !knownTest(pathSource(), parsed.data.test)) return new NextResponse(null, { status: 400 });
  const sql = db();
  if (sql) {
    const pass = parsed.data.passed ? 1 : 0;
    try {
      await sql`insert into kosakata_test_counts (test, attempts, passes) values (${parsed.data.test}, 1, ${pass})
                on conflict (day, test) do update
                set attempts = kosakata_test_counts.attempts + 1, passes = kosakata_test_counts.passes + ${pass}`;
    } catch {
      // A count is not worth an error.
    }
  }
  return new NextResponse(null, { status: 204 });
}
