import { describe, it, expect } from "vitest"
import {
  buildRewardCurrencyDisplay,
  formatRewardCurrency,
} from "@/lib/calculator/resolved-rule"

// P18 Stage 1A · spec §9 test #11 — reward-currency display. UI must show
// "Membership Rewards Points (MR)" not the raw slug or an unexplained "MR".

describe("§9.11 — reward currency display", () => {
  it("amex MR: name (from DB join) + abbreviation", () => {
    const d = buildRewardCurrencyDisplay(
      "amex_membership_rewards",
      "American Express Membership Rewards",
      "美國運通積分獎賞",
    )
    expect(d.displayAbbreviation).toBe("MR")
    expect(formatRewardCurrency(d)).toBe(
      "American Express Membership Rewards (MR)",
    )
  })

  it("cashback rules (null join) fall back to a curated name, no slug leak", () => {
    const d = buildRewardCurrencyDisplay("hkd_cashback", null, null)
    expect(d.displayNameEn).toBe("HKD Cashback")
    expect(d.displayAbbreviation).toBeNull()
    expect(formatRewardCurrency(d)).toBe("HKD Cashback")
    expect(formatRewardCurrency(d)).not.toContain("hkd_cashback")
  })

  it("no abbreviation → just the name (asia_miles)", () => {
    const d = buildRewardCurrencyDisplay("asia_miles", "Asia Miles", "亞洲萬里通")
    expect(formatRewardCurrency(d)).toBe("Asia Miles")
  })

  it("unknown slug with no name degrades to the slug (last resort)", () => {
    const d = buildRewardCurrencyDisplay("mystery_points", null, null)
    expect(d.displayNameEn).toBe("mystery_points")
    expect(d.displayAbbreviation).toBeNull()
  })
})
