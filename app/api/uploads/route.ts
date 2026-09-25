import { promises as fs } from "fs"
import path from "path"

import { UPLOAD_DIR } from "@/lib/storage"

// Keep in sync with MAX_FILE_SIZE in lib/tiptap-utils.ts (client-side check).
const MAX_FILE_SIZE = 5 * 1024 * 1024

// SVG is excluded on purpose: it can carry scripts.
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
}

/** Store an uploaded image in UPLOAD_DIR and return its URL (served by app/uploads/[file]). */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  const file = form?.get("file")

  if (!(file instanceof File)) {
    return Response.json({ error: "Expected a 'file' field" }, { status: 400 })
  }
  const ext = EXTENSIONS[file.type]
  if (!ext) {
    return Response.json({ error: `Unsupported image type: ${file.type}` }, { status: 415 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: "File is too large" }, { status: 413 })
  }

  const name = `${crypto.randomUUID()}.${ext}`
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  await fs.writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()))

  // Absolute URL: lesson image_url fields must be full URLs.
  const url = new URL(`/uploads/${name}`, request.url).toString()
  return Response.json({ url }, { status: 201 })
}
