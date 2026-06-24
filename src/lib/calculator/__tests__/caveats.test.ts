import { describe, it, expect } from "vitest"
import { synthesizeCaveats } from "@/lib/calculator/caveats"
import type { ResolvedRule } from "@/lib/calculator/resolved-rule"
import type { TransactionContext } from "@/lib/schemas/transaction"
import type { RewardResult } from "@/lib/schemas/result"

const txn = (overrides: Partial<TransactionContext> = {}): TransactionContext => ({
  amountHkd: 1000,
  transactionDate: "2026-06-24",
  isOnline: false,
  isForeignCurrency: false,
  countryRegion: "HK",
  ...overrides,
})

const result = (overrides: Partial<RewardResult> = {}): RewardResult => ({
  cardId: "x",
  rewardValueHkd: 10,
  breakdown: [],
  confidence: "high",
  confidenceScore: 0.9,
  caveats: [],
  sourceIds: [],
  ...overrides,
})

describe("synthesizeCaveats", () => {
  it("flags low merchant resolution confidence", () => {
    const out = synthesizeCaveats({
      txn: txn({
        merchantName: "Some Random Shop",
        categorySlug: "unknown",
        categoryResolutionConfidence: 0.3,
      }),
      result: result({ confidence: "low", confidenceScore: 0.3 }),
      cardRules: [],
    })
    expect(out.some((s) => s.includes('"Some Random Shop"'))).toBe(true)
    expect(out.some((s) => s.includes("confidence is low"))).toBe(true)
  })

  it("flags medium merchant confidence with a softer wording", () => {
    const out = synthesizeCaveats({
      txn: txn({
        merchantName: "Foodpanda",
        categorySlug: "dining_local",
        categoryResolutionConfidence: 0.75,
      }),
      result: result(),
      cardRules: [],
    })
    expect(out.some((s) => s.includes("0.75 (medium)"))).toBe(true)
  })

  it("notes when no rules matched but card has gated rules", () => {
    const out = synthesizeCaveats({
      txn: txn(),
      result: result({ rewardValueHkd: 0 }),
      cardRules: [
        {
          ruleId: "x",
          ruleName: "x",
          ruleType: "category_bonus",
          status: "approved",
          formula: { type: "simple_percent", rate: 0.04 },
          rewardCurrencySlug: "hkd_cashback",
          rewardCurrencyValueHkd: 1,
          categorySlug: "dining_local",
          isOnline: null,
          isOverseas: null,
          isForeignCurrency: null,
          requiresActivation: true,
          requiresRegistration: false,
          requiresSelectedCategory: false,
          campaignId: null,
          accrualKey: "x",
          cap: null,
          appliesTo: null,
          stackingPolicy: "additive",
          exclusiveGroup: null,
          priority: 100,
          sourceId: "s",
          confidenceScore: 1,
        } as ResolvedRule,
      ],
    })
    expect(out.some((s) => s.includes("gated rules"))).toBe(true)
  })

  it("notes when no rules matched at all (no gated rules either)", () => {
    const out = synthesizeCaveats({
      txn: txn(),
      result: result({ rewardValueHkd: 0 }),
      cardRules: [
        {
          ruleId: "x",
          ruleName: "x",
          ruleType: "category_bonus",
          status: "approved",
          formula: { type: "simple_percent", rate: 0.04 },
          rewardCurrencySlug: "hkd_cashback",
          rewardCurrencyValueHkd: 1,
          categorySlug: "dining_local",
          isOnline: null,
          isOverseas: null,
          isForeignCurrency: null,
          requiresActivation: false,
          requiresRegistration: false,
          requiresSelectedCategory: false,
          campaignId: null,
          accrualKey: "x",
          cap: null,
          appliesTo: null,
          stackingPolicy: "additive",
          exclusiveGroup: null,
          priority: 100,
          sourceId: "s",
          confidenceScore: 1,
        } as ResolvedRule,
      ],
    })
    expect(out.some((s) => s.includes("No reward rules matched"))).toBe(true)
  })

  it("flags missing dimensions on the txn", () => {
    const out = synthesizeCaveats({
      txn: txn({
        isOnline: undefined,
        isForeignCurrency: undefined,
        countryRegion: "UNKNOWN",
      }),
      result: result(),
      cardRules: [],
    })
    expect(out.some((s) => s.includes("unknown"))).toBe(true)
  })

  it("no caveats when everything is clean", () => {
    const out = synthesizeCaveats({
      txn: txn({
        categorySlug: "dining_local",
      }),
      result: result(),
      cardRules: [],
    })
    expect(out).toEqual([])
  })
})
