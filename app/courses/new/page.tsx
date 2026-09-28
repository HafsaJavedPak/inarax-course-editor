import Link from "next/link"

import { AppHeader } from "@/components/course/app-header"
import { CourseInfoForm } from "@/components/course/course-info-form"

import "@/components/lesson-editor/lesson-editor.scss"

export default function Page() {
  return (
    <div className="in-page">
      <AppHeader current="dashboard" />
      <main className="in-container">
        <Link href="/dashboard" className="in-back">
          ← Dashboard
        </Link>
        <div className="in-page-title">
          <h1>New course</h1>
          <p>Start with the basics. You’ll add levels, modules and lessons next.</p>
        </div>
        <CourseInfoForm />
      </main>
    </div>
  )
}
