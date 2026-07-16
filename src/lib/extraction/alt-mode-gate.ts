// Alternate-reward-mode publication gate (§3D).
//
// After the §3A aggregator fix, a card's second reward formula (e.g. Blue
// Cash's HK$6 = 1 Asia Mile alongside its 1.2% cashback base) lands in its
// OWN cross-check group. Correct grouping does NOT authorize publication. A
// single-source alternate mode must become an INACTIVE candidate — preserved,
// review-tasked, and kept out of the calculator — until an official source or
// a reviewer approves it.
//
// The canary case: Blue Cash HK$6=1 mile, single mrmiles source, no official
// backing → candidate, is_active_for_calculator=false, review task created.
// The calculator keeps using the 1.2% cashback base.

export type AltModeKind =
  | "default" // matches the card's primary mode — NOT an alt mode
  | "selectable_reward"
  | "points_conversion"
  | "miles_transfer"
  | "promotional"
  | "third_party_interpretation"

export interface AltModeInput {
  formulaType: string
  rewardCurrency: string | null
  // The card's default/base reward mode (from its base_earn group/rule).
  primaryFormulaType: string | null
  primaryRewardCurrency: string | null
  supportingSourceCount: number
  // At least one supporting source is an official / issuer document.
  hasOfficialSource: boolean
  snippets: readonly string[]
}

export interface AltModeDecision {
  isAltMode: boolean
  kind: AltModeKind
  // true = materialize as an INACTIVE candidate + create a review task.
  gateToCandidate: boolean
  reason: string | null
}

const MILES_CURRENCIES = ["asia_miles", "avios", "krisflyer", "miles"]

function canon(s: string | null): string | null {
  return s == null ? null : s.trim().toLowerCase()
}

function classify(input: AltModeInput): AltModeKind {
  const currency = canon(input.rewardCurrency)
  const text = input.snippets.join(" ").toLowerCase()

  if (
    /select|choose|opt[- ]?in|自選|選擇|轉換獎賞|reward mode/.test(text)
  ) {
    return "selectable_reward"
  }
  if (/promo|promotion|limited[- ]?time|限時|期間限定|登記後/.test(text)) {
    return "promotional"
  }
  if (currency && MILES_CURRENCIES.some((m) => currency.includes(m))) {
    return "miles_transfer"
  }
  if (input.formulaType === "points_per_hkd" || input.formulaType === "tiered_points") {
    return "points_conversion"
  }
  if (input.supportingSourceCount <= 1 && !input.hasOfficialSource) {
    return "third_party_interpretation"
  }
  return "points_conversion"
}

export function evaluateAltMode(input: AltModeInput): AltModeDecision {
  // No primary to compare against → can't classify as an alternate; defer.
  const isAltMode =
    input.primaryFormulaType != null &&
    (canon(input.formulaType) !== canon(input.primaryFormulaType) ||
      canon(input.rewardCurrency) !== canon(input.primaryRewardCurrency))

  if (!isAltMode) {
    return { isAltMode: false, kind: "default", gateToCandidate: false, reason: null }
  }

  const kind = classify(input)

  // Gate to candidate only when it's single-source AND unverified by an
  // official source. A multi-source or officially-backed alt mode may
  // publish through the normal authority path (still not via this gate).
  const gateToCandidate =
    input.supportingSourceCount <= 1 && !input.hasOfficialSource

  if (!gateToCandidate) {
    return {
      isAltMode: true,
      kind,
      gateToCandidate: false,
      reason: `alternate ${kind} mode has ${input.supportingSourceCount} source(s)` +
        (input.hasOfficialSource ? " incl. official" : "") +
        " — eligible for normal authority review, not force-gated",
    }
  }

  return {
    isAltMode: true,
    kind,
    gateToCandidate: true,
    reason:
      `alternate ${kind} mode (${input.formulaType}` +
      `${input.rewardCurrency ? `:${input.rewardCurrency}` : ""}) is single-source ` +
      `and not officially verified — held as inactive candidate pending ` +
      `official verification or reviewer approval`,
  }
}
