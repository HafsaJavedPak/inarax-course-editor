import { randomUUID } from "crypto"

import { sql } from "drizzle-orm"

import { __setDbForTests, connect, type Db } from "@/lib/db/client"

/**
 * A fresh, migrated database installed as the app's database, queried as a
 * non-superuser role, as in production, so row-level security applies
 * (superusers skip it).
 *
 * By default it's an in-memory Postgres (PGlite): fast, no server needed, but
 * a single connection, so transactions never actually overlap. Set
 * TEST_DATABASE_URL to a Postgres server (as a user that may create databases
 * and roles) to run the same tests against real Postgres with a connection
 * pool, where concurrent requests really do race. Each test file then gets its
 * own new database.
 */
export async function useTestDb(): Promise<Db> {
  const server = process.env.TEST_DATABASE_URL
  return server ? openPostgresServer(server) : openPglite()
}

async function openPglite(): Promise<Db> {
  const conn = await connect("pglite:memory")
  await conn.migrate()
  await conn.db.execute(sql`CREATE ROLE editor_app NOSUPERUSER`)
  await conn.db.execute(sql`GRANT ALL ON ALL TABLES IN SCHEMA public TO editor_app`)
  await conn.db.execute(sql`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO editor_app`)
  await conn.db.execute(sql`SET ROLE editor_app`)
  __setDbForTests(conn.db)
  return conn.db
}

const APP_ROLE = "editor_test_app"
const APP_PASSWORD = "editor_test_app"

async function openPostgresServer(serverUrl: string): Promise<Db> {
  const { Client } = await import("pg")
  const database = `editor_test_${randomUUID().replaceAll("-", "")}`

  // As the admin user: a new database, and a login role that isn't a superuser.
  const admin = new Client({ connectionString: serverUrl })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${database}`)
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER PASSWORD '${APP_PASSWORD}';
      END IF;
    END $$`)
  } finally {
    await admin.end()
  }

  // Migrate as the admin (the tables' owner), then grant the app role what production's role has.
  const adminUrl = withDatabase(serverUrl, database)
  const owner = await connect(adminUrl)
  await owner.migrate()
  await owner.db.execute(sql.raw(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`))
  await owner.db.execute(sql.raw(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`))
  await owner.close()

  const appUrl = new URL(adminUrl)
  appUrl.username = APP_ROLE
  appUrl.password = APP_PASSWORD
  const app = await connect(appUrl.toString())
  __setDbForTests(app.db)
  return app.db
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}
