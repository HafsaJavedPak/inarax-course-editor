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
import { uploadContentType, uploadPath, uploadUrlsIn, type UploadRef } from "@/lib/uploads"

// Images uploaded to this editor: absolute URLs ending in an upload path (lib/uploads.ts):
// /uploads/<tenant>/<course>/<uuid>.<ext>, or the legacy /uploads/<uuid>.<ext>.

export type AssetPublisherOptions = {
  http: HttpClient
  manifest: Manifest
  /** This editor's public address, for images the host can't store. */
  publicBaseUrl?: string
  /** Reads an upload's bytes; null when the file is gone. */
  readUpload: (ref: UploadRef) => Promise<Uint8Array | null>
}

export function createAssetPublisher({ http, manifest, publicBaseUrl, readUpload }: AssetPublisherOptions) {
  const resolved = new Map<string, Promise<string>>() // upload name → URL to publish
  const notCopied = new Map<string, string>() // upload name → why it stayed on the editor
  const missing = new Set<string>()
  const assets = manifest.capabilities.assets

  const editorUrl = (ref: UploadRef, original: string) =>
    publicBaseUrl ? `${publicBaseUrl.replace(/\/+$/, "")}${uploadPath(ref)}` : original

  async function copy(ref: UploadRef, original: string): Promise<string> {
    const name = ref.name
    const contentType = uploadContentType(name) ?? "application/octet-stream"
    if (!assets) {
      notCopied.set(name, "the platform doesn't store images")
      return editorUrl(ref, original)
    }
    if (!assets.content_types.includes(contentType)) {
      notCopied.set(name, `the platform doesn't accept ${contentType}`)
      return editorUrl(ref, original)
    }
    const bytes = await readUpload(ref)
    if (!bytes) {
      missing.add(name)
      return original
    }
    if (bytes.byteLength > assets.max_bytes) {
      notCopied.set(name, `larger than the platform's ${Math.floor(assets.max_bytes / 1024 / 1024)} MB limit`)
      return editorUrl(ref, original)
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
      return editorUrl(ref, original)
    }
  }

  /** The URL to publish for `url`: the host's copy for editor uploads, unchanged otherwise. */
  function resolve(url: string): Promise<string> {
    const ref = uploadUrlsIn(url)[0]?.ref
    if (!ref) return Promise.resolve(url)
    const name = ref.name
    if (!resolved.has(name)) resolved.set(name, copy(ref, url))
    return resolved.get(name)!
  }

  /** A copy of `value` (e.g. lesson content) with every editor upload URL replaced. */
  async function rewrite<T>(value: T): Promise<T> {
    let json = JSON.stringify(value)
    for (const url of new Set(uploadUrlsIn(json).map((u) => u.url))) {
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
      out.push(`${notCopied.size} image${notCopied.size === 1 ? "" : "s"} couldn't be copied to the platform (${reasons}). ${where}.${publicBaseUrl ? " Those links need a signed-in editor session, so learners can't load them: fix the platform's image storage and publish again." : ""}`)
    }
    if (missing.size) {
      out.push(`${missing.size} image${missing.size === 1 ? " is" : "s are"} missing from this editor's uploads folder and couldn't be copied: ${[...missing].join(", ")}.`)
    }
    return out
  }

  return { resolve, rewrite, warnings }
}
