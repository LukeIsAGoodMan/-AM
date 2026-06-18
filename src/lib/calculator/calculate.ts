import type { TransactionContext } from "@/lib/schemas/transaction"
import type {
  ConfidenceLevel,
  RewardBreakdownItem,
  RewardResult,
} from "@/lib/schemas/result"
import type { ResolvedCandidate, ResolvedRule } from "./resolved-rule"
import { matches } from "./matches"
import { applyRuleWithCap, type CapUsage } from "./apply-cap"
import { applyExclusions } from "./exclusions"
import { resolveStacking } from "./stacking"

// PRD §8.2 — pure calculator. M7 scope:
//   ✅ step 1  (merchant resolver — caller resolves first, passes
//              categorySlug + categoryResolutionConfidence on txn)
//   ✅ step 2  (filter approved; date range arrives in M5)
//   ✅ step 3  (matches: category / online / overseas / fx)
//   ✅ step 3b (M3 — activation/registration gate)
//   ✅ step 4  (exclusions disable other matched candidates)
//   ✅ step 5  (stacking groups + policy)
//   ✅ step 6  (single-rule cap, spending basis)
//   ✅ step 6b (M3 — tiered formula accrual passthrough)
//   ✅ step 7  (HKD conversion)
//   ✅ step 8  (confidence — folds in category resolution confidence)

export type UserCardContext = {
  cardId: string
  selectedCategorySlugs?: string[]
  activatedCampaignIds?: string[]
  activatedRuleIds?: string[]
  capUsage?: CapUsage
}

export function calculate(
  cardId: string,
  rules: ResolvedRule[],
  txn: TransactionContext,
  userContext?: UserCardContext,
): RewardResult {
  const capUsage = userContext?.capUsage ?? {}
  const activatedRuleIds = new Set(userContext?.activatedRuleIds ?? [])

  // Step 2 + 3 + 3b: gather candidates that match the txn and pass activation gates.
  const matched = rules.filter((r) => {
    if (r.status !== "approved") return false
    if (!matches(r, txn)) return false
    if (r.requiresActivation || r.requiresRegistration) {
      if (!activatedRuleIds.has(r.ruleId)) return false
    }
    return true
  })

  // Step 4: exclusion pass strips bonuses whose rule_type is in an exclusion's applies_to.
  // Exclusion rules themselves are removed before computing rewards.
  const surviving = applyExclusions(matched)

  // Step 6 + 6b + 7: compute reward for each surviving candidate.
  const candidates: ResolvedCandidate[] = []
  for (const rule of surviving) {
    const { rewardUnits } = applyRuleWithCap(rule, txn, capUsage)
    if (rewardUnits === 0) continue
    const rewardHkd = rewardUnits * rule.rewardCurrencyValueHkd
    candidates.push({ rule, rewardUnits, rewardHkd })
  }

  // Step 5: resolve stacking groups.
  const selected = resolveStacking(candidates)

  // Step 8: aggregate.
  const breakdown: RewardBreakdownItem[] = selected.map((c) => ({
    ruleId: c.rule.ruleId,
    ruleName: c.rule.ruleName,
    ruleType: c.rule.ruleType,
    rewardCurrencySlug: c.rule.rewardCurrencySlug,
    rewardUnits: c.rewardUnits,
    rewardHkd: c.rewardHkd,
    sourceId: c.rule.sourceId,
    confidenceScore: c.rule.confidenceScore,
  }))

  const totalHkd = breakdown.reduce((sum, b) => sum + b.rewardHkd, 0)

  const ruleMinConf =
    breakdown.length === 0
      ? 1.0
      : Math.min(...breakdown.map((b) => b.confidenceScore))
  const categoryConf = txn.categoryResolutionConfidence ?? 1.0
  const minConf = Math.min(ruleMinConf, categoryConf)
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
