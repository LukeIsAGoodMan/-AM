import { describe, it, expect } from "vitest"
import {
  classifyAnnualFee,
  evaluateAnnualFeePublication,
  type AnnualFeeClaimInput,
} from "@/lib/extraction/annual-fee-classify"

// P18 Stage 1A · spec §9 tests #7 (classification) + #8 (provisional
// publication). Snippets are the real Explorer corpus strings.

describe("§9.7 — annual-fee classification", () => {
  it("standard fee: 'Basic Card Annual Membership fee HK$2,200'", () => {
    const c = classifyAnnualFee(
      { amountHkd: 2200 },
      "Your Basic Card Annual Membership fee of HK$2,200 will be waived",
    )
    expect(c.feeKind).toBe("standard_annual_fee") // waived is a CONDITION, amount != 0
    expect(c.cardholderType).toBe("primary") // "Basic Card"
    expect(c.effectiveScope).toBe("current")
  })

  it("first-year waiver: '免首年年費' at HK$0 → first_year_fee, not standard", () => {
    const c = classifyAnnualFee({ amountHkd: 0 }, "AE Explorer Card 免首年年費")
    expect(c.feeKind).toBe("first_year_fee")
  })

  it("supplementary fee is labelled and excluded from primary setting", () => {
    const c = classifyAnnualFee(
      { amountHkd: 1100 },
      "Supplementary card annual fee HK$1,100",
    )
    expect(c.cardholderType).toBe("supplementary")
    expect(c.feeKind).toBe("standard_annual_fee")
  })

  it("historical fee is flagged", () => {
    const c = classifyAnnualFee(
      { amountHkd: 1800 },
      "The annual fee was previously HK$1,800",
    )
    expect(c.effectiveScope).toBe("historical")
  })

  it("HK$9,500 outlier '年費$9,500無得豁免' is a current standard fee", () => {
    const c = classifyAnnualFee({ amountHkd: 9500 }, "年費$9,500無得豁免")
    expect(c.feeKind).toBe("standard_annual_fee")
    expect(c.effectiveScope).toBe("current")
  })
})

describe("§9.8 — annual-fee provisional publication (Explorer scenario)", () => {
  function claim(
    id: string,
    amountHkd: number | null,
    opts: Partial<AnnualFeeClaimInput> & {
      snippet?: string
    } = {},
  ): AnnualFeeClaimInput {
    const snippet = opts.snippet ?? ""
    return {
      claimId: id,
      sourceId: opts.sourceId ?? `src-${id}`,
      amountHkd,
      isOfficial: opts.isOfficial ?? false,
      sourcePriority: opts.sourcePriority ?? 5,
      classification: opts.classification ?? classifyAnnualFee({ amountHkd }, snippet),
    }
  }

  it("official HK$2,200 + competitor HK$9,500 outlier → provisional_conflict, 9500 preserved", () => {
    const d = evaluateAnnualFeePublication([
      claim("official", 2200, {
        isOfficial: true,
        sourcePriority: 2,
        snippet: "Basic Card Annual Membership fee HK$2,200",
      }),
      claim("outlier9500", 9500, { snippet: "年費$9,500無得豁免" }),
      claim("firstyear0", 0, { snippet: "免首年年費" }),
      claim("tp2200", 2200, {
        sourceId: "src-tp",
        snippet: "基本卡年費 HK$2,200",
      }),
    ])
    expect(d.outcome).toBe("official_conflict")
    expect(d.updateCard).toBe(true)
    expect(d.newValueHkd).toBe(2200)
    expect(d.publishAuthority).toBe("provisional_conflict_pending_review")
    expect(d.needsReview).toBe(true)
    expect(d.chosenClaimId).toBe("official")
    // The 9,500 outlier is preserved for investigation, NOT auto-rejected.
    expect(d.retainedConflictClaimIds).toContain("outlier9500")
    // The first-year HK$0 is a waiver, not a conflicting standard fee.
    expect(d.waiverClaimIds).toContain("firstyear0")
    expect(d.retainedConflictClaimIds).not.toContain("firstyear0")
  })

  it("official with no conflict → provisional_pending_review, needsReview false", () => {
    const d = evaluateAnnualFeePublication([
      claim("official", 2200, {
        isOfficial: true,
        sourcePriority: 2,
        snippet: "Basic Card Annual Membership fee HK$2,200",
      }),
      claim("firstyear0", 0, { snippet: "免首年年費" }),
    ])
    expect(d.outcome).toBe("official_clean")
    expect(d.publishAuthority).toBe("provisional_pending_review")
    expect(d.needsReview).toBe(false)
    expect(d.newValueHkd).toBe(2200)
  })

  it("no official but two independent third parties agree → third_party_agreed", () => {
    const d = evaluateAnnualFeePublication([
      claim("a", 2200, { sourceId: "src-a", classification: { cardholderType: "primary", feeKind: "standard_annual_fee", effectiveScope: "current" } }),
      claim("b", 2200, { sourceId: "src-b", classification: { cardholderType: "primary", feeKind: "standard_annual_fee", effectiveScope: "current" } }),
    ])
    expect(d.outcome).toBe("third_party_agreed")
    expect(d.updateCard).toBe(true)
    expect(d.needsReview).toBe(true)
  })

  it("no authoritative evidence → insufficient, card NOT updated", () => {
    const d = evaluateAnnualFeePublication([
      // single non-official unknown-cardholder claim
      claim("lonely", 3000, { snippet: "年費 HK$3,000" }),
    ])
    expect(d.outcome).toBe("insufficient")
    expect(d.updateCard).toBe(false)
    expect(d.newValueHkd).toBeNull()
  })
})
