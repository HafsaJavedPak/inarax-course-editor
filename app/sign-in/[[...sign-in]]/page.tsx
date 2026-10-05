import { SignIn } from "@clerk/nextjs"
import { notFound } from "next/navigation"

import { AppHeader } from "@/components/course/app-header"
import { clerkEnabled } from "@/lib/clerk"

/** Sign in with an inara-next account (same Clerk app), needed to publish. */
export default function Page() {
  if (!clerkEnabled) notFound()
  return (
    <div className="in-page">
      <AppHeader />
      <main className="in-container sign-in-page">
        <p>Sign in with your inara-next account to publish courses to the platform.</p>
        <SignIn />
      </main>
    </div>
  )
}
