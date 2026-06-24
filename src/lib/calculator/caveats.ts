import type { TransactionContext } from "@/lib/schemas/transaction"
import type { RewardResult } from "@/lib/schemas/result"
import type { ResolvedRule } from "./resolved-rule"

// Per calculator-semantics §9, caveat synthesis lives outside the pure
// calculator. The calculator emits a result; this module decorates it
// with human-readable caveats for the /calculator-test UI (and later
// /projection-test).
//
// Pure. Deterministic. Inputs only — no DB, no clock.

export type CaveatInput = {
  txn: TransactionContext
  result: RewardResult
  cardRules: ResolvedRule[]
}

export function synthesizeCaveats(input: CaveatInput): string[] {
  const { txn, result, cardRules } = input
  const out: string[] = []

  // Low category resolution confidence — the ranking would change if the
  // resolver guessed wrong about what bucket this merchant falls into.
  if (txn.merchantName && txn.categoryResolutionConfidence !== undefined) {
    const c = txn.categoryResolutionConfidence
    if (c < 0.6) {
      out.push(
        `Merchant "${txn.merchantName}" → category "${txn.categorySlug}" with confidence ${c.toFixed(2)} (low). Ranking may shift if the category is wrong.`,
      )
    } else if (c < 0.85) {
      out.push(
        `Merchant "${txn.merchantName}" → category "${txn.categorySlug}" with confidence ${c.toFixed(2)} (medium). Some banks may code this merchant differently.`,
      )
    }
  }

  // Calculator confidence floor.
  if (result.confidence === "low") {
    out.push(
      `Overall confidence is low (${result.confidenceScore.toFixed(2)}). Review the cited sources before relying on this number.`,
    )
  }

  // No reward at all and the card actually has rules — something gated it out.
  if (result.rewardValueHkd === 0 && cardRules.length > 0) {
    const hasGated = cardRules.some(
      (r) =>
        r.requiresActivation ||
        r.requiresRegistration ||
        r.requiresSelectedCategory ||
        r.campaignId !== null,
    )
    if (hasGated) {
      out.push(
        "No reward earned. This card has gated rules (activation / selected-category / campaign) that may apply once opted in.",
      )
    } else {
      out.push("No reward rules matched this transaction.")
    }
  }

  // Caller passed an amount but no online/fx/region info — some rules can't fire.
  if (
    txn.isOnline === undefined ||
    txn.isForeignCurrency === undefined ||
    txn.countryRegion === undefined ||
    txn.countryRegion === "UNKNOWN"
  ) {
    const missing: string[] = []
    if (txn.isOnline === undefined) missing.push("online")
    if (txn.isForeignCurrency === undefined) missing.push("foreign currency")
    if (txn.countryRegion === undefined || txn.countryRegion === "UNKNOWN") {
      missing.push("merchant region")
    }
    out.push(
      `Transaction has unknown ${missing.join(" / ")} — bonus rules that depend on these dimensions are conservatively skipped.`,
    )
  }

  return out
}
