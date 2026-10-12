import { editorKeys } from "@/lib/keys"
import { KeyConfigError, toJwks } from "@/lib/protocol/keys"

/**
 * GET /.well-known/jwks.json: the editor's PUBLIC keys. The host fetches them
 * to check the editor's signed publish requests. Private keys never leave the
 * editor. After a rotation only the current keys are listed.
 */
export async function GET() {
  try {
    return Response.json(toJwks(editorKeys()), { headers: { "Cache-Control": "public, max-age=60" } })
  } catch (error) {
    if (error instanceof KeyConfigError) return Response.json({ keys: [] }, { status: 503, headers: { "Cache-Control": "no-store" } })
    throw error
  }
}
