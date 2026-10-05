import { getOptionalUser } from "@/lib/auth"
import { getPlatform } from "@/lib/platform"
import { redirect } from "next/navigation"

const REASONS: Record<string, string> = {
  expired: "That sign-in link had expired. Open the course editor from the platform again.",
  used: "That sign-in link was already used. Open the course editor from the platform again.",
  invalid: "That sign-in link wasn't valid. Open the course editor from the platform again.",
  not_configured: "Sign-in isn't set up for this editor yet (PLATFORM_KEY_ID / PLATFORM_KEY_SECRET).",
  signed_out: "You've signed out of the course editor.",
}

/**
 * Where people without an editor session land. The editor has no login of its
 * own: you sign in on the platform and open the editor from there (it sends a
 * one-time launch token to /launch).
 */
export default async function SignedOutPage({ searchParams }: PageProps<"/signed-out">) {
  const user = await getOptionalUser()
  const { reason } = await searchParams
  if (user && !reason) redirect(user.role === "admin" ? "/admin" : "/dashboard")

  let launchUrl: string | null = null
  try {
    launchUrl = (await getPlatform()?.launchUrl()) ?? null
  } catch {
    // Not configured: no link, the message still explains.
  }
  const message = (typeof reason === "string" && REASONS[reason]) || "Open the course editor from the platform to sign in."

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Course editor</h1>
      <p className="text-sm text-gray-600">{message}</p>
      <p className="text-sm text-gray-600">Creators and admins find it in the platform&apos;s sidebar, under Course editor.</p>
      {launchUrl && (
        <a className="in-btn in-btn-primary" href={launchUrl}>
          Open from the platform
        </a>
      )}
    </main>
  )
}
