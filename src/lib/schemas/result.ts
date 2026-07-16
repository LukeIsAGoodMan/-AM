// PRD §8 — calculator output shape.

import type { RewardCurrencyDisplay } from "@/lib/calculator/resolved-rule"

export type ConfidenceLevel = "high" | "medium" | "low"

export type RewardBreakdownItem = {
  ruleId: string
  ruleName: string
  ruleType: string
  rewardCurrencySlug: string
  // P18 (§3F): structured display object for the reward currency.
  rewardCurrency: RewardCurrencyDisplay
  rewardUnits: number
  rewardHkd: number
  sourceId: string | null
  confidenceScore: number
}

export type RewardResult = {
  cardId: string
  rewardValueHkd: number
  breakdown: RewardBreakdownItem[]
  confidence: ConfidenceLevel
  confidenceScore: number
  caveats: string[]
  sourceIds: string[]
}
