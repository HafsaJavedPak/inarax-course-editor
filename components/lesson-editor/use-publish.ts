"use client"

import { useCallback, useRef, useState } from "react"

import { modeHeaders } from "@/lib/admin-mode"

/**
 * "off": no platform is set up, so Save only saves locally (not an error).
 * `issues`: problems the platform found, located in the course (fix and Save again).
 */
export type PublishStatus = "idle" | "publishing" | "off" | { error: string; issues?: string[] }

/**
 * Publishing the course to the platform. Autosave only writes the
 * local files; the Save button saves locally and then calls `publish`.
 */
export function usePublish(
  courseId: string,
  isAdmin: boolean,
  initialPublishedAt: string | null,
  /** False when no platform is set up (the page knows from the server). */
  enabled = true,
) {
  const [status, setStatus] = useState<PublishStatus>(enabled ? "idle" : "off")
  const [publishedAt, setPublishedAt] = useState<Date | null>(
    initialPublishedAt ? new Date(initialPublishedAt) : null,
  )
  // True once something was edited here after the last publish.
  const [pending, setPending] = useState(false)
  // From the last publish: things that went through but need attention.
  const [warnings, setWarnings] = useState<string[]>([])
  const changesRef = useRef(0)

  /** Call on every edit. */
  const markChanged = useCallback(() => {
    changesRef.current += 1
    setPending(true)
  }, [])

  /** Publishes what's saved on disk; false if it failed (the status says why). */
  const publish = useCallback(async (): Promise<boolean> => {
    if (!enabled) return true // nothing to publish to: saving locally was all
    const changesAtStart = changesRef.current
    setStatus("publishing")
    try {
      const res = await fetch(`/api/courses/${courseId}/publish`, {
        method: "POST",
        headers: modeHeaders(isAdmin),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.code === "not_configured") setStatus("off")
        else setStatus({ error: data.error ?? `Publish failed (${res.status})`, issues: Array.isArray(data.issues) ? data.issues : undefined })
        return false
      }
      setPublishedAt(new Date(data.publishedAt))
      setWarnings(data.summary?.warnings ?? [])
      setPending(changesRef.current !== changesAtStart)
      setStatus("idle")
      return true
    } catch {
      setStatus({ error: "Publish failed: network error" })
      return false
    }
  }, [courseId, isAdmin, enabled])

  return { status, publishedAt, pending, warnings, enabled, markChanged, publish }
}

export type Publisher = ReturnType<typeof usePublish>
