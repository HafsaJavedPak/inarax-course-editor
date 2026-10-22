import { randomUUID } from "crypto"

import { getRequestContext } from "@/lib/authz/context"
import { uploadTarget } from "@/lib/media/access"
import { getMediaStore } from "@/lib/media/store"
import { UPLOAD_TYPES, uploadPath, type UploadExtension } from "@/lib/uploads"

// Keep in sync with MAX_FILE_SIZE in lib/tiptap-utils.ts (client-side check).
const MAX_FILE_SIZE = 5 * 1024 * 1024

// Images only (the AI worker stores its own videos). SVG is excluded on purpose: it can carry scripts.
const IMAGE_EXTENSIONS: Record<string, UploadExtension> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
}

/**
 * Store an uploaded image, private to its workspace (lib/media/store.ts), and return its URL
 * (served by app/uploads/[...path] to whoever may read the course). Say where it belongs with
 * `?course=<id>` (an image for that course) or `?workspace=<id>` (before the course exists).
 */
export async function POST(request: Request) {
  const access = await getRequestContext()
  const params = new URL(request.url).searchParams
  const target = await uploadTarget(access, { course: params.get("course"), workspace: params.get("workspace") })
  if (!target.ok) return Response.json({ error: target.error }, { status: target.status })

  const form = await request.formData().catch(() => null)
  const file = form?.get("file")

  if (!(file instanceof File)) {
    return Response.json({ error: "Expected a 'file' field" }, { status: 400 })
  }
  const ext = IMAGE_EXTENSIONS[file.type]
  if (!ext || !(ext in UPLOAD_TYPES)) {
    return Response.json({ error: `Unsupported image type: ${file.type}` }, { status: 415 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: "File is too large" }, { status: 413 })
  }

  const ref = { tenantId: target.tenantId, scope: target.scope, name: `${randomUUID()}.${ext}` }
  await getMediaStore().put(ref, new Uint8Array(await file.arrayBuffer()), file.type)

  // Absolute URL: lesson image_url fields must be full URLs. request.url holds
  // the server's own address (localhost:<port>), so use the host the browser
  // called, which a proxy (e.g. Render) passes on in the forwarded headers.
  const origin = new URL(request.url)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? origin.host
  const url = new URL(uploadPath(ref), `${origin.protocol}//${host}`).toString()
  return Response.json({ url }, { status: 201 })
}
