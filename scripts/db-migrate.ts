// Applies the migrations in db/drizzle to EDITOR_DATABASE_URL. Run before starting a
// new version of the editor (render.yaml runs it as the pre-deploy command):
//
//   npm run db:migrate
//
// PGlite databases (EDITOR_DATABASE_URL=pglite:…) are also migrated when the editor opens them.
import { connect } from "../lib/db/client"

async function main() {
  const url = process.env.EDITOR_DATABASE_URL
  if (!url) throw new Error("EDITOR_DATABASE_URL is not set (see .env.example).")
  const conn = await connect(url)
  try {
    await conn.migrate()
    console.log("Database is up to date.")
  } finally {
    await conn.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
