import { redirect } from "next/navigation"

import { currentWorkspace, getRequestContext } from "@/lib/authz/context"

/** The course list of the workspace last opened (the personal workspace at first). */
export default async function Page({ searchParams }: PageProps<"/dashboard">) {
  const workspace = await currentWorkspace(await getRequestContext())
  const { status } = await searchParams
  redirect(`/w/${workspace.tenantId}${typeof status === "string" ? `?status=${encodeURIComponent(status)}` : ""}`)
}
