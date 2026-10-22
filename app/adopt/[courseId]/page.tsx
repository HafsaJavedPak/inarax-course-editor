import Link from "next/link"
import { redirect } from "next/navigation"

import { getRequestContext } from "@/lib/authz/context"
import { adoptCourse, AdoptError } from "@/lib/adopt"
import { isUuid } from "@/lib/lesson"

/**
 * Where an admin lands from the platform's “Edit in course editor”: the course is brought across the first time, then
 * opened. If it can't be (it's plain text from the generation pipeline, the platform refused, …) they are told why.
 */
export default async function AdoptPage({ params }: PageProps<"/adopt/[courseId]">) {
  const { courseId } = await params
  let failure: string | null = null
  let opened: string | null = null

  if (!isUuid(courseId)) {
    failure = "That isn't a course address."
  } else {
    try {
      opened = (await adoptCourse(await getRequestContext(), courseId.toLowerCase())).courseId
    } catch (error) {
      if (!(error instanceof AdoptError)) throw error
      failure = error.message
    }
  }
  // redirect() throws, so it stays outside the try.
  if (opened) redirect(`/courses/${opened}`)

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Can&apos;t open this course here</h1>
      <p className="text-sm text-gray-700">{failure}</p>
      <Link className="in-btn in-btn-primary" href="/dashboard">
        Back to your courses
      </Link>
    </main>
  )
}
