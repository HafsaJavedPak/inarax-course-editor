import Image from "next/image"
import Link from "next/link"

import { getOptionalUser } from "@/lib/auth"
import { authConfig } from "@/lib/auth-gate"
import { getRequestContext } from "@/lib/authz/context"
import { reviewsAnything } from "@/lib/authz/policy"

const ROLE_LABELS = { owner: "Owner", admin: "Admin", creator: "Creator" } as const

/**
 * Top bar for the course pages, modelled on inara-next's admin brand block.
 * `workspace` is the tenant being shown, for the workspace switcher.
 */
export async function AppHeader({ current, workspace }: { current?: "dashboard" | "admin" | "shared"; workspace?: string }) {
  const isAdmin = current === "admin"
  const ctx = await getRequestContext()
  const reviewer = reviewsAnything(ctx)
  const active = ctx.workspaces.find((w) => w.tenantId === workspace)
  // Signed in through the platform: show who, and sign out.
  const signedIn = authConfig().mode === "launch" ? await getOptionalUser() : null

  return (
    <header className="in-header">
      <Link href={isAdmin ? "/admin" : "/dashboard"} className="in-brand" aria-label="Inara course editor home">
        <Image src="/images/logo.png" alt="Inara" width={69} height={28} priority />
        <span className="in-brand-label">{isAdmin ? "Admin" : "Course editor"}</span>
      </Link>

      {!isAdmin && ctx.workspaces.length > 0 && (
        <details className="in-ws-switcher">
          <summary>
            <span className="in-ws-label">Workspace</span>
            {active?.name ?? "Choose a workspace"}
          </summary>
          <ul>
            {ctx.workspaces.map((w) => (
              <li key={w.tenantId}>
                <Link href={`/w/${w.tenantId}`} aria-current={w.tenantId === workspace ? "page" : undefined}>
                  <span>{w.name}</span>
                  <span className="in-ws-role">{w.kind === "personal" ? "Personal" : ROLE_LABELS[w.role]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <nav className="in-header-nav" aria-label="Main">
        {isAdmin ? (
          <Link href="/admin" aria-current="page">
            Course reviews
          </Link>
        ) : (
          <Link href="/dashboard" aria-current={current === "dashboard" ? "page" : undefined}>
            My courses
          </Link>
        )}
        {!isAdmin && ctx.grants.some((g) => !ctx.tenantIds.includes(g.tenantId)) && (
          <Link href="/shared" aria-current={current === "shared" ? "page" : undefined}>
            Shared with me
          </Link>
        )}
        {reviewer && (isAdmin ? <Link href="/dashboard">My courses</Link> : <Link href="/admin">Course reviews</Link>)}
      </nav>
      {signedIn && (
        <form action="/sign-out" method="post" className="flex items-center gap-3 text-sm">
          <span className="text-gray-600" title={signedIn.email ?? undefined}>
            {signedIn.name ?? signedIn.email ?? "Signed in"}
            {ctx.staff ? " · InaraX admin" : ""}
          </span>
          <button type="submit" className="in-btn in-btn-secondary in-btn-sm">
            Sign out
          </button>
        </form>
      )}
    </header>
  )
}
