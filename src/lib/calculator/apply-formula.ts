import type { RewardFormula } from "@/lib/schemas/formula"
import type { TransactionContext } from "@/lib/schemas/transaction"

// Returns reward units in the rule's reward currency (NOT yet converted to HKD).
//
// `accrualUsedHkd` is the amount the user has already spent under this rule's
// accrual key in the current accrual period. Tiered formulas use it to know
// which tier brackets the new spend lands in. Non-tiered formulas ignore it.
//
// Cross-period reset is the caller's responsibility — when the period rolls
// over, the caller passes accrualUsedHkd=0 again.

export function applyFormula(
  formula: RewardFormula,
  txn: TransactionContext,
  accrualUsedHkd = 0,
): number {
  switch (formula.type) {
    case "simple_percent":
      return txn.amountHkd * formula.rate
    case "tiered_percent":
      return applyTieredPercent(formula.tiers, txn.amountHkd, accrualUsedHkd)
    case "tiered_points":
      return applyTieredPoints(formula.tiers, txn.amountHkd, accrualUsedHkd)
  }
}

type PercentTier = {
  minAmountHkd: number
  maxAmountHkd: number | null
  rate: number
}

type PointsTier = {
  minAmountHkd: number
  maxAmountHkd: number | null
  points: number
  perHkd: number
}

// Walk the tiers in order. For each tier, figure out how much of the
// transaction's spend lands inside that bracket (given how much has already
// been accrued) and multiply by the tier rate.
function applyTieredPercent(
  tiers: PercentTier[],
  amountHkd: number,
  accrualUsedHkd: number,
): number {
  let reward = 0
  let cursor = accrualUsedHkd
  let remaining = amountHkd

  for (const tier of tiers) {
    if (remaining <= 0) break
    const tierTop = tier.maxAmountHkd ?? Number.POSITIVE_INFINITY
    if (cursor >= tierTop) continue
    const tierStart = Math.max(cursor, tier.minAmountHkd)
    const spendInTier = Math.min(remaining, tierTop - tierStart)
    if (spendInTier <= 0) continue
    reward += spendInTier * tier.rate
    remaining -= spendInTier
    cursor = tierStart + spendInTier
  }

  return reward
}

function applyTieredPoints(
  tiers: PointsTier[],
  amountHkd: number,
  accrualUsedHkd: number,
): number {
  let reward = 0
  let cursor = accrualUsedHkd
  let remaining = amountHkd

  for (const tier of tiers) {
    if (remaining <= 0) break
    const tierTop = tier.maxAmountHkd ?? Number.POSITIVE_INFINITY
    if (cursor >= tierTop) continue
    const tierStart = Math.max(cursor, tier.minAmountHkd)
    const spendInTier = Math.min(remaining, tierTop - tierStart)
    if (spendInTier <= 0) continue
    reward += (spendInTier / tier.perHkd) * tier.points
    remaining -= spendInTier
    cursor = tierStart + spendInTier
  }

  return reward
}
