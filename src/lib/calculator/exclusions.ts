import type { ResolvedRule } from "./resolved-rule"

// PRD §8.2 step 4 + §8.4.
//
// An exclusion is a rule with ruleType='exclusion' and appliesTo populated.
// When such a rule matches the transaction (via the same matches() filters
// used for any rule), it disables every other matched candidate whose own
// ruleType appears in its appliesTo list.
//
// Crucially, base_earn is NOT in appliesTo for the canonical PRD §8.4 tax
// case — so a tax-payment exclusion strips category/online/overseas bonuses
// but base earn is still credited. That's the M4 ★ checkpoint test.

export function applyExclusions(matched: ResolvedRule[]): ResolvedRule[] {
  const exclusions = matched.filter((r) => r.ruleType === "exclusion")
  if (exclusions.length === 0) {
    return matched.filter((r) => r.ruleType !== "exclusion")
  }

  const disabled = new Set<string>()
  for (const ex of exclusions) {
    if (ex.appliesTo === null || ex.appliesTo.length === 0) continue
    for (const c of matched) {
      if (c.ruleId === ex.ruleId) continue
      if (disabled.has(c.ruleId)) continue
      if (ex.appliesTo.includes(c.ruleType)) {
        disabled.add(c.ruleId)
      }
    }
  }

  return matched.filter(
    (r) => r.ruleType !== "exclusion" && !disabled.has(r.ruleId),
  )
}
