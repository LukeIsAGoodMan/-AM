"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { timingSafeEqual } from "node:crypto"
import { EDIT_COOKIE_NAME, editToken } from "@/lib/auth/edit-gate"

// Unlock edit mode by entering the shared password. Sets a signed httpOnly
// cookie; every mutating action then checks it (edit-gate.ts).
export async function unlockEdit(
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const expected = process.env.ADMIN_EDIT_PASSWORD
  if (!expected) {
    return {
      ok: false,
      error: "ADMIN_EDIT_PASSWORD is not configured on the server.",
    }
  }
  const a = Buffer.from(password)
  const b = Buffer.from(expected)
  const match = a.length === b.length && timingSafeEqual(a, b)
  if (!match) return { ok: false, error: "Incorrect password." }

  ;(await cookies()).set(EDIT_COOKIE_NAME, editToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h
  })
  revalidatePath("/", "layout")
  return { ok: true }
}

export async function lockEdit(): Promise<void> {
  ;(await cookies()).delete(EDIT_COOKIE_NAME)
  revalidatePath("/", "layout")
}
