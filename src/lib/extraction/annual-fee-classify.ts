// Annual-fee classification + provisional publication policy (§3E).
//
// The bug: the materializer skipped annual_fee entirely, so a stale seed
// (Explorer HK$1,800) stayed published even though the current official page
// says HK$2,200. Naively taking the first positive number is also wrong —
// the corpus mixes primary vs supplementary fees, first-year waivers (HK$0),
// and outliers (HK$9,500) that may reference a different product.
//
// So every annual_fee claim is first CLASSIFIED on three axes, and only
// primary + standard_annual_fee + current claims may set cards.annual_fee_hkd.
// A first-year HK$0 is a WAIVER, not a conflicting standard fee. Outliers are
// preserved for investigation, never auto-rejected.

import { normalizeNumeric, numbersAgree } from "@/lib/normalize"
import type { PublicationState } from "@/lib/publication"

export type CardholderType = "primary" | "supplementary" | "unknown"
export type FeeKind =
  | "standard_annual_fee"
  | "first_year_fee"
  | "fee_waiver"
  | "membership_fee"
  | "unknown"
export type EffectiveScope = "current" | "historical" | "unknown"

export interface AnnualFeeClassification {
  cardholderType: CardholderType
  feeKind: FeeKind
  effectiveScope: EffectiveScope
}

function has(text: string, needles: readonly string[]): boolean {
  return needles.some((n) => text.includes(n))
}

export function classifyAnnualFee(
  payload: Record<string, unknown>,
  snippet: string,
): AnnualFeeClassification {
  const amount = normalizeNumeric(payload["amountHkd"])
  const lower = snippet.toLowerCase()

  // cardholder_type — a PRIMARY marker wins over a supplementary one when
  // both appear, because these official snippets read "Basic Card annual fee
  // HK$2,200 … (Supplementary Card HK$X)" and the extracted amount is the
  // Basic (primary) fee. A bare "annual fee HK$X" defaults to unknown (NOT
  // primary) so we never over-set the primary fee from an ambiguous claim.
  const primary = has(lower, ["basic card", "primary card", "principal card"]) ||
    has(snippet, ["主卡", "基本卡"])
  const supplementary = has(lower, ["supplementary", "additional card"]) ||
    has(snippet, ["附屬", "副卡", "附属"])
  const cardholderType: CardholderType = primary
    ? "primary"
    : supplementary
      ? "supplementary"
      : "unknown"

  // fee_kind
  const firstYear = has(lower, ["first year", "1st year", "first-year"]) ||
    has(snippet, ["首年", "第一年"])
  const waiver = has(lower, ["waiv", "fee free", "annual fee free"]) ||
    has(snippet, ["豁免", "免年費", "免首年", "免年会"])
  const joining = has(lower, ["joining fee", "one-time", "one time membership"]) ||
    has(snippet, ["入會費", "入会费"])
  const annualWord = has(lower, ["annual", "per year", "each year", "/year"]) ||
    has(snippet, ["年費", "每年", "年会"])

  let feeKind: FeeKind
  if (amount === 0) {
    // A HK$0 is a waiver / first-year concession, NOT a standard fee (§3E).
    if (firstYear) feeKind = "first_year_fee"
    else if (waiver) feeKind = "fee_waiver"
    else feeKind = "standard_annual_fee" // genuinely no-fee card
  } else if (amount != null) {
    // A one-time joining/membership fee (not recurring) is distinct from the
    // recurring annual fee. "Annual membership fee" IS the annual fee.
    if (joining && !annualWord) feeKind = "membership_fee"
    else feeKind = "standard_annual_fee"
  } else {
    feeKind = "unknown"
  }

  // effective_scope — default current unless the text flags a past value.
  const historical = has(lower, ["previously", "formerly", "used to", "was hk"]) ||
    has(snippet, ["以往", "過往", "舊制", "原本"])
  const effectiveScope: EffectiveScope = historical ? "historical" : "current"

  return { cardholderType, feeKind, effectiveScope }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provisional publication policy (§3E).

export interface AnnualFeeClaimInput {
  claimId: string
  sourceId: string
  amountHkd: number | null
  isOfficial: boolean
  sourcePriority: number
  classification: AnnualFeeClassification
}

export type AnnualFeePolicyOutcome =
  | "official_clean" // policy 1, no conflict
  | "official_conflict" // policy 1, conflict remains
  | "third_party_agreed" // policy 2
  | "insufficient" // policy 3 — do not replace

export interface AnnualFeePublicationDecision {
  outcome: AnnualFeePolicyOutcome
  // Whether to write cards.annual_fee_hkd + annual_fee_publish_authority.
  updateCard: boolean
  newValueHkd: number | null
  publishAuthority: PublicationState | null
  needsReview: boolean
  reviewReason: string
  chosenClaimId: string | null
  // Standard current claims that disagree with the chosen value — preserved
  // for investigation, NEVER auto-rejected (§3E: keep the HK$9,500 outlier).
  retainedConflictClaimIds: string[]
  // First-year / waiver claims — modeled as waivers, not conflicts.
  waiverClaimIds: string[]
}

function pickHighestAuthority(
  claims: readonly AnnualFeeClaimInput[],
): AnnualFeeClaimInput | null {
  // Lower sourcePriority number = higher authority (1 official T&C … 8 note).
  return (
    [...claims].sort(
      (a, b) =>
        a.sourcePriority - b.sourcePriority ||
        a.claimId.localeCompare(b.claimId),
    )[0] ?? null
  )
}

export function evaluateAnnualFeePublication(
  claims: readonly AnnualFeeClaimInput[],
): AnnualFeePublicationDecision {
  const waivers = claims.filter(
    (c) =>
      c.classification.feeKind === "first_year_fee" ||
      c.classification.feeKind === "fee_waiver",
  )

  // Standard, current-or-unknown, not-supplementary claims are candidates for
  // conflict detection. Value-setting further requires cardholderType=primary.
  const standardCurrent = claims.filter(
    (c) =>
      c.classification.feeKind === "standard_annual_fee" &&
      c.classification.effectiveScope !== "historical" &&
      c.classification.cardholderType !== "supplementary" &&
      c.amountHkd != null,
  )
  const settable = standardCurrent.filter(
    (c) => c.classification.cardholderType === "primary",
  )

  const base = {
    waiverClaimIds: waivers.map((c) => c.claimId),
  }

  const retainedAgainst = (
    chosen: AnnualFeeClaimInput,
    value: number,
  ): string[] =>
    standardCurrent
      .filter(
        (c) =>
          c.claimId !== chosen.claimId &&
          c.amountHkd != null &&
          !numbersAgree(c.amountHkd, value),
      )
      .map((c) => c.claimId)

  // Policy 1 — a current official primary standard fee.
  const officialSettable = settable.filter((c) => c.isOfficial)
  if (officialSettable.length > 0) {
    const chosen = pickHighestAuthority(officialSettable)!
    const value = chosen.amountHkd!
    const retained = retainedAgainst(chosen, value)
    const conflict = retained.length > 0
    return {
      ...base,
      outcome: conflict ? "official_conflict" : "official_clean",
      updateCard: true,
      newValueHkd: value,
      publishAuthority: conflict
        ? "provisional_conflict_pending_review"
        : "provisional_pending_review",
      needsReview: conflict,
      reviewReason: conflict
        ? `official primary standard fee HK$${value} published provisionally; ` +
          `${retained.length} conflicting standard claim(s) preserved for review`
        : `official primary standard fee HK$${value} published provisionally`,
      chosenClaimId: chosen.claimId,
      retainedConflictClaimIds: retained,
    }
  }

  // Policy 2 — two independent reliable third parties agree, no official.
  if (settable.length >= 2) {
    // Find the largest cluster of settable claims that agree on a value and
    // come from ≥2 distinct sources.
    for (const anchor of pickOrderedByAuthority(settable)) {
      const cluster = settable.filter(
        (c) => c.amountHkd != null && numbersAgree(c.amountHkd!, anchor.amountHkd!),
      )
      const distinctSources = new Set(cluster.map((c) => c.sourceId))
      if (distinctSources.size >= 2) {
        const value = anchor.amountHkd!
        const retained = retainedAgainst(anchor, value)
        return {
          ...base,
          outcome: "third_party_agreed",
          updateCard: true,
          newValueHkd: value,
          publishAuthority: "provisional_pending_review",
          needsReview: true,
          reviewReason:
            `no official source; ${distinctSources.size} independent third ` +
            `parties agree on HK$${value} — published provisionally, requires review`,
          chosenClaimId: anchor.claimId,
          retainedConflictClaimIds: retained,
        }
      }
    }
  }

  // Policy 3 — no authoritative evidence. Do NOT replace the existing value.
  return {
    ...base,
    outcome: "insufficient",
    updateCard: false,
    newValueHkd: null,
    publishAuthority: null,
    needsReview: true,
    reviewReason:
      "no current official primary standard fee and no two agreeing third " +
      "parties — existing value left unchanged, review task created",
    chosenClaimId: null,
    retainedConflictClaimIds: standardCurrent.map((c) => c.claimId),
  }
}

function pickOrderedByAuthority(
  claims: readonly AnnualFeeClaimInput[],
): AnnualFeeClaimInput[] {
  return [...claims].sort(
    (a, b) =>
      a.sourcePriority - b.sourcePriority || a.claimId.localeCompare(b.claimId),
  )
}
