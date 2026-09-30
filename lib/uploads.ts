// Matches the images /api/uploads creates (see app/uploads/[file]/route.ts).
const UPLOAD_PATH_RE = /^\/uploads\/[0-9a-f-]{36}\.(?:png|jpg|gif|webp|avif)$/i

/**
 * The address to show an image from. Uploads are stored as full URLs with
 * the host they were uploaded on, which may not be this one (another port,
 * or an internal proxy address), so our own uploads are loaded from the
 * current host. Other URLs are returned unchanged.
 */
export function imageSrc(url: string): string {
  try {
    const { pathname } = new URL(url)
    return UPLOAD_PATH_RE.test(pathname) ? pathname : url
  } catch {
    return url
  }
}
