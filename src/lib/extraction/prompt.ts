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

export const PROMPT_VERSION = "p2-v3" as const

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

// p2-v2 addition: separate the CARD'S DEFAULT terms from promotions that
// only apply through specific channels or under extra conditions. Without
// this, aggregator pages "里先生独家 HK$1,600 現金回贈" gets grouped with
// the card's real welcome (30,000 miles) → materialized as a bogus rule.
//
//   baseline           — the card's default, applies to any successful
//                        applicant/cardholder (what the calculator should
//                        reason about by default)
//   referral_exclusive — "里先生独家" / "MoneyHero exclusive" — only via
//                        that specific referral link
//   conditional        — requires an extra action beyond the baseline
//                        (link a Citigold account, sign up for Flexi
//                        Shopping installment, spend HK$X on Y merchant, ...)
//   time_limited       — has an effective_end date ("推廣期至 2026-07-31")
//   registration_required — needs to opt-in / register / activate before
//                        the terms apply (baseline card benefit but gated)
//
// P4 aggregator only feeds `baseline` claims into `canonical_payload`; the
// rest sit as pending_review source_claims for the reviewer to consider
// separately. See D17 for the load-bearing carve-out rationale.
export const PromotionType = z.enum([
  "baseline",
  "referral_exclusive",
  "conditional",
  "time_limited",
  "registration_required",
])
export type PromotionType = z.infer<typeof PromotionType>

// Shape of a single claim the extractor emits. The structured payload's
// inner shape varies per claim_type (rate% vs cap_hkd vs welcome_offer tiers),
// and the Anthropic structured-outputs API requires `additionalProperties:false`
// on every object — which rules out the obvious "free-form Record" encoding.
// We work around that by having the model emit the payload as a JSON-encoded
// string, then JSON.parse it on our side. The system prompt teaches the model
// the per-claim_type payload shape; we trust it to produce valid JSON inside
// the string. If it doesn't, the run fails loud with a parse error.
//
// P2.1+ can tighten this with a per-claim_type discriminated union (anyOf
// is supported by the API) if the loose typing becomes a quality issue.
export const ExtractedClaim = z.object({
  claimType: ClaimType,
  // JSON-encoded payload string. Examples of the parsed content:
  //   earn_rate     → { rewardFormulaType, rate?, points?, perHkd?, currencySlug?,
  //                     categorySlug?, isOnline?, isOverseas?, isForeignCurrency? }
  //   cap           → { amountHkd?, rewardAmount?, period, basis,
  //                     categorySlug?, appliesTo?, isOnline?, isOverseas?,
  //                     isForeignCurrency? }  // p2-v3: match earn_rate gating
  //   exclusion     → { categorySlug?, appliesTo: string[] }
  //   welcome_offer → { tiers: [...] }
  //   annual_fee    → { amountHkd, waiverConditions?: string }
  // Use parseStructuredPayload() below to get the parsed object.
  structuredPayloadJson: z.string().min(1),
  // p2-v2 mandatory tag. See PromotionType above for the taxonomy + why
  // it's load-bearing (D17). Extractor MUST decide — no default fallback.
  promotionType: PromotionType,
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

// Helper: parse the JSON-string payload. Throws if invalid JSON — caller's
// job to fail the extraction_run loud rather than persist garbage.
export function parseStructuredPayload(claim: ExtractedClaim): Record<string, unknown> {
  const parsed: unknown = JSON.parse(claim.structuredPayloadJson)
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `structured payload is not a JSON object: got ${typeof parsed}`,
    )
  }
  return parsed as Record<string, unknown>
}

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
          // String, not object — the API rejects additionalProperties:true
          // and we can't enumerate every per-claim_type field without losing
          // shape flexibility. See note on ExtractedClaim above.
          structuredPayloadJson: {
            type: "string",
            description:
              "JSON-encoded payload for this claim. The shape inside depends on claimType — see the system prompt for per-type schemas. Must be valid JSON that parses to an object.",
          },
          promotionType: {
            type: "string",
            enum: PromotionType.options,
            description:
              "p2-v2 tag: is this the card's baseline term, or a promotion / channel-exclusive addon / conditional / time-limited? See system prompt for the decision guide.",
          },
          extractedTextSnippet: { type: "string" },
          confidenceScore: { type: "number" },
          note: { type: "string" },
        },
        required: [
          "claimType",
          "structuredPayloadJson",
          "promotionType",
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

    **DO NOT emit as base_earn** if the rate is qualified by "as low as", "up to", "at rates from", "最高", "最低至", OR is gated by a list of merchant categories, OR only applies to specific channels (Octopus / merchant program / registered users). Marketing copy like "earn miles at a rate as low as HK$2 = 1 mile" describes the BEST category rate, not the base earn — the base is HK$8/mile or HK$15/mile in that example, and HK$2/mile only fires on the "designated everyday spend" list. If you can't tell what the true base rate is, emit the qualified rate as a category_bonus with the categorySlug set, and leave base_earn to a chunk that says something like "HK$8 = 1 mile on all other spend".
- **cap** — A monetary or time-period cap on an earn_rate. e.g. "max HKD 100,000 per year spending", "up to HK$300 Fare Rebate per month". Payload: { amountHkd?, rewardAmount?, period: 'month'|'quarter'|'year'|'campaign', basis: 'spending'|'reward'|'transaction_count', categorySlug?, appliesTo?: string[], isOnline?, isOverseas?, isForeignCurrency? }.

    **CRITICAL (p2-v3)**: caps MUST carry the same gating fields as the earn_rate they belong to. If the T&C says "15% Fare Rebate on public transport, capped at HK$300/month reward", emit the cap with \`categorySlug: 'public_transport'\` — otherwise the downstream stitcher can't pair the cap with its rule and the calculator applies the 15% unbounded. If the cap gates multiple categories ("first HK$10,000 in airlines OR selected online travel merchants each quarter"), use \`appliesTo: ['travel_airline', 'travel_ota']\`. If the cap is truly card-wide with no category gate (rare — usually only "aggregate monthly reward cap of HK$X across all bonuses"), omit both fields — the stitcher will treat it as a card-level cap.
- **exclusion** — Categories or merchant types that don't earn the bonus (often base earn still applies). e.g. "Tax payments excluded", "Octopus AAVS does not earn". Payload: { categorySlug?, appliesTo: string[] }.
- **welcome_offer** — A one-time signup bonus. e.g. "spend HKD 6,000 in 60 days → 50,000 miles". Payload: { tiers: [{ minSpendHkd, withinDays, reward: { type, amount?, currencySlug? } }] }.
- **category_definition** — How the bank defines a category (e.g. "Online means transactions coded as MCC 5411..."). Payload: { categorySlug, definition }.
- **annual_fee** — Annual fee + any waiver conditions. Payload: { amountHkd, waiverConditions? }.
- **eligibility** — Who can apply. Payload: { criteria: string[] }.

# promotionType — MANDATORY per-claim tag

Every claim must be tagged with exactly one \`promotionType\`. This is the #1 fix in p2-v2. Aggregator pages (MoneyHero, 里先生 Mr. Miles, 小斯 flyformiles, FlyAsia, MoneySmart) intersperse the CARD'S BASELINE TERMS with promotions that only apply through their referral link or under extra conditions. If you tag a channel-exclusive HK$1,600 addon as \`baseline\`, downstream will materialize it as if every applicant gets it. That's wrong. Tag it accurately.

- **baseline** — the card's standard, universal term. Any successful applicant/cardholder gets this. e.g. "HSBC Red 網上簽賬 4% 回贈" / "Citi PremierMiles base earn HK$8 = 1 mile" / "Annual fee HK$1,800, waived first year" / "welcome offer 30,000 miles on HK$5,000 spend in first 60 days". Use this for the card's real T&C-derived facts.
- **referral_exclusive** — Only applies when the customer applies through THIS SPECIFIC affiliate/referral link. Signals in the text: "獨家" / "exclusive" / "里先生獨家" / "MoneyHero exclusive" / "經 X 申請額外送 Y". These are aggregator payoffs (the aggregator gives you cash from the referral commission), NOT bank terms. Reviewer decides whether to model them separately.
- **conditional** — Requires an extra action beyond just applying + spending. Signals: "登記 Flexi Shopping" / "linked to Citigold account" / "activate the AAVS 自動增值" / "sign up for the +FUN Dollars program". If the extra action is universal (e.g. every cardholder can register), it's still \`conditional\` — the calculator can't know if the user did the action.
- **time_limited** — Has a promotion period. Signals: "推廣期至" / "由 X 日至 Y 日" / "限時" / "月/年份". These are usually valid for a specific window and expire.
- **registration_required** — The card benefit itself requires opting-in / registering / activating. Different from \`conditional\` in that it's the card's own gating (not a stacked promotion). Signals: "需要登記" for a card's own rewards program that's universal but must be enrolled. Aggregator may skip these too by default; reviewer decides.

**Decision order**: if a claim mentions BOTH baseline terms AND a limited-time addon, EMIT TWO CLAIMS — one baseline, one time_limited — with separate snippets. Do not combine.

**When in doubt**: if you can't tell whether a rate/offer is universal or channel-exclusive, prefer \`referral_exclusive\` on aggregator pages (moneyhero/mrmiles/flyformiles/flyasia) and \`baseline\` on official pages. When the source_type in the user message is \`official_page\` or \`official_pdf_tc\`, default to \`baseline\` unless the text explicitly says "promotion" / "限時".

# Hard rules

1. **Quote the source.** \`extractedTextSnippet\` MUST be a verbatim substring of the chunk you're given. If you can't quote it, don't claim it. Hallucinated quotes are the #1 failure mode of this pipeline.
2. **One claim per atomic assertion.** "4% online, capped at HKD 100k/year" is TWO claims (one earn_rate, one cap), not one. The cross-checker can stitch them back together.
3. **Confidence reflects the source, not your knowledge.** 0.9 = the source unambiguously says this. 0.6 = the source is suggestive but might need a reviewer. 0.3 = you're guessing from context — usually means you should emit nothing instead.
4. **Empty claims is a valid answer.** If the chunk is a footer, marketing fluff, or doesn't say anything calculator-relevant, emit { "claims": [], "rationale": "<why nothing>" }. The aggregator handles missing claims correctly; fabricated ones break it.
5. **Use canonical slugs** for categorySlug (dining_local, online_local, supermarket, travel_ota, travel_airline, public_transport, octopus, ewallet_topup, tax_government, general_overseas, ...). If the source mentions something off-taxonomy, put it in \`note\` rather than inventing a slug.
6. **Don't infer across rules.** If the source says "4% online" and separately "see T&C for caps", emit the earn_rate claim only — don't invent a cap. Cap is a separate source / chunk's job.
7. **Every claim MUST include \`promotionType\`.** No default. If you can't decide, use \`referral_exclusive\` on aggregator pages, \`baseline\` on official pages, and add a \`note\` explaining the ambiguity.

# Output format

Emit a JSON object matching the provided schema.

**Important**: each claim's \`structuredPayloadJson\` field is a **string** containing a JSON-encoded object — not a JSON object directly. Every claim requires \`promotionType\` at the top level (NOT inside the payload string). For example, a baseline earn_rate claim looks like:

\`\`\`json
{
  "claimType": "earn_rate",
  "structuredPayloadJson": "{\\"rewardFormulaType\\":\\"simple_percent\\",\\"rate\\":0.04,\\"isOnline\\":true,\\"categorySlug\\":\\"online_local\\"}",
  "promotionType": "baseline",
  "extractedTextSnippet": "4% RewardCash on online local spend",
  "confidenceScore": 0.9
}
\`\`\`

A referral-exclusive welcome offer from an aggregator page looks like:

\`\`\`json
{
  "claimType": "welcome_offer",
  "structuredPayloadJson": "{\\"tiers\\":[{\\"minSpendHkd\\":5000,\\"withinDays\\":60,\\"reward\\":{\\"type\\":\\"cashback_hkd\\",\\"amount\\":1600}}]}",
  "promotionType": "referral_exclusive",
  "extractedTextSnippet": "里先生獨家 首2個月簽 HK$5,000 賺 HK$1,600 現金回贈",
  "confidenceScore": 0.85,
  "note": "Aggregator payoff via referral link — not the bank's baseline welcome offer."
}
\`\`\`

The inner JSON must parse to an object (not an array, not a scalar). The \`rationale\` field at the top level is optional but encouraged when claims is empty or when you noticed something ambiguous.`

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
