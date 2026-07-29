// Edit-mode gate (deploy hardening — view is open, editing needs a password).
//
// The real defense is server-side: every mutating server action calls
// assertEditUnlocked() and refuses without a valid edit cookie, so editing is
// impossible even by hitting the action directly. The cookie value is an HMAC
// (keyed by EDIT_COOKIE_SECRET) so it can't be forged client-side.
//
// This module is server-only (it reads cookies via next/headers).

import { cookies } from "next/headers"
import { createHmac, timingSafeEqual } from "node:crypto"

export const EDIT_COOKIE_NAME = "am_edit"
export const EDIT_LOCKED_ERROR =
  "Edit is locked. Enter the edit password (top-right) to make changes."

function cookieSecret(): string {
  // Prefer a dedicated secret; fall back to the password so a single env var
  // works for a quick deploy. Dev fallback keeps local `pnpm dev` working.
  return (
    process.env.EDIT_COOKIE_SECRET ??
    process.env.ADMIN_EDIT_PASSWORD ??
    "dev-insecure-edit-secret"
  )
}

// The opaque cookie value proving edit is unlocked.
export function editToken(): string {
  return createHmac("sha256", cookieSecret())
    .update("am-edit-unlocked-v1")
    .digest("hex")
}

export async function isEditUnlocked(): Promise<boolean> {
  const value = (await cookies()).get(EDIT_COOKIE_NAME)?.value
  if (!value) return false
  const expected = editToken()
  if (value.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  } catch {
    return false
  }
}

// Throwing guard for mutating server actions that don't have a natural
// error-result shape. Actions with a result object should prefer an early
// `if (!(await isEditUnlocked())) return { ok:false, error: EDIT_LOCKED_ERROR }`.
export async function assertEditUnlocked(): Promise<void> {
  if (!(await isEditUnlocked())) throw new Error(EDIT_LOCKED_ERROR)
}
