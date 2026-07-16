import { describe, it, expect } from "vitest"
import { compareStructured, structuresAgree } from "@/lib/normalize"

// P18 Stage 1A · spec §9 test #1 — object-array normalized comparison.
// The bug being fixed: `String(object)` turned every object into
// "[object Object]", so HK$500 cashback and HK$100 Octopus top-up compared
// equal. This suite pins the four-way relation the new comparator returns.

describe("§9.1 — structured comparison: scalars + field normalization", () => {
  it("normalizes numeric representation: '100000.00' == 100000", () => {
    const r = compareStructured({ amountHkd: "100000.00" }, { amountHkd: 100000 })
    expect(r.relation).toBe("equal")
  })

  it("normalizes field names: perHkd == per_hkd == PerHKD", () => {
    const r = compareStructured({ perHkd: 6 }, { per_hkd: 6 })
    expect(r.relation).toBe("equal")
    const r2 = compareStructured({ PerHKD: 6 }, { perHkd: 6 })
    expect(r2.relation).toBe("equal")
  })

  it("a real numeric disagreement is a conflict", () => {
    const r = compareStructured({ rate: 0.04 }, { rate: 0.08 })
    expect(r.relation).toBe("conflict")
    expect(r.conflicts[0]?.reason).toBe("numeric")
  })

  it("within ±5% counts as equal, not conflict", () => {
    const r = compareStructured({ rate: 0.04 }, { rate: 0.041 })
    expect(r.relation).toBe("equal")
  })

  it("a missing optional field is NOT a contradiction (more_complete)", () => {
    const r = compareStructured(
      { rate: 0.012 },
      { rate: 0.012, note: "even insurance earns it" },
    )
    expect(r.relation).toBe("more_complete")
    expect(r.supersetSide).toBe("b")
    expect(r.conflicts).toHaveLength(0)
  })

  it("ignoreKeys drops informational fields from the verdict", () => {
    const r = compareStructured(
      { rate: 0.012, note: "phrased one way" },
      { rate: 0.012, note: "phrased another way" },
      { ignoreKeys: new Set(["note"]) },
    )
    expect(r.relation).toBe("equal")
  })
})

describe("§9.1 — structured comparison: object arrays (welcome components)", () => {
  const cashback500 = { type: "cashback", amountHkd: 500, withinDays: 60 }
  const octopus100 = { type: "octopus_topup", amountHkd: 100, withinDays: 30 }

  it("ignores array ordering", () => {
    const r = compareStructured(
      { tiers: [cashback500, octopus100] },
      { tiers: [octopus100, cashback500] },
    )
    expect(r.relation).toBe("equal")
  })

  it("HK$500 cashback and HK$100 Octopus are NOT equal (distinct components)", () => {
    // The exact bug: object arrays must not collapse to [object Object].
    const r = compareStructured({ tiers: [cashback500] }, { tiers: [octopus100] })
    expect(r.relation).toBe("enrichment") // each side has a component the other lacks
    expect(r.supersetSide).toBe("both")
    expect(r.conflicts).toHaveLength(0)
  })

  it("one source more complete = enrichment (extra component), not conflict", () => {
    const r = compareStructured(
      { tiers: [cashback500] },
      { tiers: [cashback500, octopus100] },
    )
    expect(r.relation).toBe("enrichment")
    expect(r.supersetSide).toBe("b")
    expect(structuresAgree(r.a, r.b)).toBe(true)
  })

  it("same component, different value = real conflict", () => {
    const r = compareStructured(
      { tiers: [{ type: "cashback", amountHkd: 500, withinDays: 60 }] },
      { tiers: [{ type: "cashback", amountHkd: 600, withinDays: 60 }] },
    )
    expect(r.relation).toBe("conflict")
    expect(r.conflicts[0]?.reason).toBe("numeric")
  })

  it("scalar array (exclusion scope) is order-insensitive; subset = enrichment", () => {
    expect(
      compareStructured({ appliesTo: ["dining", "travel"] }, { appliesTo: ["travel", "dining"] }).relation,
    ).toBe("equal")
    const broader = compareStructured(
      { appliesTo: ["dining"] },
      { appliesTo: ["dining", "hotel"] },
    )
    expect(broader.relation).toBe("enrichment")
    expect(broader.supersetSide).toBe("b")
  })

  it("scalar array that DIVERGES (each side unique member) = conflict", () => {
    // [a,b] vs [a,c] — b and c are distinct scope members, not a subset.
    const r = compareStructured({ appliesTo: ["a", "b"] }, { appliesTo: ["a", "c"] })
    expect(r.relation).toBe("conflict")
    expect(r.conflicts[0]?.reason).toBe("array-component")
  })
})
