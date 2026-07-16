// Typed directional ratio normalization (§4B).
//
// HARD RULE: direction NEVER comes from numeric size. "if from >= to, assume
// from is spending" is invalid (§4B, §12). Direction comes only from explicit
// unit ROLES — which quantity is the spend/from and which is the reward/to.
//
// Two shapes, mirroring the spec's examples:
//   earn:    spend {6, HKD}  → reward {1, Asia Miles}     (HK$6 = 1 mile)
//   convert: from  {1500, MR} → to     {540, Asia Miles}  (1500 MR → 540 AM)
//
// Equivalent display forms ("HK$6 = 1 mile" vs "HK$12 = 2 miles") normalize
// to the same math representation ONLY when the unit roles match. A reversed
// pairing ("6 miles = HK$1") is a DIFFERENT ratio, never equal.

import { normalizeNumeric, numbersAgree } from "./numeric"

export interface UnitQuantity {
  amount: number
  currency: string // 'hkd' | 'asia_miles' | 'amex_membership_rewards' | ...
}

export interface EarnRatio {
  kind: "earn"
  spend: UnitQuantity
  reward: UnitQuantity
}

export interface ConvertRatio {
  kind: "convert"
  from: UnitQuantity
  to: UnitQuantity
}

export type TypedRatio = EarnRatio | ConvertRatio

function canonCurrency(c: string): string {
  return c.trim().toLowerCase().replace(/[\s-]+/g, "_")
}

// Reward units earned per ONE spend unit. Meaningful only given the roles —
// never derived from which number is larger.
export function rewardPerSpendUnit(r: EarnRatio): number {
  return r.reward.amount / r.spend.amount
}

// `to` units produced per ONE `from` unit.
export function toPerFromUnit(r: ConvertRatio): number {
  return r.to.amount / r.from.amount
}

// Build an EarnRatio from a points_per_hkd reward payload. perHkd is the
// SPEND side (HKD), points is the REWARD side — the roles are fixed by the
// field names, not by comparing 6 vs 1.
export function earnRatioFromPointsPerHkd(
  payload: Record<string, unknown>,
): EarnRatio | null {
  const points = normalizeNumeric(payload["points"])
  const perHkd = normalizeNumeric(payload["perHkd"])
  const currency = payload["currencySlug"]
  if (points == null || perHkd == null || perHkd <= 0) return null
  if (typeof currency !== "string" || currency.trim() === "") return null
  return {
    kind: "earn",
    spend: { amount: perHkd, currency: "hkd" },
    reward: { amount: points, currency: canonCurrency(currency) },
  }
}

// Build an EarnRatio from a simple_percent payload: spend HK$1 → earn `rate`
// HKD cashback. Lets a cashback rule and a points rule be compared on the
// SAME typed footing (both spend HKD) while keeping their reward currencies
// distinct — so they never collapse together (§3A: 1.2% cashback vs HK$6=1
// mile must not co-group).
export function earnRatioFromSimplePercent(
  payload: Record<string, unknown>,
): EarnRatio | null {
  const rate = normalizeNumeric(payload["rate"])
  if (rate == null) return null
  return {
    kind: "earn",
    spend: { amount: 1, currency: "hkd" },
    reward: { amount: rate, currency: "hkd_cashback" },
  }
}

// Two earn ratios are equivalent iff their unit ROLES match (same spend
// currency AND same reward currency) and the reward-per-spend-unit agrees
// within numeric tolerance. Role mismatch ⇒ never equal, regardless of the
// numbers.
export function earnRatiosEquivalent(a: EarnRatio, b: EarnRatio): boolean {
  if (canonCurrency(a.spend.currency) !== canonCurrency(b.spend.currency)) {
    return false
  }
  if (canonCurrency(a.reward.currency) !== canonCurrency(b.reward.currency)) {
    return false
  }
  return numbersAgree(rewardPerSpendUnit(a), rewardPerSpendUnit(b))
}

export function convertRatiosEquivalent(
  a: ConvertRatio,
  b: ConvertRatio,
): boolean {
  if (canonCurrency(a.from.currency) !== canonCurrency(b.from.currency)) {
    return false
  }
  if (canonCurrency(a.to.currency) !== canonCurrency(b.to.currency)) {
    return false
  }
  return numbersAgree(toPerFromUnit(a), toPerFromUnit(b))
}

// Human-readable canonical form for audit output.
export function describeRatio(r: TypedRatio): string {
  if (r.kind === "earn") {
    return `${r.spend.amount} ${r.spend.currency} → ${r.reward.amount} ${r.reward.currency}`
  }
  return `${r.from.amount} ${r.from.currency} → ${r.to.amount} ${r.to.currency}`
}
