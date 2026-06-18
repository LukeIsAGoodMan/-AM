import type { TransactionContext } from "@/lib/schemas/transaction"
import type {
  ConfidenceLevel,
  RewardBreakdownItem,
  RewardResult,
} from "@/lib/schemas/result"
import type { ResolvedRule } from "./resolved-rule"
import { matches } from "./matches"
import { applyRuleWithCap, type CapUsage } from "./apply-cap"

// PRD §8.2 — pure calculator. M2 scope:
//   ✅ step 2 (filter approved + date range — date in M3)
//   ✅ step 3 (matches: category / online / overseas / fx)
//   ✅ step 6 (single-rule cap, spending basis)
//   ✅ step 7 (HKD conversion)
//   ✅ step 8 (confidence)
//   ⏳ step 1 (merchant resolver) — M5/M7
//   ⏳ step 4 (exclusion) — M4
//   ⏳ step 5 (stacking) — M4
// Until M4, all matched rules are simply additive.

export type UserCardContext = {
  cardId: string
  selectedCategorySlugs?: string[]
  activatedCampaignIds?: string[]
  capUsage?: CapUsage
}

export function calculate(
  cardId: string,
  rules: ResolvedRule[],
  txn: TransactionContext,
  userContext?: UserCardContext,
): RewardResult {
  const capUsage = userContext?.capUsage ?? {}

  const approved = rules.filter((r) => r.status === "approved")

  const breakdown: RewardBreakdownItem[] = []
  let totalHkd = 0

  for (const rule of approved) {
    if (!matches(rule, txn)) continue

    const { rewardUnits } = applyRuleWithCap(rule, txn, capUsage)
    if (rewardUnits === 0) continue

    const rewardHkd = rewardUnits * rule.rewardCurrencyValueHkd
    totalHkd += rewardHkd
    breakdown.push({
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      ruleType: rule.ruleType,
      rewardCurrencySlug: rule.rewardCurrencySlug,
      rewardUnits,
      rewardHkd,
      sourceId: rule.sourceId,
      confidenceScore: rule.confidenceScore,
    })
  }

  const minConf =
    breakdown.length === 0
      ? 1.0
      : Math.min(...breakdown.map((b) => b.confidenceScore))
  const confidence: ConfidenceLevel =
    minConf >= 0.85 ? "high" : minConf >= 0.6 ? "medium" : "low"

  const sourceIds = Array.from(
    new Set(breakdown.map((b) => b.sourceId).filter((s): s is string => !!s)),
  )

  return {
    cardId,
    rewardValueHkd: totalHkd,
    breakdown,
    confidence,
    confidenceScore: minConf,
    caveats: [],
    sourceIds,
  }
}
