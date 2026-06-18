import type { TransactionContext } from "@/lib/schemas/transaction"
import type { ResolvedRule } from "./resolved-rule"

// Per PRD §8.2 step 3: a rule applies only if its flattened conditions match
// the transaction. `null` on the rule = "applies regardless of that dimension".
//
// For boolean rule fields, the transaction must explicitly satisfy the
// rule's requirement — an unknown/undefined transaction value does NOT
// satisfy a non-null rule. Better to skip a bonus than wrongly award it.

export function matches(rule: ResolvedRule, txn: TransactionContext): boolean {
  if (rule.categorySlug !== null) {
    if (txn.categorySlug !== rule.categorySlug) return false
  }

  if (rule.isOnline !== null) {
    if (txn.isOnline !== rule.isOnline) return false
  }

  if (rule.isOverseas !== null) {
    const overseas = deriveIsOverseas(txn)
    if (overseas !== rule.isOverseas) return false
  }

  if (rule.isForeignCurrency !== null) {
    if (txn.isForeignCurrency !== rule.isForeignCurrency) return false
  }

  return true
}

// Derived: a transaction is "overseas" if its merchant region is not HK.
// Returns undefined if region is unknown — caller treats that as a non-match
// for non-null rule.isOverseas.
function deriveIsOverseas(txn: TransactionContext): boolean | undefined {
  if (txn.countryRegion === undefined) return undefined
  if (txn.countryRegion === "UNKNOWN") return undefined
  return txn.countryRegion !== "HK"
}
