import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// edit-gate.ts imports `cookies` from next/headers at module load; stub it so the
// pure helpers are importable in a plain node test. None of the tested functions
// call cookies().
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}))

import {
  signEditToken,
  verifyEditToken,
  editCookieSecret,
} from "@/lib/auth/edit-gate"

const SECRET = "test-secret-abc"
const NOW = 1_800_000_000 // fixed epoch seconds

describe("signEditToken / verifyEditToken — server-enforced signed expiry", () => {
  it("round-trips a token that has not yet expired", () => {
    const token = signEditToken(SECRET, NOW + 100)
    expect(verifyEditToken(SECRET, token, NOW)).toBe(true)
  })

  it("rejects an expired token (server enforces expiry, not just cookie maxAge)", () => {
    const token = signEditToken(SECRET, NOW - 1)
    expect(verifyEditToken(SECRET, token, NOW)).toBe(false)
  })

  it("rejects a token signed with a different secret", () => {
    const token = signEditToken("other-secret", NOW + 100)
    expect(verifyEditToken(SECRET, token, NOW)).toBe(false)
  })

  it("rejects a tampered signature", () => {
    const token = signEditToken(SECRET, NOW + 100)
    const forged = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a")
    expect(verifyEditToken(SECRET, forged, NOW)).toBe(false)
  })

  it("rejects a tampered payload (extending exp invalidates the HMAC)", () => {
    const token = signEditToken(SECRET, NOW + 100)
    const sig = token.slice(token.lastIndexOf(".") + 1)
    const forged = `v2.${NOW + 999999}.${sig}` // attacker tries to extend life
    expect(verifyEditToken(SECRET, forged, NOW)).toBe(false)
  })

  it("rejects malformed / wrong-version values", () => {
    expect(verifyEditToken(SECRET, "", NOW)).toBe(false)
    expect(verifyEditToken(SECRET, "garbage", NOW)).toBe(false)
    expect(verifyEditToken(SECRET, `v1.${NOW + 100}.deadbeef`, NOW)).toBe(false)
  })
})

describe("editCookieSecret — fail closed in production", () => {
  beforeEach(() => {
    // Start each case with neither secret present; cases opt in via stubEnv.
    delete process.env.EDIT_COOKIE_SECRET
    delete process.env.ADMIN_EDIT_PASSWORD
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses the dedicated secret when set", () => {
    vi.stubEnv("EDIT_COOKIE_SECRET", "dedicated")
    expect(editCookieSecret()).toBe("dedicated")
  })

  it("falls back to the password when the dedicated secret is unset", () => {
    vi.stubEnv("ADMIN_EDIT_PASSWORD", "pw")
    expect(editCookieSecret()).toBe("pw")
  })

  it("THROWS in production when neither is set (no public-constant fallback)", () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(() => editCookieSecret()).toThrow()
  })

  it("uses a dev fallback only outside production", () => {
    vi.stubEnv("NODE_ENV", "development")
    expect(editCookieSecret()).toBe("dev-insecure-edit-secret")
  })
})
