import { and, eq, inArray, isNull, like, type SQL } from "drizzle-orm"
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
  sourceClaims,
} from "@/db/schema/extraction"

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
    }
  | {
      kind: "skipped"
      groupId: string
      reason: string
      existingRuleId?: string
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
    return await materializeOneInternal(group)
  } catch (err) {
    return { kind: "failed", groupId, error: (err as Error).message }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — bulk (CLI)
// ─────────────────────────────────────────────────────────────────────────────

export async function materializeApprovedGroups(
  scope: MaterializeScope,
): Promise<MaterializeSummary> {
  const conditions: SQL[] = [
    // Eligibility: not yet materialized, has a canonical reading, verdict
    // is agreeable (conflict groups need reviewer pick first via
    // edit_canonical + manual status flip).
    isNull(crossCheckGroups.approvedRuleId),
    inArray(crossCheckGroups.status, ["agreed", "single_source"]),
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
    const outcome = await materializeOneInternal(g)
    summary.outcomes.push(outcome)
    if (outcome.kind === "created") summary.created += 1
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
): Promise<MaterializeOutcome> {
  if (group.approvedRuleId) {
    return {
      kind: "skipped",
      groupId: group.id,
      reason: "already materialized",
      existingRuleId: group.approvedRuleId,
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

  // For earn_rate, opportunistically stitch in any approved cap group on
  // the same dimension. Exclusion claims don't have caps.
  const cap = group.claimType === "earn_rate"
    ? await loadMatchingCap(group.cardId, group.keyDimension)
    : null

  const ruleType = deriveRuleType(group.claimType, payload)
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
        rewardFormulaType,
        rewardFormulaPayload: formulaPayload,
        rewardCurrencyId: currencyId,
        categoryId,
        isOnline: pickBool(payload, "isOnline"),
        isOverseas: pickBool(payload, "isOverseas"),
        isForeignCurrency: pickBool(payload, "isForeignCurrency"),
        appliesTo: pickStringArray(payload, "appliesTo"),
        capAmountHkd: cap?.amountHkd ?? null,
        capRewardAmount: cap?.rewardAmount ?? null,
        capPeriod: cap?.period ?? null,
        capBasis: cap?.basis ?? null,
        capUsageKey: cap?.usageKey ?? null,
        confidenceScore: Number(group.aggregateConfidence).toFixed(3),
        sourceId: primary.sourceId,
        notes: `Materialized from cross_check_group ${group.id} (verdict=${group.status}, ${supports.length} supporting source${supports.length === 1 ? "" : "s"}).`,
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

  return {
    kind: "created",
    groupId: group.id,
    ruleId,
    ruleSlug,
    ruleType,
    capStitched: cap !== null,
    supportingSourceCount: new Set(supports.map((s) => s.sourceId)).size,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function supportsP7(claimType: string): boolean {
  return claimType === "earn_rate" || claimType === "exclusion"
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

async function loadMatchingCap(
  cardId: string,
  earnRateKeyDimension: string,
): Promise<CapShape | null> {
  // P15 match order — first hit wins:
  //   (1) Exact category_slug=X match → per-rule cap, usageKey stays NULL.
  //   (2) applies_to=X,Y,... where the rule's category ∈ set → fan-out.
  //       Multiple earn_rate rules materialized from that cap group SHARE
  //       one usageKey so the calculator's accrual bucket is shared.
  //   (3) Card-level (cap_default=*_card_level) → same idea, one bucket
  //       per (card, cap_group). Only stitched when no more-specific cap
  //       exists — a category-specific cap always wins over a card-wide
  //       one on the same rule.
  // Only approvable statuses are eligible — D16 says a conflict cap is
  // not safe to apply automatically (the reviewer picks canonical first).
  const eligible = inArray(crossCheckGroups.status, ["agreed", "single_source"])

  // (1) Exact match.
  const exact = (
    await db
      .select()
      .from(crossCheckGroups)
      .where(
        and(
          eq(crossCheckGroups.cardId, cardId),
          eq(crossCheckGroups.claimType, "cap"),
          eq(crossCheckGroups.keyDimension, earnRateKeyDimension),
          eligible,
        ),
      )
      .limit(1)
  )[0]
  if (exact) {
    const fields = capFieldsFromGroup(exact)
    if (fields) return { ...fields, usageKey: null }
  }

  // Both fan-out and card-level need the earn_rate rule's category. If
  // the dimension isn't `category_slug=X` (e.g. rule_type=base_earn),
  // neither can apply.
  const categoryFromDim = earnRateKeyDimension.startsWith("category_slug=")
    ? earnRateKeyDimension.slice("category_slug=".length)
    : null

  // (2) Fan-out via applies_to. Load all applies_to=... cap groups on the
  // card, then match by category membership (Postgres `LIKE` can't easily
  // check "X ∈ comma-sorted list", but the sets are small — <10 rows).
  if (categoryFromDim) {
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
      // key_dimension format: "applies_to=X,Y,Z" — split on '=' then ','
      const rhs = g.keyDimension.slice("applies_to=".length)
      const parts = rhs.split(",").map((s) => s.trim())
      return parts.includes(categoryFromDim)
    })
    if (fanoutHit) {
      const fields = capFieldsFromGroup(fanoutHit)
      if (fields) return { ...fields, usageKey: `xcap:${fanoutHit.id}` }
    }
  }

  // (3) Card-level fallback. `cap_default=<period>_<basis>_card_level`
  // groups apply to the card as a whole (aggregate cap across bonuses).
  // If a rule has no more-specific cap, stitch a card-level one so the
  // calculator at least respects the outer bound.
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
    if (fields) return { ...fields, usageKey: `xcap:${cardLevel.id}` }
  }

  return null
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
