/**
 * GET /health: for the host's health check (render.yaml). Public, and it doesn't
 * touch the platform or the disk, so a slow platform never fails the editor's check.
 */
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}
