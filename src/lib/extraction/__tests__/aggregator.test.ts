import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db/client"
import { cards, sourceDocuments } from "@/db/schema/catalog"
import {
  crossCheckGroups,
  reviewTasks,
  sourceClaims,
} from "@/db/schema/extraction"
import {
  SOURCE_PRIORITY_WEIGHTS,
  aggregateClaims,
  claimAgreesWith,
  computeKeyDimension,
  decideVerdict,
} from "@/lib/extraction/aggregator"

// P4 tests — split between pure unit tests (no DB) and integration tests
// against the live DB using the HSBC Red multi-source corpus seeded by
// P8-partial. Integration tests run aggregator → assert verdicts → clean
// up cross_check_groups / review_tasks created.

describe("P4 — pure helpers", () => {
  describe("SOURCE_PRIORITY_WEIGHTS", () => {
    it("matches PRD §22.6 weighting table", () => {
      expect(SOURCE_PRIORITY_WEIGHTS[1]).toBe(1.0)
      expect(SOURCE_PRIORITY_WEIGHTS[2]).toBe(0.9)
      expect(SOURCE_PRIORITY_WEIGHTS[4]).toBe(0.95)
      expect(SOURCE_PRIORITY_WEIGHTS[5]).toBe(0.5)
      expect(SOURCE_PRIORITY_WEIGHTS[8]).toBe(0.1)
    })
  })

  describe("computeKeyDimension", () => {
    it("earn_rate with categorySlug → category_slug=X", () => {
      expect(
        computeKeyDimension("earn_rate", { categorySlug: "online_local" }),
      ).toBe("category_slug=online_local")
    })

    it("earn_rate without categorySlug → rule_type=base_earn", () => {
      expect(computeKeyDimension("earn_rate", { rate: 0.004 })).toBe(
        "rule_type=base_earn",
      )
    })

    it("cap with categorySlug → category_slug=X", () => {
      expect(
        computeKeyDimension("cap", {
          categorySlug: "online_local",
          amountHkd: 100000,
        }),
      ).toBe("category_slug=online_local")
    })

    it("cap without categorySlug → period+basis composite", () => {
      expect(
        computeKeyDimension("cap", { amountHkd: 500, period: "month", basis: "reward" }),
      ).toBe("cap_default=month_reward")
    })

    it("exclusion with appliesTo array → sorted join (order-insensitive)", () => {
      const a = computeKeyDimension("exclusion", {
        appliesTo: ["TAX", "ewallet_topup"],
      })
      const b = computeKeyDimension("exclusion", {
        appliesTo: ["ewallet_topup", "TAX"],
      })
      expect(a).toBe(b)
      expect(a).toBe("applies_to=ewallet_topup,tax")
    })

    it("annual_fee → single dimension per card", () => {
      expect(computeKeyDimension("annual_fee", { amountHkd: 0 })).toBe(
        "annual_fee_default",
      )
    })

    it("unknown claim_type → null (skipped)", () => {
      expect(computeKeyDimension("custom_thing", { x: 1 })).toBeNull()
    })
  })

  describe("claimAgreesWith — tolerance + type rules", () => {
    it("identical payloads agree", () => {
      expect(
        claimAgreesWith({ rate: 0.04, isOnline: true }, { rate: 0.04, isOnline: true }),
      ).toBe(true)
    })

    it("numeric values within ±5% agree", () => {
      expect(claimAgreesWith({ rate: 0.040 }, { rate: 0.042 })).toBe(true) // 5% off
      expect(claimAgreesWith({ amountHkd: 100000 }, { amountHkd: 104000 })).toBe(true)
    })

    it("numeric values beyond ±5% conflict", () => {
      expect(claimAgreesWith({ rate: 0.04 }, { rate: 0.06 })).toBe(false)
      // 100k/yr vs 10k/mo expressed as different scalars on the same field:
      expect(claimAgreesWith({ amountHkd: 100000 }, { amountHkd: 10000 })).toBe(false)
    })

    it("near-zero numbers use absolute floor (no false agreement)", () => {
      // 0.0001 vs 0 — relative tolerance would always pass; floor catches it.
      expect(claimAgreesWith({ x: 0 }, { x: 0.5 })).toBe(false)
    })

    it("strings agree case-insensitively, trim-insensitive", () => {
      expect(
        claimAgreesWith(
          { categorySlug: "Online_Local" },
          { categorySlug: "online_local " },
        ),
      ).toBe(true)
    })

    it("missing keys are NOT a conflict (just less info)", () => {
      expect(claimAgreesWith({ rate: 0.04 }, { rate: 0.04, isOnline: true })).toBe(true)
      expect(claimAgreesWith({}, { rate: 0.04 })).toBe(true)
    })

    it("mixed types disagree (no auto-coerce)", () => {
      expect(claimAgreesWith({ x: "1" }, { x: 1 })).toBe(false)
    })

    it("arrays compare order-insensitively", () => {
      expect(
        claimAgreesWith({ appliesTo: ["a", "b"] }, { appliesTo: ["b", "a"] }),
      ).toBe(true)
      expect(
        claimAgreesWith({ appliesTo: ["a", "b"] }, { appliesTo: ["a", "c"] }),
      ).toBe(false)
    })

    it("informational fields (waiverConditions, note, ...) are ignored", () => {
      // Same amountHkd, wildly different waiver text in 3 sources/languages.
      // Real signal: they all say fee=0. Agreement should hold.
      expect(
        claimAgreesWith(
          { amountHkd: 0, waiverConditions: "Perpetual annual fee waiver" },
          { amountHkd: 0, waiverConditions: "永久豁免年費" },
        ),
      ).toBe(true)
      expect(
        claimAgreesWith(
          { amountHkd: 0, note: "applies to all customers" },
          { amountHkd: 0, note: "Some other thing entirely" },
        ),
      ).toBe(true)
      // But a load-bearing field WITHIN the same payload still gates.
      expect(
        claimAgreesWith(
          { amountHkd: 0, waiverConditions: "X" },
          { amountHkd: 500, waiverConditions: "X" },
        ),
      ).toBe(false)
    })
  })

  describe("decideVerdict — anchor + check", () => {
    function mkClaim(
      id: string,
      priority: number,
      confidence: number,
      payload: Record<string, unknown>,
    ) {
      return {
        claimId: id,
        cardId: "card-1",
        cardSlug: "card-1",
        sourceId: `src-${id}`,
        sourcePriority: priority,
        claimType: "earn_rate",
        structuredPayload: payload,
        confidence,
      }
    }

    it("single claim → single_source, confidence = claim's own", () => {
      const v = decideVerdict([mkClaim("a", 2, 0.9, { rate: 0.04 })])
      expect(v.status).toBe("single_source")
      expect(v.supportingClaimIds).toEqual(["a"])
      expect(v.contradictingClaimIds).toEqual([])
      expect(v.aggregateConfidence).toBeCloseTo(0.9, 3)
    })

    it("two agreeing claims → agreed", () => {
      const v = decideVerdict([
        mkClaim("a", 2, 0.9, { rate: 0.04, categorySlug: "online_local" }),
        mkClaim("b", 5, 0.8, { rate: 0.04, categorySlug: "online_local" }),
      ])
      expect(v.status).toBe("agreed")
      expect(v.supportingClaimIds.sort()).toEqual(["a", "b"])
      // weighted: (0.9*0.9 + 0.5*0.8) / (0.9 + 0.5) = (0.81 + 0.40) / 1.4 = 0.864
      expect(v.aggregateConfidence).toBeCloseTo(0.864, 3)
    })

    it("anchor is the highest-weight claim (priority × confidence)", () => {
      // b has higher weight: 0.95 * 0.7 = 0.665 vs a's 0.9 * 0.6 = 0.54
      const v = decideVerdict([
        mkClaim("a", 2, 0.6, { rate: 0.04 }),
        mkClaim("b", 4, 0.7, { rate: 0.05 }),
      ])
      // b is the anchor, so canonical.rate = 0.05; a (0.04) is within ±5%?
      // |0.04-0.05|/0.05 = 0.20 → no, contradicts.
      expect(v.status).toBe("conflict")
      // Anchor still becomes supporting; the loser becomes contradicting.
      expect(v.supportingClaimIds).toEqual(["b"])
      expect(v.contradictingClaimIds).toEqual(["a"])
    })

    it("two claims, one from low priority disagrees → still agreed (low-priority disagreement noted but doesn't demote)", () => {
      // Anchor: priority 2, rate 0.04. Disagreer: priority 6 (forum), rate 0.06.
      const v = decideVerdict([
        mkClaim("a", 2, 0.9, { rate: 0.04 }),
        mkClaim("b", 6, 0.5, { rate: 0.06 }),
      ])
      // contradicting from priority 6 — PRD §22.6 says only priority ≤5
      // contradictions demote. So status is still 'agreed'... but we only
      // have ONE supporting claim (a). With only 1 supporting, it's single_source.
      // Test the actual outcome: contradicting claim present, only 1 supporter.
      expect(v.contradictingClaimIds).toEqual(["b"])
      expect(v.supportingClaimIds).toEqual(["a"])
      // Spec: contradictions from priority >5 don't demote to conflict.
      // With 1 supporting + 1 non-meaningful contradiction → still treated
      // as agreed per the meaningfulContradiction = false branch.
      expect(v.status).toBe("agreed")
    })

    it("three claims, two agree, one disagrees from priority ≤5 → conflict", () => {
      const v = decideVerdict([
        mkClaim("a", 2, 0.9, { rate: 0.04 }),
        mkClaim("b", 5, 0.8, { rate: 0.04 }),
        mkClaim("c", 5, 0.7, { rate: 0.08 }), // competitor disagrees
      ])
      expect(v.status).toBe("conflict")
      expect(v.supportingClaimIds.sort()).toEqual(["a", "b"])
      expect(v.contradictingClaimIds).toEqual(["c"])
    })

    it("canonical payload merges enrichment fields from supporting claims", () => {
      const v = decideVerdict([
        mkClaim("a", 2, 0.9, { rate: 0.04 }),
        mkClaim("b", 5, 0.8, {
          rate: 0.04,
          isOnline: true,
          categorySlug: "online_local",
        }),
      ])
      expect(v.status).toBe("agreed")
      expect(v.canonicalPayload).toMatchObject({
        rate: 0.04,
        isOnline: true,
        categorySlug: "online_local",
      })
    })

    it("deterministic: ties broken by claim id", () => {
      // Same priority × confidence; tiebreak by id (alphabetical).
      const a = mkClaim("a", 2, 0.9, { rate: 0.04 })
      const b = mkClaim("b", 2, 0.9, { rate: 0.04 })
      const v1 = decideVerdict([a, b])
      const v2 = decideVerdict([b, a])
      expect(v1.supportingClaimIds[0]).toBe("a") // anchor
      expect(v2.supportingClaimIds[0]).toBe("a")
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Integration — live DB, HSBC Red multi-source corpus seeded by P8-partial.
// ─────────────────────────────────────────────────────────────────────────────

describe("P4 aggregator — live integration against hsbc-red", () => {
  beforeAll(async () => {
    // Best-effort cleanup of any residue from earlier runs.
    await db
      .delete(reviewTasks)
      .where(eq(reviewTasks.title, "__p4_test_placeholder__"))
  })

  afterAll(async () => {
    // Roll back every group + task we created against hsbc-red, so the
    // /review queue stays clean for the live runner to populate.
    const hsbcRedCard = (
      await db.select({ id: cards.id }).from(cards).where(eq(cards.slug, "hsbc-red"))
    )[0]
    if (!hsbcRedCard) return
    // 1. Detach claims from any groups we created (FK on set null already,
    //    but explicit prevents lingering pointers).
    await db
      .update(sourceClaims)
      .set({ crossCheckGroupId: null })
      .where(eq(sourceClaims.cardId, hsbcRedCard.id))
    // 2. Tasks first (they reference the group).
    await db.delete(reviewTasks).where(eq(reviewTasks.cardId, hsbcRedCard.id))
    // 3. Groups.
    await db
      .delete(crossCheckGroups)
      .where(eq(crossCheckGroups.cardId, hsbcRedCard.id))
  })

  it("produces ≥1 agreed, ≥1 single_source group, plus claim+group counts that match the DB", async () => {
    const events: Array<{
      status: "agreed" | "single_source" | "conflict"
      claimType: string
      keyDimension: string
    }> = []
    const summary = await aggregateClaims({
      scope: { cardSlugs: ["hsbc-red"] },
      onGroupComplete: (e) =>
        events.push({
          status: e.status,
          claimType: e.claimType,
          keyDimension: e.keyDimension,
        }),
    })

    expect(summary.claimsScanned).toBeGreaterThan(0)
    expect(summary.groupsTotal).toBeGreaterThan(0)
    expect(summary.groupsTotal).toBe(events.length)

    // We have 3 sources × multiple claim_types with overlap → at least
    // one agreed (e.g. annual_fee=0 across all 3 sources, or
    // online_local 4% across moneyhero + mrmiles).
    expect(summary.agreed).toBeGreaterThanOrEqual(1)

    // mrmiles has some exclusion / earn_rate dimensions the other 2 don't
    // mention → at least one single_source group.
    expect(summary.singleSource).toBeGreaterThanOrEqual(1)

    // Task creation count should equal groups created (every new group
    // gets exactly one auto-created task on first aggregator run).
    expect(summary.reviewTasksCreated).toBe(summary.groupsTotal)

    // Per-card breakdown lines up.
    const perCard = summary.perCard["hsbc-red"]
    expect(perCard).toBeDefined()
    expect(perCard!.groupsTotal).toBe(summary.groupsTotal)

    // Sanity: an annual_fee group exists (3 sources all say 0).
    expect(
      events.find((e) => e.claimType === "annual_fee" && e.status === "agreed"),
    ).toBeDefined()
  })

  it("is idempotent: re-running produces zero new inserts and zero new tasks", async () => {
    const first = await aggregateClaims({
      scope: { cardSlugs: ["hsbc-red"] },
    })

    const second = await aggregateClaims({
      scope: { cardSlugs: ["hsbc-red"] },
    })

    expect(second.claimsScanned).toBe(first.claimsScanned)
    expect(second.groupsTotal).toBe(first.groupsTotal)
    // Every group on the 2nd pass should be an UPDATE, not an INSERT.
    expect(second.groupsInserted).toBe(0)
    expect(second.groupsUpdated).toBe(second.groupsTotal)
    // No new tasks — open tasks from pass 1 block creation.
    expect(second.reviewTasksCreated).toBe(0)
  })

  it("dryRun=true computes verdicts but writes nothing", async () => {
    const hsbcRedCard = (
      await db.select({ id: cards.id }).from(cards).where(eq(cards.slug, "hsbc-red"))
    )[0]
    expect(hsbcRedCard).toBeDefined()

    const groupsBefore = await db
      .select({ id: crossCheckGroups.id })
      .from(crossCheckGroups)
      .where(eq(crossCheckGroups.cardId, hsbcRedCard!.id))
    const tasksBefore = await db
      .select({ id: reviewTasks.id })
      .from(reviewTasks)
      .where(eq(reviewTasks.cardId, hsbcRedCard!.id))

    const summary = await aggregateClaims({
      scope: { cardSlugs: ["hsbc-red"] },
      dryRun: true,
    })
    expect(summary.groupsTotal).toBeGreaterThan(0)
    expect(summary.groupsInserted).toBe(0)
    expect(summary.groupsUpdated).toBe(0)
    expect(summary.reviewTasksCreated).toBe(0)

    const groupsAfter = await db
      .select({ id: crossCheckGroups.id })
      .from(crossCheckGroups)
      .where(eq(crossCheckGroups.cardId, hsbcRedCard!.id))
    const tasksAfter = await db
      .select({ id: reviewTasks.id })
      .from(reviewTasks)
      .where(eq(reviewTasks.cardId, hsbcRedCard!.id))

    expect(groupsAfter.length).toBe(groupsBefore.length)
    expect(tasksAfter.length).toBe(tasksBefore.length)
  })
})

// Reference unused imports to satisfy the linter (used in cleanup).
void and
void inArray
void sourceDocuments
