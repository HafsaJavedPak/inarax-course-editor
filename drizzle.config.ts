import { defineConfig } from "drizzle-kit"

// Migrations are generated from lib/db/schema.ts into db/drizzle (npm run db:generate)
// and applied by scripts/db-migrate.ts (npm run db:migrate).
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./db/drizzle",
})
