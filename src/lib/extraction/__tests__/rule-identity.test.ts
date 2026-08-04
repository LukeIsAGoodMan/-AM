import { describe, it, expect } from "vitest"
import {
  computeStableScopeKey,
  planLegacyBackfill,
  type RuleScopeInputs,
  type BackfillableRule,
} from "@/lib/extraction/rule-identity"

// Stage 1B core · spec §6. Persistent rule identity: the stable scope key and
// the deterministic 1:1 legacy backfill. These lock in the §6A/§6B/§6C/§12
// guarantees so a later refactor can't silently reintroduce a merge or a
// nondeterministic LIMIT 1 backfill.

const baseScope: RuleScopeInputs = {
  cardId: "card-1",
  ruleType: "base_earn",
  rewardFormulaType: "cashback_percentage",
  rewardCurrencyId: "cur-hkd",
  campaignId: null,
  requiresRegistration: false,
  requiresActivation: false,
  requiresSelectedCategory: false,
}

function makeRule(id: string, over: Partial<BackfillableRule> = {}): BackfillableRule {
  return { id, slug: `slug-${id}`, ...baseScope, ...over }
}

describe("computeStableScopeKey — §6A/§6B determinism + scope", () => {
  it("is deterministic for identical inputs", () => {
    expect(computeStableScopeKey(baseScope)).toBe(computeStableScopeKey({ ...baseScope }))
  })

  it("is independent of object construction order", () => {
    const a: RuleScopeInputs = {
      cardId: "c",
      ruleType: "t",
      rewardFormulaType: "f",
      rewardCurrencyId: "x",
      campaignId: null,
      requiresRegistration: true,
      requiresActivation: false,
      requiresSelectedCategory: true,
    }
    // Same values, properties assigned in a different order.
    const b: RuleScopeInputs = {
      requiresSelectedCategory: true,
      requiresActivation: false,
      requiresRegistration: true,
      campaignId: null,
      rewardCurrencyId: "x",
      rewardFormulaType: "f",
      ruleType: "t",
      cardId: "c",
    }
    expect(computeStableScopeKey(a)).toBe(computeStableScopeKey(b))
  })

  it("is version-prefixed so a future scope change never cross-matches", () => {
    expect(computeStableScopeKey(baseScope).startsWith("v1|")).toBe(true)
  })

  it("distinguishes default cashback vs selectable miles mode (§6B)", () => {
    const miles = computeStableScopeKey({
      ...baseScope,
      rewardFormulaType: "miles_per_hkd",
      rewardCurrencyId: "cur-asia-miles",
    })
    expect(miles).not.toBe(computeStableScopeKey(baseScope))
  })

  it("distinguishes permanent vs campaign scope (§6B)", () => {
    const campaign = computeStableScopeKey({ ...baseScope, campaignId: "camp-1" })
    expect(campaign).not.toBe(computeStableScopeKey(baseScope))
  })

  it("distinguishes universal vs new-customer / opt-in eligibility (§6B)", () => {
    expect(computeStableScopeKey({ ...baseScope, requiresRegistration: true })).not.toBe(
      computeStableScopeKey(baseScope),
    )
    expect(computeStableScopeKey({ ...baseScope, requiresActivation: true })).not.toBe(
      computeStableScopeKey(baseScope),
    )
    expect(computeStableScopeKey({ ...baseScope, requiresSelectedCategory: true })).not.toBe(
      computeStableScopeKey(baseScope),
    )
  })

  it("excludes mutable / correctable fields entirely (§6A)", () => {
    // Category, effective dates, source/confidence are not even inputs — the
    // type forbids them — so a correction to any of them cannot move identity.
    const key = computeStableScopeKey(baseScope)
    for (const forbidden of ["category", "effective", "source", "confidence", "slug", "note"]) {
      expect(key).not.toContain(forbidden)
    }
  })
})

describe("planLegacyBackfill — §6C deterministic 1:1 legacy backfill", () => {
  it("maps each rule to exactly one identity (strict 1:1)", () => {
    const rules = [makeRule("a"), makeRule("b", { cardId: "card-2" }), makeRule("c")]
    const plan = planLegacyBackfill(rules)
    expect(plan.inserts).toHaveLength(3)
    expect(new Set(plan.inserts.map((i) => i.originRuleId))).toEqual(new Set(["a", "b", "c"]))
  })

  it("stamps legacy_unreconciled + card + origin, and preserves origin in audit metadata (§6C)", () => {
    const plan = planLegacyBackfill([makeRule("a")])
    const ins = plan.inserts[0]!
    expect(ins.status).toBe("legacy_unreconciled")
    expect(ins.cardId).toBe("card-1")
    expect(ins.originRuleId).toBe("a")
    const audit = ins.auditMetadata as { origin: { ruleId: string; ruleSlug: string } }
    expect(audit.origin.ruleId).toBe("a")
    expect(audit.origin.ruleSlug).toBe("slug-a")
  })

  it("is order-independent — shuffling input yields identical inserts", () => {
    const rules = [makeRule("a"), makeRule("b"), makeRule("c", { cardId: "card-9" })]
    const forward = planLegacyBackfill(rules)
    const shuffled = planLegacyBackfill([rules[2]!, rules[0]!, rules[1]!])
    expect(shuffled.inserts).toEqual(forward.inserts)
  })

  it("is idempotent — rules that already have an identity are skipped, not re-inserted", () => {
    const rules = [makeRule("a"), makeRule("b"), makeRule("c")]
    const all = planLegacyBackfill(rules, new Set(["a", "b", "c"]))
    expect(all.inserts).toHaveLength(0)
    expect(all.skippedExistingRuleIds.sort()).toEqual(["a", "b", "c"])
  })

  it("partially backfills — only rules without an identity are inserted", () => {
    const rules = [makeRule("a"), makeRule("b"), makeRule("c")]
    const plan = planLegacyBackfill(rules, new Set(["a"]))
    expect(plan.inserts.map((i) => i.originRuleId)).toEqual(["b", "c"])
    expect(plan.skippedExistingRuleIds).toEqual(["a"])
  })

  it("NEVER merges same-scope rules — two identical-scope rules ⇒ two identities + a reported collision (§6C/§12, no LIMIT 1)", () => {
    // a and b are byte-identical in scope; only their row ids differ.
    const rules = [makeRule("a"), makeRule("b")]
    const plan = planLegacyBackfill(rules)
    expect(plan.inserts).toHaveLength(2)
    // Both share one scope key…
    const keys = new Set(plan.inserts.map((i) => i.stableScopeKey))
    expect(keys.size).toBe(1)
    // …and that collision is surfaced for later reviewer reconciliation, not
    // collapsed during backfill.
    expect(plan.collisions).toHaveLength(1)
    expect(plan.collisions[0]!.ruleIds.sort()).toEqual(["a", "b"])
  })
})
