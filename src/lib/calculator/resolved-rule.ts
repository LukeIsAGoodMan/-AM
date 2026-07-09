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

  // Selected-category gating (cards like Hang Seng enJoy / Citi Cash Back+
  // where the user picks N categories). Combined with categorySlug:
  // rule applies only when rule.categorySlug ∈ activatedRuleIds? NO —
  // → ∈ user_context.selectedCategorySlugs.
  requiresSelectedCategory: boolean

  // M10: campaign attachment. If non-null, calculator skips this rule unless
  // user_context.activatedCampaignIds includes this id. Independent of
  // requiresActivation/Registration — both gates apply when both fire.
  campaignId: string | null

  // M3: accrual key for tiered formulas. Defaults to ruleId in mapping code;
  // M4 grouped tiers may share a key across rules.
  accrualKey: string

  // P17 (D23): rule can carry N concurrent caps (category-specific +
  // card-wide is the common pair). All caps must be respected — the
  // calculator applies each and takes the tightest binding constraint.
  // Empty array = no cap on this rule.
  caps: ResolvedCap[]

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

// P17 (D23): parse the `caps` jsonb column shape into ResolvedCap[].
// Migration 0013 backfills existing rows with the shape:
//   [{ usageKey, basis, period, amountHkd?, rewardAmount? }, ...]
// Returns [] for empty / malformed input rather than throwing, but
// individual cap entries with missing basis/period drop silently —
// they'd be no-ops in the calculator anyway.
export function parseCapsJson(raw: unknown, ruleSlug: string): ResolvedCap[] {
  if (!Array.isArray(raw)) return []
  const out: ResolvedCap[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    if (typeof e["basis"] !== "string") continue
    if (typeof e["period"] !== "string") continue
    out.push({
      usageKey: typeof e["usageKey"] === "string" ? e["usageKey"] : ruleSlug,
      basis: e["basis"] as ResolvedCap["basis"],
      period: e["period"] as ResolvedCap["period"],
      amountHkd:
        typeof e["amountHkd"] === "number"
          ? e["amountHkd"]
          : typeof e["amountHkd"] === "string"
            ? Number(e["amountHkd"])
            : null,
      rewardAmount:
        typeof e["rewardAmount"] === "number"
          ? e["rewardAmount"]
          : typeof e["rewardAmount"] === "string"
            ? Number(e["rewardAmount"])
            : null,
    })
  }
  return out
}

// One survivor of matches+exclusion+formula computation. Stacking operates on these.
export type ResolvedCandidate = {
  rule: ResolvedRule
  rewardUnits: number
  rewardHkd: number
}
