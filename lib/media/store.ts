import "server-only"

import { promises as fs } from "fs"
import path from "path"

import { UPLOAD_DIR } from "@/lib/storage"
import { uploadContentType, type UploadRef } from "@/lib/uploads"

// Where uploaded and AI-generated files are kept (R1). One small port, two real
// stores and one for tests, so the routes, the AI worker, publishing and the
// migration script never know which they are talking to.
//
//   firebase  Firebase Storage (a Google Cloud Storage bucket), the same service and the same
//             FIREBASE_* settings inara-next uses for its lesson images. Objects stay private:
//             they are read only through the editor's authorized route (app/uploads/[...path]),
//             never by a public link.
//   disk      UPLOAD_DIR (DATA_DIR/uploads): local work, or a persistent disk on Render.
//
// Files of a workspace are kept under `tenants/<tenantId>/<course id | workspace>/<name>`.
// Legacy files (before tenant scoping) are only ever on disk, at `<name>`; reading one never
// goes to Firebase, and `npm run uploads:migrate` moves them into the tenant layout.

export type StoredFile = { bytes: Uint8Array; contentType: string }

export interface MediaStore {
  readonly kind: "firebase" | "disk" | "memory"
  put(ref: UploadRef, bytes: Uint8Array, contentType: string): Promise<void>
  get(ref: UploadRef): Promise<StoredFile | null>
  delete(ref: UploadRef): Promise<void>
}

/** The object key / relative path of an upload. Legacy files have no tenant: they are `<name>` on disk. */
export function objectKey(ref: UploadRef): string {
  return ref.tenantId && ref.scope ? `tenants/${ref.tenantId}/${ref.scope}/${ref.name}` : ref.name
}

// --- disk -----------------------------------------------------------------------

export function createDiskStore(root: string = UPLOAD_DIR): MediaStore {
  const fileOf = (ref: UploadRef) => path.join(/* turbopackIgnore: true */ root, objectKey(ref))
  return {
    kind: "disk",
    async put(ref, bytes) {
      const file = fileOf(ref)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, bytes)
    },
    async get(ref) {
      const contentType = uploadContentType(ref.name)
      if (!contentType) return null
      try {
        return { bytes: await fs.readFile(fileOf(ref)), contentType }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
        throw error
      }
    },
    async delete(ref) {
      await fs.rm(fileOf(ref), { force: true })
    },
  }
}

// --- Firebase Storage --------------------------------------------------------------

export type FirebaseSettings = { projectId: string; clientEmail: string; privateKey: string; bucket: string }

/** The FIREBASE_* settings, or null when Firebase Storage isn't configured (all four are needed, as in inara-next). */
export function firebaseSettings(env: Readonly<Record<string, string | undefined>> = process.env): FirebaseSettings | null {
  const projectId = env.FIREBASE_PROJECT_ID?.trim()
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim()
  const privateKey = env.FIREBASE_PRIVATE_KEY
  const bucket = env.FIREBASE_STORAGE_BUCKET?.trim()
  if (!projectId || !clientEmail || !privateKey || !bucket) return null
  // The key is kept with literal \n sequences in env files.
  return { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, "\n"), bucket }
}

export function createFirebaseStore(settings: FirebaseSettings): MediaStore {
  let bucket: import("@google-cloud/storage").Bucket | null = null
  const getBucket = async () => {
    if (bucket) return bucket
    const admin = (await import("firebase-admin")).default
    const NAME = "course-editor-media"
    const app =
      admin.apps.find((a) => a?.name === NAME) ??
      admin.initializeApp(
        { credential: admin.credential.cert({ projectId: settings.projectId, clientEmail: settings.clientEmail, privateKey: settings.privateKey }) },
        NAME,
      )
    bucket = admin.storage(app).bucket(settings.bucket)
    return bucket
  }
  const objectOf = async (ref: UploadRef) => (await getBucket()).file(objectKey(ref))
  return {
    kind: "firebase",
    async put(ref, bytes, contentType) {
      const file = await objectOf(ref)
      // Private: no makePublic(), and the cache header says so for anything in between.
      await file.save(Buffer.from(bytes), {
        contentType,
        resumable: false,
        metadata: { contentType, cacheControl: "private, max-age=31536000, immutable" },
      })
    },
    async get(ref) {
      const file = await objectOf(ref)
      const [exists] = await file.exists()
      if (!exists) return null
      const [bytes] = await file.download()
      const contentType = uploadContentType(ref.name)
      return contentType ? { bytes, contentType } : null
    },
    async delete(ref) {
      await (await objectOf(ref)).delete({ ignoreNotFound: true })
    },
  }
}

// --- memory (tests) ----------------------------------------------------------------

export function createMemoryStore(): MediaStore & { files: Map<string, StoredFile> } {
  const files = new Map<string, StoredFile>()
  return {
    kind: "memory",
    files,
    async put(ref, bytes, contentType) {
      files.set(objectKey(ref), { bytes, contentType })
    },
    async get(ref) {
      return files.get(objectKey(ref)) ?? null
    },
    async delete(ref) {
      files.delete(objectKey(ref))
    },
  }
}

// --- which one ---------------------------------------------------------------------

const holder = globalThis as typeof globalThis & { __inaraMediaStore?: MediaStore }

/** Firebase Storage when FIREBASE_* are set, otherwise the disk. Chosen once per process. */
export function getMediaStore(env: Readonly<Record<string, string | undefined>> = process.env): MediaStore {
  if (!holder.__inaraMediaStore) {
    const firebase = firebaseSettings(env)
    holder.__inaraMediaStore = firebase ? createFirebaseStore(firebase) : createDiskStore()
  }
  return holder.__inaraMediaStore
}

/** For tests: use this store (or the default again with undefined). */
export function setMediaStore(store: MediaStore | undefined) {
  holder.__inaraMediaStore = store
}

/** Legacy files (before tenant scoping) are only on disk. */
export function legacyStore(): MediaStore {
  return createDiskStore()
}

/** Reads an upload from wherever it lives: legacy files from disk, the rest from the configured store. */
export function readUpload(ref: UploadRef): Promise<StoredFile | null> {
  return (ref.tenantId ? getMediaStore() : legacyStore()).get(ref)
}
