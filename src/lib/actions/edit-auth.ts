"use server"

import { cookies, headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { timingSafeEqual } from "node:crypto"
import {
  EDIT_COOKIE_NAME,
  EDIT_SESSION_TTL_SECONDS,
  newEditToken,
} from "@/lib/auth/edit-gate"

// Best-effort brute-force throttle. NOTE: this Map is per warm serverless
// instance — it is NOT a hard, cross-instance guarantee on Vercel. Robust
// rate-limiting would need a shared store (e.g. Upstash/Vercel KV); that's a
// deliberate follow-up (needs a new dependency + owner sign-off). This still
// meaningfully slows an online guessing attack against a single instance.
const MAX_FAILURES = 10
const WINDOW_MS = 10 * 60 * 1000
const failuresByIp = new Map<string, number[]>()

function recentFailures(ip: string, now: number): number[] {
  const arr = (failuresByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  failuresByIp.set(ip, arr)
  return arr
}

async function clientIp(): Promise<string> {
  const h = await headers()
  return (h.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim() || "unknown"
}

// Unlock edit mode by entering the shared password. Verifies server-side, then
// sets a signed HttpOnly cookie carrying a server-enforced 12h expiry; every
// mutating action then checks it (edit-gate.ts). Errors are intentionally
// generic — they never reveal which server env var is missing or why a token
// was rejected.
export async function unlockEdit(
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const ip = await clientIp()
  const now = Date.now()

  if (recentFailures(ip, now).length >= MAX_FAILURES) {
    return { ok: false, error: "Too many attempts. Try again later." }
  }

  const expected = process.env.ADMIN_EDIT_PASSWORD
  if (!expected) {
    // Do not reveal which variable is unset.
    return { ok: false, error: "Editing is not configured on the server." }
  }

  const a = Buffer.from(password)
  const b = Buffer.from(expected)
  const match = a.length === b.length && timingSafeEqual(a, b)
  if (!match) {
    failuresByIp.set(ip, [...recentFailures(ip, now), now])
    return { ok: false, error: "Incorrect password." }
  }

  let token: string
  try {
    token = newEditToken()
  } catch {
    // Missing signing secret in production → fail closed, generic message.
    return { ok: false, error: "Editing is not configured on the server." }
  }

  failuresByIp.delete(ip)
  ;(await cookies()).set(EDIT_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // strict: the edit cookie is never needed on a cross-site navigation, so
    // strict gives the strongest CSRF posture without breaking any real flow.
    sameSite: "strict",
    path: "/",
    maxAge: EDIT_SESSION_TTL_SECONDS,
  })
  revalidatePath("/", "layout")
  return { ok: true }
}

export async function lockEdit(): Promise<void> {
  ;(await cookies()).delete(EDIT_COOKIE_NAME)
  revalidatePath("/", "layout")
}
