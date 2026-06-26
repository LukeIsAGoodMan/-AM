import { calculate, type UserCardContext } from "@/lib/calculator/calculate"
import type { CapUsage } from "@/lib/calculator/apply-cap"
import type { ResolvedRule } from "@/lib/calculator/resolved-rule"
import type { TransactionContext } from "@/lib/schemas/transaction"
import type {
  ProjectionInputs,
  Projection,
  SimulationEngine,
} from "./types"

// Naive impl per PRD §13. For each month in the horizon:
//   1. Detect period boundaries; reset capUsage for rules whose cap.period
//      has rolled over.
//   2. Build ONE synthetic transaction per category in the spending profile.
//   3. Run the calculator with the current cumulative capUsage.
//   4. Advance capUsage by the txn.amountHkd for any rule with a cap (over-
//      conservative — eligible spend would be more accurate but isn't exposed
//      from calculate() yet).
// Welcome offers contribute estimatedValueHkd once when includeWelcomeOffer.
//
// Calculator reads capUsage[rule.cap.usageKey] and capUsage[rule.accrualKey]
// directly. The simulator keeps those keys "current" — meaning the value
// reflects spend within the rule's current accrual period — by zeroing at
// period boundaries.
//
// Known limitations (see also docs/known-limits.md when M17 lands):
//   - One synthetic txn per category per month is coarse. Real spend is
//     many small txns; for tiered formulas a single chunky txn over-pulls
//     into the next tier.
//   - capUsage advances by full txn.amountHkd, not eligible spend. Over-
//     reports cap consumption when some spend was excluded — conservative.
//   - fxShare splits per-category (uniform), not per-txn.

export class NaiveSimulationEngine implements SimulationEngine {
  async project(input: ProjectionInputs): Promise<Projection> {
    return this.projectSync(input)
  }

  // Sync entry point. The interface stays async (Phase 2 may add IO), but
  // this naive impl has none. Useful for in-render computation in the
  // /projection-test page where useMemo can't await.
  projectSync(input: ProjectionInputs): Projection {
    const startDate = parseIso(input.startDate)
    // Per-rule period token that was current the last time we advanced
    // capUsage. When the next month's token differs, reset the key.
    const lastPeriodToken = new Map<string, string>()
    const capUsage: CapUsage = { ...(input.userContext?.capUsage ?? {}) }
    const perMonthHkd: number[] = []

    for (let m = 0; m < input.monthsAhead; m++) {
      const date = addMonths(startDate, m)
      const dateIso = date.toISOString().slice(0, 10)

      // Step 1: reset any cap keys whose period has rolled over.
      for (const rule of input.rules) {
        if (rule.cap?.basis !== "spending" || rule.cap.amountHkd === null)
          continue
        const token = periodToken(rule.cap.period, date)
        const prev = lastPeriodToken.get(rule.cap.usageKey)
        if (prev !== token) {
          capUsage[rule.cap.usageKey] = 0
          lastPeriodToken.set(rule.cap.usageKey, token)
        }
      }
      // Same for tiered accrual keys (they reset based on the formula's
      // accrualPeriod, not the rule's cap.period).
      for (const rule of input.rules) {
        const accrualPeriod = accrualPeriodOf(rule)
        if (accrualPeriod === null) continue
        const token = periodToken(accrualPeriod, date)
        const k = `__accrual::${rule.accrualKey}`
        const prev = lastPeriodToken.get(k)
        if (prev !== token) {
          capUsage[rule.accrualKey] = 0
          lastPeriodToken.set(k, token)
        }
      }

      // Step 2 + 3: run calculator per category in profile.
      let monthReward = 0
      for (const [categorySlug, monthlyAmount] of Object.entries(
        input.profile.monthlyByCategory,
      )) {
        if (monthlyAmount <= 0) continue
        const txn = buildSyntheticTxn(categorySlug, monthlyAmount, dateIso)
        const userCtx: UserCardContext = {
          cardId: input.cardId,
          ...(input.userContext ?? {}),
          capUsage,
        }
        const res = calculate(input.cardId, input.rules, txn, userCtx)
        monthReward += res.rewardValueHkd

        // Step 4: advance caps for rules with hard cap or tier accrual.
        // Even rules that didn't contribute to *this* txn's reward may
        // still have had their accrual touched (if their conditions matched
        // and they consumed cap budget). To keep things tractable, advance
        // for any rule whose conditions match the txn (not just those in
        // breakdown).
        for (const rule of input.rules) {
          if (rule.status !== "approved") continue
          if (!ruleMatchesForCap(rule, txn)) continue
          if (rule.cap?.basis === "spending" && rule.cap.amountHkd !== null) {
            capUsage[rule.cap.usageKey] =
              (capUsage[rule.cap.usageKey] ?? 0) + txn.amountHkd
          }
          if (accrualPeriodOf(rule) !== null) {
            capUsage[rule.accrualKey] =
              (capUsage[rule.accrualKey] ?? 0) + txn.amountHkd
          }
        }
      }

      perMonthHkd.push(round2(monthReward))
    }

    const welcomeContribution = input.includeWelcomeOffer
      ? input.welcomeOffers.reduce((sum, w) => sum + w.estimatedValueHkd, 0)
      : 0

    const totalOngoing = perMonthHkd.reduce((s, v) => s + v, 0)
    const total = round2(totalOngoing + welcomeContribution)

    const caveats: string[] = []
    if (input.rules.some((r) => r.cap !== null)) {
      caveats.push(
        "Cap tracking is conservative — actual rewards may be slightly higher.",
      )
    }
    if (input.profile.fxShare !== undefined && input.profile.fxShare > 0) {
      caveats.push(
        "fxShare applied uniformly per category; real FX spend is uneven.",
      )
    }

    return {
      cardId: input.cardId,
      totalRewardValueHkd: total,
      perMonthHkd,
      welcomeOfferContributionHkd: round2(welcomeContribution),
      caveats,
    }
  }
}

// Cheap re-implementation of matches() that only looks at conditions; lets us
// advance cap state for rules whose stack survives exclusion in the real run
// without re-deriving from the breakdown.
function ruleMatchesForCap(
  rule: ResolvedRule,
  txn: TransactionContext,
): boolean {
  if (rule.categorySlug !== null && txn.categorySlug !== rule.categorySlug)
    return false
  if (rule.isOnline !== null && txn.isOnline !== rule.isOnline) return false
  if (rule.isOverseas !== null) {
    const overseas =
      txn.countryRegion !== undefined && txn.countryRegion !== "UNKNOWN"
        ? txn.countryRegion !== "HK"
        : undefined
    if (overseas !== rule.isOverseas) return false
  }
  if (
    rule.isForeignCurrency !== null &&
    txn.isForeignCurrency !== rule.isForeignCurrency
  )
    return false
  return true
}

function accrualPeriodOf(rule: ResolvedRule): string | null {
  if (
    rule.formula.type === "tiered_percent" ||
    rule.formula.type === "tiered_points"
  ) {
    return rule.formula.accrualPeriod
  }
  return null
}

function buildSyntheticTxn(
  categorySlug: string,
  amountHkd: number,
  transactionDate: string,
): TransactionContext {
  const isOnline =
    categorySlug.includes("online") || categorySlug === "streaming_subscription"
  const isOverseas =
    categorySlug.includes("overseas") ||
    categorySlug === "mainland_china" ||
    categorySlug === "macau"
  const isForeignCurrency =
    categorySlug.includes("overseas_fx") ||
    categorySlug === "general_overseas" ||
    categorySlug === "online_overseas" ||
    categorySlug === "dining_overseas"

  const countryRegion =
    categorySlug === "mainland_china"
      ? ("MAINLAND_CHINA" as const)
      : categorySlug === "macau"
        ? ("MACAU" as const)
        : isOverseas
          ? ("OVERSEAS" as const)
          : ("HK" as const)

  // isOverseas is derived from countryRegion by the calculator (matches.ts).
  // We only set what TransactionContext actually carries.
  void isOverseas
  return {
    amountHkd,
    categorySlug,
    transactionDate,
    isOnline,
    isForeignCurrency,
    countryRegion,
  }
}

function periodToken(period: string, date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  switch (period) {
    case "month":
      return `${y}-${m}`
    case "quarter":
      return `${y}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`
    case "year":
      return `${y}`
    default:
      // transaction / day / campaign / none — never rolls over in M11 sim
      return "FOREVER"
  }
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCMonth(r.getUTCMonth() + n)
  return r
}

function parseIso(s: string): Date {
  const d = new Date(s + "T00:00:00.000Z")
  if (Number.isNaN(d.valueOf())) throw new Error(`invalid ISO date: ${s}`)
  return d
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
