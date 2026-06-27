import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db/client"
import { cards, sourceDocuments } from "@/db/schema/catalog"
import {
  crossCheckGroups,
  reviewTasks,
  sourceClaims,
  type CrossCheckGroup,
  type NewCrossCheckGroup,
  type NewReviewTask,
} from "@/db/schema/extraction"

// P4 — cross-check aggregator. Reads pending source_claims, groups them by
// (card_id, claim_type, key_dimension), decides agreed / single_source /
// conflict per PRD §22.6, upserts cross_check_groups, and auto-creates
// review_tasks where needed.
//
// Design choices (see D15):
//   - Single SELECT loads every active claim in scope plus its source's
//     priority — no per-claim round trips.
//   - Group verdict is computed by "anchor + check": pick the
//     highest-weighted claim as the anchor (its payload becomes the
//     canonical_payload candidate), then walk the other claims and mark
//     any that disagree on a shared field beyond tolerance as
//     contradicting. This is simpler than the per-field median/mode
//     described in PRD §22.6 and gives the same verdict in our actual
//     data, where most clusters are 2-5 claims and disagreements show up
//     as whole-claim conflicts rather than single-field outliers. We'll
//     graduate to true per-field consensus if a real conflict surfaces
//     where the anchor-based approach picks the wrong canonical.
//   - Upserts (ON CONFLICT DO UPDATE) on the (card, claim_type, dimension)
//     UNIQUE index (D12) — re-running over the same claim set produces
//     zero net writes.
//   - Review tasks: created only when a group has no open/in_progress
//     task already, so re-runs don't spam the queue.
//   - Tolerance for numeric agreement is ±5% per PRD §22.6, with a small
//     absolute floor (0.001) so values close to zero don't blow up the
//     denominator.
//
// Out of scope here (later milestones):
//   - Auto-approve agreed groups with priority ≤2 + confidence ≥0.9 (PRD
//     §22.7) — that's P5/P7 reviewer-UI territory.
//   - Per-field median / mode consensus for huge clusters (>5 claims).
//   - Re-classifying already-approved claims when a new contradicting
//     claim arrives (the reviewer made a call; only manual reopen).

// Priority weights per PRD §22.6. Priority 1 = official T&C PDF, 8 =
// manual note. Keep this table in sync if PRD §6.6 changes.
export const SOURCE_PRIORITY_WEIGHTS: Readonly<Record<number, number>> = {
  1: 1.0,
  2: 0.9,
  3: 0.8,
  4: 0.95,
  5: 0.5,
  6: 0.3,
  7: 0.2,
  8: 0.1,
} as const

// Out-of-range priority falls back to mid (matches the "competitor" weight
// — a safe-ish default). Logged via the rare-priority counter on the
// summary so we notice if our taxonomy drifts.
function priorityWeight(priority: number): number {
  return SOURCE_PRIORITY_WEIGHTS[priority] ?? 0.5
}

// Numeric tolerance — values within ±5% of each other count as agreeing.
// Below the absolute floor we require exact equality (a "5% of 0" check
// would always pass otherwise).
const NUMERIC_RELATIVE_TOLERANCE = 0.05
const NUMERIC_ABSOLUTE_FLOOR = 0.001

// Informational fields don't gate the verdict — they're descriptive text
// the reviewer reads, not values the calculator observes. Different
// sources will phrase "perpetual waiver" five different ways including
// in Chinese; if we treated those as contradictions the annual_fee
// group would always be `conflict` despite all sources agreeing the fee
// is HKD 0. Calculator-relevant fields (rate, amountHkd, categorySlug,
// boolean flags) are the ones that gate agreement.
//
// If you add a new informational field, also drop it from the per-claim
// payload guidance in prompt.ts so the extractor knows it's optional
// fluff. Reverse: don't promote a load-bearing field into here.
const INFORMATIONAL_FIELDS: ReadonlySet<string> = new Set([
  "waiverConditions",
  "criteria",
  "definition",
  "description",
  "note",
])

export type AggregateScope = {
  cardSlugs?: string[]
  cardStatuses?: ("active" | "draft" | "archived")[]
  // Limit to one claim_type (debugging). Default: all claim types.
  claimTypes?: string[]
}

export type AggregateOptions = {
  scope: AggregateScope
  // Skip DB writes. The runner still computes verdicts and fires events
  // so the operator can preview what would change.
  dryRun?: boolean
  onGroupComplete?: (event: GroupEvent) => void
}

export type GroupEvent = {
  cardSlug: string
  claimType: string
  keyDimension: string
  status: "agreed" | "single_source" | "conflict"
  supportingCount: number
  contradictingCount: number
  aggregateConfidence: number
  taskCreated: boolean
  wasInserted: boolean // true = newly created group, false = updated existing
}

export type AggregateSummary = {
  claimsScanned: number
  groupsTotal: number
  groupsInserted: number
  groupsUpdated: number
  agreed: number
  singleSource: number
  conflict: number
  reviewTasksCreated: number
  perCard: Record<
    string,
    {
      claimsScanned: number
      groupsTotal: number
      agreed: number
      singleSource: number
      conflict: number
    }
  >
}

// Row shape after we join claims to their source's priority + the card's
// slug. Used as the working set inside the aggregator.
type LoadedClaim = {
  claimId: string
  cardId: string
  cardSlug: string
  sourceId: string
  sourcePriority: number
  claimType: string
  structuredPayload: Record<string, unknown>
  confidence: number
}

export async function aggregateClaims(
  options: AggregateOptions,
): Promise<AggregateSummary> {
  const dryRun = options.dryRun ?? false
  const claims = await loadActiveClaims(options.scope)

  const summary: AggregateSummary = {
    claimsScanned: claims.length,
    groupsTotal: 0,
    groupsInserted: 0,
    groupsUpdated: 0,
    agreed: 0,
    singleSource: 0,
    conflict: 0,
    reviewTasksCreated: 0,
    perCard: {},
  }

  // Group claims in memory: card_id → claim_type → key_dimension → claims[].
  // Key skips (null) silently drop claims whose payload doesn't expose a
  // stable dimension — currently no claim_type returns null, but the
  // function is defensive in case the prompt emits something off-shape.
  const byGroup = new Map<string, { card: { id: string; slug: string }; claimType: string; keyDimension: string; claims: LoadedClaim[] }>()
  for (const c of claims) {
    const dim = computeKeyDimension(c.claimType, c.structuredPayload)
    if (dim === null) continue
    const key = `${c.cardId}\t${c.claimType}\t${dim}`
    const existing = byGroup.get(key)
    if (existing) {
      existing.claims.push(c)
    } else {
      byGroup.set(key, {
        card: { id: c.cardId, slug: c.cardSlug },
        claimType: c.claimType,
        keyDimension: dim,
        claims: [c],
      })
    }
  }

  for (const g of byGroup.values()) {
    const verdict = decideVerdict(g.claims)

    const perCard = (summary.perCard[g.card.slug] ??= {
      claimsScanned: 0,
      groupsTotal: 0,
      agreed: 0,
      singleSource: 0,
      conflict: 0,
    })
    perCard.groupsTotal += 1
    summary.groupsTotal += 1
    if (verdict.status === "agreed") {
      summary.agreed += 1
      perCard.agreed += 1
    } else if (verdict.status === "single_source") {
      summary.singleSource += 1
      perCard.singleSource += 1
    } else {
      summary.conflict += 1
      perCard.conflict += 1
    }

    let wasInserted = false
    let taskCreated = false

    if (!dryRun) {
      const result = await upsertGroup({
        cardId: g.card.id,
        claimType: g.claimType,
        keyDimension: g.keyDimension,
        verdict,
      })
      wasInserted = result.wasInserted
      if (result.wasInserted) summary.groupsInserted += 1
      else summary.groupsUpdated += 1

      // Backfill the FK on each contributing claim so the reverse lookup
      // ("which group does this claim belong to?") doesn't require a join
      // through cross_check_groups.supportingClaimIds.
      await db
        .update(sourceClaims)
        .set({ crossCheckGroupId: result.groupId, updatedAt: new Date() })
        .where(
          inArray(
            sourceClaims.id,
            [...verdict.supportingClaimIds, ...verdict.contradictingClaimIds],
          ),
        )

      taskCreated = await ensureReviewTask({
        groupId: result.groupId,
        cardId: g.card.id,
        cardSlug: g.card.slug,
        claimType: g.claimType,
        keyDimension: g.keyDimension,
        status: verdict.status,
        supportingCount: verdict.supportingClaimIds.length,
        contradictingCount: verdict.contradictingClaimIds.length,
      })
      if (taskCreated) summary.reviewTasksCreated += 1
    }

    perCard.claimsScanned += g.claims.length

    options.onGroupComplete?.({
      cardSlug: g.card.slug,
      claimType: g.claimType,
      keyDimension: g.keyDimension,
      status: verdict.status,
      supportingCount: verdict.supportingClaimIds.length,
      contradictingCount: verdict.contradictingClaimIds.length,
      aggregateConfidence: verdict.aggregateConfidence,
      taskCreated,
      wasInserted,
    })
  }

  return summary
}

// ─────────────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadActiveClaims(scope: AggregateScope): Promise<LoadedClaim[]> {
  // "Active" = pending_review or draft. Approved/rejected/superseded are
  // settled; the aggregator doesn't re-evaluate them so reviewer decisions
  // are preserved. (If a new contradicting claim lands, the reviewer can
  // manually reopen and re-run.)
  const conditions = [inArray(sourceClaims.status, ["pending_review", "draft"])]
  if (scope.cardSlugs && scope.cardSlugs.length > 0) {
    conditions.push(inArray(cards.slug, scope.cardSlugs))
  }
  if (scope.cardStatuses && scope.cardStatuses.length > 0) {
    conditions.push(inArray(cards.status, scope.cardStatuses))
  }
  if (scope.claimTypes && scope.claimTypes.length > 0) {
    conditions.push(inArray(sourceClaims.claimType, scope.claimTypes))
  }

  const rows = await db
    .select({
      claimId: sourceClaims.id,
      cardId: sourceClaims.cardId,
      cardSlug: cards.slug,
      sourceId: sourceClaims.sourceId,
      sourcePriority: sourceDocuments.sourcePriority,
      claimType: sourceClaims.claimType,
      structuredPayload: sourceClaims.structuredPayload,
      confidence: sourceClaims.confidenceScore,
    })
    .from(sourceClaims)
    .innerJoin(cards, eq(sourceClaims.cardId, cards.id))
    .innerJoin(sourceDocuments, eq(sourceClaims.sourceId, sourceDocuments.id))
    .where(and(...conditions))
    .orderBy(asc(cards.slug), asc(sourceClaims.claimType), asc(sourceClaims.id))

  return rows.map((r) => ({
    claimId: r.claimId,
    cardId: r.cardId,
    cardSlug: r.cardSlug,
    sourceId: r.sourceId,
    sourcePriority: r.sourcePriority,
    claimType: r.claimType,
    structuredPayload: r.structuredPayload as Record<string, unknown>,
    confidence: Number(r.confidence),
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Grouping key
// ─────────────────────────────────────────────────────────────────────────────

// computeKeyDimension — string discriminator within a claim_type that
// identifies "this is the same logical assertion". Two claims with the
// same (cardId, claimType, keyDimension) are candidates to cross-check.
//
// Convention: `${field}=${value}` so a glance at cross_check_groups.key_dimension
// is enough to know what's being checked. Returns null if the payload
// doesn't carry enough info to derive a stable dimension — that claim is
// dropped from aggregation (logged on the run summary, manual review).
export function computeKeyDimension(
  claimType: string,
  payload: Record<string, unknown>,
): string | null {
  switch (claimType) {
    case "earn_rate": {
      // Categorized bonus → group by category. Uncategorized "base earn"
      // collapses to a single dimension per card.
      const cat = pickString(payload, "categorySlug")
      if (cat) return `category_slug=${cat}`
      return "rule_type=base_earn"
    }
    case "cap": {
      // Cap is conceptually tied to an earn_rate. Most claims that emit
      // a cap also carry the categorySlug; if they don't, fall back to
      // the period+basis pair as a discriminator (so a year/spending cap
      // doesn't collide with a month/reward cap).
      const cat = pickString(payload, "categorySlug")
      if (cat) return `category_slug=${cat}`
      const period = pickString(payload, "period") ?? "unknown"
      const basis = pickString(payload, "basis") ?? "unknown"
      return `cap_default=${period}_${basis}`
    }
    case "exclusion": {
      // Group by what the exclusion applies to. appliesTo is an array;
      // sort + join so order doesn't matter.
      const cat = pickString(payload, "categorySlug")
      if (cat) return `category_slug=${cat}`
      const appliesTo = payload["appliesTo"]
      if (Array.isArray(appliesTo) && appliesTo.length > 0) {
        const sorted = [...appliesTo].map((v) => String(v).toLowerCase()).sort()
        return `applies_to=${sorted.join(",")}`
      }
      return "exclusion_default"
    }
    case "welcome_offer":
      return "welcome_offer_default"
    case "category_definition": {
      const cat = pickString(payload, "categorySlug")
      return cat ? `category_slug=${cat}` : "category_definition_default"
    }
    case "annual_fee":
      return "annual_fee_default"
    case "eligibility":
      return "eligibility_default"
    default:
      return null
  }
}

function pickString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key]
  return typeof v === "string" && v.length > 0 ? v.toLowerCase() : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Verdict
// ─────────────────────────────────────────────────────────────────────────────

export type Verdict = {
  status: "agreed" | "single_source" | "conflict"
  canonicalPayload: Record<string, unknown> | null
  supportingClaimIds: string[]
  contradictingClaimIds: string[]
  aggregateConfidence: number
}

export function decideVerdict(claims: readonly LoadedClaim[]): Verdict {
  if (claims.length === 0) {
    // Caller never groups an empty cluster; defensive fallback.
    return {
      status: "single_source",
      canonicalPayload: null,
      supportingClaimIds: [],
      contradictingClaimIds: [],
      aggregateConfidence: 0,
    }
  }

  // Sort by weight descending — the heaviest claim becomes the anchor.
  // Tie-break by claim id for determinism (same input always picks the
  // same anchor, otherwise the aggregator is non-idempotent across DB
  // row ordering changes).
  const ranked = [...claims].sort((a, b) => {
    const wb = priorityWeight(b.sourcePriority) * b.confidence
    const wa = priorityWeight(a.sourcePriority) * a.confidence
    if (wb !== wa) return wb - wa
    return a.claimId.localeCompare(b.claimId)
  })

  const anchor = ranked[0]!
  const canonical: Record<string, unknown> = { ...anchor.structuredPayload }

  const supportingIds: string[] = [anchor.claimId]
  const contradictingIds: string[] = []

  for (let i = 1; i < ranked.length; i++) {
    const claim = ranked[i]!
    if (claimAgreesWith(claim.structuredPayload, canonical)) {
      // Merge in any fields the anchor didn't have — they don't conflict
      // and they enrich the canonical payload (e.g. anchor says "4%
      // online_local", supporting says "4% online_local, isOnline: true").
      for (const [k, v] of Object.entries(claim.structuredPayload)) {
        if (!(k in canonical)) canonical[k] = v
      }
      supportingIds.push(claim.claimId)
    } else {
      contradictingIds.push(claim.claimId)
    }
  }

  // Aggregate confidence = weighted average over supporting claims only.
  // Contradicting claims don't contribute to the agreed verdict's confidence.
  const supporting = ranked.filter((c) => supportingIds.includes(c.claimId))
  const totalWeight = supporting.reduce(
    (s, c) => s + priorityWeight(c.sourcePriority),
    0,
  )
  const weightedSum = supporting.reduce(
    (s, c) => s + priorityWeight(c.sourcePriority) * c.confidence,
    0,
  )
  const aggregateConfidence = totalWeight > 0 ? weightedSum / totalWeight : 0

  let status: Verdict["status"]
  if (contradictingIds.length > 0) {
    // PRD §22.6: conflict if priorities ≤4 disagree, OR if any priority
    // ≤5 contradicts the canonical. We use the broader rule — any
    // contradicting claim from priority ≤5 demotes the group to conflict.
    // Higher-numbered (forum, anecdotal) disagreements get logged on the
    // group but don't change the verdict.
    const meaningfulContradiction = ranked.some(
      (c) => contradictingIds.includes(c.claimId) && c.sourcePriority <= 5,
    )
    status = meaningfulContradiction ? "conflict" : "agreed"
  } else if (supportingIds.length >= 2) {
    status = "agreed"
  } else {
    status = "single_source"
  }

  return {
    status,
    // Even on conflict we keep the anchor's payload as canonical_payload
    // (clearly labeled by status=conflict on the row). Lets the reviewer
    // start from the highest-weighted reading rather than a blank slate.
    canonicalPayload: canonical,
    supportingClaimIds: supportingIds,
    contradictingClaimIds: contradictingIds,
    aggregateConfidence,
  }
}

// claimAgreesWith — true iff every shared CALCULATOR-OBSERVED field is
// consistent within tolerance. Missing fields on either side are not a
// conflict; they're just less information. Informational fields
// (waiverConditions, note, etc.) are skipped entirely — the reviewer
// sees them on the claim but the verdict doesn't gate on them.
export function claimAgreesWith(
  claim: Record<string, unknown>,
  canonical: Record<string, unknown>,
): boolean {
  for (const [k, v] of Object.entries(claim)) {
    if (INFORMATIONAL_FIELDS.has(k)) continue
    if (!(k in canonical)) continue
    if (!valuesAgree(v, canonical[k])) return false
  }
  return true
}

function valuesAgree(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    const denom = Math.max(Math.abs(a), Math.abs(b), NUMERIC_ABSOLUTE_FLOOR)
    return Math.abs(a - b) / denom <= NUMERIC_RELATIVE_TOLERANCE
  }
  if (typeof a === "string" && typeof b === "string") {
    return a.trim().toLowerCase() === b.trim().toLowerCase()
  }
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    const sa = [...a].map((x) => String(x).toLowerCase()).sort()
    const sb = [...b].map((x) => String(x).toLowerCase()).sort()
    return sa.every((v, i) => v === sb[i])
  }
  // Mixed types — strings vs numbers etc. Don't equate; the prompt is
  // supposed to produce same-typed values for the same field.
  return a === b
}

// ─────────────────────────────────────────────────────────────────────────────
// DB writes
// ─────────────────────────────────────────────────────────────────────────────

async function upsertGroup(args: {
  cardId: string
  claimType: string
  keyDimension: string
  verdict: Verdict
}): Promise<{ groupId: string; wasInserted: boolean }> {
  const values: NewCrossCheckGroup = {
    cardId: args.cardId,
    claimType: args.claimType,
    keyDimension: args.keyDimension,
    status: args.verdict.status,
    canonicalPayload: args.verdict.canonicalPayload,
    aggregateConfidence: args.verdict.aggregateConfidence.toFixed(3),
    supportingClaimIds: args.verdict.supportingClaimIds,
    contradictingClaimIds: args.verdict.contradictingClaimIds,
  }

  // INSERT ... ON CONFLICT (D12 UNIQUE) DO UPDATE — idempotent re-runs.
  // RETURNING xmax = 0 distinguishes insert vs update for the summary.
  const inserted = (await db
    .insert(crossCheckGroups)
    .values(values)
    .onConflictDoUpdate({
      target: [
        crossCheckGroups.cardId,
        crossCheckGroups.claimType,
        crossCheckGroups.keyDimension,
      ],
      set: {
        status: values.status,
        canonicalPayload: values.canonicalPayload,
        aggregateConfidence: values.aggregateConfidence,
        supportingClaimIds: values.supportingClaimIds,
        contradictingClaimIds: values.contradictingClaimIds,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: crossCheckGroups.id,
      // xmax=0 on a freshly inserted tuple, non-zero when the row already
      // existed and we updated it. Standard postgres trick to distinguish
      // upsert path without a second query.
      wasInserted: sql<boolean>`(xmax = 0)`,
    })) as { id: string; wasInserted: boolean }[]

  const row = inserted[0]
  if (!row) {
    throw new Error(
      `cross_check_groups upsert returned no row for (${args.cardId}, ${args.claimType}, ${args.keyDimension})`,
    )
  }
  return { groupId: row.id, wasInserted: row.wasInserted }
}

async function ensureReviewTask(args: {
  groupId: string
  cardId: string
  cardSlug: string
  claimType: string
  keyDimension: string
  status: "agreed" | "single_source" | "conflict"
  supportingCount: number
  contradictingCount: number
}): Promise<boolean> {
  // Skip if there's already an open/in_progress task for this group —
  // re-runs shouldn't spam the reviewer queue. If the verdict changes
  // (e.g. agreed → conflict because a new contradicting claim arrived),
  // we still update the group row but leave the task alone; reviewer can
  // see the new contradicting count when they open it.
  const existing = await db
    .select({ id: reviewTasks.id })
    .from(reviewTasks)
    .where(
      and(
        eq(reviewTasks.subjectGroupId, args.groupId),
        inArray(reviewTasks.status, ["open", "in_progress"]),
      ),
    )
    .limit(1)
  if (existing.length > 0) return false

  const task: NewReviewTask = {
    cardId: args.cardId,
    subjectGroupId: args.groupId,
    title: buildTaskTitle(args),
    description: buildTaskDescription(args),
    taskType:
      args.status === "conflict"
        ? "conflict_resolution"
        : args.status === "agreed"
          ? "cross_check_confirmation"
          : "claim_review",
    priority: args.status === "conflict" ? "high" : "normal",
  }

  await db.insert(reviewTasks).values(task)
  return true
}

function buildTaskTitle(args: {
  cardSlug: string
  claimType: string
  keyDimension: string
  status: "agreed" | "single_source" | "conflict"
}): string {
  const verb =
    args.status === "conflict"
      ? "Resolve conflict"
      : args.status === "agreed"
        ? "Confirm cross-check"
        : "Review single-source claim"
  return `${verb}: ${args.cardSlug} · ${args.claimType} · ${args.keyDimension}`
}

function buildTaskDescription(args: {
  status: "agreed" | "single_source" | "conflict"
  supportingCount: number
  contradictingCount: number
  claimType: string
  keyDimension: string
}): string {
  return [
    `claim_type: ${args.claimType}`,
    `key_dimension: ${args.keyDimension}`,
    `status: ${args.status}`,
    `supporting_claims: ${args.supportingCount}`,
    `contradicting_claims: ${args.contradictingCount}`,
  ].join("\n")
}

// Re-export the group row type so callers (CLI, future review UI) don't
// need to import from the schema directly.
export type { CrossCheckGroup }
