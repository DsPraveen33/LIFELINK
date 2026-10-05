import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import * as schema from "./schema";
import { SCHEMA_DDL } from "./ddl";

const { Pool } = pg;

export type DbType = ReturnType<typeof drizzleNodePg<typeof schema>>;

let internalDb: DbType | null = null;
let internalPool: pg.Pool | null = null;
let pgliteClient: PGlite | null = null;

export async function initDb(): Promise<void> {
  if (process.env.DATABASE_URL) {
    if (!internalPool) {
      internalPool = new Pool({ connectionString: process.env.DATABASE_URL });
      internalDb = drizzleNodePg(internalPool, { schema });
    }
    const client = await internalPool.connect();
    try {
      await client.query(SCHEMA_DDL);
    } catch (err) {
      console.warn("Notice during table initialization (PostgreSQL):", err);
    } finally {
      client.release();
    }
  } else {
    if (!pgliteClient) {
      pgliteClient = new PGlite();
      internalDb = drizzlePglite(pgliteClient, { schema }) as unknown as DbType;
    }
    try {
      await pgliteClient.exec(SCHEMA_DDL);
    } catch (err) {
      console.warn("Notice during table initialization (PGlite):", err);
    }
  }
}

// Default export / proxy so that db can be imported directly and lazily initialized
if (process.env.DATABASE_URL) {
  internalPool = new Pool({ connectionString: process.env.DATABASE_URL });
  internalDb = drizzleNodePg(internalPool, { schema });
} else {
  pgliteClient = new PGlite();
  internalDb = drizzlePglite(pgliteClient, { schema }) as unknown as DbType;
  // Initialize DDL in background for PGlite
  void pgliteClient.exec(SCHEMA_DDL).catch((err) => {
    console.error("Failed to initialize PGlite schema:", err);
  });
}

export const pool = internalPool;
export const db = internalDb as NonNullable<typeof internalDb>;

export * from "./schema";
export * from "./ddl";
