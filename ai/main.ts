// The AI worker as its own process: npm run ai:worker.
// On SIGTERM (a deploy) it stops claiming and finishes the job it holds; the
// lease of any job it hadn't finished expires and the reaper requeues it, so
// nothing is lost. It shares the editor database with the app.

import { startWorker } from "./worker"

async function main() {
  const worker = await startWorker()
  let stopping = false
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (stopping) return
      stopping = true
      void worker
        .close()
        .catch((error) => console.error("Stopping the AI worker:", error))
        .finally(() => process.exit(0))
    })
  }
}

main().catch((error) => {
  console.error("The AI worker couldn't start:", error)
  process.exit(1)
})
