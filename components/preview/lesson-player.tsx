"use client"

import { useEffect, useMemo, useState } from "react"

// --- inara-next's learner player (copied by scripts/sync-inara-player.mjs) ---
import InteractiveLessonRunner from "@/vendor/inara-player/components/ile/InteractiveLessonRunner"
import { LessonProgressProvider } from "@/vendor/inara-player/components/ile/LessonProgressProvider"
import { clearIleSessionProgress } from "@/vendor/inara-player/lib/ile/session-storage"
import { safeParseLessonContent } from "@/vendor/inara-player/lib/lesson-content/schema"
import "@/vendor/inara-player/player.css"

import { withLocalUploads } from "@/lib/uploads"

import "@/components/preview/preview.scss"

/**
 * A lesson as learners see it on inara-next, rendered with inara-next's own
 * player (same wiring and lesson column as its admin preview). The lesson is
 * checked with inara-next's schema first; if it would be refused there, the
 * problems are listed instead.
 *
 * Answers and section progress are kept for this preview only (in session
 * storage under a throwaway id) and nothing is sent anywhere.
 */
export function LessonPlayer({
  lesson,
  lessonTitle,
  moduleTitle,
}: {
  lesson: unknown
  lessonTitle?: string
  moduleTitle?: string
}) {
  // A fresh id per mount, so each preview starts clean; cleared on unmount.
  const [previewId] = useState(() => `editor-preview-${crypto.randomUUID()}`)
  useEffect(() => () => clearIleSessionProgress(previewId), [previewId])

  // Validated with inara-next's schema; images uploaded to this editor are then
  // loaded from the current host, since their saved address may name another
  // port or proxy (see lib/uploads.ts). Recomputed only when the lesson changes.
  const parsed = useMemo(() => {
    const result = safeParseLessonContent(lesson)
    return result.success ? { success: true as const, data: withLocalUploads(result.data) } : result
  }, [lesson])
  if (!parsed.success) {
    return (
      <div className="pv-invalid" role="alert">
        <p className="pv-invalid-title">This lesson can&apos;t be previewed yet: inara-next would refuse it.</p>
        <ul>
          {parsed.error.issues.map((issue: { path: (string | number)[]; message: string }, i: number) => (
            <li key={i}>
              <code>{issue.path.join(".") || "lesson"}</code>: {issue.message}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="inara-player">
      <div className="font-montserrat">
        {/* inara-next's lesson column (max-w-5xl, white, slate-200 border); see preview.scss */}
        <div className="pv-column">
          <LessonProgressProvider content={parsed.data} lessonId={previewId} persistPoints={false}>
            <InteractiveLessonRunner showSectionNav lessonTitle={lessonTitle} moduleTitle={moduleTitle} />
          </LessonProgressProvider>
        </div>
      </div>
    </div>
  )
}
