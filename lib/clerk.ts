/**
 * Clerk sign-in is optional. With the same Clerk keys as inara-next, people
 * sign in with their inara-next account and publishing forwards that login to
 * inara-next (INARA_AUTH=clerk). Without keys the editor works as before.
 * Server-only: the secret key isn't available in the browser.
 */
const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ""
const secretKey = process.env.CLERK_SECRET_KEY ?? ""

// A key that isn't a Clerk key (e.g. a placeholder left in .env.local) would
// make every page fail with "Publishable key not valid"; run without sign-in
// and say why instead.
const looksValid = /^pk_(test|live)_[A-Za-z0-9+/=_-]+$/.test(publishableKey) && /^sk_(test|live)_\S+$/.test(secretKey)

if ((publishableKey || secretKey) && !looksValid) {
  console.warn(
    "[clerk] NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY are set but don't look like Clerk keys " +
      "(pk_test_… / sk_test_…), so sign-in is off. Copy both from inara-next's .env.",
  )
}

export const clerkEnabled = looksValid

/** Where to sign in, coming back to `returnTo` afterwards. */
export const signInPath = (returnTo?: string) =>
  returnTo ? `/sign-in?redirect_url=${encodeURIComponent(returnTo)}` : "/sign-in"
