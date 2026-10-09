import { mkdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "./schema";
import { seedReferenceData } from "./seed";

export type Db = ReturnType<typeof drizzle<typeof schema>>;
/** A db handle or an open transaction: services accept either. */
export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Create a database. `dataDir` undefined → in-memory (tests). PGlite is embedded Postgres, so the
 * same schema and SQL run unchanged against a hosted Postgres later by swapping the driver.
 */
export async function createDb(dataDir?: string): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await seedReferenceData(db);
  return db;
}

const globalForDb = globalThis as unknown as { __tcfDb?: Promise<Db> };

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getDb(): Promise<Db> {
  if (!globalForDb.__tcfDb) {
    const dir = process.env.PGLITE_DIR || path.join(process.cwd(), "data", "pglite");
    globalForDb.__tcfDb = createDb(dir).catch((err) => {
      globalForDb.__tcfDb = undefined;
      throw err;
    });
  }
  return globalForDb.__tcfDb;
}
