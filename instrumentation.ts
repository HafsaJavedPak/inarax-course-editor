// Runs once when the Next.js server starts. For local work, COLLAB_EMBEDDED=1
// starts the collaboration gateway inside this process: PGlite (the local
// database) can only be opened by one process. In production the gateway is
// its own service (collab/main.ts).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.COLLAB_EMBEDDED !== "1") return
  const holder = globalThis as typeof globalThis & { __inaraGatewayStarted?: boolean }
  if (holder.__inaraGatewayStarted) return // dev-server reloads
  holder.__inaraGatewayStarted = true
  const { startGateway } = await import("./collab/start")
  await startGateway(process.env, { embedded: true })
}
