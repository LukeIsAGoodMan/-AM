import { describe, it, expect, beforeAll } from "vitest"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "@/db/client"
import { cards, rewardRules } from "@/db/schema/catalog"
import {
  crossCheckGroups,
  rewardRuleSources,
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
// Deliberately no afterEach/afterAll cleanup — same rationale as
// aggregator.test.ts. The materializer is idempotent on
// `approved_rule_id IS NULL`; re-runs of these tests link to the
// existing rule or skip with kind='skipped'. Cleaning up would wipe
// the /rules + /review demo data that P5/P6/P7 surfaces in the UI.
// To reset by hand:
//   docker exec am-postgres psql -U am -d am \\
//     -c "UPDATE cross_check_groups SET approved_rule_id = NULL
//         WHERE approved_rule_id IN (SELECT id FROM reward_rules WHERE slug LIKE 'xchk__%');" \\
//     -c "DELETE FROM reward_rule_sources WHERE rule_id IN (SELECT id FROM reward_rules WHERE slug LIKE 'xchk__%');" \\
//     -c "DELETE FROM reward_rules WHERE slug LIKE 'xchk__%';"

beforeAll(async () => {
  // Ensure the aggregator has run at least once for hsbc-red, otherwise
  // there are no eligible groups to materialize. Idempotent (D12).
  await aggregateClaims({ scope: { cardSlugs: ["hsbc-red"] } })
})

// Helper: scoped reset of one group's materialized rule, used by the
// two tests that need to exercise the `kind='created'` path. Keeping it
// per-group means we never wipe other cards' demo state.
async function resetGroupMaterialization(groupId: string): Promise<void> {
  const group = (
    await db
      .select({ approvedRuleId: crossCheckGroups.approvedRuleId })
      .from(crossCheckGroups)
      .where(eq(crossCheckGroups.id, groupId))
  )[0]
  if (!group?.approvedRuleId) return
  const oldRuleId = group.approvedRuleId
  await db
    .update(crossCheckGroups)
    .set({ approvedRuleId: null })
    .where(eq(crossCheckGroups.id, groupId))
  await db
    .delete(rewardRuleSources)
    .where(eq(rewardRuleSources.ruleId, oldRuleId))
  await db.delete(rewardRules).where(eq(rewardRules.id, oldRuleId))
}

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

    // Reset just this group's materialized rule so the assertion always
    // exercises the kind='created' path, even across re-runs that left
    // hsbc-red rules in place.
    await resetGroupMaterialization(group!.id)

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

    await resetGroupMaterialization(group.id)

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

  // D19 regression — before the P13 fix, a points_per_hkd group whose
  // currencySlug wasn't in reward_currencies (e.g. LLM-hallucinated
  // "miles_generic") landed a rule with reward_currency_id=NULL. The
  // calculator loader then fallbacked to 1.0 HKD/mile → ~10× reward
  // inflation. Now the materializer must refuse instead.
  it("skips points_per_hkd groups whose currencySlug isn't in reward_currencies (D19)", async () => {
    // Find any eligible group in the live corpus with an off-taxonomy
    // currency slug. P9.5 seeded a few of these (miles_generic × 1,
    // avios × 2, membership_rewards × 1). If they've all been cleaned
    // up by adding the currencies to YAML or reclassifying in review,
    // this test becomes stale — refuse silently so someone updates it.
    const badGroup = (
      await db
        .select({ id: crossCheckGroups.id })
        .from(crossCheckGroups)
        .where(
          and(
            eq(crossCheckGroups.claimType, "earn_rate"),
            isNull(crossCheckGroups.approvedRuleId),
            inArray(crossCheckGroups.status, ["agreed", "single_source"]),
            sql`canonical_payload->>'rewardFormulaType' = 'points_per_hkd'`,
            sql`canonical_payload->>'currencySlug' IS NOT NULL`,
            sql`canonical_payload->>'currencySlug' NOT IN (SELECT slug FROM reward_currencies)`,
          ),
        )
        .limit(1)
    )[0]
    expect(
      badGroup,
      "Expected at least one off-taxonomy-currency group in the live corpus for D19 coverage. If all such groups have been cleaned up, delete this test or synthesize one.",
    ).toBeDefined()
    const outcome = await materializeGroup(badGroup!.id)
    expect(outcome.kind).toBe("skipped")
    if (outcome.kind !== "skipped") return
    expect(outcome.reason).toMatch(/not in reward_currencies/)
  })

  // D21 (P15) — fan-out stitching: a cap group with
  // key_dimension='applies_to=X,Y,Z' should attach to every earn_rate
  // rule whose category ∈ {X, Y, Z} with a SHARED capUsageKey so the
  // calculator's accrual bucket is shared across all fanned-out rules.
  it("live corpus has fan-out or card-level cap stitches with shared xcap: usageKey (D21)", async () => {
    // Read-only invariant: at least one xchk__ approved rule in the corpus
    // was materialized from a shared cap group and therefore carries an
    // xcap:-prefixed capUsageKey. Non-null capUsageKey is the signal that
    // multiple rules share one accrual bucket (fan-out or card-level path
    // in loadMatchingCap). Single-rule caps leave the column null and the
    // mapRow layer falls back to rule.slug.
    const shared = await db
      .select({
        ruleSlug: rewardRules.slug,
        capUsageKey: rewardRules.capUsageKey,
        capBasis: rewardRules.capBasis,
      })
      .from(rewardRules)
      .where(
        and(
          eq(rewardRules.status, "approved"),
          sql`slug LIKE 'xchk__%'`,
          sql`cap_usage_key IS NOT NULL`,
        ),
      )
    expect(
      shared.length,
      "Expected xchk__ rules with a shared xcap: capUsageKey (P15 fan-out or card-level cap). If corpus was reset, run pnpm p7:materialize first.",
    ).toBeGreaterThan(0)
    // Every shared bucket uses the xcap: prefix and has a cap_basis set.
    for (const r of shared) {
      expect(r.capUsageKey!.startsWith("xcap:")).toBe(true)
      expect(r.capBasis).not.toBeNull()
    }
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
    expect(summary.considered).toBeGreaterThanOrEqual(1)
    // The math holds: every considered group ends up in exactly one
    // outcome bucket (we don't double-count).
    expect(summary.created + summary.skipped + summary.failed).toBe(
      summary.considered,
    )
    // Don't assert created≥1 — the previous test already materialized one
    // group, and the bulk path won't re-create it (idempotent on
    // approved_rule_id). The "created" path is exercised by the
    // single-group test above.
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

