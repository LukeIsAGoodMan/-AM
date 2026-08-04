// Stage 1B core (P18 · D30) — persistent rule identity: stable scope key +
// deterministic legacy backfill. Spec §6.
//
// This module is PURE (no DB, no I/O) so the determinism / 1:1 / no-merge
// guarantees are unit-testable without a live Postgres. The gated script
// scripts/backfill-rule-identities.ts is the only thing that reads/writes rows;
// it calls planLegacyBackfill() and inserts the result behind write gates.

import type { NewRuleIdentity } from "@/db/schema/extraction"

// The stable scope dimensions the identity key is derived from. This is the
// deliberately SMALL set that is NOT correctable in-place (§6A/§6B):
//   • card_id           — immutable structural anchor
//   • rule_type         — base_earn vs category_bonus vs exclusion vs cap …
//   • reward mode       — reward_formula_type + reward_currency_id
//                         (default cashback vs selectable miles mode, §6B)
//   • campaign scope    — campaign_id present ⇒ promotional, not permanent (§6B)
//   • eligibility flags — requires_registration / _activation / _selected_category
//                         (universal vs new-customer / opt-in, §6B)
//
// It deliberately EXCLUDES mutable / correctable fields — category_id
// (§6A "survive category correction"), effective dates (§6A "effective-date
// enrichment"), source_id / confidence (§6A "source-priority changes"),
// reviewer notes, and the physical row UUID (§6A/§12). Changing any of those
// must NOT change a rule's identity.
//
// KNOWN TENSION (documented, not hidden): §6A also lists "reviewer edits" among
// the things identity must survive, yet §6B requires reward-mode and campaign
// scope to distinguish genuinely different rules. We resolve it by treating a
// reward-mode / campaign-scope change as a genuinely different logical rule
// (so it MAY get a new identity on re-derivation), while ordinary corrections
// (category, dates, source, confidence, wording) never do. The physical
// backfill binds by origin_rule_id regardless, so an existing identity is never
// lost by a reviewer edit — the key only guides FUTURE re-association.
export interface RuleScopeInputs {
  cardId: string
  ruleType: string
  rewardFormulaType: string
  rewardCurrencyId: string | null
  campaignId: string | null
  requiresRegistration: boolean
  requiresActivation: boolean
  requiresSelectedCategory: boolean
}

// Minimal shape the backfill needs from a reward_rules row. A subset of the
// full RewardRule so the pure logic doesn't depend on the whole schema.
export interface BackfillableRule extends RuleScopeInputs {
  id: string
  slug: string
}

const SCOPE_KEY_VERSION = "v1"

// Deterministic, human-readable scope key. Same inputs ⇒ byte-identical string,
// regardless of object construction order. The `v1|` prefix makes a future
// scope-definition change greppable and prevents silent cross-version matches.
export function computeStableScopeKey(scope: RuleScopeInputs): string {
  const parts = [
    `card=${scope.cardId}`,
    `type=${scope.ruleType}`,
    `formula=${scope.rewardFormulaType}`,
    `currency=${scope.rewardCurrencyId ?? "∅"}`,
    `campaign=${scope.campaignId ?? "∅"}`,
    `reg=${scope.requiresRegistration ? 1 : 0}`,
    `act=${scope.requiresActivation ? 1 : 0}`,
    `selcat=${scope.requiresSelectedCategory ? 1 : 0}`,
  ]
  return `${SCOPE_KEY_VERSION}|${parts.join("|")}`
}

function toScopeInputs(rule: BackfillableRule): RuleScopeInputs {
  return {
    cardId: rule.cardId,
    ruleType: rule.ruleType,
    rewardFormulaType: rule.rewardFormulaType,
    rewardCurrencyId: rule.rewardCurrencyId,
    campaignId: rule.campaignId,
    requiresRegistration: rule.requiresRegistration,
    requiresActivation: rule.requiresActivation,
    requiresSelectedCategory: rule.requiresSelectedCategory,
  }
}

// A group of already-existing legacy rules that compute the SAME scope key.
// Surfaced by the backfill so the eventual reconciliation step (§6C, explicit
// reviewer/matcher action — NOT built here) knows which identities are
// candidates to merge. The backfill itself NEVER merges them (§6C, §12).
export interface ScopeKeyCollision {
  stableScopeKey: string
  ruleIds: string[]
}

export interface BackfillPlan {
  // One insert per rule that does not already have an identity. Exactly 1:1 —
  // never fewer (no merge), never more (no duplicate identities). Ordered
  // deterministically by origin rule id.
  inserts: NewRuleIdentity[]
  // Rules skipped because they already have an identity (idempotent re-run).
  skippedExistingRuleIds: string[]
  // Distinct scope keys that map to >1 rule in the FULL rule set (existing +
  // new). Informational only — see ScopeKeyCollision.
  collisions: ScopeKeyCollision[]
}

// Build the deterministic 1:1 backfill plan. Pure and idempotent:
//   • every rule NOT in `existingOriginRuleIds` yields exactly one identity;
//   • re-running with those ids now present yields zero new inserts;
//   • two rules with the same scope key still produce two identities (no merge,
//     no nondeterministic LIMIT 1 — §6C/§12).
export function planLegacyBackfill(
  rules: BackfillableRule[],
  existingOriginRuleIds: ReadonlySet<string> = new Set(),
): BackfillPlan {
  // Deterministic order by origin rule id — output is independent of the order
  // the caller read rows from the DB.
  const ordered = [...rules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const inserts: NewRuleIdentity[] = []
  const skippedExistingRuleIds: string[] = []
  const keyToRuleIds = new Map<string, string[]>()

  for (const rule of ordered) {
    const scope = toScopeInputs(rule)
    const stableScopeKey = computeStableScopeKey(scope)

    // Track collisions across the FULL set (existing + new) for reporting.
    const bucket = keyToRuleIds.get(stableScopeKey)
    if (bucket) bucket.push(rule.id)
    else keyToRuleIds.set(stableScopeKey, [rule.id])

    if (existingOriginRuleIds.has(rule.id)) {
      skippedExistingRuleIds.push(rule.id)
      continue
    }

    inserts.push({
      cardId: rule.cardId,
      originRuleId: rule.id,
      stableScopeKey,
      status: "legacy_unreconciled",
      // Durable audit — survives an ON DELETE SET NULL of origin_rule_id and
      // records exactly what the key was derived from (§6C).
      auditMetadata: {
        origin: {
          ruleId: rule.id,
          ruleSlug: rule.slug,
        },
        scopeInputs: scope,
        backfill: {
          kind: "legacy_deterministic",
          scopeKeyVersion: SCOPE_KEY_VERSION,
        },
      },
    })
  }

  const collisions: ScopeKeyCollision[] = [...keyToRuleIds.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([stableScopeKey, ruleIds]) => ({ stableScopeKey, ruleIds }))

  return { inserts, skippedExistingRuleIds, collisions }
}
