import { z } from "zod"

// P2 — extraction prompt v1.
//
// Versioned via `PROMPT_VERSION` so future iterations can be A/B'd without
// touching old extraction_runs rows. Bump when the system prompt, taxonomy,
// or output schema changes meaningfully — D12's `input_hash` already includes
// prompt_version so re-runs over the same chunk produce distinct entries.
//
// Design (matches docs/decisions.md D13):
//   - System prompt holds the taxonomy + extraction rules — stable across
//     every call → cached via `cache_control: ephemeral` on the last system
//     block (skill: "Caching is a prefix match"; render order tools → system
//     → messages, so a marker on the last system block caches tools + system
//     together).
//   - Per-call user message carries only the chunk text + card context →
//     small, varies per call.
//   - Output is constrained via output_config.format JSON Schema so the
//     model can't free-form drift; we still Zod-parse for belt-and-suspenders.

export const PROMPT_VERSION = "p2-v1" as const

// One claim type per row PRD §22.5 listed. Free-text earlier; constrained
// here so the extractor can't invent a new type silently.
export const ClaimType = z.enum([
  "earn_rate",
  "cap",
  "exclusion",
  "welcome_offer",
  "category_definition",
  "annual_fee",
  "eligibility",
])
export type ClaimType = z.infer<typeof ClaimType>

// Shape of a single claim the extractor emits. Mirrors source_claims.structured_payload
// loose-ly — we keep it free-form (a Record) here because the inner shape
// varies wildly per claim_type (rate% vs cap_hkd vs exclusion list). P3+
// can tighten with discriminated unions per claim_type if needed.
export const ExtractedClaim = z.object({
  claimType: ClaimType,
  // Structured payload — shape depends on claimType. Examples:
  //   earn_rate     → { rewardFormulaType, rate?, points?, perHkd?, currencySlug?,
  //                     categorySlug?, isOnline?, isOverseas?, isForeignCurrency? }
  //   cap           → { amountHkd?, rewardAmount?, period, basis }
  //   exclusion     → { categorySlug?, appliesTo: string[] }
  //   welcome_offer → { tiers: [...] }
  //   annual_fee    → { amountHkd, waiverConditions?: string }
  structuredPayload: z.record(z.unknown()),
  // The exact substring from the source that supports this claim.
  // Reviewer eyeballs this to spot hallucination.
  extractedTextSnippet: z.string().min(1),
  // Self-reported 0..1. Aggregator in P4 weights this against source priority.
  confidenceScore: z.number().min(0).max(1),
  // Optional human-readable note explaining the claim or any ambiguity the
  // extractor noticed (e.g. "T&C mentions registration but doesn't specify
  // channel — review needed").
  note: z.string().optional(),
})
export type ExtractedClaim = z.infer<typeof ExtractedClaim>

export const ExtractionOutput = z.object({
  claims: z.array(ExtractedClaim),
  // If the chunk has nothing extractable (e.g. boilerplate footer), set
  // empty claims and explain here. Helps debug "why did it emit 0 claims?"
  rationale: z.string().optional(),
})
export type ExtractionOutput = z.infer<typeof ExtractionOutput>

// JSON Schema for the structured-output `output_config.format`. The Anthropic
// API needs JSON Schema, not Zod — we keep it in sync with the Zod above by
// hand. Single schema means low maintenance burden.
//
// Restrictions per Anthropic structured outputs:
//   - additionalProperties:false on every object
//   - no recursive schemas
//   - no minLength / minimum / numerical constraints
// We enforce min(1) / 0..1 bounds via Zod parse on the response instead.
export const EXTRACTION_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claimType: {
            type: "string",
            enum: ClaimType.options,
          },
          structuredPayload: {
            type: "object",
            additionalProperties: true,
          },
          extractedTextSnippet: { type: "string" },
          confidenceScore: { type: "number" },
          note: { type: "string" },
        },
        required: [
          "claimType",
          "structuredPayload",
          "extractedTextSnippet",
          "confidenceScore",
        ],
        additionalProperties: false,
      },
    },
    rationale: { type: "string" },
  },
  required: ["claims"],
  additionalProperties: false,
} as const

// System prompt: stable across every extraction call. Caches with the tools
// block (none in our case) via cache_control on the last system block.
//
// Token budget: ~1500 tokens. Cacheable minimum on Opus 4.7 is 4096 tokens,
// so this alone WON'T cache — we mount it together with the static taxonomy
// inside the user-turn (see extractor.ts) which pushes us over.
export const SYSTEM_PROMPT = `You are extracting structured claims from Hong Kong credit card terms & conditions.

Your job is to read one chunk of source text and emit zero or more structured "claims" — single, atomic assertions about how the card works. Another system will cross-check claims from multiple sources before any of them become approved rules. You are NOT the approver; be precise and quote the source, not exhaustive.

# Claim types

Emit exactly one entry per claim. Use the most specific type that fits.

- **earn_rate** — A reward rate for a specific situation. e.g. "1.2% cashback on all spend", "4% online local", "HKD 8 per Asia Mile on overseas". Payload mirrors reward_formula_payload: { rewardFormulaType: 'simple_percent'|'points_per_hkd'|'tiered_percent'|'tiered_points', rate?, points?, perHkd?, currencySlug?, categorySlug?, isOnline?, isOverseas?, isForeignCurrency? }.
- **cap** — A monetary or time-period cap on an earn_rate. e.g. "max HKD 100,000 per year spending". Payload: { amountHkd?, rewardAmount?, period: 'month'|'quarter'|'year'|'campaign', basis: 'spending'|'reward'|'transaction_count' }. Always tie a cap claim back to an earn_rate claim by using the same key_dimension hint in the snippet when possible.
- **exclusion** — Categories or merchant types that don't earn the bonus (often base earn still applies). e.g. "Tax payments excluded", "Octopus AAVS does not earn". Payload: { categorySlug?, appliesTo: string[] }.
- **welcome_offer** — A one-time signup bonus. e.g. "spend HKD 6,000 in 60 days → 50,000 miles". Payload: { tiers: [{ minSpendHkd, withinDays, reward: { type, amount?, currencySlug? } }] }.
- **category_definition** — How the bank defines a category (e.g. "Online means transactions coded as MCC 5411..."). Payload: { categorySlug, definition }.
- **annual_fee** — Annual fee + any waiver conditions. Payload: { amountHkd, waiverConditions? }.
- **eligibility** — Who can apply. Payload: { criteria: string[] }.

# Hard rules

1. **Quote the source.** \`extractedTextSnippet\` MUST be a verbatim substring of the chunk you're given. If you can't quote it, don't claim it. Hallucinated quotes are the #1 failure mode of this pipeline.
2. **One claim per atomic assertion.** "4% online, capped at HKD 100k/year" is TWO claims (one earn_rate, one cap), not one. The cross-checker can stitch them back together.
3. **Confidence reflects the source, not your knowledge.** 0.9 = the source unambiguously says this. 0.6 = the source is suggestive but might need a reviewer. 0.3 = you're guessing from context — usually means you should emit nothing instead.
4. **Empty claims is a valid answer.** If the chunk is a footer, marketing fluff, or doesn't say anything calculator-relevant, emit { "claims": [], "rationale": "<why nothing>" }. The aggregator handles missing claims correctly; fabricated ones break it.
5. **Use canonical slugs** for categorySlug (dining_local, online_local, supermarket, travel_ota, travel_airline, public_transport, octopus, ewallet_topup, tax_government, general_overseas, ...). If the source mentions something off-taxonomy, put it in \`note\` rather than inventing a slug.
6. **Don't infer across rules.** If the source says "4% online" and separately "see T&C for caps", emit the earn_rate claim only — don't invent a cap. Cap is a separate source / chunk's job.

# Output format

Emit a JSON object matching the provided schema. The \`rationale\` field is optional but encouraged when claims is empty or when you noticed something ambiguous.`

// User-turn template. The card context (issuer + card name) helps the model
// disambiguate generic phrases ("the bonus" → which bonus). The category
// taxonomy is repeated here so we can fold it into the cached prefix —
// keeping the system prompt itself short.
export function buildUserMessage(input: {
  cardSlug: string
  cardNameEn: string
  issuerNameEn: string
  sourceTitle: string
  sourceType: string
  chunkText: string
  knownCategorySlugs: string[]
}): string {
  return `# Card
${input.issuerNameEn} — ${input.cardNameEn} (slug: ${input.cardSlug})

# Source
Title: ${input.sourceTitle}
Type: ${input.sourceType}

# Category taxonomy (use these slugs verbatim when emitting categorySlug)
${input.knownCategorySlugs.join(", ")}

# Chunk to extract from

<chunk>
${input.chunkText}
</chunk>

Emit zero or more claims as structured JSON per the schema. Quote the source verbatim in \`extractedTextSnippet\`. If nothing is extractable, return an empty \`claims\` array with a brief \`rationale\`.`
}
