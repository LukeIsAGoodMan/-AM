// Edit-mode gate (deploy hardening — view is open, editing needs a password).
//
// The real defense is server-side: every mutating server action calls
// isEditUnlocked()/assertEditUnlocked() and refuses without a valid edit cookie,
// so editing is impossible even by hitting the action directly. The cookie value
// is an HMAC (keyed by EDIT_COOKIE_SECRET) over an EXPIRY, so it can't be forged
// AND the server — not just the cookie's maxAge — enforces the 12h lifetime.
//
// Threat model note: the browser only ever receives the opaque `payload.sig`
// token. The signing secret, the password, and the DB credentials never leave
// the server. Data access is Drizzle-over-a-server-only-DATABASE_URL; the browser
// never talks to the database, so this cookie is the whole client-facing surface.
//
// This module mixes pure helpers (signEditToken / verifyEditToken / editCookieSecret,
// unit-tested) with cookie I/O (isEditUnlocked, reads next/headers → server-only).

import { cookies } from "next/headers"
import { createHmac, timingSafeEqual } from "node:crypto"

export const EDIT_COOKIE_NAME = "am_edit"
export const EDIT_SESSION_TTL_SECONDS = 60 * 60 * 12 // 12h
export const EDIT_LOCKED_ERROR =
  "Edit is locked. Enter the edit password (top-right) to make changes."

// Signed-token version tag — bump to invalidate every outstanding cookie at once
// (e.g. after a secret rotation or a format change).
const TOKEN_VERSION = "v2"

// The HMAC key. FAIL CLOSED in production: if neither the dedicated secret nor
// the password is configured, we do NOT silently fall back to a public constant
// (which would let anyone forge the cookie) — we throw, and callers treat a throw
// as "locked". Only local dev gets a fixed fallback so `pnpm dev` keeps working.
export function editCookieSecret(): string {
  const secret = process.env.EDIT_COOKIE_SECRET ?? process.env.ADMIN_EDIT_PASSWORD
  if (secret && secret.length > 0) return secret
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "EDIT_COOKIE_SECRET (or ADMIN_EDIT_PASSWORD) must be set in production — refusing an insecure fallback.",
    )
  }
  return "dev-insecure-edit-secret"
}

// Pure: build the opaque cookie value `v2.<expEpochSec>.<hex-hmac>`.
export function signEditToken(secret: string, expEpochSec: number): string {
  const payload = `${TOKEN_VERSION}.${expEpochSec}`
  const sig = createHmac("sha256", secret).update(payload).digest("hex")
  return `${payload}.${sig}`
}

// Pure: constant-time verify of value's signature AND that it has not expired.
// Returns false for any malformed / tampered / expired / wrong-secret input.
export function verifyEditToken(
  secret: string,
  value: string,
  nowEpochSec: number,
): boolean {
  const lastDot = value.lastIndexOf(".")
  if (lastDot <= 0) return false
  const payload = value.slice(0, lastDot)
  const sig = value.slice(lastDot + 1)
  if (!payload.startsWith(`${TOKEN_VERSION}.`)) return false

  const expected = createHmac("sha256", secret).update(payload).digest("hex")
  if (sig.length !== expected.length) return false
  let sigOk = false
  try {
    sigOk = timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
  if (!sigOk) return false

  const exp = Number(payload.slice(TOKEN_VERSION.length + 1))
  if (!Number.isFinite(exp)) return false
  return nowEpochSec < exp
}

// A fresh token valid for EDIT_SESSION_TTL_SECONDS. Throws if no secret in prod.
export function newEditToken(): string {
  const exp = Math.floor(Date.now() / 1000) + EDIT_SESSION_TTL_SECONDS
  return signEditToken(editCookieSecret(), exp)
}

export async function isEditUnlocked(): Promise<boolean> {
  const value = (await cookies()).get(EDIT_COOKIE_NAME)?.value
  if (!value) return false
  let secret: string
  try {
    secret = editCookieSecret()
  } catch {
    // Misconfigured server (no secret in prod) → fail CLOSED, never open.
    return false
  }
  return verifyEditToken(secret, value, Math.floor(Date.now() / 1000))
}

// Throwing guard for mutating server actions that don't have a natural
// error-result shape. Actions with a result object should prefer an early
// `if (!(await isEditUnlocked())) return { ok:false, error: EDIT_LOCKED_ERROR }`.
export async function assertEditUnlocked(): Promise<void> {
  if (!(await isEditUnlocked())) throw new Error(EDIT_LOCKED_ERROR)
}
