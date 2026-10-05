// Images uploaded to this editor, copied to the host (contract/README.md § Assets).
//
// Assets are content-addressed: their id is the SHA-256 of their bytes. Before
// uploading, the editor asks the host whether it already has that id, so an
// image is sent once no matter how many publishes or lessons use it, and the
// editor needs no record of what it uploaded.
//
// When the host can't store an image (no asset support, a type or size it
// refuses, storage down), the course links the image from this editor's
// public address instead, and the publish reports it as a warning.

import type { HttpClient } from "@/lib/platform/http-client"
import { HttpError } from "@/lib/platform/http-client"
import { sha256Hex } from "@/lib/protocol/signing"
import { AssetSchema, PROTOCOL_PATHS, type Manifest } from "@/lib/protocol/wire"

// Images uploaded to this editor: absolute URLs ending in /uploads/<uuid>.<ext>.
const UPLOAD_URL_RE = /https?:\/\/[^\s"'()<>]+?\/uploads\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp|avif))/gi

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
}

export type AssetPublisherOptions = {
  http: HttpClient
  manifest: Manifest
  /** This editor's public address, for images the host can't store. */
  publicBaseUrl?: string
  /** Reads an upload's bytes by file name; null when the file is gone. */
  readUpload: (name: string) => Promise<Uint8Array | null>
}

export function createAssetPublisher({ http, manifest, publicBaseUrl, readUpload }: AssetPublisherOptions) {
  const resolved = new Map<string, Promise<string>>() // upload name → URL to publish
  const notCopied = new Map<string, string>() // upload name → why it stayed on the editor
  const missing = new Set<string>()
  const assets = manifest.capabilities.assets

  const editorUrl = (name: string, original: string) =>
    publicBaseUrl ? `${publicBaseUrl.replace(/\/+$/, "")}/uploads/${name}` : original

  async function copy(name: string, original: string): Promise<string> {
    const contentType = CONTENT_TYPES[name.split(".").pop()!.toLowerCase()]
    if (!assets) {
      notCopied.set(name, "the platform doesn't store images")
      return editorUrl(name, original)
    }
    if (!assets.content_types.includes(contentType)) {
      notCopied.set(name, `the platform doesn't accept ${contentType}`)
      return editorUrl(name, original)
    }
    const bytes = await readUpload(name)
    if (!bytes) {
      missing.add(name)
      return original
    }
    if (bytes.byteLength > assets.max_bytes) {
      notCopied.set(name, `larger than the platform's ${Math.floor(assets.max_bytes / 1024 / 1024)} MB limit`)
      return editorUrl(name, original)
    }

    const id = sha256Hex(bytes)
    try {
      const existing = await http.get(PROTOCOL_PATHS.asset(id), AssetSchema).catch((error) => {
        if (error instanceof HttpError && error.status === 404) return null
        throw error
      })
      if (existing) return existing.url
      const stored = await http.put(PROTOCOL_PATHS.asset(id), { bytes, contentType }, AssetSchema)
      return stored.url
    } catch (error) {
      // Credentials problems stop the publish; anything else just keeps the image on the editor.
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) throw error
      const reason = error instanceof HttpError ? (error.problem?.title ?? `HTTP ${error.status || "no response"}`) : (error as Error).message
      notCopied.set(name, reason)
      return editorUrl(name, original)
    }
  }

  /** The URL to publish for `url`: the host's copy for editor uploads, unchanged otherwise. */
  function resolve(url: string): Promise<string> {
    const match = [...url.matchAll(UPLOAD_URL_RE)][0]
    if (!match) return Promise.resolve(url)
    const name = match[1].toLowerCase()
    if (!resolved.has(name)) resolved.set(name, copy(name, url))
    return resolved.get(name)!
  }

  /** A copy of `value` (e.g. lesson content) with every editor upload URL replaced. */
  async function rewrite<T>(value: T): Promise<T> {
    let json = JSON.stringify(value)
    for (const url of new Set([...json.matchAll(UPLOAD_URL_RE)].map((m) => m[0]))) {
      json = json.split(url).join(await resolve(url))
    }
    return JSON.parse(json)
  }

  function warnings(): string[] {
    const out: string[] = []
    if (notCopied.size) {
      const where = publicBaseUrl
        ? `They're linked from this editor (${publicBaseUrl}) instead`
        : "They still point at the address they were uploaded on, which learners may not reach. Set EDITOR_PUBLIC_URL"
      const reasons = [...new Set(notCopied.values())].join("; ")
      out.push(`${notCopied.size} image${notCopied.size === 1 ? "" : "s"} couldn't be copied to the platform (${reasons}). ${where}.`)
    }
    if (missing.size) {
      out.push(`${missing.size} image${missing.size === 1 ? " is" : "s are"} missing from this editor's uploads folder and couldn't be copied: ${[...missing].join(", ")}.`)
    }
    return out
  }

  return { resolve, rewrite, warnings }
}
