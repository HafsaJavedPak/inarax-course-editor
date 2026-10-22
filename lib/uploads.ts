// Uploaded files (images, AI-generated images and videos): how their addresses look
// and how to read them. Pure (no storage, no request), so client components and the
// server share it; the bytes live behind lib/media/store.ts.
//
// An upload is private to the workspace that made it (R1):
//
//   /uploads/<tenantId>/<course id | "workspace">/<uuid>.<ext>
//
// and is served only to someone who may read that course (app/uploads/[...path]).
// "workspace" is for files made before a course exists (the cover image of a new course).
// Files from before tenant scoping are /uploads/<uuid>.<ext> ("legacy"): they still load,
// for any signed-in user, until `npm run uploads:migrate` has moved them.

/** What each file extension is: the types an upload may have (no SVG: it can carry scripts). */
export const UPLOAD_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  mp4: "video/mp4",
} as const

export type UploadExtension = keyof typeof UPLOAD_TYPES

/** The scope of an upload made before its course exists (a new course's cover image). */
export const WORKSPACE_SCOPE = "workspace"

export type UploadRef = {
  /** The workspace that owns the file; null for a legacy (pre-R1) file. */
  tenantId: string | null
  /** The course id, or WORKSPACE_SCOPE; null for a legacy file. */
  scope: string | null
  /** `<uuid>.<ext>` */
  name: string
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const EXTENSIONS = Object.keys(UPLOAD_TYPES).join("|")

/** The path of an upload, for use inside a larger regular expression (no anchors, no flags). */
export const UPLOAD_PATH_SOURCE = `\\/uploads\\/(?:${UUID}\\/(?:${UUID}|${WORKSPACE_SCOPE})\\/)?${UUID}\\.(?:${EXTENSIONS})`

const UPLOAD_PATH_RE = new RegExp(`^/uploads/(?:(${UUID})/(${UUID}|${WORKSPACE_SCOPE})/)?(${UUID}\\.(?:${EXTENSIONS}))$`, "i")
const SAMPLE_PATH_RE = /^\/images\/sample-course\/[a-z0-9-]+\.svg$/i

/** The upload a path (`/uploads/…`) names, or null when it isn't one. */
export function parseUploadPath(pathname: string): UploadRef | null {
  const match = UPLOAD_PATH_RE.exec(pathname)
  if (!match) return null
  return { tenantId: match[1]?.toLowerCase() ?? null, scope: match[2]?.toLowerCase() ?? null, name: match[3].toLowerCase() }
}

/** The path an upload is served at. */
export function uploadPath(ref: UploadRef): string {
  return ref.tenantId && ref.scope ? `/uploads/${ref.tenantId}/${ref.scope}/${ref.name}` : `/uploads/${ref.name}`
}

/** The content type of an upload, from its extension. */
export function uploadContentType(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase()
  return ext && ext in UPLOAD_TYPES ? UPLOAD_TYPES[ext as UploadExtension] : null
}

/** The extension for a content type (`image/png` → `png`), or null when uploads can't be of that type. */
export function extensionFor(contentType: string): UploadExtension | null {
  const found = Object.entries(UPLOAD_TYPES).find(([, type]) => type === contentType)
  return found ? (found[0] as UploadExtension) : null
}

/**
 * Where a page is working, from its address: the scope a file uploaded there belongs to.
 * `/courses/<id>/…` and `/admin/courses/<id>/…` are that course; `/w/<workspace>/courses/new` is the
 * workspace (the course doesn't exist yet).
 */
export function uploadScopeFromPath(pathname: string): { course: string } | { workspace: string } | null {
  const course = new RegExp(`^/(?:admin/)?courses/(${UUID})(?:/|$)`, "i").exec(pathname)
  if (course) return { course: course[1].toLowerCase() }
  const workspace = new RegExp(`^/w/(${UUID})(?:/|$)`, "i").exec(pathname)
  return workspace ? { workspace: workspace[1].toLowerCase() } : null
}

/**
 * The address to show an image from. Uploads are stored as full URLs with
 * the host they were uploaded on, which may not be this one (another port,
 * or an internal proxy address), so our own uploads are loaded from the
 * current host. Other URLs are returned unchanged.
 */
export function imageSrc(url: string): string {
  try {
    const { pathname } = new URL(url)
    return parseUploadPath(pathname) || SAMPLE_PATH_RE.test(pathname) ? pathname : url
  } catch {
    return url
  }
}

// Our uploads (and sample-course pictures) anywhere inside a string (image fields, markdown image links).
const UPLOAD_URL_IN_TEXT_RE = new RegExp(`https?:\\/\\/[^\\s"'()<>]+?(${UPLOAD_PATH_SOURCE}|\\/images\\/sample-course\\/[a-z0-9-]+\\.svg)`, "gi")

/**
 * A copy of `value` (e.g. lesson content) with every one of our uploads
 * pointed at the current host, as imageSrc does for a single URL.
 */
export function withLocalUploads<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(UPLOAD_URL_IN_TEXT_RE, "$1"))
}

/** Every upload URL inside a string, as written (absolute URLs ending in an upload path). */
export function uploadUrlsIn(text: string): { url: string; ref: UploadRef }[] {
  const re = new RegExp(`https?:\\/\\/[^\\s"'()<>]+?(${UPLOAD_PATH_SOURCE})`, "gi")
  const found: { url: string; ref: UploadRef }[] = []
  for (const m of text.matchAll(re)) {
    const ref = parseUploadPath(m[1])
    if (ref) found.push({ url: m[0], ref })
  }
  return found
}

/**
 * `text` with every upload URL replaced by what `change` returns for it (null keeps it).
 * The replacement is of the whole URL, so the host it was uploaded on is kept.
 */
export function rewriteUploadUrls(text: string, change: (ref: UploadRef, url: string) => string | null): { text: string; changed: number } {
  let changed = 0
  let out = text
  const seen = new Map<string, string | null>()
  for (const { url, ref } of uploadUrlsIn(text)) if (!seen.has(url)) seen.set(url, change(ref, url))
  for (const [url, replacement] of seen) {
    if (replacement === null || replacement === url) continue
    out = out.split(url).join(replacement)
    changed++
  }
  return { text: out, changed }
}
