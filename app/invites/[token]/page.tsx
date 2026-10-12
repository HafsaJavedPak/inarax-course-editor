import { AppHeader } from "@/components/course/app-header"
import { AcceptInvitation } from "@/components/course/accept-invitation"
import { getRequestContext } from "@/lib/authz/context"
import { describeInvitation } from "@/lib/authz/grants"
import { ROLE_LABELS } from "@/lib/authz/sharing"

/**
 * Opening an invitation link. Shows who invited you and as what, never the
 * course itself, until you accept with the invited account.
 */
export default async function Page({ params }: PageProps<"/invites/[token]">) {
  const { token } = await params
  const ctx = await getRequestContext()
  const invitation = await describeInvitation(token, ctx.userId)

  return (
    <div className="in-page">
      <AppHeader />
      <main className="in-container">
        <div className="in-page-title">
          <h1>Invitation to a course</h1>
        </div>
        {invitation.state === "invalid" ? (
          <p className="in-empty">This invitation link isn&apos;t valid any more: it was used, withdrawn, replaced by a newer link, or it expired. Ask for a new one.</p>
        ) : !invitation.forThisAccount ? (
          <p className="in-empty">
            This invitation was sent to a different email address than the one you&apos;re signed in with ({ctx.user.email ?? "no email"}). Sign in with
            the invited account, then open the link again.
          </p>
        ) : (
          <AcceptInvitation
            token={token}
            inviter={invitation.inviter.name ?? invitation.inviter.email ?? "Someone"}
            role={ROLE_LABELS[invitation.role]}
          />
        )}
      </main>
    </div>
  )
}
