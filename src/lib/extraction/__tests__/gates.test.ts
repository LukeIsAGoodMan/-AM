import { describe, it, expect } from "vitest"
import { evaluateInferredCategory } from "@/lib/extraction/inferred-category-gate"
import { evaluateAltMode } from "@/lib/extraction/alt-mode-gate"

// P18 Stage 1A · spec §9 tests #4 (inferred-category blocking), #5 (Blue Cash
// insurance claim rejection), #6 (alternate-mode candidate gating).

describe("§9.4 — inferred-category publication gate", () => {
  it("blocks a single-source category rate stated via inclusion language at the base rate", () => {
    const d = evaluateInferredCategory({
      categorySlug: "insurance",
      rate: 0.012,
      snippets: ["Even insurance payments earn 1.2% cashback"],
      supportingSourceCount: 1,
      baseRate: 0.012,
    })
    expect(d.blocked).toBe(true)
    expect(d.matchedInclusion).toContain("even")
  })

  it("does NOT block when the source explicitly limits the rate to the category", () => {
    const d = evaluateInferredCategory({
      categorySlug: "dining_local",
      rate: 0.05,
      snippets: ["5% cashback only for dining, such as restaurants"],
      supportingSourceCount: 1,
      baseRate: 0.012,
    })
    // Has inclusion ("such as") but ALSO explicit limiting ("only for") →
    // real category rate, not blocked. Rate also != base.
    expect(d.blocked).toBe(false)
    expect(d.matchedLimiting).toContain("only for")
  })

  it("does NOT block a multi-source category rate", () => {
    const d = evaluateInferredCategory({
      categorySlug: "insurance",
      rate: 0.012,
      snippets: ["even insurance earns 1.2%", "insurance also earns 1.2%"],
      supportingSourceCount: 2,
      baseRate: 0.012,
    })
    expect(d.blocked).toBe(false)
  })

  it("does NOT block when the category rate differs from the base rate", () => {
    const d = evaluateInferredCategory({
      categorySlug: "dining_local",
      rate: 0.05,
      snippets: ["dining, for example restaurants, earns 5%"],
      supportingSourceCount: 1,
      baseRate: 0.012,
    })
    expect(d.blocked).toBe(false)
  })
})

describe("§9.5 — Blue Cash mrmiles insurance claim (6db31629) is caught", () => {
  it("the real Chinese inclusion snippet 「如…都有」 triggers a block", () => {
    const d = evaluateInferredCategory({
      categorySlug: "insurance",
      rate: 0.012,
      snippets: ["如當面交付保險費用都有1.2%消費回贈！"],
      supportingSourceCount: 1,
      baseRate: 0.012,
    })
    expect(d.blocked).toBe(true)
    // Both 如 and 都有 are inclusion markers in this sentence.
    expect(d.matchedInclusion).toEqual(
      expect.arrayContaining(["如", "都有"]),
    )
    expect(d.reason).toContain("insurance")
  })
})

describe("§9.6 — alternate-reward-mode candidate gate", () => {
  it("gates a single-source HK$6=1 mile mode to inactive candidate", () => {
    const d = evaluateAltMode({
      formulaType: "points_per_hkd",
      rewardCurrency: "asia_miles",
      primaryFormulaType: "simple_percent",
      primaryRewardCurrency: "hkd_cashback",
      supportingSourceCount: 1,
      hasOfficialSource: false,
      snippets: ["HK$6 = 1 Asia Mile"],
    })
    expect(d.isAltMode).toBe(true)
    expect(d.kind).toBe("miles_transfer")
    expect(d.gateToCandidate).toBe(true)
  })

  it("does NOT gate the card's primary mode (same formula + currency)", () => {
    const d = evaluateAltMode({
      formulaType: "simple_percent",
      rewardCurrency: "hkd_cashback",
      primaryFormulaType: "simple_percent",
      primaryRewardCurrency: "hkd_cashback",
      supportingSourceCount: 1,
      hasOfficialSource: false,
      snippets: ["1.2% cashback on all spend"],
    })
    expect(d.isAltMode).toBe(false)
    expect(d.gateToCandidate).toBe(false)
  })

  it("does NOT force-gate an officially-backed alt mode (normal review instead)", () => {
    const d = evaluateAltMode({
      formulaType: "points_per_hkd",
      rewardCurrency: "asia_miles",
      primaryFormulaType: "simple_percent",
      primaryRewardCurrency: "hkd_cashback",
      supportingSourceCount: 2,
      hasOfficialSource: true,
      snippets: ["Convert to Asia Miles at HK$6 = 1 mile"],
    })
    expect(d.isAltMode).toBe(true)
    expect(d.gateToCandidate).toBe(false)
  })
})
