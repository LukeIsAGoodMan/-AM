import type { RewardFormula } from "@/lib/schemas/formula"

// PRD §8.5 — ResolvedRule is the seam between Layer 2 (schema) and Layer 4 (compute).
// DB rows are mapped into ResolvedRule before the calculator touches them.
// When schema evolves (M2+ flatten conditions, M3+ tier accrual, etc.),
// only the mapping changes; the calculator continues to operate on ResolvedRule.

export type ResolvedRule = {
  ruleId: string
  ruleName: string
  ruleType: string
  status: "draft" | "approved" | "archived"
  formula: RewardFormula
  rewardCurrencySlug: string
  rewardCurrencyValueHkd: number // multiplier from reward units → HKD
  sourceId: string | null
  confidenceScore: number
}
