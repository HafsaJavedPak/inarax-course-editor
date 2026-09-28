import { redirect } from "next/navigation"

/** The course list moved to the creator dashboard. */
export default function Page() {
  redirect("/dashboard")
}
