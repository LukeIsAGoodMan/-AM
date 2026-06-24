import type { TransactionContext } from "@/lib/schemas/transaction"
import type { ResolvedRule } from "./resolved-rule"
import type { UserCardContext } from "./calculate"
import { matches } from "./matches"
import { applyRuleWithCap } from "./apply-cap"

// Per-rule decision trace for the /calculator-test "Why this lost" view.
//
// Mirrors the pure-calculator pipeline (calculate.ts) step-by-step, but
// instead of just folding survivors into a reward total, it records the
// outcome for every rule:
//   - which step it died at (status / match / activation / selectedCategory
//     / campaign / excluded / capExhausted / zeroReward)
//   - if it survived, the reward it produced
//
// Side-effect-free; safe to import from client code (no DB access).
//
// Not used by the main calculate() — keeping this orthogonal so the hot
// path stays minimal. If we ever wanted explanation always-on, fold the
// two together; today the test page is the only caller.

export type RuleOutcome =
  | { kind: "not_approved" }
  | { kind: "no_match_category"; ruleValue: string; txnValue: string | undefined }
  | { kind: "no_match_online"; ruleValue: boolean; txnValue: boolean | undefined }
  | { kind: "no_match_overseas"; ruleValue: boolean; txnValue: boolean | undefined }
  | { kind: "no_match_fx"; ruleValue: boolean; txnValue: boolean | undefined }
  | { kind: "needs_activation" }
  | { kind: "needs_selected_category"; ruleCategory: string | null }
  | { kind: "needs_campaign_opt_in"; campaignId: string }
  | { kind: "excluded_by"; byRuleId: string; byRuleName: string }
  | { kind: "zero_reward"; reason: "cap_exhausted" | "formula_zero" }
  | { kind: "included"; rewardHkd: number; rewardUnits: number }

export type RuleExplanation = {
  rule: ResolvedRule
  outcome: RuleOutcome
}

export function explainCalculate(
  rules: ResolvedRule[],
  txn: TransactionContext,
  userContext?: UserCardContext,
): RuleExplanation[] {
  const capUsage = userContext?.capUsage ?? {}
  const activatedRuleIds = new Set(userContext?.activatedRuleIds ?? [])
  const activatedCampaignIds = new Set(userContext?.activatedCampaignIds ?? [])
  const selectedCategorySlugs = new Set(
    userContext?.selectedCategorySlugs ?? [],
  )

  // Pass 1: resolve each rule's gate outcome (without exclusion logic yet).
  type Stage = "alive" | "dead"
  type Trace = {
    rule: ResolvedRule
    stage: Stage
    outcome: RuleOutcome | null
  }
  const traces: Trace[] = rules.map((r) => ({
    rule: r,
    stage: "alive" as Stage,
    outcome: null as RuleOutcome | null,
  }))

  for (const t of traces) {
    const r = t.rule
    if (r.status !== "approved") {
      t.stage = "dead"
      t.outcome = { kind: "not_approved" }
      continue
    }
    // matches() returns true/false but doesn't tell us *which* condition
    // failed. Re-check each condition independently to get a useful reason.
    if (r.categorySlug !== null && txn.categorySlug !== r.categorySlug) {
      t.stage = "dead"
      t.outcome = {
        kind: "no_match_category",
        ruleValue: r.categorySlug,
        txnValue: txn.categorySlug,
      }
      continue
    }
    if (r.isOnline !== null && txn.isOnline !== r.isOnline) {
      t.stage = "dead"
      t.outcome = {
        kind: "no_match_online",
        ruleValue: r.isOnline,
        txnValue: txn.isOnline,
      }
      continue
    }
    if (r.isOverseas !== null) {
      const txnOverseas = deriveIsOverseas(txn)
      if (txnOverseas !== r.isOverseas) {
        t.stage = "dead"
        t.outcome = {
          kind: "no_match_overseas",
          ruleValue: r.isOverseas,
          txnValue: txnOverseas,
        }
        continue
      }
    }
    if (
      r.isForeignCurrency !== null &&
      txn.isForeignCurrency !== r.isForeignCurrency
    ) {
      t.stage = "dead"
      t.outcome = {
        kind: "no_match_fx",
        ruleValue: r.isForeignCurrency,
        txnValue: txn.isForeignCurrency,
      }
      continue
    }
    // Sanity check: matches() must agree. If they disagree the pipelines are
    // out of sync and the test page would mislead — better to crash.
    if (!matches(r, txn)) {
      throw new Error(
        `explainCalculate disagrees with matches() for rule ${r.ruleId}`,
      )
    }
    if (
      (r.requiresActivation || r.requiresRegistration) &&
      !activatedRuleIds.has(r.ruleId)
    ) {
      t.stage = "dead"
      t.outcome = { kind: "needs_activation" }
      continue
    }
    if (r.requiresSelectedCategory) {
      if (r.categorySlug === null || !selectedCategorySlugs.has(r.categorySlug)) {
        t.stage = "dead"
        t.outcome = {
          kind: "needs_selected_category",
          ruleCategory: r.categorySlug,
        }
        continue
      }
    }
    if (r.campaignId !== null && !activatedCampaignIds.has(r.campaignId)) {
      t.stage = "dead"
      t.outcome = { kind: "needs_campaign_opt_in", campaignId: r.campaignId }
      continue
    }
  }

  // Pass 2: exclusion logic. Mirror exclusions.ts — only matched (alive)
  // exclusion rules disable other matched rules whose type is in appliesTo.
  const alive = traces.filter((t) => t.stage === "alive").map((t) => t.rule)
  const exclusions = alive.filter((r) => r.ruleType === "exclusion")
  const disabledBy = new Map<string, ResolvedRule>()
  for (const ex of exclusions) {
    if (ex.appliesTo === null || ex.appliesTo.length === 0) continue
    for (const c of alive) {
      if (c.ruleId === ex.ruleId) continue
      if (disabledBy.has(c.ruleId)) continue
      if (ex.appliesTo.includes(c.ruleType)) {
        disabledBy.set(c.ruleId, ex)
      }
    }
  }
  for (const t of traces) {
    if (t.stage !== "alive") continue
    if (t.rule.ruleType === "exclusion") {
      // Exclusion rules themselves never appear in the breakdown. Show them
      // as "included" with 0 reward so the comparison view can still note
      // their presence — but mark with a special outcome.
      t.stage = "dead"
      // Reusing zero_reward.formula_zero is misleading — exclusions are a
      // distinct case. We surface them as if they were "applied" but with
      // 0 contribution; the renderer interprets ruleType==='exclusion'
      // separately.
      t.outcome = { kind: "zero_reward", reason: "formula_zero" }
      continue
    }
    const ex = disabledBy.get(t.rule.ruleId)
    if (ex) {
      t.stage = "dead"
      t.outcome = {
        kind: "excluded_by",
        byRuleId: ex.ruleId,
        byRuleName: ex.ruleName,
      }
    }
  }

  // Pass 3: surviving rules compute reward (cap + formula).
  for (const t of traces) {
    if (t.stage !== "alive") continue
    const { rewardUnits, capRemainingAfter } = applyRuleWithCap(
      t.rule,
      txn,
      capUsage,
    )
    if (rewardUnits === 0) {
      t.stage = "dead"
      t.outcome = {
        kind: "zero_reward",
        reason: capRemainingAfter === 0 ? "cap_exhausted" : "formula_zero",
      }
      continue
    }
    const rewardHkd = rewardUnits * t.rule.rewardCurrencyValueHkd
    t.outcome = { kind: "included", rewardHkd, rewardUnits }
  }

  // Stacking would only matter if two surviving rules share an exclusive
  // group. For the explanation view we still show the underlying reward
  // each rule produced before stacking; the ranked output already reflects
  // the post-stacking total. This keeps the rule-by-rule trace readable.

  return traces.map((t) => ({
    rule: t.rule,
    outcome: t.outcome ?? { kind: "included", rewardHkd: 0, rewardUnits: 0 },
  }))
}

function deriveIsOverseas(txn: TransactionContext): boolean | undefined {
  if (txn.countryRegion === undefined) return undefined
  if (txn.countryRegion === "UNKNOWN") return undefined
  return txn.countryRegion !== "HK"
}
