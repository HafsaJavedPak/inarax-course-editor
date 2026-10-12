import { redirect } from "next/navigation"

import { currentWorkspace, getRequestContext } from "@/lib/authz/context"

/** New courses are created in a workspace: the one last opened. */
export default async function Page() {
  const workspace = await currentWorkspace(await getRequestContext())
  redirect(`/w/${workspace.tenantId}/courses/new`)
}
