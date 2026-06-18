import type { RewardFormula } from "@/lib/schemas/formula"

// PRD §8.5 — ResolvedRule is the seam between Layer 2 (schema) and Layer 4 (compute).
// DB rows are mapped into ResolvedRule before the calculator touches them.
// When schema evolves (M3+ tier accrual, M4 stacking), only the mapping changes;
// the calculator continues to operate on ResolvedRule.

export type ResolvedRule = {
  ruleId: string
  ruleName: string
  ruleType: string
  status: "draft" | "approved" | "archived"

  formula: RewardFormula
  rewardCurrencySlug: string
  rewardCurrencyValueHkd: number

  // M2: flattened conditions. `null` = applies regardless of that dimension.
  categorySlug: string | null
  isOnline: boolean | null
  isOverseas: boolean | null
  isForeignCurrency: boolean | null

  // M2: single-rule cap. M4 will add capUsageKey override for shared groups.
  cap: ResolvedCap | null

  sourceId: string | null
  confidenceScore: number
}

export type ResolvedCap = {
  // Key into UserCardContext.capUsage. Defaults to ruleId for single-rule caps;
  // M4 grouped caps will override with a shared group key.
  usageKey: string
  basis: "spending" | "reward" | "transaction_count"
  // Period is informational for M2 (we trust the caller's capUsage already accounts for the period).
  period: "transaction" | "day" | "month" | "quarter" | "year" | "campaign"
  amountHkd: number | null // populated when basis='spending'
  rewardAmount: number | null // populated when basis='reward' (in reward currency units)
}
