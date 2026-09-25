import Image from "next/image"
import Link from "next/link"

/** Top bar for the course pages, modelled on inara-next's admin brand block. */
export function AppHeader({ current }: { current?: "courses" }) {
  return (
    <header className="in-header">
      <Link href="/courses" className="in-brand" aria-label="Inara course editor home">
        <Image src="/images/logo.png" alt="Inara" width={69} height={28} priority />
        <span className="in-brand-label">Course editor</span>
      </Link>
      <nav className="in-header-nav" aria-label="Main">
        <Link href="/courses" aria-current={current === "courses" ? "page" : undefined}>
          Courses
        </Link>
      </nav>
    </header>
  )
}
