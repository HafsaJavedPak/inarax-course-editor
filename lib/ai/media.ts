import "server-only"

import { randomUUID } from "crypto"

import type { GeneratedMedia, JobMedia, JobResult } from "@/lib/ai/providers/port"
import { getMediaStore } from "@/lib/media/store"
import { extensionFor, parseUploadPath, uploadPath } from "@/lib/uploads"

// Where an AI job's generated pictures and videos go (R15, R1): the same private, per-workspace
// store as uploads, under the job's workspace and course. Stored by the worker when a candidate
// arrives; the job only keeps the path, so nothing but a short reference is in the database.

/** Stores what a provider generated and returns the job's result with `media` and `assetIds` filled in. */
export async function storeJobMedia(tenantId: string, courseId: string, result: JobResult, media: GeneratedMedia[]): Promise<JobResult> {
  const store = getMediaStore()
  const stored: JobMedia[] = []
  for (const item of media) {
    const ext = extensionFor(item.contentType)
    if (!ext) throw new Error(`Can't store generated ${item.contentType}.`)
    const ref = { tenantId, scope: courseId, name: `${randomUUID()}.${ext}` }
    await store.put(ref, item.bytes, item.contentType)
    stored.push({ kind: item.kind, path: uploadPath(ref), contentType: item.contentType, bytes: item.bytes.byteLength })
  }
  return { ...result, media: stored, assetIds: stored.map((m) => parseUploadPath(m.path)!.name) }
}

/** Removes the files of a job whose candidate was thrown away. Only files in this job's own workspace and course. */
export async function discardJobMedia(tenantId: string, courseId: string, result: JobResult | null): Promise<void> {
  const store = getMediaStore()
  for (const item of result?.media ?? []) {
    const ref = parseUploadPath(item.path)
    if (!ref || ref.tenantId !== tenantId || ref.scope !== courseId) continue
    await store.delete(ref).catch((error) => console.error(`[ai] couldn't remove ${item.path}:`, error))
  }
}
