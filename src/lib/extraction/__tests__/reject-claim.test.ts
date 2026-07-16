import { describe, it, expect, afterAll } from "vitest"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { cards, sourceDocuments } from "@/db/schema/catalog"
import { sourceClaims } from "@/db/schema/extraction"
import { rejectClaim } from "@/lib/extraction/reject-claim"

// P18 Stage 1A · spec §9 test #5 (round-trip) — reject_claim stores a reason
// + reviewer email and PRESERVES the claim as rejected provenance.

const MARK = "test__reject_claim_p18"

afterAll(async () => {
  await db.delete(sourceClaims).where(eq(sourceClaims.extractedTextSnippet, MARK))
})

describe("§9.5 — reject_claim", () => {
  it("rejects a claim: status=rejected, reason + email stored, row preserved", async () => {
    const card = (
      await db.select().from(cards).where(eq(cards.slug, "citi-cash-back"))
    )[0]!
    const src = (
      await db
        .select()
        .from(sourceDocuments)
        .where(eq(sourceDocuments.cardId, card.id))
    )[0]!

    const [claim] = await db
      .insert(sourceClaims)
      .values({
        sourceId: src.id,
        cardId: card.id,
        claimType: "earn_rate",
        structuredPayload: { rate: 0.012, categorySlug: "insurance" },
        extractedTextSnippet: MARK,
        extractedBy: "manual",
        status: "pending_review",
      })
      .returning()

    const res = await rejectClaim({
      claimId: claim!.id,
      reason: "insurance is base-covered, not a category rate",
      reviewerEmail: "pm@askmike.hk",
    })
    expect(res.ok).toBe(true)

    const after = (
      await db.select().from(sourceClaims).where(eq(sourceClaims.id, claim!.id))
    )[0]!
    expect(after.status).toBe("rejected")
    expect(after.reviewerNote).toContain("base-covered")
    expect(after.reviewerEmail).toBe("pm@askmike.hk")
    // Row preserved (rejected provenance, not deleted).
    expect(after.id).toBe(claim!.id)
  })

  it("rejects invalid input (missing reason or email)", async () => {
    expect((await rejectClaim({ claimId: "x", reason: "", reviewerEmail: "a@b.c" })).ok).toBe(false)
    expect((await rejectClaim({ claimId: "x", reason: "y", reviewerEmail: "" })).ok).toBe(false)
  })

  it("returns not found for an unknown claim id", async () => {
    const res = await rejectClaim({
      claimId: "00000000-0000-0000-0000-000000000000",
      reason: "x",
      reviewerEmail: "a@b.c",
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain("not found")
  })
})
