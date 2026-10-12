import { z } from "zod"

import { getRequestContext } from "@/lib/authz/context"
import { setTenantSharing } from "@/lib/authz/grants"
import { parseBody, RoleSchema, sharingRoute } from "@/lib/authz/sharing-http"

const SharingSchema = z.object({ allow_guests: z.boolean(), guest_max_role: RoleSchema })

/** An organization's rules for inviting people from outside it (its admins only). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/workspaces/[workspace]/sharing">) {
  const { workspace } = await ctx.params
  const access = await getRequestContext()
  if (!access.tenantIds.includes(workspace)) return Response.json({ error: "Workspace not found" }, { status: 404 })
  return sharingRoute(async () => {
    const input = parseBody(SharingSchema, await request.text())
    if (input instanceof Response) return input
    await setTenantSharing(access, workspace, input)
    return Response.json({ sharing: input })
  })
}
