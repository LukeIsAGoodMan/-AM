import { describe, it, expect } from "vitest"
import { calculate } from "@/lib/calculator/calculate"
import type { ResolvedRule } from "@/lib/calculator/resolved-rule"
import type { TransactionContext } from "@/lib/schemas/transaction"

// M1 fixture: Citi Cash Back, simplified to a flat 1.2% base earn.
// Real Citi Cash Back has online/overseas/dining tiers — those come in M2/M3.
const citiCashBackBase: ResolvedRule = {
  ruleId: "citi-cash-back__base_earn",
  ruleName: "Base earn",
  ruleType: "base_earn",
  status: "approved",
  formula: { type: "simple_percent", rate: 0.012 },
  rewardCurrencySlug: "hkd_cashback",
  rewardCurrencyValueHkd: 1.0,
  sourceId: "stub-source-id",
  confidenceScore: 0.9,
}

const txn = (amountHkd: number): TransactionContext => ({
  amountHkd,
  transactionDate: "2026-06-17",
})

describe("calculate — M1 simple_percent", () => {
  it("HKD 1000 spend → 12 HKD reward (1.2%)", () => {
    const res = calculate("citi-cash-back", [citiCashBackBase], txn(1000))
    expect(res.rewardValueHkd).toBe(12)
    expect(res.breakdown).toHaveLength(1)
    expect(res.confidence).toBe("high")
    expect(res.sourceIds).toEqual(["stub-source-id"])
  })

  it("HKD 500 spend → 6 HKD reward", () => {
    const res = calculate("citi-cash-back", [citiCashBackBase], txn(500))
    expect(res.rewardValueHkd).toBe(6)
  })

  it("HKD 0 spend → 0 HKD reward, breakdown still recorded", () => {
    const res = calculate("citi-cash-back", [citiCashBackBase], txn(0))
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(1)
    expect(res.breakdown[0]?.rewardHkd).toBe(0)
  })

  it("draft rules are ignored", () => {
    const draftRule: ResolvedRule = { ...citiCashBackBase, status: "draft" }
    const res = calculate("citi-cash-back", [draftRule], txn(1000))
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
  })

  it("no rules → 0 reward with empty breakdown", () => {
    const res = calculate("citi-cash-back", [], txn(1000))
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
    expect(res.sourceIds).toEqual([])
  })
})
