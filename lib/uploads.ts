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

// Our uploads anywhere inside a string (image fields, markdown image links).
const UPLOAD_URL_IN_TEXT_RE = /https?:\/\/[^\s"'()<>]+?(\/uploads\/[0-9a-f-]{36}\.(?:png|jpg|gif|webp|avif))/gi

/**
 * A copy of `value` (e.g. lesson content) with every one of our uploads
 * pointed at the current host, as imageSrc does for a single URL.
 */
export function withLocalUploads<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(UPLOAD_URL_IN_TEXT_RE, "$1"))
}
