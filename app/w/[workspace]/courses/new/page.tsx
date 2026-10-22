import Link from "next/link"

import { AppHeader } from "@/components/course/app-header"
import { CourseInfoForm } from "@/components/course/course-info-form"
import { workspaceForPage } from "@/lib/authz/context"
import { choosableDepartments } from "@/lib/authz/departments"
import { canInTenant } from "@/lib/authz/policy"
import { listDepartments } from "@/lib/departments"
import { notFound } from "next/navigation"

import "@/components/lesson-editor/lesson-editor.scss"

export default async function Page({ params }: PageProps<"/w/[workspace]/courses/new">) {
  const { ctx, workspace } = await workspaceForPage((await params).workspace)
  if (!canInTenant(ctx, "course.create", workspace.tenantId)) notFound()

  // An organization's departments the creator may use; personal workspaces have none.
  const departments =
    workspace.kind === "org"
      ? choosableDepartments(ctx, { id: workspace.tenantId, role: workspace.role }, await listDepartments(workspace.tenantId)).map((d) => ({ id: d.id, name: d.name }))
      : []

  return (
    <div className="in-page">
      <AppHeader current="dashboard" workspace={workspace.tenantId} />
      <main className="in-container">
        <Link href={`/w/${workspace.tenantId}`} className="in-back">
          ← {workspace.name}
        </Link>
        <div className="in-page-title">
          <h1>New course</h1>
          <p>Start with the basics. You’ll add levels, modules and lessons next.</p>
        </div>
        <CourseInfoForm workspace={workspace.tenantId} departments={departments} />
      </main>
    </div>
  )
}
