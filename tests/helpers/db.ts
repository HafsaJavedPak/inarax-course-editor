import { sql } from "drizzle-orm"

import { __setDbForTests, connect, type Db } from "@/lib/db/client"

/**
 * A fresh, migrated in-memory Postgres (PGlite) installed as the app's database.
 * Queries run as a non-superuser role, as in production, so row-level security
 * applies (superusers skip it).
 */
export async function useTestDb(): Promise<Db> {
  const conn = await connect("pglite:memory")
  await conn.migrate()
  await conn.db.execute(sql`CREATE ROLE editor_app NOSUPERUSER`)
  await conn.db.execute(sql`GRANT ALL ON ALL TABLES IN SCHEMA public TO editor_app`)
  await conn.db.execute(sql`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO editor_app`)
  await conn.db.execute(sql`SET ROLE editor_app`)
  __setDbForTests(conn.db)
  return conn.db
}
