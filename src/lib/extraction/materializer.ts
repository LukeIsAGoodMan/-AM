import { and, eq, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm"
import { db } from "@/db/client"
import {
  cards,
  categories,
  rewardCurrencies,
  rewardRules,
  sourceDocuments,
} from "@/db/schema/catalog"
import {
  crossCheckGroups,
  rewardRuleSources,
  reviewTasks,
  sourceClaims,
} from "@/db/schema/extraction"
import { stripFormulaSuffix } from "@/lib/extraction/aggregator"
import { decideEarnRateGate } from "@/lib/extraction/earn-rate-gates"
import { writeAnnualFee } from "@/lib/extraction/annual-fee-writer"
import type { PublicationState } from "@/lib/publication"

// P7 — materialize an approved cross_check_group into a reward_rule (+
// reward_rule_sources rows for every supporting source).
//
// Triggered two ways:
//   1. Inline from resolveReviewTask('approve'): the reviewer-driven
//      flow. After supporting claims flip to status='approved' and the
//      task resolves, materialize the group so /rules shows the new
//      rule immediately.
//   2. CLI bulk: pnpm p7:materialize -- --card-slug X. For
//      backfills or for materializing a batch where approval happened
//      manually.
//
// Idempotency:
//   - Gate: group.approvedRuleId IS NULL. Once set, never touched again.
//   - Slug collision: if a rule with the synthesized slug already exists
//     we skip with kind='skipped' rather than throw, so a re-run after a
//     partial failure is safe.
//
// Scope:
//   - earn_rate → reward_rule. Cap conditions are stitched in if a
//     matching cap group (same card_id, same key_dimension) is itself
//     eligible (canonical_payload non-null + status agreed/single_source).
//   - exclusion → reward_rule with rule_type='exclusion' and appliesTo
//     copied from payload.
//   - Other claim_types (annual_fee → cards table, welcome_offer →
//     welcome_offers table, eligibility/category_definition →
//     qualitativeFeatures) need their own destinations. P7 v1 skips
//     them with kind='skipped'/reason='claim_type not supported by P7'.
//     A follow-up milestone will handle each.

export type MaterializeOutcome =
  | {
      kind: "created"
      groupId: string
      ruleId: string
      ruleSlug: string
      ruleType: string
      capStitched: boolean
      supportingSourceCount: number
      // P18 (D28): the authority the rule was published under + whether it
      // earns in the calculator. Candidates (§3D) land inactive.
      publishAuthority: PublicationState
      isActiveForCalculator: boolean
    }
  | {
      kind: "skipped"
      groupId: string
      reason: string
      existingRuleId?: string
      // P18 (§3C): set when an inferred-category block also deactivated a
      // pre-existing stale rule (e.g. Blue Cash's legacy insurance 1.2%).
      deactivatedRuleSlug?: string
    }
  | {
      // P18 (§3E): annual_fee groups update cards.annual_fee_hkd, not a
      // reward_rule — reported with the before/after for the audit.
      kind: "annual_fee"
      groupId: string
      cardId: string
      updated: boolean
      oldValueHkd: number | null
      newValueHkd: number | null
      authority: string
      reason: string
      retainedConflictClaimIds: string[]
      waiverClaimIds: string[]
    }
  | {
      kind: "failed"
      groupId: string
      error: string
    }

export type MaterializeScope = {
  cardSlugs?: string[]
  // Limit to specific groups (CLI may target one). If omitted, every
  // eligible group in the cardSlugs scope is processed.
  groupIds?: string[]
}

export type MaterializeSummary = {
  considered: number
  created: number
  skipped: number
  failed: number
  outcomes: MaterializeOutcome[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — single group (inline from resolveReviewTask)
// ─────────────────────────────────────────────────────────────────────────────

export async function materializeGroup(
  groupId: string,
  opts: { dryRun?: boolean } = {},
): Promise<MaterializeOutcome> {
  try {
    const group = (
      await db
        .select()
        .from(crossCheckGroups)
        .where(eq(crossCheckGroups.id, groupId))
        .limit(1)
    )[0]
    if (!group) return { kind: "failed", groupId, error: "group not found" }
    return await materializeOneInternal(group, opts)
  } catch (err) {
    return { kind: "failed", groupId, error: (err as Error).message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — bulk (CLI)
// ─────────────────────────────────────────────────────────────────────────────

export async function materializeApprovedGroups(
  scope: MaterializeScope,
  opts: { dryRun?: boolean } = {},
): Promise<MaterializeSummary> {
  const conditions: SQL[] = [
    // Eligibility: not yet materialized, verdict is agreeable (conflict
    // reward-rule groups need a reviewer pick first via edit_canonical +
    // manual status flip). EXCEPTION (§3E): annual_fee groups are eligible
    // even in `conflict` — the authority policy resolves the conflict itself
    // (official source wins provisionally, outliers retained for review).
    isNull(crossCheckGroups.approvedRuleId),
    or(
      inArray(crossCheckGroups.status, ["agreed", "single_source"]),
      and(
        eq(crossCheckGroups.claimType, "annual_fee"),
        inArray(crossCheckGroups.status, ["agreed", "single_source", "conflict"]),
      ),
    )!,
  ]
  if (scope.groupIds && scope.groupIds.length > 0) {
    conditions.push(inArray(crossCheckGroups.id, scope.groupIds))
  }

  // Resolve card_slug → card_id upfront (groups table has card_id, not
  // slug). Returning early on empty match keeps us out of a noop SELECT.
  if (scope.cardSlugs && scope.cardSlugs.length > 0) {
    const ids = (
      await db
        .select({ id: cards.id })
        .from(cards)
        .where(inArray(cards.slug, scope.cardSlugs))
    ).map((r) => r.id)
    if (ids.length === 0) {
      return { considered: 0, created: 0, skipped: 0, failed: 0, outcomes: [] }
    }
    conditions.push(inArray(crossCheckGroups.cardId, ids))
  }

  const groups = await db
    .select()
    .from(crossCheckGroups)
    .where(and(...conditions))

  const summary: MaterializeSummary = {
    considered: groups.length,
    created: 0,
    skipped: 0,
    failed: 0,
    outcomes: [],
  }
  for (const g of groups) {
    const outcome = await materializeOneInternal(g, opts)
    summary.outcomes.push(outcome)
    if (outcome.kind === "created") summary.created += 1
    else if (outcome.kind === "annual_fee")
      outcome.updated ? (summary.created += 1) : (summary.skipped += 1)
    else if (outcome.kind === "skipped") summary.skipped += 1
    else summary.failed += 1
  }
  return summary
}

// ─────────────────────────────────────────────────────────────────────────────
// Core — materialize one group (called by both public entry points)
// ─────────────────────────────────────────────────────────────────────────────

type LoadedGroup = typeof crossCheckGroups.$inferSelect

async function materializeOneInternal(
  group: LoadedGroup,
  opts: { dryRun?: boolean } = {},
): Promise<MaterializeOutcome> {
  if (group.approvedRuleId) {
    return {
      kind: "skipped",
      groupId: group.id,
      reason: "already materialized",
      existingRuleId: group.approvedRuleId,
    }
  }
  // P18 (§3E): annual_fee updates cards.annual_fee_hkd through the authority
  // policy, not a reward_rule. Route it FIRST — the policy resolves conflicts
  // itself (a current official source wins provisionally), so a `conflict`
  // verdict must NOT block it the way it blocks reward-rule materialization.
  if (group.claimType === "annual_fee") {
    if (!["agreed", "single_source", "conflict"].includes(group.status)) {
      return {
        kind: "skipped",
        groupId: group.id,
        reason: `annual_fee verdict '${group.status}' not processable`,
      }
    }
    const res = await writeAnnualFee(group, { dryRun: opts.dryRun })
    return {
      kind: "annual_fee",
      groupId: group.id,
      cardId: res.cardId,
      updated: res.updated,
      oldValueHkd: res.oldValueHkd,
      newValueHkd: res.newValueHkd,
      authority: res.authority,
      reason: res.reason,
      retainedConflictClaimIds: res.retainedConflictClaimIds,
      waiverClaimIds: res.waiverClaimIds,
    }
  }

  if (!group.canonicalPayload) {
    return {
      kind: "skipped",
      groupId: group.id,
      reason: "no canonical_payload",
    }
  }
  if (group.status !== "agreed" && group.status !== "single_source") {
    return {
      kind: "skipped",
      groupId: group.id,
      reason: `verdict '${group.status}' is not approve-eligible`,
    }
  }
  if (!supportsP7(group.claimType)) {
    return {
      kind: "skipped",
      groupId: group.id,
      reason: `claim_type '${group.claimType}' not supported by P7 (see materializer doc)`,
    }
  }

  const payload = group.canonicalPayload as Record<string, unknown>

  // Pull supporting claims + their sources (one query) so we can choose
  // the primary source and build the reward_rule_sources join rows.
  const supports = await loadSupportingClaimsWithSources(
    group.supportingClaimIds,
  )
  if (supports.length === 0) {
    return {
      kind: "skipped",
      groupId: group.id,
      reason: "group has no supporting claims with valid sources",
    }
  }
  // Primary source = lowest priority number (P1 official PDF wins over P5
  // competitor). Stable order: tiebreak by claim id.
  const primary = [...supports].sort((a, b) => {
    if (a.sourcePriority !== b.sourcePriority)
      return a.sourcePriority - b.sourcePriority
    return a.claimId.localeCompare(b.claimId)
  })[0]!

  const ruleSlug = synthesizeSlug(group, payload)

  // Slug collision = the group has been materialized before (or hand-curated
  // YAML already uses that slug). Either way, don't insert a duplicate.
  const existing = (
    await db
      .select({ id: rewardRules.id })
      .from(rewardRules)
      .where(eq(rewardRules.slug, ruleSlug))
      .limit(1)
  )[0]
  if (existing) {
    // Mark the group as materialized against the existing rule so future
    // bulk runs don't keep retrying this group.
    await db
      .update(crossCheckGroups)
      .set({ approvedRuleId: existing.id, updatedAt: new Date() })
      .where(eq(crossCheckGroups.id, group.id))
    return {
      kind: "skipped",
      groupId: group.id,
      reason: `rule with slug '${ruleSlug}' already exists; linked group to it`,
      existingRuleId: existing.id,
    }
  }

  // Resolve foreign keys for category + currency (string slug → uuid id).
  // payload.categorySlug / currencySlug come from the P2 extractor prompt's
  // canonical taxonomy AND match the RewardFormulaSchema keys used in
  // reward_formula_payload. Category-miss is tolerable (rule lands without
  // the FK; calculator reads it as "no category restriction"). Currency-miss
  // is NOT — see the fail-fast guard below (D19).
  const categoryId = await lookupCategoryId(
    typeof payload["categorySlug"] === "string"
      ? (payload["categorySlug"] as string)
      : null,
  )
  const currencySlugInPayload =
    typeof payload["currencySlug"] === "string"
      ? (payload["currencySlug"] as string)
      : null
  const currencyId = await lookupCurrencyId(currencySlugInPayload)

  // For earn_rate, opportunistically stitch caps: primary (category exact
  // or applies_to fan-out) + card-level secondary if the card has one.
  // Exclusion claims don't have caps.
  const caps = group.claimType === "earn_rate"
    ? await loadMatchingCaps(group.cardId, group.keyDimension)
    : []

  const ruleType = deriveRuleType(group.claimType, payload)

  // P16 (D22): dedup against hand-curated YAML rules. If the card already
  // has an approved non-xchk__, non-campaign rule that covers the same
  // (rule_type, category_id) combo, the extractor is re-deriving a fact
  // already encoded in YAML. Materializing anyway would double-count
  // additively (audit finding: HSBC Red / BOC Chill online_local 4% ×
  // yaml + 4% × xchk = 8% effective). Skip; link group to the yaml rule
  // so future re-runs don't retry.
  if (group.claimType === "earn_rate") {
    const yamlRule = await findMatchingYamlBaselineRule(
      group.cardId,
      ruleType,
      categoryId,
    )
    if (yamlRule) {
      await db
        .update(crossCheckGroups)
        .set({ approvedRuleId: yamlRule.id, updatedAt: new Date() })
        .where(eq(crossCheckGroups.id, group.id))
      return {
        kind: "skipped",
        groupId: group.id,
        reason: `dedup against yaml rule '${yamlRule.slug}' (same rule_type + category)`,
        existingRuleId: yamlRule.id,
      }
    }
  }

  const ruleName = synthesizeRuleName(group, payload)
  // The discriminator lives in src/lib/schemas/formula.ts:
  //   simple_percent | points_per_hkd | tiered_percent | tiered_points | no_reward
  // Exclusion rules don't compute a reward; the YAML convention pairs
  // rule_type='exclusion' with reward_formula_type='no_reward' (the calc
  // pipeline reads appliesTo from the flat column and zeroes other rules).
  const rewardFormulaType =
    group.claimType === "exclusion"
      ? "no_reward"
      : typeof payload["rewardFormulaType"] === "string"
        ? (payload["rewardFormulaType"] as string)
        : "simple_percent"

  // Strip fields that live on the rule's flattened columns rather than
  // inside reward_formula_payload; the calculator reads them from columns.
  const formulaPayload = pickFormulaPayload(rewardFormulaType, payload)
  if (!formulaPayload) {
    return {
      kind: "skipped",
      groupId: group.id,
      reason: `payload missing required fields for reward_formula_type '${rewardFormulaType}'`,
    }
  }

  // D19: currency FK is load-bearing for points_per_hkd. Calculator's
  // rule loader fallbacks a NULL reward_currency_id to hkd_cashback + 1.0
  // HKD/mile — a miles rule with NULL currency inflates rewards ~10×.
  // Refuse; the review queue can add the currency to YAML or reclassify.
  if (rewardFormulaType === "points_per_hkd" && !currencyId) {
    return {
      kind: "skipped",
      groupId: group.id,
      reason: `currencySlug '${currencySlugInPayload ?? "(missing)"}' not in reward_currencies`,
    }
  }

  // P18 (§3C/§3D): gate earn_rate before writing. Correct grouping does NOT
  // authorize publication — a category rate inferred from inclusion language
  // is blocked (review only); a single-source alternate reward mode lands as
  // an INACTIVE candidate. Exclusions keep their auto behavior (§7).
  let publishAuthority: PublicationState = "auto"
  let isActiveForCalculator = true
  let candidateReason: string | null = null
  if (group.claimType === "earn_rate") {
    const gate = await decideEarnRateGate({
      cardId: group.cardId,
      payload,
      rewardFormulaType,
      supports: supports.map((s) => ({
        claimId: s.claimId,
        sourceId: s.sourceId,
        sourcePriority: s.sourcePriority,
      })),
    })
    if (gate.action === "block") {
      // §3C: no active calculator rule should remain for the inferred
      // category. Reconcile any pre-existing ACTIVE xchk rule on the same
      // (card, category, rule_type) — e.g. Blue Cash's legacy insurance 1.2%
      // materialized before this gate existed. yaml rules are never touched.
      const stale = await findActiveXchkRule(group.cardId, categoryId, ruleType)
      if (stale && !opts.dryRun) {
        await db
          .update(rewardRules)
          .set({
            isActiveForCalculator: false,
            publishAuthority: "reviewer_rejected",
            notes: `Deactivated by inferred-category gate: ${gate.reason}`,
            updatedAt: new Date(),
          })
          .where(eq(rewardRules.id, stale.id))
        await ensureGateReviewTask({
          group,
          taskType: "inferred_category_review",
          priority: "high",
          title: `Inferred-category rule blocked — reject or reclassify`,
          description: `${gate.reason}. Deactivated stale rule '${stale.slug}'.`,
        })
      } else if (!opts.dryRun) {
        await ensureGateReviewTask({
          group,
          taskType: "inferred_category_review",
          priority: "high",
          title: `Inferred-category rule blocked — reject or reclassify`,
          description: gate.reason,
        })
      }
      return {
        kind: "skipped",
        groupId: group.id,
        reason:
          `inferred-category gate blocked: ${gate.reason}` +
          (stale ? `; deactivated stale rule '${stale.slug}'` : ""),
        deactivatedRuleSlug: stale?.slug,
      }
    }
    if (gate.action === "candidate") {
      publishAuthority = "candidate"
      isActiveForCalculator = false
      candidateReason = gate.reason
    }
  }

  // Dry-run: report the would-be rule (incl. its publication authority)
  // without touching the DB. The canary CLI defaults to dry-run.
  if (opts.dryRun) {
    return {
      kind: "created",
      groupId: group.id,
      ruleId: "(dry-run)",
      ruleSlug,
      ruleType,
      capStitched: caps.length > 0,
      supportingSourceCount: new Set(supports.map((s) => s.sourceId)).size,
      publishAuthority,
      isActiveForCalculator,
    }
  }

  // Atomic: insert rule + insert join rows + set group.approvedRuleId.
  // Single transaction so a mid-flight failure leaves no half-materialized
  // state (group pointing at a non-existent rule, etc.).
  const ruleId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(rewardRules)
      .values({
        cardId: group.cardId,
        slug: ruleSlug,
        ruleName,
        ruleType,
        status: "approved",
        publishAuthority,
        isActiveForCalculator,
        rewardFormulaType,
        rewardFormulaPayload: formulaPayload,
        rewardCurrencyId: currencyId,
        categoryId,
        isOnline: pickBool(payload, "isOnline"),
        isOverseas: pickBool(payload, "isOverseas"),
        isForeignCurrency: pickBool(payload, "isForeignCurrency"),
        appliesTo: pickStringArray(payload, "appliesTo"),
        caps: caps.map((c) => ({
          usageKey: c.usageKey ?? ruleSlug,
          basis: c.basis,
          period: c.period ?? "transaction",
          amountHkd: c.amountHkd,
          rewardAmount: c.rewardAmount,
        })),
        confidenceScore: Number(group.aggregateConfidence).toFixed(3),
        sourceId: primary.sourceId,
        notes: `Materialized from cross_check_group ${group.id} (verdict=${group.status}, ${supports.length} supporting source${supports.length === 1 ? "" : "s"}${candidateReason ? "; CANDIDATE: " + candidateReason : ""}).`,
      })
      .returning({ id: rewardRules.id })

    if (!inserted) throw new Error("insert returned no row")
    const newRuleId = inserted.id

    // reward_rule_sources: one row per distinct source, with a
    // representative supporting claim id pointing at the first claim from
    // that source (stable: claims are loaded in priority-then-creation
    // order). Composite PK on (rule_id, source_id) handles the dedup.
    const seenSources = new Set<string>()
    const joinRows = supports
      .filter((s) => {
        if (seenSources.has(s.sourceId)) return false
        seenSources.add(s.sourceId)
        return true
      })
      .map((s) => ({
        ruleId: newRuleId,
        sourceId: s.sourceId,
        supportingClaimId: s.claimId,
      }))
    if (joinRows.length > 0) {
      await tx.insert(rewardRuleSources).values(joinRows)
    }

    await tx
      .update(crossCheckGroups)
      .set({ approvedRuleId: newRuleId, updatedAt: new Date() })
      .where(eq(crossCheckGroups.id, group.id))

    return newRuleId
  })

  // §3D: a candidate alternate mode gets a review task so a human can verify
  // or approve it before it goes active.
  if (candidateReason) {
    await ensureGateReviewTask({
      group,
      taskType: "alt_mode_candidate_review",
      priority: "normal",
      title: "Alternate reward mode candidate — verify before activating",
      description: candidateReason,
    })
  }

  return {
    kind: "created",
    groupId: group.id,
    ruleId,
    ruleSlug,
    ruleType,
    capStitched: caps.length > 0,
    supportingSourceCount: new Set(supports.map((s) => s.sourceId)).size,
    publishAuthority,
    isActiveForCalculator,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function supportsP7(claimType: string): boolean {
  // P18 (§3E): annual_fee now materializes (into cards.annual_fee_hkd via the
  // authority policy). welcome_offer / category_definition / eligibility / cap
  // still skip — Stage 2 owns welcome offers; caps stitch onto earn_rate.
  return (
    claimType === "earn_rate" ||
    claimType === "exclusion" ||
    claimType === "annual_fee"
  )
}

// P18: create a gate-generated review task (inferred-category block or
// alt-mode candidate), guarded so idempotent re-runs don't spam the queue.
async function ensureGateReviewTask(args: {
  group: LoadedGroup
  taskType: string
  priority: "normal" | "high"
  title: string
  description: string
}): Promise<void> {
  const existing = (
    await db
      .select({ id: reviewTasks.id })
      .from(reviewTasks)
      .where(
        and(
          eq(reviewTasks.subjectGroupId, args.group.id),
          eq(reviewTasks.taskType, args.taskType),
          inArray(reviewTasks.status, ["open", "in_progress"]),
        ),
      )
      .limit(1)
  )[0]
  if (existing) return
  await db.insert(reviewTasks).values({
    taskType: args.taskType,
    priority: args.priority,
    cardId: args.group.cardId,
    subjectGroupId: args.group.id,
    title: args.title,
    description: args.description,
  })
}

type SupportingClaim = {
  claimId: string
  sourceId: string
  sourcePriority: number
}

async function loadSupportingClaimsWithSources(
  claimIds: string[],
): Promise<SupportingClaim[]> {
  if (claimIds.length === 0) return []
  const rows = await db
    .select({
      claimId: sourceClaims.id,
      sourceId: sourceClaims.sourceId,
      sourcePriority: sourceDocuments.sourcePriority,
      createdAt: sourceClaims.createdAt,
    })
    .from(sourceClaims)
    .innerJoin(sourceDocuments, eq(sourceClaims.sourceId, sourceDocuments.id))
    .where(inArray(sourceClaims.id, claimIds))
  return rows
}

// rule_type per claim_type + payload shape. Mirrors the YAML conventions
// in data/cards/*.yaml so /rules + the calculator see consistent labels
// whether a rule came from hand-curated YAML or from P7 materialization.
function deriveRuleType(
  claimType: string,
  payload: Record<string, unknown>,
): string {
  if (claimType === "exclusion") return "exclusion"
  // earn_rate branches:
  const cat = typeof payload["categorySlug"] === "string"
    ? (payload["categorySlug"] as string)
    : null
  const online = payload["isOnline"] === true
  const overseas = payload["isOverseas"] === true
  const fx = payload["isForeignCurrency"] === true
  if (!cat && !online && !overseas && !fx) return "base_earn"
  if (online) return "online_bonus"
  if (overseas) return "overseas_bonus"
  if (fx) return "foreign_currency_bonus"
  return "category_bonus"
}

function synthesizeRuleName(
  group: LoadedGroup,
  payload: Record<string, unknown>,
): string {
  const rate = payload["rate"]
  const cat = payload["categorySlug"]
  const rateStr =
    typeof rate === "number" ? `${(rate * 100).toFixed(rate < 0.01 ? 2 : 1)}%` : ""
  const catStr = typeof cat === "string" ? cat : ""
  if (group.claimType === "exclusion") {
    const at = pickStringArray(payload, "appliesTo")
    return `Exclusion: ${at?.join(", ") ?? group.keyDimension}`
  }
  // earn_rate
  if (rateStr && catStr) return `${catStr} ${rateStr}`
  if (rateStr) return `Base earn (${rateStr})`
  return `Materialized — ${group.keyDimension}`
}

// Slug convention: `<card_slug>__xchk_<key_dim_sanitized>`. Distinct from
// MVP hand-curated slugs (those don't use `xchk_` prefix) so it's obvious
// at a glance whether a rule came from YAML or from the cross-check pipe.
// The cards-table slug isn't on the group; the caller resolves it. We
// derive it from the group + payload at synth time to avoid a join here.
function synthesizeSlug(
  group: LoadedGroup,
  _payload: Record<string, unknown>,
): string {
  // Sanitize key_dimension to slug-safe chars: lowercase, replace = with _,
  // strip anything else.
  const dim = group.keyDimension
    .toLowerCase()
    .replace(/=/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
  // Card slug is not on the group struct, but the slug must be unique
  // anyway — embed the group id prefix as a backup uniqueness device. We
  // rely on the eq() lookup against the synthesized slug to detect
  // collisions; the prefix's purpose is just to keep slugs readable.
  return `xchk__${group.claimType}__${dim}__${group.id.slice(0, 8)}`
}

function pickBool(p: Record<string, unknown>, key: string): boolean | null {
  const v = p[key]
  return typeof v === "boolean" ? v : null
}

function pickStringArray(
  p: Record<string, unknown>,
  key: string,
): string[] | null {
  const v = p[key]
  if (!Array.isArray(v)) return null
  const out = v.filter((x) => typeof x === "string") as string[]
  return out.length === v.length ? out : null
}

// The reward_formula_payload jsonb holds the schema-specific fields the
// calculator's formula step expects (per src/lib/schemas/formula.ts). The
// flattened columns (categoryId, isOnline, capAmountHkd, etc.) duplicate
// some of these; strip duplicates so the jsonb only contains the
// formula-shape fields the calculator dispatches on.
//
// IMPORTANT: each formula type's required fields per Zod schema —
// simple_percent { rate }, points_per_hkd { points, perHkd, currencySlug },
// no_reward {}. Missing required fields will break the calculator at
// rule-load time (RewardFormulaSchema.parse throws) — refuse here instead
// so a partial rule doesn't 500 the /rules page. Currency-FK validation
// happens in the caller (D19); this just guards the payload shape.
function pickFormulaPayload(
  rewardFormulaType: string,
  src: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = { type: rewardFormulaType }
  if (rewardFormulaType === "simple_percent") {
    if (typeof src["rate"] !== "number") return null
    // Sanity: RewardFormulaSchema requires rate ∈ [0, 1]. LLM sometimes
    // extracts "1.95% FX surcharge" as `rate: -0.0195`; that's not a
    // reward, it's a fee. Refuse — Zod would 500 the /rules page anyway.
    if (src["rate"] < 0 || src["rate"] > 1) return null
    out["rate"] = src["rate"]
  } else if (rewardFormulaType === "points_per_hkd") {
    if (typeof src["points"] !== "number") return null
    if (typeof src["perHkd"] !== "number") return null
    // Same bounds enforcement — points must be non-negative, perHkd
    // positive (division by zero on the calculator side otherwise).
    if (src["points"] < 0) return null
    if (src["perHkd"] <= 0) return null
    out["points"] = src["points"]
    out["perHkd"] = src["perHkd"]
    if (typeof src["currencySlug"] !== "string") return null
    out["currencySlug"] = src["currencySlug"]
  } else if (rewardFormulaType === "no_reward") {
    // Exclusion rules — payload is just { type:'no_reward' }. Calculator
    // skips reward computation; appliesTo on the flat column controls
    // which rules get zeroed.
    return out
  } else {
    // tiered_* fall through with just `type`; they're not produced by P7
    // today (no extractor support yet). Returning a minimal payload would
    // fail Zod parse, so refuse explicitly.
    return null
  }
  return out
}

type CapShape = {
  amountHkd: string | null
  rewardAmount: string | null
  period: string | null
  basis: string | null
  // P15 (D21): NULL means "single-rule accrual" (calculator falls back
  // to rule.slug in mapRow). Non-null when this cap is shared across
  // multiple rules (applies_to fan-out or card-level fallback).
  usageKey: string | null
}

// Extract the (amountHkd, rewardAmount, period, basis) shape from a cap
// group's canonical_payload. Returns null if the group's canonical is
// missing entirely.
function capFieldsFromGroup(
  group: { canonicalPayload: unknown },
): Omit<CapShape, "usageKey"> | null {
  if (!group.canonicalPayload) return null
  const p = group.canonicalPayload as Record<string, unknown>
  return {
    amountHkd:
      typeof p["amountHkd"] === "number" ? String(p["amountHkd"]) : null,
    rewardAmount:
      typeof p["rewardAmount"] === "number" ? String(p["rewardAmount"]) : null,
    period: typeof p["period"] === "string" ? (p["period"] as string) : null,
    basis: typeof p["basis"] === "string" ? (p["basis"] as string) : null,
  }
}

async function loadMatchingCaps(
  cardId: string,
  earnRateKeyDimension: string,
): Promise<CapShape[]> {
  // P17 (D23): a rule can now carry multiple caps concurrently. Semantics:
  //   (a) PRIMARY cap = first hit of (exact category_slug=X match →
  //       applies_to=X,Y,... fan-out). At most one primary per rule.
  //   (b) SECONDARY cap = card-level cap (cap_default=*_card_level), if
  //       one exists on the card. Applies IN ADDITION to any primary.
  // A base_earn rule with no category still picks up the card-level cap
  // (as its sole cap). Only approvable status caps are eligible —
  // D16 keeps conflict caps out of auto-stitch.
  const eligible = inArray(crossCheckGroups.status, ["agreed", "single_source"])
  const results: CapShape[] = []

  // P18: earn_rate key_dimensions now carry a |formula=... suffix (§3A) but
  // cap groups are still keyed by category only, so match against the bare
  // category dimension. Identity on pre-P18 keys (no suffix).
  const categoryDim = stripFormulaSuffix(earnRateKeyDimension)

  // (1) Exact match — per-rule usageKey (stays null, mapRow falls back to slug).
  const exact = (
    await db
      .select()
      .from(crossCheckGroups)
      .where(
        and(
          eq(crossCheckGroups.cardId, cardId),
          eq(crossCheckGroups.claimType, "cap"),
          eq(crossCheckGroups.keyDimension, categoryDim),
          eligible,
        ),
      )
      .limit(1)
  )[0]
  let primaryLanded = false
  if (exact) {
    const fields = capFieldsFromGroup(exact)
    if (fields) {
      results.push({ ...fields, usageKey: null })
      primaryLanded = true
    }
  }

  // (2) applies_to fan-out — only if no exact match. Shared xcap:id.
  const categoryFromDim = categoryDim.startsWith("category_slug=")
    ? categoryDim.slice("category_slug=".length)
    : null
  if (!primaryLanded && categoryFromDim) {
    const fanoutCandidates = await db
      .select()
      .from(crossCheckGroups)
      .where(
        and(
          eq(crossCheckGroups.cardId, cardId),
          eq(crossCheckGroups.claimType, "cap"),
          like(crossCheckGroups.keyDimension, "applies_to=%"),
          eligible,
        ),
      )
    const fanoutHit = fanoutCandidates.find((g) => {
      const rhs = g.keyDimension.slice("applies_to=".length)
      const parts = rhs.split(",").map((s) => s.trim())
      return parts.includes(categoryFromDim)
    })
    if (fanoutHit) {
      const fields = capFieldsFromGroup(fanoutHit)
      if (fields) {
        results.push({ ...fields, usageKey: `xcap:${fanoutHit.id}` })
        primaryLanded = true
      }
    }
  }

  // (3) Card-level cap — ALWAYS applies on top of any primary (or as
  // the sole cap when no primary match). Real T&C shape: category-
  // specific cap + separate card-wide aggregate cap both bind.
  const cardLevel = (
    await db
      .select()
      .from(crossCheckGroups)
      .where(
        and(
          eq(crossCheckGroups.cardId, cardId),
          eq(crossCheckGroups.claimType, "cap"),
          like(crossCheckGroups.keyDimension, "cap_default=%_card_level"),
          eligible,
        ),
      )
      .limit(1)
  )[0]
  if (cardLevel) {
    const fields = capFieldsFromGroup(cardLevel)
    if (fields) {
      results.push({ ...fields, usageKey: `xcap:${cardLevel.id}` })
    }
  }

  return results
}

// P18 (§3C): find an ACTIVE xchk__ rule on (card, rule_type, category) — the
// stale rule an inferred-category block must deactivate. Only xchk rules;
// hand-curated yaml is never touched by the gate.
async function findActiveXchkRule(
  cardId: string,
  categoryId: string | null,
  ruleType: string,
): Promise<{ id: string; slug: string } | null> {
  const row = (
    await db
      .select({ id: rewardRules.id, slug: rewardRules.slug })
      .from(rewardRules)
      .where(
        and(
          eq(rewardRules.cardId, cardId),
          eq(rewardRules.ruleType, ruleType),
          eq(rewardRules.isActiveForCalculator, true),
          sql`slug LIKE 'xchk__%'`,
          categoryId === null
            ? isNull(rewardRules.categoryId)
            : eq(rewardRules.categoryId, categoryId),
        ),
      )
      .limit(1)
  )[0]
  return row ?? null
}

// P16 (D22): match hand-curated baseline yaml rules on (card, rule_type,
// category). Excludes xchk__ (that's what we're deduping against) and
// excludes campaign rules (Q3 promo etc. are separate from baseline;
// they can co-exist with an xchk baseline rule of the same category).
async function findMatchingYamlBaselineRule(
  cardId: string,
  ruleType: string,
  categoryId: string | null,
): Promise<{ id: string; slug: string } | null> {
  const row = (
    await db
      .select({ id: rewardRules.id, slug: rewardRules.slug })
      .from(rewardRules)
      .where(
        and(
          eq(rewardRules.cardId, cardId),
          eq(rewardRules.status, "approved"),
          eq(rewardRules.ruleType, ruleType),
          isNull(rewardRules.campaignId),
          sql`slug NOT LIKE 'xchk__%'`,
          categoryId === null
            ? isNull(rewardRules.categoryId)
            : eq(rewardRules.categoryId, categoryId),
        ),
      )
      .limit(1)
  )[0]
  return row ?? null
}

async function lookupCategoryId(slug: string | null): Promise<string | null> {
  if (!slug) return null
  const row = (
    await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, slug))
      .limit(1)
  )[0]
  return row?.id ?? null
}

async function lookupCurrencyId(slug: string | null): Promise<string | null> {
  if (!slug) return null
  const row = (
    await db
      .select({ id: rewardCurrencies.id })
      .from(rewardCurrencies)
      .where(eq(rewardCurrencies.slug, slug))
      .limit(1)
  )[0]
  return row?.id ?? null
}
