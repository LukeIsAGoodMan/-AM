import type { TransactionContext } from "@/lib/schemas/transaction"
import type { ResolvedCap, ResolvedRule } from "./resolved-rule"
import { applyFormula } from "./apply-formula"

// PRD §8.2 step 6 + accrual feed for tiered formulas.
//
// P17 (D23): rule.caps is an array. Every cap on the rule must be
// respected — for spending caps, the tightest remaining budget wins; for
// reward caps, the tightest remaining reward budget wins. When mixed,
// spending caps constrain eligible spend BEFORE applyFormula runs;
// reward caps clip the resulting reward AFTER.

export type CapUsage = Record<string, number>

type ApplyResult = {
  rewardUnits: number
  eligibleSpendHkd: number
  // Kept for backward compat with M6 caveats + explainer output.
  // Reflects the tightest spending-cap remaining (or the tightest
  // reward-cap remaining if no spending caps apply). null if no caps.
  capRemainingAfter: number | null
}

export function applyRuleWithCap(
  rule: ResolvedRule,
  txn: TransactionContext,
  capUsage: CapUsage,
): ApplyResult {
  const accrualUsedHkd = capUsage[rule.accrualKey] ?? 0

  let eligibleSpend = txn.amountHkd
  let tightestSpendingRemaining: number | null = null

  // Pass 1: apply every spending-basis cap. Each shrinks the eligible spend.
  for (const cap of rule.caps) {
    if (cap.basis !== "spending") continue
    if (cap.amountHkd === null) continue
    const used = capUsage[cap.usageKey] ?? 0
    const remaining = Math.max(0, cap.amountHkd - used)
    if (remaining === 0) {
      // Any spending cap fully consumed → zero reward from this rule.
      return { rewardUnits: 0, eligibleSpendHkd: 0, capRemainingAfter: 0 }
    }
    if (remaining < eligibleSpend) eligibleSpend = remaining
    if (tightestSpendingRemaining === null || remaining < tightestSpendingRemaining) {
      tightestSpendingRemaining = remaining
    }
  }

  // Compute reward with the (possibly clipped) eligible spend.
  let rewardUnits = applyFormula(
    rule.formula,
    { ...txn, amountHkd: eligibleSpend },
    accrualUsedHkd,
  )

  // Pass 2: apply every reward-basis cap. Each caps total reward this txn.
  let tightestRewardRemaining: number | null = null
  for (const cap of rule.caps) {
    if (cap.basis !== "reward") continue
    if (cap.rewardAmount === null) continue
    const used = capUsage[cap.usageKey] ?? 0
    const remaining = Math.max(0, cap.rewardAmount - used)
    if (remaining === 0) {
      return { rewardUnits: 0, eligibleSpendHkd: eligibleSpend, capRemainingAfter: 0 }
    }
    if (remaining < rewardUnits) rewardUnits = remaining
    if (tightestRewardRemaining === null || remaining < tightestRewardRemaining) {
      tightestRewardRemaining = remaining
    }
  }

  // transaction_count-basis is unused; refuse rather than silently ignore.
  for (const cap of rule.caps) {
    if (cap.basis === "transaction_count") {
      throw new Error(`cap.basis=${cap.basis} not implemented yet`)
    }
  }

  // Reporting priority: spending-cap remaining (existing UI expectation)
  // then reward-cap remaining, else null. Keeps M6 caveats stable.
  const capRemainingAfter =
    tightestSpendingRemaining !== null
      ? Math.max(0, tightestSpendingRemaining - eligibleSpend)
      : tightestRewardRemaining !== null
        ? Math.max(0, tightestRewardRemaining - rewardUnits)
        : null

  return { rewardUnits, eligibleSpendHkd: eligibleSpend, capRemainingAfter }
}

// Convenience: pick the "primary" cap for legacy per-rule display (M6
// caveats, /rules provenance card). Returns the first spending cap, or
// the first reward cap, or null. Callers that need all caps read
// `rule.caps` directly.
export function primaryCap(caps: ResolvedCap[]): ResolvedCap | null {
  const spending = caps.find((c) => c.basis === "spending")
  if (spending) return spending
  const reward = caps.find((c) => c.basis === "reward")
  if (reward) return reward
  return caps[0] ?? null
}
