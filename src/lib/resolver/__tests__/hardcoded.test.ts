import { describe, it, expect } from "vitest"
import { HardcodedMerchantResolver, FALLBACK_RESOLUTION } from "@/lib/resolver/hardcoded"

describe("HardcodedMerchantResolver", () => {
  const resolver = new HardcodedMerchantResolver()

  it("resolves Klook → travel_ota with confidence 0.9", async () => {
    const r = await resolver.resolve("Klook")
    expect(r.categorySlug).toBe("travel_ota")
    expect(r.confidence).toBe(0.9)
    expect(r.matchedMerchantSlug).toBe("klook")
    expect(r.fallbackUsed).toBe(false)
  })

  it("is case-insensitive: klook == KLOOK == Klook", async () => {
    const a = await resolver.resolve("klook")
    const b = await resolver.resolve("KLOOK")
    const c = await resolver.resolve("Klook")
    expect(a.categorySlug).toBe(b.categorySlug)
    expect(b.categorySlug).toBe(c.categorySlug)
  })

  it("matches aliases (PnS → PARKnSHOP)", async () => {
    const r = await resolver.resolve("PnS")
    expect(r.matchedMerchantSlug).toBe("parknshop")
    expect(r.categorySlug).toBe("supermarket")
  })

  it("matches Chinese aliases (麥當勞 → McDonald's → dining_local)", async () => {
    const r = await resolver.resolve("麥當勞")
    expect(r.matchedMerchantSlug).toBe("mcdonalds-hk")
    expect(r.categorySlug).toBe("dining_local")
  })

  it("trims whitespace before lookup", async () => {
    const r = await resolver.resolve("  Octopus  ")
    expect(r.matchedMerchantSlug).toBe("octopus")
  })

  it("unknown merchant → fallback (unknown / 0.3 / fallbackUsed=true)", async () => {
    const r = await resolver.resolve("Some Random Shop XYZ")
    expect(r).toEqual(FALLBACK_RESOLUTION)
    expect(r.categorySlug).toBe("unknown")
    expect(r.confidence).toBe(0.3)
    expect(r.fallbackUsed).toBe(true)
  })

  it("ambiguous merchant (Foodpanda) gets reduced confidence by design", async () => {
    const r = await resolver.resolve("Foodpanda")
    expect(r.categorySlug).toBe("dining_local")
    expect(r.confidence).toBeLessThan(0.9)
  })

  it("tax_government merchant (IRD) resolves correctly", async () => {
    const r = await resolver.resolve("IRD")
    expect(r.categorySlug).toBe("tax_government")
  })
})
