import { describe, it, expect } from "vitest"
import {
  earnRatioFromPointsPerHkd,
  earnRatioFromSimplePercent,
  earnRatiosEquivalent,
  rewardPerSpendUnit,
  toPerFromUnit,
  describeRatio,
  type EarnRatio,
  type ConvertRatio,
} from "@/lib/normalize"

// P18 Stage 1A · spec §9 test #10 — typed directional ratio normalization.
// HARD RULE (§4B, §12): direction comes from unit ROLES, never numeric size.

describe("§9.10 — typed directional ratio", () => {
  it("HK$6 = 1 mile builds spend=HKD reward=mile from field roles", () => {
    const r = earnRatioFromPointsPerHkd({
      points: 1,
      perHkd: 6,
      currencySlug: "asia_miles",
    })!
    expect(r.spend).toEqual({ amount: 6, currency: "hkd" })
    expect(r.reward).toEqual({ amount: 1, currency: "asia_miles" })
    expect(rewardPerSpendUnit(r)).toBeCloseTo(1 / 6)
  })

  it("HK$6=1mile ≡ HK$12=2miles (same math, roles known)", () => {
    const a = earnRatioFromPointsPerHkd({ points: 1, perHkd: 6, currencySlug: "asia_miles" })!
    const b = earnRatioFromPointsPerHkd({ points: 2, perHkd: 12, currencySlug: "asia_miles" })!
    expect(earnRatiosEquivalent(a, b)).toBe(true)
  })

  it("does NOT confuse HK$6=1mile with a reversed 1 mile=HK$6 (roles differ)", () => {
    const spendHkd: EarnRatio = {
      kind: "earn",
      spend: { amount: 6, currency: "hkd" },
      reward: { amount: 1, currency: "asia_miles" },
    }
    const spendMiles: EarnRatio = {
      kind: "earn",
      spend: { amount: 6, currency: "asia_miles" },
      reward: { amount: 1, currency: "hkd" },
    }
    // Same numbers, reversed unit roles → never equivalent.
    expect(earnRatiosEquivalent(spendHkd, spendMiles)).toBe(false)
  })

  it("1.2% cashback and HK$6=1mile never equate (different reward currency)", () => {
    const cashback = earnRatioFromSimplePercent({ rate: 0.012 })!
    const miles = earnRatioFromPointsPerHkd({ points: 1, perHkd: 6, currencySlug: "asia_miles" })!
    expect(earnRatiosEquivalent(cashback, miles)).toBe(false)
  })

  it("HK$1 = 2 points preserves direction", () => {
    const r = earnRatioFromPointsPerHkd({ points: 2, perHkd: 1, currencySlug: "amex_membership_rewards" })!
    expect(rewardPerSpendUnit(r)).toBeCloseTo(2)
    expect(describeRatio(r)).toBe("1 hkd → 2 amex_membership_rewards")
  })

  it("convert ratio 1500 MR → 540 Asia Miles keeps from/to direction", () => {
    const r: ConvertRatio = {
      kind: "convert",
      from: { amount: 1500, currency: "amex_membership_rewards" },
      to: { amount: 540, currency: "asia_miles" },
    }
    expect(toPerFromUnit(r)).toBeCloseTo(540 / 1500)
    expect(describeRatio(r)).toBe(
      "1500 amex_membership_rewards → 540 asia_miles",
    )
  })

  it("rejects malformed payloads (perHkd <= 0 or missing currency)", () => {
    expect(earnRatioFromPointsPerHkd({ points: 1, perHkd: 0, currencySlug: "x" })).toBeNull()
    expect(earnRatioFromPointsPerHkd({ points: 1, perHkd: 6 })).toBeNull()
  })
})
