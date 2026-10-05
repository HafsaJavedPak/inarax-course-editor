import { requireAdminArea } from "@/lib/auth"

/** Everything under /admin is for admins (proxy.ts checks first; this is the second check). */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdminArea()
  return children
}
