import { redirect } from "next/navigation"

import { getOptionalUser } from "@/lib/auth"
import { platformLinks } from "@/lib/platform"

const REASONS: Record<string, string> = {
  expired: "That sign-in link had expired. Open the course editor from the platform again.",
  used: "That sign-in link was already used. Open the course editor from the platform again.",
  invalid: "That sign-in link wasn't valid. Open the course editor from the platform again.",
  not_configured: "Sign-in isn't set up for this editor yet (PLATFORM_URL / PLATFORM_JWKS_URL).",
  signed_out: "You've signed out of the course editor and the platform.",
  session_expired: "Your session ended after 8 hours. Open the course editor from the platform to sign in again.",
  idle: "You were signed out after 30 minutes without activity. Open the course editor from the platform to sign in again.",
  access_changed: "Your role or organizations changed on the platform, so you need to sign in again. Open the course editor from the platform.",
  renew: "Please sign in again: open the course editor from the platform.",
}

/**
 * Where people without an editor session land. The editor has no login of its
 * own: you sign in on the platform and open the editor from there (it sends a
 * one-time launch token to /launch).
 *
 * After signing out of both, the link goes to the platform's sign-in page;
 * otherwise (session ended, link expired…) to the platform's editor launch,
 * which signs in again straight away if the platform session is still there.
 */
export default async function SignedOutPage({ searchParams }: PageProps<"/signed-out">) {
  const user = await getOptionalUser()
  const { reason } = await searchParams
  if (user && !reason) redirect("/dashboard")

  const links = await platformLinks()
  const signedOutOfBoth = reason === "signed_out"
  const href = signedOutOfBoth ? (links.signInUrl ?? links.launchUrl) : links.launchUrl
  const message = (typeof reason === "string" && REASONS[reason]) || "Open the course editor from the platform to sign in."

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Course editor</h1>
      <p className="text-sm text-gray-600">{message}</p>
      <p className="text-sm text-gray-600">Creators and admins find it in the platform&apos;s sidebar, under Course editor.</p>
      {href && (
        <a className="in-btn in-btn-primary" href={href}>
          {signedOutOfBoth ? "Sign in to the platform" : "Open from the platform"}
        </a>
      )}
    </main>
  )
}
