"use client"

import { useCallback, useRef, useState } from "react"

import { modeHeaders } from "@/lib/admin-mode"

export type PublishStatus = "idle" | "publishing" | { error: string }

/**
 * Publishing the course to the platform database. Autosave only writes the
 * local files; the Save button saves locally and then calls `publish`.
 */
export function usePublish(courseId: string, isAdmin: boolean, initialPublishedAt: string | null) {
  const [status, setStatus] = useState<PublishStatus>("idle")
  const [publishedAt, setPublishedAt] = useState<Date | null>(
    initialPublishedAt ? new Date(initialPublishedAt) : null,
  )
  // True once something was edited here after the last publish.
  const [pending, setPending] = useState(false)
  const changesRef = useRef(0)

  /** Call on every edit. */
  const markChanged = useCallback(() => {
    changesRef.current += 1
    setPending(true)
  }, [])

  /** Publishes what's saved on disk; false if it failed (the status says why). */
  const publish = useCallback(async (): Promise<boolean> => {
    const changesAtStart = changesRef.current
    setStatus("publishing")
    try {
      const res = await fetch(`/api/courses/${courseId}/publish`, {
        method: "POST",
        headers: modeHeaders(isAdmin),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus({ error: data.error ?? `Publish failed (${res.status})` })
        return false
      }
      setPublishedAt(new Date(data.publishedAt))
      setPending(changesRef.current !== changesAtStart)
      setStatus("idle")
      return true
    } catch {
      setStatus({ error: "Publish failed: network error" })
      return false
    }
  }, [courseId, isAdmin])

  return { status, publishedAt, pending, markChanged, publish }
}

export type Publisher = ReturnType<typeof usePublish>
