import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { eq, inArray, like } from "drizzle-orm"
import { db } from "@/db/client"
import { cards, rewardRules } from "@/db/schema/catalog"
import {
  crossCheckGroups,
  rewardRuleSources,
  sourceClaims,
} from "@/db/schema/extraction"
import {
  materializeApprovedGroups,
  materializeGroup,
} from "@/lib/extraction/materializer"
import { aggregateClaims } from "@/lib/extraction/aggregator"

// P7 materializer tests — live integration against the hsbc-red corpus
// seeded by P8-partial + P4. The materializer is the kind of code where
// schema integration matters more than pure unit purity, so we exercise
// the real DB end-to-end and clean up after ourselves.
//
// What we pin:
//   - earn_rate group materializes into a reward_rule + reward_rule_sources
//   - reward_rule.source_id is the highest-priority supporting source
//   - reward_rule_sources contains one row per distinct supporting source
//   - cross_check_groups.approved_rule_id is set on success
//   - re-running materializeGroup on the same id is a no-op (kind=skipped)
//   - unsupported claim_types (annual_fee, welcome_offer, ...) skip cleanly
//   - bulk materializeApprovedGroups respects card-slug scope
//
// Each test sets up its own group → cleans up its own rule + join rows +
// reverts the group's approved_rule_id pointer. Tests do NOT touch the
// aggregator's source_claims state.

const CLEAN_SLUG_PREFIX = "xchk__"

beforeAll(async () => {
  // Ensure the aggregator has run at least once for hsbc-red, otherwise
  // there are no eligible groups to materialize. The aggregator test runs
  // alongside us but we can't depend on its ordering — call it once,
  // idempotently (D12 makes this safe).
  await aggregateClaims({ scope: { cardSlugs: ["hsbc-red"] } })
})

afterEach(async () => {
  // Roll back any rules + join rows + group pointers we created during
  // the test. Scoped to slugs that start with `xchk__` so we don't touch
  // hand-curated rules. Order: detach FK references first, then delete.
  const rules = await db
    .select({ id: rewardRules.id })
    .from(rewardRules)
    .where(like(rewardRules.slug, `${CLEAN_SLUG_PREFIX}%`))
  if (rules.length > 0) {
    const ruleIds = rules.map((r) => r.id)
    // 1. Clear the group → rule pointer (FK is set null on delete, but
    //    explicit prevents lingering wrong state if the cascade isn't set).
    await db
      .update(crossCheckGroups)
      .set({ approvedRuleId: null })
      .where(inArray(crossCheckGroups.approvedRuleId, ruleIds))
    // 2. Drop join rows (FK cascade would do it, but explicit is faster
    //    and survives FK churn).
    await db
      .delete(rewardRuleSources)
      .where(inArray(rewardRuleSources.ruleId, ruleIds))
    // 3. Delete the rules.
    await db.delete(rewardRules).where(inArray(rewardRules.id, ruleIds))
  }
})

describe("P7 materializer — single-group entry point", () => {
  it("materializes an earn_rate / online_local group into a reward_rule", async () => {
    const hsbcRedId = (
      await db.select({ id: cards.id }).from(cards).where(eq(cards.slug, "hsbc-red"))
    )[0]!.id

    // The aggregator should have produced a category_slug=online_local
    // earn_rate group; it's our canonical 'agreed' example.
    const group = (
      await db
        .select()
        .from(crossCheckGroups)
        .where(
          eq(crossCheckGroups.cardId, hsbcRedId),
        )
    ).find(
      (g) =>
        g.claimType === "earn_rate" &&
        g.keyDimension === "category_slug=online_local",
    )
    expect(group).toBeDefined()
    expect(group!.canonicalPayload).toBeTruthy()

    const outcome = await materializeGroup(group!.id)
    expect(outcome.kind).toBe("created")
    if (outcome.kind !== "created") return // type narrow

    // Slug carries the xchk__ prefix and the dimension; reward_rule row
    // exists with the expected fields.
    expect(outcome.ruleSlug.startsWith("xchk__")).toBe(true)
    expect(outcome.ruleType).toBe("online_bonus") // online_local + isOnline=true
    expect(outcome.supportingSourceCount).toBeGreaterThanOrEqual(2) // moneyhero + mrmiles + possibly official

    const ruleRow = (
      await db
        .select()
        .from(rewardRules)
        .where(eq(rewardRules.id, outcome.ruleId))
    )[0]
    expect(ruleRow).toBeDefined()
    expect(ruleRow!.status).toBe("approved")
    expect(ruleRow!.cardId).toBe(hsbcRedId)
    expect(ruleRow!.isOnline).toBe(true)
    expect(ruleRow!.sourceId).not.toBeNull()
    // Confidence comes from the group's aggregate_confidence.
    expect(Number(ruleRow!.confidenceScore)).toBeCloseTo(
      Number(group!.aggregateConfidence),
      3,
    )

    // reward_rule_sources rows: one per distinct source.
    const joinRows = await db
      .select({ sourceId: rewardRuleSources.sourceId })
      .from(rewardRuleSources)
      .where(eq(rewardRuleSources.ruleId, outcome.ruleId))
    expect(joinRows.length).toBe(outcome.supportingSourceCount)
    // No duplicates (composite PK guarantees this, but verify the count).
    expect(new Set(joinRows.map((r) => r.sourceId)).size).toBe(joinRows.length)

    // The group's approved_rule_id is now set.
    const reloaded = (
      await db
        .select({ approvedRuleId: crossCheckGroups.approvedRuleId })
        .from(crossCheckGroups)
        .where(eq(crossCheckGroups.id, group!.id))
    )[0]
    expect(reloaded!.approvedRuleId).toBe(outcome.ruleId)
  })

  it("is idempotent: re-running on the same group skips", async () => {
    const hsbcRedId = (
      await db.select({ id: cards.id }).from(cards).where(eq(cards.slug, "hsbc-red"))
    )[0]!.id

    const group = (
      await db.select().from(crossCheckGroups).where(eq(crossCheckGroups.cardId, hsbcRedId))
    ).find(
      (g) =>
        g.claimType === "earn_rate" &&
        g.keyDimension === "category_slug=online_local",
    )!

    const first = await materializeGroup(group.id)
    expect(first.kind).toBe("created")

    const second = await materializeGroup(group.id)
    expect(second.kind).toBe("skipped")
    if (second.kind !== "skipped") return
    expect(second.reason).toContain("already materialized")
    if (first.kind === "created") {
      expect(second.existingRuleId).toBe(first.ruleId)
    }
  })

  it("skips unsupported claim_types (annual_fee → cards table, not reward_rule)", async () => {
    const hsbcRedId = (
      await db.select({ id: cards.id }).from(cards).where(eq(cards.slug, "hsbc-red"))
    )[0]!.id

    const annualFee = (
      await db.select().from(crossCheckGroups).where(eq(crossCheckGroups.cardId, hsbcRedId))
    ).find((g) => g.claimType === "annual_fee")
    expect(annualFee).toBeDefined()

    const outcome = await materializeGroup(annualFee!.id)
    expect(outcome.kind).toBe("skipped")
    if (outcome.kind !== "skipped") return
    expect(outcome.reason).toContain("not supported by P7")
  })

  it("returns failed for unknown group id", async () => {
    const outcome = await materializeGroup(
      "00000000-0000-0000-0000-000000000000",
    )
    expect(outcome.kind).toBe("failed")
  })
})

describe("P7 materializer — bulk entry point", () => {
  it("respects card-slug scope; ignores unsupported claim_types in the count", async () => {
    const summary = await materializeApprovedGroups({
      cardSlugs: ["hsbc-red"],
    })
    // hsbc-red has earn_rate + exclusion groups eligible (~13 of the 21
    // agreed/single_source — annual_fee/welcome/eligibility don't qualify
    // for P7 v1 and skip). 'considered' counts every eligible-status group
    // in scope before the per-claim_type filter, so it should be ≥ what
    // we created.
    expect(summary.considered).toBeGreaterThanOrEqual(summary.created)
    expect(summary.created + summary.skipped + summary.failed).toBe(
      summary.considered,
    )
    // At least one earn_rate or exclusion group from hsbc-red should
    // materialize. Tighter: there are >5 earn_rate dimensions agreed.
    expect(summary.created).toBeGreaterThanOrEqual(1)
  })

  it("returns empty summary for an unknown card slug", async () => {
    const summary = await materializeApprovedGroups({
      cardSlugs: ["__no_such_card__"],
    })
    expect(summary.considered).toBe(0)
    expect(summary.created).toBe(0)
    expect(summary.outcomes).toEqual([])
  })
})

// Reference unused imports the cleanup uses.
void sourceClaims
