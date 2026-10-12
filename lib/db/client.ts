// The database connection, opened on first use from EDITOR_DATABASE_URL:
//
//   postgres://user:pass@host/db   a Postgres server (production: Render Postgres)
//   pglite:./.data/pglite          PGlite, Postgres in-process, stored in that folder
//   pglite:memory                  PGlite in memory (gone on restart; for trying things out)
//
// PGlite needs no server, which suits local work and the tests. The app must not
// connect as a Postgres superuser: superusers skip row-level security.
//
// Only lib/db/* uses this directly; everything else goes through
// lib/db/tenant-db.ts, which scopes every query to the caller's tenants.

import { mkdir } from "fs/promises"
import path from "path"

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"

import * as schema from "./schema"

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

const MIGRATIONS_FOLDER = path.join(process.cwd(), "db/drizzle")

type Connection = { db: Db; migrate: () => Promise<void>; close: () => Promise<void> }

/** Opens a connection for an EDITOR_DATABASE_URL value (see the top of this file). */
export async function connect(url: string): Promise<Connection> {
  if (url.startsWith("pglite:")) {
    const location = url.slice("pglite:".length)
    const { PGlite } = await import("@electric-sql/pglite")
    const { drizzle } = await import("drizzle-orm/pglite")
    const { migrate } = await import("drizzle-orm/pglite/migrator")
    const inMemory = location === "memory" || location === ""
    // PGlite creates its own folder but not the ones above it (e.g. .data/).
    if (!inMemory) await mkdir(path.dirname(path.resolve(location)), { recursive: true })
    const client = inMemory ? new PGlite() : new PGlite(location)
    const db = drizzle(client, { schema })
    return {
      db: db as unknown as Db,
      migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => client.close(),
    }
  }

  const { Pool } = await import("pg")
  const { drizzle } = await import("drizzle-orm/node-postgres")
  const { migrate } = await import("drizzle-orm/node-postgres/migrator")
  const pool = new Pool({ connectionString: url, max: Number(process.env.EDITOR_DATABASE_POOL_SIZE ?? 10) })
  const db = drizzle(pool, { schema })
  return {
    db: db as unknown as Db,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => pool.end(),
  }
}

// One connection per process. Kept on globalThis so dev-server reloads reuse it.
const holder = globalThis as typeof globalThis & { __editorDb?: Promise<Connection> }

/** The process-wide connection. PGlite databases are migrated on open, since nothing else would. */
function connection(): Promise<Connection> {
  if (!holder.__editorDb) {
    const opening = (async () => {
      const url = process.env.EDITOR_DATABASE_URL
      if (!url) throw new Error("EDITOR_DATABASE_URL is not set (see .env.example).")
      const conn = await connect(url)
      if (url.startsWith("pglite:")) await conn.migrate()
      return conn
    })()
    // Don't keep a failed connection: the next request tries again.
    opening.catch(() => {
      if (holder.__editorDb === opening) holder.__editorDb = undefined
    })
    holder.__editorDb = opening
  }
  return holder.__editorDb
}

export async function getDb(): Promise<Db> {
  return (await connection()).db
}

/** For tests: use this database instead of EDITOR_DATABASE_URL. */
export function __setDbForTests(db: Db) {
  holder.__editorDb = Promise.resolve({ db, migrate: async () => {}, close: async () => {} })
}
