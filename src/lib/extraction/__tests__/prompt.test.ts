import { describe, it, expect } from "vitest"
import {
  ClaimType,
  EXTRACTION_OUTPUT_JSON_SCHEMA,
  ExtractionOutput,
  PROMPT_VERSION,
  PromotionType,
  SYSTEM_PROMPT,
  buildUserMessage,
  parseStructuredPayload,
} from "@/lib/extraction/prompt"

// Pure tests for the extraction prompt module. No LLM call. Pins:
//   - Prompt version is what extraction_runs rows will record
//   - Zod schema accepts valid output, rejects common malformations
//   - JSON Schema sent to the API stays in sync with the Zod enum (claimType)
//   - User-message builder produces deterministic, cacheable output

describe("P2 — prompt module invariants", () => {
  it("prompt version is the stable 'p2-v3' constant", () => {
    expect(PROMPT_VERSION).toBe("p2-v3")
  })

  it("SYSTEM_PROMPT mentions every claim_type by name (taxonomy in sync with enum)", () => {
    // If a new claim_type is added to the Zod enum, this test forces the
    // system prompt to be updated alongside it — otherwise the model has
    // no idea when to emit the new type.
    for (const t of ClaimType.options) {
      expect(SYSTEM_PROMPT).toContain(t)
    }
  })

  it("SYSTEM_PROMPT mentions every promotionType by name (p2-v2 decision guide sync)", () => {
    // Same principle as the claim_type pin — if a new promotion type
    // gets added to the enum, this test forces the prompt's decision
    // guide to teach the model about it.
    for (const t of PromotionType.options) {
      expect(SYSTEM_PROMPT).toContain(t)
    }
  })

  it("JSON schema enum stays in sync with Zod enum (claimType + promotionType)", () => {
    const properties = EXTRACTION_OUTPUT_JSON_SCHEMA.properties
    const claimsItems = properties.claims.items
    expect(claimsItems.properties.claimType.enum).toEqual(ClaimType.options)
    expect(claimsItems.properties.promotionType.enum).toEqual(
      PromotionType.options,
    )
    // promotionType is required — the whole point of p2-v2 is that the
    // model can't quietly emit an untagged claim (see D17).
    expect(claimsItems.required).toContain("promotionType")
  })

  it("JSON schema sets additionalProperties:false on every nested object (Anthropic structured-output requirement)", () => {
    // The skill explicitly notes that structured outputs require
    // `additionalProperties: false` — true or omitted both 400. This test
    // pins that we comply at every nesting level.
    expect(EXTRACTION_OUTPUT_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(
      EXTRACTION_OUTPUT_JSON_SCHEMA.properties.claims.items.additionalProperties,
    ).toBe(false)
    // The per-claim structured payload is a string field (NOT a nested
    // object) so we don't need additionalProperties there — and the
    // model can still emit per-claim_type payload shapes inside the string.
    expect(
      EXTRACTION_OUTPUT_JSON_SCHEMA.properties.claims.items.properties
        .structuredPayloadJson.type,
    ).toBe("string")
  })

  it("Zod schema accepts a well-formed extraction output", () => {
    const output = {
      claims: [
        {
          claimType: "earn_rate" as const,
          structuredPayloadJson: JSON.stringify({
            rewardFormulaType: "simple_percent",
            rate: 0.04,
            isOnline: true,
            categorySlug: "online_local",
          }),
          promotionType: "baseline" as const,
          extractedTextSnippet: "4% RewardCash on online local spend",
          confidenceScore: 0.9,
        },
        {
          claimType: "cap" as const,
          structuredPayloadJson: JSON.stringify({
            amountHkd: 100000,
            period: "year",
            basis: "spending",
          }),
          promotionType: "baseline" as const,
          extractedTextSnippet: "subject to an annual cap of HKD 100,000",
          confidenceScore: 0.85,
          note: "Cap applies to the online bonus; not the base earn",
        },
      ],
      rationale: undefined,
    }
    const parsed = ExtractionOutput.parse(output)
    expect(parsed.claims).toHaveLength(2)
    // Payload round-trips
    const payload = parseStructuredPayload(parsed.claims[0]!)
    expect(payload.rate).toBe(0.04)
    expect(payload.categorySlug).toBe("online_local")
  })

  it("Zod rejects a claim missing promotionType (p2-v2 mandatory tag)", () => {
    expect(() =>
      ExtractionOutput.parse({
        claims: [
          {
            claimType: "earn_rate",
            structuredPayloadJson: JSON.stringify({ rate: 0.04 }),
            extractedTextSnippet: "4%",
            confidenceScore: 0.9,
            // promotionType intentionally missing
          },
        ],
      }),
    ).toThrow()
  })

  it("SYSTEM_PROMPT teaches p2-v3 cap gating fields (categorySlug + appliesTo)", () => {
    // p2-v3 requires caps to carry the same category/applies_to gating as
    // their earn_rate. The prompt must teach the model about it; if a future
    // edit drops the guidance, this test forces us to notice.
    expect(SYSTEM_PROMPT).toMatch(/categorySlug.*appliesTo/s)
    // The Fare Rebate example (Citi Octopus 15% → HK$300/mo cap) is the
    // canonical illustration. If the wording changes, verify the intent
    // is still communicated.
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("public_transport")
  })

  it("SYSTEM_PROMPT warns against 'as low as' / 'up to' as base_earn (P13/P14 misclassification guard)", () => {
    // HSBC EveryMile "at a rate as low as HKD2 = 1 mile" was extracted
    // as base_earn in p2-v2 because the prompt didn't guard against
    // marketing qualifiers. This test pins the mitigation.
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("as low as")
  })

  it("Zod rejects a claim with an unknown promotionType", () => {
    expect(() =>
      ExtractionOutput.parse({
        claims: [
          {
            claimType: "earn_rate",
            structuredPayloadJson: JSON.stringify({ rate: 0.04 }),
            promotionType: "invented_type",
            extractedTextSnippet: "4%",
            confidenceScore: 0.9,
          },
        ],
      }),
    ).toThrow()
  })

  it("Zod schema accepts an empty-claims output (chunk wasn't extractable)", () => {
    const parsed = ExtractionOutput.parse({
      claims: [],
      rationale: "Chunk is the page footer with no calculator-relevant content",
    })
    expect(parsed.claims).toEqual([])
    expect(parsed.rationale).toContain("footer")
  })

  it("Zod rejects an unknown claim_type (extractor can't invent new types)", () => {
    expect(() =>
      ExtractionOutput.parse({
        claims: [
          {
            claimType: "lucky_draw_offer",
            structuredPayloadJson: "{}",
            promotionType: "baseline",
            extractedTextSnippet: "win a trip to Tokyo",
            confidenceScore: 0.5,
          },
        ],
      }),
    ).toThrow()
  })

  it("Zod rejects confidence > 1 (sanity bound)", () => {
    expect(() =>
      ExtractionOutput.parse({
        claims: [
          {
            claimType: "earn_rate",
            structuredPayloadJson: JSON.stringify({ rate: 0.04 }),
            promotionType: "baseline",
            extractedTextSnippet: "4%",
            confidenceScore: 1.5,
          },
        ],
      }),
    ).toThrow()
  })

  it("Zod rejects an empty snippet (would defeat the quote-the-source rule)", () => {
    expect(() =>
      ExtractionOutput.parse({
        claims: [
          {
            claimType: "earn_rate",
            structuredPayloadJson: JSON.stringify({ rate: 0.04 }),
            promotionType: "baseline",
            extractedTextSnippet: "",
            confidenceScore: 0.9,
          },
        ],
      }),
    ).toThrow()
  })

  it("parseStructuredPayload rejects non-object JSON (array, scalar, null)", () => {
    const baseValid = {
      claimType: "earn_rate" as const,
      promotionType: "baseline" as const,
      extractedTextSnippet: "4%",
      confidenceScore: 0.9,
    }
    for (const badJson of ["[1,2,3]", "42", "null", '"a string"']) {
      const claim = ExtractionOutput.parse({
        claims: [{ ...baseValid, structuredPayloadJson: badJson }],
      }).claims[0]!
      expect(() => parseStructuredPayload(claim)).toThrow()
    }
  })

  it("buildUserMessage produces deterministic output (caching invariant)", () => {
    // The skill flags non-determinism as a silent cache invalidator. The
    // user message must produce byte-identical output for the same inputs.
    const a = buildUserMessage({
      cardSlug: "hsbc-red",
      cardNameEn: "HSBC Red",
      issuerNameEn: "HSBC",
      sourceTitle: "Official T&C",
      sourceType: "official_page",
      chunkText: "4% RewardCash on online local.",
      knownCategorySlugs: ["online_local", "dining_local"],
    })
    const b = buildUserMessage({
      cardSlug: "hsbc-red",
      cardNameEn: "HSBC Red",
      issuerNameEn: "HSBC",
      sourceTitle: "Official T&C",
      sourceType: "official_page",
      chunkText: "4% RewardCash on online local.",
      knownCategorySlugs: ["online_local", "dining_local"],
    })
    expect(a).toBe(b)
  })

  it("buildUserMessage includes card slug, source title, and chunk text", () => {
    const msg = buildUserMessage({
      cardSlug: "hsbc-red",
      cardNameEn: "HSBC Red",
      issuerNameEn: "HSBC",
      sourceTitle: "Official T&C",
      sourceType: "official_page",
      chunkText: "<the chunk content>",
      knownCategorySlugs: ["online_local"],
    })
    expect(msg).toContain("hsbc-red")
    expect(msg).toContain("Official T&C")
    expect(msg).toContain("<the chunk content>")
    expect(msg).toContain("online_local")
  })
})
