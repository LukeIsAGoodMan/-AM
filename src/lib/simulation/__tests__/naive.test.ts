import { describe, it, expect } from "vitest"
import { NaiveSimulationEngine } from "@/lib/simulation/naive"
import type { ResolvedRule } from "@/lib/calculator/resolved-rule"

// HSBC Red shape — mirrors data/cards/hsbc-red.yaml (M2 + M10):
//   base_earn: 0.4% on everything
//   online_local 4% bonus, cap HKD 100k/yr spending, isOnline=true,
//     isOverseas=false
//   (campaign rule skipped — these tests don't activate it)

const ASIA_MILE_HKD = 0.1
void ASIA_MILE_HKD

const baseRule = (
  o: Partial<ResolvedRule> & Pick<ResolvedRule, "ruleId" | "formula">,
): ResolvedRule => ({
  ruleName: o.ruleId,
  ruleType: "base_earn",
  status: "approved",
  rewardCurrencySlug: "hkd_cashback",
  rewardCurrencyValueHkd: 1.0,
  categorySlug: null,
  isOnline: null,
  isOverseas: null,
  isForeignCurrency: null,
  requiresActivation: false,
  requiresRegistration: false,
  requiresSelectedCategory: false,
  campaignId: null,
  accrualKey: o.ruleId,
  cap: null,
  appliesTo: null,
  stackingPolicy: "additive",
  exclusiveGroup: null,
  priority: 100,
  sourceId: "stub-source",
  confidenceScore: 0.9,
  ...o,
})

const hsbcRedRules: ResolvedRule[] = [
  baseRule({
    ruleId: "hsbc-red__base_earn",
    ruleType: "base_earn",
    formula: { type: "simple_percent", rate: 0.004 },
  }),
  baseRule({
    ruleId: "hsbc-red__online_local_bonus",
    ruleType: "online_bonus",
    formula: { type: "simple_percent", rate: 0.04 },
    categorySlug: "online_local",
    isOnline: true,
    isOverseas: false,
    cap: {
      usageKey: "hsbc-red__online_local_bonus",
      basis: "spending",
      period: "year",
      amountHkd: 100000,
      rewardAmount: null,
    },
    priority: 80,
  }),
]

const hsbcRedWelcome = {
  offerId: "hsbc-red__welcome_2026",
  offerName: "HSBC Red welcome HK$300",
  estimatedValueHkd: 300,
}

describe("NaiveSimulationEngine — HSBC Red projection", () => {
  const sim = new NaiveSimulationEngine()

  it("3000/mo online × 12, no welcome → 12 × (3000×0.4% + 3000×4%) = 1584", async () => {
    const res = await sim.project({
      cardId: "hsbc-red",
      rules: hsbcRedRules,
      welcomeOffers: [hsbcRedWelcome],
      profile: { monthlyByCategory: { online_local: 3000 } },
      monthsAhead: 12,
      includeWelcomeOffer: false,
      startDate: "2026-01-01",
    })
    expect(res.totalRewardValueHkd).toBeCloseTo(1584)
    expect(res.welcomeOfferContributionHkd).toBe(0)
    expect(res.perMonthHkd).toHaveLength(12)
    for (const m of res.perMonthHkd) expect(m).toBeCloseTo(132)
  })

  it("3000/mo online × 12 + welcome offer → 1584 + 300 = 1884", async () => {
    const res = await sim.project({
      cardId: "hsbc-red",
      rules: hsbcRedRules,
      welcomeOffers: [hsbcRedWelcome],
      profile: { monthlyByCategory: { online_local: 3000 } },
      monthsAhead: 12,
      includeWelcomeOffer: true,
      startDate: "2026-01-01",
    })
    expect(res.totalRewardValueHkd).toBeCloseTo(1884)
    expect(res.welcomeOfferContributionHkd).toBe(300)
  })

  it("multi-category: 5000 dining + 3000 online → monthly 152, 12mo=1824 (no welcome)", async () => {
    // dining_local matches no HSBC Red bonus → base only: 5000 × 0.4% = 20
    // online_local matches online bonus + base: 3000 × 4.4% = 132
    const res = await sim.project({
      cardId: "hsbc-red",
      rules: hsbcRedRules,
      welcomeOffers: [],
      profile: {
        monthlyByCategory: { dining_local: 5000, online_local: 3000 },
      },
      monthsAhead: 12,
      includeWelcomeOffer: false,
      startDate: "2026-01-01",
    })
    expect(res.totalRewardValueHkd).toBeCloseTo(1824)
    for (const m of res.perMonthHkd) expect(m).toBeCloseTo(152)
  })

  it("cap rollover: 10000/mo online (120k/yr) hits 100k cap in year 1, resets year 2", async () => {
    // Year 1, monthly 10k:
    //   month i base earn: 10000 × 0.4% = 40 every month (no cap on base)
    //   online bonus: capped at 100k/yr eligible spend
    //     months 1..10 (10×10k=100k): full 4% = 400/mo → 4000 total
    //     month 11: cap fully consumed → 0 bonus
    //     month 12: 0 bonus
    //   Year 1 = 12×40 (base) + 4000 (bonus) = 480 + 4000 = 4480
    // Year 2 resets: same pattern → another 4480
    // 24 months total ≈ 8960
    //
    // BUT simulator advances cap by full txn (10000) each match — including
    // the month that the cap actually saturates in mid-stream. That's the
    // "conservative" known limit. Trace:
    //   month 1: cap_used 0→10000, bonus 400
    //   ...
    //   month 10: cap_used 90000→100000, bonus 400
    //   month 11: cap_used 100000 already → no bonus
    //   month 12: same → no bonus
    // Year 1 totals match the ideal case here (sim doesn't over-charge
    // because the cap boundary lines up cleanly with a whole-month txn).
    const res = await sim.project({
      cardId: "hsbc-red",
      rules: hsbcRedRules,
      welcomeOffers: [],
      profile: { monthlyByCategory: { online_local: 10000 } },
      monthsAhead: 24,
      includeWelcomeOffer: false,
      startDate: "2026-01-01",
    })
    expect(res.totalRewardValueHkd).toBeCloseTo(8960)
    expect(res.caveats[0]).toContain("Cap tracking is conservative")
  })

  it("0 spend → 0 reward, but welcome offer still pays if included", async () => {
    const res = await sim.project({
      cardId: "hsbc-red",
      rules: hsbcRedRules,
      welcomeOffers: [hsbcRedWelcome],
      profile: { monthlyByCategory: {} },
      monthsAhead: 12,
      includeWelcomeOffer: true,
      startDate: "2026-01-01",
    })
    expect(res.totalRewardValueHkd).toBe(300)
    expect(res.welcomeOfferContributionHkd).toBe(300)
    expect(res.perMonthHkd.every((m) => m === 0)).toBe(true)
  })
})

describe("NaiveSimulationEngine — overseas + FX heuristic", () => {
  const sim = new NaiveSimulationEngine()

  // Citi PremierMiles shape — base + FX bonus + tax exclusion (M4)
  const ASIA_MILE_HKD = 0.1
  const citiPmRules: ResolvedRule[] = [
    baseRule({
      ruleId: "citi-pm__base",
      ruleType: "base_earn",
      rewardCurrencySlug: "asia_miles",
      rewardCurrencyValueHkd: ASIA_MILE_HKD,
      formula: {
        type: "points_per_hkd",
        points: 1,
        perHkd: 8,
        currencySlug: "asia_miles",
      },
    }),
    baseRule({
      ruleId: "citi-pm__fx_bonus",
      ruleType: "foreign_currency_bonus",
      rewardCurrencySlug: "asia_miles",
      rewardCurrencyValueHkd: ASIA_MILE_HKD,
      formula: {
        type: "points_per_hkd",
        points: 1,
        perHkd: 8,
        currencySlug: "asia_miles",
      },
      isForeignCurrency: true,
      priority: 90,
    }),
  ]

  it("general_overseas → both base + FX fire (synthetic txn sets isForeignCurrency=true)", async () => {
    const res = await sim.project({
      cardId: "citi-premiermiles",
      rules: citiPmRules,
      welcomeOffers: [],
      profile: { monthlyByCategory: { general_overseas: 4000 } },
      monthsAhead: 1,
      includeWelcomeOffer: false,
      startDate: "2026-01-01",
    })
    // base: 4000/8 = 500 miles; FX: 4000/8 = 500; total 1000 miles × 0.10 = 100
    expect(res.totalRewardValueHkd).toBeCloseTo(100)
  })

  it("general_local → only base fires (no FX bonus on local)", async () => {
    const res = await sim.project({
      cardId: "citi-premiermiles",
      rules: citiPmRules,
      welcomeOffers: [],
      profile: { monthlyByCategory: { general_local: 4000 } },
      monthsAhead: 1,
      includeWelcomeOffer: false,
      startDate: "2026-01-01",
    })
    // 4000/8 = 500 miles × 0.10 = 50
    expect(res.totalRewardValueHkd).toBeCloseTo(50)
  })
})
