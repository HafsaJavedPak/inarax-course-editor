import Image from "next/image"
import Link from "next/link"

import { getOptionalUser } from "@/lib/auth"
import { authConfig } from "@/lib/auth-gate"

/** Top bar for the course pages, modelled on inara-next's admin brand block. */
export async function AppHeader({ current }: { current?: "dashboard" | "admin" }) {
  const isAdmin = current === "admin"
  // Signed in through the platform: show who, the other area for admins, and sign out.
  const signedIn = authConfig().mode === "launch" ? await getOptionalUser() : null

  return (
    <header className="in-header">
      <Link href={isAdmin ? "/admin" : "/dashboard"} className="in-brand" aria-label="Inara course editor home">
        <Image src="/images/logo.png" alt="Inara" width={69} height={28} priority />
        <span className="in-brand-label">{isAdmin ? "Admin" : "Course editor"}</span>
      </Link>
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
        {signedIn?.role === "admin" &&
          (isAdmin ? <Link href="/dashboard">My courses</Link> : <Link href="/admin">Course reviews</Link>)}
      </nav>
      {signedIn && (
        <form action="/sign-out" method="post" className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-gray-600" title={signedIn.email ?? undefined}>
            {signedIn.name ?? signedIn.email ?? "Signed in"}
            {signedIn.role === "admin" ? " · Admin" : ""}
          </span>
          <button type="submit" className="in-btn in-btn-secondary in-btn-sm">
            Sign out
          </button>
        </form>
      )}
    </header>
  )
}
