import type { TransactionContext } from "@/lib/schemas/transaction"
import type { ResolvedCap, ResolvedRule } from "./resolved-rule"
import { applyFormula } from "./apply-formula"

// PRD §8.2 step 6 (single-rule subset).
// Returns reward units for this rule given current cap usage.
// Caller is responsible for the period semantics — capUsage[key] is the
// already-accrued amount within the current cap period.

export type CapUsage = Record<string, number>

type ApplyResult = {
  rewardUnits: number
  // The portion of spend (in HKD) that was eligible under the cap.
  // Useful for the caller to update its capUsage for downstream rules.
  eligibleSpendHkd: number
  capRemainingAfter: number | null
}

export function applyRuleWithCap(
  rule: ResolvedRule,
  txn: TransactionContext,
  capUsage: CapUsage,
): ApplyResult {
  if (rule.cap === null) {
    const rewardUnits = applyFormula(rule.formula, txn)
    return {
      rewardUnits,
      eligibleSpendHkd: txn.amountHkd,
      capRemainingAfter: null,
    }
  }

  switch (rule.cap.basis) {
    case "spending":
      return applySpendingCap(rule.cap, rule, txn, capUsage)
    case "reward":
    case "transaction_count":
      // Not used by any M2 rule. Wired up in M3+ as adversarial cards arrive.
      throw new Error(
        `cap.basis=${rule.cap.basis} not implemented yet (M2 supports 'spending' only)`,
      )
  }
}

function applySpendingCap(
  cap: ResolvedCap,
  rule: ResolvedRule,
  txn: TransactionContext,
  capUsage: CapUsage,
): ApplyResult {
  if (cap.amountHkd === null) {
    throw new Error(
      `cap.basis='spending' requires cap.amountHkd on rule ${rule.ruleId}`,
    )
  }
  const used = capUsage[cap.usageKey] ?? 0
  const remaining = Math.max(0, cap.amountHkd - used)

  if (remaining === 0) {
    return { rewardUnits: 0, eligibleSpendHkd: 0, capRemainingAfter: 0 }
  }

  const eligibleSpend = Math.min(txn.amountHkd, remaining)
  const rewardUnits = applyFormula(rule.formula, {
    ...txn,
    amountHkd: eligibleSpend,
  })

  return {
    rewardUnits,
    eligibleSpendHkd: eligibleSpend,
    capRemainingAfter: remaining - eligibleSpend,
  }
}
