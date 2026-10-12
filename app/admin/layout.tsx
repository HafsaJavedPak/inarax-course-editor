import { requireReviewArea } from "@/lib/authz/context"

/** Everything under /admin is for reviewers (staff or org admins); each course page checks its own course too. */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireReviewArea()
  return children
}
