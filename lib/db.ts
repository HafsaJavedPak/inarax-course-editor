import postgres from "postgres"

/**
 * The platform's Postgres (Supabase). Connected directly rather than through
 * the Supabase REST API: the platform's tables aren't exposed to the API
 * roles, and a publish writes several tables in one transaction.
 *
 * One client per server process; in dev it's kept on globalThis so hot
 * reloads don't open a new pool each time.
 */
const globalForDb = globalThis as unknown as { inaraSql?: postgres.Sql }

export function getSql(): postgres.Sql {
  if (globalForDb.inaraSql) return globalForDb.inaraSql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set, so courses can't be published to the database.")
  globalForDb.inaraSql = postgres(url, {
    max: 5,
    idle_timeout: 20,
    // Supabase's transaction pooler doesn't support prepared statements.
    prepare: false,
  })
  return globalForDb.inaraSql
}
