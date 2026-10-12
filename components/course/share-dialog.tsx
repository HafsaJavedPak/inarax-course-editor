"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import type { CollaboratorsView, InvitationView } from "@/lib/authz/grants"
import { atLeast, GRANT_ROLES, ROLE_LABELS, type GrantRole } from "@/lib/authz/sharing"

import "@/components/course/share-dialog.scss"

type Person = { id: string; name: string | null; email: string | null }
const label = (p: Person) => p.name ?? p.email ?? p.id

const ROLE_HINTS: Record<GrantRole, string> = {
  co_owner: "Everything the owner can do, except deleting the course",
  editor: "Edits the outline and lessons; can't submit or share",
  commenter: "Reads and sees the history",
  viewer: "Reads only",
}

const idempotent = () => ({ "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() })

type Loaded = { view: CollaboratorsView; invitations: InvitationView[] } | { error: string }

/** Who has access, and (for those who may share) the open invitations. */
async function fetchSharing(api: string): Promise<Loaded> {
  const res = await fetch(`${api}/grants`, { cache: "no-store" })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { error: data.error ?? "Couldn't load who has access" }
  const view = data as CollaboratorsView
  if (!view.maxRole) return { view, invitations: [] }
  const inv = await fetch(`${api}/invitations`, { cache: "no-store" })
  return { view, invitations: inv.ok ? (await inv.json()).invitations : [] }
}

/** Who has access to a course, and (for owners, co-owners and org admins) sharing it. */
export function ShareDialog({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const router = useRouter()
  const [view, setView] = useState<CollaboratorsView | null>(null)
  const [invitations, setInvitations] = useState<InvitationView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [memberId, setMemberId] = useState("")
  const [memberRole, setMemberRole] = useState<GrantRole>("editor")
  const [email, setEmail] = useState("")
  const [emailRole, setEmailRole] = useState<GrantRole>("editor")
  const [link, setLink] = useState<{ email: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const api = `/api/courses/${courseId}`
  const apply = useCallback((loaded: Loaded) => {
    if ("error" in loaded) return setError(loaded.error)
    setView(loaded.view)
    setInvitations(loaded.invitations)
  }, [])
  const load = useCallback(async () => apply(await fetchSharing(api)), [api, apply])

  useEffect(() => {
    let cancelled = false
    void fetchSharing(api).then((loaded) => !cancelled && apply(loaded))
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => {
      cancelled = true
      window.removeEventListener("keydown", onKey)
    }
  }, [api, apply, onClose])

  const run = async (request: () => Promise<Response>, after?: (data: Record<string, unknown>) => void) => {
    setBusy(true)
    setError(null)
    try {
      const res = await request()
      const data = res.status === 204 ? {} : await res.json().catch(() => ({}))
      if (!res.ok) return setError((data as { error?: string }).error ?? `Something went wrong (${res.status})`)
      after?.(data)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const maxRole = view?.maxRole ?? null
  const roles = maxRole ? GRANT_ROLES.filter((r) => atLeast(maxRole, r)) : []
  const canManage = (role: GrantRole) => !!maxRole && atLeast(maxRole, role)

  const showLink = (data: Record<string, unknown>, to: string) => {
    const delivered = data.delivered as { channel: string; link?: string } | undefined
    if (delivered?.link) {
      setLink({ email: to, url: delivered.link })
      setCopied(false)
    }
  }

  return (
    <div className="sh-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sh-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <header className="sh-head">
          <h2 id="share-title">{maxRole ? "Share this course" : "People with access"}</h2>
          <button type="button" className="in-btn in-btn-secondary in-btn-sm" onClick={onClose}>
            Close
          </button>
        </header>

        {error && (
          <p className="sp-error" role="alert">
            {error}
          </p>
        )}
        {!view ? (
          <p className="le-muted">Loading…</p>
        ) : (
          <>
            <ul className="sh-people">
              <li>
                <span className="sh-person">
                  <strong>{label(view.owner)}</strong>
                  {view.owner.email && view.owner.name && <span className="le-muted"> {view.owner.email}</span>}
                </span>
                <span className="sh-role">Owner</span>
              </li>
              {view.collaborators.map((c) => (
                <li key={c.id}>
                  <span className="sh-person">
                    <strong>{label(c)}</strong>
                    {c.email && c.name && <span className="le-muted"> {c.email}</span>}
                    {c.kind === "guest" && <span className="sh-tag">Guest</span>}
                    {!c.active && (
                      <span className="sh-tag" data-tone="off" title="Kept, and active again if they rejoin the workspace or guests are allowed again">
                        Inactive
                      </span>
                    )}
                    {c.active && c.effectiveRole !== c.role && c.effectiveRole && (
                      <span className="sh-tag" data-tone="off">
                        Counts as {ROLE_LABELS[c.effectiveRole].toLowerCase()} (guest limit)
                      </span>
                    )}
                  </span>
                  {canManage(c.role) ? (
                    <>
                      <select
                        aria-label={`Role of ${label(c)}`}
                        value={c.role}
                        disabled={busy}
                        onChange={(e) =>
                          void run(() =>
                            fetch(`${api}/grants/${encodeURIComponent(c.id)}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ role: e.target.value }),
                            }),
                          )
                        }
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="in-btn in-btn-secondary in-btn-sm"
                        disabled={busy}
                        onClick={() =>
                          window.confirm(`Remove ${label(c)}'s access to this course?`) &&
                          void run(() => fetch(`${api}/grants/${encodeURIComponent(c.id)}`, { method: "DELETE" }))
                        }
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="sh-role">{ROLE_LABELS[c.role]}</span>
                  )}
                </li>
              ))}
            </ul>

            {maxRole && view.candidates.length > 0 && (
              <form
                className="sh-add"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!memberId) return
                  void run(
                    () => fetch(`${api}/grants`, { method: "POST", headers: idempotent(), body: JSON.stringify({ user_id: memberId, role: memberRole }) }),
                    () => setMemberId(""),
                  )
                }}
              >
                <h3>Add someone from this workspace</h3>
                <div className="sh-row">
                  <select aria-label="Person" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                    <option value="">Choose a person…</option>
                    {view.candidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {label(p)}
                        {p.email && p.name ? ` (${p.email})` : ""}
                      </option>
                    ))}
                  </select>
                  <RoleSelect value={memberRole} roles={roles} onChange={setMemberRole} />
                  <button type="submit" className="in-btn in-btn-primary in-btn-sm" disabled={busy || !memberId}>
                    Add
                  </button>
                </div>
                <p className="le-muted sh-hint">{ROLE_HINTS[memberRole]}</p>
              </form>
            )}

            {maxRole && (
              <form
                className="sh-add"
                onSubmit={(e) => {
                  e.preventDefault()
                  const to = email.trim()
                  if (!to) return
                  void run(
                    () => fetch(`${api}/invitations`, { method: "POST", headers: idempotent(), body: JSON.stringify({ email: to, role: emailRole }) }),
                    (data) => {
                      showLink(data, to)
                      setEmail("")
                    },
                  )
                }}
              >
                <h3>Invite by link</h3>
                <div className="sh-row">
                  <input
                    type="email"
                    className="sh-input"
                    aria-label="Email address"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <RoleSelect value={emailRole} roles={roles} onChange={setEmailRole} />
                  <button type="submit" className="in-btn in-btn-primary in-btn-sm" disabled={busy || !email.trim()}>
                    Create link
                  </button>
                </div>
                <p className="le-muted sh-hint">
                  They open the link signed in to the editor with that email address. People need to be able to open the course editor
                  from InaraX.
                  {!view.sharing.allow_guests && " This organization only allows its own members."}
                  {view.sharing.allow_guests && ` People from outside this workspace can be at most ${ROLE_LABELS[view.sharing.guest_max_role].toLowerCase()}s.`}
                </p>
              </form>
            )}

            {link && (
              <div className="sh-link" role="status">
                <p>
                  Link for <strong>{link.email}</strong>. Copy it now: it won&apos;t be shown again (you can make a new one).
                </p>
                <div className="sh-row">
                  <input className="sh-input" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
                  <button
                    type="button"
                    className="in-btn in-btn-secondary in-btn-sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(link.url)
                      setCopied(true)
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            {maxRole && invitations.length > 0 && (
              <section className="sh-add">
                <h3>Open invitations</h3>
                <ul className="sh-people">
                  {invitations.map((inv) => (
                    <li key={inv.id}>
                      <span className="sh-person">
                        <strong>{inv.email}</strong> <span className="le-muted">{ROLE_LABELS[inv.role]}</span>
                        {inv.expired && (
                          <span className="sh-tag" data-tone="off">
                            Expired
                          </span>
                        )}
                      </span>
                      {canManage(inv.role) && (
                        <>
                          <button
                            type="button"
                            className="in-btn in-btn-secondary in-btn-sm"
                            disabled={busy}
                            onClick={() => void run(() => fetch(`${api}/invitations/${inv.id}/link`, { method: "POST" }), (data) => showLink(data, inv.email))}
                          >
                            New link
                          </button>
                          <button
                            type="button"
                            className="in-btn in-btn-secondary in-btn-sm"
                            disabled={busy}
                            onClick={() => void run(() => fetch(`${api}/invitations/${inv.id}`, { method: "DELETE" }))}
                          >
                            Withdraw
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {view.collaborators.some((c) => c.id === view.me) && (
              <LeaveButton
                onLeave={() =>
                  void run(
                    () => fetch(`${api}/grants/${encodeURIComponent(view.me)}`, { method: "DELETE" }),
                    () => router.push("/dashboard"),
                  )
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function RoleSelect({ value, roles, onChange }: { value: GrantRole; roles: GrantRole[]; onChange: (role: GrantRole) => void }) {
  return (
    <select aria-label="Role" value={roles.includes(value) ? value : roles[0]} onChange={(e) => onChange(e.target.value as GrantRole)}>
      {roles.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  )
}

function LeaveButton({ onLeave }: { onLeave: () => void }) {
  return (
    <div className="sh-leave">
      <button
        type="button"
        className="in-btn in-btn-secondary in-btn-sm"
        onClick={() => window.confirm("Leave this course? You'll lose access until someone shares it with you again.") && onLeave()}
      >
        Leave this course
      </button>
    </div>
  )
}
