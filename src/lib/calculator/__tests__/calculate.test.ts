import { describe, it, expect } from "vitest"
import { calculate } from "@/lib/calculator/calculate"
import type { ResolvedRule } from "@/lib/calculator/resolved-rule"
import type { TransactionContext } from "@/lib/schemas/transaction"

// Test fixtures kept inline. As cards grow we'll extract to /test-fixtures.

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
  cap: null,
  sourceId: "stub-source-id",
  confidenceScore: 0.9,
  ...overrides,
})

const txn = (overrides: Partial<TransactionContext> = {}): TransactionContext => ({
  amountHkd: 0,
  transactionDate: "2026-06-17",
  ...overrides,
})

// ---------- M1: simple_percent + status filtering ----------

describe("calculate — M1 simple_percent", () => {
  const citiBase = baseRule({
    ruleId: "citi-cash-back__base_earn",
    ruleName: "Citi Cash Back base earn",
    formula: { type: "simple_percent", rate: 0.012 },
  })

  it("HKD 1000 spend → 12 HKD reward (1.2%)", () => {
    const res = calculate("citi-cash-back", [citiBase], txn({ amountHkd: 1000 }))
    expect(res.rewardValueHkd).toBe(12)
    expect(res.breakdown).toHaveLength(1)
    expect(res.confidence).toBe("high")
    expect(res.sourceIds).toEqual(["stub-source-id"])
  })

  it("HKD 500 spend → 6 HKD reward", () => {
    const res = calculate("citi-cash-back", [citiBase], txn({ amountHkd: 500 }))
    expect(res.rewardValueHkd).toBe(6)
  })

  it("HKD 0 spend → 0 HKD reward, no breakdown entry", () => {
    // M2 change: rewardUnits=0 entries are now suppressed from breakdown
    // (matches behave: don't show rules that contributed nothing).
    const res = calculate("citi-cash-back", [citiBase], txn({ amountHkd: 0 }))
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
  })

  it("draft rules are ignored", () => {
    const draft: ResolvedRule = { ...citiBase, status: "draft" }
    const res = calculate("citi-cash-back", [draft], txn({ amountHkd: 1000 }))
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
  })

  it("no rules → 0 reward, empty sources", () => {
    const res = calculate("citi-cash-back", [], txn({ amountHkd: 1000 }))
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
    expect(res.sourceIds).toEqual([])
  })
})

// ---------- M2: category + online matching ----------

describe("calculate — M2 condition matching", () => {
  const hsbcRedBase = baseRule({
    ruleId: "hsbc-red__base_earn",
    ruleName: "HSBC Red base earn",
    formula: { type: "simple_percent", rate: 0.004 },
  })
  const hsbcRedOnline = baseRule({
    ruleId: "hsbc-red__online_local_bonus",
    ruleName: "HSBC Red online 4%",
    ruleType: "online_bonus",
    formula: { type: "simple_percent", rate: 0.04 },
    categorySlug: "online_local",
    isOnline: true,
    isOverseas: false,
    cap: {
      usageKey: "hsbc-red__online_local_bonus",
      basis: "spending",
      period: "year",
      amountHkd: 100000,
      rewardAmount: null,
    },
  })
  const rules = [hsbcRedBase, hsbcRedOnline]

  it("HSBC Red online HKD 5000 → 200 HKD (4% bonus) + 20 HKD (0.4% base) = 220", () => {
    const res = calculate(
      "hsbc-red",
      rules,
      txn({
        amountHkd: 5000,
        categorySlug: "online_local",
        isOnline: true,
        countryRegion: "HK",
      }),
    )
    expect(res.rewardValueHkd).toBe(220)
    expect(res.breakdown).toHaveLength(2)
  })

  it("HSBC Red offline HKD 5000 → 20 HKD (only base earn matches)", () => {
    const res = calculate(
      "hsbc-red",
      rules,
      txn({
        amountHkd: 5000,
        categorySlug: "dining_local",
        isOnline: false,
        countryRegion: "HK",
      }),
    )
    expect(res.rewardValueHkd).toBe(20)
    expect(res.breakdown).toHaveLength(1)
    expect(res.breakdown[0]?.ruleType).toBe("base_earn")
  })

  it("HSBC Red online but txn.isOnline missing → bonus does NOT apply (no match)", () => {
    // Unknown txn.isOnline does NOT satisfy a rule that requires isOnline=true.
    // PRD principle: better to under-credit than over-credit.
    const res = calculate(
      "hsbc-red",
      rules,
      txn({ amountHkd: 5000, categorySlug: "online_local", countryRegion: "HK" }),
    )
    expect(res.rewardValueHkd).toBe(20)
    expect(res.breakdown).toHaveLength(1)
  })
})

// ---------- M2: single-rule spending cap ----------

describe("calculate — M2 spending cap", () => {
  const hsbcRedOnline = baseRule({
    ruleId: "hsbc-red__online_local_bonus",
    ruleName: "HSBC Red online 4%",
    ruleType: "online_bonus",
    formula: { type: "simple_percent", rate: 0.04 },
    categorySlug: "online_local",
    isOnline: true,
    cap: {
      usageKey: "hsbc-red__online_local_bonus",
      basis: "spending",
      period: "year",
      amountHkd: 100000,
      rewardAmount: null,
    },
  })

  it("under cap → full 4%", () => {
    const res = calculate(
      "hsbc-red",
      [hsbcRedOnline],
      txn({ amountHkd: 3000, categorySlug: "online_local", isOnline: true }),
      { cardId: "hsbc-red", capUsage: { "hsbc-red__online_local_bonus": 0 } },
    )
    expect(res.rewardValueHkd).toBe(120)
  })

  it("partially through cap → still full 4% (well within)", () => {
    const res = calculate(
      "hsbc-red",
      [hsbcRedOnline],
      txn({ amountHkd: 2000, categorySlug: "online_local", isOnline: true }),
      {
        cardId: "hsbc-red",
        capUsage: { "hsbc-red__online_local_bonus": 80000 }, // 20k remaining
      },
    )
    expect(res.rewardValueHkd).toBe(80) // 2000 × 4%
  })

  it("crosses cap boundary → only remaining eligible spend earns 4%", () => {
    // 95k already used, cap 100k, txn 10k
    // → only 5k eligible at 4% = 200 HKD
    const res = calculate(
      "hsbc-red",
      [hsbcRedOnline],
      txn({ amountHkd: 10000, categorySlug: "online_local", isOnline: true }),
      {
        cardId: "hsbc-red",
        capUsage: { "hsbc-red__online_local_bonus": 95000 },
      },
    )
    expect(res.rewardValueHkd).toBe(200)
  })

  it("cap fully consumed → no reward from this rule", () => {
    const res = calculate(
      "hsbc-red",
      [hsbcRedOnline],
      txn({ amountHkd: 1000, categorySlug: "online_local", isOnline: true }),
      {
        cardId: "hsbc-red",
        capUsage: { "hsbc-red__online_local_bonus": 100000 },
      },
    )
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
  })
})
