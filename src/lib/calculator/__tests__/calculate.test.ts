import { describe, it, expect } from "vitest"
import { calculate } from "@/lib/calculator/calculate"
import type { ResolvedRule } from "@/lib/calculator/resolved-rule"
import type { TransactionContext } from "@/lib/schemas/transaction"
import { HardcodedMerchantResolver } from "@/lib/resolver/hardcoded"

// Test fixtures kept inline. As cards grow we'll extract to /test-fixtures.

const baseRule = (
  overrides: Partial<ResolvedRule> & Pick<ResolvedRule, "ruleId" | "formula">,
): ResolvedRule => ({
  ruleName: overrides.ruleId,
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
  campaignId: null,
  accrualKey: overrides.ruleId,
  cap: null,
  appliesTo: null,
  stackingPolicy: "additive",
  exclusiveGroup: null,
  priority: 100,
  sourceId: "stub-source-id",
  confidenceScore: 0.9,
  ...overrides,
})

const txn = (overrides: Partial<TransactionContext> = {}): TransactionContext => ({
  amountHkd: 0,
  transactionDate: "2026-06-17",
  ...overrides,
})

// ---------- M1: simple_percent + status filtering ----------

describe("calculate — M1 simple_percent", () => {
  const citiBase = baseRule({
    ruleId: "citi-cash-back__base_earn",
    ruleName: "Citi Cash Back base earn",
    formula: { type: "simple_percent", rate: 0.012 },
  })

  it("HKD 1000 spend → 12 HKD reward (1.2%)", () => {
    const res = calculate("citi-cash-back", [citiBase], txn({ amountHkd: 1000 }))
    expect(res.rewardValueHkd).toBe(12)
    expect(res.breakdown).toHaveLength(1)
    expect(res.confidence).toBe("high")
    expect(res.sourceIds).toEqual(["stub-source-id"])
  })

  it("HKD 500 spend → 6 HKD reward", () => {
    const res = calculate("citi-cash-back", [citiBase], txn({ amountHkd: 500 }))
    expect(res.rewardValueHkd).toBe(6)
  })

  it("HKD 0 spend → 0 HKD reward, no breakdown entry", () => {
    // M2 change: rewardUnits=0 entries are now suppressed from breakdown
    // (matches behave: don't show rules that contributed nothing).
    const res = calculate("citi-cash-back", [citiBase], txn({ amountHkd: 0 }))
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
  })

  it("draft rules are ignored", () => {
    const draft: ResolvedRule = { ...citiBase, status: "draft" }
    const res = calculate("citi-cash-back", [draft], txn({ amountHkd: 1000 }))
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
  })

  it("no rules → 0 reward, empty sources", () => {
    const res = calculate("citi-cash-back", [], txn({ amountHkd: 1000 }))
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
    expect(res.sourceIds).toEqual([])
  })
})

// ---------- M2: category + online matching ----------

describe("calculate — M2 condition matching", () => {
  const hsbcRedBase = baseRule({
    ruleId: "hsbc-red__base_earn",
    ruleName: "HSBC Red base earn",
    formula: { type: "simple_percent", rate: 0.004 },
  })
  const hsbcRedOnline = baseRule({
    ruleId: "hsbc-red__online_local_bonus",
    ruleName: "HSBC Red online 4%",
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
  })
  const rules = [hsbcRedBase, hsbcRedOnline]

  it("HSBC Red online HKD 5000 → 200 HKD (4% bonus) + 20 HKD (0.4% base) = 220", () => {
    const res = calculate(
      "hsbc-red",
      rules,
      txn({
        amountHkd: 5000,
        categorySlug: "online_local",
        isOnline: true,
        countryRegion: "HK",
      }),
    )
    expect(res.rewardValueHkd).toBe(220)
    expect(res.breakdown).toHaveLength(2)
  })

  it("HSBC Red offline HKD 5000 → 20 HKD (only base earn matches)", () => {
    const res = calculate(
      "hsbc-red",
      rules,
      txn({
        amountHkd: 5000,
        categorySlug: "dining_local",
        isOnline: false,
        countryRegion: "HK",
      }),
    )
    expect(res.rewardValueHkd).toBe(20)
    expect(res.breakdown).toHaveLength(1)
    expect(res.breakdown[0]?.ruleType).toBe("base_earn")
  })

  it("HSBC Red online but txn.isOnline missing → bonus does NOT apply (no match)", () => {
    // Unknown txn.isOnline does NOT satisfy a rule that requires isOnline=true.
    // PRD principle: better to under-credit than over-credit.
    const res = calculate(
      "hsbc-red",
      rules,
      txn({ amountHkd: 5000, categorySlug: "online_local", countryRegion: "HK" }),
    )
    expect(res.rewardValueHkd).toBe(20)
    expect(res.breakdown).toHaveLength(1)
  })
})

// ---------- M2: single-rule spending cap ----------

describe("calculate — M2 spending cap", () => {
  const hsbcRedOnline = baseRule({
    ruleId: "hsbc-red__online_local_bonus",
    ruleName: "HSBC Red online 4%",
    ruleType: "online_bonus",
    formula: { type: "simple_percent", rate: 0.04 },
    categorySlug: "online_local",
    isOnline: true,
    cap: {
      usageKey: "hsbc-red__online_local_bonus",
      basis: "spending",
      period: "year",
      amountHkd: 100000,
      rewardAmount: null,
    },
  })

  it("under cap → full 4%", () => {
    const res = calculate(
      "hsbc-red",
      [hsbcRedOnline],
      txn({ amountHkd: 3000, categorySlug: "online_local", isOnline: true }),
      { cardId: "hsbc-red", capUsage: { "hsbc-red__online_local_bonus": 0 } },
    )
    expect(res.rewardValueHkd).toBe(120)
  })

  it("partially through cap → still full 4% (well within)", () => {
    const res = calculate(
      "hsbc-red",
      [hsbcRedOnline],
      txn({ amountHkd: 2000, categorySlug: "online_local", isOnline: true }),
      {
        cardId: "hsbc-red",
        capUsage: { "hsbc-red__online_local_bonus": 80000 }, // 20k remaining
      },
    )
    expect(res.rewardValueHkd).toBe(80) // 2000 × 4%
  })

  it("crosses cap boundary → only remaining eligible spend earns 4%", () => {
    // 95k already used, cap 100k, txn 10k
    // → only 5k eligible at 4% = 200 HKD
    const res = calculate(
      "hsbc-red",
      [hsbcRedOnline],
      txn({ amountHkd: 10000, categorySlug: "online_local", isOnline: true }),
      {
        cardId: "hsbc-red",
        capUsage: { "hsbc-red__online_local_bonus": 95000 },
      },
    )
    expect(res.rewardValueHkd).toBe(200)
  })

  it("cap fully consumed → no reward from this rule", () => {
    const res = calculate(
      "hsbc-red",
      [hsbcRedOnline],
      txn({ amountHkd: 1000, categorySlug: "online_local", isOnline: true }),
      {
        cardId: "hsbc-red",
        capUsage: { "hsbc-red__online_local_bonus": 100000 },
      },
    )
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
  })
})

// ---------- M3: tiered_percent with monthly accrual ----------

describe("calculate — M3 tiered_percent (Hang Seng MPOWER-style)", () => {
  const ruleId = "hang-seng-mpower__tiered_monthly"
  const mpower = baseRule({
    ruleId,
    ruleName: "MPOWER monthly tier",
    ruleType: "category_bonus",
    formula: {
      type: "tiered_percent",
      accrualPeriod: "month",
      tiers: [
        { minAmountHkd: 0, maxAmountHkd: 4000, rate: 0.004 },
        { minAmountHkd: 4000, maxAmountHkd: null, rate: 0.05 },
      ],
    },
    requiresRegistration: true,
  })

  const ctx = (accrual: number) => ({
    cardId: "hang-seng-mpower",
    activatedRuleIds: [ruleId],
    capUsage: { [ruleId]: accrual },
  })

  it("under tier-1 ceiling (accrual 0, spend 4000) → 16 HKD (all tier 1)", () => {
    const res = calculate(
      "hang-seng-mpower",
      [mpower],
      txn({ amountHkd: 4000 }),
      ctx(0),
    )
    expect(res.rewardValueHkd).toBe(16) // 4000 × 0.4%
  })

  it("entirely in tier 2 (accrual 4000, spend 4000) → 200 HKD", () => {
    const res = calculate(
      "hang-seng-mpower",
      [mpower],
      txn({ amountHkd: 4000 }),
      ctx(4000),
    )
    expect(res.rewardValueHkd).toBe(200) // 4000 × 5%
  })

  it("spans tier boundary (accrual 0, spend 8000) → 16 + 200 = 216 HKD", () => {
    const res = calculate(
      "hang-seng-mpower",
      [mpower],
      txn({ amountHkd: 8000 }),
      ctx(0),
    )
    expect(res.rewardValueHkd).toBe(216)
  })

  it("partial bridge across boundary (accrual 3500, spend 1000) → 2 + 25 = 27 HKD", () => {
    // 500 at tier-1 rate (0.4%) = 2; 500 at tier-2 rate (5%) = 25
    const res = calculate(
      "hang-seng-mpower",
      [mpower],
      txn({ amountHkd: 1000 }),
      ctx(3500),
    )
    expect(res.rewardValueHkd).toBe(27)
  })

  it("cross-month reset → 4000 spent this month starts at tier 1 again", () => {
    // Caller is responsible for resetting accrual at month boundary. We
    // simulate that by passing accrual=0 even though "last month" was 6000.
    const res = calculate(
      "hang-seng-mpower",
      [mpower],
      txn({ amountHkd: 4000 }),
      ctx(0),
    )
    expect(res.rewardValueHkd).toBe(16)
  })

  it("requires_registration: not in activatedRuleIds → 0 reward", () => {
    const res = calculate(
      "hang-seng-mpower",
      [mpower],
      txn({ amountHkd: 8000 }),
      { cardId: "hang-seng-mpower", capUsage: { [ruleId]: 0 } },
    )
    expect(res.rewardValueHkd).toBe(0)
    expect(res.breakdown).toHaveLength(0)
  })

  it("requires_registration: in activatedRuleIds → reward applies", () => {
    const res = calculate(
      "hang-seng-mpower",
      [mpower],
      txn({ amountHkd: 8000 }),
      ctx(0),
    )
    expect(res.rewardValueHkd).toBe(216)
  })

  it("requires_activation flag (semantic synonym) gates the same way", () => {
    const variant: ResolvedRule = {
      ...mpower,
      requiresActivation: true,
      requiresRegistration: false,
    }
    const denied = calculate("hang-seng-mpower", [variant], txn({ amountHkd: 4000 }), {
      cardId: "hang-seng-mpower",
      capUsage: { [ruleId]: 0 },
    })
    const allowed = calculate(
      "hang-seng-mpower",
      [variant],
      txn({ amountHkd: 4000 }),
      ctx(0),
    )
    expect(denied.rewardValueHkd).toBe(0)
    expect(allowed.rewardValueHkd).toBe(16)
  })
})

// ---------- M4: exclusion + stacking (Citi PremierMiles) ----------

describe("calculate — M4 exclusion + stacking", () => {
  // Asia Miles valued at HKD 0.10 per mile in M4 seed.
  const ASIA_MILE_HKD = 0.1

  const citiPmBase = baseRule({
    ruleId: "citi-premiermiles__base_earn",
    ruleName: "Citi PM base (HK$8 = 1 mile)",
    ruleType: "base_earn",
    rewardCurrencySlug: "asia_miles",
    rewardCurrencyValueHkd: ASIA_MILE_HKD,
    formula: {
      type: "points_per_hkd",
      points: 1,
      perHkd: 8,
      currencySlug: "asia_miles",
    },
    priority: 100,
  })

  const citiPmFxBonus = baseRule({
    ruleId: "citi-premiermiles__fx_bonus",
    ruleName: "Citi PM FX bonus (additive)",
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
  })

  const citiPmTaxExclusion = baseRule({
    ruleId: "citi-premiermiles__tax_exclusion",
    ruleName: "Tax/government — bonus excluded",
    ruleType: "exclusion",
    rewardCurrencySlug: "asia_miles",
    rewardCurrencyValueHkd: ASIA_MILE_HKD,
    formula: {
      type: "no_reward",
      reason: "Tax category does not earn bonus miles.",
    },
    categorySlug: "tax_government",
    appliesTo: [
      "category_bonus",
      "online_bonus",
      "overseas_bonus",
      "foreign_currency_bonus",
      "campaign_bonus",
      "merchant_bonus",
    ],
    priority: 50,
  })

  const rules = [citiPmBase, citiPmFxBonus, citiPmTaxExclusion]

  it("local HKD 1000 → base only (125 miles × 0.10 = 12.5 HKD)", () => {
    const res = calculate(
      "citi-premiermiles",
      rules,
      txn({
        amountHkd: 1000,
        categorySlug: "dining_local",
        countryRegion: "HK",
        isForeignCurrency: false,
      }),
    )
    expect(res.rewardValueHkd).toBeCloseTo(12.5)
    expect(res.breakdown).toHaveLength(1)
    expect(res.breakdown[0]?.ruleType).toBe("base_earn")
  })

  it("foreign currency HKD 4000 → base + FX bonus additive (1000 miles = 100 HKD)", () => {
    // base: 4000/8 = 500 miles; FX bonus: 4000/8 = 500 miles; total 1000 × 0.10 = 100
    const res = calculate(
      "citi-premiermiles",
      rules,
      txn({
        amountHkd: 4000,
        categorySlug: "general_overseas",
        countryRegion: "OVERSEAS",
        isForeignCurrency: true,
      }),
    )
    expect(res.rewardValueHkd).toBeCloseTo(100)
    expect(res.breakdown).toHaveLength(2)
    const types = res.breakdown.map((b) => b.ruleType).sort()
    expect(types).toEqual(["base_earn", "foreign_currency_bonus"])
  })

  it("★ PRD §8.4 — tax HKD 10000 → base earns, bonus excluded", () => {
    // Even with the tax exclusion matching (txn.categorySlug = tax_government),
    // base_earn is NOT in appliesTo, so it still earns 10000/8 = 1250 miles = 125 HKD.
    const res = calculate(
      "citi-premiermiles",
      rules,
      txn({
        amountHkd: 10000,
        categorySlug: "tax_government",
        countryRegion: "HK",
        isForeignCurrency: false,
      }),
    )
    expect(res.rewardValueHkd).toBeCloseTo(125)
    expect(res.breakdown).toHaveLength(1)
    expect(res.breakdown[0]?.ruleType).toBe("base_earn")
  })

  it("tax + foreign currency → base only (exclusion catches FX bonus too)", () => {
    // FX bonus rule_type is in appliesTo, so it gets disabled even though
    // isForeignCurrency=true matches. Base earn survives.
    const res = calculate(
      "citi-premiermiles",
      rules,
      txn({
        amountHkd: 8000,
        categorySlug: "tax_government",
        countryRegion: "OVERSEAS",
        isForeignCurrency: true,
      }),
    )
    expect(res.rewardValueHkd).toBeCloseTo(100) // 8000/8 = 1000 miles × 0.10
    expect(res.breakdown).toHaveLength(1)
    expect(res.breakdown[0]?.ruleType).toBe("base_earn")
  })

  it("exclusion rule itself never appears in breakdown", () => {
    const res = calculate(
      "citi-premiermiles",
      rules,
      txn({
        amountHkd: 5000,
        categorySlug: "tax_government",
        countryRegion: "HK",
      }),
    )
    expect(res.breakdown.find((b) => b.ruleType === "exclusion")).toBeUndefined()
  })
})

// ---------- M4: stacking policies ----------

describe("calculate — M4 stacking policies", () => {
  const base = baseRule({
    ruleId: "card__base",
    ruleType: "base_earn",
    formula: { type: "simple_percent", rate: 0.005 },
    priority: 100,
  })

  it("max_only_in_group: picks the highest reward in the group", () => {
    const groupA = baseRule({
      ruleId: "card__bonus_a",
      ruleType: "category_bonus",
      formula: { type: "simple_percent", rate: 0.03 },
      categorySlug: "online_local",
      stackingPolicy: "max_only_in_group",
      exclusiveGroup: "card__online_group",
      priority: 80,
    })
    const groupB = baseRule({
      ruleId: "card__bonus_b",
      ruleType: "online_bonus",
      formula: { type: "simple_percent", rate: 0.05 },
      categorySlug: "online_local",
      stackingPolicy: "max_only_in_group",
      exclusiveGroup: "card__online_group",
      priority: 80,
    })
    const res = calculate(
      "card",
      [base, groupA, groupB],
      txn({
        amountHkd: 1000,
        categorySlug: "online_local",
        isOnline: null as unknown as boolean,
      }),
    )
    // base 0.5% = 5; group picks max(30, 50) = 50; total 55
    expect(res.rewardValueHkd).toBe(55)
    expect(res.breakdown.find((b) => b.ruleId === "card__bonus_a")).toBeUndefined()
    expect(res.breakdown.find((b) => b.ruleId === "card__bonus_b")).toBeDefined()
  })

  it("replaces_base: knocks out base_earn already in selected", () => {
    const replacer = baseRule({
      ruleId: "card__merchant_bonus",
      ruleType: "merchant_bonus",
      formula: { type: "simple_percent", rate: 0.08 },
      categorySlug: "merchant_specific",
      stackingPolicy: "replaces_base",
      // Higher priority number = iterated later → base is added first, then replaced.
      priority: 150,
    })
    const res = calculate(
      "card",
      [base, replacer],
      txn({
        amountHkd: 1000,
        categorySlug: "merchant_specific",
      }),
    )
    // base would have been 5; replaced by merchant 80
    expect(res.rewardValueHkd).toBe(80)
    expect(res.breakdown).toHaveLength(1)
    expect(res.breakdown[0]?.ruleType).toBe("merchant_bonus")
  })
})

// ---------- M7: category resolution confidence in result ----------

describe("calculate — M7 categoryResolutionConfidence", () => {
  const rule = baseRule({
    ruleId: "card__base",
    formula: { type: "simple_percent", rate: 0.01 },
    confidenceScore: 0.95,
  })

  it("undefined categoryResolutionConfidence → treated as 1.0 (rule conf wins)", () => {
    const res = calculate("card", [rule], txn({ amountHkd: 1000 }))
    expect(res.confidenceScore).toBe(0.95)
    expect(res.confidence).toBe("high")
  })

  it("resolver returned high confidence (0.9) → final = min(0.95, 0.9) = 0.9, high", () => {
    const res = calculate(
      "card",
      [rule],
      txn({ amountHkd: 1000, categoryResolutionConfidence: 0.9 }),
    )
    expect(res.confidenceScore).toBe(0.9)
    expect(res.confidence).toBe("high")
  })

  it("resolver fallback (0.3) → final = 0.3, badge low", () => {
    const res = calculate(
      "card",
      [rule],
      txn({ amountHkd: 1000, categoryResolutionConfidence: 0.3 }),
    )
    expect(res.confidenceScore).toBe(0.3)
    expect(res.confidence).toBe("low")
  })

  it("medium category conf (0.75) with high rule (0.95) → 0.75, medium", () => {
    const res = calculate(
      "card",
      [rule],
      txn({ amountHkd: 1000, categoryResolutionConfidence: 0.75 }),
    )
    expect(res.confidenceScore).toBe(0.75)
    expect(res.confidence).toBe("medium")
  })

  it("no breakdown + low category conf → still high (no uncertainty to combine)", () => {
    // Empty breakdown means no rule contributed. ruleMinConf=1.0; we still take
    // min with categoryConf, but result has nothing for the user to read into.
    const res = calculate(
      "card",
      [],
      txn({ amountHkd: 1000, categoryResolutionConfidence: 0.3 }),
    )
    expect(res.rewardValueHkd).toBe(0)
    expect(res.confidenceScore).toBe(0.3)
  })
})

// ---------- M10: campaign gate (activatedCampaignIds) ----------

describe("calculate — M10 campaign gate", () => {
  const CAMPAIGN_ID = "hsbc-red-q3-online-extra"
  const onlineBonus = baseRule({
    ruleId: "hsbc-red__online_local_bonus",
    ruleName: "Online local 4%",
    ruleType: "online_bonus",
    formula: { type: "simple_percent", rate: 0.04 },
    categorySlug: "online_local",
    isOnline: true,
    priority: 80,
  })
  const campaignBonus = baseRule({
    ruleId: "hsbc-red__q3_online_extra",
    ruleName: "Q3 online extra 2% (campaign)",
    ruleType: "campaign_bonus",
    formula: { type: "simple_percent", rate: 0.02 },
    categorySlug: "online_local",
    isOnline: true,
    campaignId: CAMPAIGN_ID,
    priority: 70,
  })
  const rules = [onlineBonus, campaignBonus]
  const onlineTxn = txn({
    amountHkd: 1000,
    categorySlug: "online_local",
    isOnline: true,
  })

  it("user NOT registered → campaign rule skipped, only standard online bonus applies", () => {
    const res = calculate("hsbc-red", rules, onlineTxn, {
      cardId: "hsbc-red",
      activatedCampaignIds: [],
    })
    expect(res.rewardValueHkd).toBe(40) // 1000 × 4% only
    expect(res.breakdown).toHaveLength(1)
    expect(res.breakdown[0]?.ruleType).toBe("online_bonus")
  })

  it("user registered → both rules apply (additive default)", () => {
    const res = calculate("hsbc-red", rules, onlineTxn, {
      cardId: "hsbc-red",
      activatedCampaignIds: [CAMPAIGN_ID],
    })
    expect(res.rewardValueHkd).toBe(60) // 40 + 20
    expect(res.breakdown).toHaveLength(2)
    expect(res.breakdown.map((b) => b.ruleType).sort()).toEqual([
      "campaign_bonus",
      "online_bonus",
    ])
  })

  it("user registered for a different campaign → still skipped", () => {
    const res = calculate("hsbc-red", rules, onlineTxn, {
      cardId: "hsbc-red",
      activatedCampaignIds: ["some-other-campaign"],
    })
    expect(res.rewardValueHkd).toBe(40)
    expect(res.breakdown).toHaveLength(1)
  })

  it("activatedCampaignIds undefined → treated as empty (rule skipped)", () => {
    const res = calculate("hsbc-red", rules, onlineTxn)
    expect(res.rewardValueHkd).toBe(40)
  })
})

// ---------- M7 demo: caller resolves merchant, then calculator runs ----------

describe("M7 end-to-end: merchantName only → resolve → calculate", () => {
  const resolver = new HardcodedMerchantResolver()

  // Citi PremierMiles-style: base earn only; tax exclusion irrelevant here.
  const ASIA_MILE_HKD = 0.1
  const citiPmBase = baseRule({
    ruleId: "citi-premiermiles__base_earn",
    ruleType: "base_earn",
    rewardCurrencySlug: "asia_miles",
    rewardCurrencyValueHkd: ASIA_MILE_HKD,
    formula: { type: "points_per_hkd", points: 1, perHkd: 8, currencySlug: "asia_miles" },
    confidenceScore: 0.9,
  })

  it("Klook HKD 5000 (only merchantName given) → 62.5 HKD, high confidence", async () => {
    const merchantName = "Klook"
    const resolution = await resolver.resolve(merchantName)
    expect(resolution.categorySlug).toBe("travel_ota")

    const res = calculate(
      "citi-premiermiles",
      [citiPmBase],
      txn({
        amountHkd: 5000,
        merchantName,
        categorySlug: resolution.categorySlug,
        categoryResolutionConfidence: resolution.confidence,
      }),
    )

    // 5000 / 8 = 625 miles × 0.10 = 62.5 HKD
    expect(res.rewardValueHkd).toBeCloseTo(62.5)
    expect(res.confidence).toBe("high") // min(0.9 rule, 0.9 category) = 0.9
  })

  it("Unknown merchant HKD 5000 → reward computed, confidence drops to low", async () => {
    const merchantName = "Random Shop XYZ"
    const resolution = await resolver.resolve(merchantName)
    expect(resolution.fallbackUsed).toBe(true)

    const res = calculate(
      "citi-premiermiles",
      [citiPmBase],
      txn({
        amountHkd: 5000,
        merchantName,
        categorySlug: resolution.categorySlug, // "unknown"
        categoryResolutionConfidence: resolution.confidence, // 0.3
      }),
    )

    expect(res.rewardValueHkd).toBeCloseTo(62.5) // base earn still applies
    expect(res.confidence).toBe("low") // 0.3 category dominates
    expect(res.confidenceScore).toBe(0.3)
  })
})
