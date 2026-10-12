import "server-only"

// How an invitation reaches the person invited. Today the only way is a link
// the inviter copies and sends themselves; email can be added later as another
// InviteDelivery, chosen with INVITE_DELIVERY, without changing the routes,
// the tables, the acceptance page or the tests (the same pattern as
// PlatformPort in lib/platform). Every attempt is recorded in
// course_invitation_deliveries, so "resend" and "delivery failed" already have
// somewhere to live.

export type InvitationToDeliver = {
  id: string
  email: string
  role: string
  courseTitle: string
  inviterName: string | null
}

export type Delivered =
  /** The link goes back to the inviter to copy (shown once: only its hash is stored). */
  | { channel: "link"; status: "sent"; link: string }
  | { channel: "email"; status: "sent" }
  | { channel: "email"; status: "failed"; error: string }

export interface InviteDelivery {
  readonly channel: Delivered["channel"]
  deliver(invitation: InvitationToDeliver, link: string): Promise<Delivered>
}

export const linkDelivery: InviteDelivery = {
  channel: "link",
  async deliver(_invitation, link) {
    return { channel: "link", status: "sent", link }
  },
}

/** The configured delivery. INVITE_DELIVERY=link (default); "email" arrives with an email provider. */
export function getInviteDelivery(env: NodeJS.ProcessEnv = process.env): InviteDelivery {
  const configured = env.INVITE_DELIVERY?.trim() || "link"
  if (configured === "link") return linkDelivery
  throw new Error(`INVITE_DELIVERY=${configured} isn't available yet; use "link".`)
}
