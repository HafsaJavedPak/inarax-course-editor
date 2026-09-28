import Image from "next/image"
import Link from "next/link"

/** Top bar for the course pages, modelled on inara-next's admin brand block. */
export function AppHeader({ current }: { current?: "dashboard" | "admin" }) {
  const isAdmin = current === "admin"

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
      </nav>
    </header>
  )
}
