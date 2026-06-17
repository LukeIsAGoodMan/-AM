// PRD §8 — calculator output shape.

export type ConfidenceLevel = "high" | "medium" | "low"

export type RewardBreakdownItem = {
  ruleId: string
  ruleName: string
  ruleType: string
  rewardCurrencySlug: string
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
