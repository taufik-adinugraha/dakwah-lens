import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const url =
  process.env.DATABASE_URL_WEB ??
  process.env.DATABASE_URL?.replace("postgresql+asyncpg://", "postgresql://") ??
  "postgresql://dakwah:dakwah_dev@localhost:5433/dakwah_lens";

const client = postgres(url, {
  prepare: false, // Auth.js adapter is incompatible with prepared statements
  max: 5,
});

export const db = drizzle(client, { schema });
export { schema };
