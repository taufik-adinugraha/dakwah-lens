import { NextResponse } from "next/server";

import { db } from "@/db";

export const dynamic = "force-dynamic";

/** Probed by deploy/belajar/deploy.sh after every rollout. */
export async function GET() {
  const sql = db();
  let database: "ok" | "error" | "unconfigured" = "unconfigured";
  if (sql) {
    try {
      await sql`select 1`;
      database = "ok";
    } catch {
      database = "error";
    }
  }
  return NextResponse.json(
    {
      ok: database !== "error",
      database,
      version: process.env.GIT_SHA ?? "dev",
    },
    {
      status: database === "error" ? 503 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
