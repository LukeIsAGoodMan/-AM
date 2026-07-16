// Inferred-category publication gate (§3C).
//
// Deterministic pattern check. A category-specific earn-rate claim must NOT
// auto-publish when ALL of the following hold:
//   1. it is supported by only ONE source
//   2. its category was inferred from an EXAMPLE / INCLUSION / counterexample
//      (risky language in the source snippet)
//   3. the SAME rate is described elsewhere as the general base rate
//   4. there is NO explicit source condition limiting that rate to the category
//
// The canary case: mrmiles claim `6db31629` on Blue Cash —
//   「如當面交付保險費用都有1.2%消費回贈！」 (even paying insurance in person
//   earns the 1.2% rebate). That is the 1.2% BASE covering insurance, not a
//   special `insurance = 1.2%` category rate. The gate blocks it; the reviewer
//   rejects it; no active `insurance = 1.2%` calculator rule remains.
//
// When blocked, the caller preserves the source claim, does NOT materialize
// the category rule, and creates a review task (subtask 6 wires this in).

import { numbersAgree } from "@/lib/normalize"

// Risky language that signals a category was mentioned as an EXAMPLE of / an
// INCLUSION in the general rate, not carved out as its own rate. From §3C.
export const INCLUSION_PATTERNS_EN: readonly string[] = [
  "even",
  "including",
  "such as",
  "for example",
  "also eligible",
  "as well",
]
export const INCLUSION_PATTERNS_ZH: readonly string[] = [
  "如",
  "例如",
  "即使",
  "甚至",
  "包括",
  "連",
  "亦",
  "都有",
  "均可",
]

// Language that EXPLICITLY limits a rate to a category — its presence means
// the category rate is real (do not block). From §3C intent.
export const LIMITING_PATTERNS_EN: readonly string[] = [
  "only for",
  "only on",
  "exclusively",
  "solely",
  "restricted to",
  "limited to",
  "applies only",
]
export const LIMITING_PATTERNS_ZH: readonly string[] = [
  "只限",
  "僅限",
  "限於",
  "只適用",
  "僅適用",
  "專享",
  "獨享",
]

export interface InferredCategoryInput {
  categorySlug: string
  // The claim's rate as a fraction (simple_percent) — compared to baseRate.
  rate: number | null
  // Verbatim source snippets of the claim's supporting claims.
  snippets: readonly string[]
  // Distinct supporting source count for this category group.
  supportingSourceCount: number
  // The card's general base-spend rate, if a base_earn rule/group exists.
  baseRate: number | null
}

export interface InferredCategoryDecision {
  blocked: boolean
  reason: string | null
  matchedInclusion: string[]
  matchedLimiting: string[]
}

function findMatches(
  snippets: readonly string[],
  patternsEn: readonly string[],
  patternsZh: readonly string[],
): string[] {
  const hits = new Set<string>()
  for (const s of snippets) {
    const lower = s.toLowerCase()
    for (const p of patternsEn) {
      // Word-ish boundary for EN so "even" doesn't match "evening".
      const re = new RegExp(`(^|[^a-z])${p.replace(/ /g, "\\s+")}([^a-z]|$)`, "i")
      if (re.test(lower)) hits.add(p)
    }
    for (const p of patternsZh) {
      if (s.includes(p)) hits.add(p)
    }
  }
  return [...hits]
}

export function evaluateInferredCategory(
  input: InferredCategoryInput,
): InferredCategoryDecision {
  const matchedInclusion = findMatches(
    input.snippets,
    INCLUSION_PATTERNS_EN,
    INCLUSION_PATTERNS_ZH,
  )
  const matchedLimiting = findMatches(
    input.snippets,
    LIMITING_PATTERNS_EN,
    LIMITING_PATTERNS_ZH,
  )

  const singleSource = input.supportingSourceCount <= 1
  const hasInclusion = matchedInclusion.length > 0
  const hasLimiting = matchedLimiting.length > 0
  const rateEqualsBase =
    input.rate != null &&
    input.baseRate != null &&
    numbersAgree(input.rate, input.baseRate)

  // Block only when ALL four §3C conditions hold. Any explicit limiting
  // language means the category rate is real → never block.
  const blocked =
    singleSource && hasInclusion && rateEqualsBase && !hasLimiting

  if (!blocked) {
    return { blocked: false, reason: null, matchedInclusion, matchedLimiting }
  }
  return {
    blocked: true,
    reason:
      `inferred-category gate: single-source '${input.categorySlug}' rate ` +
      `equals base and is stated via inclusion language ` +
      `(${matchedInclusion.join(", ")}) with no category-limiting condition — ` +
      `covered by base spend, not a category rule`,
    matchedInclusion,
    matchedLimiting,
  }
}
