// The collaboration gateway as its own process: npm run collab.
// On SIGTERM (a deploy) it stores every open document and closes the sockets;
// browsers reconnect to the new instance and lose nothing, since every
// acknowledged edit is already in the operation log.

import { startGateway } from "./start"

async function main() {
  const gateway = await startGateway()
  let stopping = false
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (stopping) return
      stopping = true
      void gateway
        .close()
        .catch((error) => console.error("Stopping the gateway:", error))
        .finally(() => process.exit(0))
    })
  }
}

main().catch((error) => {
  console.error("The collaboration gateway couldn't start:", error)
  process.exit(1)
})
