import { clerkMiddleware } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

import { clerkEnabled } from "@/lib/clerk"

// With Clerk configured, make the signed-in user available to pages and API
// routes (publishing forwards their session to inara-next). Nothing is
// protected here: signing in is only needed to publish. Without Clerk, pass
// every request through.
export default clerkEnabled ? clerkMiddleware() : () => NextResponse.next()

export const config = {
  matcher: [
    // Everything except Next.js internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …and always API routes.
    "/(api|trpc)(.*)",
  ],
}
