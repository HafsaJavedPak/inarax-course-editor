import path from "path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // Next.js resolves this to nothing on the server; outside Next it would throw.
      "server-only": path.resolve(__dirname, "tests/helpers/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests with a database start an in-process Postgres (PGlite) first, which takes a few seconds.
    hookTimeout: 60_000,
  },
})
