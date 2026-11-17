import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type { AppConfig } from "../config/config.js"
import * as schema from "./schema.js"

export type Schema = typeof schema
export type Db = PgDatabase<PgQueryResultHKT, Schema>
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export type DbOrTx = Db | Tx

export interface DatabaseHandle {
  kind: "postgres" | "pglite"
  db: Db
  migrate(): Promise<void>
  close(): Promise<void>
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url))

/** Opens Postgres when DATABASE_URL is set, otherwise the embedded PGlite database. */
export async function openDatabase(config: Pick<AppConfig, "database">): Promise<DatabaseHandle> {
  if (config.database.kind === "postgres") {
    const pg = (await import("pg")).default
    const { drizzle } = await import("drizzle-orm/node-postgres")
    const { migrate } = await import("drizzle-orm/node-postgres/migrator")
    const pool = new pg.Pool({ connectionString: config.database.url, max: 10 })
    const db = drizzle({ client: pool, schema })
    return {
      kind: "postgres",
      db: db as unknown as Db,
      migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_DIR }),
      close: () => pool.end(),
    }
  }

  const { PGlite } = await import("@electric-sql/pglite")
  const { drizzle } = await import("drizzle-orm/pglite")
  const { migrate } = await import("drizzle-orm/pglite/migrator")
  const dir = config.database.dir
  let client: InstanceType<typeof PGlite>
  if (dir === "memory://") {
    client = new PGlite()
  } else {
    const path = resolve(dir)
    mkdirSync(path, { recursive: true })
    client = new PGlite(path)
  }
  await client.waitReady
  const db = drizzle({ client, schema })
  return {
    kind: "pglite",
    db: db as unknown as Db,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.close(),
  }
}

/** Normalises `db.execute()` results across node-postgres and PGlite. */
export function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] }
  return Array.isArray(r) ? (r as T[]) : (r.rows ?? [])
}
