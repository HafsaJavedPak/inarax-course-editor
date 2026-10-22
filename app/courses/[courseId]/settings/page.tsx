import Link from "next/link"

import { CourseSettings } from "@/components/course/course-settings"
import { AppHeader } from "@/components/course/app-header"
import { coursePaths } from "@/lib/admin-mode"
import { CourseAccessModePicker } from "@/components/course/access-mode-field"
import { CourseDepartmentPicker } from "@/components/course/department-field"
import { authorCourseForPage, permissionsFor } from "@/lib/authz/context"
import { choosableDepartments } from "@/lib/authz/departments"
import { roleIn } from "@/lib/authz/policy"
import { listDepartments } from "@/lib/departments"

import "@/components/lesson-editor/lesson-editor.scss"
import "@/components/course/course-builder.scss"

export default async function Page({ params }: PageProps<"/courses/[courseId]/settings">) {
  const { courseId } = await params
  const { ctx, record } = await authorCourseForPage(courseId, coursePaths(true).settings(courseId))
  const course = record.course
  const permissions = permissionsFor(ctx, record)
  const canEdit = permissions.settings
  // An organization course may sit in a department the person may use (and in the one it is in now).
  const all = record.tenantKind === "org" ? await listDepartments(record.tenantId) : []
  const departments = choosableDepartments(ctx, { id: record.tenantId, role: roleIn(ctx, record.tenantId) }, all)
  const current = all.find((d) => d.id === record.departmentId)
  if (current && !departments.some((d) => d.id === current.id)) departments.push(current)

  return (
    <div className="in-page">
      <AppHeader workspace={record.tenantId} />
      <main className="in-container">
        <Link href={`/courses/${course.id}`} className="in-back">
          ← {course.title}
        </Link>
        <div className="in-page-title">
          <h1>Course settings</h1>
          <p>Details, lesson limits and pricing. Levels, modules and lessons are edited in the builder.</p>
        </div>
        {record.tenantKind === "org" && (departments.length > 0 || record.departmentId) && (
          <CourseDepartmentPicker
            courseId={course.id}
            departments={departments.map((d) => ({ id: d.id, name: d.name }))}
            current={record.departmentId}
            disabled={!canEdit}
          />
        )}
        {permissions.sponsor && <CourseAccessModePicker courseId={course.id} current={record.accessMode} />}
        <CourseSettings course={course} canEdit={canEdit} />
      </main>
    </div>
  )
}
