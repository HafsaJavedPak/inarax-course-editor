// Launch tokens are single-use: each token id (jti) is remembered until the
// token would have expired anyway. In memory, which matches how the editor
// runs (one process with its data on local disk); tokens live about a minute,
// so a restart forgets nothing that still matters for long.

const seen = new Map<string, number>() // jti → exp (unix seconds)

/** True the first time a token id is offered; false for every repeat. */
export function claimTokenId(jti: string, exp: number, now = Math.floor(Date.now() / 1000)): boolean {
  for (const [id, expiresAt] of seen) if (expiresAt <= now) seen.delete(id)
  if (seen.has(jti)) return false
  seen.set(jti, exp)
  return true
}

/** For tests. */
export function __resetSeenTokenIds() {
  seen.clear()
}
