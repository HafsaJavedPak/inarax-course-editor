import type { Person } from "@/lib/authz/identity"

/**
 * Who someone is, for admins: their name and email, falling back to the user
 * id for people the editor has never seen sign in.
 */
export function PersonLabel({ id, person }: { id: string; person?: Person }) {
  if (!person?.name && !person?.email) return <code title="User id">{id}</code>
  return (
    <span className="person" title={`User id: ${id}`}>
      {person.name && <strong>{person.name}</strong>}
      {person.name && person.email && " · "}
      {person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}
    </span>
  )
}
