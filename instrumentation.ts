// Runs once when the Next.js server starts.
//
// Local work: PGlite (the local database) can only be opened by one process, so
// the collaboration gateway (COLLAB_EMBEDDED=1) and the AI worker run inside
// this process. In production each is its own service (collab/main.ts,
// ai/main.ts) sharing a real Postgres.
//
// The AI worker is embedded automatically when AI is on and the database is
// PGlite, so local jobs run without a second terminal; set AI_EMBEDDED=0 to opt
// out, or point EDITOR_DATABASE_URL at Postgres and run `npm run ai:worker`.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  if (process.env.COLLAB_EMBEDDED === "1") {
    const holder = globalThis as typeof globalThis & { __inaraGatewayStarted?: boolean }
    if (!holder.__inaraGatewayStarted) {
      holder.__inaraGatewayStarted = true // dev-server reloads
      const { startGateway } = await import("./collab/start")
      await startGateway(process.env, { embedded: true })
    }
  }

  const embeddedWorker = process.env.AI_EMBEDDED !== "0" && (process.env.EDITOR_DATABASE_URL ?? "").startsWith("pglite:")
  if (embeddedWorker && process.env.AI_ENABLED) {
    const holder = globalThis as typeof globalThis & { __inaraAiWorkerStarted?: boolean }
    if (!holder.__inaraAiWorkerStarted) {
      holder.__inaraAiWorkerStarted = true
      const { startWorker } = await import("./ai/worker")
      await startWorker({ quiet: true })
    }
  }
}
