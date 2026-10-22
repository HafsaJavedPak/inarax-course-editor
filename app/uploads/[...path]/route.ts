import { getRequestContext } from "@/lib/authz/context"
import { mayReadUpload } from "@/lib/media/access"
import { readUpload } from "@/lib/media/store"
import { parseUploadPath } from "@/lib/uploads"

// Uploaded and AI-generated files are private (R1): this is the only way to load one. The path is
// /uploads/<tenantId>/<course id | workspace>/<uuid>.<ext>; legacy files are /uploads/<uuid>.<ext>.
// Anyone who may read the course may load its files; everyone else gets "Not found" (never a hint
// that the file exists). Learners don't load files from here: publishing copies images to the platform.

const notFound = () => new Response("Not found", { status: 404 })

/** `Range: bytes=a-b` (what a browser asks for when it plays or seeks a video), or null when absent or unusable. */
function byteRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "")
  if (!match || (match[1] === "" && match[2] === "")) return null
  const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1])
  const end = match[1] === "" || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1)
  return start <= end && start < size ? { start, end } : null
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const ref = parseUploadPath(`/uploads/${path.join("/")}`)
  if (!ref) return notFound()

  const access = await getRequestContext()
  if (!(await mayReadUpload(access, ref))) return notFound()

  const file = await readUpload(ref)
  if (!file) return notFound()

  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    // Names are unique per upload, so the file never changes; but it's private, so no shared cache.
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  }
  const size = file.bytes.byteLength
  const range = byteRange(request.headers.get("range"), size)
  if (!range) return new Response(file.bytes as Uint8Array<ArrayBuffer>, { headers: { ...headers, "Content-Length": String(size) } })
  return new Response((file.bytes as Uint8Array<ArrayBuffer>).slice(range.start, range.end + 1), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": String(range.end - range.start + 1) },
  })
}
