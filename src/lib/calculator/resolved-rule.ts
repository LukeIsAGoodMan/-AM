import type { RewardFormula } from "@/lib/schemas/formula"

// PRD §8.5 — ResolvedRule is the seam between Layer 2 (schema) and Layer 4 (compute).
// DB rows are mapped into ResolvedRule before the calculator touches them.
// When schema evolves, only the mapping changes; the calculator stays.

export type StackingPolicy =
  | "additive"
  | "max_only_in_group"
  | "replaces_base"

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

  // M3: opt-in gating. Calculator skips this rule unless the rule_id appears
  // in user_context.activatedRuleIds.
  requiresActivation: boolean
  requiresRegistration: boolean

  // M3: accrual key for tiered formulas. Defaults to ruleId in mapping code;
  // M4 grouped tiers may share a key across rules.
  accrualKey: string

  // M2: single-rule cap.
  cap: ResolvedCap | null

  // M4: exclusion + stacking (PRD §8.2 steps 4–5).
  // - appliesTo: for ruleType='exclusion', the rule_types this exclusion
  //   disables. null on non-exclusion rules.
  // - stackingPolicy: 'additive' (default), 'max_only_in_group', 'replaces_base'.
  // - exclusiveGroup: rules sharing a group key obey the policy together.
  // - priority: groups iterate in ascending priority; lower = first.
  appliesTo: string[] | null
  stackingPolicy: StackingPolicy
  exclusiveGroup: string | null
  priority: number

  sourceId: string | null
  confidenceScore: number
}

export type ResolvedCap = {
  usageKey: string
  basis: "spending" | "reward" | "transaction_count"
  period: "transaction" | "day" | "month" | "quarter" | "year" | "campaign"
  amountHkd: number | null
  rewardAmount: number | null
}

// One survivor of matches+exclusion+formula computation. Stacking operates on these.
export type ResolvedCandidate = {
  rule: ResolvedRule
  rewardUnits: number
  rewardHkd: number
}
