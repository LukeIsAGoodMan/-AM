import type { TransactionContext } from "@/lib/schemas/transaction"
import type { ResolvedRule } from "./resolved-rule"
import { applyFormula } from "./apply-formula"

// PRD §8.2 step 6 (single-rule subset) + accrual feed for tiered formulas.
//
// Two responsibilities here:
//   1. Hard cap: if rule.cap is set with basis='spending' and amountHkd,
//      limit eligible spend to what's left under the cap.
//   2. Accrual passthrough: tiered formulas need to know how much has
//      already been accumulated in the current period under rule.accrualKey.

export type CapUsage = Record<string, number>

type ApplyResult = {
  rewardUnits: number
  eligibleSpendHkd: number
  capRemainingAfter: number | null
}

export function applyRuleWithCap(
  rule: ResolvedRule,
  txn: TransactionContext,
  capUsage: CapUsage,
): ApplyResult {
  const accrualUsedHkd = capUsage[rule.accrualKey] ?? 0

  let eligibleSpend = txn.amountHkd
  let capRemainingAfter: number | null = null

  if (rule.cap !== null) {
    switch (rule.cap.basis) {
      case "spending": {
        if (rule.cap.amountHkd === null) break
        const used = capUsage[rule.cap.usageKey] ?? 0
        const remaining = Math.max(0, rule.cap.amountHkd - used)
        if (remaining === 0) {
          return { rewardUnits: 0, eligibleSpendHkd: 0, capRemainingAfter: 0 }
        }
        eligibleSpend = Math.min(eligibleSpend, remaining)
        capRemainingAfter = remaining - eligibleSpend
        break
      }
      case "reward":
      case "transaction_count":
        // Not used by any M3 rule. Wired up in M4+ as adversarial cards arrive.
        throw new Error(
          `cap.basis=${rule.cap.basis} not implemented yet (M3 supports 'spending' only)`,
        )
    }
  }

  const rewardUnits = applyFormula(
    rule.formula,
    { ...txn, amountHkd: eligibleSpend },
    accrualUsedHkd,
  )

  return { rewardUnits, eligibleSpendHkd: eligibleSpend, capRemainingAfter }
}
