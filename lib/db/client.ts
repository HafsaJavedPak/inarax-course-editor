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

/** Called for each notification on a channel; `onReconnect` after the listening connection was re-established (notifications sent meanwhile are lost). */
export type Listen = (channel: string, onMessage: (payload: string) => void, onReconnect?: () => void) => Promise<() => Promise<void>>

type Connection = { db: Db; migrate: () => Promise<void>; close: () => Promise<void>; listen: Listen }

const CHANNEL = /^[a-z_][a-z0-9_]*$/

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
      // PGlite runs in this process: NOTIFY from any transaction here reaches these listeners.
      listen: async (channel, onMessage) => client.listen(channel, onMessage),
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
    listen: (channel, onMessage, onReconnect) => listenOnPostgres(url, channel, onMessage, onReconnect),
  }
}

/**
 * LISTEN on a dedicated connection (not from the pool: a pooled connection
 * would stop listening when returned). Reconnects with backoff when the
 * connection drops, then calls onReconnect, since notifications sent while it
 * was down are gone.
 */
async function listenOnPostgres(url: string, channel: string, onMessage: (payload: string) => void, onReconnect?: () => void) {
  if (!CHANNEL.test(channel)) throw new Error(`Invalid channel name: ${channel}`)
  const { Client } = await import("pg")
  let stopped = false
  let current: InstanceType<typeof Client> | null = null

  const open = async () => {
    const client = new Client({ connectionString: url })
    client.on("notification", (message) => {
      if (message.channel === channel) onMessage(message.payload ?? "")
    })
    client.on("error", () => {}) // "end" follows; reconnecting happens there
    client.on("end", () => {
      if (stopped || current !== client) return
      current = null
      void retry(1)
    })
    await client.connect()
    await client.query(`LISTEN ${channel}`)
    current = client
  }
  const retry = async (attempt: number): Promise<void> => {
    if (stopped) return
    await new Promise((r) => setTimeout(r, Math.min(30_000, 250 * 2 ** attempt)))
    try {
      await open()
      onReconnect?.()
    } catch {
      return retry(attempt + 1)
    }
  }

  await open()
  return async () => {
    stopped = true
    await current?.end().catch(() => {})
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

/** Listens for notifications on a channel of the process-wide database (see Listen). */
export const listenTo: Listen = async (channel, onMessage, onReconnect) => (await connection()).listen(channel, onMessage, onReconnect)

/** For tests: use this database instead of EDITOR_DATABASE_URL. */
export function __setDbForTests(db: Db, listen?: Listen) {
  holder.__editorDb = Promise.resolve({
    db,
    migrate: async () => {},
    close: async () => {},
    listen: listen ?? (async () => async () => {}),
  })
}
