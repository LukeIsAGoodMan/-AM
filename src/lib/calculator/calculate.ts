import type { TransactionContext } from "@/lib/schemas/transaction"
import type {
  ConfidenceLevel,
  RewardBreakdownItem,
  RewardResult,
} from "@/lib/schemas/result"
import type { ResolvedRule } from "./resolved-rule"
import { applyFormula } from "./apply-formula"

// Pure calculator: takes already-resolved rules + a transaction, returns reward.
// No DB access. The DB-loading wrapper lives separately (added M2+).
//
// M1 scope (PRD §8.2):
//   - Steps 1 (merchant resolve), 4 (exclusion), 5 (stacking), 6 (cap) are NOT yet implemented.
//   - Only step 2 (filter approved), 3 (apply formula), 7 (HKD conversion),
//     8 (confidence) are active.
//   - All approved rules are simply additive in M1; matching, stacking,
//     exclusions arrive in M2–M4.

export function calculate(
  cardId: string,
  rules: ResolvedRule[],
  txn: TransactionContext,
): RewardResult {
  const approved = rules.filter((r) => r.status === "approved")

  const breakdown: RewardBreakdownItem[] = []
  let totalHkd = 0

  for (const rule of approved) {
    const rewardUnits = applyFormula(rule.formula, txn)
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
