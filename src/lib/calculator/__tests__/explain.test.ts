import { describe, it, expect } from "vitest"
import { explainCalculate } from "@/lib/calculator/explain"
import type { ResolvedRule } from "@/lib/calculator/resolved-rule"
import type { TransactionContext } from "@/lib/schemas/transaction"

// explainCalculate mirrors calculate's pipeline but returns per-rule
// decisions for the /calculator-test "Why this lost" view. These tests
// pin down each gate so refactors don't quietly change the explanation
// the UI shows the user.

const baseRule = (
  overrides: Partial<ResolvedRule> & Pick<ResolvedRule, "ruleId" | "formula">,
): ResolvedRule => ({
  ruleName: overrides.ruleId,
  ruleType: "base_earn",
  status: "approved",
  rewardCurrencySlug: "hkd_cashback",
  rewardCurrencyValueHkd: 1.0,
  categorySlug: null,
  isOnline: null,
  isOverseas: null,
  isForeignCurrency: null,
  requiresActivation: false,
  requiresRegistration: false,
  requiresSelectedCategory: false,
  campaignId: null,
  accrualKey: overrides.ruleId,
  cap: null,
  appliesTo: null,
  stackingPolicy: "additive",
  exclusiveGroup: null,
  priority: 100,
  sourceId: "src-1",
  confidenceScore: 0.9,
  ...overrides,
})

const txn = (overrides: Partial<TransactionContext> = {}): TransactionContext => ({
  amountHkd: 1000,
  transactionDate: "2026-06-24",
  ...overrides,
})

describe("explainCalculate — gate-by-gate outcomes", () => {
  it("includes a vanilla matching rule", () => {
    const r = baseRule({
      ruleId: "base",
      formula: { type: "simple_percent", rate: 0.012 },
    })
    const ex = explainCalculate([r], txn({ amountHkd: 1000 }))
    expect(ex).toHaveLength(1)
    expect(ex[0]!.outcome.kind).toBe("included")
    if (ex[0]!.outcome.kind === "included") {
      expect(ex[0]!.outcome.rewardHkd).toBeCloseTo(12)
    }
  })

  it("reports not_approved for non-approved rules", () => {
    const r = baseRule({
      ruleId: "draft",
      status: "draft",
      formula: { type: "simple_percent", rate: 0.012 },
    })
    expect(explainCalculate([r], txn())[0]!.outcome.kind).toBe("not_approved")
  })

  it("reports no_match_category with rule + txn values", () => {
    const r = baseRule({
      ruleId: "dine",
      categorySlug: "dining_local",
      formula: { type: "simple_percent", rate: 0.04 },
    })
    const ex = explainCalculate([r], txn({ categorySlug: "online_local" }))
    expect(ex[0]!.outcome).toEqual({
      kind: "no_match_category",
      ruleValue: "dining_local",
      txnValue: "online_local",
    })
  })

  it("reports no_match_online when txn online is unknown vs required true", () => {
    const r = baseRule({
      ruleId: "online_bonus",
      isOnline: true,
      formula: { type: "simple_percent", rate: 0.03 },
    })
    const ex = explainCalculate([r], txn())
    expect(ex[0]!.outcome.kind).toBe("no_match_online")
  })

  it("reports needs_activation when rule is gated and user hasn't opted in", () => {
    const r = baseRule({
      ruleId: "tiered",
      requiresRegistration: true,
      formula: { type: "simple_percent", rate: 0.02 },
    })
    const ex = explainCalculate([r], txn())
    expect(ex[0]!.outcome.kind).toBe("needs_activation")
  })

  it("flips to included once the activation is provided", () => {
    const r = baseRule({
      ruleId: "tiered",
      requiresRegistration: true,
      formula: { type: "simple_percent", rate: 0.02 },
    })
    const ex = explainCalculate([r], txn(), {
      cardId: "x",
      activatedRuleIds: ["tiered"],
    })
    expect(ex[0]!.outcome.kind).toBe("included")
  })

  it("reports needs_selected_category when rule is gated and user didn't pick", () => {
    const r = baseRule({
      ruleId: "dine_select",
      categorySlug: "dining_local",
      requiresSelectedCategory: true,
      formula: { type: "simple_percent", rate: 0.04 },
    })
    const ex = explainCalculate([r], txn({ categorySlug: "dining_local" }))
    expect(ex[0]!.outcome).toEqual({
      kind: "needs_selected_category",
      ruleCategory: "dining_local",
    })
  })

  it("reports needs_campaign_opt_in when campaign rule isn't activated", () => {
    const r = baseRule({
      ruleId: "campaign_extra",
      campaignId: "camp-uuid",
      ruleType: "campaign_bonus",
      formula: { type: "simple_percent", rate: 0.02 },
    })
    const ex = explainCalculate([r], txn())
    expect(ex[0]!.outcome).toEqual({
      kind: "needs_campaign_opt_in",
      campaignId: "camp-uuid",
    })
  })

  it("reports excluded_by when an exclusion disables a matched bonus", () => {
    const bonus = baseRule({
      ruleId: "category_bonus",
      ruleType: "category_bonus",
      categorySlug: "tax_government",
      formula: { type: "simple_percent", rate: 0.05 },
    })
    const ex = baseRule({
      ruleId: "tax_exclusion",
      ruleType: "exclusion",
      categorySlug: "tax_government",
      appliesTo: ["category_bonus"],
      formula: { type: "no_reward" },
    })
    const traces = explainCalculate(
      [bonus, ex],
      txn({ categorySlug: "tax_government" }),
    )
    const bonusTrace = traces.find((t) => t.rule.ruleId === "category_bonus")!
    expect(bonusTrace.outcome.kind).toBe("excluded_by")
    if (bonusTrace.outcome.kind === "excluded_by") {
      expect(bonusTrace.outcome.byRuleId).toBe("tax_exclusion")
    }
  })

  it("base_earn alongside an exclusion that doesn't target it stays included (PRD §8.4)", () => {
    const base = baseRule({
      ruleId: "base",
      ruleType: "base_earn",
      formula: { type: "simple_percent", rate: 0.005 },
    })
    const bonus = baseRule({
      ruleId: "cat",
      ruleType: "category_bonus",
      categorySlug: "tax_government",
      formula: { type: "simple_percent", rate: 0.04 },
    })
    const ex = baseRule({
      ruleId: "tax_exclusion",
      ruleType: "exclusion",
      categorySlug: "tax_government",
      appliesTo: ["category_bonus"],
      formula: { type: "no_reward" },
    })
    const traces = explainCalculate(
      [base, bonus, ex],
      txn({ amountHkd: 10000, categorySlug: "tax_government" }),
    )
    expect(traces.find((t) => t.rule.ruleId === "base")!.outcome.kind).toBe(
      "included",
    )
    expect(traces.find((t) => t.rule.ruleId === "cat")!.outcome.kind).toBe(
      "excluded_by",
    )
  })
})
