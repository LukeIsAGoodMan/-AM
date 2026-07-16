import { describe, it, expect } from "vitest"
import {
  parseCanaryArgs,
  validateCanaryConfig,
  enforceMaxWriteCount,
  formatAuditDiff,
  CANARY_ALLOWLIST,
  type CardSnapshot,
} from "@/lib/extraction/canary"

// P18 Stage 1A · spec §9 tests #12 (dry-run protections), #13 (card
// allowlist), #14 (max-write-count protection), #15 (before/after audit diff).

const EXPLORER = "american-express-explorer-credit-card"
const BLUE_CASH = "american-express-amex-blue-cash-credit-card"

describe("§9.12 — dry-run is the default; writing requires all gates", () => {
  it("no --enable-write ⇒ dryRun true", () => {
    const r = parseCanaryArgs(["--card-slug", BLUE_CASH])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.dryRun).toBe(true)
    expect(r.config.enableWrite).toBe(false)
  })

  it("--enable-write WITHOUT --max-write-count is rejected", () => {
    const r = parseCanaryArgs(["--card-slug", BLUE_CASH, "--enable-write"])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain("--max-write-count")
  })

  it("--enable-write WITH --max-write-count and allowlisted card ⇒ ok, dryRun false", () => {
    const r = parseCanaryArgs([
      "--card-slug", BLUE_CASH, "--enable-write", "--max-write-count", "20",
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.dryRun).toBe(false)
    expect(r.config.maxWriteCount).toBe(20)
  })
})

describe("§9.13 — card allowlist", () => {
  it("refuses a card not on the Stage 1A allowlist", () => {
    const r = parseCanaryArgs(["--card-slug", "hsbc-red"])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain("allowlist")
  })

  it("refuses a full-DB run (no --card-slug)", () => {
    const r = parseCanaryArgs(["--enable-write", "--max-write-count", "5"])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain("explicit card allowlist")
  })

  it("allowlist contains only Explorer + Blue Cash", () => {
    expect([...CANARY_ALLOWLIST].sort()).toEqual([BLUE_CASH, EXPLORER].sort())
    // A mix of one allowed + one disallowed still fails.
    const r = validateCanaryConfig({
      cards: [EXPLORER, "citi-cash-back"],
      dryRun: true, enableWrite: false, maxWriteCount: null, printDiff: false, reaggregate: false,
    })
    expect(r).toContain("citi-cash-back")
  })
})

describe("§9.14 — max-write-count protection", () => {
  it("aborts when planned writes exceed the cap", () => {
    expect(enforceMaxWriteCount(21, 20)).toContain("exceeds")
    expect(enforceMaxWriteCount(21, 20)).toContain("aborting")
  })
  it("passes when within the cap", () => {
    expect(enforceMaxWriteCount(20, 20)).toBeNull()
    expect(enforceMaxWriteCount(0, 20)).toBeNull()
  })
  it("no cap in a dry run ⇒ never blocks", () => {
    expect(enforceMaxWriteCount(9999, null)).toBeNull()
  })
})

describe("§9.15 — before/after audit diff", () => {
  it("renders the Explorer annual-fee 1800→2200 authority change + a new candidate", () => {
    const before: CardSnapshot = {
      cardSlug: EXPLORER,
      annualFeeHkd: 1800,
      annualFeeAuthority: "legacy_unverified",
      rules: [
        { slug: "explorer__base", ruleType: "base_earn", formulaType: "points_per_hkd", currencySlug: "amex_membership_rewards", publishAuthority: "legacy_unverified", isActiveForCalculator: true },
      ],
    }
    const after: CardSnapshot = {
      cardSlug: EXPLORER,
      annualFeeHkd: 2200,
      annualFeeAuthority: "provisional_conflict_pending_review",
      rules: [
        before.rules[0]!,
        { slug: "xchk__earn_rate__base__miles", ruleType: "base_earn", formulaType: "points_per_hkd", currencySlug: "asia_miles", publishAuthority: "candidate", isActiveForCalculator: false },
      ],
    }
    const diff = formatAuditDiff(before, after)
    expect(diff).toContain("1800 (legacy_unverified) → 2200 (provisional_conflict_pending_review)")
    expect(diff).toContain("+ rule xchk__earn_rate__base__miles")
    expect(diff).toContain("INACTIVE")
    expect(diff).toContain("active-for-calc 1→1")
  })

  it("reports 'unchanged' when nothing moved", () => {
    const snap: CardSnapshot = {
      cardSlug: BLUE_CASH, annualFeeHkd: 0, annualFeeAuthority: "legacy_unverified", rules: [],
    }
    expect(formatAuditDiff(snap, snap)).toContain("unchanged")
  })
})
