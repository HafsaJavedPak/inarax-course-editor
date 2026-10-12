"use client"

import { useState } from "react"

import { ROLE_LABELS, type GrantRole, type SharingSettings } from "@/lib/authz/sharing"
import { GRANT_ROLES } from "@/lib/authz/roles"

/** An organization admin's switch: may courses here be shared with people outside the organization, and up to which role? */
export function WorkspaceSharing({ tenantId, initial }: { tenantId: string; initial: SharingSettings }) {
  const [settings, setSettings] = useState(initial)
  const [state, setState] = useState<"idle" | "saving" | "saved" | { error: string }>("idle")

  const save = async (next: SharingSettings) => {
    setSettings(next)
    setState("saving")
    const res = await fetch(`/api/workspaces/${tenantId}/sharing`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    })
    const data = await res.json().catch(() => ({}))
    setState(res.ok ? "saved" : { error: data.error ?? "Couldn't save" })
  }

  return (
    <section className="ws-sharing" aria-label="Sharing with people outside the organization">
      <label>
        <input
          type="checkbox"
          checked={settings.allow_guests}
          disabled={state === "saving"}
          onChange={(e) => void save({ ...settings, allow_guests: e.target.checked })}
        />{" "}
        Courses here can be shared with people outside this organization
      </label>
      {settings.allow_guests && (
        <label>
          as at most{" "}
          <select
            value={settings.guest_max_role}
            disabled={state === "saving"}
            onChange={(e) => void save({ ...settings, guest_max_role: e.target.value as GrantRole })}
          >
            {GRANT_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r].toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="ws-sharing-state" role="status">
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : typeof state === "object" ? state.error : ""}
      </span>
    </section>
  )
}
