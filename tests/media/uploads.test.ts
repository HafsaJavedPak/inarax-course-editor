import { describe, expect, it } from "vitest"

import { extensionFor, imageSrc, parseUploadPath, rewriteUploadUrls, uploadContentType, uploadPath, uploadScopeFromPath, uploadUrlsIn, withLocalUploads, WORKSPACE_SCOPE } from "@/lib/uploads"

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const NAME = "33333333-3333-4333-8333-333333333333.png"

describe("upload paths", () => {
  it("reads and builds tenant-scoped, workspace and legacy paths", () => {
    expect(parseUploadPath(`/uploads/${T}/${C}/${NAME}`)).toEqual({ tenantId: T, scope: C, name: NAME })
    expect(parseUploadPath(`/uploads/${T}/${WORKSPACE_SCOPE}/${NAME}`)).toEqual({ tenantId: T, scope: "workspace", name: NAME })
    expect(parseUploadPath(`/uploads/${NAME}`)).toEqual({ tenantId: null, scope: null, name: NAME })
    for (const ref of [{ tenantId: T, scope: C, name: NAME }, { tenantId: null, scope: null, name: NAME }]) {
      expect(parseUploadPath(uploadPath(ref))).toEqual(ref)
    }
  })

  it("refuses anything else (traversal, odd scopes, SVG, other extensions)", () => {
    for (const bad of [`/uploads/../${NAME}`, `/uploads/${T}/${NAME}`, `/uploads/${T}/other/${NAME}`, `/uploads/${T}/${C}/${NAME}/x`, "/uploads/x.svg", `/uploads/${NAME.replace("png", "svg")}`, `/uploads/${NAME.replace("png", "exe")}`]) {
      expect(parseUploadPath(bad), bad).toBeNull()
    }
  })

  it("knows the content types, including AI-generated video", () => {
    expect(uploadContentType(NAME)).toBe("image/png")
    expect(uploadContentType("a.mp4")).toBe("video/mp4")
    expect(uploadContentType("a.svg")).toBeNull()
    expect(extensionFor("image/jpeg")).toBe("jpg")
    expect(extensionFor("image/svg+xml")).toBeNull()
  })
})

describe("uploads inside content", () => {
  const json = JSON.stringify({ a: `http://localhost:3001/uploads/${NAME}`, b: `https://ed.test/uploads/${T}/${C}/${NAME}`, c: "https://elsewhere.test/pic.png" })

  it("finds every upload URL, new and legacy, and nothing else", () => {
    expect(uploadUrlsIn(json).map((u) => u.ref.tenantId)).toEqual([null, T])
  })

  it("shows our uploads from the current host and leaves other URLs alone", () => {
    expect(imageSrc(`http://localhost:3001/uploads/${T}/${C}/${NAME}`)).toBe(`/uploads/${T}/${C}/${NAME}`)
    expect(imageSrc("https://elsewhere.test/pic.png")).toBe("https://elsewhere.test/pic.png")
    expect(withLocalUploads({ u: `https://ed.test/uploads/${T}/${C}/${NAME}` })).toEqual({ u: `/uploads/${T}/${C}/${NAME}` })
  })

  it("rewrites chosen uploads and keeps the host they were saved with", () => {
    const out = rewriteUploadUrls(json, (ref, url) => (ref.tenantId ? null : url.replace(uploadPath(ref), uploadPath({ tenantId: T, scope: C, name: ref.name }))))
    expect(out.changed).toBe(1)
    expect(out.text).toContain(`http://localhost:3001/uploads/${T}/${C}/${NAME}`)
    expect(out.text).toContain("https://elsewhere.test/pic.png")
  })
})

describe("uploadScopeFromPath", () => {
  it("says which course or workspace a page is working on", () => {
    expect(uploadScopeFromPath(`/courses/${C}/lessons/x`)).toEqual({ course: C })
    expect(uploadScopeFromPath(`/admin/courses/${C}/edit`)).toEqual({ course: C })
    expect(uploadScopeFromPath(`/w/${T}/courses/new`)).toEqual({ workspace: T })
    expect(uploadScopeFromPath("/dashboard")).toBeNull()
  })
})
